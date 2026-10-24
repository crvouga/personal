import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import { imapServer } from './fixtures/imap-server.ts';
import { scanImapClient } from '../src/adapters/imap.ts';
import { sourceSchema } from '../src/domain/config.ts';
import { MemorySecrets } from '../src/testing/fakes.ts';
import { runtime } from '../src/adapters/runtime.ts';
import type { Evidence } from '../src/domain/model.ts';
import type { Scan } from '../src/adapters/discovery.ts';
async function collect(scan: Scan) {
  const evidence: Evidence[] = [];
  for (;;) {
    const next = await scan.next();
    if (next.done) return { evidence, result: next.value };
    evidence.push(next.value);
  }
}
void test('real IMAP protocol client uses read-only mailbox selection and resumes bounded UID scans', async () => {
  const server = await imapServer();
  const source = sourceSchema.parse({
    id: 'imap',
    kind: 'imap',
    maxMessages: 1,
  });
  const context = { secrets: new MemorySecrets(), vault: null, runtime, fetch };
  const client = () =>
    new ImapFlow({
      host: '127.0.0.1',
      port: server.port,
      secure: false,
      doSTARTTLS: false,
      auth: {
        user: 'synthetic',
        pass: 'SYNTHETIC_PASSWORD',
        loginMethod: 'LOGIN',
      },
      logger: false,
      socketTimeout: 5000,
    });
  try {
    let cursor: string | null = null;
    const ids = new Set<string>();
    for (let scan = 0; scan < 3; scan++) {
      const batch = await collect(
        scanImapClient({ source, context, cursor, client: client() })
      );
      for (const evidence of batch.evidence) ids.add(evidence.id);
      cursor = batch.result.cursor;
      assert.equal(batch.result.complete, scan === 2);
      assert.equal(JSON.stringify(batch).includes('SUBJECT_CANARY'), false);
    }
    assert.equal(ids.size, 3);
    assert.ok(server.commands.includes('EXAMINE'));
    assert.equal(server.commands.includes('SELECT'), false);
    server.resetValidity();
    const reset = await collect(
      scanImapClient({ source, context, cursor, client: client() })
    );
    assert.equal(reset.evidence.length, 1);
    assert.ok(ids.has(reset.evidence[0]!.id));
    server.reject();
    await assert.rejects(
      collect(
        scanImapClient({ source, context, cursor: null, client: client() })
      ),
      /not-authenticated/
    );
  } finally {
    server.close();
  }
});
