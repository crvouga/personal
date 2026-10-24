import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { guardContext, fillSecret } from '../../src/adapters/browser-guard.ts';
async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
void test('trusted static assets load before entry; new URLs and credential-bearing queries are blocked after sealing', async () => {
  const requests: string[] = [];
  const assets = createServer((request, response) => {
    requests.push(request.url ?? '');
    response
      .writeHead(200, { 'Content-Type': 'text/javascript' })
      .end('window.fixtureReady=true');
  });
  const assetOrigin = await listen(assets);
  const main = createServer((_request, response) =>
    response
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end(
        `<script src="${assetOrigin}/assets/bootstrap.js"></script><input id="password" type="password">`
      )
  );
  const origin = await listen(main);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const guard = await guardContext(context, origin, [assetOrigin]);
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'load' });
    assert.equal(requests.length, 1);
    guard.seal();
    await fillSecret({
      page,
      locator: page.locator('#password'),
      value: 'SECRET_CANARY',
      origin,
    });
    await page.evaluate(async (url) => {
      await Promise.all(
        [
          '/assets/new-SECRET_CANARY.js',
          '/assets/bootstrap.js?value=SECRET_CANARY',
        ].map(
          (path) =>
            new Promise<void>((resolve) => {
              const script = document.createElement('script');
              script.onload = () => resolve();
              script.onerror = () => resolve();
              script.src = url + path;
              document.head.append(script);
            })
        )
      );
    }, assetOrigin);
    assert.equal(requests.length, 1);
    assert.equal(
      requests.some((url) => url.includes('SECRET_CANARY')),
      false
    );
  } finally {
    await browser.close();
    assets.closeAllConnections();
    assets.close();
    main.closeAllConnections();
    main.close();
  }
});
