import assert from 'node:assert/strict';
import { digest } from '../src/db';
import type { Dependencies } from '../src/types';

type Operator = (
  path: string,
  method?: string,
  body?: unknown
) => Promise<{ status: number; data: { revision?: number } }>;

export async function agentAcceptance(
  operator: Operator,
  deps: Dependencies,
  operatorClient: string
) {
  const id = `grant-${crypto.randomUUID()}`;
  const token = 'agent-fixture-'.repeat(4);
  const grant = {
    tokenHash: digest(token),
    project: 'agent-fixture',
    environments: ['localhost', 'preview'],
    origins: ['https://agent.example'],
    allowLoopback: true,
    expiresAt: new Date(Date.now() + 7200000).toISOString(),
  };
  assert.equal(
    (await operator(`/api/agent-grants/${id}`, 'PUT', grant)).status,
    200
  );
  const base = deps.config.origin;
  async function agent(
    path = '/agent/v1/clients',
    method = 'GET',
    body?: unknown,
    bearer = token
  ) {
    return fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  assert.equal((await fetch(`${base}/agent/v1/clients`)).status, 401);
  assert.equal((await agent('/api/clients')).status, 401);
  for (const headers of [{ Origin: base }, { Cookie: 'session=fake' }])
    assert.equal(
      (
        await fetch(`${base}/agent/v1/clients`, {
          headers: { ...headers, Authorization: `Bearer ${token}` },
        })
      ).status,
      403
    );
  const input = {
    name: 'Agent fixture',
    project: 'agent-fixture',
    environment: 'localhost',
    instance: 'one',
    callbacks: ['http://localhost:40001/callback'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const client = `app-${crypto.randomUUID()}`;
  const path = `/agent/v1/clients/${client}`;
  for (const changes of [
    { project: 'another' },
    { environment: 'ci' },
    { callbacks: ['https://elsewhere.example/callback'] },
    { callbacks: ['https://*.example/callback'] },
    { expiresAt: new Date(Date.now() + 10800000).toISOString() },
  ])
    assert.equal(
      (await agent(path, 'PUT', { ...input, ...changes })).status,
      400
    );
  assert.equal(
    (await agent(`/agent/v1/clients/${operatorClient}`, 'DELETE')).status,
    400
  );
  assert.equal(
    (await agent(`/agent/v1/clients/${operatorClient}`, 'PUT', input)).status,
    400
  );
  assert.equal((await agent(path, 'PUT', input)).status, 200);
  assert.equal(
    (await agent(`/agent/v1/clients/app-${crypto.randomUUID()}`, 'PUT', input))
      .status,
    400
  );
  assert.equal((await agent(path, 'PUT', input)).status, 400);
  const changed = {
    ...input,
    callbacks: ['http://127.0.0.1:40002/callback'],
    revision: 1,
  };
  const upstream = deps.config.upstream;
  deps.config.upstream = 'http://127.0.0.1:1';
  try {
    assert.equal((await agent(path, 'PUT', changed)).status, 503);
  } finally {
    deps.config.upstream = upstream;
  }
  const listing = await (await agent()).json();
  assert.equal(listing.clients.length, 1);
  assert.deepEqual(listing.clients[0].config.callbacks, input.callbacks);
  assert.equal((await agent(path, 'PUT', changed)).status, 200);
  // A second credential cannot discover or mutate the first credential's clients.
  const otherId = `grant-${crypto.randomUUID()}`;
  const otherToken = 'other-agent-fixture-'.repeat(3);
  assert.equal(
    (
      await operator(`/api/agent-grants/${otherId}`, 'PUT', {
        ...grant,
        tokenHash: digest(otherToken),
      })
    ).status,
    200
  );
  assert.equal(
    (await agent(path, 'PUT', { ...changed, revision: 2 }, otherToken)).status,
    400
  );
  assert.equal(
    (await agent(path, 'DELETE', undefined, otherToken)).status,
    400
  );
  assert.deepEqual(
    (
      await (
        await agent('/agent/v1/clients', 'GET', undefined, otherToken)
      ).json()
    ).clients,
    []
  );
  // Rotate in place: new credential retains ownership, old credential stops working.
  const rotated = 'rotated-agent-fixture-'.repeat(3);
  assert.equal(
    (
      await operator(`/api/agent-grants/${id}`, 'PUT', {
        ...grant,
        tokenHash: digest(rotated),
        revision: 1,
      })
    ).status,
    200
  );
  assert.equal((await agent()).status, 401);
  assert.equal((await agent(path, 'DELETE', undefined, rotated)).status, 200);
  assert.equal(
    (await operator(`/api/agent-grants/${id}`, 'DELETE')).status,
    200
  );
  assert.equal(
    (await agent('/agent/v1/clients', 'GET', undefined, rotated)).status,
    401
  );
  const schema = deps.db(deps.config.schema);
  await deps.db`UPDATE ${schema}.agent_grants SET expires_at = now() - interval '1 second' WHERE id = ${otherId}`;
  assert.equal(
    (await agent('/agent/v1/clients', 'GET', undefined, otherToken)).status,
    401
  );
  const audit =
    await deps.db`SELECT action FROM ${schema}.audit WHERE subject = ${`agent:${id}`}`;
  assert(
    audit.some((row) => row.action === 'save') &&
      audit.some((row) => row.action === 'revoke')
  );
  console.log(
    'PASS scoped agent registration, ownership isolation, revision/port updates, provider failure preservation, credential rotation/revocation/expiry and audit'
  );
}
