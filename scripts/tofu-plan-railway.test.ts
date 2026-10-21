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

test('Railway variable read failures retry alone and alongside PostgreSQL exhaustion', () => {
  for (const errors of [[railway], [slots, railway]]) {
    expect(retryDelay(failure(errors), 0)).toBe(120_000);
    expect(retryDelay(failure(errors), 1)).toBe(240_000);
    expect(retryDelay(failure(errors), 2)).toBe(480_000);
    expect(retryDelay(failure(errors), 3)).toBeNull();
  }
  for (const address of [
    'railway_variable_collection.example',
    'module.service["auth.production"].railway_variable_collection.this',
    'railway_variable_collection.example["production"]',
  ])
    expect(retryDelay(failure([{ ...railway, address }]), 0)).toBe(120_000);
});

test('the recorded project read failure retries alongside PostgreSQL exhaustion', () => {
  const project = {
    severity: 'error',
    summary: 'Client Error',
    address: 'railway_project.workspace',
    detail:
      'Unable to read project, got error: input:3: project Not Authorized',
  };
  const atlas = {
    severity: 'error',
    summary: 'Atlas Plan Error',
    detail:
      'Unable to generate migration plan, got error: Error: postgres: querying schemas: pq: remaining connection slots are reserved for roles with the SUPERUSER attribute (53300)',
  };
  expect(retryDelay(failure([project, atlas]), 0)).toBe(120_000);
  expect(retryDelay(failure([project]), 2)).toBe(480_000);
  for (const bad of [
    { ...project, detail: project.detail.replace('read', 'update') },
    { ...project, address: 'railway_service.workspace' },
    { ...project, address: undefined },
  ])
    expect(retryDelay(failure([bad]), 0)).toBeNull();
});

test('Railway retries reject writes, auth errors, unknown reads and unrelated resources', () => {
  for (const detail of [
    'Unable to create variable collection, got error: input: Problem processing request',
    'Unable to update variable collection, got error: input: Problem processing request',
    'Unable to delete variable collection, got error: input: Problem processing request',
    'Unable to read variable collection, got error: Not Authorized',
    'Unable to read variable collection, got error: input: Not Found',
    railway.detail + 'Additional unknown failure',
  ])
    expect(retryDelay(failure([{ ...railway, detail }]), 0)).toBeNull();
  for (const address of [
    undefined,
    'module.vault_service.railway_service.this',
    'other_railway_variable_collection.this',
  ])
    expect(retryDelay(failure([{ ...railway, address }]), 0)).toBeNull();
  const permanent = { ...railway, detail: 'Permission denied' };
  expect(retryDelay(failure([slots, railway, permanent]), 0)).toBeNull();
  expect(
    retryDelay(failure([{ ...railway, summary: 'Unknown Error' }]), 0)
  ).toBeNull();
});

test('the recorded deploy failure retries the plan process and retains only its successful plan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tofu-railway-'));
  const attempts = join(directory, 'attempts');
  const runner = join(directory, 'runner.ts');
  try {
    writeFileSync(
      runner,
      `import { planWithRetry } from ${JSON.stringify(join(import.meta.dirname, 'tofu-plan.ts'))};
      process.exitCode = await planWithRetry(process.env.TEST_ROOT!, undefined, async ms => console.log('wait=' + ms));`
    );
    const diagnostics = [slots, railway].map((diagnostic) =>
      JSON.stringify({ type: 'diagnostic', diagnostic })
    );
    writeFileSync(
      join(directory, 'tofu'),
      `#!/bin/sh
      printf '%s\\n' "$*" >> "$TEST_ATTEMPTS"
      if [ -f "$TEST_ROOT/apply.tfplan" ]; then exit 9; fi
      if [ "$(wc -l < "$TEST_ATTEMPTS")" -eq 1 ]; then
        printf '%s\\n' partial > "$TEST_ROOT/apply.tfplan"
        printf '%s\\n' '${diagnostics[0]}' '${diagnostics[1]}'
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
    expect(result.stdout.toString()).toContain('wait=120000');
    expect(readFileSync(join(directory, 'apply.tfplan'), 'utf8')).toBe(
      'complete\n'
    );
    const commands = readFileSync(attempts, 'utf8').trim().split('\n');
    expect(commands).toEqual(
      Array(2).fill(
        `-chdir=${directory} plan -json -input=false -lock-timeout=15m -parallelism=1 -out=apply.tfplan`
      )
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
