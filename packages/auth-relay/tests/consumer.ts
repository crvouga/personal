import * as oidc from 'openid-client';
import { digest, random } from '../src/db';

// An independent SSR consumer fixture. Its sessions belong to the application,
// not the relay, and its callback uses the standard public-client OIDC profile.
export async function consumer(issuer: string, id: string, port: number) {
  const config = await oidc.discovery(
    new URL(issuer),
    id,
    undefined,
    oidc.None(),
    { execute: [oidc.allowInsecureRequests] }
  );
  const callback = `http://localhost:${port}/callback`;
  const transactions = new Map<
    string,
    { verifier: string; nonce: string; binding: string }
  >();
  const sessions = new Set<string>();
  const cookie = `app_${port}`;
  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/login') {
        const state = random(),
          verifier = oidc.randomPKCECodeVerifier(),
          nonce = random(),
          binding = random();
        transactions.set(state, { verifier, nonce, binding: digest(binding) });
        const target = oidc.buildAuthorizationUrl(config, {
          redirect_uri: callback,
          scope: 'openid',
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          kc_idp_hint: 'google',
        });
        return new Response(null, {
          status: 302,
          headers: {
            location: target.href,
            'Set-Cookie': `${cookie}_tx=${binding}; HttpOnly; SameSite=Lax; Path=/`,
          },
        });
      }
      if (url.pathname === '/callback') {
        const state = url.searchParams.get('state') ?? '';
        const tx = transactions.get(state);
        transactions.delete(state);
        const browserCookie = request.headers.get('cookie') ?? '';
        const binding =
          browserCookie
            .split('; ')
            .find((part) => part.startsWith(`${cookie}_tx=`))
            ?.split('=')[1] ?? '';
        if (!tx || digest(binding) !== tx.binding)
          return new Response('Invalid state', { status: 400 });
        await oidc.authorizationCodeGrant(config, url, {
          expectedState: state,
          expectedNonce: tx.nonce,
          pkceCodeVerifier: tx.verifier,
        });
        const session = random();
        sessions.add(session);
        return new Response(null, {
          status: 302,
          headers: {
            location: '/private',
            'Set-Cookie': `${cookie}=${session}; HttpOnly; SameSite=Lax; Path=/`,
          },
        });
      }
      const value =
        (request.headers.get('cookie') ?? '')
          .split('; ')
          .find((part) => part.startsWith(`${cookie}=`))
          ?.split('=')[1] ?? '';
      return new Response(
        sessions.has(value) ? 'authenticated' : 'unauthorized',
        { status: sessions.has(value) ? 200 : 401 }
      );
    },
  });
}
