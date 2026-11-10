import { readdirSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { DoctorCheck } from '../doctor';
import { failCheck, passCheck, warnCheck } from './make-check';
import type { Platform } from '../../../../fleet/src/platform/types';
import { diskCheck } from '../../../../fleet/src/machine-health';
import { findOnPath } from './run';
import { fetchT3Environment, LOCAL_T3_ORIGIN } from './t3';
import type { TailscaleStatus } from './tailscale';

type Check = DoctorCheck;

export function tailscaleLocalChecks(
  bin: string | null,
  status: TailscaleStatus | null
): Check[] {
  if (bin === null) {
    return [
      failCheck(
        'ts-installed',
        'Tailscale',
        'not installed',
        'Install it from tailscale.com/download.'
      ),
    ];
  }
  const state = status?.backendState ?? 'unknown';
  const checks = [
    state === 'Running'
      ? passCheck('ts-running', 'Tailscale', 'running')
      : failCheck(
          'ts-running',
          'Tailscale',
          `state is '${state}'`,
          'Open the Tailscale app and connect.'
        ),
  ];
  if (status !== null && status.health.length > 0) {
    checks.push(
      warnCheck('ts-health', 'Tailscale health', status.health.join('; '))
    );
  }
  checks.push(
    findOnPath('tailscale') === null
      ? warnCheck(
          'ts-cli',
          'tailscale command',
          "not on PATH, so T3 Code can't run 'tailscale status'",
          'Run `personal workstation net fix` (adds a wrapper), then restart T3 Code.'
        )
      : passCheck('ts-cli', 'tailscale command', 'on PATH')
  );
  return checks;
}

export async function localT3Check(): Promise<{
  check: Check;
  version: string | null;
}> {
  const env = await fetchT3Environment(LOCAL_T3_ORIGIN, 5000);
  if (env === null) {
    return {
      check: warnCheck(
        't3-local',
        'T3 server',
        `not answering at ${LOCAL_T3_ORIGIN}`,
        'Open T3 Code on this machine (skip if it is not used here).'
      ),
      version: null,
    };
  }
  return {
    check: passCheck(
      't3-local',
      'T3 server',
      `${env.label} v${env.serverVersion}`
    ),
    version: env.serverVersion,
  };
}

function hasRemoteSshExtension(): boolean {
  try {
    return readdirSync(join(homedir(), '.vscode/extensions')).some((d) =>
      /^ms-vscode-remote\.remote-ssh-\d/.test(d)
    );
  } catch {
    return false;
  }
}

export function vscodeChecks(platform: Platform): Check[] {
  const checks = [
    hasRemoteSshExtension()
      ? passCheck('vscode-ext', 'VS Code Remote-SSH', 'extension installed')
      : warnCheck(
          'vscode-ext',
          'VS Code Remote-SSH',
          'extension missing',
          "Install 'Remote - SSH' in VS Code."
        ),
  ];
  if (findOnPath('code') === null && platform.vscodeCliBinaries().length > 0) {
    checks.push(
      warnCheck(
        'vscode-cli',
        'code command',
        'not on PATH',
        'Run `personal workstation net fix`.'
      )
    );
  }
  return checks;
}

export function localDiskCheck(): Check | null {
  try {
    const s = statfsSync(homedir());
    return diskCheck(Math.floor((s.bavail * s.bsize) / 1024 / 1024));
  } catch {
    return null;
  }
}
