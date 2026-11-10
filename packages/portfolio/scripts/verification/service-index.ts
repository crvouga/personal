/**
 * Reads every web host the OpenTofu inventory serves, for the committed
 * snapshot behind `/index/` (`src/data/service-index.json`). Shared by the
 * CLI (`scripts/service-index.ts`) and the drift test, so both run the same
 * code.
 *
 * Hosts come from four places in `locals.inventory`:
 * - `services`: hosted applications (Railway);
 * - `auth_relay.instances`: the sign-in relay and its admin console;
 * - `cloudflare.dns.records`: other web records in the zone (A, AAAA, CNAME),
 *   minus `_` verification records and anything at or under a mail domain;
 * - `domains`: other registered domains, at the URL each declares first.
 *
 * Stores with no web host come from `postgres.projects` (PlanetScale) and
 * `object_stores` (R2 buckets), each linked to its provider console.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SERVICE_INDEX_VERSION,
  type Hosting,
  type IndexedHost,
  type IndexedResource,
  type ServiceIndexSnapshot,
} from '../../src/lib/service-index';

export const SERVICE_INDEX_RELATIVE_PATH = 'src/data/service-index.json';

type Row = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const at = (value: unknown, key: string): unknown => {
  if (!isRecord(value) || !(key in value)) {
    throw new Error(`inventory: missing \`${key}\``);
  }
  return value[key];
};

const str = (value: unknown, key: string): string => {
  const found = at(value, key);
  if (typeof found !== 'string' || found === '') {
    throw new Error(`inventory: \`${key}\` is not a non-empty string`);
  }
  return found;
};

const optionalStr = (value: unknown, key: string): string | null => {
  if (!isRecord(value)) return null;
  const found = value[key];
  return typeof found === 'string' && found !== '' ? found : null;
};

const rows = (value: unknown, key: string): readonly unknown[] => {
  const found = at(value, key);
  if (Array.isArray(found)) return found;
  if (isRecord(found)) return Object.values(found);
  throw new Error(`inventory: \`${key}\` is not a list or map`);
};

const WEB_RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME']);

const rootUrl = (hostname: string): string => `https://${hostname}/`;

const fromServices = (inventory: unknown): readonly IndexedHost[] =>
  rows(inventory, 'services').map((service) => {
    const hostname = str(service, 'hostname');
    return {
      hostname,
      url: rootUrl(hostname),
      id: str(service, 'id'),
      hosting: 'railway',
      sourceUrl: optionalStr(service, 'source_code_url'),
    };
  });

const fromAuthRelay = (inventory: unknown): readonly IndexedHost[] => {
  if (!isRecord(inventory) || !isRecord(inventory['auth_relay'])) return [];
  return rows(inventory['auth_relay'], 'instances').flatMap((instance) => {
    const service = at(instance, 'service');
    const id = str(service, 'id');
    const sourceUrl = optionalStr(service, 'source_code_url');
    const host = (hostname: string, suffix: string): IndexedHost => ({
      hostname,
      url: rootUrl(hostname),
      id: `${id}${suffix}`,
      hosting: 'railway',
      sourceUrl,
    });
    return [
      host(str(instance, 'hostname'), ''),
      host(str(instance, 'admin_hostname'), ' admin'),
    ];
  });
};

const hostingOfRecord = (target: string, zone: string): Hosting => {
  if (target.endsWith('.cfargotunnel.com')) return 'tunnel';
  if (target === `origin.${zone}`) return 'origin';
  return 'dns';
};

const fromDns = (inventory: unknown, zone: string): readonly IndexedHost[] => {
  const records = rows(at(at(inventory, 'cloudflare'), 'dns'), 'records');
  const mailDomains = records
    .filter((record) => str(record, 'type') === 'MX')
    .map((record) => str(record, 'name'));
  const isMail = (name: string): boolean =>
    mailDomains.some((mail) => name === mail || name.endsWith(`.${mail}`));
  return records
    .filter((record) => WEB_RECORD_TYPES.has(str(record, 'type')))
    .map((record) => ({
      name: str(record, 'name'),
      target: str(record, 'content'),
    }))
    .filter(({ name }) => !name.startsWith('_') && !isMail(name))
    .map(({ name, target }) => ({
      hostname: name,
      url: rootUrl(name),
      id: name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name,
      hosting: hostingOfRecord(target, zone),
      sourceUrl: null,
    }));
};

const fromDomains = (
  inventory: unknown,
  zone: string
): readonly IndexedHost[] => {
  const domains = at(inventory, 'domains');
  if (!isRecord(domains)) throw new Error('inventory: `domains` is not a map');
  return Object.entries(domains)
    .filter(([domain]) => domain !== zone)
    .flatMap(([domain, config]) => {
      const first = rows(config, 'https')[0];
      if (first === undefined) return [];
      return [
        {
          hostname: domain,
          url: str(first, 'url'),
          id: domain,
          hosting: 'domain' as const,
          sourceUrl: null,
        },
      ];
    });
};

const fromPostgres = (inventory: unknown): readonly IndexedResource[] =>
  rows(at(inventory, 'postgres'), 'projects').map((project) => {
    const id = str(project, 'id');
    const organization = str(project, 'organization');
    const name = str(project, 'name');
    return {
      key: `postgres:${id}`,
      kind: 'postgres',
      id,
      name: `${organization}/${name} · ${str(project, 'branch')}`,
      provider: 'PlanetScale',
      consoleUrl: `https://app.planetscale.com/${organization}/${name}`,
    };
  });

const PROVIDER_LABEL: Readonly<Record<string, string>> = {
  r2: 'Cloudflare R2',
};

const fromObjectStores = (inventory: unknown): readonly IndexedResource[] =>
  rows(inventory, 'object_stores').map((store) => {
    const bucket = str(store, 'bucket');
    const provider = str(store, 'provider');
    return {
      key: `blob:${str(store, 'id')}`,
      kind: 'blob',
      id: str(store, 'id'),
      name: bucket,
      provider: PROVIDER_LABEL[provider] ?? provider,
      consoleUrl:
        provider === 'r2'
          ? `https://dash.cloudflare.com/?to=/:account/r2/default/buckets/${bucket}`
          : `https://${bucket}`,
    };
  });

/** Parses `locals.inventory`; throws when a shape it relies on is gone. */
export const parseInventory = (json: unknown): ServiceIndexSnapshot => {
  const inventory = at(at(json, 'locals'), 'inventory');
  const zone = str(inventory, 'zone');
  const inZone = (hostname: string): boolean =>
    hostname === zone || hostname.endsWith(`.${zone}`);
  const seen = new Set<string>();
  const unique = (host: IndexedHost): boolean => {
    if (seen.has(host.hostname)) return false;
    seen.add(host.hostname);
    return true;
  };
  const inZoneHosts = [
    ...fromServices(inventory),
    ...fromAuthRelay(inventory),
    ...fromDns(inventory, zone),
  ].filter((host) => inZone(host.hostname));
  return {
    version: SERVICE_INDEX_VERSION,
    zone,
    hosts: [...inZoneHosts, ...fromDomains(inventory, zone)].filter(unique),
    resources: [...fromPostgres(inventory), ...fromObjectStores(inventory)],
  };
};

const INVENTORY = 'packages/infra/tofu/modules/inventory/inventory.tf.json';

/** From the monorepo root. */
export const computeServiceIndex = (root: string): ServiceIndexSnapshot =>
  parseInventory(JSON.parse(readFileSync(join(root, INVENTORY), 'utf8')));
