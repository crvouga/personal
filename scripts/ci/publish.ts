/** Build local application images in order. Hosting remains OpenTofu-owned. */
import { execFileSync } from 'node:child_process';
import {
  findService,
  imagePrefix,
  infraGithubRepo,
  loadServicesConfig,
} from '../../packages/infra/lib/services';

const config = loadServicesConfig();
const ids: unknown = JSON.parse(process.env.SERVICE_IDS ?? '[]');
if (
  !Array.isArray(ids) ||
  !ids.length ||
  !ids.every((id) => typeof id === 'string')
)
  throw new Error('SERVICE_IDS must contain service ids');
for (const id of ids) {
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
    '--tag',
    `${image}:latest`,
    '--tag',
    `${image}:${process.env.GITHUB_SHA}`,
    '--file',
    service.dockerfile,
  ];
  if (
    service.secrets?.some(
      (secret) => secret.name === 'PORTFOLIO_GITHUB_TOKEN'
    ) &&
    process.env.PORTFOLIO_GITHUB_TOKEN
  )
    args.push('--secret', 'id=github_token,env=PORTFOLIO_GITHUB_TOKEN');
  console.log(`Publishing ${id}`);
  execFileSync('docker', [...args, service.build_context], {
    stdio: 'inherit',
  });
}
