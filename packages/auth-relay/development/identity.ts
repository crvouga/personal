import { join } from 'node:path';

export function localIdentity(
  root: string,
  instance?: string
): { cache: string; project: string } {
  if (instance !== undefined && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(instance))
    throw new Error(
      'AUTH_DEV_INSTANCE must be 1–40 lowercase letters, digits or hyphens, starting with a letter or digit'
    );
  const hash = new Bun.CryptoHasher('sha256')
    .update(instance === undefined ? root : `${root}:${instance}`)
    .digest('hex')
    .slice(0, 12);
  const base = join(root, '.superset/.auth-dev');
  return {
    cache: instance === undefined ? base : join(base, 'instances', instance),
    project: `auth-relay-dev-${hash}`,
  };
}
