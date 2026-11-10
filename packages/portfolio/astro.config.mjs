import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { writeCspSnippet } from './scripts/csp.ts';
import {
  ARCHETYPE_ID_PATTERN,
  DEFAULT_ARCHETYPE_ID,
  isArchetypeId,
} from './src/archetypes/definitions.ts';

// Outside the served root (and git-ignored); the Dockerfile copies it into
// the nginx image, where nginx/security-headers.conf includes it.
const CSP_SNIPPET = fileURLToPath(
  new URL('./.astro/csp-header.conf', import.meta.url)
);

/** Hash every inline script/style of the built pages into the nginx CSP. */
const cspHeader = () => ({
  name: 'portfolio-csp-header',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      await writeCspSnippet(fileURLToPath(dir), CSP_SNIPPET);
      logger.info(`wrote ${CSP_SNIPPET}`);
    },
  },
});

/** The built location of a presentation's page or résumé, or null. */
const archetypePath = (requestUrl) => {
  const url = new URL(requestUrl, 'http://localhost');
  const id = url.searchParams.get('archetype') ?? '';
  const variant =
    ARCHETYPE_ID_PATTERN.test(id) &&
    isArchetypeId(id) &&
    id !== DEFAULT_ARCHETYPE_ID;
  if (!variant) return null;
  if (url.pathname === '/') return `/a/${id}/`;
  return url.pathname === '/chris-vouga-resume.pdf'
    ? `/a/${id}${url.pathname}`
    : null;
};

/**
 * `astro dev` only: answer `/?archetype=<id>` the way nginx.conf does in
 * production, by serving the presentation built under `/a/<id>/`.
 */
const archetypeQuery = () => ({
  name: 'portfolio-archetype-query',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      request.url = archetypePath(request.url ?? '/') ?? request.url;
      next();
    });
  },
});

export default defineConfig({
  site: 'https://www.chrisvouga.dev',
  output: 'static',
  build: { inlineStylesheets: 'always' },
  // Emits sitemap-index.xml + sitemap-0.xml. /404 and non-page endpoints
  // (llm.txt and llms.txt) are excluded automatically.
  // Presentations under /a/ are not public URLs (nginx.conf), so they stay
  // out of the sitemap.
  integrations: [
    sitemap({ filter: (page) => !new URL(page).pathname.startsWith('/a/') }),
    cspHeader(),
  ],
  vite: { plugins: [archetypeQuery()] },
});
