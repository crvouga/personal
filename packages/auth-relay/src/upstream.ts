import { oauthError } from '@pkgs/logger';
import { forwardedHeaders } from './oidc';
import type { Config } from './config';
import { step } from './telemetry';

export async function providerRequest(
  config: Config,
  operation: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  return step(operation, async () => {
    const response = await fetch(url, {
      ...init,
      headers: forwardedHeaders(config.origin, init.headers),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return response;
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw Object.assign(new Error('Identity provider request failed'), {
      status: response.status,
      error: oauthError(data?.error),
    });
  });
}
