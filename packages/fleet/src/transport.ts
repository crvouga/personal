import { remoteCommand, sshFailure } from './ssh';
import { cleanCheck, decodeSnapshot, validCheck } from './protocol';
import { record } from './config';
import { fileURLToPath } from 'node:url';
import type { FleetNode, NodeReport, Runner } from './types';

export async function bundleProbe(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL('./remote-entry.ts', import.meta.url))],
    target: 'node',
    minify: true,
  });
  if (!result.success || !result.outputs[0])
    throw new Error('Cannot bundle the fleet probe.');
  return result.outputs[0].text();
}

export interface RemoteOptions {
  source: string;
  timeoutMs: number;
  action: 'probe' | 'sync';
  pull?: boolean;
}

export async function inspectRemote(
  node: FleetNode,
  options: RemoteOptions,
  run: Runner
): Promise<NodeReport> {
  const command = remoteCommand(node, {
    action: options.action,
    node,
    apply: options.action === 'sync',
    pull: options.pull === true,
  });
  const result = await run(command, {
    input: options.source,
    timeoutMs: options.timeoutMs,
  });
  if (!result.ok) return { node: node.id, checks: [sshFailure(result)] };
  if (options.action === 'sync') return decodeSync(node.id, result.stdout);
  const snapshot = decodeSnapshot(result.stdout);
  if (!snapshot) return protocolFailure(node.id);
  return {
    node: node.id,
    snapshot,
    checks: [
      {
        id: 'ssh:session',
        status: 'pass',
        summary:
          'Fresh noninteractive SSH session and Node-compatible probe succeeded with verified host keys and no agent forwarding.',
      },
      ...snapshot.checks,
      {
        id: 'vscode:forwarding',
        status: 'skip',
        summary:
          'VS Code Remote-SSH tunnel/server installation is not tested by a shell session. Use the onboarding forwarding test.',
      },
    ],
  };
}

function decodeSync(node: string, output: string): NodeReport {
  try {
    const data: unknown = JSON.parse(output);
    if (
      record(data) &&
      data['version'] === 1 &&
      Array.isArray(data['checks']) &&
      data['checks'].length <= 200 &&
      data['checks'].every(validCheck)
    ) {
      return { node, checks: data['checks'].map(cleanCheck) };
    }
  } catch {
    return protocolFailure(node);
  }
  return protocolFailure(node);
}

function protocolFailure(node: string): NodeReport {
  return {
    node,
    checks: [
      {
        id: 'ssh:protocol',
        status: 'fail',
        summary: 'Remote response is not a supported fleet JSON document.',
        remedy: {
          action:
            'Remove stdout banners from noninteractive shell startup; check the Node/Bun runtime. No raw remote output is retained.',
        },
      },
    ],
  };
}
