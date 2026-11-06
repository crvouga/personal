import { record } from './config';
import type { Check, Runner } from './types';

export async function workstationChecks(
  root: string,
  run: Runner
): Promise<Check[]> {
  const result = await run(
    ['personal', 'workstation', 'doctor', '--json', '--non-interactive'],
    {
      cwd: root,
      timeoutMs: 20_000,
    }
  );
  const fallback: Check = {
    id: 'workstation:configuration',
    status: 'fail',
    summary: 'Managed workstation configuration could not be verified.',
    remedy: {
      action:
        'Run personal workstation doctor --json on this computer. Review managed links, PATH, coding-tool/provider configuration and notification settings; apply personal workstation sync only explicitly.',
    },
  };
  try {
    const data: unknown = JSON.parse(result.stdout);
    if (
      !record(data) ||
      !Array.isArray(data['checks']) ||
      !data['checks'].length ||
      data['checks'].length > 100
    )
      return [fallback];
    const checks = data['checks'].map(configurationCheck);
    if (checks.some((check) => check === null)) return [fallback];
    return [
      ...(!result.ok || data['ok'] !== true ? [fallback] : []),
      ...(checks as Check[]),
    ];
  } catch {
    return [fallback];
  }
}

function configurationCheck(value: unknown): Check | null {
  if (
    !record(value) ||
    typeof value['id'] !== 'string' ||
    !/^[a-zA-Z0-9:._-]{1,75}$/.test(value['id']) ||
    !['pass', 'warn', 'fail'].includes(String(value['severity']))
  )
    return null;
  const ok = value['severity'] === 'pass';
  return {
    id: `workstation:${value['id'].toLowerCase()}`,
    status: value['severity'] as Check['status'],
    summary: ok
      ? 'Managed configuration check succeeded (configuration presence; provider authorization is checked separately).'
      : 'Managed configuration is missing, conflicting or unverified.',
    ...(!ok
      ? {
          remedy: {
            action:
              'Inspect personal workstation doctor --json on this computer. Use explicit personal workstation sync only after reviewing the configuration changes.',
          },
        }
      : {}),
  };
}
