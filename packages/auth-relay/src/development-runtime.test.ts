import { expect, test } from 'bun:test';
import { ensureDocker } from '../development/docker';
import { localIdentity } from '../development/identity';
import type { command } from '../development/process';
import { assertCluster } from '../development/database';

function runtime(context: string, ready = false) {
  const calls: string[] = [];
  let running = ready;
  const run: typeof command = async (args) => {
    const name = args.slice(0, 2).join(' ');
    calls.push(name);
    if (name === 'docker info' && !running) throw new Error('daemon stopped');
    if (name === 'docker context') return context;
    if (name === 'colima list')
      return JSON.stringify({ name: 'default', status: 'Stopped' });
    if (name === 'colima start') running = true;
    return '';
  };
  return { run, calls };
}

test('cold startup starts the selected Colima runtime and checks readiness again', async () => {
  const fixture = runtime('colima');
  await ensureDocker({}, fixture.run, true);
  expect(fixture.calls).toEqual([
    'docker info',
    'docker context',
    'colima start',
    'docker info',
  ]);
});
test('warm startup does not restart a healthy runtime', async () => {
  const fixture = runtime('colima', true);
  await ensureDocker({}, fixture.run, true);
  expect(fixture.calls).toEqual(['docker info']);
});
test('Colima cold stop removes its context; an existing default profile can still start', async () => {
  const fixture = runtime('default');
  await ensureDocker({}, fixture.run, true);
  expect(fixture.calls).toEqual([
    'docker info',
    'docker context',
    'colima list',
    'colima start',
    'docker info',
  ]);
});
test('an unavailable foreign or explicitly selected endpoint never starts Colima', async () => {
  for (const [context, env] of [
    ['desktop-linux', {}],
    ['colima', { DOCKER_HOST: 'unix:///other.sock' }],
  ] as const) {
    const fixture = runtime(context);
    await expect(ensureDocker(env, fixture.run, true)).rejects.toThrow(
      'Docker is unavailable'
    );
    expect(fixture.calls).not.toContain('colima start');
  }
});
test('fresh verification instances have isolated state and Compose identities', () => {
  const original = localIdentity('/workspace');
  const isolated = localIdentity('/workspace', 'cold-test');
  expect(original.cache).toBe('/workspace/.superset/.auth-dev');
  expect(isolated.cache).toBe(
    '/workspace/.superset/.auth-dev/instances/cold-test'
  );
  expect(isolated.project).not.toBe(original.project);
  expect(isolated).toEqual(localIdentity('/workspace', 'cold-test'));
  for (const invalid of ['', '../other', '/tmp/test', 'UPPER']) {
    expect(() => localIdentity('/workspace', invalid)).toThrow(
      'AUTH_DEV_INSTANCE'
    );
  }
});

test('a host forwarder must reach the owning database before any schema work', () => {
  expect(() => assertCluster('771234567890', '771234567890')).not.toThrow();
  expect(() => assertCluster('771234567890', '771234567891')).toThrow(
    'no schema changes'
  );
  expect(() => assertCluster('', '')).toThrow('no schema changes');
});
