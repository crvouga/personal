import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteState } from '../../src/adapters/state.ts';
import { fakeVault, MemorySecrets } from '../../src/testing/fakes.ts';
import type { WorkflowContext, VaultItem } from '../../src/domain/ports.ts';
import { stableId } from '../../src/domain/identity.ts';
import { parseConfig } from '../../src/domain/config.ts';
import { reconcile } from '../../src/application/reconcile.ts';
export function workflowFixture(withVault = true) {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-workflow-'));
  const state = new SqliteState(directory);
  const secrets = new MemorySecrets();
  const item = syntheticItem();
  const fake = fakeVault(withVault ? [item] : []);
  let counter = 0;
  const clock = { now: '2026-01-01T00:00:00.000Z' };
  let submissions = 0;
  let activePassword = 'CURRENT_PASSWORD';
  const context: WorkflowContext = {
    state,
    secrets,
    vault: fake.vault,
    runtime: {
      now: () => clock.now,
      id: () => `id-${counter++}`,
      password: () => 'REPLACEMENT_PASSWORD',
    },
    site: async () => ({
      origin: 'https://github.com',
      prepare: async () => 'ready',
      change: async (input) => {
        submissions++;
        activePassword = input.replacement;
        return 'confirmed';
      },
      verify: async (input) =>
        input.password === activePassword ? 'valid' : 'invalid',
      close: async () => {},
    }),
  };
  state.put('evidence', {
    id: 'evidence',
    sourceId: 'fixture',
    sourceRef: 'item',
    observedAt: clock.now,
    category: withVault ? 'vault' : 'export',
    origin: 'https://github.com',
    domain: 'github.com',
    username: 'alice',
    confirmed: true,
    reasons: [],
    vaultId: withVault ? 'vault' : null,
    candidateRef: 'candidate/source',
    unsupported: [],
    auth: 'password',
  });
  reconcile(state);
  return {
    directory,
    state,
    secrets,
    context,
    clock,
    fake,
    item,
    config: parseConfig({ version: 1 }),
    accountId: stableId('https://github.com', 'alice'),
    submissions: () => submissions,
    close: () => {
      state.close();
      rmSync(directory, { recursive: true });
    },
  };
}

function syntheticItem(): VaultItem {
  return {
    id: 'vault',
    type: 1,
    name: 'Synthetic',
    notes: 'CURRENT_NOTES',
    login: {
      username: 'alice',
      password: 'CURRENT_PASSWORD',
      uris: [{ uri: 'https://github.com' }],
    },
  };
}
