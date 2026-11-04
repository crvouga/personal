import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  contentHash,
  PACKAGE,
  REGISTRY,
  registryDocument,
  releasePlan,
} from './release-model';
import type { ReleasePlan } from './release-model';
import {
  withPublisher,
  interactiveNpm,
  checkBootstrapNpm,
} from './release-publisher';
import type { PublisherOptions } from './release-publisher';
import { configurePublisher } from './release-trust';
import { mustRun } from './release-io';
import { pack } from './pack';
import { consumerSmoke } from './consumer-smoke';
import { npmCommand } from './npm';
import { ReleaseError } from './release-error';
import { propagatedDocument } from './release-propagation';

const root = fileURLToPath(new URL('../../..', import.meta.url));

async function publish(
  plan: ReleasePlan,
  bootstrap: boolean,
  authentication: PublisherOptions
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'personal-release-'));
  try {
    await mustRun(
      [process.execPath, 'packages/personal-cli/scripts/build.ts'],
      root,
      {
        PERSONAL_RELEASE_VERSION: plan.next,
      },
      { stage: 'build' }
    );
    const tarball = await pack(root, temporary);
    await consumerSmoke(tarball.path);
    if ((await contentHash(root)) !== plan.contentHash)
      throw new ReleaseError(
        'Release inputs changed during validation; rerun from a stable checkout.'
      );
    process.stdout.write(
      'Validated tarball. Resolving publishing authorization; credentials are withheld.\n'
    );
    let rejected = false;
    await withPublisher(authentication, async (env) => {
      const args = [
        'publish',
        tarball.path,
        '--access',
        'public',
        '--ignore-scripts',
        '--registry',
        REGISTRY,
        ...(process.env['PERSONAL_NPM_PROVENANCE'] === 'true'
          ? ['--provenance']
          : []),
      ];
      const operation = authentication.npmLogin
        ? interactiveNpm(args, env)
        : mustRun(await npmCommand(args), root, env, { stage: 'publish' });
      await operation.catch(() => {
        rejected = true;
      });
      await verifyPublication(plan, tarball.integrity, rejected);
      if (bootstrap) await configurePublisher(env);
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          version: 1,
          ok: true,
          bootstrap,
          package: PACKAGE,
          published: plan.next,
          integrity: tarball.integrity,
          install: `npx --yes ${PACKAGE}@${plan.next}`,
        },
        null,
        2
      )}\n`
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyPublication(
  plan: ReleasePlan,
  integrity: string,
  rejected: boolean
): Promise<void> {
  const doc = await propagatedDocument(plan.next);
  const saved = doc?.versions[plan.next];
  if (
    saved?.personalCli?.contentHash !== plan.contentHash ||
    saved.dist?.integrity !== integrity
  )
    throw new ReleaseError(
      rejected
        ? 'npm publication failed or its outcome is unconfirmed. Check Vault token validity, npm package scope and 2FA/bypass policy. Rerun the plan before retrying; never republish blindly.'
        : 'npm accepted publication but registry verification is not yet confirmed. Rerun the plan before retrying; do not publish another version blindly.'
    );
  if (doc?.['dist-tags'].latest !== plan.next)
    throw new ReleaseError(
      'Version is published, but latest points elsewhere. Publication is not being repeated; review concurrent releases and the dist-tag manually.'
    );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean' },
      apply: { type: 'boolean' },
      yes: { type: 'boolean' },
      bootstrap: { type: 'boolean' },
      login: { type: 'boolean' },
      'npm-login': { type: 'boolean' },
      oidc: { type: 'boolean' },
      'github-output': { type: 'boolean' },
    },
  });
  if (values.apply && !values.yes)
    throw new ReleaseError('Publishing requires both --apply and --yes.');
  const plan = releasePlan(await contentHash(root), await registryDocument());
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (values['github-output'] && process.env['GITHUB_OUTPUT'])
    await appendFile(
      process.env['GITHUB_OUTPUT'],
      `changed=${String(plan.action === 'publish')}\nversion=${plan.next}\n`
    );
  if (values.plan || !values.apply) return;
  await applyRelease(plan, values);
}

async function applyRelease(
  plan: ReleasePlan,
  values: {
    oidc?: boolean;
    login?: boolean;
    'npm-login'?: boolean;
    bootstrap?: boolean;
  }
): Promise<void> {
  if (values.bootstrap) await checkBootstrapNpm(root);
  if (values.oidc && !plan.current)
    throw new ReleaseError(
      'Initial npm account authorization is required. Run bun run personal:publish:bootstrap --apply --yes --npm-login in a terminal, then retry CI.'
    );
  const authentication = {
    login: values.login === true,
    npmLogin: values['npm-login'] === true,
    oidc: values.oidc === true,
  };
  if (plan.action === 'skip') {
    if (values.bootstrap)
      await withPublisher(authentication, configurePublisher);
    return;
  }
  await publish(plan, values.bootstrap === true, authentication);
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof ReleaseError ? error.message : 'Release failed safely. Inspect arguments, registry availability and local tools; raw errors are withheld.'}\n`
  );
  process.exitCode = 1;
}
