import { expect, test } from 'bun:test';
import { developmentMode } from '../development/mode';
import { command } from '../development/process';

test('an unresponsive development dependency times out instead of hanging startup', async () => {
  await expect(
    command(
      [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      process.env,
      true,
      { timeoutMs: 100 }
    )
  ).rejects.toThrow('timed out after 100ms');
});

test('bare dev requires managed credentials; fixtures require explicit selection', () => {
  expect(developmentMode({})).toBe('configured');
  expect(developmentMode({ AUTH_DEV_MODE: 'local' })).toBe('local');
});
test('an explicit or partially configured provider never silently falls back to mock authentication', () => {
  expect(developmentMode({ AUTH_ORIGIN: 'http://localhost:8081' })).toBe(
    'configured'
  );
  expect(developmentMode({ AUTH_DATABASE_URL: 'configured' })).toBe(
    'configured'
  );
  expect(developmentMode({ AUTH_DEV_MODE: 'configured' })).toBe('configured');
});
test('production and unknown development modes are rejected', () => {
  expect(() => developmentMode({ NODE_ENV: 'production' })).toThrow();
  expect(() =>
    developmentMode({ AUTH_DEV_MODE: 'local', AUTH_ENVIRONMENT: 'production' })
  ).toThrow();
  expect(() => developmentMode({ AUTH_DEV_MODE: 'fallback' })).toThrow();
});

test('local schema plans cannot delete owned resources or change unrelated resources', async () => {
  const { validatePlan } = await import('../development/schema');
  const change = (address: string, actions: string[]) => ({
    address,
    mode: 'managed',
    change: { actions },
  });
  expect(() =>
    validatePlan([change('atlas_schema.console[0]', ['create'])])
  ).not.toThrow();
  expect(() =>
    validatePlan([change('atlas_schema.console[0]', ['delete', 'create'])])
  ).toThrow();
  expect(() =>
    validatePlan([change('postgresql_schema.other_project', ['create'])])
  ).toThrow();
  expect(() =>
    validatePlan([change('atlas_schema.console[0]', ['create'])], false)
  ).toThrow();
});

test('managed startup names missing credentials without exposing supplied secrets or starting fixtures', async () => {
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', 'development/managed.ts'],
    {
      cwd: `${import.meta.dir}/..`,
      env: {
        PATH: process.env['PATH'],
        AUTH_CONSOLE_CLIENT_SECRET: 'supplied-secret-must-stay-private',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).toBe(1);
  expect(stderr).toContain('missing Vault fields in secret/data/personal/dev');
  expect(stderr).toContain('AUTH_RELAY_DATABASE_URL');
  expect(stderr).not.toContain('Missing settings: AUTH_ORIGIN');
  expect(stderr).toContain('No mock fallback was started');
  expect(stdout + stderr).not.toContain('supplied-secret-must-stay-private');
  expect(stdout).not.toContain('Starting local database');
});
