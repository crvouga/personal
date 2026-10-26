/**
 * The built site, checked in a real browser: accessibility (axe, headings,
 * landmarks, link names, tap targets, the dialog's focus handling), layout at
 * phone and desktop widths in both themes, the performance budget, and that no
 * page talks to a third party. Runs against `dist/` (`bun run test:site`, which
 * Turbo orders after `build`), served the way nginx serves it: real 404s.
 */
import AxeBuilder from '@axe-core/playwright';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const DIST = join(import.meta.dir, '..', 'dist');
const TIMEOUT_MS = 120_000;
const HTML_BUDGET_BYTES = 100_000;
const TRANSFER_BUDGET_BYTES = 400_000;
const TAP_MIN_HEIGHT = 44;
const TAP_MIN_WIDTH = 24;

const PAGES = [
  '/',
  '/projects/',
  '/projects/mockingbird/',
  '/projects/workspace-platform/',
];

if (!existsSync(join(DIST, 'index.html'))) {
  throw new Error(
    'dist/ is missing: run `bun run build` first (test:site depends on it in Turbo).'
  );
}

const fileFor = (pathname: string): string | null => {
  const direct = join(DIST, pathname);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  const index = join(DIST, pathname, 'index.html');
  return existsSync(index) ? index : null;
};

const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const { pathname } = new URL(request.url);
    const file = fileFor(decodeURIComponent(pathname));
    if (file === null)
      return new Response(Bun.file(join(DIST, '404.html')), { status: 404 });
    return new Response(Bun.file(file));
  },
});
const origin = `http://localhost:${String(server.port)}`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  await server.stop(true);
});

type Opened = {
  readonly page: Page;
  readonly external: string[];
  readonly bytes: number[];
};

const open = async (
  path: string,
  options: { width?: number; scheme?: 'dark' | 'light' } = {}
): Promise<Opened> => {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1440, height: 900 },
    colorScheme: options.scheme ?? 'dark',
  });
  const page = await context.newPage();
  const external: string[] = [];
  const bytes: number[] = [];
  page.on('request', (request) => {
    if (
      !request.url().startsWith(origin) &&
      !request.url().startsWith('data:')
    ) {
      external.push(request.url());
    }
  });
  page.on('response', (response) => {
    void response.body().then(
      (body) => bytes.push(body.byteLength),
      () => undefined
    );
  });
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
  return { page, external, bytes };
};

describe('accessibility', () => {
  for (const scheme of ['dark', 'light'] as const) {
    for (const path of [...PAGES, '/404']) {
      test(
        `axe finds no WCAG A/AA violations on ${path} (${scheme})`,
        async () => {
          const { page } = await open(path, { scheme });
          await page.evaluate(() => {
            document.querySelectorAll('details').forEach((d) => {
              d.open = true;
            });
          });
          const result = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze();
          await page.close();
          expect(
            result.violations.map(
              (v) =>
                `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
            )
          ).toEqual([]);
        },
        TIMEOUT_MS
      );
    }
  }

  for (const path of PAGES) {
    test(
      `${path}: one h1, no skipped heading levels, one main, labelled nav`,
      async () => {
        const { page } = await open(path);
        const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', (hs) =>
          hs
            .filter(
              (h) => h.getClientRects().length > 0 || h.closest('details')
            )
            .map((h) => Number(h.tagName[1]))
        );
        const landmarks = await page.evaluate(() => ({
          mains: document.querySelectorAll('main').length,
          unlabelledNavs: [...document.querySelectorAll('nav')].filter(
            (n) => !n.getAttribute('aria-label')
          ).length,
          footers: document.querySelectorAll('footer').length,
        }));
        await page.close();
        expect(levels.filter((l) => l === 1)).toHaveLength(1);
        expect(levels[0]).toBe(1);
        const skips = levels.filter(
          (level, i) => i > 0 && level > (levels[i - 1] ?? 1) + 1
        );
        expect(skips).toEqual([]);
        expect(landmarks).toEqual({ mains: 1, unlabelledNavs: 0, footers: 1 });
      },
      TIMEOUT_MS
    );

    // WCAG 2.4.4: "Live", "Code" and "Images" repeat on a page, so each one's
    // accessible name must say which project it belongs to.
    test(
      `${path}: no two links share a name but lead to different places`,
      async () => {
        const { page } = await open(path);
        const links = await page.$$eval('a[href]', (as) =>
          as.map((a) => ({
            name: (a.getAttribute('aria-label') ?? a.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim(),
            href: (a as HTMLAnchorElement).href.replace(/#.*$/, ''),
          }))
        );
        await page.close();
        const byName = new Map<string, Set<string>>();
        for (const link of links) {
          byName.set(
            link.name,
            (byName.get(link.name) ?? new Set()).add(link.href)
          );
        }
        const ambiguous = [...byName]
          .filter(([, hrefs]) => hrefs.size > 1)
          .map(([name]) => name);
        expect(ambiguous).toEqual([]);
      },
      TIMEOUT_MS
    );
  }

  test(
    'every image has a specific alt or is provably decorative',
    async () => {
      for (const path of PAGES) {
        const { page } = await open(path);
        const images = await page.$$eval('img', (imgs) =>
          imgs.map((img) => ({
            alt: img.getAttribute('alt'),
            decorative:
              img.closest('.chip') !== null ||
              img.closest('[aria-hidden="true"]') !== null,
          }))
        );
        await page.close();
        expect(images.filter((i) => i.alt === null)).toEqual([]);
        expect(images.filter((i) => i.alt === '' && !i.decorative)).toEqual([]);
        const alts = images.map((i) => i.alt).filter((alt) => alt !== '');
        expect(
          alts.filter((alt) =>
            /^(a )?screenshot( of the project)?$/i.test(alt ?? '')
          )
        ).toEqual([]);
      }
    },
    TIMEOUT_MS
  );

  for (const width of [320, 390]) {
    test(
      `tap targets are at least ${String(TAP_MIN_HEIGHT)}px tall at ${String(width)}px`,
      async () => {
        const { page } = await open('/', { width });
        const small = await page.$$eval(
          'a[href], button, summary, input',
          (els, [minH, minW]) =>
            els
              .filter(
                (el) =>
                  el.getClientRects().length > 0 &&
                  getComputedStyle(el).display !== 'inline'
              )
              .filter(
                (el) =>
                  !el.closest('.visually-hidden, .skip-link, [data-hidden]')
              )
              .map((el) => ({
                el: el.outerHTML.slice(0, 80),
                box: el.getBoundingClientRect(),
              }))
              .filter(
                ({ box }) => box.height < (minH ?? 0) || box.width < (minW ?? 0)
              )
              .map(
                ({ el, box }) =>
                  `${el} (${String(Math.round(box.width))}×${String(Math.round(box.height))})`
              ),
          [TAP_MIN_HEIGHT, TAP_MIN_WIDTH]
        );
        await page.close();
        expect(small).toEqual([]);
      },
      TIMEOUT_MS
    );
  }

  test(
    'the gallery dialog takes focus, closes on Escape and gives focus back',
    async () => {
      const { page } = await open('/');
      const trigger = page.locator('button[data-gallery]').first();
      await trigger.click();
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('dialog[open]') !== null
        )
      ).toBe(true);
      await page.keyboard.press('Escape');
      expect(
        await page.evaluate(() => document.querySelector('dialog[open]'))
      ).toBeNull();
      expect(
        await trigger.evaluate((el) => el === document.activeElement)
      ).toBe(true);
      await page.close();
    },
    TIMEOUT_MS
  );
});

describe('layout', () => {
  for (const scheme of ['dark', 'light'] as const) {
    for (const width of [320, 390, 1440]) {
      test(
        `no horizontal page scroll at ${String(width)}px (${scheme})`,
        async () => {
          for (const path of PAGES) {
            const { page } = await open(path, { width, scheme });
            const overflow = await page.evaluate(
              () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth
            );
            await page.close();
            expect({ path, overflow }).toEqual({ path, overflow: 0 });
          }
        },
        TIMEOUT_MS
      );
    }
  }

  // Two identical Email/Résumé pairs on screen at once is noise.
  test(
    'the phone action bar hides beside the hero and contact buttons',
    async () => {
      const { page } = await open('/', { width: 390 });
      const hidden = (): Promise<boolean> =>
        page
          .locator('[data-sticky-cta]')
          .evaluate((el) => el.hasAttribute('data-hidden'));
      expect(await hidden()).toBe(true);
      await page.locator('#projects').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      expect(await hidden()).toBe(false);
      await page.locator('#contact .ctas').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      expect(await hidden()).toBe(true);
      await page.close();
    },
    TIMEOUT_MS
  );

  test(
    'print is black on white and drops screen-only parts',
    async () => {
      const { page } = await open('/');
      await page.emulateMedia({ media: 'print' });
      const printed = await page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        nav: getComputedStyle(document.querySelector('.nav') as Element)
          .display,
      }));
      await page.close();
      expect(printed).toEqual({
        background: 'rgb(255, 255, 255)',
        nav: 'none',
      });
    },
    TIMEOUT_MS
  );
});

describe('performance budget', () => {
  test(`homepage HTML is under ${String(HTML_BUDGET_BYTES / 1000)} KB`, () => {
    expect(statSync(join(DIST, 'index.html')).size).toBeLessThan(
      HTML_BUDGET_BYTES
    );
  });

  for (const path of PAGES) {
    test(
      `${path}: no third-party requests, every image sized`,
      async () => {
        const { page, external } = await open(path);
        const unsized = await page.$$eval('img', (imgs) =>
          imgs
            .filter(
              (img) => !img.getAttribute('width') || !img.getAttribute('height')
            )
            .map((img) => img.src)
        );
        await page.close();
        expect(external).toEqual([]);
        expect(unsized).toEqual([]);
      },
      TIMEOUT_MS
    );
  }

  // /projects/ is the gallery page and is allowed its screenshots; the pages a
  // reviewer lands on first are held to the budget.
  for (const path of [
    '/',
    '/projects/mockingbird/',
    '/projects/workspace-platform/',
  ]) {
    test(
      `${path}: first load transfers under ${String(TRANSFER_BUDGET_BYTES / 1000)} KB`,
      async () => {
        const { page, bytes } = await open(path);
        await page.close();
        expect(bytes.reduce((sum, n) => sum + n, 0)).toBeLessThan(
          TRANSFER_BUDGET_BYTES
        );
      },
      TIMEOUT_MS
    );
  }

  test(
    'nothing shifts while the homepage loads (CLS 0)',
    async () => {
      const { page } = await open('/', { width: 390 });
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(500);
      const shift = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let total = 0;
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const e = entry as PerformanceEntry & {
                  value: number;
                  hadRecentInput: boolean;
                };
                if (!e.hadRecentInput) total += e.value;
              }
            }).observe({ type: 'layout-shift', buffered: true });
            setTimeout(() => resolve(total), 300);
          })
      );
      await page.close();
      expect(shift).toBeLessThan(0.01);
    },
    TIMEOUT_MS
  );

  test(
    'fonts are preloaded and swap',
    async () => {
      const { page } = await open('/');
      const preloads = await page.$$eval(
        'link[rel="preload"][as="font"]',
        (ls) => ls.length
      );
      const css = await page.evaluate(() =>
        [...document.styleSheets]
          .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
          .join('\n')
      );
      await page.close();
      expect(preloads).toBeGreaterThanOrEqual(2);
      expect(
        css.match(/@font-face[^}]*font-display: swap/g)?.length
      ).toBeGreaterThanOrEqual(2);
    },
    TIMEOUT_MS
  );
});

describe('the site’s own guarantees', () => {
  test(
    'the homepage project count matches /projects/',
    async () => {
      const counts: string[] = [];
      for (const path of ['/', '/projects/']) {
        const { page } = await open(path);
        counts.push(
          (await page
            .locator('[data-project-count]')
            .first()
            .getAttribute('data-project-count')) ?? ''
        );
        await page.close();
      }
      expect(counts[0]).not.toBe('');
      expect(counts[0]).toBe(counts[1]);
    },
    TIMEOUT_MS
  );

  test('unknown paths are real 404s', async () => {
    const response = await fetch(`${origin}/no-such-page/`);
    expect(response.status).toBe(404);
  });

  for (const path of [
    '/resume.json',
    '/llms.txt',
    '/llms-infra.txt',
    '/manifest.webmanifest',
    '/favicon.svg',
    '/.well-known/security.txt',
    '/humans.txt',
    '/robots.txt',
    '/sitemap-index.xml',
    '/og/mockingbird.png',
  ]) {
    test(`${path} is served`, async () => {
      expect((await fetch(`${origin}${path}`)).status).toBe(200);
    });
  }
});
