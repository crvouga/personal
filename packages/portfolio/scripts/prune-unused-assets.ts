#!/usr/bin/env bun
/**
 * Keep `public/` and `assets/` honest.
 *
 * `public/` is what the site serves; `assets/` holds the raster sources that
 * `bun run assets:optimize` turns into `public/**\/*.optimized.webp`. This
 * script derives the reference set from the content registry plus the literal
 * paths in `.astro`/`.css`, then classifies every file:
 *
 *   keep   — referenced by content or markup
 *   move   — a raster source whose derivative is served: `git mv` to `assets/`
 *   delete — nothing references it and nothing derives from it
 *
 * Usage:
 *   bun run assets:prune            # dry run, prints the classification
 *   bun run assets:prune -- --apply # perform moves and deletions
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { writeLine } from '../src/library/cli-output';
import { CONTENT } from '../src/content/content';
import { TOPIC_TO_IMAGE_SRC } from '../src/content/topic';
import { HOMEPAGE_SCREENSHOT_PATH } from '../src/lib/seo';

const execFileAsync = promisify(execFile);

const PACKAGE_DIR = path.resolve('.');
const PUBLIC_DIR = path.join(PACKAGE_DIR, 'public');
const ASSETS_DIR = path.join(PACKAGE_DIR, 'assets');
const SOURCE_DIR = path.join(PACKAGE_DIR, 'src');

const RASTER_EXTENSION_BY_EXT: Record<string, true> = {
  '.png': true,
  '.jpg': true,
  '.jpeg': true,
  '.heic': true,
};

const ASSET_EXTENSION_PATTERN =
  'png|jpg|jpeg|webp|svg|gif|ico|pdf|heic|woff2|woff|ttf|otf|eot|txt|xml';

/** Delimiters that can precede/follow an asset path in markup or a template. */
const PATH_DELIMITER = '["\'(`}]';

/** Root-relative asset paths in Astro markup, CSS, and interpolated literals. */
const ASSET_PATH_IN_TEXT = new RegExp(
  `${PATH_DELIMITER}(\\.?/[A-Za-z0-9_./\\-&%()+ ]+\\.(?:${ASSET_EXTENSION_PATTERN}))${PATH_DELIMITER}`,
  'g'
);

/**
 * Never pruned: robots.txt is a protocol file, not referenced by markup. The
 * sitemap is no longer here — `@astrojs/sitemap` generates it into `dist/`.
 */
/** Served by convention or linked from <head>, not from content. */
const ALWAYS_KEEP: readonly string[] = [
  '/robots.txt',
  '/favicon.ico',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/humans.txt',
  '/.well-known/security.txt',
  '/llms-infra.txt',
];

const DERIVATIVE_SUFFIX = '.optimized.webp';
const MAX_LISTED = 200;

type Classification = {
  readonly keep: string[];
  readonly move: string[];
  readonly remove: string[];
  readonly orphanSources: string[];
};

const isRaster = (filePath: string): boolean =>
  RASTER_EXTENSION_BY_EXT[path.extname(filePath).toLowerCase()] === true;

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walkFiles(entryPath)));
    else if (entry.isFile()) found.push(entryPath);
  }
  return found.sort();
}

/** Normalizes `/x.png`, `./x.png` → `/x.png`; returns null for non-local URLs. */
function toPublicPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.startsWith('data:')) return null;
  if (/^(?:https?:)?\/\//.test(trimmed)) return null;
  const withoutDot = trimmed.startsWith('./') ? trimmed.slice(1) : trimmed;
  return withoutDot.startsWith('/') ? withoutDot : null;
}

/** Typed content paths: project/work/school media and topic icons. */
function typedReferences(): string[] {
  return [
    ...CONTENT.PROJECTS.flatMap((p) => [...p.imageSrc, ...p.galleryImageSrc]),
    // Folded behind "everything else" on /projects/, but still rendered.
    ...CONTENT.ARCHIVE_PROJECTS.flatMap((p) => [
      ...p.imageSrc,
      ...p.galleryImageSrc,
    ]),
    ...CONTENT.WORK.flatMap((w) => [...w.imageSrc, ...w.galleryImageSrc]),
    ...CONTENT.SCHOOL.flatMap((s) => [s.imageSrc, ...s.galleryImageSrc]),
    ...Object.values(TOPIC_TO_IMAGE_SRC).filter(
      (value): value is string => typeof value === 'string'
    ),
    HOMEPAGE_SCREENSHOT_PATH,
  ];
}

/** Literal paths in Astro markup and CSS only (never `.ts` comments). */
async function markupReferences(): Promise<string[]> {
  const files = (await walkFiles(SOURCE_DIR)).filter(
    (file) => file.endsWith('.astro') || file.endsWith('.css')
  );
  const found: string[] = [];
  for (const file of files) {
    const text = await Bun.file(file).text();
    for (const match of text.matchAll(ASSET_PATH_IN_TEXT)) {
      if (match[1] !== undefined) found.push(match[1]);
    }
  }
  return found;
}

async function referencedPaths(): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const raw of [...typedReferences(), ...(await markupReferences())]) {
    const publicPath = toPublicPath(raw);
    if (publicPath !== null) referenced.add(publicPath);
  }
  for (const always of ALWAYS_KEEP) referenced.add(always);
  return referenced;
}

const relativePath = (filePath: string, root: string): string =>
  `/${path.relative(root, filePath).split(path.sep).join('/')}`;

const derivativeOf = (publicPath: string): string =>
  `${publicPath.slice(0, publicPath.lastIndexOf('.'))}${DERIVATIVE_SUFFIX}`;

async function classifyPublicFiles(referenced: ReadonlySet<string>): Promise<{
  readonly keep: string[];
  readonly move: string[];
  readonly remove: string[];
}> {
  const keep: string[] = [];
  const move: string[] = [];
  const remove: string[] = [];
  for (const file of await walkFiles(PUBLIC_DIR)) {
    const publicPath = relativePath(file, PUBLIC_DIR);
    if (referenced.has(publicPath)) keep.push(publicPath);
    else if (isRaster(file) && referenced.has(derivativeOf(publicPath))) {
      move.push(publicPath);
    } else remove.push(publicPath);
  }
  return { keep, move, remove };
}

async function classify(): Promise<Classification> {
  const referenced = await referencedPaths();
  const { keep, move, remove } = await classifyPublicFiles(referenced);
  const orphanSources = await findOrphanSources(referenced);
  return { keep, move, remove, orphanSources };
}

async function findOrphanSources(
  referenced: ReadonlySet<string>
): Promise<string[]> {
  const orphans: string[] = [];
  for (const file of await walkFiles(ASSETS_DIR)) {
    if (!isRaster(file)) continue;
    const assetPath = relativePath(file, ASSETS_DIR);
    if (!referenced.has(derivativeOf(assetPath))) orphans.push(assetPath);
  }
  return orphans;
}

function printList(label: string, entries: readonly string[]): void {
  writeLine(`\n${label} (${entries.length})`);
  const shown = entries.slice(0, MAX_LISTED);
  for (const entry of shown) writeLine(`  ${entry}`);
  if (entries.length > shown.length) {
    writeLine(`  … ${entries.length - shown.length} more`);
  }
}

async function moveToAssets(publicPath: string): Promise<void> {
  const from = path.join(PUBLIC_DIR, publicPath);
  const to = path.join(ASSETS_DIR, publicPath);
  await mkdir(path.dirname(to), { recursive: true });
  await execFileAsync('git', ['mv', '--', from, to]);
}

/** Prefers `git rm` so the index stays clean; falls back to a plain unlink. */
async function removeTrackedFile(target: string): Promise<void> {
  try {
    await execFileAsync('git', ['rm', '-f', '--quiet', '--', target]);
  } catch {
    await rm(target, { force: true });
  }
}

async function applyChanges(classification: Classification): Promise<void> {
  for (const publicPath of classification.move) await moveToAssets(publicPath);
  for (const publicPath of classification.remove) {
    await removeTrackedFile(path.join(PUBLIC_DIR, publicPath));
  }
  for (const assetPath of classification.orphanSources) {
    await removeTrackedFile(path.join(ASSETS_DIR, assetPath));
  }
  const deleted =
    classification.remove.length + classification.orphanSources.length;
  writeLine(
    `\nMoved ${classification.move.length} file(s); deleted ${deleted} file(s).`
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const classification = await classify();

  writeLine(
    `Asset classification (${apply ? 'APPLY' : 'dry run'}) — public: ${PUBLIC_DIR}`
  );
  printList('keep', classification.keep);
  printList('move → assets/', classification.move);
  printList('delete', classification.remove);
  printList('delete orphan sources in assets/', classification.orphanSources);

  if (!apply) {
    writeLine('\nRe-run with --apply to perform these changes.');
    return;
  }
  await applyChanges(classification);
}

if (import.meta.main) {
  await main();
}
