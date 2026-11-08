import { runAnsible } from '../platform/ansible';
import macos from '../../../macos/policy.json';
import { applyHub } from './hub';
import { resolve } from 'node:path';
import { loadDefinition } from '../../../../fleet/src/definition';
import { record } from '../../../../fleet/src/config';
import { isRevision } from '../../../../fleet/src/machine/state';
import { privateHub } from '../../../../fleet/src/monitoring/beszel';
import { runLockedCommand as runCommand } from '../../../../fleet/src/runner';
import type { Check, Runner } from '../../../../fleet/src/types';

export async function applyAgent(
  value: unknown,
  root: string,
  run: Runner
): Promise<Check[]> {
  const request = validateRequest(value);
  const definition = loadDefinition(
    resolve(root, 'packages/fleet/definition.json')
  );
  await validateSource(request, root, run);
  if (
    !definition.nodes.some(
      (node) => node.id === request.node && node.os !== 'windows'
    )
  )
    throw new Error('BESZEL_NOT_ENROLLED');
  if (request.mode === 'hub') {
    if (definition.monitoring.parent !== request.node)
      throw new Error('BESZEL_NOT_HUB');
    return applyHub(root, request.hubUrl, run);
  }
  if (
    typeof request.publicKey !== 'string' ||
    typeof request.token !== 'string'
  )
    throw new Error('BESZEL_CREDENTIALS_REQUIRED');
  return installAgent(request, root, run);
}

/** Linux installs a hardened systemd unit; macOS an always-on launchd daemon. */
async function installAgent(
  request: Request,
  root: string,
  run: Runner,
  darwin = process.platform === 'darwin'
): Promise<Check[]> {
  const result = await runAnsible(
    run,
    darwin ? 'agent-darwin.yml' : 'agent.yml',
    {
      cwd: resolve(root, 'packages/workstation/monitoring'),
      timeoutMs: 300_000,
      input: JSON.stringify({
        beszel_node: request.node,
        beszel_hub_url: privateHub(request.hubUrl),
        beszel_public_key: request.publicKey,
        beszel_agent_token: request.token,
      }),
    }
  );
  if (!result.ok)
    return [
      {
        id: 'beszel:installation',
        status: 'fail',
        summary: 'BESZEL_INSTALLATION_INCOMPLETE',
        remedy: {
          action:
            'Inspect sudo, signed artifact access, free disk and existing service ownership. Preserve the native agent DATA_DIR and rerun the controller.',
        },
      },
    ];
  const ready = darwin
    ? await darwinAgentRunning(run)
    : (await run(['systemctl', 'is-enabled', 'beszel-agent.service'])).ok &&
      (await run(['systemctl', 'is-active', 'beszel-agent.service'])).ok;
  return [
    {
      id: 'beszel:service',
      status: ready ? 'pass' : 'fail',
      summary: ready
        ? 'Native Beszel service is enabled and active; hub metrics remain a separate gate.'
        : 'BESZEL_SERVICE_STOPPED',
    },
  ];
}
async function darwinAgentRunning(run: Runner): Promise<boolean> {
  const state = await run([
    '/bin/launchctl',
    'print',
    `system/${macos.beszelDaemon}`,
  ]);
  return state.ok && /state = running/.test(state.stdout);
}
interface Request {
  node: string;
  revision: string;
  hubUrl: string;
  mode?: unknown;
  publicKey?: unknown;
  token?: unknown;
}
function validateRequest(value: unknown): Request {
  if (
    !record(value) ||
    typeof value['node'] !== 'string' ||
    !isRevision(value['revision']) ||
    typeof value['hubUrl'] !== 'string'
  )
    throw new Error('BESZEL_INPUT_INVALID');
  return value as unknown as Request;
}
async function validateSource(
  request: Request,
  root: string,
  run: Runner
): Promise<void> {
  for (const [args, expected] of [
    [['git', 'rev-parse', 'HEAD'], request.revision],
    [['git', 'rev-parse', '--show-toplevel'], resolve(root)],
    [['git', 'status', '--porcelain'], ''],
  ] as const) {
    const observed = await run([...args], { cwd: root });
    if (!observed.ok || observed.stdout.trim() !== expected)
      throw new Error('BESZEL_SOURCE_MISMATCH');
  }
}
async function main(): Promise<Check[]> {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += String(chunk);
    if (raw.length > 16_384) throw new Error('BESZEL_INPUT_LIMIT');
  }
  return applyAgent(JSON.parse(raw), process.cwd(), runCommand);
}
if (import.meta.main) {
  const checks = await main().catch((): Check[] => [
    {
      id: 'beszel:operation',
      status: 'fail',
      summary: 'BESZEL_OPERATION_INCOMPLETE',
    },
  ]);
  process.stdout.write(JSON.stringify({ version: 1, checks }));
}
