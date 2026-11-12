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

test("synthetic monitoring requires its data source on the stack", async () => {
  const synthetic = {
    ...CONFIG,
    observability: {
      enabled: true,
      live: true,
      synthetic_monitoring: { enabled: true, probes: ["Ohio"], frequency_ms: 900000, timeout_ms: 30000, alerts: { failures: 2, period: "30m", tls_expiry_days: 14 } },
    },
  };
  const run = (types: string[]) => checkObservability(fakeContext({
    config: synthetic,
    kv: async () => ({ ok: true, data: KV }),
    fetch: fakeFetch({
      [`${GRAFANA}/api/health`]: { body: { database: "ok" } },
      [`${GRAFANA}/api/datasources`]: { body: types.map((type) => ({ type })) },
    }),
  }));
  const missing = (await run(["loki", "tempo"])).find((result) => result.name === "data sources");
  expect(missing?.status).toBe("fail");
  expect(missing?.detail ?? JSON.stringify(missing)).toContain("synthetic-monitoring-datasource");
  const present = await run(["loki", "tempo", "synthetic-monitoring-datasource"]);
  expect(present.every((result) => result.status === "pass")).toBe(true);
});
