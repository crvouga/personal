// A warm cache needs only public signature checks, not credentials or rebuilds.
import { appendFile, writeFile } from 'node:fs/promises';

async function capture(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'inherit' });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw new Error('FLEET_CACHE_EVALUATION_FAILED');
  return text.trim();
}

const metadata = JSON.parse(
  await capture([
    'nix',
    'eval',
    '--no-write-lock-file',
    '--raw',
    '.#nixosConfigurations.ci.config.environment.etc."fleet/bootstrap.json".text',
  ])
) as { cacheUrl: string; cachePublicKey: string };
const paths: string[] = [];
for (const role of ['ci', 'web', 'cache', 'netboot', 'devbox']) {
  paths.push(
    await capture([
      'nix',
      'eval',
      '--no-write-lock-file',
      '--raw',
      `.#nixosConfigurations.${role}.config.system.build.toplevel`,
    ])
  );
}
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
  console.log(
    'FLEET_CACHE_ALREADY_PUBLISHED: exact role paths and pinned signatures verified through the public endpoint.'
  );
}
const output = process.env['GITHUB_OUTPUT'];
if (!output) throw new Error('FLEET_CACHE_OUTPUT_PATH_MISSING');
await appendFile(output, `hit=${hit}\n`);
