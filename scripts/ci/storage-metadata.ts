/** Read-only storage diagnostics. Never log object bodies, credentials or signed URLs. */
import { S3Client } from 'bun';
import { loadServicesConfig } from '../../packages/infra/lib/services';
import { createHealthContext } from '../../packages/infra/lib/health/ports';
import { DEFAULT_HEALTH_OPTIONS } from '../../packages/infra/lib/health/context';
import { accountId, cfGet } from '../../packages/infra/lib/domains/cloudflare';

const key = process.env.STORAGE_KEY ?? '';
if (!key || key.length > 1024 || /[\r\n]/.test(key))
  throw new Error('STORAGE_KEY required');
const config = loadServicesConfig();
const ctx = createHealthContext({
  config,
  repoRoot: process.cwd(),
  options: DEFAULT_HEALTH_OPTIONS,
});
const store = config.object_stores?.find((value) => value.id === 'production');
if (!store?.bucket) throw new Error('Production object store missing');
const locks = await cfGet(
  ctx,
  `/accounts/${accountId(ctx)}/r2/buckets/${encodeURIComponent(store.bucket)}/lock`
);
const result = locks.result as {
  rules?: { enabled: boolean; prefix?: string; condition: unknown }[];
};
console.log(
  JSON.stringify({
    bucket: store.bucket,
    locks: result.rules?.map(({ enabled, prefix, condition }) => ({
      enabled,
      prefix,
      condition,
    })),
  })
);
const doc = await ctx.kv('prd');
if (!doc.ok) throw new Error('Production storage credentials unavailable');
const required = (name: string): string => {
  const value = doc.data[name];
  if (!value) throw new Error(`Missing storage field ${name}`);
  return value;
};
const client = new S3Client({
  endpoint: required(store.endpoint_secret),
  region: required(store.region_secret),
  bucket: required(store.bucket_secret),
  accessKeyId: required(store.access_key_secret),
  secretAccessKey: required(store.secret_key_secret),
});
try {
  const file = client.file(key);
  const head = await file.stat();
  console.log(
    JSON.stringify({ key, head: { etag: head.etag, size: head.size } })
  );
  for (const encoding of ['identity', 'gzip, br']) {
    const response = await fetch(
      file.presign({ method: 'GET', expiresIn: 60 }),
      {
        method: 'GET',
        redirect: 'error',
        headers: { 'accept-encoding': encoding },
        signal: AbortSignal.timeout(10000),
      }
    );
    const headers = Object.fromEntries(
      [
        'etag',
        'content-encoding',
        'content-type',
        'cache-control',
        'cf-cache-status',
      ].map((name) => [name, response.headers.get(name)])
    );
    await response.body?.cancel();
    console.log(JSON.stringify({ encoding, status: response.status, headers }));
  }
} catch {
  // Fetch/S3 errors may contain signed URLs: suppress the raw error entirely.
  throw new Error(
    'Storage metadata read failed; no object content or signed URL was logged'
  );
}
