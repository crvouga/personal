import { isDeepStrictEqual } from 'node:util';
import {
  TOFU_VAULT_INPUTS_ADDRESS,
  type Fill,
  type VaultInputs,
} from '../vault-inputs/model';
import { bootstrapBindings, unrelatedKvChanges, type Stage } from './model';

type Change = {
  address: string;
  mode?: string;
  change: {
    actions: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
};

function jsonInput(value: unknown): unknown {
  if (typeof value !== 'string')
    throw new Error(
      'A planned secret value is unavailable; refusing this plan.'
    );
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(
      'A planned secret document is invalid; refusing this plan.'
    );
  }
}

/** Fail closed: this editor can update existing selected secrets, never adopt resources. */
export function reviewPlan(
  plan: unknown,
  stage: Stage,
  before: VaultInputs,
  next: VaultInputs,
  fills: Fill[]
): string[] {
  if (
    !plan ||
    typeof plan !== 'object' ||
    !('resource_changes' in plan) ||
    !Array.isArray(plan.resource_changes)
  )
    throw new Error('OpenTofu did not return a reviewable resource plan.');
  const entries = plan.resource_changes as Change[];
  if (
    stage.addresses.some(
      (address) => !entries.some((entry) => entry.address === address)
    )
  )
    throw new Error(
      'The plan omits a selected resource; refusing an incomplete review.'
    );
  const updates: string[] = [];
  for (const entry of entries) {
    const { actions } = entry.change;
    const unchanged = actions.length === 1 && actions[0] === 'no-op';
    if (unchanged && !stage.addresses.includes(entry.address)) continue;
    if (entry.mode === 'data' && actions.length === 1 && actions[0] === 'read')
      continue;
    if (
      !stage.addresses.includes(entry.address) ||
      actions.length !== 1 ||
      !['update', 'no-op'].includes(actions[0])
    )
      throw new Error(
        `Refusing unrelated or destructive change: ${entry.address} (${actions.join(', ')}).`
      );
    const old = entry.change.before;
    const planned = entry.change.after;
    if (entry.address === TOFU_VAULT_INPUTS_ADDRESS) {
      if (!isDeepStrictEqual(jsonInput(old.value), before))
        throw new Error(
          'Managed inputs changed since they were loaded. Restart the editor to preserve those changes.'
        );
      if (!isDeepStrictEqual(jsonInput(planned.value), next))
        throw new Error(
          'The saved plan does not contain the reviewed managed inputs.'
        );
    } else if (stage.root === 'vault') {
      const config = entry.address.endsWith('["prd"]') ? 'prd' : 'dev';
      const selected = fills.filter((fill) => fill.config === config);
      jsonInput(old.data_json);
      const values = jsonInput(planned.data_json) as Record<string, unknown>;
      const unrelated = unrelatedKvChanges(
        old.data_json as string,
        planned.data_json as string,
        selected
      );
      if (unrelated.length)
        throw new Error(
          `Vault plan also changes unselected fields: ${unrelated.join(', ')}. Resolve that drift separately.`
        );
      if (selected.some((fill) => values[fill.name] !== fill.value))
        throw new Error('The Vault plan does not contain the reviewed values.');
    } else if (stage.root === 'auth') {
      const remaining = (values: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => !['client_id', 'client_secret'].includes(key)
          )
        );
      if (!isDeepStrictEqual(remaining(old), remaining(planned)))
        throw new Error(
          'The Google provider plan also changes settings beyond its credentials. Resolve that drift separately.'
        );
      if (
        planned.client_id !== stage.env.TF_VAR_google_client_id ||
        planned.client_secret !== stage.env.TF_VAR_google_client_secret
      )
        throw new Error(
          'The Google provider plan does not contain the reviewed credentials.'
        );
    } else if (stage.root === 'foundation') {
      const binding = Object.entries(bootstrapBindings).find(
        ([, binding]) =>
          entry.address ===
          `github_actions_secret.bootstrap["${binding.secret}"]`
      );
      if (!binding || planned.value !== next.secrets.prd[binding[0]])
        throw new Error(
          'A bootstrap credential does not match the reviewed production value.'
        );
    }
    if (!unchanged) updates.push(entry.address);
  }
  return updates;
}
