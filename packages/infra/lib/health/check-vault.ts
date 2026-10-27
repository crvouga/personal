/** OpenBao seal state plus the mounts, policies, auth and KV keys OpenTofu declares. */
import type { InfraConfig, VaultConfig } from "../schema.js";
import { vaultAddr, vaultConfigOrDefault } from "../services.js";
import { asRecord, asStrings, errorMessage, getJson, type HealthContext, type JsonResponse } from "./context.js";
import { fail, pass, skip, type CheckResult } from "./report.js";
import { missingFrom } from "./targets.js";

const DAY_SECONDS = 24 * 60 * 60;

/** The seal-status document, or undefined when Vault is unreachable. */
export async function readSealStatus(ctx: HealthContext): Promise<Readonly<Record<string, unknown>> | undefined> {
  try {
    const res = await getJson(ctx, `${vaultAddr(ctx.config)}/v1/sys/seal-status`);
    return res.status === 200 ? asRecord(res.body) : undefined;
  } catch {
    return undefined;
  }
}

function sealChecks(vault: VaultConfig, status: Readonly<Record<string, unknown>>): CheckResult[] {
  const version = typeof status["version"] === "string" ? status["version"] : "unknown version";
  const results = [
    status["initialized"] !== true
      ? fail("seal", "Vault is not initialized")
      : status["sealed"] === true
        ? fail("seal", `Vault ${version} is sealed; rerun CI with unseal_only to apply the bootstrap root`)
        : pass("seal", `Vault ${version} is initialized and unsealed (${String(status["storage_type"])} storage)`),
  ];
  if (vault.init) {
    const { key_shares: shares, key_threshold: threshold } = vault.init;
    results.push(
      status["n"] === shares && status["t"] === threshold
        ? pass("seal shares", `${threshold} of ${shares} Shamir shares`)
        : fail("seal shares", `expected ${threshold} of ${shares}, live is ${String(status["t"])} of ${String(status["n"])}`),
    );
  }
  return results;
}

type Read = (path: string) => Promise<JsonResponse>;

/** A 403 means this token may not look; that is a skip, not a misconfiguration. */
async function inspect(
  name: string,
  read: Read,
  path: string,
  judge: (data: Readonly<Record<string, unknown>>) => CheckResult,
): Promise<CheckResult> {
  try {
    const res = await read(path);
    if (res.status === 403) return skip(name, `token may not read ${path} (HTTP 403)`);
    if (res.status === 404) return fail(name, `${path} does not exist`);
    if (res.status !== 200) return fail(name, `${path} returned HTTP ${res.status}`);
    const body = asRecord(res.body);
    return judge(asRecord(body["data"] ?? body));
  } catch (err) {
    return fail(name, errorMessage(err));
  }
}

function presence(name: string, required: readonly string[], present: readonly string[], noun: string): CheckResult {
  const missing = missingFrom(required, present);
  return missing.length === 0
    ? pass(name, `${required.length} declared ${noun} present`)
    : fail(name, `missing ${noun}: ${missing.join(", ")}`);
}

function configChecks(config: InfraConfig, vault: VaultConfig, read: Read): Promise<CheckResult>[] {
  const addr = vaultAddr(config);
  const jwt = vault.auth?.jwt;
  const users = vault.auth?.userpass?.users ?? [];
  const checks = [
    inspect("kv mount", read, "sys/mounts", (mounts) => {
      const mount = asRecord(mounts[`${vault.kv.mount}/`]);
      const version = asRecord(mount["options"])["version"];
      return mount["type"] === "kv" && version === "2"
        ? pass("kv mount", `${vault.kv.mount}/ is KV v2`)
        : fail("kv mount", `${vault.kv.mount}/ is ${String(mount["type"] ?? "absent")} v${String(version ?? "?")}, expected KV v2`);
    }),
    inspect("policies", read, "sys/policies/acl?list=true", (data) =>
      presence("policies", (vault.policies ?? []).map((policy) => policy.name), asStrings(data["keys"]), "policies"),
    ),
    inspect("auth backends", read, "sys/auth", (auth) => {
      const expected = [...(jwt ? [[`${jwt.path}/`, "jwt"]] : []), ...(users.length > 0 ? [["userpass/", "userpass"]] : [])];
      const wrong = expected.filter(([path, type]) => asRecord(auth[path as string])["type"] !== type);
      return wrong.length === 0
        ? pass("auth backends", expected.map(([path]) => path).join(", "))
        : fail("auth backends", `missing or mistyped: ${wrong.map(([path]) => path).join(", ")}`);
    }),
  ];
  if (vault.operator_credentials_path) {
    checks.push(inspect("operator credentials", read, `${vault.kv.mount}/data/${vault.operator_credentials_path}`, (document) => {
      const values = asRecord(document["data"]);
      const required = ["TOFU_STATE_PASSPHRASE", "TOFU_STATE_ACCESS_KEY", "TOFU_STATE_SECRET_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID", "GITHUB_TOKEN"];
      const missing = required.filter((key) => typeof values[key] !== "string" || !(values[key] as string).trim());
      return missing.length ? fail("operator credentials", `operator setup incomplete: ${missing.join(", ")}`) : pass("operator credentials", "admin-only state and deployment credentials are configured");
    }));
  }
  for (const role of jwt?.roles ?? []) {
    const name = `jwt role ${role.name}`;
    checks.push(
      inspect(name, read, `auth/${jwt?.path}/role/${role.name}`, (data) => {
        const problems = [
          ...(asStrings(data["token_policies"]).includes(role.policy) ? [] : [`policy ${role.policy} not attached`]),
          ...(asStrings(data["bound_audiences"]).includes(addr) ? [] : [`audience is not ${addr}`]),
        ];
        return problems.length === 0 ? pass(name, `${role.policy}, audience ${addr}`) : fail(name, problems.join("; "));
      }),
    );
  }
  if (users.length > 0) {
    checks.push(
      inspect("userpass users", read, "auth/userpass/users?list=true", (data) =>
        presence("userpass users", users.map((user) => user.username), asStrings(data["keys"]), "users"),
      ),
    );
  }
  return checks;
}

/** Keys a KV config must hold for the services, tunnels, cache and object stores to work. */
export function requiredKvKeys(config: InfraConfig, kvConfig: string): readonly string[] {
  const vault = vaultConfigOrDefault(config);
  const keys = (vault.kv_keys ?? [])
    .filter((key) => key.required && key.configs.includes(kvConfig))
    .map((key) => key.name);
  for (const store of config.object_stores ?? []) {
    if (!(store.namespaces ?? []).includes(kvConfig)) continue;
    keys.push(store.bucket_secret, store.endpoint_secret, store.region_secret, store.access_key_secret, store.secret_key_secret);
  }
  // Preparation credentials are required even while broker deployment is staged.
  for (const instance of Object.values(config.auth_relay?.instances ?? {})) {
    if (instance.vault_config === kvConfig) {
      keys.push(instance.google_client_id_key, instance.google_client_secret_key, instance.setup_token_key);
      if (config.auth_relay?.enabled && config.auth_relay.live !== false) keys.push('AUTH_RELAY_DATABASE_URL', 'AUTH_CONSOLE_CLIENT_ID', 'AUTH_CONSOLE_CLIENT_SECRET', 'AUTH_MANAGER_CLIENT_ID', 'AUTH_MANAGER_CLIENT_SECRET');
    }
  }
  // The services root copies service secrets, and tunnels read theirs, from production only.
  if (kvConfig === "prd") {
    for (const service of config.services) {
      for (const secret of service.secrets ?? []) if (secret.source === "vault") keys.push(secret.name);
      if (service.railway?.registry) keys.push(service.railway.registry.vault_key);
    }
    for (const tunnel of config.tunnels ?? []) keys.push(...(tunnel.secrets ?? []));
  }
  return [...new Set(keys)].sort();
}

async function kvChecks(ctx: HealthContext, vault: VaultConfig): Promise<CheckResult[]> {
  return Promise.all(
    vault.kv.configs.map(async (kvConfig) => {
      const name = `kv ${vault.kv.project}/${kvConfig}`;
      const doc = await ctx.kv(kvConfig);
      if (!doc.ok) return doc.unverifiable ? skip(name, doc.reason) : fail(name, doc.reason);
      const required = requiredKvKeys(ctx.config, kvConfig);
      const missing = required.filter((key) => !doc.data[key]?.trim());
      return missing.length === 0
        ? pass(name, `${required.length} required keys set (${Object.keys(doc.data).length} total)`)
        : fail(name, `missing or empty: ${missing.join(", ")}`);
    }),
  );
}

export async function checkVault(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const vault = vaultConfigOrDefault(ctx.config);
  const addr = vaultAddr(ctx.config);
  const status = await readSealStatus(ctx);
  if (!status) return [fail("seal", `${addr}/v1/sys/seal-status is unreachable`)];
  const results = sealChecks(vault, status);
  if (status["sealed"] === true || status["initialized"] !== true) return results;

  const token = ctx.vaultToken();
  if (!token) {
    return [...results, skip("configuration", "no Vault token: set VAULT_TOKEN or run `bun run vault:login`")];
  }
  const read: Read = (path) => getJson(ctx, `${addr}/v1/${path}`, { "X-Vault-Token": token });
  try {
    const self = await read("auth/token/lookup-self");
    if (self.status !== 200) {
      return [...results, skip("configuration", `Vault token rejected (HTTP ${self.status}); run \`bun run vault:login\``)];
    }
    const data = asRecord(asRecord(self.body)["data"]);
    const ttl = typeof data["ttl"] === "number" ? data["ttl"] : 0;
    const lifetime = ttl === 0 ? "no expiry" : `${Math.floor(ttl / DAY_SECONDS)}d left`;
    results.push(pass("token", `policies ${asStrings(data["policies"]).join(", ")}; ${lifetime}`));
  } catch (err) {
    return [...results, fail("token", errorMessage(err))];
  }
  return [...results, ...(await Promise.all(configChecks(ctx.config, vault, read))), ...(await kvChecks(ctx, vault))];
}
