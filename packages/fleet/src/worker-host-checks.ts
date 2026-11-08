import { powerRecoveryCheck } from './power-recovery';
import { auditUbuntu } from '../../workstation/cli/lib/platform/ubuntu-audit';
import { verifyUbuntuBoot } from '../../workstation/cli/lib/platform/ubuntu-verify';
import { verifyResourceSafety } from '../../workstation/cli/lib/platform/resource-verify';
import { verifyDarwinMachine } from '../../workstation/cli/lib/platform/darwin-verify';
import policy from '../../workstation/ubuntu/policy.json';
import { userInfo } from 'node:os';
import type { Check, Runner } from './types';

function check(id: string, ok: boolean, summary: string): Check {
  return {
    id: `worker:${id}`,
    status: ok ? 'pass' : 'fail',
    summary,
    ...(!ok
      ? {
          remedy: {
            action:
              'Apply the approved fleet-sync revision over verified SSH, then rerun fleet-status --workers. No password prompt or state reset is attempted by health.',
          },
        }
      : {}),
  };
}
/** Measured runtime evidence, independent of installer receipts. */
export async function workerHostChecks(
  user: string,
  run: Runner,
  platform: NodeJS.Platform = process.platform
): Promise<Check[]> {
  if (platform === 'darwin')
    return verifyDarwinMachine({ name: user, uid: userInfo().uid }, run);
  const audit = await auditUbuntu(run);
  const checks = [
    check(
      'ubuntu',
      audit.supported,
      'Required Ubuntu release and architecture.'
    ),
    check(
      'sudo',
      audit.passwordlessSudo,
      'Designated worker user has noninteractive sudo.'
    ),
    ...Object.entries(policy.packages).map(([name, version]) =>
      check(
        `package:${name}`,
        audit.packages[name] === version,
        'Exact declarative Ubuntu package version.'
      )
    ),
  ];
  for (const name of policy.alwaysOnServices) {
    const unit = await run([
      'systemctl',
      'show',
      `${name}.service`,
      '--property=UnitFileState,ActiveState,Restart',
    ]);
    const active =
      name === 'beszel-agent'
        ? /^ActiveState=active$/m.test(unit.stdout)
        : audit.services[name] === true;
    checks.push(
      check(
        `service:${name}`,
        unit.ok &&
          active &&
          /^UnitFileState=enabled$/m.test(unit.stdout) &&
          /^Restart=always$/m.test(unit.stdout),
        'Required system service is active, enabled for boot and restarts unconditionally.'
      )
    );
  }
  checks.push(...(await recoveryChecks(run)));
  checks.push(...(await verifyUbuntuBoot(user, run)));
  checks.push(...(await verifyResourceSafety(userInfo().homedir, run)));
  return checks;
}

async function recoveryChecks(run: Runner): Promise<Check[]> {
  const checks: Check[] = [];
  const t3 = await run([
    'systemctl',
    '--user',
    'show',
    't3code.service',
    '--property=ActiveState,UnitFileState,Restart',
  ]);
  checks.push(
    check(
      't3-recovery',
      t3.ok &&
        /^ActiveState=active$/m.test(t3.stdout) &&
        /^UnitFileState=enabled$/m.test(t3.stdout) &&
        /^Restart=(always|on-failure)$/m.test(t3.stdout),
      'T3 runs as an enabled user service with automatic crash recovery.'
    )
  );
  checks.push(await t3HealthCheck(run));
  const renewal = await run([
    'systemctl',
    '--user',
    'is-active',
    'personal-worker-auth.timer',
  ]);
  const recovery = await run([
    'systemctl',
    '--user',
    'is-active',
    'personal-worker-recovery.timer',
  ]);
  checks.push(
    check(
      'credential-renewal',
      renewal.ok,
      'Worker credential renewal timer is active.'
    )
  );
  checks.push(
    check(
      'service-recovery',
      recovery.ok,
      'Worker service recovery timer is active.'
    )
  );
  checks.push(await powerRecoveryCheck(run));
  return checks;
}

/** The server answers its local API now, not merely that a process exists. */
async function t3HealthCheck(run: Runner): Promise<Check> {
  const probe = await run(
    [
      'curl',
      '--fail',
      '--silent',
      '--max-time',
      '10',
      'http://127.0.0.1:3773/.well-known/t3/environment',
    ],
    { timeoutMs: 15_000 }
  );
  let identified = false;
  try {
    const value: unknown = JSON.parse(probe.stdout);
    identified =
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>)['environmentId'] === 'string';
  } catch {
    /* Raw responses are never reported. */
  }
  return check(
    't3-health',
    probe.ok && identified,
    'T3 local API answers with its environment identity within 10 seconds.'
  );
}
