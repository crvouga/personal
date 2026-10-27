// Cache writes replace the same content, so retrying an interrupted request is
// safe. Only known transient failures retry; credentials/configuration fail fast.
const transientCodes = new Set([
  'InternalError',
  'ServiceUnavailable',
  'SlowDown',
  'RequestTimeout',
  'RequestTimeoutException',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ConnectionClosed',
  'TimeoutError',
]);
const permanentCodes = new Set([
  'AccessDenied',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'NoSuchBucket',
  'NoSuchKey',
  'ERR_S3_MISSING_CREDENTIALS',
  'ERR_S3_INVALID_METHOD',
  'ERR_S3_INVALID_PATH',
  'ERR_S3_INVALID_ENDPOINT',
  'ERR_S3_INVALID_SIGNATURE',
  'ERR_S3_INVALID_SESSION_TOKEN',
]);

export interface CacheOperationOptions {
  sleep?: (milliseconds: number) => Promise<unknown>;
  warn?: (message: string) => void;
}

function safeCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  // Never emit provider messages, response bodies, paths or unrecognized codes.
  return typeof code === 'string' &&
    (transientCodes.has(code) || permanentCodes.has(code))
    ? code
    : 'UNKNOWN';
}

export async function cacheOperation<T>(
  operation: 'HEAD' | 'PUT' | 'GET',
  action: () => Promise<T>,
  options: CacheOperationOptions = {}
): Promise<T> {
  const sleep = options.sleep ?? Bun.sleep;
  const warn = options.warn ?? console.warn;
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const code = safeCode(error);
      if (!transientCodes.has(code) || attempt === 4) {
        throw new Error(`NIX_CACHE_S3_${operation}_${code.toUpperCase()}`);
      }
      const delay = 1000 * 2 ** (attempt - 1);
      warn(
        `NIX_CACHE_S3_RETRY operation=${operation} code=${code} attempt=${attempt}/4 delayMs=${delay}`
      );
      await sleep(delay);
    }
  }
}
