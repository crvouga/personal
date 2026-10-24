import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doctor } from '../src/application/doctor.ts';
import type { DoctorProbes } from '../src/application/doctor-probes.ts';
import { workflowFixture } from './fixtures/workflow.ts';
import { ManagerError } from '../src/domain/errors.ts';
import { parseConfig } from '../src/domain/config.ts';
import {
  checkPlatform,
  acquireSystemDependencies,
  type Execute,
} from '../src/adapters/system-dependencies.ts';
import { checkInstalledDependencies } from '../src/adapters/dependency-check.ts';
const probes: Partial<DoctorProbes> = {
  nativeSecrets: async () => {},
  nodeVersion: '22.22.3',
  dependencies: () => {},
  platform: async () => {},
  systemPackages: async () => {},
  executables: () => {},
  privateDirectory: () => {},
  exists: () => false,
  browserAvailable: () => true,
  browserNative: async () => {},
  now: () => Date.parse('2026-01-01'),
};
void test('doctor distinguishes wrong runtime, missing browser/libraries, locked vault/store and insufficient source scopes without mutations', async () => {
  const f = workflowFixture();
  try {
    const config = parseConfig({
      version: 1,
      bitwarden: { email: 'synthetic@example.test' },
      sources: [
        {
          id: 'mail',
          kind: 'gmail',
          identity: 'synthetic@example.test',
          tokenRef: 'oauth/mail',
        },
      ],
    });
    await f.secrets.setSecret(
      'oauth/mail',
      JSON.stringify({
        accessToken: 'TOKEN_CANARY',
        expiresAt: Date.parse('2027-01-01'),
        scopes: ['gmail.metadata'],
      })
    );
    const before = f.state.list('actions');
    const lockedVault = {
      ...f.fake.vault,
      status: async () => ({
        serverUrl: 'https://vault.bitwarden.com',
        userEmail: 'synthetic@example.test',
        status: 'locked',
      }),
    };
    const result = await doctor({
      config,
      directory: f.directory,
      secrets: f.secrets,
      vault: lockedVault,
      probes: {
        ...probes,
        nodeVersion: '20.0.0',
        exists: (path) => path.endsWith('data.json'),
        browserAvailable: () => false,
      },
    });
    const status = (name: string) =>
      result.find((d) => d.name === name)?.status;
    assert.equal(status('node'), 'wrong-version');
    assert.equal(status('chromium'), 'missing');
    assert.equal(status('bitwarden'), 'locked');
    assert.equal(status('source:mail'), 'insufficient-scope');
    assert.deepEqual(f.state.list('actions'), before);
    const second = await doctor({
      config: f.config,
      directory: f.directory,
      secrets: {
        ...f.secrets,
        getOptional: async () => {
          throw new ManagerError('locked');
        },
        getRequired: f.secrets.getRequired.bind(f.secrets),
        getRequiredMany: f.secrets.getRequiredMany.bind(f.secrets),
        getOptionalMany: f.secrets.getOptionalMany.bind(f.secrets),
        setSecret: async () => {
          throw new Error('doctor must not write secrets');
        },
      },
      vault: null,
      probes: {
        ...probes,
        browserNative: async () => {
          throw new ManagerError('missing');
        },
      },
    });
    assert.equal(
      second.find((d) => d.name === 'persistent-secret-store')?.status,
      'locked'
    );
    assert.equal(
      second.find((d) => d.name === 'chromium-native-libraries')?.status,
      'missing'
    );
  } finally {
    f.close();
  }
});
void test('doctor identifies expired and revoked authorization through read-only provider probes', async () => {
  const f = workflowFixture();
  try {
    const config = parseConfig({
      version: 1,
      sources: [
        {
          id: 'mail',
          kind: 'gmail',
          identity: 'synthetic@example.test',
          tokenRef: 'oauth/mail',
        },
      ],
    });
    await f.secrets.setSecret(
      'oauth/mail',
      JSON.stringify({ accessToken: 'TOKEN_CANARY', expiresAt: 0, scopes: [] })
    );
    const expired = await doctor({
      config,
      directory: f.directory,
      secrets: f.secrets,
      vault: null,
      probes,
    });
    assert.equal(
      expired.find((d) => d.name === 'source:mail')?.status,
      'expired-connection'
    );
    await f.secrets.setSecret(
      'oauth/mail',
      JSON.stringify({
        accessToken: 'TOKEN_CANARY',
        expiresAt: Date.parse('2027-01-01'),
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      })
    );
    const fetchFn = (async (_url: RequestInfo | URL) =>
      new Response('PROVIDER_SECRET_CANARY', { status: 401 })) as typeof fetch;
    const revoked = await doctor({
      config,
      directory: f.directory,
      secrets: f.secrets,
      vault: null,
      probes: { ...probes, fetch: fetchFn },
    });
    assert.equal(
      revoked.find((d) => d.name === 'source:mail')?.status,
      'expired-connection'
    );
    assert.equal(
      JSON.stringify(revoked).includes('PROVIDER_SECRET_CANARY'),
      false
    );
  } finally {
    f.close();
  }
});
void test('managed package checks inspect actual local resolution and lockfile', () => {
  checkInstalledDependencies();
});
void test('platform policy and OS installer use only declared owners and noninteractive elevation', async () => {
  const calls: { executable: string; args: string[] }[] = [];
  const execute: Execute = async (input) => {
    calls.push(input);
    return '14.0';
  };
  await checkPlatform({
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '',
    execute,
  });
  await checkPlatform({
    platform: 'linux',
    arch: 'x64',
    osRelease: 'ID=ubuntu\nVERSION_ID="24.04"',
    execute,
  });
  await assert.rejects(
    checkPlatform({
      platform: 'linux',
      arch: 'x64',
      osRelease: 'ID=unsupported\nVERSION_ID=1',
      execute,
    }),
    /unsupported-platform/
  );
  calls.length = 0;
  await acquireSystemDependencies({
    playwrightCli: '/locked/playwright/cli.js',
    platform: 'linux',
    root: false,
    execute,
  });
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(
      (call) => call.executable === '/usr/bin/sudo' && call.args[0] === '-n'
    )
  );
  assert.ok(calls.some((call) => call.args.includes('gnome-keyring')));
  assert.ok(
    calls.some((call) => call.args.includes('/locked/playwright/cli.js'))
  );
  await assert.rejects(
    acquireSystemDependencies({
      playwrightCli: '/locked/playwright/cli.js',
      platform: 'linux',
      root: false,
      execute: async () => {
        throw new Error('SUDO_SECRET_CANARY');
      },
    }),
    /requires-user-action/
  );
});
