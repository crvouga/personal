/** Publish one managed global mise config without clobbering unrelated configuration. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MARKER = '# Managed by crvouga/workspace scripts/dev/setup.ts\n';
const MANAGED = /^# Managed by \S+ \S*setup\.ts\n/;
/** dev-fleet publishes its own pinned toolchain config on every fleet-sync. */
const FLEET_OWNED = /^# Managed by dev-fleet /;
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
  // The marker text identifies the file as managed, whichever repository
  // published it.
  const managed =
    existsSync(config) && MANAGED.test(readFileSync(config, 'utf8'));
  if ((existsSync(config) && !managed) || (existsSync(lock) && !managed)) {
    throw new Error(
      `Existing mise configuration at ${dir}. Back up and move config.toml and mise.lock, then rerun. Nothing was overwritten.`
    );
  }
}

/** False when the machine is in the fleet: its global config belongs to
 * dev-fleet and is left as fleet-sync published it. This checkout's pins still
 * apply inside the checkout, through its own mise.toml.
 */
export function publishGlobalConfig(
  dir: string,
  root = workspaceRoot
): boolean {
  assertManagedConfig(dir);
  const path = join(dir, 'config.toml');
  if (existsSync(path) && FLEET_OWNED.test(readFileSync(path, 'utf8')))
    return false;
  mkdirSync(dir, { recursive: true });
  const config = readFileSync(join(root, 'mise.toml'), 'utf8');
  if (!existsSync(path) || readFileSync(path, 'utf8') !== MARKER + config)
    writeFileSync(path, MARKER + config);
  cpSync(join(root, 'mise.lock'), join(dir, 'mise.lock'), {
    filter: changedFile,
  });
  const sidecars = join(root, '.mise/locks');
  if (existsSync(sidecars))
    cpSync(sidecars, join(dir, '.mise/locks'), {
      recursive: true,
      filter: changedFile,
    });
  return true;
}

function changedFile(source: string, destination: string): boolean {
  return (
    statSync(source).isDirectory() ||
    !existsSync(destination) ||
    !readFileSync(source).equals(readFileSync(destination))
  );
}
