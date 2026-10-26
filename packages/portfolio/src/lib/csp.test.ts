import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildPolicy,
  collectInlineSources,
  cspHash,
  nginxSnippet,
  writeCspSnippet,
} from '../../scripts/csp';

const GREETING = "\n  console.log('hi');\n";
const CSS = '\n  body { color: red; }\n';
const LD_JSON = '{"@context":"https://schema.org"}';

const FIXTURE = `<!DOCTYPE html><html><head>
<style>${CSS}</style>
<script type="application/ld+json">${LD_JSON}</script>
<script type="module">${GREETING}</script>
<script src="/local.js"></script>
</head><body><p>text with on="x" inside</p><script>document.title = '<a onclick=x>';</script></body></html>`;

describe('collectInlineSources', () => {
  test('collects executable inline scripts and styles, skipping ld+json and src', () => {
    const sources = collectInlineSources(FIXTURE);
    expect(sources.scripts).toEqual([
      GREETING,
      "document.title = '<a onclick=x>';",
    ]);
    expect(sources.styles).toEqual([CSS]);
    expect(sources.styleAttributes).toBe(false);
  });

  test('flags style attributes', () => {
    expect(
      collectInlineSources('<div style="color:red"></div>').styleAttributes
    ).toBe(true);
  });

  test('rejects markup the policy would silently break', () => {
    expect(() => collectInlineSources('<button onclick="x()">')).toThrow(
      /event handlers/
    );
    expect(() => collectInlineSources('<a href="javascript:x()">')).toThrow(
      /javascript:/
    );
    expect(() =>
      collectInlineSources('<script src="https://cdn.example/x.js"></script>')
    ).toThrow(/cross-origin/);
  });
});

describe('buildPolicy', () => {
  const policy = buildPolicy(collectInlineSources(FIXTURE));
  const directive = (name: string): string =>
    policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  test('allows exactly the inline scripts by hash', () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).toContain(cspHash(GREETING));
    expect(scriptSrc).toContain(cspHash("document.title = '<a onclick=x>';"));
    expect(scriptSrc).not.toContain(cspHash(LD_JSON));
    expect(scriptSrc.match(/'sha256-/g)).toHaveLength(2);
  });

  test('hashes styles and never relaxes scripts', () => {
    expect(directive('style-src')).toBe(`style-src 'self' ${cspHash(CSS)}`);
    expect(policy).not.toContain('unsafe-eval');
    expect(directive('script-src')).not.toContain('unsafe-inline');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  test("uses 'unsafe-inline' alone for styles when style attributes exist", () => {
    const sources = collectInlineSources(
      `<style>${CSS}</style><p style="x"></p>`
    );
    expect(buildPolicy(sources)).toContain("style-src 'self' 'unsafe-inline';");
    expect(nginxSnippet(sources)).toContain('# style-src uses');
  });

  test('matches the browser hash of a known source', () => {
    // printf alert(1) | openssl dgst -sha256 -binary | base64
    expect(cspHash('alert(1)')).toBe(
      "'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='"
    );
  });
});

test('writeCspSnippet scans nested HTML and writes an nginx add_header line', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'csp-'));
  try {
    await mkdir(path.join(dir, 'dist', 'projects'), { recursive: true });
    await writeFile(path.join(dir, 'dist', 'index.html'), FIXTURE);
    await writeFile(
      path.join(dir, 'dist', 'projects', 'index.html'),
      '<script>nested()</script>'
    );
    const out = path.join(dir, 'out', 'csp-header.conf');
    const policy = await writeCspSnippet(path.join(dir, 'dist'), out);
    expect(policy).toContain(cspHash('nested()'));
    const snippet = await readFile(out, 'utf8');
    expect(snippet).toContain(
      `add_header Content-Security-Policy "${policy}" always;`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
