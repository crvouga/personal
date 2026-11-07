import { powerRecoveryCheck } from './power-recovery';
import { auditUbuntu } from '../../workstation/cli/lib/platform/ubuntu-audit';
import { verifyUbuntuBoot } from '../../workstation/cli/lib/platform/ubuntu-verify';
import policy from '../../workstation/ubuntu/policy.json';
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
              'Apply the approved fleet-converge revision over verified SSH, then rerun fleet-health. No password prompt or state reset is attempted by health.',
          },
        }
      : {}),
  };
}
/** Measured runtime evidence, independent of installer receipts. */
export async function workerHostChecks(
  user: string,
  run: Runner
): Promise<Check[]> {
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
  for (const name of ['ssh', 'tailscaled', 'docker']) {
    const enabled = await run(['systemctl', 'is-enabled', `${name}.service`]);
    checks.push(
      check(
        `service:${name}`,
        audit.services[name] === true && enabled.ok,
        'Required system service is active and enabled for boot.'
      )
    );
  }
  checks.push(...(await recoveryChecks(run)));
  checks.push(...(await verifyUbuntuBoot(user, run)));
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
