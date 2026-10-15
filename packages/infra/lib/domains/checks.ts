import { asRecord, asStrings, errorMessage, type HealthContext } from '../health/context.js';
import { fail, pass, type CheckResult } from '../health/report.js';
import { answers, parents, query } from './dns.js';
import { RESOLVERS } from './model.js';

export async function probe(name: string, task: () => Promise<string>): Promise<CheckResult> {
  try { return pass(name, await task()); }
  catch (error) { return fail(name, errorMessage(error)); }
}

export async function absentDs(ctx: HealthContext, domain: string): Promise<string> {
  for (const server of [...await parents(ctx, domain), ...RESOLVERS]) {
    const recursive = RESOLVERS.some((value) => value === server);
    const reply = await query(ctx, server, domain, 'DS', recursive);
    if (!recursive && !reply.authoritative) throw new Error(`${server}: DS absence is not authoritative`);
    if (answers(reply, domain, 'DS').length) throw new Error(`${server}: unexpected DS published or cached`);
    if (!reply.records.some((record) => ['SOA', 'NSEC', 'NSEC3'].includes(record.type))) throw new Error(`${server}: no negative-answer proof`);
  }
  return 'DS absent at every parent authority and both validating resolvers';
}

const bootstraps = new WeakMap<HealthContext, Promise<Record<string, unknown>>>();

/** Use the authoritative RDAP service, avoiding a rate-limited forwarding proxy. */
export async function rdap(ctx: HealthContext, domain: string): Promise<Record<string, unknown>> {
  let bootstrap = bootstraps.get(ctx);
  if (!bootstrap) {
    bootstrap = (async () => {
      const response = await ctx.fetch('https://data.iana.org/rdap/dns.json', { method: 'GET', signal: AbortSignal.timeout(ctx.options.timeoutMs) });
      if (!response.ok) throw new Error(`RDAP bootstrap HTTP ${response.status}`);
      return asRecord(await response.json());
    })();
    bootstraps.set(ctx, bootstrap);
  }
  const services = (await bootstrap).services;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  const service = Array.isArray(services) ? services.find((row) => Array.isArray(row) && asStrings(row[0]).includes(tld)) : undefined;
  const base = Array.isArray(service) ? asStrings(service[1]).find((url) => url.startsWith('https://')) : undefined;
  if (!base) throw new Error('Authoritative RDAP service unavailable');
  const response = await ctx.fetch(`${base.replace(/\/$/, '')}/domain/${domain}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(ctx.options.timeoutMs) });
  if (!response.ok) throw new Error(`RDAP HTTP ${response.status}`);
  return asRecord(await response.json());
}

export async function retainedRegistrar(ctx: HealthContext, domain: string): Promise<string> {
  const doc = await rdap(ctx, domain);
  if (String(doc.ldhName).toLowerCase() !== domain) throw new Error('RDAP domain identity mismatch');
  const entities = Array.isArray(doc.entities) ? doc.entities.map(asRecord) : [];
  const registrar = entities.find((entity) => asStrings(entity.roles).includes('registrar'));
  const card = registrar?.vcardArray;
  const fields = Array.isArray(card) && Array.isArray(card[1]) ? card[1] : [];
  const name = fields.find((field) => Array.isArray(field) && field[0] === 'fn')?.[3];
  const ids = Array.isArray(registrar?.publicIds) ? registrar.publicIds.map(asRecord) : [];
  const expected = ctx.config.domains?.[domain]?.registrar_iana_id;
  if (!expected || !ids.some((id) => id.type === 'IANA Registrar ID' && id.identifier === expected)) throw new Error('RDAP registrar differs from retained Squarespace-managed inventory');
  if (typeof name !== 'string') throw new Error('Registrar name unavailable');
  const status = asStrings(doc.status).map((value) => value.toLowerCase().replace(/\s/g, ''));
  if (status.some((value) => /pendingtransfer|hold|redemption|pendingdelete/.test(value))) throw new Error('RDAP indicates a pending transfer, hold or deletion');
  if (!status.includes('clienttransferprohibited')) throw new Error('Registrar transfer lock is not verified');
  return `${name}; transfer locked; no pending transfer`;
}
