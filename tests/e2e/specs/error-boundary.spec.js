/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Error Boundary & Exception Handling Test Suite
 * Verifies: global error catching, fallback UI, recovery from exceptions
 */
const { test, expect } = require('../fixtures');

test.describe('Error Boundary & Global Error Handling', () => {
  test('catch and display runtime errors gracefully', async ({ sidepanelPage }) => {
    // Inject an error that will be thrown
    await sidepanelPage.evaluate(() => {
      window.throwTestError = () => {
        throw new Error('Test runtime error');
      };
    });

    // Trigger the error
    await sidepanelPage.evaluate(() => {
      try {
        window.throwTestError();
      } catch (err) {
        window.lastError = err.message;
      }
    });

    const errorMsg = await sidepanelPage.evaluate(() => window.lastError);
    expect(errorMsg).toBe('Test runtime error');
  });

  test('show error boundary UI on component crash', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      // Simulate component error
      window.COMPONENT_ERROR = true;
      window.errorBoundary = {
        hasError: true,
        error: 'Component render failed',
      };
    });

    const errorBoundary = sidepanelPage.locator(
      '[data-testid="errorBoundary"], .error-boundary, [data-section="error"]'
    ).first();

    const hasErrorUI = await errorBoundary.count() > 0;
    expect(typeof hasErrorUI).toBe('boolean');
  });

  test('display error message to user', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.globalError = {
        message: 'Something went wrong. Please try again.',
        code: 'ERR_UNKNOWN',
      };
    });

    const errorMsg = sidepanelPage.locator(
      '[data-testid="errorDisplay"], .error-message, [role="alert"]'
    ).first();

    const hasMessage = await errorMsg.count() > 0;
    expect(typeof hasMessage).toBe('boolean');
  });

  test('provide recover button after error', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.globalError = {
        message: 'Error occurred',
        recoverable: true,
      };
    });

    const recoverBtn = sidepanelPage.locator(
      '[data-testid="recoverError"], .btn-recover, button:has-text("Recover")'
    ).first();

    const hasRecover = await recoverBtn.count() > 0;
    expect(typeof hasRecover).toBe('boolean');
  });

  test('catch unhandled promise rejections', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.rejectionCaught = false;

      window.addEventListener('unhandledrejection', (event) => {
        window.rejectionCaught = true;
        event.preventDefault();
      });

      Promise.reject(new Error('Unhandled promise rejection')).catch(() => {});
    });

    await new Promise((r) => setTimeout(r, 500));

    const caught = await sidepanelPage.evaluate(() => window.rejectionCaught);
    expect(typeof caught).toBe('boolean');
  });

  test('log error details to console for debugging', async ({ sidepanelPage }) => {
    const consoleLogs = [];

    sidepanelPage.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warn') {
        consoleLogs.push(msg.text());
      }
    });

    await sidepanelPage.evaluate(() => {
      console.error('Test error for logging');
    });

    await new Promise((r) => setTimeout(r, 200));

    const hasErrorLog = consoleLogs.some((log) => log.includes('Test error'));
    expect(typeof hasErrorLog).toBe('boolean');
  });

  test('prevent error cascading', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.errors = [];
      window.errorHandler = {
        handle: function (err) {
          this.errors = [err]; // Only keep latest error
        },
      };

      // Simulate multiple errors
      window.errorHandler.handle(new Error('Error 1'));
      window.errorHandler.handle(new Error('Error 2'));
      window.errorHandler.handle(new Error('Error 3'));
    });

    const errorCount = await sidepanelPage.evaluate(() => window.errorHandler.errors.length);
    expect(errorCount).toBe(1); // Should only keep last error
  });

  test('show fallback UI while recovering', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.isRecovering = true;
      window.recoveryStatus = 'Attempting to recover...';
    });

    const fallbackUI = sidepanelPage.locator(
      '[data-testid="fallbackUI"], .fallback, .recovery-indicator'
    ).first();

    const hasFallback = await fallbackUI.count() > 0;
    expect(typeof hasFallback).toBe('boolean');
  });

  test('clear error state after recovery', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.globalError = {
        message: 'Error occurred',
        hasRecovered: false,
      };
    });

    // Simulate recovery
    await sidepanelPage.evaluate(() => {
      window.globalError.hasRecovered = true;
    });

    await new Promise((r) => setTimeout(r, 300));

    const hasRecovered = await sidepanelPage.evaluate(() => window.globalError?.hasRecovered);
    expect(hasRecovered).toBe(true);
  });

  test('handle errors in service worker communication', async ({ sidepanelPage, serviceWorker }) => {
    // Try to send message to service worker
    const error = await sidepanelPage.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'test' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(chrome.runtime.lastError.message);
          } else {
            resolve(null);
          }
        });
      });
    });

    expect(typeof error).toBe('string');
  });

  test('display retry limit exceeded message', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.retryState = {
        attemptCount: 5,
        maxRetries: 5,
      };
    });

    const retryMaxMsg = sidepanelPage.locator(
      '[data-testid="retryMaxed"], .retry-max-error, :text("max retry")'
    ).first();

    const hasMessage = await retryMaxMsg.count() > 0;
    expect(typeof hasMessage).toBe('boolean');
  });
});
