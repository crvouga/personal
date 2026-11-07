import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Runner } from '../types';
import { ensurePrivateRoot } from './state';

const REPOSITORY = 'https://github.com/crvouga/personal.git';

/** Only called after approval, under the machine lock. Never uses the user's checkout. */
export async function prepareSource(
  root: string,
  revision: string,
  run: Runner
): Promise<string | null> {
  const source = join(root, 'source');
  await ensurePrivateRoot(source);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let origin = await run(['git', 'remote', 'get-url', 'origin'], {
    cwd: source,
  });
  if (!origin.ok) {
    const cloned = await run(
      [
        'git',
        'clone',
        '--no-checkout',
        '--origin',
        'origin',
        REPOSITORY,
        source,
      ],
      { timeoutMs: 120_000 }
    );
    if (!cloned.ok) return null;
    origin = await run(['git', 'remote', 'get-url', 'origin'], { cwd: source });
  }
  if (!origin.ok || origin.stdout.trim() !== REPOSITORY) return null;
  let found = await run(
    ['git', 'rev-parse', '--verify', `${revision}^{commit}`],
    { cwd: source }
  );
  if (!found.ok || found.stdout.trim() !== revision) {
    const fetch = await run(['git', 'fetch', '--no-tags', 'origin', revision], {
      cwd: source,
      timeoutMs: 120_000,
    });
    if (!fetch.ok) return null;
    found = await run(
      ['git', 'rev-parse', '--verify', `${revision}^{commit}`],
      { cwd: source }
    );
  }
  return found.ok && found.stdout.trim() === revision ? source : null;
}
