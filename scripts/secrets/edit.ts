import { GOOGLE_KEYS, editableKeys } from './model';
import type { Config, Fill, VaultInputs } from '../vault-inputs/model';
import type { Ui, SecretKey } from './types';

export async function selectKeys(
  ui: Ui,
  keys: SecretKey[],
  inputs: VaultInputs,
  configs: Config[]
) {
  const selected: string[] = [];
  const available = editableKeys(keys).filter((key) =>
    key.configs.some((config) => configs.includes(config as Config))
  );
  if (!available.length) return selected;
  do {
    selected.push(
      await ui.key(
        available.filter((key) => !selected.includes(key.name)),
        inputs,
        configs
      )
    );
  } while (
    selected.length < available.length &&
    (await ui.confirm('Update another secret?'))
  );
  return selected;
}

export async function enterValues(
  ui: Ui,
  names: string[],
  configs: Config[],
  inputs: VaultInputs,
  keys: SecretKey[]
): Promise<Fill[]> {
  const shared =
    configs.length > 1 &&
    (await ui.confirm('Use the same new values in both environments?', true));
  const fills: Fill[] = [];
  for (const name of names) {
    const allowed = keys.find((key) => key.name === name)!.configs;
    const eligible = configs.filter((config) => allowed.includes(config));
    const groups = shared ? [eligible] : eligible.map((config) => [config]);
    for (const group of groups) {
      if (!group.length) continue;
      const present = group.every((config) => !!inputs.secrets[config][name]);
      const value = await ui.value(name, group.join(' + '), present);
      // Keep is per environment: never copy an old production value into dev.
      for (const config of group) {
        const chosen = value || inputs.secrets[config][name];
        if (chosen) fills.push({ config, name, value: chosen });
      }
    }
  }
  // Changing the ID requires its matching secret, even when editing a single key.
  for (const config of configs) {
    const id = fills.find(
      (fill) => fill.config === config && fill.name === GOOGLE_KEYS[0]
    );
    if (!id || id.value === inputs.secrets[config][id.name]) continue;
    if (
      !fills.some(
        (fill) =>
          fill.config === config &&
          fill.name === GOOGLE_KEYS[1] &&
          fill.value !== inputs.secrets[config][fill.name]
      )
    ) {
      ui.say(
        `${config}: the new Google client ID needs its matching client secret.`
      );
      const value = await ui.value(GOOGLE_KEYS[1], config, false);
      const at = fills.findIndex(
        (fill) => fill.config === config && fill.name === GOOGLE_KEYS[1]
      );
      if (at >= 0) fills.splice(at, 1);
      fills.push({ config, name: GOOGLE_KEYS[1], value });
    }
  }
  return fills;
}
