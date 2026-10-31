/** Read-only toolchain checks; no logins, installations or changes to Docker. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workspaceRoot } from './global-config';

type Tool = string | { version: string; lazy?: boolean; os?: string[] };
type Config = { tools: Record<string, Tool> };
export type Check = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};
export type Runner = (command: string[]) => { ok: boolean; output: string };
const COMMANDS: Record<string, string> = {
  'npm:@yarnpkg/cli-dist': 'yarn',
  'npm:vercel': 'vercel',
  'npm:wrangler': 'wrangler',
  'aqua:anomalyco/opencode': 'opencode',
  'docker-cli': 'docker',
  opentofu: 'tofu',
  ripgrep: 'rg',
};
const run: Runner = (command) => {
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    cwd: tmpdir(),
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
};

export function toolChecks(
  tools: Record<string, Tool>,
  execute: Runner = run
): Check[] {
  const checks: Check[] = [];
  for (const [id, tool] of Object.entries(tools)) {
    if (typeof tool !== 'string' && tool.lazy) continue;
    const version = typeof tool === 'string' ? tool : tool.version;
    const command = COMMANDS[id] ?? id;
    const result = execute([
      command,
      command === 'go' ? 'version' : '--version',
    ]);
    const exact = new RegExp(
      `(?:^|[^0-9])${version.replaceAll('.', '\\.')}($|[^0-9.])`
    );
    const matches = result.ok && exact.test(result.output);
    checks.push({
      id,
      status: matches ? 'pass' : 'fail',
      detail: matches
        ? version
        : `Expected ${command} ${version}; run ws tools sync and reopen the shell. Check for competing PATH entries.`,
    });
  }
  for (const command of ['git', 'npm']) {
    const result = execute([command, '--version']);
    checks.push({
      id: command,
      status: result.ok ? 'pass' : 'fail',
      detail: result.ok
        ? result.output
        : `Missing ${command}; rerun the OS bootstrap.`,
    });
  }
  return checks;
}

export function dockerChecks(
  required: boolean,
  execute: Runner = run
): Check[] {
  return [
    ['docker-engine', ['docker', 'info', '--format', '{{.ServerVersion}}']],
    ['docker-compose', ['docker', 'compose', 'version']],
    ['docker-buildx', ['docker', 'buildx', 'version']],
  ].map(([id, command]) => {
    const result = execute(command as string[]);
    return {
      id: id as string,
      status: result.ok ? 'pass' : required ? 'fail' : 'warn',
      detail: result.ok
        ? result.output
        : 'Install/start Docker Desktop or Docker Engine with Compose + Buildx. See scripts/dev/README.md.',
    };
  });
}

export function checkMachine(requireDocker = false): Check[] {
  const config = Bun.TOML.parse(
    readFileSync(join(workspaceRoot, 'mise.toml'), 'utf8')
  ) as Config;
  const auth = run(['gh', 'auth', 'status']);
  return [
    ...toolChecks(config.tools),
    ...dockerChecks(requireDocker),
    {
      id: 'github-auth',
      status: auth.ok ? 'pass' : 'warn',
      detail: auth.ok
        ? 'Authenticated'
        : 'Run gh auth login, then gh auth setup-git.',
    },
  ];
}

if (import.meta.main) {
  const checks = checkMachine(process.argv.includes('--docker'));
  const ok = checks.every((check) => check.status !== 'fail');
  if (process.argv.includes('--json'))
    console.log(JSON.stringify({ ok, checks }, null, 2));
  else
    for (const check of checks)
      console.log(`${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
  process.exitCode = ok ? 0 : 1;
}
