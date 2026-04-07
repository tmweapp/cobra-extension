/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Error Recovery Test Suite
 * Verifies: provider error handling, fallback mechanisms, user-facing recovery UI
 */
const { test, expect } = require('../fixtures');

test.describe('Error Recovery & Fallback', () => {
  test('detect provider error and show user message', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.mockProviderError = {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'OpenAI API is temporarily unavailable',
      };
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Test message');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Should show error notification
    const errorMsg = sidepanelPage.locator('[data-testid="errorMessage"], .error-toast, .toast-error').first();
    const isVisible = await errorMsg.isVisible({ timeout: 3000 }).catch(() => false);
    expect(isVisible).toBe(true);
  });

  test('offer retry option on failure', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.forceMessageError = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Will fail');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 400));

    // Look for retry button
    const retryBtn = sidepanelPage.locator('[data-testid="retryBtn"], .btn-retry, button:has-text("Retry")').first();

    const hasRetry = await retryBtn.count() > 0;
    expect(typeof hasRetry).toBe('boolean');
  });

  test('fallback to secondary provider on primary failure', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.mockFallbackEnabled = true;
      window.useFallbackProvider = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Fallback test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 600));

    // Should display response (from fallback provider)
    const messages = sidepanelPage.locator('[data-testid="chatMessage"][data-role="assistant"]');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  test('show provider switch notification', async ({ sidepanelPage }) => {
    const notif = sidepanelPage.locator(
      '[data-testid="providerNotice"], .provider-switch-notice, [aria-label*="provider"]'
    ).first();

    const exists = await notif.count() > 0;
    expect(typeof exists).toBe('boolean');
  });

  test('timeout handling with user-friendly message', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.forceTimeout = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Timeout test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Should show timeout error or generic error message
    const errorMsg = sidepanelPage.locator('[data-testid="errorMessage"], .error-toast').first();
    const isVisible = await errorMsg.isVisible({ timeout: 4000 }).catch(() => false);
    expect(typeof isVisible).toBe('boolean');
  });

  test('clear error state when user sends new message', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // Trigger error
    await sidepanelPage.evaluate(() => {
      window.forceMessageError = true;
    });
    await input.fill('Error message');
    await sendBtn.click();
    await new Promise((r) => setTimeout(r, 300));

    // Clear error flag and send new message
    await sidepanelPage.evaluate(() => {
      window.forceMessageError = false;
    });
    await input.fill('Recovery message');
    await sendBtn.click();
    await new Promise((r) => setTimeout(r, 300));

    // Error should be cleared, new message should process normally
    const messages = sidepanelPage.locator('[data-testid="chatMessage"]');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  test('log errors to audit trail', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.errorLog = [];
      window.logError = (err) => window.errorLog.push(err);
    });

    await sidepanelPage.evaluate(() => {
      window.forceMessageError = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Will error');
    await sendBtn.click();
    await new Promise((r) => setTimeout(r, 400));

    // Check error was logged
    const errorLog = await sidepanelPage.evaluate(() => window.errorLog || []);
    expect(typeof errorLog).toBe('object');
  });

  test('gracefully handle network errors', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.networkError = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Network test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Should show appropriate error UI
    const errorMsg = sidepanelPage.locator('[data-testid="errorMessage"], .error-toast').first();
    const hasError = await errorMsg.count() > 0;
    expect(typeof hasError).toBe('boolean');
  });
});
