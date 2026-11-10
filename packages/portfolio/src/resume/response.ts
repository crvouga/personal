/**
 * A presentation's résumé as an HTTP response. Shared by the canonical
 * endpoint and the per-role ones, so every PDF passes the same one-page
 * checks. Under `astro dev` the cache only skips Chromium while the content
 * is unchanged.
 */
import type { Presentation } from '../roles/presentation';
import { buildResumeContent } from './content';
import { renderResume } from './pdf';

const cache = new Map<
  string,
  { readonly key: string; readonly bytes: Uint8Array }
>();

const resumeBytes = async (presentation: Presentation): Promise<Uint8Array> => {
  const content = buildResumeContent(presentation);
  const key = JSON.stringify(content);
  const cached = cache.get(presentation.id);
  if (cached?.key === key) return cached.bytes;
  const { bytes, reductions } = await renderResume(content);
  // The page fits either way, but a silent trim means content outgrew it.
  if (reductions.length > 0) {
    console.warn(
      `[resume:${presentation.id}] trimmed to fit one page: ${reductions.join(' → ')}`
    );
  }
  cache.set(presentation.id, { key, bytes });
  return bytes;
};

export const resumeResponse = async (
  presentation: Presentation
): Promise<Response> =>
  new Response(Buffer.from(await resumeBytes(presentation)), {
    headers: { 'content-type': 'application/pdf' },
  });
