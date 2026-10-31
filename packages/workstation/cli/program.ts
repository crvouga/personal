import { Command } from 'commander';

import { cmdBackup, cmdBackups, cmdReset } from './commands/backup-cmds';
import { registerCleanup } from './commands/cleanup-cmd';
import { registerDeprecatedAliases } from './deprecated-aliases';
import { cmdDoctor } from './commands/doctor-cmd';
import { cmdInstall, cmdUninstall } from './commands/install-cmds';
import {
  cmdOpencodeDisable,
  cmdOpencodeResetModel,
  cmdOpencodeSetModel,
  cmdOpencodeStatus,
  cmdOpencodeSync,
} from './commands/opencode-cmds';
import {
  cmdFocusRequest,
  cmdNotificationsDisable,
  cmdNotificationsEnable,
  cmdNotificationsFocus,
  cmdNotificationsStatus,
  cmdNotificationsTag,
  cmdNotificationsTest,
} from './commands/notifications-cmds';
import {
  cmdOpenRouterModels,
  cmdOpenRouterStatus,
} from './commands/openrouter-cmds';
import { cmdProvidersList } from './commands/providers-cmds';
import {
  cmdSoundsConfigure,
  cmdSoundsList,
  cmdSoundsPlay,
  cmdSoundsReset,
  cmdSoundsSet,
  cmdSoundsStatus,
} from './commands/sounds-cmds';
import { cmdStatus } from './commands/status-cmd';
import { cmdSync } from './commands/sync-cmd';
import { cmdUpdate } from './commands/update-cmds';
import { cmdToolsSync, cmdToolsCheck } from './commands/tools-cmds';
import { resolveVaultConfig } from './lib/vault-config';
import type { GlobalOpts } from './lib/cli-opts';
import { readVersion } from './lib/cli-opts';
import { printJson, resolveOutputMode, section } from './lib/output-and-theme';

/**
 * Command domains:
 *
 *   ws …            workstation itself (status/sync/doctor/install/update/vault)
 *   ws opencode …   OpenCode config (providers, models, notifications, backups)
 *   ws openrouter … OpenRouter catalog (model list used by opencode set-model)
 *
 * Every leaf states its domain in the description (`[ws]`, `[opencode]`,
 * `[openrouter]`) so `ws --help` reads as a domain map. The old flat
 * top-level names (`ws sounds`, `ws notifications`, `ws providers`,
 * `ws backup/…`) remain as deprecated aliases that forward to their
 * canonical domain path.
 */

function registerCore(program: Command, globals: () => GlobalOpts): void {
  const tools = program
    .command('tools')
    .description('[ws] Shared developer toolchain');
  tools
    .command('sync')
    .description('Install locked tools and refresh global mise configuration')
    .action(() => cmdToolsSync(globals()));
  tools
    .command('check')
    .description('Check tool versions, GitHub auth and Docker')
    .option('--docker', 'Require a working Docker engine, Compose and Buildx')
    .action((opts: { docker?: boolean }) =>
      cmdToolsCheck({ ...globals(), ...opts })
    );
  program
    .command('status')
    .description('[ws] Show ws + OpenCode + Vault state')
    .action(async () => cmdStatus(globals()));
  program
    .command('doctor')
    .description('[ws] Run checks with actionable fixes')
    .option('--fix', 'Auto-fix by running sync')
    .action(async (opts: { fix?: boolean | undefined }) =>
      cmdDoctor({ ...globals(), fix: opts.fix })
    );
  program
    .command('sync')
    .description('[ws] Converge home directory to the checked-in spec')
    .option('--strict', 'Fail when Vault is unavailable')
    .action(async (opts: { strict?: boolean | undefined }) =>
      cmdSync({ ...globals(), strict: opts.strict })
    );
  registerCleanup(program, globals);
}

function registerSounds(parent: Command, globals: () => GlobalOpts): void {
  const sounds = parent
    .command('sounds')
    .description(
      '[opencode] Per-event notification sounds (preview + configure)'
    );
  sounds
    .command('list')
    .description('Show per-kind sounds + available system sounds')
    .action(async () => cmdSoundsList(globals()));
  sounds
    .command('status')
    .description('Show per-kind sounds + available system sounds')
    .action(async () => cmdSoundsStatus(globals()));
  sounds
    .command('set <kind> <sound>')
    .description('Set the sound for a kind (warns when unknown)')
    .action(async (kind: string, sound: string) =>
      cmdSoundsSet(kind, sound, globals())
    );
  sounds
    .command('play <target>')
    .description('Preview a kind or a system sound name')
    .action(async (target: string) => cmdSoundsPlay(target, globals()));
  sounds
    .command('configure')
    .description('Interactive sound picker (kind → sound, with preview)')
    .option('--kind <kind>', 'Event kind (skips picker)')
    .option('--sound <name>', 'System sound name (skips picker)')
    .option('--play', 'Preview after saving')
    .action(
      async (opts: {
        kind?: string | undefined;
        sound?: string | undefined;
        play?: boolean | undefined;
      }) =>
        cmdSoundsConfigure({
          ...globals(),
          kind: opts.kind,
          sound: opts.sound,
          play: opts.play,
        })
    );
  sounds
    .command('reset')
    .description('Reset all sounds to defaults')
    .action(async () => cmdSoundsReset(globals()));
}

function registerNotifications(
  parent: Command,
  globals: () => GlobalOpts
): void {
  const notifications = parent
    .command('notifications')
    .description('[opencode] Click-to-focus notification plugin');
  notifications
    .command('status')
    .description('Show enabled state + capabilities')
    .action(async () => cmdNotificationsStatus(globals()));
  notifications
    .command('enable')
    .description('Symlink plugin + write sounds')
    .action(async () => cmdNotificationsEnable(globals()));
  notifications
    .command('disable')
    .description('Remove plugin symlink')
    .action(async () => cmdNotificationsDisable(globals()));
  notifications
    .command('test')
    .description('Post a test notification')
    .option(
      '--kind <kind>',
      'finished|interrupted|question|permission|error',
      'finished'
    )
    .action(async (opts: { kind: string }) =>
      cmdNotificationsTest(opts.kind, globals())
    );
  registerNotificationTests(notifications, globals);
  registerSounds(notifications, globals);
}

/** Manual-test commands for the click-to-focus pipeline (no TTY needed). */
function registerNotificationTests(
  notifications: Command,
  globals: () => GlobalOpts
): void {
  notifications
    .command('focus')
    .description('Run the click-to-focus handler (manual test)')
    .option('--dir <dir>', 'Project directory to focus')
    .option('--session <id>', 'Session id the banner belongs to')
    .option('--token <token>', 'Short session token (defaults from --session)')
    .option('--title <title>', 'Session title (token fallback)')
    .option(
      '--kind <kind>',
      'finished|interrupted|question|permission|error',
      'finished'
    )
    .option('--dry-run', 'Print the focus plan without acting')
    .action(
      async (opts: {
        dir?: string | undefined;
        session?: string | undefined;
        token?: string | undefined;
        title?: string | undefined;
        kind?: string | undefined;
        dryRun?: boolean | undefined;
      }) => cmdNotificationsFocus({ ...globals(), ...opts })
    );
  notifications
    .command('focus-request')
    .description('Write/read the session focus request (manual test)')
    .option('--session <id>', 'Session id to route to the owning TUI')
    .option('--read', 'Inspect the current request instead of writing')
    .action(
      async (opts: {
        session?: string | undefined;
        read?: boolean | undefined;
      }) => cmdFocusRequest({ ...globals(), ...opts })
    );
  notifications
    .command('tag')
    .description('Tag this terminal title with the session token')
    .option('--session <id>', 'Session id to derive the token from')
    .option('--title <title>', 'Session title suffix')
    .action(
      async (opts: {
        session?: string | undefined;
        title?: string | undefined;
      }) => cmdNotificationsTag({ ...globals(), ...opts })
    );
}

function registerProviders(parent: Command, globals: () => GlobalOpts): void {
  const providers = parent
    .command('providers')
    .description('[opencode] Vault-backed provider connections');
  providers
    .command('list')
    .description('Vault status for every catalogued provider')
    .action(async () => cmdProvidersList(globals()));
  providers
    .command('sync')
    .description('Merge every valid Vault key into opencode.json')
    .option('--strict', 'Fail when Vault is unavailable')
    .action(async (opts: { strict?: boolean | undefined }) =>
      cmdOpencodeSync({ ...globals(), strict: opts.strict })
    );
}

function registerOpencode(program: Command, globals: () => GlobalOpts): void {
  const opencode = program
    .command('opencode')
    .description(
      '[opencode] OpenCode config, providers, models, notifications'
    );
  opencode
    .command('status')
    .description('[opencode] Show config, providers, model')
    .action(async () => cmdOpencodeStatus(globals()));
  opencode
    .command('sync')
    .description('[opencode] Merge every valid Vault key into opencode.json')
    .option('--strict', 'Fail when Vault is unavailable')
    .action(async (opts: { strict?: boolean | undefined }) =>
      cmdOpencodeSync({ ...globals(), strict: opts.strict })
    );
  registerOpencodeModels(opencode, globals);
  registerOpencodeBackups(opencode, globals);

  registerProviders(opencode, globals);
  registerNotifications(opencode, globals);
}

function registerOpencodeModels(
  opencode: Command,
  globals: () => GlobalOpts
): void {
  opencode
    .command('set-model')
    .description(
      '[opencode] Pick build_model + plan_model from the model catalog'
    )
    .option('--build-model <ref>', 'Build model ref (skips picker)')
    .option('--plan-model <ref>', 'Plan model ref (skips picker)')
    .option('--refresh-models', 'Refresh the cached model catalog')
    .action(
      async (opts: {
        buildModel?: string | undefined;
        planModel?: string | undefined;
        refreshModels?: boolean | undefined;
      }) =>
        cmdOpencodeSetModel({
          ...globals(),
          buildModel: opts.buildModel,
          planModel: opts.planModel,
          refreshModels: opts.refreshModels,
        })
    );
  opencode
    .command('reset-model')
    .description(
      '[opencode] Clear explicit model (restores Auto Router default when connected)'
    )
    .action(async () => cmdOpencodeResetModel(globals()));
  opencode
    .command('disable <provider>')
    .description(
      '[opencode] Remove a provider from opencode.json (keys stay in Vault)'
    )
    .action(async (provider: string) =>
      cmdOpencodeDisable(provider, globals())
    );
  opencode
    .command('list')
    .description('[opencode] List providers in local config')
    .action(async () => cmdOpencodeStatus(globals()));
}

function registerOpencodeBackups(
  opencode: Command,
  globals: () => GlobalOpts
): void {
  opencode
    .command('backup')
    .description('[opencode] Timestamped backup of opencode.json')
    .action(async () => cmdBackup(globals()));
  opencode
    .command('backups')
    .description('[opencode] List backups')
    .action(async () => cmdBackups(globals()));
  opencode
    .command('reset')
    .description('[opencode] Backup then remove generated opencode.json')
    .action(async () => cmdReset(globals()));
}

function registerOpenRouter(program: Command, globals: () => GlobalOpts): void {
  const openrouter = program
    .command('openrouter')
    .description('[openrouter] Live model catalog + key state');
  openrouter
    .command('status')
    .description('[openrouter] Show key state + catalog source')
    .action(async () => cmdOpenRouterStatus(globals()));
  openrouter
    .command('models')
    .description('[openrouter] List the cached/live model catalog')
    .option('--refresh', 'Refresh the cached model catalog')
    .option('--query <q>', 'Filter by name or id')
    .option('--limit <n>', 'Max rows (default 50)', '50')
    .action(
      async (opts: {
        refresh?: boolean | undefined;
        query?: string | undefined;
        limit?: string | undefined;
      }) =>
        cmdOpenRouterModels({
          ...globals(),
          refresh: opts.refresh,
          query: opts.query,
          limit: opts.limit === undefined ? undefined : Number(opts.limit),
        })
    );
}

function registerLifecycle(program: Command, globals: () => GlobalOpts): void {
  program
    .command('install')
    .description('[ws] (Re)install the global ws launcher + sync')
    .action(async () => cmdInstall(globals()));
  program
    .command('uninstall')
    .description('[ws] Remove the global ws launcher')
    .option('--remove-links', 'Also remove managed symlinks')
    .action(async (opts: { removeLinks?: boolean | undefined }) =>
      cmdUninstall({ ...globals(), removeLinks: opts.removeLinks })
    );
  program
    .command('update')
    .description('[ws] Pull latest from GitHub + reinstall + sync')
    .action(async () => cmdUpdate(globals()));
  program
    .command('vault')
    .description('[ws] Show resolved Vault coordinates')
    .action(async () => {
      const mode = resolveOutputMode(globals().json);
      const vault = resolveVaultConfig();
      if (mode === 'json') {
        printJson({ ok: true, ...vault });
        return;
      }
      section('Vault', vault.addr);
      console.log(
        `  path: ${vault.mount}/data/${vault.project}/${vault.config}`
      );
    });
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ws')
    .description(
      'Workstation CLI — domains: `ws` (workstation) · `ws opencode` (editor config) · `ws openrouter` (model catalog)'
    )
    .version(readVersion(), '--version', 'Show ws version')
    .option(
      '--json',
      'Machine-readable JSON output (LLM-friendly, secrets redacted)'
    )
    .option('--yes', 'Skip confirmations')
    .option('--non-interactive', 'Fail instead of prompting')
    .showHelpAfterError('(add --help for usage)');

  const globals = (): GlobalOpts => {
    const o = program.opts() as GlobalOpts;
    return { json: o.json, yes: o.yes, nonInteractive: o.nonInteractive };
  };

  registerCore(program, globals);
  registerOpencode(program, globals);
  registerOpenRouter(program, globals);
  registerLifecycle(program, globals);
  registerDeprecatedAliases(program, globals);
  return program;
}
