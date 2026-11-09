/** T3 binaryPath adapter. This file remains in Git; no generated executable copies. */
import { homedir } from 'node:os';
import { currentPlatform } from '../cli/lib/platform';
import { agentRoot } from '../cli/lib/agents/render';
import { select } from '../cli/lib/agents/registry';
import { plan } from '../cli/lib/agents/converge';
import { launchProfile } from '../cli/lib/agents/launch';
import { AgentConfigurationError } from '../cli/lib/agents/errors';

const SYNC_HINT =
  'Run personal fleet-sync from a terminal to repair this machine.';

export async function runManagedProxy(
  tool: 'codex' | 'opencode'
): Promise<void> {
  const args = process.argv.slice(2);
  // Version probes need no credentials; answering them lets T3 report the real
  // launch error instead of "unable to determine version".
  if (args.length === 1 && ['--version', '-v'].includes(args[0]!)) {
    process.exitCode = await Bun.spawn([tool, ...args], {
      stdio: ['inherit', 'inherit', 'inherit'],
    }).exited;
    return;
  }
  try {
    const selection = select(process.env['WS_AGENT_NODE'] ?? '', tool, 'proxy');
    const root = agentRoot(homedir(), currentPlatform().name);
    const result = await plan({ root, selection, revision: 'unverified' });
    if (
      !result.previous ||
      result.previous.fingerprint !== result.fingerprint ||
      result.files.some((file) => file.state !== 'unchanged')
    )
      throw new AgentConfigurationError(
        `The ${tool} proxy profile for node ${selection.node} is missing or out of date.`
      );
    process.exitCode = await launchProfile(root, selection, args);
  } catch (error) {
    // Configuration errors carry curated, secret-free messages; others do not.
    const reason =
      error instanceof AgentConfigurationError
        ? error.message
        : 'Managed provider proxy unavailable.';
    process.stderr.write(`${reason} ${SYNC_HINT}\n`);
    process.exitCode = 1;
  }
}
