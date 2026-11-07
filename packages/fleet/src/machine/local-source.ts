import { isRevision } from './state';
import { resolve } from 'node:path';
import type { Runner } from '../types';

/** Use committed objects, never working-tree files, for an approved local branch. */
export async function approvedLocalSource(
  checkout: string,
  revision: string,
  run: Runner
): Promise<string | null> {
  const options = { cwd: checkout, timeoutMs: 10_000 };
  const top = await run(['git', 'rev-parse', '--show-toplevel'], options);
  if (!top.ok || resolve(top.stdout.trim()) !== resolve(checkout)) return null;
  const origin = await run(['git', 'remote', 'get-url', 'origin'], options);
  if (
    !origin.ok ||
    !/^(https:\/\/github\.com\/|git@github\.com:)crvouga\/personal(?:\.git)?$/.test(
      origin.stdout.trim()
    )
  )
    return null;
  const commit = await run(
    ['git', 'rev-parse', '--verify', `${revision}^{commit}`],
    options
  );
  return commit.ok && commit.stdout.trim() === revision ? checkout : null;
}

export async function localCheckoutRevision(
  checkout: string,
  run: Runner
): Promise<string | undefined> {
  const result = await run(['git', 'rev-parse', 'HEAD'], {
    cwd: checkout,
    timeoutMs: 10_000,
  });
  const revision = result.stdout.trim();
  if (!result.ok || !isRevision(revision)) return undefined;
  return (await approvedLocalSource(checkout, revision, run))
    ? revision
    : undefined;
}
