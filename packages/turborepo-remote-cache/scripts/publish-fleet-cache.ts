// Application data publication only. OpenTofu owns signing keys and access.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { S3Client } from 'bun';
import { nixCacheKeys } from './nix-cache-keys';
import { uploadNixCache } from './nix-cache-upload';

let phase = 'credential-validation';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('FLEET_CACHE_CREDENTIAL_MISSING');
  return value;
}

async function run(args: string[]): Promise<void> {
  const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error('FLEET_CACHE_NIX_FAILED');
}

async function publish(): Promise<void> {
  const paths = process.argv.slice(2).map((path) => resolve(path));
  if (paths.length === 0) throw new Error('FLEET_CACHE_CLOSURES_MISSING');
  const keys = nixCacheKeys(required('NIX_CACHE_PRIVATE_KEY_PEM'));
  const config = await Bun.file(
    new URL('../../fleet/settings/shared.nix', import.meta.url)
  ).text();
  if (!config.includes(`publicKey = "${keys.public}";`))
    throw new Error('FLEET_CACHE_SIGNING_KEY_MISMATCH');
  const client = new S3Client({
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  });
  const directory = await mkdtemp(join(tmpdir(), 'fleet-cache-'));
  try {
    const keyFile = join(directory, 'signing-key');
    await writeFile(keyFile, keys.secret + '\n', { mode: 0o600 });
    const cache = join(directory, 'cache');
    phase = 'native-cache-copy';
    await run([
      'nix',
      'copy',
      '--to',
      `file://${cache}?compression=zstd&secret-key=${keyFile}`,
      ...paths,
    ]);
    phase = 'signature-verification';
    await run([
      'nix',
      'store',
      'verify',
      '--store',
      `file://${cache}`,
      '--all',
      '--sigs-needed',
      '1',
      '--option',
      'trusted-public-keys',
      keys.public,
    ]);
    phase = 'object-upload-and-readback';
    const signedPaths = await uploadNixCache(cache, {
      exists: (key) => client.exists(key),
      put: async (key, body) => {
        await client.write(key, body);
      },
      text: (key) => client.file(key).text(),
    });
    phase = 'exact-revision-proof';
    const git = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const revision = (await new Response(git.stdout).text()).trim();
    if ((await git.exited) !== 0 || !/^[0-9a-f]{40}$/.test(revision))
      throw new Error('FLEET_CACHE_REVISION_MISSING');
    await writeFile(
      required('FLEET_CACHE_PROOF'),
      JSON.stringify({
        version: 1,
        revision,
        publicKey: keys.public,
        paths: await Promise.all(paths.map((path) => realpath(path))),
        signedPaths,
      }) + '\n'
    );
    console.log(
      `Fleet cache objects published: ${signedPaths} signature-verified store paths. Public endpoint readiness is checked before disk erasure.`
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  await publish();
} catch (error) {
  const code =
    error instanceof Error && /^FLEET_CACHE_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'DEPENDENCY_OPERATION_FAILED';
  console.error(
    `FLEET_CACHE_PUBLICATION_FAILED phase=${phase} code=${code}: inspect this phase's dependency and retry. Running nodes retain their current generation. Credentials and provider response bodies are omitted.`
  );
  process.exitCode = 1;
}
