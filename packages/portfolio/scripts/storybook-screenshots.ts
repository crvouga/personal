/**
 * Screenshots every story of the static Storybook build, for review.
 *
 *   bun run storybook:build
 *   bun run storybook:screenshots [out-dir] [--filter <substring>]
 *
 * Serves `storybook-static/` itself (no server needed), opens each story's
 * iframe in Chromium and writes `<out-dir>/<story-id>.png` plus
 * `<out-dir>/index.json` (id, title, name, file) for the PR comment.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dir, '..');
const STATIC = join(ROOT, 'storybook-static');
const argv = process.argv.slice(2);
const filterAt = argv.indexOf('--filter');
const filter = filterAt === -1 ? '' : (argv[filterAt + 1] ?? '');
const positional = argv.filter(
  (arg, i) => !arg.startsWith('--') && (filterAt === -1 || i !== filterAt + 1)
);
const out = resolve(positional[0] ?? join(ROOT, 'storybook-screenshots'));
mkdirSync(out, { recursive: true });

type Entry = {
  id: string;
  title: string;
  name: string;
  type: string;
  tags?: string[];
};
const index = JSON.parse(readFileSync(join(STATIC, 'index.json'), 'utf8')) as {
  entries: Record<string, Entry>;
};
const stories = Object.values(index.entries).filter(
  (entry) => entry.type === 'story' && entry.id.includes(filter)
);

const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    let path = decodeURIComponent(new URL(request.url).pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = Bun.file(join(STATIC, path));
    return (await file.exists())
      ? new Response(file)
      : new Response('Not found', { status: 404 });
  },
});

const browser = await chromium.launch();
const shots: (Entry & { file: string })[] = [];
const failures: string[] = [];
try {
  for (const story of stories) {
    // `phone` stories only show below 900px (the sticky CTA).
    const phone = story.tags?.includes('phone') === true;
    const page = await browser.newPage({
      viewport: phone
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
    });
    page.on('pageerror', (error) =>
      failures.push(`${story.id}: ${error.message}`)
    );
    await page.goto(
      `http://localhost:${String(server.port)}/iframe.html?id=${story.id}&viewMode=story`,
      { waitUntil: 'networkidle' }
    );
    await page.locator('[data-theme]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (story.tags?.includes('opens-gallery') === true) {
      await page.locator('.gallery-btn').first().click();
      await page.locator('dialog[open] img').first().waitFor();
    }
    const file = `${story.id}.png`;
    await page.screenshot({ path: join(out, file), fullPage: !phone });
    await page.close();
    shots.push({ ...story, file });
    process.stdout.write(`✓ ${story.id}\n`);
  }
} finally {
  await browser.close();
  await server.stop(true);
}
writeFileSync(join(out, 'index.json'), `${JSON.stringify(shots, null, 2)}\n`);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
process.stdout.write(`${String(shots.length)} screenshots in ${out}\n`);
