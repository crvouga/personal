import { test, expect } from 'bun:test';
import { exec } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { setTimeout } from 'timers/promises';
import { collectInlineSources, cspHash } from '../scripts/csp';
import { writeLine } from '../src/library/cli-output';

const execAsync = promisify(exec);

const PACKAGE_DIR = join(import.meta.dir, '..');
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');

const IMAGE_NAME = 'portfolio-app-test';
const SECRET_ENV = 'PORTFOLIO_GITHUB_TOKEN';
const CONTAINER_NAME = 'portfolio-app-test-container';
const PORT = 8080;
const TEST_URL = `http://localhost:${PORT}`;
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;

async function runCommand(
  command: string,
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(command, {
      encoding: 'utf8',
      ...(cwd ? { cwd } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message +
          (error && typeof error === 'object' && 'stderr' in error
            ? `\nstderr: ${String(error.stderr)}`
            : '') +
          (error && typeof error === 'object' && 'stdout' in error
            ? `\nstdout: ${String(error.stdout)}`
            : '')
        : String(error);
    throw new Error(`Command failed: ${command}\n${message}`);
  }
}

async function waitForContainer(): Promise<void> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(TEST_URL, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Container not ready yet, continue retrying
    }
    await setTimeout(RETRY_DELAY_MS);
  }
  throw new Error(
    `Container did not become ready after ${MAX_RETRIES * RETRY_DELAY_MS}ms`
  );
}

async function printDockerLogs(): Promise<void> {
  try {
    const { stdout } = await runCommand(
      `docker logs ${CONTAINER_NAME} 2>&1 || true`
    );
    if (stdout && stdout.trim()) {
      writeLine(`Docker logs for ${CONTAINER_NAME}:\n${stdout}`);
    } else {
      writeLine(`(No logs found for container ${CONTAINER_NAME})`);
    }
  } catch {
    writeLine(`Unable to retrieve Docker logs for ${CONTAINER_NAME}`);
  }
}

async function cleanup(): Promise<void> {
  try {
    await runCommand(`docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`);
    await runCommand(`docker rmi ${IMAGE_NAME} 2>/dev/null || true`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Cleanup error (non-fatal):', message);
  }
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=63072000',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
];

/** Every response, including assets, the PDF and 404s, carries the full set. */
function expectSecurityHeaders(response: Response, label: string): string {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect({ label, name, value: response.headers.get(name) }).toEqual({
      label,
      name,
      value,
    });
  }
  expect(response.headers.get('x-xss-protection')).toBeNull();
  const csp = response.headers.get('content-security-policy') ?? '';
  const directives = csp.split(';').map((d) => d.trim());
  for (const directive of CSP_DIRECTIVES) {
    expect({ label, directives }).toEqual({
      label,
      directives: expect.arrayContaining([directive]),
    });
  }
  expect(csp).toMatch(/script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+;/);
  expect(csp).not.toContain('unsafe-eval');
  return csp;
}

/** The build-time hashes must cover every inline script/style nginx serves. */
function expectCspCoversPage(csp: string, html: string, label: string): void {
  const sources = collectInlineSources(html, label);
  expect(sources.scripts.length).toBeGreaterThan(0);
  const sourceList = sources.styleAttributes
    ? sources.scripts
    : [...sources.scripts, ...sources.styles];
  for (const hash of sourceList.map(cspHash)) {
    expect({ label, covered: csp.includes(hash) }).toEqual({
      label,
      covered: true,
    });
  }
}

async function checkSecurityHeaders(): Promise<void> {
  for (const route of ['/', '/projects/']) {
    const page = await fetch(`${TEST_URL}${route}`);
    expect(page.status).toBe(200);
    const csp = expectSecurityHeaders(page, route);
    expectCspCoversPage(csp, await page.text(), route);
  }

  const pdf = await fetch(`${TEST_URL}/chris-vouga-resume.pdf`);
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get('cache-control')).toBe('no-cache');
  expectSecurityHeaders(pdf, 'resume pdf');

  // Stable names may change, so they revalidate daily; only content-hashed
  // bundles are immutable.
  for (const asset of [
    '/fonts/inter-variable.woff2',
    '/og.png',
    '/favicon.svg',
  ]) {
    const response = await fetch(`${TEST_URL}${asset}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=86400, must-revalidate'
    );
    expectSecurityHeaders(response, asset);
  }
  const html = await (await fetch(`${TEST_URL}/`)).text();
  const bundle = /\/_astro\/[^"']+\.(css|js)/.exec(html)?.[0];
  if (bundle !== undefined) {
    const hashed = await fetch(`${TEST_URL}${bundle}`);
    expect(hashed.headers.get('cache-control')).toBe(
      'public, immutable, max-age=31536000'
    );
    expectSecurityHeaders(hashed, bundle);
  }

  // Both the page and the static-asset location fall through to 404.html.
  for (const missing of ['/definitely-not-a-page', '/missing-asset.png']) {
    const response = await fetch(`${TEST_URL}${missing}`);
    expect(response.status).toBe(404);
    expectSecurityHeaders(response, missing);
  }
}

async function expectContentType(route: string, type: string): Promise<void> {
  const response = await fetch(`${TEST_URL}${route}`);
  expect({ route, status: response.status }).toEqual({ route, status: 200 });
  expect({ route, type: response.headers.get('content-type') }).toEqual({
    route,
    type,
  });
  expectSecurityHeaders(response, route);
}

async function checkStaticFiles(): Promise<void> {
  await expectContentType(
    '/.well-known/security.txt',
    'text/plain; charset=utf-8'
  );
  await expectContentType('/humans.txt', 'text/plain; charset=utf-8');
  await expectContentType('/llms.txt', 'text/plain; charset=utf-8');
  await expectContentType(
    '/manifest.webmanifest',
    'application/manifest+json; charset=utf-8'
  );
  await expectContentType('/favicon.svg', 'image/svg+xml');
}

async function checkCompression(): Promise<void> {
  for (const route of ['/', '/projects/', '/llms.txt']) {
    const gzipped = await fetch(`${TEST_URL}${route}`, {
      headers: { 'accept-encoding': 'gzip' },
      decompress: false,
    });
    expect({
      route,
      encoding: gzipped.headers.get('content-encoding'),
    }).toEqual({ route, encoding: 'gzip' });
    expect(gzipped.headers.get('vary')).toContain('Accept-Encoding');
  }
  const plain = await fetch(TEST_URL, {
    headers: { 'accept-encoding': 'identity' },
    decompress: false,
  });
  expect(plain.headers.get('content-encoding')).toBeNull();
  expect((await plain.text()).includes('<html')).toBe(true);
}

test('Docker container serves the multi-route site on port 80', async () => {
  try {
    writeLine('Cleaning up any existing containers/images...');
    await cleanup();
    if (!process.env[SECRET_ENV]) {
      throw new Error(
        `${SECRET_ENV} is required to build the image. Run: vault run --config dev -- bun run --filter @pkgs/portfolio test:docker`
      );
    }

    writeLine('Building Docker image...');
    // Docker resolves `-f` relative to the cwd, so the build must run from the
    // repo root with `.` as the context. The Dockerfile requires the GitHub
    // token as a BuildKit secret (see packages/portfolio/Dockerfile).
    await runCommand(
      `docker build -f packages/portfolio/Dockerfile --secret id=github_token,env=${SECRET_ENV} -t ${IMAGE_NAME} .`,
      REPO_ROOT
    );
    writeLine('Starting container...');
    await runCommand(
      `docker run -d --name ${CONTAINER_NAME} -p ${PORT}:80 ${IMAGE_NAME}`
    );

    writeLine('Waiting for container to be ready...');
    await waitForContainer();

    writeLine('Making HTTP request to test server...');
    const response = await fetch(TEST_URL);

    expect(response.status).toBe(200);

    const contentType = response.headers.get('content-type') || '';
    expect(
      contentType.includes('html') || contentType.includes('text/html')
    ).toBe(true);

    const body = await response.text();
    expect(body.includes('<!DOCTYPE html') || body.includes('<html')).toBe(
      true
    );
    expect(body.includes('id="proof"')).toBe(true);
    expect(body.includes('aria-label="Last 12 months:')).toBe(true);
    // The heatmap draws one path per shade (ContributionHeatmap.astro), so
    // the grid is present when a shaded path is.
    expect(/<path[^>]*class="c[0-4]"/.test(body)).toBe(true);
    expect(body.includes('id="agentic"')).toBe(true);

    // The site is multi-route now, so nginx must NOT fall back to the
    // homepage. An unknown path has to be a real 404 serving 404.html.
    writeLine('Checking that an unknown path 404s...');
    const missing = await fetch(`${TEST_URL}/definitely-not-a-page`);
    expect(missing.status).toBe(404);
    const missingBody = await missing.text();
    expect(missingBody.includes('That page does not exist.')).toBe(true);

    // Behind the TLS edge an absolute http:// redirect would downgrade the
    // visitor, so the trailing-slash redirect must be relative.
    const bare = await fetch(`${TEST_URL}/projects`, { redirect: 'manual' });
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/projects/');

    // The retired hand-written sitemap must be gone, not silently served.
    const oldSitemap = await fetch(`${TEST_URL}/sitemap.xml`);
    expect(oldSitemap.status).toBe(404);

    writeLine('Checking the generated routes...');
    const archive = await fetch(`${TEST_URL}/projects/`);
    expect(archive.status).toBe(200);
    expect((await archive.text()).includes('All projects')).toBe(true);

    const sitemap = await fetch(`${TEST_URL}/sitemap-index.xml`);
    expect(sitemap.status).toBe(200);
    expect((await sitemap.text()).includes('sitemap-0.xml')).toBe(true);

    const llms = await fetch(`${TEST_URL}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(
      (llms.headers.get('content-type') || '').includes('text/plain')
    ).toBe(true);
    // /llms.txt is candidate information for recruiters' screening agents;
    // the infrastructure guide moved to /llms-infra.txt and is linked from it.
    const llmsBody = await llms.text();
    expect(llmsBody.startsWith('# Chris Vouga')).toBe(true);
    expect(llmsBody.includes('/llms-infra.txt')).toBe(true);

    const infra = await fetch(`${TEST_URL}/llms-infra.txt`);
    expect(infra.status).toBe(200);
    const infraBody = await infra.text();
    expect(infraBody.includes('shared infrastructure integration guide')).toBe(
      true
    );
    expect(infraBody.includes('## 2. PostgreSQL')).toBe(true);

    const resumeJson = await fetch(`${TEST_URL}/resume.json`);
    expect(resumeJson.status).toBe(200);
    expect(
      (resumeJson.headers.get('content-type') || '').includes('json')
    ).toBe(true);

    for (const study of [
      '/projects/mockingbird/',
      '/projects/workspace-platform/',
    ]) {
      expect((await fetch(`${TEST_URL}${study}`)).status).toBe(200);
    }

    writeLine('Checking security headers, static files and compression...');
    await checkSecurityHeaders();
    await checkStaticFiles();
    await checkCompression();

    writeLine(
      '✓ Test passed: routes, 404 handling, sitemap, headers and gzip all correct'
    );
  } catch (error) {
    await printDockerLogs();
    throw error;
  } finally {
    writeLine('Cleaning up...');
    await cleanup();
  }
}, 300_000); // cold image build + container start exceed bun's 5s default
