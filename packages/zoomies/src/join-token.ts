/**
 * Mints a single-use join token and prints the one-line command that enrols a
 * host (home machine or rented VM) with the controller. The host connects
 * outbound, so it needs no inbound firewall rule.
 *
 *   bun run zoomies:join-token --capacity 4 --label site=home
 */
import { ZoomiesApi } from './api';
import { ORIGIN } from './spec';

export type JoinOptions = {
  readonly ttl: string;
  readonly capacity: number;
  readonly labels: Readonly<Record<string, string>>;
};

function parseLabel(value: string): [string, string] {
  const [key, ...rest] = value.split('=');
  if (!key || rest.length === 0) throw new Error('--label expects key=value');
  return [key, rest.join('=')];
}

export function parseArgs(args: readonly string[]): JoinOptions {
  const options = {
    ttl: '15m',
    capacity: 0,
    labels: {} as Record<string, string>,
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Incomplete argument: ${flag}`);
    if (flag === '--ttl') options.ttl = value;
    else if (flag === '--capacity') options.capacity = Number(value);
    else if (flag === '--label') {
      const [key, label] = parseLabel(value);
      options.labels[key] = label;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!Number.isInteger(options.capacity) || options.capacity < 0)
    throw new Error(
      '--capacity must be a non-negative integer (0 measures the host)'
    );
  return options;
}

if (import.meta.main) {
  const token = process.env['ZOOMIES_BOOTSTRAP_TOKEN'];
  if (!token) {
    console.error(
      'Missing ZOOMIES_BOOTSTRAP_TOKEN. Run through: vault run --config prd -- ...'
    );
    process.exit(1);
  }
  const origin = process.env['ZOOMIES_URL'] ?? ORIGIN;
  const options = parseArgs(process.argv.slice(2));
  const joined = await new ZoomiesApi(origin, token).createJoinToken({
    ...options,
    connection: 'direct',
    controller_url: origin,
  });
  process.stdout.write(
    [
      `Run on the new host (single use, expires ${joined.expires_at}):`,
      '',
      joined.commands.linux,
      '',
      'Windows (elevated PowerShell):',
      '',
      joined.commands.windows,
      '',
    ].join('\n')
  );
}
