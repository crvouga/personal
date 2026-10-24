import type { BrowserContext, Locator, Page, Request } from 'playwright';
import { ManagerError } from '../domain/errors.ts';
export interface NetworkGuard {
  seal(): void;
}
export async function guardContext(
  context: BrowserContext,
  allowedOrigin: string,
  staticOrigins: string[] = []
): Promise<NetworkGuard> {
  const assets = new Set<string>();
  let sealed = false;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === allowedOrigin) {
      await route.continue();
      return;
    }
    if (!staticRequest(request, url, staticOrigins)) {
      await route.abort('blockedbyclient');
      return;
    }
    if (!sealed && assets.size < 256) assets.add(url.href);
    if (!assets.has(url.href)) {
      await route.abort('blockedbyclient');
      return;
    }
    const headers = { ...request.headers() };
    for (const key of ['referer', 'authorization', 'cookie'])
      delete headers[key];
    await route.continue({ headers });
  });
  context.on('page', (page) => {
    page.setDefaultTimeout(10_000);
  });
  return {
    seal: () => {
      sealed = true;
    },
  };
}
function staticRequest(request: Request, url: URL, origins: string[]): boolean {
  return (
    origins.includes(url.origin) &&
    request.method() === 'GET' &&
    !url.search &&
    ['script', 'stylesheet', 'font', 'image'].includes(
      request.resourceType()
    ) &&
    /^\/assets\/[a-zA-Z0-9._-]+\.(js|css|woff2?|png|svg)$/.test(url.pathname)
  );
}
export function assertOrigin(page: Page, origin: string): void {
  if (new URL(page.url()).origin !== origin)
    throw new ManagerError('invalid-input');
}
export async function fillSecret(input: {
  page: Page;
  locator: Locator;
  value: string;
  origin: string;
}): Promise<void> {
  assertOrigin(input.page, input.origin);
  const safe = await input.locator.evaluate((element, expected) => {
    const node = element as HTMLInputElement;
    const form = node.form;
    return (
      window.location.origin === expected &&
      (!form ||
        new URL(form.action || window.location.href).origin === expected)
    );
  }, input.origin);
  if (!safe) throw new ManagerError('invalid-input');
  await input.locator.fill(input.value);
}
