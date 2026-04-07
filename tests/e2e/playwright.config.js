/**
 * COBRA v5.2 — Playwright E2E Configuration
 * Tests Chrome Extension side panel, service worker, and end-to-end workflows.
 * Requires Chrome with extension loaded via --load-extension flag.
 *
 * Run: npx playwright test --project=chromium
 */
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../..');

module.exports = defineConfig({
  testDir: './specs',
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0, // E2E tests should not retry automatically
  workers: 1, // Chrome extensions require single worker
  reporter: [
    ['html', { open: 'never', outputFolder: './test-results' }],
    ['json', { outputFile: './test-results/results.json' }],
    ['list'],
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        headless: false, // Extensions require headed browser
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-first-run',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-background-networking',
          ],
          timeout: 30000,
        },
      },
    },
  ],
  webServer: [
    // If you have a local dev server, uncomment:
    // {
    //   command: 'npm run dev',
    //   url: 'http://localhost:3000',
    //   timeout: 120000,
    //   reuseExistingServer: !process.env.CI,
    // },
  ],
  globalSetup: require.resolve('./global-setup.js'),
});
