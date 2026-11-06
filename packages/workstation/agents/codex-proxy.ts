#!/usr/bin/env bun
/** T3 binaryPath adapter. This file remains in Git; no generated executable copies. */
import { homedir } from 'node:os';
import { currentPlatform } from '../cli/lib/platform';
import { agentRoot } from '../cli/lib/agents/render';
import { select } from '../cli/lib/agents/registry';
import { plan } from '../cli/lib/agents/converge';
import { launchProfile } from '../cli/lib/agents/launch';

try {
  const selection = select(
    process.env['WS_AGENT_NODE'] ?? '',
    'codex',
    'proxy'
  );
  const root = agentRoot(homedir(), currentPlatform().name);
  const result = await plan({ root, selection, revision: 'unverified' });
  if (
    !result.previous ||
    result.previous.fingerprint !== result.fingerprint ||
    result.files.some((file) => file.state !== 'unchanged')
  )
    throw new Error('Profile missing or drifted.');
  process.exitCode = await launchProfile(
    root,
    selection,
    process.argv.slice(2)
  );
} catch {
  process.stderr.write(
    'Managed Codex proxy unavailable. Set WS_AGENT_NODE, apply the reviewed ws profile, and authenticate this node to Vault.\n'
  );
  process.exitCode = 1;
}
