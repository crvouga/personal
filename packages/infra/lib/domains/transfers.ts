/** Transfer requests are OpenTofu resources. This module only reads status/inputs. */
import { asRecord, type HealthContext } from '../health/context.js';
import { accountId, cfGet, transferStatus } from './cloudflare.js';

export function authCode(ctx: HealthContext, domain: string): string {
  let codes: Record<string, unknown>;
  try { codes = asRecord(JSON.parse(ctx.env['TF_VAR_domain_auth_codes'] ?? '{}')); }
  catch { throw new Error('TF_VAR_domain_auth_codes must be a private JSON object; its value is never logged'); }
  const code = codes[domain];
  if (typeof code !== 'string' || !code.trim()) throw new Error(`${domain}: no owner-authorized EPP code available through the encrypted OpenTofu input`);
  return code;
}

export async function transferPreflight(ctx: HealthContext, domain: string): Promise<string> {
  if (!ctx.config.domains?.[domain]?.transfer_enabled) throw new Error('transfer_enabled is false in the canonical inventory');
  authCode(ctx, domain);
  const extension = domain.split('.').at(-1)!;
  const body = await cfGet(ctx, `/accounts/${accountId(ctx)}/registrar/extensions/${extension}`);
  const schema = asRecord(body.result).transfer_schema;
  if (schema === undefined || schema === null || schema === false || (typeof schema !== 'object' && schema !== true)) throw new Error('The Registrar API supplied no transfer schema for this extension; verify API support before a billable request');
  try {
    const status = await transferStatus(ctx, domain);
    throw new Error(`A transfer workflow already exists (${String(status.state)}); resume read-only status checks, never submit again`);
  } catch (err) {
    // An enabled, reachable extension API plus a 404 on this workflow is the
    // documented initial state. Any other error is missing evidence.
    if (!(err instanceof Error) || !err.message.includes(': HTTP 404;')) throw err;
  }
  return 'authorized EPP input present, extension schema available and no existing transfer workflow';
}

export async function acceptedTransfer(ctx: HealthContext, domain: string): Promise<string> {
  const status = await transferStatus(ctx, domain);
  if (!['pending', 'in_progress', 'blocked', 'action_required', 'succeeded'].includes(String(status.state))) {
    throw new Error(`Transfer workflow is ${String(status.state)}; preserve state and resolve the reported registrar condition`);
  }
  return `workflow ${String(status.state)}; registration is complete only after the complete gate passes`;
}
