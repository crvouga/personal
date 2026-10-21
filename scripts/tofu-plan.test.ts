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
import { parse } from 'yaml';
import { planWithRetry, retryDelay } from './tofu-plan';

function failure(status = 504, method = 'GET') {
  return {
    code: 1,
    valid: true,
    errors: [
      {
        severity: 'error',
        summary: 'failed to make http request',
        address:
          'cloudflare_zero_trust_access_service_token.auth_admin["production"]',
        detail: `${method} "https://api.cloudflare.com/client/v4/accounts/example/access/service_tokens/example": ${status} Gateway Timeout {"retryable":true,"retry_after":120}`,
      },
    ],
  };
}

test('Cloudflare GET 429 and 5xx diagnostics retry with bounded backoff', () => {
  for (const status of [429, 500, 502, 503, 504]) {
    expect(retryDelay(failure(status), 0)).toBe(120_000);
    expect(retryDelay(failure(status), 1)).toBe(240_000);
  }
  const result = failure();
  result.errors[0]!.detail = result.errors[0]!.detail.replace('120', '700');
  expect(retryDelay(result, 0)).toBeNull();
  result.errors[0]!.detail = result.errors[0]!.detail.replaceAll('700', '300');
  expect(retryDelay(result, 0)).toBe(300_000);
});

test('Atlas inspection refused for lack of connection slots retries', () => {
  const refused = (detail: string, summary = 'Inspect Error') => ({
    code: 1,
    valid: true,
    errors: [{ severity: 'error', summary, detail }],
  });
  const slots =
    'Unable to inspect, got error: Error: postgres: querying system variables: pq: remaining connection slots are reserved for roles with the SUPERUSER attribute (53300)';
  expect(retryDelay(refused(slots), 0)).toBe(60_000);
  expect(retryDelay(refused(slots), 1)).toBe(120_000);
  expect(retryDelay(refused('pq: sorry, too many clients already'), 0)).toBe(
    60_000
  );
  expect(
    retryDelay(
      refused(
        '',
        'error connecting to PostgreSQL server: pq: remaining connection slots are reserved for roles with the SUPERUSER attribute'
      ),
      0
    )
  ).toBe(60_000);
  // Other inspection failures are real.
  expect(
    retryDelay(refused('pq: password authentication failed'), 0)
  ).toBeNull();
  // Mixed with a permanent error, nothing retries.
  expect(
    retryDelay(
      {
        ...refused(slots),
        errors: [...refused(slots).errors, failure(403).errors[0]!],
      },
      0
    )
  ).toBeNull();
});

test('real process output recovers from HTTP errors and rejects malformed diagnostics', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tofu-process-'));
  const runner = join(directory, 'runner.ts');
  const attempts = join(directory, 'attempts');
  const diagnostic = JSON.stringify({
    type: 'diagnostic',
    diagnostic: failure(500).errors[0],
  });
  writeFileSync(
    runner,
    `
    import { planWithRetry } from ${JSON.stringify(join(import.meta.dirname, 'tofu-plan.ts'))};
    process.exitCode = await planWithRetry(process.env.TEST_ROOT!, undefined, async ms => {
      console.log('wait=' + ms);
    });
  `
  );
  writeFileSync(
    join(directory, 'tofu'),
    `#!/bin/sh
    printf '%s\\n' "$*" >> "$TEST_ATTEMPTS"
    if [ -f "$TEST_ROOT/apply.tfplan" ]; then exit 9; fi
    if [ "$(wc -l < "$TEST_ATTEMPTS")" -eq 1 ]; then
      printf '%s\\n' 'partial' > "$TEST_ROOT/apply.tfplan"
      printf '%s\\n' '${diagnostic}'
      if [ "$TEST_MALFORMED" = true ]; then printf '%s\\n' '{"type":"diagnostic"}'; fi
      exit 1
    fi
    printf '%s\\n' 'complete' > "$TEST_ROOT/apply.tfplan"
    printf '%s\\n' '{"@message":"Plan: 0 to add, 0 to change, 0 to destroy.","type":"change_summary"}'
  `,
    { mode: 0o755 }
  );
  try {
    for (const malformed of [false, true]) {
      rmSync(attempts, { force: true });
      const result = Bun.spawnSync([process.execPath, runner], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          TEST_ROOT: directory,
          TEST_ATTEMPTS: attempts,
          TEST_MALFORMED: String(malformed),
        },
        timeout: 5_000,
      });
      expect(result.exitCode).toBe(malformed ? 1 : 0);
      const commands = readFileSync(attempts, 'utf8').trim().split('\n');
      expect(commands.length).toBe(malformed ? 1 : 2);
      expect(
        commands.every(
          (command) =>
            command ===
            `-chdir=${directory} plan -json -input=false -lock-timeout=15m -parallelism=1 -out=apply.tfplan`
        )
      ).toBe(true);
      expect(existsSync(join(directory, 'apply.tfplan'))).toBe(!malformed);
      if (!malformed) expect(result.stdout.toString()).toContain('wait=120000');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('permanent, mixed, unknown and mutating failures never retry', () => {
  for (const status of [400, 401, 403, 404, 409, 422])
    expect(retryDelay(failure(status), 0)).toBeNull();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    expect(retryDelay(failure(504, method), 0)).toBeNull();
  const permanent = failure(403).errors[0]!;
  const transient = failure();
  expect(
    retryDelay({ ...transient, errors: [...transient.errors, permanent] }, 0)
  ).toBeNull();
  expect(retryDelay({ ...transient, errors: [] }, 0)).toBeNull();
  expect(retryDelay({ ...transient, valid: false }, 0)).toBeNull();
  for (const address of [undefined, 'railway_service.example'])
    expect(
      retryDelay(
        { ...transient, errors: [{ ...transient.errors[0]!, address }] },
        0
      )
    ).toBeNull();
  expect(
    retryDelay(
      {
        ...transient,
        errors: [{ ...permanent, summary: 'Invalid configuration' }],
      },
      0
    )
  ).toBeNull();
});

test('planning retries only three times and discards every failed saved plan', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tofu-retry-'));
  const savedPlan = join(directory, 'apply.tfplan');
  try {
    for (const succeeds of [true, false]) {
      let attempts = 0;
      const waits: number[] = [];
      writeFileSync(savedPlan, 'stale');
      const code = await planWithRetry(
        directory,
        async () => {
          expect(existsSync(savedPlan)).toBe(false);
          attempts++;
          writeFileSync(savedPlan, `attempt ${attempts}`);
          return succeeds && attempts === 3
            ? { code: 0, errors: [], valid: true }
            : failure();
        },
        async (delay) => {
          expect(existsSync(savedPlan)).toBe(false);
          waits.push(delay);
        }
      );
      expect(attempts).toBe(3);
      expect(waits).toEqual([120_000, 240_000]);
      expect(code).toBe(succeeds ? 0 : 1);
      expect(existsSync(savedPlan)).toBe(succeeds);
      if (succeeds) expect(readFileSync(savedPlan, 'utf8')).toBe('attempt 3');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('permanent failure stops immediately and preserves its exit status', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tofu-permanent-'));
  try {
    let attempts = 0;
    const code = await planWithRetry(
      directory,
      async () => {
        attempts++;
        return { ...failure(403), code: 7 };
      },
      async () => {
        throw new Error('must not sleep');
      }
    );
    expect(code).toBe(7);
    expect(attempts).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shared action reviews the successful plan and applies it exactly once', () => {
  const action = parse(
    readFileSync(
      join(import.meta.dirname, '../.github/actions/tofu/action.yml'),
      'utf8'
    )
  );
  const steps = action.runs.steps;
  const plan = steps.find((step: { name?: string }) => step.name === 'Plan');
  expect(plan.run).toContain('bun scripts/tofu-plan.ts\n');
  expect(plan.run).toContain('show -no-color apply.tfplan');
  const apply = steps.find((step: { name?: string }) => step.name === 'Apply');
  expect(apply.run).toBe(
    'tofu -chdir="packages/infra/tofu/${TOFU_ROOT}" apply -input=false -lock-timeout=15m -parallelism=1 apply.tfplan'
  );
  const workflow = parse(
    readFileSync(
      join(import.meta.dirname, '../.github/workflows/auth-relay-deploy.yml'),
      'utf8'
    )
  );
  expect(workflow.on.push.paths).toContain('scripts/tofu-plan.ts');
});
