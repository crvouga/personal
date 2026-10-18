// Pure model behind `bun run vault:fix`: the foundation root's `vault_inputs`
// JSON, the gaps in it, and the checks on the resulting OpenTofu plan. No I/O,
// and no function here returns a secret value except `withFills`.
import { isDerived, overridable, type KvKey } from '../vault-secrets-tfvars';

export const CONFIGS = ['dev', 'prd'] as const;
export type Config = (typeof CONFIGS)[number];

export type VaultInputs = {
  secrets: Record<Config, Record<string, string>>;
  admin_passwords: Record<string, string>;
  [other: string]: unknown;
};

/** Fields renamed in the inventory; the old name's value is the new name's. */
export const LEGACY_RENAMES: Readonly<Record<string, string>> = {
  WEB_CLIENT_GOOGLE_CLIENT_ID: 'GOOGLE_OAUTH_CLIENT_ID',
  WEB_CLIENT_GOOGLE_CLIENT_SECRET: 'GOOGLE_OAUTH_CLIENT_SECRET',
};

export const TOFU_VAULT_INPUTS_ADDRESS =
  'github_actions_secret.bootstrap["TOFU_VAULT_INPUTS"]';

export type Gap = {
  config: Config;
  name: string;
  /** Value held under the field's former name, if any. */
  legacy?: { name: string; value: string };
};
export type Fill = { config: Config; name: string; value: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function stringMap(value: unknown, where: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${where} must be an object`);
  for (const [name, entry] of Object.entries(value))
    if (typeof entry !== 'string')
      throw new Error(`${where}.${name} must be a string`);
  return value as Record<string, string>;
}

export function parseVaultInputs(text: string): VaultInputs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('vault_inputs is not valid JSON');
  }
  if (!isRecord(parsed)) throw new Error('vault_inputs must be an object');
  const secrets = parsed['secrets'];
  if (!isRecord(secrets)) throw new Error('vault_inputs.secrets is missing');
  return {
    ...parsed,
    secrets: {
      dev: stringMap(secrets['dev'], 'secrets.dev'),
      prd: stringMap(secrets['prd'], 'secrets.prd'),
    },
    admin_passwords: stringMap(
      parsed['admin_passwords'] ?? {},
      'admin_passwords'
    ),
  };
}

/** Fields an operator must supply: not generated, derived or overridable. */
export function requiredManualKeys(keys: KvKey[], config: Config): string[] {
  return keys
    .filter(
      (key) =>
        key.required &&
        !key.generated &&
        key.configs.includes(config) &&
        !isDerived(key.name) &&
        !overridable(key.name)
    )
    .map((key) => key.name);
}

const filled = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

export function findGaps(inputs: VaultInputs, keys: KvKey[]): Gap[] {
  const legacyOf = new Map(
    Object.entries(LEGACY_RENAMES).map(([old, current]) => [current, old])
  );
  return CONFIGS.flatMap((config) =>
    requiredManualKeys(keys, config)
      .filter((name) => !filled(inputs.secrets[config][name]))
      .map((name): Gap => {
        const old = legacyOf.get(name);
        const value = old ? inputs.secrets[config][old] : undefined;
        return filled(value) && old
          ? { config, name, legacy: { name: old, value } }
          : { config, name };
      })
  );
}

/**
 * Gaps the live Vault already answers. One value serves every config: the
 * prd document is the source and dev takes the same value.
 */
export function fillsFromLive(
  gaps: Gap[],
  live: Record<string, string>
): Fill[] {
  const legacyOf = new Map(
    Object.entries(LEGACY_RENAMES).map(([old, current]) => [current, old])
  );
  return gaps.flatMap(({ config, name }) => {
    const old = legacyOf.get(name);
    const value = live[name] ?? (old ? live[old] : undefined);
    return filled(value) ? [{ config, name, value }] : [];
  });
}

/**
 * Everything that needs no operator: a renamed field's old value from the
 * inputs themselves, else the live document's. `unresolved` is what remains.
 */
export function autoFills(
  gaps: Gap[],
  live: Record<string, string>
): { fills: Fill[]; unresolved: Gap[] } {
  const carried = gaps.flatMap(({ config, name, legacy }) =>
    legacy ? [{ config, name, value: legacy.value }] : []
  );
  const rest = gaps.filter(
    (gap) =>
      !carried.some(
        (fill) => fill.config === gap.config && fill.name === gap.name
      )
  );
  const fromLive = fillsFromLive(rest, live);
  const fills = [...carried, ...fromLive];
  const unresolved = rest.filter(
    (gap) =>
      !fromLive.some(
        (fill) => fill.config === gap.config && fill.name === gap.name
      )
  );
  return { fills, unresolved };
}

/** Legacy fields still present; the vault root would write them to Vault. */
export function legacyPresent(inputs: VaultInputs): string[] {
  return CONFIGS.flatMap((config) =>
    Object.keys(LEGACY_RENAMES)
      .filter((name) => name in inputs.secrets[config])
      .map((name) => `${config}.${name}`)
  );
}

export function withFills(
  inputs: VaultInputs,
  fills: Fill[],
  dropLegacy: boolean
): VaultInputs {
  const secrets = {
    dev: { ...inputs.secrets.dev },
    prd: { ...inputs.secrets.prd },
  };
  for (const { config, name, value } of fills) secrets[config][name] = value;
  if (dropLegacy)
    for (const config of CONFIGS)
      for (const name of Object.keys(LEGACY_RENAMES))
        delete secrets[config][name];
  return { ...inputs, secrets };
}

/** Names only, e.g. `dev.GOOGLE_OAUTH_CLIENT_ID`. */
export function diffNames(before: VaultInputs, after: VaultInputs) {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const config of CONFIGS) {
    const from = before.secrets[config];
    const to = after.secrets[config];
    for (const name of Object.keys(to))
      if (!(name in from)) added.push(`${config}.${name}`);
      else if (from[name] !== to[name]) changed.push(`${config}.${name}`);
    for (const name of Object.keys(from))
      if (!(name in to)) removed.push(`${config}.${name}`);
  }
  return { added, removed, changed };
}

/** The current `TOFU_VAULT_INPUTS` value, when the state records it. */
export function inputsFromState(state: unknown): string | undefined {
  if (!isRecord(state) || !isRecord(state['values'])) return undefined;
  const root = state['values']['root_module'];
  if (!isRecord(root) || !Array.isArray(root['resources'])) return undefined;
  const resource = root['resources'].find(
    (entry) => isRecord(entry) && entry['address'] === TOFU_VAULT_INPUTS_ADDRESS
  );
  if (!isRecord(resource) || !isRecord(resource['values'])) return undefined;
  const value =
    resource['values']['value'] ?? resource['values']['plaintext_value'];
  return typeof value === 'string' && value ? value : undefined;
}

/** Plan changes other than the one this command exists to make. */
export function unexpectedChanges(plan: unknown): string[] {
  const changes =
    isRecord(plan) && Array.isArray(plan['resource_changes'])
      ? plan['resource_changes']
      : [];
  return changes.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry['change'])) return [];
    const actions = (entry['change']['actions'] as string[] | undefined) ?? [];
    const quiet = actions.every((a) => a === 'no-op' || a === 'read');
    return quiet || entry['address'] === TOFU_VAULT_INPUTS_ADDRESS
      ? []
      : [`${String(entry['address'])}: ${actions.join(' + ')}`];
  });
}

export function updatesVaultInputs(plan: unknown): boolean {
  const changes =
    isRecord(plan) && Array.isArray(plan['resource_changes'])
      ? plan['resource_changes']
      : [];
  return changes.some(
    (entry) =>
      isRecord(entry) &&
      entry['address'] === TOFU_VAULT_INPUTS_ADDRESS &&
      isRecord(entry['change']) &&
      Array.isArray(entry['change']['actions']) &&
      entry['change']['actions'].includes('update')
  );
}
