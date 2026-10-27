/**
 * Stateful backends: R2 buckets, PostgreSQL databases.
 * Credentials come from the Vault KV documents; without them every check skips.
 */
import type { ObjectStoreSpec, PostgresConfig } from "../schema.js";
import { errorMessage, type HealthContext, type KvDocument, type KvRead } from "./context.js";
import { readSealStatus } from "./check-vault.js";
import { fail, pass, skip, type CheckResult } from "./report.js";

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

/** Databases the services connects to, named by the Vault secret that holds their URL. */
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

export async function checkStorage(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const buckets = (ctx.config.object_stores ?? []).flatMap((store) =>
    (store.namespaces ?? []).map((kvConfig) => checkBucket(ctx, store, kvConfig)),
  );
  const groups = await Promise.all([
    Promise.all(buckets),
    postgresChecks(ctx, ctx.config.postgres),
    databaseChecks(ctx),
  ]);
  return groups.flat();
}
