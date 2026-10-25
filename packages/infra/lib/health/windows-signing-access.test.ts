import { expect, test } from 'bun:test';
import { checkWindowsSigning } from './check-windows-signing.js';
import { asRecord } from './context.js';
import { verifiedPublisher } from './windows-signing-access.js';
import { identityPath, profilePath, rolesPath, signingFixture, variablePath } from './windows-signing.test-support.js';

test('rotation accepts matching active subjects, rejecting missing or ambiguous identities', () => {
  const certificates = [{ status: 'Active', subjectName: 'CN=Alice' }, { status: 'Active', subjectName: 'CN=Alice' }, { status: 'Revoked', subjectName: 'CN=Bob' }];
  expect(verifiedPublisher({ certificates })).toBe('CN=Alice');
  expect(verifiedPublisher({ certificates: [] })).toBeUndefined();
  expect(verifiedPublisher({ certificates: [...certificates, { status: 'Active', subjectName: 'CN=Bob' }] })).toBeUndefined();
});

test('a signer assignment for another identity or an account scope does not pass', async () => {
  for (const properties of [
    { principalId: 'someone-else', scope: profilePath },
    { principalId: 'publisher-principal', scope: profilePath.split('/certificateProfiles/')[0] },
  ]) {
    const { ctx, routes } = signingFixture();
    routes[rolesPath] = { body: { value: [{ properties: { ...properties, roleDefinitionId: '/role/2837e146-70d7-4cfd-ad55-7efa6464f958' } }] } };
    const results = await checkWindowsSigning(ctx);
    expect(results.find((result) => result.name === 'profile-scoped signing permission')?.status).toBe('fail');
  }
});

test('federation for a pull request is rejected and mismatched generated client IDs fail', async () => {
  const { ctx, routes } = signingFixture();
  const path = `${identityPath}/federatedIdentityCredentials`;
  routes[path] = { body: { value: [{ name: 'github-main', properties: { issuer: 'https://token.actions.githubusercontent.com', audiences: ['api://AzureADTokenExchange'], subject: 'repo:acme/workspace:pull_request' } }] } };
  const value = JSON.parse(String(asRecord(routes[variablePath]?.body)['value'])) as Record<string, unknown>;
  routes[variablePath] = { body: { value: JSON.stringify({ ...value, client_id: 'wrong-client' }) } };
  const results = await checkWindowsSigning(ctx);
  expect(results.find((result) => result.name === 'main-only signing federation')?.status).toBe('fail');
  expect(results.find((result) => result.name === 'signing workflow configuration')?.status).toBe('fail');
});

test('additional federation or inherited publisher roles cannot masquerade as restricted access', async () => {
  const { ctx, routes } = signingFixture();
  const path = `${identityPath}/federatedIdentityCredentials`;
  const credentials = asRecord(routes[path]?.body)['value'] as unknown[];
  routes[path] = { body: { value: [...credentials, { name: 'unreviewed-pr-binding', properties: { subject: 'repo:acme/workspace:pull_request' } }] } };
  const assignments = asRecord(routes[rolesPath]?.body)['value'] as unknown[];
  routes[rolesPath] = { body: { value: [...assignments, { properties: { principalId: 'publisher-principal', scope: '/subscriptions/11111111-1111-4111-8111-111111111111', roleDefinitionId: '/role/8e3af657-a8ff-443c-a75c-2fe8c4bcb635' } }] } };
  const results = await checkWindowsSigning(ctx);
  expect(results.find((result) => result.name === 'main-only signing federation')?.status).toBe('fail');
  expect(results.find((result) => result.name === 'profile-scoped signing permission')?.status).toBe('fail');
});

test('missing read permission is a skip and never leaks reader credentials', async () => {
  const { ctx, routes } = signingFixture();
  routes[rolesPath] = { status: 403, body: { private: 'do-not-print' } };
  routes[variablePath] = { status: 403, body: { private: 'do-not-print' } };
  const results = await checkWindowsSigning(ctx);
  expect(results.find((result) => result.name === 'profile-scoped signing permission')?.status).toBe('skip');
  expect(results.find((result) => result.name === 'signing workflow configuration')?.status).toBe('skip');
  expect(JSON.stringify(results)).not.toMatch(/test-reader-token|do-not-print/);
});
