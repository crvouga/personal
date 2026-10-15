import { describe, expect, test } from 'bun:test';

import { hmacHex, safeEqual, sha256Hex } from '../../src/auth/hash';
import { parseNodeCredential } from '../../src/auth/node-credential';
import { roleTokenValid } from '../../src/auth/role-token';
import {
  SESSION_SECONDS,
  clearedSessionCookie,
  sessionCookie,
  signSession,
  verifySession,
} from '../../src/auth/session';
import { nodeIdOf, secretOf, sha256 } from '../support/fixtures';

const SECRET = 'a-session-secret-of-sufficient-length-0123456789';
const NOW = 1_800_000_000;

describe('safeEqual and hashes', () => {
  test('compares strings of any length without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'x')).toBe(false);
    expect(safeEqual('é', 'é')).toBe(true);
  });

  test('sha256 and hmac are the standard ones', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(hmacHex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    );
  });
});

describe('session cookie value', () => {
  const value = signSession(SECRET, 'chris', NOW + SESSION_SECONDS);

  test('verifies for the actor it was signed for until it expires', () => {
    expect(verifySession(SECRET, value, NOW)).toBe('chris');
    expect(verifySession(SECRET, value, NOW + SESSION_SECONDS - 1)).toBe(
      'chris'
    );
  });

  test('expires at the second it says', () => {
    expect(verifySession(SECRET, value, NOW + SESSION_SECONDS)).toBeNull();
    expect(verifySession(SECRET, value, NOW + SESSION_SECONDS + 1)).toBeNull();
  });

  test('is signed with HMAC-SHA256 over actor|expiry', () => {
    const [encoded, expiry, signature] = value.split('.');
    expect(Buffer.from(encoded ?? '', 'base64url').toString()).toBe('chris');
    expect(signature).toBe(hmacHex(SECRET, `chris|${expiry}`));
  });

  test('a different secret does not verify', () => {
    expect(verifySession(`${SECRET}x`, value, NOW)).toBeNull();
  });

  test('tampering with any part is refused', () => {
    const [encoded = '', expiry = '', signature = ''] = value.split('.');
    const other = Buffer.from('mallory').toString('base64url');
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    const tampered = [
      `${other}.${expiry}.${signature}`,
      `${encoded}.${Number(expiry) + 1}.${signature}`,
      `${encoded}.${expiry}.${flipped}`,
      `${encoded}.${expiry}.`,
      `${encoded}..${signature}`,
      `.${expiry}.${signature}`,
      `${encoded}.${expiry}.${signature}.extra`,
      `${encoded}.${expiry}`,
      encoded,
      '',
      '...',
      `${encoded}.99999999999999999999.${signature}`,
      `${encoded}.-5.${signature}`,
      `${encoded}.0x10.${signature}`,
    ];
    for (const cookie of tampered)
      expect(verifySession(SECRET, cookie, NOW)).toBeNull();
    expect(verifySession(SECRET, undefined, NOW)).toBeNull();
  });

  test('an actor outside the username alphabet cannot be signed in as', () => {
    const forged = signSession(SECRET, 'a b', NOW + 100);
    expect(verifySession(SECRET, forged, NOW)).toBeNull();
    const slash = signSession(SECRET, '../root', NOW + 100);
    expect(verifySession(SECRET, slash, NOW)).toBeNull();
  });

  test('actors with dots and dashes survive the round trip', () => {
    const dotted = signSession(SECRET, 'ops.bob-2_x', NOW + 100);
    expect(verifySession(SECRET, dotted, NOW)).toBe('ops.bob-2_x');
  });

  test('cookie attributes: HttpOnly, Secure, SameSite=Lax, Path=/, 12 hours', () => {
    const header = sessionCookie(value);
    expect(header.startsWith(`fleet_session=${value};`)).toBe(true);
    for (const attribute of [
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=43200',
    ]) {
      expect(header.split('; ')).toContain(attribute);
    }
    expect(SESSION_SECONDS).toBe(12 * 3600);
  });

  test('the clearing cookie expires the session immediately', () => {
    const header = clearedSessionCookie();
    expect(header.startsWith('fleet_session=;')).toBe(true);
    expect(header.split('; ')).toEqual(
      expect.arrayContaining([
        'Max-Age=0',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/',
      ])
    );
  });
});

describe('parseNodeCredential', () => {
  const good = `Bearer ${nodeIdOf(1)}.${secretOf(1)}`;

  test('splits the id from the secret and returns only the secret hash', () => {
    expect(parseNodeCredential(good)).toEqual({
      nodeId: nodeIdOf(1),
      secretHash: sha256(secretOf(1)),
    });
  });

  test('refuses everything that is not exactly <64 hex>.<64 hex>', () => {
    const bad = [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      `Basic ${nodeIdOf(1)}.${secretOf(1)}`,
      `bearer ${nodeIdOf(1)}.${secretOf(1)}`,
      `Bearer ${nodeIdOf(1)}`,
      `Bearer ${nodeIdOf(1)}.`,
      `Bearer .${secretOf(1)}`,
      `Bearer ${nodeIdOf(1).toUpperCase()}.${secretOf(1)}`,
      `Bearer ${nodeIdOf(1)}.${secretOf(1).slice(1)}`,
      `Bearer ${nodeIdOf(1)}.${secretOf(1)}.x`,
      `Bearer ${nodeIdOf(1)}:${secretOf(1)}`,
      `Bearer ${'g'.repeat(64)}.${secretOf(1)}`,
    ];
    for (const header of bad) expect(parseNodeCredential(header)).toBeNull();
  });
});

describe('roleTokenValid', () => {
  const hashes = { ci: sha256('ci-token'), web: sha256('web-token') };

  test('accepts the token for its own role only', () => {
    expect(roleTokenValid(hashes, 'ci', 'ci-token')).toBe(true);
    expect(roleTokenValid(hashes, 'web', 'web-token')).toBe(true);
    expect(roleTokenValid(hashes, 'ci', 'web-token')).toBe(false);
    expect(roleTokenValid(hashes, 'web', 'ci-token')).toBe(false);
  });

  test('refuses missing, empty, wrong and padded tokens', () => {
    for (const token of [
      undefined,
      '',
      'nope',
      'ci-token ',
      ' ci-token',
      'CI-TOKEN',
    ]) {
      expect(roleTokenValid(hashes, 'ci', token)).toBe(false);
    }
  });

  test('a role with no configured token can never be approved this way', () => {
    expect(roleTokenValid(hashes, 'cache', 'anything')).toBe(false);
    expect(roleTokenValid(hashes, 'cache', '')).toBe(false);
    expect(roleTokenValid({}, 'ci', 'ci-token')).toBe(false);
    expect(roleTokenValid({ ci: '0'.repeat(64) }, 'ci', '')).toBe(false);
  });

  test('an enormous token is refused', () => {
    const huge = 'x'.repeat(513);
    expect(roleTokenValid({ ci: sha256(huge) }, 'ci', huge)).toBe(false);
  });
});
