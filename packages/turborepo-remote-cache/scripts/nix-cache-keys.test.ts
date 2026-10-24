import { expect, test } from 'bun:test';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { nixCacheKeys } from './nix-cache-keys';

test('managed Ed25519 PKCS8 becomes Nix/libsodium seed-plus-public encoding', () => {
  const pair = generateKeyPairSync('ed25519');
  const pem = pair.privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
  const keys = nixCacheKeys(pem);
  const secret = Buffer.from(keys.secret.split(':')[1]!, 'base64');
  const publicBytes = Buffer.from(keys.public.split(':')[1]!, 'base64');
  expect(secret.length).toBe(64);
  expect(publicBytes.length).toBe(32);
  expect(secret.subarray(32)).toEqual(publicBytes);
  const expected = createPublicKey(pair.privateKey).export({ format: 'jwk' });
  expect(publicBytes).toEqual(Buffer.from(expected.x!, 'base64url'));
  expect(keys).toEqual(nixCacheKeys(pem));
});

test('other key algorithms and invalid private material fail closed', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  expect(() =>
    nixCacheKeys(
      pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    )
  ).toThrow('Ed25519');
  expect(() => nixCacheKeys('not private key material')).toThrow();
});
