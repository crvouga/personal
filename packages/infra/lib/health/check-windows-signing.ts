/** Azure GET probes only. Authentication failures never print CLI/token output. */
import { asRecord, getJson, type HealthContext } from './context.js';
import { fail, pass, skip, type CheckResult } from './report.js';
import { checkSigningAccess, signingAccountPath, verifiedPublisher } from './windows-signing-access.js';
import { checkSignedInstaller } from './windows-signing-release.js';

export async function checkWindowsSigning(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const config = ctx.config.fleet_windows_signing;
  if (!config?.enabled) return [skip('publisher enrollment', 'Azure signing account enrollment is not configured')];
  if (!config.subscription_id || !config.tenant_id) return [fail('publisher enrollment', 'Azure subscription and tenant are missing from inventory')];
  let token: string;
  try {
    const auth = await ctx.run('az', [
      'account', 'get-access-token', '--subscription', config.subscription_id,
      '--resource', 'https://management.azure.com/', '--output', 'json',
    ], { timeoutMs: ctx.options.timeoutMs });
    if (auth.code !== 0 || !auth.stdout.trim()) return [skip('publisher enrollment', 'Azure read credentials unavailable; sign in with the Azure CLI')];
    const credential = asRecord(JSON.parse(auth.stdout));
    if (credential['tenant'] !== config.tenant_id || typeof credential['accessToken'] !== 'string' || !credential['accessToken']) {
      return [skip('publisher enrollment', 'Azure credential is missing or belongs to a different tenant')];
    }
    token = credential['accessToken'];
  } catch {
    return [skip('publisher enrollment', 'Azure CLI/read credentials unavailable')];
  }
  const account = signingAccountPath(config);
  const azure = (path: string, version: string) => getJson(ctx, `https://management.azure.com${path}?api-version=${version}`, { Authorization: `Bearer ${token}` });
  const targets = [
    { name: 'signing account', path: account },
    ...(config.identity_validation_id ? [{ name: 'public certificate profile', path: `${account}/certificateProfiles/${encodeURIComponent(config.profile)}` }] : []),
  ];
  const results: CheckResult[] = [];
  let publisher: string | undefined;
  let endpoint = '';
  for (const target of targets) {
    const response = await azure(target.path, '2024-02-05-preview');
    if (response.status === 401 || response.status === 403) {
      results.push(skip(target.name, 'Azure reader permission is unavailable'));
      continue;
    }
    const body = asRecord(response.body);
    const properties = asRecord(body['properties']);
    if (target.name === 'signing account') endpoint = String(properties['accountUri'] ?? '');
    else publisher = verifiedPublisher(properties);
    const valid = response.status === 200 && properties['provisioningState'] === 'Succeeded' &&
      (target.name === 'signing account'
        ? asRecord(properties['sku'])['name'] === 'Basic' && String(body['location']).replace(/\s/g, '').toLowerCase() === config.location
        : properties['profileType'] === 'PublicTrust' && properties['status'] === 'Active' && properties['identityValidationId'] === config.identity_validation_id && publisher !== undefined);
    results.push(valid ? pass(target.name, 'Azure resource matches inventory and is ready') : fail(target.name, `Azure resource is missing, not ready or differs from inventory (HTTP ${response.status}); review the signing OpenTofu plan`));
  }
  if (!config.identity_validation_id) results.push(fail('identity validation', 'Complete Microsoft personal identity verification, then apply the signing OpenTofu activation plan'));
  if (publisher && results.every((result) => result.status === 'pass')) {
    const checks = await Promise.allSettled([
      checkSigningAccess(ctx, azure, { config, publisher, endpoint }),
      checkSignedInstaller(ctx, publisher),
    ]);
    for (const check of checks) results.push(...(check.status === 'fulfilled'
      ? Array.isArray(check.value) ? check.value : [check.value]
      : [fail('signing activation', 'Cannot verify signing access or public release; retry the read-only health check')]));
  }
  return results;
}
