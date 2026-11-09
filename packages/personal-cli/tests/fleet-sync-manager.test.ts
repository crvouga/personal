import { afterEach, expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { managerProviders } from '../src/fleet-sync-manager';

const repo = resolve(import.meta.dir, '../../..');
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function home(settings?: unknown) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'manager-t3-')));
  directories.push(dir);
  if (settings !== undefined) {
    await mkdir(join(dir, 'userdata'), { recursive: true });
    await writeFile(
      join(dir, 'userdata/settings.json'),
      JSON.stringify(settings)
    );
  }
  return dir;
}
const instances = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'userdata/settings.json'), 'utf8'))
    .providerInstances as Record<string, unknown>;

test('a plan reports pending manager providers without writing', async () => {
  const dir = await home({ providerInstances: { antigravity: {} } });
  const check = await managerProviders('chriss-macbook-air', repo, false, dir);
  expect(check.status).toBe('warn');
  expect(check.summary).toBe('T3_PROVIDERS_PENDING');
  expect(Object.keys(await instances(dir))).toEqual(['antigravity']);
});

test('apply adds the declared worker providers, keeps others, then is a no-op', async () => {
  const dir = await home({ providerInstances: { antigravity: {} } });
  expect(
    (await managerProviders('chriss-macbook-air', repo, true, dir)).status
  ).toBe('pass');
  const applied = await instances(dir);
  expect(Object.keys(applied).sort()).toEqual([
    'antigravity',
    'personal_codex_proxy',
    'personal_gateway_models',
  ]);
  expect(JSON.stringify(applied)).toContain('chriss-macbook-air');
  const again = await managerProviders('chriss-macbook-air', repo, false, dir);
  expect(again.status).toBe('pass');
});

test('an unowned instance with a managed ID is reported, never overwritten', async () => {
  const dir = await home({
    providerInstances: { personal_codex_proxy: { driver: 'codex' } },
  });
  const check = await managerProviders('chriss-macbook-air', repo, true, dir);
  expect(check.status).toBe('fail');
  expect(check.summary).toBe('T3_PROVIDER_CONFLICT');
  expect(await instances(dir)).toEqual({
    personal_codex_proxy: { driver: 'codex' },
  });
});
