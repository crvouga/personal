import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  Runner,
  CommandOptions,
  CommandResult,
} from '../../../../fleet/src/types';

/** Ansible resolves @file paths before opening them; @/dev/stdin is not portable
 * across versions when stdin is a pipe. Keep runtime variables in a private,
 * short-lived directory instead. Never put their values in argv or logs.
 */
export async function runAnsible(
  run: Runner,
  playbook: string,
  options: CommandOptions & { input: string }
): Promise<CommandResult> {
  if (Buffer.byteLength(options.input) > 256 * 1024)
    throw new Error('ANSIBLE_VARIABLE_LIMIT');
  const directory = await mkdtemp(join(tmpdir(), 'personal-ansible-'));
  const path = join(directory, 'variables.json');
  try {
    await writeFile(path, options.input, { mode: 0o600, flag: 'wx' });
    const { input: _input, ...commandOptions } = options;
    return await run(
      ['ansible-playbook', playbook, '--extra-vars', '@' + path],
      commandOptions
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
