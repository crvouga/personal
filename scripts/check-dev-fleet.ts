/** Read-only proof that a locally running API shows the managed fleet records. */
import assert from 'node:assert/strict';
import { createDb } from '../packages/fleet-api/src/db/client';
import { readServerEnv } from '../packages/fleet-api/src/env';

const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 1023 && port <= 65535);
const env = readServerEnv();
const db = createDb({ url: env.databaseUrl, prepare: env.databasePrepare });
const origin = `http://127.0.0.1:${port}`;
const request = (path: string, authenticated = true) =>
  fetch(`${origin}${path}`, {
    redirect: 'manual',
    headers: authenticated ? { Authorization: `Bearer ${env.adminToken}` } : {},
    signal: AbortSignal.timeout(15000),
  });
try {
  assert.equal((await request('/health', false)).status, 200);
  assert.equal((await request('/v1/nodes', false)).status, 401);
  const response = await request('/v1/nodes');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Fleet-Data-Source'), 'managed');
  const result = (await response.json()) as { nodes: { id: string }[] };
  const rows = await db<
    { id: string }[]
  >`select id from fleet.nodes order by id`;
  assert.deepEqual(
    result.nodes.map((node) => node.id).sort(),
    rows.map((row) => String(row['id'])).sort()
  );
  const page = await request('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /LIVE FLEET DATA/);
  assert.doesNotMatch(html, /LOCAL DEMO/);
  console.log(
    `PASS local fleet: ${rows.length} managed nodes match the database; dashboard authenticated; anonymous API access rejected. Read-only verification.`
  );
} finally {
  await db.close();
}
