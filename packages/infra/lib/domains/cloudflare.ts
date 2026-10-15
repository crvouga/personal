/** This adapter deliberately has no write method. Never echo API bodies or contacts. */
import { asRecord, asStrings, type HealthContext } from '../health/context.js';
import type { Zone } from './model.js';
import { parseRecords } from './records.js';

export function accountId(ctx: HealthContext): string {
  const value = ctx.env['TF_VAR_cloudflare_account_id'] ?? ctx.env['CLOUDFLARE_ACCOUNT_ID'];
  if (!value || !/^[a-f0-9]{32}$/.test(value)) throw new Error('CLOUDFLARE_ACCOUNT_ID or TF_VAR_cloudflare_account_id required');
  return value;
}

export async function cfGet(ctx: HealthContext, path: string): Promise<Record<string, unknown>> {
  const token = ctx.env['TF_VAR_cloudflare_api_token'] ?? ctx.env['CF_API_TOKEN'] ?? ctx.env['CLOUDFLARE_API_TOKEN'];
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN, CF_API_TOKEN or TF_VAR_cloudflare_api_token required (read permissions)');
  if (!path.startsWith('/zones') && !path.startsWith('/accounts/')) throw new Error('Unsupported read path');
  const response = await ctx.fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(ctx.options.timeoutMs),
  });
  if (!response.ok) throw new Error(`Cloudflare read ${path.split('?')[0]}: HTTP ${response.status}; check token permissions`);
  const body = asRecord(await response.json());
  if (body.success !== true) throw new Error('Cloudflare read unsuccessful');
  return body;
}

export async function listZones(ctx: HealthContext): Promise<Zone[]> {
  const zones: Zone[] = [];
  for (let page = 1; page <= 100; page++) {
    const body = await cfGet(ctx, `/zones?account.id=${accountId(ctx)}&per_page=50&page=${page}`);
    if (!Array.isArray(body.result)) throw new Error('Cloudflare zones response missing result');
    for (const value of body.result) {
      const row = asRecord(value);
      zones.push({ id: String(row.id), name: String(row.name), status: String(row.status), name_servers: asStrings(row.name_servers) });
    }
    if (page >= Number(asRecord(body.result_info).total_pages ?? 1)) return zones;
  }
  throw new Error('Cloudflare zones pagination exceeded limit');
}

export async function findZone(ctx: HealthContext, domain: string): Promise<Zone> {
  const matches = (await listZones(ctx)).filter((zone) => zone.name === domain);
  if (matches.length !== 1) throw new Error(`${domain}: expected one zone in account; found ${matches.length}. Stage/import through OpenTofu first`);
  const zone = matches[0];
  if (zone.name_servers.length < 2) throw new Error('Cloudflare assigned nameservers unavailable');
  return zone;
}

export async function listRecords(ctx: HealthContext, zone: Zone) {
  const records: unknown[] = [];
  for (let page = 1; page <= 1000; page++) {
    const body = await cfGet(ctx, `/zones/${zone.id}/dns_records?per_page=100&page=${page}`);
    if (!Array.isArray(body.result)) throw new Error('Cloudflare DNS response missing result');
    records.push(...body.result);
    if (page >= Number(asRecord(body.result_info).total_pages ?? 1)) return parseRecords(records, zone.name);
  }
  throw new Error('Cloudflare DNS pagination exceeded limit');
}

export async function dnssec(ctx: HealthContext, zone: Zone) {
  return asRecord((await cfGet(ctx, `/zones/${zone.id}/dnssec`)).result);
}
