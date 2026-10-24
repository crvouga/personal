import type { Context } from 'hono';
import { logContext } from '@pkgs/logger';

const failures = {
  expired: {
    status: 400,
    title: 'Sign-in expired',
    message:
      'This sign-in expired or could not be verified in this browser. Start a new sign-in.',
  },
  denied: {
    status: 403,
    title: 'Sign-in not allowed',
    message:
      'The identity provider did not allow this sign-in. Try again or contact an operator if you need access.',
  },
  unavailable: {
    status: 503,
    title: 'Sign-in unavailable',
    message:
      'We could not complete your sign-in. The authentication service may be temporarily unavailable. Start a new sign-in shortly; contact an operator if it persists.',
  },
} as const;

export function signInError(
  c: Context,
  reason: keyof typeof failures
): Response {
  const failure = failures[reason];
  const requestId = String(logContext()['requestId'] ?? '');
  const reference = /^[a-f0-9-]{36}$/.test(requestId)
    ? `<p>Reference: <code>${requestId}</code></p>`
    : '';
  c.header('Cache-Control', 'no-store');
  return c.html(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${failure.title}</title><script src="/theme-init.js"></script><link rel="stylesheet" href="/style.css"></head>
<body><main><h1>${failure.title}</h1><section><p>${failure.message}</p>
<a class="button" href="/auth/login">Start a new sign-in</a>
${reference}
<p><a href="/">Return to the authentication relay</a></p>
</section></main></body></html>`,
    failure.status
  );
}
