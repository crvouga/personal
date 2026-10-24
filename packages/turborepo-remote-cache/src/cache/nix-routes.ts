import { Hono } from 'hono';
import type { ObjectStore } from '@pkgs/object-store/interface';

// Only CI's signed binary-cache namespace is public. Turbo artifacts and tags
// remain private, even if a caller guesses their hashes or encodes separators.
const NIX_OBJECT =
  /^(?:nix-cache-info|[0-9abcdfghijklmnpqrsvwxyz]{32}\.narinfo|nar\/[0-9a-z]{32,64}\.nar(?:\.(?:zst|xz|bz2|gz))?)$/;

export function createNixCacheApp(store: ObjectStore): Hono {
  const app = new Hono();
  const cache = store.withPrefix('nix/');
  app.on(['GET', 'HEAD'], '/*', async (c) => {
    const key = c.req.path.slice('/nix/'.length);
    if (!NIX_OBJECT.test(key))
      return new Response(null, {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    const stored = await cache.get(key);
    if (stored === null)
      return new Response(null, {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    const headers = {
      'Content-Type':
        key.endsWith('.narinfo') || key === 'nix-cache-info'
          ? 'text/plain; charset=utf-8'
          : 'application/octet-stream',
      'Content-Length': String(stored.size),
      // Narinfo signatures may be added during key rotation; NARs are immutable.
      'Cache-Control': key.startsWith('nar/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60',
    };
    if (c.req.method === 'HEAD') {
      await stored.body.cancel();
      return new Response(null, { headers });
    }
    return new Response(stored.body, { headers });
  });
  return app;
}
