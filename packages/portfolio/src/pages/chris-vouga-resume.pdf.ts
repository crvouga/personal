/**
 * The resume PDF, rendered from site content on every build.
 *
 * Static output prerenders this into `dist/chris-vouga-resume.pdf`, so the
 * deployed file is always built from the same commit as the page that links
 * to it — there is no committed PDF to forget to regenerate. Under `astro dev`
 * it renders on request; the cache only skips Chromium while content is
 * unchanged. The filename must equal `RESUME_FILENAME` (a test enforces it).
 */
import { DEFAULT_PRESENTATION } from '../archetypes/presentation';
import { resumeResponse } from '../resume/response';

export const GET = (): Promise<Response> =>
  resumeResponse(DEFAULT_PRESENTATION);
