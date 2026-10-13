import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const tofu = 'packages/infra/tofu/';
const sourceFiles = [
  ...new Bun.Glob('**/*.{ts,sh,yml,yaml,tf,json}').scanSync({
    cwd: repo,
    dot: true,
    onlyFiles: true,
  }),
].filter(
  (file) =>
    !file
      .split('/')
      .some((part) =>
        [
          'node_modules',
          '.git',
          '.terraform',
          'dist',
          '.astro',
          '.sc',
          '.turbo',
        ].includes(part)
      )
);

describe('OpenTofu infrastructure ownership', () => {
  test('infrastructure adapters contain no cloud control plane clients', () => {
    const violations = sourceFiles.filter((file) => {
      if (file.startsWith(tofu) || file.endsWith('.test.ts')) return false;
      const text = readFileSync(join(repo, file), 'utf8');
      return /backboard\.railway\.(?:app|com)|api\.cloudflare\.com|api\.planetscale\.com/.test(
        text
      );
    });
    expect(violations).toEqual([]);
  });

  test('resource definitions cannot invoke shell provisioning or another IaC engine', () => {
    const violations = sourceFiles.filter((file) => {
      if (!file.startsWith(tofu) || !/\.tf(?:\.json)?$/.test(file))
        return false;
      const text = readFileSync(join(repo, file), 'utf8');
      return /\bprovisioner\s+"|"provisioner"\s*:|\b(?:resource|data)\s+"(?:null_resource|external)"|"(?:null_resource|external)"\s*:/.test(
        text
      );
    });
    expect(violations).toEqual([]);
  });

  test('cloud lifecycle commands forward directly to OpenTofu', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
    const commands = Object.entries(pkg.scripts).filter(
      ([name]) => name === 'infra' || name.startsWith('infra:')
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const [, command] of commands) {
      expect(command).toMatch(/^tofu -chdir=packages\/infra\/tofu\/[a-z]+$/);
    }
    expect(pkg.scripts.reconcile).toBeUndefined();
    expect(sourceFiles).not.toContain('packages/infra/services.yaml');
  });
});
