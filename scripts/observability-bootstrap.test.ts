import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseStack, updateInventory } from './observability-bootstrap';

const wanted = {
  slug: 'chrisvouga',
  name: 'chrisvouga',
  region: 'prod-us-east-0',
  adopt: true,
};
const stack = (slug: string, regionSlug = 'prod-us-east-0') => ({
  slug,
  name: slug,
  regionSlug,
  status: 'active',
});

test('adopts the inventory stack, else the only one, and records its real region', () => {
  expect(
    chooseStack([stack('other'), stack('chrisvouga', 'prod-eu-west-2')], wanted)
  ).toEqual({
    ...wanted,
    region: 'prod-eu-west-2',
  });
  expect(chooseStack([stack('signup123')], wanted)).toEqual({
    slug: 'signup123',
    name: 'signup123',
    region: 'prod-us-east-0',
    adopt: true,
  });
});

test('creates the inventory stack when the organization has none', () => {
  expect(chooseStack([], wanted)).toEqual({ ...wanted, adopt: false });
});

test('refuses to guess between several stacks or adopt a missing named one', () => {
  expect(() => chooseStack([stack('a'), stack('b')], wanted)).toThrow(
    '--stack'
  );
  expect(chooseStack([stack('a'), stack('b')], wanted, 'b').slug).toBe('b');
  expect(() => chooseStack([stack('a')], wanted, 'b')).toThrow('No stack "b"');
});

test('rewrites only the observability block of the real inventory', () => {
  const path = resolve(
    import.meta.dirname,
    '../packages/infra/tofu/modules/inventory/inventory.tf.json'
  );
  const text = readFileSync(path, 'utf8');
  const next = updateInventory(text, {
    slug: 's1',
    name: 'S 1',
    region: 'prod-eu-west-2',
    adopt: false,
  });
  const before = JSON.parse(text).locals.inventory;
  const after = JSON.parse(next).locals.inventory;
  expect(after.observability).toEqual({
    ...before.observability,
    live: true,
    stack: { slug: 's1', name: 'S 1', region: 'prod-eu-west-2', adopt: false },
  });
  expect({ ...after, observability: null }).toEqual({
    ...before,
    observability: null,
  });
  expect(next.length - text.length).toBeLessThan(40);
});
