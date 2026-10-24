import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
const read = (path: string) =>
  parse(readFileSync(join(import.meta.dirname, '..', path), 'utf8'));
const workflow = read('.github/workflows/ci.yml');
const deploy = read('.github/workflows/deploy.yml');
const publish = read('.github/workflows/publish.yml');
const maintenance = read('.github/workflows/maintenance.yml');

test('PR and merge queue checks always report, including documentation-only changes', () => {
  expect(workflow.on.pull_request).toEqual({});
  expect(workflow.on.merge_group).toEqual({});
  expect(workflow.jobs.check.name).toBe('Check');
  expect(workflow.jobs.check.if).toBe("always() && inputs.service_id == ''");
  expect(workflow.jobs.fleet.if).toContain('always()');
  expect(workflow.jobs.changes.needs).toBeUndefined();
});

test('sibling callers only publish, forwarding the existing inputs and outputs', () => {
  expect(workflow.jobs.publish.if).toBe("inputs.service_id != ''");
  expect(workflow.jobs.publish.uses).toBe('./.github/workflows/publish.yml');
  for (const key of Object.keys(publish.on.workflow_call.inputs))
    expect(workflow.jobs.publish.with[key]).toBe('${{ inputs.' + key + ' }}');
  expect(workflow.on.workflow_call.outputs).toEqual(
    publish.on.workflow_call.outputs
  );
  expect(JSON.stringify(publish.jobs)).not.toMatch(
    /setup-bun|actions\/tofu|deploy-auth|vault-secrets/
  );
});

test('optional integrations cannot suppress core checks or require production credentials', () => {
  const optional = workflow.jobs.optional.steps.filter((s: { name: string }) =>
    /optional/i.test(s.name)
  );
  expect(optional).toHaveLength(2);
  for (const step of optional) expect(step['continue-on-error']).toBe(true);
  expect(optional[0].with.optional).toBe('true');
  expect(JSON.stringify(workflow.jobs.packages.env)).not.toContain('secrets.');
});

test('deployment requires successful checks on a main push and cannot cancel active mutations', () => {
  expect(workflow.jobs.deploy.needs).toEqual(['check', 'fleet']);
  expect(workflow.jobs.deploy.if).toContain("github.event_name == 'push'");
  expect(workflow.jobs.deploy.if).toContain("github.ref == 'refs/heads/main'");
  expect(deploy.jobs.deploy.if).toContain("github.ref == 'refs/heads/main'");
  expect(deploy.jobs.deploy.concurrency).toEqual({
    group: 'production',
    'cancel-in-progress': false,
  });
  const steps = deploy.jobs.deploy.steps;
  const index = (name: string) =>
    steps.findIndex((s: { name: string }) => s.name === name);
  expect(index('Check deployment credentials')).toBeLessThan(
    index('Publish Vault')
  );
  expect(index('Check deployment credentials')).toBeLessThan(
    index('Apply foundation')
  );
  expect(index('Apply foundation')).toBeLessThan(index('Apply bootstrap'));
  expect(index('Apply bootstrap')).toBeLessThan(index('Deploy auth'));
  expect(index('Deploy auth')).toBeLessThan(index('Apply vault'));
  expect(index('Publish service images')).toBeLessThan(
    index('Deploy services')
  );
  expect(index('Deploy services')).toBeLessThan(index('Check public services'));
  expect(index('Check public services')).toBeLessThan(index('Smoke test'));
  const probe = steps[index('Check deployment credentials')];
  expect(probe.run).toBe('bun scripts/ci/deploy-preflight.ts');
  expect(probe['timeout-minutes']).toBe(2);
  expect(probe.if).toBe("steps.plan.outputs.apply == 'true'");
  const smoke = steps.find(
    (s: { name: string }) => s.name === 'Read smoke test credentials'
  );
  expect(smoke.with.optional).not.toBe('true');
  expect(steps[index('Smoke test')]['continue-on-error']).not.toBe(true);
});

test('deployment runs after optional Fleet skips but refuses failed, skipped or cancelled gates', () => {
  const condition = workflow.jobs.deploy.if;
  // GitHub otherwise inserts success(), which includes skipped ancestors even
  // when the direct Check and Fleet gates both succeeded.
  expect(condition).toContain('!cancelled()');
  for (const check of ['success', 'failure', 'skipped', 'cancelled'])
    for (const fleet of ['success', 'failure', 'skipped', 'cancelled'])
      for (const cancelled of [false, true])
        for (const event of ['push', 'pull_request', 'workflow_dispatch'])
          for (const ref of ['refs/heads/main', 'refs/heads/feature'])
            for (const serviceId of ['', 'portfolio']) {
              const actual = runInNewContext(condition, {
                cancelled: () => cancelled,
                success: () => false,
                needs: { check: { result: check }, fleet: { result: fleet } },
                github: { event_name: event, ref },
                inputs: { service_id: serviceId },
              });
              expect(actual).toBe(
                !cancelled &&
                  check === 'success' &&
                  fleet === 'success' &&
                  event === 'push' &&
                  ref === 'refs/heads/main' &&
                  serviceId === ''
              );
            }
});

test('health remains read-only and repair runs only through an explicit main-branch manual task', () => {
  const health = maintenance.jobs.health;
  const prepared = health.steps.filter(
    (s: { uses?: string }) => s.uses === './.github/actions/tofu'
  );
  expect(prepared.map((s: { with: { root: string } }) => s.with.root)).toEqual([
    'foundation',
    'bootstrap',
    'vault',
    'fleet',
  ]);
  for (const step of prepared) expect(step.with.mode).toBe('prepare');
  expect(JSON.stringify(health)).not.toMatch(/\bapply\b/);
  expect(maintenance.jobs.repair.if).toBe(
    "github.event_name == 'workflow_dispatch' && inputs.task == 'vault-inputs' && github.ref == 'refs/heads/main'"
  );
  expect(maintenance.jobs.repair.concurrency).toEqual(
    deploy.jobs.deploy.concurrency
  );
  for (const name of ['Plan', 'Apply'])
    expect(
      read('.github/actions/tofu/action.yml').runs.steps.find(
        (s: { name: string }) => s.name === name
      ).if
    ).toBe("inputs.mode == 'apply'");
});

for (const [dispatch, caller, expected] of [
  ['platform-token', 'caller-token', 'platform-token'],
  ['', 'caller-token', 'caller-token'],
  ['', '', 'workflow-token'],
])
  test(`publishing selects ${expected}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ci-auth-'));
    const output = join(directory, 'output');
    try {
      const step = publish.jobs.publish.steps.find(
        (s: { id?: string }) => s.id === 'ghcr_auth'
      );
      const result = Bun.spawnSync(['bash', '-c', step.run], {
        env: {
          ...process.env,
          DISPATCH_TOKEN: dispatch!,
          CALLER_TOKEN: caller!,
          WORKFLOW_TOKEN: 'workflow-token',
          IMAGE_OWNER: 'crvouga',
          ACTOR: 'caller',
          GITHUB_OUTPUT: output,
        },
      });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(output, 'utf8')).toContain(`password=${expected}`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('all core gates are retained across independent validation jobs', () => {
  const steps = Object.values(workflow.jobs).flatMap(
    (job: any) => job.steps ?? []
  );
  const runs = steps.map((s: { run?: string }) => s.run ?? '').join('\n');
  for (const command of [
    'bun run ci:format',
    'bun run check:agents',
    'bun run check:llms',
    'bun run check:scripts',
    'bash packages/infra/tofu/check.sh',
    'bunx turbo run tc lint',
    'bunx turbo run test build',
  ])
    expect(runs).toContain(command);
  expect(read('.github/actions/setup/action.yml').runs.steps.at(-1).run).toBe(
    'bun install --frozen-lockfile'
  );
  expect(workflow.jobs.packages.env.TURBO_CACHE).toBe('local:rw');
});

test('the transitional Required status preserves all validation until the live ruleset migrates', () => {
  expect(workflow.jobs.Required.needs).toEqual(['check', 'fleet']);
  const script = workflow.jobs.Required.steps[0].run;
  for (const result of ['failure', 'cancelled', 'skipped', 'success']) {
    const actual = Bun.spawnSync(['bash', '-c', script], {
      env: {
        ...process.env,
        RESULTS: JSON.stringify({
          check: { result: 'success' },
          fleet: { result },
        }),
      },
    });
    expect(actual.exitCode).toBe(result === 'success' ? 0 : 1);
  }
});

test('validation preserves the protected main branch constraints', () => {
  const script = workflow.jobs.repository.steps.find(
    (step: { name: string }) => step.name === 'Check branches'
  ).run;
  for (const [base, head, expected] of [
    ['main', 'feature', 0],
    ['refs/heads/main', 'refs/heads/gh-readonly-queue/main/pr-1', 0],
    ['other', 'feature', 1],
    ['main', 'main', 1],
  ]) {
    expect(
      Bun.spawnSync(['bash', '-c', script], {
        env: { ...process.env, BASE_REF: String(base), HEAD_REF: String(head) },
      }).exitCode
    ).toBe(Number(expected));
  }
});

test('reusable publisher rejects empty build inputs before authenticating', () => {
  const script = publish.jobs.publish.steps.find(
    (step: { name: string }) => step.name === 'Check inputs'
  ).run;
  const valid = {
    service_id: 'service',
    dockerfile: 'Dockerfile',
    context: '.',
    image_owner: 'owner',
    image_prefix: 'prefix',
  };
  for (const field of Object.keys(valid)) {
    expect(
      Bun.spawnSync(['bash', '-c', script], {
        env: {
          ...process.env,
          BUILD_INPUTS: JSON.stringify({ ...valid, [field]: '' }),
        },
      }).exitCode
    ).not.toBe(0);
  }
  expect(
    Bun.spawnSync(['bash', '-c', script], {
      env: { ...process.env, BUILD_INPUTS: JSON.stringify(valid) },
    }).exitCode
  ).toBe(0);
});
