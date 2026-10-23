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

for (const [dispatch, caller, expected] of [
  ['platform-token', 'caller-token', 'platform-token'],
  ['', 'caller-token', 'caller-token'],
  ['', '', 'workflow-token'],
]) {
  test(`sibling GHCR publish selects ${expected}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ci-ghcr-auth-'));
    const output = join(directory, 'output');
    const step = workflow.jobs.publish.steps.find(
      (candidate: { id?: string }) => candidate.id === 'ghcr_auth'
    );
    const script = step.run
      .replaceAll('${{ steps.resolve.outputs.image_owner }}', 'crvouga')
      .replaceAll('${{ github.actor }}', 'caller-actor')
      .replaceAll('${{ github.token }}', 'workflow-token');
    try {
      const result = Bun.spawnSync(['bash', '-c', script], {
        env: {
          ...process.env,
          GITHUB_REPOSITORY: 'crvouga/pickflix-v1',
          DISPATCH_TOKEN: dispatch!,
          CALLER_TOKEN: caller!,
          GITHUB_OUTPUT: output,
        },
      });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(output, 'utf8')).toContain(`password=${expected}`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('production deployment credentials are checked before checks, builds and mutations', () => {
  const preflight = workflow.jobs['deploy-preflight'];
  expect(dependencies('deploy-preflight').has('check')).toBe(false);
  expect(preflight.if).toContain(
    "needs.changes.outputs.workflow_call != 'true'"
  );
  expect(preflight.if).toContain("github.ref == 'refs/heads/main'");
  expect(preflight['timeout-minutes']).toBe(5);
  const prepare = preflight.steps.find(
    (step: { uses?: string }) => step.uses === './.github/actions/tofu'
  );
  expect(prepare.with).toEqual({ root: 'foundation', mode: 'prepare' });
  const probe = preflight.steps.find((step: { run?: string }) =>
    step.run?.includes('-refresh-only')
  );
  expect(probe['timeout-minutes']).toBe(2);
  expect(probe.run).toContain('-target=railway_project.workspace');
  expect(probe.run).toContain('-lock=false -parallelism=1');
  expect(probe.run).not.toMatch(/\bapply\b|\bmutation\b/);
  for (const name of ['check', 'publish', 'vault', 'deploy-prepare', 'smoke']) {
    expect(workflow.jobs[name].needs).toContain('deploy-preflight');
    expect(workflow.jobs[name].if).toContain(
      "needs.deploy-preflight.result == 'success'"
    );
  }
});

test('CI result fails loudly for failed or cancelled stages and reports their names', () => {
  const job = workflow.jobs['ci-result'];
  expect(job.if).toBe('always()');
  for (const name of [
    'deploy-preflight',
    'check',
    'publish',
    'deploy-reconcile',
    'deploy-railway',
    'smoke',
  ])
    expect(job.needs).toContain(name);
  const step = job.steps[0];
  const directory = mkdtempSync(join(tmpdir(), 'ci-result-'));
  try {
    for (const status of ['success', 'skipped', 'failure', 'cancelled']) {
      const summary = join(directory, status);
      const result = Bun.spawnSync(['bash', '-c', step.run], {
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summary,
          RESULTS: JSON.stringify({ 'deploy-preflight': { result: status } }),
        },
      });
      expect(result.exitCode).toBe(
        ['failure', 'cancelled'].includes(status) ? 1 : 0
      );
      expect(readFileSync(summary, 'utf8')).toContain(
        `| deploy-preflight | ${status} |`
      );
      if (result.exitCode)
        expect(result.stdout.toString()).toContain(
          `::error title=CI failed::deploy-preflight=${status}`
        );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('cheap validation runs before provider and browser setup without dropping any core checks', () => {
  const steps = workflow.jobs.check.steps;
  const position = (name: string) =>
    steps.findIndex(
      (step: { name?: string; uses?: string }) =>
        step.name === name || step.uses === name
    );
  expect(position('Fast repository checks')).toBeLessThan(
    position('opentofu/setup-opentofu@v1')
  );
  expect(position('Typecheck and lint packages')).toBeLessThan(
    position('opentofu/setup-opentofu@v1')
  );
  expect(position('Validate and test OpenTofu')).toBeLessThan(
    position('Install Chromium (portfolio resume PDF)')
  );
  const runs = steps.map((step: { run?: string }) => step.run ?? '').join('\n');
  for (const command of [
    'bun install --frozen-lockfile',
    'bun run ci:format',
    'bun run check:agents',
    'bun run check:llms',
    'bun run check:scripts',
    'bun run check:infra',
    'bunx turbo run tc lint',
    'bunx turbo run test build',
  ])
    expect(runs).toContain(command);
  expect(workflow.jobs.check.env.TURBO_CACHE).toBe('local:rw');
});
