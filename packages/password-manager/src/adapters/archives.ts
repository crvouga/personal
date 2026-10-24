import { createReadStream } from 'node:fs';
import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
import { mailEvidence, parseHeaders } from './mail-evidence.ts';
import type { DiscoveryContext, Scan } from './discovery.ts';
import { fileProgress } from './file-cursor.ts';
const MAX_HEADER = 64 * 1024;
const MAX_LINE = 64 * 1024;
/** Stream byte lines, discarding oversized body lines without retaining them. */
async function* lines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  let pending = '';
  let dropping = false;
  try {
    for await (const chunk of stream) {
      const parts = (chunk as Buffer).toString('latin1').split('\n');
      for (let i = 0; i < parts.length; i++) {
        pending += parts[i] ?? '';
        if (pending.length > MAX_LINE) {
          pending = '';
          dropping = true;
        }
        if (i < parts.length - 1) {
          yield dropping
            ? '\u0000oversized-line'
            : Buffer.from(pending.replace(/\r$/, ''), 'latin1').toString(
                'utf8'
              );
          pending = '';
          dropping = false;
        }
      }
    }
    if (pending) yield pending;
  } finally {
    stream.destroy();
  }
}
async function* headers(source: SourceConfig): AsyncGenerator<string> {
  if (!source.path) throw new ManagerError('invalid-config');
  let header = '';
  let reading = source.kind === 'eml';
  let messages = 0;
  for await (const line of lines(source.path)) {
    if (isBoundary(source, line)) {
      if (reading && header) throw new ManagerError('invalid-input');
      reading = true;
      header = '';
      continue;
    }
    if (!reading) continue;
    if (line === '') {
      validateHeader(header);
      messages++;
      yield header;
      reading = false;
      header = '';
    } else header = appendHeader(header, line);
  }
  validateEnd(reading, header, messages);
}
function appendHeader(header: string, line: string): string {
  if (line === '\u0000oversized-line') throw new ManagerError('invalid-input');
  const result = header + line + '\r\n';
  if (result.length > MAX_HEADER) throw new ManagerError('invalid-input');
  return result;
}
export async function* scanArchive(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null = null
): Scan {
  if (!source.path) throw new ManagerError('invalid-config');
  const progress = await fileProgress(source.path, cursor);
  let scanned = 0;
  let index = 0;
  for await (const header of headers(source)) {
    if (index++ < progress.offset) continue;
    if (scanned >= source.maxMessages)
      return { cursor: progress.cursor(index - 1), complete: false, scanned };
    const mail = await parseHeaders(header, String(index));
    scanned++;
    const evidence = mailEvidence(source.id, mail, context.runtime.now());
    if (evidence) yield evidence;
  }
  await progress.unchanged();
  return { cursor: progress.cursor(index), complete: true, scanned };
}

function isBoundary(source: SourceConfig, line: string): boolean {
  return source.kind === 'mbox' && line.startsWith('From ');
}

function validateHeader(header: string): void {
  if (!/^(from|to|subject|date|message-id):/im.test(header))
    throw new ManagerError('invalid-input');
}
function validateEnd(reading: boolean, header: string, messages: number): void {
  if ((reading && header) || !messages) throw new ManagerError('invalid-input');
}
