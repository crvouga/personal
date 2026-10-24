import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../agent';
import { digest } from './db';

const key = 'AUTH_AGENT_CLIENT_TEST_TOKEN';
const token = 'client-test-credential-'.repeat(3);
test('standalone client fingerprints injected credentials without returning the credential', async () => {
  process.env[key] = token;
  try {
    expect(await runAgent(['fingerprint', '--token-env', key])).toBe(
      digest(token)
    );
    await expect(
      runAgent([
        'list',
        '--origin',
        'http://attacker.example',
        '--token-env',
        key,
      ])
    ).rejects.toThrow('HTTPS');
  } finally {
    delete process.env[key];
  }
});

test('registration reconciles pending identities, uses the revision and keeps credentials out of output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'auth-agent-client-'));
  const file = join(directory, 'registration.json');
  const id = `app-${crypto.randomUUID()}`;
  const grantExpiry = new Date(Date.now() + 300000).toISOString();
  const input = {
    name: 'Example',
    project: 'example',
    environment: 'localhost',
    instance: 'one',
    callbacks: ['http://localhost:5173/callback'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  await writeFile(file, JSON.stringify(input));
  const requests: {
    method: string;
    body: unknown;
    authorization: string | null;
  }[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push({
        method: request.method,
        body: request.method === 'PUT' ? await request.json() : null,
        authorization: request.headers.get('Authorization'),
      });
      if (request.method === 'GET')
        return Response.json({
          issuer: 'https://auth.example/realms/test',
          grant: { expiresAt: grantExpiry },
          clients: [{ id, revision: 2, config: null, desired: input }],
        });
      expect(new URL(request.url).pathname).toBe(`/agent/v1/clients/${id}`);
      return Response.json({ revision: 3 });
    },
  });
  process.env[key] = token;
  try {
    const output = await runAgent([
      'register',
      '--file',
      file,
      '--origin',
      server.url.origin,
      '--token-env',
      key,
    ]);
    expect(output).toMatchObject({
      id,
      revision: 3,
      settings: { OIDC_CLIENT_ID: id },
    });
    expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT']);
    expect(requests[1]?.body).toEqual({ ...input, revision: 2 });
    expect(requests[1]?.authorization).toBe(`Bearer ${token}`);
    expect(JSON.stringify(output)).not.toContain(token);
    await writeFile(file, JSON.stringify({ ...input, expiresAt: undefined }));
    await runAgent([
      'register',
      '--file',
      file,
      '--origin',
      server.url.origin,
      '--token-env',
      key,
      '--callback',
      'http://127.0.0.1:43123/callback',
    ]);
    expect(requests[3]?.body).toEqual({
      ...input,
      revision: 2,
      expiresAt: grantExpiry,
      callbacks: ['http://127.0.0.1:43123/callback'],
    });
  } finally {
    delete process.env[key];
    await server.stop(true);
    await rm(directory, { recursive: true });
  }
});

test('the client refuses redirect forwarding and does not echo a failed server body or retry', async () => {
  let calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      calls++;
      return new Response(token, {
        status: 307,
        headers: { Location: 'https://attacker.example' },
      });
    },
  });
  process.env[key] = token;
  try {
    await expect(
      runAgent(['list', '--origin', server.url.origin, '--token-env', key])
    ).rejects.toThrow('HTTP 307');
    expect(calls).toBe(1);
  } finally {
    delete process.env[key];
    await server.stop(true);
  }
});
