import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { DoctorCheck } from '../doctor';
import { workstationRoot } from '../paths';

export type NetHostOs = 'macOS' | 'linux' | 'windows';

/** One machine from the checked-in `net/hosts.json` inventory. */
export type NetHost = {
  readonly alias: string;
  readonly tailscaleName: string;
  readonly sshPort: number;
  readonly user: string;
  readonly identityFile: string;
  readonly os: NetHostOs;
  readonly t3Port: number;
};

/** A doctor-style check, grouped by the machine it is about. */
export type NetCheck = DoctorCheck & { readonly group: string };

export function inventoryPath(): string {
  return join(workstationRoot(), 'net/hosts.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`net/hosts.json: "${key}" must be a non-empty string`);
  }
  return value;
}

function requirePort(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`net/hosts.json: "${key}" must be a positive integer`);
  }
  return value;
}

function parseOs(raw: Record<string, unknown>): NetHostOs {
  const os = requireString(raw, 'os');
  if (os === 'macOS' || os === 'linux' || os === 'windows') return os;
  throw new Error(`net/hosts.json: "os" must be macOS, linux or windows`);
}

function parseHost(raw: unknown): NetHost {
  if (!isRecord(raw)) throw new Error('net/hosts.json: host must be an object');
  return {
    alias: requireString(raw, 'alias'),
    tailscaleName: requireString(raw, 'tailscaleName'),
    sshPort: requirePort(raw, 'sshPort'),
    user: requireString(raw, 'user'),
    identityFile: requireString(raw, 'identityFile'),
    os: parseOs(raw),
    t3Port: requirePort(raw, 't3Port'),
  };
}

/** Parse and validate the inventory JSON. Pure — unit-tested. */
export function parseInventory(text: string): NetHost[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed['hosts'])) {
    throw new Error('net/hosts.json: expected { "hosts": [...] }');
  }
  return parsed['hosts'].map(parseHost);
}

export function loadInventory(): NetHost[] {
  return parseInventory(readFileSync(inventoryPath(), 'utf8'));
}

/** `~/x` → absolute path under the current home directory. */
export function expandHome(path: string, home: string = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

/** First DNS label: `box.tailnet.ts.net` → `box`. */
export function shortName(fqdn: string): string {
  return fqdn.split('.')[0] ?? fqdn;
}

export function hostGroup(host: NetHost): string {
  return `${host.alias} (${host.tailscaleName})`;
}
