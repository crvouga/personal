import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Check } from '../../../../fleet/src/types';

/** T3 keeps each credential setting in its per-host secret store as
 * `userdata/secrets/<slot>.bin`; the settings (and the fleet policy) only hold
 * the saved-secret marker. Slot names follow T3's settingsSecrets naming.
 */
export function providerConfigSecretPath(
  instanceId: string,
  driver: string,
  field: string,
  t3Home = process.env['T3CODE_HOME'] ?? join(homedir(), '.t3')
): string {
  const encode = (value: string) =>
    Buffer.from(value, 'utf8').toString('base64url');
  return join(
    t3Home,
    'userdata',
    'secrets',
    `provider-config-${encode(instanceId)}-${encode(driver)}-${encode(field)}.bin`
  );
}

/** Puts this node's shared proxy key (read from its own Vault session) where
 * the managed Antigravity instance reads it. Private, atomic, only on change;
 * the key never reaches policy, argv, output or logs.
 */
export async function syncAntigravityKey(
  key: () => Promise<string>,
  t3Home?: string
): Promise<Check> {
  const path = providerConfigSecretPath(
    'personal_antigravity_proxy',
    'antigravity',
    'apiKey',
    t3Home
  );
  try {
    const value = await key();
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current !== value) {
      await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, value, { mode: 0o600, flag: 'w' });
      await rename(temporary, path);
    }
    return {
      id: 't3:antigravity-key',
      status: 'pass',
      summary:
        "T3's managed Antigravity instance has this node's shared proxy key in T3's per-host secret store.",
    };
  } catch {
    return {
      id: 't3:antigravity-key',
      status: 'fail',
      summary: 'T3_ANTIGRAVITY_KEY_UNAVAILABLE',
      remedy: {
        action:
          "Restore this node's Vault session (the shared proxy key), then rerun fleet-sync; it writes the key into T3's per-host secret store.",
      },
    };
  }
}
