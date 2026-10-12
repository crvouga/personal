/** Real implementations of the health-check ports. */
import { spawn, spawnSync } from "node:child_process";
import { resolve4, resolveCname, resolveMx, resolveNs, resolveTxt } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { assert } from "@pkgs/assert";
import type { InfraConfig } from "../schema.js";
import { vaultAddr, vaultConfigOrDefault } from "../services.js";
import {
  asRecord,
  errorMessage,
  getJson,
  type BucketAccess,
  type Certificate,
  type CommandOptions,
  type CommandResult,
  type DnsPort,
  type HealthContext,
  type HealthOptions,
  type KvRead,
} from "./context.js";

const TRANSIENT_DNS_CODES = new Set(["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED", "EAI_AGAIN"]);

/** One retry for resolver hiccups; a missing record is an answer, not a hiccup. */
async function resolveWithRetry<T>(resolve: () => Promise<T>): Promise<T> {
  try {
    return await resolve();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code !== "string" || !TRANSIENT_DNS_CODES.has(code)) throw err;
    return resolve();
  }
}

const dns: DnsPort = {
  resolve4: (name) => resolveWithRetry(() => resolve4(name)),
  resolveCname: (name) => resolveWithRetry(() => resolveCname(name)),
  resolveNs: (name) => resolveWithRetry(() => resolveNs(name)),
  resolveTxt: async (name) => (await resolveWithRetry(() => resolveTxt(name))).map((chunks) => chunks.join("")),
  resolveMx: (name) => resolveWithRetry(() => resolveMx(name)),
};

function certificate(hostname: string, timeoutMs: number): Promise<Certificate> {
  assert.nonEmptyString(hostname, "certificate hostname must be non-empty");
  return new Promise((resolve, reject) => {
    // Inspect an untrusted chain too, so an expired certificate reports its date.
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        const peer = socket.getPeerCertificate();
        const error = socket.authorizationError;
        socket.end();
        if (!peer?.valid_to) return reject(new Error("no peer certificate"));
        resolve({
          validTo: new Date(peer.valid_to),
          authorized: socket.authorized,
          ...(error ? { error: String(error) } : {}),
        });
      },
    );
    socket.on("timeout", () => socket.destroy(new Error(`TLS handshake timed out after ${timeoutMs}ms`)));
    socket.on("error", reject);
  });
}

async function listBucket(access: BucketAccess, maxKeys: number): Promise<readonly string[]> {
  assert.nonEmptyString(access.bucket, "bucket must be non-empty");
  const client = new Bun.S3Client({
    accessKeyId: access.accessKeyId,
    secretAccessKey: access.secretAccessKey,
    bucket: access.bucket,
    endpoint: access.endpoint,
    region: access.region,
  });
  const listing = await client.list({ maxKeys });
  return (listing.contents ?? []).map((object) => object.key);
}

/**
 * Connection errors can echo the URL. The report may be public (a CI job
 * summary), so its credentials and its endpoint never reach it.
 */
function redactUrl(message: string, url: string): string {
  let redacted = message.split(url).join("<database url>");
  try {
    const { password, username, hostname } = new URL(url);
    for (const part of [password, decodeURIComponent(password), hostname, username]) {
      if (part) redacted = redacted.split(part).join("<redacted>");
    }
  } catch {
    /* Not a parseable URL; the literal replacement above is all we can do. */
  }
  return redacted;
}

async function sqlPing(url: string, timeoutMs: number): Promise<void> {
  assert.nonEmptyString(url, "database url must be non-empty");
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const sql = new Bun.SQL({ url, max: 1, connectionTimeout: seconds, idleTimeout: seconds });
  try {
    await sql`select 1`;
  } catch (err) {
    throw new Error(redactUrl(errorMessage(err), url));
  } finally {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

function run(command: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
  assert.nonEmptyString(command, "command must be non-empty");
  return new Promise((resolve) => {
    // An explicitly undefined variable is removed from the child's environment.
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...options.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const child = spawn(command, [...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: `${stderr}${errorMessage(err)}` }));
    child.on("close", (code, signal) =>
      resolve({ code: code ?? 1, stdout, stderr: signal ? `${stderr}terminated by ${signal}` : stderr }),
    );
  });
}

function readVaultToken(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const fromEnv = env["VAULT_TOKEN"]?.trim();
  if (fromEnv) return fromEnv;
  const file = join(homedir(), ".vault-token");
  if (!existsSync(file)) return undefined;
  return readFileSync(file, "utf8").trim() || undefined;
}

function readGithubToken(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const fromEnv = env["GH_TOKEN"]?.trim() || env["GITHUB_TOKEN"]?.trim();
  if (fromEnv) return fromEnv;
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function memoize<T>(read: () => T): () => T {
  let cached: { readonly value: T } | undefined;
  return () => (cached ??= { value: read() }).value;
}

async function readKv(
  ctx: Pick<HealthContext, "fetch" | "options">,
  config: InfraConfig,
  token: string | undefined,
  kvConfig: string,
): Promise<KvRead> {
  if (!token) {
    return { ok: false, unverifiable: true, reason: "no Vault token (set VAULT_TOKEN or run `bun run vault:login`)" };
  }
  const { kv } = vaultConfigOrDefault(config);
  const path = `${kv.mount}/data/${kv.project}/${kvConfig}`;
  try {
    const res = await getJson(ctx, `${vaultAddr(config)}/v1/${path}`, { "X-Vault-Token": token });
    if (res.status !== 200) {
      return { ok: false, unverifiable: res.status === 403, reason: `Vault read of ${path} returned HTTP ${res.status}` };
    }
    const data = asRecord(asRecord(asRecord(res.body)["data"])["data"]);
    const strings = Object.fromEntries(
      Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    return { ok: true, data: strings };
  } catch (err) {
    return { ok: false, unverifiable: false, reason: `Vault read of ${path} failed: ${errorMessage(err)}` };
  }
}

export type ContextInput = {
  readonly config: InfraConfig;
  readonly repoRoot: string;
  readonly options: HealthOptions;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

export function createHealthContext(input: ContextInput): HealthContext {
  assert.record(input.config, "config must be a record");
  assert.nonEmptyString(input.repoRoot, "repo root must be non-empty");
  const env = input.env ?? process.env;
  const base = { fetch, options: input.options };
  const vaultToken = memoize(() => readVaultToken(env));
  const kvReads = new Map<string, Promise<KvRead>>();
  return {
    ...base,
    config: input.config,
    repoRoot: input.repoRoot,
    env,
    now: () => new Date(),
    dns,
    certificate: (hostname) => certificate(hostname, input.options.timeoutMs),
    listBucket,
    sqlPing: (url) => sqlPing(url, input.options.timeoutMs),
    run,
    fileExists: existsSync,
    readFile: (path) => readFileSync(path, "utf8"),
    vaultToken,
    githubToken: memoize(() => readGithubToken(env)),
    kv: (kvConfig) => {
      const cached = kvReads.get(kvConfig);
      if (cached) return cached;
      const read = readKv(base, input.config, vaultToken(), kvConfig);
      kvReads.set(kvConfig, read);
      return read;
    },
  };
}
