import { Assert, assert, hotAssert } from '@pkgs/assert';
import { SecretStoreEntry, type SecretUsedBy } from '@pkgs/secret-store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VaultSecretKey } from '../src/config/vault-secret-key';

export { VaultSecretKey };

const ha: Assert = hotAssert();
const validationAssert: Assert = Assert.validation();

type InfraInventory = {
  object_stores: readonly { id: string; bucket: string }[];
  zone?: string;
  image_owner?: string;
  image_prefix?: string;
  vault?: { hostname?: string };
  services?: readonly {
    id: string;
    hostname?: string;
  }[];
};

function readInfraInventory(): InfraInventory | null {
  try {
    const path = join(
      import.meta.dirname,
      '..',
      '..',
      'infra',
      'tofu/modules/inventory/inventory.tf.json'
    );
    return (
      JSON.parse(readFileSync(path, 'utf8')) as {
        locals: { inventory: InfraInventory };
      }
    ).locals.inventory;
  } catch {
    return null;
  }
}

const infraInventory = readInfraInventory();
if (!infraInventory) throw new Error('OpenTofu inventory must be readable');
const turboService = infraInventory?.services?.find(
  (s) => s.id === 'turborepo'
);

/** Public hostname for the self-hosted Turborepo remote cache server. */
export const CACHE_PUBLIC_HOSTNAME =
  turboService?.hostname ?? 'turborepo.chrisvouga.dev';

/** Cloudflare DNS zone for {@link CACHE_PUBLIC_HOSTNAME}. */
export const CACHE_DNS_ZONE = infraInventory?.zone ?? 'chrisvouga.dev';

/** Public origin for the self-hosted Turborepo remote cache server. */
export const CACHE_PUBLIC_ORIGIN = `https://${CACHE_PUBLIC_HOSTNAME}`;

/** GHCR repository for the cache server image (CI publishes via ci.yml → publish-image). */
export const GHCR_IMAGE_REPOSITORY = (() => {
  const owner = infraInventory?.image_owner ?? 'crvouga';
  const prefix = infraInventory?.image_prefix ?? 'chrisvouga';
  return `ghcr.io/${owner}/${prefix}-turborepo`;
})();

/** Base Vault UI link for the cache-secret KV path (project/config appended). */
export const VAULT_UI_BASE = (() => {
  const host =
    infraInventory?.vault?.hostname ??
    (infraInventory?.zone
      ? `vault.${infraInventory.zone}`
      : 'vault.chrisvouga.dev');
  return `https://${host}/ui/vault/secrets/secret/show`;
})();

/** Shared R2 buckets — one per Vault config. Apps own key prefixes inside the bucket. */
export const SHARED_R2_BUCKET_BY_CONFIG = {
  dev: infraInventory.object_stores.find((store) => store.id === 'development')!
    .bucket,
  prd: infraInventory.object_stores.find((store) => store.id === 'production')!
    .bucket,
} as const;

export type VaultConfigName = keyof typeof SHARED_R2_BUCKET_BY_CONFIG;

export function sharedR2BucketForConfig(config: string): string {
  assert.nonEmptyString(config, 'vault config must be non-empty');
  if (config === 'dev' || config === 'prd') {
    return SHARED_R2_BUCKET_BY_CONFIG[config];
  }
  throw new Error(
    `Unknown vault config "${config}" (expected ${Object.keys(SHARED_R2_BUCKET_BY_CONFIG).join(' | ')})`
  );
}

const TURBO_CACHE_RE = /^(local|remote):(r|rw|w)?(,(local|remote):(r|rw|w)?)?$/;

function validateHttpsUrl(value: string): string | null {
  validationAssert.nonEmptyString(value, 'TURBO_API must be non-empty');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return `${VaultSecretKey.turboApi} must be an https URL, got ${value}`;
    }
  } catch {
    return `${VaultSecretKey.turboApi} must be a valid URL, got ${value}`;
  }
  return null;
}

function validateTurboCache(value: string): string | null {
  validationAssert.nonEmptyString(value, 'TURBO_CACHE must be non-empty');
  if (!TURBO_CACHE_RE.test(value)) {
    return `Invalid ${VaultSecretKey.turboCache} "${value}" (expected e.g. remote:rw)`;
  }
  return null;
}

function validateHttpsUrlOrR2Endpoint(value: string): string | null {
  validationAssert.nonEmptyString(value, 'S3_ENDPOINT must be non-empty');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return `${VaultSecretKey.s3Endpoint} must be an https URL, got ${value}`;
    }
  } catch {
    return `${VaultSecretKey.s3Endpoint} must be a valid URL, got ${value}`;
  }
  return null;
}

/** Central register of every secret expected in the secret store. */
export const VAULT_SECRET_REGISTRY: readonly SecretStoreEntry[] = [
  new SecretStoreEntry({
    key: VaultSecretKey.turboToken,
    required: true,
    usedBy: ['server', 'client'],
    hint: 'Bearer token Turbo clients send and the cache server validates',
    description: 'Shared secret for the self-hosted Turborepo remote cache.',
    docsUrl: 'https://turborepo.com/docs/reference/remote-caching',
    obtainUrl: `${VAULT_UI_BASE}/personal/{{config}}`,
    vaultUiPath: `${VAULT_UI_BASE}/personal/{{config}}`,
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.turboApi,
    required: true,
    usedBy: ['client'],
    hint: 'Self-hosted cache URL (TURBO_API env for turbo CLI)',
    seed: () => CACHE_PUBLIC_ORIGIN,
    transform: (value) => value.replace(/\/+$/, ''),
    validate: validateHttpsUrl,
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.turboTeam,
    required: true,
    usedBy: ['client'],
    hint: 'Any team slug (e.g. local) — required by turbo CLI for remote cache',
    seed: () => 'local',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.s3Endpoint,
    required: true,
    usedBy: ['server'],
    hint: 'Cloudflare R2 S3 API endpoint (https://<ACCOUNT_ID>.r2.cloudflarestorage.com)',
    docsUrl: 'https://developers.cloudflare.com/r2/api/s3/api/',
    obtainUrl: 'https://dash.cloudflare.com/?to=/:account/r2/overview',
    validExample: 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com',
    invalidHint: 'Use https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com',
    validate: validateHttpsUrlOrR2Endpoint,
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.s3Region,
    required: true,
    usedBy: ['server'],
    hint: 'R2 SigV4 region (always "auto")',
    validExample: 'auto',
    invalidHint: 'Set S3_REGION to "auto" for Cloudflare R2.',
    seed: () => 'auto',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.s3AccessKeyId,
    required: true,
    usedBy: ['server'],
    hint: 'R2 API token Access Key ID (Object Read & Write on the cache bucket)',
    docsUrl: 'https://developers.cloudflare.com/r2/api/tokens/',
    obtainUrl: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens',
    invalidHint:
      'Create an R2 API token with Object Read & Write on crvouga-development and crvouga-production.',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.s3SecretAccessKey,
    required: true,
    usedBy: ['server'],
    hint: 'R2 API token Secret Access Key (shown once at creation)',
    docsUrl: 'https://developers.cloudflare.com/r2/api/tokens/',
    obtainUrl: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens',
    invalidHint:
      'The secret is only shown once — recreate the R2 API token if lost.',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.s3Bucket,
    required: true,
    usedBy: ['server'],
    hint: 'Shared R2 bucket (dev→crvouga-development, prd→crvouga-production)',
    docsUrl: 'https://developers.cloudflare.com/r2/',
    obtainUrl: 'https://dash.cloudflare.com/?to=/:account/r2/overview',
    validExample: 'crvouga-development | crvouga-production',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.vaultToken,
    required: true,
    usedBy: ['server'],
    hint: 'Long-lived Vault read token for server boot-time secret loading',
    docsUrl: 'https://openbao.org/docs/concepts/tokens/',
    obtainUrl: `${VAULT_UI_BASE}/personal/{{config}}`,
    invalidHint:
      'The OpenTofu vault root manages the periodic runtime read token.',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.turboCache,
    required: false,
    usedBy: ['client'],
    hint: 'Turbo --cache flag default (e.g. remote:rw)',
    seed: () => 'remote:rw',
    validate: validateTurboCache,
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.turboLogOrder,
    required: false,
    usedBy: ['client'],
    hint: 'Turbo log order (e.g. stream)',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.turboTelemetryDisabled,
    required: false,
    usedBy: ['client'],
    hint: 'Set to 1 to disable Turbo telemetry',
  }),
  new SecretStoreEntry({
    key: VaultSecretKey.portfolioGithubToken,
    required: true,
    usedBy: ['ci', 'portfolio'],
    hint: 'GitHub user token with read:user access for the contribution calendar',
    description:
      'Build-time credential for the portfolio proof section (contribution calendar + profile stats).',
    docsUrl:
      'https://docs.github.com/en/graphql/reference/objects#contributionscollection',
    obtainUrl: 'https://github.com/settings/tokens',
    vaultUiPath: `${VAULT_UI_BASE}/personal/{{config}}`,
    validExample: 'ghp_… (classic) or github_pat_… (fine-grained)',
    invalidHint:
      'Store a GitHub user token with read:user at secret/data/personal/{dev|prd} → PORTFOLIO_GITHUB_TOKEN, e.g. `bun run infra:vault apply`, then build with `vault run --config dev -- bun run --filter @pkgs/portfolio build`.',
  }),
];

export const VAULT_CONFIGS = ['dev', 'prd'] as const;

assert.nonEmptyArray(VAULT_CONFIGS, 'vault configs must be non-empty');
assert.nonEmptyArray(
  VAULT_SECRET_REGISTRY,
  'vault secret registry must be non-empty'
);
for (const def of VAULT_SECRET_REGISTRY) {
  assert.nonEmptyString(def.key, 'registry entry key must be non-empty');
}

/** Turbo env vars consumer monorepos need to use this self-hosted cache. */
export const TURBO_CLIENT_REQUIRED_KEYS = [
  VaultSecretKey.turboToken,
  VaultSecretKey.turboApi,
  VaultSecretKey.turboTeam,
  VaultSecretKey.turboCache,
] as const;

/** Optional Turbo client env vars copied when set in the source config. */
export const TURBO_CLIENT_OPTIONAL_KEYS = [
  VaultSecretKey.turboLogOrder,
  VaultSecretKey.turboTelemetryDisabled,
] as const;

export function turboClientRegistryDefaults(): Readonly<
  Record<string, string | undefined>
> {
  assert.nonEmptyArray(VAULT_SECRET_REGISTRY, 'registry must have entries');
  const defaults: Record<string, string | undefined> = {};
  for (const def of VAULT_SECRET_REGISTRY) {
    ha.nonEmptyString(def.key, 'registry entry key must be non-empty');
    const value = def.seed();
    if (value !== undefined) {
      defaults[def.key] = value;
    }
  }
  assert.record(defaults, 'registry defaults must be a record');
  return defaults;
}

export type { SecretUsedBy };
