import { expect, test } from 'bun:test';
import { ZoomiesApi, type FetchLike } from './api';
import {
  configure,
  installationBody,
  missingAppFields,
  storedPoolName,
  withVaultAppFields,
} from './configure';
import { parseArgs } from './join-token';
import { POOLS } from './spec';

const env = {
  ZOOMIES_GITHUB_APP_ID: '123',
  ZOOMIES_GITHUB_APP_INSTALLATION_ID: '456',
  ZOOMIES_GITHUB_APP_PRIVATE_KEY: 'pem',
};

type State = { installations: unknown[]; pools: unknown[] };

function handlePost(
  state: State,
  path: string,
  body: Record<string, unknown>
): Response {
  if (path === '/api/v1/installations') {
    const created = {
      id: 'ins_1',
      installation_id: body['installation_id'],
      target: body['target'],
    };
    state.installations.push(created);
    return Response.json(created, { status: 201 });
  }
  const created = {
    id: 'pool_1',
    name: body['name'],
    installation_id: body['installation_id'],
  };
  state.pools.push(created);
  return Response.json(created, { status: 201 });
}

function fakeController(state: State) {
  const calls: string[] = [];
  const fetcher: FetchLike = async (input, init) => {
    const path = new URL(input).pathname;
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    expect(
      (init?.headers as Record<string, string> | undefined)?.['authorization']
    ).toBe('Bearer token');
    if (method !== 'GET')
      return handlePost(
        state,
        path,
        JSON.parse(String(init?.body)) as Record<string, unknown>
      );
    return Response.json({
      items: path === '/api/v1/pools' ? state.pools : state.installations,
    });
  };
  return {
    calls,
    api: new ZoomiesApi('https://zoomies.test', 'token', fetcher),
  };
}

test('skips cleanly until the GitHub App secrets exist', async () => {
  const { api, calls } = fakeController({ installations: [], pools: [] });
  expect(missingAppFields({})).toHaveLength(3);
  expect(await configure(api, {}, () => {})).toBe('app-missing');
  expect(calls).toEqual([]);
});

test('connects the installation and creates declared pools once', async () => {
  const { api, calls } = fakeController({ installations: [], pools: [] });
  expect(await configure(api, env, () => {})).toBe('configured');
  expect(calls.filter((call) => call.startsWith('POST'))).toEqual([
    'POST /api/v1/installations',
    'POST /api/v1/pools',
  ]);
  calls.length = 0;
  await configure(api, env, () => {});
  expect(calls.filter((call) => call.startsWith('POST'))).toEqual([]);
});

test('never recreates or modifies a pool tuned in the UI', async () => {
  const { api, calls } = fakeController({
    installations: [
      { id: 'ins_9', installation_id: 456, target: 'crvouga/personal' },
    ],
    pools: POOLS.map((pool) => ({
      id: 'p',
      name: storedPoolName(pool.name),
      installation_id: 'ins_9',
    })),
  });
  await configure(api, env, () => {});
  expect(calls.every((call) => call.startsWith('GET'))).toBe(true);
});

test('validates numeric App identifiers and passes the optional webhook secret', () => {
  expect(() =>
    installationBody({ ...env, ZOOMIES_GITHUB_APP_ID: 'x' })
  ).toThrow('integers');
  expect(
    installationBody({ ...env, ZOOMIES_GITHUB_APP_WEBHOOK_SECRET: 's' })
  ).toMatchObject({
    app_id: 123,
    installation_id: 456,
    target_type: 'repo',
    webhook_secret: 's',
  });
});

test('restores PEM newlines stored as escaped sequences', () => {
  const body = installationBody({
    ...env,
    ZOOMIES_GITHUB_APP_PRIVATE_KEY: '-----BEGIN-----\\nabc\\n-----END-----',
  });
  expect(body.private_key).toBe('-----BEGIN-----\nabc\n-----END-----');
});

test('pool names always carry the brand prefix', () => {
  expect(storedPoolName('gpu')).toBe('zoomies-gpu');
  expect(storedPoolName('zoomies-gpu')).toBe('zoomies-gpu');
});

test('parses join token arguments', () => {
  expect(
    parseArgs(['--ttl', '1h', '--capacity', '4', '--label', 'site=home'])
  ).toEqual({
    ttl: '1h',
    capacity: 4,
    labels: { site: 'home' },
  });
  expect(() => parseArgs(['--label', 'bad'])).toThrow('key=value');
  expect(() => parseArgs(['--capacity', '-1'])).toThrow('non-negative');
});

test('surfaces API failures without the credential', async () => {
  const api = new ZoomiesApi(
    'https://zoomies.test',
    'secret-token',
    async () => new Response('nope', { status: 403 })
  );
  let message = '';
  await api.pools().catch((caught: unknown) => {
    message = String(caught);
  });
  expect(message).toContain('403');
  expect(message).not.toContain('secret-token');
});

test('fills absent App fields from the Vault document only when needed', async () => {
  const calls: string[] = [];
  const fetcher: FetchLike = async (input, init) => {
    calls.push(input);
    expect((init?.headers as Record<string, string>)['x-vault-token']).toBe(
      't'
    );
    return Response.json({ data: { data: { ZOOMIES_GITHUB_APP_ID: '9' } } });
  };
  const base = { VAULT_ADDR: 'https://vault.test', VAULT_TOKEN: 't' };
  const filled = await withVaultAppFields(base, fetcher);
  expect(filled['ZOOMIES_GITHUB_APP_ID']).toBe('9');
  expect(missingAppFields(filled)).toHaveLength(2);
  expect(await withVaultAppFields({}, fetcher)).toEqual({});
  expect(calls).toEqual(['https://vault.test/v1/secret/data/personal/prd']);
});
