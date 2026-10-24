import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = join(import.meta.dirname, '../..');
const workflow = parse(
  readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
);
const jobs = workflow.jobs;
const required = ['changes', 'repository', 'packages'];
const conditional = ['infra', 'fleet_e2e', 'auth', 'portfolio_urls'];
const filters = {
  infra: 'true',
  fleet_e2e: 'true',
  auth: 'true',
  portfolio: 'true',
};
const successful = Object.fromEntries(
  [...required, ...conditional].map((job) => [job, { result: 'success' }])
);

function gate(results = successful, selected = filters) {
  return Bun.spawnSync(['bash', '-c', jobs.check.steps[0].run], {
    env: {
      ...process.env,
      RESULTS: JSON.stringify(results),
      FILTERS: JSON.stringify(selected),
    },
  }).exitCode;
}

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
    fleet_e2e: 'false',
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

test('expensive work starts from the plan, without waiting for package validation', () => {
  for (const job of [
    'infra',
    'fleet_e2e',
    'auth',
    'portfolio_urls',
    'nix',
    'installer',
  ]) {
    expect(jobs[job].needs).toBe('changes');
    expect(jobs[job].if).toContain('needs.changes.outputs.');
  }
  expect(jobs.packages.needs).toBeUndefined();
  expect(jobs.optional.needs).toBeUndefined();
  expect(jobs.check.needs).not.toContain('optional');
  for (const job of ['packages', 'infra', 'fleet_e2e', 'nix', 'installer'])
    expect(jobs[job].strategy['fail-fast']).toBe(false);
});

test('manual runs exercise every conditional validation lane', () => {
  for (const flag of ['infra', 'fleet_e2e', 'auth', 'portfolio'])
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

test('headless installer contracts avoid Windows media feature setup', () => {
  const install = jobs.installer.steps.find(
    (step: any) => step.name === 'Install only Fleet browser dependencies'
  );
  expect(
    jobs.installer.steps.some(
      (step: any) => step.uses === './.github/actions/browsers'
    )
  ).toBe(true);
  expect(install.run).not.toContain('--with-deps');
  expect(jobs.installer.strategy.matrix.os).toHaveLength(5);
});

test('missing filter outputs cannot authorize a skipped integration', () => {
  const skipped = { ...successful, infra: { result: 'skipped' } };
  expect(gate(skipped, { ...filters, infra: '' })).not.toBe(0);
});

test('Nix result caching only covers VM groups and manual runs force fresh tests', () => {
  const steps = jobs.nix.steps;
  const cache = steps.find(
    (step: any) => step.name === 'Cache successful VM derivations'
  );
  expect(cache.if).toBe(
    "matrix.group == 'runtime' || matrix.group == 'lifecycle'"
  );
  expect(cache.with.key).toContain(
    "hashFiles('packages/fleet/.ci/nix-plan.json')"
  );
  expect(cache.with.path).toBe('packages/fleet/.ci/nix-results.json');
  expect(cache.with.key).toContain(
    '${{ github.sha }}-${{ github.run_attempt }}'
  );
  const save = steps.find(
    (step: any) => step.name === 'Save successful VM derivations'
  );
  expect(save.if).toContain('always()');
  expect(save.with.key).toContain('steps.vm_cache.outputs.cache-primary-key');
  const build = steps.find((step: any) => step.name === 'Test all Nix checks');
  expect(build.if).toBeUndefined();
  expect(build.env.FRESH_CHECKS).toBe(
    "${{ github.event_name == 'workflow_dispatch' }}"
  );
  expect(build.run).toContain('--fresh');
  expect(build.run).toContain('--plan .ci/nix-plan.json');
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
  expect(
    steps.find((step: any) => step.name === 'Test and build packages').if
  ).toBe("matrix.task == 'tests'");
});

test('Fleet PR scopes are computed from the tested merge tree and gate native builds', () => {
  const plan = jobs.changes.steps.find(
    (step: any) => step.id === 'fleet_impact'
  );
  expect(plan.run).toBe('python3 packages/fleet/scripts/ci-impact.py');
  expect(plan.env.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
  expect(plan.env.FLEET_AFFECTED).toContain(
    "github.event_name == 'workflow_dispatch'"
  );
  expect(jobs.nix.if).toBe("needs.changes.outputs.nix == 'true'");
  expect(jobs.installer.if).toBe("needs.changes.outputs.installer == 'true'");
  expect(jobs.changes.outputs.fleet_e2e).toContain(
    "steps.fleet_impact.outputs.docs_only != 'true'"
  );
  expect(jobs.fleet.steps[0].env.NIX_REQUIRED).toBe(
    '${{ needs.check.outputs.nix }}'
  );
  expect(jobs.fleet.steps[0].env.INSTALLER_REQUIRED).toBe(
    '${{ needs.check.outputs.installer }}'
  );
});

test('native installer unit/browser/build checks overlap and remain required', () => {
  const step = jobs.installer.steps.find(
    (step: any) => step.name === 'Test and build the installer concurrently'
  );
  expect(step.run).toContain(
    'python -B tests/installer.py "${installer_args[@]}"'
  );
  expect(step.run).toContain('installer_args+=(--native-nix)');
  expect(step['continue-on-error']).not.toBe(true);
  expect(step.env.PYTHON).toBe('${{ steps.python.outputs.python-path }}');
  expect(step.env.PLAYWRIGHT_PATH).toBe('@playwright/test');
  expect(jobs.installer.strategy.matrix.os).toHaveLength(5);
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
  expect(uses(jobs.fleet_e2e, 'ariga/setup-atlas')).toBeDefined();
  expect(uses(jobs.auth, 'ariga/setup-atlas').if).toBe(
    "matrix.suite == 'compatibility'"
  );
  expect(uses(jobs.auth, 'opentofu/setup-opentofu').with.tofu_version).toBe(
    '1.13.0'
  );
  expect(
    jobs.fleet_e2e.steps.find((step: any) => step.name === 'Build Fleet assets')
      .run
  ).toBe('bun run --filter @pkgs/fleet-api build');
});
