import { expect, test } from 'bun:test';
import { audit, buildTfvars, parseEnv } from './vault-secrets-tfvars';

test('parses comments, export, quotes and inline comments', () => {
  expect(
    parseEnv('# c\nexport A=1\nB="x y\\nz"\nC=\'q # r\'\nD=v # note\nE=\n')
  ).toEqual({ A: '1', B: 'x y\nz', C: 'q # r', D: 'v', E: '' });
});

test('rejects malformed lines', () => {
  expect(() => parseEnv('nonsense')).toThrow('Line 1');
  expect(() => parseEnv('A="open')).toThrow('unterminated');
});

test('uses identical secrets for dev and prd', () => {
  const { secrets } = buildTfvars({ A: '1', BLANK: '' });
  expect(secrets).toEqual({ dev: { A: '1' }, prd: { A: '1' } });
});

test('reports generated overrides and missing required inputs', () => {
  const keys = [
    { name: 'A', configs: ['dev'], required: true },
    { name: 'B', configs: ['dev'], required: true },
    { name: 'G', configs: ['dev'], required: true, generated: true },
  ];
  expect(audit({ A: '1', G: 'x' }, keys)).toEqual({
    ignored: ['G'],
    missing: ['B'],
  });
});
