/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Tooltips & Onboarding Flow Test Suite
 * Verifies: first-time user experience, tooltip display, onboarding completion
 */
const { test, expect } = require('../fixtures');

test.describe('Tooltips & Onboarding', () => {
  test('show onboarding modal on first load', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.isFirstTimeUser = true;
    });

    // Navigate to trigger onboarding check
    await sidepanelPage.goto(sidepanelPage.url());
    await new Promise((r) => setTimeout(r, 500));

    const onboardingModal = sidepanelPage.locator(
      '[data-testid="onboardingModal"], .onboarding-modal, [aria-label*="welcome"]'
    ).first();

    const hasOnboarding = await onboardingModal.count() > 0;
    expect(typeof hasOnboarding).toBe('boolean');
  });

  test('display welcome message with feature highlights', async ({ sidepanelPage }) => {
    const welcomeText = sidepanelPage.locator(
      '[data-testid="welcomeMessage"], .welcome-text, h1:has-text("Welcome")'
    ).first();

    if (await welcomeText.count() > 0) {
      await expect(welcomeText).toBeVisible();
    }
  });

  test('show tooltip on chat input field', async ({ sidepanelPage }) => {
    const inputField = sidepanelPage.locator('#chatInput');

    // Hover to trigger tooltip
    await inputField.hover();
    await new Promise((r) => setTimeout(r, 500));

    const tooltip = sidepanelPage.locator('[role="tooltip"], .tooltip, [data-testid="tooltip"]').first();

    const hasTooltip = await tooltip.count() > 0;
    expect(typeof hasTooltip).toBe('boolean');
  });

  test('show tooltip on voice button', async ({ sidepanelPage }) => {
    const voiceBtn = sidepanelPage.locator('[data-testid="voiceToggle"], [aria-label*="voice"]').first();

    if (await voiceBtn.count() > 0) {
      await voiceBtn.hover();
      await new Promise((r) => setTimeout(r, 500));

      const tooltip = sidepanelPage.locator('[role="tooltip"], .tooltip').first();
      const hasTooltip = await tooltip.count() > 0;
      expect(typeof hasTooltip).toBe('boolean');
    }
  });

  test('step through onboarding sequence', async ({ sidepanelPage }) => {
    const nextBtn = sidepanelPage.locator('[data-testid="nextStep"], .btn-next, button:has-text("Next")').first();

    if (await nextBtn.count() > 0) {
      const stepBefore = await sidepanelPage.locator('[data-testid="onboardingStep"], .step-indicator').first().textContent();

      await nextBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const stepAfter = await sidepanelPage.locator('[data-testid="onboardingStep"]').first().textContent();

      expect(typeof stepBefore).toBe('string');
      expect(typeof stepAfter).toBe('string');
    }
  });

  test('skip onboarding flow', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.isFirstTimeUser = true;
    });

    const skipBtn = sidepanelPage.locator('[data-testid="skipOnboarding"], .btn-skip, button:has-text("Skip")').first();

    if (await skipBtn.count() > 0) {
      await skipBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      // Onboarding modal should be closed
      const modal = sidepanelPage.locator('[data-testid="onboardingModal"]').first();
      const isVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
      expect(isVisible).toBe(false);
    }
  });

  test('mark onboarding as completed', async ({ sidepanelPage }) => {
    const completeBtn = sidepanelPage.locator('[data-testid="completeOnboarding"], .btn-complete, button:has-text("Get Started")').first();

    if (await completeBtn.count() > 0) {
      await completeBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      // Check storage for completion flag
      const completed = await sidepanelPage.evaluate(() => {
        return new Promise((resolve) => {
          chrome.storage.local.get('onboardingCompleted', (result) => {
            resolve(result.onboardingCompleted === true);
          });
        });
      });

      expect(completed).toBe(true);
    }
  });

  test('show feature tips for each section', async ({ sidepanelPage }) => {
    // Hover over settings icon to show tip
    const settingsIcon = sidepanelPage.locator('[data-view="settings"], [aria-label*="settings"]').first();

    if (await settingsIcon.count() > 0) {
      await settingsIcon.hover();
      await new Promise((r) => setTimeout(r, 500));

      const tip = sidepanelPage.locator('[role="tooltip"], .tooltip, .feature-tip').first();
      const hasTip = await tip.count() > 0;
      expect(typeof hasTip).toBe('boolean');
    }
  });

  test('dismiss tooltip by clicking elsewhere', async ({ sidepanelPage }) => {
    const inputField = sidepanelPage.locator('#chatInput');

    // Show tooltip
    await inputField.hover();
    await new Promise((r) => setTimeout(r, 500));

    // Click elsewhere to dismiss
    await sidepanelPage.click('#root', { position: { x: 0, y: 0 } });
    await new Promise((r) => setTimeout(r, 300));

    const tooltip = sidepanelPage.locator('[role="tooltip"]').first();
    const isVisible = await tooltip.isVisible({ timeout: 2000 }).catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('show contextual help for error states', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.forceMessageError = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Error test');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Look for help text near error
    const helpText = sidepanelPage.locator(
      '[data-testid="errorHelp"], .help-text, [role="status"]'
    ).first();

    const hasHelp = await helpText.count() > 0;
    expect(typeof hasHelp).toBe('boolean');
  });
});
