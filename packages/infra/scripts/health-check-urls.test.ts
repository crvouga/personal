import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

async function runHealthCheck(statuses: readonly number[], retries: number) {
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      const status = statuses[Math.min(requests++, statuses.length - 1)]!;
      return new Response("", { status });
    },
  });
  try {
    const child = Bun.spawn([
      process.execPath,
      fileURLToPath(new URL("./health-check-urls.ts", import.meta.url)),
      "--id", "9router",
      "--base-url", server.url.origin,
      "--retries", String(retries),
      "--retry-delay-ms", "0",
    ], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr, requests };
  } finally {
    await server.stop(true);
  }
}

test.each([502, 503, 504])("CLI retries HTTP %i during an always-on service handoff", async (status) => {
  const result = await runHealthCheck([status, 200], 1);
  expect(result.code).toBe(0);
  expect(result.requests).toBe(2);
  expect(result.stdout).toContain("attempt 2/2");
});

test("CLI fails when gateway errors exhaust the configured retries", async () => {
  const result = await runHealthCheck([502], 2);
  expect(result.code).toBe(1);
  expect(result.requests).toBe(3);
  expect(result.stderr).toContain("9router: HTTP 502");
});

test("CLI honors zero retries for gateway errors", async () => {
  const result = await runHealthCheck([502, 200], 0);
  expect(result.code).toBe(1);
  expect(result.requests).toBe(1);
});
