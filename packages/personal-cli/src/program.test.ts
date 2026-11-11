import { expect, test } from 'bun:test';
import { execute } from './program';

const settings = { workspace: '/checkout' };

test('commands --json lists only infra, workstation and reference commands', async () => {
  const outcome = await execute(['commands', '--json'], settings, '0.0.0');
  expect(outcome.exitCode).toBe(0);
  const { commands } = outcome.data as { commands: { id: string }[] };
  const ids = commands.map((command) => command.id);
  expect(ids).toContain('workstation');
  expect(ids).toContain('infra-vault');
  expect(ids.some((id) => /^(fleet|t3)-|cliproxy/.test(id))).toBe(false);
});

test('fleet commands are gone: dev-fleet owns them', async () => {
  const outcome = await execute(['fleet-sync'], settings, '0.0.0');
  expect(outcome.exitCode).toBe(2);
});
