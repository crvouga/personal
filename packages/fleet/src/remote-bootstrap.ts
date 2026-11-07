import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareSource } from './machine/source';
import { isRevision } from './machine/state';
import { sshArgs, shellQuote, sshFailure } from './ssh';
import type { FleetNode, NodeReport, Runner, Check } from './types';
import { record } from './config';
import { parseDefinition, type FleetDefinition } from './definition';
import { cleanCheck, validCheck } from './protocol';

export interface BootstrapPayload {
  revision: string;
  script: string;
  bundle: string;
  digest: string;
  authorizeSudo?: string;
}
/** No controller tool installation; Git/source preparation is part of apply approval. */
export async function prepareBootstrap(
  root: string,
  revision: string,
  run: Runner,
  expectedDefinition?: FleetDefinition
): Promise<BootstrapPayload | null> {
  if (!isRevision(revision)) return null;
  const source = await prepareSource(root, revision, run);
  if (!source) return null;
  if (
    expectedDefinition &&
    !(await definitionMatches(source, revision, expectedDefinition, run))
  )
    return null;
  const script = await trackedScript(
    source,
    revision,
    'scripts/dev/fleet-remote-bootstrap.sh',
    run
  );
  const sudoScript = await trackedScript(
    source,
    revision,
    'packages/workstation/ubuntu/authorize-sudo.sh',
    run
  );
  if (!script || !sudoScript) return null;
  const path = join(root, `transfer-${randomUUID()}.bundle`);
  try {
    if (
      !(
        await run(['git', 'bundle', 'create', path, revision], {
          cwd: source,
          timeoutMs: 120_000,
        })
      ).ok
    )
      return null;
    if ((await stat(path)).size > 512 * 1024 * 1024) return null;
    const bundle = await readFile(path);
    return {
      revision,
      script,
      authorizeSudo: sudoScript,
      bundle: bundle.toString('base64'),
      digest: createHash('sha256').update(bundle).digest('hex'),
    };
  } finally {
    await unlink(path).catch(() => undefined);
  }
}
export async function bootstrapRemote(
  node: FleetNode,
  payload: BootstrapPayload,
  run: Runner
): Promise<NodeReport> {
  const cached = await cachedRevision(node, payload.revision, run);
  if (typeof cached !== 'boolean') return { node: node.id, checks: [cached] };
  const transfer = cached
    ? { mode: 'cached', input: '' }
    : { mode: 'transfer', input: payload.bundle };
  const command = [
    'sh',
    '-c',
    payload.script,
    'fleet-bootstrap',
    payload.revision,
    payload.digest,
    node.id,
    transfer.mode,
  ]
    .map(shellQuote)
    .join(' ');
  const result = await run([...sshArgs(node), command], {
    input: transfer.input,
    timeoutMs: 5_400_000,
  });
  const evidence = parseEvidence(result);
  if (evidence) return { node: node.id, checks: evidence };
  if (!result.ok) return { node: node.id, checks: [sshFailure(result)] };
  return {
    node: node.id,
    checks: [
      {
        id: 'bootstrap:protocol',
        status: 'fail',
        summary: 'REMOTE_BOOTSTRAP_EVIDENCE_INVALID',
        remedy: {
          action:
            'Inspect the source-owned remote operation and lock. Do not assume a controller disconnect stopped installation.',
        },
      },
    ],
  };
}

async function definitionMatches(
  source: string,
  revision: string,
  expected: FleetDefinition,
  run: Runner
): Promise<boolean> {
  const result = await run(
    ['git', 'show', `${revision}:packages/fleet/definition.json`],
    { cwd: source }
  );
  try {
    return (
      result.ok &&
      JSON.stringify(parseDefinition(JSON.parse(result.stdout))) ===
        JSON.stringify(expected)
    );
  } catch {
    return false;
  }
}

async function cachedRevision(
  node: FleetNode,
  revision: string,
  run: Runner
): Promise<boolean | Check> {
  const command = `d="$HOME/.local/share/personal/fleet/revisions/${revision}"; test ! -L "$d" && test -d "$d/.git" && test "$(git -C "$d" rev-parse HEAD 2>/dev/null)" = '${revision}' && test "$(git -C "$d" rev-parse --show-toplevel 2>/dev/null)" = "$d" && clean=$(git -C "$d" status --porcelain 2>/dev/null) && test -z "$clean" && printf ready`;
  const result = await run([...sshArgs(node), command], { timeoutMs: 20_000 });
  if (!result.ok) {
    const failure = sshFailure(result);
    if (result.reason !== 'exit' || failure.id !== 'ssh:probe') return failure;
  }
  return result.ok && result.stdout === 'ready';
}

function parseEvidence(result: {
  stdout: string;
  ok: boolean;
}): Check[] | null {
  try {
    const value: unknown = JSON.parse(result.stdout);
    if (
      record(value) &&
      value['version'] === 1 &&
      Array.isArray(value['checks']) &&
      value['checks'].length > 0 &&
      value['checks'].length <= 200 &&
      value['checks'].every(validCheck)
    ) {
      const checks = value['checks'].map(cleanCheck);
      if (!result.ok && !checks.some((check) => check.status === 'fail'))
        checks.push({
          id: 'bootstrap:exit',
          status: 'fail',
          summary: 'REMOTE_BOOTSTRAP_EXIT_FAILED',
          remedy: {
            action:
              'The remote process failed despite partial evidence. Inspect its operation state before retry; no success receipt may advance.',
          },
        });
      return checks;
    }
  } catch {
    /* Raw SSH output is never included in reports. */
  }
  return null;
}

async function trackedScript(
  source: string,
  revision: string,
  path: string,
  run: Runner
): Promise<string | null> {
  const result = await run(['git', 'show', revision + ':' + path], {
    cwd: source,
  });
  return result.ok && result.stdout.startsWith('#!/bin/sh\n')
    ? result.stdout
    : null;
}
