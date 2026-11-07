import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { applyAgent } from './apply';
import type { Runner } from '../../../../fleet/src/types';

const root = resolve(import.meta.dir, '../../../../..');
const revision = 'a'.repeat(40);
for (const conflict of [
  'revision',
  'nested-checkout',
  'dirty',
  'status-failed',
]) {
  test(`monitoring refuses ${conflict} before installation`, async () => {
    const calls: string[][] = [];
    const run: Runner = async (args) => {
      calls.push([...args]);
      const status = args.includes('--porcelain');
      return {
        ok: !(status && conflict === 'status-failed'),
        reason: 'exit',
        stdout: status
          ? conflict === 'dirty'
            ? ' M packages/workstation/monitoring/agent.yml'
            : ''
          : args.includes('--show-toplevel')
            ? conflict === 'nested-checkout'
              ? '/another-checkout'
              : root
            : conflict === 'revision'
              ? 'b'.repeat(40)
              : revision,
        stderr: '',
      };
    };
    await expect(
      applyAgent(
        {
          node: 'chris-vouga-ms-a2',
          revision,
          mode: 'hub',
          hubUrl: 'https://hub.example.ts.net:8443',
        },
        root,
        run
      )
    ).rejects.toThrow('BESZEL_SOURCE_MISMATCH');
    expect(calls.every((args) => args[0] === 'git')).toBe(true);
  });
}
