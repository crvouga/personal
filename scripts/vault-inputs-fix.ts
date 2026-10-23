// `bun run vault:fix` — interactive repair of the foundation root's
// `vault_inputs`, which OpenTofu publishes as the TOFU_VAULT_INPUTS Actions
// secret that CI feeds to the vault root. It collects what is missing, plans a
// targeted OpenTofu change, applies it after confirmation, then offers to re-run
// the failed CI run and the health report. OpenTofu stays the only writer; this
// script never calls a provider API or sets a secret itself.
//
// It first offers to run in GitHub Actions (maintenance.yml, task=vault-inputs), which can
// read the repo secrets this terminal cannot, and only prompts for whatever the
// workflow could not fill. `--ci` is that workflow's entry point.
//
//   bun run vault:fix [--env-file FILE] [--dry-run] [--from-vault NAME[,NAME]]
//
// `--from-vault` overwrites existing fields with the live Vault's values (e.g.
// after rotating the Google OAuth client there) instead of only filling blanks.
// Selecting RAILWAY_TOKEN also rotates its bootstrap Actions secret through
// the same saved OpenTofu plan, so CI uses the new token on subsequent runs.
import { readFileSync } from 'node:fs';
import { rerunFailedCi } from './vault-inputs/ci';
import {
  Abort,
  fixVaultInputs,
  fixVaultInputsUnattended,
  infraRepo,
} from './vault-inputs/flow';
import { confirm } from './vault-inputs/prompt';
import { run } from './vault-inputs/process';
import { parseEnv } from './vault-secrets-tfvars';

function fromVaultNames(args: string[]): string[] {
  const at = args.indexOf('--from-vault');
  if (at < 0) return [];
  const names = args[at + 1];
  if (!names) throw new Abort('--from-vault needs field names');
  return names.split(',').filter(Boolean);
}

function flags() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--env-file');
  const file = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0 && !file) throw new Abort('--env-file needs a path');
  return {
    dryRun: args.includes('--dry-run'),
    given: file ? parseEnv(readFileSync(file, 'utf8')) : {},
    fromVault: fromVaultNames(args),
  };
}

async function main() {
  if (process.argv.includes('--ci')) {
    await fixVaultInputsUnattended(
      process.argv.includes('--dry-run'),
      fromVaultNames(process.argv.slice(2))
    );
    return;
  }
  if (!process.stdin.isTTY)
    throw new Abort('Run this in an interactive terminal.');
  const options = flags();
  const applied = await fixVaultInputs(options);
  if (!applied && options.dryRun) return;
  if (await confirm('\nRe-run the failed CI run on main?', applied))
    await rerunFailedCi(infraRepo);
  if (await confirm('Run `bun run health` now?', false))
    await run(['bun', 'run', 'health']);
}

main().catch((error: unknown) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
