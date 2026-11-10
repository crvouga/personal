/**
 * Every web host deployed under the site's domain, for the unlisted `/hosted/`
 * page — including the ones the portfolio itself does not show.
 *
 * The OpenTofu inventory is the source, but the Docker build context holds only
 * `packages/portfolio`, so `scripts/hosted-index.ts` snapshots it into
 * `src/data/hosted-index.json` and `src/data/hosted-index.test.ts` fails when
 * the snapshot drifts from the inventory. This module only reads the file.
 */

import raw from '../data/hosted-index.json';
import { ARCHIVE_PROJECT_FACTS } from '../knowledge/projects-archive';
import { PROJECT_FACTS } from '../knowledge/projects';

export const HOSTED_INDEX_VERSION = 1;

/** Served by `src/pages/hosted/index.astro`. */
export const HOSTED_INDEX_PATH = '/hosted/';

/** How a host is reached, read from the inventory. */
export const HOST_VIA = ['railway', 'tunnel', 'origin', 'dns'] as const;

export type HostVia = (typeof HOST_VIA)[number];

export const HOST_VIA_LABEL: Readonly<Record<HostVia, string>> = {
  railway: 'Railway',
  tunnel: 'Cloudflare Tunnel',
  origin: 'Origin server',
  dns: 'DNS record',
};

export type HostedHost = {
  readonly hostname: string;
  /** The inventory id of the service or record behind the host. */
  readonly id: string;
  readonly via: HostVia;
  /** Source code, when the inventory names it. */
  readonly sourceUrl: string | null;
};

export type HostedDomain = {
  readonly domain: string;
  readonly url: string;
};

export type HostedIndex = {
  readonly version: typeof HOSTED_INDEX_VERSION;
  /** The site's own zone, e.g. `chrisvouga.dev`. */
  readonly zone: string;
  readonly hosts: readonly HostedHost[];
  /** Other domains the inventory serves on the web. */
  readonly domains: readonly HostedDomain[];
};

const fail = (detail: string): never => {
  throw new Error(
    `src/data/hosted-index.json is malformed: ${detail}. ` +
      'Regenerate it with `bun run hosted-index` from packages/portfolio.'
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

const isVia = (value: unknown): value is HostVia =>
  HOST_VIA.some((via) => via === value);

const list = (value: unknown, key: string): readonly unknown[] =>
  Array.isArray(value) ? value : fail(`${key} must be a list`);

const parseHost = (value: unknown): HostedHost => {
  if (!isRecord(value)) return fail('hosts entries must be objects');
  const via = value['via'];
  const sourceUrl = value['sourceUrl'];
  if (!isVia(via)) return fail(`via must be one of ${HOST_VIA.join(', ')}`);
  if (sourceUrl !== null && typeof sourceUrl !== 'string') {
    return fail('sourceUrl must be a string or null');
  }
  return {
    hostname: text(value, 'hostname'),
    id: text(value, 'id'),
    via,
    sourceUrl,
  };
};

const parseDomain = (value: unknown): HostedDomain => {
  if (!isRecord(value)) return fail('domains entries must be objects');
  return { domain: text(value, 'domain'), url: text(value, 'url') };
};

/** Throws on anything that is not a complete, current-version index. */
export const parseHostedIndex = (value: unknown): HostedIndex => {
  if (!isRecord(value)) return fail('expected an object');
  if (value['version'] !== HOSTED_INDEX_VERSION) {
    return fail(`version must be ${String(HOSTED_INDEX_VERSION)}`);
  }
  const hosts = list(value['hosts'], 'hosts').map(parseHost);
  if (hosts.length === 0) return fail('hosts must not be empty');
  return {
    version: HOSTED_INDEX_VERSION,
    zone: text(value, 'zone'),
    hosts,
    domains: list(value['domains'], 'domains').map(parseDomain),
  };
};

let cached: HostedIndex | null = null;

/** The committed index, validated once per process. */
export const loadHostedIndex = (): HostedIndex => {
  cached ??= parseHostedIndex(raw);
  return cached;
};

const hostOf = (url: string): string => new URL(url).hostname;

/** Hostnames a project on the portfolio (listed or archived) links to. */
const PORTFOLIO_HOSTS: ReadonlySet<string> = new Set(
  [...PROJECT_FACTS, ...ARCHIVE_PROJECT_FACTS].flatMap((project) =>
    project.deployment.t === 'public' ? [hostOf(project.deployment.url)] : []
  )
);

/** Whether the portfolio already links to this host from a project. */
export const isOnPortfolio = (hostname: string): boolean =>
  PORTFOLIO_HOSTS.has(hostname);
