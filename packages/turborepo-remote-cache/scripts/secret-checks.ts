import {
  VAULT_SECRET_REGISTRY,
  VaultSecretKey,
} from './vault-secrets-registry';
import { verifyS3Credentials } from './verify-s3';

// Shared integrations remain active; retired cache credentials are manual-only.
const integrationEntries = VAULT_SECRET_REGISTRY.filter(
  (entry) => !entry.key.startsWith('TURBO_')
);

export function unavailableSecrets(env: NodeJS.ProcessEnv): Set<string> {
  const unavailable = new Set<string>();
  for (const entry of integrationEntries) {
    const value = env[entry.key]?.trim() ?? '';
    if (!value || entry.validate(entry.transform(value)) !== null)
      unavailable.add(entry.key);
  }
  return unavailable;
}

const s3Keys = [
  VaultSecretKey.s3Endpoint,
  VaultSecretKey.s3Region,
  VaultSecretKey.s3AccessKeyId,
  VaultSecretKey.s3SecretAccessKey,
  VaultSecretKey.s3Bucket,
];

export async function checkSecretIntegrations(
  env: NodeJS.ProcessEnv = process.env,
  probeS3: typeof verifyS3Credentials = verifyS3Credentials,
  report: (message: string) => void = console.warn
): Promise<void> {
  const unavailable = unavailableSecrets(env);
  for (const entry of integrationEntries) {
    if (unavailable.has(entry.key)) {
      const reason = env[entry.key]?.trim() ? 'invalid format' : 'unset';
      report(`SKIP ${entry.key} (${entry.usedBy.join(', ')}): ${reason}`);
    }
  }
  const missingS3 = s3Keys.filter((key) => unavailable.has(key));
  if (missingS3.length) {
    report(`SKIP R2 integration: unavailable ${missingS3.join(', ')}`);
    return;
  }
  const error = await probeS3();
  if (error === null) report('PASS R2 integration');
  else if (
    /401|403|Signature|InvalidAccessKeyId|ExpiredToken|AccessDenied/.test(error)
  ) {
    report('SKIP R2 integration: credentials rejected');
  } else throw new Error(error);
}
