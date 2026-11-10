import type { Platform } from '../../../../fleet/src/platform/types';
import { findOnPath, lastLine, run } from './run';

export type TailscalePeer = {
  readonly dnsName: string;
  readonly online: boolean;
};

export type TailscaleStatus = {
  readonly backendState: string;
  readonly selfDnsName: string;
  readonly health: readonly string[];
  readonly peers: readonly TailscalePeer[];
};

export type PingResult = {
  readonly ok: boolean;
  readonly viaRelay: boolean;
  readonly latency: string;
  readonly detail: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `name.tailnet.ts.net.` → `name.tailnet.ts.net` (lowercase). */
export function normalizeDnsName(name: string): string {
  return name.replace(/\.$/, '').toLowerCase();
}

function parsePeers(raw: unknown): TailscalePeer[] {
  if (!isRecord(raw)) return [];
  return Object.values(raw)
    .filter(isRecord)
    .map((p) => ({
      dnsName: normalizeDnsName(str(p['DNSName'])),
      online: p['Online'] === true,
    }));
}

/** Parse `tailscale status --json`. Pure — unit-tested. */
export function parseTailscaleStatus(json: string): TailscaleStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const self = isRecord(parsed['Self']) ? parsed['Self'] : {};
  const health = Array.isArray(parsed['Health'])
    ? parsed['Health'].map(str).filter((h) => h.length > 0)
    : [];
  return {
    backendState: str(parsed['BackendState']),
    selfDnsName: normalizeDnsName(str(self['DNSName'])),
    health,
    peers: parsePeers(parsed['Peer']),
  };
}

/** Parse `tailscale ping -c 1` output. Pure — unit-tested. */
export function parsePing(output: string): PingResult {
  const pong = output
    .split(/\r?\n/)
    .filter((l) => l.startsWith('pong'))
    .pop();
  if (pong === undefined) {
    return {
      ok: false,
      viaRelay: false,
      latency: '',
      detail: lastLine(output),
    };
  }
  const latency = /\bin ([0-9.]+[mµ]?s)\b/.exec(pong)?.[1] ?? '';
  return { ok: true, viaRelay: pong.includes('DERP'), latency, detail: pong };
}

/** Tailscale CLI: PATH first, then the platform's app-bundled binary. */
export function findTailscale(platform: Platform): string | null {
  const onPath = findOnPath('tailscale');
  if (onPath !== null) return onPath;
  return platform.tailscaleAppBinaries()[0] ?? null;
}

export async function tailscaleStatus(
  bin: string
): Promise<TailscaleStatus | null> {
  const r = await run(bin, ['status', '--json'], { timeoutMs: 10_000 });
  return r.status === 0 ? parseTailscaleStatus(r.stdout) : null;
}

export async function tailscalePing(
  bin: string,
  name: string
): Promise<PingResult> {
  const r = await run(bin, ['ping', '-c', '1', '--timeout', '8s', name], {
    timeoutMs: 12_000,
  });
  return parsePing(`${r.stdout}\n${r.stderr}`);
}
