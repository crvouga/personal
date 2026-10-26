#!/usr/bin/env bun
/**
 * HTTP health-check every public URL referenced by portfolio content.
 *
 * Usage:
 *   bun run scripts/health-check-urls.ts
 *   bun run scripts/health-check-urls.ts --timeout-ms 30000 --retries 4
 */
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT } from '../src/content/content';
import { AGENTIC_LINKS } from '../src/content/agentic';
import { CASE_STUDIES } from '../src/content/case-studies';
import { ARCHIVE_PROJECTS, PROJECTS } from '../src/content/project';
import { WORK } from '../src/content/work';
import { writeLine } from '../src/library/cli-output';

type UrlCheckResult = {
  url: string;
  status: number;
  ok: boolean;
  error?: string;
  duration: number;
  attempts: number;
};

type CheckOptions = {
  readonly timeoutMs: number;
  readonly retries: number;
  readonly retryDelayMs: number;
};

type Args = {
  readonly timeoutMs: number;
  readonly retries: number;
  readonly retryDelayMs: number;
};

function parseArgs(argv: readonly string[]): Args {
  let timeoutMs = 20_000;
  let retries = 2;
  let retryDelayMs = 5_000;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--timeout-ms') timeoutMs = Number(argv[++i] ?? timeoutMs);
    else if (arg === '--retries') retries = Number(argv[++i] ?? retries);
    else if (arg === '--retry-delay-ms')
      retryDelayMs = Number(argv[++i] ?? retryDelayMs);
    else if (arg === '--help' || arg === '-h') {
      writeLine(
        'Usage: bun run scripts/health-check-urls.ts ' +
          '[--timeout-ms <ms>] [--retries <n>] [--retry-delay-ms <ms>]'
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return { timeoutMs, retries, retryDelayMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hosts that answer GitHub-hosted runners with a bot-protection status. */
const BOT_PROTECTED_STATUSES: Record<string, readonly number[]> = {
  'oneorigin.us': [403],
};

function isBotProtected(url: string, status: number): boolean {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return BOT_PROTECTED_STATUSES[host]?.includes(status) ?? false;
}

async function fetchOnce(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number
): Promise<{ status: number; ok: boolean }> {
  const response = await fetch(url, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const isLinkedIn = url.includes('linkedin.com');
  const ok =
    response.ok ||
    (isLinkedIn && (response.status === 999 || response.status === 405)) ||
    isBotProtected(url, response.status);
  return { status: response.status, ok };
}

async function checkUrlOnce(
  url: string,
  opts: CheckOptions
): Promise<UrlCheckResult> {
  const startTime = Date.now();
  const isLinkedIn = url.includes('linkedin.com');

  try {
    try {
      const head = await fetchOnce(url, 'HEAD', opts.timeoutMs);
      if (head.ok) {
        return {
          url,
          status: head.status,
          ok: true,
          duration: Date.now() - startTime,
          attempts: 1,
        };
      }
      if (!isLinkedIn) {
        return {
          url,
          status: head.status,
          ok: false,
          duration: Date.now() - startTime,
          attempts: 1,
        };
      }
    } catch {
      /* try GET below for linkedin edge cases */
    }

    const get = await fetchOnce(url, 'GET', opts.timeoutMs);
    return {
      url,
      status: get.status,
      ok: get.ok,
      duration: Date.now() - startTime,
      attempts: 1,
    };
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
      attempts: 1,
    };
  }
}

async function checkUrlWithRetries(
  url: string,
  args: Args
): Promise<UrlCheckResult> {
  const opts: CheckOptions = {
    timeoutMs: args.timeoutMs,
    retries: args.retries,
    retryDelayMs: args.retryDelayMs,
  };
  const maxAttempts = opts.retries + 1;
  let last: UrlCheckResult = {
    url,
    status: 0,
    ok: false,
    error: 'no attempts',
    duration: 0,
    attempts: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    writeLine(
      `Checking: ${url}...` +
        (attempt > 1 ? ` (retry ${attempt - 1}/${opts.retries})` : '')
    );
    const result = await checkUrlOnce(url, opts);
    last = { ...result, attempts: attempt };

    if (result.ok) {
      writeLine(`  ✓ OK (${result.status}) - ${result.duration}ms`);
      return last;
    }

    const errMsg = result.error ?? `HTTP ${result.status}`;
    writeLine(
      `  ✗ attempt ${attempt}/${maxAttempts}: ${errMsg} - ${result.duration}ms` +
        (attempt < maxAttempts ? ` — waiting ${opts.retryDelayMs}ms` : '')
    );

    if (attempt < maxAttempts) {
      await sleep(opts.retryDelayMs);
    } else {
      last = { ...result, error: errMsg, attempts: attempt };
    }
  }

  return last;
}

const collectContentUrls = (): string[] => {
  const urls: string[] = [];

  if (CONTENT.SITE_URL) urls.push(CONTENT.SITE_URL);
  if (CONTENT.SITE_SOURCE_CODE_URL) urls.push(CONTENT.SITE_SOURCE_CODE_URL);
  if (CONTENT.GITHUB_URL) urls.push(CONTENT.GITHUB_URL);
  if (CONTENT.LINKEDIN_URL) urls.push(CONTENT.LINKEDIN_URL);
  if (CONTENT.X_URL) urls.push(CONTENT.X_URL);

  return urls;
};

const collectProjectUrls = (): string[] => {
  const urls: string[] = [];

  for (const project of [...PROJECTS, ...ARCHIVE_PROJECTS]) {
    if (project.deployment?.t === 'public' && project.deployment.url) {
      urls.push(project.deployment.url);
    }
    if (project.code?.t === 'public' && project.code.url) {
      urls.push(project.code.url);
    }
  }

  return urls;
};

const collectWorkUrls = (): string[] => {
  const urls: string[] = [];

  for (const work of WORK) {
    if (work.infoUrl) {
      urls.push(work.infoUrl);
    }
    // Each senior-role bullet links its artifact; a dead one is evidence lost.
    for (const highlight of work.highlights) {
      for (const match of highlight.matchAll(/href="(https?:[^"]+)"/g)) {
        if (match[1] !== undefined) urls.push(match[1]);
      }
    }
  }

  return urls;
};

/** The receipts under "How I build" and every case study's links. */
const collectEvidenceUrls = (): string[] => [
  ...AGENTIC_LINKS,
  ...CASE_STUDIES.flatMap((study) => study.links.map((link) => link.href)),
];

const extractUrls = (): string[] => {
  const urls = new Set([
    ...collectContentUrls(),
    ...collectProjectUrls(),
    ...collectWorkUrls(),
    ...collectEvidenceUrls(),
  ]);

  return Array.from(urls).sort();
};

const SERVICES_YAML = path.resolve(
  import.meta.dir,
  '../../infra/tofu/modules/inventory/inventory.tf.json'
);

/** Hostnames the fleet declares in `packages/infra/tofu/modules/inventory/inventory.tf.json`. */
async function readFleetHostnames(): Promise<ReadonlySet<string>> {
  const doc = JSON.parse(await readFile(SERVICES_YAML, 'utf8')).locals
    .inventory as {
    services?: readonly { hostname?: string }[];
  };
  const hostnames = (doc.services ?? []).flatMap((s) =>
    s.hostname ? [s.hostname.toLowerCase()] : []
  );
  return new Set(hostnames);
}

async function resolves(hostname: string): Promise<boolean> {
  try {
    await lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

/**
 * A service added in the same PR as its portfolio entry is declared in
 * tofu/modules/inventory/inventory.tf.json but has no DNS record until the post-merge deploy provisions
 * it, so its URL cannot pass yet. Skip exactly those (declared + no DNS
 * record); a provisioned service that is down still resolves and still fails.
 */
async function splitPendingUrls(
  urls: readonly string[]
): Promise<{ readonly live: string[]; readonly pending: string[] }> {
  const fleet = await readFleetHostnames();
  const pendingFlags = await Promise.all(
    urls.map(async (url) => {
      const host = new URL(url).hostname.toLowerCase();
      return fleet.has(host) && !(await resolves(host));
    })
  );
  return {
    live: urls.filter((_, i) => !pendingFlags[i]),
    pending: urls.filter((_, i) => pendingFlags[i]),
  };
}

type FailedUrl = { url: string; error: string; attempts: number };

type CheckRun = {
  readonly results: UrlCheckResult[];
  readonly totalDuration: number;
};

async function runChecks(
  urls: readonly string[],
  args: Args
): Promise<CheckRun> {
  writeLine(`\n🔍 Health Check: ${urls.length} URL(s)\n`);
  writeLine(
    `   timeout=${args.timeoutMs}ms, retries=${args.retries}, delay=${args.retryDelayMs}ms\n`
  );
  writeLine('='.repeat(60));

  const startTime = Date.now();
  const results = await Promise.all(
    urls.map((url) => checkUrlWithRetries(url, args))
  );
  const totalDuration = Date.now() - startTime;

  writeLine('='.repeat(60));
  writeLine('\n📊 Summary:\n');
  return { results, totalDuration };
}

function summarize(
  results: readonly UrlCheckResult[],
  totalDuration: number
): FailedUrl[] {
  const failedUrls: FailedUrl[] = [];

  for (const result of results) {
    if (!result.ok) {
      failedUrls.push({
        url: result.url,
        error: result.error || `HTTP ${result.status}`,
        attempts: result.attempts,
      });
    }
  }

  const avgDuration =
    results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const maxDuration = Math.max(...results.map((r) => r.duration));
  const minDuration = Math.min(...results.map((r) => r.duration));

  writeLine(`Total URLs checked: ${results.length}`);
  writeLine(`Successful: ${results.length - failedUrls.length}`);
  writeLine(`Failed: ${failedUrls.length}`);
  writeLine(`Total time: ${totalDuration}ms`);
  writeLine(`Average response time: ${Math.round(avgDuration)}ms`);
  writeLine(`Fastest: ${minDuration}ms`);
  writeLine(`Slowest: ${maxDuration}ms`);
  return failedUrls;
}

function reportFailures(failedUrls: readonly FailedUrl[]): void {
  writeLine('\n❌ Failed URLs:\n');
  for (const failedUrl of failedUrls) {
    writeLine(`  • ${failedUrl.url}`);
    writeLine(
      `    Error: ${failedUrl.error} (${failedUrl.attempts} attempt(s))`
    );
  }
  console.error(
    `\n❌ Health check failed: ${failedUrls.length} URL(s) are not accessible`
  );
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const { live: urls, pending } = await splitPendingUrls(extractUrls());
  for (const url of pending) {
    writeLine(
      `⏭  Skipping ${url}: declared in tofu/modules/inventory/inventory.tf.json, not provisioned yet (no DNS record)`
    );
  }
  const { results, totalDuration } = await runChecks(urls, args);
  const failedUrls = summarize(results, totalDuration);

  if (failedUrls.length === 0) {
    writeLine('\n✅ All URLs are healthy!');
    return;
  }

  reportFailures(failedUrls);
  process.exit(1);
};

main().catch((error: unknown) => {
  console.error('Health check failed:', error);
  process.exit(1);
});
