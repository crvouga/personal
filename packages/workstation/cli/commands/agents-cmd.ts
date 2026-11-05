import { auditMachine } from '../lib/agents/audit';
import { AgentConfigurationError } from '../lib/agents/errors';
import type { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { currentPlatform } from '../lib/platform';
import { workspaceRoot } from '../lib/paths';
import { registry, select } from '../lib/agents/registry';
import { agentRoot } from '../lib/agents/render';
import { convergeAgents, plan, publicPlan } from '../lib/agents/converge';
import { launchProfile } from '../lib/agents/launch';
import { verifyProvider } from '../lib/agents/verify';
import type { GlobalOpts } from '../lib/cli-opts';

async function revision(requireClean: boolean): Promise<string> {
  if (requireClean) await requireCleanSources();
  const child = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd: workspaceRoot(),
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const value = (await new Response(child.stdout).text()).trim();
  if ((await child.exited) || !/^[a-f0-9]{40}$/.test(value))
    throw new AgentConfigurationError('Cannot resolve checkout revision.');
  return value;
}

type AgentOptions = {
  node: string;
  tool: string;
  profile: string;
  adopt?: boolean;
  smoke?: boolean;
};

export function registerAgents(
  program: Command,
  globals: () => GlobalOpts
): void {
  const agents = program
    .command('agents')
    .description('[ws] Versioned agent/provider profiles');
  agents
    .command('inventory')
    .action(() => console.log(JSON.stringify(registry, null, 2)));
  agents
    .command('audit')
    .action(async () =>
      console.log(
        JSON.stringify(await auditMachine(currentPlatform()), null, 2)
      )
    );
  registerT3Plan(agents);
  for (const action of ['preview', 'apply', 'status', 'verify', 'run']) {
    agents
      .command(action)
      .argument('[args...]')
      .requiredOption('--node <id>', 'Explicit fleet node ID')
      .option('--tool <tool>', 'codex|claude|opencode|gemini', 'codex')
      .option('--profile <profile>', 'direct|proxy', 'direct')
      .option(
        '--adopt',
        'Back up and replace conflicting dedicated profile files'
      )
      .option(
        '--smoke',
        'Spend tokens: one request, 16 output tokens, 30 second deadline'
      )
      .action(async (args: string[], options: AgentOptions) => {
        try {
          await execute(action, args, options, globals());
        } catch (error) {
          console.log(
            JSON.stringify({
              ok: false,
              error:
                error instanceof AgentConfigurationError
                  ? error.message
                  : 'Agent operation failed. Check node/tool/profile, review conflicts with preview, authenticate this node to Vault for proxy, and check approved model availability. No raw error or response is retained.',
            })
          );
          process.exitCode = 1;
        }
      });
  }
}

async function execute(
  action: string,
  args: string[],
  options: AgentOptions,
  global: GlobalOpts
) {
  const selection = select(options.node, options.tool, options.profile);
  const root = agentRoot(homedir(), currentPlatform().name);
  const context = {
    root,
    selection,
    revision: await revision(['apply', 'run', 'verify'].includes(action)),
  };
  if (action === 'apply') {
    if (!global.yes) throw new AgentConfigurationError('Apply requires --yes.');
    console.log(
      JSON.stringify({
        ok: true,
        ...(await convergeAgents(context, options.adopt)),
      })
    );
    return;
  }
  const result = await plan(context);
  const clean =
    result.files.every((file) => file.state === 'unchanged') &&
    result.previous?.fingerprint === result.fingerprint;
  if (['run', 'verify'].includes(action)) {
    if (!clean)
      throw new AgentConfigurationError(
        'Apply the reviewed configuration first.'
      );
    await runOrVerify(action, root, selection, {
      args,
      smoke: options.smoke === true,
    });
    return;
  }
  console.log(
    JSON.stringify({
      ok: action === 'preview' || clean,
      ...publicPlan(result, context.revision),
    })
  );
  if (action === 'status' && !clean) process.exitCode = 1;
}

async function runOrVerify(
  action: string,
  root: string,
  selection: ReturnType<typeof select>,
  input: { args: string[]; smoke: boolean }
) {
  if (action === 'run') {
    process.exitCode = await launchProfile(root, selection, input.args);
    return;
  }
  console.log(
    JSON.stringify({
      ok: true,
      ...(await verifyProvider(selection, input.smoke)),
    })
  );
}

function registerT3Plan(agents: Command): void {
  agents
    .command('t3-plan')
    .requiredOption('--node <id>', 'Fleet node ID')
    .action((options: { node: string }) => {
      const selection = select(options.node, 'codex', 'proxy');
      const root = agentRoot(homedir(), currentPlatform().name);
      console.log(
        JSON.stringify(
          {
            applied: false,
            instance: 'personal_codex_proxy',
            driver: 'codex',
            config: {
              binaryPath: join(
                workspaceRoot(),
                'packages/workstation/agents/codex-proxy.ts'
              ),
              homePath: join(root, selection.node, 'codex', 'proxy'),
            },
            environment: [{ name: 'WS_AGENT_NODE', value: selection.node }],
            instruction:
              'Use these explicitly owned fields in a new T3 Codex provider instance. Preserve all other settings and secret references. Native Windows executable launch has not been validated.',
          },
          null,
          2
        )
      );
    });
}

async function requireCleanSources(): Promise<void> {
  const child = Bun.spawn(
    ['git', 'status', '--porcelain', '--', 'packages/workstation'],
    {
      cwd: workspaceRoot(),
      stdout: 'pipe',
      stderr: 'ignore',
    }
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) || output.trim())
    throw new AgentConfigurationError(
      'Workstation sources are dirty. Commit/review configuration before applying or launching a managed profile. Local work was preserved.'
    );
}
