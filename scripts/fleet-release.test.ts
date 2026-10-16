import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = join(import.meta.dirname, '..');
const workflow = parse(
  readFileSync(join(root, '.github/workflows/fleet.yml'), 'utf8')
);
const assets = [
  'fleet-installer.iso.parts.json',
  'fleet-installer.iso.sha256',
  'fleet-installer.iso.part-000',
  'fleet-node.sh',
  'fleet-installer-windows-x64.exe',
  'fleet-installer-macos-arm64.zip',
  'fleet-installer-macos-x64.zip',
  'fleet-installer-linux-arm64.tar.gz',
  'fleet-installer-linux-x64.tar.gz',
];

function releaseMissing(names: readonly string[], exitCode = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-release-'));
  const output = join(directory, 'output');
  const step = workflow.jobs.changes.steps.find(
    (candidate: { id?: string }) => candidate.id === 'release'
  );
  try {
    writeFileSync(
      join(directory, 'gh'),
      '#!/bin/sh\nprintf "%s\\n" "$FLEET_TEST_ASSETS"\nexit "$FLEET_TEST_EXIT"\n',
      { mode: 0o700 }
    );
    const result = Bun.spawnSync(['bash', '-c', step.run], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FLEET_TEST_ASSETS: names.join('\n'),
        FLEET_TEST_EXIT: String(exitCode),
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.exitCode).toBe(0);
    return readFileSync(output, 'utf8').trim();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a missing release requests a full fleet rebuild on main pushes', () => {
  expect(releaseMissing([], 1)).toBe('missing=true');
  const recovery = workflow.jobs.changes.steps.find(
    (step: { id?: string }) => step.id === 'release'
  );
  expect(recovery.if).toBe("github.event_name == 'push'");
  expect(workflow.jobs.changes.outputs.fleet).toBe(
    "${{ steps.filter.outputs.fleet == 'true' || steps.release.outputs.missing == 'true' }}"
  );
  expect(workflow.jobs.publish.needs).toEqual(['changes', 'check', 'wizard']);
});

for (const asset of assets) {
  test(`an incomplete release retries publication when ${asset} is absent`, () => {
    expect(releaseMissing(assets.filter((name) => name !== asset))).toBe(
      'missing=true'
    );
  });
}

test('a complete release preserves the normal path filter', () => {
  expect(releaseMissing(assets)).toBe('missing=false');
  expect(
    readFileSync(join(root, 'packages/fleet/workflows/fleet.yml'), 'utf8')
  ).toBe(readFileSync(join(root, '.github/workflows/fleet.yml'), 'utf8'));
});

test('the parallel check matrix covers all scheduler groups and gates publication', () => {
  expect(workflow.jobs.check.strategy.matrix.group).toEqual([
    'roles',
    'runtime',
    'lifecycle',
    'image',
  ]);
  expect(workflow.jobs.check.strategy['fail-fast']).toBe(false);
  expect(workflow.jobs.check['timeout-minutes']).toBe(12);
  expect(workflow.jobs.gate.needs).toContain('check');
  expect(workflow.jobs.publish.needs).toContain('check');
  const upload = workflow.jobs.check.steps.find(
    (step: { uses?: string }) => step.uses === 'actions/upload-artifact@v4'
  );
  expect(upload.if).toBe(
    "matrix.group == 'image' && github.event_name != 'pull_request'"
  );
  expect(upload.with['compression-level']).toBe(0);
});

for (const event of [
  'pull_request',
  'merge_group',
  'push',
  'workflow_dispatch',
]) {
  test(`${event} gate refuses failed, cancelled, or skipped check groups`, () => {
    const step = workflow.jobs.gate.steps[0];
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      const gate = Bun.spawnSync(['bash', '-c', step.run], {
        env: {
          ...process.env,
          EVENT: event,
          CHANGES: 'success',
          FLEET: 'true',
          CHECK: result,
          WIZARD: 'success',
          CACHE: 'success',
          PUBLISH: 'success',
        },
      });
      expect(gate.exitCode).toBe(result === 'success' ? 0 : 1);
    }
  });
}
