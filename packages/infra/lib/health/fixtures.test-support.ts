/** Fake ports for health-check tests: a healthy platform unless a test says otherwise. */
import type { InfraConfig } from "../schema.js";
import { DEFAULT_HEALTH_OPTIONS, type HealthContext, type KvDocument } from "./context.js";

export const NOW = new Date("2026-10-11T00:00:00Z");

export const CONFIG: InfraConfig = {
  zone: "example.dev",
  image_owner: "acme",
  image_prefix: "ex",
  default_image_tag: "latest",
  railway: { project: "P", environment: "production", region: "us-west2" },
  github: {
    org: "acme",
    infra_repo: "acme/workspace",
    repositories: { app: { default_branch: "main", actions_secrets: ["DOCKER_PASSWORD"] } },
    pr_ready: { repo_settings: { default_branch: "main" }, ruleset: { name: "main", enforcement: "active" } },
  },
  cloudflare: {
    dns_settings: { nameservers: { type: "cloudflare.standard" } },
    redirects: [{ from: "example.dev", to_service: "web", status: 301 }],
    dns: {
      records: {
        legacy: { name: "legacy.example.dev", type: "A", content: "203.0.113.7", proxied: false },
        mail: { name: "mail.example.dev", type: "MX", content: "mx.example.net", proxied: false, priority: 10 },
        llm: { name: "llm.example.dev", type: "CNAME", content: "abc.cfargotunnel.com", proxied: true },
      },
    },
  },
  vault: {
    hostname: "vault.example.dev",
    kv: { mount: "secret", project: "personal", configs: ["dev", "prd"] },
    init: { key_shares: 3, key_threshold: 2 },
    policies: [{ name: "ci-read", file: "policies/ci-read.hcl" }],
    auth: {
      jwt: { path: "jwt", roles: [{ name: "github-actions", policy: "ci-read", user_claim: "actor", no_default_policy: true }] },
      userpass: { users: [{ username: "admin", policy: "ci-read" }] },
    },
    kv_keys: [{ name: "TURBO_TOKEN", configs: ["dev", "prd"], required: true }],
  },
  postgres: {
    projects: [
      {
        id: "openbao",
        purpose: "openbao-storage",
        secret_name: "DB_CONNECTION_URI",
        application_secret: "DATABASE_URL",
        organization: "example",
        name: "personal",
        branch: "main",
        region: "us-east",
        cluster_size: "PS_5_AWS_ARM",
        major_version: "18",
        replicas: 0,
        role_name: "owner",
        inherited_roles: ["postgres"],
      },
    ],
  },
  object_stores: [
    {
      id: "production",
      provider: "r2",
      bucket: "acme-production",
      bucket_secret: "S3_BUCKET",
      endpoint_secret: "S3_ENDPOINT",
      region_secret: "S3_REGION",
      access_key_secret: "S3_ACCESS_KEY_ID",
      secret_key_secret: "S3_SECRET_ACCESS_KEY",
      namespaces: ["prd"],
    },
  ],
  tunnels: [
    { id: "router", provider: "cloudflare", name: "router", hostname: "router.example.dev", local: { host: "127.0.0.1", port: 1 }, secrets: ["ROUTER_PASSWORD"] },
  ],
  services: [
    {
      id: "web",
      hostname: "www.example.dev",
      github_repo: "acme/app",
      source_code_url: "https://github.com/acme/app",
      dockerfile: "./Dockerfile",
      build_context: ".",
      port: 80,
      health_check: true,
      secrets: [{ name: "DATABASE_URL", source: "vault" }],
    },
    {
      id: "turborepo",
      hostname: "turborepo.example.dev",
      github_repo: "acme/workspace",
      source_code_url: "https://github.com/acme/workspace",
      dockerfile: "./Dockerfile",
      build_context: ".",
      port: 8080,
      health_check: true,
      health_path: "/health",
      railway: { sleep: false },
    },
    { id: "router", kind: "tunnel", hostname: "router.example.dev" },
  ],
};

export const PRD_KV: KvDocument = {
  TURBO_TOKEN: "turbo-token",
  TURBO_API: "https://turborepo.example.dev",
  DATABASE_URL: "postgres://user:hunter2@db.example.net/app",
  ROUTER_PASSWORD: "router-password",
  S3_BUCKET: "acme-production",
  S3_ENDPOINT: "https://account.r2.example",
  S3_REGION: "auto",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

export type Route = { readonly status?: number; readonly body?: unknown; readonly headers?: Record<string, string> };
export type Routes = Readonly<Record<string, Route | Error>>;

/** Serves `routes` by URL (query string optional); unrouted URLs answer 200 `{}`. */
export function fakeFetch(routes: Routes, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const route = routes[url] ?? routes[url.split("?")[0] as string] ?? {};
    if (route instanceof Error) throw route;
    // A null-body status (a HEAD answer or redirect) cannot carry a body.
    const status = route.status ?? 200;
    const body = status === 204 || status === 304 || (status >= 300 && status < 400) ? null :
      route.headers?.['content-type'] === 'text/plain' && typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {});
    return new Response(body, { status, headers: route.headers ?? {} });
  }) as typeof fetch;
}

const notFound = (): never => {
  throw Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });
};

export function fakeContext(overrides: Partial<HealthContext> = {}): HealthContext {
  return {
    config: CONFIG,
    repoRoot: "/repo",
    env: {},
    options: { ...DEFAULT_HEALTH_OPTIONS, retries: 0, retryDelayMs: 0 },
    now: () => NOW,
    fetch: fakeFetch({}),
    dns: {
      resolve4: async (name) => (name === "legacy.example.dev" ? ["203.0.113.7"] : ["192.0.2.10"]),
      resolveCname: async () => ["edge.up.railway.app"],
      resolveNs: async () => ["a.ns.cloudflare.com", "b.ns.cloudflare.com"],
      resolveTxt: async () => notFound(),
      resolveMx: async () => [{ exchange: "mx.example.net", priority: 10 }],
    },
    certificate: async () => ({ validTo: new Date("2027-01-01T00:00:00Z"), authorized: true }),
    listBucket: async () => [],
    sqlPing: async () => undefined,
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fileExists: () => true,
    readFile: () => "",
    vaultToken: () => "vault-token",
    githubToken: () => "github-token",
    kv: async (config) => (config === "prd" ? { ok: true, data: PRD_KV } : { ok: true, data: { TURBO_TOKEN: "dev" } }),
    ...overrides,
  };
}

export function statusOf(results: readonly { name: string; status: string }[], name: string): string | undefined {
  return results.find((result) => result.name === name)?.status;
}
