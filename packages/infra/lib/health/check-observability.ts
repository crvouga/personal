/**
 * Shared observability stack (Grafana Cloud over OTLP). Read-only: it confirms
 * Vault carries the ingest and agent credentials, then asks Grafana, with the
 * agents' Viewer token, for its health and its log/trace (and, when synthetic
 * monitoring is on, synthetic monitoring) data sources.
 */
import { errorMessage, getJson, type HealthContext } from "./context.js";
import { fail, pass, skip, type CheckResult } from "./report.js";

const VAULT_KEYS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_RESOURCE_ATTRIBUTES",
  "GRAFANA_URL",
  "GRAFANA_SERVICE_ACCOUNT_TOKEN",
] as const;
const DATA_SOURCES = ["loki", "tempo"] as const;
const SYNTHETIC_MONITORING = "synthetic-monitoring-datasource";

async function checkGrafana(ctx: HealthContext, url: string, token: string, expected: readonly string[]): Promise<CheckResult[]> {
  const base = url.replace(/\/+$/, "");
  try {
    const health = await getJson(ctx, `${base}/api/health`);
    if (health.status !== 200) return [fail("grafana", `GET /api/health answered ${health.status}`)];
    const sources = await getJson(ctx, `${base}/api/datasources`, { Authorization: `Bearer ${token}` });
    if (sources.status !== 200) {
      return [fail("agent token", `GET /api/datasources answered ${sources.status}; the agents service account token was rejected`)];
    }
    const types = new Set((Array.isArray(sources.body) ? sources.body : []).map((source) => String((source as { type?: unknown }).type)));
    const missing = expected.filter((type) => !types.has(type));
    return [
      pass("grafana", "stack answered /api/health"),
      missing.length > 0
        ? fail("data sources", `stack has no ${missing.join(", ")} data source`)
        : pass("data sources", `agent token reads ${expected.join(", ")}`),
    ];
  } catch (err) {
    return [fail("grafana", `request failed: ${errorMessage(err)}`)];
  }
}

export async function checkObservability(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const observability = ctx.config.observability;
  if (!observability?.enabled) return [];
  if (!observability.live) return [skip("observability", "inventory observability.live is false; the stack is not provisioned yet")];
  const results: CheckResult[] = [];
  for (const config of ctx.config.vault?.kv.configs ?? []) {
    const doc = await ctx.kv(config);
    if (!doc.ok) {
      results.push((doc.unverifiable ? skip : fail)(`vault ${config}`, doc.reason));
      continue;
    }
    const unset = VAULT_KEYS.filter((key) => !doc.data[key]?.trim());
    results.push(unset.length > 0
      ? fail(`vault ${config}`, `missing or empty ${unset.join(", ")} (apply the vault root after foundation)`)
      : pass(`vault ${config}`, "OTLP ingest and agent credentials present"));
  }
  const prd = await ctx.kv("prd");
  const url = prd.ok ? prd.data["GRAFANA_URL"]?.trim() : undefined;
  const token = prd.ok ? prd.data["GRAFANA_SERVICE_ACCOUNT_TOKEN"]?.trim() : undefined;
  const expected = observability.synthetic_monitoring?.enabled ? [...DATA_SOURCES, SYNTHETIC_MONITORING] : DATA_SOURCES;
  if (url && token) results.push(...(await checkGrafana(ctx, url, token, expected)));
  return results;
}
