import { ManagerError } from '../domain/errors.ts';
export async function apiJson<T>(input: {
  url: string;
  token: string;
  origin: string;
  fetch: typeof fetch;
}): Promise<T> {
  if (new URL(input.url).origin !== input.origin)
    throw new ManagerError('invalid-input');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await input.fetch(input.url, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${input.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    checkAuthorization(response.status);
    if (response.status === 429) {
      await response.body?.cancel();
      const delay = retryDelay(response.headers.get('retry-after'));
      if (delay > 30_000) throw new ManagerError('rate-limited');
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) throw new ManagerError('unavailable');
    return boundedResponse<T>(response);
  }
  throw new ManagerError('rate-limited');
}
export async function boundedResponse<T>(
  response: Response,
  limit = 8 * 1024 * 1024
): Promise<T> {
  if (!response.body) throw new ManagerError('unavailable');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) throw new ManagerError('invalid-input');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } finally {
    await reader.cancel();
  }
}

function checkAuthorization(status: number): void {
  if (status === 401) throw new ManagerError('expired-connection');
  if (status === 403) throw new ManagerError('insufficient-scope');
  if (status === 400 || status === 410) throw new ManagerError('stale-cursor');
  if (status === 404) throw new ManagerError('missing');
}

function retryDelay(header: string | null): number {
  if (!header) return 1000;
  const numeric = Number(header);
  if (Number.isFinite(numeric)) return Math.max(0, numeric * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000;
}
