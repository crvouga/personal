import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { writeCspSnippet } from './scripts/csp.ts';

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

export default defineConfig({
  site: 'https://www.chrisvouga.dev',
  output: 'static',
  build: { inlineStylesheets: 'always' },
  // Emits sitemap-index.xml + sitemap-0.xml. /404 and non-page endpoints
  // (llm.txt and llms.txt) are excluded automatically.
  integrations: [sitemap(), cspHeader()],
});
