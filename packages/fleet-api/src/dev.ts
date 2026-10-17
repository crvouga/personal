const mode = process.env['FLEET_DEV_MODE'] ?? 'managed';
if (!['managed', 'fixtures'].includes(mode))
  throw new Error('FLEET_DEV_MODE must be managed or fixtures');
const scope = process.env['FLEET_VAULT_CONFIG'] ?? 'prd';
if (!['dev', 'prd'].includes(scope))
  throw new Error('FLEET_VAULT_CONFIG must be dev or prd');
const args =
  mode === 'fixtures'
    ? ['bun', '--watch', 'scripts/demo.ts']
    : [
        'vault',
        'run',
        '--config',
        scope,
        '--',
        'bun',
        '--watch',
        'src/local-server.ts',
      ];
process.stdout.write(
  mode === 'managed'
    ? `Fleet development: real managed data from Vault scope ${scope}; no synthetic fallback.\n`
    : 'Fleet development: explicitly selected synthetic fixtures.\n'
);
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
export {};
