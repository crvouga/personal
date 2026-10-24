import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteState } from '../src/adapters/state.ts';
import { fakeVault, MemorySecrets } from '../src/testing/fakes.ts';
import { sealDraft } from '../src/application/authorization.ts';
import { authorizePlan, newOperation } from '../src/application/plans.ts';
import { importCredential } from '../src/application/import.ts';
import { createBackup, verifyBackup } from '../src/application/backup.ts';
import { parseConfig } from '../src/domain/config.ts';
import { encryptBackup, decryptBackup } from '../src/adapters/backup-crypto.ts';
import type { WorkflowContext } from '../src/domain/ports.ts';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-import-'));
  const state = new SqliteState(directory);
  const secrets = new MemorySecrets();
  const fake = fakeVault([]);
  let counter = 0;
  const context: WorkflowContext = {
    state,
    secrets,
    vault: fake.vault,
    runtime: {
      now: () => '2026-01-01',
      id: () => `fixture-${counter++}`,
      password: () => 'UNUSED_SYNTHETIC',
    },
    site: async () => {
      throw new Error('not used');
    },
  };
  state.put('accounts', {
    id: 'account',
    origin: 'https://example.test',
    username: 'alice',
    confirmed: true,
    auth: 'password',
    identityProvider: null,
    evidenceIds: ['evidence'],
    vaultIds: [],
    credential: 'unknown',
    recovery: 'unknown',
    mfa: 'unknown',
    priority: 50,
  });
  state.put('evidence', {
    id: 'evidence',
    sourceId: 'export',
    sourceRef: 'row1',
    observedAt: '',
    category: 'export',
    origin: 'https://example.test',
    domain: 'example.test',
    username: 'alice',
    confirmed: true,
    reasons: [],
    vaultId: null,
    candidateRef: 'candidate/evidence',
    unsupported: [],
    auth: 'password',
  });
  state.put('plans', {
    id: 'plan',
    createdAt: '',
    operationIds: ['op'],
    authorizedAt: '2026-01-01',
    expiresAt: '2099-01-01',
    policy: 'selected',
  });
  state.put(
    'operations',
    newOperation({
      id: 'op',
      planId: 'plan',
      accountId: 'account',
      kind: 'import',
      vaultId: null,
      evidenceId: 'evidence',
    })
  );
  sealDraft(state, state.get('plans', 'plan')!);
  authorizePlan(state, 'plan', context.runtime);
  return {
    context,
    state,
    fake,
    secrets,
    directory,
    close: () => {
      state.close();
      rmSync(directory, { recursive: true });
    },
  };
}
void test('lost create acknowledgement reconciles operation marker without duplicate import', async () => {
  const f = fixture();
  try {
    await f.secrets.setSecret(
      'candidate/evidence',
      JSON.stringify({
        id: 'old-id',
        type: 1,
        name: 'Synthetic',
        notes: 'NOTES_CANARY',
        login: {
          username: 'alice',
          password: 'PASSWORD_CANARY',
          uris: [{ uri: 'https://example.test' }],
        },
      })
    );
    const create = f.fake.vault.create;
    f.fake.vault.create = async (item) => {
      await create(item);
      throw new Error('lost response');
    };
    await assert.rejects(importCredential(f.context, 'op'));
    assert.equal(f.fake.creates(), 1);
    assert.equal((await importCredential(f.context, 'op')).state, 'completed');
    assert.equal(f.fake.creates(), 1);
    assert.equal(f.state.list('accounts')[0]?.credential, 'stored');
  } finally {
    f.close();
  }
});
void test('encrypted backup verification is isolated from the active vault', async () => {
  const f = fixture();
  try {
    await f.secrets.setSecret(
      'candidate/evidence',
      JSON.stringify({ type: 1, login: { password: 'SECRET_CANARY' } })
    );
    await f.secrets.setSecret(
      'backup/independent-password',
      'INDEPENDENT_SYNTHETIC_BACKUP_PASSWORD'
    );
    const config = parseConfig({ version: 1 });
    const created = await createBackup({
      context: f.context,
      config,
      directory: f.directory,
    });
    const bytes = readFileSync(
      join(f.directory, 'backups', `${created.id}.pwm`)
    );
    assert.equal(bytes.includes(Buffer.from('SECRET_CANARY')), false);
    const verified = await verifyBackup({
      context: f.context,
      config,
      directory: f.directory,
      id: created.id,
    });
    assert.equal(verified.status, 'verified');
    assert.equal(f.fake.creates(), 0);
    assert.equal(f.fake.edits(), 0);
    const encrypted = await encryptBackup(
      'SYNTHETIC',
      'INDEPENDENT_SYNTHETIC_BACKUP_PASSWORD'
    );
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 1;
    await assert.rejects(
      decryptBackup(encrypted, 'INDEPENDENT_SYNTHETIC_BACKUP_PASSWORD'),
      /invalid-input/
    );
  } finally {
    f.close();
  }
});
