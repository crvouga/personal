/**
 * Document metadata for the résumé PDF. Chromium writes only `/Title` and
 * `/Creator`; applicant tracking systems and desktop search read `/Author`,
 * `/Subject` and `/Keywords` too. Everything is derived from the content the
 * page renders, keywords from its Skills rows.
 */
import { PDFDocument } from 'pdf-lib';

import type { ResumeContent } from './html';

export type ResumeMetadata = {
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly keywords: readonly string[];
};

export const resumeMetadata = (content: ResumeContent): ResumeMetadata => ({
  title: `${content.identity.name} — Résumé`,
  author: content.identity.name,
  subject: `Résumé — ${content.identity.title}`,
  keywords: [...new Set(content.skills.flatMap((row) => row.items))],
});

/** Rewrites the info dictionary; page content and the text layer are untouched. */
export const withMetadata = async (
  bytes: Uint8Array,
  metadata: ResumeMetadata
): Promise<Uint8Array> => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.setTitle(metadata.title);
  doc.setAuthor(metadata.author);
  doc.setSubject(metadata.subject);
  doc.setKeywords([...metadata.keywords]);
  doc.setCreator('chrisvouga.dev résumé generator');
  doc.setProducer('Chromium via Playwright, metadata by pdf-lib');
  return doc.save({ useObjectStreams: false });
};
