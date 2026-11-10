import type { StorybookConfig } from '@storybook-astro/framework';

// Stories are static and offline: the proof section renders the committed
// GitHub snapshot instead of calling GitHub (src/lib/github-insights.ts).
process.env['PORTFOLIO_SNAPSHOT_ONLY'] = '1';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  staticDirs: ['../public'],
  framework: {
    name: '@storybook-astro/framework',
    options: { renderMode: 'static' },
  },
};

export default config;
