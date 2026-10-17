import type { MiddlewareHandler } from 'hono';
import type { Dependencies } from './types';

export function rateLimit({ db, config }: Dependencies): MiddlewareHandler {
  return async (c, next) => {
    if (!protectedPath(c.req.path)) {
      await next();
      return;
    }
    // Per-client admission plus a global ceiling; no reliance on spoofable IPs.
    const params =
      c.req.method === 'POST' && c.req.path.endsWith('/token')
        ? new URLSearchParams(await c.req.raw.clone().text())
        : new URL(c.req.url).searchParams;
    const client = params.get('client_id') ?? 'console';
    const minute = Math.floor(Date.now() / 60000);
    const schema = db(config.schema);
    for (const [key, maximum] of [
      ['global', 1200],
      [`client:${client.slice(0, 128)}`, 120],
    ] as const) {
      const [row] =
        await db`INSERT INTO ${schema}.limits (key, "window", count) VALUES (${key}, ${minute}, 1)
        ON CONFLICT (key) DO UPDATE SET count = CASE WHEN ${schema}.limits."window" = ${minute}
        THEN ${schema}.limits.count + 1 ELSE 1 END, "window" = ${minute} RETURNING count`;
      if (row.count > maximum)
        return c.json(
          { error: 'Rate limit exceeded; try again shortly' },
          429,
          { 'Retry-After': '60' }
        );
    }
    await next();
    return;
  };
}

function protectedPath(path: string): boolean {
  return (
    path.startsWith('/api/') ||
    path.startsWith('/auth/') ||
    path.endsWith('/protocol/openid-connect/auth') ||
    path.endsWith('/protocol/openid-connect/token')
  );
}
