import { developmentMode } from './mode';

const mode = developmentMode(process.env);
const scope =
  process.env['AUTH_VAULT_CONFIG'] ?? process.env['VAULT_CONFIG'] ?? 'dev';
if (!['dev', 'prd'].includes(scope))
  throw new Error('AUTH_VAULT_CONFIG must be dev or prd');
const args =
  mode === 'local'
    ? ['bun', 'development/start.ts']
    : [
        'vault',
        'run',
        '--config',
        scope,
        '--',
        'bun',
        'development/managed.ts',
        scope,
      ];
const child = Bun.spawn(args, {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    child.kill('SIGINT');
  });
const code = await child.exited;
process.exitCode = stopping ? 0 : code;
