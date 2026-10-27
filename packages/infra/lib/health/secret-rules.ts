/**
 * Shape rules for Vault values. They look only at the value's form and report
 * the problem in words; a value is never echoed. `fail` means the secret cannot
 * work, `warn` means it looks unusual (for example an unexpected vendor prefix).
 */
export type Severity = "fail" | "warn";
export type Problem = { readonly severity: Severity; readonly message: string };
export type Rule = (value: string) => Problem | undefined;

const bad = (severity: Severity, message: string): Problem => ({ severity, message });

const PLACEHOLDER = /^(changeme|change-me|replace[-_ ]?me|todo|tbd|xxx+|your[-_ ].*|example|placeholder|<.*>|\.{3})$/i;

/** Applies to every value, whatever else is known about it. */
export function genericProblem(value: string): Problem | undefined {
  if (value !== value.trim()) return bad("fail", "has leading or trailing whitespace or a newline");
  if (PLACEHOLDER.test(value)) return bad("fail", "is still a placeholder");
  return undefined;
}

const url = (protocols: readonly string[]): Rule => (value) => {
  try {
    return protocols.includes(new URL(value).protocol)
      ? undefined
      : bad("fail", `must be a ${protocols.map((p) => p.replace(":", "")).join("/")} URL`);
  } catch {
    return bad("fail", "is not a valid URL");
  }
};

const matches = (pattern: RegExp, message: string, severity: Severity = "fail"): Rule => (value) =>
  pattern.test(value) ? undefined : bad(severity, message);

const longerThan = (length: number): Rule => (value) =>
  value.length >= length ? undefined : bad("warn", `is shorter than ${length} characters`);

const json = (check: (parsed: unknown) => boolean, message: string): Rule => (value) => {
  try {
    return check(JSON.parse(value)) ? undefined : bad("fail", message);
  } catch {
    return bad("fail", "is not valid JSON");
  }
};

const postgres = url(["postgres:", "postgresql:"]);
const random = longerThan(32);

export const RULES: Readonly<Record<string, Rule>> = {
  GOOGLE_OAUTH_CLIENT_ID: matches(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, "is not a Google OAuth client ID (NNN-xxx.apps.googleusercontent.com)"),
  GOOGLE_OAUTH_CLIENT_SECRET: matches(/^GOCSPX-\S+$/, "does not look like a Google OAuth client secret (GOCSPX-…)", "warn"),
  DATABASE_URL: postgres,
  AUTH_RELAY_DATABASE_URL: postgres,
  S3_ENDPOINT: url(["https:"]),
  CLOUDFLARE_ACCOUNT_ID: matches(/^[0-9a-f]{32}$/, "is not a 32-character hex Cloudflare account ID"),
  CLOUDFLARE_API_TOKEN: longerThan(30),
  RAILWAY_TOKEN: matches(/^[0-9a-f-]{36}$/, "is not a UUID-shaped Railway token", "warn"),
  PORTFOLIO_GITHUB_TOKEN: matches(/^(ghp_|gho_|ghu_|ghs_|github_pat_)\S+$/, "does not look like a GitHub token", "warn"),
  OPENAI_API_KEY: matches(/^sk-\S+$/, "does not start with sk-", "warn"),
  RESEND_API_KEY: matches(/^re_\S+$/, "does not start with re_", "warn"),
  MOCKINGBIRD_STRIPE_SECRET_KEY: matches(/^(sk|rk)_(live|test)_\S+$/, "does not look like a Stripe secret key", "warn"),
  TWILIO_ACCOUNT_SID: matches(/^AC[0-9a-f]{32}$/, "is not a Twilio account SID (AC + 32 hex)"),
  TWILIO_SERVICE_SID: matches(/^VA[0-9a-f]{32}$/, "is not a Twilio Verify service SID (VA + 32 hex)"),
  TWILIO_AUTH_TOKEN: matches(/^[0-9a-f]{32}$/, "is not a 32-character hex Twilio auth token", "warn"),
  FLEET_ROLE_TOKEN_HASHES: json(
    (parsed) =>
      typeof parsed === "object" && parsed !== null && Object.values(parsed).every((hash) => /^[0-9a-f]{64}$/.test(String(hash))),
    "must map each role to a SHA-256 hex digest",
  ),
  FLEET_ADMIN_TOKEN: random,
  FLEET_SESSION_SECRET: random,
  PICKFLIX_SECRET: random,
  PICKFLIX_SESSION_SECRET: random,
  MOVIEFINDER_AUTH_SECRET: random,
  AUTH_RELAY_SETUP_TOKEN_PRODUCTION: random,
  AUTH_RELAY_SETUP_TOKEN_NONPRODUCTION: random,
  "9ROUTER_PASSWORD": random,
  "9ROUTER_JWT_SECRET": random,
  "9ROUTER_API_KEY_SECRET": random,
  "9ROUTER_MACHINE_ID_SALT": random,
};

/** Every problem with `value` for `name`, generic ones first. */
export function problemsFor(name: string, value: string): readonly Problem[] {
  const generic = genericProblem(value);
  if (generic) return [generic];
  const specific = RULES[name]?.(value);
  return specific ? [specific] : [];
}
