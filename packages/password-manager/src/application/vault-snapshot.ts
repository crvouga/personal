import type { SecretStore } from '@pkgs/secret-store';
import type { VaultItem } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
/** Bounded chunks avoid one giant credential-store entry during restore. */
export async function storeVaultSnapshot(
  vault: VaultItem[],
  secrets: SecretStore,
  folders: { id: string; name: string }[] = []
): Promise<void> {
  const serialized = JSON.stringify({ items: vault, folders });
  const refs: string[] = [];
  for (let offset = 0; offset < serialized.length; offset += 4096) {
    const ref = `restore/vault/${refs.length}`;
    const value = serialized.slice(offset, offset + 4096);
    await secrets.setSecret(ref, value);
    if ((await secrets.getRequired(ref)).readSecretValue() !== value)
      throw new ManagerError('unavailable');
    refs.push(ref);
  }
  await secrets.setSecret(
    'restore/vault-snapshot',
    JSON.stringify({ version: 1, items: vault.length, refs })
  );
}
