import { expect, test } from 'bun:test';
import { execute } from '../src/program';
import { capabilities } from '../src/options';
import { CAPABILITIES } from '../../fleet/src/config';

const settings = { workspace: '/missing-workspace', config: '/missing-roster' };
test('the sole public parser preserves fleet defaults and preview authorization', async () => {
  expect(capabilities('none')).toEqual([]);
  expect(capabilities()).toEqual(
    CAPABILITIES.filter((entry) => entry !== 'worker')
  );
  expect((await execute([], settings, 'test')).exitCode).toBe(0);
});
test.each(
  [
    ['sync', '--apply'],
    ['doctor', '--apply', '--yes'],
    ['doctor', '--pull'],
    ['doctor', '--local', '--node', 'dev-one'],
    ['doctor', '--timeout', 'Infinity'],
    ['doctor', '--timeout', '0'],
    ['doctor', '--require', 'made-up'],
    ['unknown'],
  ].map((args) => ({ args }))
)('the public fleet parser rejects unsafe options %j', async ({ args }) => {
  expect(
    (await execute(['fleet', ...args, '--json'], settings, 'test')).exitCode
  ).toBe(2);
});
