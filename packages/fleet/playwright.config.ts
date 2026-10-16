import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'bdd/features/*.feature',
  steps: ['bdd/fixtures.ts', 'bdd/steps/*.ts'],
  outputDir: 'dist/bdd-generated',
});

export default defineConfig({
  testDir,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  outputDir: 'dist/bdd-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'dist/bdd-report', open: 'never' }],
    ['json', { outputFile: 'dist/bdd-results.json' }],
  ],
  use: { ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  projects: [
    { name: 'local', grep: /@local/, use: { trace: 'retain-on-failure' } },
    // Live authentication must never be written into a trace or video.
    { name: 'live', grep: /@live/, use: { trace: 'off', video: 'off' } },
  ],
});
