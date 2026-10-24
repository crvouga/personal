/** Publish independent local images concurrently; hosting remains OpenTofu-owned. */
import { spawn } from 'node:child_process';
import {
  findService,
  imagePrefix,
  infraGithubRepo,
  loadServicesConfig,
  type InfraConfig,
} from '../../packages/infra/lib/services';

type Build = { id: string; args: string[] };

export function imageBuilds(
  config: InfraConfig,
  ids: readonly string[],
  sha: string,
  fresh = false
): Build[] {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Select distinct service ids');
  if (!/^[\w][\w.-]{0,127}$/.test(sha))
    throw new Error('Invalid image revision');
  return ids.map((id) => {
    const service = findService(config, id);
    if (
      !service?.dockerfile ||
      !service.build_context ||
      service.github_repo !== infraGithubRepo(config)
    )
      throw new Error(`Service is not locally publishable: ${id}`);
    const image = `ghcr.io/${config.image_owner}/${imagePrefix(config)}-${id}`;
    const args = [
      'buildx',
      'build',
      '--platform',
      'linux/amd64',
      '--push',
      '--provenance=false',
      '--pull',
      '--cache-from',
      `type=registry,ref=${image}:buildcache`,
      '--cache-to',
      `type=registry,ref=${image}:buildcache,mode=max,ignore-error=true`,
      '--tag',
      `${image}:latest`,
      '--tag',
      `${image}:${sha}`,
      '--file',
      service.dockerfile,
    ];
    if (fresh) args.push('--no-cache');
    if (
      service.secrets?.some(
        (secret) => secret.name === 'PORTFOLIO_GITHUB_TOKEN'
      ) &&
      process.env.PORTFOLIO_GITHUB_TOKEN
    )
      args.push('--secret', 'id=github_token,env=PORTFOLIO_GITHUB_TOKEN');
    return { id, args: [...args, service.build_context] };
  });
}

function buildImage(build: Build): Promise<void> {
  console.log(`Publishing ${build.id}`);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', build.args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${build.id}: image build failed (${signal ?? code})`)
        );
    });
  });
}

export async function publishImages(
  builds: readonly Build[],
  run: (build: Build) => Promise<void> = buildImage
): Promise<void> {
  let next = 0;
  const errors: unknown[] = [];
  async function worker() {
    while (next < builds.length && !errors.length) {
      const build = builds[next++]!;
      try {
        await run(build);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, builds.length) }, worker));
  if (errors.length)
    throw new AggregateError(
      errors,
      'Image publication failed; deployment cannot continue'
    );
}

if (import.meta.main) {
  const ids: unknown = JSON.parse(process.env.SERVICE_IDS ?? '[]');
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))
    throw new Error('SERVICE_IDS must contain service ids');
  await publishImages(
    imageBuilds(
      loadServicesConfig(),
      ids,
      process.env.GITHUB_SHA ?? '',
      process.env.PUBLISH_FRESH === 'true'
    )
  );
}
