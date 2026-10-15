/** Read-only account discovery. No owner mutation adapter is enabled here. */
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { privateJson } from './files.js';
import { OWNER_DASHBOARD, ownerBrowserEnvironment } from './owner-browser.js';
import { releaseOwnerBrowser } from './owner-browser-process.js';
import { ownerPageAllowed, ownerReadRequest } from './owner-read-policy.js';

export type OwnerInspection = { readonly status: 'unavailable' | 'observed'; readonly detail: string; readonly evidencePath?: string };

async function snapshot(page: Page) {
  if (!ownerPageAllowed(page.url())) throw new Error('Owner inspection left the allowed Squarespace origins');
  const url = new URL(page.url());
  return { url: `${url.origin}${url.pathname}`, title: await page.title(), text: await page.locator('body').innerText(),
    links: await page.locator('a[href]').evaluateAll((links) => links.map((link) => ({ text: (link.textContent ?? '').trim(), href: (link as HTMLAnchorElement).href }))),
    controls: await page.locator('button, input, [role="switch"], [role="tab"]').evaluateAll((nodes) => nodes.map((node) => ({
      tag: node.tagName, type: node.getAttribute('type'), role: node.getAttribute('role'), name: node.getAttribute('aria-label'),
      id: node.id, text: node.tagName === 'INPUT' ? '' : (node.textContent ?? '').trim(),
      checked: node instanceof HTMLInputElement && node.type === 'checkbox' ? node.checked : node.getAttribute('aria-checked'),
      labels: node instanceof HTMLInputElement ? Array.from(node.labels ?? []).map((label) => label.textContent?.trim()) : [],
      ancestry: node instanceof HTMLInputElement && node.type === 'checkbox' ? (() => {
        const rows = []; let parent = node.parentElement;
        for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) rows.push({ tag: parent.tagName, text: (parent.textContent ?? '').trim().slice(0, 500), checkboxes: parent.querySelectorAll('input[type="checkbox"]').length });
        return rows;
      })() : [],
    }))),
  };
}

/** Existing sign-in is reused in place; no credentials/cookies are exported. */
export async function inspectOwnerBrowser(repo: string, domains: readonly string[], restartBrowser = false, progress: (detail: string) => void = () => undefined): Promise<OwnerInspection> {
  const profile = join(repo, '.domain-migration/owner-chrome');
  const info = lstatSync(profile);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error('Owner Chrome profile must be a private directory owned by the current user');
  if (!await releaseOwnerBrowser(repo, restartBrowser)) return { status: 'unavailable', detail: 'The dedicated Chrome profile is in use. An approved controlled restart is required before scripted inspection; no process was stopped' };
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, env: ownerBrowserEnvironment(),
    // Reuse real Chrome's encrypted sign-in; Playwright's mock/basic stores differ.
    ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
    serviceWorkers: 'block', acceptDownloads: false, chromiumSandbox: true, timeout: 30000 });
  let blockedRequests = 0;
  const blocked = new Map<string, number>();
  const observed: Awaited<ReturnType<typeof snapshot>>[] = [];
  let currentPage: Page | undefined;
  try {
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!ownerReadRequest(request.url(), request.method(), request.isNavigationRequest())) {
        blockedRequests++;
        const url = new URL(request.url());
        const key = `${request.method()} ${url.origin}${url.pathname}`;
        if (blocked.size < 100 || blocked.has(key)) blocked.set(key, (blocked.get(key) ?? 0) + 1);
        await route.abort('blockedbyclient');
      }
      else await route.continue();
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    currentPage = page;
    progress('Reading the authenticated Squarespace domain list');
    await page.goto(OWNER_DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: 'Domains', exact: true }).waitFor({ timeout: 30000 });
    for (const domain of domains) await page.locator('a[href]').filter({ hasText: domain }).first().waitFor({ timeout: 30000 });
    const dashboard = await snapshot(page);
    observed.push(dashboard);
    for (const domain of domains) {
      const link = dashboard.links.find((link) => {
        if (!ownerPageAllowed(link.href)) return false;
        return new URL(link.href).pathname.split('/').some((part) => decodeURIComponent(part) === domain);
      });
      if (!link) throw new Error('A requested domain has no exact observed dashboard link');
      progress(`${domain}: Reading domain lock and registration controls`);
      await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.getByText(/^domain lock$/i).waitFor({ timeout: 30000 });
      const overview = await snapshot(page);
      observed.push(overview);
      for (const label of ['DNSSEC', 'Domain Nameservers']) {
        const detail = overview.links.find((item) => item.text === label && ownerPageAllowed(item.href)
          && new URL(item.href).pathname.startsWith(`/domains/managed/${domain}/dns/`));
        if (!detail) continue;
        progress(`${domain}: Reading ${label} controls`);
        await page.goto(detail.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByRole('heading', { name: /^(DNSSEC|Domain Nameservers|Nameservers)$/i }).first().waitFor({ timeout: 30000 });
        if (label === 'Domain Nameservers') await page.getByRole('button', { name: /edit|custom nameservers|change nameservers/i }).first().waitFor({ timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        observed.push(await snapshot(page));
      }
    }
    const evidencePath = join(repo, `.domain-migration/owner-inspection-${Date.now()}-${crypto.randomUUID()}.json`);
    privateJson(evidencePath, { observedAt: new Date().toISOString(), blockedRequests, blocked: Object.fromEntries(blocked), pages: observed });
    return { status: 'observed', detail: `${observed.length} Squarespace page observations saved privately; write requests and WebSockets were blocked; no domain setting was changed`, evidencePath };
  } catch {
    const path = join(repo, `.domain-migration/owner-inspection-failed-${Date.now()}-${crypto.randomUUID()}.json`);
    let partial;
    try { if (currentPage) partial = await snapshot(currentPage); } catch { /* No foreign page is captured. */ }
    privateJson(path, { observedAt: new Date().toISOString(), blockedRequests, blocked: Object.fromEntries(blocked), pages: observed, partial });
    throw new Error(`Read-only Squarespace inspection did not finish; partial observations: ${path}. Browser output withheld; no write request was allowed`);
  } finally { await context.close(); }
}
