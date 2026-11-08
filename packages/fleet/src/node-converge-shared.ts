import { fingerprint, writeReceipt } from './fingerprint';
import { configureWorkspace } from './configure';
import type { Check, Runner } from './types';

/** Phase wrapper: one failure code per phase, durations measured, no exception text. */
export async function attempt(
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

/** Source-owned launcher, managed workstation configuration and this worker's own
 * credential refresh. Identical on Linux and macOS.
 */
export async function configureWorkstation(
  root: string,
  run: Runner
): Promise<Check[]> {
  const installed = await run(['bun', 'run', 'personal:install', '--yes'], {
    cwd: root,
    timeoutMs: 300_000,
  });
  if (!installed.ok)
    return [
      {
        id: 'workstation:installation',
        status: 'fail',
        summary: 'WORKSTATION_INSTALLATION_FAILED',
      },
    ];
  // This receipt certifies only frozen dependency inputs, never machine readiness.
  await writeReceipt(root, await fingerprint(root, run));
  await run(['bun', 'scripts/dev/worker-auth.ts'], {
    cwd: root,
    timeoutMs: 90_000,
  });
  const synced = await run(
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
    { cwd: root, timeoutMs: 300_000 }
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

export function applyAgentProfiles(
  root: string,
  node: string,
  revision: string,
  run: Runner
): Promise<Check[]> {
  return configureWorkspace(
    root,
    { node, revision, tool: 'codex', profile: 'proxy' },
    run,
    {
      additionalTools: ['claude', 'gemini', 'opencode'],
      bootstrappedDeployment: true,
    }
  );
}
