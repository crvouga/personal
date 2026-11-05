import { VaultSecretStore } from '@pkgs/secret-store';
import { VaultCli } from '@pkgs/vault';
import { registry } from './registry';
import { resolveVaultConfig } from '../vault-config';

export async function proxyKey(): Promise<string> {
  const reference = registry.proxy.secret;
  try {
    const { addr } = resolveVaultConfig();
    const token = new VaultCli({ addr }).resolveToken().token;
    const store = new VaultSecretStore({
      addr,
      token,
      mount: reference.mount,
      project: reference.project,
      config: reference.config,
    });
    const row = await store.getOptionalMany([reference.key]);
    const value = row[reference.key]?.readSecretValue().trim();
    if (value) return value;
  } catch {
    /* Never forward Vault/network exceptions or response bodies. */
  }
  throw new Error(
    'Required Vault secret unavailable: secret/data/personal/prd CLIPROXY_FLEET_CLIENT_API_KEY. Authenticate this node with vault login and verify read permission; secret changes belong to OpenTofu.'
  );
}
