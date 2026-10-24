import type { SourceConfig } from '../domain/config.ts';
import type { Evidence } from '../domain/model.ts';
import type { StateStore } from '../domain/ports.ts';
import { requireAction } from './actions.ts';
export function sourceNeedsAttention(
  state: StateStore,
  source: SourceConfig,
  reason: string
): void {
  const oauth =
    ['gmail', 'microsoft'].includes(source.kind) &&
    [
      'expired-connection',
      'not-authenticated',
      'insufficient-scope',
      'requires-user-action',
      'identity-authentication-changed-recheck-connection',
      'invalid-config',
      'missing',
    ].includes(reason);
  requireAction(state, {
    accountId: null,
    sourceId: source.id,
    operationId: null,
    runId: null,
    step: oauth ? 'oauth-consent' : 'source-scan',
    reason,
    destination:
      source.kind === 'gmail'
        ? 'https://console.cloud.google.com/auth/clients'
        : source.kind === 'microsoft'
          ? 'https://entra.microsoft.com'
          : null,
    instructions: oauth
      ? oauthInstructions(source.kind)
      : [
          '1. Check the configured source file or provider connection from this machine.',
          '2. If this is a credential export, complete the browser/OS export prompt into a private local file; keep the original vault intact.',
          `3. Run bun run password-manager discover --source ${source.id}. Inspect coverage before assuming the scan is complete.`,
        ],
    prerequisites: [
      'Selected source identity and read-only access; unlocked OS credential store when tokens/candidates are needed.',
    ],
    expiresAt: null,
    detection:
      'A subsequent source scan validates identity and completes with durable evidence/cursor checkpoints.',
    resume: oauth
      ? `bun run password-manager connect ${source.kind} --source ${source.id}`
      : `bun run password-manager discover --source ${source.id}`,
    alternative:
      'Read local EML/MBOX archives independently; other configured sources can continue.',
  });
}
export function oauthInstructions(kind: string): string[] {
  if (kind === 'gmail')
    return [
      '1. In Google Cloud Console select the existing project. Enable Gmail API in APIs & Services > Library.',
      '2. In Google Auth Platform configure Branding, Audience, and Data Access. Request https://www.googleapis.com/auth/gmail.readonly. For an External app in Testing, add the selected email as a test user; refresh tokens normally expire after seven days for these scopes.',
      '3. Under Clients create/select a Desktop app OAuth client. Set clientId and identity in the private source config; store any client_secret with secrets set and reference it using clientSecretRef. Desktop loopback redirects use 127.0.0.1. Do not configure a web-client wildcard.',
      '4. Rerun the resume command in a terminal with a system browser, select the configured mailbox and grant read-only access. The loopback callback validates state + S256 PKCE and checks the mailbox identity.',
    ];
  return [
    '1. In Microsoft Entra > App registrations select/create the installed-app registration with the intended supported account types.',
    '2. Under Authentication add Mobile and desktop applications with loopback redirect http://127.0.0.1. Enable the public-client desktop flow; a client secret is not required.',
    '3. Under API permissions request delegated Mail.ReadBasic, User.Read (selected-mailbox identity verification), and offline_access. Obtain admin consent if required. Set clientId, tenant and identity in the private source config.',
    '4. Rerun the resume command in a terminal with a system browser. Select the configured account and consent; return after the validated callback.',
  ];
}

export function unsupportedSourceItem(
  state: StateStore,
  evidence: Evidence
): void {
  if (
    evidence.category !== 'export' ||
    evidence.confirmed ||
    !evidence.unsupported.length
  )
    return;
  requireAction(state, {
    accountId: null,
    operationId: null,
    runId: null,
    sourceId: evidence.sourceId,
    step: `transfer-${evidence.id}`,
    reason: 'unsupported-export-item',
    destination: 'https://bitwarden.com/help/import-data/',
    instructions: [
      `1. Inspect source item reference ${evidence.sourceRef}; unsupported fields: ${evidence.unsupported.join(', ')}. Its original payload remains encrypted in the OS credential store.`,
      '2. In the authenticated source application, use its documented export/transfer for this item type. Select an isolated destination first and check notes, custom fields and attachments individually; native import does not deduplicate.',
      '3. Keep this action pending until checked. If independent verification is unavailable, preserve the source and use actions skip ACTION_ID --reason deferred to record that incomplete transfer explicitly.',
    ],
    prerequisites: [
      'Original authenticated application and selected transfer destination.',
    ],
    expiresAt: null,
    detection:
      'This connector cannot independently verify native non-login transfer; no completion is inferred from a successful source scan.',
    resume: `bun run password-manager evidence list --source ${evidence.sourceId}`,
    alternative:
      'Keep the original item and encrypted candidate; continue supported login imports independently.',
  });
}
