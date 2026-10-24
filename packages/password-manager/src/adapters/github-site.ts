import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import type { SecretStore } from '@pkgs/secret-store';
import type { Credential, SiteAdapter, Verification } from '../domain/ports.ts';
import { submitPasswordForm } from './password-form.ts';
import { ManagerError } from '../domain/errors.ts';
import {
  passwordResponse,
  passwordAccepted,
  matchesIdentity,
} from './github-verification.ts';
import {
  assertOrigin,
  guardContext,
  type NetworkGuard,
} from './browser-guard.ts';
const GITHUB_ORIGIN = 'https://github.com';
export interface GithubOptions {
  accountId: string;
  secrets: SecretStore;
  headless: boolean;
  /** Dependency seam for controlled fixtures, never supplied from CLI/config. */
  fixtureOrigin?: string;
}
/** Maintained selectors for GitHub's password and fresh password-login flows. */
export class GithubSite implements SiteAdapter {
  readonly origin: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly guards = new WeakMap<BrowserContext, NetworkGuard>();
  constructor(private readonly options: GithubOptions) {
    this.origin = options.fixtureOrigin ?? GITHUB_ORIGIN;
  }
  private async launch(): Promise<Browser> {
    this.browser ??= await chromium.launch({ headless: this.options.headless });
    return this.browser;
  }
  private async newContext(
    saved: boolean,
    provided?: Awaited<ReturnType<BrowserContext['storageState']>>
  ): Promise<BrowserContext> {
    const stored = saved
      ? await this.options.secrets.getOptional(
          `browser/${this.options.accountId}`
        )
      : null;
    const storageState = stored
      ? (JSON.parse(stored.readSecretValue()) as Awaited<
          ReturnType<BrowserContext['storageState']>
        >)
      : provided;
    const context = await (
      await this.launch()
    ).newContext({
      ...(storageState ? { storageState } : {}),
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    this.guards.set(
      context,
      await guardContext(
        context,
        this.origin,
        this.origin === GITHUB_ORIGIN ? ['https://github.githubassets.com'] : []
      )
    );
    return context;
  }
  async prepare(credential: Credential): Promise<'ready' | 'challenge'> {
    this.context = await this.newContext(true);
    this.page = await this.context.newPage();
    await this.page.goto(this.origin + '/settings/security', {
      waitUntil: 'domcontentloaded',
    });
    assertOrigin(this.page, this.origin);
    if (new URL(this.page.url()).pathname === '/login') {
      const login = await this.login(this.page, credential);
      if (login !== 'valid') return 'challenge';
      await this.openSettingsAfterLogin();
    }
    if (await this.challenge(this.page)) {
      if (this.options.headless) return 'challenge';
      try {
        await this.page
          .locator('#old_password')
          .waitFor({ state: 'visible', timeout: 60_000 });
      } catch {
        return 'challenge';
      }
    }
    if (!(await matchesIdentity(this.page, credential.username)))
      return 'challenge';
    return (await this.page.locator('#old_password').isVisible())
      ? 'ready'
      : 'challenge';
  }
  async change(input: {
    old: Credential;
    replacement: string;
  }): Promise<'confirmed' | 'challenge' | 'unknown'> {
    const page = this.page;
    if (!page) throw new ManagerError('unavailable');
    this.guards.get(page.context())!.seal();
    const fields = [
      ['#old_password', input.old.password],
      ['#new_password', input.replacement],
      ['#confirm_new_password', input.replacement],
    ] as const;
    if (input.replacement.length < 15)
      throw new ManagerError('requires-user-action');
    await submitPasswordForm({
      page,
      origin: this.origin,
      fields,
      button: /update password/i,
    });
    try {
      await page
        .getByText(
          /your password has been changed|password updated successfully/i
        )
        .first()
        .waitFor({ timeout: 15_000 });
      assertOrigin(page, this.origin);
      return 'confirmed';
    } catch {
      return (await this.challenge(page)) ? 'challenge' : 'unknown';
    }
  }
  async verify(credential: Credential): Promise<Verification> {
    // No storageState, signed-in cookies, extension, SSO or passkey fallback.
    const context = await this.newContext(false);
    try {
      const page = await context.newPage();
      await page.goto(this.origin + '/login', {
        waitUntil: 'domcontentloaded',
      });
      return await this.login(page, credential);
    } finally {
      await context.close();
    }
  }
  private async login(
    page: Page,
    credential: Credential
  ): Promise<Verification> {
    this.guards.get(page.context())!.seal();
    const response = passwordResponse(page, this.origin);
    await submitPasswordForm({
      page,
      origin: this.origin,
      fields: [
        ['#login_field', credential.username],
        ['#password', credential.password],
      ],
      button: /sign in/i,
    });
    const accepted = await passwordAccepted(await response, this.origin);
    await page.waitForLoadState('domcontentloaded');
    assertOrigin(page, this.origin);
    if (await page.getByText(/incorrect username or password/i).isVisible())
      return 'invalid';
    if (!accepted)
      return (await this.challenge(page)) ? 'challenge' : 'unknown';
    if (await this.challenge(page)) {
      if (this.options.headless) return 'challenge';
      try {
        await page
          .locator('meta[name="user-login"]')
          .waitFor({ state: 'attached', timeout: 60_000 });
      } catch {
        return 'challenge';
      }
    }
    return (await matchesIdentity(page, credential.username))
      ? 'valid'
      : 'unknown';
  }

  private async openSettingsAfterLogin(): Promise<void> {
    const state = await this.context!.storageState();
    await this.context!.close();
    this.context = await this.newContext(false, state);
    this.page = await this.context.newPage();
    await this.page.goto(this.origin + '/settings/security', {
      waitUntil: 'domcontentloaded',
    });
  }
  private async challenge(page: Page): Promise<boolean> {
    return (
      /two-factor|sessions\/verified-device|sudo|captcha/.test(
        new URL(page.url()).pathname
      ) ||
      (await page.locator('input[autocomplete="one-time-code"]').isVisible())
    );
  }
  async close(): Promise<void> {
    try {
      if (this.context)
        await this.options.secrets.setSecret(
          `browser/${this.options.accountId}`,
          JSON.stringify(await this.context.storageState())
        );
    } finally {
      await this.browser?.close();
      this.context = null;
      this.browser = null;
      this.page = null;
    }
  }
}
