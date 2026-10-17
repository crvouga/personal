// OpenAI's device login avoids installed-app loopback callbacks on hosted apps.
// Protocol: openai/codex codex-rs/login/src/device_code_auth.rs.
const ISSUER = 'https://auth.openai.com';
const DEVICE_API = `${ISSUER}/api/accounts/deviceauth`;

async function post(fetcher, url, body, form = false) {
  return fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': form
        ? 'application/x-www-form-urlencoded'
        : 'application/json',
      Accept: 'application/json',
    },
    body: form ? new URLSearchParams(body) : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

export async function requestCodexDeviceCode(config, fetcher = fetch) {
  const response = await post(fetcher, `${DEVICE_API}/usercode`, {
    client_id: config.clientId,
  });
  if (!response.ok) {
    throw new Error(
      `Codex device login failed (HTTP ${response.status}). Enable device code login in ChatGPT security settings or workspace permissions, or use the callback URL option.`
    );
  }
  const data = await response.json();
  const userCode = data.user_code || data.usercode;
  if (!data.device_auth_id || !userCode)
    throw new Error('Codex device login returned an incomplete response.');
  const interval = Number(data.interval);
  return {
    device_code: data.device_auth_id,
    user_code: userCode,
    verification_uri: `${ISSUER}/codex/device`,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
    expires_in: 900,
  };
}

export async function pollCodexDeviceCode(
  config,
  deviceCode,
  userCode,
  fetcher = fetch
) {
  if (!deviceCode || !userCode)
    throw new Error('Missing Codex device login attempt. Restart login.');
  const response = await post(fetcher, `${DEVICE_API}/token`, {
    device_auth_id: deviceCode,
    user_code: userCode,
  });
  // OpenAI uses 403/404 for a device code that has not been approved yet.
  if ([403, 404, 429].includes(response.status)) {
    return {
      ok: false,
      error: response.status === 429 ? 'slow_down' : 'authorization_pending',
      pending: true,
    };
  }
  if (!response.ok)
    throw new Error(`Codex device login failed (HTTP ${response.status}).`);
  const grant = await response.json();
  if (!grant.authorization_code || !grant.code_verifier)
    throw new Error('Codex device login returned an incomplete grant.');
  const tokens = await post(
    fetcher,
    config.tokenUrl,
    {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code: grant.authorization_code,
      code_verifier: grant.code_verifier,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
    },
    true
  );
  if (!tokens.ok)
    throw new Error(
      `Codex device token exchange failed (HTTP ${tokens.status}). Restart login.`
    );
  const data = await tokens.json();
  if (!data.access_token)
    throw new Error(
      'Codex device login returned no access token. Restart login.'
    );
  return { ok: true, data };
}
