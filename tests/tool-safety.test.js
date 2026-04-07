require('./setup');
require('../tool-safety');

const ToolSafety = global.ToolSafety;

beforeEach(() => {
  ToolSafety._undoStack = [];
  ToolSafety._pendingPreview = null;
  // Mock TOOL_RISK_MAP
  global.TOOL_RISK_MAP = {
    navigate: 'safe',
    click_element: 'risky',
    fill_form: 'risky',
    execute_js: 'destructive',
    google_search: 'safe',
    scrape_url: 'safe',
  };
});

describe('ToolSafety', () => {
  describe('generatePreview()', () => {
    test('generates preview for navigate', () => {
      const p = ToolSafety.generatePreview('navigate', { url: 'https://example.com' });
      expect(p.action).toBe('Navigate');
      expect(p.description).toContain('example.com');
      expect(p.requiresConfirmation).toBe(false);
    });

    test('generates preview for click_element', () => {
      const p = ToolSafety.generatePreview('click_element', { selector: '#submit' });
      expect(p.action).toBe('Click');
      expect(p.description).toContain('#submit');
    });

    test('generates preview for fill_form with field count', () => {
      const p = ToolSafety.generatePreview('fill_form', {
        fields: { name: 'John', email: 'john@test.com' },
      });
      expect(p.action).toBe('Fill Form');
      expect(p.description).toContain('2 campi');
      expect(p.requiresConfirmation).toBe(true);
      expect(p.details.length).toBe(2);
    });

    test('generates preview for execute_js as destructive', () => {
      const p = ToolSafety.generatePreview('execute_js', { code: 'document.title = "test"' });
      expect(p.risk).toBe('destructive');
      expect(p.requiresConfirmation).toBe(true);
    });

    test('generates preview for google_search', () => {
      const p = ToolSafety.generatePreview('google_search', { query: 'test query' });
      expect(p.action).toBe('Google Search');
      expect(p.risk).toBe('safe');
    });

    test('generates generic preview for unknown tools', () => {
      const p = ToolSafety.generatePreview('unknown_tool', {});
      expect(p.action).toBe('unknown_tool');
      expect(p.description).toContain('unknown_tool');
    });
  });

  describe('needsConfirmation()', () => {
    test('returns true for destructive tools', () => {
      expect(ToolSafety.needsConfirmation('execute_js')).toBe(true);
    });

    test('returns false for safe tools', () => {
      expect(ToolSafety.needsConfirmation('navigate')).toBe(false);
      expect(ToolSafety.needsConfirmation('google_search')).toBe(false);
    });

    test('returns false for unknown tools (default safe)', () => {
      expect(ToolSafety.needsConfirmation('brand_new_tool')).toBe(false);
    });
  });

  describe('Pending Preview', () => {
    test('setPendingPreview stores preview', () => {
      const preview = { action: 'Test', description: 'test' };
      ToolSafety.setPendingPreview('navigate', { url: 'test' }, preview);
      expect(ToolSafety._pendingPreview).not.toBeNull();
      expect(ToolSafety._pendingPreview.toolName).toBe('navigate');
    });

    test('consumePendingPreview returns and clears', () => {
      ToolSafety.setPendingPreview('navigate', {}, {});
      const pending = ToolSafety.consumePendingPreview();
      expect(pending).not.toBeNull();
      expect(ToolSafety._pendingPreview).toBeNull();
    });

    test('consumePendingPreview returns null when empty', () => {
      expect(ToolSafety.consumePendingPreview()).toBeNull();
    });
  });

  describe('Undo Stack', () => {
    test('canUndo returns false when stack is empty', () => {
      expect(ToolSafety.canUndo()).toBe(false);
    });

    test('capturePreState adds to undo stack', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com', title: 'Test' }]);
      await ToolSafety.capturePreState('navigate', { url: 'https://new.com' });
      expect(ToolSafety.canUndo()).toBe(true);
      expect(ToolSafety._undoStack.length).toBe(1);
    });

    test('undo stack respects max size', async () => {
      for (let i = 0; i < 15; i++) {
        chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: `https://page${i}.com`, title: 'T' }]);
        await ToolSafety.capturePreState('navigate', { url: `https://page${i + 1}.com` });
      }
      expect(ToolSafety._undoStack.length).toBe(ToolSafety._maxUndoSize);
    });

    test('getUndoStack returns summary info', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://a.com', title: 'A' }]);
      await ToolSafety.capturePreState('navigate', { url: 'https://b.com' });

      const stack = ToolSafety.getUndoStack();
      expect(stack.length).toBe(1);
      expect(stack[0].toolName).toBe('navigate');
      expect(stack[0].undoAction).toBe('navigate_back');
    });

    test('undo returns error when stack is empty', async () => {
      const result = await ToolSafety.undo();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Nothing to undo');
    });
  });
});
