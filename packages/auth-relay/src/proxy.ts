import { Hono } from 'hono';
import { forwardedHeaders } from './oidc';
import type { Dependencies } from './types';

// Only this gateway has a public ingress. Keycloak admin and dynamic client
// registration routes are private, including when the database is unavailable.
export function proxyRoutes({ db, config }: Dependencies): Hono {
  const app = new Hono();
  app.all('/realms/*', async (c) => {
    const url = new URL(c.req.url);
    if (
      !url.pathname.startsWith(`/realms/${config.realm}/`) ||
      url.pathname.includes('/clients-registrations')
    )
      return c.notFound();
    const token = url.pathname.endsWith('/protocol/openid-connect/token');
    if (needsValidation(url.pathname, c.req.method)) {
      const params = token
        ? new URLSearchParams(await c.req.raw.clone().text())
        : url.searchParams;
      const id = params.get('client_id') ?? '';
      if (
        id !== config.consoleId &&
        !(await allowed(depsForPolicy(db, config), params))
      ) {
        return c.json({ error: 'unauthorized_client' }, 400);
      }
    }
    const headers = forwardedHeaders(config.origin, c.req.raw.headers);
    const response = await fetch(
      new URL(url.pathname + url.search, config.upstream),
      {
        method: c.req.method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        body: ['GET', 'HEAD'].includes(c.req.method)
          ? null
          : await c.req.arrayBuffer(),
      }
    );
    return response;
  });
  app.all('/resources/*', (c) =>
    fetch(new URL(c.req.path, config.upstream), {
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    })
  );
  return app;
}

function needsValidation(path: string, method: string): boolean {
  return (
    path.endsWith('/protocol/openid-connect/auth') ||
    (path.endsWith('/protocol/openid-connect/token') && method === 'POST')
  );
}

function depsForPolicy(db: Dependencies['db'], config: Dependencies['config']) {
  return { db, schema: config.schema };
}

async function allowed(
  deps: ReturnType<typeof depsForPolicy>,
  params: URLSearchParams
): Promise<boolean> {
  const { db } = deps;
  const schema = db(deps.schema);
  const id = params.get('client_id') ?? '';
  const rows =
    await db`SELECT config, previous, overlap_until > now() AS overlap FROM ${schema}.clients
    WHERE id = ${id} AND NOT revoked AND expires_at > now()`;
  if (!rows[0]?.config) return false;
  const redirects = [
    ...(rows[0].config.callbacks as string[]),
    ...(rows[0].overlap ? (rows[0].previous as string[]) : []),
  ];
  return redirects.includes(params.get('redirect_uri') ?? '');
}
