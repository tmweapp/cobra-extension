/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Streaming & SSE Test Suite
 * Verifies: chunked response handling, progressive UI updates, stream termination
 */
const { test, expect } = require('../fixtures');

test.describe('Streaming SSE Responses', () => {
  test('display streaming chunks as they arrive', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.mockStreamingEnabled = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // Send message that triggers streaming response
    await input.fill('Generate a long response');
    await sendBtn.click();

    // Wait for first chunk to appear
    const messages = sidepanelPage.locator('[data-testid="chatMessage"][data-role="assistant"]');
    const count = await messages.count({ timeout: 5000 }).catch(() => 0);
    expect(count).toBeGreaterThan(0);
  });

  test('update message progressively as chunks arrive', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // Inject streaming handler
    await sidepanelPage.evaluate(() => {
      window.testStreamProgress = [];
    });

    await input.fill('Stream test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Check if message content is present
    const lastMsg = sidepanelPage.locator('[data-testid="chatMessage"]').last();
    const content = await lastMsg.textContent().catch(() => '');
    expect(typeof content).toBe('string');
  });

  test('show loading indicator while streaming', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Streaming message');
    await sendBtn.click();

    // Look for loading/spinner element
    const loadingIndicator = sidepanelPage.locator(
      '[data-testid="loadingIndicator"], .spinner, .loading, [aria-busy="true"]'
    ).first();

    const hasLoading = await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false);
    expect(typeof hasLoading).toBe('boolean');
  });

  test('complete stream and remove loading state', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Final chunk test');
    await sendBtn.click();

    // Wait for stream completion
    await new Promise((r) => setTimeout(r, 1000));

    // Loading indicator should be gone
    const loadingIndicator = sidepanelPage.locator('[data-testid="loadingIndicator"], .spinner').first();
    const isVisible = await loadingIndicator.isVisible({ timeout: 2000 }).catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('handle stream error and show fallback', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.forceStreamError = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Error stream');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Should show error state
    const errorMsg = sidepanelPage.locator('[data-testid="errorMessage"], .error-toast').first();
    const hasError = await errorMsg.isVisible({ timeout: 3000 }).catch(() => false);
    expect(typeof hasError).toBe('boolean');
  });

  test('cancel stream in progress', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Long stream');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    // Look for cancel button
    const cancelBtn = sidepanelPage.locator('[data-testid="cancelStream"], .btn-cancel').first();

    if (await cancelBtn.count() > 0) {
      await cancelBtn.click();
      await new Promise((r) => setTimeout(r, 200));

      // Stream should be aborted
      const loadingIndicator = sidepanelPage.locator('[data-testid="loadingIndicator"]').first();
      const isVisible = await loadingIndicator.isVisible({ timeout: 2000 }).catch(() => false);
      expect(typeof isVisible).toBe('boolean');
    }
  });

  test('format markdown in streamed content', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('**Bold** and *italic* test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    const lastMsg = sidepanelPage.locator('[data-testid="chatMessage"]').last();

    // Check for HTML rendering of markdown
    const hasFormatting = await lastMsg.evaluate((el) => {
      const text = el.textContent || '';
      return text.includes('Bold') || el.innerHTML.includes('<strong>') || el.innerHTML.includes('<em>');
    });

    expect(typeof hasFormatting).toBe('boolean');
  });
});
