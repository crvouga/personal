// Interactive half of the model: find the current `vault_inputs`, then ask for
// whatever it is missing.
import { readFileSync } from 'node:fs';
import { problemsFor } from '../../packages/infra/lib/health/secret-rules';
import type { KvKey } from '../vault-secrets-tfvars';
import {
  findGaps,
  inputsFromState,
  legacyPresent,
  parseVaultInputs,
  withFills,
  type Fill,
  type Gap,
  type VaultInputs,
} from './model';
import { ask, askSecret, confirm } from './prompt';
import { capture } from './process';

export async function loadCurrentInputs(
  tofu: (args: string[]) => string[],
  env: Record<string, string>
): Promise<{ inputs: VaultInputs; source: string }> {
  const fromEnv = process.env['TF_VAR_vault_inputs'];
  if (fromEnv)
    return { inputs: parseVaultInputs(fromEnv), source: 'TF_VAR_vault_inputs' };

  const state = await capture(tofu(['show', '-json']), { env });
  const recorded = state && inputsFromState(JSON.parse(state));
  if (recorded)
    return { inputs: parseVaultInputs(recorded), source: 'OpenTofu state' };

  console.log(
    'The state does not record the current vault_inputs. Point at a JSON file\n' +
      'with the complete {"secrets": {"dev","prd"}, "admin_passwords"} map.'
  );
  for (;;) {
    const path = await ask('Path to vault_inputs JSON');
    try {
      return {
        inputs: parseVaultInputs(readFileSync(path, 'utf8')),
        source: path,
      };
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
}

const looksSecret = (name: string) => /SECRET|TOKEN|PASSWORD|KEY/.test(name);

async function promptValue(name: string, config: string): Promise<string> {
  const label = `${config}.${name}`;
  for (;;) {
    const value = await (looksSecret(name) ? askSecret : ask)(label);
    const [problem] = problemsFor(name, value);
    if (value && !problem) return value;
    if (!value) console.log('A value is required.');
    else if (problem.severity === 'fail')
      console.log(`${label} ${problem.message}`);
    else if (
      await confirm(`${label} ${problem.message}. Use it anyway?`, false)
    )
      return value;
  }
}

async function valueFor(gap: Gap, fills: Fill[]): Promise<string> {
  const { config, name, legacy } = gap;
  if (
    legacy &&
    (await confirm(`${config}.${name}: carry over ${legacy.name}?`))
  )
    return legacy.value;
  const same = fills.find((fill) => fill.name === name);
  if (
    same &&
    (await confirm(`${config}.${name}: reuse the ${same.config} value?`))
  )
    return same.value;
  return promptValue(name, config);
}

export async function completeInputs(
  inputs: VaultInputs,
  keys: KvKey[]
): Promise<VaultInputs> {
  const gaps = findGaps(inputs, keys);
  const legacy = legacyPresent(inputs);
  const fills: Fill[] = [];
  for (const gap of gaps)
    fills.push({
      config: gap.config,
      name: gap.name,
      value: await valueFor(gap, fills),
    });
  const dropLegacy =
    legacy.length > 0 &&
    (await confirm(
      `Remove renamed legacy fields (${legacy.join(', ')}) from the inputs?`
    ));
  return withFills(inputs, fills, dropLegacy);
}
