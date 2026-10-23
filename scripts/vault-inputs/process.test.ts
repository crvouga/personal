import { expect, test } from 'bun:test';
import { capture } from './process';

test('captured credential lookups cannot read or prompt on the interactive terminal', async () => {
  const result = await capture([
    process.execPath,
    '-e',
    'console.log((await new Response(Bun.stdin.stream()).text()) === "" ? "stdin-closed" : "unexpected-input")',
  ]);
  expect(result).toBe('stdin-closed');
});
