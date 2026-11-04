import { expect, test } from 'bun:test';
import { runCommand } from './runner';

test('captures success and distinguishes missing commands', async () => {
  expect(
    (await runCommand([process.execPath, '-e', 'process.stdout.write("ok")']))
      .stdout
  ).toBe('ok');
  expect((await runCommand(['/fleet-definitely-missing-command'])).reason).toBe(
    'missing'
  );
});

test('bounds output and deadlines', async () => {
  const timeout = await runCommand(
    [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    { timeoutMs: 100 }
  );
  expect(timeout.ok).toBe(false);
  expect(timeout.reason).toBe('timeout');
  const overflow = await runCommand([
    process.execPath,
    '-e',
    'process.stdout.write("x".repeat(2 * 1024 * 1024))',
  ]);
  expect(overflow.ok).toBe(false);
  expect(overflow.reason).toBe('overflow');
  expect(overflow.stdout.length).toBeLessThanOrEqual(1024 * 1024);
});
