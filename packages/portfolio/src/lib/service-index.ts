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

export const SERVICE_INDEX_VERSION = 2;

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

/** Stores the inventory declares that have no web host of their own. */
export const RESOURCE_KINDS = ['postgres', 'blob'] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type IndexedResource = {
  /** Unique across the snapshot, and the resource's catalog key, e.g. `postgres:openbao`. */
  readonly key: string;
  readonly kind: ResourceKind;
  /** The inventory id. */
  readonly id: string;
  /** What the provider calls it, e.g. `crvouga/personal` or a bucket name. */
  readonly name: string;
  readonly provider: string;
  /** The provider console page for it. */
  readonly consoleUrl: string;
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
  readonly resources: readonly IndexedResource[];
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

const isResourceKind = (value: unknown): value is ResourceKind =>
  RESOURCE_KINDS.some((kind) => kind === value);

const parseResource = (value: unknown): IndexedResource => {
  if (!isRecord(value)) return fail('resources entries must be objects');
  const kind = value['kind'];
  if (!isResourceKind(kind))
    return fail(`kind must be one of ${RESOURCE_KINDS.join(', ')}`);
  return {
    key: text(value, 'key'),
    kind,
    id: text(value, 'id'),
    name: text(value, 'name'),
    provider: text(value, 'provider'),
    consoleUrl: text(value, 'consoleUrl'),
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
  const resources = value['resources'];
  if (!Array.isArray(resources)) return fail('resources must be a list');
  return {
    version: SERVICE_INDEX_VERSION,
    zone: text(value, 'zone'),
    hosts: hosts.map(parseHost),
    resources: resources.map(parseResource),
  };
};

let cached: ServiceIndexSnapshot | null = null;

/** The committed snapshot, validated once per process. */
export const loadServiceIndex = (): ServiceIndexSnapshot => {
  cached ??= parseServiceIndex(raw);
  return cached;
};
