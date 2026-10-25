/** Compare Azure's binding with GitHub's actual default OIDC subject. */
import { asRecord, type HealthContext, type JsonResponse } from './context.js';
import { githubApi } from './check-github.js';
import { fail, pass, skip, type CheckResult } from './report.js';

export async function checkSigningFederation(ctx: HealthContext, federation: JsonResponse): Promise<CheckResult> {
  const name = 'main-only signing federation';
  if (federation.status === 401 || federation.status === 403) return skip(name, 'Azure reader permission unavailable; access was not verified');
  const token = ctx.githubToken();
  if (!token) return skip(name, 'GitHub OIDC settings reader credential unavailable');
  const repository = ctx.config.github?.infra_repo;
  const settings = await githubApi(ctx, token)(`/repos/${repository}/actions/oidc/customization/sub`);
  if (settings.status === 401 || settings.status === 403) return skip(name, 'GitHub OIDC settings reader permission unavailable');
  const oidc = asRecord(settings.body);
  const prefix = oidc['sub_claim_prefix'];
  const validPrefix = settings.status === 200 && oidc['use_default'] === true && typeof prefix === 'string' &&
    prefix.replace(/@[0-9]+/g, '') === `repo:${repository}`;
  const credentials = asRecord(federation.body)['value'];
  const credential = Array.isArray(credentials) && credentials.length === 1 ? asRecord(credentials[0]) : {};
  const binding = asRecord(credential['properties']);
  const valid = federation.status === 200 && validPrefix && credential['name'] === 'github-main' &&
    !asRecord(federation.body)['nextLink'] && binding['issuer'] === 'https://token.actions.githubusercontent.com' &&
    binding['subject'] === `${prefix}:ref:refs/heads/main` &&
    JSON.stringify(binding['audiences']) === '["api://AzureADTokenExchange"]';
  return valid ? pass(name, 'Azure trusts GitHub’s actual main-only subject, including immutable IDs') :
    fail(name, 'Azure federation does not match GitHub’s default main subject; review the signing OpenTofu plan');
}
