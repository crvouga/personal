import { expect, test } from 'bun:test';
import { providerHttpFailure, providerFailureCode } from './provider-errors';
test('provider rejection distinguishes auth, quota, upstream and protocol failures', () => {
  for (const [status, code] of [
    [401, 'PROVIDER_AUTH_REJECTED'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [503, 'PROVIDER_UPSTREAM_UNAVAILABLE'],
    [404, 'PROVIDER_PROTOCOL_REJECTED'],
  ] as const)
    expect(providerFailureCode(providerHttpFailure(status))).toBe(code);
});
test('unexpected private errors never become diagnostic codes', () => {
  expect(providerFailureCode(new Error('PRIVATE_SENTINEL'))).toBe(
    'PROVIDER_ROUTE_UNVERIFIED'
  );
  expect(providerFailureCode(new TypeError('PRIVATE_SENTINEL'))).toBe(
    'PROVIDER_NETWORK_UNVERIFIED'
  );
  expect(providerFailureCode(new Error('PROVIDER_STREAM_INCOMPLETE'))).toBe(
    'PROVIDER_STREAM_INCOMPLETE'
  );
});
