import { expect, test } from 'bun:test';
import { forwardedHeaders } from './oidc';

test('server-side and proxied Keycloak requests carry the public origin', () => {
  const headers = forwardedHeaders(
    'https://auth.example.com',
    new Headers({
      host: 'identity.railway.internal:8080',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-proto': 'http',
      authorization: 'Basic abc',
    })
  );
  expect(headers.get('x-forwarded-proto')).toBe('https');
  expect(headers.get('x-forwarded-host')).toBe('auth.example.com');
  expect(headers.has('host')).toBe(false);
  expect(headers.has('x-forwarded-for')).toBe(false);
  expect(headers.get('authorization')).toBe('Basic abc');
});

test('forwarded headers are added when the caller supplies none', () => {
  const headers = forwardedHeaders('http://localhost:8081', undefined);
  expect(headers.get('x-forwarded-proto')).toBe('http');
  expect(headers.get('x-forwarded-host')).toBe('localhost:8081');
});
