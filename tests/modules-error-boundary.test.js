/**
 * Error Boundary Module — Jest Tests
 * Tests for the CobraErrorBoundary global error catching system
 */

// Mock location.reload before importing error boundary
delete window.location;
window.location = { reload: jest.fn() };

// Mock Toast before importing error boundary
global.Toast = {
  warning: jest.fn(),
  error: jest.fn()
};

// Mock CobraAudit
global.CobraAudit = {
  log: jest.fn()
};

// Import the module (will auto-initialize)
const CobraErrorBoundary = require('../modules/error-boundary.js');

describe('CobraErrorBoundary Module', () => {
  beforeEach(() => {
    // Reset state
    CobraErrorBoundary._errors = [];
    CobraErrorBoundary._recoveryShown = false;

    // Clear all mocks
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Mock window.addEventListener and window.removeEventListener
    window.addEventListener = jest.fn();
    window.removeEventListener = jest.fn();

    // Create mock DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllTimers();
  });

  describe('init()', () => {
    test('should register error event listener on init', () => {
      jest.clearAllMocks();
      window.addEventListener = jest.fn();

      CobraErrorBoundary.init();

      const calls = window.addEventListener.mock.calls;
      const errorCall = calls.find(call => call[0] === 'error');
      expect(errorCall).toBeTruthy();
    });

    test('should register unhandledrejection event listener on init', () => {
      jest.clearAllMocks();
      window.addEventListener = jest.fn();

      CobraErrorBoundary.init();

      const calls = window.addEventListener.mock.calls;
      const rejectionCall = calls.find(call => call[0] === 'unhandledrejection');
      expect(rejectionCall).toBeTruthy();
    });

    test('should log initialization message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      CobraErrorBoundary.init();

      expect(consoleSpy).toHaveBeenCalledWith('[ErrorBoundary] Initialized — global error catching active');

      consoleSpy.mockRestore();
    });
  });

  describe('_handle()', () => {
    test('should record error in _errors array', () => {
      const error = {
        type: 'error',
        message: 'Test error',
        line: 10,
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(CobraErrorBoundary._errors.length).toBe(1);
      expect(CobraErrorBoundary._errors[0]).toEqual(error);
    });

    test('should deduplicate errors within 2 second window', () => {
      const error = {
        type: 'error',
        message: 'Duplicate error',
        line: 10,
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);
      CobraErrorBoundary._handle(error);

      expect(CobraErrorBoundary._errors.length).toBe(1);
    });

    test('should allow duplicate error after 2 second window', () => {
      jest.useFakeTimers();

      const error = {
        type: 'error',
        message: 'Duplicate error',
        line: 10,
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      // Advance time past 2 second window
      jest.advanceTimersByTime(2001);

      CobraErrorBoundary._handle(error);

      expect(CobraErrorBoundary._errors.length).toBe(2);

      jest.useRealTimers();
    });

    test('should distinguish errors by message and line number', () => {
      const error1 = {
        type: 'error',
        message: 'Error 1',
        line: 10,
        timestamp: Date.now()
      };

      const error2 = {
        type: 'error',
        message: 'Error 1',
        line: 20,
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error1);
      CobraErrorBoundary._handle(error2);

      expect(CobraErrorBoundary._errors.length).toBe(2);
    });

    test('should enforce maximum 50 errors', () => {
      for (let i = 0; i < 60; i++) {
        CobraErrorBoundary._handle({
          type: 'error',
          message: `Error ${i}`,
          line: i,
          timestamp: Date.now() - i // Make each unique
        });
      }

      expect(CobraErrorBoundary._errors.length).toBe(50);
      // Should keep the most recent 50
      expect(CobraErrorBoundary._errors[0].message).toContain('Error 10');
    });

    test('should log errors to console with styling', () => {
      const consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleGroupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation();

      const error = {
        type: 'error',
        message: 'Console test',
        line: 10,
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(consoleGroupSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Console test');
      expect(consoleGroupEndSpy).toHaveBeenCalled();

      consoleGroupSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleGroupEndSpy.mockRestore();
    });

    test('should call _classify to determine severity', () => {
      const spy = jest.spyOn(CobraErrorBoundary, '_classify');

      const error = {
        type: 'error',
        message: 'Test error',
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    test('should show recovery UI for critical errors', () => {
      const showRecoverySpy = jest.spyOn(CobraErrorBoundary, '_showRecoveryUI');

      const error = {
        type: 'error',
        message: 'Cannot read properties of null at sidepanel.js',
        source: '/sidepanel.js',
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(showRecoverySpy).toHaveBeenCalledWith(error);

      showRecoverySpy.mockRestore();
    });

    test('should show toast for warning errors with user-facing messages', () => {
      const error = {
        type: 'error',
        message: 'Network timeout occurred',
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(Toast.warning).toHaveBeenCalled();
    });

    test('should not show toast for non-user-facing warnings', () => {
      jest.clearAllMocks();

      const error = {
        type: 'error',
        message: 'ResizeObserver loop limit exceeded',
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(Toast.warning).not.toHaveBeenCalled();
    });

    test('should call CobraAudit.log if available', () => {
      jest.clearAllMocks();

      const error = {
        type: 'error',
        message: 'Audit test error',
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(CobraAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'JS_ERROR',
          category: 'system',
          result: 'fail'
        })
      );
    });

    test('should gracefully handle missing CobraAudit', () => {
      delete global.CobraAudit;

      const error = {
        type: 'error',
        message: 'No audit test',
        timestamp: Date.now()
      };

      expect(() => {
        CobraErrorBoundary._handle(error);
      }).not.toThrow();

      global.CobraAudit = { log: jest.fn() };
    });
  });

  describe('_classify()', () => {
    test('should classify null reference at sidepanel as critical', () => {
      const error = {
        message: 'Cannot read properties of null',
        source: '/sidepanel.js'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('critical');
    });

    test('should classify chrome.runtime disconnected as critical', () => {
      const error = {
        message: 'chrome.runtime has been disconnected'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('critical');
    });

    test('should classify extension context invalidated as critical', () => {
      const error = {
        message: 'Extension context invalidated'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('critical');
    });

    test('should classify quota exceeded as critical', () => {
      const error = {
        message: 'QuotaExceededError: quota exceeded'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('critical');
    });

    test('should classify network errors as warning', () => {
      const error = {
        message: 'Network request failed'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('warning');
    });

    test('should classify fetch errors as warning', () => {
      const error = {
        message: 'Fetch error occurred'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('warning');
    });

    test('should classify timeout errors as warning', () => {
      const error = {
        message: 'Request timeout'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('warning');
    });

    test('should classify promise rejections as warning', () => {
      const error = {
        type: 'rejection',
        message: 'Promise rejected'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('warning');
    });

    test('should classify other errors as info', () => {
      const error = {
        type: 'error',
        message: 'Some random error'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('info');
    });

    test('should be case insensitive', () => {
      const error = {
        message: 'NETWORK ERROR OCCURRED'
      };

      expect(CobraErrorBoundary._classify(error)).toBe('warning');
    });

    test('should handle missing message property', () => {
      const error = { type: 'error' };

      expect(() => {
        CobraErrorBoundary._classify(error);
      }).not.toThrow();

      expect(CobraErrorBoundary._classify(error)).toBe('info');
    });
  });

  describe('_isUserFacing()', () => {
    test('should filter out ResizeObserver errors', () => {
      const error = {
        message: 'ResizeObserver loop limit exceeded'
      };

      expect(CobraErrorBoundary._isUserFacing(error)).toBe(false);
    });

    test('should filter out script error', () => {
      const error = {
        message: 'Script error'
      };

      expect(CobraErrorBoundary._isUserFacing(error)).toBe(false);
    });

    test('should filter out extension page errors', () => {
      const error = {
        message: 'Error in extension page'
      };

      expect(CobraErrorBoundary._isUserFacing(error)).toBe(false);
    });

    test('should accept user-facing errors', () => {
      const error = {
        message: 'User cannot save settings'
      };

      expect(CobraErrorBoundary._isUserFacing(error)).toBe(true);
    });

    test('should accept network errors as user-facing', () => {
      const error = {
        message: 'Network connection failed'
      };

      expect(CobraErrorBoundary._isUserFacing(error)).toBe(true);
    });

    test('should handle missing message property', () => {
      const error = { type: 'error' };

      expect(CobraErrorBoundary._isUserFacing(error)).toBe(true);
    });

    test('should be case insensitive', () => {
      const error = {
        message: 'RESIZEOBSERVER LOOP'
      };

      expect(CobraErrorBoundary._isUserFacing(error)).toBe(false);
    });
  });

  describe('_showRecoveryUI()', () => {
    test('should create overlay with correct styling', () => {
      const error = {
        message: 'Critical error occurred'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const overlay = document.getElementById('cobraErrorOverlay');
      expect(overlay).toBeTruthy();
      expect(overlay.style.position).toBe('fixed');
      expect(overlay.style.zIndex).toBe('99999');
    });

    test('should display error message in overlay', () => {
      const error = {
        message: 'Test critical error'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const overlay = document.getElementById('cobraErrorOverlay');
      expect(overlay.innerHTML).toContain('Test critical error');
    });

    test('should display error count in overlay', () => {
      CobraErrorBoundary._errors = [{}, {}, {}];

      const error = {
        message: 'Test error'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const overlay = document.getElementById('cobraErrorOverlay');
      expect(overlay.innerHTML).toContain('3 errori registrati');
    });

    test('should create reload button', () => {
      const error = {
        message: 'Test error'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const reloadBtn = document.getElementById('cobraRecoveryReload');
      expect(reloadBtn).toBeTruthy();
      expect(reloadBtn.textContent).toContain('Ricarica');
    });

    test('should create dismiss button', () => {
      const error = {
        message: 'Test error'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const dismissBtn = document.getElementById('cobraRecoveryDismiss');
      expect(dismissBtn).toBeTruthy();
      expect(dismissBtn.textContent).toContain('Ignora');
    });

    test('reload button should trigger page reload', () => {
      const reloadSpy = jest.spyOn(location, 'reload').mockImplementation();

      const error = {
        message: 'Test error'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const reloadBtn = document.getElementById('cobraRecoveryReload');
      reloadBtn.click();

      expect(reloadSpy).toHaveBeenCalled();

      reloadSpy.mockRestore();
    });

    test('dismiss button should remove overlay', () => {
      const error = {
        message: 'Test error'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      let overlay = document.getElementById('cobraErrorOverlay');
      expect(overlay).toBeTruthy();

      const dismissBtn = document.getElementById('cobraRecoveryDismiss');
      dismissBtn.click();

      overlay = document.getElementById('cobraErrorOverlay');
      expect(overlay).toBeNull();
    });

    test('dismiss button should reset _recoveryShown flag', () => {
      const error = {
        message: 'Test error'
      };

      CobraErrorBoundary._showRecoveryUI(error);
      expect(CobraErrorBoundary._recoveryShown).toBe(true);

      const dismissBtn = document.getElementById('cobraRecoveryDismiss');
      dismissBtn.click();

      expect(CobraErrorBoundary._recoveryShown).toBe(false);
    });

    test('should only show recovery UI once', () => {
      const error = {
        message: 'Test error'
      };

      CobraErrorBoundary._showRecoveryUI(error);
      const firstOverlay = document.getElementById('cobraErrorOverlay');

      CobraErrorBoundary._showRecoveryUI(error);
      const overlays = document.querySelectorAll('#cobraErrorOverlay');

      // Should still have only one overlay
      expect(overlays.length).toBe(1);
    });

    test('should sanitize error message to prevent XSS', () => {
      const error = {
        message: '<script>alert("XSS")</script>'
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const overlay = document.getElementById('cobraErrorOverlay');
      // The message should be escaped
      expect(overlay.innerHTML).not.toContain('<script>');
    });

    test('should truncate very long error messages', () => {
      const longMsg = 'A'.repeat(200);
      const error = {
        message: longMsg
      };

      CobraErrorBoundary._showRecoveryUI(error);

      const overlay = document.getElementById('cobraErrorOverlay');
      // Message should be truncated to 150 chars
      const messageText = overlay.textContent;
      expect(messageText).not.toContain(longMsg);
    });
  });

  describe('_sanitize()', () => {
    test('should escape HTML special characters', () => {
      const input = '<script>alert("XSS")</script>';
      const output = CobraErrorBoundary._sanitize(input);

      expect(output).not.toContain('<script>');
      expect(output).toContain('&lt;');
      expect(output).toContain('&gt;');
    });

    test('should handle null input', () => {
      const output = CobraErrorBoundary._sanitize(null);
      expect(output).toBe('');
    });

    test('should handle undefined input', () => {
      const output = CobraErrorBoundary._sanitize(undefined);
      expect(output).toBe('');
    });

    test('should handle empty string', () => {
      const output = CobraErrorBoundary._sanitize('');
      expect(output).toBe('');
    });

    test('should preserve regular text', () => {
      const input = 'Regular error message';
      const output = CobraErrorBoundary._sanitize(input);

      expect(output).toBe('Regular error message');
    });
  });

  describe('getErrors()', () => {
    test('should return copy of errors array', () => {
      const error = {
        type: 'error',
        message: 'Test',
        timestamp: Date.now()
      };

      CobraErrorBoundary._errors = [error];

      const result = CobraErrorBoundary.getErrors();

      expect(result).not.toBe(CobraErrorBoundary._errors);
      expect(result).toEqual([error]);
    });

    test('should return empty array when no errors', () => {
      CobraErrorBoundary._errors = [];

      const result = CobraErrorBoundary.getErrors();

      expect(result).toEqual([]);
    });

    test('should not allow modification of internal errors', () => {
      const error = { type: 'error', message: 'Test', timestamp: Date.now() };
      CobraErrorBoundary._errors = [error];

      const result = CobraErrorBoundary.getErrors();
      result.push({ type: 'error', message: 'Fake', timestamp: Date.now() });

      expect(CobraErrorBoundary._errors.length).toBe(1);
    });
  });

  describe('getStats()', () => {
    test('should return stats object with total count', () => {
      CobraErrorBoundary._errors = [
        { type: 'error', message: 'Error 1', timestamp: Date.now() },
        { type: 'rejection', message: 'Rejection 1', timestamp: Date.now() }
      ];

      const stats = CobraErrorBoundary.getStats();

      expect(stats.total).toBe(2);
    });

    test('should aggregate errors by type', () => {
      CobraErrorBoundary._errors = [
        { type: 'error', message: 'Error 1', timestamp: Date.now() },
        { type: 'error', message: 'Error 2', timestamp: Date.now() },
        { type: 'rejection', message: 'Rejection 1', timestamp: Date.now() }
      ];

      const stats = CobraErrorBoundary.getStats();

      expect(stats.byType.error).toBe(2);
      expect(stats.byType.rejection).toBe(1);
    });

    test('should aggregate errors by severity', () => {
      CobraErrorBoundary._errors = [
        { type: 'error', message: 'Cannot read properties of null at sidepanel', source: '/sidepanel.js', timestamp: Date.now() },
        { type: 'error', message: 'Network error', timestamp: Date.now() },
        { type: 'error', message: 'Random error', timestamp: Date.now() }
      ];

      const stats = CobraErrorBoundary.getStats();

      expect(stats.bySeverity).toHaveProperty('critical');
      expect(stats.bySeverity).toHaveProperty('warning');
      expect(stats.bySeverity).toHaveProperty('info');
    });

    test('should count errors in last 5 minutes', () => {
      const now = Date.now();
      CobraErrorBoundary._errors = [
        { type: 'error', message: 'Recent error 1', timestamp: now - 60000 }, // 1 min ago
        { type: 'error', message: 'Recent error 2', timestamp: now - 120000 }, // 2 min ago
        { type: 'error', message: 'Old error', timestamp: now - 400000 } // 6+ min ago
      ];

      const stats = CobraErrorBoundary.getStats();

      expect(stats.last5min).toBe(2);
    });

    test('should handle empty errors array', () => {
      CobraErrorBoundary._errors = [];

      const stats = CobraErrorBoundary.getStats();

      expect(stats.total).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.bySeverity).toEqual({});
    });
  });

  describe('clear()', () => {
    test('should empty errors array', () => {
      CobraErrorBoundary._errors = [
        { type: 'error', message: 'Error 1', timestamp: Date.now() },
        { type: 'error', message: 'Error 2', timestamp: Date.now() }
      ];

      CobraErrorBoundary.clear();

      expect(CobraErrorBoundary._errors).toEqual([]);
    });

    test('should allow new errors after clear', () => {
      CobraErrorBoundary._errors = [
        { type: 'error', message: 'Error 1', timestamp: Date.now() }
      ];

      CobraErrorBoundary.clear();

      const error = {
        type: 'error',
        message: 'New error',
        timestamp: Date.now()
      };

      CobraErrorBoundary._handle(error);

      expect(CobraErrorBoundary._errors.length).toBe(1);
      expect(CobraErrorBoundary._errors[0].message).toBe('New error');
    });
  });

  describe('Error listener integration', () => {
    test('should handle window error event', () => {
      const handleSpy = jest.spyOn(CobraErrorBoundary, '_handle');

      const event = new ErrorEvent('error', {
        message: 'Test error',
        filename: 'test.js',
        lineno: 10,
        colno: 5,
        error: new Error('Test error\nat test.js:10:5')
      });

      window.dispatchEvent(event);

      expect(handleSpy).toHaveBeenCalled();

      handleSpy.mockRestore();
    });

    test('should handle unhandledrejection event', () => {
      const handleSpy = jest.spyOn(CobraErrorBoundary, '_handle');

      const error = new Error('Promise rejection');
      const promise = Promise.reject(error);
      // Catch the rejection to prevent uncaught exception
      promise.catch(() => {});

      const event = new PromiseRejectionEvent('unhandledrejection', {
        reason: error,
        promise: promise
      });

      window.dispatchEvent(event);

      expect(handleSpy).toHaveBeenCalled();

      handleSpy.mockRestore();
    });
  });
});
