/** Native owner changes are exclusively leased, scoped saved OpenTofu applies. */
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asRecord, type HealthContext } from '../health/context.js';
import { digest, directory, privateJson } from './files.js';
import { migrationProgress } from './progress.js';
import { criticalHealth } from './plans.js';
import { applyOwnerOperation } from '../../tofu/owner/browser.js';
import { normalizeOperation, operationFile, operationId, ownerReceipt, type OwnerOperation } from '../../tofu/owner/operation.js';
import { startOwnerTransport } from '../../tofu/owner/transport.js';

export function reviewOwnerPlan(plan: unknown, input: OwnerOperation): string[] {
  if (asRecord(plan).errored === true) throw new Error('Owner plan is not applyable');
  const operation = normalizeOperation(input);
  const id = operationId(operation);
  const changes = asRecord(plan).resource_changes;
  if (!Array.isArray(changes)) throw new Error('Owner plan has no readable resource changes');
  const summary: string[] = [];
  for (const raw of changes) {
    const resource = asRecord(raw), change = asRecord(resource.change), after = asRecord(change.after);
    const actions = Array.isArray(change.actions) ? change.actions : [];
    if (resource.address !== 'restapi_object.squarespace_owner_operation[0]' || resource.provider_name !== 'registry.opentofu.org/mastercard/restapi' ||
      !(actions.length === 1 && ['create', 'no-op'].includes(String(actions[0]))) || change.importing) throw new Error('Owner plan changes an unrelated resource or replaces/updates an existing operation');
    if (after.path !== '/operations' || after.object_id !== id || after.create_method !== 'POST' ||
      (after.create_path != null && after.create_path !== '/operations') || (after.query_string != null && after.query_string !== '') ||
      after.read_method !== 'GET' || after.read_path !== `/operations/${id}` || after.update_method !== 'GET' || after.update_path !== `/operations/${id}` ||
      after.destroy_method !== 'GET' || after.destroy_path !== `/operations/${id}` || after.debug !== false || after.ignore_all_server_changes !== true) throw new Error('Owner resource methods/paths differ from the guarded transport');
    let body: Record<string, unknown>;
    try { body = asRecord(JSON.parse(String(after.data))); } catch { throw new Error('Owner plan data is unreadable; contents withheld'); }
    if (Object.keys(body).sort().join(',') !== 'action,domain,id,nameservers' || body.id !== id || digest(normalizeOperation(body as unknown as OwnerOperation)) !== digest(operation)) throw new Error('Owner plan targets a different domain, action or nameserver assignment');
    if (actions[0] !== 'no-op') summary.push(`create ${resource.address}: ${operation.domain} ${operation.action}`);
  }
  return summary;
}

export async function executeOwnerOperation(ctx: HealthContext, input: OwnerOperation, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const operation = normalizeOperation(input);
  const existing = ownerReceipt(ctx.repoRoot, operation);
  if (existing && existsSync(operationFile(ctx.repoRoot, operation, 'tofu-applied'))) return existing;
  if (!ctx.env['TF_VAR_state_passphrase']) throw new Error('Owner execution requires the existing OpenTofu state passphrase; no replacement is generated');
  const id = operationId(operation);
  const dir = directory(ctx.repoRoot, operation.domain);
  const dataDir = join(dir, `owner-${operation.action}-${id}-data`);
  mkdirSync(dataDir, { mode: 0o700, recursive: true });
  const root = `-chdir=${join(ctx.repoRoot, 'packages/infra/tofu/owner')}`;
  const transport = startOwnerTransport(ctx, operation, applyOwnerOperation);
  const env = { ...ctx.env, TF_DATA_DIR: dataDir, TF_IN_AUTOMATION: 'true', API_DATA_IS_SENSITIVE: 'true',
    TF_VAR_owner_operation: JSON.stringify(operation), TF_VAR_owner_bridge_url: transport.url, TF_VAR_owner_bridge_token: transport.token };
  const run = async (args: string[], timeoutMs: number) => {
    const result = await ctx.run('tofu', [root, ...args], { env, timeoutMs });
    if (result.code !== 0 && !(args[0] === 'plan' && result.code === 2)) throw new Error(`Owner OpenTofu ${args[0]} did not complete; output withheld; inspect the private receipt and intent before another plan`);
    return result;
  };
  const plan = join(dir, `owner-${operation.action}-${Date.now()}-${crypto.randomUUID()}.tfplan`);
  try {
    migrationProgress('owner-init', `Initializing the encrypted ${operation.action} execution state`, operation.domain);
    await run(['init', '-input=false', '-lockfile=readonly', `-backend-config=path=${join(dir, `owner-${operation.action}-${id}.tfstate`)}`], 120000);
    signal?.throwIfAborted();
    migrationProgress('owner-plan', `Planning the Squarespace ${operation.action} operation through OpenTofu`, operation.domain);
    await run(['plan', '-input=false', '-parallelism=1', '-detailed-exitcode', `-out=${plan}`], 180000);
    chmodSync(plan, 0o600);
    const shown = await run(['show', '-json', plan], 60000);
    let parsed: unknown;
    try { parsed = JSON.parse(shown.stdout); } catch { throw new Error('Owner plan JSON is unreadable; output withheld'); }
    const variables = asRecord(asRecord(parsed).variables);
    if (asRecord(variables.owner_bridge_url).value !== transport.url || asRecord(variables.owner_bridge_token).value !== transport.token) throw new Error('Owner plan transport identity differs from this execution');
    const summary = reviewOwnerPlan(parsed, operation);
    const sha256 = Bun.CryptoHasher.hash('sha256', readFileSync(plan), 'hex');
    privateJson(`${plan}.review.json`, { reviewer: 'strict-owner-operation-v1', operation, id, sha256, summary, reviewedAt: ctx.now().toISOString() });
    if (summary.length) {
      signal?.throwIfAborted();
      await criticalHealth(ctx);
      signal?.throwIfAborted();
      if (Bun.CryptoHasher.hash('sha256', readFileSync(plan), 'hex') !== sha256) throw new Error('Saved owner plan changed after review');
      privateJson(`${plan}.attempt.json`, { id, sha256, startedAt: ctx.now().toISOString() });
      migrationProgress('owner-apply', `Applying the reviewed Squarespace ${operation.action} operation`, operation.domain);
      try {
        await transport.withApplyLease(() => run(['apply', '-input=false', '-parallelism=1', plan], 300000));
        privateJson(`${plan}.applied.json`, { id, sha256, appliedAt: ctx.now().toISOString() });
      } finally { await criticalHealth(ctx); }
    }
    const receipt = ownerReceipt(ctx.repoRoot, operation);
    if (!receipt) throw new Error('Owner native outcome has no verified receipt');
    const proof = operationFile(ctx.repoRoot, operation, 'tofu-applied');
    if (!existsSync(proof)) privateJson(proof, { id, sha256, verifiedAt: ctx.now().toISOString() });
    return receipt;
  } finally { transport.close(); }
}
