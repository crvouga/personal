import { expect, test } from 'bun:test';
import { BESZEL_FLEET_IDENTITY, fleetCredentials } from './hub-access';

test('the generated password maps to the fixed fleet account; legacy JSON still works', () => {
  expect(fleetCredentials('generated-secret-value\n')).toEqual({
    identity: BESZEL_FLEET_IDENTITY,
    password: 'generated-secret-value',
  });
  expect(
    fleetCredentials('{"identity":"ops@example.test","password":"p"}')
  ).toEqual({ identity: 'ops@example.test', password: 'p' });
  for (const invalid of ['', '   ', '{"identity":"x"}', '{not json']) {
    expect(() => fleetCredentials(invalid)).toThrow('BESZEL_ACCOUNT_INVALID');
  }
});
