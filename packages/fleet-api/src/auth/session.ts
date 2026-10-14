import { hmacHex, safeEqual } from './hash';

export const SESSION_COOKIE = 'fleet_session';
export const SESSION_SECONDS = 12 * 60 * 60;

const ACTOR_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

function encodeActor(actor: string): string {
  return Buffer.from(actor, 'utf8').toString('base64url');
}

function decodeActor(encoded: string): string | null {
  const actor = Buffer.from(encoded, 'base64url').toString('utf8');
  return ACTOR_PATTERN.test(actor) && encodeActor(actor) === encoded
    ? actor
    : null;
}

/** `<actor, base64url>.<expiry, unix seconds>.<hmac-sha256 hex of actor|expiry>` */
export function signSession(
  secret: string,
  actor: string,
  expiresAtSeconds: number
): string {
  const signature = hmacHex(secret, `${actor}|${expiresAtSeconds}`);
  return `${encodeActor(actor)}.${expiresAtSeconds}.${signature}`;
}

/** The actor when the value is correctly signed and unexpired, else null. */
export function verifySession(
  secret: string,
  value: string | undefined,
  nowSeconds: number
): string | null {
  if (value === undefined) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [encoded = '', expiry = '', signature = ''] = parts;
  const actor = decodeActor(encoded);
  if (actor === null || !/^[0-9]{1,12}$/.test(expiry)) return null;
  if (!safeEqual(signature, hmacHex(secret, `${actor}|${expiry}`))) return null;
  return Number(expiry) > nowSeconds ? actor : null;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}
