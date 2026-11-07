import { record } from './config';
import { join } from 'node:path';
import type { Check, Runner } from './types';

export async function workstationChecks(
  root: string,
  run: Runner,
  nodeId?: string
): Promise<Check[]> {
  const result = await run(
    [
      'bun',
      join(root, 'packages/personal-cli/src/cli.ts'),
      'workstation',
      'doctor',
      '--json',
      '--non-interactive',
    ],
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
    const scoped = (checks as Check[]).map((check) =>
      nodeId ? workerConfigurationScope(check, nodeId) : check
    );
    const failed = nodeId
      ? scoped.some((check) => check.status === 'fail')
      : !result.ok || data['ok'] !== true;
    return [...(failed ? [fallback] : []), ...scoped];
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

function workerConfigurationScope(check: Check, nodeId: string): Check {
  const id = check.id.slice('workstation:'.length);
  if (
    id === 'ws-launcher' ||
    /^agent:(codex|claude|opencode|gemini|copilot|profiles)$/.test(id) ||
    id.startsWith(`agent:${nodeId}:`)
  )
    return check;
  return {
    ...check,
    status: 'skip',
    required: false,
    summary:
      'Desktop/direct-provider configuration is outside the minimal proxy-backed worker policy.',
  };
}
