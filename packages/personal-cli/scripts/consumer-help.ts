import { join } from 'node:path';
import { mustRun } from './release-io';
import { ReleaseError } from './release-error';

export async function consumerHelp(
  directory: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const node = Bun.which('node');
  if (!node) throw new ReleaseError('Consumer help smoke requires Node.');
  const cli = join(directory, 'node_modules/@crvouga/personal/cli.mjs');
  for (const args of [
    [],
    ['--help'],
    ['help'],
    ['workstation'],
    ['workstation', '--help'],
  ]) {
    const output = await mustRun([node, cli, ...args], directory, env, {
      stage: 'consumer-command',
    });
    if (!output.includes('Usage: personal'))
      throw new ReleaseError(
        'Consumer default/help command did not return help.'
      );
  }
  const index = await mustRun(
    [node, cli, 'commands', '--json'],
    directory,
    env,
    { stage: 'consumer-command' }
  );
  const data = JSON.parse(index);
  if (
    data.defaultCommand !== 'help' ||
    typeof data.releasedAt !== 'string' ||
    typeof data.agent?.invocation !== 'string' ||
    !data.commands.every(
      (entry: { help?: string; execution?: unknown }) =>
        entry.help && entry.execution
    )
  )
    throw new ReleaseError(
      'Consumer command index lacks agent discovery metadata.'
    );
}
