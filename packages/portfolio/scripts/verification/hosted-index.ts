/**
 * Computes the {@link HostedIndex} from the OpenTofu inventory. Shared by the
 * CLI (`scripts/hosted-index.ts`) and the drift test, so both run the same code.
 *
 * Hosts come from three places in `locals.inventory`: hosted `services`, the
 * `auth_relay` instances, and web records in `cloudflare.dns.records` (A, AAAA
 * and CNAME, minus `_` verification records and anything at or under a mail
 * domain, i.e. a name with an MX record).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOSTED_INDEX_VERSION,
  type HostVia,
  type HostedDomain,
  type HostedHost,
  type HostedIndex,
} from '../../src/lib/hosted-index';

export const HOSTED_INDEX_RELATIVE_PATH = 'src/data/hosted-index.json';

const INVENTORY = 'packages/infra/tofu/modules/inventory/inventory.tf.json';

type Row = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const at = (value: unknown, key: string): unknown => {
  if (!isRecord(value) || !(key in value)) {
    throw new Error(`${INVENTORY}: missing \`${key}\``);
  }
  return value[key];
};

const str = (value: unknown, key: string): string => {
  const found = at(value, key);
  if (typeof found !== 'string' || found === '') {
    throw new Error(`${INVENTORY}: \`${key}\` is not a string`);
  }
  return found;
};

const optionalStr = (value: unknown, key: string): string | null =>
  isRecord(value) && typeof value[key] === 'string' && value[key] !== ''
    ? value[key]
    : null;

const rows = (value: unknown, key: string): readonly unknown[] => {
  const found = at(value, key);
  if (Array.isArray(found)) return found;
  if (isRecord(found)) return Object.values(found);
  throw new Error(`${INVENTORY}: \`${key}\` is not a list or map`);
};

const WEB_RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME']);

const viaOfRecord = (target: string, zone: string): HostVia => {
  if (target.endsWith('.cfargotunnel.com')) return 'tunnel';
  if (target === `origin.${zone}`) return 'origin';
  return 'dns';
};

const fromServices = (inventory: unknown): readonly HostedHost[] =>
  rows(inventory, 'services').map((service) => ({
    hostname: str(service, 'hostname'),
    id: str(service, 'id'),
    via: 'railway',
    sourceUrl: optionalStr(service, 'source_code_url'),
  }));

const fromAuthRelay = (inventory: unknown): readonly HostedHost[] =>
  rows(at(inventory, 'auth_relay'), 'instances').flatMap((instance) => {
    const service = at(instance, 'service');
    const id = str(service, 'id');
    const sourceUrl = optionalStr(service, 'source_code_url');
    return [
      { hostname: str(instance, 'hostname'), id, via: 'railway', sourceUrl },
      {
        hostname: str(instance, 'admin_hostname'),
        id: `${id} admin`,
        via: 'railway',
        sourceUrl,
      },
    ] as const;
  });

const fromDns = (inventory: unknown, zone: string): readonly HostedHost[] => {
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
      id: name.slice(0, -(zone.length + 1)),
      via: viaOfRecord(target, zone),
      sourceUrl: null,
    }));
};

const otherDomains = (
  inventory: unknown,
  zone: string
): readonly HostedDomain[] =>
  Object.entries(at(inventory, 'domains') as Row)
    .filter(([domain]) => domain !== zone)
    .flatMap(([domain, config]) => {
      const first = rows(config, 'https')[0];
      return first === undefined ? [] : [{ domain, url: str(first, 'url') }];
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));

export const computeHostedIndex = (root: string): HostedIndex => {
  const inventory = at(
    at(JSON.parse(readFileSync(join(root, INVENTORY), 'utf8')), 'locals'),
    'inventory'
  );
  const zone = str(inventory, 'zone');
  const inZone = (hostname: string): boolean =>
    hostname === zone || hostname.endsWith(`.${zone}`);
  const seen = new Set<string>();
  const hosts = [
    ...fromServices(inventory),
    ...fromAuthRelay(inventory),
    ...fromDns(inventory, zone),
  ]
    .filter((host) => {
      if (!inZone(host.hostname) || seen.has(host.hostname)) return false;
      seen.add(host.hostname);
      return true;
    })
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
  return {
    version: HOSTED_INDEX_VERSION,
    zone,
    hosts,
    domains: otherDomains(inventory, zone),
  };
};
