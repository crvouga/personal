import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteState } from '../src/adapters/state.ts';
import { assertPrivateLocation, repoRoot } from '../src/adapters/paths.ts';

void test('SQLite transactions, two-process-equivalent owners and stale locks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-state-'));
  const first = new SqliteState(directory);
  const second = new SqliteState(directory);
  try {
    assert.equal(statSync(join(directory, 'workflow.sqlite')).mode & 0o077, 0);
    assert.throws(() =>
      first.transaction(() => {
        first.put('runs', {
          id: 'rollback',
          createdAt: '',
          planId: null,
          state: 'running',
          cancelled: false,
        });
        throw new Error('rollback');
      })
    );
    assert.equal(second.get('runs', 'rollback'), null);
    await first.withLock('account:x', async () => {
      await assert.rejects(
        second.withLock('account:x', async () => {}),
        /busy/
      );
    });
    await second.withLock('account:x', async () => {});
    assert.equal(
      second.db.prepare('SELECT count(*) AS n FROM locks').get()?.['n'],
      0
    );
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true });
  }
});
void test('private state refuses checkout and synchronized folders', () => {
  assert.throws(
    () => assertPrivateLocation(join(repoRoot, 'state')),
    /unsafe-path/
  );
  assert.throws(
    () => assertPrivateLocation(join(tmpdir(), 'Dropbox', 'state')),
    /unsafe-path/
  );
});
void test('future SQLite versions are refused by both writable and read-only callers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-version-'));
  const state = new SqliteState(directory);
  state.db.exec('PRAGMA user_version=999');
  state.close();
  try {
    assert.throws(() => new SqliteState(directory), /wrong-version/);
    assert.throws(() => new SqliteState(directory, true), /wrong-version/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
