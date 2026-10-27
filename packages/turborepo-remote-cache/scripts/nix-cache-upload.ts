import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cacheOperation,
  type CacheOperationOptions,
} from './nix-cache-operation';

export interface CacheUploadStore {
  exists(key: string): Promise<boolean>;
  put(key: string, body: Blob): Promise<void>;
  text(key: string): Promise<string>;
}

/** Publish all immutable content before exposing any signed pointers. */
export async function uploadNixCache(
  cache: string,
  store: CacheUploadStore,
  options: CacheOperationOptions = {}
): Promise<number> {
  const upload = async (relative: string, immutable: boolean) => {
    const key = `turbo-cache/prd/nix/${relative}`;
    if (
      immutable &&
      (await cacheOperation('HEAD', () => store.exists(key), options))
    )
      return;
    await cacheOperation(
      'PUT',
      () => store.put(key, Bun.file(join(cache, relative))),
      options
    );
  };
  const nars = await readdir(join(cache, 'nar'));
  for (let offset = 0; offset < nars.length; offset += 4) {
    await Promise.all(
      nars.slice(offset, offset + 4).map((name) => upload(`nar/${name}`, true))
    );
  }
  const metadata = (await readdir(cache)).filter((name) =>
    name.endsWith('.narinfo')
  );
  for (let offset = 0; offset < metadata.length; offset += 8) {
    await Promise.all(
      metadata.slice(offset, offset + 8).map((name) => upload(name, false))
    );
  }
  await upload('nix-cache-info', false);
  if (
    (await cacheOperation(
      'GET',
      () => store.text('turbo-cache/prd/nix/nix-cache-info'),
      options
    )) !== (await Bun.file(join(cache, 'nix-cache-info')).text())
  ) {
    throw new Error('FLEET_CACHE_READBACK_FAILED');
  }
  return metadata.length;
}
