import { dirname, join } from 'node:path';
import { ReleaseError } from './release-error';

export async function npmCommand(
  args: string[],
  executables = { node: Bun.which('node'), npm: Bun.which('npm') }
): Promise<string[]> {
  const { node, npm } = executables;
  if (!node || !npm)
    throw new ReleaseError(
      'Node and npm must be on PATH to verify/publish the Node distribution. Use the shared mise toolchain.'
    );
  if (npm.toLowerCase().endsWith('.cmd'))
    return [
      node,
      join(dirname(npm), 'node_modules/npm/bin/npm-cli.js'),
      ...args,
    ];
  return [npm, ...args];
}
