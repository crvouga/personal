import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  inputsFromState,
  parseVaultInputs,
  type Fill,
  type VaultInputs,
} from '../vault-inputs/model';
import { connect } from './connection';
import { command, type Command } from './command';
import { stages, type Stage } from './model';
import { reviewPlan } from './plan';
import type { Inventory, Session, Ui } from './types';

const tofuRoot = resolve(import.meta.dirname, '../../packages/infra/tofu');

/** Isolate backend metadata/plans per run; never overwrite another task's backend. */
export class TofuSession implements Session {
  private directory = mkdtempSync(join(tmpdir(), 'vault-edit-'));
  private env: Record<string, string> = {};
  private backend: Record<string, unknown> = {};
  private roots = new Map<
    string,
    { env: Record<string, string>; args: string[] }
  >();
  private completed: string[] = [];

  constructor(
    private inventory: Inventory,
    private ui: Ui,
    private execute: Command = command,
    private credentials: () => Promise<Record<string, string>> = () =>
      connect(ui)
  ) {}

  async load(): Promise<VaultInputs> {
    await this.ui.task('Check OpenTofu', async () => {
      const version = JSON.parse(
        await this.execute(['tofu', 'version', '-json'], {})
      );
      if (version.terraform_version !== '1.13.0')
        throw new Error(
          'Install the pinned OpenTofu 1.13.0 with mise install.'
        );
    });
    this.env = await this.credentials();
    this.backend = {
      bucket: 'crvouga-tofu-state',
      region: 'auto',
      endpoints: {
        s3: `https://${this.env.TF_VAR_cloudflare_account_id}.r2.cloudflarestorage.com`,
      },
      skip_credentials_validation: true,
      skip_region_validation: true,
      skip_requesting_account_id: true,
      skip_metadata_api_check: true,
      use_path_style: true,
      use_lockfile: true,
    };
    const root = await this.initialize('foundation', 'foundation');
    const state = await this.ui.task('Load complete managed inputs', async () =>
      JSON.parse(await this.execute([...root.args, 'show', '-json'], root.env))
    );
    const recorded = inputsFromState(state);
    if (!recorded)
      throw new Error(
        'The existing foundation state has no TOFU_VAULT_INPUTS value. Restore access to the adopted state; this editor will not create a new input map.'
      );
    return parseVaultInputs(recorded);
  }

  private async initialize(root: string, state: string) {
    const cached = this.roots.get(state);
    if (cached) return cached;
    const directory = join(this.directory, state);
    mkdirSync(directory, { mode: 0o700 });
    const backendFile = join(directory, 'backend.backend.json');
    writeFileSync(
      backendFile,
      JSON.stringify({ ...this.backend, key: `${state}.tfstate` }),
      { mode: 0o600 }
    );
    const configured = {
      args: ['tofu', `-chdir=${join(tofuRoot, root)}`],
      env: {
        ...this.env,
        TF_DATA_DIR: join(directory, 'data'),
        TF_VAR_state_backend: JSON.stringify(this.backend),
      },
    };
    await this.ui.task(`Initialize existing ${state} state`, () =>
      this.execute(
        [
          ...configured.args,
          'init',
          '-input=false',
          '-reconfigure',
          '-lockfile=readonly',
          `-backend-config=${backendFile}`,
        ],
        configured.env
      )
    );
    this.roots.set(state, configured);
    return configured;
  }

  private variables(stage: Stage, next: VaultInputs): Record<string, unknown> {
    const common = {
      state_passphrase: this.env.TF_VAR_state_passphrase,
      state_backend: this.backend,
    };
    if (stage.root === 'vault')
      return {
        ...common,
        cloudflare_account_id: this.env.TF_VAR_cloudflare_account_id,
        cloudflare_zone_id: this.env.TF_VAR_cloudflare_zone_id,
        state_access_key: this.env.TF_VAR_state_access_key,
        state_secret_key: this.env.TF_VAR_state_secret_key,
        github_token: this.env.TF_VAR_github_token,
        ...next,
      };
    const supplied = { ...this.env, ...stage.env };
    const strings = Object.fromEntries(
      Object.entries(supplied)
        .filter(([key]) => key.startsWith('TF_VAR_'))
        .map(([key, value]) => [key.slice(7), value])
    );
    if (stage.root === 'foundation') {
      delete strings.state_backend;
      return strings;
    }
    return {
      ...common,
      ...Object.fromEntries(
        Object.entries(stage.env).map(([key, value]) => [key.slice(7), value])
      ),
    };
  }

  private async stage(
    stage: Stage,
    before: VaultInputs,
    next: VaultInputs,
    fills: Fill[],
    preview: boolean
  ) {
    const root = await this.initialize(stage.root, stage.state);
    const env = { ...root.env, ...stage.env };
    const file = join(this.directory, stage.state, 'selected.tfvars.json');
    const plan = join(this.directory, stage.state, 'selected.tfplan');
    writeFileSync(file, JSON.stringify(this.variables(stage, next)), {
      mode: 0o600,
    });
    // A targeted create would adopt missing resources. Require every target in state first.
    const managed = await this.execute([...root.args, 'state', 'list'], env);
    const addresses = new Set(managed.split('\n'));
    if (stage.addresses.some((address) => !addresses.has(address)))
      throw new Error(
        `${stage.state} is missing an adopted target. This editor only updates existing resources.`
      );
    await this.ui.task(`Plan · ${stage.label}`, () =>
      this.execute(
        [
          ...root.args,
          'plan',
          '-input=false',
          '-lock-timeout=30s',
          '-parallelism=1',
          `-var-file=${file}`,
          ...stage.addresses.map((address) => `-target=${address}`),
          `-out=${plan}`,
        ],
        env
      )
    );
    const saved = JSON.parse(
      await this.execute([...root.args, 'show', '-json', plan], env)
    );
    const updates = reviewPlan(saved, stage, before, next, fills);
    if (!updates.length) {
      this.ui.say(`✓ ${stage.label}: already matches.`);
      return;
    }
    this.ui.say(
      `\n${stage.label}\n${updates.map((address) => `  update ${address}`).join('\n')}`
    );
    if (preview) {
      this.ui.say('Preview only · this saved plan will be removed.');
      return;
    }
    if (!(await this.ui.confirm(`Apply this saved ${stage.state} plan?`)))
      throw new Error('Stopped before this apply.');
    await this.ui.task(`Apply · ${stage.label}`, () =>
      this.execute(
        [
          ...root.args,
          'apply',
          '-input=false',
          '-lock-timeout=30s',
          '-parallelism=1',
          plan,
        ],
        env
      )
    );
    this.completed.push(stage.label);
  }

  async update(
    before: VaultInputs,
    next: VaultInputs,
    fills: Fill[],
    preview: boolean
  ) {
    const steps = stages(next, fills, this.inventory);
    try {
      for (const stage of steps)
        await this.stage(stage, before, next, fills, preview);
    } catch (error) {
      if (this.completed.length)
        this.ui.say(
          `\nCompleted: ${this.completed.join(' → ')}.\nLater stages are incomplete. Re-run vault:edit with the same values to finish synchronization.`
        );
      throw error;
    }
  }

  close() {
    rmSync(this.directory, { recursive: true, force: true });
  }
}
