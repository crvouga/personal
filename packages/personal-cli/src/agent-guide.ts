import type { Release } from './program';

const SAFETY = [
  'No arguments prints help, including on a TTY. --json returns this document. The menu requires --interactive; --json and --non-interactive never prompt.',
  'Diagnostics, onboarding instructions, schema, catalogs, scripts and repair previews are read-only.',
  'fleet-sync, fleet-node-sync, t3-apply and t3-cleanup apply by invocation; --dry-run previews. t3-apply --import ID explicitly adopts ownership. --json never implies a dry run. fleet-node-add and fleet-repair require --apply --yes.',
  'Do not copy credentials, forward SSH agents, bypass host keys, provision infrastructure or execute unreviewed remedies.',
  'A healthy controller does not prove another machine can connect to it. Run fleet-status from each intended controller.',
  'fleet-repair executes only allowlisted owner actions, then reruns diagnostics. Native logins, host trust and resource permissions remain explicit operator steps. Pass the reviewed planHash as --plan-hash to reject a changed plan.',
  'Shared provider keys are fetched through each machine’s existing Vault authorization by workstation tooling. Never copy machine-local login caches.',
  'Use exact npm versions for automation. The application never self-updates.',
];

const EXAMPLES = [
  'personal fleet-node-sync',
  'personal fleet-status',
  'personal t3-status',
  'personal fleet-status --local --workspace /path/to/personal --json',
  'personal fleet-status --json --strict --timeout 120000',
  'personal fleet-status --tailnet --json',
  'personal fleet-status --workers --json',
  'personal fleet-node-add --id dev-linux --ssh dev-linux --path /home/dev/workspace --require github,t3,toolchain --json',
  'personal fleet-node-add --id dev-linux --ssh dev-linux --path /home/dev/workspace --apply --yes --json',
  'personal fleet-status --node dev-linux --json',
  'personal fleet-repair --list --json',
  'personal fleet-repair --json',
  'personal fleet-repair --local --repair workspace --json',
  'personal fleet-repair --local --repair workspace --plan-hash <reviewed-sha256> --apply --yes --json',
];

export function agentGuide(release: Release) {
  return {
    version: 1,
    name: '@crvouga/personal',
    release: release.version,
    releasedAt: release.releasedAt,
    invocation: 'personal <command> --json --non-interactive',
    discovery: 'personal commands --json',
    defaultCommand: 'help',
    help: 'personal <command> --help',
    interactive:
      'personal --interactive (explicit opt-in; TTY required, disabled in CI)',
    groups: {
      'fleet-*':
        'Developer computers: fleet-status, fleet-discover, fleet-sync, fleet-node-sync, fleet-repair, fleet-nodes, fleet-node-add',
      't3-*': 'Declared T3 provider instances: t3-status, t3-apply, t3-cleanup',
      'infra-*':
        'Platform operations run from the personal checkout: infra-health, infra-domains, infra-vault, infra-cliproxy, infra-password-manager',
      workstation:
        'This machine’s tools, agent profiles and launcher lifecycle',
    },
    configuration: {
      workspace:
        '--workspace PATH, PERSONAL_WORKSPACE, closest ancestor mise.toml, then current directory',
      roster:
        '--config PATH, PERSONAL_FLEET_CONFIG, closest ancestor .fleet.local.json, then ~/.config/personal/fleet.json',
    },
    output: {
      stdout:
        'Public diagnostics emit one versioned JSON document with --json. Workstation and infra-* leaf commands retain owner output contracts; native agent launch commands stream native output.',
      exitCodes: {
        '0': 'Success or preview',
        '1': 'Failed check or operation; strict also rejects warnings/skips',
        '2': 'Invalid usage or configuration',
        '130': 'Cancelled',
      },
      errors:
        '{version:1,ok:false,code,error}; raw subprocess output and exception details are withheld',
      reports:
        '{version:1,command,ok,generatedAt,nodes:[{node,checks:[{id,status,summary,remedy?}]}],summary,coverage}',
      statuses: ['pass', 'warn', 'fail', 'skip'],
      coverage:
        'Default fleet-status tests the controller and all configured nodes. --local tests only this controller; --tailnet and --workers cover Tailscale computers. A missing roster fails explicitly. T3/VS Code end-to-end checks remain manual.',
    },
    safety: SAFETY,
    fleetSync: {
      command: 'personal fleet-sync',
      preview: 'personal fleet-sync --dry-run --json',
      approval: 'Applies on invocation without a prompt; --dry-run previews',
      scope:
        'Whole enrolled Ubuntu fleet over verified SSH; --node filters diagnostics/rollout',
      state: '~/.local/share/personal/fleet/controller/enrollment.json',
      readiness:
        'Full Ubuntu acceptance is incomplete and fails closed; do not override it or claim deployment success.',
    },
    reconciliation: {
      plan: 'personal t3-apply --dry-run --json',
      apply: 'personal t3-apply --plan-hash HASH',
      cleanup: 'personal t3-cleanup --dry-run',
      import: 'personal t3-apply --import ID',
      ownership:
        'Only declared or explicitly imported T3 instances. Pairing, credentials, threads and unrelated settings are preserved.',
      concurrency:
        'Exclusive personal lock with optimistic external T3 file updates; avoid concurrent Settings edits.',
    },
    examples: EXAMPLES,
  };
}
