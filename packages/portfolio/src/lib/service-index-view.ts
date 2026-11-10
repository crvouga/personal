/**
 * The `/index/` page model: one card per host, from the inventory snapshot,
 * the catalog, and a probe of every host taken when the site is built.
 *
 * The site is rebuilt daily, so statuses are at most a day old. A host that is
 * down or parked moves to its own section and is never shown as a working
 * link. When no host answers at all (the build has no network), every card
 * says "not checked" instead of calling the whole platform offline.
 */

import {
  CATALOG,
  CATEGORIES,
  CATEGORY_LABEL,
  type CatalogEntry,
  type Category,
} from '../content/service-index';
import {
  HOSTING_LABEL,
  loadServiceIndex,
  type IndexedHost,
  type ServiceIndexSnapshot,
} from './service-index';
import { mapLimit, probe, type Probe, type Status } from './service-probe';

export type CardStatus = Status | 'unchecked';

export const STATUS_LABEL: Readonly<Record<CardStatus, string>> = {
  live: 'Live',
  gated: 'Sign-in',
  parked: 'Parked',
  down: 'Offline',
  unchecked: 'Not checked',
};

export type ServiceCard = {
  readonly slug: string;
  readonly hostname: string;
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly category: Category;
  readonly categoryLabel: string;
  readonly hostingLabel: string;
  readonly sourceUrl: string | null;
  readonly status: CardStatus;
  readonly statusLabel: string;
  /** Why the card has its status, for its tooltip. */
  readonly detail: string;
  readonly artHref: string;
  /** Lower-case text the search box matches against. */
  readonly search: string;
};

export type CategoryCount = {
  readonly category: Category;
  readonly label: string;
  readonly count: number;
};

export type ServiceIndexView = {
  /** ISO time of the probe; null when hosts were not checked. */
  readonly checkedAt: string | null;
  /** Live, sign-in and unchecked hosts: the links that work. */
  readonly open: readonly ServiceCard[];
  /** Offline and parked hosts. */
  readonly closed: readonly ServiceCard[];
  readonly categories: readonly CategoryCount[];
  readonly counts: Readonly<Record<CardStatus, number>>;
};

/** The hostname itself, which is already unique and file-safe. */
export const slugOf = (hostname: string): string =>
  hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');

export const artHrefOf = (slug: string): string => `/index/art/${slug}.svg`;

/** A host the catalog does not know yet still gets a card. */
export const catalogEntryFor = (host: IndexedHost): CatalogEntry =>
  CATALOG[host.hostname] ?? {
    title: host.hostname,
    category: host.hosting === 'domain' ? 'domain' : 'ops',
    description: null,
  };

/** Framework boilerplate, not a description. */
const GENERIC_DESCRIPTION =
  /web site created using|create-react-app|^vite app$/i;

const FALLBACK: Readonly<Record<CardStatus, string>> = {
  live: 'A live site.',
  gated: 'Asks for sign-in first.',
  parked: 'A placeholder page; nothing has launched here yet.',
  down: 'Not answering right now.',
  unchecked: 'Not checked in this build.',
};

const describe = (
  entry: CatalogEntry,
  status: CardStatus,
  result: Probe | undefined
): string => {
  if (entry.description !== null) return entry.description;
  const page = result?.pageDescription;
  if (page !== null && page !== undefined && !GENERIC_DESCRIPTION.test(page))
    return page;
  const title = result?.pageTitle ?? null;
  if (status === 'live' && title !== null) return title;
  return FALLBACK[status];
};

const cardOf = (host: IndexedHost, result: Probe | undefined): ServiceCard => {
  const entry = catalogEntryFor(host);
  const status: CardStatus = result?.status ?? 'unchecked';
  const slug = slugOf(host.hostname);
  const description = describe(entry, status, result);
  return {
    slug,
    hostname: host.hostname,
    url: host.url,
    title: entry.title,
    description,
    category: entry.category,
    categoryLabel: CATEGORY_LABEL[entry.category],
    hostingLabel: HOSTING_LABEL[host.hosting],
    sourceUrl: host.sourceUrl,
    status,
    statusLabel: STATUS_LABEL[status],
    detail: result?.detail ?? 'not checked in this build',
    artHref: artHrefOf(slug),
    search: [
      entry.title,
      host.hostname,
      description,
      CATEGORY_LABEL[entry.category],
    ]
      .join(' ')
      .toLowerCase(),
  };
};

const order = (a: ServiceCard, b: ServiceCard): number =>
  CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
  a.title.localeCompare(b.title);

const isClosed = (card: ServiceCard): boolean =>
  card.status === 'down' || card.status === 'parked';

/** Pure: the page from a snapshot and whatever probes there are. */
export const buildServiceIndexView = (
  snapshot: ServiceIndexSnapshot,
  probes: ReadonlyMap<string, Probe> | null,
  checkedAt: string | null
): ServiceIndexView => {
  const cards = snapshot.hosts
    .map((host) => cardOf(host, probes?.get(host.hostname)))
    .sort(order);
  const open = cards.filter((card) => !isClosed(card));
  const counts = { live: 0, gated: 0, parked: 0, down: 0, unchecked: 0 };
  for (const card of cards) counts[card.status] += 1;
  return {
    checkedAt: probes === null ? null : checkedAt,
    open,
    closed: cards.filter(isClosed),
    categories: CATEGORIES.map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      count: open.filter((card) => card.category === category).length,
    })).filter((entry) => entry.count > 0),
    counts,
  };
};

const PROBE_CONCURRENCY = 12;
/** A sleeping app can take this long to wake, so "down" gets a second, patient try. */
const RETRY_TIMEOUT_MS = 20_000;

const probeWithRetry = async (url: string): Promise<Probe> => {
  const first = await probe(url);
  return first.status === 'down' ? probe(url, fetch, RETRY_TIMEOUT_MS) : first;
};

/**
 * Probes every host; null when probing is switched off
 * (`PORTFOLIO_SKIP_PROBES=1`) or when nothing answered at all.
 */
export const probeHosts = async (
  snapshot: ServiceIndexSnapshot
): Promise<ReadonlyMap<string, Probe> | null> => {
  if (process.env['PORTFOLIO_SKIP_PROBES'] === '1') return null;
  const results = await mapLimit(snapshot.hosts, PROBE_CONCURRENCY, (host) =>
    probeWithRetry(host.url)
  );
  if (
    results.every(
      (result) => result.httpStatus === null && result.status === 'down'
    )
  ) {
    return null;
  }
  return new Map(
    snapshot.hosts.map((host, index) => [
      host.hostname,
      results[index] as Probe,
    ])
  );
};

let built: Promise<ServiceIndexView> | null = null;

/** Probed once per build, however many pages ask. */
export const loadServiceIndexView = (): Promise<ServiceIndexView> => {
  built ??= (async () => {
    const snapshot = loadServiceIndex();
    const probes = await probeHosts(snapshot);
    return buildServiceIndexView(snapshot, probes, new Date().toISOString());
  })();
  return built;
};
