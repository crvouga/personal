import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const context = mkdtempSync(join(tmpdir(), 'password-manager-cold-context-'));
try {
  for (const name of [
    'package.json',
    'bun.lock',
    'mise.toml',
    'tsconfig.json',
    'tsconfig.strict.json',
  ])
    cpSync(join(root, name), join(context, name));
  mkdirSync(join(context, 'scripts'));
  cpSync(
    join(root, 'scripts/password-manager-setup.sh'),
    join(context, 'scripts/password-manager-setup.sh')
  );
  for (const name of readdirSync(join(root, 'packages'))) {
    const manifest = join(root, 'packages', name, 'package.json');
    if (!existsSync(manifest)) continue;
    mkdirSync(join(context, 'packages', name), { recursive: true });
    cpSync(manifest, join(context, 'packages', name, 'package.json'));
  }
  for (const name of [
    'password-manager',
    'assert',
    'secret-store',
    'secret-string',
    'vault',
    'logger',
  ]) {
    cpSync(join(root, 'packages', name), join(context, 'packages', name), {
      recursive: true,
      filter: (path) => !path.split('/').includes('node_modules'),
    });
  }
  const inventory = 'packages/infra/tofu/modules/inventory';
  mkdirSync(join(context, inventory), { recursive: true });
  cpSync(
    join(root, inventory, 'inventory.tf.json'),
    join(context, inventory, 'inventory.tf.json')
  );
  const result = spawnSync(
    'docker',
    [
      'build',
      '--progress=plain',
      '-f',
      join(context, 'packages/password-manager/tests/bootstrap/Dockerfile'),
      context,
    ],
    { stdio: 'inherit' }
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(context, { recursive: true, force: true });
}
