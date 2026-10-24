import { expect, test } from 'bun:test';
import { application } from './app';
import type { Dependencies } from './types';

function app(developmentIdentity = false) {
  return application({
    db: (value: unknown) => value,
    config: { schema: 'auth_relay_nonproduction', developmentIdentity },
  } as unknown as Dependencies);
}

test('the client shell carries a unique CSP style nonce without relaxing scripts', async () => {
  const service = app();
  const first = await service.request('/');
  const html = await first.text();
  const nonce = html.match(/name="csp-nonce" content="([^"]+)"/)?.[1];
  expect(nonce).toBeTruthy();
  const policy = first.headers.get('Content-Security-Policy');
  expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`);
  expect(policy).toContain("script-src 'self';");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(first.headers.get('Cache-Control')).toBe('no-store');
  expect(html).toContain('href="/app.css"');
  expect(html.indexOf('src="/theme-init.js"')).toBeLessThan(
    html.indexOf('href="/app.css"')
  );
  expect(html).not.toContain('src="/theme-init.js" defer');
  const next = await service.request('/');
  expect(await next.text()).not.toContain(`content="${nonce}"`);
});

test('fixture identity is explicitly labelled in the shell metadata only when selected', async () => {
  expect(await (await app(true).request('/')).text()).toContain(
    'name="relay-development" content="true"'
  );
  expect(await (await app().request('/')).text()).toContain(
    'name="relay-development" content="false"'
  );
});
