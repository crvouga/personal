import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLAUDE_MANUAL_CALLBACK,
  browserOAuthFlow,
  callbackStateMatches,
  isTrustedCallbackOrigin,
  parseClaudeCallback,
  requireCallbackState,
} from './oauth-browser.mjs';

const hosted = new URL(
  'https://9router.chrisvouga.dev/dashboard/providers/claude'
);

test('hosted Claude uses its registered manual callback, never localhost:443', () => {
  assert.deepEqual(browserOAuthFlow('claude', hosted), {
    redirectUri: CLAUDE_MANUAL_CALLBACK,
    local: false,
    manual: true,
    startProxy: false,
  });
});

test('hosted fixed-port providers use manual entry without a remote listener', () => {
  for (const [provider, redirectUri] of [
    ['codex', 'http://localhost:1455/auth/callback'],
    ['xai', 'http://127.0.0.1:56121/callback'],
  ]) {
    const flow = browserOAuthFlow(provider, hosted);
    assert.equal(flow.redirectUri, redirectUri);
    assert.equal(flow.manual, true);
    assert.equal(flow.startProxy, false);
  }
});

test('Google installed-app callbacks stay on loopback and offer manual entry', () => {
  for (const provider of ['antigravity', 'gemini-cli']) {
    const flow = browserOAuthFlow(provider, hosted);
    assert.equal(flow.redirectUri, 'http://localhost:8080/callback');
    assert.equal(flow.manual, true);
    assert.equal(flow.startProxy, false);
  }
});

test('other hosted browser callbacks preserve the actual public origin', () => {
  for (const address of [
    'https://9router.chrisvouga.dev',
    'https://router.example:8443',
  ]) {
    const origin = new URL(address);
    const flow = browserOAuthFlow('cline', origin);
    assert.equal(flow.redirectUri, `${origin.origin}/callback`);
    assert.equal(flow.manual, false);
  }
});

test('local IPv4, IPv6 and localhost dashboards retain automatic OAuth', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const location = new URL(`http://${hostname}:20128/dashboard`);
    assert.equal(
      browserOAuthFlow('claude', location).redirectUri,
      'http://localhost:20128/callback'
    );
    const codex = browserOAuthFlow('codex', location);
    assert.equal(codex.startProxy, true);
    assert.equal(codex.manual, false);
    assert.equal(browserOAuthFlow('xai', location).startProxy, true);
  }
});

test('callbacks must match the active attempt, including when state is missing', () => {
  assert.equal(callbackStateMatches('attempt', 'attempt'), true);
  for (const state of [null, undefined, '', 'another-attempt']) {
    assert.equal(callbackStateMatches('attempt', state), false);
    assert.throws(
      () => requireCallbackState('attempt', state),
      /state does not match/
    );
  }
  assert.throws(
    () => requireCallbackState(undefined, undefined),
    /state does not match/
  );
});

test('Claude accepts copied code#state, plain code and full callback URLs', () => {
  const expected = { code: 'test-code', state: 'attempt' };
  for (const input of [
    'test-code#attempt',
    ' test-code ',
    'http://localhost:443/callback?code=test-code&state=attempt',
    `${CLAUDE_MANUAL_CALLBACK}?code=test-code&state=attempt`,
  ])
    assert.deepEqual(parseClaudeCallback(input, 'attempt'), expected);
});

test('Claude rejects wrong/missing URL state, malformed input and provider errors', () => {
  for (const input of [
    'test-code#other-attempt',
    'test-code#',
    'http://localhost:443/callback?code=test-code',
    'http://localhost:443/callback?code=test-code&state=other-attempt',
  ])
    assert.throws(
      () => parseClaudeCallback(input, 'attempt'),
      /state does not match/
    );
  for (const input of ['', 'two words', 'code#attempt#extra']) {
    assert.throws(() => parseClaudeCallback(input, 'attempt'));
  }
  assert.throws(
    () =>
      parseClaudeCallback(
        `${CLAUDE_MANUAL_CALLBACK}?code=test-code%23other-attempt&state=attempt`,
        'attempt'
      ),
    /complete Claude authorization code/
  );
  assert.throws(
    () =>
      parseClaudeCallback(
        `${CLAUDE_MANUAL_CALLBACK}?error=access_denied`,
        'attempt'
      ),
    /access_denied/
  );
});

test('callback origins require exact hosts, rejecting loopback substrings', () => {
  for (const origin of [
    hosted.origin,
    'http://localhost:1455',
    'http://127.0.0.1:8080',
    'http://[::1]:20128',
  ]) {
    assert.equal(isTrustedCallbackOrigin(origin, hosted.origin), true);
  }
  for (const origin of [
    'https://localhost.attacker.example',
    'https://attacker.example/localhost',
    'https://127.0.0.1.attacker.example',
    'null',
    'not-a-url',
  ]) {
    assert.equal(isTrustedCallbackOrigin(origin, hosted.origin), false);
  }
});
