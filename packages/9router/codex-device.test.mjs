import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  requestCodexDeviceCode,
  pollCodexDeviceCode,
} from './codex-device.mjs';

const config = {
  clientId: 'registered-client',
  tokenUrl: 'https://auth.openai.com/oauth/token',
};

test('device login returns a public verification page, never a localhost URL', async () => {
  for (const key of ['user_code', 'usercode']) {
    const data = await requestCodexDeviceCode(config, async (url, options) => {
      assert.equal(
        url,
        'https://auth.openai.com/api/accounts/deviceauth/usercode'
      );
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), {
        client_id: config.clientId,
      });
      return Response.json({
        device_auth_id: 'attempt',
        [key]: 'ABCD-EFGH',
        interval: '5',
      });
    });
    assert.deepEqual(data, {
      device_code: 'attempt',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://auth.openai.com/codex/device',
      interval: 5,
      expires_in: 900,
    });
  }
});

test('device polling distinguishes pending and rate limiting from fatal failures', async () => {
  for (const status of [403, 404, 429]) {
    const result = await pollCodexDeviceCode(
      config,
      'attempt',
      'user-code',
      async (url, options) => {
        assert.equal(
          url,
          'https://auth.openai.com/api/accounts/deviceauth/token'
        );
        assert.deepEqual(JSON.parse(options.body), {
          device_auth_id: 'attempt',
          user_code: 'user-code',
        });
        return new Response('', { status });
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.pending, true);
    assert.equal(
      result.error,
      status === 429 ? 'slow_down' : 'authorization_pending'
    );
  }
  await assert.rejects(
    pollCodexDeviceCode(
      config,
      'attempt',
      'user-code',
      async () => new Response('', { status: 400 })
    ),
    /HTTP 400/
  );
});

test('approved device grant exchanges its own verifier with the registered device callback', async () => {
  const calls = [];
  const tokens = {
    access_token: 'access',
    refresh_token: 'refresh',
    id_token: 'id',
    expires_in: 3600,
  };
  const result = await pollCodexDeviceCode(
    config,
    'attempt',
    'user-code',
    async (url, options) => {
      calls.push(url);
      if (calls.length === 1)
        return Response.json({
          authorization_code: 'grant',
          code_verifier: 'grant-verifier',
        });
      assert.equal(
        options.headers['Content-Type'],
        'application/x-www-form-urlencoded'
      );
      assert.deepEqual(Object.fromEntries(options.body), {
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code: 'grant',
        code_verifier: 'grant-verifier',
        redirect_uri: 'https://auth.openai.com/deviceauth/callback',
      });
      return Response.json(tokens);
    }
  );
  assert.deepEqual(calls, [
    'https://auth.openai.com/api/accounts/deviceauth/token',
    config.tokenUrl,
  ]);
  assert.deepEqual(result, { ok: true, data: tokens });
});

test('disabled device login explains recovery without echoing upstream secrets', async () => {
  await assert.rejects(
    requestCodexDeviceCode(
      config,
      async () => new Response('sensitive upstream body', { status: 404 })
    ),
    (error) => {
      assert.match(error.message, /Enable device code login/);
      assert.match(error.message, /callback URL option/);
      assert.doesNotMatch(error.message, /sensitive upstream body/);
      return true;
    }
  );
});

test('malformed responses and failed one-shot exchanges cannot claim success', async () => {
  await assert.rejects(
    requestCodexDeviceCode(config, async () => Response.json({})),
    /incomplete response/
  );
  await assert.rejects(
    pollCodexDeviceCode(config, 'attempt', '', () => assert.fail()),
    /Missing Codex/
  );
  await assert.rejects(
    pollCodexDeviceCode(config, 'attempt', 'code', async () =>
      Response.json({})
    ),
    /incomplete grant/
  );
  for (const status of [200, 401]) {
    let call = 0;
    await assert.rejects(
      pollCodexDeviceCode(config, 'attempt', 'code', async () => {
        if (++call === 1)
          return Response.json({
            authorization_code: 'grant',
            code_verifier: 'verifier',
          });
        return Response.json({}, { status });
      }),
      status === 200 ? /no access token/ : /exchange failed/
    );
  }
});
