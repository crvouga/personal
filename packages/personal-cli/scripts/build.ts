import { fingerprint } from '../../fleet/src/fingerprint';
import type { Fingerprint } from '../../fleet/src/types';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from '../package.json';
import { indexedCommands } from '../src/command-index';
import { contentHash, stableVersion } from './release-model';
import { runCommand } from '../../fleet/src/runner';

const root = fileURLToPath(new URL('..', import.meta.url));
const destination = join(root, 'dist');
let sourceRevision: string | null = null;
let reference: Fingerprint | null = null;
const version = process.env['PERSONAL_RELEASE_VERSION'] ?? manifest.version;
stableVersion(version);

async function bundle(entry: string, name: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(root, entry)],
    target: 'node',
    format: 'esm',
    minify: false,
    external: Object.keys(manifest.dependencies),
    define: {
      PERSONAL_VERSION: JSON.stringify(version),
      PERSONAL_SOURCE_REVISION: JSON.stringify(sourceRevision),
      PERSONAL_FLEET_REFERENCE: JSON.stringify(reference),
    },
  });
  if (!result.success || !result.outputs[0])
    throw new Error(`Cannot build ${name}.`);
  await writeFile(join(destination, name), await result.outputs[0].text());
}

async function build(): Promise<void> {
  const metadata = await releaseMetadata();
  sourceRevision = !metadata.dirty ? (metadata.sourceCommit ?? null) : null;
  reference = sourceRevision
    ? {
        ...(await fingerprint(join(root, '../..'), runCommand)),
        head: sourceRevision,
      }
    : null;
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await bundle('src/cli.ts', 'cli.mjs');
  await bundle('../fleet/src/remote-entry.ts', 'probe.mjs');
  await chmod(join(destination, 'cli.mjs'), 0o755);
  await copyFile(join(root, 'README.md'), join(destination, 'README.md'));
  await copyFile(join(root, 'releasing.md'), join(destination, 'releasing.md'));
  await copyFile(
    join(root, '../fleet/schema.json'),
    join(destination, 'schema.json')
  );
  await writeFile(
    join(destination, 'commands.json'),
    `${JSON.stringify({ version: 1, commands: indexedCommands() }, null, 2)}\n`
  );
  await writeFile(
    join(destination, 'package.json'),
    `${JSON.stringify(
      {
        name: '@crvouga/personal',
        version,
        description: manifest.description,
        type: 'module',
        bin: { personal: './cli.mjs' },
        engines: { node: '^22.13.0 || >=23.5.0' },
        files: [
          'cli.mjs',
          'probe.mjs',
          'schema.json',
          'commands.json',
          'README.md',
          'releasing.md',
        ],
        dependencies: manifest.dependencies,
        license: 'UNLICENSED',
        repository: {
          type: 'git',
          url: 'git+https://github.com/crvouga/personal.git',
          directory: 'packages/personal-cli',
        },
        publishConfig: {
          access: 'public',
          registry: 'https://registry.npmjs.org/',
        },
        personalCli: metadata,
      },
      null,
      2
    )}\n`
  );
  process.stdout.write(
    `Built @crvouga/personal@${version} in ${destination}\n`
  );
}

async function releaseMetadata() {
  const repository = fileURLToPath(new URL('../../..', import.meta.url));
  const revision = await runCommand(['git', 'rev-parse', 'HEAD'], {
    cwd: repository,
  });
  const dirty = await runCommand(['git', 'status', '--porcelain'], {
    cwd: repository,
  });
  return {
    contentHash: await contentHash(repository),
    ...(revision.ok && /^[a-f0-9]{40,64}\s*$/.test(revision.stdout)
      ? { sourceCommit: revision.stdout.trim() }
      : {}),
    dirty: !dirty.ok || Boolean(dirty.stdout.trim()),
  };
}

await build();
