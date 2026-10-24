import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceSchema } from '../domain/config.ts';
import { scanCsv } from './exports.ts';
import { scanArchive } from './archives.ts';
import { scanGmail } from './gmail.ts';
import { scanMicrosoft } from './microsoft.ts';
import { MemorySecrets } from '../testing/fakes.ts';
import type { DiscoveryContext, Scan } from './discovery.ts';
import type { Evidence } from '../domain/model.ts';
function context(fetchFn: typeof fetch = fetch): DiscoveryContext {
  return {
    vault: null,
    secrets: new MemorySecrets(),
    fetch: fetchFn,
    runtime: {
      now: () => '2026-01-01',
      id: () => 'fixture',
      password: () => 'SYNTHETIC',
    },
  };
}
async function collect(scan: Scan) {
  const evidence: Evidence[] = [];
  for (;;) {
    const next = await scan.next();
    if (next.done) return { evidence, result: next.value };
    evidence.push(next.value);
  }
}
test('quoted Chrome and Apple CSV secrets stay in encrypted-port candidates', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-csv-'));
  const path = join(directory, 'export.csv');
  writeFileSync(
    path,
    'name,url,username,password,note\n"A, Inc",https://service.test,alice,"PASS,WORD","line 1\nline 2"\n'
  );
  const ctx = context();
  const source = sourceSchema.parse({ id: 'csv', kind: 'csv', path });
  try {
    const first = await collect(scanCsv(source, ctx));
    const second = await collect(scanCsv(source, ctx));
    expect(first.evidence[0]?.id).toBe(second.evidence[0]?.id);
    expect(first.result.complete).toBe(true);
    expect(JSON.stringify(first)).not.toContain('PASS,WORD');
    const value = await ctx.secrets.getRequired(
      first.evidence[0]!.candidateRef!
    );
    expect(value.readSecretValue()).toContain('PASS,WORD');
    writeFileSync(
      path,
      'name,url,username,password,note\n"A, Inc",https://service.test,alice,DIFFERENT,notes\n'
    );
    await expect(collect(scanCsv(source, ctx))).rejects.toThrow('conflict');
  } finally {
    rmSync(directory, { recursive: true });
  }
});
test('streaming MBOX ignores huge bodies and rejects oversized malformed headers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-mbox-'));
  const path = join(directory, 'archive.mbox');
  const source = sourceSchema.parse({ id: 'mail', kind: 'mbox', path });
  try {
    writeFileSync(
      path,
      'From sender@example.test Sat Jan 1 00:00:00 2026\nFrom: security@vendor.test\nSubject: Welcome SECRET\n\n' +
        'x'.repeat(4 * 1024 * 1024) +
        '\nFrom sender@example.test Sat Jan 1 00:00:00 2026\nFrom: security@vendor.test\nSubject: Password reset SECRET\n\nignored\n'
    );
    const result = await collect(scanArchive(source, context()));
    expect(result.result.scanned).toBe(2);
    expect(result.evidence).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    writeFileSync(
      path,
      'From sender@example.test Sat Jan 1 00:00:00 2026\nSubject: ' +
        'x'.repeat(100_000) +
        '\n\n'
    );
    await expect(collect(scanArchive(source, context()))).rejects.toThrow(
      'invalid-input'
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});
test('Gmail paginates metadata search and expires history into full resync', async () => {
  const requests: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/profile'))
      return Response.json({ historyId: '100' });
    if (url.pathname.endsWith('/history'))
      return new Response('', { status: 404 });
    if (url.pathname.endsWith('/messages'))
      return Response.json(
        url.searchParams.has('pageToken')
          ? { messages: [{ id: '2' }] }
          : { messages: [{ id: '1' }], nextPageToken: 'next' }
      );
    return Response.json({
      id: url.pathname.split('/').pop(),
      internalDate: String(Date.parse('2025-01-01')),
      payload: {
        headers: [
          { name: 'From', value: 'security@vendor.test' },
          { name: 'Subject', value: 'Welcome SECRET' },
        ],
      },
    });
  }) as typeof fetch;
  const ctx = context(fakeFetch);
  await ctx.secrets.setSecret(
    'token',
    JSON.stringify({ accessToken: 'TOKEN_CANARY' })
  );
  const source = sourceSchema.parse({
    id: 'gmail',
    kind: 'gmail',
    tokenRef: 'token',
  });
  const result = await collect(scanGmail(source, ctx, 'expired'));
  expect(result.evidence).toHaveLength(2);
  expect(result.result.cursor).toBe('100');
  expect(requests.some((r) => r.includes('pageToken=next'))).toBe(true);
  expect(requests.some((r) => r.includes('format=metadata'))).toBe(true);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(JSON.stringify(result)).not.toContain('TOKEN_CANARY');
});
test('Microsoft follows exact nextLink and rejects cross-origin credential destinations', async () => {
  const requests: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.href);
    if (url.pathname.includes('mailFolders'))
      return Response.json({ id: url.pathname.split('/').pop() });
    return Response.json({
      value: [{ id: '1', subject: 'Welcome SECRET' }],
      '@odata.nextLink': 'https://evil.test/steal',
    });
  }) as typeof fetch;
  const ctx = context(fakeFetch);
  await ctx.secrets.setSecret(
    'token',
    JSON.stringify({ accessToken: 'TOKEN_CANARY' })
  );
  const source = sourceSchema.parse({
    id: 'graph',
    kind: 'microsoft',
    tokenRef: 'token',
  });
  await expect(collect(scanMicrosoft(source, ctx))).rejects.toThrow(
    'invalid-input'
  );
  expect(requests.some((r) => r.includes('evil.test'))).toBe(false);
});

test('bounded Gmail and Graph scans resume from durable message offsets', async () => {
  const gmailFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/profile'))
      return Response.json({ historyId: '100' });
    if (url.pathname.endsWith('/messages'))
      return Response.json({
        messages: [{ id: '1' }, { id: '2' }, { id: '3' }],
      });
    return Response.json({
      id: url.pathname.split('/').pop(),
      internalDate: String(Date.parse('2025-01-01')),
      payload: { headers: [{ name: 'Subject', value: 'Welcome' }] },
    });
  }) as typeof fetch;
  const ctx = context(gmailFetch);
  await ctx.secrets.setSecret(
    'token',
    JSON.stringify({ accessToken: 'SYNTHETIC' })
  );
  const source = sourceSchema.parse({
    id: 'mail',
    kind: 'gmail',
    tokenRef: 'token',
    maxMessages: 1,
  });
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let iteration = 0; iteration < 3; iteration++) {
    const batch = await collect(scanGmail(source, ctx, cursor));
    for (const evidence of batch.evidence) ids.add(evidence.id);
    cursor = batch.result.cursor;
    expect(batch.result.complete).toBe(iteration === 2);
  }
  expect(ids.size).toBe(3);
  const graphFetch = (async () =>
    Response.json({
      value: [
        { id: '1', subject: 'Welcome' },
        { id: '2', subject: 'Welcome' },
      ],
    })) as unknown as typeof fetch;
  const graph = sourceSchema.parse({
    id: 'graph',
    kind: 'microsoft',
    tokenRef: 'token',
    maxMessages: 1,
    includeSpamTrash: true,
  });
  const first = await collect(
    scanMicrosoft(graph, { ...ctx, fetch: graphFetch })
  );
  const second = await collect(
    scanMicrosoft(graph, { ...ctx, fetch: graphFetch }, first.result.cursor)
  );
  expect(first.result.complete).toBe(false);
  expect(second.result.complete).toBe(true);
  expect(first.evidence[0]!.id).not.toBe(second.evidence[0]!.id);
});
