import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const runner = join(
  import.meta.dirname,
  '../../packages/infra/tofu/tests/run-contracts.py'
);

test('provider contracts overlap with private per-worker caches and merge successful downloads serially', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tofu-workers-'));
  try {
    mkdirSync(join(directory, 'tests'));
    mkdirSync(join(directory, 'cache'));
    const source = `from pathlib import Path
import os, sys, time
name = Path(__file__).stem
assert 'TF_DATA_DIR' not in os.environ
cache = Path(os.environ['TF_PLUGIN_CACHE_DIR'])
Path(name).write_text(str(cache))
(cache / name).write_text('verified fixture provider')
end = time.monotonic() + 5
while not all(Path(other).exists() for other in ['first', 'second']):
 if time.monotonic() > end: raise RuntimeError('contracts did not overlap')
 time.sleep(0.02)
`;
    for (const name of ['first', 'second'])
      writeFileSync(join(directory, 'tests', `${name}.py`), source);
    const code = `import importlib.util,pathlib,sys; spec=importlib.util.spec_from_file_location('contracts',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); sys.exit(module.run_contracts(['first','second'],pathlib.Path(sys.argv[2]),workers=2))`;
    const result = Bun.spawnSync(
      ['python3', '-B', '-c', code, runner, directory],
      {
        env: {
          ...process.env,
          TF_DATA_DIR: join(directory, 'must-not-be-shared'),
          TF_PLUGIN_CACHE_DIR: join(directory, 'cache'),
        },
      }
    );
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(directory, 'first'), 'utf8')).not.toBe(
      readFileSync(join(directory, 'second'), 'utf8')
    );
    for (const name of ['first', 'second'])
      expect(readFileSync(join(directory, 'cache', name), 'utf8')).toBe(
        'verified fixture provider'
      );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed contracts still fail the suite and their cache data is never published', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tofu-workers-failure-'));
  try {
    mkdirSync(join(directory, 'tests'));
    writeFileSync(
      join(directory, 'tests', 'failed.py'),
      "raise RuntimeError('fixture failure')\n"
    );
    const code = `import importlib.util,pathlib,sys; spec=importlib.util.spec_from_file_location('contracts',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); sys.exit(module.run_contracts(['failed'],pathlib.Path(sys.argv[2])))`;
    const result = Bun.spawnSync(
      ['python3', '-B', '-c', code, runner, directory],
      {
        env: {
          ...process.env,
          TF_DATA_DIR: join(directory, 'must-not-be-shared'),
          TF_PLUGIN_CACHE_DIR: join(directory, 'cache'),
        },
      }
    );
    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain(
      'FAILED OpenTofu contracts: failed'
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
