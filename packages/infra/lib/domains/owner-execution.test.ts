import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeContext } from '../health/fixtures.test-support.js';
import { initialize, privateJson } from './files.js';
import { reviewOwnerPlan } from './owner-execution.js';
import { normalizeOperation, operationFile, operationId, type OwnerOperation } from '../../tofu/owner/operation.js';
import { startOwnerTransport } from '../../tofu/owner/transport.js';

const operation: OwnerOperation = { action: 'unlock', domain: 'example.dev', nameservers: [] };

function plan() {
  const id = operationId(operation);
  return { resource_changes: [{ address: 'restapi_object.squarespace_owner_operation[0]', provider_name: 'registry.opentofu.org/mastercard/restapi',
    change: { actions: ['create'], after: { path: '/operations', object_id: id, create_method: 'POST', read_method: 'GET', read_path: `/operations/${id}`,
      update_method: 'GET', update_path: `/operations/${id}`, destroy_method: 'GET', destroy_path: `/operations/${id}`, debug: false,
      ignore_all_server_changes: true, data: JSON.stringify({ ...operation, id }) } } }] };
}

test('owner plans reject unrelated resources, deletes, replacement, altered methods and payloads', () => {
  expect(reviewOwnerPlan(plan(), operation)).toHaveLength(1);
  for (const change of [
    (p: ReturnType<typeof plan>) => { p.resource_changes[0].address = 'atlas_schema.openbao'; },
    (p: ReturnType<typeof plan>) => { p.resource_changes[0].change.actions = ['delete', 'create']; },
    (p: ReturnType<typeof plan>) => { p.resource_changes[0].change.after.destroy_method = 'DELETE'; },
    (p: ReturnType<typeof plan>) => { p.resource_changes[0].change.after.read_path = '/other-account'; },
    (p: ReturnType<typeof plan>) => { p.resource_changes[0].change.after.data = JSON.stringify({ ...operation, id: operationId(operation), domain: 'other.dev' }); },
  ]) {
    const candidate = plan(); change(candidate);
    expect(() => reviewOwnerPlan(candidate, operation)).toThrow();
  }
  expect(() => normalizeOperation({ action: 'delegate', domain: 'example.dev', nameservers: ['attacker.example', 'other.example'] })).toThrow();
});

test('provider transport rejects writes without the apply lease, wrong tokens and cross-domain payloads', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'owner-transport-'));
  initialize(repoRoot, operation.domain);
  let writes = 0;
  const bridge = startOwnerTransport(fakeContext({ repoRoot }), operation, async (_ctx, input, authorized) => {
    expect(authorized()).toBe(true);
    writes++;
    const receipt = { ...input, id: operationId(input), status: 'accepted' };
    privateJson(operationFile(repoRoot, input, 'receipt'), receipt);
    return receipt;
  });
  const post = (body: unknown, token = bridge.token) => fetch(`${bridge.url}/operations`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { ...operation, id: operationId(operation) };
  try {
    expect((await post(body)).status).toBe(403);
    expect((await post(body, 'wrong-token')).status).toBe(401);
    await bridge.withApplyLease(async () => {
      expect((await post({ ...body, domain: 'other.dev' })).status).toBe(400);
      expect((await post(body)).status).toBe(200);
      expect((await post(body)).status).toBe(200);
    });
    expect((await post(body)).status).toBe(403);
    expect(writes).toBe(1);
  } finally { bridge.close(); rmSync(repoRoot, { recursive: true, force: true }); }
});

test('an in-flight operation loses write authority when its OpenTofu apply lease ends', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'owner-revocation-'));
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const hold = new Promise<void>((resolve) => { finish = resolve; });
  let allowedAfterApply: boolean | undefined;
  const bridge = startOwnerTransport(fakeContext({ repoRoot }), operation, async (_ctx, _operation, authorized) => {
    entered(); await hold;
    allowedAfterApply = authorized();
    throw new Error('apply ended');
  });
  let response!: Promise<Response>;
  try {
    await bridge.withApplyLease(async () => {
      response = fetch(`${bridge.url}/operations`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...operation, id: operationId(operation) }) });
      await ready;
    });
    finish();
    expect((await response).status).toBe(409);
    expect(allowedAfterApply).toBe(false);
  } finally { finish(); bridge.close(); rmSync(repoRoot, { recursive: true, force: true }); }
});
