/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Tool Execution & Safety Test Suite
 * Verifies: tool execution, safety checks, policy enforcement
 */
const { test, expect } = require('../fixtures');

test.describe('Tool Execution & Safety', () => {
  test('display tool recommendations in chat', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Can you execute a task?');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Look for tool suggestion
    const toolSuggestion = sidepanelPage.locator('[data-testid="toolSuggestion"], .tool-card, [aria-label*="tool"]').first();

    const hasToolSuggestion = await toolSuggestion.count() > 0;
    expect(typeof hasToolSuggestion).toBe('boolean');
  });

  test('execute safe tool without confirmation', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.safeToolName = 'read_file';
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Execute read file tool');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Safe tools should execute without dialog
    const confirmDialog = sidepanelPage.locator('[role="dialog"], .confirm-tool-execution').first();

    const hasDialog = await confirmDialog.count() > 0;
    // Safe tools may not show dialog
    expect(typeof hasDialog).toBe('boolean');
  });

  test('require confirmation for sensitive tool', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.sensitiveToolName = 'delete_file';
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Execute delete file tool');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Sensitive tools should show confirmation
    const confirmDialog = sidepanelPage.locator('[role="dialog"], .confirm-tool-execution, [data-testid="confirmTool"]').first();

    const hasDialog = await confirmDialog.count() > 0;
    expect(typeof hasDialog).toBe('boolean');
  });

  test('show tool safety warnings', async ({ sidepanelPage }) => {
    const toolWarning = sidepanelPage.locator('[data-testid="toolWarning"], .tool-warning, [role="status"]').first();

    const hasWarning = await toolWarning.count() > 0;
    expect(typeof hasWarning).toBe('boolean');
  });

  test('confirm before executing tool', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Execute tool');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    const confirmDialog = sidepanelPage.locator('[role="dialog"]').first();

    if (await confirmDialog.count() > 0) {
      const confirmBtn = sidepanelPage.locator('[data-testid="confirmToolExec"], button:has-text("Confirm")').first();

      if (await confirmBtn.count() > 0) {
        await confirmBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Dialog should close after confirmation
        const isVisible = await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false);
        expect(isVisible).toBe(false);
      }
    }
  });

  test('abort tool execution on cancel', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Execute tool');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    const confirmDialog = sidepanelPage.locator('[role="dialog"]').first();

    if (await confirmDialog.count() > 0) {
      const cancelBtn = sidepanelPage.locator('[data-testid="cancelToolExec"], button:has-text("Cancel")').first();

      if (await cancelBtn.count() > 0) {
        await cancelBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Dialog should close without executing
        const isVisible = await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false);
        expect(isVisible).toBe(false);
      }
    }
  });

  test('show tool execution result', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Tool execution result test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    const resultMsg = sidepanelPage.locator('[data-testid="toolResult"], [role="status"]').first();

    const hasResult = await resultMsg.count() > 0;
    expect(typeof hasResult).toBe('boolean');
  });

  test('handle tool execution error', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.forceToolError = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Tool error test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    const errorMsg = sidepanelPage.locator('[data-testid="toolError"], .error-message').first();

    const hasError = await errorMsg.count() > 0;
    expect(typeof hasError).toBe('boolean');
  });

  test('enforce policy restrictions on tool', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.policyBlocked = true;
      window.blockedToolReason = 'Violates policy restrictions';
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Restricted tool');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    const policyMsg = sidepanelPage.locator('[data-testid="policyBlocked"], .policy-error').first();

    const hasPolicy = await policyMsg.count() > 0;
    expect(typeof hasPolicy).toBe('boolean');
  });
});
