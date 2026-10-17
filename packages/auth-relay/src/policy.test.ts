import { expect, test } from 'bun:test';
import { callbackAllowed, registration } from './policy';

test('exact local ports are permitted only outside production', () => {
  for (const port of [3000, 5173, 8080, 43123]) {
    expect(callbackAllowed(`http://localhost:${port}/callback`, false)).toBe(
      true
    );
    expect(callbackAllowed(`http://127.0.0.1:${port}/callback`, false)).toBe(
      true
    );
    expect(callbackAllowed(`http://localhost:${port}/callback`, true)).toBe(
      false
    );
  }
});
test('redirect policy rejects wildcards, credentials, fragments and noncanonical URLs', () => {
  for (const url of [
    'https://*.example.com/callback',
    'https://user:pass@example.com/callback',
    'https://example.com/callback#token',
    'javascript:alert(1)',
    'http://localhost/callback',
    'http://example.com/callback',
    'https://EXAMPLE.com/callback',
  ]) {
    expect(callbackAllowed(url, false)).toBe(false);
  }
  expect(callbackAllowed('https://project-a.com/callback', true)).toBe(true);
  expect(callbackAllowed('https://project-b.io/callback', true)).toBe(true);
});
test('environment separation and expiry are validated before writes', () => {
  const input = {
    name: 'Project',
    project: 'project',
    environment: 'localhost',
    instance: 'dev-one',
    callbacks: ['http://localhost:5173/callback'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  expect(registration(input, false)).toEqual(input);
  expect(() => registration(input, true)).toThrow('Wrong environment');
  expect(() => registration({ ...input, expiresAt: 'invalid' }, false)).toThrow(
    'Invalid expiry'
  );
  expect(() => registration({ ...input, callbacks: [] }, false)).toThrow();
});
