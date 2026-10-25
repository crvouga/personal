import { expect, test } from 'bun:test';
import { checkWindowsSigning } from './check-windows-signing.js';
import { asRecord } from './context.js';
import { identityPath, oidcPath, signingFixture } from './windows-signing.test-support.js';

test('the real immutable GitHub subject passes while an obsolete name-only binding fails', async () => {
  for (const subject of ['repo:acme@123/workspace@456:ref:refs/heads/main', 'repo:acme/workspace:ref:refs/heads/main', 'repo:acme@999/workspace@456:ref:refs/heads/main', 'repo:acme@123/workspace@456:pull_request']) {
    const { ctx, routes } = signingFixture();
    const path = `${identityPath}/federatedIdentityCredentials`;
    const credentials = asRecord(routes[path]?.body)['value'] as { properties: { subject: string } }[];
    credentials[0]!.properties.subject = subject;
    const results = await checkWindowsSigning(ctx);
    expect(results.find((result) => result.name === 'main-only signing federation')?.status).toBe(subject === 'repo:acme@123/workspace@456:ref:refs/heads/main' ? 'pass' : 'fail');
  }
});

test('custom, absent and mismatched GitHub settings cannot pass federation readiness', async () => {
  for (const body of [{}, { use_default: false, sub_claim_prefix: 'repo:acme@123/workspace@456' }, { use_default: true, sub_claim_prefix: 'repo:attacker@123/workspace@456' }]) {
    const { ctx, routes } = signingFixture();
    routes[oidcPath] = { body };
    const results = await checkWindowsSigning(ctx);
    expect(results.find((result) => result.name === 'main-only signing federation')?.status).toBe('fail');
  }
});

test('unavailable GitHub OIDC settings are skipped without passing the trust check', async () => {
  const { ctx, routes } = signingFixture();
  routes[oidcPath] = { status: 403, body: {} };
  const results = await checkWindowsSigning(ctx);
  expect(results.find((result) => result.name === 'main-only signing federation')?.status).toBe('skip');
});
