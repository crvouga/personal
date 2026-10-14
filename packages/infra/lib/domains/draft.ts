import { join } from 'node:path';
import { asRecord, type HealthContext } from '../health/context.js';
import { listZones, listRecords } from './cloudflare.js';
import { effectiveRecords } from './forwarding.js';
import { directory, digest, privateJson, readJson } from './files.js';
import type { DnsRecord, DomainSpec, Snapshot } from './model.js';
import { recordKey, settingsKey } from './records.js';

function resources(module: Record<string, unknown>): Record<string, unknown>[] {
  return [
    ...(Array.isArray(module.resources) ? module.resources.map(asRecord) : []),
    ...(Array.isArray(module.child_modules) ? module.child_modules.flatMap((child) => resources(asRecord(child))) : []),
  ];
}

async function ownedRecordIds(ctx: HealthContext, zoneId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const root of ['foundation', 'fleet']) {
    const result = await ctx.run('tofu', [`-chdir=${join(ctx.repoRoot, 'packages/infra/tofu', root)}`, 'show', '-json'], { timeoutMs: 60000, env: ctx.env });
    if (result.code !== 0) throw new Error(`Initialize ${root} and supply encrypted state credentials before drafting adoption; state output is never logged`);
    const state = asRecord(JSON.parse(result.stdout));
    const values = asRecord(state.values);
    if (!values.root_module) throw new Error(`${root}: no state found; refuse to infer ownership`);
    for (const resource of resources(asRecord(values.root_module))) {
      const value = asRecord(resource.values);
      if (resource.type === 'cloudflare_dns_record' && value.zone_id === zoneId) ids.add(String(value.id));
    }
  }
  return ids;
}

/** Generate a reviewable candidate, never change inventory or run an apply. */
export async function draft(ctx: HealthContext, domain: string, spec: DomainSpec, snapshot: Snapshot): Promise<string> {
  const zone = (await listZones(ctx)).find((zone) => zone.name === domain);
  const target = zone ? await listRecords(ctx, zone) : [];
  const existingKeys = new Set(snapshot.records.map(recordKey));
  if (target.some((record) => !existingKeys.has(recordKey(record)))) throw new Error('Target has additional/changed records; resolve against source before drafting');
  const owned = zone ? await ownedRecordIds(ctx, zone.id) : new Set<string>();
  const records: Record<string, DnsRecord> = {};
  const alreadyDeclared = new Map(Object.entries(spec.records).map(([key, record]) => [recordKey(record), key]));
  for (const record of effectiveRecords(snapshot.records, spec)) {
    const live = target.find((candidate) => recordKey(candidate) === recordKey(record));
    const original = snapshot.records.find((candidate) => recordKey(candidate) === recordKey(record));
    if (live && settingsKey(live) !== settingsKey(record) && (!spec.forwarding_enabled || !original || settingsKey(live) !== settingsKey(original))) throw new Error(`${record.name}: TTL/proxy/settings differ; reconcile before drafting`);
    const previousKey = alreadyDeclared.get(recordKey(record));
    if (live?.id && owned.has(live.id) && !previousKey) continue;
    const { id: _sourceId, ...desired } = record;
    records[previousKey ?? `${record.type.toLowerCase()}-${digest(recordKey(record)).slice(0, 16)}`] = {
      ...desired, ...(live?.id ? { id: live.id } : {}),
    };
  }
  const inventory = asRecord(readJson(join(ctx.repoRoot, 'packages/infra/tofu/modules/inventory/inventory.tf.json')));
  const config = asRecord(asRecord(inventory.locals).inventory);
  const candidate = {
    ...inventory, locals: { ...asRecord(inventory.locals), inventory: {
      ...config, domains: { ...asRecord(config.domains), [domain]: {
        ...spec, manage_zone: domain !== ctx.config.zone, ...(zone ? { existing_zone_id: zone.id } : {}), records,
      } },
    } },
  };
  const path = join(directory(ctx.repoRoot, domain), `inventory-draft-${Date.now()}-${crypto.randomUUID()}.json`);
  privateJson(path, candidate);
  return path;
}
