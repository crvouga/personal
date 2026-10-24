import type { Hono } from 'hono';
import type { Context } from './types';

export function staticAssets(
  app: Hono<Context>,
  developmentIdentity: boolean
): void {
  app.get('/', async (c) => {
    const html = await Bun.file(
      new URL('../ui/index.html', import.meta.url)
    ).text();
    c.header('Cache-Control', 'no-store');
    return c.html(
      html
        .replace('{{development}}', String(developmentIdentity))
        .replace('{{nonce}}', c.get('secureHeadersNonce') ?? '')
    );
  });
  for (const [path, file, contentType] of [
    ['/app.js', '../dist/app.js', 'text/javascript'],
    ['/theme-init.js', '../dist/theme-init.js', 'text/javascript'],
    ['/app.css', '../dist/app.css', 'text/css'],
    ['/style.css', '../../admin-ui/src/style.css', 'text/css'],
  ] as const) {
    app.get(
      path,
      () =>
        new Response(Bun.file(new URL(file, import.meta.url)), {
          headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
        })
    );
  }
}
