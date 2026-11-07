import { expect, test } from 'bun:test';
import { convergeT3Service } from './t3-service';
import type { Runner } from '../../../../fleet/src/types';
const artifact = { path: '/managed/t3', version: '0.1.7' };
const result = (stdout: string, ok = true) => ({
  ok,
  stdout,
  stderr: '',
  reason: 'exit' as const,
});
test('healthy native T3 is checked without reinstall, restart or pairing', async () => {
  const calls: string[][] = [];
  const run: Runner = async (args) => {
    calls.push(args);
    if (args.includes('--version')) return result('t3 v0.1.7');
    if (args.includes('--json'))
      return result(
        JSON.stringify({
          service: { installed: true, installedVersion: '0.1.7' },
        })
      );
    return result('active');
  };
  const checks = await convergeT3Service(artifact, run);
  expect(checks[0]?.status).toBe('pass');
  expect(
    calls.some(
      (args) =>
        args.includes('install') ||
        args.includes('restart') ||
        args.includes('pair')
    )
  ).toBe(false);
});
test('newer desktop CLI is preserved instead of implicitly downgraded', async () => {
  const calls: string[][] = [];
  const checks = await convergeT3Service(artifact, async (args) => {
    calls.push(args);
    return result('t3 v0.1.8');
  });
  expect(checks[0]?.summary).toBe('T3_EXECUTABLE_OWNER_CONFLICT');
  expect(calls).toHaveLength(1);
});
test('an unmanaged listener blocks duplicate native service installation', async () => {
  const checks = await convergeT3Service(artifact, async (args) => {
    if (args.includes('--version')) return result('', false);
    if (args.includes('--json'))
      return result(JSON.stringify({ service: { installed: false } }));
    expect(args[0]).toBe('ss');
    return result('LISTEN occupied');
  });
  expect(checks[0]?.summary).toBe('T3_LISTENER_CONFLICT');
});
test('stopped pinned service is started once and independently rechecked without resetting restart limits', async () => {
  const calls: string[][] = [];
  let started = false;
  const checks = await convergeT3Service(artifact, async (args) => {
    calls.push(args);
    if (args.includes('--version')) return result('t3 v0.1.7');
    if (args.includes('--json'))
      return result(
        JSON.stringify({
          service: { installed: true, installedVersion: '0.1.7' },
        })
      );
    if (args[0] === 'ss') return result('');
    if (args.includes('start')) {
      started = true;
      return result('');
    }
    if (args.includes('is-active'))
      return result(started ? 'active' : 'inactive', started);
    return result('enabled');
  });
  expect(checks[0]?.status).toBe('pass');
  expect(calls.filter((args) => args.includes('start'))).toHaveLength(1);
  expect(calls.filter((args) => args.includes('is-active'))).toHaveLength(2);
  expect(calls.some((args) => args.includes('reset-failed'))).toBe(false);
});
test('a conflicting native launcher prevents managed policy installation too', async () => {
  let prepared = false;
  await convergeT3Service(
    artifact,
    async () => result('t3 v0.1.8'),
    async () => {
      prepared = true;
      return [];
    }
  );
  expect(prepared).toBe(false);
});
test('a desktop-owned live listener blocks starting an installed but inactive native unit', async () => {
  const calls: string[][] = [];
  const checks = await convergeT3Service(artifact, async (args) => {
    calls.push(args);
    if (args.includes('--version')) return result('t3 v0.1.7');
    if (args.includes('--json'))
      return result(
        JSON.stringify({
          service: { installed: true, installedVersion: '0.1.7' },
        })
      );
    if (args[0] === 'ss') return result('LISTEN desktop');
    return result('inactive', false);
  });
  expect(checks[0]?.summary).toBe('T3_ACTIVE_LISTENER_MIGRATION_REQUIRED');
  expect(calls.some((args) => args.includes('start'))).toBe(false);
});
