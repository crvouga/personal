import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteState } from '../src/adapters/state.ts';
const worker = fileURLToPath(
  new URL('./fixtures/crash-worker.ts', import.meta.url)
);
function run(directory: string, mode: string, boundary = '') {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', worker, directory, mode, boundary],
    { timeout: 20_000 }
  );
}
void test('SIGKILL at persistent writes and external effects recovers one credential across processes', () => {
  for (const boundary of [
    'prerequisites_ready',
    'old-written',
    'replacement-written',
    'credential_staged',
    'change_submitting',
    'remote-write',
    'change_confirmed',
    'vault-write',
    'vault_updated',
    'login_verified',
    'completed',
  ]) {
    const directory = mkdtempSync(join(tmpdir(), 'password-manager-kill-'));
    try {
      assert.equal(run(directory, 'seed').status, 0);
      const stopped = run(directory, 'run', boundary);
      assert.equal(stopped.signal, 'SIGKILL', boundary);
      assert.equal(run(directory, 'run').status, 0, boundary);
      const state = new SqliteState(directory);
      try {
        assert.equal(
          state.get('operations', 'op')?.state,
          'completed',
          boundary
        );
      } finally {
        state.close();
      }
      const remote = JSON.parse(
        readFileSync(join(directory, 'remote.json'), 'utf8')
      ) as { password: string; submissions: number };
      const secrets = JSON.parse(
        readFileSync(join(directory, 'secrets.json'), 'utf8')
      ) as Record<string, string>;
      assert.equal(remote.submissions, 1, boundary);
      assert.equal(
        remote.password,
        secrets['operation/op/replacement'],
        boundary
      );
    } finally {
      rmSync(directory, { recursive: true });
    }
  }
});
void test('a live separate process holds its account lock; termination permits recovery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-lock-'));
  const holder = spawn(process.execPath, [
    '--import',
    'tsx',
    worker,
    directory,
    'hold',
  ]);
  try {
    await once(holder.stdout, 'data');
    const state = new SqliteState(directory);
    try {
      await assert.rejects(
        state.withLock('account:account', async () => {}),
        /busy/
      );
    } finally {
      state.close();
    }
    holder.kill('SIGKILL');
    await once(holder, 'exit');
    const recovered = new SqliteState(directory);
    try {
      await recovered.withLock('account:account', async () => {});
    } finally {
      recovered.close();
    }
  } finally {
    holder.kill('SIGKILL');
    rmSync(directory, { recursive: true });
  }
});
