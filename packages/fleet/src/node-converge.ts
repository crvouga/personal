import { workerReadiness } from './worker-readiness';
import { fingerprint, writeReceipt } from './fingerprint';
import { runAnsible } from '../../workstation/cli/lib/platform/ansible';
import {
  stageT3Policy,
  verifyT3Policy,
} from '../../workstation/cli/lib/platform/t3-policy';
import { verifyUbuntuBoot } from '../../workstation/cli/lib/platform/ubuntu-verify';
import { convergeT3Route } from '../../workstation/cli/lib/platform/t3-route';
import { convergeProxy } from './proxy-converge';
import { verifyFleetProviders } from '../../workstation/cli/lib/agents/fleet-verify';
import { managedT3 } from '../../../scripts/dev/native-t3';
import { convergeT3Service } from '../../workstation/cli/lib/platform/t3-service';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { auditUbuntu } from '../../workstation/cli/lib/platform/ubuntu-audit';
import { runLockedCommand as runCommand } from './runner';
import { configureWorkspace } from './configure';
import { isRevision } from './machine/state';
import type { Check } from './types';

/** Internal remote entry only. Controller owns the operation lock and source
 * selection; this installs no pull daemon or timer. Never prints child output.
 */
async function main(): Promise<Check[]> {
  const [node, revision] = process.argv.slice(2);
  if (!node || !/^[a-z][a-z0-9-]{0,62}$/.test(node) || !isRevision(revision))
    throw new Error();
  const root = process.cwd();
  const head = await runCommand(['git', 'rev-parse', 'HEAD']);
  if (!head.ok || head.stdout.trim() !== revision) throw new Error();
  const audit = await auditUbuntu(runCommand);
  const checks: Check[] = [];
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
  checks.push(
    ...(await attempt('tailscale:configuration', async () => [
      await applyTailscale(root),
    ]))
  );
  const baseline = await attempt('ubuntu:baseline', () => applyBaseline(root));
  checks.push(...baseline);
  checks.push(
    ...(await attempt('ubuntu:boot-policy', () =>
      verifyUbuntuBoot(userInfo().username, runCommand)
    ))
  );
  checks.push(...(await t3AfterBaseline(root, node, baseline)));
  checks.push(
    ...(await attempt('workstation:configuration', () =>
      configureWorkstation(root)
    ))
  );
  checks.push(
    ...(await attempt('configuration:apply', () =>
      applyAgentProfiles(root, node, revision)
    ))
  );
  checks.push(
    ...(await attempt('proxy:configuration', () =>
      convergeProxy(node, revision, runCommand)
    ))
  );
  checks.push(
    ...(await attempt('provider:verification', () =>
      verifyFleetProviders(node)
    ))
  );
  checks.push(
    ...(await attempt('worker:readiness', () =>
      workerReadiness(runCommand, node)
    ))
  );
  return checks;
}
if (import.meta.main) {
  const checks = await main().catch((): Check[] => [
    {
      id: 'configuration:operation',
      status: 'fail',
      summary: 'REMOTE_CONFIGURATION_INCOMPLETE',
    },
  ]);
  process.stdout.write(JSON.stringify({ version: 1, checks }));
}

async function applyBaseline(root: string): Promise<Check[]> {
  const checks: Check[] = [];
  {
    const user = userInfo();
    const result = await runAnsible(
      runCommand,
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
    checks.push({
      id: 'ubuntu:baseline',
      status: result.ok ? 'pass' : 'fail',
      summary: result.ok
        ? 'Workstation Ubuntu tasks completed; effective boot/session policies require separate verification.'
        : 'UBUNTU_BASELINE_INCOMPLETE',
    });
  }

  return checks;
}
async function applyTailscale(root: string): Promise<Check> {
  const tailscale = await runCommand(['ansible-playbook', 'tailscale.yml'], {
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

async function convergeT3(root: string, node: string): Promise<Check[]> {
  const artifact = managedT3();
  const checks = await convergeT3Service(artifact, runCommand, async () => {
    const staged = await stageT3Policy(root, artifact.path, runCommand, node);
    return staged.status === 'pass' ? [] : [staged];
  });
  if (checks.every((check) => check.status === 'pass'))
    checks.push(await verifyT3Policy(artifact.path, runCommand));
  if (
    checks.some((check) => check.id === 't3:service' && check.status === 'pass')
  )
    checks.push(...(await convergeT3Route(runCommand)));
  if (
    checks.some((check) => check.id === 't3:service' && check.status === 'pass')
  )
    checks.push(...(await enableWorkerRecovery(root)));
  return checks;
}

async function attempt(
  id: string,
  operation: () => Promise<Check[]>
): Promise<Check[]> {
  const started = Date.now();
  try {
    const checks = await operation();
    const phaseDurationMs = Date.now() - started;
    return checks.map((check) => ({ ...check, phaseDurationMs }));
  } catch {
    return [
      {
        id,
        status: 'fail',
        summary: 'REMOTE_PHASE_FAILED',
        phaseDurationMs: Date.now() - started,
        remedy: {
          action:
            'Inspect the named owner and approved source revision. Prior phase evidence is retained; no exception, environment or auth response is logged.',
        },
      },
    ];
  }
}
async function t3AfterBaseline(
  root: string,
  node: string,
  baseline: Check[]
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
  return attempt('t3:service', () => convergeT3(root, node));
}

async function configureWorkstation(root: string): Promise<Check[]> {
  const installed = await runCommand(
    ['bun', 'run', 'personal:install', '--yes'],
    {
      cwd: root,
      timeoutMs: 300_000,
    }
  );
  if (!installed.ok)
    return [
      {
        id: 'workstation:installation',
        status: 'fail',
        summary: 'WORKSTATION_INSTALLATION_FAILED',
      },
    ];
  // This receipt certifies only frozen dependency inputs, never machine readiness.
  await writeReceipt(root, await fingerprint(root, runCommand));
  await runCommand(['bun', 'scripts/dev/worker-auth.ts'], {
    cwd: root,
    timeoutMs: 90_000,
  });
  const synced = await runCommand(
    [
      'bun',
      'run',
      'personal',
      'workstation',
      'sync',
      '--yes',
      '--non-interactive',
      '--json',
    ],
    {
      cwd: root,
      timeoutMs: 300_000,
    }
  );
  return [
    {
      id: 'workstation:configuration',
      status: synced.ok ? 'pass' : 'fail',
      summary: synced.ok
        ? 'Source-owned personal launcher and managed workstation configuration converged; authentication remains a separate gate.'
        : 'WORKSTATION_SYNC_FAILED',
    },
  ];
}

function applyAgentProfiles(
  root: string,
  node: string,
  revision: string
): Promise<Check[]> {
  return configureWorkspace(
    root,
    { node, revision, tool: 'codex', profile: 'proxy' },
    runCommand,
    {
      additionalTools: ['claude', 'gemini', 'opencode'],
      bootstrappedDeployment: true,
    }
  );
}

async function enableWorkerRecovery(root: string): Promise<Check[]> {
  const user = userInfo();
  const result = await runAnsible(
    runCommand,
    resolve(root, 'packages/workstation/ubuntu/recovery.yml'),
    {
      cwd: root,
      timeoutMs: 60_000,
      input: JSON.stringify({
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
        ? 'Bounded T3 recovery enabled only after verifying ownership of the native worker service.'
        : 'WORKER_RECOVERY_SETUP_FAILED',
    },
  ];
}
