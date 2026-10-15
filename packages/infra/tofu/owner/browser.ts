/** Native owner operations invoked solely by the leased OpenTofu REST resource. */
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { type HealthContext } from '../../lib/health/context.js';
import { baseline, directory, privateJson } from '../../lib/domains/files.js';
import { ownerBrowserEnvironment } from '../../lib/domains/owner-browser.js';
import { releaseOwnerBrowser } from '../../lib/domains/owner-browser-process.js';
import {
  ownerPageAllowed,
  ownerReadRequest,
} from '../../lib/domains/owner-read-policy.js';
import { findZone } from '../../lib/domains/cloudflare.js';
import { sameSet } from '../../lib/domains/dns.js';
import { requireGate } from '../../lib/domains/runner.js';
import {
  normalizeOperation,
  operationFile,
  operationId,
  ownerIntent,
  ownerReceipt,
  type OwnerOperation,
} from './operation.js';

const baseUrl = (domain: string) =>
  `https://account.squarespace.com/domains/managed/${domain}`;

async function ready(page: Page, url: string, title: RegExp): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const landmark = /DNSSEC|Nameservers/i.test(title.source)
    ? page.getByRole('heading', { name: title })
    : page.getByText(title, { exact: true });
  await landmark.filter({ visible: true }).first().waitFor({ timeout: 30000 });
  if (page.url() !== url)
    throw new Error('Owner session redirected; authentication is required');
}

function lockControl(page: Page) {
  return page
    .getByText(/^domain lock$/i)
    .locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]')
    .locator('input[type="checkbox"]');
}

async function verified(
  page: Page,
  operation: OwnerOperation
): Promise<boolean> {
  if (operation.action === 'disable-dnssec') {
    await ready(page, `${baseUrl(operation.domain)}/dns/dnssec`, /^DNSSEC$/i);
    const toggle = page.getByLabel('DNS Security Extensions', { exact: true });
    await toggle.waitFor({ state: 'attached', timeout: 30000 });
    return (await toggle.count()) === 1 && !(await toggle.isChecked());
  }
  if (operation.action === 'unlock') {
    await ready(page, baseUrl(operation.domain), /^domain lock$/i);
    await lockControl(page).waitFor({ state: 'attached', timeout: 30000 });
    return (
      (await lockControl(page).count()) === 1 &&
      !(await lockControl(page).isChecked())
    );
  }
  if (operation.action === 'delegate') {
    await ready(
      page,
      `${baseUrl(operation.domain)}/dns/domain-nameservers`,
      /^Domain Nameservers$/i
    );
    await page
      .getByRole('button', {
        name: /edit|custom nameservers|change nameservers/i,
      })
      .first()
      .waitFor({ timeout: 30000 });
    const names =
      (await page.locator('body').innerText()).match(
        /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g
      ) ?? [];
    return sameSet(
      names.filter((name) => name !== operation.domain),
      operation.nameservers
    );
  }
  return false; // A prior EPP request needs its durable accepted receipt, not a guess.
}

async function confirmIfKnown(
  page: Page,
  operation: OwnerOperation
): Promise<void> {
  const dialog = page.getByRole('dialog');
  if (!(await dialog.count())) return;
  const text = (await dialog.innerText()).toLowerCase();
  const expected =
    operation.action === 'disable-dnssec'
      ? /dnssec|dns security extensions/
      : /unlock|domain lock/;
  if (
    !expected.test(text) ||
    /password|verification code|authenticate|sign in/.test(text)
  )
    throw new Error(
      'Owner confirmation requires authenticated access or an unrecognized control'
    );
  const confirm = dialog.getByRole('button', {
    name:
      operation.action === 'disable-dnssec'
        ? /^(disable dnssec|disable|confirm)$/i
        : /^(unlock domain|unlock|confirm)$/i,
  });
  if ((await confirm.count()) !== 1)
    throw new Error('Owner confirmation is ambiguous');
  await confirm.click();
}

async function delegate(
  page: Page,
  operation: OwnerOperation,
  arm: () => void
): Promise<void> {
  await page
    .getByRole('button', {
      name: /^(use custom nameservers|edit|edit nameservers)$/i,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  if (!/nameserver/i.test(await dialog.innerText()))
    throw new Error('Unexpected nameserver editor');
  const fields = dialog.getByRole('textbox');
  const count = await fields.count();
  if (count < 2 || count > 13)
    throw new Error('Nameserver editor fields are not recognized');
  for (let i = 0; i < count; i++)
    await fields.nth(i).fill(operation.nameservers[i] ?? '');
  arm();
  await dialog.getByRole('button', { name: /^save$/i }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
}

export async function applyOwnerOperation(
  ctx: HealthContext,
  raw: OwnerOperation,
  authorized: () => boolean
): Promise<Record<string, unknown>> {
  if (!authorized())
    throw new Error(
      'Owner writes require a live reviewed OpenTofu apply lease'
    );
  const operation = normalizeOperation(raw);
  const receipt = ownerReceipt(ctx.repoRoot, operation);
  if (receipt) return receipt;
  const spec = ctx.config.domains?.[operation.domain];
  if (!spec)
    throw new Error(
      'Owner operation domain is outside the canonical inventory'
    );
  if (
    operation.action === 'disable-dnssec' ||
    operation.action === 'delegate'
  ) {
    const source = baseline(ctx.repoRoot, operation.domain);
    if (
      spec.availability !== 'best-effort' ||
      spec.dns_migration !== 'retire-unused' ||
      source.source !== 'retired-unused'
    )
      throw new Error(
        'Source DNS owner changes are restricted to explicitly retired unused domains'
      );
    if (
      operation.action === 'delegate' &&
      !sameSet(
        (await findZone(ctx, operation.domain)).name_servers,
        operation.nameservers
      )
    )
      throw new Error(
        'Delegation does not match the exact Cloudflare account assignment'
      );
    await requireGate(
      ctx,
      operation.domain,
      operation.action === 'delegate' ? 'cutover' : 'baseline'
    );
  } else await requireGate(ctx, operation.domain, 'dns-live');
  const profile = join(ctx.repoRoot, '.domain-migration/owner-chrome');
  const info = lstatSync(profile);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.mode & 0o077 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error('Owner browser profile is not private');
  if (!(await releaseOwnerBrowser(ctx.repoRoot, false)))
    throw new Error(
      'The dedicated owner browser is in use; no browser was terminated'
    );
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    chromiumSandbox: true,
    env: ownerBrowserEnvironment(),
    ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  let armed = false;
  let wrote = false;
  const blockedWrites: string[] = [];
  const priorIntent = existsSync(
    operationFile(ctx.repoRoot, operation, 'intent')
  );
  const page = await context.newPage();
  try {
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (
        ownerReadRequest(
          request.url(),
          request.method(),
          request.isNavigationRequest()
        )
      )
        return route.continue();
      if (
        !priorIntent &&
        armed &&
        authorized() &&
        ownerPageAllowed(request.url()) &&
        ownerPageAllowed(page.url()) &&
        new URL(page.url()).pathname.startsWith(
          `/domains/managed/${operation.domain}`
        ) &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())
      ) {
        if (!wrote) {
          ownerIntent(ctx.repoRoot, operation);
          wrote = true;
        }
        return route.continue();
      }
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
        blockedWrites.length < 30
      ) {
        const url = new URL(request.url());
        blockedWrites.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    if (!(await verified(page, operation))) {
      if (priorIntent)
        throw new Error(
          'Prior owner mutation outcome is unresolved; its request will not be replayed'
        );
      if (operation.action === 'delegate')
        await delegate(page, operation, () => {
          armed = true;
        });
      else if (operation.action === 'request-code') {
        await ready(page, baseUrl(operation.domain), /^domain lock$/i);
        if (await lockControl(page).isChecked())
          throw new Error(
            'Domain must be unlocked before requesting an EPP code'
          );
        armed = true;
        await page
          .getByRole('button', { name: /^request transfer code$/i })
          .click();
        await page
          .getByText(
            /(?:sent|emailed).*(?:transfer|authentication|authorization).*(?:code)|(?:transfer|authentication|authorization).*code.*(?:sent|emailed)/i
          )
          .first()
          .waitFor({ timeout: 30000 });
        if (!wrote)
          throw new Error('No native transfer-code request was observed');
      } else {
        armed = true;
        const toggle =
          operation.action === 'disable-dnssec'
            ? page.getByLabel('DNS Security Extensions', { exact: true })
            : lockControl(page);
        // Squarespace visually hides the native input; click its visible label.
        if (await toggle.isChecked())
          await toggle.locator('xpath=ancestor::label[1]').click();
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await confirmIfKnown(page, operation);
      }
      if (
        operation.action !== 'request-code' &&
        !(await verified(page, operation))
      )
        throw new Error('Owner setting did not persist after reload');
    }
    const accepted = {
      ...operation,
      id: operationId(operation),
      status: 'accepted',
      recordedAt: ctx.now().toISOString(),
      nativeWriteObserved: wrote,
    };
    privateJson(operationFile(ctx.repoRoot, operation, 'receipt'), accepted);
    return accepted;
  } catch (error) {
    const url = new URL(page.url());
    privateJson(
      join(
        directory(ctx.repoRoot, operation.domain),
        `owner-${operation.action}-failure-${Date.now()}-${crypto.randomUUID()}.json`
      ),
      {
        operation,
        wrote,
        blockedWrites,
        error:
          error instanceof Error
            ? error.message.slice(0, 4000)
            : 'unrecognized failure',
        url: `${url.origin}${url.pathname}`,
        text: ownerPageAllowed(page.url())
          ? await page
              .locator('body')
              .innerText()
              .catch(() => '')
          : '',
      }
    );
    throw new Error(
      'Owner operation was not verified; private evidence saved; no uncertain mutation will be replayed'
    );
  } finally {
    await context.close();
  }
}
