// Deterministic test identity only. Never included in the production image.
import { createServer } from 'node:http';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const keyPath = process.env.MOCK_PRIVATE_KEY_PATH;
const privateKey =
  keyPath && existsSync(keyPath)
    ? createPrivateKey(readFileSync(keyPath))
    : generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
if (keyPath && !existsSync(keyPath))
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
const publicKey = createPublicKey(privateKey);
const key = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  use: 'sig',
  alg: 'RS256',
};
const codes = new Map();
let unavailable = false;
let pause = false,
  release,
  callbackPort;
const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock:8090');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/pause') {
    pause = true;
    release = undefined;
    callbackPort = undefined;
    return res.end('{}');
  }
  if (url.pathname === '/status')
    return res.end(JSON.stringify({ pending: Boolean(release) }));
  if (url.pathname === '/release') {
    callbackPort = url.searchParams.get('port');
    pause = false;
    release?.();
    return res.end('{}');
  }
  if (url.pathname === '/outage') {
    unavailable = url.searchParams.get('enabled') === 'true';
    return res.end('{}');
  }
  if (unavailable) {
    res.writeHead(503);
    return res.end(JSON.stringify({ error: 'temporarily_unavailable' }));
  }
  if (url.pathname === '/jwks') return res.end(JSON.stringify({ keys: [key] }));
  if (url.pathname === '/authorize') {
    if (pause)
      await new Promise((resolve) => {
        release = resolve;
      });
    const code = randomUUID();
    codes.set(code, {
      nonce: url.searchParams.get('nonce'),
      aud: url.searchParams.get('client_id'),
      redirect: url.searchParams.get('redirect_uri'),
      expires: Date.now() + 60_000,
    });
    const target = new URL(url.searchParams.get('redirect_uri'));
    if (callbackPort) target.port = callbackPort;
    target.searchParams.set('code', code);
    target.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: target.href });
    return res.end();
  }
  if (url.pathname === '/token') {
    const parts = [];
    for await (const part of req) parts.push(part);
    const params = new URLSearchParams(Buffer.concat(parts).toString());
    const code = params.get('code');
    const tx = codes.get(code);
    codes.delete(code);
    if (
      !tx ||
      tx.expires < Date.now() ||
      tx.redirect !== params.get('redirect_uri')
    ) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'http://mock:8090',
      sub: 'mock-user',
      aud: tx.aud,
      nonce: tx.nonce,
      iat: now,
      exp: now + 300,
      email: 'user@example.test',
      email_verified: true,
      given_name: 'Test',
      family_name: 'User',
      preferred_username: 'test-user',
    };
    const signing =
      encode({ alg: 'RS256', kid: key.kid, typ: 'JWT' }) +
      '.' +
      encode(payload);
    const jwt =
      signing +
      '.' +
      sign('RSA-SHA256', Buffer.from(signing), privateKey).toString(
        'base64url'
      );
    return res.end(
      JSON.stringify({
        access_token: 'mock-access',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: jwt,
      })
    );
  }
  res.writeHead(404);
  res.end('{}');
});
server.listen(8090, '0.0.0.0');
// Node as container PID 1 must handle termination explicitly.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
