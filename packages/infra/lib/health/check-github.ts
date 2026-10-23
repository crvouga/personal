/**
 * GitHub control plane the deploy pipeline depends on: repositories, publisher
 * workflows, dispatch secrets, the merge gate and the last production run.
 * Full settings drift is the OpenTofu plan's job; these are the load-bearing parts.
 */
import type { GithubMergeGateConfig, InfraConfig } from "../schema.js";
import { infraGithubRepo } from "../services.js";
import { asRecord, asStrings, errorMessage, getJson, mapLimit, type HealthContext, type JsonResponse } from "./context.js";
import { fail, pass, skip, warn, type CheckResult } from "./report.js";
import { missingFrom } from "./targets.js";

const API = "https://api.github.com";
const CONCURRENCY = 6;
const PUBLISHER_PATH = ".github/workflows/publish.yml";
const DISPATCH_SECRET = "DEPLOY_DISPATCH_TOKEN";
const MIGRATION_VARIABLE = "TOFU_MIGRATION_READY";
const PIPELINE_WORKFLOWS = ["ci.yml", "deploy.yml"];

export type GithubApi = (path: string) => Promise<JsonResponse>;

export function githubApi(ctx: HealthContext, token: string): GithubApi {
  return (path) =>
    getJson(ctx, `${API}${path}`, {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
}

/** GitHub answers 403 or 404 when a token lacks the scope to see a resource. */
const hidden = (status: number): boolean => status === 403 || status === 404;

async function guarded(name: string, probe: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await probe();
  } catch (err) {
    return fail(name, errorMessage(err));
  }
}

type ManagedRepo = {
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly publisherPath: string;
  readonly application: boolean;
  readonly secrets: readonly string[];
  readonly hostsService: boolean;
};

export function managedRepositories(config: InfraConfig): readonly ManagedRepo[] {
  const infraRepo = infraGithubRepo(config);
  const org = config.github?.org ?? (infraRepo.split("/")[0] as string);
  const hosting = new Set(config.services.flatMap((service) => (service.github_repo ? [service.github_repo] : [])));
  const applications = Object.entries(config.github?.repositories ?? {}).map(([name, spec]) => ({
    fullName: `${org}/${name}`,
    defaultBranch: spec.default_branch,
    publisherPath: spec.publisher_file ?? PUBLISHER_PATH,
    application: true,
    secrets: spec.actions_secrets ?? [],
    hostsService: hosting.has(`${org}/${name}`),
  }));
  return [
    {
      fullName: infraRepo,
      defaultBranch: config.github?.pr_ready?.repo_settings.default_branch ?? "main",
      publisherPath: PUBLISHER_PATH,
      application: false,
      secrets: [],
      hostsService: hosting.has(infraRepo),
    },
    ...applications,
  ];
}

function checkRepository(api: GithubApi, repo: ManagedRepo): Promise<CheckResult> {
  const name = `repo ${repo.fullName}`;
  return guarded(name, async () => {
    const res = await api(`/repos/${repo.fullName}`);
    if (res.status === 404) return fail(name, "repository not found");
    if (res.status !== 200) return fail(name, `HTTP ${res.status}`);
    const body = asRecord(res.body);
    if (body["archived"] === true) return fail(name, "repository is archived");
    return body["default_branch"] === repo.defaultBranch
      ? pass(name, `default branch ${repo.defaultBranch}`)
      : fail(name, `default branch is ${String(body["default_branch"])}, inventory declares ${repo.defaultBranch}`);
  });
}

function checkPublisher(api: GithubApi, repo: ManagedRepo): Promise<CheckResult> {
  const name = `publisher ${repo.fullName}`;
  return guarded(name, async () => {
    const res = await api(`/repos/${repo.fullName}/contents/${repo.publisherPath}?ref=${encodeURIComponent(repo.defaultBranch)}`);
    if (res.status === 200) return pass(name, `${repo.publisherPath} on ${repo.defaultBranch}`);
    return fail(name, res.status === 404 ? `${repo.publisherPath} is missing on ${repo.defaultBranch}` : `HTTP ${res.status}`);
  });
}

/** Declared application secrets may be legitimately absent; the dispatch secret may not. */
function checkSecrets(api: GithubApi, repo: ManagedRepo): Promise<CheckResult> {
  const name = `secrets ${repo.fullName}`;
  return guarded(name, async () => {
    const res = await api(`/repos/${repo.fullName}/actions/secrets?per_page=100`);
    if (hidden(res.status)) return skip(name, `token may not list Actions secrets (HTTP ${res.status})`);
    if (res.status !== 200) return fail(name, `HTTP ${res.status}`);
    const secrets = asRecord(res.body)["secrets"];
    const present = (Array.isArray(secrets) ? secrets : []).flatMap((secret) => asStrings([asRecord(secret)["name"]]));
    if (repo.hostsService && !present.includes(DISPATCH_SECRET)) {
      return fail(name, `${DISPATCH_SECRET} is not set, so this repository cannot trigger deploys`);
    }
    const absent = missingFrom(repo.secrets, present);
    return absent.length === 0
      ? pass(name, `${present.length} secret(s) set`)
      : warn(name, `declared but not set: ${absent.join(", ")}`);
  });
}

function checkMigrationVariable(api: GithubApi, infraRepo: string): Promise<CheckResult> {
  const name = `variable ${MIGRATION_VARIABLE}`;
  return guarded(name, async () => {
    const res = await api(`/repos/${infraRepo}/actions/variables/${MIGRATION_VARIABLE}`);
    if (res.status === 403) return skip(name, "token may not read Actions variables (HTTP 403)");
    if (res.status === 404) return fail(name, "not set; CI refuses every OpenTofu apply until it is true");
    if (res.status !== 200) return fail(name, `HTTP ${res.status}`);
    const value = asRecord(res.body)["value"];
    return value === "true" ? pass(name, "true") : fail(name, `is ${String(value)}; CI refuses every OpenTofu apply`);
  });
}

function checkRuleset(api: GithubApi, infraRepo: string, declared: GithubMergeGateConfig["ruleset"]): Promise<CheckResult> {
  const name = `ruleset ${declared.name}`;
  return guarded(name, async () => {
    const res = await api(`/repos/${infraRepo}/rulesets?per_page=100`);
    if (res.status === 403) return skip(name, "token may not list rulesets (HTTP 403)");
    if (res.status !== 200) return fail(name, `HTTP ${res.status}`);
    const live = (Array.isArray(res.body) ? res.body : []).map(asRecord).find((ruleset) => ruleset["name"] === declared.name);
    if (!live) return fail(name, "ruleset not found; the default branch is unprotected");
    return live["enforcement"] === declared.enforcement
      ? pass(name, `enforcement ${declared.enforcement}`)
      : fail(name, `enforcement is ${String(live["enforcement"])}, inventory declares ${declared.enforcement}`);
  });
}

/** The newest finished non-PR run is the last time production was reconciled. */
function checkPipeline(api: GithubApi, infraRepo: string, branch: string, workflow: string): Promise<CheckResult> {
  const name = `pipeline ${workflow}`;
  return guarded(name, async () => {
    const res = await api(
      `/repos/${infraRepo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=20`,
    );
    if (hidden(res.status)) return skip(name, `token may not read workflow runs (HTTP ${res.status})`);
    if (res.status !== 200) return fail(name, `HTTP ${res.status}`);
    const runs = asRecord(res.body)["workflow_runs"];
    const events = workflow === "ci.yml" ? ["push"] : ["schedule", "workflow_dispatch", "repository_dispatch"];
    const run = (Array.isArray(runs) ? runs : []).map(asRecord).find((candidate) => events.includes(String(candidate["event"])));
    if (!run) return warn(name, `no completed run on ${branch}`);
    const label = `run #${String(run["run_number"])} (${String(run["event"])}, ${String(run["updated_at"])})`;
    if (run["conclusion"] === "success") return pass(name, `${label} succeeded`);
    if (run["conclusion"] === "failure") return fail(name, `${label} failed: ${String(run["html_url"])}`);
    return warn(name, `${label} ended ${String(run["conclusion"])}: ${String(run["html_url"])}`);
  });
}

export async function checkGithub(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const token = ctx.githubToken();
  if (!token) return [skip("github", "no GitHub token: set GH_TOKEN or run `gh auth login`")];
  const api = githubApi(ctx, token);
  // A rejected token would fail every check below for a reason that is not the platform's.
  try {
    const probe = await api("/rate_limit");
    if (probe.status === 401) return [skip("github", "GitHub token rejected (HTTP 401); run `gh auth login`")];
  } catch (err) {
    return [fail("github", `${API} is unreachable: ${errorMessage(err)}`)];
  }
  const infraRepo = infraGithubRepo(ctx.config);
  const repos = managedRepositories(ctx.config);
  const workspace = repos[0] as ManagedRepo;
  const ruleset = ctx.config.github?.pr_ready?.ruleset;
  const probes: (() => Promise<CheckResult>)[] = [
    ...repos.map((repo) => () => checkRepository(api, repo)),
    ...repos.filter((repo) => repo.application).map((repo) => () => checkPublisher(api, repo)),
    ...repos.filter((repo) => repo.hostsService || repo.secrets.length > 0).map((repo) => () => checkSecrets(api, repo)),
    () => checkMigrationVariable(api, infraRepo),
    ...(ruleset ? [() => checkRuleset(api, infraRepo, ruleset)] : []),
    ...PIPELINE_WORKFLOWS.map((workflow) => () => checkPipeline(api, infraRepo, workspace.defaultBranch, workflow)),
  ];
  return mapLimit(probes, CONCURRENCY, (probe) => probe());
}
