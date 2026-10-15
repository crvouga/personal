import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serve } from './runtime.mjs';

function fixture({ locked = true, restoreError } = {}) {
  const events = [];
  const client = new EventEmitter();
  Object.assign(client, {
    connect: async () => events.push('connect'),
    query: async () => ({ rows: [{ locked }] }),
    end: async () => events.push('unlock'),
  });
  const signals = new EventEmitter();
  let finish;
  const run = (args) => {
    events.push(args.includes('-once') ? 'flush' : args[0]);
    return {
      done:
        args[0] === 'restore' || args.includes('-once')
          ? restoreError
            ? Promise.reject(restoreError)
            : Promise.resolve()
          : new Promise((done) => {
              finish = done;
            }),
      stop: (signal) => {
        events.push(signal);
        finish?.();
      },
    };
  };
  const options = {
    client,
    signals,
    run,
    prepare: async () => events.push('prepare'),
  };
  return { client, signals, events, options, finish: () => finish?.() };
}
const tick = () => new Promise((done) => setImmediate(done));

test('holds the lock through restore, app lifetime and final flush', async () => {
  const f = fixture();
  const serving = serve(f.options);
  await tick();
  assert.deepEqual(f.events, ['connect', 'prepare', 'restore', 'replicate']);
  f.signals.emit('SIGTERM');
  await serving;
  assert.deepEqual(f.events.slice(-3), ['SIGTERM', 'flush', 'unlock']);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});

test('a failed restore never starts the app or uploads an empty database', async () => {
  const f = fixture({ restoreError: new Error('R2 unavailable') });
  await assert.rejects(serve(f.options), /R2 unavailable/);
  assert.deepEqual(f.events, ['connect', 'prepare', 'restore', 'unlock']);
});

test('a contender does not touch SQLite or R2 while the old writer owns the lock', async () => {
  const f = fixture({ locked: false });
  const serving = serve(f.options);
  await tick();
  assert.deepEqual(f.events, ['connect']);
  f.signals.emit('SIGTERM');
  await serving;
  assert.ok(!f.events.includes('prepare'));
});

test('losing the Postgres session kills writers before releasing the lock', async () => {
  const f = fixture();
  const serving = serve(f.options);
  await tick();
  f.client.emit('error', new Error('connection lost'));
  await assert.rejects(serving, /connection lost/);
  assert.deepEqual(f.events.slice(-2), ['SIGKILL', 'unlock']);
});

test('an app exit releases the lock so its replacement can restore', async () => {
  const f = fixture();
  const serving = serve(f.options);
  await tick();
  f.finish();
  await serving;
  assert.equal(f.events.at(-1), 'unlock');
});
