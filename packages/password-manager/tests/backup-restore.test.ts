import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workflowFixture } from './fixtures/workflow.ts';
import { createBackup, verifyBackup } from '../src/application/backup.ts';
import { restoreBackup } from '../src/application/backup-restore.ts';
import { MemorySecrets } from '../src/testing/fakes.ts';
import { readConfig } from '../src/adapters/config-file.ts';
import { parseConfig } from '../src/domain/config.ts';
import { decryptBackup, encryptBackup } from '../src/adapters/backup-crypto.ts';
import { SqliteState } from '../src/adapters/state.ts';
import { extractBackup } from '../src/application/backup-extract.ts';
const independentPassword = 'INDEPENDENT_SYNTHETIC_BACKUP_PASSWORD';
void test('restore validates config/staging and hydrates an isolated namespace without touching active vault/state', async () => {
  const f = workflowFixture();
  const restoreRoot = mkdtempSync(
    join(tmpdir(), 'password-manager-rehearsal-')
  );
  const isolatedSecrets = new MemorySecrets();
  try {
    f.fake.vault.folders = async () => [
      { id: 'folder', name: 'Private folder metadata' },
    ];
    await f.secrets.setSecret('candidate/source', JSON.stringify(f.item));
    await f.secrets.setSecret(f.config.backupPasswordRef, independentPassword);
    const config = parseConfig({
      ...f.config,
      sources: [{ id: 'mail', kind: 'eml', path: '/private/synthetic.eml' }],
      execution: { ...f.config.execution, autoApply: true },
    });
    const created = await createBackup({
      context: f.context,
      config,
      directory: f.directory,
    });
    const verified = await verifyBackup({
      context: f.context,
      config,
      directory: f.directory,
      id: created.id,
    });
    assert.equal(verified.stagedSecrets, 1);
    const before = f.state.list('accounts');
    const file = join(f.directory, 'backups', `${created.id}.pwm`);
    const transfer = join(restoreRoot, 'selected-sensitive-transfer.json');
    await extractBackup({
      file,
      password: independentPassword,
      destination: transfer,
    });
    assert.equal(
      JSON.parse(readFileSync(transfer, 'utf8')).items[0]?.login?.password,
      'CURRENT_PASSWORD'
    );
    assert.equal(
      JSON.parse(readFileSync(transfer, 'utf8')).folders[0]?.name,
      'Private folder metadata'
    );
    await assert.rejects(
      extractBackup({
        file,
        password: independentPassword,
        destination: transfer,
      })
    );
    const destination = join(restoreRoot, 'isolated');
    const result = await restoreBackup({
      file,
      password: independentPassword,
      destination,
      activeDirectory: f.directory,
      secretFactory: (service) => {
        assert.match(service, /^workspace\.password-manager\.restore\./);
        return isolatedSecrets;
      },
    });
    assert.equal(result.status, 'restored-isolated');
    const restoredConfig = readConfig(destination);
    assert.equal(restoredConfig.sources[0]?.id, 'mail');
    assert.equal(restoredConfig.execution.autoApply, false);
    assert.notEqual(restoredConfig.secretService, config.secretService);
    const restored = new SqliteState(destination);
    try {
      assert.deepEqual(restored.list('accounts'), before);
    } finally {
      restored.close();
    }
    assert.equal(
      (await isolatedSecrets.getRequired('candidate/source')).readSecretValue(),
      JSON.stringify(f.item)
    );
    assert.ok(
      (await isolatedSecrets.getRequired('restore/vault/0'))
        .readSecretValue()
        .includes('CURRENT_PASSWORD')
    );
    assert.deepEqual(f.state.list('accounts'), before);
    assert.equal(f.fake.creates(), 0);
    assert.equal(f.fake.edits(), 0);
    assert.equal(JSON.stringify(result).includes('CURRENT_PASSWORD'), false);
    assert.equal(
      (
        await restoreBackup({
          file,
          password: independentPassword,
          destination,
          activeDirectory: f.directory,
          secretFactory: () => {
            throw new Error('must not rewrite completed restore');
          },
        })
      ).status,
      'already-restored'
    );
    await assert.rejects(
      restoreBackup({
        file,
        password: independentPassword,
        destination: f.directory,
        activeDirectory: f.directory,
      }),
      /unsafe-path/
    );
  } finally {
    f.close();
    rmSync(restoreRoot, { recursive: true });
  }
});
void test('authenticated archive with missing referenced staging is rejected before any restore', async () => {
  const f = workflowFixture();
  try {
    await f.secrets.setSecret('candidate/source', JSON.stringify(f.item));
    await f.secrets.setSecret(f.config.backupPasswordRef, independentPassword);
    const created = await createBackup({
      context: f.context,
      config: f.config,
      directory: f.directory,
    });
    const file = join(f.directory, 'backups', `${created.id}.pwm`);
    const payload = JSON.parse(
      await decryptBackup(readFileSync(file), independentPassword)
    ) as { staging: Record<string, string> };
    delete payload.staging['candidate/source'];
    writeFileSync(
      file,
      await encryptBackup(JSON.stringify(payload), independentPassword)
    );
    await assert.rejects(
      verifyBackup({
        context: f.context,
        config: f.config,
        directory: f.directory,
        id: created.id,
      }),
      /invalid-input/
    );
  } finally {
    f.close();
  }
});
