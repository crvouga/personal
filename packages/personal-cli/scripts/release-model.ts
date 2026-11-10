import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import manifest from '../package.json';
import { ReleaseError } from './release-error';

export const PACKAGE = '@crvouga/personal';
export const REGISTRY = 'https://registry.npmjs.org';

export interface PublishedVersion {
  version: string;
  personalCli?: { contentHash?: string };
  dist?: { integrity?: string; tarball?: string };
}

export interface RegistryDocument {
  'dist-tags': { latest?: string };
  versions: Record<string, PublishedVersion>;
}

export interface ReleasePlan {
  version: 1;
  package: string;
  action: 'publish' | 'skip';
  current: string | null;
  next: string;
  contentHash: string;
}

async function sourceFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== '__pycache__')
      paths.push(...(await sourceFiles(root, path)));
    else if (
      entry.isFile() &&
      !entry.name.endsWith('.test.ts') &&
      entry.name !== 'test-fixtures.ts'
    )
      paths.push(path);
  }
  return paths;
}

export async function contentHash(root: string): Promise<string> {
  const files = [
    ...(await sourceFiles(root, 'packages/personal-cli/src')),
    ...(await sourceFiles(root, 'packages/fleet/src')),
    ...(await sourceFiles(root, 'scripts/dev')),
    ...(await sourceFiles(root, 'packages/workstation/cli')),
    ...(await sourceFiles(root, 'packages/fleet/agents')),
    ...(await sourceFiles(root, 'packages/cliproxy-fleet/scripts')),
    ...(await sourceFiles(root, 'packages/fleet/ubuntu')),
    ...(await sourceFiles(root, 'packages/fleet/monitoring')),
    'mise.toml',
    'mise.lock',
    'packages/personal-cli/package.json',
    'packages/personal-cli/README.md',
    'packages/personal-cli/releasing.md',
    'packages/personal-cli/scripts/build.ts',
    'packages/fleet/docs/ubuntu-sync.md',
    'packages/fleet/schema.json',
    'packages/fleet/definition.json',
    'packages/fleet/definition.schema.json',
    'packages/fleet/fleet.example.json',
  ].sort();
  const hash = createHash('sha256');
  for (const path of files) {
    const bytes = await readFile(join(root, path));
    hash.update(`${path}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function stableVersion(value: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new ReleaseError('Release requires a stable semver version.');
  const tuple = value.split('.').map(Number);
  if (tuple.some((part) => !Number.isSafeInteger(part)))
    throw new ReleaseError('Version is too large.');
  return tuple;
}

export function releasePlan(
  hash: string,
  doc: RegistryDocument | null
): ReleasePlan {
  const current = doc?.['dist-tags'].latest ?? null;
  const published = currentVersion(doc, current);
  if (current && !published)
    throw new ReleaseError('Registry latest tag has no corresponding version.');
  const unchanged = published?.personalCli?.contentHash === hash;
  return {
    version: 1,
    package: PACKAGE,
    action: unchanged ? 'skip' : 'publish',
    current,
    next: unchanged ? current! : nextVersion(current),
    contentHash: hash,
  };
}

function currentVersion(
  doc: RegistryDocument | null,
  current: string | null
): PublishedVersion | undefined {
  return current ? doc?.versions[current] : undefined;
}

function nextVersion(current: string | null): string {
  const base = stableVersion(manifest.version);
  if (!current) return manifest.version;
  const previous = stableVersion(current);
  const firstDifference = base.findIndex(
    (part, index) => part !== previous[index]
  );
  if (
    firstDifference >= 0 &&
    base[firstDifference]! > previous[firstDifference]!
  )
    return manifest.version;
  return `${previous[0]}.${previous[1]}.${previous[2]! + 1}`;
}

export async function registryDocument(
  request: typeof fetch = fetch
): Promise<RegistryDocument | null> {
  // npm metadata is cached for five minutes. Planning and post-publish reads
  // must not reuse the stale document fetched before publication.
  const url = new URL(`${REGISTRY}/${encodeURIComponent(PACKAGE)}`);
  url.searchParams.set('personal-release', randomUUID());
  const response = await request(url, {
    headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new ReleaseError(
      'Cannot read the public npm registry; publication state is unknown. Recheck the release plan before retrying.'
    );
  const doc = (await response.json()) as RegistryDocument;
  if (!doc.versions || !doc['dist-tags'])
    throw new ReleaseError('Unsupported registry response.');
  return doc;
}
