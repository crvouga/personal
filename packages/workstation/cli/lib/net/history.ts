import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { Platform } from '../platform/types';
import type { NetCheck } from './inventory';

const LOG_MAX_LINES = 3000;

export function netStateDir(platform: Platform): string {
  return join(platform.cacheDir(), 'ws', 'net');
}

/** Stable identity of each failure (group + check id), sorted. Pure. */
export function failureKeys(checks: readonly NetCheck[]): string[] {
  return checks
    .filter((c) => c.severity === 'fail')
    .map((c) => `${c.group} :: ${c.id}`)
    .sort();
}

export type NetNotification = {
  readonly title: string;
  readonly message: string;
  readonly kind: 'error' | 'finished';
};

/** Notify only on change: new failures, or full recovery. Pure — unit-tested. */
export function notificationFor(
  previous: readonly string[],
  checks: readonly NetCheck[]
): NetNotification | null {
  const next = failureKeys(checks);
  if (next.join('\n') === previous.join('\n')) return null;
  if (next.length === 0) {
    return {
      title: 'personal workstation net: recovered',
      message: 'All machines are connected again.',
      kind: 'finished',
    };
  }
  const fails = checks.filter((c) => c.severity === 'fail');
  const message = fails
    .slice(0, 2)
    .map((c) => `${c.group.split(' ')[0] ?? c.group}: ${c.label}`)
    .join(' · ');
  return {
    title: `personal workstation net: ${fails.length} problem(s)`,
    message,
    kind: 'error',
  };
}

export function readPreviousFailures(platform: Platform): string[] {
  try {
    const raw = readFileSync(
      join(netStateDir(platform), 'last-failures'),
      'utf8'
    );
    return raw.split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/** Persist failure keys and append a timestamped entry to `net-check.log`. */
export function recordRun(
  platform: Platform,
  checks: readonly NetCheck[]
): void {
  const dir = netStateDir(platform);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'last-failures'), failureKeys(checks).join('\n'));
  const problems = checks
    .filter((c) => c.severity !== 'pass')
    .map(
      (c) =>
        `    ${c.severity.toUpperCase()} [${c.group}] ${c.label}: ${c.detail}`
    );
  const fails = checks.filter((c) => c.severity === 'fail').length;
  const warns = checks.filter((c) => c.severity === 'warn').length;
  const log = join(dir, 'check.log');
  appendFileSync(
    log,
    [
      `${new Date().toISOString()} fails=${fails} warns=${warns}`,
      ...problems,
      '',
    ].join('\n')
  );
  const lines = readFileSync(log, 'utf8').split('\n');
  if (lines.length > LOG_MAX_LINES) {
    writeFileSync(log, lines.slice(-LOG_MAX_LINES).join('\n'));
  }
}
