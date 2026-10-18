// `bun run check:vault-inputs` — fails when the TOFU_VAULT_INPUTS Actions secret
// (exposed as TF_VAR_vault_inputs) lacks a field the inventory requires, which
// would otherwise only surface when the deploy's vault plan hits its
// precondition. Reports names only. Skips when the secret is unavailable
// (forked pull requests, local runs); `bun run vault:fix` repairs a failure.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findGaps, parseVaultInputs } from './vault-inputs/model';

const inventory = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '../packages/infra/tofu/modules/inventory/inventory.tf.json'
    ),
    'utf8'
  )
).locals.inventory;

const raw = process.env['TF_VAR_vault_inputs'];
if (!raw) {
  console.log(
    'TF_VAR_vault_inputs is not set; skipping the vault inputs check.'
  );
  process.exit(0);
}

const gaps = findGaps(parseVaultInputs(raw), inventory.vault.kv_keys);
if (gaps.length > 0) {
  console.error(
    `TOFU_VAULT_INPUTS is missing required fields the vault root needs:\n${gaps
      .map(
        ({ config, name, legacy }) =>
          `  ${config}.${name}${legacy ? ` (still stored as ${legacy.name})` : ''}`
      )
      .join('\n')}\nRun \`bun run vault:fix\` to repair them through OpenTofu.`
  );
  process.exit(1);
}
console.log('TOFU_VAULT_INPUTS has every required field.');
