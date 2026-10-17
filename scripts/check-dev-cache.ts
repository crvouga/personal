import assert from 'node:assert/strict';

const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 1023 && port <= 65535);
const token = process.env['TURBO_TOKEN'];
assert.ok(token, 'TURBO_TOKEN must be present in the dev Vault scope');
const headers = { Authorization: `Bearer ${token}` };
const origin = `http://localhost:${port}`;
const status = await fetch(`${origin}/v8/artifacts/status`, {
  headers,
  signal: AbortSignal.timeout(10000),
});
assert.equal(status.status, 200, 'local cache must accept the dev Vault token');
assert.deepEqual(await status.json(), { status: 'enabled' });
const miss = await fetch(
  `${origin}/v8/artifacts/cold-check-${crypto.randomUUID()}`,
  { method: 'HEAD', headers, signal: AbortSignal.timeout(10000) }
);
assert.equal(
  miss.status,
  404,
  'local cache must reach R2 for a read-only cache miss'
);
console.log('PASS remote-cache: authenticated request and read-only R2 access');
