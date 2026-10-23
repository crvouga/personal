import { expect, test } from 'bun:test';
import { before, inventory, fakeUi } from './fixtures';
import { editSecrets } from './flow';
import { enterValues } from './edit';
import type { Session } from './types';
import { GOOGLE_KEYS } from './model';

test('keeping shared values preserves the different existing secret in each environment', async () => {
  const ui = fakeUi({ value: async () => '' });
  const selected = await enterValues(
    ui,
    GOOGLE_KEYS,
    ['prd', 'dev'],
    before,
    inventory.vault.kv_keys
  );
  expect(
    selected.find(
      (fill) => fill.config === 'dev' && fill.name === GOOGLE_KEYS[1]
    )?.value
  ).toBe(before.secrets.dev.GOOGLE_OAUTH_CLIENT_SECRET);
  expect(
    selected.find(
      (fill) => fill.config === 'prd' && fill.name === GOOGLE_KEYS[1]
    )?.value
  ).toBe(before.secrets.prd.GOOGLE_OAUTH_CLIENT_SECRET);
});

test('a changed client ID cannot silently retain the old matching secret', async () => {
  const prompts: boolean[] = [];
  const ui = fakeUi({
    value: async (name, _scope, present) => {
      prompts.push(present);
      return name === GOOGLE_KEYS[0]
        ? '456-new.apps.googleusercontent.com'
        : 'GOCSPX-new-secret';
    },
  });
  const selected = await enterValues(
    ui,
    [GOOGLE_KEYS[0]],
    ['prd'],
    before,
    inventory.vault.kv_keys
  );
  expect(selected.map((fill) => fill.name)).toEqual(GOOGLE_KEYS);
  expect(prompts).toEqual([true, false]);
});

test('cancel after the review never starts a plan or apply and does not display values', async () => {
  const ui = fakeUi({
    choose: async (_message, choices) =>
      choices.find((choice) => choice.value === 'cancel')!.value,
  });
  const session: Session = {
    load: async () => before,
    update: async () => {
      throw new Error('must not run');
    },
    close() {},
  };
  await editSecrets(ui, session, inventory, { google: true, dryRun: false });
  expect(ui.messages.join('\n')).toContain('Cancelled. Nothing changed.');
  expect(ui.messages.join('\n')).not.toContain('GOCSPX-');
});

test('dry-run always previews even if Continue is selected', async () => {
  let previewed = false;
  const ui = fakeUi();
  const session: Session = {
    load: async () => before,
    update: async (_before, _next, _fills, preview) => {
      previewed = preview;
    },
    close() {},
  };
  await editSecrets(ui, session, inventory, { google: true, dryRun: true });
  expect(previewed).toBe(true);
  expect(ui.messages.join('\n')).toContain('No secrets were changed');
  expect(ui.messages.join('\n')).not.toContain('are synchronized');
});
