import { expect, test } from 'bun:test';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const inventory = 'packages/infra/tofu/modules/inventory/';
const readers = new Set([
  'infra',
  'fleet',
  'auth-relay',
  'password-manager',
  'portfolio',
  'turborepo-remote-cache',
]);
const commands = new Set(['tc', 'lint', 'test', 'build']);

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ci-task-inputs-'));
  const copy = (relative: string) => {
    if (!existsSync(join(root, relative))) return;
    mkdirSync(dirname(join(directory, relative)), { recursive: true });
    copyFileSync(join(root, relative), join(directory, relative));
  };
  for (const path of [
    'package.json',
    'bun.lock',
    'turbo.json',
    'tsconfig.json',
    'tsconfig.strict.json',
    '.nvmrc',
  ])
    copy(path);
  for (const name of readdirSync(join(root, 'packages'))) {
    copy(`packages/${name}/package.json`);
    copy(`packages/${name}/turbo.json`);
  }
  for (const name of ['inventory.tf.json', 'publish.yml.tftpl'])
    copy(inventory + name);
  return directory;
}

function plan(directory: string): Map<string, string> {
  const result = Bun.spawnSync(
    [
      join(root, 'node_modules/.bin/turbo'),
      'run',
      'tc',
      'lint',
      'test',
      'build',
      '--dry=json',
    ],
    {
      cwd: directory,
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
    }
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  const tasks = JSON.parse(result.stdout.toString()).tasks as {
    taskId: string;
    hash: string;
  }[];
  return new Map(tasks.map((task) => [task.taskId, task.hash]));
}

function verifyReaders(
  before: Map<string, string>,
  after: Map<string, string>
) {
  const covered = new Set<string>();
  for (const [id, hash] of before) {
    const [packageName, command] = id.split('#');
    const name = packageName?.replace('@pkgs/', '');
    if (!name || !command || !commands.has(command)) continue;
    if (readers.has(name)) {
      expect(after.get(id), `${id} must see changed inventory`).not.toBe(hash);
      covered.add(name);
    }
    if (name === 'logger')
      expect(after.get(id), `${id} has no inventory dependency`).toBe(hash);
  }
  expect(covered).toEqual(readers);
}

test('inventory and publisher changes invalidate all real readers without rerunning unrelated packages', () => {
  const directory = fixture();
  try {
    const original = plan(directory);
    const path = join(directory, inventory, 'inventory.tf.json');
    const content = readFileSync(path, 'utf8');
    const changed = JSON.parse(content);
    changed.locals.inventory.__ciCacheFixture = true;
    writeFileSync(path, JSON.stringify(changed));
    verifyReaders(original, plan(directory));
    writeFileSync(path, content);
    appendFileSync(
      join(directory, inventory, 'publish.yml.tftpl'),
      '\n# cache invalidation fixture\n'
    );
    verifyReaders(original, plan(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shared lint rules invalidate every linter without discarding unrelated compiler, test or build results', () => {
  const directory = fixture();
  try {
    const original = plan(directory);
    mkdirSync(join(directory, 'packages/eslint-rules'), { recursive: true });
    writeFileSync(
      join(directory, 'packages/eslint-rules/cache-fixture.cjs'),
      'module.exports = {};\n'
    );
    const changed = plan(directory);
    let linters = 0;
    for (const [id, hash] of original) {
      if (id.endsWith('#lint')) {
        expect(changed.get(id), `${id} must see changed lint rules`).not.toBe(
          hash
        );
        linters++;
      } else if (id.startsWith('@pkgs/logger#')) {
        expect(changed.get(id), `${id} does not execute lint rules`).toBe(hash);
      }
    }
    expect(linters).toBeGreaterThan(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
