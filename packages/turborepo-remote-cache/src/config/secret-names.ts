import { assert } from '@pkgs/assert';

import { VaultSecretKey } from './vault-secret-key';

/** Vault secret names loaded at server boot. */
export const CacheSecretName = {
  turboToken: VaultSecretKey.turboToken,
  s3Endpoint: VaultSecretKey.s3Endpoint,
  s3Region: VaultSecretKey.s3Region,
  s3AccessKeyId: VaultSecretKey.s3AccessKeyId,
  s3SecretAccessKey: VaultSecretKey.s3SecretAccessKey,
  s3Bucket: VaultSecretKey.s3Bucket,
} as const;

assert.equals(
  CacheSecretName.turboToken,
  VaultSecretKey.turboToken,
  'turboToken must match registry'
);
assert.equals(
  CacheSecretName.s3Endpoint,
  VaultSecretKey.s3Endpoint,
  's3Endpoint must match registry'
);
assert.equals(
  CacheSecretName.s3Region,
  VaultSecretKey.s3Region,
  's3Region must match registry'
);
assert.equals(
  CacheSecretName.s3AccessKeyId,
  VaultSecretKey.s3AccessKeyId,
  's3AccessKeyId must match registry'
);
assert.equals(
  CacheSecretName.s3SecretAccessKey,
  VaultSecretKey.s3SecretAccessKey,
  's3SecretAccessKey must match registry'
);
assert.equals(
  CacheSecretName.s3Bucket,
  VaultSecretKey.s3Bucket,
  's3Bucket must match registry'
);
for (const name of Object.values(CacheSecretName)) {
  assert.nonEmptyString(name, 'secret name must be non-empty');
}
