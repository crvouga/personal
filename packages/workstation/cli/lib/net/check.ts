import type { DoctorCheck } from '../doctor';
import type { Platform } from '@crvouga/dev-fleet/src/platform/types';
import { checkHost } from './host-checks';
import { hostGroup, loadInventory, type NetCheck } from './inventory';
import {
  localDiskCheck,
  localT3Check,
  tailscaleLocalChecks,
  vscodeChecks,
} from './local-checks';
import { findTailscale, tailscaleStatus } from './tailscale';

export type NetCheckOpts = {
  readonly host?: string | undefined;
  readonly tries: number;
};

export const THIS_MACHINE_GROUP = 'This machine';

function grouped(group: string, checks: readonly DoctorCheck[]): NetCheck[] {
  return checks.map((c) => ({ ...c, group }));
}

/** Run every local + per-host check. Read-only: changes nothing anywhere. */
export async function runNetChecks(
  platform: Platform,
  opts: NetCheckOpts
): Promise<NetCheck[]> {
  const hosts = loadInventory().filter(
    (h) => opts.host === undefined || h.alias === opts.host
  );
  if (opts.host !== undefined && hosts.length === 0) {
    throw new Error(`unknown host '${opts.host}' (see net/hosts.json)`);
  }
  const tailscaleBin = findTailscale(platform);
  const tailscale =
    tailscaleBin === null ? null : await tailscaleStatus(tailscaleBin);
  const t3 = await localT3Check();
  const disk = localDiskCheck();
  const local = [
    ...tailscaleLocalChecks(tailscaleBin, tailscale),
    t3.check,
    ...vscodeChecks(platform),
    ...(disk === null ? [] : [disk]),
  ];
  const ctx = {
    tailscaleBin,
    tailscale,
    localT3Version: t3.version,
    tries: opts.tries,
  };
  const perHost = await Promise.all(
    hosts.map(async (h) => grouped(hostGroup(h), await checkHost(ctx, h)))
  );
  return [...grouped(THIS_MACHINE_GROUP, local), ...perHost.flat()];
}
