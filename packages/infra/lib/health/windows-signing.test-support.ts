import { expect } from 'bun:test';
import { fakeContext } from './fixtures.test-support.js';
import { signingAccountPath } from './windows-signing-access.js';

export const signing = {
  enabled: true, subscription_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: '22222222-2222-4222-8222-222222222222', operator_object_id: '33333333-3333-4333-8333-333333333333',
  resource_group: 'fleet-windows-signing', location: 'eastus', account: 'fleettest',
  profile: 'fleet-installer', identity_validation_id: '44444444-4444-4444-8444-444444444444',
};
export const publisher = 'CN=Fleet Test, O=Fleet Test, C=US';
const digest = 'a'.repeat(64);
const revision = 'b'.repeat(40);
export const profilePath = `${signingAccountPath(signing)}/certificateProfiles/fleet-installer`;
export const variablePath = '/repos/acme/workspace/actions/variables/FLEET_WINDOWS_SIGNING';
export const releasePath = '/repos/acme/workspace/releases/tags/fleet-installer';
export const proofPath = '/acme/workspace/releases/download/fleet-installer/fleet-installer-windows-x64.signature.json';
export const sourcePath = '/repos/acme/workspace/actions/runs/123';
export const identityPath = `/subscriptions/${signing.subscription_id}/resourceGroups/fleet-windows-signing/providers/Microsoft.ManagedIdentity/userAssignedIdentities/fleet-installer-publisher`;
export const rolesPath = `${profilePath}/providers/Microsoft.Authorization/roleAssignments`;

export function signingFixture() {
  const base = fakeContext();
  const routes: Record<string, { status?: number; body: unknown }> = {
    [signingAccountPath(signing)]: { body: { location: 'eastus', properties: { sku: { name: 'Basic' }, provisioningState: 'Succeeded', accountUri: 'https://eus.codesigning.azure.net/' } } },
    [profilePath]: { body: { properties: { provisioningState: 'Succeeded', status: 'Active', profileType: 'PublicTrust', identityValidationId: signing.identity_validation_id, certificates: [{ status: 'Active', subjectName: publisher }] } } },
    [identityPath]: { body: { properties: { principalId: 'publisher-principal', clientId: 'publisher-client' } } },
    [`${identityPath}/federatedIdentityCredentials`]: { body: { value: [{ name: 'github-main', properties: { issuer: 'https://token.actions.githubusercontent.com', subject: 'repo:acme/workspace:ref:refs/heads/main', audiences: ['api://AzureADTokenExchange'] } }] } },
    [rolesPath]: { body: { value: [{ properties: { principalId: 'publisher-principal', scope: profilePath, roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/2837e146-70d7-4cfd-ad55-7efa6464f958' } }] } },
    [variablePath]: { body: { value: JSON.stringify({ tenant_id: signing.tenant_id, subscription_id: signing.subscription_id, client_id: 'publisher-client', endpoint: 'https://eus.codesigning.azure.net/', account: signing.account, profile: signing.profile, publisher }) } },
    [releasePath]: { body: { assets: [{ name: 'fleet-installer-windows-x64.exe', digest: `sha256:${digest}` }, { name: 'fleet-installer-windows-x64.signature.json' }] } },
    [proofPath]: { body: { file: 'fleet-installer-windows-x64.exe', publisher, sha256: digest, revision, runId: 123, certificateThumbprint: 'c'.repeat(40), timestampCertificateThumbprint: 'd'.repeat(40) } },
    [sourcePath]: { body: { path: '.github/workflows/ci.yml', head_sha: revision, conclusion: 'success', head_branch: 'main', event: 'push', head_repository: { full_name: 'acme/workspace' } } },
  };
  return {
    routes,
    ctx: {
      ...base, config: { ...base.config, fleet_windows_signing: signing },
      run: async (command: string, args: readonly string[]) => {
        expect(command).toBe('az');
        expect(args.slice(0, 2)).toEqual(['account', 'get-access-token']);
        expect(args).not.toContain('--tenant');
        return { code: 0, stdout: JSON.stringify({ tenant: signing.tenant_id, accessToken: 'test-reader-token' }), stderr: '' };
      },
      fetch: (async (url, options) => {
        expect(options?.method).toBe('GET');
        const parsed = new URL(String(url));
        const route = routes[parsed.pathname];
        return Response.json(route?.body ?? {}, { status: route?.status ?? (route ? 200 : 404) });
      }) as typeof fetch,
    },
  };
}
