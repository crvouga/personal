// Real Keycloak, PostgreSQL, mock upstream, and browser redirects. No Google IO.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// Synchronous fixture provisioning can outlive a pooled socket's keepalive.
// Close each test connection rather than retrying any authorization code.
function fixtureFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('connection', 'close');
  return globalThis.fetch(url, { ...options, headers });
}
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const require = createRequire(join(repo, 'packages/auth-relay/package.json'));
const { chromium } = require('@playwright/test');
const issuer = 'http://localhost:19080/realms/compatibility';
let activeBackend = 'http://localhost:18080';
let brokerEndpoint = issuer;
const temp = mkdtempSync(join(tmpdir(), 'auth-relay-e2e-'));
const servers = [];
const observedTokens = new Map();
let generations = { initial: { priority: 200, active: true } };
const random = () => randomBytes(32).toString('base64url');
const hash = (x) => createHash('sha256').update(x).digest('base64url');
const clients = {
  a: { port: 3000, uri: 'http://localhost:3000/callback' },
  b: { port: 5173, uri: 'http://localhost:5173/callback' },
  c: {
    port: Number(process.env.AUTH_TEST_PORT_C ?? 8080),
    uri: `http://127.0.0.1:${process.env.AUTH_TEST_PORT_C ?? 8080}/callback`,
  },
  d: { port: 3443, uri: 'https://project-a.test:3443/callback', tls: true },
  e: { port: 5443, uri: 'https://project-b.test:5443/callback', tls: true },
};
let browser;
const control = (path) =>
  fixtureFetch('http://127.0.0.1:8090/' + path, {
    headers: { connection: 'close' },
    signal: AbortSignal.timeout(5000),
  });
const tofu = (...args) =>
  execFileSync('tofu', [`-chdir=${temp}`, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      KEYCLOAK_CLIENT_ID: 'admin-cli',
      KEYCLOAK_USER: 'admin',
      KEYCLOAK_PASSWORD: 'test-only',
      KEYCLOAK_CLIENT_SECRET: '',
      KEYCLOAK_URL: 'http://localhost:18080',
    },
  });
function configure(enabled = true, extra = '') {
  extra += `
module "signing" {
 source = ${JSON.stringify(join(repo, 'packages/infra/tofu/modules/auth-signing-keys'))}
 realm_id = "compatibility"
 generations = ${JSON.stringify(generations)}
}
`;

  const modules = Object.entries(clients)
    .map(
      ([id, c]) => `module "${id}" {
    source = ${JSON.stringify(join(repo, 'packages/infra/tofu/modules/auth-client'))}
    realm_id = "compatibility"
    client_id = "project-${id}"
    redirect_uris = [${JSON.stringify(c.uri)}]
    enabled = ${id === 'c' ? enabled : true}
  }`
    )
    .join('\n');
  writeFileSync(
    join(temp, 'main.tf'),
    `terraform {\nrequired_providers {\nkeycloak = { source = "keycloak/keycloak", version = "= 5.9.0" }\n}\n}\nprovider "keycloak" {\nurl = "http://localhost:18080"\n}\n${modules}\n${extra}`
  );
}
function apply() {
  tofu('plan', '-input=false', '-out=apply.tfplan');
  tofu('apply', '-input=false', 'apply.tfplan');
}
const discovery = async () =>
  (await fixtureFetch(`${issuer}/.well-known/openid-configuration`)).json();
async function application(id, c) {
  const transactions = new Map();
  const sessions = new Set();
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, c.uri);
      const cookies = Object.fromEntries(
        (req.headers.cookie ?? '').split(';').map((x) => x.trim().split('='))
      );
      if (url.pathname === '/private') {
        res.writeHead(sessions.has(cookies[`session_${id}`]) ? 200 : 401);
        return res.end(
          sessions.has(cookies[`session_${id}`])
            ? 'authenticated'
            : 'unauthenticated'
        );
      }
      if (url.pathname === '/login') {
        const state = random(),
          verifier = random(),
          nonce = random(),
          binding = random();
        transactions.set(state, {
          verifier,
          nonce,
          binding,
          expires: Date.now() + 600_000,
        });
        const target = new URL(`${issuer}/protocol/openid-connect/auth`);
        target.search = new URLSearchParams({
          client_id: `project-${id}`,
          redirect_uri: c.uri,
          response_type: 'code',
          scope: 'openid email profile',
          state,
          nonce,
          code_challenge: hash(verifier),
          code_challenge_method: 'S256',
          kc_idp_hint: 'google',
        });
        // A per-transaction cookie supports simultaneous tabs; names include
        // application identity because localhost cookies do not isolate ports.
        res.writeHead(302, {
          location: target.href,
          'set-cookie': `tx_${id}_${state}=${binding}; HttpOnly; SameSite=Lax; Path=/callback; Max-Age=600`,
        });
        return res.end();
      }
      if (url.pathname === '/callback') {
        const state = url.searchParams.get('state');
        const tx = transactions.get(state);
        transactions.delete(state);
        if (
          !tx ||
          tx.expires < Date.now() ||
          cookies[`tx_${id}_${state}`] !== tx.binding ||
          url.searchParams.has('error')
        ) {
          res.writeHead(400);
          return res.end('Sign-in failed. Start a new sign-in.');
        }
        // A one-time code exchange is attempted once, with a bounded timeout.
        const response = await fixtureFetch(
          `${brokerEndpoint}/protocol/openid-connect/token`,
          {
            method: 'POST',
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: `project-${id}`,
              code: url.searchParams.get('code'),
              code_verifier: tx.verifier,
              redirect_uri: c.uri,
            }),
            signal: AbortSignal.timeout(5000),
          }
        );
        if (!response.ok) throw new Error('Token exchange failed');
        const token = (await response.json()).id_token;
        const [header, payload, signature] = token.split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url'));
        const kid = JSON.parse(Buffer.from(header, 'base64url')).kid;
        observedTokens.set(id, { token, kid });
        const jwks = await (
          await fixtureFetch(`${brokerEndpoint}/protocol/openid-connect/certs`)
        ).json();
        const key = jwks.keys.find((x) => x.kid === kid);
        assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
        assert(
          verify(
            'RSA-SHA256',
            Buffer.from(`${header}.${payload}`),
            createPublicKey({ key, format: 'jwk' }),
            Buffer.from(signature, 'base64url')
          )
        );
        assert.equal(claims.iss, issuer);
        assert.equal(claims.aud, `project-${id}`);
        assert.equal(claims.nonce, tx.nonce);
        assert(claims.exp > Date.now() / 1000);
        const session = random();
        sessions.add(session);
        res.writeHead(302, {
          location: '/private',
          'set-cookie': `session_${id}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
        });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    } catch {
      res.writeHead(503);
      res.end('Sign-in is temporarily unavailable. Start a new sign-in later.');
    }
  };
  const server = c.tls
    ? createHttpsServer(
        {
          key: readFileSync(join(temp, 'key.pem')),
          cert: readFileSync(join(temp, 'cert.pem')),
        },
        handler
      )
    : createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(c.port, '127.0.0.1', resolve);
  });
  servers.push(server);
}
async function login(context, id) {
  const page = await context.newPage();
  await page.goto(new URL('/login', clients[id].uri).href);
  await page.waitForURL('**/private', { timeout: 30_000 });
  assert.equal(await page.textContent('body'), 'authenticated');
  return page;
}
async function rejectRedirect(uri) {
  const url = new URL(`${issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: 'project-a',
    redirect_uri: uri,
    response_type: 'code',
    scope: 'openid',
    state: random(),
    code_challenge: hash(random()),
    code_challenge_method: 'S256',
  });
  const response = await fixtureFetch(url, { redirect: 'manual' });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
}
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(temp, 'key.pem'),
      '-out',
      join(temp, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=project-a.test',
      '-addext',
      'subjectAltName=DNS:project-a.test,DNS:project-b.test',
    ],
    { stdio: 'pipe' }
  );
  configure();
  tofu('init', '-input=false');
  apply();
  for (const [id, c] of Object.entries(clients)) await application(id, c);
  const proxy = createServer((req, res) => {
    const upstream = httpRequest(
      activeBackend + req.url,
      { method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(503);
      res.end('Broker temporarily unavailable');
    });
    req.pipe(upstream);
  });
  await new Promise((resolve) => proxy.listen(19080, '127.0.0.1', resolve));
  servers.push(proxy);
  const anonymous = await fixtureFetch(
    `${issuer}/clients-registrations/openid-connect`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'unauthorized',
        redirect_uris: ['https://attacker.test/callback'],
      }),
    }
  );
  assert([401, 403].includes(anonymous.status));
  console.log('PASS unauthenticated dynamic registration rejected');
  const config = await discovery();
  assert.equal(config.issuer, issuer);
  browser = await chromium.launch({
    headless: true,
    args: [
      '--host-resolver-rules=MAP project-a.test 127.0.0.1, MAP project-b.test 127.0.0.1',
    ],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await login(context, 'b');
  assert.equal(
    (
      await context.request.get(new URL('/private', clients.a.uri).href)
    ).status(),
    401
  );
  // Independent projects, two tabs, localhost and 127.0.0.1, concurrently.
  const results = await Promise.allSettled(
    ['a', 'b', 'c', 'a', 'd', 'e'].map((id) => login(context, id))
  );
  const failures = results.filter((result) => result.status === 'rejected');
  assert.deepEqual(
    failures.map((result) => result.reason.message),
    []
  );
  const pages = results.map((result) => result.value);
  console.log(
    'PASS three localhost ports, two unrelated HTTPS domains, unrelated clients, simultaneous tabs'
  );
  const oldToken = observedTokens.get('b');
  generations = {
    initial: { priority: 200, active: false },
    next: { priority: 300, active: true },
  };
  configure();
  apply();
  await login(context, 'b');
  for (
    let attempt = 0;
    observedTokens.get('b').kid === oldToken.kid && attempt < 10;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await login(context, 'b');
  }
  if (observedTokens.get('b').kid === oldToken.kid) {
    const state = JSON.parse(tofu('show', '-json'));
    console.log(
      'Signing provider metadata',
      state.values.root_module.child_modules
        .find((m) => m.address === 'module.signing')
        .resources.filter((r) => r.type === 'keycloak_realm_keystore_rsa')
        .map((r) => ({
          name: r.values.name,
          active: r.values.active,
          priority: r.values.priority,
        }))
    );
  }
  assert.notEqual(observedTokens.get('b').kid, oldToken.kid);
  const rotatedKeys = (
    await (await fixtureFetch(`${issuer}/protocol/openid-connect/certs`)).json()
  ).keys;
  const retained = rotatedKeys.find((key) => key.kid === oldToken.kid);
  assert(retained, 'previous verification key remains published');
  const [oldHeader, oldPayload, oldSignature] = oldToken.token.split('.');
  assert(
    verify(
      'RSA-SHA256',
      Buffer.from(`${oldHeader}.${oldPayload}`),
      createPublicKey({ key: retained, format: 'jwk' }),
      Buffer.from(oldSignature, 'base64url')
    )
  );
  console.log(
    'PASS signing-key rotation issues new signatures while retaining old verification keys'
  );
  await rejectRedirect('https://attacker.example/callback');
  await rejectRedirect('http://localhost:43123/callback');
  await rejectRedirect('http://localhost:3000/callback/evil');
  console.log('PASS exact callback rejection');
  // New exact callback on a changing port: no Google configuration change.
  await new Promise((resolve) => servers[0].close(resolve));
  clients.a = { port: 43123, uri: 'http://localhost:43123/callback' };
  configure();
  apply();
  await application('a', clients.a);
  await login(context, 'a');
  console.log('PASS authenticated exact registration on changed local port');
  configure(false);
  apply();
  const disabled = await fixtureFetch(
    `${issuer}/protocol/openid-connect/auth?` +
      new URLSearchParams({
        client_id: 'project-c',
        redirect_uri: clients.c.uri,
        response_type: 'code',
        scope: 'openid',
        state: random(),
        code_challenge: hash(random()),
        code_challenge_method: 'S256',
      }),
    { redirect: 'manual' }
  );
  assert.equal(disabled.status, 400);
  await login(context, 'b');
  console.log('PASS preview-style revocation preserves other clients');
  // A malformed registration fails before update and leaves B operational.
  const saved = clients.b.uri;
  clients.b.uri = 'http://localhost:5173/*';
  configure();
  assert.throws(() => tofu('plan', '-input=false'));
  clients.b.uri = saved;
  await login(context, 'b');
  console.log('PASS failed registration preserves valid configuration');
  // Force upstream outage with a new browser, avoiding broker SSO reuse.
  await control('outage?enabled=true');
  const fresh = await browser.newContext();
  const failed = await fresh.newPage();
  await failed.goto(new URL('/login', clients.b.uri).href);
  assert(!failed.url().endsWith('/private'));
  assert.equal(
    await (
      await context.request.get(new URL('/private', clients.b.uri).href)
    ).text(),
    'authenticated'
  );
  await control('outage?enabled=false');
  console.log(
    'PASS upstream outage fails closed; established app session remains usable'
  );
  // Start a login, then terminate one broker while the surviving replica holds
  // the distributed authentication session. Route callback to the survivor.
  const restartContext = await browser.newContext();
  const pending = await restartContext.newPage();
  await control('pause');
  const navigation = pending
    .goto(new URL('/login', clients.b.uri).href, { timeout: 60_000 })
    .then(
      () => null,
      (error) => error
    );
  let reached = false;
  for (let i = 0; i < 100; i++) {
    reached = (await (await control('status')).json()).pending;
    if (reached) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(reached, 'upstream authorization was reached');
  activeBackend = 'http://localhost:18081';
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'auth-relay-compatibility',
      '-f',
      join(here, 'compose.yml'),
      'stop',
      '--timeout',
      '60',
      'broker',
    ],
    { stdio: 'pipe' }
  );
  await control('release');
  await navigation;
  await pending.waitForURL('**/private', { timeout: 30_000 });
  assert.equal(await pending.textContent('body'), 'authenticated');
  console.log(
    'PASS initiating replica terminates during login; surviving replica completes it'
  );
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'auth-relay-compatibility',
      '-f',
      join(here, 'compose.yml'),
      'stop',
      '--timeout',
      '60',
      'replica',
    ],
    { stdio: 'pipe' }
  );
  assert.equal(
    await (
      await context.request.get(new URL('/private', clients.b.uri).href)
    ).text(),
    'authenticated'
  );
  console.log(
    'PASS established application session survives complete broker outage'
  );
  for (const page of pages) await page.close();
} finally {
  if (browser) await browser.close();
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers.map((s) => new Promise((resolve) => s.close(resolve)))
  );
  rmSync(temp, { recursive: true, force: true });
}
