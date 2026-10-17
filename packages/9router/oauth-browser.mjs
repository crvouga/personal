// Narrow, user-approved exception to the repository's no-dependency-patches rule.
// Copied into the pinned upstream source before its normal Next.js build.
export const CLAUDE_MANUAL_CALLBACK =
  'https://platform.claude.com/oauth/code/callback';

export function isLoopbackHostname(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

export function browserOAuthFlow(provider, location) {
  const local = isLoopbackHostname(location.hostname);
  const port = location.port || (location.protocol === 'https:' ? '443' : '80');
  const fixed = {
    codex: 'http://localhost:1455/auth/callback',
    xai: 'http://127.0.0.1:56121/callback',
    trae: 'http://127.0.0.1:8080/callback',
    windsurf: 'http://127.0.0.1:8080/windsurf-auth-callback',
    zed: 'http://127.0.0.1:58443/',
  };
  // These installed-app registrations accept loopback callbacks, not arbitrary
  // public dashboard hostnames. The browser must hand their code back manually.
  const google = ['antigravity', 'gemini-cli'].includes(provider);
  const redirectUri =
    fixed[provider] ||
    (provider === 'claude' && !local
      ? CLAUDE_MANUAL_CALLBACK
      : local || google
        ? `http://localhost:${local ? port : '8080'}/callback`
        : new URL('/callback', location.origin).href);
  return {
    redirectUri,
    local,
    manual:
      !local && (provider === 'claude' || Boolean(fixed[provider]) || google),
    startProxy: local && Boolean(fixed[provider]),
  };
}

export function shouldUseDeviceCode(provider, location) {
  return provider === 'codex' && !isLoopbackHostname(location.hostname);
}

// Native-app providers require loopback redirects. Hosted dashboards cannot
// receive those callbacks: keep attempt material in the modal for manual entry.
export async function hostedProxyAuth(provider, location, fetcher = fetch) {
  const flow = browserOAuthFlow(provider, location);
  if (flow.local) return null;
  const url = new URL(`/api/oauth/${provider}/authorize`, location.origin);
  url.searchParams.set('redirect_uri', flow.redirectUri);
  const response = await fetcher(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to start login.');
  if (!data.authUrl)
    throw new Error('No authorization URL returned. Restart login.');
  return { ...data, redirectUri: flow.redirectUri, manual: true };
}

export function callbackStateMatches(expected, actual) {
  return (
    typeof expected === 'string' && expected.length > 0 && expected === actual
  );
}

export function requireCallbackState(expected, actual) {
  if (!callbackStateMatches(expected, actual)) {
    throw new Error(
      'OAuth state does not match this login attempt. Start login again.'
    );
  }
}

export function parseClaudeCallback(input, expectedState) {
  const value = input.trim();
  let code;
  let state;
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.searchParams.has('error')) {
      throw new Error(
        url.searchParams.get('error_description') ||
          url.searchParams.get('error')
      );
    }
    code = url.searchParams.get('code');
    state = url.searchParams.get('state');
  } else {
    // Anthropic's manual callback displays code#state. Plain codes are also
    // accepted and remain bound to this attempt by its original PKCE verifier.
    const parts = value.split('#');
    if (parts.length > 2) throw new Error('Invalid Claude authorization code.');
    [code, state = expectedState] = parts;
  }
  requireCallbackState(expectedState, state);
  if (!code || /[\s#]/.test(code))
    throw new Error(
      'Paste the complete Claude authorization code or callback URL.'
    );
  return { code, state };
}

export function isTrustedCallbackOrigin(origin, dashboardOrigin) {
  try {
    const url = new URL(origin);
    return (
      origin === dashboardOrigin ||
      (['http:', 'https:'].includes(url.protocol) &&
        isLoopbackHostname(url.hostname))
    );
  } catch {
    return false;
  }
}
