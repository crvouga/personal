import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../packages/fleet/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');

/** Real browser/provider redirects; the upstream is the labelled local fixture. */
export async function checkDevBrowser(
  origin: string,
  previous?: string
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    assert.match(await page.textContent('header'), /LOCAL DEVELOPMENT/);
    await page.goto(`${origin}/auth/login`);
    await page.waitForURL(`${origin}/`, { timeout: 30000 });
    const session = await page.evaluate(async () =>
      (await fetch('/api/session')).json()
    );
    if (session.setup) {
      assert.equal(previous, undefined, 'operator setup must survive restart');
      await page.locator('#setup-token').fill('local-development-only');
      await page.locator('#setup-form button').click();
    }
    await page
      .locator('#console')
      .waitFor({ state: 'visible', timeout: 30000 });
    const result = await page.evaluate(async (existing: string | undefined) => {
      const session = await (await fetch('/api/session')).json();
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf,
      };
      if (existing) {
        const clients = await (await fetch('/api/clients')).json();
        if (
          !clients.some(
            (client: { id: string; revoked: boolean }) =>
              client.id === existing && !client.revoked
          )
        )
          throw new Error('registration did not survive restart');
        const response = await fetch(`/api/clients/${existing}`, {
          method: 'DELETE',
          headers,
        });
        if (!response.ok) throw new Error('revocation failed');
        return existing;
      }
      const id = 'app-' + crypto.randomUUID();
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: 'Cold run verification',
          project: 'dev-check',
          instance: 'first',
          environment: 'localhost',
          callbacks: ['http://localhost:53999/callback'],
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      });
      if (!response.ok)
        throw new Error(`registration failed (${response.status})`);
      return id;
    }, previous);
    return result;
  } finally {
    await browser.close();
  }
}
