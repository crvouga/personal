// The interactive flow behind `bun run vault:fix` (and the vault fixer of
// `bun run health:fix`): complete the foundation root's `vault_inputs`, plan a
// targeted OpenTofu change and apply it after confirmation.
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repairInActions, VAULT_FIX_WORKFLOW } from './ci';
import { collectEnvironment } from './environment';
import { completeInputs, loadCurrentInputs } from './inputs';
import { readLiveVault } from './live';
import {
  autoFills,
  diffNames,
  findGaps,
  legacyPresent,
  parseVaultInputs,
  withFills,
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
  { dryRun, unattended }: { dryRun: boolean; unattended: boolean }
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
      if (unattended) fail('Refusing to apply unrelated changes unattended.');
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
      !unattended &&
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
  if (
    !dryRun &&
    (await capture([
      'gh',
      'workflow',
      'view',
      VAULT_FIX_WORKFLOW,
      '--repo',
      infraRepo,
    ])) !== undefined &&
    (await confirm(
      'Repair in GitHub Actions? It reads the repo secrets itself, so there is nothing to type.'
    ))
  ) {
    if (await repairInActions(infraRepo)) return true;
    console.log('The Actions repair did not finish; continuing locally.');
  }

  if (!(await capture(['tofu', 'version'])))
    fail('Install OpenTofu 1.13.0 first.');

  console.log(
    'Collecting foundation inputs (existing env vars are used as-is)…'
  );
  const live = (await readLiveVault()) ?? {};
  if (Object.keys(live).length)
    console.log('Using your Vault login to pre-fill credentials (prd).');
  const env = await collectEnvironment(given, live);
  await initialize(env);

  const tofu = (args: string[]) => ['tofu', `-chdir=${foundation}`, ...args];
  const { inputs, source } = await loadCurrentInputs(tofu, env).catch(
    (error: unknown) => fail(String(error))
  );
  console.log(`\nCurrent vault_inputs loaded from ${source}.`);

  const next = await completeInputs(inputs, inventory.vault.kv_keys, live);
  const { added, removed, changed } = diffNames(inputs, next);
  console.log('\nChanges to vault_inputs (names only):');
  console.log(`  add:    ${added.join(', ') || '—'}`);
  console.log(`  change: ${changed.join(', ') || '—'}`);
  console.log(`  remove: ${removed.join(', ') || '—'}`);
  if (!(await confirm('Plan this change?'))) fail('Stopped.');

  return planAndApply(env, JSON.stringify(next), { dryRun, unattended: false });
}

/**
 * Unattended repair for GitHub Actions, where the repo secrets are already in
 * the environment (the API never returns them). Fills only what needs no
 * operator, from the renamed fields and the live prd Vault; anything left needs
 * a person, so the run fails naming it rather than guessing. The caller has
 * initialized the foundation root.
 */
export async function fixVaultInputsUnattended(
  dryRun: boolean
): Promise<boolean> {
  const live = (await readLiveVault()) ?? {};
  console.log(
    `Live prd Vault: ${Object.keys(live).length ? 'readable' : 'unavailable'}.`
  );
  const raw = process.env['TF_VAR_vault_inputs'];
  if (!raw)
    fail('TF_VAR_vault_inputs (the TOFU_VAULT_INPUTS secret) is empty.');
  const inputs = parseVaultInputs(raw);
  const gaps = findGaps(inputs, inventory.vault.kv_keys);
  const { fills, unresolved } = autoFills(gaps, live);
  if (unresolved.length)
    fail(
      `No automatic source for: ${unresolved.map((gap) => `${gap.config}.${gap.name}`).join(', ')}.\n` +
        'Supply them with `bun run vault:fix` from a terminal.'
    );
  const next = withFills(inputs, fills, legacyPresent(inputs).length > 0);
  const { added, removed, changed } = diffNames(inputs, next);
  console.log('Changes to vault_inputs (names only):');
  console.log(`  add:    ${added.join(', ') || '—'}`);
  console.log(`  change: ${changed.join(', ') || '—'}`);
  console.log(`  remove: ${removed.join(', ') || '—'}`);
  return planAndApply(
    process.env as Record<string, string>,
    JSON.stringify(next),
    {
      dryRun,
      unattended: true,
    }
  );
}

export const infraRepo: string = inventory.github.infra_repo;
