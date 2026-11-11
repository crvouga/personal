import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

// The image installs the runtime with `npm ci`, which refuses a lock that
// disagrees with package.json. Bun-ecosystem bumps edit only package.json, so
// regenerate the lock in the same PR, from a copy of both files outside the
// workspace: `npm install --package-lock-only --ignore-scripts`.
test('package-lock.json matches package.json, so the image can npm ci', () => {
  const { dependencies } = read('./package.json');
  const { packages } = read('./package-lock.json');
  assert.deepEqual(packages[''].dependencies, dependencies);
  for (const [name, version] of Object.entries(dependencies))
    assert.equal(packages[`node_modules/${name}`]?.version, version);
});
