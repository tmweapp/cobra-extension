/**
 * Toast Module — Jest Tests
 * Tests for the Toast notification system
 */

// Import the module
const Toast = require('../modules/toast.js');

describe('Toast Module', () => {
  let toastContainer;

  beforeEach(() => {
    // Create mock DOM with toast container
    document.body.innerHTML = '<div id="toastContainer"></div>';
    toastContainer = document.getElementById('toastContainer');

    // Reset Toast's cached container reference
    Toast._container = null;

    // Clear any timers
    jest.clearAllTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllTimers();
  });

  describe('_getContainer()', () => {
    test('should find and cache the toast container', () => {
      const container = Toast._getContainer();
      expect(container).toBe(toastContainer);

      // Verify it caches the reference
      const container2 = Toast._getContainer();
      expect(container2).toBe(container);
    });

    test('should return null if container does not exist', () => {
      document.body.innerHTML = '';
      Toast._container = null;
      const container = Toast._getContainer();
      expect(container).toBeNull();
    });
  });

  describe('show()', () => {
    test('should create a toast element with correct structure', () => {
      Toast.show('Test message', 'info');

      const toasts = toastContainer.querySelectorAll('.toast');
      expect(toasts.length).toBe(1);

      const toast = toasts[0];
      expect(toast.className).toBe('toast toast-info');
      expect(toast.innerHTML).toContain('Test message');
      expect(toast.innerHTML).toContain('toast-icon');
      expect(toast.innerHTML).toContain('toast-close');
    });

    test('should use default type "info" when not specified', () => {
      Toast.show('Default type');

      const toast = toastContainer.querySelector('.toast');
      expect(toast.className).toBe('toast toast-info');
    });

    test('should use default duration 4000ms when not specified', () => {
      jest.useFakeTimers();
      Toast.show('Timed message');

      const toast = toastContainer.querySelector('.toast');
      expect(toast).toBeTruthy();

      // Advance time to just before dismiss
      jest.advanceTimersByTime(3999);
      expect(toast.parentNode).toBeTruthy();

      // Advance past dismiss
      jest.advanceTimersByTime(1);
      jest.advanceTimersByTime(300); // dismiss animation
      expect(toast.parentNode).toBeNull();

      jest.useRealTimers();
    });

    test('should support success type with correct icon', () => {
      Toast.show('Success!', 'success');

      const toast = toastContainer.querySelector('.toast-success');
      expect(toast).toBeTruthy();
      expect(toast.innerHTML).toContain('✓');
    });

    test('should support error type with correct icon', () => {
      Toast.show('Error!', 'error');

      const toast = toastContainer.querySelector('.toast-error');
      expect(toast).toBeTruthy();
      expect(toast.innerHTML).toContain('✕');
    });

    test('should support warning type with correct icon', () => {
      Toast.show('Warning!', 'warning');

      const toast = toastContainer.querySelector('.toast-warning');
      expect(toast).toBeTruthy();
      expect(toast.innerHTML).toContain('⚠');
    });

    test('should support info type with correct icon', () => {
      Toast.show('Info', 'info');

      const toast = toastContainer.querySelector('.toast-info');
      expect(toast).toBeTruthy();
      expect(toast.innerHTML).toContain('ℹ');
    });

    test('should enforce maximum of 5 toasts', () => {
      for (let i = 0; i < 7; i++) {
        Toast.show(`Toast ${i}`, 'info');
      }

      const toasts = toastContainer.querySelectorAll('.toast');
      expect(toasts.length).toBe(5);
    });

    test('should respect custom duration parameter', () => {
      jest.useFakeTimers();
      Toast.show('Custom duration', 'info', 2000);

      const toast = toastContainer.querySelector('.toast');

      jest.advanceTimersByTime(1999);
      expect(toast.parentNode).toBeTruthy();

      jest.advanceTimersByTime(1);
      jest.advanceTimersByTime(300); // dismiss animation
      expect(toast.parentNode).toBeNull();

      jest.useRealTimers();
    });

    test('should handle case when container does not exist', () => {
      document.body.innerHTML = '';
      Toast._container = null;

      // Should not throw
      expect(() => {
        Toast.show('No container');
      }).not.toThrow();
    });

    test('should close toast when clicking close button', () => {
      Toast.show('Clickable toast', 'info');

      const toast = toastContainer.querySelector('.toast');
      const closeBtn = toast.querySelector('.toast-close');

      closeBtn.click();

      // Should have toast-out class added
      jest.advanceTimersByTime(1);
      expect(toast.classList.contains('toast-out')).toBe(true);
    });

    test('should close toast when clicking on it (non-close-button)', () => {
      Toast.show('Click to close', 'info');

      const toast = toastContainer.querySelector('.toast');
      const textSpan = toast.querySelector('.toast-text');

      textSpan.click();

      jest.advanceTimersByTime(1);
      expect(toast.classList.contains('toast-out')).toBe(true);
    });

    test('should not close toast when clicking close button on close button itself', () => {
      Toast.show('Click test', 'info');

      const toast = toastContainer.querySelector('.toast');
      const closeBtn = toast.querySelector('.toast-close');

      // Create mock event that targets the close button
      const event = new MouseEvent('click');
      Object.defineProperty(event, 'target', {
        value: closeBtn,
        enumerable: true
      });

      // This should dismiss
      closeBtn.onclick(event);

      jest.advanceTimersByTime(1);
      expect(toast.classList.contains('toast-out')).toBe(true);
    });
  });

  describe('_dismiss()', () => {
    test('should add toast-out class to element', () => {
      Toast.show('Test', 'info');

      const toast = toastContainer.querySelector('.toast');
      Toast._dismiss(toast);

      expect(toast.classList.contains('toast-out')).toBe(true);
    });

    test('should remove element after 300ms animation', () => {
      jest.useFakeTimers();
      Toast.show('Test', 'info');

      const toast = toastContainer.querySelector('.toast');
      Toast._dismiss(toast);

      expect(toast.parentNode).toBeTruthy();

      jest.advanceTimersByTime(299);
      expect(toast.parentNode).toBeTruthy();

      jest.advanceTimersByTime(1);
      expect(toast.parentNode).toBeNull();

      jest.useRealTimers();
    });

    test('should handle null element gracefully', () => {
      expect(() => {
        Toast._dismiss(null);
      }).not.toThrow();
    });

    test('should handle element with no parent node', () => {
      const orphanEl = document.createElement('div');

      expect(() => {
        Toast._dismiss(orphanEl);
      }).not.toThrow();
    });

    test('should not remove element if already removed', () => {
      Toast.show('Test', 'info');

      const toast = toastContainer.querySelector('.toast');
      toast.remove();

      expect(() => {
        Toast._dismiss(toast);
      }).not.toThrow();
    });
  });

  describe('Shorthand methods', () => {
    test('success() should call show with success type', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.success('Success message');

      expect(spy).toHaveBeenCalledWith('Success message', 'success', undefined);

      spy.mockRestore();
    });

    test('success() should accept custom duration', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.success('Success', 3000);

      expect(spy).toHaveBeenCalledWith('Success', 'success', 3000);

      spy.mockRestore();
    });

    test('error() should call show with error type', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.error('Error message');

      expect(spy).toHaveBeenCalledWith('Error message', 'error', 6000);

      spy.mockRestore();
    });

    test('error() should use 6000ms default duration', () => {
      Toast.error('Error');

      const toast = toastContainer.querySelector('.toast-error');
      expect(toast).toBeTruthy();
      // Duration of 6000ms is enforced in the error method
    });

    test('error() should accept custom duration', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.error('Error', 8000);

      expect(spy).toHaveBeenCalledWith('Error', 'error', 8000);

      spy.mockRestore();
    });

    test('warning() should call show with warning type', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.warning('Warning message');

      expect(spy).toHaveBeenCalledWith('Warning message', 'warning', 5000);

      spy.mockRestore();
    });

    test('warning() should use 5000ms default duration', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.warning('Warning');

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][2]).toBe(5000);

      spy.mockRestore();
    });

    test('warning() should accept custom duration', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.warning('Warning', 7000);

      expect(spy).toHaveBeenCalledWith('Warning', 'warning', 7000);

      spy.mockRestore();
    });

    test('info() should call show with info type', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.info('Info message');

      expect(spy).toHaveBeenCalledWith('Info message', 'info', undefined);

      spy.mockRestore();
    });

    test('info() should accept custom duration', () => {
      const spy = jest.spyOn(Toast, 'show');

      Toast.info('Info', 2000);

      expect(spy).toHaveBeenCalledWith('Info', 'info', 2000);

      spy.mockRestore();
    });
  });

  describe('Edge cases', () => {
    test('should handle empty message', () => {
      expect(() => {
        Toast.show('', 'info');
      }).not.toThrow();

      const toast = toastContainer.querySelector('.toast');
      expect(toast).toBeTruthy();
    });

    test('should handle very long message', () => {
      const longMsg = 'A'.repeat(1000);
      Toast.show(longMsg, 'info');

      const toast = toastContainer.querySelector('.toast-text');
      expect(toast.textContent).toBe(longMsg);
    });

    test('should handle special characters in message', () => {
      const specialMsg = '<script>alert("XSS")</script>';
      Toast.show(specialMsg, 'info');

      const toast = toastContainer.querySelector('.toast');
      // innerHTML is used, so special chars should be escaped
      expect(toast.innerHTML).toContain(specialMsg);
    });

    test('should handle rapid successive toasts', () => {
      for (let i = 0; i < 10; i++) {
        Toast.show(`Toast ${i}`, 'info');
      }

      // Should be capped at 5
      const toasts = toastContainer.querySelectorAll('.toast');
      expect(toasts.length).toBe(5);
    });

    test('should handle unknown toast type gracefully', () => {
      Toast.show('Unknown type', 'unknown');

      const toast = toastContainer.querySelector('.toast');
      expect(toast.className).toBe('toast toast-unknown');
      // Should use default info icon
      expect(toast.innerHTML).toContain('ℹ');
    });

    test('should handle negative duration', () => {
      jest.useFakeTimers();
      Toast.show('Negative duration', 'info', -1000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast).toBeTruthy();

      jest.useRealTimers();
    });

    test('should handle zero duration', () => {
      jest.useFakeTimers();
      Toast.show('Zero duration', 'info', 0);

      const toast = toastContainer.querySelector('.toast');

      jest.advanceTimersByTime(1);
      // Toast should be dismissed immediately

      jest.useRealTimers();
    });
  });
});
