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

const strings = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).flatMap(([name, value]) =>
      typeof value === 'string' && value.trim() ? [[name, value]] : []
    )
  );

// GitHub Actions has a token in VAULT_TOKEN (vault-action) but no `vault` CLI.
async function readOverHttp(
  token: string,
  config: string
): Promise<Record<string, string> | undefined> {
  const { mount, project } = inventory.vault.kv;
  try {
    const response = await fetch(
      `https://${inventory.vault.hostname}/v1/${mount}/data/${project}/${config}`,
      { headers: { 'X-Vault-Token': token } }
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      data: { data: Record<string, unknown> };
    };
    return strings(body.data.data);
  } catch {
    return undefined;
  }
}

export async function readLiveVault(
  config = 'prd'
): Promise<Record<string, string> | undefined> {
  const token = process.env['VAULT_TOKEN'];
  if (token) return readOverHttp(token, config);
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
    return strings(JSON.parse(out).data.data as Record<string, unknown>);
  } catch {
    return undefined;
  }
}
