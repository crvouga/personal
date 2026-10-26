/**
 * Render the resume to a strictly one-page PDF with nothing cut off.
 *
 * Each candidate is checked three ways before it is accepted:
 *   1. the rendered DOM fits the printable area, with no element crossing the
 *      left or right edge (a long unbroken URL is the usual culprit);
 *   2. the PDF produced from it really is one page — the page count is part of
 *      the loop, not an assertion afterwards, so an overflow costs a reduction
 *      rather than the whole build;
 *   3. nothing rendered as an empty shell (a section heading with no rows).
 * A candidate that fails any check is reduced and re-checked. Only when every
 * reduction is exhausted does this throw, and the message says what was left.
 *
 * Runs under Node inside `astro build` (and `astro dev`), so it uses only
 * portable APIs — no `import.meta.dir`, no Bun globals.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

import { resumeMetadata, withMetadata } from './metadata';
import { chromium, type Browser, type Page } from 'playwright';

import { renderHtml, type ResumeContent } from './html';
import { reduceOnce } from './reductions';

const DPI = 96;
const PAGE_HEIGHT_IN = 11;
const PAGE_WIDTH_IN = 8.5;
const MARGIN_TOP_IN = 0.45;
const MARGIN_BOTTOM_IN = 0.45;
const MARGIN_SIDE_IN = 0.55;

const CONTENT_WIDTH_PX = Math.round((PAGE_WIDTH_IN - MARGIN_SIDE_IN * 2) * DPI);
const CONTENT_HEIGHT_PX = Math.round(
  (PAGE_HEIGHT_IN - MARGIN_TOP_IN - MARGIN_BOTTOM_IN) * DPI
);

/** Sub-pixel rounding differences are not overflow. */
const EPSILON_PX = 0.5;

/** The site's own Inter build, so the PDF matches the page it is linked from. */
const INTER_FONT = path.join(
  process.cwd(),
  'public',
  'fonts',
  'inter-variable.woff2'
);

const fontFaceCss = (): string => {
  const woff2 = readFileSync(INTER_FONT).toString('base64');
  return `@font-face { font-family: "Inter Variable"; font-weight: 100 900; font-style: normal; src: url(data:font/woff2;base64,${woff2}) format("woff2"); }`;
};

export type Overflow = {
  readonly heightPx: number;
  /** Elements crossing the printable width — clipped text in the PDF. */
  readonly clipped: readonly string[];
  /** Section headings whose section rendered no rows. */
  readonly emptySections: readonly string[];
};

const measure = async (page: Page, html: string): Promise<Overflow> => {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    ({ epsilon }) => {
      const label = (el: Element): string =>
        `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`;
      const width = document.documentElement.clientWidth;
      const clipped = Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          return r.right > width + epsilon || r.left < -epsilon;
        })
        .map(label);
      const emptySections = Array.from(document.querySelectorAll('section'))
        .filter((s) => {
          const heading = s.querySelector('.section-title');
          // Experience/Projects/Education render `.entry`; Skills `.skill-row`.
          const rows = s.querySelectorAll('.entry, .skill-row').length;
          return heading !== null && rows === 0;
        })
        .map((s) => s.querySelector('.section-title')?.textContent ?? '?');
      return {
        heightPx: document.documentElement.scrollHeight,
        clipped: [...new Set(clipped)],
        emptySections,
      };
    },
    { epsilon: EPSILON_PX }
  );
};

const printPdf = async (page: Page): Promise<Uint8Array> =>
  page.pdf({
    format: 'Letter',
    margin: {
      top: `${MARGIN_TOP_IN}in`,
      bottom: `${MARGIN_BOTTOM_IN}in`,
      left: `${MARGIN_SIDE_IN}in`,
      right: `${MARGIN_SIDE_IN}in`,
    },
    printBackground: true,
    tagged: true,
    outline: false,
  });

const pageCount = async (bytes: Uint8Array): Promise<number> =>
  (await PDFDocument.load(bytes)).getPageCount();

/** What is wrong with the laid-out DOM, or null when it is printable. */
const domDefect = (overflow: Overflow): string | null => {
  if (overflow.heightPx > CONTENT_HEIGHT_PX) {
    return `content is ${overflow.heightPx}px tall, printable area is ${CONTENT_HEIGHT_PX}px`;
  }
  if (overflow.clipped.length > 0) {
    return `clipped past the page edge: ${overflow.clipped.join(', ')}`;
  }
  if (overflow.emptySections.length > 0) {
    return `empty section heading: ${overflow.emptySections.join(', ')}`;
  }
  return null;
};

/** A printable candidate: the checked bytes, or why they were rejected. */
const tryRender = async (
  page: Page,
  html: string
): Promise<{ bytes: Uint8Array } | { defect: string }> => {
  const dom = domDefect(await measure(page, html));
  if (dom !== null) return { defect: dom };
  const bytes = await printPdf(page);
  const pages = await pageCount(bytes);
  return pages === 1 ? { bytes } : { defect: `PDF came out ${pages} pages` };
};

export type RenderedResume = {
  readonly bytes: Uint8Array;
  readonly content: ResumeContent;
  /** Reductions applied, in order, to make it fit. Usually short. */
  readonly reductions: readonly string[];
};

export const renderResume = async (
  initial: ResumeContent
): Promise<RenderedResume> => {
  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: CONTENT_WIDTH_PX, height: CONTENT_HEIGHT_PX },
      deviceScaleFactor: 1,
    });
    const fonts = fontFaceCss();
    const reductions: string[] = [];
    let content = initial;
    let lastDefect = 'unknown';
    for (;;) {
      const result = await tryRender(page, renderHtml(content, fonts));
      if ('bytes' in result) {
        const bytes = await withMetadata(result.bytes, resumeMetadata(content));
        return { bytes, content, reductions };
      }
      lastDefect = result.defect;
      const reduced = reduceOnce(content);
      if (reduced === null) break;
      reductions.push(reduced.name);
      content = reduced.content;
    }
    throw new Error(
      `Resume cannot be laid out on one page (${lastDefect}) after ${reductions.length} ` +
        `reduction(s): ${reductions.join(' → ')}. Trim src/content/work.ts highlights.`
    );
  } finally {
    await browser.close();
  }
};

export const renderResumePdf = async (
  content: ResumeContent
): Promise<Uint8Array> => (await renderResume(content)).bytes;

/** Lays out arbitrary HTML at print size. Exists so the checks are testable. */
export const inspectHtml = async (html: string): Promise<Overflow> => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: CONTENT_WIDTH_PX, height: CONTENT_HEIGHT_PX },
      deviceScaleFactor: 1,
    });
    return await measure(page, html);
  } finally {
    await browser.close();
  }
};
