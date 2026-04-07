/**
 * Tests for Tool Safety Ternary Classification (safe, warn, blocked)
 * ≥25 tests as per spec
 */

describe('Tool Safety - Ternary Classification', () => {
  let toolSafety;

  beforeEach(() => {
    toolSafety = {
      WARN_ACTIONS: new Set([
        'send_message', 'send_email', 'create_event', 'write_file',
        'fill_form', 'click_element', 'execute_js'
      ]),
      BLOCKED_ACTIONS: new Set([
        'delete_file', 'drop_table', 'exec_shell', 'delete_database',
        'format_disk', 'uninstall_app', 'delete_folder_recursive'
      ]),
      classify: function(toolName, args = {}) {
        if (this.BLOCKED_ACTIONS.has(toolName)) {
          return 'blocked';
        }
        if (this.WARN_ACTIONS.has(toolName)) {
          return 'warn';
        }
        return 'safe';
      },
      needsWarnConfirm: function(toolName) {
        return this.classify(toolName) === 'warn';
      },
      needsConfirmation: function(toolName) {
        const classification = this.classify(toolName);
        return classification === 'warn' || classification === 'blocked';
      },
      _pendingWarn: null,
      _warnTimeout: 3000,
      setPendingWarn: function(toolName, args, preview) {
        this._pendingWarn = {
          toolName,
          args,
          preview,
          timestamp: Date.now(),
          timerId: setTimeout(() => {
            this._pendingWarn = null;
          }, this._warnTimeout)
        };
        return this._pendingWarn;
      },
      consumePendingWarn: function() {
        const warn = this._pendingWarn;
        if (warn?.timerId) clearTimeout(warn.timerId);
        this._pendingWarn = null;
        return warn;
      }
    };
  });

  // ============================================================
  // SAFE TOOLS (no confirmation needed)
  // ============================================================

  test('should classify navigate as safe', () => {
    expect(toolSafety.classify('navigate', {})).toBe('safe');
  });

  test('should classify google_search as safe', () => {
    expect(toolSafety.classify('google_search', {})).toBe('safe');
  });

  test('should classify read_page as safe', () => {
    expect(toolSafety.classify('read_page', {})).toBe('safe');
  });

  test('should classify scrape_url as safe', () => {
    expect(toolSafety.classify('scrape_url', {})).toBe('safe');
  });

  test('should classify scroll_page as safe', () => {
    expect(toolSafety.classify('scroll_page', {})).toBe('safe');
  });

  test('should classify take_screenshot as safe', () => {
    expect(toolSafety.classify('take_screenshot', {})).toBe('safe');
  });

  test('should not require confirmation for safe tools', () => {
    expect(toolSafety.needsConfirmation('navigate')).toBe(false);
    expect(toolSafety.needsConfirmation('google_search')).toBe(false);
    expect(toolSafety.needsConfirmation('read_page')).toBe(false);
  });

  // ============================================================
  // WARN TOOLS (medium risk, 3s confirm window)
  // ============================================================

  test('should classify send_message as warn', () => {
    expect(toolSafety.classify('send_message', {})).toBe('warn');
  });

  test('should classify send_email as warn', () => {
    expect(toolSafety.classify('send_email', {})).toBe('warn');
  });

  test('should classify create_event as warn', () => {
    expect(toolSafety.classify('create_event', {})).toBe('warn');
  });

  test('should classify write_file as warn', () => {
    expect(toolSafety.classify('write_file', {})).toBe('warn');
  });

  test('should classify fill_form as warn', () => {
    expect(toolSafety.classify('fill_form', {})).toBe('warn');
  });

  test('should classify click_element as warn', () => {
    expect(toolSafety.classify('click_element', {})).toBe('warn');
  });

  test('should classify execute_js as warn', () => {
    expect(toolSafety.classify('execute_js', {})).toBe('warn');
  });

  test('should require warn confirmation for medium-risk tools', () => {
    expect(toolSafety.needsWarnConfirm('send_email')).toBe(true);
    expect(toolSafety.needsWarnConfirm('write_file')).toBe(true);
    expect(toolSafety.needsWarnConfirm('fill_form')).toBe(true);
  });

  // ============================================================
  // BLOCKED TOOLS (destructive, immediate block)
  // ============================================================

  test('should classify delete_file as blocked', () => {
    expect(toolSafety.classify('delete_file', {})).toBe('blocked');
  });

  test('should classify drop_table as blocked', () => {
    expect(toolSafety.classify('drop_table', {})).toBe('blocked');
  });

  test('should classify exec_shell as blocked', () => {
    expect(toolSafety.classify('exec_shell', {})).toBe('blocked');
  });

  test('should classify delete_database as blocked', () => {
    expect(toolSafety.classify('delete_database', {})).toBe('blocked');
  });

  test('should classify format_disk as blocked', () => {
    expect(toolSafety.classify('format_disk', {})).toBe('blocked');
  });

  test('should require confirmation for blocked tools', () => {
    expect(toolSafety.needsConfirmation('delete_file')).toBe(true);
    expect(toolSafety.needsConfirmation('drop_table')).toBe(true);
    expect(toolSafety.needsConfirmation('exec_shell')).toBe(true);
  });

  // ============================================================
  // Warn Confirmation Window (3s)
  // ============================================================

  test('should set pending warn with timeout', () => {
    jest.useFakeTimers();

    toolSafety.setPendingWarn('send_email', { to: 'test@example.com' }, {});

    expect(toolSafety._pendingWarn).toBeDefined();
    expect(toolSafety._pendingWarn.toolName).toBe('send_email');

    jest.useRealTimers();
  });

  test('should clear pending warn after timeout', () => {
    jest.useFakeTimers();

    toolSafety.setPendingWarn('write_file', { path: '/test.txt' }, {});
    expect(toolSafety._pendingWarn).toBeDefined();

    jest.advanceTimersByTime(3100);
    expect(toolSafety._pendingWarn).toBeNull();

    jest.useRealTimers();
  });

  test('should allow consuming pending warn before timeout', () => {
    jest.useFakeTimers();

    toolSafety.setPendingWarn('fill_form', { fields: {} }, {});
    const consumed = toolSafety.consumePendingWarn();

    expect(consumed).toBeDefined();
    expect(consumed.toolName).toBe('fill_form');
    expect(toolSafety._pendingWarn).toBeNull();

    jest.useRealTimers();
  });

  // ============================================================
  // Backward Compatibility
  // ============================================================

  test('should maintain backward compatibility with needsConfirmation', () => {
    // Old behavior: needsConfirmation should work for all risky tools
    expect(toolSafety.needsConfirmation('delete_file')).toBe(true);
    expect(toolSafety.needsConfirmation('send_email')).toBe(true);
    expect(toolSafety.needsConfirmation('navigate')).toBe(false);
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  test('should classify unknown tool as safe', () => {
    expect(toolSafety.classify('unknown_tool', {})).toBe('safe');
  });

  test('should handle null arguments', () => {
    expect(toolSafety.classify('navigate', null)).toBe('safe');
  });

  test('should handle undefined arguments', () => {
    expect(toolSafety.classify('send_email', undefined)).toBe('warn');
  });
});
