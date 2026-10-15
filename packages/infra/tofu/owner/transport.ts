/** Provider transport, not a controller: only a reviewed OpenTofu apply gets a lease. */
import { timingSafeEqual } from 'node:crypto';
import type { HealthContext } from '../../lib/health/context.js';
import { asRecord } from '../../lib/health/context.js';
import { digest } from '../../lib/domains/files.js';
import {
  normalizeOperation,
  operationId,
  ownerReceipt,
  type OwnerOperation,
} from './operation.js';

export type OwnerApply = (
  ctx: HealthContext,
  operation: OwnerOperation,
  authorized: () => boolean
) => Promise<Record<string, unknown>>;

export function startOwnerTransport(
  ctx: HealthContext,
  input: OwnerOperation,
  apply: OwnerApply
) {
  const operation = normalizeOperation(input);
  const id = operationId(operation);
  const token = crypto.randomUUID() + crypto.randomUUID();
  let lease = false;
  let busy = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    maxRequestBodySize: 8192,
    async fetch(request) {
      const supplied = request.headers.get('authorization') ?? '';
      const expected = `Bearer ${token}`;
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        return new Response(null, { status: 401 });
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === `/operations/${id}`) {
        const receipt = ownerReceipt(ctx.repoRoot, operation);
        return receipt
          ? Response.json(receipt)
          : new Response(null, { status: 404 });
      }
      if (request.method !== 'POST' || path !== '/operations')
        return new Response(null, { status: 405 });
      if (!lease || busy) return new Response(null, { status: 403 });
      let body: Record<string, unknown>;
      try {
        body = asRecord(await request.json());
      } catch {
        return new Response(null, { status: 400 });
      }
      try {
        if (
          Object.keys(body).sort().join(',') !==
            'action,domain,id,nameservers' ||
          body.id !== id ||
          digest(normalizeOperation(body as unknown as OwnerOperation)) !==
            digest(operation)
        )
          return new Response(null, { status: 400 });
      } catch {
        return new Response(null, { status: 400 });
      }
      busy = true;
      try {
        const existing = ownerReceipt(ctx.repoRoot, operation);
        return Response.json(
          existing ?? (await apply(ctx, operation, () => lease))
        );
      } catch {
        return Response.json(
          {
            id,
            status: 'blocked',
            error:
              'Owner operation was not verified; inspect private evidence and preserve the native intent',
          },
          { status: 409 }
        );
      } finally {
        busy = false;
      }
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    token,
    async withApplyLease<T>(run: () => Promise<T>): Promise<T> {
      if (lease) throw new Error('Owner apply lease is already active');
      lease = true;
      try {
        return await run();
      } finally {
        lease = false;
      }
    },
    close: () => {
      lease = false;
      server.stop(true);
    },
  };
}
