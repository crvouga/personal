import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(join(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8')
);

function changeFlags(event: string, serviceId: string, changed: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-flags-'));
  const output = join(directory, 'output');
  const step = workflow.jobs.changes.steps.find(
    (candidate: { id?: string }) => candidate.id === 'flags'
  );
  try {
    const result = Bun.spawnSync(['bash', '-c', step.run], {
      env: {
        ...process.env,
        ...Object.fromEntries(Object.keys(step.env).map((key) => [key, ''])),
        EVENT_NAME: event,
        INPUT_SERVICE_ID: serviceId,
        FILTER_CHECK: String(changed),
        FILTER_RUNNER_FLEET: String(changed),
        FILTER_FLEET_E2E: String(changed),
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.exitCode).toBe(0);
    return Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('='))
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('sibling publishing cannot schedule workspace fleet checks from caller paths', () => {
  const outputs = workflow.jobs.changes.outputs;
  expect(outputs.runner_fleet).toBe('${{ steps.flags.outputs.runner_fleet }}');
  expect(outputs.fleet_e2e).toBe('${{ steps.flags.outputs.fleet_e2e }}');
  expect(changeFlags('push', 'mockingbird-docs', true)).toMatchObject({
    workflow_call: 'true',
    publish: 'true',
    check: 'false',
    runner_fleet: 'false',
    fleet_e2e: 'false',
  });
});

for (const event of ['push', 'pull_request', 'merge_group']) {
  test(`${event} preserves native fleet path filters`, () => {
    for (const changed of [true, false]) {
      expect(changeFlags(event, '', changed)).toMatchObject({
        workflow_call: 'false',
        check: String(changed),
        runner_fleet: String(changed),
        fleet_e2e: String(changed),
      });
    }
  });
}

function dependencies(name: string, visited = new Set<string>()): Set<string> {
  for (const needed of workflow.jobs[name].needs ?? []) {
    if (!visited.has(needed)) {
      visited.add(needed);
      dependencies(needed, visited);
    }
  }
  return visited;
}

test('optional credential failures cannot suppress core checks or block Required', () => {
  expect(dependencies('check').has('vault')).toBe(false);
  expect(dependencies('Required').has('secret-integrations')).toBe(false);
  expect(workflow.jobs['secret-integrations']['continue-on-error']).toBe(true);
});

test('active cache deployment smoke still requires its own credential groups', () => {
  const imports = workflow.jobs.smoke.steps.find(
    (step: { uses?: string }) =>
      step.uses === './.github/actions/turborepo-vault-secrets'
  );
  expect(imports).toBeDefined();
  expect(imports.with.optional).not.toBe('true');
  expect(workflow.jobs.smoke['continue-on-error']).not.toBe(true);
});

test('the health workflow prepares OpenTofu roots read-only and can never apply', () => {
  const read = (path: string) =>
    parse(readFileSync(join(import.meta.dirname, '..', path), 'utf8'));
  const health = read('.github/workflows/infra-health.yml');
  const prepared = health.jobs.health.steps.filter(
    (step: { uses?: string }) => step.uses === './.github/actions/tofu'
  );
  expect(
    prepared.map((step: { with: { root: string } }) => step.with.root)
  ).toEqual(['foundation', 'bootstrap', 'vault', 'fleet']);
  for (const step of prepared) expect(step.with.mode).toBe('prepare');
  expect(JSON.stringify(health.jobs)).not.toMatch(/\bapply\b/);

  const action = read('.github/actions/tofu/action.yml');
  for (const name of ['Plan', 'Apply']) {
    const step = action.runs.steps.find(
      (candidate: { name?: string }) => candidate.name === name
    );
    expect(step.if).toBe("inputs.mode == 'apply'");
  }
});
