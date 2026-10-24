import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atlasPlanEnvironment, ATLAS_PLAN_TIMEOUT } from './atlas-plan';
import { retryDelay } from './tofu-plan';

test('stalled Atlas reads stop promptly, while real applies and other commands finish', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-deadline-'));
  const fake = join(directory, 'fake.ts');
  const runner = join(directory, 'runner.ts');
  writeFileSync(fake, `await Bun.sleep(500); console.log('finished');`);
  // The shim uses a fake executable with a shebang so Atlas's command arguments
  // remain at argv[0], exactly as they do when the provider invokes Atlas.
  const executable = join(directory, 'atlas');
  writeFileSync(
    executable,
    `#!/bin/sh\nexec '${process.execPath}' '${fake}' "$@"\n`,
    {
      mode: 0o700,
    }
  );
  writeFileSync(
    runner,
    `import { runAtlas } from ${JSON.stringify(join(import.meta.dirname, 'atlas-plan.ts'))};
     process.exitCode = await runAtlas(${JSON.stringify(executable)}, process.argv.slice(2), 100);`
  );
  try {
    for (const [args, timedOut] of [
      [['schema', 'inspect', '--env', 'tf'], true],
      [['schema', 'apply', '--dry-run', '--env', 'tf'], true],
      [['schema', 'clean', '--dry-run'], true],
      [['schema', 'apply', '--auto-approve'], false],
      [['schema', 'apply', '--dry-run=false'], false],
      [['schema', 'apply', '--dry-run', '--dry-run=false'], false],
      [['schema', 'clean', '--auto-approve'], false],
      [['migrate', 'apply'], false],
      [['version'], false],
    ] as const) {
      const child = Bun.spawn([process.execPath, runner, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(timedOut ? 124 : 0);
      expect(stdout.includes('finished')).toBe(!timedOut);
      expect(stderr.includes(ATLAS_PLAN_TIMEOUT)).toBe(timedOut);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

test('planning PATH adapter forwards arguments, output and status and cleans up', async () => {
  // A quote in the directory catches accidental shell interpolation in the shim.
  const directory = mkdtempSync(join(tmpdir(), "atlas adapter's "));
  const binary = join(directory, 'atlas');
  const originalPath = process.env.PATH;
  writeFileSync(
    binary,
    `#!/bin/sh\nprintf '%s\\n' "$@"\nprintf 'fixture error\\n' >&2\nexit 7\n`,
    { mode: 0o700 }
  );
  let cleanup = () => {};
  try {
    const adapter = atlasPlanEnvironment({
      ...process.env,
      PATH: `${directory}:${originalPath}`,
    });
    cleanup = adapter.cleanup;
    expect(adapter.env.WORKSPACE_ATLAS_BINARY).toBe(binary);
    const wrapper = join(adapter.env.PATH!.split(':')[0]!, 'atlas');
    expect(readFileSync(wrapper, 'utf8')).toContain('exec ');
    const child = Bun.spawn([wrapper, 'schema', 'inspect', '--env', "a b's"], {
      env: adapter.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(7);
    expect(stdout).toBe("schema\ninspect\n--env\na b's\n");
    expect(stderr).toBe('fixture error\n');
    expect(process.env.PATH).toBe(originalPath);
    cleanup();
    expect(existsSync(wrapper)).toBe(false);
  } finally {
    cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('only Atlas read timeout diagnostics are retryable; mixed failures still stop', () => {
  const diagnostic = {
    severity: 'error',
    summary: 'Atlas Plan Error',
    detail: `Unable to generate migration plan: ${ATLAS_PLAN_TIMEOUT} after 120s.`,
  };
  const result = { code: 1, valid: true, errors: [diagnostic] };
  expect(retryDelay(result, 0)).toBe(15_000);
  expect(retryDelay(result, 1)).toBe(30_000);
  expect(
    retryDelay(
      { ...result, errors: [{ ...diagnostic, summary: 'Inspect Error' }] },
      0
    )
  ).toBe(15_000);
  for (const summary of ['Apply Error', 'Client Error'])
    expect(
      retryDelay({ ...result, errors: [{ ...diagnostic, summary }] }, 0)
    ).toBeNull();
  expect(
    retryDelay(
      {
        ...result,
        errors: [diagnostic, { ...diagnostic, detail: 'permission denied' }],
      },
      0
    )
  ).toBeNull();
});
