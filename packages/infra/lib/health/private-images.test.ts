import { expect, test } from "bun:test";
import { checkImages } from "./check-images.js";
import { CONFIG, fakeContext, fakeFetch } from "./fixtures.test-support.js";
import type { HealthContext, KvRead } from "./context.js";

const registry = { username: "acme", vault_key: "GHCR_TOKEN" };
const config = { ...CONFIG, services: [{ ...CONFIG.services[0]!, railway: { registry } }] };
const grant = { "https://ghcr.io/token": { body: { token: "pull-token" } } };

function context(kv: KvRead, request: typeof fetch = fakeFetch(grant)): HealthContext {
  return fakeContext({ config, kv: async () => kv, fetch: request });
}

test("private image pulls use only the declared production Vault credential", async () => {
  const requests: { url: string; headers: Headers }[] = [];
  const request = (async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers) });
    return fakeFetch(grant)(url, init);
  }) as typeof fetch;
  const results = await checkImages(context({ ok: true, data: { GHCR_TOKEN: "secret" } }, request));
  expect(results[0]?.status).toBe("pass");
  expect(requests[0]?.headers.get("Authorization")).toBe(`Basic ${Buffer.from("acme:secret").toString("base64")}`);
  expect(requests[1]?.headers.get("Authorization")).toBe("Bearer pull-token");
  expect(requests[1]?.headers.get("Accept")).toContain("application/vnd.oci.image.manifest.v1+json");
  expect(JSON.stringify(results)).not.toContain("secret");
});

test("missing Vault access skips private image validation", async () => {
  const results = await checkImages(context({ ok: false, unverifiable: true, reason: "no Vault token" }));
  expect(results[0]?.status).toBe("skip");
});

test("an absent registry password fails without sending a registry request", async () => {
  const seen: string[] = [];
  const results = await checkImages(context({ ok: true, data: {} }, fakeFetch(grant, seen)));
  expect(results[0]?.status).toBe("fail");
  expect(seen).toEqual([]);
});

test("rejected private credentials fail without leaking the password", async () => {
  const results = await checkImages(context(
    { ok: true, data: { GHCR_TOKEN: "do-not-log" } },
    fakeFetch({ "https://ghcr.io/token": { status: 401 } }),
  ));
  expect(results[0]?.status).toBe("fail");
  expect(results[0]?.detail).toContain("authenticated pull token");
  expect(JSON.stringify(results)).not.toContain("do-not-log");
});
