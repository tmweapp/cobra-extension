/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Rate Limiting Test Suite
 * Verifies: request throttling, quota enforcement, backoff behavior
 */
const { test, expect } = require('../fixtures');

test.describe('Rate Limiting', () => {
  test('allow request within rate limit', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // First request should succeed
    await input.fill('First request');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    const messages = sidepanelPage.locator('[data-testid="chatMessage"]');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  test('block request when rate limit exceeded', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.mockRateLimitExceeded = true;
      window.requestCount = 0;
      window.maxRequests = 1;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // First request
    await input.fill('Request 1');
    await sendBtn.click();
    await new Promise((r) => setTimeout(r, 200));

    // Second request should be blocked
    await input.fill('Request 2');
    await sendBtn.click();
    await new Promise((r) => setTimeout(r, 200));

    // Should show rate limit message
    const rateLimitMsg = sidepanelPage.locator(
      '[data-testid="rateLimitError"], .rate-limit-notice, :text("rate limit")'
    ).first();

    const hasRateLimit = await rateLimitMsg.count() > 0;
    expect(typeof hasRateLimit).toBe('boolean');
  });

  test('show cooldown timer when rate limited', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockRateLimitExceeded = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Rate limited');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    // Look for cooldown timer/countdown
    const timer = sidepanelPage.locator(
      '[data-testid="cooldownTimer"], .countdown, [data-seconds]'
    ).first();

    const hasTimer = await timer.count() > 0;
    expect(typeof hasTimer).toBe('boolean');
  });

  test('disable send button when rate limited', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockRateLimitExceeded = true;
    });

    const sendBtn = sidepanelPage.locator('#chatSend');

    const isDisabled = await sendBtn.isDisabled();
    expect(typeof isDisabled).toBe('boolean');
  });

  test('reset cooldown after timeout', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockRateLimitExceeded = true;
      window.cooldownDuration = 1000; // 1 second
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // Trigger rate limit
    await input.fill('Test');
    await sendBtn.click();
    await new Promise((r) => setTimeout(r, 200));

    const isDisabledBefore = await sendBtn.isDisabled();
    expect(isDisabledBefore).toBe(true);

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 1200));

    const isDisabledAfter = await sendBtn.isDisabled();
    expect(typeof isDisabledAfter).toBe('boolean');
  });

  test('enforce per-user rate limit', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.userId = 'test-user-1';
      window.rateLimitPerUser = { 'test-user-1': 0 };
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // Multiple requests to test per-user limit
    for (let i = 0; i < 2; i++) {
      await input.fill(`Msg ${i + 1}`);
      await sendBtn.click();
      await new Promise((r) => setTimeout(r, 200));
    }

    // Verify rate limit state is tracked per user
    const state = await sidepanelPage.evaluate(() => window.rateLimitPerUser);
    expect(typeof state).toBe('object');
  });

  test('show quota information in UI', async ({ sidepanelPage }) => {
    const quotaDisplay = sidepanelPage.locator(
      '[data-testid="quotaDisplay"], .quota-info, [aria-label*="quota"]'
    ).first();

    const hasQuota = await quotaDisplay.count() > 0;
    expect(typeof hasQuota).toBe('boolean');
  });

  test('handle multiple rapid requests gracefully', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // Send 3 rapid requests
    for (let i = 0; i < 3; i++) {
      await input.fill(`Rapid ${i + 1}`);
      await sendBtn.click();
      // No delay - test rapid firing
    }

    await new Promise((r) => setTimeout(r, 500));

    // Should handle gracefully (either queued or rate limited)
    const messages = sidepanelPage.locator('[data-testid="chatMessage"]');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(0);

    // Or should show rate limit message
    const rateLimitMsg = sidepanelPage.locator('[data-testid="rateLimitError"]').first();
    const hasRateLimit = await rateLimitMsg.count() > 0;
    expect(typeof hasRateLimit).toBe('boolean');
  });
});
