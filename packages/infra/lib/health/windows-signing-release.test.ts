import { expect, test } from 'bun:test';
import { asRecord } from './context.js';
import { checkSignedInstaller } from './windows-signing-release.js';
import { proofPath, publisher, releasePath, signingFixture, sourcePath } from './windows-signing.test-support.js';

test('missing proof, altered download digest and wrong publisher fail public release readiness', async () => {
  const missing = signingFixture();
  missing.routes[releasePath] = { body: { assets: [{ name: 'fleet-installer-windows-x64.exe' }] } };
  expect((await checkSignedInstaller(missing.ctx, publisher)).status).toBe('fail');
  for (const patch of [{ sha256: 'f'.repeat(64) }, { publisher: 'CN=Other' }]) {
    const { ctx, routes } = signingFixture();
    routes[proofPath] = { body: { ...asRecord(routes[proofPath]?.body), ...patch } };
    expect((await checkSignedInstaller(ctx, publisher)).status).toBe('fail');
  }
});

test('a failed, PR, foreign-repository or wrong-revision source run never establishes release trust', async () => {
  for (const patch of [{ conclusion: 'failure' }, { path: '.github/workflows/unrelated.yml' }, { event: 'pull_request' }, { head_repository: { full_name: 'other/workspace' } }, { head_sha: 'e'.repeat(40) }]) {
    const { ctx, routes } = signingFixture();
    routes[sourcePath] = { body: { ...asRecord(routes[sourcePath]?.body), ...patch } };
    expect((await checkSignedInstaller(ctx, publisher)).status).toBe('fail');
  }
});

test('missing release digest is unknown, never a verification pass', async () => {
  const { ctx, routes } = signingFixture();
  routes[releasePath] = { body: { assets: [{ name: 'fleet-installer-windows-x64.exe' }, { name: 'fleet-installer-windows-x64.signature.json' }] } };
  expect((await checkSignedInstaller(ctx, publisher)).status).toBe('skip');
});
