// A warm cache needs only public signature checks, not credentials or rebuilds.
import { appendFile, writeFile } from 'node:fs/promises';

async function capture(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'inherit' });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw new Error('FLEET_CACHE_EVALUATION_FAILED');
  return text.trim();
}

// The flake derives the published closures from packages/fleet/roles.json,
// so this probe never keeps its own role list.
const { metadata, paths } = JSON.parse(
  await capture([
    'nix',
    'eval',
    '--no-write-lock-file',
    '--json',
    '.#lib.cacheProbe',
  ])
) as {
  metadata: { cacheUrl: string; cachePublicKey: string };
  paths: string[];
};
if (
  paths.length === 0 ||
  !paths.every((path) => path.startsWith('/nix/store/'))
)
  throw new Error('FLEET_CACHE_PROBE_INVALID');
const child = Bun.spawn(
  [
    'timeout',
    '45',
    'nix',
    'store',
    'verify',
    '--store',
    metadata.cacheUrl,
    '--no-contents',
    '--sigs-needed',
    '1',
    '--option',
    'trusted-public-keys',
    metadata.cachePublicKey,
    '--option',
    'narinfo-cache-negative-ttl',
    '0',
    ...paths,
  ],
  { stdout: 'inherit', stderr: 'inherit' }
);
const hit = (await child.exited) === 0;
if (hit) {
  const revision = await capture(['git', 'rev-parse', 'HEAD']);
  const proof = process.env['FLEET_CACHE_PROOF'];
  if (!proof) throw new Error('FLEET_CACHE_PROOF_PATH_MISSING');
  await writeFile(
    proof,
    JSON.stringify({
      version: 1,
      revision,
      publicKey: metadata.cachePublicKey,
      paths,
      signedPaths: paths.length,
    }) + '\n'
  );
  process.stdout.write(
    'FLEET_CACHE_ALREADY_PUBLISHED: exact role paths and pinned signatures verified through the public endpoint.\n'
  );
}
const output = process.env['GITHUB_OUTPUT'];
if (!output) throw new Error('FLEET_CACHE_OUTPUT_PATH_MISSING');
await appendFile(output, `hit=${String(hit)}\n`);
