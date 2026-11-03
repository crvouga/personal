import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ReleaseError } from './release-error';

export async function npmCommand(args: string[]): Promise<string[]> {
  const node = Bun.which('node');
  const npm = Bun.which('npm');
  if (!node || !npm)
    throw new ReleaseError(
      'Node and npm must be on PATH to verify/publish the Node distribution. Use the shared mise toolchain.'
    );
  const script = npm.toLowerCase().endsWith('.cmd')
    ? join(dirname(npm), 'node_modules/npm/bin/npm-cli.js')
    : await realpath(npm);
  return [node, script, ...args];
}
