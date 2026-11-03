import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from './pack';
import { consumerSmoke } from './consumer-smoke';
import { ReleaseError } from './release-error';

const temporary = await mkdtemp(join(tmpdir(), 'personal-pack-'));
try {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const tarball = process.argv[2] ?? (await pack(root, temporary)).path;
  await consumerSmoke(tarball);
  process.stdout.write(
    'Packed consumer smoke passed on Node without a workspace or registry login.\n'
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof ReleaseError ? error.message : 'Packed consumer smoke failed; raw errors withheld.'}\n`
  );
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
