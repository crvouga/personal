import { expect, spyOn, test } from 'bun:test';
import { request } from '../ui/api';
import { registrationValidation, callbackLines } from '../ui/editor-validation';
import type { Session } from '../ui/model';

const session = { csrf: 'fixture-csrf' } as Session;
test('browser writes use the same-origin session, CSRF token and exact revision', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ revision: 3 })
  );
  try {
    await expect(
      request('/api/clients/app-fixture', session, {
        method: 'PUT',
        body: { revision: 2 },
      })
    ).resolves.toEqual({ revision: 3 });
    const [path, options] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/clients/app-fixture');
    expect(options?.credentials).toBe('same-origin');
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'fixture-csrf',
    });
    expect(options?.body).toBe('{"revision":2}');
  } finally {
    fetch.mockRestore();
  }
});
test('stale writes and provider failures surface errors without retrying', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(
      { error: 'Registration changed; reload before saving' },
      { status: 400 }
    )
  );
  try {
    await expect(
      request('/api/clients/app-fixture', session, { method: 'PUT' })
    ).rejects.toThrow('Registration changed; reload before saving');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response('proxy unavailable', { status: 503 }));
    await expect(request('/api/clients', session)).rejects.toThrow(
      'The relay returned an unexpected response'
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    fetch.mockRestore();
  }
});
test('inline validation respects production callback restrictions and requires verified ownership', () => {
  const local = registrationValidation(false);
  const production = registrationValidation(true);
  expect(local.callbacks('http://localhost:5173/callback')).toBeNull();
  expect(production.callbacks('http://localhost:5173/callback')).toBeTruthy();
  expect(production.callbacks('https://*.example.com/callback')).toBeTruthy();
  expect(production.callbacks('https://app.example.com/callback')).toBeNull();
  expect(local.ownership(false)).toBeTruthy();
  expect(local.ownership(true)).toBeNull();
  expect(local.expiresAt('invalid')).toBeTruthy();
  expect(
    local.expiresAt(new Date(Date.now() + 8 * 86400_000).toISOString())
  ).toBeTruthy();
  expect(
    production.expiresAt(new Date(Date.now() + 8 * 86400_000).toISOString())
  ).toBeNull();
  expect(local.project(' leading space')).toBeTruthy();
});
test('callback parsing trims blanks and duplicates before saving or selecting settings', () => {
  expect(
    callbackLines(
      'http://localhost:5173/callback\n\n http://localhost:5173/callback\nhttp://localhost:3000/callback '
    )
  ).toEqual([
    'http://localhost:5173/callback',
    'http://localhost:3000/callback',
  ]);
});
