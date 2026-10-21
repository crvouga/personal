import * as oidc from 'openid-client';
import type { Config } from './config';
import { logContext, operation } from '@pkgs/logger';

// Keycloak trusts x-forwarded-* (KC_PROXY_HEADERS=xforwarded) and its realm
// requires HTTPS, so every request to it must carry the public origin, whether
// it is proxied from a browser or made by the gateway itself over the private
// network.
export function forwardedHeaders(
  origin: string,
  source: HeadersInit | undefined
): Headers {
  const headers = new Headers(source);
  headers.delete('host');
  for (const name of [
    'forwarded',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-for',
  ])
    headers.delete(name);
  const url = new URL(origin);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
  const context = logContext();
  headers.delete('traceparent');
  headers.delete('tracestate');
  headers.delete('x-request-id');
  if (typeof context['requestId'] === 'string')
    headers.set('x-request-id', context['requestId']);
  if (typeof context['traceId'] === 'string')
    headers.set(
      'traceparent',
      `00-${context['traceId']}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}-01`
    );
  return headers;
}

export async function provider(config: Config): Promise<oidc.Configuration> {
  const internalFetch: oidc.CustomFetch = (input, init) => {
    const url = new URL(input);
    if (url.origin !== config.origin)
      throw new Error('Unexpected OIDC destination');
    const destination = new URL(url.pathname + url.search, config.upstream);
    const body =
      init.body instanceof Uint8Array
        ? new Uint8Array(init.body).buffer
        : (init.body ?? null);
    return operation('oidc.transport', () =>
      fetch(destination, {
        ...init,
        headers: forwardedHeaders(config.origin, init.headers),
        body,
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      })
    );
  };
  return oidc.discovery(
    new URL(config.issuer),
    config.consoleId,
    config.consoleSecret,
    undefined,
    {
      [oidc.customFetch]: internalFetch,
      execute: [
        oidc.enableNonRepudiationChecks,
        ...(config.origin.startsWith('http:')
          ? [oidc.allowInsecureRequests]
          : []),
      ],
    }
  );
}
