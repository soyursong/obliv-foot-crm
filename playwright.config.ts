import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI || !!process.env.QA_MODE;

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: isCI,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: isCI ? [['json', { outputFile: 'test-results/results.json' }], ['list']] : [['list']],
});
