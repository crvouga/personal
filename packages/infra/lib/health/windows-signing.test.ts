import { expect, test } from 'bun:test';
import { checkWindowsSigning } from './check-windows-signing.js';
import { fakeContext } from './fixtures.test-support.js';

const signing = {
  enabled: true, subscription_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: '22222222-2222-4222-8222-222222222222', operator_object_id: '33333333-3333-4333-8333-333333333333',
  resource_group: 'fleet-windows-signing', location: 'eastus', account: 'fleettest',
  profile: 'fleet-installer', identity_validation_id: '44444444-4444-4444-8444-444444444444',
};

function context(profileStatus = 'Active') {
  const ctx = fakeContext();
  return {
    ...ctx,
    config: { ...ctx.config, fleet_windows_signing: signing },
    run: async (command: string, args: readonly string[]) => {
      expect(command).toBe('az');
      expect(args.slice(0, 2)).toEqual(['account', 'get-access-token']);
      return { code: 0, stdout: 'test-reader-token', stderr: '' };
    },
    fetch: (async (url, options) => {
      expect(options?.method).toBe('GET');
      const profile = String(url).includes('/certificateProfiles/');
      return Response.json(profile ? {
        properties: { provisioningState: 'Succeeded', status: profileStatus, profileType: 'PublicTrust', identityValidationId: signing.identity_validation_id },
      } : { location: 'eastus', sku: { name: 'Basic' }, properties: { provisioningState: 'Succeeded' } });
    }) as typeof fetch,
  };
}

test('signing health uses only GETs and distinguishes a ready profile from a disabled one', async () => {
  const healthy = await checkWindowsSigning(context());
  expect(healthy.map((result) => result.status)).toEqual(['pass', 'pass']);
  const broken = await checkWindowsSigning(context('Disabled'));
  expect(broken.map((result) => result.status)).toEqual(['pass', 'fail']);
  expect(JSON.stringify(healthy)).not.toContain('test-reader-token');
});

test('missing enrollment, CLI and Azure credentials are skips, never passes or leaked output', async () => {
  expect((await checkWindowsSigning(fakeContext()))[0]?.status).toBe('skip');
  const results = await checkWindowsSigning({
    ...context(), run: async () => ({ code: 1, stdout: 'private-token', stderr: 'private-account-details' }),
  });
  expect(results[0]?.status).toBe('skip');
  expect(JSON.stringify(results)).not.toContain('private-');
});

test('bootstrap cannot pass health before Microsoft identity verification', async () => {
  const ctx = context();
  const results = await checkWindowsSigning({ ...ctx, config: { ...ctx.config, fleet_windows_signing: { ...signing, identity_validation_id: null } } });
  expect(results.map((result) => result.status)).toEqual(['pass', 'fail']);
  expect(results[1]?.name).toBe('identity validation');
});
