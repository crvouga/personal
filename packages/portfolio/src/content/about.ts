import { BIO } from '../knowledge/bio';
import { factHtml } from './work';
import { LOCATION } from './hero';

/**
 * One entry per paragraph, each trusted HTML rendered from the knowledge
 * base's bio. They are separate strings rather than one newline-delimited
 * block because the section renders a real `<p>` per paragraph \u2014 a single
 * block would need `white-space: pre-line`, which forces any inline `<a>` onto
 * its own line.
 */
export const ABOUT_ME_PARAGRAPHS: readonly string[] = BIO.map((paragraph) =>
  factHtml(paragraph.replace('{location}', LOCATION))
);
