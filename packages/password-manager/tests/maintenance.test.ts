import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { schedule, scheduleDefinition } from '../src/adapters/schedule.ts';
import { maintenanceReport } from '../src/application/maintenance-report.ts';
import { workflowFixture } from './fixtures/workflow.ts';
import { ManagerError } from '../src/domain/errors.ts';
import { pruneBackups } from '../src/application/backup-retention.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
void test('launchd and systemd installation/status/removal are idempotent and use owned exact paths', async () => {
  for (const platform of ['darwin', 'linux']) {
    const f = workflowFixture();
    try {
      let active = false;
      const calls: string[][] = [];
      const host = {
        platform,
        home: f.directory,
        uid: 501,
        execute: async (input: { executable: string; args?: string[] }) => {
          const args = input.args ?? [];
          calls.push([input.executable, ...args]);
          if (args.some((a) => ['print', 'is-active'].includes(a)) && !active)
            throw new ManagerError('unavailable');
          if (args.some((a) => ['bootstrap', 'enable'].includes(a)))
            active = true;
          if (args.some((a) => ['bootout', 'disable'].includes(a)))
            active = false;
          return '';
        },
      };
      const input = {
        cli: '/owned/repository with spaces/bin.mjs',
        directory: f.directory,
        hour: 9,
      };
      const definition = scheduleDefinition({
        ...input,
        platform,
        home: f.directory,
      });
      assert.equal(
        (await schedule({ ...input, action: 'status' }, host)).installed,
        false
      );
      await schedule({ ...input, action: 'install' }, host);
      assert.equal(
        (await schedule({ ...input, action: 'status' }, host)).installed,
        true
      );
      const modified = statSync(definition.files[0]!.path).mtimeMs;
      await schedule({ ...input, action: 'install' }, host);
      assert.equal(statSync(definition.files[0]!.path).mtimeMs, modified);
      assert.equal(
        calls.filter((a) => a.includes('bootstrap') || a.includes('enable'))
          .length,
        1
      );
      assert.equal(
        definition.files.some((file) =>
          file.content.includes('/owned/repository with spaces/bin.mjs')
        ),
        true
      );
      await schedule({ ...input, action: 'remove' }, host);
      await schedule({ ...input, action: 'remove' }, host);
      assert.equal(existsSync(definition.files[0]!.path), false);
      assert.equal(
        calls.filter((a) => a.includes('bootout') || a.includes('disable'))
          .length,
        1
      );
      assert.equal(
        calls.every(
          (a) =>
            a[0] ===
            (platform === 'darwin' ? '/bin/launchctl' : '/usr/bin/systemctl')
        ),
        true
      );
    } finally {
      f.close();
    }
  }
});
void test('backup retention previews and preserves the two newest verified snapshots plus unverified backups', async () => {
  const f = workflowFixture();
  try {
    mkdirSync(join(f.directory, 'backups'), { mode: 0o700 });
    for (const [id, date, verified] of [
      ['newest', '2026-01-01', true],
      ['newer', '2025-12-31', true],
      ['old', '2025-01-01', true],
      ['unverified', '2024-01-01', false],
    ] as const) {
      f.state.put('backups', {
        id,
        createdAt: date,
        digest: 'fixture',
        verifiedAt: verified ? date : null,
        vaultItems: 0,
      });
      writeFileSync(
        join(f.directory, 'backups', id + '.pwm'),
        'synthetic-container',
        { mode: 0o600 }
      );
    }
    assert.deepEqual(
      await pruneBackups({
        ...f.context,
        config: f.config,
        directory: f.directory,
        apply: false,
      }),
      ['old']
    );
    assert.equal(existsSync(join(f.directory, 'backups', 'old.pwm')), true);
    await pruneBackups({
      ...f.context,
      config: f.config,
      directory: f.directory,
      apply: true,
    });
    assert.equal(existsSync(join(f.directory, 'backups', 'old.pwm')), false);
    assert.equal(f.state.list('backups').length, 3);
    assert.ok(f.state.get('backups', 'unverified'));
  } finally {
    f.close();
  }
});
void test('maintenance persists summaries and deduplicates backup actions/notifications', () => {
  const f = workflowFixture();
  try {
    const first = maintenanceReport({
      ...f.context,
      config: f.config,
      status: 'requires-user-action',
    });
    assert.equal(first.backupFresh, false);
    assert.equal(first.notificationChanged, true);
    f.clock.now = '2026-01-01T01:00:00.000Z';
    const second = maintenanceReport({
      ...f.context,
      config: f.config,
      status: 'requires-user-action',
    });
    assert.equal(second.notificationChanged, false);
    assert.equal(f.state.list('actions').length, 1);
    f.state.put('backups', {
      id: 'backup',
      createdAt: f.clock.now,
      digest: 'synthetic',
      verifiedAt: f.clock.now,
      vaultItems: 1,
    });
    f.clock.now = '2026-01-01T02:00:00.000Z';
    const fresh = maintenanceReport({
      ...f.context,
      config: f.config,
      status: 'completed',
    });
    assert.equal(fresh.backupFresh, true);
    assert.equal(f.state.list('actions')[0]?.status, 'resolved');
    assert.equal(f.state.list('maintenance').length, 3);
    assert.equal(
      JSON.stringify(f.state.list('maintenance')).includes('CURRENT_PASSWORD'),
      false
    );
    assert.ok(join(f.directory, 'workflow.sqlite'));
  } finally {
    f.close();
  }
});
