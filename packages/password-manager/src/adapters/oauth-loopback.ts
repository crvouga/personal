import { createServer } from 'node:http';
import type { SourceConfig } from '../domain/config.ts';
import type { SecretStore } from '@pkgs/secret-store';
import { startOAuth, finishOAuth } from './oauth.ts';
import { ManagerError } from '../domain/errors.ts';
/** URL is passed only to the system opener, never ordinary logs/reports. */
export async function connectOAuth(input: {
  source: SourceConfig;
  secrets: SecretStore;
  open: (url: string) => Promise<void>;
  fetch: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  let settle: (result: 'done' | 'failed' | 'cancelled') => void = () => {};
  const outcome = new Promise<'done' | 'failed' | 'cancelled'>((resolve) => {
    settle = resolve;
  });
  const server = callbackServer(input, () => settle('done'));
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new ManagerError('unavailable')));
    server.listen(0, '127.0.0.1', resolve);
  });
  const cancel = () => settle('cancelled');
  input.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => settle('failed'), 10 * 60_000);
  try {
    if (input.signal?.aborted) throw new ManagerError('cancelled');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new ManagerError('unavailable');
    const url = await startOAuth({
      source: input.source,
      secrets: input.secrets,
      redirect: `http://127.0.0.1:${address.port}/callback`,
    });
    await input.open(url);
    const result = await outcome;
    if (result === 'cancelled') throw new ManagerError('cancelled');
    if (result !== 'done') throw new ManagerError('expired-connection');
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', cancel);
    server.closeAllConnections();
    server.close();
  }
}

function callbackServer(
  input: Parameters<typeof connectOAuth>[0],
  done: () => void
) {
  const server = createServer((request, response) => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      response.writeHead(400).end();
      return;
    }
    const base = `http://127.0.0.1:${address.port}`;
    if (
      request.headers.host !== `127.0.0.1:${address.port}` ||
      request.method !== 'GET'
    ) {
      response.writeHead(400).end();
      return;
    }
    void finishOAuth({
      source: input.source,
      secrets: input.secrets,
      callback: base + (request.url ?? '/'),
      fetch: input.fetch,
    })
      .then(() => {
        response
          .writeHead(200, {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          })
          .end('Connected. Return to password-manager.');
        done();
      })
      .catch(() => {
        response
          .writeHead(400)
          .end('Authorization rejected. Restart connection.');
      });
  });
  return server;
}
