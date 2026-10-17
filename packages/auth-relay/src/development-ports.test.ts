import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localPorts } from '../development/ports';

test('persisted dependency ports are reused unless another server occupies one', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'auth-dev-ports-'));
  let occupied: ReturnType<typeof Bun.serve> | undefined;
  try {
    const initial = await localPorts(cache);
    expect(new Set(Object.values(initial)).size).toBe(3);
    expect(await localPorts(cache)).toEqual(initial);
    occupied = Bun.serve({
      hostname: '127.0.0.1',
      port: Number(initial['AUTH_LOCAL_BROKER_PORT']),
      fetch: () => new Response('unrelated server'),
    });
    const changed = await localPorts(cache);
    expect(changed['AUTH_LOCAL_DATABASE_PORT']).toBe(
      initial['AUTH_LOCAL_DATABASE_PORT']
    );
    expect(changed['AUTH_LOCAL_BROKER_PORT']).not.toBe(
      initial['AUTH_LOCAL_BROKER_PORT']
    );
    expect(new Set(Object.values(changed)).size).toBe(3);
    expect(
      await (await fetch(`http://127.0.0.1:${occupied.port}`)).text()
    ).toBe('unrelated server');
  } finally {
    await occupied?.stop(true);
    await rm(cache, { recursive: true, force: true });
  }
});
