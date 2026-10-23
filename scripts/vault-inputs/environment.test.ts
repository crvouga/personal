import { expect, test } from 'bun:test';
import { collectEnvironment } from './environment';

const operator = {
  TOFU_STATE_PASSPHRASE: 'private-passphrase',
  TOFU_STATE_ACCESS_KEY: 'private-state-access',
  TOFU_STATE_SECRET_KEY: 'private-state-secret',
  CLOUDFLARE_ACCOUNT_ID: 'account',
  CLOUDFLARE_ZONE_ID: 'zone',
  GITHUB_TOKEN: 'private-github-token',
};
const live = {
  CLOUDFLARE_API_TOKEN: 'private-cloudflare',
  RAILWAY_TOKEN: 'private-railway',
  PLANETSCALE_SERVICE_TOKEN_ID: 'planetscale-id',
  PLANETSCALE_SERVICE_TOKEN: 'private-planetscale',
};

test('an administrator Vault login supplies every infrastructure credential without prompts or gh login', async () => {
  const env = await collectEnvironment({}, live, {
    env: {},
    operator,
  });
  expect(env.TF_VAR_state_passphrase).toBe(operator.TOFU_STATE_PASSPHRASE);
  expect(env.AWS_ACCESS_KEY_ID).toBe(operator.TOFU_STATE_ACCESS_KEY);
  expect(env.AWS_SECRET_ACCESS_KEY).toBe(operator.TOFU_STATE_SECRET_KEY);
  expect(env.TF_VAR_github_token).toBe(operator.GITHUB_TOKEN);
  expect(env.TF_VAR_cloudflare_api_token).toBe(live.CLOUDFLARE_API_TOKEN);
});

test('missing operator setup fails once with credential names, never an interactive fallback or secret values', async () => {
  try {
    await collectEnvironment({}, live, {
      env: {},
      operator: undefined,
    });
    throw new Error('Expected unavailable setup');
  } catch (error) {
    expect(String(error)).toContain(
      'No infrastructure credentials will be requested interactively'
    );
    expect(String(error)).toContain('TOFU_STATE_ACCESS_KEY');
    expect(String(error)).toContain('secret/infra/operator');
    expect(String(error)).not.toContain('Run vault login');
    expect(String(error)).not.toContain(live.CLOUDFLARE_API_TOKEN);
  }
});

test('does not substitute application object-store credentials for state access', async () => {
  const {
    TOFU_STATE_ACCESS_KEY: _access,
    TOFU_STATE_SECRET_KEY: _secret,
    ...partial
  } = operator;
  await expect(
    collectEnvironment(
      {},
      {
        ...live,
        S3_ACCESS_KEY_ID: 'application-access',
        S3_SECRET_ACCESS_KEY: 'application-secret',
      },
      {
        env: {},
        operator: partial,
      }
    )
  ).rejects.toThrow('TOFU_STATE_ACCESS_KEY');
});

test('supports existing explicit backend environment aliases without prompting', async () => {
  const env = await collectEnvironment({}, live, {
    env: {
      AWS_ACCESS_KEY_ID: 'explicit-access',
      AWS_SECRET_ACCESS_KEY: 'explicit-secret',
    },
    operator,
  });
  expect(env.TF_VAR_state_access_key).toBe('explicit-access');
  expect(env.TF_VAR_state_secret_key).toBe('explicit-secret');
});
