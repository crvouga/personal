import { expect, test } from 'bun:test';
import { imageBuilds, publishImages } from './publish';
import {
  loadServicesConfig,
  deployableServices,
  infraGithubRepo,
} from '../../packages/infra/lib/services';
const config = loadServicesConfig();
const ids = deployableServices(config)
  .filter((s) => s.github_repo === infraGithubRepo(config))
  .slice(0, 2)
  .map((s) => s.id);

test('all image inputs validate before any build starts and select isolated cache tags', () => {
  expect(() =>
    imageBuilds(config, [...ids, 'missing-service'], 'revision')
  ).toThrow('not locally publishable');
  expect(() => imageBuilds(config, [ids[0]!, ids[0]!], 'revision')).toThrow(
    'distinct'
  );
  expect(() => imageBuilds(config, ids, 'bad\nrevision')).toThrow(
    'Invalid image revision'
  );
  const builds = imageBuilds(config, ids, 'fixture-revision');
  for (const build of builds) {
    expect(build.args.join(' ')).toContain(
      '--platform linux/amd64 --push --provenance=false --pull'
    );
    expect(build.args.join(' ')).toContain(`${build.id}:latest`);
    expect(build.args.join(' ')).toContain(`${build.id}:fixture-revision`);
    expect(build.args.join(' ')).toContain(
      `${build.id}:buildcache,mode=max,ignore-error=true`
    );
    expect(build.args).not.toContain('--no-cache-filter');
  }
  expect(
    imageBuilds(config, ids, 'revision', true).every(
      (build) =>
        build.args.includes('--no-cache-filter') &&
        build.args[build.args.indexOf('--no-cache-filter') + 1] === 'build'
    )
  ).toBe(true);
});

test('publishing overlaps two builds and waits for both to finish', async () => {
  const builds = imageBuilds(config, ids, 'revision');
  const started: string[] = [];
  const completed: string[] = [];
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await publishImages(builds, async ({ id }) => {
    started.push(id);
    if (started.length === 2) release();
    await ready;
    completed.push(id);
  });
  expect(started).toEqual(ids);
  expect(completed.sort()).toEqual([...ids].sort());
});

test('publication failures stop queued builds, await active work and fail deployment', async () => {
  const builds = [
    ...imageBuilds(config, ids, 'revision'),
    { id: 'must-not-start', args: [] },
  ];
  const started: string[] = [];
  let finished = false;
  await expect(
    publishImages(builds, async ({ id }) => {
      started.push(id);
      if (id === ids[0]) throw new Error('fixture failure');
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished = true;
    })
  ).rejects.toThrow('deployment cannot continue');
  expect(started).toEqual(ids);
  expect(finished).toBe(true);
});

test('build credentials use a secret mount and never enter Docker arguments', () => {
  const original = process.env.PORTFOLIO_GITHUB_TOKEN;
  try {
    process.env.PORTFOLIO_GITHUB_TOKEN = 'fixture-private-token';
    const builds = imageBuilds(config, ids, 'revision');
    for (const build of builds) {
      expect(build.args.join(' ')).not.toContain('fixture-private-token');
      const usesSecret =
        config.services
          .find((service) => service.id === build.id)
          ?.secrets?.some(
            (secret) => secret.name === 'PORTFOLIO_GITHUB_TOKEN'
          ) ?? false;
      expect(
        build.args.includes('id=github_token,env=PORTFOLIO_GITHUB_TOKEN')
      ).toBe(usesSecret);
    }
  } finally {
    if (original === undefined) delete process.env.PORTFOLIO_GITHUB_TOKEN;
    else process.env.PORTFOLIO_GITHUB_TOKEN = original;
  }
});
