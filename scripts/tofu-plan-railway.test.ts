import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retryDelay } from './tofu-plan';

const railway = {
  severity: 'error',
  summary: 'Client Error',
  address: 'module.vault_service.railway_variable_collection.this',
  detail:
    'Unable to read variable collection, got error: input: Problem processing request\n',
};
const slots = {
  severity: 'error',
  summary:
    'could not start transaction: pq: remaining connection slots are reserved for roles with the SUPERUSER attribute',
  detail: '',
};
const failure = (
  errors: Parameters<typeof retryDelay>[0]['errors'] = [railway]
) => ({ code: 1, valid: true, errors });

const project = {
  severity: 'error',
  summary: 'Client Error',
  address: 'railway_project.workspace',
  detail: 'Unable to read project, got error: input:3: project Not Authorized',
};
const atlas = {
  severity: 'error',
  summary: 'Atlas Plan Error',
  detail:
    'Unable to generate migration plan, got error: Error: postgres: querying schemas: pq: remaining connection slots are reserved for roles with the SUPERUSER attribute (53300)',
};
const atlasTimeout = {
  severity: 'error',
  summary: 'Atlas Plan Error',
  detail:
    'Unable to generate migration plan, got error: Error: read tcp 10.1.0.110:58406->13.223.10.127:5432: read: connection timed out',
};

test('recorded Atlas TCP read timeout retries only known inspection diagnostics', () => {
  expect(retryDelay(failure([atlasTimeout]), 0)).toBe(15_000);
  expect(retryDelay(failure([atlasTimeout]), 1)).toBe(30_000);
  expect(
    retryDelay(
      failure([
        {
          ...atlasTimeout,
          summary: 'Inspect Error',
          detail: atlasTimeout.detail.replace(
            'connection timed out',
            'i/o timeout'
          ),
        },
      ]),
      0
    )
  ).toBe(15_000);
  for (const diagnostic of [
    { ...atlasTimeout, summary: 'Apply Error' },
    { ...atlasTimeout, detail: 'migration statement timed out' },
    { ...atlasTimeout, detail: `${atlasTimeout.detail}; permission denied` },
  ])
    expect(retryDelay(failure([diagnostic]), 0)).toBeNull();
  expect(retryDelay(failure([atlasTimeout, project]), 0)).toBeNull();
  expect(retryDelay(failure([atlasTimeout, railway]), 0)).toBeNull();
});

test('recorded Railway authorization errors fail immediately, including mixed failures', () => {
  for (const errors of [
    [railway],
    [project],
    [slots, railway],
    [project, atlas],
    [slots, railway, project, atlas],
  ])
    expect(retryDelay(failure(errors), 0)).toBeNull();
  expect(retryDelay(failure([slots, atlas]), 0)).toBe(15_000);
});

test.each([[slots, atlas], [atlasTimeout]])(
  'temporary database failures retry the process and retain only its successful plan (%j)',
  (...errors) => {
    const directory = mkdtempSync(join(tmpdir(), 'tofu-railway-'));
    const attempts = join(directory, 'attempts');
    const runner = join(directory, 'runner.ts');
    try {
      writeFileSync(
        runner,
        `import { planWithRetry } from ${JSON.stringify(join(import.meta.dirname, 'tofu-plan.ts'))};
      process.exitCode = await planWithRetry(process.env.TEST_ROOT!, undefined, async ms => console.log('wait=' + ms));`
      );
      const diagnostics = errors.map((diagnostic) =>
        JSON.stringify({ type: 'diagnostic', diagnostic })
      );
      writeFileSync(
        join(directory, 'tofu'),
        `#!/bin/sh
      printf '%s\\n' "$*" >> "$TEST_ATTEMPTS"
      if [ -f "$TEST_ROOT/apply.tfplan" ]; then exit 9; fi
      if [ "$(wc -l < "$TEST_ATTEMPTS")" -eq 1 ]; then
        printf '%s\\n' partial > "$TEST_ROOT/apply.tfplan"
        printf '%s\\n' ${diagnostics.map((diagnostic) => `'${diagnostic}'`).join(' ')}
        exit 1
      fi
      printf '%s\\n' complete > "$TEST_ROOT/apply.tfplan"
      `,
        { mode: 0o755 }
      );
      const result = Bun.spawnSync([process.execPath, runner], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          TEST_ROOT: directory,
          TEST_ATTEMPTS: attempts,
        },
        timeout: 5_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('wait=15000');
      expect(readFileSync(join(directory, 'apply.tfplan'), 'utf8')).toBe(
        'complete\n'
      );
      const commands = readFileSync(attempts, 'utf8').trim().split('\n');
      expect(commands).toEqual(
        Array(2).fill(
          `-chdir=${directory} plan -json -input=false -lock-timeout=30s -parallelism=1 -out=apply.tfplan`
        )
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
);
