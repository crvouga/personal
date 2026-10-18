// The interactive flow behind `bun run vault:fix` (and the vault fixer of
// `bun run health:fix`): complete the foundation root's `vault_inputs`, plan a
// targeted OpenTofu change and apply it after confirmation.
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectEnvironment } from './environment';
import { completeInputs, loadCurrentInputs } from './inputs';
import {
  diffNames,
  TOFU_VAULT_INPUTS_ADDRESS,
  unexpectedChanges,
  updatesVaultInputs,
} from './model';
import { confirm } from './prompt';
import { capture, run } from './process';

const repo = join(import.meta.dirname, '../..');
const foundation = join(repo, 'packages/infra/tofu/foundation');
const inventory = JSON.parse(
  readFileSync(
    join(repo, 'packages/infra/tofu/modules/inventory/inventory.tf.json'),
    'utf8'
  )
).locals.inventory;
const PLAN = 'vault-inputs.tfplan';

/** A deliberate stop; callers decide whether it ends the process. */
export class Abort extends Error {}

function fail(message: string): never {
  throw new Abort(message);
}

async function initialize(env: Record<string, string>) {
  const account = env['TF_VAR_cloudflare_account_id'];
  writeFileSync(
    join(foundation, 'backend.backend.json'),
    JSON.stringify({
      bucket: 'crvouga-tofu-state',
      key: 'foundation.tfstate',
      region: 'auto',
      endpoints: { s3: `https://${account}.r2.cloudflarestorage.com` },
      skip_credentials_validation: true,
      skip_region_validation: true,
      skip_requesting_account_id: true,
      skip_metadata_api_check: true,
      use_path_style: true,
      use_lockfile: true,
    }),
    { mode: 0o600 }
  );
  const { code } = await run(
    [
      'tofu',
      `-chdir=${foundation}`,
      'init',
      '-input=false',
      '-lockfile=readonly',
      '-backend-config=backend.backend.json',
    ],
    { env }
  );
  if (code !== 0) fail('tofu init failed (check the state credentials above).');
}

async function planAndApply(
  env: Record<string, string>,
  inputsJson: string,
  dryRun: boolean
): Promise<boolean> {
  const tofu = (args: string[]) => ['tofu', `-chdir=${foundation}`, ...args];
  const planEnv = { ...env, TF_VAR_vault_inputs: inputsJson };
  try {
    const planned = await run(
      tofu([
        'plan',
        '-input=false',
        '-parallelism=1',
        `-target=${TOFU_VAULT_INPUTS_ADDRESS}`,
        `-out=${PLAN}`,
      ]),
      { env: planEnv }
    );
    if (planned.code !== 0) fail('tofu plan failed.');
    const shown = await capture(tofu(['show', '-json', PLAN]), {
      env: planEnv,
    });
    if (!shown) fail('Could not read the saved plan.');
    const plan = JSON.parse(shown);
    const extra = unexpectedChanges(plan);
    if (extra.length) {
      console.log(`\n! The plan also changes:\n  ${extra.join('\n  ')}`);
      if (!(await confirm('Apply these as well?', false))) fail('Stopped.');
    }
    if (!updatesVaultInputs(plan)) {
      console.log('\n✓ TOFU_VAULT_INPUTS already matches; nothing to apply.');
      return false;
    }
    if (dryRun) {
      console.log('\n--dry-run: stopping before apply.');
      return false;
    }
    if (
      !(await confirm(
        '\nApply this plan (updates the TOFU_VAULT_INPUTS secret)?'
      ))
    )
      fail('Stopped before apply.');
    const applied = await run(
      tofu(['apply', '-input=false', '-parallelism=1', PLAN]),
      { env: planEnv }
    );
    if (applied.code !== 0) fail('tofu apply failed.');
    return true;
  } finally {
    rmSync(join(foundation, PLAN), { force: true });
  }
}

export type VaultFixOptions = {
  dryRun: boolean;
  given: Record<string, string>;
};

/** Resolves true when the TOFU_VAULT_INPUTS secret was updated. */
export async function fixVaultInputs({
  dryRun,
  given,
}: VaultFixOptions): Promise<boolean> {
  if (!(await capture(['tofu', 'version'])))
    fail('Install OpenTofu 1.13.0 first.');

  console.log(
    'Collecting foundation inputs (existing env vars are used as-is)…'
  );
  const env = await collectEnvironment(given);
  await initialize(env);

  const tofu = (args: string[]) => ['tofu', `-chdir=${foundation}`, ...args];
  const { inputs, source } = await loadCurrentInputs(tofu, env).catch(
    (error: unknown) => fail(String(error))
  );
  console.log(`\nCurrent vault_inputs loaded from ${source}.`);

  const next = await completeInputs(inputs, inventory.vault.kv_keys);
  const { added, removed, changed } = diffNames(inputs, next);
  console.log('\nChanges to vault_inputs (names only):');
  console.log(`  add:    ${added.join(', ') || '—'}`);
  console.log(`  change: ${changed.join(', ') || '—'}`);
  console.log(`  remove: ${removed.join(', ') || '—'}`);
  if (!(await confirm('Plan this change?'))) fail('Stopped.');

  return planAndApply(env, JSON.stringify(next), dryRun);
}

export const infraRepo: string = inventory.github.infra_repo;
