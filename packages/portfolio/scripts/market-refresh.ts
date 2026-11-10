#!/usr/bin/env bun
/**
 * Market research: sample current job postings and rewrite the committed
 * landscape, `src/data/market/landscape.json`.
 *
 * Deterministic and model-free: public job-board APIs, regular expressions,
 * arithmetic. Raw postings are cached under `.cache/market/` (git-ignored)
 * for a day, so re-running while tuning the taxonomy costs nothing. A source
 * that fails keeps its cached copy; with no copy it is reported and skipped,
 * and the run fails only when too few postings remain to trust the result.
 *
 * Usage (from packages/portfolio):
 *   bun run market:refresh             # fetch (or reuse today's cache), rewrite
 *   bun run market:refresh --offline   # never touch the network
 *   bun run market:refresh --force     # ignore the cache
 *   bun run market:refresh --max-age-days=7   # no-op while the committed
 *                                             # landscape is newer (CI)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPABLE_SKILLS } from '../src/knowledge/capabilities';
import { writeLine } from '../src/library/cli-output';
import { aggregate } from './market/aggregate';
import { extract } from './market/extract';
import { ATS_SOURCES } from './market/sources/ats';
import { BOARD_SOURCES } from './market/sources/boards';
import { WORKDAY_SOURCE } from './market/sources/workday';
import type { Posting, Source } from './market/types';
import { writeJson } from './verification/write-json';

const SOURCES: readonly Source[] = [
  ...BOARD_SOURCES,
  ...ATS_SOURCES,
  WORKDAY_SOURCE,
];
const CACHE_DIR = resolve(import.meta.dir, '../.cache/market');
const OUTPUT = resolve(import.meta.dir, '../src/data/market/landscape.json');
const DAY_MS = 86_400_000;
const CACHE_TTL_MS = DAY_MS;
/** Below this the per-segment shares are noise, so the old file is kept. */
const MIN_ELIGIBLE = 400;

type Cached = { readonly fetchedAt: number; readonly postings: Posting[] };

const cachePath = (source: Source): string =>
  resolve(CACHE_DIR, `${source.id}.json`);

const readCache = (source: Source): Cached | null =>
  existsSync(cachePath(source))
    ? (JSON.parse(readFileSync(cachePath(source), 'utf8')) as Cached)
    : null;

const flags = new Set(process.argv.slice(2));

const isFresh = (cached: Cached): boolean =>
  !flags.has('--force') &&
  (flags.has('--offline') || Date.now() - cached.fetchedAt < CACHE_TTL_MS);

const load = async (source: Source): Promise<Posting[]> => {
  const cached = readCache(source);
  if (cached !== null && isFresh(cached)) return cached.postings;
  if (flags.has('--offline')) return [];
  try {
    const postings = await source.fetch();
    if (postings.length === 0) throw new Error('no postings returned');
    writeFileSync(
      cachePath(source),
      JSON.stringify({ fetchedAt: Date.now(), postings } satisfies Cached)
    );
    return postings;
  } catch (error) {
    writeLine(`  ! ${source.id}: ${String(error)}; using the cached copy`);
    return cached?.postings ?? [];
  }
};

/** `--max-age-days=N`: the committed landscape is still young enough to keep. */
const stillCurrent = (): boolean => {
  const limit = process.argv
    .find((flag) => flag.startsWith('--max-age-days='))
    ?.split('=')[1];
  if (limit === undefined || !existsSync(OUTPUT)) return false;
  const { generatedAt } = JSON.parse(readFileSync(OUTPUT, 'utf8')) as {
    generatedAt: string;
  };
  return Date.now() - Date.parse(generatedAt) < Number(limit) * DAY_MS;
};

const main = async (): Promise<void> => {
  if (stillCurrent()) {
    writeLine('landscape.json is current; nothing fetched');
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const loaded = await Promise.all(
    SOURCES.map(async (source) => ({ source, postings: await load(source) }))
  );
  const postings = [
    ...new Map(
      loaded.flatMap(({ postings: list }) => list).map((p) => [p.id, p])
    ).values(),
  ];
  const landscape = aggregate({
    postings,
    features: postings.map(extract),
    have: CAPABLE_SKILLS,
    sources: loaded.map(({ source, postings: list }) => ({
      id: source.id,
      postings: list.length,
    })),
    generatedAt: new Date().toISOString().slice(0, 10),
  });
  for (const { id, postings: count } of landscape.sources) {
    writeLine(`  ${id.padEnd(18)} ${String(count).padStart(5)} postings`);
  }
  if (landscape.totals.eligible < MIN_ELIGIBLE) {
    throw new Error(
      `only ${landscape.totals.eligible} eligible postings (need ${MIN_ELIGIBLE}); landscape left untouched`
    );
  }
  const changed = await writeJson(landscape, OUTPUT);
  writeLine(
    `${landscape.totals.eligible} eligible of ${landscape.totals.fetched} postings → ${changed ? 'landscape.json rewritten' : 'landscape.json unchanged'}`
  );
};

await main();
