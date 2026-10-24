// Synthetic process-crash fixture. Never used by the production CLI.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SecretString, type SecretStore } from '@pkgs/secret-store';
import { SqliteState } from '../../src/adapters/state.ts';
import { rotate } from '../../src/application/rotate.ts';
import { sealDraft } from '../../src/application/authorization.ts';
import { authorizePlan, newOperation } from '../../src/application/plans.ts';
import type {
  Vault,
  VaultItem,
  WorkflowContext,
} from '../../src/domain/ports.ts';
const directory = process.argv[2]!;
const mode = process.argv[3]!;
const boundary = process.argv[4];
const state = new SqliteState(directory);
function path(name: string): string {
  return join(directory, `${name}.json`);
}
function read<T>(name: string): T {
  return JSON.parse(readFileSync(path(name), 'utf8')) as T;
}
function write(name: string, value: unknown): void {
  writeFileSync(path(name), JSON.stringify(value), { mode: 0o600 });
}
function crash(at: string): void {
  if (boundary === at) process.kill(process.pid, 'SIGKILL');
}
const secrets: SecretStore = {
  getRequired: async (name) =>
    new SecretString(
      'synthetic',
      read<Record<string, string>>('secrets')[name]!
    ),
  getOptional: async (name) => {
    const value = read<Record<string, string>>('secrets')[name];
    return value ? new SecretString('synthetic', value) : null;
  },
  getRequiredMany: async () => {
    throw new Error('unused');
  },
  getOptionalMany: async () => {
    throw new Error('unused');
  },
  setSecret: async (name, value) => {
    write('secrets', {
      ...read<Record<string, string>>('secrets'),
      [name]: value,
    });
    crash(
      name.endsWith('/replacement') ? 'replacement-written' : 'old-written'
    );
  },
};
const vault: Vault = {
  status: async () => ({ serverUrl: '', userEmail: null, status: '' }),
  list: async () => [read<VaultItem>('vault')],
  get: async () => read<VaultItem>('vault'),
  create: async () => {
    throw new Error('unused');
  },
  edit: async (item) => {
    write('vault', item);
    crash('vault-write');
    return item;
  },
  sync: async () => {},
  health: async () => [],
};
const context: WorkflowContext = {
  state,
  secrets,
  vault,
  runtime: {
    now: () => '2026-01-01',
    id: () => crypto.randomUUID(),
    password: () => crypto.randomUUID() + '!aA9',
  },
  checkpoint: (current) => crash(current),
  site: async () => ({
    origin: 'https://github.com',
    prepare: async () => 'ready',
    change: async (input) => {
      const previous = read<{ password: string; submissions: number }>(
        'remote'
      );
      write('remote', {
        password: input.replacement,
        submissions: previous.submissions + 1,
      });
      crash('remote-write');
      return 'confirmed';
    },
    verify: async (input) =>
      input.password === read<{ password: string }>('remote').password
        ? 'valid'
        : 'invalid',
    close: async () => {},
  }),
};
function seed(): void {
  write('secrets', {});
  write('remote', { password: 'SYNTHETIC_OLD', submissions: 0 });
  write('vault', {
    id: 'vault',
    type: 1,
    name: 'Synthetic',
    login: {
      username: 'alice',
      password: 'SYNTHETIC_OLD',
      uris: [{ uri: 'https://github.com' }],
    },
  });
  state.put('accounts', {
    id: 'account',
    origin: 'https://github.com',
    username: 'alice',
    confirmed: true,
    auth: 'password',
    identityProvider: null,
    evidenceIds: [],
    vaultIds: ['vault'],
    credential: 'stored',
    recovery: 'unknown',
    mfa: 'unknown',
    priority: 50,
  });
  state.put('plans', {
    id: 'plan',
    operationIds: ['op'],
    authorizedAt: '2026-01-01',
    createdAt: '',
    expiresAt: '2099-01-01',
    policy: 'selected',
  });
  state.put(
    'operations',
    newOperation({
      id: 'op',
      planId: 'plan',
      accountId: 'account',
      kind: 'rotate',
      vaultId: 'vault',
      evidenceId: null,
    })
  );
  sealDraft(state, state.get('plans', 'plan')!);
  authorizePlan(state, 'plan', context.runtime);
}
if (mode === 'seed') seed();
else if (mode === 'hold')
  await state.withLock('account:account', async () => {
    process.stdout.write('ready\n');
    await new Promise(() => {});
  });
else await rotate(context, 'op');
state.close();
