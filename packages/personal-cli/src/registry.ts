import { T3_COMMANDS } from './t3/register';
import type { CommandSpec } from './contracts';
import { searchCommands } from './search';

function fleet(
  command: string,
  title: string,
  description: string,
  keywords: string[]
): CommandSpec {
  return {
    id: `fleet ${command}`,
    title,
    description,
    group: 'Fleet',
    keywords,
    args: ['fleet', command],
    examples: [`personal fleet ${command} --json`],
    mutation: ['add', 'sync', 'init', 'repair'].includes(command),
  };
}

export const COMMANDS: CommandSpec[] = [
  ...T3_COMMANDS.map(([id, description]) => ({
    id,
    title: description,
    description,
    group: 'T3',
    keywords: ['t3', 'configuration', 'terraform', 'drift'],
    args: [id],
    examples: [`personal ${id} --json`],
    mutation: ['t3-apply', 't3-cleanup', 't3-import'].includes(id),
  })),
  {
    id: 'workstation',
    title: 'Workstation configuration',
    description:
      'Tools, editor configuration, agent profiles, notifications and launcher lifecycle.',
    group: 'Workstation',
    keywords: ['tools', 'agents', 'opencode', 'install'],
    args: ['workstation'],
    examples: ['personal workstation --help'],
    mutation: false,
  },
  ...[
    [
      'fleet-node-sync',
      'Sync this node',
      'Upsert and reconcile locked tools and the Codex proxy profile on this machine. Applies by default; --dry-run previews.',
    ],
    [
      'fleet-status',
      'Fleet status',
      'Check this machine and all registered computers without changing them.',
    ],
    [
      'fleet-discover',
      'Discover computers',
      'List computers visible through Tailscale.',
    ],
  ].map(([id, title, description]) => ({
    id: id!,
    title: title!,
    description: description!,
    group: 'Fleet',
    keywords: ['node', 'sync', 'proxy', 'status'],
    args: [id!],
    examples: [`personal ${id} --json`],
    mutation: id === 'fleet-node-sync',
  })),
  fleet(
    'repairs',
    'Explore repairs and login commands',
    'List existing tool owners, automated repairs, native per-machine login commands and shared Vault access guidance. No roster or credentials required.',
    ['fix', 'repair', 'login', 'credentials', 'sharing', 'vault', 'resources']
  ),
  fleet(
    'repair',
    'Repair tools and configuration',
    'Inspect visible Tailscale computers and preview owner-managed repairs. --apply --yes executes eligible tools/config repairs and reruns diagnostics. Logins and host trust remain explicit operator steps.',
    [
      'fix',
      'repair',
      'sync',
      'setup',
      'versions',
      'config',
      'login',
      'credentials',
    ]
  ),
  fleet(
    'health',
    'Check all Tailscale computers',
    'Discover every visible non-mobile Tailscale computer, test reachability, pinned tools, configuration and service logins. Offline, unregistered and unverified computers fail coverage.',
    [
      'tailscale',
      'tailnet',
      'all',
      'health',
      'versions',
      'codex',
      'claude',
      'login',
      'auth',
    ]
  ),
  fleet(
    'discover',
    'Discover Tailscale computers',
    'List all computers visible to this Tailscale account, including offline devices. Excludes iOS, Android and tvOS; never writes a roster.',
    ['tailscale', 'tailnet', 'computers', 'discover', 'machines']
  ),
  fleet(
    'doctor',
    'Diagnose the entire fleet',
    'Read-only SSH, authentication, T3, VS Code and dependency checks for this controller and every roster node.',
    [
      'health',
      'ssh',
      'auth',
      'github',
      'vscode',
      't3',
      'dependencies',
      'diagnose',
    ]
  ),
  {
    ...fleet(
      'doctor',
      'Diagnose this computer',
      'Check this process context without a roster or remote connections.',
      ['local', 'controller', 'health']
    ),
    id: 'fleet doctor local',
    args: ['fleet', 'doctor', '--local'],
    examples: ['personal fleet doctor --local --json'],
  },
  fleet(
    'nodes',
    'Explore fleet nodes',
    'List registered developer computers and their required capabilities without contacting them.',
    ['roster', 'list', 'machines', 'computers']
  ),
  fleet(
    'add',
    'Register a developer computer',
    'Preview or explicitly save an existing SSH alias, checkout path and per-machine capabilities. No SSH or cloud setup.',
    ['onboarding', 'register', 'new', 'setup']
  ),
  fleet(
    'validate',
    'Validate the roster',
    'Check local configuration before making any network requests.',
    ['config', 'schema', 'verify']
  ),
  fleet(
    'onboard',
    'Explore onboarding instructions',
    'Get per-node SSH templates, VS Code guidance, authentication steps and safe verification commands.',
    ['setup', 'guide', 'instructions', 'vscode', 'connect']
  ),
  fleet(
    'sync',
    'Plan toolchain and dependency sync',
    'Preview convergence through the existing mise/workstation owners. Applying requires --apply --yes.',
    ['drift', 'versions', 'mise', 'install', 'dependencies']
  ),
  fleet(
    'init',
    'Preview an example roster',
    'Inspect a starter configuration; only --apply --yes creates it. Prefer Register for real nodes.',
    ['setup', 'example', 'config']
  ),
  fleet(
    'schema',
    'Explore the fleet JSON schema',
    'Read the versioned roster schema for editors and agents.',
    ['agent', 'config', 'json']
  ),
  {
    id: 'commands',
    title: 'Explore the command catalog',
    description:
      'Search command names, descriptions and keywords; emit the complete machine-readable interface.',
    group: 'Reference',
    keywords: ['search', 'help', 'llm', 'agent', 'api'],
    args: ['commands'],
    examples: ['personal commands --json --search ssh'],
    mutation: false,
  },
  {
    id: 'agent',
    title: 'Agent integration guide',
    description:
      'Noninteractive usage, JSON contracts, exit codes, safety boundaries and reproducible examples.',
    group: 'Reference',
    keywords: ['llm', 'automation', 'help', 'safety'],
    args: ['agent'],
    examples: ['personal agent --json'],
    mutation: false,
  },
];

export function commandCatalog(search = '', group?: string): CommandSpec[] {
  return searchCommands(COMMANDS, search).filter(
    (command) => !group || command.group.toLowerCase() === group.toLowerCase()
  );
}
