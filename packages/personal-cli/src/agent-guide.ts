import type { Release } from './program';

export function agentGuide(release: Release) {
  return {
    version: 1,
    name: '@crvouga/personal',
    release: release.version,
    invocation: 'personal <command> --json --non-interactive',
    discovery: 'personal commands --json',
    defaultCommand: 'help',
    help: 'personal <command> --help',
    groups: {
      'infra-*':
        'Platform operations run from the personal checkout: infra-health, infra-domains, infra-vault, infra-password-manager',
      workstation:
        'This machine’s tools, agent profiles and launcher lifecycle',
    },
    fleet:
      'Fleet machines, T3 provider instances and the CLI proxy are managed by dev-fleet (https://github.com/crvouga/dev-fleet), not this CLI. From the checkout: bash scripts/dev/project-action.sh fleet-sync | fleet-status | fleet-repair | infra-cliproxy.',
    configuration: {
      workspace:
        '--workspace PATH, PERSONAL_WORKSPACE, closest ancestor mise.toml, then current directory',
    },
    output: {
      stdout:
        'commands --json emits one versioned JSON document. Workstation and infra-* leaf commands retain owner output contracts.',
      exitCodes: {
        '0': 'Success',
        '1': 'Failed operation',
        '2': 'Invalid usage',
      },
      errors:
        '{version:1,ok:false,code,error}; raw subprocess output and exception details are withheld',
    },
    examples: [
      'personal commands --json',
      'personal workstation tools check --json --non-interactive',
      'personal infra-health',
      'personal infra-vault run --config dev -- COMMAND',
    ],
  };
}
