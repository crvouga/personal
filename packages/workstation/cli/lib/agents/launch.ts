import { join } from 'node:path';
import { registry, type Selection } from './registry';
import { proxyKey } from './secrets';

export async function launchProfile(
  root: string,
  selection: Selection,
  args: string[]
): Promise<number> {
  const directory = join(
    root,
    selection.node,
    selection.tool,
    selection.profile
  );
  const env = { ...process.env };
  // Do not allow an ambient gateway to silently change the selected route.
  for (const name of [
    'OPENAI_BASE_URL',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLIPROXY_API_KEY',
    'GOOGLE_GEMINI_BASE_URL',
  ])
    delete env[name];
  if (selection.profile === 'proxy') {
    env['CLIPROXY_API_KEY'] = await proxyKey();
    configureGatewayEnvironment(env, selection);
  }
  if (selection.tool === 'claude') env['DISABLE_AUTOUPDATER'] = '1';
  if (selection.tool === 'codex') env['CODEX_HOME'] = directory;
  if (selection.tool === 'opencode')
    env['OPENCODE_CONFIG'] = join(directory, 'opencode.json');
  if (selection.tool === 'gemini') env['GEMINI_CLI_HOME'] = directory;
  const prefix =
    selection.tool === 'claude'
      ? ['--settings', join(directory, 'settings.json')]
      : [];
  const child = Bun.spawn([selection.tool, ...prefix, ...args], {
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return child.exited;
}

function configureGatewayEnvironment(
  env: NodeJS.ProcessEnv,
  selection: Selection
): void {
  if (selection.tool === 'gemini') {
    delete env['GOOGLE_GENAI_USE_VERTEXAI'];
    delete env['GOOGLE_GENAI_USE_GCA'];
    env['GOOGLE_GEMINI_BASE_URL'] = registry.proxy.endpoint;
    env['GEMINI_API_KEY'] = env['CLIPROXY_API_KEY'];
  }
  if (selection.tool === 'claude') {
    delete env['ANTHROPIC_API_KEY'];
    env['ANTHROPIC_BASE_URL'] = registry.proxy.endpoint;
    env['ANTHROPIC_AUTH_TOKEN'] = env['CLIPROXY_API_KEY'];
    for (const family of ['OPUS', 'SONNET', 'HAIKU'])
      env[`ANTHROPIC_DEFAULT_${family}_MODEL`] = selection.model;
  }
}
