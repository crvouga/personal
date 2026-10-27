/**
 * Configuration drift: `tofu plan` must find nothing to change in any root.
 *
 * Plans are read-only. They run without the state lock so a health check can
 * never block a deploy, write no plan file, and report resource addresses only.
 * Initialization and credentials are the caller's job (CI: the tofu action).
 */
import { join } from "node:path";
import { deployableServices } from "../services.js";
import { asRecord, errorMessage, type CommandResult, type HealthContext } from "./context.js";
import { fail, pass, skip, type CheckResult } from "./report.js";
import { missingFrom } from "./targets.js";

export const DRIFT_ROOTS = ["foundation", "bootstrap", "vault", "services"] as const;
type Root = (typeof DRIFT_ROOTS)[number];
const driftRoots = (): readonly Root[] => DRIFT_ROOTS;

const TOFU_DIR = "packages/infra/tofu";
const BACKEND_FILE = "backend.backend.json";
const PLAN_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_LISTED = 8;
const SETUP_HINT = "see packages/infra/tofu/README.md";

/** Inputs CI carries between runs; a plan without them would propose a redeploy. */
const PRESERVED_INPUTS: Readonly<Partial<Record<Root, { readonly variable: string; readonly output: readonly string[] }>>> = {
  foundation: { variable: "TF_VAR_vault_image_tag", output: ["-raw", "vault_image_tag"] },
  services: { variable: "TF_VAR_image_tags", output: ["-json", "image_tags"] },
};

/**
 * A service added to the inventory has no deployed revision to preserve. Give it
 * the default tag, as CI does, so the complete-map check passes and the plan can
 * report that the service is still to be created.
 */
export function withNewServices(ctx: HealthContext, deployed: string): string {
  const tags = asRecord(JSON.parse(deployed));
  const merged: Record<string, unknown> = { ...tags };
  for (const service of deployableServices(ctx.config)) {
    if (!(service.id in merged)) merged[service.id] = ctx.config.default_image_tag;
  }
  return JSON.stringify(merged);
}

export type PlanSummary = {
  readonly changes: readonly string[];
  readonly errors: readonly string[];
};

/** Reduces `tofu plan -json` to changed addresses and error summaries; values never leave. */
export function summarizePlan(stdout: string): PlanSummary {
  const changes: string[] = [];
  const errors: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let message: Readonly<Record<string, unknown>>;
    try {
      message = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (message["type"] === "planned_change") {
      const change = asRecord(message["change"]);
      const action = String(change["action"]);
      if (action !== "noop") changes.push(`${String(asRecord(change["resource"])["addr"])} (${action})`);
    } else if (message["type"] === "diagnostic" && message["@level"] === "error") {
      errors.push(String(asRecord(message["diagnostic"])["summary"] ?? message["@message"]));
    }
  }
  return { changes, errors };
}

function listed(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown}, and ${items.length - MAX_LISTED} more` : shown;
}

export function judgePlan(root: string, result: CommandResult): CheckResult {
  const name = `plan ${root}`;
  const summary = summarizePlan(result.stdout);
  if (result.code === 0) return pass(name, "no changes; live infrastructure matches the configuration");
  if (result.code === 2) {
    return summary.changes.length > 0
      ? fail(name, `${summary.changes.length} pending change(s): ${listed(summary.changes)}`)
      : fail(name, "outputs would change; run `tofu plan` in this root for the diff");
  }
  const reason = summary.errors.length > 0 ? listed(summary.errors) : result.stderr.trim().split("\n").pop() || "no diagnostic";
  return fail(name, `tofu plan exited ${result.code}: ${reason}`);
}

async function planRoot(ctx: HealthContext, root: Root): Promise<CheckResult> {
  const name = `plan ${root}`;
  const dir = join(ctx.repoRoot, TOFU_DIR, root);
  if (!ctx.fileExists(join(dir, BACKEND_FILE)) || !ctx.fileExists(join(dir, ".terraform"))) {
    return skip(name, `root is not initialized with ${BACKEND_FILE}; ${SETUP_HINT}`);
  }
  if (!ctx.env["TF_VAR_state_passphrase"]) return skip(name, `TF_VAR_state_passphrase is unset; ${SETUP_HINT}`);

  // Providers take their Vault token from bootstrap state, exactly as in a deploy;
  // the report's own read-only token must not reach them.
  const env: Record<string, string | undefined> = { VAULT_TOKEN: undefined };
  const preserved = PRESERVED_INPUTS[root];
  if (preserved && !ctx.env[preserved.variable]) {
    const output = await ctx.run("tofu", [`-chdir=${dir}`, "output", ...preserved.output], { timeoutMs: PLAN_TIMEOUT_MS });
    if (output.code !== 0) {
      return fail(name, `cannot read deployed ${preserved.output[1]}: ${output.stderr.trim().split("\n").pop() ?? ""}`);
    }
    env[preserved.variable] = root === "services" ? withNewServices(ctx, output.stdout.trim()) : output.stdout.trim();
  }
  const result = await ctx.run(
    "tofu",
    [`-chdir=${dir}`, "plan", "-input=false", "-lock=false", "-parallelism=1", "-detailed-exitcode", "-json"],
    { env, timeoutMs: PLAN_TIMEOUT_MS },
  );
  return judgePlan(root, result);
}

/** Every root's state object exists in the R2 state bucket. */
async function checkStateBucket(ctx: HealthContext): Promise<CheckResult> {
  const name = "state bucket";
  const roots = driftRoots();
  const backendPath = roots.map((root) => join(ctx.repoRoot, TOFU_DIR, root, BACKEND_FILE)).find(ctx.fileExists);
  const accessKeyId = ctx.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = ctx.env["AWS_SECRET_ACCESS_KEY"];
  if (!backendPath || !accessKeyId || !secretAccessKey) {
    return skip(name, `needs ${BACKEND_FILE} and AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY; ${SETUP_HINT}`);
  }
  try {
    const backend = asRecord(JSON.parse(ctx.readFile(backendPath)));
    const bucket = String(backend["bucket"]);
    const keys = await ctx.listBucket(
      {
        endpoint: String(asRecord(backend["endpoints"])["s3"]),
        region: String(backend["region"] ?? "auto"),
        accessKeyId,
        secretAccessKey,
        bucket,
      },
      1000,
    );
    const missing = missingFrom(roots.map((root) => `${root === "services" ? "fleet" : root}.tfstate`), keys);
    return missing.length === 0
      ? pass(name, `${bucket} holds state for ${roots.join(", ")}`)
      : fail(name, `${bucket} is missing ${missing.join(", ")}`);
  } catch (err) {
    return fail(name, errorMessage(err));
  }
}

export async function checkDrift(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const stateBucket = await checkStateBucket(ctx);
  if (!ctx.options.drift) {
    return [stateBucket, skip("plan", `not requested: pass --drift to run \`tofu plan\` in ${driftRoots().join(", ")}`)];
  }
  const version = await ctx.run("tofu", ["version"], { timeoutMs: 30_000 });
  if (version.code !== 0) return [stateBucket, skip("plan", "OpenTofu is not installed")];

  // Railway provider operations must not overlap, so roots plan one at a time.
  const plans: CheckResult[] = [];
  for (const root of driftRoots()) plans.push(await planRoot(ctx, root));
  return [stateBucket, ...plans];
}
