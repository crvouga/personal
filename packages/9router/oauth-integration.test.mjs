import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as browser from './oauth-browser.mjs';
import * as device from './codex-device.mjs';

// Run against the checksum-verified, patched upstream tree in the image build.
// Normal workspace tests exercise the standalone helpers without downloading it.
const source = process.env.NINE_ROUTER_SOURCE;
const integration = (name, run) => test(name, { skip: !source }, run);
async function load(relative, imports, globals = {}) {
  const require = createRequire(resolve(source, 'package.json'));
  const { transform, loadBindings } = require('next/dist/build/swc');
  await loadBindings();
  const code = await readFile(resolve(source, relative), 'utf8');
  const result = await transform(code, {
    filename: relative,
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  const exports = {};
  const names = Object.keys(globals);
  new Function('require', 'exports', ...names, result.code)(
    (id) => {
      assert.ok(id in imports, `Unexpected import ${id}`);
      return imports[id];
    },
    exports,
    ...Object.values(globals)
  );
  return exports;
}

async function modal(provider, fetcher, address = 'https://router.example') {
  const values = [],
    effects = [],
    timers = [],
    calls = [],
    tabs = [];
  let index = 0,
    dirty = true,
    tree,
    successes = 0;
  const slot = () => index++;
  const changed = (before, next) =>
    !next || !before || next.some((value, i) => value !== before[i]);
  const hooks = {
    useState(initial) {
      const i = slot();
      if (!(i in values)) values[i] = initial;
      return [
        values[i],
        (next) => {
          values[i] = typeof next === 'function' ? next(values[i]) : next;
          dirty = true;
        },
      ];
    },
    useRef(initial) {
      const i = slot();
      return (values[i] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const i = slot();
      if (changed(values[i]?.deps, deps)) values[i] = { fn, deps };
      return values[i].fn;
    },
    useEffect(fn, deps) {
      const i = slot();
      if (changed(values[i], deps)) {
        values[i] = deps;
        effects.push(fn);
      }
    },
  };
  const types = new Proxy(() => types, { get: () => types });
  const jsx = (type, props) => ({ type, props });
  const fetchMock = async (url, options) => {
    calls.push({ url: String(url), options });
    return fetcher(String(url), options);
  };
  const Component = (
    await load(
      `src/shared/components/${provider === 'zed' ? 'ZedAuthModal' : 'OAuthModal'}.js`,
      {
        react: hooks,
        'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
        'prop-types': types,
        '@/shared/components': {
          Modal: 'Modal',
          Button: 'Button',
          Input: 'Input',
        },
        '@/shared/hooks/useCopyToClipboard': {
          useCopyToClipboard: () => ({ copy() {} }),
        },
        '@/lib/oauth/oauth-browser.mjs': {
          ...browser,
          hostedProxyAuth: (id, location) =>
            browser.hostedProxyAuth(id, location, fetchMock),
        },
      },
      {
        window: {
          location: new URL(address),
          open: (url) => {
            tabs.push(url);
            return {};
          },
          addEventListener() {},
          removeEventListener() {},
        },
        localStorage: {
          getItem() {
            return null;
          },
          removeItem() {},
        },
        BroadcastChannel: class {
          close() {}
        },
        fetch: fetchMock,
        setTimeout: (fn) => timers.push(fn),
      }
    )
  ).default;
  const props = {
    isOpen: true,
    provider,
    providerInfo: { name: provider },
    onClose() {},
    onSuccess() {
      successes++;
    },
  };
  const flush = async () => {
    for (let i = 0; i < 12; i++) {
      if (dirty) {
        dirty = false;
        index = 0;
        tree = Component(props);
      }
      while (effects.length) effects.shift()();
      await new Promise(setImmediate);
    }
  };
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    return [node, ...nodes(node.props?.children)];
  }
  await flush();
  return {
    calls,
    tabs,
    timers,
    flush,
    nodes: () => nodes(tree),
    successes: () => successes,
  };
}

integration(
  'patched hosted Codex modal selects device login and completes polling',
  async () => {
    const app = await modal('codex', async (url, options) => {
      if (url.endsWith('/device-code'))
        return Response.json({
          device_code: 'attempt',
          user_code: 'ABCD',
          verification_uri: 'https://auth.openai.com/codex/device',
          expires_in: 900,
        });
      assert.equal(url, '/api/oauth/codex/poll');
      assert.deepEqual(JSON.parse(options.body), {
        deviceCode: 'attempt',
        extraData: { userCode: 'ABCD' },
      });
      return Response.json({ success: true });
    });
    assert.deepEqual(app.tabs, ['https://auth.openai.com/codex/device']);
    app.timers.shift()();
    await app.flush();
    assert.equal(app.successes(), 1);
    assert.equal(app.calls.length, 2);
  }
);

integration(
  'disabled device login offers manual Codex callback with original PKCE/state',
  async () => {
    const app = await modal('codex', async (url, options) => {
      if (url.endsWith('/device-code'))
        return Response.json(
          { error: 'Device login unavailable' },
          { status: 400 }
        );
      if (url.includes('/authorize')) {
        assert.equal(
          new URL(url).searchParams.get('redirect_uri'),
          'http://localhost:1455/auth/callback'
        );
        return Response.json({
          authUrl: 'https://auth.openai.com/oauth/authorize',
          state: 'attempt',
          codeVerifier: 'verifier',
        });
      }
      assert.equal(url, '/api/oauth/codex/exchange');
      assert.deepEqual(JSON.parse(options.body), {
        code: 'code',
        state: 'attempt',
        redirectUri: 'http://localhost:1455/auth/callback',
        codeVerifier: 'verifier',
      });
      return Response.json({ success: true });
    });
    app
      .nodes()
      .find(
        (node) =>
          node.type === 'Button' &&
          node.props.children === 'Use callback URL instead'
      )
      .props.onClick();
    await app.flush();
    const input = app
      .nodes()
      .find((node) => node.type === 'Input' && node.props.onChange);
    input.props.onChange({
      target: {
        value: 'http://localhost:1455/auth/callback?code=code&state=attempt',
      },
    });
    await app.flush();
    await app
      .nodes()
      .find(
        (node) => node.type === 'Button' && node.props.children === 'Connect'
      )
      .props.onClick();
    await app.flush();
    assert.equal(app.successes(), 1);
    assert.equal(app.calls.length, 3);
  }
);

integration(
  'all hosted native modals avoid proxy listeners, session registration and status polling',
  async () => {
    for (const provider of ['trae', 'windsurf', 'zed']) {
      const app = await modal(provider, async (url) => {
        if (url.endsWith('/ide-status'))
          return Response.json({ installed: false });
        assert.equal(new URL(url).pathname, `/api/oauth/${provider}/authorize`);
        return Response.json({
          authUrl: 'https://provider.example/login',
          state: 'attempt',
          codeVerifier: 'private',
          systemId: 'system',
        });
      });
      assert.deepEqual(app.tabs, ['https://provider.example/login']);
      assert.equal(app.timers.length, 0);
      assert.ok(
        !app.calls.some(({ url }) =>
          /proxy|poll-status|register-session|auto-import/.test(url)
        )
      );
    }
  }
);

integration(
  'patched Codex API saves the mapped device tokens and leaves pending attempts unsaved',
  async () => {
    const saved = [];
    let approved = false;
    const config = {
      clientId: 'client',
      tokenUrl: 'https://auth.openai.com/oauth/token',
    };
    const fetcher = async (url) => {
      if (url.endsWith('/usercode'))
        return Response.json({
          device_auth_id: 'attempt',
          user_code: 'ABCD',
          interval: '5',
        });
      if (url.endsWith('/deviceauth/token'))
        return approved
          ? Response.json({
              authorization_code: 'grant',
              code_verifier: 'verifier',
            })
          : new Response('', { status: 403 });
      return Response.json({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
      });
    };
    const api = await load('src/app/api/oauth/[provider]/[action]/route.js', {
      crypto: {},
      'next/server': { NextResponse: { json: Response.json } },
      '@/lib/oauth/codex-device.mjs': {
        requestCodexDeviceCode: (cfg) =>
          device.requestCodexDeviceCode(cfg, fetcher),
        pollCodexDeviceCode: (cfg, id, code) =>
          device.pollCodexDeviceCode(cfg, id, code, fetcher),
      },
      '@/lib/oauth/providers': {
        getProvider: () => ({
          config,
          mapTokens: (data) => ({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
          }),
        }),
      },
      '@/models': {
        createProviderConnection: async (data) => {
          saved.push(data);
          return { id: 'connection', ...data };
        },
      },
      'open-sse/shared/mimoAccount.js': {},
      '@/lib/oauth/utils/server': {},
      '@/lib/oauth/utils/ideDetect': {},
      '@/lib/oauth/constants/oauth': {},
    });
    const params = (action) => ({
      params: Promise.resolve({ provider: 'codex', action }),
    });
    const started = await api.GET(
      new Request('https://router.example/api/oauth/codex/device-code'),
      params('device-code')
    );
    assert.equal(
      (await started.json()).verification_uri,
      'https://auth.openai.com/codex/device'
    );
    const poll = () =>
      api.POST(
        new Request('https://router.example/api/oauth/codex/poll', {
          method: 'POST',
          body: JSON.stringify({
            deviceCode: 'attempt',
            extraData: { userCode: 'ABCD' },
          }),
        }),
        params('poll')
      );
    assert.equal((await (await poll()).json()).pending, true);
    assert.equal(saved.length, 0);
    approved = true;
    assert.equal((await (await poll()).json()).success, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].provider, 'codex');
    assert.equal(saved[0].accessToken, 'access');
    assert.equal(saved[0].refreshToken, 'refresh');
    assert.ok(Date.parse(saved[0].expiresAt) > Date.now());
  }
);

integration(
  'every hosted browser provider uses its supported callback path',
  async () => {
    for (const provider of [
      'claude',
      'xai',
      'gemini-cli',
      'antigravity',
      'gitlab',
      'cline',
      'clinepass',
      'iflow',
      'kimchi',
    ]) {
      const app = await modal(provider, async (url) => {
        assert.equal(new URL(url).pathname, `/api/oauth/${provider}/authorize`);
        assert.equal(
          new URL(url).searchParams.get('redirect_uri'),
          browser.browserOAuthFlow(provider, new URL('https://router.example'))
            .redirectUri
        );
        return Response.json({
          authUrl: 'https://provider.example/login',
          state: 'attempt',
          codeVerifier: 'verifier',
        });
      });
      assert.deepEqual(app.tabs, ['https://provider.example/login'], provider);
      assert.equal(app.calls.length, 1, provider);
    }
  }
);

integration(
  'local Codex keeps its automatic listener instead of device login',
  async () => {
    const app = await modal(
      'codex',
      async (url) => {
        if (url.includes('/authorize'))
          return Response.json({
            authUrl: 'https://auth.openai.com/oauth/authorize',
            state: 'attempt',
            codeVerifier: 'verifier',
          });
        assert.equal(new URL(url).pathname, '/api/oauth/codex/start-proxy');
        return Response.json({ success: true, serverSide: true });
      },
      'http://localhost:20128'
    );
    assert.equal(app.calls.length, 2);
    assert.deepEqual(app.tabs, ['https://auth.openai.com/oauth/authorize']);
  }
);

integration(
  'hosted native callbacks preserve the original attempt during manual exchange',
  async () => {
    for (const provider of ['trae', 'windsurf', 'zed']) {
      const callback =
        'http://127.0.0.1:58443/?user_id=user&access_token=encrypted';
      const app = await modal(provider, async (url, options) => {
        if (url.endsWith('/ide-status'))
          return Response.json({ installed: false });
        if (url.includes('/authorize'))
          return Response.json({
            authUrl: 'https://provider.example/login',
            state: 'attempt',
            codeVerifier: 'original-private-key',
            systemId: 'original-system-id',
          });
        assert.equal(url, `/api/oauth/${provider}/exchange`);
        const body = JSON.parse(options.body);
        assert.equal(body.code, callback);
        assert.equal(body.state, 'attempt');
        assert.equal(body.codeVerifier, 'original-private-key');
        assert.equal(body.systemId, 'original-system-id');
        assert.equal(
          body.redirectUri,
          browser.browserOAuthFlow(provider, new URL('https://router.example'))
            .redirectUri
        );
        return Response.json({ success: true });
      });
      app
        .nodes()
        .find((node) => node.type === 'Input' && node.props.onChange)
        .props.onChange({ target: { value: callback } });
      await app.flush();
      await app
        .nodes()
        .find(
          (node) =>
            node.type === 'Button' &&
            node.props.onClick &&
            (node.props.children === 'Connect' ||
              (Array.isArray(node.props.children) &&
                node.props.children.includes('Connect')))
        )
        .props.onClick();
      await app.flush();
      assert.equal(app.successes(), 1, provider);
    }
  }
);
