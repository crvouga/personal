/** Publish one managed global mise config without clobbering unrelated configuration. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MARKER = '# Managed by crvouga/workspace scripts/dev/setup.ts\n';
export const workspaceRoot = join(import.meta.dirname, '../..');

export function globalConfigDir(): string {
  if (process.env['MISE_GLOBAL_CONFIG_FILE']) {
    throw new Error(
      'Unset MISE_GLOBAL_CONFIG_FILE before applying the shared toolchain.'
    );
  }
  return (
    process.env['MISE_CONFIG_DIR'] ??
    join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'mise')
  );
}

export function assertManagedConfig(dir: string): void {
  const config = join(dir, 'config.toml');
  const lock = join(dir, 'mise.lock');
  const managed =
    existsSync(config) && readFileSync(config, 'utf8').startsWith(MARKER);
  if ((existsSync(config) && !managed) || (existsSync(lock) && !managed)) {
    throw new Error(
      `Existing mise configuration at ${dir}. Back up and move config.toml and mise.lock, then rerun. Nothing was overwritten.`
    );
  }
}

export function publishGlobalConfig(dir: string, root = workspaceRoot): void {
  assertManagedConfig(dir);
  mkdirSync(dir, { recursive: true });
  const config = readFileSync(join(root, 'mise.toml'), 'utf8');
  writeFileSync(join(dir, 'config.toml'), MARKER + config);
  cpSync(join(root, 'mise.lock'), join(dir, 'mise.lock'));
  const sidecars = join(root, '.mise/locks');
  if (existsSync(sidecars))
    cpSync(sidecars, join(dir, '.mise/locks'), { recursive: true });
}
