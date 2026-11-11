import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

test('fleet.revision pins dev-fleet to a full commit', () => {
  expect(readFileSync(join(root, 'fleet.revision'), 'utf8')).toMatch(
    /^[a-f0-9]{40}\n$/
  );
});
