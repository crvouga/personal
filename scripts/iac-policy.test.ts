import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const repo = join(import.meta.dirname, '..');
const tofu = 'packages/infra/tofu/';
// AGENTS.md permits read-only health probes. Audit this single adapter's
// fetch options structurally rather than exempting a directory or provider.
const readOnlyCloudflare = 'packages/infra/lib/domains/cloudflare.ts';

function getOnlyFetches(text: string): number {
  const source = ts.createSourceFile(
    'adapter.ts',
    text,
    ts.ScriptTarget.Latest,
    true
  );
  let calls = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'fetch') ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'fetch'))
    ) {
      calls++;
      const options = node.arguments[1];
      if (!options || !ts.isObjectLiteralExpression(options))
        throw new Error('Explicit GET options required');
      const fields = options.properties;
      if (
        fields.some(
          (field) =>
            !ts.isPropertyAssignment(field) ||
            !['method', 'headers', 'redirect', 'signal'].includes(
              field.name.getText(source)
            )
        )
      )
        throw new Error('Unknown or mutating fetch option');
      const method = fields.find(
        (field) =>
          ts.isPropertyAssignment(field) &&
          field.name.getText(source) === 'method'
      );
      if (
        !method ||
        !ts.isPropertyAssignment(method) ||
        !ts.isStringLiteral(method.initializer) ||
        method.initializer.text !== 'GET'
      )
        throw new Error('Only literal GET is allowed');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}
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
          '.domain-migration',
        ].includes(part)
      )
);

describe('OpenTofu infrastructure ownership', () => {
  test('infrastructure adapters contain no cloud control plane clients', () => {
    const violations = sourceFiles.filter((file) => {
      if (file.startsWith(tofu) || file.endsWith('.test.ts')) return false;
      const text = readFileSync(join(repo, file), 'utf8');
      if (file === readOnlyCloudflare) {
        expect(getOnlyFetches(text)).toBe(1);
        expect(text).not.toMatch(
          /child_process|Bun\.spawn|node:https|node:http|XMLHttpRequest/
        );
        return false;
      }
      return /backboard\.railway\.(?:app|com)|api\.cloudflare\.com|api\.planetscale\.com/.test(
        text
      );
    });
    expect(violations).toEqual([]);
  });

  test('the health-read exception rejects writes, implicit methods and spread/body options', () => {
    for (const options of [
      "{ method: 'PUT' }",
      '{}',
      "{ method: 'GET', body: data }",
      "{ method: 'GET', ...options }",
      'options',
    ]) {
      expect(() => getOnlyFetches(`ctx.fetch(url, ${options})`)).toThrow();
    }
    expect(
      getOnlyFetches("ctx.fetch(url, { method: 'GET', headers: {} })")
    ).toBe(1);
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
      expect(command).toMatch(
        /^tofu -chdir=packages\/infra\/tofu\/[a-z]+(?:-[a-z]+)*$/
      );
    }
    expect(pkg.scripts.reconcile).toBeUndefined();
    expect(sourceFiles).not.toContain('packages/infra/services.yaml');
  });
});
