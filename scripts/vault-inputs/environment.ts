// Infrastructure credentials are resolved automatically. Operators are only
// prompted for the secrets they are editing, never for backend/provider keys.
import { readOperatorVault } from './live';

type InputSpec = { variable: string; names: string[]; alsoAs?: string[] };
const INPUTS: InputSpec[] = [
  { variable: 'cloudflare_account_id', names: ['CLOUDFLARE_ACCOUNT_ID'] },
  { variable: 'cloudflare_zone_id', names: ['CLOUDFLARE_ZONE_ID'] },
  { variable: 'state_passphrase', names: ['TOFU_STATE_PASSPHRASE'] },
  {
    variable: 'state_access_key',
    names: ['TOFU_STATE_ACCESS_KEY', 'AWS_ACCESS_KEY_ID'],
    alsoAs: ['AWS_ACCESS_KEY_ID'],
  },
  {
    variable: 'state_secret_key',
    names: ['TOFU_STATE_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY'],
    alsoAs: ['AWS_SECRET_ACCESS_KEY'],
  },
  { variable: 'cloudflare_api_token', names: ['CLOUDFLARE_API_TOKEN'] },
  { variable: 'railway_token', names: ['RAILWAY_TOKEN'] },
  {
    variable: 'planetscale_service_token_id',
    names: ['PLANETSCALE_SERVICE_TOKEN_ID'],
  },
  {
    variable: 'planetscale_service_token',
    names: ['PLANETSCALE_SERVICE_TOKEN'],
  },
  {
    variable: 'github_token',
    names: ['GITHUB_TOKEN', 'DEPLOY_DISPATCH_TOKEN', 'GH_TOKEN'],
  },
];
type Sources = {
  env: Record<string, string | undefined>;
  operator: Record<string, string> | undefined;
};
const defaults: Sources = {
  env: process.env,
  operator: undefined,
};

export async function collectEnvironment(
  given: Record<string, string>,
  live: Record<string, string>,
  sources?: Sources
): Promise<Record<string, string>> {
  const resolved = sources ?? {
    ...defaults,
    operator: await readOperatorVault(),
  };
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const spec of INPUTS) {
    const key = `TF_VAR_${spec.variable}`;
    const value = [
      resolved.env[key],
      given[key],
      ...spec.names.map((name) => resolved.env[name]),
      ...spec.names.map((name) => given[name]),
      ...spec.names.map((name) => resolved.operator?.[name]),
      ...spec.names.map((name) => live[name]),
    ].find((value) => value?.trim());
    if (!value?.trim()) {
      missing.push(spec.names[0]);
      continue;
    }
    env[key] = value;
    for (const alias of spec.alsoAs ?? []) env[alias] = value;
  }
  if (missing.length)
    throw new Error(
      `Managed operator credentials are unavailable (${missing.join(', ')}). ` +
        'The admin-only secret/infra/operator setup document is missing, incomplete or inaccessible. ' +
        'An administrator login does not create this document: deploy the Vault OpenTofu root from CI after the setup changes are merged. ' +
        'No infrastructure credentials will be requested interactively.'
    );
  return env;
}
