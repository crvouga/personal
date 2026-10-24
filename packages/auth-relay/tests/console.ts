// Disposable PostgreSQL/Keycloak fixture only. Schema lifecycle uses OpenTofu
// and Atlas exactly as production does, never application-startup DDL.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { configuration } from '../src/config';
import { database } from '../src/db';
import { provider } from '../src/oidc';
import { application } from '../src/app';
import { maintenance } from '../src/maintenance';
import { consumer } from './consumer';
import { agentAcceptance } from './agent';

const repo = resolve(import.meta.dir, '../../..');
const portA = Number(process.env['AUTH_CONSOLE_PORT_A'] ?? 3000);
const require = createRequire(join(repo, 'packages/fleet/package.json'));
const { chromium } = require('@playwright/test');
const temp = mkdtempSync(join(tmpdir(), 'auth-console-'));
const databaseUrl =
  'postgres://keycloak:test-only@127.0.0.1:15432/keycloak?sslmode=disable';
writeFileSync(
  join(temp, 'schema.hcl'),
  readFileSync(join(repo, 'packages/auth-relay/schema.hcl'), 'utf8').replaceAll(
    '${schema}',
    'auth_relay_nonproduction'
  )
);
writeFileSync(
  join(temp, 'main.tf'),
  `
terraform {
 required_providers {
  atlas = { source = "ariga/atlas", version = "= 0.10.3" }
  postgresql = { source = "cyrilgdn/postgresql", version = "= 1.26.0" }
 }
}
provider "postgresql" {
 host = "127.0.0.1"
 port = 15432
 username = "keycloak"
 password = "test-only"
 database = "keycloak"
 sslmode = "disable"
}
resource "postgresql_schema" "console" { name = "auth_relay_nonproduction" }
resource "postgresql_schema" "unrelated" { name = "unrelated_fixture" }
resource "atlas_schema" "console" {
 url = "${databaseUrl}&search_path=auth_relay_nonproduction"
 dev_url = "docker://postgres/18/dev?search_path=public"
 hcl = file(${JSON.stringify(join(temp, 'schema.hcl'))})
 depends_on = [postgresql_schema.console]
}
`
);
function tofu(...args: string[]) {
  return execFileSync('tofu', [`-chdir=${temp}`, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}
Object.assign(process.env, {
  AUTH_ORIGIN: 'http://localhost:19080',
  AUTH_UPSTREAM: 'http://127.0.0.1:18080',
  AUTH_REALM: 'compatibility',
  AUTH_ENVIRONMENT: 'nonproduction',
  AUTH_DATABASE_URL: databaseUrl,
  AUTH_CONSOLE_CLIENT_ID: 'auth-relay-console',
  AUTH_CONSOLE_CLIENT_SECRET: 'test-only',
  AUTH_MANAGER_CLIENT_ID: 'auth-relay-registration',
  AUTH_MANAGER_CLIENT_SECRET: 'test-only',
  AUTH_SETUP_TOKEN: 'test-setup-token',
});
tofu('init', '-input=false');
tofu(
  'plan',
  '-input=false',
  '-target=postgresql_schema.console',
  '-target=postgresql_schema.unrelated',
  '-out=schemas.tfplan'
);
tofu('apply', '-input=false', 'schemas.tfplan');
tofu('plan', '-input=false', '-out=tables.tfplan');
tofu('apply', '-input=false', 'tables.tfplan');
const config = configuration();
const db = database(config);
const oidc = await provider(config);
const deps = { db, config, oidc };
let server = Bun.serve({ port: 19080, fetch: application(deps).fetch });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const consumers: ReturnType<typeof Bun.serve>[] = [];
async function api(path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const session = await (await fetch('/api/session')).json();
      const response = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    },
    { path, method, body }
  );
}
try {
  assert.equal((await fetch('http://localhost:19080/api/clients')).status, 401);
  await page.goto('http://localhost:19080/auth/login');
  await page.waitForURL('http://localhost:19080/', { timeout: 30000 });
  assert.equal((await api('/api/clients')).status, 403);
  assert.equal((await api('/api/agent-grants')).status, 403);
  assert.equal(
    (await api('/api/setup', 'POST', { token: 'wrong' })).status,
    403
  );
  assert.equal(
    (await api('/api/setup', 'POST', { token: 'test-setup-token' })).status,
    200
  );
  assert.equal(
    (await api('/api/setup', 'POST', { token: 'test-setup-token' })).status,
    409
  );
  const csrf = await page.evaluate(
    async () =>
      (
        await fetch('/api/clients/app-00000000-0000-0000-0000-000000000000', {
          method: 'DELETE',
        })
      ).status
  );
  assert.equal(csrf, 403);
  const id = `app-${crypto.randomUUID()}`;
  const input = {
    name: 'UI project',
    project: 'ui-project',
    environment: 'localhost',
    instance: 'one',
    callbacks: [`http://localhost:${portA}/callback`],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  assert.equal((await api(`/api/clients/${id}`, 'PUT', input)).status, 200);
  assert.equal(
    (
      await api(`/api/clients/${id}`, 'PUT', {
        ...input,
        callbacks: ['https://*.example.com/callback'],
      })
    ).status,
    400
  );
  assert.deepEqual(
    (await api('/api/clients')).data[0].config.callbacks,
    input.callbacks
  );
  assert.equal((await api(`/api/clients/${id}`, 'PUT', input)).status, 400);
  const upstream = config.upstream;
  config.upstream = 'http://127.0.0.1:1';
  try {
    assert.equal(
      (
        await api(`/api/clients/${id}`, 'PUT', {
          ...input,
          revision: 1,
          callbacks: ['http://localhost:31000/callback'],
        })
      ).status,
      503
    );
  } finally {
    config.upstream = upstream;
  }
  assert.deepEqual(
    (await api('/api/clients')).data[0].config.callbacks,
    input.callbacks
  );
  const clientA = await consumer(config.issuer, id, portA);
  consumers.push(clientA);
  const applicationPage = await context.newPage();
  await applicationPage.goto(`http://localhost:${portA}/login`);
  await applicationPage.waitForURL('**/private');
  assert.equal(await applicationPage.textContent('body'), 'authenticated');
  await server.stop(true);
  server = Bun.serve({
    port: 19080,
    fetch: application({ ...deps, oidc: await provider(config) }).fetch,
  });
  assert.equal((await api('/api/clients')).status, 200);
  assert.equal(
    (
      await api(`/api/clients/${id}`, 'PUT', {
        ...input,
        callbacks: ['http://localhost:43123/callback'],
        revision: 1,
      })
    ).status,
    200
  );
  const url =
    `${config.issuer}/protocol/openid-connect/auth?` +
    new URLSearchParams({
      client_id: id,
      redirect_uri: 'http://localhost:5555/callback',
      response_type: 'code',
      scope: 'openid',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 400);
  assert.equal((await api(`/api/clients/${id}`, 'DELETE')).status, 200);
  assert.equal(
    (await fetch(url.replace('5555', '43123'), { redirect: 'manual' })).status,
    400
  );
  await maintenance(deps);
  const unrelated =
    await db`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'unrelated_fixture'`;
  assert.equal(unrelated.length, 1);
  await page.reload();
  await page.locator('#console').waitFor({ state: 'visible' });
  await page
    .getByRole('button', { name: 'New application', exact: true })
    .first()
    .click();
  const form = page.locator('#registration');
  await form.locator('[name=name]').fill('Second UI project');
  await form.locator('[name=project]').fill('ui-second');
  await form.locator('[name=instance]').fill('local-two');
  await form.locator('[name=callbacks]').fill('http://localhost:5173/callback');
  await form
    .locator('[name=expiresAt]')
    .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  await form.locator('[name=ownership]').check();
  await page.getByRole('button', { name: 'Save registration' }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('#settings')
      ?.textContent?.includes('OIDC_CLIENT_ID=app-')
  );
  const saved = (await api('/api/clients')).data.find(
    (row: { project: string }) => row.project === 'ui-second'
  );
  assert(saved);
  consumers.push(await consumer(config.issuer, saved.id, 5173));
  const secondPage = await context.newPage();
  await secondPage.goto('http://localhost:5173/login');
  await secondPage.waitForURL('**/private');
  assert.equal(await secondPage.textContent('body'), 'authenticated');
  await applicationPage.reload();
  assert.equal(await applicationPage.textContent('body'), 'authenticated');
  assert.equal(
    (await fetch('http://localhost:19080/admin/realms')).status,
    404
  );
  console.log(
    'PASS Google-backed console login, operator bootstrap, CSRF, DB registrations, port update, rejection/revocation, Bun restart, scoped Atlas schema'
  );
  await agentAcceptance(api, deps, id);
  await page.goto('http://localhost:19080/#agents');
  await page
    .getByRole('button', { name: 'Authorize an agent', exact: true })
    .click();
  const grantDialog = page.getByRole('dialog', { name: 'Authorize an agent' });
  await grantDialog.getByRole('textbox', { name: /^Project/ }).fill('ui-agent');
  await grantDialog
    .getByRole('textbox', { name: /^Credential SHA-256 fingerprint/ })
    .fill('f'.repeat(64));
  await grantDialog
    .getByLabel(
      "I verified this project's ownership, credential custody and every approved origin."
    )
    .check();
  await grantDialog.getByRole('button', { name: 'Save agent access' }).click();
  await grantDialog.waitFor({ state: 'hidden' });
  await page.getByText('ui-agent', { exact: true }).waitFor();
  console.log(
    'PASS operator Agent access UI creates a scoped grant using only a fingerprint'
  );
} finally {
  await browser.close();
  for (const app of consumers) await app.stop(true);
  await server.stop(true);
  await db.close();
  rmSync(temp, { recursive: true, force: true });
}
