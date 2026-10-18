// Read-only view of the live prd Vault document, used to pre-fill values the
// operator would otherwise have to type. Needs the operator's own Vault login
// (`vault login`); returns undefined when there is none. Values are never printed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capture } from './process';

const inventory = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '../../packages/infra/tofu/modules/inventory/inventory.tf.json'
    ),
    'utf8'
  )
).locals.inventory;

export async function readLiveVault(
  config = 'prd'
): Promise<Record<string, string> | undefined> {
  const { mount, project } = inventory.vault.kv;
  const out = await capture(
    [
      'vault',
      'kv',
      'get',
      `-mount=${mount}`,
      '-format=json',
      `${project}/${config}`,
    ],
    { env: { VAULT_ADDR: `https://${inventory.vault.hostname}` } }
  );
  if (!out) return undefined;
  try {
    const data = JSON.parse(out).data.data as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(data).flatMap(([name, value]) =>
        typeof value === 'string' && value.trim() ? [[name, value]] : []
      )
    );
  } catch {
    return undefined;
  }
}
