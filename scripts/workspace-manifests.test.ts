import { expect, test } from 'bun:test';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Docker frozen workspace installs receive every declared package manifest', () => {
  const manifests = readdirSync('packages').filter((name) =>
    existsSync(join('packages', name, 'package.json'))
  );
  for (const image of [
    'portfolio',
    'turborepo-remote-cache',
    'auth-relay',
    'fleet-api',
  ]) {
    const dockerfile = readFileSync(
      join('packages', image, 'Dockerfile'),
      'utf8'
    );
    for (const name of manifests) {
      expect(dockerfile).toContain(
        `COPY packages/${name}/package.json ./packages/${name}/`
      );
    }
  }
});
