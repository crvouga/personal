/**
 * Every secret OpenTofu or a service expects in Vault: present, shaped like what
 * it should be, and consistent with the inventory. Reads each KV document once
 * and never prints a value.
 */
import type { InfraConfig } from "../schema.js";
import { vaultConfigOrDefault } from "../services.js";
import { requiredKvKeys } from "./check-vault.js";
import type { HealthContext, KvDocument } from "./context.js";
import { fail, pass, skip, warn, type CheckResult } from "./report.js";
import { problemsFor } from "./secret-rules.js";

const hostOf = (value: string): string | undefined => {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
};

function presence(name: string, config: InfraConfig, kvConfig: string, doc: KvDocument): CheckResult {
  const required = requiredKvKeys(config, kvConfig);
  const declared = (vaultConfigOrDefault(config).kv_keys ?? [])
    .filter((key) => key.configs.includes(kvConfig))
    .map((key) => key.name);
  const set = (key: string): boolean => !!doc[key]?.trim();
  const missing = required.filter((key) => !set(key));
  if (missing.length > 0) {
    return fail(name, `missing or empty required: ${missing.join(", ")} (set them in secrets input and apply the vault root)`);
  }
  const unset = declared.filter((key) => !required.includes(key) && !set(key));
  const undeclared = Object.keys(doc).filter((key) => !declared.includes(key) && !required.includes(key));
  const notes = [
    unset.length > 0 ? `optional unset: ${unset.join(", ")}` : "",
    undeclared.length > 0 ? `${undeclared.length} not declared in the inventory` : "",
  ].filter(Boolean);
  return pass(name, [`${required.length} required set`, ...notes].join("; "));
}

function shape(name: string, doc: KvDocument): CheckResult {
  const found = Object.entries(doc)
    .filter(([, value]) => value !== "")
    .flatMap(([key, value]) => problemsFor(key, value).map((problem) => ({ key, ...problem })));
  const describe = (items: typeof found): string => items.map((item) => `${item.key} ${item.message}`).join("; ");
  const failures = found.filter((item) => item.severity === "fail");
  if (failures.length > 0) return fail(name, describe(failures));
  return found.length > 0 ? warn(name, describe(found)) : pass(name, `${Object.keys(doc).length} values look well-formed`);
}

function consistency(name: string, config: InfraConfig, doc: KvDocument): CheckResult {
  const problems: string[] = [];
  const turbo = config.services.find((service) => service.id === "turborepo")?.hostname;
  if (doc["TURBO_API"] && turbo && hostOf(doc["TURBO_API"]) !== turbo) {
    problems.push(`TURBO_API host differs from the inventory's turborepo hostname ${turbo}`);
  }
  const account = doc["CLOUDFLARE_ACCOUNT_ID"];
  const endpoint = doc["S3_ENDPOINT"] ? hostOf(doc["S3_ENDPOINT"]) : undefined;
  if (account && endpoint?.endsWith(".r2.cloudflarestorage.com") && !endpoint.startsWith(`${account}.`)) {
    problems.push("S3_ENDPOINT belongs to a different Cloudflare account than CLOUDFLARE_ACCOUNT_ID");
  }
  if (doc["GOOGLE_OAUTH_CLIENT_ID"] && doc["GOOGLE_OAUTH_CLIENT_ID"] === doc["GOOGLE_OAUTH_CLIENT_SECRET"]) {
    problems.push("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are the same value");
  }
  return problems.length === 0 ? pass(name, "values agree with the inventory") : fail(name, problems.join("; "));
}

export async function checkSecrets(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const vault = vaultConfigOrDefault(ctx.config);
  const documents = await Promise.all(
    vault.kv.configs.map(async (kvConfig) => ({ kvConfig, doc: await ctx.kv(kvConfig) })),
  );
  return documents.flatMap(({ kvConfig, doc }): CheckResult[] => {
    const label = `${vault.kv.project}/${kvConfig}`;
    if (!doc.ok) return [doc.unverifiable ? skip(label, doc.reason) : fail(label, doc.reason)];
    return [
      presence(`presence ${label}`, ctx.config, kvConfig, doc.data),
      shape(`shape ${label}`, doc.data),
      consistency(`consistency ${label}`, ctx.config, doc.data),
    ];
  });
}
