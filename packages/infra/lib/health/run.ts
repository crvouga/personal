/** The health groups, in report order, and the runner that executes them. */
import { assert } from "@pkgs/assert";
import { checkDns } from "./check-dns.js";
import { checkDomains } from './check-domains.js';
import { checkDrift } from "./check-drift.js";
import { checkGithub } from "./check-github.js";
import { checkImages } from "./check-images.js";
import { checkInventory } from "./check-inventory.js";
import { checkRunners } from "./check-runners.js";
import { checkServices, checkTunnels } from "./check-services.js";
import { checkStorage } from "./check-storage.js";
import { checkTls } from "./check-tls.js";
import { checkVault } from "./check-vault.js";
import { errorMessage, type HealthContext } from "./context.js";
import { fail, type CheckResult, type GroupReport, type HealthReport } from "./report.js";

export type HealthGroup = {
  readonly id: string;
  readonly title: string;
  readonly covers: string;
  readonly run: (ctx: HealthContext) => Promise<readonly CheckResult[]>;
};

export const HEALTH_GROUPS: readonly HealthGroup[] = [
  { id: "inventory", title: "Inventory", covers: "offline consistency of the OpenTofu inventory", run: checkInventory },
  { id: "dns", title: "DNS", covers: "Cloudflare delegation and every declared record", run: checkDns },
  { id: 'domains', title: 'Domains', covers: 'registrar, exact account delegation, DNSSEC, migration records and HTTPS', run: checkDomains },
  { id: "tls", title: "TLS", covers: "certificate trust and expiry for every public hostname", run: checkTls },
  { id: "services", title: "Services", covers: "Railway service health endpoints and Cloudflare redirects", run: checkServices },
  { id: "tunnels", title: "Tunnels", covers: "Cloudflare tunnel connectors", run: checkTunnels },
  { id: "vault", title: "Vault", covers: "seal state, mounts, policies, auth and required KV keys", run: checkVault },
  { id: "storage", title: "Storage", covers: "R2 buckets, PostgreSQL, service databases and the remote cache", run: checkStorage },
  { id: "images", title: "Images", covers: "public pullability of every deployed GHCR image", run: checkImages },
  { id: "github", title: "GitHub", covers: "repositories, publishers, secrets, merge gate and last CI run", run: checkGithub },
  { id: "runners", title: "CI runners", covers: "self-hosted runner fleet registrations", run: checkRunners },
  { id: "drift", title: "OpenTofu", covers: "state objects and `tofu plan` drift per root (--drift)", run: checkDrift },
];

/** A check that throws is a failed check, never a crashed report. */
async function runGroup(group: HealthGroup, ctx: HealthContext): Promise<GroupReport> {
  const started = Date.now();
  let results: readonly CheckResult[];
  try {
    results = await group.run(ctx);
  } catch (err) {
    results = [fail(group.id, `check crashed: ${errorMessage(err)}`)];
  }
  return { id: group.id, title: group.title, durationMs: Date.now() - started, results };
}

export function selectGroups(only: readonly string[], except: readonly string[]): readonly HealthGroup[] {
  const known = new Set(HEALTH_GROUPS.map((group) => group.id));
  const unknown = [...only, ...except].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown health group: ${unknown.join(", ")} (known: ${[...known].join(", ")})`);
  }
  return HEALTH_GROUPS.filter((group) => (only.length === 0 || only.includes(group.id)) && !except.includes(group.id));
}

/** Groups are independent and run concurrently; the report keeps their declared order. */
export async function runHealth(ctx: HealthContext, groups: readonly HealthGroup[]): Promise<HealthReport> {
  assert.nonEmptyArray(groups, "at least one health group must be selected");
  const started = ctx.now();
  const reports = await Promise.all(groups.map((group) => runGroup(group, ctx)));
  return {
    zone: ctx.config.zone,
    startedAt: started.toISOString(),
    durationMs: ctx.now().getTime() - started.getTime(),
    groups: reports,
  };
}
