import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadServicesConfig } from "../services.js";
import { checkDns } from "./check-dns.js";
import { checkImages, parseImageRef } from "./check-images.js";
import { checkInventory } from "./check-inventory.js";
import { checkServices, checkTunnels } from "./check-services.js";
import { checkTls } from "./check-tls.js";
import { CONFIG, NOW, fakeContext, fakeFetch, statusOf } from "./fixtures.test-support.js";
import { httpsHostnames, tunnelHostnames } from "./targets.js";

const statuses = (results: readonly { status: string }[]): string[] => [...new Set(results.map((result) => result.status))];

test("additional service domains are independently checked for DNS, TLS and readiness", async () => {
  const hostname = "www.application.app";
  const ctx = fakeContext({ config: {
    ...CONFIG,
    aliases: [{ hostname, service: "web", zone: "application.app" }],
  } });
  const broken = async (): Promise<never> => { throw new Error("alias unavailable"); };
  expect(httpsHostnames(ctx.config)).toContain(hostname);
  expect(statusOf(await checkDns({ ...ctx, dns: { ...ctx.dns, resolveCname: broken, resolve4: broken } }), `CNAME ${hostname}`)).toBe("fail");
  expect(statusOf(await checkTls({ ...ctx, certificate: broken }), hostname)).toBe("fail");
  expect(statusOf(await checkServices({ ...ctx, fetch: fakeFetch({ [`https://${hostname}/`]: { status: 503 } }) }), hostname)).toBe("fail");
});

describe("inventory", () => {
  test("the committed inventory is internally consistent", async () => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
    const results = await checkInventory(
      fakeContext({ config: loadServicesConfig(), repoRoot, fileExists: existsSync }),
    );
    expect(results.filter((result) => result.status !== "pass")).toEqual([]);
  });

  test("reports duplicate ids, foreign hostnames, dangling references and missing policy files", async () => {
    const web = CONFIG.services[0]!;
    const results = await checkInventory(
      fakeContext({
        fileExists: () => false,
        config: {
          ...CONFIG,
          cloudflare: { ...CONFIG.cloudflare, redirects: [{ from: "example.dev", to_service: "gone" }] },
          tunnels: [],
          services: [...CONFIG.services, { ...web, hostname: "www.elsewhere.io", github_repo: "stranger/app" }],
        },
      }),
    );
    for (const name of ["service ids unique", "hostnames in zone", "redirect targets", "tunnel services", "service repositories", "vault policies"]) {
      expect(statusOf(results, name)).toBe("fail");
    }
  });
});

describe("dns", () => {
  test("a healthy zone passes every record", async () => {
    expect(statuses(await checkDns(fakeContext()))).toEqual(["pass"]);
  });

  test("an unproxied record answering something else fails with both values", async () => {
    const ctx = fakeContext();
    const results = await checkDns({ ...ctx, dns: { ...ctx.dns, resolve4: async () => ["198.51.100.1"] } });
    const legacy = results.find((result) => result.name === "A legacy.example.dev")!;
    expect(legacy.status).toBe("fail");
    expect(legacy.detail).toContain("expected 203.0.113.7, got 198.51.100.1");
  });

  test("TXT content is compared case-sensitively and unchanged", async () => {
    const key = "p=MIGfMA0GCSqGSIb3DQEB/Zz";
    const ctx = fakeContext();
    const config = {
      ...ctx.config,
      cloudflare: {
        ...ctx.config.cloudflare,
        dns: { records: { dkim: { name: "k._domainkey.example.dev", type: "TXT" as const, content: key, proxied: false } } },
      },
    };
    const dns = (answer: string) => ({ ...ctx.dns, resolveTxt: async () => [answer] });
    const name = "TXT k._domainkey.example.dev";
    expect(statusOf(await checkDns({ ...ctx, config, dns: dns(key) }), name)).toBe("pass");
    expect(statusOf(await checkDns({ ...ctx, config, dns: dns(key.toLowerCase()) }), name)).toBe("fail");
  });

  test("foreign nameservers and unresolvable service hostnames fail", async () => {
    const ctx = fakeContext();
    const missing = async (): Promise<never> => {
      throw Object.assign(new Error("queryCname ENOTFOUND"), { code: "ENOTFOUND" });
    };
    const results = await checkDns({
      ...ctx,
      dns: { ...ctx.dns, resolveNs: async () => ["ns1.registrar.example"], resolveCname: missing, resolve4: missing },
    });
    expect(statusOf(results, "NS example.dev")).toBe("fail");
    expect(statusOf(results, "CNAME www.example.dev")).toBe("fail");
  });
});

describe("tls", () => {
  test("covers every public hostname, including tunnels and redirects", () => {
    expect([...httpsHostnames(CONFIG)].sort()).toEqual([
      "example.dev",
      "llm.example.dev",
      "router.example.dev",
      "turborepo.example.dev",
      "www.example.dev",
    ]);
  });

  test("expired fails, untrusted fails, near expiry warns", async () => {
    const day = 24 * 60 * 60 * 1000;
    const certificates: Record<string, { validTo: Date; authorized: boolean; error?: string }> = {
      "www.example.dev": { validTo: new Date(NOW.getTime() - day), authorized: false, error: "CERT_HAS_EXPIRED" },
      "turborepo.example.dev": { validTo: new Date(NOW.getTime() + 90 * day), authorized: false, error: "SELF_SIGNED" },
      "example.dev": { validTo: new Date(NOW.getTime() + 3 * day), authorized: true },
    };
    const results = await checkTls(
      fakeContext({
        certificate: async (hostname) => {
          if (hostname === "llm.example.dev") throw new Error("ECONNREFUSED");
          return certificates[hostname] ?? { validTo: new Date(NOW.getTime() + 90 * day), authorized: true };
        },
      }),
    );
    expect(statusOf(results, "www.example.dev")).toBe("fail");
    expect(statusOf(results, "turborepo.example.dev")).toBe("fail");
    expect(statusOf(results, "llm.example.dev")).toBe("fail");
    expect(statusOf(results, "example.dev")).toBe("warn");
    expect(statusOf(results, "router.example.dev")).toBe("pass");
  });
});

describe("services", () => {
  const redirect = { "https://example.dev/": { status: 301, headers: { location: "https://www.example.dev/" } } };

  test("healthy endpoints and the declared redirect pass", async () => {
    expect(statuses(await checkServices(fakeContext({ fetch: fakeFetch(redirect) })))).toEqual(["pass"]);
  });

  test("an unhealthy endpoint and a misdirected redirect fail", async () => {
    const results = await checkServices(
      fakeContext({
        fetch: fakeFetch({
          "https://turborepo.example.dev/health": { status: 503 },
          "https://www.example.dev/": new Error("connection refused"),
          "https://example.dev/": { status: 301, headers: { location: "https://elsewhere.example/" } },
        }),
      }),
    );
    expect(results.find((result) => result.name === "turborepo")).toMatchObject({ status: "fail" });
    expect(results.find((result) => result.name === "web")?.detail).toContain("connection refused");
    expect(statusOf(results, "redirect example.dev")).toBe("fail");
  });

  test("a service is retried before it is reported unhealthy", async () => {
    let calls = 0;
    const flaky = (async () => new Response("", { status: ++calls < 3 ? 500 : 200 })) as unknown as typeof fetch;
    const ctx = fakeContext({ config: { ...CONFIG, cloudflare: {}, services: [CONFIG.services[0]!] }, fetch: flaky });
    const results = await checkServices({ ...ctx, options: { ...ctx.options, retries: 2 } });
    expect(results[0]).toMatchObject({ name: "web", status: "pass" });
    expect(results[0]!.detail).toContain("attempt 3/3");
  });

  test.each([502, 503, 504])("an always-on service can recover from HTTP %i", async (status) => {
    let calls = 0;
    const recovering = (async () => new Response("", { status: ++calls === 1 ? status : 200 })) as unknown as typeof fetch;
    const ctx = fakeContext({ config: { ...CONFIG, cloudflare: {}, services: [CONFIG.services[1]!] }, fetch: recovering });
    const results = await checkServices({ ...ctx, options: { ...ctx.options, retries: 1 } });
    expect(results[0]).toMatchObject({ name: "turborepo", status: "pass" });
    expect(calls).toBe(2);
  });

  test("persistent gateway errors fail after the configured retries", async () => {
    let calls = 0;
    const unavailable = (async () => { calls++; return new Response("", { status: 502 }); }) as unknown as typeof fetch;
    const ctx = fakeContext({ config: { ...CONFIG, cloudflare: {}, services: [CONFIG.services[1]!] }, fetch: unavailable });
    const results = await checkServices({ ...ctx, options: { ...ctx.options, retries: 2 } });
    expect(results[0]).toMatchObject({ name: "turborepo", status: "fail" });
    expect(calls).toBe(3);
  });

  test("an offline tunnel connector warns; an unreachable edge fails", async () => {
    expect(tunnelHostnames(CONFIG)).toEqual(["llm.example.dev", "router.example.dev"]);
    const results = await checkTunnels(
      fakeContext({
        fetch: fakeFetch({ "https://router.example.dev/": { status: 530 }, "https://llm.example.dev/": new Error("ENOTFOUND") }),
      }),
    );
    expect(statusOf(results, "router.example.dev")).toBe("warn");
    expect(statusOf(results, "llm.example.dev")).toBe("fail");
  });
});

describe("images", () => {
  const token = { "https://ghcr.io/token": { body: { token: "anonymous" } } };

  test("parses registry, repository and tag", () => {
    expect(parseImageRef("ghcr.io/acme/ex-web:abc")).toEqual({ registry: "ghcr.io", repository: "acme/ex-web", tag: "abc" });
    expect(parseImageRef("ghcr.io/acme/ex-web")?.tag).toBe("latest");
  });

  test("checks each Railway service image and nothing for tunnels", async () => {
    const seen: string[] = [];
    const results = await checkImages(fakeContext({ fetch: fakeFetch(token, seen) }));
    expect(results.map((result) => [result.name, result.status])).toEqual([["web", "pass"], ["turborepo", "pass"]]);
    expect(seen).toContain("https://ghcr.io/v2/acme/ex-web/manifests/latest");
  });

  test("a missing image and a private package fail", async () => {
    const missing = await checkImages(
      fakeContext({ fetch: fakeFetch({ ...token, "https://ghcr.io/v2/acme/ex-web/manifests/latest": { status: 404 } }) }),
    );
    expect(statusOf(missing, "web")).toBe("fail");
    const denied = await checkImages(fakeContext({ fetch: fakeFetch({ "https://ghcr.io/token": { status: 403 } }) }));
    expect(statuses(denied)).toEqual(["fail"]);
  });
});
