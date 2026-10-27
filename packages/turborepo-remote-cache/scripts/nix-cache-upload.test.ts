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
  await expect(uploadNixCache(directory, store)).rejects.toThrow(
    'NIX_CACHE_S3_PUT_UNKNOWN'
  );
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

for (const method of ['exists', 'put', 'text'] as const) {
  test(`transient ${method} failure recovers within the publication, before exposing pointers`, async () => {
    const directory = await fixture();
    const objects = new Map<string, string>();
    const order: string[] = [];
    const delays: number[] = [];
    const warnings: string[] = [];
    let failed = false;
    const fault = (operation: string) => {
      if (method === operation && !failed) {
        failed = true;
        // Provider messages must never appear in diagnostics.
        throw Object.assign(new Error('credential=private-fixture'), {
          code: 'SlowDown',
        });
      }
    };
    const store: CacheUploadStore = {
      exists: async (key) => {
        fault('exists');
        return objects.has(key);
      },
      put: async (key, body) => {
        fault('put');
        objects.set(key, await body.text());
        order.push(key);
      },
      text: async (key) => {
        fault('text');
        return objects.get(key) ?? '';
      },
    };
    expect(
      await uploadNixCache(directory, store, {
        sleep: async (delay) => {
          delays.push(delay);
        },
        warn: (message) => {
          warnings.push(message);
        },
      })
    ).toBe(1);
    expect(failed).toBe(true);
    expect(delays).toEqual([1000]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('code=SlowDown');
    expect(warnings[0]).not.toContain('private-fixture');
    expect(order[0]).toContain('/nar/');
    expect(order[1]).toEndWith('.narinfo');
    expect(order[2]).toEndWith('/nix-cache-info');
  });
}

test('exhausted NAR retries leave metadata unpublished and name the failing operation', async () => {
  const directory = await fixture();
  const delays: number[] = [];
  let attempts = 0;
  await expect(
    uploadNixCache(
      directory,
      {
        exists: async () => false,
        put: async (key) => {
          expect(key).toContain('/nar/');
          attempts++;
          throw Object.assign(new Error('private response'), {
            code: 'ETIMEDOUT',
          });
        },
        text: async () => {
          throw new Error('readback must not start');
        },
      },
      {
        sleep: async (delay) => {
          delays.push(delay);
        },
        warn: () => {},
      }
    )
  ).rejects.toThrow('NIX_CACHE_S3_PUT_ETIMEDOUT');
  expect(attempts).toBe(4);
  expect(delays).toEqual([1000, 2000, 4000]);
});

test('a failed private readback cannot produce a successful publication', async () => {
  const directory = await fixture();
  await expect(
    uploadNixCache(directory, {
      exists: async () => false,
      put: async () => {},
      text: async () => 'wrong cache index',
    })
  ).rejects.toThrow('NIX_CACHE_READBACK_FAILED');
});
