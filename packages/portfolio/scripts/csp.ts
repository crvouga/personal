#!/usr/bin/env bun
/**
 * Build-time Content-Security-Policy for the nginx image.
 *
 * Every page inlines its CSS and its few `<script is:inline>` blocks, so the
 * policy allows exactly those bytes by sha256 instead of `'unsafe-inline'`.
 * The hashes change whenever a component does, so they are never written by
 * hand: `astro.config.mjs` runs this after `astro build`, it scans
 * `dist/**\/*.html`, and writes an nginx `add_header` snippet *outside* the
 * served root. The Dockerfile copies that snippet next to
 * `nginx/security-headers.conf`, which includes it.
 *
 * The build fails, rather than shipping a page the policy silently breaks, if
 * the markup gains an inline event handler, a `javascript:` URL or a
 * cross-origin `<script src>`.
 *
 * Usage (normally automatic): bun run scripts/csp.ts [distDir] [outFile]
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type InlineSources = {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  /** Any element carries a `style="…"` attribute. */
  readonly styleAttributes: boolean;
};

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const TYPE_ATTR_RE = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SRC_ATTR_RE = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const STYLE_ATTR_RE = /<[a-z][^>]*\sstyle\s*=/i;
const EVENT_HANDLER_RE = /<[a-z][^>]*\son[a-z]+\s*=/i;
const JAVASCRIPT_URL_RE =
  /\s(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i;

// Only these `type`s execute; data blocks such as application/ld+json do not
// and need no hash.
const EXECUTABLE_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
]);

const attribute = (attrs: string, pattern: RegExp): string | null => {
  const match = pattern.exec(attrs);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
};

const isExecutable = (attrs: string): boolean =>
  EXECUTABLE_TYPES.has(
    (attribute(attrs, TYPE_ATTR_RE) ?? '').trim().toLowerCase()
  );

const assertSameOriginSrc = (src: string, file: string): void => {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) {
    throw new Error(
      `${file}: cross-origin <script src="${src}"> is not allowed by script-src 'self'`
    );
  }
};

const inlineScripts = (html: string, file: string): string[] =>
  [...html.matchAll(SCRIPT_RE)].flatMap(([, attrs = '', body = '']) => {
    const src = attribute(attrs, SRC_ATTR_RE);
    if (src !== null) {
      assertSameOriginSrc(src, file);
      return [];
    }
    return isExecutable(attrs) ? [body] : [];
  });

/** Markup with script and style bodies removed, so their text cannot match tag patterns. */
const markupOnly = (html: string): string =>
  html
    .replace(SCRIPT_RE, '<script$1></script>')
    .replace(STYLE_RE, '<style></style>');

const assertNoInlineHandlers = (markup: string, file: string): void => {
  if (EVENT_HANDLER_RE.test(markup)) {
    throw new Error(
      `${file}: inline on* event handlers are blocked by the CSP; use a script`
    );
  }
  if (JAVASCRIPT_URL_RE.test(markup)) {
    throw new Error(`${file}: javascript: URLs are blocked by the CSP`);
  }
};

/** Collect the inline sources of one HTML document. `file` only labels errors. */
export const collectInlineSources = (
  html: string,
  file = '<html>'
): InlineSources => {
  const markup = markupOnly(html);
  assertNoInlineHandlers(markup, file);
  return {
    scripts: inlineScripts(html, file),
    styles: [...html.matchAll(STYLE_RE)].map(([, body = '']) => body),
    styleAttributes: STYLE_ATTR_RE.test(markup),
  };
};

export const cspHash = (source: string): string =>
  `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;

const uniqueHashes = (sources: readonly string[]): string[] =>
  [...new Set(sources.map(cspHash))].sort();

const mergeSources = (all: readonly InlineSources[]): InlineSources => ({
  scripts: all.flatMap((s) => s.scripts),
  styles: all.flatMap((s) => s.styles),
  styleAttributes: all.some((s) => s.styleAttributes),
});

export const buildPolicy = (sources: InlineSources): string => {
  // A style="…" attribute cannot be hash-allowed without 'unsafe-hashes', and
  // browsers ignore 'unsafe-inline' once any hash is listed, so it is
  // 'unsafe-inline' alone. Inline CSS cannot execute script.
  const styleSrc = sources.styleAttributes
    ? ["'unsafe-inline'"]
    : uniqueHashes(sources.styles);
  return [
    "default-src 'self'",
    ["script-src 'self'", ...uniqueHashes(sources.scripts)].join(' '),
    ["style-src 'self'", ...styleSrc].join(' '),
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    // Project galleries open YouTube embeds on demand.
    'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
};

export const nginxSnippet = (sources: InlineSources): string => {
  const why = sources.styleAttributes
    ? '# style-src uses \'unsafe-inline\': the pages contain style="…" attributes, which hashes cannot cover.\n'
    : '';
  return [
    '# Generated by packages/portfolio/scripts/csp.ts from dist/**/*.html. Do not edit.',
    `${why}add_header Content-Security-Policy "${buildPolicy(sources)}" always;`,
    '',
  ].join('\n');
};

const htmlFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
};

/** Scan a built site and write the nginx CSP snippet. Returns the policy. */
export const writeCspSnippet = async (
  distDir: string,
  outFile: string
): Promise<string> => {
  const files = await htmlFiles(distDir);
  if (files.length === 0)
    throw new Error(`csp: no HTML files under ${distDir}`);
  const all = await Promise.all(
    files.map(async (file) =>
      collectInlineSources(
        await readFile(file, 'utf8'),
        path.relative(distDir, file)
      )
    )
  );
  const sources = mergeSources(all);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, nginxSnippet(sources));
  return buildPolicy(sources);
};

if (import.meta.main) {
  const [distDir = 'dist', outFile = '.astro/csp-header.conf'] =
    process.argv.slice(2);
  void writeCspSnippet(distDir, outFile).then((policy) => {
    process.stdout.write(`${policy}\n`);
  });
}
