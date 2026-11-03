import { expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { stableVersion, releasePlan } from '../scripts/release-model';
import { validatePackedFiles } from '../scripts/pack';
import { withNpmAuth, mustRun, npmEnvironment } from '../scripts/release-io';
import { publishingToken } from '../scripts/release-auth';
import { ReleaseError } from '../scripts/release-error';
import YAML from 'yaml';

test('release planning handles initial publish, no-op and automatic patch versions', () => {
  const first = releasePlan('abc', null);
  expect(first).toMatchObject({
    action: 'publish',
    current: null,
    next: '0.1.0',
  });
  const doc = {
    'dist-tags': { latest: '0.1.7' },
    versions: {
      '0.1.7': { version: '0.1.7', personalCli: { contentHash: 'abc' } },
    },
  };
  expect(releasePlan('abc', doc)).toMatchObject({
    action: 'skip',
    next: '0.1.7',
  });
  expect(releasePlan('changed', doc)).toMatchObject({
    action: 'publish',
    next: '0.1.8',
  });
  expect(() =>
    releasePlan('abc', { 'dist-tags': { latest: '1.0.0' }, versions: {} })
  ).toThrow();
  for (const version of ['1.0', '1.0.0-rc.1', '01.0.0', 'NaN'])
    expect(() => stableVersion(version)).toThrow();
});

test('pack allowlist rejects missing files, secrets, source and duplicate paths', () => {
  const files = [
    'README.md',
    'releasing.md',
    'package.json',
    'cli.mjs',
    'probe.mjs',
    'schema.json',
    'commands.json',
  ];
  expect(() => validatePackedFiles(files)).not.toThrow();
  for (const unexpected of [
    '.env',
    '.fleet.local.json',
    'src/cli.ts',
    'cli.mjs.map',
  ])
    expect(() => validatePackedFiles([...files, unexpected])).toThrow();
  expect(() => validatePackedFiles(files.slice(1))).toThrow();
  expect(() => validatePackedFiles([...files.slice(1), 'cli.mjs'])).toThrow();
});

test('npm config contains only a token reference and is deleted even after failure', async () => {
  const anonymous = npmEnvironment('/temporary', '', {
    npm_config_registry: 'https://not-the-public-registry.test',
    NPM_ID_TOKEN: 'synthetic-identity',
  });
  expect(anonymous['npm_config_registry']).toBeUndefined();
  expect(anonymous['NPM_ID_TOKEN']).toBeUndefined();
  expect(anonymous['NODE_AUTH_TOKEN']).toBe('');
  let path = '';
  await expect(
    withNpmAuth('secret-must-not-be-written', async (env) => {
      path = env['NPM_CONFIG_USERCONFIG']!;
      const config = await readFile(path, 'utf8');
      expect(config).toContain('${NODE_AUTH_TOKEN}');
      expect(config).not.toContain('secret-must-not-be-written');
      if (process.platform !== 'win32')
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      throw new Error('intentional');
    })
  ).rejects.toThrow('intentional');
  expect(existsSync(path)).toBe(false);
});

test('release subprocess failures never expose raw output', async () => {
  const result = mustRun(['npm', 'publish'], '/', {}, async () => ({
    ok: false,
    reason: 'exit',
    stdout: 'token-secret',
    stderr: 'token-secret',
  }));
  await expect(result).rejects.toBeInstanceOf(ReleaseError);
  await expect(result).rejects.not.toThrow('token-secret');
  expect(
    await publishingToken({ NODE_AUTH_TOKEN: 'existing-session-token' })
  ).toBe('existing-session-token');
});

test('CI gates publication on main and read-only OIDC credential selection', async () => {
  const ci = YAML.parse(
    await readFile(
      new URL('../../../.github/workflows/ci.yml', import.meta.url),
      'utf8'
    )
  );
  const release = YAML.parse(
    await readFile(
      new URL(
        '../../../.github/workflows/release-personal-cli.yml',
        import.meta.url
      ),
      'utf8'
    )
  );
  expect(ci.jobs.check.needs).toContain('personal_cli');
  expect(ci.jobs.personal_cli_release.needs).toEqual(['check', 'fleet']);
  expect(ci.jobs.personal_cli_release.if).toContain('refs/heads/main');
  expect(release.permissions).toEqual({
    contents: 'read',
    'id-token': 'write',
  });
  expect(release.concurrency['cancel-in-progress']).toBe(false);
  expect(release.jobs.release.if).toContain(
    "github.event_name != 'pull_request'"
  );
  expect(
    release.jobs.release.steps.find(
      (step: { uses?: string }) => step.uses === 'hashicorp/vault-action@v4'
    ).with.secrets
  ).toContain('NODE_AUTH_TOKEN');
  expect(
    release.jobs.release.steps.find(
      (step: { uses?: string }) => step.uses === 'hashicorp/vault-action@v4'
    ).if
  ).toContain("vars.PERSONAL_NPM_TOKEN_KEY != ''");
  expect(release.jobs.release.steps.at(-1).run).toContain('--oidc');
});
