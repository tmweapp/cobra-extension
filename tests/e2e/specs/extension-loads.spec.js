/**
 * COBRA v5.2 — E2E: Extension Loads Correctly
 * Verifies the extension installs, service worker activates,
 * and the side panel opens with expected UI elements.
 */
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../../..');

test.describe('COBRA Extension', () => {

  let context;
  let extensionId;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
      ],
    });

    // Wait for service worker to register
    let swTarget;
    const maxWait = 10000;
    const start = Date.now();
    while (!swTarget && Date.now() - start < maxWait) {
      const targets = context.serviceWorkers();
      swTarget = targets.find(t => t.url().includes('background.js'));
      if (!swTarget) await new Promise(r => setTimeout(r, 500));
    }

    if (swTarget) {
      const url = swTarget.url();
      extensionId = url.split('/')[2];
    }
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  test('service worker is active', async () => {
    expect(extensionId).toBeTruthy();
    const workers = context.serviceWorkers();
    const cobraWorker = workers.find(w => w.url().includes(extensionId));
    expect(cobraWorker).toBeTruthy();
  });

  test('side panel HTML loads without errors', async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForLoadState('domcontentloaded');

    // Check critical DOM elements exist
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.locator('#chatMessages')).toBeVisible();
    await expect(page.locator('#chatInput')).toBeVisible();
    await expect(page.locator('#chatSend')).toBeVisible();

    // No critical JS errors
    const criticalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') && !e.includes('Extension context')
    );
    expect(criticalErrors).toHaveLength(0);

    await page.close();
  });

  test('navigation tabs work', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForLoadState('domcontentloaded');

    // Click each nav tab and verify view changes
    const tabs = ['home', 'archivio', 'ai', 'comms', 'settings'];
    for (const tabName of tabs) {
      const tab = page.locator(`.nav-tab[data-view="${tabName}"]`);
      if (await tab.count() > 0) {
        await tab.click();
        const view = page.locator(`.view[data-view="${tabName}"]`);
        await expect(view).toHaveClass(/active/);
      }
    }

    await page.close();
  });

  test('chat input accepts text', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('#chatInput');
    await input.fill('Test COBRA input');
    await expect(input).toHaveValue('Test COBRA input');

    await page.close();
  });

  test('settings view shows API key fields', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForLoadState('domcontentloaded');

    // Navigate to settings
    const settingsTab = page.locator('.nav-tab[data-view="settings"]');
    if (await settingsTab.count() > 0) {
      await settingsTab.click();
    }

    // Check API key inputs exist
    await expect(page.locator('#openaiKey')).toBeVisible();
    await expect(page.locator('#groqKey')).toBeVisible();

    await page.close();
  });

  test('toast system works', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForLoadState('domcontentloaded');

    // Trigger a toast via JS
    await page.evaluate(() => {
      Toast.success('E2E Test Toast');
    });

    const toast = page.locator('.toast-success');
    await expect(toast).toBeVisible({ timeout: 2000 });

    await page.close();
  });
});
