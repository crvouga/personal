import type { Runner, Check } from '../types';

/** The user unit that runs the pinned desktop app (UI and embedded server). */
export const T3_DESKTOP_UNIT = 't3code-desktop.service';
/** The former headless server unit created by `t3 service install`. */
export const T3_LEGACY_UNIT = 't3code.service';

/** Workers run one T3 process: the desktop app, started with the auto-login
 * graphical session. Never stop a running T3 to adopt this: replacing the
 * headless server ends active turns, so it is reported as maintenance.
 */
export async function convergeT3Service(
  artifact: { path: string; version: string },
  run: Runner,
  prepare: () => Promise<Check[]> = async () => [],
  install: () => Promise<boolean> = async () => true
): Promise<Check[]> {
  const existing = await run(['t3', '--version']);
  if (conflictingVersion(existing, artifact.version))
    return pending(
      'T3_EXECUTABLE_OWNER_CONFLICT',
      'The existing T3 launcher has a different version. Review the pinned release; preserve its application data and active sessions.'
    );
  const preparation = await prepare();
  if (preparation.length) return preparation;
  if (!(await install()))
    return pending(
      'T3_DESKTOP_INSTALL_FAILED',
      'Inspect the t3-desktop.yml Ansible output (package download, apt, GDM auto-login, user unit). T3 data in ~/.t3 is untouched.'
    );
  if ((await userctl(run, 'is-active', T3_LEGACY_UNIT)).ok)
    return pending(
      'T3_DESKTOP_MIGRATION_REQUIRED',
      `The headless server still runs. During approved maintenance (this ends active T3 turns) run: systemctl --user disable --now ${T3_LEGACY_UNIT} && systemctl --user start ${T3_DESKTOP_UNIT}, then rerun fleet-sync.`
    );
  if ((await userctl(run, 'is-enabled', T3_LEGACY_UNIT)).ok)
    await userctl(run, 'disable', T3_LEGACY_UNIT);
  return startDesktop(run);
}

async function startDesktop(run: Runner): Promise<Check[]> {
  let active = await userctl(run, 'is-active', T3_DESKTOP_UNIT);
  if (!active.ok) {
    // Start is idempotent and respects the unit's restart limit. Never
    // reset-failed or restart a running app to force acceptance.
    await run(['systemctl', '--user', 'start', T3_DESKTOP_UNIT], {
      timeoutMs: 30_000,
    });
    active = await userctl(run, 'is-active', T3_DESKTOP_UNIT);
  }
  const enabled = await userctl(run, 'is-enabled', T3_DESKTOP_UNIT);
  if (!active.ok || !enabled.ok)
    return pending(
      'T3_DESKTOP_STOPPED',
      `The desktop app needs the auto-login graphical session. Reboot or log in on the machine, then inspect journalctl --user -u ${T3_DESKTOP_UNIT}; ~/.t3 is preserved.`
    );
  return [
    {
      id: 't3:service',
      status: 'pass',
      summary:
        'Pinned T3 desktop app is enabled for the auto-login session and running. Private routing, policy and pairing remain separate checks.',
    },
  ];
}

function userctl(run: Runner, verb: string, unit: string) {
  return run(['systemctl', '--user', verb, unit]);
}

function pending(code: string, action: string): Check[] {
  return [
    { id: 't3:service', status: 'fail', summary: code, remedy: { action } },
  ];
}

function conflictingVersion(
  result: { ok: boolean; stdout: string },
  version: string
): boolean {
  return result.ok && result.stdout.trim() !== `t3 v${version}`;
}
