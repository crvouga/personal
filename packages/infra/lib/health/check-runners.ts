/**
 * Self-hosted runner fleet. The fleet is defined by `fleet.nix`, not OpenTofu;
 * its GitHub registrations are the only state observable from here.
 */
import { join } from "node:path";
import { asRecord, asStrings, errorMessage, type HealthContext } from "./context.js";
import { githubApi } from "./check-github.js";
import { fail, pass, skip, type CheckResult } from "./report.js";

const FLEET_FILE = "packages/fleet/fleet.nix";
/** Routing labels every fleet job must require; see packages/fleet/AGENTS.md. */
const FLEET_LABELS = ["nixos", "ci"];

export type FleetGithub = {
  readonly configured: boolean;
  readonly scope: string;
  readonly organization: string;
  readonly repositories: readonly string[];
};

/** Reads the `github` attribute set; a remaining TODO means the fleet was never set up. */
export function parseFleetGithub(nix: string): FleetGithub {
  const block = /\bgithub\s*=\s*\{([\s\S]*?)\};/.exec(nix.replace(/#.*$/gm, ""))?.[1] ?? "";
  const attribute = (name: string): string => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(block)?.[1] ?? "";
  const repositories = /\brepositories\s*=\s*\[([^\]]*)\]/.exec(block)?.[1] ?? "";
  return {
    configured: block.length > 0 && !block.includes("TODO"),
    scope: attribute("scope"),
    organization: attribute("organization"),
    repositories: [...repositories.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string),
  };
}

/**
 * Node lag is not observable from here. Each node compares itself with
 * origin/main (`fleet-drift.service`). This is not OpenTofu plan drift.
 * TODO: metrics are only on 127.0.0.1:9101. No scraper exists, so a node
 * that stops reporting is invisible outside that machine.
 */
export function checkFleetRevision(): CheckResult {
  return skip(
    "fleet revision",
    "TODO: no scraper for 127.0.0.1:9101. A silent node is invisible here. fleet-drift.service is the on-node lag signal; this is not OpenTofu plan drift.",
  );
}

export async function checkRunners(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const name = "runner fleet";
  const revision = checkFleetRevision();
  const path = join(ctx.repoRoot, FLEET_FILE);
  if (!ctx.fileExists(path)) return [skip(name, `${FLEET_FILE} not found`), revision];
  const fleet = parseFleetGithub(ctx.readFile(path));
  if (!fleet.configured) {
    return [skip(name, `not deployed: ${FLEET_FILE} still has TODO placeholders for its GitHub registration`), revision];
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
