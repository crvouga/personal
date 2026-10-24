import type { Command } from 'commander';
import { password } from '@inquirer/prompts';
import { ManagerError } from '../domain/errors.ts';
import { sourceSchema } from '../domain/config.ts';
import { updateConfig } from '../adapters/config-file.ts';
import { BitwardenVault } from '../adapters/bitwarden.ts';
import { connectOAuth } from '../adapters/oauth-loopback.ts';
import { command } from '../adapters/process.ts';
import { oauthInstructions } from '../application/source-actions.ts';
import { requireAction } from '../application/actions.ts';
import { action, type AppContext } from './context.ts';
import { join } from 'node:path';
import { bindBitwarden, upsertSource } from '../domain/connection-config.ts';
export function registerConnections(program: Command): void {
  registerSecrets(program);
  registerBitwarden(program);
  registerMail(program);
  registerSources(program);
}
function registerSecrets(program: Command): void {
  const secrets = program.command('secrets');
  secrets
    .command('set <reference>')
    .option('--stdin', 'Read a secret from stdin; never pass it as an argument')
    .action(async (reference: string, options: { stdin?: boolean }) => {
      await action(program, async (app) => {
        if (
          /^(operation|candidate|browser|oauth-pending|restore)\//.test(
            reference
          )
        )
          throw new ManagerError('invalid-input');
        const value = options.stdin
          ? await readSecretInput()
          : app.interactive
            ? await password({
                message: 'Secret value (not echoed):',
                mask: true,
              })
            : null;
        if (!value) throw new ManagerError('requires-user-action');
        await app.secrets.setSecret(reference, value);
        return { status: 'completed' };
      })();
    });
}
function registerBitwarden(program: Command): void {
  const connect = program.command('connect');
  connect
    .command('bitwarden')
    .option('--email <email>')
    .option(
      '--server <origin>',
      'Exact existing server; defaults to current binding or US'
    )
    .action(async (options: { email?: string; server?: string }) => {
      await action(program, async (app) => {
        const config = await updateConfig(app, (current) =>
          bindBitwarden(current, options)
        );
        const vault = new BitwardenVault({
          directory: join(app.directory, 'bitwarden'),
          expected: config.bitwarden!,
          secrets: app.secrets,
        });
        await app.state.withLock('bitwarden-session', () => vault.connect());
        return {
          status: 'completed',
          authentication: 'authenticated',
          unlock: 'separate',
          next: 'bun run password-manager run',
        };
      })();
    });
}
function registerMail(program: Command): void {
  const connect = program.commands.find((c) => c.name() === 'connect')!;
  for (const kind of ['gmail', 'microsoft'] as const) {
    connect
      .command(kind)
      .requiredOption('--source <id>')
      .action(async (options: { source: string }) => {
        await action(program, async (app) =>
          app.state.withLock(`source:${options.source}`, () =>
            connectMail(app, { ...options, kind })
          )
        )();
      });
  }
}
function registerSources(program: Command): void {
  const sources = program.command('sources');
  sources.command('detect').action(
    action(program, async () => {
      const { detectBrowserSources } =
        await import('../adapters/browser-sources.ts');
      return detectBrowserSources();
    })
  );
  sources.command('list').action(
    action(program, async (app) =>
      app.config.sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        enabled: s.enabled,
        coverage: app.state.get('coverage', s.id),
      }))
    )
  );
  sources
    .command('add <id> <kind>')
    .option('--file <path>')
    .option('--identity <email>')
    .option('--client-id <id>')
    .option('--client-secret-ref <reference>')
    .action(
      async (
        id: string,
        kind: string,
        options: {
          file?: string;
          identity?: string;
          clientId?: string;
          clientSecretRef?: string;
        }
      ) => {
        await action(program, async (app) => {
          const source = sourceSchema.parse({
            id,
            kind,
            path: options.file,
            identity: options.identity,
            clientId: options.clientId,
            clientSecretRef: options.clientSecretRef,
            ...(['gmail', 'microsoft'].includes(kind)
              ? { tokenRef: `oauth/${id}` }
              : {}),
          });
          await updateConfig(app, (current) => upsertSource(current, source));
          return { status: 'configured', sourceId: id };
        })();
      }
    );
}
async function connectMail(
  app: AppContext,
  input: { source: string; kind: string }
) {
  const source = app.config.sources.find(
    (s) => s.id === input.source && s.kind === input.kind
  );
  if (!source) throw new ManagerError('invalid-config');
  if (!source.clientId || !app.interactive) {
    requireAction(app.state, {
      accountId: null,
      sourceId: source.id,
      operationId: null,
      runId: null,
      step: 'oauth-consent',
      reason: !source.clientId
        ? 'application-registration-required'
        : 'interactive-browser-required',
      destination:
        source.kind === 'gmail'
          ? 'https://console.cloud.google.com/auth/clients'
          : 'https://entra.microsoft.com',
      instructions: oauthInstructions(source.kind),
      prerequisites: [
        'Use your existing app registration when it permits installed-app flows.',
      ],
      expiresAt: null,
      detection:
        'Loopback callback state + S256 PKCE validation; token exchange and source identity check.',
      resume: `bun run password-manager connect ${source.kind} --source ${source.id}`,
      alternative: 'Use local EML/MBOX archives without vault unlock or OAuth.',
    });
    return {
      status: 'requires-user-action',
      next: 'bun run password-manager actions list',
    };
  }
  await connectOAuth({
    source,
    secrets: app.secrets,
    fetch,
    open: systemOpen,
    signal: app.controller.signal,
  });
  return { status: 'connected', sourceId: source.id };
}
async function systemOpen(url: string): Promise<void> {
  const executable =
    process.platform === 'darwin' ? '/usr/bin/open' : '/usr/bin/xdg-open';
  await command({ executable, args: [url], timeoutMs: 10_000 });
}
async function readSecretInput(): Promise<string> {
  let value = '';
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (value.length > 1024 * 1024) throw new ManagerError('invalid-input');
  }
  return value.replace(/\r?\n$/, '');
}
