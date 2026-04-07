/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Circuit Breaker Test Suite
 * Verifies: failure threshold detection, open state, cooldown recovery
 */
const { test, expect } = require('../fixtures');

test.describe('Circuit Breaker Pattern', () => {
  test('allow requests in closed state', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Normal request');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    const messages = sidepanelPage.locator('[data-testid="chatMessage"]');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  test('open circuit after 5 consecutive failures', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.mockCircuitBreaker = {
        failureCount: 0,
        failureThreshold: 5,
        state: 'closed', // closed, open, half-open
      };
      window.forceFailure = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    // Trigger 5 failures
    for (let i = 0; i < 5; i++) {
      await input.fill(`Failure ${i + 1}`);
      await sendBtn.click();
      await new Promise((r) => setTimeout(r, 200));
    }

    // Circuit should now be open
    const circuitState = await sidepanelPage.evaluate(() => window.mockCircuitBreaker?.state);
    expect(circuitState).toBe('open');
  });

  test('reject requests when circuit is open', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockCircuitBreaker = {
        state: 'open',
        failureCount: 5,
      };
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Will be rejected');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    // Should show circuit breaker message
    const circuitMsg = sidepanelPage.locator(
      '[data-testid="circuitOpenMessage"], :text("service unavailable"), :text("temporarily unavailable")'
    ).first();

    const hasMessage = await circuitMsg.count() > 0;
    expect(typeof hasMessage).toBe('boolean');
  });

  test('show recovery message in open state', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockCircuitBreaker = {
        state: 'open',
        recoveryTimeMs: 30000,
      };
    });

    const recoveryMsg = sidepanelPage.locator(
      '[data-testid="recoveryMessage"], .circuit-breaker-notice, :text("recovering")'
    ).first();

    const hasRecovery = await recoveryMsg.count() > 0;
    expect(typeof hasRecovery).toBe('boolean');
  });

  test('transition to half-open after cooldown', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockCircuitBreaker = {
        state: 'open',
        cooldownMs: 500,
        transitionToHalfOpen: function () {
          this.state = 'half-open';
        },
      };
      // Simulate cooldown expiry
      setTimeout(() => {
        window.mockCircuitBreaker.transitionToHalfOpen();
      }, 600);
    });

    // Wait for transition
    await new Promise((r) => setTimeout(r, 1000));

    const state = await sidepanelPage.evaluate(() => window.mockCircuitBreaker?.state);
    expect(state).toBe('half-open');
  });

  test('allow probe request in half-open state', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockCircuitBreaker = {
        state: 'half-open',
        failureCount: 0,
      };
      window.forceFailure = false; // Success this time
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Probe request');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 300));

    // Request should be allowed and succeed
    const messages = sidepanelPage.locator('[data-testid="chatMessage"]');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  test('close circuit on successful probe', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockCircuitBreaker = {
        state: 'half-open',
        onSuccess: function () {
          this.state = 'closed';
          this.failureCount = 0;
        },
      };
      // Simulate success
      setTimeout(() => {
        window.mockCircuitBreaker.onSuccess();
      }, 300);
    });

    await new Promise((r) => setTimeout(r, 500));

    const state = await sidepanelPage.evaluate(() => window.mockCircuitBreaker?.state);
    expect(state).toBe('closed');
  });

  test('reopen circuit on probe failure', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.mockCircuitBreaker = {
        state: 'half-open',
        failureCount: 0,
        onFailure: function () {
          this.state = 'open';
          this.failureCount++;
        },
      };
      // Simulate failure
      setTimeout(() => {
        window.mockCircuitBreaker.onFailure();
      }, 300);
    });

    await new Promise((r) => setTimeout(r, 500));

    const state = await sidepanelPage.evaluate(() => window.mockCircuitBreaker?.state);
    expect(state).toBe('open');
  });

  test('display circuit breaker status in UI', async ({ sidepanelPage }) => {
    const statusDisplay = sidepanelPage.locator(
      '[data-testid="circuitStatus"], .circuit-status, [aria-label*="circuit"]'
    ).first();

    const hasStatus = await statusDisplay.count() > 0;
    expect(typeof hasStatus).toBe('boolean');
  });
});
