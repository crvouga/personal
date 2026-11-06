import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { CAPABILITIES, DEFAULT_CONFIG } from './config';
import { FleetUsageError } from './errors';
import type { Capability } from './types';

function readArguments(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      revision: { type: 'string' },
      tool: { type: 'string' },
      profile: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      config: { type: 'string' },
      node: { type: 'string', multiple: true },
      local: { type: 'boolean' },
      workspace: { type: 'string' },
      timeout: { type: 'string' },
      strict: { type: 'boolean' },
      pull: { type: 'boolean' },
      apply: { type: 'boolean' },
      yes: { type: 'boolean' },
      'non-interactive': { type: 'boolean' },
      require: { type: 'string' },
    },
  });
}

export function parseOptions(args: string[]) {
  const { values, positionals } = readArguments(args);
  const command = readCommand(positionals, values.help === true);
  const timeoutMs = readTimeout(values, command);
  validateFlags(values, command);
  return {
    command,
    revision: values.revision ?? '',
    tool: values.tool ?? 'codex',
    profile: values.profile ?? 'direct',
    json: values.json === true,
    config: resolve(values.config ?? DEFAULT_CONFIG),
    ids: values.node ?? [],
    local: values.local === true,
    root: resolve(values.workspace ?? process.cwd()),
    timeoutMs,
    strict: values.strict === true,
    pull: values.pull === true,
    apply: values.apply === true,
    required: readRequirements(values.require),
  };
}

function validateFlags(
  values: {
    apply?: boolean;
    yes?: boolean;
    pull?: boolean;
    local?: boolean;
    node?: string[];
  },
  command: string
): void {
  if (values.apply && !['init', 'sync', 'configure'].includes(command))
    throw new FleetUsageError('--apply is only valid with init or sync.');
  if (values.apply && !values.yes)
    throw new FleetUsageError('Mutation requires both --apply and --yes.');
  if (values.pull && command !== 'sync')
    throw new FleetUsageError('--pull is only valid with sync.');
  validateLocal(values, command);
}

function validateLocal(
  values: { local?: boolean; node?: string[] },
  command: string
): void {
  if (values.local && !['doctor', 'sync', 'configure'].includes(command))
    throw new FleetUsageError('--local is only valid with doctor or sync.');
  if (values.local && values.node?.length)
    throw new FleetUsageError('Choose --local or --node, not both.');
}

function readCommand(positionals: string[], help: boolean): string {
  const command = help ? 'help' : (positionals[0] ?? 'help');
  if (
    positionals.length > 1 ||
    ![
      'help',
      'schema',
      'init',
      'validate',
      'nodes',
      'onboard',
      'doctor',
      'sync',
      'configure',
    ].includes(command)
  )
    throw new FleetUsageError(
      'Unknown command or extra arguments. Run fleet help.'
    );
  return command;
}

function readTimeout(
  values: { timeout?: string; apply?: boolean },
  command: string
): number {
  const value = Number(
    values.timeout ??
      (['sync', 'configure'].includes(command) && values.apply
        ? 1_500_000
        : 120_000)
  );
  if (!Number.isInteger(value) || value < 1000 || value > 1_800_000)
    throw new FleetUsageError(
      'timeout must be an integer from 1000 to 1800000 milliseconds.'
    );
  return value;
}

function readRequirements(value: string | undefined): Capability[] {
  const required = value === 'none' ? [] : (value?.split(',') ?? CAPABILITIES);
  if (required.some((item) => !CAPABILITIES.includes(item as Capability)))
    throw new FleetUsageError(
      '--require expects comma-separated capabilities or none.'
    );
  return required as Capability[];
}

export type Options = ReturnType<typeof parseOptions>;
