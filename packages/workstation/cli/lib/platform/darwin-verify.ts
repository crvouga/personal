import policy from '../../../macos/policy.json';
import type { Check, Runner } from '../../../../fleet/src/types';

function check(
  id: string,
  ok: boolean,
  summary: string,
  action: string
): Check {
  return {
    id,
    status: ok ? 'pass' : 'fail',
    summary,
    ...(ok ? {} : { remedy: { action } }),
  };
}

/** Parse `pmset -g custom`: every declared key must read the declared value in
 * each power-source section. Desktop Macs expose one section, laptops two. A key
 * the hardware does not list at all (autorestart on laptops) is unsupported, not drift.
 */
export function pmsetDrift(output: string): string[] {
  return Object.entries(policy.pmset)
    .filter(([key, value]) => {
      const observed = [
        ...output.matchAll(new RegExp(`^\\s*${key}\\s+(\\S+)\\s*$`, 'gm')),
      ].map((match) => match[1]);
      return observed.some((entry) => entry !== value);
    })
    .map(([key]) => key);
}

/** Measured macOS runtime evidence for the declared always-on policy. */
export async function verifyDarwinMachine(
  user: { name: string; uid: number },
  run: Runner
): Promise<Check[]> {
  const pmset = await run(['/usr/bin/pmset', '-g', 'custom']);
  const drift = pmset.ok ? pmsetDrift(pmset.stdout) : Object.keys(policy.pmset);
  const autologout = await run([
    '/usr/bin/defaults',
    'read',
    '/Library/Preferences/.GlobalPreferences',
    'com.apple.autologout.AutoLogOutDelay',
  ]);
  const autologoutOff =
    !autologout.ok ||
    autologout.stdout.trim() === String(policy.autoLogOutDelay);
  const tailscale = await tailscaleState(run);
  const renewal = await run([
    '/bin/launchctl',
    'print',
    `gui/${user.uid}/${policy.credentialRenewalAgent}`,
  ]);
  return [
    check(
      'macos:power',
      drift.length === 0,
      drift.length
        ? `MACOS_POWER_POLICY_DRIFT: ${drift.join(', ')}`
        : 'pmset reports never-sleep, wake-on-network and restart-after-power-loss.',
      'Rerun personal fleet-sync for this node, then inspect pmset -g custom and any MDM energy profile.'
    ),
    check(
      'macos:session',
      autologoutOff,
      autologoutOff
        ? 'Automatic logout after inactivity is disabled.'
        : 'MACOS_AUTOLOGOUT_ENABLED',
      'Rerun personal fleet-sync for this node; it sets AutoLogOutDelay to 0 without logging anyone out.'
    ),
    check(
      'macos:tailscale',
      tailscale.running,
      tailscale.running
        ? `Tailscale is authenticated and running (${tailscale.daemon}).`
        : 'TAILSCALE_LOGIN_OR_SERVICE_REQUIRED',
      'Open Tailscale on this Mac and complete its native login; the fleet never copies device identity.'
    ),
    check(
      'worker:credential-renewal',
      renewal.ok,
      renewal.ok
        ? 'Worker credential renewal launch agent is loaded.'
        : 'MACOS_CREDENTIAL_RENEWAL_AGENT_UNLOADED',
      'Log the designated user in once so launchd loads the agent, or rerun personal fleet-sync for this node.'
    ),
  ];
}

async function tailscaleState(
  run: Runner
): Promise<{ running: boolean; daemon: string }> {
  for (const path of [
    '/opt/homebrew/bin/tailscale',
    '/usr/local/bin/tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  ]) {
    const status = await run([path, 'status', '--json']);
    if (!status.ok) continue;
    try {
      const value: unknown = JSON.parse(status.stdout);
      const running =
        typeof value === 'object' &&
        value !== null &&
        (value as Record<string, unknown>)['BackendState'] === 'Running';
      const daemon = path.includes('.app')
        ? 'Tailscale.app login item'
        : (
              await run([
                '/bin/launchctl',
                'print',
                `system/${policy.tailscaleDaemon}`,
              ])
            ).ok
          ? 'launchd system daemon'
          : 'daemon not loaded';
      return { running: running && daemon !== 'daemon not loaded', daemon };
    } catch {
      /* Raw status output may contain peer details; never surface it. */
    }
  }
  return { running: false, daemon: 'not installed' };
}
