import { workerReadiness } from './worker-readiness';
import { runAnsible } from '../../workstation/cli/lib/platform/ansible';
import {
  stageT3Policy,
  verifyT3Policy,
} from '../../workstation/cli/lib/platform/t3-policy';
import { verifyUbuntuBoot } from '../../workstation/cli/lib/platform/ubuntu-verify';
import { verifyResourceSafety } from '../../workstation/cli/lib/platform/resource-verify';
import { convergeT3Route } from '../../workstation/cli/lib/platform/t3-route';
import { convergeProxy } from './proxy-converge';
import { verifyFleetProviders } from '../../workstation/cli/lib/agents/fleet-verify';
import { managedT3, managedT3Desktop } from '../../../scripts/dev/native-t3';
import { convergeT3Service } from '../../workstation/cli/lib/platform/t3-service';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { auditUbuntu } from '../../workstation/cli/lib/platform/ubuntu-audit';
import {
  applyAgentProfiles,
  attempt,
  configureWorkstation,
} from './node-converge-shared';
import type { Check, Runner } from './types';

/** Ubuntu worker convergence: Ansible owns OS policy, services and recovery; the
 * native T3, proxy and provider owners run only after the baseline passes.
 */
export async function convergeLinux(
  root: string,
  node: string,
  revision: string,
  run: Runner
): Promise<Check[]> {
  const audit = await auditUbuntu(run);
  if (!audit.supported || !audit.passwordlessSudo)
    return [
      {
        id: 'ubuntu:prerequisites',
        status: 'fail',
        summary: audit.supported
          ? 'SUDO_AUTHORIZATION_REQUIRED'
          : 'UBUNTU_BASELINE_MISMATCH',
        remedy: {
          action:
            'Authorize designated-user sudo through the controller enrollment flow; unsupported releases require an explicit migration.',
        },
      },
    ];
  const checks: Check[] = [];
  checks.push(
    ...(await attempt('tailscale:configuration', async () => [
      await applyTailscale(root, run),
    ]))
  );
  const baseline = await attempt('ubuntu:baseline', () =>
    applyBaseline(root, run)
  );
  checks.push(...baseline);
  checks.push(
    ...(await attempt('ubuntu:boot-policy', () =>
      verifyUbuntuBoot(userInfo().username, run)
    ))
  );
  checks.push(
    ...(await attempt('ubuntu:resource-safety', () =>
      verifyResourceSafety(userInfo().homedir, run)
    ))
  );
  checks.push(...(await t3AfterBaseline(root, node, baseline, run)));
  checks.push(
    ...(await attempt('workstation:configuration', () =>
      configureWorkstation(root, run)
    ))
  );
  checks.push(
    ...(await attempt('configuration:apply', () =>
      applyAgentProfiles(root, node, revision, run)
    ))
  );
  checks.push(
    ...(await attempt('proxy:configuration', () =>
      convergeProxy(node, revision, run)
    ))
  );
  checks.push(
    ...(await attempt('provider:verification', () =>
      verifyFleetProviders(node)
    ))
  );
  checks.push(
    ...(await attempt('worker:readiness', () => workerReadiness(run, node)))
  );
  return checks;
}

async function applyBaseline(root: string, run: Runner): Promise<Check[]> {
  const user = userInfo();
  const result = await runAnsible(
    run,
    resolve(root, 'packages/workstation/ubuntu/baseline.yml'),
    {
      cwd: resolve(root, 'packages/workstation/ubuntu'),
      timeoutMs: 900_000,
      input: JSON.stringify({
        development_source: root,
        development_user: user.username,
        development_uid: user.uid,
        development_home: user.homedir,
      }),
    }
  );
  return [
    {
      id: 'ubuntu:baseline',
      status: result.ok ? 'pass' : 'fail',
      summary: result.ok
        ? 'Workstation Ubuntu tasks completed, including always-on service recovery; effective boot/session policies require separate verification.'
        : 'UBUNTU_BASELINE_INCOMPLETE',
    },
  ];
}

async function applyTailscale(root: string, run: Runner): Promise<Check> {
  const tailscale = await run(['ansible-playbook', 'tailscale.yml'], {
    cwd: resolve(root, 'packages/workstation/ubuntu'),
    timeoutMs: 300_000,
  });
  return {
    id: 'tailscale:configuration',
    status: tailscale.ok ? 'pass' : 'fail',
    summary: tailscale.ok
      ? 'Pinned native Tailscale service is enabled, running and authenticated; controller reachability remains separate.'
      : 'TAILSCALE_SETUP_OR_LOGIN_REQUIRED',
  };
}

async function convergeT3(
  root: string,
  node: string,
  run: Runner
): Promise<Check[]> {
  const artifact = managedT3();
  const checks = await convergeT3Service(
    artifact,
    run,
    async () => {
      const staged = await stageT3Policy(root, artifact.path, run, node);
      return staged.status === 'pass' ? [] : [staged];
    },
    () => installT3Desktop(root, run)
  );
  if (checks.every((check) => check.status === 'pass'))
    checks.push(await verifyT3Policy(artifact.path, run));
  const serviceReady = checks.some(
    (check) => check.id === 't3:service' && check.status === 'pass'
  );
  if (serviceReady) checks.push(...(await convergeT3Route(run)));
  if (serviceReady) checks.push(...(await enableWorkerRecovery(root, run)));
  return checks;
}

async function installT3Desktop(root: string, run: Runner): Promise<boolean> {
  const user = userInfo();
  const desktop = managedT3Desktop();
  const result = await runAnsible(
    run,
    resolve(root, 'packages/workstation/ubuntu/t3-desktop.yml'),
    {
      cwd: root,
      timeoutMs: 600_000,
      input: JSON.stringify({
        development_user: user.username,
        development_uid: user.uid,
        development_home: user.homedir,
        t3_desktop_url: desktop.url,
        t3_desktop_name: desktop.name,
        t3_desktop_sha256: desktop.sha256,
      }),
    }
  );
  return result.ok;
}

async function t3AfterBaseline(
  root: string,
  node: string,
  baseline: Check[],
  run: Runner
): Promise<Check[]> {
  if (baseline.some((check) => check.status !== 'pass'))
    return [
      {
        id: 't3:prerequisites',
        status: 'skip',
        summary: 'T3_BASELINE_PREREQUISITES_REQUIRED',
        remedy: {
          action:
            'Complete the designated-user baseline and lingering policy before changing native service lifecycle. Existing service state is preserved.',
        },
      },
    ];
  return attempt('t3:service', () => convergeT3(root, node, run));
}

async function enableWorkerRecovery(
  root: string,
  run: Runner
): Promise<Check[]> {
  const user = userInfo();
  const result = await runAnsible(
    run,
    resolve(root, 'packages/workstation/ubuntu/recovery.yml'),
    {
      cwd: root,
      timeoutMs: 60_000,
      input: JSON.stringify({
        development_source: root,
        development_user: user.username,
        development_uid: user.uid,
        development_home: user.homedir,
      }),
    }
  );
  return [
    {
      id: 'worker:service-recovery',
      status: result.ok ? 'pass' : 'fail',
      summary: result.ok
        ? 'T3 recovery enabled: a stopped desktop app is started and an unresponsive one restarted after three failed one-minute health checks.'
        : 'WORKER_RECOVERY_SETUP_FAILED',
    },
  ];
}
