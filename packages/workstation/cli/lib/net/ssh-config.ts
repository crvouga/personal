import { shortName, type NetHost } from './inventory';

export const SSH_BLOCK_BEGIN =
  '# ws-net:begin (managed by `personal workstation net fix` from fleet.json; do not edit)';
export const SSH_BLOCK_END = '# ws-net:end';

/** Markers from earlier versions; their blocks are replaced, never duplicated. */
const MANAGED_MARKERS: readonly (readonly [string, string])[] = [
  ['# ws-net:begin', '# ws-net:end'],
  ['# devnet:begin', '# devnet:end'],
];

/**
 * One `Host` entry per machine, matching the alias, the full Tailscale name
 * and the short name. VS Code Remote-SSH and T3 often connect as
 * `user@full-name`, which must pick the same key and port as the alias.
 */
export function renderSshBlock(hosts: readonly NetHost[]): string {
  const entries = hosts.map((h) =>
    [
      `Host ${h.alias} ${h.tailscaleName} ${shortName(h.tailscaleName)}`,
      `    HostName ${h.tailscaleName}`,
      `    User ${h.user}`,
      `    Port ${h.sshPort}`,
      ...(h.identityFile
        ? [`    IdentityFile ${h.identityFile}`, '    IdentitiesOnly yes']
        : []),
      '    AddressFamily inet',
      '    ServerAliveInterval 30',
      '    ServerAliveCountMax 3',
      '    ConnectTimeout 20',
    ].join('\n')
  );
  return [SSH_BLOCK_BEGIN, ...entries, SSH_BLOCK_END].join('\n\n');
}

function stripBlock(text: string, begin: string, end: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.startsWith(begin)) skipping = true;
    if (!skipping) kept.push(line);
    if (skipping && line.startsWith(end)) skipping = false;
  }
  return kept.join('\n');
}

/**
 * Replace (or append) the managed block. Everything outside it is left
 * byte-for-byte alone. Appended last: ssh uses the first value it finds, so
 * hand-written entries above keep priority. Pure — unit-tested.
 */
export function upsertSshBlock(config: string, block: string): string {
  let rest = config;
  for (const [begin, end] of MANAGED_MARKERS) {
    rest = stripBlock(rest, begin, end);
  }
  const trimmed = rest.replace(/\s+$/, '');
  return `${trimmed}${trimmed.length > 0 ? '\n\n' : ''}${block}\n`;
}
