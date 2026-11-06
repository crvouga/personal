export const AGENT_GUIDE = {
  version: 1,
  name: '@crvouga/personal',
  invocation: 'personal <command> --json --non-interactive',
  discovery: 'personal commands --json',
  configuration: {
    workspace:
      '--workspace PATH, PERSONAL_WORKSPACE, closest ancestor mise.toml, then current directory',
    roster:
      '--config PATH, PERSONAL_FLEET_CONFIG, closest ancestor .fleet.local.json, then ~/.config/personal/fleet.json',
  },
  output: {
    stdout:
      'One versioned JSON document with --json. Prompts and progress never contaminate stdout.',
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
      'Default doctor tests the controller and all configured nodes. --local tests only this controller. A missing roster fails explicitly; configured nodes are not every computer that exists. T3/VS Code end-to-end checks remain manual.',
  },
  safety: [
    'No arguments opens a menu only on an interactive terminal. --json and --non-interactive never prompt.',
    'Diagnostics, onboarding instructions, schema, catalogs, scripts and sync/repair previews are read-only.',
    'fleet-node-sync authorizes local reconciliation by invocation; --dry-run previews. Legacy roster writes, sync and repair require --apply --yes.',
    'Do not copy credentials, forward SSH agents, bypass host keys, provision infrastructure or execute unreviewed remedies.',
    'A healthy controller does not prove another machine can connect to it. Run doctor from each intended controller.',
    'Repair executes only allowlisted owner actions, then reruns diagnostics. Native logins, host trust and resource permissions remain explicit operator steps. Pass the reviewed planHash as --plan-hash to reject a changed plan.',
    'Shared provider keys are fetched through each machine’s existing Vault authorization by workstation tooling. Never copy machine-local login caches.',
    'Use exact npm versions for automation. The application never self-updates.',
  ],
  reconciliation: {
    plan: 'personal t3-plan --json',
    apply: 'personal t3-apply --plan-hash HASH',
    cleanup: 'personal t3-cleanup --dry-run',
    import: 'personal t3-import --instance ID',
    ownership:
      'Only declared or explicitly imported T3 instances. Pairing, credentials, threads and unrelated settings are preserved.',
    concurrency:
      'Exclusive personal lock with optimistic external T3 file updates; avoid concurrent Settings edits.',
  },
  examples: [
    'personal fleet-node-sync',
    'personal fleet-status',
    'personal t3-status',
    'personal fleet doctor --local --workspace /path/to/personal --json',
    'personal fleet doctor --all --json --strict --timeout 120000',
    'personal fleet add --id dev-linux --ssh dev-linux --path /home/dev/workspace --require github,t3,toolchain --json',
    'personal fleet add --id dev-linux --ssh dev-linux --path /home/dev/workspace --apply --yes --json',
    'personal fleet doctor --node dev-linux --json',
    'personal fleet sync --node dev-linux --json',
    'personal fleet repairs --json',
    'personal fleet repair --json',
    'personal fleet repair --local --repair workspace --json',
    'personal fleet repair --local --repair workspace --plan-hash <reviewed-sha256> --apply --yes --json',
  ],
};
