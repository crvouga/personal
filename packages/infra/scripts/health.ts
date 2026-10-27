#!/usr/bin/env bun
/**
 * One report for the whole platform: is everything in
 * tofu/modules/inventory/inventory.tf.json configured correctly and healthy?
 *
 * Read-only. Checks that need a credential or tool report SKIP with the reason
 * instead of passing. Exits 1 when any check fails.
 *
 * Usage:
 *   bun run scripts/health.ts
 *   bun run scripts/health.ts --verbose
 *   bun run scripts/health.ts --drift
 *   bun run scripts/health.ts --only services,vault
 *   bun run scripts/health.ts --json
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assert } from "@pkgs/assert";
import { DEFAULT_HEALTH_OPTIONS, errorMessage, type HealthOptions } from "../lib/health/context.js";
import { createHealthContext } from "../lib/health/ports.js";
import { renderMarkdown, renderText, reportExitCode } from "../lib/health/report.js";
import { HEALTH_GROUPS, runHealth, selectGroups } from "../lib/health/run.js";
import { loadServicesConfig } from "../lib/services.js";

type Args = {
  readonly only: readonly string[];
  readonly except: readonly string[];
  readonly verbose: boolean;
  readonly json: boolean;
  readonly strict: boolean;
  readonly options: HealthOptions;
};

function usage(): string {
  const groups = HEALTH_GROUPS.map((group) => `  ${group.id.padEnd(10)} ${group.covers}`).join("\n");
  return [
    "Usage: bun run health [options]",
    "",
    "  --drift              also run `tofu plan` in every initialized root (slow; needs provider credentials)",
    "  --only <ids>         comma-separated groups to run",
    "  --skip <ids>         comma-separated groups to leave out",
    "  --verbose, -v        list passing checks too",
    "  --json               print the report as JSON",
    "  --strict             exit 1 on warnings and skipped checks as well as failures",
    "  --timeout-ms <ms>    per-attempt timeout for always-on endpoints",
    "  --cold-start-timeout-ms <ms>  per-attempt timeout for sleeping services",
    "  --retries <n>        extra attempts for a failing service",
    "",
    "Groups:",
    groups,
    "",
    "Credentials (each optional; dependent checks skip without it):",
    "  VAULT_TOKEN or ~/.vault-token   Vault configuration, KV keys, buckets, databases",
    "  GH_TOKEN or `gh auth login`     GitHub repositories, secrets, merge gate, CI runs",
    "  initialized tofu roots          --drift; see packages/infra/tofu/README.md",
  ].join("\n");
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

function parseArgs(argv: readonly string[]): Args {
  assert.array(argv, "argv must be an array");
  const only: string[] = [];
  const except: string[] = [];
  let verbose = false;
  let json = false;
  let strict = false;
  let options = DEFAULT_HEALTH_OPTIONS;
  const number = (flag: string, value: string | undefined): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} requires a non-negative number`);
    return parsed;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--drift") options = { ...options, drift: true };
    else if (arg === "--only") only.push(...list(argv[++i]));
    else if (arg === "--skip") except.push(...list(argv[++i]));
    else if (arg === "--verbose" || arg === "-v") verbose = true;
    else if (arg === "--json") json = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "--timeout-ms") options = { ...options, timeoutMs: number(arg, argv[++i]) };
    else if (arg === "--cold-start-timeout-ms") options = { ...options, coldStartTimeoutMs: number(arg, argv[++i]) };
    else if (arg === "--retries") options = { ...options, retries: number(arg, argv[++i]) };
    else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { only, except, verbose, json, strict, options };
}

async function main(): Promise<number> {
  let args: Args;
  let groups: ReturnType<typeof selectGroups>;
  try {
    args = parseArgs(process.argv.slice(2));
    groups = selectGroups(args.only, args.except);
  } catch (err) {
    console.error(`${errorMessage(err)}\n\n${usage()}`);
    return 2;
  }
  const ctx = createHealthContext({
    config: loadServicesConfig(),
    repoRoot: join(import.meta.dirname, "..", "..", ".."),
    options: args.options,
  });
  if (!args.json) console.error(`Checking ${groups.map((group) => group.id).join(", ")}…`);
  const report = await runHealth(ctx, groups);

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderText(report, { verbose: args.verbose, color: process.stdout.isTTY === true && !process.env["NO_COLOR"] }));

  const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryFile) appendFileSync(summaryFile, `${renderMarkdown(report)}\n`);
  return reportExitCode(report, args.strict);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(errorMessage(err));
    process.exit(1);
  },
);
