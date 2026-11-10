/**
 * Ships redacted log records to the shared OpenTelemetry (OTLP/HTTP JSON)
 * endpoint. Configured only by the standard OTEL_* environment variables that
 * the platform injects; without OTEL_EXPORTER_OTLP_ENDPOINT it does nothing.
 * Export never throws into the caller and never logs through the logger.
 */
type Env = Readonly<Record<string, string | undefined>>;
type Level = 'debug' | 'info' | 'warn' | 'error';
type AnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number };
type KeyValue = { key: string; value: AnyValue };
type LogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: AnyValue;
  attributes: KeyValue[];
  traceId?: string;
};

export interface OtlpExporter {
  export(level: Level, entry: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export interface OtlpOptions {
  env?: Env;
  fetch?: typeof fetch;
  intervalMs?: number;
  maxBatch?: number;
  maxQueue?: number;
}

const SEVERITY: Record<Level, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};
// Fields that become the record's own body, time and trace, not attributes.
const RECORD_FIELDS = new Set(['msg', 'time', 'level', 'traceId']);

/** `k1=v1,k2=v2` with percent-encoded values, as the OTEL spec defines. */
export function parsePairs(value: string | undefined): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const part of (value ?? '').split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    try {
      pairs[key] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      pairs[key] = part.slice(at + 1).trim();
    }
  }
  return pairs;
}

function anyValue(value: unknown): AnyValue {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number' && Number.isInteger(value))
    return { intValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  return { stringValue: JSON.stringify(value) ?? String(value) };
}

function attributes(fields: Record<string, unknown>): KeyValue[] {
  return Object.entries(fields)
    .filter(([key, value]) => value !== undefined && !RECORD_FIELDS.has(key))
    .map(([key, value]) => ({ key, value: anyValue(value) }));
}

function logsUrl(env: Env): string | undefined {
  const specific = env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']?.trim();
  if (specific) return specific;
  const base = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  return base ? `${base.replace(/\/+$/, '')}/v1/logs` : undefined;
}

function toRecord(level: Level, entry: Record<string, unknown>): LogRecord {
  const time = Date.parse(String(entry['time'] ?? '')) || Date.now();
  const traceId = entry['traceId'];
  return {
    timeUnixNano: `${BigInt(time) * 1_000_000n}`,
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: { stringValue: String(entry['msg'] ?? '') },
    attributes: attributes(entry),
    ...(typeof traceId === 'string' && /^[0-9a-f]{32}$/.test(traceId)
      ? { traceId }
      : {}),
  };
}

function resource(env: Env, fallbackName: string): KeyValue[] {
  return attributes({
    ...parsePairs(env['OTEL_RESOURCE_ATTRIBUTES']),
    'service.name': env['OTEL_SERVICE_NAME']?.trim() || fallbackName,
    'deployment.id': env['RAILWAY_DEPLOYMENT_ID'],
    'service.instance.id': env['RAILWAY_REPLICA_ID'],
    'service.version': env['RAILWAY_GIT_COMMIT_SHA'],
  });
}

const NOOP: OtlpExporter = { export: () => {}, flush: async () => {} };

type Target = { url: string; headers: Record<string, string> };

/** Where and how to send, or nothing when export is not configured. */
function target(env: Env): Target | undefined {
  const url = logsUrl(env);
  if (!url || env['OTEL_SDK_DISABLED']?.trim().toLowerCase() === 'true')
    return undefined;
  const pairs =
    env['OTEL_EXPORTER_OTLP_LOGS_HEADERS'] ?? env['OTEL_EXPORTER_OTLP_HEADERS'];
  return {
    url,
    headers: { ...parsePairs(pairs), 'Content-Type': 'application/json' },
  };
}

/** Posts one batch; a failure is reported at most once a minute, never thrown. */
function createSender(
  to: Target,
  scope: KeyValue[],
  send: typeof fetch,
  dropped: () => number
): (batch: LogRecord[]) => Promise<void> {
  let reported = 0;
  const warn = (reason: string): void => {
    if (Date.now() - reported < 60_000) return;
    reported = Date.now();
    // Written directly: the export path must never recurse into the logger.
    process.stderr.write(
      `${JSON.stringify({ level: 'warn', msg: 'otlp_export_failed', reason, dropped: dropped() })}\n`
    );
  };
  return async (batch) => {
    const body = JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: scope },
          scopeLogs: [{ scope: { name: '@pkgs/logger' }, logRecords: batch }],
        },
      ],
    });
    try {
      const response = await send(to.url, {
        method: 'POST',
        headers: to.headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) warn(`HTTP ${response.status}`);
    } catch (error) {
      warn(error instanceof Error ? error.name : 'request failed');
    }
  };
}

export function createOtlpExporter(
  serviceName: string,
  options: OtlpOptions = {}
): OtlpExporter {
  const env = options.env ?? process.env;
  const to = target(env);
  if (!to) return NOOP;
  const maxBatch = options.maxBatch ?? 200;
  const maxQueue = options.maxQueue ?? 2000;
  let queue: LogRecord[] = [];
  let dropped = 0;
  let inFlight: Promise<void> = Promise.resolve();
  const post = createSender(
    to,
    resource(env, serviceName),
    options.fetch ?? fetch,
    () => dropped
  );

  function flush(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.slice(0, maxBatch);
      queue = queue.slice(maxBatch);
      inFlight = inFlight.then(() => post(batch));
    }
    return inFlight;
  }

  const timer = setInterval(() => void flush(), options.intervalMs ?? 2000);
  timer.unref?.();
  process.once?.('beforeExit', () => void flush());

  return {
    export(level, entry) {
      if (queue.length >= maxQueue) {
        dropped += 1;
        return;
      }
      queue.push(toRecord(level, entry));
      if (queue.length >= maxBatch) void flush();
    },
    flush,
  };
}
