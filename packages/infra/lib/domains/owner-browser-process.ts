import { execFileSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ownerBrowserEnvironment } from './owner-browser.js';

/** Fingerprint the dedicated profile process, never another Chrome instance. */
export function ownerBrowserPid(repo: string): number {
  const profile = join(repo, '.domain-migration/owner-chrome');
  const pid = Number(readlinkSync(join(profile, 'SingletonLock')).split('-').at(-1));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Dedicated Chrome profile has no live process');
  const read = (field: string) => execFileSync('/bin/ps', ['-p', String(pid), '-o', `${field}=`],
    { encoding: 'utf8', env: ownerBrowserEnvironment(), stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  if (read('comm') !== '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' || !`${read('args')} `.includes(`--user-data-dir=${profile} `)) {
    throw new Error('Dedicated Chrome process fingerprint changed');
  }
  return pid;
}

export async function releaseOwnerBrowser(repo: string, restart: boolean): Promise<boolean> {
  let pid: number;
  try { pid = ownerBrowserPid(repo); } catch { return true; }
  if (!restart) return false;
  // Explicit opt-in only. Never SIGKILL, terminate another profile or copy cookies.
  if (ownerBrowserPid(repo) !== pid) throw new Error('Owner browser changed before the approved restart');
  process.kill(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 150; attempt++) {
    await Bun.sleep(100);
    try { if (ownerBrowserPid(repo) !== pid) throw new Error('A different owner browser started during restart'); }
    catch (error) {
      if (error instanceof Error && error.message === 'A different owner browser started during restart') throw error;
      return true;
    }
  }
  throw new Error('Dedicated Chrome did not exit gracefully; no force termination attempted');
}
