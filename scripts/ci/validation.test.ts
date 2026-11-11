import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { PLANNED_TASKS } from './browser-plan';

const root = join(import.meta.dirname, '../..');
const workflow = parse(
  readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
);
const jobs = workflow.jobs;
const required = ['changes', 'repository', 'packages'];
const conditional = ['infra'];
const filters = {
  infra: 'true',
  auth: 'true',
  portfolio: 'true',
};
const successful = Object.fromEntries(
  [...required, ...conditional].map((job) => [job, { result: 'success' }])
);

function gate(
  results: Record<string, { result: string }> = successful,
  selected: Record<string, string> = filters,
  job = jobs.check
) {
  const step = job.steps[0];
  return Bun.spawnSync(['bash', '-c', step.run], {
    env: {
      ...process.env,
      REQUIRED: step.env.REQUIRED,
      CONDITIONAL: step.env.CONDITIONAL,
      RESULTS: JSON.stringify(results),
      FILTERS: JSON.stringify(selected),
    },
  }).exitCode;
}

test('the Slow checks gate applies the same rules to the slow lanes', () => {
  const slow = {
    auth: { result: 'skipped' },
    portfolio_urls: { result: 'success' },
  };
  const selected = { auth: 'false', portfolio: 'true' };
  expect(new Set(jobs.slow.needs)).toEqual(
    new Set(['changes', ...Object.keys(slow)])
  );
  expect(gate(slow, selected, jobs.slow)).toBe(0);
  expect(
    gate(
      { ...slow, portfolio_urls: { result: 'skipped' } },
      selected,
      jobs.slow
    )
  ).not.toBe(0);
  expect(
    gate({ ...slow, auth: { result: 'failure' } }, selected, jobs.slow)
  ).not.toBe(0);
});

test('the Check gate rejects every failed, cancelled, missing or unexpectedly skipped stage', () => {
  expect(new Set(jobs.check.needs)).toEqual(
    new Set([...required, ...conditional])
  );
  expect(gate()).toBe(0);
  for (const job of [...required, ...conditional]) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(gate({ ...successful, [job]: { result } })).not.toBe(0);
    }
    const missing = { ...successful };
    delete missing[job];
    expect(gate(missing)).not.toBe(0);
  }
});

test('only unaffected integrations can skip and their failures still fail the gate', () => {
  const selected = {
    infra: 'false',
    auth: 'false',
    portfolio: 'false',
  };
  const skipped = {
    ...successful,
    ...Object.fromEntries(
      conditional.map((job) => [job, { result: 'skipped' }])
    ),
  };
  expect(gate(skipped, selected)).toBe(0);
  for (const job of conditional) {
    for (const result of ['failure', 'cancelled']) {
      expect(gate({ ...skipped, [job]: { result } }, selected)).not.toBe(0);
    }
  }
});

test('independent platform integrations start from the change plan', () => {
  for (const job of ['infra', 'auth', 'portfolio_urls']) {
    expect(jobs[job].needs).toBe('changes');
    expect(jobs[job].if).toContain('needs.changes.outputs.');
  }
  expect(jobs.packages.needs).toBeUndefined();
  expect(jobs.optional.needs).toBeUndefined();
  expect(jobs.check.needs).not.toContain('optional');
  for (const job of ['packages', 'infra'])
    expect(jobs[job].strategy['fail-fast']).toBe(false);
});

test('manual runs exercise every conditional validation lane', () => {
  for (const flag of ['infra', 'auth', 'portfolio'])
    expect(jobs.changes.outputs[flag]).toContain(
      "github.event_name == 'workflow_dispatch'"
    );
});

test('restored task results are validated by Turbo and never skip the package commands', () => {
  const cache = jobs.packages.steps.find(
    (step: any) => step.name === 'Cache task results'
  );
  expect(cache.with.path).toBe('.turbo');
  expect(cache.with.key).toContain('${{ matrix.task }}-${{ github.sha }}');
  for (const step of jobs.packages.steps.filter((step: any) => step.run))
    expect(step.if ?? '').not.toContain('cache-hit');
  const save = jobs.packages.steps.find(
    (step: any) => step.name === 'Save completed task results'
  );
  expect(save.if).toContain('always()');
  expect(save.with.path).toBe('.turbo');
  expect(
    jobs.infra.steps.find(
      (step: any) => step.name === 'Cache verified providers'
    ).with.key
  ).toContain('${{ matrix.group }}');
  const config = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'));
  expect(config.tasks.lint.inputs).toContain(
    '$TURBO_ROOT$/packages/eslint-rules/**'
  );
  expect(config.globalDependencies).toContain('tsconfig.strict.json');
  for (const task of ['tc', 'lint'])
    expect(config.tasks[task].inputs).toContain('$TURBO_DEFAULT$');
});

test('missing filter outputs cannot authorize a skipped integration', () => {
  const skipped = { ...successful, infra: { result: 'skipped' } };
  expect(gate(skipped, { ...filters, infra: '' })).not.toBe(0);
});

test('cached browser tasks can skip installation while the actual tests always run', () => {
  const steps = jobs.packages.steps;
  const plan = steps.find(
    (step: any) => step.name === 'Plan browser installation'
  );
  expect(plan.run).toBe('bun scripts/ci/browser-plan.ts');
  const install = steps.find((step: any) =>
    step.name.startsWith('Install Chromium')
  );
  expect(install.if).toContain("steps.browsers.outputs.install == 'true'");
  const run = steps.find(
    (step: any) => step.name === 'Test and build packages'
  );
  expect(run.if).toBe("matrix.task == 'tests'");
  // The plan must look at every task the step runs, or an uncached one runs without a browser.
  expect(run.run).toContain(`turbo run ${PLANNED_TASKS.join(' ')}`);
});

test('formatting cache keeps the full check and scopes reuse to the lock and formatter configuration', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  expect(pkg.scripts['ci:format']).toContain('prettier --check .');
  expect(pkg.scripts['ci:format']).toContain('--cache-strategy content');
  const cache = jobs.repository.steps.find(
    (step: any) => step.name === 'Cache formatting results'
  );
  expect(cache.with.path).toBe('.cache/prettier');
  for (const key of ['key', 'restore-keys']) {
    expect(cache.with[key]).toContain('bun.lock');
    expect(cache.with[key]).toContain('packages/*/.prettier*');
    expect(cache.with[key]).not.toContain('**/');
    expect(cache.with[key]).toContain('package.json');
  }
});

test('every independent database lane installs its own tooling before testing', () => {
  const uses = (job: any, tool: string) =>
    job.steps.find((step: any) => String(step.uses ?? '').startsWith(tool));
  expect(uses(jobs.packages, 'ariga/setup-atlas').if).toBe(
    "matrix.task == 'tests'"
  );
  expect(uses(jobs.auth, 'ariga/setup-atlas').if).toBe(
    "matrix.suite == 'compatibility'"
  );
  expect(uses(jobs.auth, 'opentofu/setup-opentofu').with.tofu_version).toBe(
    '1.13.0'
  );
});
