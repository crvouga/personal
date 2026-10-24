import { expect, test } from 'bun:test';
import { deploymentPlan } from './deploy-plan';
import {
  loadServicesConfig,
  deployableServices,
  infraGithubRepo,
} from '../../packages/infra/lib/services';
const config = loadServicesConfig();
const local = deployableServices(config).filter(
  (s) => s.github_repo === infraGithubRepo(config)
);
const request = {
  event: 'push',
  action: 'auto',
  paths: [] as string[],
  sha: 'abcdef1234',
};

test('documentation changes preserve deployed revisions and do not apply infrastructure', () => {
  expect(
    deploymentPlan(config, { ...request, paths: ['README.md'] })
  ).toMatchObject({
    apply: false,
    build: false,
    services: false,
    image_tag: '',
    smoke: true,
  });
});
for (const service of local)
  test(`${service.id} Docker changes publish inventory-selected images at the checked SHA`, () => {
    expect(
      deploymentPlan(config, { ...request, paths: [service.dockerfile!] })
    ).toMatchObject({
      apply: true,
      build: true,
      services: true,
      service_ids: [service.id],
      image_tag: request.sha,
    });
  });
for (const path of ['bun.lock', 'package.json', 'packages/logger/src/index.ts'])
  test(`${path} rebuilds shared application images`, () => {
    expect(deploymentPlan(config, { ...request, paths: [path] }).build).toBe(
      true
    );
  });

test('infrastructure changes preserve existing application image revisions', () => {
  expect(
    deploymentPlan(config, {
      ...request,
      paths: ['packages/infra/tofu/fleet/main.tf'],
    })
  ).toMatchObject({ apply: true, build: false, services: true, image_tag: '' });
});

test.each(['scripts/tofu-plan.ts', 'scripts/atlas-plan.ts'])(
  '%s changes exercise infrastructure and enabled auth planning',
  (path) => {
    expect(
      deploymentPlan(
        { ...config, auth_relay: { ...config.auth_relay!, enabled: true } },
        { ...request, paths: [path] }
      )
    ).toMatchObject({ apply: true, auth: true, build: false });
  }
);

test('scheduled refresh only rebuilds and deploys portfolio', () => {
  expect(
    deploymentPlan(config, { ...request, event: 'schedule' })
  ).toMatchObject({
    build: true,
    auth: false,
    vault: false,
    service_ids: ['portfolio'],
    image_tag: request.sha,
  });
});

test('dispatch selects exactly the requested managed service and revision', () => {
  expect(
    deploymentPlan(config, {
      ...request,
      event: 'repository_dispatch',
      action: 'deploy',
      serviceId: local[0]!.id,
      imageTag: 'revision-42',
    })
  ).toMatchObject({
    build: false,
    service_ids: [local[0]!.id],
    image_tag: 'revision-42',
    services: true,
  });
});

test('malformed dispatches cannot redeploy every service or accept arbitrary tags', () => {
  expect(() =>
    deploymentPlan(config, {
      ...request,
      event: 'repository_dispatch',
      action: 'deploy',
    })
  ).toThrow('requires a service id');
  expect(() =>
    deploymentPlan(config, {
      ...request,
      action: 'deploy',
      serviceId: 'unknown',
    })
  ).toThrow('Unknown deployable');
  expect(() =>
    deploymentPlan(config, {
      ...request,
      action: 'deploy',
      imageTag: 'bad\nvalue',
    })
  ).toThrow('Invalid image tag');
  expect(() =>
    deploymentPlan(config, { ...request, action: 'invalid' })
  ).toThrow('Unknown deployment action');
});

test('manual release supports one local image and refuses external images', () => {
  expect(
    deploymentPlan(config, {
      ...request,
      event: 'workflow_dispatch',
      action: 'release',
      serviceId: local[0]!.id,
    })
  ).toMatchObject({ build: true, service_ids: [local[0]!.id] });
  const external = deployableServices(config).find(
    (s) => s.github_repo !== infraGithubRepo(config)
  );
  if (external)
    expect(() =>
      deploymentPlan(config, {
        ...request,
        action: 'release',
        serviceId: external.id,
      })
    ).toThrow('No locally built');
});

test('unseal does not rebuild images; automatic recovery can rebuild Vault', () => {
  expect(
    deploymentPlan(config, {
      ...request,
      event: 'workflow_dispatch',
      action: 'unseal',
    })
  ).toMatchObject({ apply: true, vault: false, build: false, services: false });
  expect(
    deploymentPlan(config, { ...request, recoverVault: true })
  ).toMatchObject({ apply: true, vault: true, build: false });
});

test('auth rollout respects the enabled gate and runs without unrelated application releases', () => {
  expect(
    deploymentPlan(
      { ...config, auth_relay: { ...config.auth_relay!, enabled: false } },
      { ...request, paths: ['packages/auth-relay/Dockerfile'] }
    )
  ).toMatchObject({ apply: false, auth: false });
  expect(
    deploymentPlan(
      { ...config, auth_relay: { ...config.auth_relay!, enabled: true } },
      { ...request, event: 'workflow_dispatch', action: 'auth' }
    )
  ).toMatchObject({ apply: true, auth: true, build: false, services: false });
});

test('manual smoke remains read-only', () => {
  expect(
    deploymentPlan(config, {
      ...request,
      event: 'workflow_dispatch',
      action: 'smoke',
    })
  ).toMatchObject({
    apply: false,
    build: false,
    auth: false,
    vault: false,
    services: false,
    smoke: true,
  });
});

test('CI-only edits do not roll the identity service; auth runtime dependencies do', () => {
  const enabled = {
    ...config,
    auth_relay: { ...config.auth_relay!, enabled: true },
  };
  for (const path of [
    '.github/workflows/ci.yml',
    'scripts/ci/browser-plan.ts',
    'scripts/ci/format-cache.test.ts',
  ])
    expect(deploymentPlan(enabled, { ...request, paths: [path] }).auth).toBe(
      false
    );
  for (const path of [
    'packages/admin-ui/src/theme.ts',
    'packages/logger/src/index.ts',
    'bun.lock',
    '.github/actions/deploy-auth/action.yml',
    '.github/workflows/deploy.yml',
  ])
    expect(deploymentPlan(enabled, { ...request, paths: [path] }).auth).toBe(
      true
    );
});
