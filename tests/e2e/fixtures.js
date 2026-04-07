/**
 * E2E Test Fixtures - requires Chrome with extension loaded. Run: npx playwright test
 * Provides extension context, service worker access, and page utilities.
 */
const { test: base, chromium, expect } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../..');

/**
 * Custom fixture: extContext
 * Launches a persistent Chrome context with the extension loaded.
 */
const test = base.extend({
  extContext: async ({}, use) => {
    let context;
    try {
      context = await chromium.launchPersistentContext('', {
        headless: false,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-first-run',
          '--disable-default-apps',
          '--disable-sync',
        ],
        timeout: 30000,
      });

      await use(context);
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  },

  /**
   * Fixture: extensionId
   * Extracts the extension ID from the service worker URL
   */
  extensionId: async ({ extContext }, use) => {
    let extensionId = null;

    // Wait for service worker to register (max 15s)
    const maxWait = 15000;
    const start = Date.now();
    while (!extensionId && Date.now() - start < maxWait) {
      const workers = extContext.serviceWorkers();
      if (workers.length > 0) {
        const url = workers[0].url();
        // Extract: chrome-extension://EXTENSIONID/background.js
        const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
        if (match) {
          extensionId = match[1];
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!extensionId) {
      throw new Error('Extension ID not found after 15s - service worker may not have loaded');
    }

    await use(extensionId);
  },

  /**
   * Fixture: serviceWorker
   * Returns the service worker page for background script
   */
  serviceWorker: async ({ extContext, extensionId }, use) => {
    const workers = extContext.serviceWorkers();
    const worker = workers.find((w) => w.url().includes(extensionId));

    if (!worker) {
      throw new Error(`Service worker for extension ${extensionId} not found`);
    }

    await use(worker);
  },

  /**
   * Fixture: sidepanelPage
   * Opens the side panel HTML and returns the page object
   */
  sidepanelPage: async ({ extContext, extensionId }, use) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for root element to be available
    await page.locator('#root').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    await use(page);

    // Cleanup
    await page.close().catch(() => {});
  },

  /**
   * Utility: waitForMessage
   * Waits for a background message to be received (for mocking responses)
   */
  waitForMessage: async ({}, use) => {
    await use(async (page, timeout = 5000) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Message timeout')),
          timeout
        );

        const listener = (message) => {
          clearTimeout(timer);
          resolve(message);
        };

        page.evaluate(() => {
          window.TEST_MESSAGE_HANDLER = (msg) => {
            window.lastMessage = msg;
          };
        });

        page.on('console', (msg) => {
          if (msg.type() === 'log' && msg.text().startsWith('TEST:')) {
            listener(msg.text());
          }
        });
      });
    });
  },

  /**
   * Utility: injectMock
   * Injects a mock provider/handler into the page context
   */
  injectMock: async ({}, use) => {
    await use(async (page, mockScript) => {
      await page.addInitScript(() => {
        window.MOCK_ENABLED = true;
      });
      if (mockScript) {
        await page.addInitScript(mockScript);
      }
    });
  },
});

module.exports = { test, expect };
