import { mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { asRecord, type HealthContext } from '../health/context.js';
import { accountId } from './cloudflare.js';
import { privateJson } from './files.js';

/** Reuse only the original checkout's non-secret backend identity in a worktree. */
async function recoverBackend(ctx: HealthContext, root: string, path: string): Promise<void> {
  const git = await ctx.run('git', ['-C', ctx.repoRoot, 'rev-parse', '--git-common-dir'], { timeoutMs: 10000 });
  if (git.code) return;
  const common = resolve(ctx.repoRoot, git.stdout.trim());
  if (basename(common) !== '.git' || dirname(common) === ctx.repoRoot) return;
  const source = join(dirname(common), 'packages/infra/tofu', root, 'backend.backend.json');
  if (!ctx.fileExists(source)) return;
  let value: Readonly<Record<string, unknown>>;
  try { value = asRecord(JSON.parse(ctx.readFile(source))); }
  catch { throw new Error(`${root}: original backend is invalid; contents withheld`); }
  const allowed = ['bucket', 'key', 'region', 'endpoints', 'skip_credentials_validation', 'skip_region_validation', 'skip_requesting_account_id', 'skip_metadata_api_check', 'use_path_style', 'use_lockfile'];
  if (Object.keys(value).some((key) => !allowed.includes(key)) || value.key !== `${root}.tfstate` || typeof value.bucket !== 'string' || !value.bucket || value.use_lockfile !== true ||
    asRecord(value.endpoints).s3 !== `https://${accountId(ctx)}.r2.cloudflarestorage.com`) throw new Error(`${root}: original backend identity/account/locking cannot be safely reused; no file copied`);
  mkdirSync(path, { recursive: true });
  privateJson(join(path, 'backend.backend.json'), value);
}

/** Read existing state; never infer that a missing/empty state is safe to adopt. */
export async function existingState(ctx: HealthContext): Promise<void> {
  for (const root of ['foundation', 'fleet']) {
    const path = join(ctx.repoRoot, 'packages/infra/tofu', root);
    if (!ctx.fileExists(join(path, '.terraform/terraform.tfstate')) && !ctx.fileExists(join(path, 'backend.backend.json'))) await recoverBackend(ctx, root, path);
  }
  for (const root of ['foundation', 'fleet']) {
    const path = join(ctx.repoRoot, 'packages/infra/tofu', root);
    if (!ctx.fileExists(join(path, '.terraform/terraform.tfstate'))) {
      if (!ctx.fileExists(join(path, 'backend.backend.json'))) throw new Error(`${root}: existing backend.backend.json is required; refusing to guess or initialize replacement state`);
      const inputFile = ['terraform.tfvars', 'terraform.tfvars.json'].some((name) => ctx.fileExists(join(path, name))) ||
        [...new Bun.Glob('*.auto.tfvars{,.json}').scanSync({ cwd: path })].length > 0;
      if (!ctx.env['TF_VAR_state_passphrase'] && !inputFile) throw new Error(`${root}: original TF_VAR_state_passphrase is unavailable; restore the existing encryption input, never generate a replacement`);
      const init = await ctx.run('tofu', [`-chdir=${path}`, 'init', '-input=false', '-lockfile=readonly', '-backend-config=backend.backend.json'], { timeoutMs: 300000, env: ctx.env });
      if (init.code) throw new Error(`${root}: existing-backend initialization failed; provider output withheld`);
    }
    const state = await ctx.run('tofu', [`-chdir=${path}`, 'show', '-json'], { timeoutMs: 60000, env: ctx.env });
    if (state.code) throw new Error(`${root}: cannot read encrypted existing state; supply its original passphrase/backend credentials`);
    let values: Readonly<Record<string, unknown>>;
    try { values = asRecord(asRecord(JSON.parse(state.stdout)).values); }
    catch { throw new Error(`${root}: invalid state response; sensitive output withheld`); }
    const module = asRecord(values.root_module);
    if (!(Array.isArray(module.resources) && module.resources.length) && !(Array.isArray(module.child_modules) && module.child_modules.length)) throw new Error(`${root}: existing state is empty; migration cannot perform initial platform adoption`);
  }
}
