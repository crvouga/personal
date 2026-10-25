/**
 * Self-hosted runner fleet. Bootstrap registration data lives in JSON;
 * its GitHub registrations are the only state observable from here.
 */
import { join } from "node:path";
import { asRecord, asStrings, errorMessage, type HealthContext } from "./context.js";
import { githubApi } from "./check-github.js";
import { fail, pass, skip, type CheckResult } from "./report.js";

const FLEET_FILE = "packages/fleet/settings/github.json";
/** Routing labels every fleet job must require; see packages/fleet/AGENTS.md. */
const FLEET_LABELS = ["nixos", "ci"];

export type FleetGithub = {
  readonly configured: boolean;
  readonly scope: string;
  readonly organization: string;
  readonly repositories: readonly string[];
};

/** Read the same JSON consumed by Nix and setup; no source-code parsing. */
export function parseFleetGithub(json: string): FleetGithub {
  let config: Record<string, unknown>;
  try {
    config = asRecord(JSON.parse(json));
  } catch {
    config = {};
  }
  const text = (key: string): string => typeof config[key] === "string" ? config[key] : "";
  const scope = text("scope");
  const organization = text("organization");
  const repositories = asStrings(config["repositories"]);
  return {
    configured: /^\d+$/.test(text("appId")) && /^\d+$/.test(text("installationId"))
      && (scope === "organization" ? organization.length > 0 && organization !== "TODO" : scope === "repository" && repositories.length > 0),
    scope,
    organization,
    repositories,
  };
}

/**
 * Node lag is not observable from here. Each node compares itself with
 * origin/main (`fleet-drift.service`). This is not OpenTofu plan drift.
 * Fleet API heartbeats separately expose revision, readiness and missed beats.
 * GitHub registration alone does not prove the installed revision is healthy.
 */
export function checkFleetRevision(): CheckResult {
  return skip(
    "fleet revision",
    "GitHub registration does not prove revision readiness. The fleet-nodes health group checks authenticated heartbeats, readiness, sync failures and offline state; fleet-drift.service reports revision lag on the node.",
  );
}

export async function checkRunners(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const name = "runner fleet";
  const revision = checkFleetRevision();
  const path = join(ctx.repoRoot, FLEET_FILE);
  if (!ctx.fileExists(path)) return [skip(name, `${FLEET_FILE} not found`), revision];
  const fleet = parseFleetGithub(ctx.readFile(path));
  if (!fleet.configured) {
    return [skip(name, `not deployed: ${FLEET_FILE} has incomplete or invalid GitHub registration data`), revision];
  }
  const token = ctx.githubToken();
  if (!token) return [skip(name, "no GitHub token: set GH_TOKEN or run `gh auth login`")];
  const api = githubApi(ctx, token);
  const scopes =
    fleet.scope === "organization" ? [`orgs/${fleet.organization}`] : fleet.repositories.map((repo) => `repos/${repo}`);

  const runners = await Promise.all(
    scopes.map(async (scope) => {
      const label = `runners ${scope}`;
      try {
        const res = await api(`/${scope}/actions/runners?per_page=100`);
        if (res.status === 403 || res.status === 404) return skip(label, `token may not list runners (HTTP ${res.status})`);
        if (res.status !== 200) return fail(label, `HTTP ${res.status}`);
        const runners = asRecord(res.body)["runners"];
        const fleetRunners = (Array.isArray(runners) ? runners : []).map(asRecord).filter((runner) => {
          const labels = (Array.isArray(runner["labels"]) ? runner["labels"] : []).flatMap((entry) => asStrings([asRecord(entry)["name"]]));
          return FLEET_LABELS.every((required) => labels.includes(required));
        });
        const online = fleetRunners.filter((runner) => runner["status"] === "online").length;
        if (fleetRunners.length === 0) return fail(label, `no runner registered with labels ${FLEET_LABELS.join(", ")}`);
        return online > 0
          ? pass(label, `${online} of ${fleetRunners.length} fleet runner(s) online`)
          : fail(label, `all ${fleetRunners.length} fleet runner(s) are offline`);
      } catch (err) {
        return fail(label, errorMessage(err));
      }
    }),
  );
  return [...runners, revision];
}
