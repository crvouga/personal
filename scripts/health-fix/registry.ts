// What `bun run health:fix` knows how to repair. Add a fixer when a failing
// check has an interactive repair; add advice when it only needs a pointer.
// Every repair goes through OpenTofu or a reusable workflow, never a provider API.
import { rerunFailedCi } from '../vault-inputs/ci';
import { Abort, fixVaultInputs, infraRepo } from '../vault-inputs/flow';
import type { Advice, Fixer } from './triage';

export type FixSettings = { dryRun: boolean; given: Record<string, string> };

const actionable = (status: string) => status === 'fail' || status === 'warn';

export function fixers(settings: FixSettings): Fixer[] {
  return [
    {
      // Required Vault fields missing, or generated ones never applied because
      // CI's vault_inputs secret lacks them.
      id: 'vault-inputs',
      title: 'Complete vault_inputs (TOFU_VAULT_INPUTS) through OpenTofu',
      handles: ({ group, status, detail }) =>
        actionable(status) &&
        ['auth', 'vault', 'secrets'].includes(group) &&
        /missing or empty/i.test(detail),
      run: async () => {
        try {
          await fixVaultInputs(settings);
        } catch (error) {
          if (!(error instanceof Abort)) throw error;
          console.log(`\n– vault-inputs: ${error.message}`);
        }
      },
    },
    {
      id: 'ci-rerun',
      title: 'Re-run failed CI or Deploy jobs on main',
      handles: ({ group, check, status }) =>
        status === 'fail' &&
        group === 'github' &&
        ['pipeline ci.yml', 'pipeline deploy.yml'].includes(check),
      run: async (findings) => {
        const workflows = new Set(
          findings.map(({ check }) =>
            check === 'pipeline deploy.yml' ? 'deploy.yml' : 'ci.yml'
          )
        );
        for (const workflow of workflows)
          await rerunFailedCi(infraRepo, workflow);
      },
    },
  ];
}

const when = (group: string, pattern: RegExp, text: string): Advice => ({
  handles: (finding) =>
    finding.group === group &&
    pattern.test(`${finding.check} ${finding.detail}`),
  text,
});

export const ADVICE: Advice[] = [
  when(
    'windows-signing',
    /./,
    'Use packages/fleet/docs/windows-signing.md: authenticate Azure, complete the personal identity check if pending, then review and apply a saved plan through bun run infra:signing. Do not create signing resources in the dashboard.'
  ),
  when(
    'storage',
    /Fleet Nix cache/,
    'Inspect the Fleet cache workflow on main. Signing credentials are owned by the Vault OpenTofu root; the HTTP route deploys with turborepo-remote-cache. Rerun the failed workflow after the dependency is repaired. No physical cache node or node terminal command is required.'
  ),
  when(
    'vault',
    /operator credentials/,
    'Publish the admin-only operator document through a reviewed Vault OpenTofu apply in CI. Existing CI supplies the state and deployment credentials; do not enter them into the secret editor or personal runtime secrets.'
  ),
  when(
    'tunnels',
    /connector offline/,
    'Start the cloudflared tunnel on the workstation that serves this hostname.'
  ),
  when(
    'github',
    /publish\.yml is missing/,
    'The application repo owns its publisher workflow: add .github/workflows/publish.yml there (see llms.txt), or set managed_publisher=false in the inventory.'
  ),
  when(
    'runners',
    /no runner registered/,
    'Register a runner for that repo on a fleet machine (packages/fleet, role ci); see packages/fleet/AGENTS.md.'
  ),
  when(
    'domains',
    /origin TLS mode/,
    'Review the domain ssl_mode in the OpenTofu inventory and a saved foundation plan; apply through the deployment workflow. For Railway aliases, follow the documented Cloudflare proxy policy and verify public TLS before changing origin TLS settings.'
  ),
  when(
    'domains',
    /advisory/,
    'Advisory for an unused domain; ignore unless you plan to use it.'
  ),
  when(
    'drift',
    /state bucket|plan/,
    'Re-run with --drift and the OpenTofu state credentials (see packages/infra/tofu/README.md).'
  ),
  {
    handles: ({ status }) => status === 'skip',
    text: 'Not checked: supply the credential or flag named in the message, then re-run.',
  },
];
