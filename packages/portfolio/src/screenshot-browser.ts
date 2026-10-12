/**
 * Browser profile for hosted screenshots.
 *
 * Playwright's default user agent contains `HeadlessChrome`. Orchard
 * (asuorchard.asu.edu) and One Origin answer that token with a 403 or a
 * Cloudflare interstitial, and a normal desktop Chrome token is let through.
 */
import type { Browser, BrowserContext, Page } from 'playwright';

const CHALLENGE_WAIT_MS = 15_000;
const CHALLENGE_POLL_MS = 1_000;
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

const BOT_WALL_TITLE =
  /just a moment|attention required|checking your browser|sorry, you have been blocked|^403 forbidden$|^access denied$/i;

const CHALLENGE_SELECTOR =
  '#cf-challenge-running, #challenge-running, .cf-browser-verification';

type Viewport = { readonly width: number; readonly height: number };

export function desktopChromeUserAgent(version: string): string {
  const engine = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${engine}`;
  }
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${engine}`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) ${engine}`;
}

export function titleLooksBlocked(title: string): boolean {
  return BOT_WALL_TITLE.test(title.trim());
}

async function hideAutomationFlag(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => false,
    });
  });
}

/** A fresh context whose fingerprint matches desktop Chrome, not headless. */
export async function openScreenshotContext(
  browser: Browser,
  viewport: Viewport
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    colorScheme: 'dark',
    locale: 'en-US',
    userAgent: desktopChromeUserAgent(browser.version()),
    extraHTTPHeaders: { 'Accept-Language': ACCEPT_LANGUAGE },
  });
  await hideAutomationFlag(context);
  return context;
}

/** True while the document is still a bot wall rather than the site. */
export async function pageLooksBlocked(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    if (titleLooksBlocked(title)) return true;
    const markers = await page.locator(CHALLENGE_SELECTOR).count();
    return markers > 0;
  } catch {
    // A challenge reload destroys the document mid-read. Keep waiting.
    return true;
  }
}

/** Cloudflare's JS check clears itself in a normal browser. Give it that time. */
export async function waitOutBotChallenge(page: Page): Promise<void> {
  if (!(await pageLooksBlocked(page))) return;
  const deadline = Date.now() + CHALLENGE_WAIT_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(CHALLENGE_POLL_MS);
    if (!(await pageLooksBlocked(page))) return;
  }
}

/**
 * Accept a 2xx document. Also accept a challenge response once the
 * interstitial has replaced itself with the real page — `goto` still reports
 * the first status after that client-side reload.
 */
export async function ensureReachableDocument(
  page: Page,
  status: number
): Promise<void> {
  const sawChallenge = await pageLooksBlocked(page);
  if (sawChallenge) await waitOutBotChallenge(page);
  if (await pageLooksBlocked(page)) {
    throw new Error(`HTTP ${status}: bot check did not clear`);
  }
  if (status >= 200 && status < 300) return;
  if (sawChallenge) return;
  throw new Error(`HTTP ${status}: server returned non-success status code`);
}
