import { expect, test } from "bun:test";
import { checkObservability } from "./check-observability.js";
import { CONFIG, fakeContext, fakeFetch } from "./fixtures.test-support.js";

const GRAFANA = "https://example.grafana.net";
const KV = {
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.example.net/otlp",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic%20abc",
  OTEL_RESOURCE_ATTRIBUTES: "deployment.environment.name=production",
  GRAFANA_URL: GRAFANA,
  GRAFANA_SERVICE_ACCOUNT_TOKEN: "glsa_token",
};
const live = { ...CONFIG, observability: { enabled: true, live: true } };

test("disabled observability reports nothing and a staged one skips", async () => {
  expect(await checkObservability(fakeContext())).toEqual([]);
  const staged = await checkObservability(fakeContext({ config: { ...CONFIG, observability: { enabled: true, live: false } } }));
  expect(staged.map((result) => result.status)).toEqual(["skip"]);
});

test("a live stack with credentials in both configs and readable data sources passes", async () => {
  const seen: string[] = [];
  const results = await checkObservability(fakeContext({
    config: live,
    kv: async () => ({ ok: true, data: KV }),
    fetch: fakeFetch({
      [`${GRAFANA}/api/health`]: { body: { database: "ok" } },
      [`${GRAFANA}/api/datasources`]: { body: [{ type: "loki" }, { type: "tempo" }, { type: "prometheus" }] },
    }, seen),
  }));
  expect(results.every((result) => result.status === "pass")).toBe(true);
  expect(results.map((result) => result.name)).toEqual(["vault dev", "vault prd", "grafana", "data sources"]);
});

test("missing Vault fields and a rejected agent token fail", async () => {
  const results = await checkObservability(fakeContext({
    config: live,
    kv: async (config) => ({ ok: true, data: config === "dev" ? {} : KV }),
    fetch: fakeFetch({
      [`${GRAFANA}/api/health`]: { body: {} },
      [`${GRAFANA}/api/datasources`]: { status: 401, body: {} },
    }),
  }));
  expect(results.find((result) => result.name === "vault dev")?.status).toBe("fail");
  expect(results.find((result) => result.name === "agent token")?.status).toBe("fail");
});
