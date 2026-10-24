import { expect, test } from 'bun:test';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

test('Fleet BDD metadata and its test runner use the same Playwright core', () => {
  const fleet = createRequire(
    new URL('../packages/fleet-api/package.json', import.meta.url)
  );
  const bdd = createRequire(fleet.resolve('playwright-bdd'));
  const runner = createRequire(fleet.resolve('@playwright/test'));
  const playwright = createRequire(runner.resolve('playwright/package.json'));
  expect(bdd('playwright-core/package.json').version).toBe(
    playwright('playwright-core/package.json').version
  );
});

test('Docker frozen workspace installs receive every declared package manifest', () => {
  const manifests = readdirSync('packages').filter((name) =>
    existsSync(join('packages', name, 'package.json'))
  );
  for (const image of [
    'portfolio',
    'turborepo-remote-cache',
    'auth-relay',
    'fleet-api',
  ]) {
    const dockerfile = readFileSync(
      join('packages', image, 'Dockerfile'),
      'utf8'
    );
    for (const name of manifests) {
      expect(dockerfile).toContain(
        `COPY packages/${name}/package.json ./packages/${name}/`
      );
    }
  }
});
