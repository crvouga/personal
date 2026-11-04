import { CAPABILITIES } from '../../fleet/src/config';
import { FleetUsageError } from '../../fleet/src/errors';
import type { Capability } from '../../fleet/src/types';
import type { Settings } from './settings';

export interface CliOptions extends Partial<Settings> {
  json?: boolean;
  nonInteractive?: boolean;
  interactive?: boolean;
  local?: boolean;
  all?: boolean;
  node?: string[];
  require?: string;
  timeout?: string;
  strict?: boolean;
  apply?: boolean;
  yes?: boolean;
  pull?: boolean;
  id?: string;
  ssh?: string;
  path?: string;
  runtime?: string;
  search?: string;
  group?: string;
}

export function capabilities(value?: string): Capability[] {
  const values = value === 'none' ? [] : (value?.split(',') ?? CAPABILITIES);
  if (values.some((entry) => !CAPABILITIES.includes(entry as Capability)))
    throw new FleetUsageError(
      `--require expects ${CAPABILITIES.join(',')} or none.`
    );
  return [...new Set(values)] as Capability[];
}

export function timeout(options: CliOptions): number {
  const value = Number(
    options.timeout ?? (options.apply ? 1_500_000 : 120_000)
  );
  if (!Number.isInteger(value) || value < 1000 || value > 1_800_000)
    throw new FleetUsageError('--timeout must be 1000–1800000 milliseconds.');
  return value;
}

export function validateOptions(command: string, options: CliOptions): void {
  validateMutation(command, options);
  validateScope(command, options);
  if (['discover', 'health'].includes(command) && options.require !== undefined)
    throw new FleetUsageError(
      'Tailscale health always checks the complete capability set; --require is not supported.'
    );
  if (options.timeout !== undefined) timeout(options);
}

function validateMutation(command: string, options: CliOptions): void {
  if (options.apply && !['add', 'init', 'sync'].includes(command))
    throw new FleetUsageError(
      '--apply is only valid for fleet add, init or sync.'
    );
  if (options.apply && !options.yes)
    throw new FleetUsageError('Mutation requires both --apply and --yes.');
  if (options.pull && command !== 'sync')
    throw new FleetUsageError('--pull is only valid for fleet sync.');
}

function validateScope(command: string, options: CliOptions): void {
  if (
    ['discover', 'health'].includes(command) &&
    (options.local || options.all || options.node?.length)
  )
    throw new FleetUsageError(
      'Tailscale discovery and health always cover all visible computers; scope filters are not supported.'
    );
  if (options.local && !['doctor', 'sync'].includes(command))
    throw new FleetUsageError(
      '--local is only valid for fleet doctor or sync.'
    );
  validateExclusive(options);
  if (options.all && command !== 'doctor')
    throw new FleetUsageError(
      '--all is only valid for fleet doctor; sync already targets all configured nodes by default.'
    );
}

function validateExclusive(options: CliOptions): void {
  const selected = [
    options.local,
    options.all,
    Boolean(options.node?.length),
  ].filter(Boolean);
  if (selected.length > 1)
    throw new FleetUsageError(
      'Choose --local, --all, or --node, not a combination.'
    );
}
