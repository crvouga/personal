import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteState } from '../adapters/state.ts';
import { MemorySecrets, fakeVault } from '../testing/fakes.ts';
import { runtime } from '../adapters/runtime.ts';
import { parseConfig } from '../domain/config.ts';
import { discover } from './discover.ts';
import { createPlan, authorizePlan } from './plans.ts';
import { applyPlan } from './apply.ts';
import type { WorkflowContext } from '../domain/ports.ts';
export async function demo() {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-demo-'));
  const state = new SqliteState(directory);
  const secrets = new MemorySecrets();
  const { vault } = fakeVault([]);
  const path = join(directory, 'synthetic.csv');
  writeFileSync(
    path,
    'name,url,username,password\nSynthetic,https://github.com,synthetic-user,SYNTHETIC_ONLY\n',
    { mode: 0o600 }
  );
  const config = parseConfig({
    version: 1,
    sources: [{ id: 'synthetic-export', kind: 'csv', path }],
  });
  let activePassword = 'SYNTHETIC_ONLY';
  const context: WorkflowContext = {
    state,
    secrets,
    vault,
    runtime,
    site: async () => ({
      origin: 'https://github.com',
      prepare: async () => 'ready',
      change: async (input) => {
        activePassword = input.replacement;
        return 'confirmed';
      },
      verify: async (input) =>
        input.password === activePassword ? 'valid' : 'invalid',
      close: async () => {},
    }),
  };
  try {
    const coverage = await discover({
      config,
      state,
      context: { ...context, fetch },
    });
    const imported = await selected(context, config, 'import');
    const rotated = await selected(context, config, 'rotate');
    return {
      mode: 'synthetic-only-no-network-or-OS-secrets',
      coverage,
      imported,
      rotated,
      accounts: state.list('accounts'),
      operations: state.list('operations'),
    };
  } finally {
    state.close();
    rmSync(directory, { recursive: true });
  }
}
async function selected(
  context: WorkflowContext,
  config: ReturnType<typeof parseConfig>,
  kind: 'import' | 'rotate'
) {
  const plan = createPlan({ ...context, config, kind });
  authorizePlan(context.state, plan.id, context.runtime);
  return applyPlan(context, plan.id);
}
