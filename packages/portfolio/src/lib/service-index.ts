/**
 * Every web host the platform serves, for `/index/`.
 *
 * The OpenTofu inventory is the source, but the Docker build context holds only
 * `packages/portfolio`, so `scripts/service-index.ts` snapshots the hosts into
 * `src/data/service-index.json`. `src/data/service-index.test.ts` fails when
 * the snapshot drifts from the inventory, or when a host has no catalog entry
 * (`src/content/service-index.ts`). This module only reads the file.
 */

import raw from '../data/service-index.json';

export const SERVICE_INDEX_VERSION = 1;

/** Served by `src/pages/index/index.astro`. */
export const SERVICE_INDEX_PATH = '/index/';

export const HOSTINGS = [
  'railway',
  'tunnel',
  'origin',
  'dns',
  'domain',
] as const;

export type Hosting = (typeof HOSTINGS)[number];

export const HOSTING_LABEL: Readonly<Record<Hosting, string>> = {
  railway: 'Railway',
  tunnel: 'Cloudflare Tunnel',
  origin: 'Origin server',
  dns: 'DNS record',
  domain: 'Own domain',
};

export type IndexedHost = {
  readonly hostname: string;
  /** Where a visitor goes: the host's root, or a domain's declared URL. */
  readonly url: string;
  /** The inventory id of the service or record behind the host. */
  readonly id: string;
  readonly hosting: Hosting;
  readonly sourceUrl: string | null;
};

export type ServiceIndexSnapshot = {
  readonly version: typeof SERVICE_INDEX_VERSION;
  /** The site's own zone, e.g. `chrisvouga.dev`. */
  readonly zone: string;
  readonly hosts: readonly IndexedHost[];
};

const fail = (detail: string): never => {
  throw new Error(
    `src/data/service-index.json is malformed: ${detail}. ` +
      'Regenerate it with `bun run service-index` from packages/portfolio.'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0
    ? value
    : fail(`${key} must be a non-empty string`);
};

const isHosting = (value: unknown): value is Hosting =>
  HOSTINGS.some((hosting) => hosting === value);

const parseHost = (value: unknown): IndexedHost => {
  if (!isRecord(value)) return fail('hosts entries must be objects');
  const hosting = value['hosting'];
  const sourceUrl = value['sourceUrl'];
  if (!isHosting(hosting))
    return fail(`hosting must be one of ${HOSTINGS.join(', ')}`);
  if (sourceUrl !== null && typeof sourceUrl !== 'string') {
    return fail('sourceUrl must be a string or null');
  }
  return {
    hostname: text(value, 'hostname'),
    url: text(value, 'url'),
    id: text(value, 'id'),
    hosting,
    sourceUrl,
  };
};

/** Throws on anything that is not a complete, current-version snapshot. */
export const parseServiceIndex = (value: unknown): ServiceIndexSnapshot => {
  if (!isRecord(value)) return fail('expected an object');
  if (value['version'] !== SERVICE_INDEX_VERSION) {
    return fail(`version must be ${String(SERVICE_INDEX_VERSION)}`);
  }
  const hosts = value['hosts'];
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return fail('hosts must be a non-empty list');
  }
  return {
    version: SERVICE_INDEX_VERSION,
    zone: text(value, 'zone'),
    hosts: hosts.map(parseHost),
  };
};

let cached: ServiceIndexSnapshot | null = null;

/** The committed snapshot, validated once per process. */
export const loadServiceIndex = (): ServiceIndexSnapshot => {
  cached ??= parseServiceIndex(raw);
  return cached;
};
