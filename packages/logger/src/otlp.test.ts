import { expect, test } from 'bun:test';
import { createOtlpExporter, parsePairs } from './otlp';

type Sent = { url: string; init: RequestInit };

function recorder() {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(null, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

const env = {
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.test/otlp/',
  OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20abc123',
  OTEL_SERVICE_NAME: 'auth-relay',
  OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=production',
};

test('without an endpoint nothing is sent', async () => {
  const { sent, fetch } = recorder();
  const exporter = createOtlpExporter('svc', { env: {}, fetch });
  exporter.export('info', { msg: 'hello' });
  await exporter.flush();
  expect(sent).toHaveLength(0);
});

test('OTEL_SDK_DISABLED turns export off', async () => {
  const { sent, fetch } = recorder();
  const exporter = createOtlpExporter('svc', {
    env: { ...env, OTEL_SDK_DISABLED: 'true' },
    fetch,
  });
  exporter.export('info', { msg: 'hello' });
  await exporter.flush();
  expect(sent).toHaveLength(0);
});

test('records are posted as OTLP JSON with resource, severity and trace correlation', async () => {
  const { sent, fetch } = recorder();
  const exporter = createOtlpExporter('fallback', { env, fetch });
  exporter.export('error', {
    msg: 'operation_failed',
    time: '2026-11-09T00:00:00.000Z',
    level: 'error',
    traceId: '0123456789abcdef0123456789abcdef',
    requestId: 'r-1',
    status: 503,
  });
  await exporter.flush();
  expect(sent).toHaveLength(1);
  const [{ url, init }] = sent as [Sent];
  expect(url).toBe('https://otlp.example.test/otlp/v1/logs');
  expect((init.headers as Record<string, string>)['Authorization']).toBe(
    'Basic abc123'
  );
  const body = JSON.parse(String(init.body));
  const resource = body.resourceLogs[0].resource.attributes;
  expect(resource).toContainEqual({
    key: 'service.name',
    value: { stringValue: 'auth-relay' },
  });
  expect(resource).toContainEqual({
    key: 'deployment.environment.name',
    value: { stringValue: 'production' },
  });
  const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
  expect(record.severityText).toBe('ERROR');
  expect(record.severityNumber).toBe(17);
  expect(record.body).toEqual({ stringValue: 'operation_failed' });
  expect(record.traceId).toBe('0123456789abcdef0123456789abcdef');
  expect(record.timeUnixNano).toBe(
    `${BigInt(Date.parse('2026-11-09T00:00:00.000Z')) * 1_000_000n}`
  );
  expect(record.attributes).toContainEqual({
    key: 'status',
    value: { intValue: '503' },
  });
  expect(record.attributes.map((a: { key: string }) => a.key)).not.toContain(
    'msg'
  );
});

test('a full queue drops records instead of growing without bound', async () => {
  const { sent, fetch } = recorder();
  const exporter = createOtlpExporter('svc', {
    env,
    fetch,
    maxQueue: 2,
    maxBatch: 10,
  });
  for (let i = 0; i < 5; i++) exporter.export('info', { msg: `m${i}` });
  await exporter.flush();
  const body = JSON.parse(String(sent[0]?.init.body));
  expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2);
});

test('export failures never throw into the caller', async () => {
  const failing = (async () => {
    throw new Error('network down');
  }) as unknown as typeof globalThis.fetch;
  const exporter = createOtlpExporter('svc', { env, fetch: failing });
  exporter.export('info', { msg: 'x' });
  await expect(exporter.flush()).resolves.toBeUndefined();
});

test('header pairs are percent-decoded', () => {
  expect(parsePairs('a=b%20c, d = e ,bad')).toEqual({ a: 'b c', d: 'e' });
});
