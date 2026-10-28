/**
 * Idempotently connects the GitHub App and creates the declared pools in a
 * running Zoomies controller. This is application data: the controller,
 * its volume, DNS and secrets are OpenTofu-owned.
 *
 *   bun run zoomies:configure
 */
import { ZoomiesApi, type FetchLike, type Installation } from './api';
import { DEFAULT_TARGET, ORIGIN, POOLS, type PoolSpec } from './spec';

type Env = Readonly<Record<string, string | undefined>>;
type Log = (message: string) => void;

const REQUIRED_APP_FIELDS = [
  'ZOOMIES_GITHUB_APP_ID',
  'ZOOMIES_GITHUB_APP_INSTALLATION_ID',
  'ZOOMIES_GITHUB_APP_PRIVATE_KEY',
] as const;

const OPTIONAL_APP_FIELDS = [
  ...REQUIRED_APP_FIELDS,
  'ZOOMIES_GITHUB_APP_WEBHOOK_SECRET',
] as const;

/**
 * CI holds a Vault token and the bootstrap token; `vault run` injects every
 * field. Fill any App field still absent from the Vault document, tolerating
 * an App that has not been created yet.
 */
export async function withVaultAppFields(
  env: Env,
  fetcher: FetchLike = fetch
): Promise<Env> {
  const addr = env['VAULT_ADDR'];
  const token = env['VAULT_TOKEN'];
  if (!addr || !token || OPTIONAL_APP_FIELDS.every((name) => env[name]))
    return env;
  const response = await fetcher(`${addr}/v1/secret/data/personal/prd`, {
    headers: { 'x-vault-token': token },
  });
  if (!response.ok)
    throw new Error(`Vault read failed with ${response.status}`);
  const body = (await response.json()) as {
    data?: { data?: Record<string, string> };
  };
  const stored = body.data?.data ?? {};
  const found = OPTIONAL_APP_FIELDS.filter(
    (name) => !env[name] && stored[name]
  );
  return {
    ...env,
    ...Object.fromEntries(found.map((name) => [name, stored[name]])),
  };
}

export function missingAppFields(env: Env): readonly string[] {
  return REQUIRED_APP_FIELDS.filter((name) => !env[name]?.trim());
}

/** Zoomies prefixes every stored pool name with `zoomies-`. */
export function storedPoolName(name: string): string {
  return name.startsWith('zoomies-') ? name : `zoomies-${name}`;
}

export function installationBody(env: Env) {
  const appId = Number(env['ZOOMIES_GITHUB_APP_ID']);
  const installationId = Number(env['ZOOMIES_GITHUB_APP_INSTALLATION_ID']);
  if (!Number.isSafeInteger(appId) || !Number.isSafeInteger(installationId))
    throw new Error(
      'ZOOMIES_GITHUB_APP_ID and ZOOMIES_GITHUB_APP_INSTALLATION_ID must be integers'
    );
  const webhookSecret = env['ZOOMIES_GITHUB_APP_WEBHOOK_SECRET']?.trim();
  return {
    app_id: appId,
    installation_id: installationId,
    target: env['ZOOMIES_GITHUB_TARGET']?.trim() || DEFAULT_TARGET.target,
    target_type:
      env['ZOOMIES_GITHUB_TARGET_TYPE']?.trim() || DEFAULT_TARGET.target_type,
    // Hidden single-line prompts cannot hold a PEM's newlines; accept `\n` escapes.
    private_key: env['ZOOMIES_GITHUB_APP_PRIVATE_KEY']?.replaceAll('\\n', '\n'),
    ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
  };
}

export function poolBody(pool: PoolSpec, installationId: string) {
  return { ...pool, installation_id: installationId };
}

export async function waitUntilReady(
  api: ZoomiesApi,
  log: Log,
  { attempts = 60, delayMs = 5000 } = {}
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const state = await api.ready();
    if (state.ready && !state.bootstrapRequired) return;
    log(
      state.ready
        ? `controller is up but not yet claimed (${attempt}/${attempts})`
        : `controller not ready (${attempt}/${attempts})`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${ORIGIN} did not become ready and claimed`);
}

export async function configure(
  api: ZoomiesApi,
  env: Env,
  log: Log
): Promise<'configured' | 'app-missing'> {
  const missing = missingAppFields(env);
  if (missing.length > 0) {
    log(
      `GitHub App not connected yet; missing ${missing.join(', ')}. See packages/zoomies/README.md.`
    );
    return 'app-missing';
  }
  const body = installationBody(env);
  const existing: Installation | undefined = (await api.installations()).find(
    (item) => item.installation_id === body.installation_id
  );
  let installation = existing;
  if (installation)
    log(`installation ${body.installation_id} already connected`);
  else {
    installation = await api.createInstallation(body);
    log(
      `connected GitHub App installation ${body.installation_id} (${body.target})`
    );
  }
  const present = new Set((await api.pools()).map((pool) => pool.name));
  for (const pool of POOLS) {
    if (present.has(storedPoolName(pool.name))) {
      log(`pool ${storedPoolName(pool.name)} exists; leaving it as configured`);
      continue;
    }
    await api.createPool(poolBody(pool, installation.id));
    log(`created pool ${storedPoolName(pool.name)}`);
  }
  return 'configured';
}

if (import.meta.main) {
  const token = process.env['ZOOMIES_BOOTSTRAP_TOKEN'];
  if (!token) {
    console.error(
      'Missing ZOOMIES_BOOTSTRAP_TOKEN. Run through: vault run --config prd -- ...'
    );
    process.exit(1);
  }
  const api = new ZoomiesApi(process.env['ZOOMIES_URL'] ?? ORIGIN, token);
  const log: Log = (message) => process.stdout.write(`zoomies: ${message}\n`);
  await waitUntilReady(api, log);
  await configure(api, await withVaultAppFields(process.env), log);
}
