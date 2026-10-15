import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeContext } from '../health/fixtures.test-support.js';
import { foundationInputs } from './inputs.js';
import { existingState } from './prerequisites.js';

describe('recovered OpenTofu inputs', () => {
  test('private foundation bundle loads only supported inputs and preserves structured Vault input bytes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'domain-inputs-'));
    try {
      mkdirSync(join(repo, '.domain-migration'));
      const path = join(repo, '.domain-migration/tofu-inputs.json');
      expect(foundationInputs(repo, {})).toEqual({});
      expect(() => foundationInputs(repo, { DOMAIN_TOFU_INPUTS_FILE: path })).toThrow('missing');
      const vault = '{ "secrets": {"dev": {"EXAMPLE": "preserved"}}, "admin_passwords": {} }';
      writeFileSync(path, JSON.stringify({ state_passphrase: 'original-test-passphrase', vault_inputs: vault, migration_ready: true, unrelated_secret: 'excluded' }), { mode: 0o600 });
      expect(foundationInputs(repo, {})).toEqual({ TF_VAR_state_passphrase: 'original-test-passphrase', TF_VAR_vault_inputs: vault, TF_VAR_migration_ready: 'true' });
      expect(foundationInputs(repo, { DOMAIN_TOFU_INPUTS_FILE: '.domain-migration/tofu-inputs.json' })).toEqual(foundationInputs(repo, {}));
      chmodSync(path, 0o644);
      expect(() => foundationInputs(repo, {})).toThrow('owner-only');
      chmodSync(path, 0o600);
      writeFileSync(path, 'private-malformed-input');
      expect(() => foundationInputs(repo, {})).toThrow('contents withheld');
      writeFileSync(path, JSON.stringify({ migration_ready: 'true' }));
      expect(() => foundationInputs(repo, {})).toThrow('contents withheld');
      const link = join(repo, 'linked-inputs.json');
      symlinkSync(path, link);
      expect(() => foundationInputs(repo, { DOMAIN_TOFU_INPUTS_FILE: link })).toThrow('owner-only');
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test('state reads preserve the deployed image and migration gate without overriding explicit inputs', async () => {
    const state = JSON.stringify({ values: {
      outputs: { vault_image_tag: { value: 'deployed-revision' } },
      root_module: { resources: [{ address: 'github_actions_variable.migration_ready', values: { value: 'true' } }] },
    } });
    const ctx = fakeContext({ fileExists: () => true, run: async () => ({ code: 0, stdout: state, stderr: '' }) });
    const env = await existingState(ctx);
    expect(env['TF_VAR_vault_image_tag']).toBe('deployed-revision');
    expect(env['TF_VAR_migration_ready']).toBe('true');
    expect(ctx.env['TF_VAR_vault_image_tag']).toBeUndefined();
    const explicit = await existingState({ ...ctx, env: { TF_VAR_vault_image_tag: 'explicit-revision', TF_VAR_migration_ready: 'false' } });
    expect(explicit['TF_VAR_vault_image_tag']).toBe('explicit-revision');
    expect(explicit['TF_VAR_migration_ready']).toBe('false');
  });
});
