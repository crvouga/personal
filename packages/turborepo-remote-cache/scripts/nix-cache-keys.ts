import { createPrivateKey, createPublicKey } from 'node:crypto';

export function nixCacheKeys(
  pem: string,
  name: string
): { secret: string; public: string } {
  if (!/^[A-Za-z0-9._-]+$/.test(name))
    throw new Error('Invalid Nix cache key name');
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('Expected an Ed25519 signing key');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  if (!privateJwk.d || !publicJwk.x) throw new Error('Incomplete Ed25519 key');
  const seed = Buffer.from(privateJwk.d, 'base64url');
  const publicBytes = Buffer.from(publicJwk.x, 'base64url');
  if (seed.length !== 32 || publicBytes.length !== 32)
    throw new Error('Invalid Ed25519 key size');
  // Nix uses libsodium's 64-byte secret: the 32-byte seed plus public key.
  return {
    secret: `${name}:${Buffer.concat([seed, publicBytes]).toString('base64')}`,
    public: `${name}:${publicBytes.toString('base64')}`,
  };
}
