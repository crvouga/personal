import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
test('personal owns the only user executable; private package manifests expose no bins', () => {
  for (const name of readdirSync(join(root, 'packages'))) {
    const path = join(root, 'packages', name, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    expect(manifest.bin, path).toBeUndefined();
  }
  const build = readFileSync(
    join(root, 'packages/personal-cli/scripts/build.ts'),
    'utf8'
  );
  expect(build).toContain("bin: { personal: './cli.mjs' }");
});

test('legacy domain tasks forward to personal rather than independent CLIs', () => {
  const { scripts } = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  );
  for (const name of [
    'fleet',
    'password-manager',
    'cliproxy',
    'health',
    'health:fix',
    'domains',
  ]) {
    expect(scripts[name]).toStartWith('bun run personal ');
  }
});

test('custom Vault operations live behind personal, with no global copied wrapper installer', () => {
  expect(existsSync(join(root, 'packages/vault-service/cli/bin/vault'))).toBe(
    false
  );
  const installer = readFileSync(
    join(root, 'packages/vault-service/scripts/install-cli.sh'),
    'utf8'
  );
  expect(installer).toContain('personal:install');
  expect(installer).not.toContain('cp -R');
  const manifest = JSON.parse(
    readFileSync(join(root, 'packages/portfolio/package.json'), 'utf8')
  );
  expect(manifest.scripts.dev).toContain('personal-cli/src/cli.ts vault run');
});
