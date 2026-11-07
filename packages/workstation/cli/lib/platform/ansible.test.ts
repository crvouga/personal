import { expect, test } from 'bun:test';
import { stat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runAnsible } from './ansible';

test('Ansible variables stay private, out of argv/stdin, and are removed after success', async () => {
  let path = '';
  await runAnsible(
    async (args, options) => {
      path = args.at(-1)!.slice(1);
      expect(args.join(' ')).not.toContain('PRIVATE_SENTINEL');
      expect(options?.input).toBeUndefined();
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
      expect(JSON.parse(await readFile(path, 'utf8')).token).toBe(
        'PRIVATE_SENTINEL'
      );
      return { ok: true, stdout: '', stderr: '', reason: 'exit' };
    },
    'fixture.yml',
    { input: JSON.stringify({ token: 'PRIVATE_SENTINEL' }) }
  );
  expect(await stat(path).catch(() => null)).toBeNull();
});
test('failed or interrupted child execution removes temporary credential material', async () => {
  let path = '';
  await expect(
    runAnsible(
      async (args) => {
        path = args.at(-1)!.slice(1);
        throw new Error('fixture failure');
      },
      'fixture.yml',
      { input: '{}' }
    )
  ).rejects.toThrow('fixture failure');
  expect(await stat(dirname(path)).catch(() => null)).toBeNull();
});
