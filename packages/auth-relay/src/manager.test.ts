import { expect, test } from 'bun:test';
import { Manager } from './manager';
import type { Config } from './config';
import { errorDetails } from '@pkgs/logger';

test('private manager token, lookup and update requests carry the HTTPS public origin', async () => {
  const calls: Request[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      calls.push(request);
      if (request.headers.get('x-forwarded-proto') !== 'https')
        return new Response('HTTPS required', { status: 403 });
      if (request.url.endsWith('/token'))
        return Response.json({ access_token: 'test-token' });
      if (request.method === 'GET')
        return Response.json([
          {
            id: 'internal-client',
            attributes: { 'auth-relay.owner': 'app-test' },
          },
        ]);
      return new Response(null, { status: 204 });
    },
  });
  try {
    const config = {
      upstream: server.url.origin,
      origin: 'https://auth.example',
      realm: 'projects',
      managerId: 'manager',
      managerSecret: 'test-secret',
    } as Config;
    await new Manager(config).apply('app-test', null, []);
    expect(calls.map((request) => request.method)).toEqual([
      'POST',
      'GET',
      'PUT',
    ]);
    for (const request of calls)
      expect(request.headers.get('x-forwarded-host')).toBe('auth.example');
    expect(calls[1]?.headers.get('Authorization')).toBe('Bearer test-token');
  } finally {
    await server.stop(true);
  }
});

test('a rejected manager token records safe status and OAuth reason without retrying or writing', async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch() {
      calls++;
      return Response.json(
        { error: 'invalid_client', error_description: 'private-client-secret' },
        { status: 401 }
      );
    },
  });
  try {
    const config = {
      upstream: server.url.origin,
      origin: 'https://auth.example',
      realm: 'projects',
      managerId: 'manager',
      managerSecret: 'private-client-secret',
    } as Config;
    const error = await new Manager(config)
      .apply('app-test', null, [])
      .catch((error: unknown) => error);
    const details = errorDetails(error);
    expect(details['operation']).toBe('manager.token');
    expect(details['cause']).toMatchObject({
      status: 401,
      oauth: 'invalid_client',
    });
    expect(JSON.stringify(details)).not.toContain('private-client-secret');
    expect(calls).toBe(1);
  } finally {
    await server.stop(true);
  }
});
