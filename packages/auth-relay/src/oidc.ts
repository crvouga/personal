import * as oidc from 'openid-client';
import type { Config } from './config';

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
    return fetch(destination, {
      ...init,
      body,
      signal: AbortSignal.timeout(5000),
    });
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
