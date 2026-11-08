import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mustRun } from './release-io';
import { ReleaseError } from './release-error';

/** Exercise real Node package reconciliation only against synthetic local state. */
export async function consumerT3(
  directory: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const node = Bun.which('node');
  if (!node) throw new ReleaseError('Consumer T3 smoke requires Node.');
  const cli = join(directory, 'node_modules/@crvouga/personal/cli.mjs');
  const base = join(directory, 'synthetic-t3');
  await mkdir(join(base, 'userdata'), { recursive: true });
  const settings = join(base, 'userdata/settings.json');
  await writeFile(
    settings,
    JSON.stringify({ unrelated: { sentinel: 'preserve' } })
  );
  const definition = join(directory, 't3-definition.json');
  await writeFile(definition, JSON.stringify({ version: 1, instances: {} }));
  for (const command of [
    ['t3-apply', '--dry-run'],
    ['t3-apply'],
    ['t3-status'],
    ['t3-cleanup'],
  ]) {
    const output = await mustRun(
      [
        node,
        cli,
        ...command,
        '--t3-home',
        base,
        '--definition',
        definition,
        '--workspace',
        directory,
        '--json',
      ],
      directory,
      env,
      { stage: 'consumer-command' }
    );
    if (JSON.parse(output).ok !== true)
      throw new ReleaseError('Consumer T3 reconciliation failed.');
  }
  if (
    JSON.parse(await readFile(settings, 'utf8')).unrelated.sentinel !==
    'preserve'
  )
    throw new ReleaseError(
      'Consumer T3 reconciliation changed unrelated settings.'
    );
}
