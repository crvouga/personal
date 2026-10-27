import { expect, test } from 'bun:test';
import { S3Client } from 'bun';
import { cacheOperation } from './nix-cache-operation';

for (const code of [
  'AccessDenied',
  'SignatureDoesNotMatch',
  'ERR_S3_INVALID_ENDPOINT',
  'private-fixture',
]) {
  test(`${code} fails without retrying or exposing provider data`, async () => {
    let attempts = 0;
    const diagnostics: unknown[] = [];
    const result = cacheOperation(
      'HEAD',
      async () => {
        attempts++;
        throw Object.assign(new Error('credential=private-fixture'), { code });
      },
      {
        sleep: async (delay) => {
          diagnostics.push(delay);
        },
        warn: (message) => {
          diagnostics.push(message);
        },
      }
    );
    await expect(result).rejects.toThrow(
      `NIX_CACHE_S3_HEAD_${code === 'private-fixture' ? 'UNKNOWN' : code.toUpperCase()}`
    );
    expect(attempts).toBe(1);
    expect(diagnostics).toEqual([]);
  });
}

test('the native Bun S3 client retries a temporary storage response', async () => {
  let attempts = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      await request.arrayBuffer();
      attempts++;
      return attempts === 1
        ? new Response(
            '<Error><Code>SlowDown</Code><Message>private-fixture</Message></Error>',
            { status: 503 }
          )
        : new Response('');
    },
  });
  try {
    const client = new S3Client({
      endpoint: server.url.href,
      bucket: 'fixture',
      accessKeyId: 'fixture',
      secretAccessKey: 'fixture',
      region: 'auto',
    });
    const warnings: string[] = [];
    await cacheOperation('PUT', () => client.write('fixture', 'body'), {
      sleep: async () => {},
      warn: (message) => {
        warnings.push(message);
      },
    });
    expect(attempts).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('operation=PUT code=SlowDown');
    expect(warnings[0]).not.toContain('private-fixture');
  } finally {
    server.stop(true);
  }
});
