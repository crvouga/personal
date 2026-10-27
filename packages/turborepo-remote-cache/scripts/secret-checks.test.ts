import { expect, test } from 'bun:test';
import { checkSecretIntegrations } from './secret-checks';

const s3Env = {
  S3_ENDPOINT: 'https://fixture.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'fixture-key',
  S3_SECRET_ACCESS_KEY: 'fixture-secret',
  S3_BUCKET: 'fixture-bucket',
};

test('missing or malformed R2 inputs skip the probe without exposing values', async () => {
  for (const env of [
    {},
    { ...s3Env, S3_ENDPOINT: 'invalid-private-fixture' },
  ]) {
    const messages: string[] = [];
    await checkSecretIntegrations(
      env,
      async () => {
        throw new Error('Probe must not run');
      },
      (message) => messages.push(message)
    );
    expect(messages.some((message) => message.startsWith('SKIP R2'))).toBe(
      true
    );
    expect(messages.join('\n')).not.toContain('invalid-private-fixture');
  }
});

test('missing portfolio token does not skip R2 and retired cache settings are ignored', async () => {
  const messages: string[] = [];
  let probes = 0;
  await checkSecretIntegrations(
    { ...s3Env, TURBO_CACHE: 'invalid' },
    async () => {
      probes++;
      return null;
    },
    (message) => messages.push(message)
  );
  expect(probes).toBe(1);
  expect(messages).toContain('PASS R2 integration');
  expect(
    messages.some((message) =>
      message.startsWith('SKIP PORTFOLIO_GITHUB_TOKEN')
    )
  ).toBe(true);
  expect(
    messages.some((message) => message.startsWith('SKIP TURBO_CACHE'))
  ).toBe(false);
});

test('rejected credentials skip the optional probe; actual probe bugs still fail it', async () => {
  const messages: string[] = [];
  await checkSecretIntegrations(
    s3Env,
    async () => 'HTTP 403 fixture-secret',
    (message) => messages.push(message)
  );
  expect(messages).toContain('SKIP R2 integration: credentials rejected');
  expect(messages.join('\n')).not.toContain('fixture-secret');
  await expect(
    checkSecretIntegrations(
      s3Env,
      async () => 'S3 put succeeded but HEAD returned false',
      () => {}
    )
  ).rejects.toThrow('HEAD returned false');
});
