import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { runAnsible } from '../../workstation/cli/lib/platform/ansible';
import { verifyDarwinMachine } from '../../workstation/cli/lib/platform/darwin-verify';
import { verifyFleetProviders } from '../../workstation/cli/lib/agents/fleet-verify';
import { workerAccessChecks } from './worker-access-checks';
import {
  applyAgentProfiles,
  attempt,
  configureWorkstation,
} from './node-converge-shared';
import type { Check, Runner } from './types';

/** Best-effort macOS convergence: the same Ansible-first order as Ubuntu with
 * launchd in place of systemd. Singleton proxy hosting and the native T3 worker
 * service stay Linux-only and are reported as explicitly out of scope.
 */
export async function convergeDarwin(
  root: string,
  node: string,
  revision: string,
  run: Runner
): Promise<Check[]> {
  const sudo = await run(['sudo', '-n', 'true']);
  if (!sudo.ok)
    return [
      {
        id: 'macos:prerequisites',
        status: 'fail',
        summary: 'SUDO_AUTHORIZATION_REQUIRED',
        remedy: {
          action:
            'Authorize designated-user sudo once through the controller enrollment flow (authorize-sudo.sh); routine convergence never prompts.',
        },
      },
    ];
  const user = userInfo();
  const checks: Check[] = [];
  checks.push(
    ...(await attempt('macos:baseline', () => applyBaseline(root, run)))
  );
  checks.push(
    ...(await attempt('macos:policy', () =>
      verifyDarwinMachine({ name: user.username, uid: user.uid }, run)
    ))
  );
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
    ...(await attempt('provider:verification', () =>
      verifyFleetProviders(node)
    ))
  );
  checks.push(
    ...(await attempt('worker:access', () => workerAccessChecks(run)))
  );
  checks.push(
    {
      id: 't3:service',
      status: 'skip',
      required: false,
      summary:
        'Native T3 worker service lifecycle is accepted on Ubuntu only; use t3 service install manually on macOS.',
    },
    {
      id: 'worker:proxy-singleton',
      status: 'skip',
      required: false,
      summary: 'The singleton CLIProxyAPI gateway is hosted on Ubuntu only.',
    }
  );
  return checks;
}

async function applyBaseline(root: string, run: Runner): Promise<Check[]> {
  const user = userInfo();
  const result = await runAnsible(
    run,
    resolve(root, 'packages/workstation/macos/baseline.yml'),
    {
      cwd: resolve(root, 'packages/workstation/macos'),
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
      id: 'macos:baseline',
      status: result.ok ? 'pass' : 'fail',
      summary: result.ok
        ? 'macOS power, session, sudo, Tailscale and credential-renewal policy applied; effective state is verified separately.'
        : 'MACOS_BASELINE_INCOMPLETE',
    },
  ];
}
