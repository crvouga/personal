import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { sourceFiles as repositorySources } from './ci/source-files';
import { deploymentQuery } from '../packages/infra/lib/railway-deployments';
import { volumeQuery } from '../packages/infra/lib/health/check-volumes';

const repo = join(import.meta.dirname, '..');
const tofu = 'packages/infra/tofu/';
// AGENTS.md permits read-only health probes. Audit this single adapter's
// fetch options structurally rather than exempting a directory or provider.
const readOnlyCloudflare = 'packages/infra/lib/domains/cloudflare.ts';
const readOnlyRailway = 'packages/infra/lib/railway-deployments.ts';
const readOnlyVolume = 'packages/infra/lib/health/check-volumes.ts';

function deploymentReads(
  text: string,
  queryName = 'deploymentQuery',
  expectedQuery = deploymentQuery
): void {
  const source = ts.createSourceFile(
    'reader.ts',
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const requests: ts.CallExpression[] = [];
  const queries: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === queryName
    )
      queries.push(node);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'request'
    )
      requests.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(queries).toHaveLength(1);
  expect(ts.isNoSubstitutionTemplateLiteral(queries[0]!.initializer!)).toBe(
    true
  );
  expect(
    (queries[0]!.initializer as ts.NoSubstitutionTemplateLiteral).text
  ).toBe(expectedQuery);
  expect(expectedQuery).toMatch(/^query (Rollout|VolumeWriter)\(/);
  expect(expectedQuery).not.toMatch(/\b(mutation|subscription)\b/);
  expect(requests).toHaveLength(1);
  const options = requests[0]!.arguments[1]!;
  if (!ts.isObjectLiteralExpression(options))
    throw new Error('Explicit read options required');
  const fields = options.properties;
  expect(fields.every(ts.isPropertyAssignment)).toBe(true);
  expect(fields.map((field) => field.name!.getText(source)).sort()).toEqual([
    'body',
    'headers',
    'method',
    'signal',
  ]);
  const field = (name: string) =>
    (
      fields.find(
        (field) => field.name!.getText(source) === name
      ) as ts.PropertyAssignment
    ).initializer;
  expect(field('method').getText(source)).toBe("'POST'");
  const body = field('body');
  if (
    !ts.isCallExpression(body) ||
    body.expression.getText(source) !== 'JSON.stringify'
  )
    throw new Error('Fixed query body required');
  const payload = body.arguments[0]!;
  if (!ts.isObjectLiteralExpression(payload))
    throw new Error('Explicit query payload required');
  expect(payload.properties.every(ts.isPropertyAssignment)).toBe(true);
  expect(
    payload.properties.map((field) => field.name!.getText(source)).sort()
  ).toEqual(['query', 'variables']);
  const query = payload.properties.find(
    (field) => field.name!.getText(source) === 'query'
  ) as ts.PropertyAssignment;
  expect(query.initializer.getText(source)).toBe(queryName);
  expect(text).not.toMatch(
    /child_process|Bun\.spawn|node:https|node:http|XMLHttpRequest|\bfetch\s*\(/
  );
}

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
const sourceFiles = repositorySources(repo)
  .filter((file) => /\.(?:ts|sh|yml|yaml|tf|json)$/.test(file))
  .filter(
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
      if (file === readOnlyRailway) {
        deploymentReads(text);
        return false;
      }
      if (file === readOnlyVolume) {
        deploymentReads(text, 'volumeQuery', volumeQuery);
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

  test('the volume probe exception requires its fixed read query and explicit POST options', () => {
    const text = readFileSync(join(repo, readOnlyVolume), 'utf8');
    for (const changed of [
      text.replace('query VolumeWriter(', 'mutation VolumeWriter('),
      text.replace("method: 'POST'", "method: 'PATCH'"),
      text.replace('query: volumeQuery', 'query: dynamicQuery'),
    ])
      expect(() =>
        deploymentReads(changed, 'volumeQuery', volumeQuery)
      ).toThrow();
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
