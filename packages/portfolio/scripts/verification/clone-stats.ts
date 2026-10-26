/**
 * Facts about other repositories, read from a shallow clone of their default
 * branch. Nothing in a clone is executed: files are listed through git and
 * `package.json` is parsed as data.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloneStats, MockingbirdStats } from '../../src/lib/verification';
import { countRepoCallSites, git, listRepoFiles } from './facts-git';
import { toRecord } from './json-fields';

/** Emulators are the direct children of `packages/service/`. */
const EMULATOR_MANIFEST = /^packages\/service\/[^/]+\/package\.json$/;
const WIP_DESCRIPTION = /work-in-progress|scaffold/i;
const PROPERTY_TEST = /\.property\.test\.ts$/;

export const withShallowClone = <T>(
  repo: string,
  read: (dir: string) => T
): T => {
  const parent = mkdtempSync(join(tmpdir(), 'portfolio-verification-'));
  const dir = join(parent, 'repo');
  try {
    execFileSync(
      'git',
      ['clone', '--quiet', '--depth', '1', `https://github.com/${repo}`, dir],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    return read(dir);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
};

const cloneStatsOf = (dir: string): CloneStats => {
  const tests = countRepoCallSites(dir);
  return {
    commit: git(dir, ['rev-parse', 'HEAD']).trim(),
    testFiles: tests.files,
    testCallSites: tests.callSites,
  };
};

export const readCloneStats = (repo: string): CloneStats =>
  withShallowClone(repo, cloneStatsOf);

type Manifest = {
  readonly path: string;
  readonly isPrivate: boolean;
  readonly description: string;
};

const readManifest = (dir: string, path: string): Manifest => {
  const json = toRecord(JSON.parse(readFileSync(join(dir, path), 'utf8')));
  if (json === null) throw new Error(`${path}: package.json is not an object`);
  const description = json['description'];
  return {
    path,
    isPrivate: json['private'] === true,
    description: typeof description === 'string' ? description : '',
  };
};

/**
 * Published packages are every non-private `package.json` in the clone;
 * emulators are the non-private ones directly under `packages/service/`; an
 * emulator is work-in-progress when its description says "work-in-progress"
 * or "scaffold" (any case).
 */
export const mockingbirdStatsOf = (dir: string): MockingbirdStats => {
  const files = listRepoFiles(dir);
  const published = files
    .filter((path) => path === 'package.json' || path.endsWith('/package.json'))
    .filter((path) => !path.split('/').includes('node_modules'))
    .map((path) => readManifest(dir, path))
    .filter((manifest) => !manifest.isPrivate);
  const emulators = published.filter((manifest) =>
    EMULATOR_MANIFEST.test(manifest.path)
  );
  return {
    ...cloneStatsOf(dir),
    publishedPackages: published.length,
    emulators: emulators.length,
    wipEmulators: emulators.filter((manifest) =>
      WIP_DESCRIPTION.test(manifest.description)
    ).length,
    propertyTestFiles: files.filter((path) => PROPERTY_TEST.test(path)).length,
  };
};

export const readMockingbirdStats = (repo: string): MockingbirdStats =>
  withShallowClone(repo, mockingbirdStatsOf);
