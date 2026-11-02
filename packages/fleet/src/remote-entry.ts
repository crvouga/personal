import { parseConfig, record } from './config';
import { probe } from './probe';
import { runCommand } from './runner';
import { syncWorkspace } from './sync';

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(
    Buffer.from(process.argv.at(-1) ?? '', 'base64').toString()
  );
  if (!record(raw) || (raw['action'] !== 'probe' && raw['action'] !== 'sync'))
    throw new Error('Invalid request.');
  const node = parseConfig({ version: 1, nodes: [raw['node']] }).nodes[0]!;
  if (raw['action'] === 'sync') {
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
