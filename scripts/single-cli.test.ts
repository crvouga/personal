import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
test('personal owns the only user executable; other private package manifests expose no bins', () => {
  for (const name of readdirSync(join(root, 'packages'))) {
    const path = join(root, 'packages', name, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (name === 'personal-cli') continue;
    expect(manifest.bin, path).toBeUndefined();
  }
});

test('npx @crvouga/personal resolves to this checkout through the workspace link', () => {
  const source = JSON.parse(
    readFileSync(join(root, 'packages/personal-cli/package.json'), 'utf8')
  );
  expect(source.name).toBe('@crvouga/personal');
  expect(source.private).toBe(true);
  expect(source.bin).toEqual({ personal: './bin.mjs' });
  const rootManifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  );
  expect(rootManifest.devDependencies['@crvouga/personal']).toBe('workspace:*');
});

test('legacy domain tasks forward to personal rather than independent CLIs', () => {
  const { scripts } = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  );
  for (const name of ['password-manager', 'health', 'health:fix', 'domains']) {
    expect(scripts[name]).toStartWith('bun run personal ');
  }
  // Fleet tasks run dev-fleet at the pinned revision, not personal.
  for (const name of ['fleet', 'cliproxy'])
    expect(scripts[name]).toStartWith('sh scripts/dev/fleet.sh');
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
  expect(manifest.scripts.dev).toContain(
    'personal-cli/src/cli.ts infra-vault run'
  );
});
