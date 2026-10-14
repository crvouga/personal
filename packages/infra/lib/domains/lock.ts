import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { asRecord } from '../health/context.js';
import { privateJson, readJson } from './files.js';

/** A local campaign lock supplements OpenTofu's remote state locking. */
export function campaignLock(repo: string): () => void {
  const root = join(repo, '.domain-migration');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'execution.lock');
  const guard = `${path}.guard`;
  // Serialize stale-lock recovery too. This directory exists for a synchronous
  // critical section only; another process must not race its inventory edits.
  try { mkdirSync(guard, { mode: 0o700 }); }
  catch { throw new Error('Another runner is acquiring the campaign lock; retry after it finishes'); }
  const owner = { pid: process.pid, host: hostname(), id: crypto.randomUUID(), startedAt: new Date().toISOString() };
  try {
    if (existsSync(path)) {
      const previous = asRecord(readJson(path));
      if (previous.host !== hostname() || !Number.isInteger(previous.pid) || Number(previous.pid) <= 0) throw new Error('Campaign lock belongs to another host or cannot be verified; refusing concurrent writes');
      let alive = true;
      try { process.kill(Number(previous.pid), 0); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw new Error(`Campaign already running as local PID ${String(previous.pid)}`);
      rmSync(path);
    }
    privateJson(path, owner);
  } finally { rmSync(guard, { recursive: true }); }
  const bytes = readFileSync(path, 'utf8');
  return () => { if (existsSync(path) && readFileSync(path, 'utf8') === bytes) rmSync(path); };
}
