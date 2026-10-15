import type { EventQuery } from '../store';
import type { EventInput, EventRow } from '../types';

import type { Db } from './client';
import { toEventRow } from './rows';

/** An event as written by the store itself. Fields the database defaults are omitted. */
export interface NewEvent {
  readonly nodeId: string | null;
  readonly nodeLabel: string | null;
  readonly kind: string;
  readonly severity: EventInput['severity'];
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export async function insertEvent(
  db: Db,
  event: NewEvent,
  at: Date | null
): Promise<void> {
  const data = JSON.stringify(event.data ?? {});
  await db`
    insert into fleet.events (at, node_id, node_label, kind, severity, message, data)
    values (
      coalesce(${at?.toISOString() ?? null}::timestamptz, now()),
      ${event.nodeId}::text,
      ${event.nodeLabel}::text,
      ${event.kind}::text,
      ${event.severity}::text,
      ${event.message}::text,
      ${data}::text::jsonb
    )`;
}

/** Inserts several events for one node in order, in a single statement. */
export async function insertEvents(
  db: Db,
  node: { readonly id: string; readonly label: string },
  events: readonly { kind: string; severity: string; message: string }[],
  at: Date
): Promise<void> {
  if (events.length === 0) return;
  const items = JSON.stringify(events);
  await db`
    insert into fleet.events (at, node_id, node_label, kind, severity, message)
    select ${at.toISOString()}::timestamptz, ${node.id}::text, ${node.label}::text,
           e.item->>'kind', e.item->>'severity', e.item->>'message'
    from jsonb_array_elements(${items}::text::jsonb) with ordinality as e(item, ord)
    order by e.ord`;
}

export async function selectEvents(
  db: Db,
  query: EventQuery
): Promise<EventRow[]> {
  const rows = await db`
    select * from fleet.events
    where (${query.nodeId ?? null}::text is null or node_id = ${query.nodeId ?? null}::text)
      and (${query.severity ?? null}::text is null
           or severity = ${query.severity ?? null}::text
           or (${query.severity ?? null}::text = 'warn' and severity = 'error'))
      and (${query.beforeId ?? null}::bigint is null or id < ${query.beforeId ?? null}::bigint)
    order by id desc
    limit ${query.limit}::int`;
  return rows.map(toEventRow);
}
