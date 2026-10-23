import { enterValues, selectKeys } from './edit';
import { GOOGLE_KEYS, stages, updateInputs } from './model';
import type { Inventory, Session, Ui } from './types';

export async function editSecrets(
  ui: Ui,
  session: Session,
  inventory: Inventory,
  options: { google: boolean; dryRun: boolean }
) {
  const mode = options.google
    ? 'google'
    : await ui.choose('What would you like to update?', [
        {
          name: 'Google sign-in credentials',
          value: 'google',
          description:
            'Update the client ID and secret together, including the live relay.',
        },
        {
          name: 'Other secrets',
          value: 'custom',
          description: 'Find registered secrets by name or application.',
        },
        { name: 'Exit', value: 'exit' },
      ]);
  if (mode === 'exit') return;
  const configs = await ui.scopes();
  if (mode === 'google') {
    ui.say('\nAdd these exact redirect URIs to your Google web client:');
    for (const relay of Object.values(inventory.auth_relay.instances)) {
      if (configs.includes(relay.vault_config))
        ui.say(
          `  https://${relay.hostname}/realms/${relay.realm}/broker/google/endpoint`
        );
    }
  }
  const before = await session.load();
  const keys = inventory.vault.kv_keys;
  const names =
    mode === 'google'
      ? GOOGLE_KEYS
      : await selectKeys(ui, keys, before, configs);
  for (;;) {
    const fills = await enterValues(ui, names, configs, before, keys);
    if (!fills.length) {
      ui.say('No values selected. Nothing changed.');
      return;
    }
    const next = updateInputs(before, fills, keys);
    const steps = stages(next, fills, inventory);
    ui.review(before, fills);
    ui.say(`  ${steps.map((step) => step.label).join(' → ')}\n`);
    const action = await ui.choose('Continue?', [
      {
        name: options.dryRun ? 'Preview saved plans' : 'Review plans and apply',
        value: 'continue',
      },
      ...(options.dryRun
        ? []
        : [{ name: 'Preview plans without applying', value: 'preview' }]),
      { name: 'Re-enter values', value: 'edit' },
      { name: 'Cancel', value: 'cancel' },
    ]);
    if (action === 'cancel') {
      ui.say('Cancelled. Nothing changed.');
      return;
    }
    if (action === 'edit') continue;
    const preview = options.dryRun || action === 'preview';
    await session.update(before, next, fills, preview);
    ui.say(
      preview
        ? '\nPreview complete. No secrets were changed.'
        : '\n✓ Managed inputs and Vault are synchronized.'
    );
    if (!preview && fills.some((fill) => GOOGLE_KEYS.includes(fill.name)))
      ui.say(
        '✓ Google provider credentials are synchronized. Start a fresh sign-in to verify Google accepts the new client.'
      );
    else if (!preview)
      ui.say(
        'Applications that read secrets at startup need a deployment to pick up the new values.'
      );
    return;
  }
}
