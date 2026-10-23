import { expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { before, fills, inventory, fakeUi } from './fixtures';
import { stages, updateInputs } from './model';
import { TOFU_VAULT_INPUTS_ADDRESS } from '../vault-inputs/model';
import { TofuSession } from './session';
import { command, type Command } from './command';

const next = updateInputs(before, fills, inventory.vault.kv_keys);
const steps = stages(next, fills, inventory);

function provider(failState?: string) {
  const calls: { args: string[]; state: string }[] = [];
  const directories = new Set<string>();
  const plans = new Map<string, unknown>();
  const execute: Command = async (args, env) => {
    const directory = env.TF_DATA_DIR ? dirname(env.TF_DATA_DIR) : '';
    const state = directory.split('/').at(-1) ?? '';
    calls.push({ args, state });
    if (args.includes('version'))
      return JSON.stringify({ terraform_version: '1.13.0' });
    directories.add(dirname(directory));
    if (args.includes('init')) {
      const file = args
        .find((arg) => arg.startsWith('-backend-config='))!
        .slice(16);
      expect(JSON.parse(readFileSync(file, 'utf8')).key).toBe(
        `${state}.tfstate`
      );
      return '';
    }
    if (args.includes('state'))
      return steps.find((step) => step.state === state)!.addresses.join('\n');
    if (args.includes('plan')) {
      const step = steps.find((step) => step.state === state)!;
      const file = args.find((arg) => arg.startsWith('-var-file='))!.slice(10);
      const vars = JSON.parse(readFileSync(file, 'utf8'));
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(args).toContain('-parallelism=1');
      expect(args.join(' ')).not.toContain('GOCSPX-');
      const entries = step.addresses.map((address) => {
        let old: Record<string, unknown>;
        let after: Record<string, unknown>;
        if (state === 'foundation') {
          old = { value: JSON.stringify(before) };
          after = { value: vars.vault_inputs };
        } else if (state === 'vault') {
          const config = address.endsWith('["prd"]') ? 'prd' : 'dev';
          old = {
            data_json: JSON.stringify({
              ...before.secrets[config],
              VAULT_TOKEN: 'keep-managed',
            }),
          };
          after = {
            data_json: JSON.stringify({
              ...vars.secrets[config],
              VAULT_TOKEN: 'keep-managed',
            }),
          };
          expect(vars.fleet_age_keys).toEqual(before.fleet_age_keys);
          expect(vars.admin_passwords).toEqual(before.admin_passwords);
        } else {
          old = { realm: state, client_id: 'old', client_secret: 'old-secret' };
          after = {
            ...old,
            client_id: vars.google_client_id,
            client_secret: vars.google_client_secret,
          };
        }
        return { address, change: { actions: ['update'], before: old, after } };
      });
      const path = args.find((arg) => arg.startsWith('-out='))!.slice(5);
      plans.set(path, { resource_changes: entries });
      writeFileSync(path, 'encrypted-fixture');
      return '';
    }
    if (args.includes('show')) {
      const plan = plans.get(args.at(-1)!);
      return JSON.stringify(
        plan ?? {
          values: {
            root_module: {
              resources: [
                {
                  address: TOFU_VAULT_INPUTS_ADDRESS,
                  values: { value: JSON.stringify(before) },
                },
              ],
            },
          },
        }
      );
    }
    if (args.includes('apply')) {
      expect(existsSync(args.at(-1)!)).toBe(true);
      expect(plans.has(args.at(-1)!)).toBe(true);
      expect(args.some((arg) => arg.startsWith('-var'))).toBe(false);
      if (state === failState) throw new Error('Simulated provider outage');
      return '';
    }
    throw new Error('Unexpected test command');
  };
  return { execute, calls, directories };
}

const credentials = async () => ({
  TF_VAR_cloudflare_account_id: 'fixture-account',
  TF_VAR_state_passphrase: 'fixture-passphrase-at-least-32-characters',
});

test('applies reviewed saved plans in source → Vault → per-environment Google order, then removes private files', async () => {
  const fake = provider();
  const ui = fakeUi();
  const session = new TofuSession(inventory, ui, fake.execute, credentials);
  try {
    expect(await session.load()).toEqual(before);
    await session.update(before, next, fills, false);
    expect(
      fake.calls
        .filter((call) => call.args.includes('apply'))
        .map((call) => call.state)
    ).toEqual(['foundation', 'vault', 'auth-production', 'auth-nonproduction']);
    expect(ui.messages.join('\n')).not.toContain('GOCSPX-');
  } finally {
    session.close();
  }
  for (const path of fake.directories) expect(existsSync(path)).toBe(false);
});

test('dry-run plans all stages and never calls apply', async () => {
  const fake = provider();
  const session = new TofuSession(
    inventory,
    fakeUi(),
    fake.execute,
    credentials
  );
  try {
    await session.load();
    await session.update(before, next, fills, true);
    expect(
      fake.calls.filter((call) => call.args.includes('plan'))
    ).toHaveLength(4);
    expect(fake.calls.some((call) => call.args.includes('apply'))).toBe(false);
  } finally {
    session.close();
  }
});

test('a later apply failure reports persisted progress and never starts subsequent Google applies', async () => {
  const fake = provider('vault');
  const ui = fakeUi();
  const session = new TofuSession(inventory, ui, fake.execute, credentials);
  try {
    await session.load();
    await expect(session.update(before, next, fills, false)).rejects.toThrow(
      'provider outage'
    );
    expect(fake.calls.some((call) => call.state.startsWith('auth-'))).toBe(
      false
    );
    expect(ui.messages.join('\n')).toContain(
      'Completed: Save managed inputs in GitHub'
    );
    expect(ui.messages.join('\n')).toContain('same values');
  } finally {
    session.close();
  }
});

test('declining a saved plan never applies it', async () => {
  const fake = provider();
  const session = new TofuSession(
    inventory,
    fakeUi({ confirm: async () => false }),
    fake.execute,
    credentials
  );
  try {
    await session.load();
    await expect(session.update(before, next, fills, false)).rejects.toThrow(
      'Stopped'
    );
    expect(fake.calls.some((call) => call.args.includes('apply'))).toBe(false);
  } finally {
    session.close();
  }
});

test('command failures do not echo provider stdout, stderr or secret values', async () => {
  try {
    await command(
      [
        process.execPath,
        '-e',
        'console.log("private-stdout"); console.error("private-stderr"); process.exit(1)',
      ],
      {}
    );
    throw new Error('Expected command failure');
  } catch (error) {
    expect(String(error)).toContain('exit 1');
    expect(String(error)).not.toContain('private-stdout');
    expect(String(error)).not.toContain('private-stderr');
  }
});
