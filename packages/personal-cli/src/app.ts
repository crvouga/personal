import pkg from '../package.json';
import { sourceOperation, forwardSourceOperation } from './source-operations';
import { forwardWorkstation } from './workstation';
import { resolveSettings, type Settings } from './settings';
import { execute } from './program';
import { parseArgs } from 'node:util';

export const VERSION: string = pkg.version;
const RELEASE = { version: VERSION, releasedAt: null };

function startup(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      workspace: { type: 'string' },
      json: { type: 'boolean' },
      'non-interactive': { type: 'boolean' },
    },
  });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { values } = startup(args);
  const settings = await resolveSettings({
    ...(typeof values.workspace === 'string'
      ? { workspace: values.workspace }
      : {}),
  });
  const forwarded = forwardOwner(args, settings);
  if (forwarded) return forwarded;
  const outcome = await execute(args, settings, RELEASE);
  const text = args.includes('--json')
    ? JSON.stringify(outcome.data, null, 2)
    : (outcome.text ?? JSON.stringify(outcome.data, null, 2));
  process.stdout.write(`${text}\n`);
  return outcome.exitCode;
}

function workstationOperation(args: string[]): boolean {
  const { positionals } = startup(args);
  return positionals[0] === 'workstation' && positionals.length > 1;
}

function forwardOwner(
  args: string[],
  settings: Settings
): Promise<number> | undefined {
  const ownerArgs = stripOwnerWorkspace(args);
  if (sourceOperation(ownerArgs))
    return forwardSourceOperation(ownerArgs, settings);
  if (workstationOperation(args)) return forwardWorkstation(args, settings);
  return undefined;
}

export function stripOwnerWorkspace(args: string[]): string[] {
  const forwarded: string[] = [];
  let child = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--') child = true;
    if (!child && arg === '--workspace') {
      index++;
      continue;
    }
    forwarded.push(arg);
  }
  return forwarded;
}
