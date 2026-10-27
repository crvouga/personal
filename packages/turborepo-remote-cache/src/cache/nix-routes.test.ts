import { expect, test } from 'bun:test';
import { ObjectStoreImplInMemory } from '@pkgs/object-store/impl-in-memory';
import { createCacheApp } from './create-app';

test('Nix cache streams only its public namespace without exposing Turbo artifacts', async () => {
  const store = new ObjectStoreImplInMemory();
  const hash = 'a'.repeat(32);
  const encode = (value: string) => new TextEncoder().encode(value);
  await store.put(
    'nix/nix-cache-info',
    encode('StoreDir: /nix/store\n'),
    'text/plain'
  );
  await store.put(
    `nix/${hash}.narinfo`,
    encode('Sig: test-cache-1:test\n'),
    'text/plain'
  );
  await store.put(
    `nix/nar/${hash}.nar.zst`,
    new Uint8Array([1, 2, 3]),
    'application/octet-stream'
  );
  await store.put(
    hash,
    encode('private Turbo artifact'),
    'application/octet-stream'
  );
  const app = createCacheApp({
    turboToken: 'fixture-only',
    objectStore: store,
  });
  const metadata = await app.request(`/nix/${hash}.narinfo`);
  expect(metadata.status).toBe(200);
  expect(await metadata.text()).toContain('Sig: test-cache-1:');
  const nar = await app.request(`/nix/nar/${hash}.nar.zst`);
  expect(nar.status).toBe(200);
  expect([...new Uint8Array(await nar.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(nar.headers.get('cache-control')).toContain('immutable');
  const head = await app.request(`/nix/nar/${hash}.nar.zst`, {
    method: 'HEAD',
  });
  expect(head.headers.get('content-length')).toBe('3');
  expect(await head.text()).toBe('');
  for (const path of [
    `/nix/${hash}`,
    `/nix/${hash}.tag`,
    '/nix/%2e%2e/private',
    '/nix/nar/anything',
  ]) {
    expect((await app.request(path)).status).not.toBe(200);
  }
  expect((await app.request(`/v8/artifacts/${hash}`)).status).toBe(401);
  expect(
    (
      await app.request(`/nix/${hash}.narinfo`, {
        method: 'PUT',
        body: 'malicious',
      })
    ).status
  ).not.toBe(200);
  expect((await app.request('/nix/nix-cache-info')).status).toBe(200);
  // Turbo's write token grants no write path into the public Nix namespace.
  const escape = await app.request(`/v8/artifacts/nix%2F${hash}.narinfo`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer fixture-only' },
    body: 'overwritten',
  });
  expect(escape.status).toBe(400);
  expect(await (await app.request(`/nix/${hash}.narinfo`)).text()).toBe(
    'Sig: test-cache-1:test\n'
  );
  const miss = await app.request(`/nix/${'b'.repeat(32)}.narinfo`);
  expect(miss.status).toBe(404);
  expect(miss.headers.get('cache-control')).toBe('no-store');
});
