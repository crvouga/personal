/**
 * Everything a health check may touch, behind injectable ports.
 *
 * Checks are read-only: public probes, Vault and GitHub reads, object listing,
 * `SELECT 1`, and `tofu plan`. Nothing here creates, updates or deletes
 * infrastructure; OpenTofu remains the only manager.
 */
import type { InfraConfig } from "../schema.js";

export type DnsPort = {
  readonly resolve4: (name: string) => Promise<readonly string[]>;
  readonly resolveCname: (name: string) => Promise<readonly string[]>;
  readonly resolveNs: (name: string) => Promise<readonly string[]>;
  readonly resolveTxt: (name: string) => Promise<readonly string[]>;
  readonly resolveMx: (name: string) => Promise<readonly { exchange: string; priority: number }[]>;
};

export type Certificate = {
  readonly validTo: Date;
  readonly authorized: boolean;
  readonly error?: string;
};

export type BucketAccess = {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
};

export type CommandResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type CommandOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
};

export type KvDocument = Readonly<Record<string, string>>;

/**
 * A KV read either yields the document or the reason dependent checks cannot run.
 * `unverifiable` is true when no usable credential reached Vault, as opposed to
 * Vault answering that the document is missing or broken.
 */
export type KvRead =
  | { readonly ok: true; readonly data: KvDocument }
  | { readonly ok: false; readonly reason: string; readonly unverifiable: boolean };

export type HealthOptions = {
  /** Per-attempt timeout for an always-on endpoint. */
  readonly timeoutMs: number;
  /** Per-attempt timeout for a service Railway may have put to sleep. */
  readonly coldStartTimeoutMs: number;
  readonly retries: number;
  readonly retryDelayMs: number;
  /** Warn when a certificate expires within this many days. */
  readonly certificateWarnDays: number;
  /** Run `tofu plan` against every initialized root. */
  readonly drift: boolean;
};

export type HealthContext = {
  readonly config: InfraConfig;
  readonly repoRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly options: HealthOptions;
  readonly now: () => Date;
  readonly fetch: typeof fetch;
  readonly dns: DnsPort;
  readonly certificate: (hostname: string) => Promise<Certificate>;
  /** Object keys in a bucket, at most `maxKeys`. */
  readonly listBucket: (access: BucketAccess, maxKeys: number) => Promise<readonly string[]>;
  /** Runs `SELECT 1`; rejects with a credential-free message. */
  readonly sqlPing: (url: string) => Promise<void>;
  readonly run: (command: string, args: readonly string[], options?: CommandOptions) => Promise<CommandResult>;
  readonly fileExists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  readonly vaultToken: () => string | undefined;
  readonly githubToken: () => string | undefined;
  /** Memoized read of `<mount>/data/<project>/<config>`. */
  readonly kv: (config: string) => Promise<KvRead>;
};

export const DEFAULT_HEALTH_OPTIONS: HealthOptions = {
  timeoutMs: 15_000,
  coldStartTimeoutMs: 45_000,
  retries: 2,
  retryDelayMs: 3_000,
  certificateWarnDays: 14,
  drift: false,
};

/** Runs `task` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && !err.message.includes(code) ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

export type JsonResponse = { readonly status: number; readonly body: unknown };

/** GET returning parsed JSON when the body is JSON; network errors reject. */
export async function getJson(
  ctx: Pick<HealthContext, "fetch" | "options">,
  url: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<JsonResponse> {
  const res = await ctx.fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(ctx.options.timeoutMs),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, body: undefined };
  }
}

export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asStrings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
