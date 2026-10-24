import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workflowFixture } from './fixtures/workflow.ts';
import { parseConfig } from '../src/domain/config.ts';
import { discover } from '../src/application/discover.ts';
import { coverageStatus } from '../src/application/report-status.ts';
import { cleanupExport } from '../src/application/export-cleanup.ts';
import { createPlan, authorizePlan } from '../src/application/plans.ts';
import { applyPlan } from '../src/application/apply.ts';
import { existsSync } from 'node:fs';

void test('bounded streaming MBOX and CSV discovery resume and repeated scans stay idempotent', async () => {
  const f = workflowFixture(false);
  try {
    const mbox = join(f.directory, 'synthetic.mbox');
    writeFileSync(
      mbox,
      [0, 1, 2]
        .map(
          (i) =>
            `From sender@example.test Mon Jan 1 00:00:00 2026\nFrom: sender@example.test\nTo: alice@example.test\nSubject: =?UTF-8?B?V2VsY29tZQ==?=\nMessage-ID: <${i}@example.test>\n\n${'x'.repeat(100000)}\n`
        )
        .join('')
    );
    const csv = join(f.directory, 'synthetic.csv');
    writeFileSync(
      csv,
      'name,url,username,password\n"name, quoted",https://one.example,alice,SECRET_ONE\ntwo,https://two.example,alice,SECRET_TWO\n'
    );
    const config = parseConfig({
      version: 1,
      sources: [
        { id: 'archive', kind: 'mbox', path: mbox, maxMessages: 1 },
        { id: 'csv', kind: 'csv', path: csv, maxMessages: 1 },
      ],
    });
    const scan = () =>
      discover({ ...f, config, context: { ...f.context, fetch } });
    assert.equal(coverageStatus(await scan()), 'partial');
    assert.equal(coverageStatus(await scan()), 'partial');
    assert.equal(coverageStatus(await scan()), 'completed');
    const count = f.state.list('evidence').length;
    assert.equal(count, 6);
    assert.equal(coverageStatus(await scan()), 'completed');
    assert.equal(f.state.list('evidence').length, count);
    assert.equal(
      JSON.stringify(f.state.list('evidence')).includes('SECRET_'),
      false
    );
    assert.equal(
      f.state
        .list('evidence')
        .filter((e) => e.sourceId === 'archive')
        .every((e) => !e.confirmed),
      true
    );
  } finally {
    f.close();
  }
});
void test('selected source-export cleanup requires complete verified migration and preserves encrypted candidates', async () => {
  const f = workflowFixture(false);
  try {
    const path = join(f.directory, 'export.csv');
    writeFileSync(
      path,
      'name,url,username,password\nfixture,https://example.test,alice,EXPORT_SECRET\n',
      { mode: 0o600 }
    );
    const config = parseConfig({
      version: 1,
      sources: [{ id: 'export', kind: 'csv', path }],
    });
    await assert.rejects(
      cleanupExport({ ...f, config, sourceId: 'export', apply: true }),
      /requires-user-action/
    );
    await discover({ ...f, config, context: { ...f.context, fetch } });
    await assert.rejects(
      cleanupExport({ ...f, config, sourceId: 'export', apply: true }),
      /requires-user-action/
    );
    const plan = createPlan({ ...f.context, config, kind: 'import' });
    authorizePlan(f.state, plan.id, f.context.runtime);
    // The fixture's unrelated unstaged evidence is deliberately excluded.
    for (const id of plan.operationIds) {
      const op = f.state.get('operations', id)!;
      if (op.evidenceId === 'evidence')
        f.state.put('operations', { ...op, state: 'cancelled' });
    }
    await applyPlan(f.context, plan.id);
    const preview = await cleanupExport({
      ...f,
      config,
      sourceId: 'export',
      apply: false,
    });
    assert.equal(preview.deleted, false);
    assert.equal(existsSync(path), true);
    await cleanupExport({ ...f, config, sourceId: 'export', apply: true });
    assert.equal(existsSync(path), false);
    const evidence = f.state
      .list('evidence')
      .find((e) => e.sourceId === 'export')!;
    assert.ok(await f.secrets.getRequired(evidence.candidateRef!));
  } finally {
    f.close();
  }
});
void test('native non-login transfers remain actionable after a successful repeated scan', async () => {
  const f = workflowFixture(false);
  try {
    const path = join(f.directory, 'export.json');
    writeFileSync(
      path,
      JSON.stringify({
        encrypted: false,
        items: [
          { id: 'note', type: 2, name: 'secret note', notes: 'NOTE_CANARY' },
        ],
      })
    );
    const config = parseConfig({
      version: 1,
      sources: [{ id: 'native', kind: 'bitwarden-json', path }],
    });
    const scan = () =>
      discover({ ...f, config, context: { ...f.context, fetch } });
    assert.equal(coverageStatus(await scan()), 'completed');
    assert.equal(
      f.state.list('actions').filter((a) => a.status === 'pending').length,
      1
    );
    assert.equal(coverageStatus(await scan()), 'completed');
    assert.equal(
      f.state.list('actions').filter((a) => a.status === 'pending').length,
      1
    );
    assert.equal(
      JSON.stringify(f.state.list('evidence')).includes('NOTE_CANARY'),
      false
    );
  } finally {
    f.close();
  }
});
void test('malformed/unterminated archives fail; changed snapshots restart rather than skipping new evidence', async () => {
  const f = workflowFixture(false);
  try {
    const path = join(f.directory, 'input.mbox');
    const config = parseConfig({
      version: 1,
      sources: [{ id: 'mail', kind: 'mbox', path }],
    });
    const scan = () =>
      discover({ ...f, config, context: { ...f.context, fetch } });
    for (const malformed of [
      'garbage',
      'From sender\nFrom: sender@test.example\nSubject: Welcome',
    ]) {
      writeFileSync(path, malformed);
      assert.equal(coverageStatus(await scan()), 'failed');
    }
    writeFileSync(
      path,
      'From sender\nFrom: sender@test.example\nSubject: Welcome\nMessage-ID: <valid@test.example>\n\nbody\n'
    );
    assert.equal(coverageStatus(await scan()), 'completed');
    writeFileSync(
      path,
      'From sender\nFrom: sender@test.example\nSubject: Welcome\nMessage-ID: <new@test.example>\n\nnew body\n'
    );
    assert.equal(coverageStatus(await scan()), 'completed');
    assert.equal(
      f.state.list('evidence').filter((e) => e.sourceId === 'mail').length,
      2
    );
  } finally {
    f.close();
  }
});
