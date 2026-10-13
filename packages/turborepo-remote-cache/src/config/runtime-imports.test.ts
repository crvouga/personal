import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const SERVER_ENTRY = join(PACKAGE_ROOT, 'src/server.ts');

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function moduleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
    )) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;
      const next = resolveSpecifier(file, specifier);
      if (next !== null && !seen.has(next)) pending.push(next);
    }
  }
  return [...seen];
}

describe('cache server runtime imports', () => {
  test('boot does not load the OpenTofu inventory registry', () => {
    const files = moduleGraph(SERVER_ENTRY);
    expect(
      files.some((file) => file.endsWith('vault-secrets-registry.ts'))
    ).toBe(false);
  });
});
