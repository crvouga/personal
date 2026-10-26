/** Platform facts that come from git: test call sites and AI co-author trailers. */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_TOOLS,
  type AiCoAuthorTrailers,
} from '../../src/lib/platform-facts';
import { aiTrailersIn, countTestCallSites, isTestFile } from './classify';

const MAX_BUFFER = 512 * 1024 * 1024;

export const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * Files git would commit: tracked plus untracked-but-not-ignored, minus any
 * tracked file deleted from the working tree. Including untracked files keeps
 * the count stable across `git add`, so a new test file does not change the
 * number between generating the facts and committing them.
 */
export const listRepoFiles = (root: string): readonly string[] => {
  const output = git(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  const paths = new Set(output.split('\0').filter((path) => path !== ''));
  return [...paths].filter((path) => existsSync(join(root, path))).sort();
};

export type CallSiteCount = {
  readonly files: number;
  readonly callSites: number;
};

/** Counts `test(`/`it(` call sites across the test files of a checkout. */
export const countRepoCallSites = (root: string): CallSiteCount => {
  const files = listRepoFiles(root).filter(isTestFile);
  const callSites = files.reduce(
    (total, path) =>
      total + countTestCallSites(readFileSync(join(root, path), 'utf8')),
    0
  );
  return { files: files.length, callSites };
};

/**
 * Whether `ref` resolves and its full history is present. CI checks out with
 * depth 1, where `git log` would silently count a single commit.
 */
export const canCountHistory = (root: string, ref: string): boolean => {
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true')
      return false;
    git(root, ['cat-file', '-e', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

/**
 * `Co-Authored-By:` trailers naming Claude (any model) or Cursor in every
 * commit message reachable from `ref` (`git log --format=%B`). Each trailer
 * line counts once, so a commit naming both tools counts for both.
 */
export const countAiTrailers = (
  root: string,
  ref: string
): AiCoAuthorTrailers => {
  const asOfCommit = git(root, ['rev-parse', `${ref}^{commit}`]).trim();
  const tools = aiTrailersIn(git(root, ['log', '--format=%B', asOfCommit]));
  return {
    asOfCommit,
    asOfDate: git(root, ['show', '-s', '--format=%cI', asOfCommit]).trim(),
    commits: Number(git(root, ['rev-list', '--count', asOfCommit]).trim()),
    byTool: AI_TOOLS.map((tool) => ({
      tool,
      trailers: tools.filter((entry) => entry === tool).length,
    })),
  };
};
