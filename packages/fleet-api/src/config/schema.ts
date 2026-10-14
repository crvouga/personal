import { createHash } from 'node:crypto';

import { isRole, type Role } from '../types';

/**
 * Fleet configuration: data, never code. Each node receives the merge of the
 * documents that apply to it and applies the keys it understands to its own
 * behavior. A key a node does not set keeps the value built into its image.
 * The meaning of each key on the node is in packages/fleet/docs/dynamic-config.md.
 */
export interface FleetConfig {
  heartbeat?: { intervalSeconds?: number };
  sync?: { paused?: boolean };
  reboot?: { enabled?: boolean; delayMaxSeconds?: number };
  disk?: { alertPercent?: number };
  capacity?: {
    reserveGiB?: number;
    perRunnerGiB?: number;
    perRunnerCores?: number;
    slotMax?: number;
    highMemGiB?: number;
  };
  runners?: {
    enabled?: boolean;
    cordoned?: boolean;
    repositories?: string[];
    extraLabels?: string[];
  };
  /** Server side only. Never sent to a node. */
  alerts?: { offlineAfterSeconds?: number; webhookUrl?: string | null };
}

type Section = keyof FleetConfig;

interface IntRule {
  readonly kind: 'int';
  readonly min: number;
  readonly max: number;
}
interface BoolRule {
  readonly kind: 'bool';
}
interface ListRule {
  readonly kind: 'list';
  readonly max: number;
  readonly pattern: RegExp;
  readonly forbidden?: readonly string[];
}
interface UrlRule {
  readonly kind: 'url-or-null';
}
type Rule = IntRule | BoolRule | ListRule | UrlRule;

/** Labels the image already sets, so a person cannot shadow them. */
export const RESERVED_LABELS = [
  'self-hosted',
  'linux',
  'x64',
  'arm64',
  'nixos',
  'ci',
  'gpu',
  'high-mem',
] as const;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LABEL_PATTERN = /^[A-Za-z0-9_.:-]{1,50}$/;
const MAX_REPOSITORIES = 64;
const MAX_LABELS = 16;
const MAX_URL_LENGTH = 500;

export const RULES: Readonly<Record<Section, Readonly<Record<string, Rule>>>> =
  {
    heartbeat: { intervalSeconds: { kind: 'int', min: 15, max: 3600 } },
    sync: { paused: { kind: 'bool' } },
    reboot: {
      enabled: { kind: 'bool' },
      delayMaxSeconds: { kind: 'int', min: 0, max: 86400 },
    },
    disk: { alertPercent: { kind: 'int', min: 50, max: 99 } },
    capacity: {
      reserveGiB: { kind: 'int', min: 0, max: 256 },
      perRunnerGiB: { kind: 'int', min: 1, max: 256 },
      perRunnerCores: { kind: 'int', min: 1, max: 128 },
      slotMax: { kind: 'int', min: 1, max: 64 },
      highMemGiB: { kind: 'int', min: 1, max: 4096 },
    },
    runners: {
      enabled: { kind: 'bool' },
      cordoned: { kind: 'bool' },
      repositories: {
        kind: 'list',
        max: MAX_REPOSITORIES,
        pattern: REPO_PATTERN,
      },
      extraLabels: {
        kind: 'list',
        max: MAX_LABELS,
        pattern: LABEL_PATTERN,
        forbidden: RESERVED_LABELS,
      },
    },
    alerts: {
      offlineAfterSeconds: { kind: 'int', min: 60, max: 86400 },
      webhookUrl: { kind: 'url-or-null' },
    },
  };

export const SECTIONS = Object.keys(RULES) as Section[];

export type ValidationResult =
  | { readonly ok: true; readonly value: FleetConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkInt(path: string, value: unknown, rule: IntRule): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `${path} must be a whole number`;
  }
  if (value < rule.min || value > rule.max) {
    return `${path} must be between ${rule.min} and ${rule.max}`;
  }
  return null;
}

function checkListItems(
  path: string,
  items: unknown[],
  rule: ListRule
): string | null {
  for (const item of items) {
    if (typeof item !== 'string' || !rule.pattern.test(item)) {
      return `${path} has an invalid entry ${JSON.stringify(item)}`;
    }
    if (rule.forbidden?.includes(item.toLowerCase())) {
      return `${path} may not contain ${item}: the image already sets it`;
    }
  }
  return new Set(items).size === items.length ? null : `${path} has duplicates`;
}

function checkList(
  path: string,
  value: unknown,
  rule: ListRule
): string | null {
  if (!Array.isArray(value)) return `${path} must be a list`;
  if (value.length > rule.max)
    return `${path} may have at most ${rule.max} entries`;
  return checkListItems(path, value, rule);
}

function checkUrl(path: string, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    return `${path} must be an https URL or null`;
  }
  try {
    return new URL(value).protocol === 'https:'
      ? null
      : `${path} must be https`;
  } catch {
    return `${path} must be an https URL or null`;
  }
}

function checkValue(path: string, value: unknown, rule: Rule): string | null {
  switch (rule.kind) {
    case 'int':
      return checkInt(path, value, rule);
    case 'bool':
      return typeof value === 'boolean'
        ? null
        : `${path} must be true or false`;
    case 'list':
      return checkList(path, value, rule);
    case 'url-or-null':
      return checkUrl(path, value);
  }
}

function checkSection(name: string, value: unknown): string[] {
  const rules = RULES[name as Section];
  if (!isRecord(value)) return [`${name} must be an object`];
  const errors: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const rule = rules[key];
    if (rule === undefined) {
      errors.push(`${name}.${key} is not a setting`);
      continue;
    }
    const problem = checkValue(`${name}.${key}`, entry, rule);
    if (problem !== null) errors.push(problem);
  }
  return errors;
}

/** Strict: an unknown key is an error, so a typo cannot silently do nothing. */
export function validateConfig(input: unknown): ValidationResult {
  if (!isRecord(input))
    return { ok: false, errors: ['settings must be an object'] };
  const errors: string[] = [];
  for (const [name, value] of Object.entries(input)) {
    if (!(name in RULES)) {
      errors.push(`${name} is not a settings section`);
      continue;
    }
    errors.push(...checkSection(name, value));
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as FleetConfig };
}

/** Objects merge key by key; lists and scalars from the later layer replace. */
export function mergeConfig(...layers: readonly FleetConfig[]): FleetConfig {
  const out: Record<string, Record<string, unknown>> = {};
  for (const layer of layers) {
    for (const [section, entries] of Object.entries(layer)) {
      out[section] = {
        ...out[section],
        ...(entries as Record<string, unknown>),
      };
    }
  }
  return out as FleetConfig;
}

export type Scope = 'fleet' | `role:${Role}` | `node:${string}`;

const NODE_SCOPE = /^node:[0-9a-f]{64}$/;

export function isScope(value: string): value is Scope {
  if (value === 'fleet') return true;
  if (value.startsWith('role:')) return isRole(value.slice('role:'.length));
  return NODE_SCOPE.test(value);
}

export interface ScopeDocuments {
  readonly fleet: FleetConfig;
  readonly role: FleetConfig;
  readonly node: FleetConfig;
}

/** Fleet, then the node's role, then the node itself. The later one wins. */
export function resolveConfig(documents: ScopeDocuments): FleetConfig {
  return mergeConfig(documents.fleet, documents.role, documents.node);
}

/** What a node is sent: everything except the server-only section. */
export function nodePayload(
  resolved: FleetConfig
): Omit<FleetConfig, 'alerts'> {
  const { alerts: _alerts, ...rest } = resolved;
  return rest;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short fingerprint of a node's configuration. Equal content, equal revision. */
export function configRevision(payload: Omit<FleetConfig, 'alerts'>): string {
  return createHash('sha256')
    .update(canonical(payload))
    .digest('hex')
    .slice(0, 16);
}
