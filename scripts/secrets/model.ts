import { isDeepStrictEqual } from 'node:util';
import { isDerived } from '../vault-secrets-tfvars';
import { problemsFor } from '../../packages/infra/lib/health/secret-rules';
import {
  TOFU_VAULT_INPUTS_ADDRESS,
  withFills,
  type Fill,
  type VaultInputs,
} from '../vault-inputs/model';
import type { Inventory, SecretKey } from './types';

export const GOOGLE_KEYS = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
];
// These values are computed after operator inputs in the Vault root.
const computed = new Set([
  'TURBO_LOG_ORDER',
  'TURBO_TELEMETRY_DISABLED',
  '9ROUTER_TUNNEL_TOKEN',
]);
export const bootstrapBindings: Record<
  string,
  { variable: string; secret: string }
> = {
  RAILWAY_TOKEN: { variable: 'railway_token', secret: 'RAILWAY_TOKEN' },
  CLOUDFLARE_API_TOKEN: {
    variable: 'cloudflare_api_token',
    secret: 'CF_API_TOKEN',
  },
  PLANETSCALE_SERVICE_TOKEN_ID: {
    variable: 'planetscale_service_token_id',
    secret: 'PLANETSCALE_SERVICE_TOKEN_ID',
  },
  PLANETSCALE_SERVICE_TOKEN: {
    variable: 'planetscale_service_token',
    secret: 'PLANETSCALE_SERVICE_TOKEN',
  },
};

export function editableKeys(keys: SecretKey[]): SecretKey[] {
  return keys.filter(
    (key) => !key.generated && !isDerived(key.name) && !computed.has(key.name)
  );
}

/** Merge selected values only; preserve unregistered inputs and every other map. */
export function updateInputs(
  before: VaultInputs,
  fills: Fill[],
  keys: SecretKey[]
): VaultInputs {
  const editable = editableKeys(keys);
  for (const fill of fills) {
    const key = editable.find((key) => key.name === fill.name);
    if (!key?.configs.includes(fill.config))
      throw new Error(`Cannot edit ${fill.config}.${fill.name}.`);
    if (!fill.value.trim())
      throw new Error(`${fill.config}.${fill.name} must not be empty.`);
    const problem = problemsFor(fill.name, fill.value).find(
      (p) => p.severity === 'fail'
    );
    if (problem) throw new Error(`${fill.name} ${problem.message}.`);
  }
  return withFills(before, fills, false);
}

export type Stage = {
  root: 'foundation' | 'vault' | 'auth';
  state: string;
  label: string;
  addresses: string[];
  env: Record<string, string>;
};

export function stages(
  next: VaultInputs,
  fills: Fill[],
  inventory: Inventory
): Stage[] {
  const foundation: Stage = {
    root: 'foundation',
    state: 'foundation',
    label: 'Save managed inputs in GitHub',
    addresses: [TOFU_VAULT_INPUTS_ADDRESS],
    env: { TF_VAR_vault_inputs: JSON.stringify(next) },
  };
  for (const [name, binding] of Object.entries(bootstrapBindings)) {
    if (!fills.some((fill) => fill.config === 'prd' && fill.name === name))
      continue;
    foundation.env[`TF_VAR_${binding.variable}`] = next.secrets.prd[name];
    foundation.addresses.push(
      `github_actions_secret.bootstrap["${binding.secret}"]`
    );
  }
  const configs = [...new Set(fills.map((fill) => fill.config))];
  const result: Stage[] = [
    foundation,
    {
      root: 'vault',
      state: 'vault',
      label: 'Update Vault',
      addresses: configs.map(
        (config) => `vault_kv_secret_v2.personal["${config}"]`
      ),
      env: Object.fromEntries(
        Object.entries(next).map(([key, value]) => [
          `TF_VAR_${key}`,
          JSON.stringify(value),
        ])
      ),
    },
  ];
  if (!fills.some((fill) => GOOGLE_KEYS.includes(fill.name))) return result;
  if (!inventory.auth_relay.enabled || !inventory.auth_relay.live)
    throw new Error(
      'The managed auth relay is not live. Deploy it before changing Google credentials here.'
    );
  for (const [instance, relay] of Object.entries(
    inventory.auth_relay.instances
  )) {
    const config = relay.vault_config;
    if (
      !fills.some(
        (fill) => fill.config === config && GOOGLE_KEYS.includes(fill.name)
      )
    )
      continue;
    if (GOOGLE_KEYS.some((name) => !next.secrets[config][name]?.trim()))
      throw new Error(
        `${config}: both Google client ID and client secret are required before updating the relay.`
      );
    result.push({
      root: 'auth',
      state: `auth-${instance}`,
      label: `Update Google provider · ${relay.hostname}`,
      addresses: ['keycloak_oidc_google_identity_provider.google'],
      env: {
        TF_VAR_instance: instance,
        TF_VAR_google_client_id: next.secrets[config].GOOGLE_OAUTH_CLIENT_ID,
        TF_VAR_google_client_secret:
          next.secrets[config].GOOGLE_OAUTH_CLIENT_SECRET,
      },
    });
  }
  return result;
}

/** Provider-generated fields must stay intact when replacing a whole KV document. */
export function unrelatedKvChanges(
  before: string,
  after: string,
  fills: Fill[]
): string[] {
  const old = JSON.parse(before) as Record<string, unknown>;
  const next = JSON.parse(after) as Record<string, unknown>;
  const selected = new Set(fills.map((fill) => fill.name));
  return [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(
    (name) => !selected.has(name) && !isDeepStrictEqual(old[name], next[name])
  );
}
