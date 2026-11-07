/** Failure taxonomy for the GitHub proof fetch; every code names its fix. */

export type GitHubInsightsErrorCode =
  | 'missing-token'
  | 'request-failed'
  | 'api-error'
  | 'invalid-response'
  | 'empty-calendar';

/**
 * Retry intent, carried on the error rather than sniffed back out of its
 * message. GitHub signals "try again" in three unrelated places — a 5xx status,
 * a 429 with `Retry-After`, and an HTTP 200 GraphQL body whose `errors[]` says
 * `RATE_LIMITED` — so the layer that recognises each one is the only layer that
 * can classify it honestly.
 */
export type RetryHint = {
  readonly retryable?: boolean;
  /** Server-requested wait before the next attempt, ms. 0 = use the backoff. */
  readonly retryAfterMs?: number;
};

export class GitHubInsightsError extends Error {
  readonly code: GitHubInsightsErrorCode;
  /** Transient failure: another attempt could plausibly succeed. */
  readonly retryable: boolean;
  /** Server-requested wait before retrying, ms; 0 when it asked for none. */
  readonly retryAfterMs: number;

  constructor(
    code: GitHubInsightsErrorCode,
    message: string,
    hint: RetryHint = {}
  ) {
    super(message);
    this.name = 'GitHubInsightsError';
    this.code = code;
    this.retryable = hint.retryable ?? false;
    this.retryAfterMs = hint.retryAfterMs ?? 0;
  }
}

export const ENV_TOKEN_KEY = 'PORTFOLIO_GITHUB_TOKEN';

export const VAULT_PATH = 'secret/data/personal/{dev|prd}';

export const MISSING_TOKEN_MESSAGE = `${ENV_TOKEN_KEY} is required. Expected ${VAULT_PATH} → ${ENV_TOKEN_KEY}. Locally run: personal vault run --config dev -- bun run --filter @pkgs/portfolio build. GitHub contribution access also requires read:user.`;

export const REMEDIATION = `Verify ${ENV_TOKEN_KEY} in ${VAULT_PATH}.`;

export const SCOPE_REMEDIATION = `${ENV_TOKEN_KEY} must be a user token with read:user access; verify the account's contribution visibility and the ${VAULT_PATH} secret.`;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
