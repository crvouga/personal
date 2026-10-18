import { describe, expect, test } from "bun:test";
import { loadServicesConfig } from "../services.js";
import { checkSecrets } from "./check-secrets.js";
import { PRD_KV, fakeContext, statusOf } from "./fixtures.test-support.js";
import { RULES, problemsFor } from "./secret-rules.js";

const STRONG = "a".repeat(48);
const GOOD: Record<string, string> = { ...PRD_KV, TURBO_TOKEN: STRONG, TURBO_API: "https://turborepo.example.dev" };

const run = (data: Record<string, string>) =>
  checkSecrets(fakeContext({ kv: async () => ({ ok: true, data }) }));

describe("secrets health", () => {
  test("a complete, well-formed document passes presence, shape and consistency", async () => {
    const results = await run(GOOD);
    expect(results.map((result) => result.name)).toContain("presence personal/prd");
    expect(new Set(results.map((result) => result.status))).toEqual(new Set(["pass"]));
  });

  test("a missing required key fails and names it", async () => {
    const { DATABASE_URL: _removed, ...rest } = GOOD;
    const results = await run(rest);
    expect(statusOf(results, "presence personal/prd")).toBe("fail");
    expect(results.find((result) => result.name === "presence personal/prd")!.detail).toContain("DATABASE_URL");
  });

  test("malformed values fail without ever printing the value", async () => {
    const secret = "mysql://user:hunter2@db/app";
    const results = await run({ ...GOOD, DATABASE_URL: secret, S3_REGION: "auto\n" });
    const shape = results.find((result) => result.name === "shape personal/prd")!;
    expect(shape.status).toBe("fail");
    expect(shape.detail).toContain("DATABASE_URL must be a postgres/postgresql URL");
    expect(shape.detail).toContain("S3_REGION has leading or trailing whitespace");
    expect(JSON.stringify(results)).not.toContain("hunter2");
  });

  test("placeholders fail and unusual vendor prefixes only warn", async () => {
    expect(problemsFor("RESEND_API_KEY", "changeme")[0]?.severity).toBe("fail");
    expect(problemsFor("RESEND_API_KEY", "abc")[0]?.severity).toBe("warn");
    expect(problemsFor("RESEND_API_KEY", "re_123")).toEqual([]);
    const results = await run({ ...GOOD, TURBO_TOKEN: "short" });
    expect(statusOf(results, "shape personal/prd")).toBe("warn");
  });

  test("Google client credentials are checked by shape", () => {
    expect(problemsFor("GOOGLE_OAUTH_CLIENT_ID", "123-abc.apps.googleusercontent.com")).toEqual([]);
    expect(problemsFor("GOOGLE_OAUTH_CLIENT_ID", "123-abc")[0]?.severity).toBe("fail");
    expect(problemsFor("GOOGLE_OAUTH_CLIENT_SECRET", "GOCSPX-abc_def")).toEqual([]);
  });

  test("values that contradict the inventory fail consistency", async () => {
    const results = await run({ ...GOOD, TURBO_API: "https://elsewhere.example.net" });
    expect(statusOf(results, "consistency personal/prd")).toBe("fail");
  });

  test("an unreadable document is a skip when unverifiable, a failure otherwise", async () => {
    const skipped = await checkSecrets(fakeContext({ kv: async () => ({ ok: false, reason: "no token", unverifiable: true }) }));
    expect(skipped.every((result) => result.status === "skip")).toBe(true);
    const failed = await checkSecrets(fakeContext({ kv: async () => ({ ok: false, reason: "404", unverifiable: false }) }));
    expect(failed.every((result) => result.status === "fail")).toBe(true);
  });

  test("every shape rule names a key the committed inventory still declares", () => {
    const declared = new Set((loadServicesConfig().vault?.kv_keys ?? []).map((key) => key.name));
    const stale = Object.keys(RULES).filter((name) => !declared.has(name));
    expect(stale).toEqual([]);
  });
});
