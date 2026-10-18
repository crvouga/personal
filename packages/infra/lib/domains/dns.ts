import type { CommandResult, HealthContext } from '../health/context.js';
import { normalizeName, RESOLVERS, type DnsRecord } from './model.js';
import { answerData, rdata } from './records.js';

export type Answer = { readonly name: string; readonly ttl: number; readonly type: string; readonly value: string };
export type DnsReply = { readonly records: readonly Answer[]; readonly authoritative: boolean; readonly authenticated: boolean };

/** dig exit 8, 9 and 10 mean no usable connection, no reply or an internal timeout; a killed dig is the same. */
const TRANSIENT_DIG_CODES: ReadonlySet<number> = new Set([8, 9, 10]);

function isTransientDig(result: CommandResult): boolean {
  return TRANSIENT_DIG_CODES.has(result.code) || result.stderr.includes('terminated by');
}

/**
 * Real answers (including SERVFAIL and NXDOMAIN) exit 0 and are never retried.
 * Only a resolver that could not be reached is retried, and it still fails once the retries are spent.
 */
async function dig(ctx: HealthContext, args: readonly string[], label: string): Promise<CommandResult> {
  const attempts = ctx.options.retries + 1;
  for (let attempt = 1; ; attempt++) {
    const result = await ctx.run('dig', args, { timeoutMs: 8000 });
    if (result.code === 0) return result;
    if (!isTransientDig(result)) throw new Error(`DNS ${label}: dig failed (${result.code})`);
    if (attempt >= attempts) throw new Error(`DNS ${label}: resolver unreachable after ${attempts} attempt${attempts === 1 ? '' : 's'}; dig failed (${result.code})`);
    await new Promise((resolve) => setTimeout(resolve, ctx.options.retryDelayMs));
  }
}

/** Full dig output is essential: +short hides SERVFAIL and negative-answer TTLs. */
export async function query(ctx: HealthContext, server: string, name: string, type: string, recursive = false): Promise<DnsReply> {
  if (!/^[a-zA-Z0-9.:-]+$/.test(server) || !/^[a-zA-Z0-9_.*-]+(?:\.[a-zA-Z0-9_*-]+)*\.?$/.test(name) || !/^[A-Z]+$/.test(type)) {
    throw new Error('Invalid DNS query');
  }
  const result = await dig(ctx, [`@${server}`, name, type, '+tcp', '+dnssec', '+time=3', '+tries=1', recursive ? '+recurse' : '+norecurse'], `${server} ${type} ${name}`);
  const status = /status: (\w+)/.exec(result.stdout)?.[1];
  if (!status || !['NOERROR', 'NXDOMAIN'].includes(status)) throw new Error(`DNS ${server} ${type} ${name}: ${status ?? 'malformed response'}`);
  const flags = /flags: ([^;]+);/.exec(result.stdout)?.[1].split(/\s+/) ?? [];
  const records = result.stdout.split('\n').flatMap((line): Answer[] => {
    const match = /^(\S+)\s+(\d+)\s+IN\s+(\S+)\s+(.+)$/.exec(line);
    return match ? [{ name: normalizeName(match[1]), ttl: Number(match[2]), type: match[3], value: match[4].trim() }] : [];
  });
  return { records, authoritative: flags.includes('aa'), authenticated: flags.includes('ad') };
}

export function answers(reply: DnsReply, name: string, type: string): Answer[] {
  return reply.records.filter((record) => record.name === name && record.type === type);
}

export function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

export async function parents(ctx: HealthContext, domain: string): Promise<string[]> {
  const parent = domain.slice(domain.indexOf('.') + 1);
  const views = await Promise.all(RESOLVERS.map(async (server) =>
    answers(await query(ctx, server, parent, 'NS', true), parent, 'NS').map((record) => normalizeName(record.value))));
  if (!sameSet(views[0], views[1]) || views[0].length === 0) throw new Error('Cannot agree on parent authoritative nameservers');
  return views[0];
}

export async function delegation(ctx: HealthContext, domain: string): Promise<{ servers: string[]; maxTtl: number }> {
  const views = await Promise.all((await parents(ctx, domain)).map(async (server) =>
    answers(await query(ctx, server, domain, 'NS'), domain, 'NS')));
  const names = views.map((view) => view.map((record) => normalizeName(record.value)));
  if (names.some((view) => view.length === 0 || !sameSet(view, names[0]))) throw new Error('Parent delegation missing or inconsistent');
  return { servers: names[0], maxTtl: Math.max(...views.flat().map((record) => record.ttl)) };
}

/** Every RRset is compared as a set so lost MX/TXT siblings cannot pass. */
export async function verifyRecords(ctx: HealthContext, server: string, records: readonly DnsRecord[], cloudflare: boolean, recursive = false, domain = ''): Promise<void> {
  if (!records.length) {
    if (!domain) throw new Error('Empty-zone verification requires the domain');
    const reply = await query(ctx, server, domain, 'SOA', recursive);
    if ((!recursive && !reply.authoritative) || answers(reply, domain, 'SOA').length === 0) throw new Error(`${server}: empty target zone has no authoritative SOA`);
    return;
  }
  // Cloudflare proxies every A/AAAA at a hostname if any sibling is proxied,
  // even when that record's own API proxy flag remains false. Origins and
  // individual proxy flags are still verified by the full API parity check.
  const proxiedNames = new Set(records.filter((record) => record.proxied && ['A', 'AAAA'].includes(record.type)).map((record) => record.name));
  const groups = new Map<string, DnsRecord[]>();
  for (const record of records) {
    const key = `${record.name} ${record.type}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const group of groups.values()) {
    const first = group[0];
    const flattened = cloudflare && (first.proxied || (['A', 'AAAA'].includes(first.type) && proxiedNames.has(first.name)) || first.settings?.flatten_cname || (first.type === 'CNAME' && first.name === domain));
    if (flattened) {
      const reply = await query(ctx, server, first.name, 'A', recursive);
      if ((!recursive && !reply.authoritative) || answers(reply, first.name, 'A').length === 0) throw new Error(`${server}: ${first.name} flattened/proxied answer missing`);
      continue;
    }
    const reply = await query(ctx, server, first.name, first.type, recursive);
    if (!recursive && first.type !== 'NS' && !reply.authoritative) throw new Error(`${server}: ${first.name} is not authoritative`);
    const got = answers(reply, first.name, first.type).map((record) => answerData(first.type, record.value));
    if (!sameSet(group.map(rdata), got)) throw new Error(`${server}: ${first.type} ${first.name} RRset differs from baseline`);
  }
}
