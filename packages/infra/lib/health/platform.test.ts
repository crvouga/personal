import { describe, expect, test } from "bun:test";
import { loadServicesConfig } from "../services.js";
import { checkDrift, judgePlan, summarizePlan } from "./check-drift.js";
import { checkGithub } from "./check-github.js";
import { checkRunners, parseFleetGithub } from "./check-runners.js";
import { checkStorage } from "./check-storage.js";
import { checkVault, requiredKvKeys } from "./check-vault.js";
import type { CommandResult } from "./context.js";
import { PRD_KV, fakeContext, fakeFetch, statusOf, type Routes } from "./fixtures.test-support.js";
import { renderMarkdown, renderText, reportExitCode, fail, pass, skip, warn, type HealthReport } from "./report.js";
import { HEALTH_GROUPS, runHealth, selectGroups } from "./run.js";

const VAULT = "https://vault.example.dev/v1";
const GITHUB = "https://api.github.com";
const statuses = (results: readonly { status: string }[]): string[] => [...new Set(results.map((result) => result.status))];

const SEAL = { initialized: true, sealed: false, t: 2, n: 3, version: "2.7.0", storage_type: "postgresql" };
const vaultRoutes: Routes = {
  [`${VAULT}/sys/seal-status`]: { body: SEAL },
  [`${VAULT}/auth/token/lookup-self`]: { body: { data: { policies: ["admin"], ttl: 172800 } } },
  [`${VAULT}/sys/mounts`]: { body: { data: { "secret/": { type: "kv", options: { version: "2" } } } } },
  [`${VAULT}/sys/policies/acl`]: { body: { data: { keys: ["ci-read", "default"] } } },
  [`${VAULT}/sys/auth`]: { body: { data: { "jwt/": { type: "jwt" }, "userpass/": { type: "userpass" } } } },
  [`${VAULT}/auth/jwt/role/github-actions`]: {
    body: { data: { token_policies: ["ci-read"], bound_audiences: ["https://vault.example.dev"] } },
  },
  [`${VAULT}/auth/userpass/users`]: { body: { data: { keys: ["admin"] } } },
};

describe("vault", () => {
  test("a correctly configured Vault passes every check", async () => {
    const results = await checkVault(fakeContext({ fetch: fakeFetch(vaultRoutes) }));
    expect(statuses(results)).toEqual(["pass"]);
    expect(results.map((result) => result.name)).toContain("kv personal/prd");
  });

  test("a sealed Vault fails and nothing behind the seal is reported as checked", async () => {
    const results = await checkVault(
      fakeContext({ fetch: fakeFetch({ ...vaultRoutes, [`${VAULT}/sys/seal-status`]: { body: { ...SEAL, sealed: true } } }) }),
    );
    expect(statusOf(results, "seal")).toBe("fail");
    expect(results.map((result) => result.name)).not.toContain("token");
  });

  test("an unreachable Vault fails", async () => {
    const results = await checkVault(fakeContext({ fetch: fakeFetch({ [`${VAULT}/sys/seal-status`]: new Error("timeout") }) }));
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("fail");
  });

  test("without a token the configuration is skipped, never passed", async () => {
    const results = await checkVault(fakeContext({ fetch: fakeFetch(vaultRoutes), vaultToken: () => undefined }));
    expect(statusOf(results, "seal")).toBe("pass");
    expect(statusOf(results, "configuration")).toBe("skip");
  });

  test("a read-only token skips what it cannot see and still checks KV", async () => {
    const results = await checkVault(
      fakeContext({ fetch: fakeFetch({ ...vaultRoutes, [`${VAULT}/sys/mounts`]: { status: 403 }, [`${VAULT}/sys/auth`]: { status: 403 } }) }),
    );
    expect(statusOf(results, "kv mount")).toBe("skip");
    expect(statusOf(results, "auth backends")).toBe("skip");
    expect(statusOf(results, "kv personal/prd")).toBe("pass");
  });

  test("drifted configuration fails: share count, policy, role audience, missing key", async () => {
    const { DATABASE_URL: _removed, ...withoutDatabase } = PRD_KV;
    const results = await checkVault(
      fakeContext({
        kv: async () => ({ ok: true, data: withoutDatabase }),
        fetch: fakeFetch({
          ...vaultRoutes,
          [`${VAULT}/sys/seal-status`]: { body: { ...SEAL, t: 1, n: 1 } },
          [`${VAULT}/sys/policies/acl`]: { body: { data: { keys: ["default"] } } },
          [`${VAULT}/auth/jwt/role/github-actions`]: { body: { data: { token_policies: ["ci-read"], bound_audiences: ["other"] } } },
        }),
      }),
    );
    for (const name of ["seal shares", "policies", "jwt role github-actions", "kv personal/prd"]) {
      expect(statusOf(results, name)).toBe("fail");
    }
    expect(results.find((result) => result.name === "kv personal/prd")!.detail).toContain("DATABASE_URL");
  });

  test("production must hold every key the committed inventory feeds to services, tunnels and stores", () => {
    const keys = requiredKvKeys(loadServicesConfig(), "prd");
    expect(keys).toEqual(expect.arrayContaining(["TURBO_TOKEN", "DATABASE_URL", "S3_BUCKET", "9ROUTER_PASSWORD", "VAULT_TOKEN"]));
    expect(keys).not.toContain("GITHUB_TOKEN_SUPER");
    for (const environment of ["dev", "prd"]) {
      expect(requiredKvKeys(loadServicesConfig(), environment)).toEqual(expect.arrayContaining(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]));
    }
    expect(requiredKvKeys(loadServicesConfig(), "dev")).not.toContain("DATABASE_URL");
  });
});

describe("storage", () => {
  const routes: Routes = {
    [`${VAULT}/sys/seal-status`]: { body: SEAL },
    "https://turborepo.example.dev/v8/artifacts/status": { body: { status: "enabled" } },
    "https://turborepo.example.dev/nix/nix-cache-info": { body: "StoreDir: /nix/store\n", headers: { 'content-type': 'text/plain' } },
  };

  test("buckets, PostgreSQL, databases and the cache pass when reachable", async () => {
    const results = await checkStorage(fakeContext({ fetch: fakeFetch(routes) }));
    expect(results.map((result) => [result.name, result.status])).toEqual([
      ["bucket acme-production (prd)", "pass"],
      ["postgres openbao", "pass"],
      ["database DATABASE_URL", "pass"],
      ["remote cache", "pass"],
      ["Fleet Nix cache", "pass"],
    ]);
  });

  test("without Vault secrets every credentialed check skips", async () => {
    const results = await checkStorage(
      fakeContext({ fetch: fakeFetch(routes), kv: async () => ({ ok: false, unverifiable: true, reason: "no Vault token" }) }),
    );
    expect(statusOf(results, "bucket acme-production (prd)")).toBe("skip");
    expect(statusOf(results, "database DATABASE_URL")).toBe("skip");
    expect(statusOf(results, "remote cache")).toBe("skip");
    expect(statusOf(results, "postgres openbao")).toBe("pass");
  });

  test("rejected credentials, a wrong bucket and a dead database fail without leaking the URL", async () => {
    const results = await checkStorage(
      fakeContext({
        fetch: fakeFetch({ ...routes, "https://turborepo.example.dev/v8/artifacts/status": { status: 401 } }),
        kv: async () => ({ ok: true, data: { ...PRD_KV, S3_BUCKET: "someone-elses" } }),
        sqlPing: async () => {
          throw new Error("connection refused");
        },
      }),
    );
    expect(statuses(results.filter((result) => !result.name.startsWith("postgres") && result.name !== "Fleet Nix cache"))).toEqual(["fail"]);
    const database = results.find((result) => result.name === "database DATABASE_URL")!;
    expect(database.detail).toBe("connection failed: connection refused");
  });

  test("a document Vault cannot serve fails; one this token may not read skips", async () => {
    const broken = await checkStorage(
      fakeContext({ fetch: fakeFetch(routes), kv: async () => ({ ok: false, unverifiable: false, reason: "HTTP 404" }) }),
    );
    expect(statusOf(broken, "remote cache")).toBe("fail");
    const vault = await checkVault(
      fakeContext({ fetch: fakeFetch(vaultRoutes), kv: async () => ({ ok: false, unverifiable: true, reason: "HTTP 403" }) }),
    );
    expect(statusOf(vault, "kv personal/prd")).toBe("skip");
  });

  test("a failing bucket list fails the bucket", async () => {
    const results = await checkStorage(
      fakeContext({
        fetch: fakeFetch(routes),
        listBucket: async () => {
          throw new Error("AccessDenied");
        },
      }),
    );
    expect(statusOf(results, "bucket acme-production (prd)")).toBe("fail");
  });
});

describe("github", () => {
  const routes: Routes = {
    [`${GITHUB}/repos/acme/workspace`]: { body: { default_branch: "main", archived: false } },
    [`${GITHUB}/repos/acme/app`]: { body: { default_branch: "main", archived: false } },
    [`${GITHUB}/repos/acme/workspace/actions/secrets`]: { body: { secrets: [{ name: "DEPLOY_DISPATCH_TOKEN" }] } },
    [`${GITHUB}/repos/acme/app/actions/secrets`]: {
      body: { secrets: [{ name: "DEPLOY_DISPATCH_TOKEN" }, { name: "DOCKER_PASSWORD" }] },
    },
    [`${GITHUB}/repos/acme/workspace/actions/variables/TOFU_MIGRATION_READY`]: { body: { value: "true" } },
    [`${GITHUB}/repos/acme/workspace/rulesets`]: { body: [{ name: "main", enforcement: "active" }] },
    [`${GITHUB}/repos/acme/workspace/actions/workflows/deploy.yml/runs`]: { body: { workflow_runs: [{ event: "workflow_dispatch", conclusion: "success", run_number: 1, updated_at: "2026-10-10T00:00:00Z" }] } },
    [`${GITHUB}/repos/acme/workspace/actions/workflows/ci.yml/runs`]: {
      body: {
        workflow_runs: [
          { event: "pull_request", conclusion: "failure", run_number: 9 },
          { event: "push", conclusion: "success", run_number: 8, updated_at: "2026-10-10T00:00:00Z" },
        ],
      },
    },
  };

  test("a healthy control plane passes; PR runs do not decide pipeline health", async () => {
    const results = await checkGithub(fakeContext({ fetch: fakeFetch(routes) }));
    expect(statuses(results)).toEqual(["pass"]);
    expect(results.find((result) => result.name === "pipeline ci.yml")!.detail).toContain("run #8");
  });

  test("manual Deploy failures remain visible when main CI is green", async () => {
    const results = await checkGithub(fakeContext({ fetch: fakeFetch({ ...routes,
      [`${GITHUB}/repos/acme/workspace/actions/workflows/deploy.yml/runs`]: { body: { workflow_runs: [{ event: "workflow_dispatch", conclusion: "failure", run_number: 2, html_url: "https://example/deploy/2" }] } },
    }) }));
    expect(statusOf(results, "pipeline ci.yml")).toBe("pass");
    expect(statusOf(results, "pipeline deploy.yml")).toBe("fail");
  });

  test("merge queue and validation-only dispatches do not count as production CI", async () => {
    const results = await checkGithub(fakeContext({ fetch: fakeFetch({ ...routes,
      [`${GITHUB}/repos/acme/workspace/actions/workflows/ci.yml/runs`]: { body: { workflow_runs: [{ event: "merge_group", conclusion: "success" }, { event: "workflow_dispatch", conclusion: "success" }] } },
    }) }));
    expect(statusOf(results, "pipeline ci.yml")).toBe("warn");
  });

  test("publisher probes follow the repository's declared workflow path", async () => {
    const ctx = fakeContext({ fetch: fakeFetch({
      ...routes,
      [`${GITHUB}/repos/acme/app/contents/.github/workflows/publish.yml`]: { status: 404 },
      [`${GITHUB}/repos/acme/app/contents/.github/workflows/publish-image.yml`]: { status: 200 },
    }) });
    const config = { ...ctx.config, github: { ...ctx.config.github!,
      repositories: { app: { default_branch: "main", publisher_file: ".github/workflows/publish-image.yml" } },
    } };
    const results = await checkGithub({ ...ctx, config });
    expect(statusOf(results, "publisher acme/app")).toBe("pass");
    expect(results.find(result => result.name === "publisher acme/app")!.detail).toContain("publish-image.yml");
  });

  test("without a token, or with a rejected one, everything is skipped", async () => {
    const results = await checkGithub(fakeContext({ githubToken: () => undefined }));
    expect(results.map((result) => result.status)).toEqual(["skip"]);
    const rejected = await checkGithub(fakeContext({ fetch: fakeFetch({ [`${GITHUB}/rate_limit`]: { status: 401 } }) }));
    expect(rejected.map((result) => result.status)).toEqual(["skip"]);
  });

  test("broken wiring fails: branch, publisher, dispatch secret, migration gate, ruleset, pipeline", async () => {
    const results = await checkGithub(
      fakeContext({
        fetch: fakeFetch({
          ...routes,
          [`${GITHUB}/repos/acme/app`]: { body: { default_branch: "master", archived: false } },
          [`${GITHUB}/repos/acme/app/contents/.github/workflows/publish.yml`]: { status: 404 },
          [`${GITHUB}/repos/acme/app/actions/secrets`]: { body: { secrets: [{ name: "DOCKER_PASSWORD" }] } },
          [`${GITHUB}/repos/acme/workspace/actions/variables/TOFU_MIGRATION_READY`]: { body: { value: "false" } },
          [`${GITHUB}/repos/acme/workspace/rulesets`]: { body: [] },
          [`${GITHUB}/repos/acme/workspace/actions/workflows/ci.yml/runs`]: {
            body: { workflow_runs: [{ event: "push", conclusion: "failure", run_number: 7, html_url: "https://example/7" }] },
          },
        }),
      }),
    );
    for (const name of [
      "repo acme/app",
      "publisher acme/app",
      "secrets acme/app",
      "variable TOFU_MIGRATION_READY",
      "ruleset main",
      "pipeline ci.yml",
    ]) {
      expect(statusOf(results, name)).toBe("fail");
    }
  });

  test("an absent optional secret warns; a token that cannot list secrets skips", async () => {
    const warned = await checkGithub(
      fakeContext({
        fetch: fakeFetch({ ...routes, [`${GITHUB}/repos/acme/app/actions/secrets`]: { body: { secrets: [{ name: "DEPLOY_DISPATCH_TOKEN" }] } } }),
      }),
    );
    expect(statusOf(warned, "secrets acme/app")).toBe("warn");
    const hidden = await checkGithub(
      fakeContext({ fetch: fakeFetch({ ...routes, [`${GITHUB}/repos/acme/app/actions/secrets`]: { status: 403 } }) }),
    );
    expect(statusOf(hidden, "secrets acme/app")).toBe("skip");
  });
});

describe("runners", () => {
  test("central JSON registration data is checked without parsing Nix code", () => {
    const registration = {
      scope: "repository", organization: "", repositories: ["acme/private"],
      runnerGroup: null, appId: "123", installationId: "456",
    };
    expect(parseFleetGithub(JSON.stringify(registration))).toEqual({
      configured: true, scope: "repository", organization: "", repositories: ["acme/private"],
    });
    expect(parseFleetGithub(JSON.stringify({ ...registration, installationId: "TODO" })).configured).toBe(false);
    expect(parseFleetGithub(JSON.stringify({ ...registration, repositories: [] })).configured).toBe(false);
  });
  const configured = JSON.stringify({
    scope: "repository", organization: "", repositories: ["acme/private"], appId: "1", installationId: "2",
  });
  const runner = (status: string, labels: string[]) => ({ status, labels: labels.map((name) => ({ name })) });

  test("the committed fleet definition is reported as not deployed until its placeholders are filled", () => {
    expect(parseFleetGithub(JSON.stringify({ scope: "organization", organization: "TODO" })).configured).toBe(false);
    expect(parseFleetGithub(configured)).toEqual({
      configured: true,
      scope: "repository",
      organization: "",
      repositories: ["acme/private"],
    });
  });

  test("an unconfigured fleet skips", async () => {
    const results = await checkRunners(fakeContext({ readFile: () => JSON.stringify({ appId: "TODO" }) }));
    expect(results.map((result) => result.status)).toEqual(["skip", "skip"]);
    expect(results[1]).toMatchObject({ name: "fleet revision", status: "skip" });
  });

  test("only runners carrying the fleet labels count, and one must be online", async () => {
    const url = `${GITHUB}/repos/acme/private/actions/runners`;
    const online = await checkRunners(
      fakeContext({
        readFile: () => configured,
        fetch: fakeFetch({ [url]: { body: { runners: [runner("online", ["nixos", "ci"]), runner("offline", ["nixos", "ci"])] } } }),
      }),
    );
    expect(online[0]).toMatchObject({ status: "pass", detail: "1 of 2 fleet runner(s) online" });
    const offline = await checkRunners(
      fakeContext({
        readFile: () => configured,
        fetch: fakeFetch({ [url]: { body: { runners: [runner("offline", ["nixos", "ci"]), runner("online", ["self-hosted"])] } } }),
      }),
    );
    expect(offline[0]!.status).toBe("fail");
  });
});

describe("drift", () => {
  const plan = (lines: object[]): string => lines.map((line) => JSON.stringify(line)).join("\n");
  const changed = plan([
    { type: "version" },
    { type: "planned_change", change: { action: "update", resource: { addr: "railway_service.this" } } },
    { type: "planned_change", change: { action: "noop", resource: { addr: "cloudflare_zone.primary" } } },
    { type: "outputs", outputs: { secret: { sensitive: true, value: "hunter2" } } },
  ]);

  test("a plan is summarized by address and action only", () => {
    expect(summarizePlan(changed)).toEqual({ changes: ["railway_service.this (update)"], errors: [] });
    expect(JSON.stringify(judgePlan("fleet", { code: 2, stdout: changed, stderr: "" }))).not.toContain("hunter2");
  });

  test("exit code 0 passes, 2 is drift, anything else is an error", () => {
    expect(judgePlan("fleet", { code: 0, stdout: "", stderr: "" }).status).toBe("pass");
    expect(judgePlan("fleet", { code: 2, stdout: changed, stderr: "" })).toMatchObject({
      status: "fail",
      detail: "1 pending change(s): railway_service.this (update)",
    });
    const errored = plan([{ type: "diagnostic", "@level": "error", diagnostic: { summary: "Invalid credentials" } }]);
    expect(judgePlan("fleet", { code: 1, stdout: errored, stderr: "" }).detail).toContain("Invalid credentials");
  });

  test("plans are opt-in and skip, never pass, when not requested or not initialized", async () => {
    expect(statusOf(await checkDrift(fakeContext()), "plan")).toBe("skip");
    const ctx = fakeContext({ fileExists: () => false, env: { TF_VAR_state_passphrase: "x" } });
    const results = await checkDrift({ ...ctx, options: { ...ctx.options, drift: true } });
    expect(results.map((result) => result.status)).toEqual(["skip", "skip", "skip", "skip", "skip"]);
  });

  test("each root is planned read-only, unlocked and serially, preserving deployed image revisions", async () => {
    const calls: { args: readonly string[]; env: Readonly<Record<string, string | undefined>> }[] = [];
    let running = 0;
    const run = async (_command: string, args: readonly string[], options?: { env?: Record<string, string | undefined> }): Promise<CommandResult> => {
      expect(++running).toBe(1);
      await Promise.resolve();
      running--;
      calls.push({ args, env: options?.env ?? {} });
      if (args.includes("output")) return { code: 0, stdout: args.includes("image_tags") ? '{"web":"abc"}\n' : "v1\n", stderr: "" };
      return { code: args.some((arg) => arg.endsWith("/fleet")) ? 2 : 0, stdout: changed, stderr: "" };
    };
    const ctx = fakeContext({
      run,
      env: { TF_VAR_state_passphrase: "x", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" },
      readFile: () => JSON.stringify({ bucket: "state", region: "auto", endpoints: { s3: "https://r2.example" } }),
      listBucket: async () => ["foundation.tfstate", "bootstrap.tfstate", "vault.tfstate"],
    });
    const results = await checkDrift({ ...ctx, options: { ...ctx.options, drift: true } });

    expect(results.map((result) => [result.name, result.status])).toEqual([
      ["state bucket", "fail"],
      ["plan foundation", "pass"],
      ["plan bootstrap", "pass"],
      ["plan vault", "pass"],
      ["plan fleet", "fail"],
    ]);
    expect(results[0]!.detail).toContain("fleet.tfstate");
    const plans = calls.filter((call) => call.args.includes("plan"));
    expect(plans).toHaveLength(4);
    for (const call of plans) {
      expect(call.args).toEqual(expect.arrayContaining(["-lock=false", "-detailed-exitcode", "-parallelism=1", "-input=false"]));
      expect(call.args.some((arg) => arg === "apply" || arg.startsWith("-out"))).toBe(false);
    }
    expect(plans[0]!.env["TF_VAR_vault_image_tag"]).toBe("v1");
    // turborepo is in the inventory but not yet deployed: it takes the default tag.
    expect(JSON.parse(plans[3]!.env["TF_VAR_image_tags"]!)).toEqual({ web: "abc", turborepo: "latest" });
  });
});

describe("report", () => {
  const report: HealthReport = {
    zone: "example.dev",
    startedAt: "2026-10-11T00:00:00.000Z",
    durationMs: 1234,
    groups: [
      { id: "a", title: "Alpha", durationMs: 1, results: [pass("one", "fine"), warn("two", "slow")] },
      { id: "b", title: "Beta", durationMs: 1, results: [skip("three", "no token")] },
    ],
  };
  const broken: HealthReport = { ...report, groups: [{ id: "c", title: "Gamma", durationMs: 1, results: [fail("four", "a | b")] }] };

  test("failures exit 1; warnings and skips only under --strict", () => {
    expect(reportExitCode(report, false)).toBe(0);
    expect(reportExitCode(report, true)).toBe(1);
    expect(reportExitCode(broken, false)).toBe(1);
  });

  test("text hides passes unless verbose and always shows what needs attention", () => {
    const quiet = renderText(report, { verbose: false, color: false });
    expect(quiet).toContain("! Alpha  1 pass · 1 warn");
    expect(quiet).toContain("! two — slow");
    expect(quiet).toContain("– three — no token");
    expect(quiet).not.toContain("one — fine");
    expect(quiet).toContain("DEGRADED, 1 NOT CHECKED");
    expect(renderText(report, { verbose: true, color: false })).toContain("✓ one — fine");
    expect(renderText(broken, { verbose: false, color: false })).toContain("UNHEALTHY");
  });

  test("markdown lists attention items and escapes table cells", () => {
    expect(renderMarkdown(report)).toContain("### Needs attention");
    expect(renderMarkdown(broken)).toContain("a \\| b");
  });
});

describe("runner", () => {
  test("a crashing group becomes a failed check instead of aborting the report", async () => {
    const report = await runHealth(fakeContext(), [
      { id: "boom", title: "Boom", covers: "", run: async () => { throw new Error("kaboom"); } },
      { id: "ok", title: "Ok", covers: "", run: async () => [pass("fine", "yes")] },
    ]);
    expect(report.groups[0]!.results[0]).toMatchObject({ status: "fail", detail: "check crashed: kaboom" });
    expect(report.groups[1]!.results[0]!.status).toBe("pass");
  });

  test("groups are selectable and unknown ids are rejected", () => {
    expect(selectGroups([], []).length).toBe(HEALTH_GROUPS.length);
    expect(selectGroups(["vault", "dns"], ["dns"]).map((group) => group.id)).toEqual(["vault"]);
    expect(() => selectGroups(["nope"], [])).toThrow("Unknown health group");
  });
});
