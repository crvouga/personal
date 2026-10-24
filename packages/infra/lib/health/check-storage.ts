/**
 * Stateful backends: R2 buckets, PostgreSQL databases and the remote cache.
 * Credentials come from the Vault KV documents; without them every check skips.
 */
import type { ObjectStoreSpec, PostgresConfig } from "../schema.js";
import { asRecord, errorMessage, getJson, type HealthContext, type KvDocument, type KvRead } from "./context.js";
import { readSealStatus } from "./check-vault.js";
import { checkFleetCache } from './check-fleet-cache.js';
import { fail, pass, skip, type CheckResult } from "./report.js";

const CACHE_SERVICE_ID = "turborepo";
const DATABASE_SECRET = /(^|_)(DATABASE_URL|DB_CONNECTION_URI)$/;

/** No credential means the check cannot run; a document Vault cannot serve is a failure. */
function unavailable(name: string, doc: Extract<KvRead, { ok: false }>): CheckResult {
  return doc.unverifiable ? skip(name, doc.reason) : fail(name, doc.reason);
}

async function checkBucket(ctx: HealthContext, store: ObjectStoreSpec, kvConfig: string): Promise<CheckResult> {
  const name = `bucket ${store.bucket ?? store.id} (${kvConfig})`;
  const doc = await ctx.kv(kvConfig);
  if (!doc.ok) return unavailable(name, doc);
  const read = (key: string): string => doc.data[key]?.trim() ?? "";
  const access = {
    endpoint: read(store.endpoint_secret),
    region: read(store.region_secret),
    accessKeyId: read(store.access_key_secret),
    secretAccessKey: read(store.secret_key_secret),
    bucket: read(store.bucket_secret),
  };
  const unset = Object.entries(access).filter(([, value]) => !value).map(([field]) => field);
  if (unset.length > 0) return fail(name, `Vault ${kvConfig} is missing ${unset.join(", ")}`);
  if (store.bucket && access.bucket !== store.bucket) {
    return fail(name, `Vault ${kvConfig} points at bucket ${access.bucket}, inventory declares ${store.bucket}`);
  }
  try {
    await ctx.listBucket(access, 1);
    return pass(name, "credentials accepted; bucket lists");
  } catch (err) {
    return fail(name, `list failed: ${errorMessage(err)}`);
  }
}

/** The database is named by its secret only: the report can be public and the endpoint is not. */
async function checkDatabase(ctx: HealthContext, secret: string, doc: KvDocument): Promise<CheckResult> {
  const name = `database ${secret}`;
  const url = doc[secret]?.trim();
  if (!url) return fail(name, `Vault prd has no ${secret}`);
  const started = Date.now();
  try {
    await ctx.sqlPing(url);
    return pass(name, `answered SELECT 1 (${Date.now() - started}ms)`);
  } catch (err) {
    return fail(name, `connection failed: ${errorMessage(err)}`);
  }
}

/** Databases the fleet connects to, named by the Vault secret that holds their URL. */
async function databaseChecks(ctx: HealthContext): Promise<CheckResult[]> {
  const secrets = new Set<string>();
  for (const service of ctx.config.services) {
    for (const secret of service.secrets ?? []) {
      if (secret.source === "vault" && DATABASE_SECRET.test(secret.name)) secrets.add(secret.name);
    }
  }
  if (secrets.size === 0) return [];
  const doc = await ctx.kv("prd");
  if (!doc.ok) return [...secrets].map((secret) => unavailable(`database ${secret}`, doc));
  return Promise.all([...secrets].map((secret) => checkDatabase(ctx, secret, doc.data)));
}

/**
 * OpenBao stores everything in its PostgreSQL database, so an unsealed Vault
 * on PostgreSQL storage is the read-only proof that the database is serving.
 */
async function postgresChecks(ctx: HealthContext, postgres: PostgresConfig | undefined): Promise<CheckResult[]> {
  const projects = (postgres?.projects ?? []).filter((project) => project.purpose === "openbao-storage");
  if (projects.length === 0) return [];
  const status = await readSealStatus(ctx);
  return projects.map((project) => {
    const name = `postgres ${project.id}`;
    if (!status) return fail(name, "Vault is unreachable, so its PostgreSQL storage cannot be confirmed");
    if (status["storage_type"] !== "postgresql") {
      return fail(name, `Vault reports ${String(status["storage_type"])} storage, expected postgresql`);
    }
    return status["initialized"] === true && status["sealed"] === false
      ? pass(name, "serving OpenBao: Vault is unsealed on postgresql storage")
      : fail(name, "Vault cannot read its seal configuration from PostgreSQL storage");
  });
}

/** `/v8/artifacts/status` is authenticated and read-only: it proves the Vault token is the server's. */
async function cacheCheck(ctx: HealthContext): Promise<CheckResult[]> {
  const service = ctx.config.services.find((candidate) => candidate.id === CACHE_SERVICE_ID);
  if (!service?.hostname) return [];
  const name = "remote cache";
  const doc = await ctx.kv("prd");
  if (!doc.ok) return [unavailable(name, doc)];
  const api = doc.data["TURBO_API"]?.trim().replace(/\/$/, "");
  const token = doc.data["TURBO_TOKEN"]?.trim();
  if (!api || !token) return [fail(name, "Vault prd is missing TURBO_API or TURBO_TOKEN")];
  if (api !== `https://${service.hostname}`) {
    return [fail(name, `Vault prd TURBO_API is ${api}, inventory hosts the cache at https://${service.hostname}`)];
  }
  try {
    const res = await getJson(ctx, `${api}/v8/artifacts/status`, { Authorization: `Bearer ${token}` });
    const status = asRecord(res.body)["status"];
    if (res.status === 401 || res.status === 403) return [fail(name, `the cache rejected Vault's TURBO_TOKEN (HTTP ${res.status})`)];
    return res.status === 200
      ? [pass(name, `${api} accepts Vault's TURBO_TOKEN (status ${String(status)})`)]
      : [fail(name, `${api}/v8/artifacts/status returned HTTP ${res.status}`)];
  } catch (err) {
    return [fail(name, errorMessage(err))];
  }
}

export async function checkStorage(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const buckets = (ctx.config.object_stores ?? []).flatMap((store) =>
    (store.namespaces ?? []).map((kvConfig) => checkBucket(ctx, store, kvConfig)),
  );
  const groups = await Promise.all([
    Promise.all(buckets),
    postgresChecks(ctx, ctx.config.postgres),
    databaseChecks(ctx),
    cacheCheck(ctx),
    checkFleetCache(ctx),
  ]);
  return groups.flat();
}
