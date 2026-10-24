import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, type ParseError } from 'jsonc-parser';
import { ManagerError } from '../domain/errors.ts';
import { repoRoot } from './paths.ts';
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export function checkInstalledDependencies(): void {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8')
  ) as { dependencies: Record<string, string> };
  const errors: ParseError[] = [];
  const lock = parse(readFileSync(join(repoRoot, 'bun.lock'), 'utf8'), errors, {
    allowTrailingComma: true,
  }) as { packages: Record<string, [string]> };
  if (errors.length) throw new ManagerError('invalid-config');
  for (const [name, policy] of Object.entries(manifest.dependencies)) {
    if (policy.startsWith('workspace:')) continue;
    checkPackage({ name, policy, lock });
  }
}
function checkPackage(input: {
  name: string;
  policy: string;
  lock: { packages: Record<string, [string]> };
}): void {
  const path = join(packageRoot, 'node_modules', input.name, 'package.json');
  let actual: { version: string };
  try {
    actual = JSON.parse(readFileSync(path, 'utf8')) as { version: string };
  } catch {
    throw new ManagerError('missing');
  }
  const resolved = realpathSync(dirname(path));
  const rel = relative(realpathSync(join(repoRoot, 'node_modules')), resolved);
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new ManagerError('wrong-version');
  const resolution =
    input.lock.packages[`@pkgs/password-manager/${input.name}`] ??
    input.lock.packages[input.name];
  const expected = resolution?.[0];
  if (expected !== `${input.name}@${actual.version}`)
    throw new ManagerError('wrong-version');
  if (/^\d/.test(input.policy) && input.policy !== actual.version)
    throw new ManagerError('wrong-version');
}
