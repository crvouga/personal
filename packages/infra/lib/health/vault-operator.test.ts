import { expect, test } from "bun:test";
import { checkVault } from "./check-vault.js";
import { CONFIG, fakeContext, fakeFetch, statusOf } from "./fixtures.test-support.js";

const url = "https://vault.example.dev/v1";
const document = {
  TOFU_STATE_PASSPHRASE: "private-passphrase", TOFU_STATE_ACCESS_KEY: "private-access",
  TOFU_STATE_SECRET_KEY: "private-secret", CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_ZONE_ID: "zone", GITHUB_TOKEN: "private-token",
};

async function inspect(status: number, values = document) {
  const config = { ...CONFIG, vault: { ...CONFIG.vault!, operator_credentials_path: "infra/operator" } };
  return checkVault(fakeContext({ config, fetch: fakeFetch({
    [`${url}/sys/seal-status`]: { body: { initialized: true, sealed: false, t: 2, n: 3 } },
    [`${url}/auth/token/lookup-self`]: { body: { data: { policies: ["admin"] } } },
    [`${url}/secret/data/infra/operator`]: { status, body: { data: { data: values } } },
  }) }));
}

test("operator state credentials are checked without printing their values", async () => {
  const results = await inspect(200);
  expect(statusOf(results, "operator credentials")).toBe("pass");
  expect(JSON.stringify(results)).not.toContain("private-");
});

test("restricted tokens skip operator checks; missing and incomplete setup fail", async () => {
  expect(statusOf(await inspect(403), "operator credentials")).toBe("skip");
  expect(statusOf(await inspect(404), "operator credentials")).toBe("fail");
  const results = await inspect(200, { ...document, TOFU_STATE_ACCESS_KEY: "" });
  expect(statusOf(results, "operator credentials")).toBe("fail");
  expect(results.find((result) => result.name === "operator credentials")!.detail).toContain("TOFU_STATE_ACCESS_KEY");
});
