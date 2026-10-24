export const errorCodes = [
  'missing',
  'wrong-version',
  'unsupported-platform',
  'locked',
  'not-authenticated',
  'unavailable',
  'invalid-config',
  'unsafe-path',
  'conflict',
  'busy',
  'rate-limited',
  'insufficient-scope',
  'expired-connection',
  'invalid-input',
  'outcome-unknown',
  'requires-user-action',
  'cancelled',
  'stale-cursor',
  'unsupported-capability',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

/** Only reviewed static codes cross presentation boundaries. Never error.message. */
export class ManagerError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'ManagerError';
  }
}
export function safeCode(error: unknown): ErrorCode {
  return error instanceof ManagerError ? error.code : 'unavailable';
}
