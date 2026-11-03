import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withUserpassSession } from '../scripts/release-userpass';
import { publishingToken } from '../scripts/release-auth';
import { withPublisher } from '../scripts/release-publisher';
import { hasCiPublisher, trustConfigurations } from '../scripts/release-trust';

test('userpass authenticates with password and revokes its unsaved session even when a credential read fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-userpass-test-'));
  const file = join(directory, 'password');
  await writeFile(file, 'synthetic-password \n', { mode: 0o600 });
  const requests: string[] = [];
  const request = (async (url: URL, options: RequestInit) => {
    requests.push(url.pathname);
    if (url.pathname.includes('/login/')) {
      expect(JSON.parse(options.body as string)).toEqual({
        password: 'synthetic-password ',
      });
      return Response.json({ auth: { client_token: 'synthetic-session' } });
    }
    expect(options.headers).toEqual({ 'X-Vault-Token': 'synthetic-session' });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  try {
    await expect(
      withUserpassSession(
        {
          PERSONAL_VAULT_PASSWORD_FILE: file,
          PERSONAL_VAULT_USERNAME: 'test-user',
        },
        async (session) => {
          expect(session).toBe('synthetic-session');
          throw new Error('read denied');
        },
        request
      )
    ).rejects.toThrow('read denied');
    expect(requests).toEqual([
      '/v1/auth/userpass/login/test-user',
      '/v1/auth/token/revoke-self',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('insecure userpass addresses and conflicting publication methods fail before authentication', async () => {
  await expect(
    withUserpassSession({ VAULT_ADDR: 'http://example.test' }, async () => null)
  ).rejects.toThrow('HTTPS');
  await expect(
    publishingToken({
      VAULT_TOKEN: 'ignored-token',
      VAULT_ADDR: 'http://example.test',
    })
  ).rejects.toThrow('HTTPS');
  await expect(
    withPublisher(
      { oidc: true, login: true, npmLogin: false },
      async () => null
    )
  ).rejects.toThrow('Choose one');
  await expect(
    withPublisher(
      { oidc: false, login: true, npmLogin: true },
      async () => null
    )
  ).rejects.toThrow('Choose one');
});

test('publisher matching uses the caller workflow and direct publish permission without replacing unrelated publishers', () => {
  const desired = {
    type: 'github',
    repository: 'crvouga/personal',
    file: 'ci.yml',
    permissions: ['createPackage'],
  };
  const other = { ...desired, repository: 'other/project' };
  expect(
    hasCiPublisher(
      trustConfigurations(
        `${JSON.stringify(other, null, 2)}\n${JSON.stringify(desired, null, 2)}\n`
      )
    )
  ).toBe(true);
  expect(
    hasCiPublisher([{ ...desired, file: 'release-personal-cli.yml' }])
  ).toBe(false);
  expect(hasCiPublisher([{ ...desired, environment: 'other' }])).toBe(false);
  expect(hasCiPublisher([{ ...desired, permissions: [] }])).toBe(false);
  expect(trustConfigurations(' \n')).toEqual([]);
  expect(() => trustConfigurations('{')).toThrow();
  expect(() => trustConfigurations('unexpected')).toThrow();
});
