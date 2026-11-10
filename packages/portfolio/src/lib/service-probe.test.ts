import { describe, expect, test } from 'bun:test';
import {
  mapLimit,
  pageDescriptionOf,
  pageTitleOf,
  probe,
  type Fetcher,
} from './service-probe';

type Reply = { status: number; location?: string; html?: string } | Error;

/** A fake network: URL → reply, recording what was asked. */
const network =
  (replies: Readonly<Record<string, Reply>>): Fetcher =>
  (url) => {
    const reply = replies[url];
    if (reply === undefined)
      return Promise.reject(new Error(`unexpected ${url}`));
    if (reply instanceof Error) return Promise.reject(reply);
    const headers = new Headers();
    if (reply.location !== undefined) headers.set('location', reply.location);
    if (reply.html !== undefined)
      headers.set('content-type', 'text/html; charset=utf-8');
    return Promise.resolve(
      new Response(reply.html ?? null, { status: reply.status, headers })
    );
  };

const A = 'https://a.example.dev/';

describe('probe', () => {
  test('a page anyone can open is live, with its title and description', async () => {
    const result = await probe(
      A,
      network({
        [A]: {
          status: 200,
          html: '<title>Snake &amp; Co</title><meta name="description" content="Eat the dots.">',
        },
      })
    );
    expect(result).toMatchObject({
      status: 'live',
      pageTitle: 'Snake & Co',
      pageDescription: 'Eat the dots.',
    });
  });

  test('follows redirects to the final page', async () => {
    const result = await probe(
      A,
      network({
        [A]: { status: 301, location: '/app/' },
        [`${A}app/`]: { status: 200, html: '<title>App</title>' },
      })
    );
    expect(result).toMatchObject({ status: 'live', finalUrl: `${A}app/` });
  });

  test('a redirect to a login path or a 401/403 is gated', async () => {
    expect(
      (
        await probe(
          A,
          network({ [A]: { status: 302, location: '/auth?returnTo=%2F' } })
        )
      ).status
    ).toBe('gated');
    expect((await probe(A, network({ [A]: { status: 403 } }))).status).toBe(
      'gated'
    );
  });

  test('a "coming soon" or expired page is parked', async () => {
    const result = await probe(
      A,
      network({ [A]: { status: 200, html: '<title>Coming Soon</title>' } })
    );
    expect(result.status).toBe('parked');
  });

  test('error statuses, network failures and redirect loops are down', async () => {
    expect((await probe(A, network({ [A]: { status: 530 } }))).status).toBe(
      'down'
    );
    const failure = new TypeError('fetch failed', {
      cause: Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
    });
    expect(await probe(A, network({ [A]: failure }))).toMatchObject({
      status: 'down',
      detail: 'no answer (ENOTFOUND)',
    });
    expect(
      (await probe(A, network({ [A]: { status: 302, location: A } }))).status
    ).toBe('down');
  });
});

describe('page metadata', () => {
  test('reads the title and either description, in any attribute order', () => {
    expect(pageTitleOf('<TITLE>\n  Hi  there </TITLE>')).toBe('Hi there');
    expect(
      pageDescriptionOf(`<meta content='Two' property="og:description">`)
    ).toBe('Two');
    expect(pageTitleOf('<p>no title</p>')).toBeNull();
  });
});

test('mapLimit keeps order and never exceeds the limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapLimit([5, 1, 3, 2, 4], 2, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, value));
    inFlight -= 1;
    return value * 10;
  });
  expect(results).toEqual([50, 10, 30, 20, 40]);
  expect(peak).toBe(2);
});
