import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { command } from '../src/adapters/process.ts';
import { safeCode } from '../src/domain/errors.ts';
import { scopedCommand, shellQuote } from '../src/domain/commands.ts';
import { bindBitwarden } from '../src/domain/connection-config.ts';
import { parseConfig } from '../src/domain/config.ts';
import { workflowFixture } from './fixtures/workflow.ts';
import { createPlan, authorizePlan } from '../src/application/plans.ts';
import { applyOperation } from '../src/application/apply.ts';
import { recheckAuthDependencies } from '../src/application/auth-dependencies.ts';
void test('displayed state-directory commands preserve literal shell metacharacters and replace an old scope', () => {
  const path = "/private/user's $& $(printf injected) state";
  const result = spawnSync(
    '/bin/sh',
    ['-c', `printf '%s' ${shellQuote(path)}`],
    { encoding: 'utf8' }
  );
  assert.equal(result.stdout, path);
  const initial = scopedCommand('bun run password-manager recover OP', path);
  assert.equal(scopedCommand(initial, path), initial);
  const rebound = scopedCommand(initial, '/private/restored');
  assert.equal(
    rebound,
    "bun run password-manager --state-dir '/private/restored' recover OP"
  );
});
void test('subprocess credential-bearing stderr and generic browser errors cannot cross report boundaries', async () => {
  const canary = 'CREDENTIAL_NOTES_OTP_RESET_URL_CANARY';
  try {
    await command({
      executable: process.execPath,
      args: [
        '-e',
        "process.stdin.on('data',d=>{process.stderr.write(d);process.exit(1)})",
      ],
      input: canary,
    });
    assert.fail('expected failure');
  } catch (error) {
    assert.equal(safeCode(error), 'unavailable');
    assert.equal(String(error).includes(canary), false);
  }
  const f = workflowFixture();
  try {
    const plan = createPlan({ ...f.context, config: f.config, kind: 'rotate' });
    authorizePlan(f.state, plan.id, f.context.runtime);
    const result = await applyOperation(
      {
        ...f.context,
        site: async () => {
          throw new Error(canary);
        },
      },
      plan.operationIds[0]!
    );
    assert.equal(result.state, 'requires_user_action');
    assert.equal(
      JSON.stringify([
        result,
        f.state.list('actions'),
        f.state.list('events'),
      ]).includes(canary),
      false
    );
  } finally {
    f.close();
  }
});
void test('selected plans cannot silently target another vault identity or region', async () => {
  const f = workflowFixture();
  try {
    const config = bindBitwarden(parseConfig({ version: 1 }), {
      email: 'synthetic@example.test',
      server: 'https://vault.bitwarden.eu',
    });
    assert.equal(
      bindBitwarden(config, {}).bitwarden?.server,
      'https://vault.bitwarden.eu'
    );
    assert.throws(
      () => bindBitwarden(config, { email: 'other@example.test' }),
      /conflict/
    );
    const plan = createPlan({ ...f.context, config, kind: 'rotate' });
    authorizePlan(f.state, plan.id, f.context.runtime);
    const result = await applyOperation(
      {
        ...f.context,
        vaultIdentity: {
          email: 'other@example.test',
          server: 'https://vault.bitwarden.com',
        },
      },
      plan.operationIds[0]!
    );
    assert.equal(result.state, 'requires_user_action');
    assert.equal(f.submissions(), 0);
  } finally {
    f.close();
  }
});
void test('identity authentication changes request mailbox reauthorization while preserving downstream state', () => {
  const f = workflowFixture();
  try {
    const source = parseConfig({
      version: 1,
      sources: [{ id: 'mail', kind: 'gmail', identity: 'alice' }],
    }).sources[0]!;
    const account = f.state.get('accounts', f.accountId)!;
    f.state.put('accounts', {
      ...account,
      origin: 'https://accounts.google.com',
    });
    f.state.put('coverage', {
      id: 'mail',
      state: 'scanned',
      scanned: 1,
      discovered: 1,
      lastSuccess: f.clock.now,
      cursor: 'history-123',
      filters: '{}',
      error: null,
    });
    const plan = createPlan({
      ...f.context,
      config: f.config,
      kind: 'recovery-check',
    });
    const op = f.state.get('operations', plan.operationIds[0]!)!;
    const before = f.state.list('evidence');
    recheckAuthDependencies({ ...f.context, sources: [source] }, op);
    assert.equal(
      f.state.get('coverage', 'mail')?.state,
      'requires-user-action'
    );
    assert.equal(f.state.get('coverage', 'mail')?.cursor, 'history-123');
    assert.match(
      f.state.list('actions')[0]?.resume ?? '',
      /connect gmail --source mail/
    );
    assert.deepEqual(f.state.list('evidence'), before);
    assert.equal(f.state.get('operations', op.id)?.state, 'planned');
  } finally {
    f.close();
  }
});
