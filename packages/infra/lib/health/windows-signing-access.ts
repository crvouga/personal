/** Read-only verification of the actual publisher identity and release wiring. */
import type { InfraConfig } from '../schema.js';
import { asRecord, type HealthContext, type JsonResponse } from './context.js';
import { githubApi } from './check-github.js';
import { checkSigningFederation } from './windows-signing-federation.js';
import { fail, pass, skip, type CheckResult } from './report.js';

export type SigningConfig = NonNullable<InfraConfig['fleet_windows_signing']>;
export type AzureReader = (path: string, version: string) => Promise<JsonResponse>;
type VerifiedProfile = { readonly config: SigningConfig; readonly publisher: string; readonly endpoint: string };
const SIGNER_ROLE = '/2837e146-70d7-4cfd-ad55-7efa6464f958';

export function signingAccountPath(config: SigningConfig): string {
  return `/subscriptions/${config.subscription_id}/resourceGroups/${encodeURIComponent(config.resource_group)}/providers/Microsoft.CodeSigning/codeSigningAccounts/${encodeURIComponent(config.account)}`;
}

/** A rotated certificate may overlap another certificate for the same subject. */
export function verifiedPublisher(properties: Readonly<Record<string, unknown>>): string | undefined {
  const certificates = properties['certificates'];
  if (!Array.isArray(certificates)) return undefined;
  const subjects = [...new Set(certificates.map(asRecord).filter((entry) => entry['status'] === 'Active').flatMap((entry) => {
    const subject = entry['subjectName'];
    return typeof subject === 'string' && subject.trim() ? [subject] : [];
  }))];
  return subjects.length === 1 ? subjects[0] : undefined;
}

function azureResult(name: string, response: JsonResponse, valid: boolean): CheckResult {
  if (response.status === 401 || response.status === 403) return skip(name, 'Azure reader permission unavailable; access was not verified');
  return response.status === 200 && valid ? pass(name, 'Expected publisher identity and restricted access verified') : fail(name, `Missing or mismatched signing access (HTTP ${response.status}); review the signing OpenTofu plan`);
}

async function workflowConfiguration(ctx: HealthContext, profile: VerifiedProfile & { readonly clientId: unknown }): Promise<CheckResult> {
  const { config, clientId, publisher, endpoint } = profile;
  const name = 'signing workflow configuration';
  const token = ctx.githubToken();
  if (!token) return skip(name, 'GitHub Actions variable reader credential unavailable');
  const response = await githubApi(ctx, token)(`/repos/${ctx.config.github?.infra_repo}/actions/variables/FLEET_WINDOWS_SIGNING`);
  if (response.status === 401 || response.status === 403) return skip(name, 'GitHub Actions variable reader permission unavailable');
  let value: Readonly<Record<string, unknown>> = {};
  try { value = asRecord(JSON.parse(String(asRecord(response.body)['value']))); } catch { /* Missing or invalid configuration fails below. */ }
  const expected = {
    tenant_id: config.tenant_id, subscription_id: config.subscription_id,
    client_id: clientId, account: config.account, profile: config.profile, publisher,
  };
  const valid = typeof clientId === 'string' && clientId.length > 0 &&
    Object.entries(expected).every(([key, entry]) => value[key] === entry) &&
    /^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/$/.test(endpoint) && value['endpoint'] === endpoint;
  return response.status === 200 && valid ? pass(name, 'Actions configuration matches the live identity and verified publisher') : fail(name, `Signing is not activated or configuration differs from Azure (HTTP ${response.status}); apply the reviewed signing OpenTofu plan`);
}

export async function checkSigningAccess(ctx: HealthContext, azure: AzureReader, profile: VerifiedProfile): Promise<readonly CheckResult[]> {
  const { config } = profile;
  const identityPath = `/subscriptions/${config.subscription_id}/resourceGroups/${encodeURIComponent(config.resource_group)}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/fleet-installer-publisher`;
  const profilePath = `${signingAccountPath(config)}/certificateProfiles/${encodeURIComponent(config.profile)}`;
  const [identity, federation, roles] = await Promise.all([
    azure(identityPath, '2023-01-31'),
    azure(`${identityPath}/federatedIdentityCredentials`, '2023-01-31'),
    azure(`${profilePath}/providers/Microsoft.Authorization/roleAssignments`, '2022-04-01&$filter=atScope()'),
  ]);
  const properties = asRecord(asRecord(identity.body)['properties']);
  const principalId = properties['principalId'];
  const assignments = asRecord(roles.body)['value'];
  const publisherRoles = Array.isArray(assignments) ? assignments.map(asRecord).map((entry) => asRecord(entry['properties'])).filter((role) => typeof principalId === 'string' && role['principalId'] === principalId) : [];
  const signer = publisherRoles.length === 1 && publisherRoles.every((role) =>
    String(role['scope']).toLowerCase() === profilePath.toLowerCase() && String(role['roleDefinitionId']).toLowerCase().endsWith(SIGNER_ROLE) && !role['condition']) && !asRecord(roles.body)['nextLink'];
  return [
    azureResult('publisher managed identity', identity, typeof principalId === 'string' && typeof properties['clientId'] === 'string'),
    await checkSigningFederation(ctx, federation),
    azureResult('profile-scoped signing permission', roles, signer),
    await workflowConfiguration(ctx, { ...profile, clientId: properties['clientId'] }),
  ];
}
