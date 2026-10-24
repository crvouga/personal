import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadNixCache, type CacheUploadStore } from './nix-cache-upload';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nix-upload-test-'));
  directories.push(directory);
  await mkdir(join(directory, 'nar'));
  const hash = 'a'.repeat(32);
  await writeFile(join(directory, `nar/${hash}.nar.zst`), 'fixture NAR');
  await writeFile(
    join(directory, `${hash}.narinfo`),
    'Sig: fixture:signature\n'
  );
  await writeFile(join(directory, 'nix-cache-info'), 'StoreDir: /nix/store\n');
  return directory;
}

test('an interrupted NAR upload exposes no pointers and the next publication recovers', async () => {
  const directory = await fixture();
  const objects = new Map<string, string>();
  let fail = true;
  const order: string[] = [];
  const store: CacheUploadStore = {
    exists: async (key) => objects.has(key),
    put: async (key, body) => {
      if (fail) throw new Error('fixture upload interrupted');
      objects.set(key, await body.text());
      order.push(key);
    },
    text: async (key) => objects.get(key) ?? '',
  };
  await expect(uploadNixCache(directory, store)).rejects.toThrow('interrupted');
  expect(objects.size).toBe(0);
  fail = false;
  expect(await uploadNixCache(directory, store)).toBe(1);
  expect(order[0]).toContain('/nix/nar/');
  expect(order[1]).toEndWith('.narinfo');
  expect(order[2]).toEndWith('/nix-cache-info');
  order.length = 0;
  await uploadNixCache(directory, store);
  expect(order.some((key) => key.includes('/nar/'))).toBe(false);
  expect(order).toHaveLength(2);
});

test('a failed private readback cannot produce a successful publication', async () => {
  const directory = await fixture();
  await expect(
    uploadNixCache(directory, {
      exists: async () => false,
      put: async () => {},
      text: async () => 'wrong cache index',
    })
  ).rejects.toThrow('FLEET_CACHE_READBACK_FAILED');
});
