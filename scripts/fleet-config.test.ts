import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const json = (path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;

test('fleet.revision pins dev-fleet to a full commit', () => {
  expect(readFileSync(join(root, 'fleet.revision'), 'utf8')).toMatch(
    /^[a-f0-9]{40}\n$/
  );
});

// fleet.json is what runs the fleet (through dev-fleet). The older copy under
// packages/fleet only feeds the SSH/editor setup until that code is removed,
// so the two must describe the same machines and endpoints.
test('fleet.json and the older definition describe the same fleet', () => {
  const fleet = json('fleet.json');
  const older = json('packages/fleet/definition.json');
  for (const key of ['manager', 'workers', 'services', 'worker', 'ubuntu'])
    expect(fleet[key]).toEqual(older[key]);
});
