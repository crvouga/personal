import { parseConfig, record } from './config';
import { probe } from './probe';
import { runCommand } from './runner';
import { syncWorkspace } from './sync';
import { repairWorkspace, validRepairs } from './repair-runner';
import { validSnapshot } from './protocol';
import type { Fingerprint } from './types';

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(
    Buffer.from(process.argv.at(-1) ?? '', 'base64').toString()
  );
  if (
    !record(raw) ||
    !['probe', 'sync', 'repair'].includes(String(raw['action']))
  )
    throw new Error('Invalid request.');
  const node = parseConfig({ version: 1, nodes: [raw['node']] }).nodes[0]!;
  if (raw['action'] === 'repair') {
    if (
      raw['apply'] !== true ||
      !validRepairs(raw['repairs']) ||
      !validSnapshot({
        version: 1,
        platform: 'request',
        checks: [],
        fingerprint: raw['expected'],
      })
    )
      throw new Error(
        'Repair requires explicit authorization and supported actions.'
      );
    const checks = await repairWorkspace(
      node.workspace,
      raw['repairs'],
      runCommand,
      raw['expected'] as Fingerprint
    );
    process.stdout.write(JSON.stringify({ version: 1, checks }));
  } else if (raw['action'] === 'sync') {
    if (raw['apply'] !== true)
      throw new Error('Sync requires explicit authorization.');
    const checks = await syncWorkspace(
      node.workspace,
      raw['pull'] === true,
      runCommand
    );
    process.stdout.write(JSON.stringify({ version: 1, checks }));
  } else
    process.stdout.write(
      JSON.stringify(await probe(node.workspace, node.required, runCommand))
    );
}

await main().catch(() => {
  process.stdout.write(
    JSON.stringify({
      version: 1,
      error: 'Remote operation failed; inspect node locally.',
    })
  );
  process.exitCode = 1;
});
