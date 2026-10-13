import { assert } from '@pkgs/assert';

/**
 * Stable Vault secret key literals.
 *
 * The cache server imports these at boot. They stay free of the OpenTofu
 * inventory: that file is not copied into the runtime image, and loading
 * `scripts/vault-secrets-registry.ts` throws when it is missing.
 */
export const VaultSecretKey = {
  turboToken: 'TURBO_TOKEN',
  turboApi: 'TURBO_API',
  turboTeam: 'TURBO_TEAM',
  turboCache: 'TURBO_CACHE',
  turboLogOrder: 'TURBO_LOG_ORDER',
  turboTelemetryDisabled: 'TURBO_TELEMETRY_DISABLED',
  s3Endpoint: 'S3_ENDPOINT',
  s3Region: 'S3_REGION',
  s3AccessKeyId: 'S3_ACCESS_KEY_ID',
  s3SecretAccessKey: 'S3_SECRET_ACCESS_KEY',
  s3Bucket: 'S3_BUCKET',
  vaultToken: 'VAULT_TOKEN',
  portfolioGithubToken: 'PORTFOLIO_GITHUB_TOKEN',
} as const;

for (const key of Object.values(VaultSecretKey)) {
  assert.nonEmptyString(key, 'vault secret key must be non-empty');
}
