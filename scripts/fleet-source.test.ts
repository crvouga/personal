import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync('packages/fleet/source.json', 'utf8'));

test('machine and API builds consume the identical pinned external Fleet revision', () => {
  expect(source.url).toBe('https://github.com/crvouga/fleet.git');
  expect(source.rev).toMatch(/^[0-9a-f]{40}$/);
  expect(
    execFileSync('git', ['-C', 'vendor/fleet', 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  ).toBe(source.rev);
  expect(readFileSync('.gitmodules', 'utf8')).toContain(source.url);
  expect(readFileSync('.github/workflows/runner-check.yml', 'utf8')).toContain(
    `@${source.rev}`
  );
  expect(
    readFileSync('packages/infra/tofu/foundation/fleet-database.tf', 'utf8')
  ).toContain('/../../../../vendor/fleet/packages/fleet-api/schema.hcl');
  expect(readFileSync('packages/fleet/roles.json', 'utf8')).toBe(
    readFileSync('vendor/fleet/packages/fleet/roles.json', 'utf8')
  );
  expect(existsSync('packages/fleet-api/package.json')).toBe(false);
  expect(existsSync('packages/fleet/modules/base.nix')).toBe(false);
});
