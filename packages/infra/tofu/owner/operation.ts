import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { domainName } from '../../lib/domains/model.js';
import {
  digest,
  directory,
  privateJson,
  readJson,
} from '../../lib/domains/files.js';

export type OwnerOperation = {
  readonly action: 'disable-dnssec' | 'delegate' | 'unlock' | 'request-code';
  readonly domain: string;
  readonly nameservers: readonly string[];
};

/** Key order matches OpenTofu jsonencode(object), including for operation IDs. */
export function normalizeOperation(operation: OwnerOperation): OwnerOperation {
  domainName(operation.domain);
  if (
    !['disable-dnssec', 'delegate', 'unlock', 'request-code'].includes(
      operation.action
    )
  )
    throw new Error('Unsupported owner operation');
  const nameservers = [...operation.nameservers].sort();
  if (
    operation.action === 'delegate'
      ? nameservers.length !== 2 ||
        new Set(nameservers).size !== 2 ||
        nameservers.some(
          (name) => !/^[a-z0-9-]+\.ns\.cloudflare\.com$/.test(name)
        )
      : nameservers.length !== 0
  )
    throw new Error(
      'Owner nameservers must be the exact two verified Cloudflare assignments, only for delegation'
    );
  return { action: operation.action, domain: operation.domain, nameservers };
}

export const operationId = (operation: OwnerOperation): string =>
  digest(normalizeOperation(operation));
export const operationFile = (
  repo: string,
  operation: OwnerOperation,
  suffix: string
): string =>
  join(
    directory(repo, operation.domain),
    `owner-${operation.action}-${operationId(operation)}.${suffix}.json`
  );

export function ownerReceipt(
  repo: string,
  operation: OwnerOperation
): Record<string, unknown> | undefined {
  const file = operationFile(repo, operation, 'receipt');
  if (!existsSync(file)) return;
  const value = readJson(file) as Record<string, unknown>;
  if (value.id !== operationId(operation) || value.status !== 'accepted')
    throw new Error('Owner receipt identity/status mismatch');
  return value;
}

/** Durable intent precedes the first native mutating request, never a UI guess. */
export function ownerIntent(repo: string, operation: OwnerOperation): void {
  privateJson(operationFile(repo, operation, 'intent'), {
    id: operationId(operation),
    operation: normalizeOperation(operation),
    startedAt: new Date().toISOString(),
  });
}
