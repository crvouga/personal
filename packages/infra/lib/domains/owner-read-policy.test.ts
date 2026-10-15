import { expect, test } from 'bun:test';
import { ownerBrowserEnvironment } from './owner-browser.js';
import { ownerPageAllowed, ownerReadRequest } from './owner-read-policy.js';

test('inspection refuses every write method, including writes to trusted owner origins', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE']) {
    expect(ownerReadRequest('https://account.squarespace.com/api/domain/unlock', method, false)).toBe(false);
    expect(ownerReadRequest('https://account.squarespace.com/domains', method, true)).toBe(false);
  }
});

test('inspection follows only exact HTTPS owner origins, never credentialed or lookalike URLs', () => {
  expect(ownerPageAllowed('https://account.squarespace.com/domains')).toBe(true);
  expect(ownerReadRequest('https://login.squarespace.com/', 'GET', true)).toBe(true);
  for (const url of ['https://account.squarespace.com.evil.example/domains', 'http://account.squarespace.com/domains',
    'https://user:password@account.squarespace.com/domains', 'https://accounts.google.com/', 'file:///etc/passwd', 'javascript:alert(1)']) {
    expect(ownerPageAllowed(url)).toBe(false);
    expect(ownerReadRequest(url, 'GET', true)).toBe(false);
  }
});

test('static assets do not permit foreign navigation or arbitrary outbound requests', () => {
  expect(ownerReadRequest('https://static1.squarespace.com/app.js', 'GET', false)).toBe(true);
  expect(ownerReadRequest('https://fonts.gstatic.com/font.woff', 'GET', false)).toBe(true);
  expect(ownerReadRequest('https://fonts.gstatic.com/', 'GET', true)).toBe(false);
  expect(ownerReadRequest('https://squarespace.com.evil.example/collect', 'GET', false)).toBe(false);
  expect(ownerReadRequest('https://attacker.example/collect', 'GET', false)).toBe(false);
});

test('infrastructure and provider credentials are absent from the browser environment', () => {
  const before = process.env['TF_VAR_state_passphrase'];
  try {
    process.env['TF_VAR_state_passphrase'] = 'fixture-private-state-input';
    const env = ownerBrowserEnvironment();
    expect(env['TF_VAR_state_passphrase']).toBeUndefined();
    expect(env['CLOUDFLARE_API_TOKEN']).toBeUndefined();
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    const home = process.env['HOME'];
    if (home !== undefined) expect(env['HOME']).toBe(home);
  } finally {
    if (before === undefined) delete process.env['TF_VAR_state_passphrase'];
    else process.env['TF_VAR_state_passphrase'] = before;
  }
});
