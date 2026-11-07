import type { Runner, Check } from '../../../../fleet/src/types';
import { record } from '../../../../fleet/src/config';

/** Use the supported native lifecycle. Never restart an installed service merely
 * to adopt a new pin, downgrade a desktop environment, or mint pairing material.
 */
export async function convergeT3Service(
  artifact: { path: string; version: string },
  run: Runner,
  prepare: () => Promise<Check[]> = async () => []
): Promise<Check[]> {
  const existing = await run(['t3', '--version']);
  if (conflictingVersion(existing, artifact.version))
    return pending(
      'T3_EXECUTABLE_OWNER_CONFLICT',
      'The existing T3 launcher has a different version. Review the desktop/native service migration; preserve its application data and active sessions.'
    );
  const status = await run([artifact.path, 'status', '--json']);
  let installed: boolean;
  try {
    const value: unknown = JSON.parse(status.stdout);
    if (!status.ok) throw new Error();
    assertServiceStatus(value);
    installed = value['service']['installed'];
    if (installed && value['service']['installedVersion'] !== artifact.version)
      return pending(
        'T3_MAINTENANCE_REQUIRED',
        'The native service runs another release. Plan an explicit maintenance update; routine sync never interrupts active turns.'
      );
  } catch {
    return pending(
      'T3_STATUS_UNVERIFIED',
      'Inspect native service status and the declared data directory; no state was reset.'
    );
  }
  const preparation = await prepare();
  if (preparation.length) return preparation;
  if (!installed) {
    const installation = await installService(artifact.path, run);
    if (installation.length) return installation;
  }
  return verifyService(run);
}
async function verifyService(run: Runner): Promise<Check[]> {
  let active = await run([
    'systemctl',
    '--user',
    'is-active',
    't3code.service',
  ]);
  let enabled = await run([
    'systemctl',
    '--user',
    'is-enabled',
    't3code.service',
  ]);
  if (!enabled.ok) {
    await run(['systemctl', '--user', 'enable', 't3code.service']);
    enabled = await run([
      'systemctl',
      '--user',
      'is-enabled',
      't3code.service',
    ]);
  }
  if (!active.ok) {
    // Start is idempotent and respects the native unit's restart limit. Never
    // reset-failed or restart a running process to force acceptance.
    await run(['systemctl', '--user', 'start', 't3code.service'], {
      timeoutMs: 30_000,
    });
    active = await run(['systemctl', '--user', 'is-active', 't3code.service']);
  }
  if (!active.ok || !enabled.ok)
    return pending(
      'T3_SERVICE_STOPPED',
      'Inspect the native service failure and restart limits. A crash recovery must preserve its data directory and be verified before readiness.'
    );
  return [
    {
      id: 't3:service',
      status: 'pass',
      summary:
        'Pinned native service reports installed, enabled and active. Private routing, reboot survival and paired tool execution remain separate checks.',
    },
  ];
}
async function installService(path: string, run: Runner): Promise<Check[]> {
  const listener = await run(['ss', '-H', '-ltn', 'sport = :3773']);
  if (!listener.ok || listener.stdout.trim())
    return pending(
      'T3_LISTENER_CONFLICT',
      'Resolve the existing listener or desktop server through a reviewed migration before installing another service.'
    );
  const result = await run([path, 'service', 'install'], { timeoutMs: 60_000 });
  return result.ok
    ? []
    : pending(
        'T3_SERVICE_INSTALLATION_FAILED',
        'Inspect the user systemd manager and native installer status; keep existing T3 runtime identity and state.'
      );
}

function pending(code: string, action: string): Check[] {
  return [
    { id: 't3:service', status: 'fail', summary: code, remedy: { action } },
  ];
}

function assertServiceStatus(value: unknown): asserts value is {
  service: { installed: boolean; installedVersion?: string };
} {
  if (
    !record(value) ||
    !record(value['service']) ||
    typeof value['service']['installed'] !== 'boolean'
  )
    throw new Error();
}

function conflictingVersion(
  result: { ok: boolean; stdout: string },
  version: string
): boolean {
  return result.ok && result.stdout.trim() !== `t3 v${version}`;
}
