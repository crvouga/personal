import { record } from './config';
import { join } from 'node:path';
import type { Capability, Check, Runner, CommandResult } from './types';

export async function authCheck(
  capability: Capability,
  run: Runner,
  root: string
): Promise<Check[]> {
  if (capability === 't3') return t3Checks(run);
  const spec = {
    github: {
      command: ['gh', 'auth', 'status', '--active'],
      action:
        'Authenticate on this node with gh auth login, then gh auth setup-git.',
    },
    vault: {
      command: ['vault', 'token', 'lookup', '-format=json'],
      action:
        'Authenticate to the configured Vault on this node. Do not copy a token from another computer.',
    },
    vscode: {
      command: ['code', '--list-extensions'],
      action:
        'Install the VS Code CLI on PATH and ms-vscode-remote.remote-ssh in the local editor profile.',
    },
    toolchain: {
      command: ['bun', join(root, 'scripts/dev/doctor.ts'), '--json'],
      action:
        'Run ws tools check --json; use the shared mise setup to reconcile tools.',
    },
  }[capability];
  const result = await run(spec.command, {
    cwd: root,
    timeoutMs: capability === 'toolchain' ? 90_000 : 15_000,
  });
  const extensions = result.stdout.toLowerCase().split(/\s+/);
  const ok =
    result.ok &&
    (capability !== 'vscode' ||
      extensions.includes('ms-vscode-remote.remote-ssh'));
  return [
    {
      id: `auth:${capability}`,
      status: ok ? 'pass' : 'fail',
      summary: ok
        ? `${capability} check succeeded in this process context.`
        : `${capability} check failed (${result.reason}); no credential output retained.`,
      ...(ok ? {} : { remedy: { action: spec.action } }),
    },
  ];
}

async function t3Checks(run: Runner): Promise<Check[]> {
  const config = await run(['t3', 'status', '--json']);
  const checks: Check[] = [t3Settings(config)];
  const live = await run(['t3', 'environment', 'list', '--json']);
  checks.push({
    id: 't3:api',
    status: live.ok ? 'pass' : 'fail',
    summary: live.ok
      ? 'Local T3 API answered a read-only environment listing; peer connectivity is not inferred.'
      : 'Local T3 API did not answer the environment listing.',
    ...(!live.ok
      ? {
          remedy: {
            action:
              'Check t3 service status and t3 status. Inspect linked peers in T3 Settings → Connections; relink only with operator approval.',
          },
        }
      : {}),
  });
  checks.push({
    id: 't3:end-to-end',
    status: 'skip',
    summary:
      'Relay traversal and remote peer authorization require an operator connection test; local settings are not proof.',
  });
  return checks;
}

function t3Settings(config: CommandResult): Check {
  const fallback: Check = {
    id: 't3:settings',
    status: 'fail',
    summary: 'T3 settings unavailable or unsupported CLI response.',
    remedy: {
      action:
        'Run t3 status --json on this node. Complete t3 up --connect as its operator if needed.',
    },
  };
  try {
    const data: unknown = JSON.parse(config.stdout);
    if (config.ok && record(data) && record(data['connect'])) {
      const enabled =
        data['connect']['enabled'] === true &&
        data['connect']['revoked'] === false;
      return {
        id: 't3:settings',
        status: enabled ? 'pass' : 'fail',
        summary: enabled
          ? 'T3 Connect enabled and not marked revoked (settings only).'
          : 'T3 Connect disabled, revoked, or unknown.',
        ...(!enabled
          ? {
              remedy: {
                action:
                  'Review t3 status, then complete t3 up --connect as the operator. Never share pairing tokens.',
              },
            }
          : {}),
      };
    }
  } catch {}
  return fallback;
}
