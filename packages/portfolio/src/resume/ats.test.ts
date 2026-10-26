/**
 * What an applicant tracking system reads: the PDF's text layer and its
 * metadata, extracted the way those systems do (poppler's `pdftotext`). The
 * layout tests in pdf.test.ts prove the page looks right; these prove a
 * machine can read it. CI installs poppler-utils; locally the extraction
 * tests skip, loudly, if it is missing.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

import { buildResumeContent, includePhone } from './content';
import { toPlainText } from './content';
import { renderResume } from './pdf';

const rendered = await renderResume(buildResumeContent());
const pdfPath = join(mkdtempSync(join(tmpdir(), 'resume-ats-')), 'resume.pdf');
writeFileSync(pdfPath, rendered.bytes);

const hasPdftotext =
  spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).error === undefined;
if (!hasPdftotext) {
  console.warn(
    '[resume] pdftotext not found: text-layer tests skipped. Install poppler-utils.'
  );
}

const extract = (): string =>
  spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' })
    .stdout;
const text = hasPdftotext ? extract() : '';
const lines = text.split('\n').map((line) => line.trim());
// A word that already contains a hyphen ("sign-on") may break at it; the
// extractor then reads "sign- on". Rejoin those, as an ATS tokenizer does.
const flat = text.replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, '$1-$2');

describe('résumé metadata', () => {
  test('carries author, subject and keywords derived from the content', async () => {
    const doc = await PDFDocument.load(rendered.bytes, {
      updateMetadata: false,
    });
    expect(doc.getAuthor()).toBe(rendered.content.identity.name);
    expect(doc.getSubject()).toBe(
      `Résumé — ${rendered.content.identity.title}`
    );
    const keywords = doc.getKeywords() ?? '';
    for (const skill of ['TypeScript', 'Claude Code', 'OpenTofu']) {
      expect(keywords).toContain(skill);
    }
    expect(doc.getTitle()).toContain('Résumé');
  });

  test('omits the phone number unless the build asks for it', () => {
    expect(includePhone({})).toBe(false);
    expect(includePhone({ RESUME_INCLUDE_PHONE: '1' })).toBe(true);
    expect(rendered.content.identity.phone).toBeNull();
  });
});

describe.skipIf(!hasPdftotext)('résumé text layer', () => {
  // Letter-spacing on small caps can come out as "E X P E R I E N C E".
  test('section headings extract as single words', () => {
    for (const heading of ['EXPERIENCE', 'PROJECTS', 'SKILLS', 'EDUCATION']) {
      expect(lines).toContain(heading);
    }
  });

  test('no letter-spacing artifacts anywhere', () => {
    expect(flat).not.toMatch(/\b(?:[A-Z] ){4,}[A-Z]\b/);
  });

  test('every bullet extracts whole, in reading order', () => {
    for (const role of rendered.content.experience) {
      for (const bullet of role.bullets) {
        expect(flat).toContain(toPlainText(bullet).replace(/\s+/g, ' '));
      }
    }
  });

  test('the name, the contact links and the AI-assisted row are text', () => {
    expect(flat).toContain(rendered.content.identity.name);
    expect(flat).toContain(rendered.content.identity.email);
    expect(flat).toContain('AI-assisted engineering');
    expect(flat).toContain('Claude Code');
  });
});
