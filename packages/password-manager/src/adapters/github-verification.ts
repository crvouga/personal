import type { Page, Response } from 'playwright';
export function passwordResponse(
  page: Page,
  origin: string
): Promise<Response | null> {
  return page
    .waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'POST' &&
          url.origin === origin &&
          url.pathname === '/session'
        );
      },
      { timeout: 15_000 }
    )
    .catch(() => null);
}
/** A fresh cookie or a meta tag alone cannot establish password acceptance. */
export async function passwordAccepted(
  response: Response | null,
  origin: string
): Promise<boolean> {
  if (!response || ![302, 303].includes(response.status())) return false;
  const destination = (await response.allHeaders())['location'];
  if (!destination) return false;
  const url = new URL(destination, origin);
  if (url.origin !== origin) return false;
  return (
    url.pathname === '/' ||
    /^\/sessions\/(two-factor|verified-device)(\/|$)/.test(url.pathname)
  );
}
export async function matchesIdentity(
  page: Page,
  username: string
): Promise<boolean> {
  const meta = page.locator('meta[name="user-login"]');
  if ((await meta.count()) !== 1) return false;
  const identity = await meta.getAttribute('content');
  return identity?.toLowerCase() === username.toLowerCase();
}
