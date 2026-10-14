import { isIP } from 'node:net';
import { asRecord } from '../health/context.js';
import { normalizeName, type DnsRecord } from './model.js';

const TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'CAA', 'SRV']);

/** Refuse unsupported records instead of silently losing them in generated IaC. */
export function parseRecords(value: unknown, domain: string): DnsRecord[] {
  if (!Array.isArray(value)) throw new Error('A complete record array is required');
  return value.map((item): DnsRecord => {
    const row = asRecord(item);
    if (row.private_routing === true) throw new Error('Private routing records need an explicit provider mapping before migration');
    const name = normalizeName(String(row.name ?? '').replace(/^@$/, domain));
    const type = String(row.type ?? '').toUpperCase();
    if (!(name === domain || name.endsWith(`.${domain}`)) || /\s/.test(name)) throw new Error(`Record outside ${domain}`);
    if (!TYPES.has(type)) throw new Error(`${name}: ${type} needs an explicit provider mapping and probe before migration`);
    if (name === domain && type === 'NS') throw new Error('Exclude provider-owned apex NS/SOA; retain child NS and glue');
    const ttl = Number(row.ttl);
    if (!Number.isInteger(ttl) || !(ttl === 1 || (ttl >= 60 && ttl <= 86400))) throw new Error(`${name}: invalid TTL`);
    if (typeof row.proxied !== 'boolean') throw new Error(`${name}: explicit proxied boolean required`);
    if (row.proxied && !['A', 'AAAA', 'CNAME'].includes(type)) throw new Error(`${name}: cannot proxy ${type}`);
    const data = Object.fromEntries(Object.entries(asRecord(row.data)).filter(([, value]) => value !== null && value !== undefined));
    if (Object.values(data).some((v) => typeof v !== 'string' && typeof v !== 'number')) throw new Error(`${name}: invalid data`);
    const settings = Object.fromEntries(Object.entries(asRecord(row.settings)).filter(([, value]) => value !== null && value !== undefined));
    if (Object.values(settings).some((v) => typeof v !== 'boolean')) throw new Error(`${name}: invalid record settings`);
    const record: DnsRecord = {
      name, type, ttl, proxied: row.proxied,
      ...(typeof row.id === 'string' ? { id: row.id } : {}),
      ...(typeof row.content === 'string' ? { content: row.content } : {}),
      ...(Object.keys(data).length ? { data: data as Record<string, string | number> } : {}),
      ...(typeof row.priority === 'number' ? { priority: row.priority } : {}),
      ...(Object.keys(settings).length ? { settings: settings as Record<string, boolean> } : {}),
    };
    if (type === 'A' && isIP(record.content ?? '') !== 4) throw new Error(`${name}: invalid IPv4 address`);
    if (type === 'AAAA' && isIP(record.content ?? '') !== 6) throw new Error(`${name}: invalid IPv6 address`);
    if (type === 'MX' && (!Number.isInteger(record.priority) || record.priority! < 0 || record.priority! > 65535)) {
      throw new Error(`${name}: MX priority required`);
    }
    rdata(record); // Also validates structured records.
    return record;
  });
}

export function rdata(record: DnsRecord): string {
  const { type, data = {}, content } = record;
  if (type === 'CAA' && Object.keys(data).length) {
    if (data.flags === undefined || typeof data.tag !== 'string' || typeof data.value !== 'string') throw new Error('Invalid CAA data');
    return `${data.flags} ${data.tag.toLowerCase()} ${JSON.stringify(data.value)}`;
  }
  if (type === 'SRV' && Object.keys(data).length) {
    if (['priority', 'weight', 'port', 'target'].some((key) => data[key] === undefined)) throw new Error('Invalid SRV data');
    return `${data.priority} ${data.weight} ${data.port} ${normalizeName(String(data.target))}`;
  }
  if (content === undefined) throw new Error(`${record.name}: ${type} content required`);
  if (type === 'MX') return `${record.priority} ${normalizeName(content)}`;
  if (['NS', 'PTR', 'CNAME'].includes(type)) return normalizeName(content);
  if (type === 'AAAA') return new URL(`http://[${content}]/`).hostname.toLowerCase();
  if (type === 'TXT' && content.startsWith('"')) return txtValue(content);
  if (type === 'CAA') return answerData(type, content);
  return content;
}

/** DNS TXT chunks form one value. Case, spaces and escaped bytes are significant. */
export function txtValue(value: string): string {
  const chunks = value.match(/"(?:\\.|[^"\\])*"/g);
  if (!chunks || chunks.join(' ').replace(/\s/g, '') !== value.replace(/\s/g, '')) throw new Error('Invalid TXT presentation');
  return chunks.map((chunk) => chunk.slice(1, -1).replace(/\\(\d{3}|.)/g, (_, char: string) =>
    /^\d{3}$/.test(char) ? String.fromCharCode(Number(char)) : char)).join('');
}

export function answerData(type: string, value: string): string {
  if (type === 'TXT') return txtValue(value);
  if (['NS', 'PTR', 'CNAME'].includes(type)) return normalizeName(value);
  if (type === 'AAAA') return new URL(`http://[${value}]/`).hostname.toLowerCase();
  if (['MX', 'SRV'].includes(type)) return value.trim().split(/\s+/).map((part, i, all) =>
    i === all.length - 1 ? normalizeName(part) : part).join(' ');
  if (type === 'CAA') {
    const match = /^(\d+)\s+(\S+)\s+(.+)$/.exec(value);
    if (!match) throw new Error('Invalid CAA answer');
    return `${Number(match[1])} ${match[2].toLowerCase()} ${JSON.stringify(txtValue(match[3]))}`;
  }
  return value;
}

export function recordKey(record: DnsRecord): string {
  return `${normalizeName(record.name)} ${record.type} ${rdata(record)}`;
}

export function settingsKey(record: DnsRecord): string {
  const settings = Object.entries(record.settings ?? {}).filter(([, value]) => value !== false).sort();
  return JSON.stringify([recordKey(record), record.ttl, record.proxied, settings]);
}

/** Full multiset comparison: missing, additional, changed TTL/proxy/settings all block. */
export function parity(before: readonly DnsRecord[], after: readonly DnsRecord[]): string[] {
  const remaining = after.map(settingsKey);
  const issues: string[] = [];
  for (const record of before) {
    const i = remaining.indexOf(settingsKey(record));
    if (i < 0) issues.push(`missing/changed ${record.type} ${record.name}`);
    else remaining.splice(i, 1);
  }
  if (remaining.length) issues.push(`${remaining.length} additional/changed record(s)`);
  return issues;
}
