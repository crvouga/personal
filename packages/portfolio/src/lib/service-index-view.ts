/**
 * The `/index/` page model: every host and store from the inventory snapshot,
 * grouped by the catalog into items (one per app, with its variants as
 * links) and sections (Public Apps, Internal APIs…), with each host's status
 * from a probe taken when the site is built.
 *
 * The site is rebuilt daily, so statuses are at most a day old. A host that is
 * down or parked is never shown as a working link, and an item whose links
 * are all down or parked moves to its own section. When no host answers at
 * all (the build has no network), every host says "not checked" instead of
 * calling the whole platform offline. Stores are not probed; they link to
 * their provider console.
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
  type IndexedResource,
  type ServiceIndexSnapshot,
} from './service-index';
import { mapLimit, probe, type Probe, type Status } from './service-probe';

/** `console`: a store, linked to its provider console and never probed. */
export type CardStatus = Status | 'unchecked' | 'console';

export const STATUS_LABEL: Readonly<Record<CardStatus, string>> = {
  live: 'Live',
  gated: 'Sign-in',
  parked: 'Parked',
  down: 'Offline',
  unchecked: 'Not checked',
  console: 'Console',
};

/** Best first: an item shows the status of its best link. */
const STATUS_RANK: readonly CardStatus[] = [
  'live',
  'gated',
  'console',
  'unchecked',
  'parked',
  'down',
];

export type ServiceVariant = {
  /** The hostname, or the store's key. */
  readonly key: string;
  /** What the link says: the catalog variant, else the address. */
  readonly label: string;
  /** The hostname or store name. */
  readonly address: string;
  readonly url: string;
  readonly status: CardStatus;
  readonly statusLabel: string;
  /** Why it has its status, for its tooltip. */
  readonly detail: string;
  readonly hostingLabel: string;
  readonly sourceUrl: string | null;
  /** False when down or parked: shown, but not as a working link. */
  readonly isLink: boolean;
};

export type ServiceItem = {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: Category;
  readonly categoryLabel: string;
  readonly status: CardStatus;
  readonly statusLabel: string;
  readonly detail: string;
  /** The first working link's url; null when none works. */
  readonly url: string | null;
  /** The first link's address, shown under the title. */
  readonly address: string;
  readonly hostingLabels: readonly string[];
  readonly sourceUrl: string | null;
  readonly variants: readonly ServiceVariant[];
  readonly artHref: string;
  /** Lower-case text the search box matches against. */
  readonly search: string;
};

export type ServiceSection = {
  readonly category: Category;
  readonly label: string;
  readonly items: readonly ServiceItem[];
};

export type ServiceIndexView = {
  /** ISO time of the probe; null when hosts were not checked. */
  readonly checkedAt: string | null;
  /** Items with at least one working link, by category. */
  readonly sections: readonly ServiceSection[];
  /** Items whose every link is offline or parked. */
  readonly closed: readonly ServiceItem[];
  /** Per host or store. */
  readonly counts: Readonly<Record<CardStatus, number>>;
  readonly total: number;
};

/** The key itself, which is already unique; made file-safe. */
export const slugOf = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');

export const artHrefOf = (slug: string): string => `/index/art/${slug}.svg`;

/** A host the catalog does not know yet still gets an item. */
export const catalogEntryFor = (host: IndexedHost): CatalogEntry =>
  CATALOG[host.hostname] ?? {
    title: host.hostname,
    category: host.hosting === 'domain' ? 'domain' : 'internal-api',
    description: null,
    variant: null,
  };

const resourceEntryFor = (resource: IndexedResource): CatalogEntry =>
  CATALOG[resource.key] ?? {
    title: resource.name,
    category: resource.kind,
    description: null,
    variant: null,
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
  console: 'Managed in the provider console.',
};

/** What the probe found on the page, when the catalog has nothing. */
const probedDescription = (
  status: CardStatus,
  result: Probe | undefined
): string | null => {
  const page = result?.pageDescription;
  if (page !== null && page !== undefined && !GENERIC_DESCRIPTION.test(page))
    return page;
  const title = result?.pageTitle ?? null;
  return status === 'live' ? title : null;
};

type Member = {
  readonly entry: CatalogEntry;
  readonly variant: ServiceVariant;
  readonly found: string | null;
};

const isWorking = (status: CardStatus): boolean =>
  status !== 'down' && status !== 'parked';

const hostMember = (host: IndexedHost, result: Probe | undefined): Member => {
  const entry = catalogEntryFor(host);
  const status: CardStatus = result?.status ?? 'unchecked';
  return {
    entry,
    found: probedDescription(status, result),
    variant: {
      key: host.hostname,
      label: entry.variant ?? host.hostname,
      address: host.hostname,
      url: host.url,
      status,
      statusLabel: STATUS_LABEL[status],
      detail: result?.detail ?? 'not checked in this build',
      hostingLabel: HOSTING_LABEL[host.hosting],
      sourceUrl: host.sourceUrl,
      isLink: isWorking(status),
    },
  };
};

const resourceMember = (resource: IndexedResource): Member => {
  const entry = resourceEntryFor(resource);
  return {
    entry,
    found: null,
    variant: {
      key: resource.key,
      label: entry.variant ?? resource.name,
      address: resource.name,
      url: resource.consoleUrl,
      status: 'console',
      statusLabel: STATUS_LABEL.console,
      detail: `${resource.provider} console`,
      hostingLabel: resource.provider,
      sourceUrl: null,
      isLink: true,
    },
  };
};

/** Catalog order, so variants read the way the catalog lists them. */
const catalogIndex = (key: string): number => {
  const index = Object.keys(CATALOG).indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const unique = (values: readonly string[]): readonly string[] => [
  ...new Set(values),
];

const bestOf = (variants: readonly ServiceVariant[]): ServiceVariant | null =>
  [...variants].sort(
    (a, b) => STATUS_RANK.indexOf(a.status) - STATUS_RANK.indexOf(b.status)
  )[0] ?? null;

/** The catalog's words, else what the probe read off the page. */
const describeItem = (members: readonly Member[], status: CardStatus): string =>
  members.find((member) => member.entry.description !== null)?.entry
    .description ??
  members.find((member) => member.found !== null)?.found ??
  FALLBACK[status];

const itemOf = (members: readonly Member[]): ServiceItem => {
  const sorted = [...members].sort(
    (a, b) => catalogIndex(a.variant.key) - catalogIndex(b.variant.key)
  );
  const first = sorted[0];
  if (first === undefined) throw new Error('an item needs a member');
  const variants = sorted.map((member) => member.variant);
  const best = bestOf(variants);
  const status = best?.status ?? 'unchecked';
  const description = describeItem(sorted, status);
  const { title, category } = first.entry;
  const slug = slugOf(first.variant.key);
  return {
    slug,
    title,
    description,
    category,
    categoryLabel: CATEGORY_LABEL[category],
    status,
    statusLabel: STATUS_LABEL[status],
    detail: best?.detail ?? '',
    url: variants.find((variant) => variant.isLink)?.url ?? null,
    address: first.variant.address,
    hostingLabels: unique(variants.map((variant) => variant.hostingLabel)),
    sourceUrl:
      variants.find((variant) => variant.sourceUrl !== null)?.sourceUrl ?? null,
    variants,
    artHref: artHrefOf(slug),
    search: [
      title,
      description,
      CATEGORY_LABEL[category],
      ...variants.flatMap((variant) => [variant.label, variant.address]),
    ]
      .join(' ')
      .toLowerCase(),
  };
};

const order = (a: ServiceItem, b: ServiceItem): number =>
  CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
  a.title.localeCompare(b.title);

/** Pure: the page from a snapshot and whatever probes there are. */
export const buildServiceIndexView = (
  snapshot: ServiceIndexSnapshot,
  probes: ReadonlyMap<string, Probe> | null,
  checkedAt: string | null
): ServiceIndexView => {
  const members = [
    ...snapshot.hosts.map((host) =>
      hostMember(host, probes?.get(host.hostname))
    ),
    ...snapshot.resources.map(resourceMember),
  ];
  const groups = new Map<string, Member[]>();
  for (const member of members) {
    const key = `${member.entry.category}\u0000${member.entry.title}`;
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  const items = [...groups.values()].map(itemOf).sort(order);
  const open = items.filter((item) => isWorking(item.status));
  const counts: Record<CardStatus, number> = {
    live: 0,
    gated: 0,
    parked: 0,
    down: 0,
    unchecked: 0,
    console: 0,
  };
  for (const member of members) counts[member.variant.status] += 1;
  return {
    checkedAt: probes === null ? null : checkedAt,
    sections: CATEGORIES.map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      items: open.filter((item) => item.category === category),
    })).filter((section) => section.items.length > 0),
    closed: items.filter((item) => !isWorking(item.status)),
    counts,
    total: members.length,
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
