import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { globalLauncherPath } from '../global-install';
import type { Platform, ScheduledJob } from '../platform/types';
import { netStateDir } from './history';
import type { NetHost } from './inventory';
import { findOnPath } from './run';
import { renderSshBlock, upsertSshBlock } from './ssh-config';
import { mergeVscodeSettings } from './vscode';

export const NET_JOB_LABEL = 'dev.chrisvouga.ws-net-check';
export const NET_JOB_INTERVAL_S = 300;

export type FixStep = {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly changed: boolean;
  readonly detail: string;
};

function step(
  id: string,
  label: string,
  r: { ok?: boolean; changed: boolean; detail: string }
): FixStep {
  return { id, label, ok: r.ok ?? true, changed: r.changed, detail: r.detail };
}

/** Copy `file` into `backupDir` before it is rewritten. */
function backup(file: string, backupDir: string): void {
  if (!existsSync(file)) return;
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(file, join(backupDir, basename(file)));
}

export function newBackupDir(platform: Platform): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(netStateDir(platform), 'backups', stamp);
}

/** `tailscale` on PATH: T3 Code shells out to `tailscale status`. */
export function fixTailscaleCli(platform: Platform): FixStep {
  const label = 'tailscale command on PATH';
  if (findOnPath('tailscale') !== null)
    return step('tailscale-cli', label, {
      changed: false,
      detail: 'already on PATH',
    });
  const app = platform.tailscaleAppBinaries()[0];
  if (app === undefined || platform.name === 'windows') {
    return step('tailscale-cli', label, {
      ok: false,
      changed: false,
      detail: 'no Tailscale app binary found; install Tailscale',
    });
  }
  const wrapper = join(platform.globalBinDir(), 'tailscale');
  mkdirSync(dirname(wrapper), { recursive: true });
  writeFileSync(
    wrapper,
    `#!/bin/sh\n# Managed by \`ws net fix\`.\nexec "${app}" "$@"\n`
  );
  chmodSync(wrapper, 0o755);
  return step('tailscale-cli', label, {
    changed: true,
    detail: `wrote ${wrapper}; restart T3 Code to pick it up`,
  });
}

export function fixCodeCli(platform: Platform): FixStep {
  const label = 'code command on PATH';
  if (findOnPath('code') !== null)
    return step('code-cli', label, {
      changed: false,
      detail: 'already on PATH',
    });
  const app = platform.vscodeCliBinaries()[0];
  if (app === undefined)
    return step('code-cli', label, {
      changed: false,
      detail: 'VS Code not installed; skipped',
    });
  const link = join(
    platform.globalBinDir(),
    platform.name === 'windows' ? 'code.cmd' : 'code'
  );
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(app, link);
  return step('code-cli', label, { changed: true, detail: `linked ${link}` });
}

export function fixSshConfig(
  hosts: readonly NetHost[],
  backupDir: string
): FixStep {
  const path = join(homedir(), '.ssh/config');
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const after = upsertSshBlock(before, renderSshBlock(hosts));
  if (after === before)
    return step('ssh-config', '~/.ssh/config hosts', {
      changed: false,
      detail: 'up to date',
    });
  backup(path, backupDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, after, { mode: 0o600 });
  chmodSync(path, 0o600);
  return step('ssh-config', '~/.ssh/config hosts', {
    changed: true,
    detail: `managed block written (${hosts.length} hosts)`,
  });
}

export function fixVscodeSettings(
  platform: Platform,
  hosts: readonly NetHost[],
  backupDir: string
): FixStep {
  const label = 'VS Code Remote-SSH settings';
  const path = platform.vscodeSettingsPath();
  if (path === null)
    return step('vscode-settings', label, {
      changed: false,
      detail: 'unknown settings location; skipped',
    });
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const merged = mergeVscodeSettings(raw, hosts);
  if (!merged.ok)
    return step('vscode-settings', label, {
      ok: false,
      changed: false,
      detail: merged.reason,
    });
  if (!merged.changed)
    return step('vscode-settings', label, {
      changed: false,
      detail: 'up to date',
    });
  backup(path, backupDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, merged.text);
  return step('vscode-settings', label, {
    changed: true,
    detail: 'per-host platform + 60s connect timeout',
  });
}

export function netWatchJob(platform: Platform): ScheduledJob {
  return {
    label: NET_JOB_LABEL,
    command: [
      globalLauncherPath(platform),
      'net',
      'check',
      '--notify',
      '--quiet',
      '--tries',
      '2',
    ],
    intervalSeconds: NET_JOB_INTERVAL_S,
    logDir: netStateDir(platform),
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
  };
}

export function fixWatch(platform: Platform): FixStep {
  const r = platform.installScheduledJob(netWatchJob(platform));
  return step(
    'watch',
    `background check every ${NET_JOB_INTERVAL_S / 60} min`,
    { ok: r.ok, changed: r.ok, detail: r.detail }
  );
}
