/**
 * COBRA v5.2 — Tool Safety Layer (Preview + Undo)
 * Provides pre-execution preview for risky tools and undo capability.
 * Integrates with TOOL_RISK_MAP from tool-registry.js
 */

const ToolSafety = {
  // ── Safety tier lists ──
  WARN_ACTIONS: new Set([
    'send_message', 'send_email', 'create_event', 'write_file',
    'fill_form', 'click_element', 'execute_js'
  ]),

  BLOCKED_ACTIONS: new Set([
    'delete_file', 'drop_table', 'exec_shell', 'delete_database',
    'format_disk', 'uninstall_app', 'delete_folder_recursive'
  ]),

  // Undo stack: last N tool executions with state snapshots
  _undoStack: [],
  _maxUndoSize: 10,
  // Pending preview awaiting user confirmation
  _pendingPreview: null,
  // Pending warn confirmation (3s timeout)
  _pendingWarn: null,
  _warnTimeout: 3000,

  // ============================================================
  // SAFETY CLASSIFICATION (ternary)
  // ============================================================

  /**
   * Classify tool safety into 3 tiers: 'safe', 'warn', 'blocked'
   */
  classify(toolName, args = {}) {
    if (this.BLOCKED_ACTIONS.has(toolName)) {
      return 'blocked';
    }
    if (this.WARN_ACTIONS.has(toolName)) {
      return 'warn';
    }
    return 'safe';
  },

  /**
   * Check if tool needs warning confirmation (3s window)
   */
  needsWarnConfirm(toolName) {
    return this.classify(toolName) === 'warn';
  },

  /**
   * Set pending warn (awaiting user confirmation before 3s timeout)
   */
  setPendingWarn(toolName, args, preview) {
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

  /**
   * Consume pending warn confirmation
   */
  consumePendingWarn() {
    const warn = this._pendingWarn;
    if (warn?.timerId) clearTimeout(warn.timerId);
    this._pendingWarn = null;
    return warn;
  },

  // ============================================================
  // PRE-EXECUTION PREVIEW
  // ============================================================

  /**
   * Generate a human-readable preview of what a tool will do
   * Returns { action, description, risk, requiresConfirmation }
   */
  generatePreview(toolName, args) {
    const classification = this.classify(toolName, args);
    const risk = (self.TOOL_RISK_MAP && self.TOOL_RISK_MAP[toolName]) || (classification === 'blocked' ? 'destructive' : 'safe');

    const previews = {
      navigate: () => ({
        action: 'Navigate',
        description: `Aprirà la pagina: ${args.url}`,
        risk,
        requiresConfirmation: false,
      }),
      click_element: () => ({
        action: 'Click',
        description: `Cliccherà sull'elemento: ${args.selector}`,
        risk,
        requiresConfirmation: risk === 'risky',
      }),
      fill_form: () => {
        const fieldCount = typeof args.fields === 'object' ? Object.keys(args.fields).length : 0;
        return {
          action: 'Fill Form',
          description: `Compilerà ${fieldCount} campi nel form`,
          risk,
          requiresConfirmation: true,
          details: typeof args.fields === 'object'
            ? Object.keys(args.fields).map(k => `${k}: ${String(args.fields[k]).slice(0, 30)}`)
            : [],
        };
      },
      execute_js: () => ({
        action: 'Execute JavaScript',
        description: `Eseguirà codice JS (${(args.code || '').length} chars)`,
        risk: 'destructive',
        requiresConfirmation: true,
        details: [(args.code || '').slice(0, 200)],
      }),
      google_search: () => ({
        action: 'Google Search',
        description: `Cercherà: "${args.query}"`,
        risk: 'safe',
        requiresConfirmation: false,
      }),
      scrape_url: () => ({
        action: 'Scrape',
        description: `Estrarrà contenuto da: ${args.url}`,
        risk: 'safe',
        requiresConfirmation: false,
      }),
      scroll_page: () => ({
        action: 'Scroll',
        description: `Scorrerà la pagina ${args.direction || 'down'}`,
        risk: 'safe',
        requiresConfirmation: false,
      }),
      take_screenshot: () => ({
        action: 'Screenshot',
        description: 'Catturerà uno screenshot della pagina corrente',
        risk: 'safe',
        requiresConfirmation: false,
      }),
    };

    const previewFn = previews[toolName];
    if (previewFn) return previewFn();

    return {
      action: toolName,
      description: `Eseguirà tool: ${toolName}`,
      risk,
      requiresConfirmation: risk === 'destructive',
    };
  },

  /**
   * Check if a tool execution needs user confirmation
   * (for backward compatibility, maps to 'warn' or 'blocked' classification)
   */
  needsConfirmation(toolName) {
    const classification = this.classify(toolName);
    return classification === 'warn' || classification === 'blocked';
  },

  /**
   * Set pending preview (awaiting user confirmation)
   */
  setPendingPreview(toolName, args, preview) {
    this._pendingPreview = {
      toolName,
      args,
      preview,
      timestamp: Date.now(),
    };
    return this._pendingPreview;
  },

  /**
   * Get and clear pending preview
   */
  consumePendingPreview() {
    const pending = this._pendingPreview;
    this._pendingPreview = null;
    return pending;
  },

  // ============================================================
  // UNDO CAPABILITY
  // ============================================================

  /**
   * Capture state before tool execution (for undo)
   */
  async capturePreState(toolName, args) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;

      const state = {
        toolName,
        args,
        timestamp: Date.now(),
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
      };

      // For navigation tools, just store the URL to go back to
      if (['navigate', 'google_search'].includes(toolName)) {
        state.undoAction = 'navigate_back';
        state.previousUrl = tab.url;
      }

      // For form fills, capture current field values
      if (toolName === 'fill_form' && typeof args.fields === 'object') {
        try {
          const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (selectors) => {
              const values = {};
              for (const key of selectors) {
                const el = document.querySelector(`[name="${key}"], #${key}, [data-field="${key}"]`);
                if (el) values[key] = el.value || el.textContent || '';
              }
              return values;
            },
            args: [Object.keys(args.fields)],
          });
          state.previousValues = result?.[0]?.result || {};
          state.undoAction = 'restore_form';
        } catch {}
      }

      // For click, we can't really undo but we log it
      if (toolName === 'click_element') {
        state.undoAction = 'navigate_back'; // best effort: go back
      }

      // Push to undo stack
      this._undoStack.push(state);
      if (this._undoStack.length > this._maxUndoSize) {
        this._undoStack.shift();
      }

      return state;
    } catch (e) {
      console.warn('[ToolSafety] capturePreState failed:', e.message);
      return null;
    }
  },

  /**
   * Undo the last tool execution
   */
  async undo() {
    const state = this._undoStack.pop();
    if (!state) return { ok: false, error: 'Nothing to undo' };

    try {
      switch (state.undoAction) {
        case 'navigate_back':
          if (state.previousUrl) {
            await chrome.tabs.update(state.tabId, { url: state.previousUrl });
            return { ok: true, action: 'Navigated back', url: state.previousUrl };
          }
          // Fallback: browser back
          await chrome.tabs.goBack(state.tabId);
          return { ok: true, action: 'Browser back' };

        case 'restore_form':
          if (state.previousValues && Object.keys(state.previousValues).length > 0) {
            await chrome.scripting.executeScript({
              target: { tabId: state.tabId },
              func: (values) => {
                for (const [key, val] of Object.entries(values)) {
                  const el = document.querySelector(`[name="${key}"], #${key}, [data-field="${key}"]`);
                  if (el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
              },
              args: [state.previousValues],
            });
            return { ok: true, action: 'Form values restored' };
          }
          return { ok: false, error: 'No form values to restore' };

        default:
          return { ok: false, error: `No undo action for: ${state.undoAction || state.toolName}` };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  /**
   * Get undo stack info
   */
  getUndoStack() {
    return this._undoStack.map(s => ({
      toolName: s.toolName,
      undoAction: s.undoAction,
      timestamp: s.timestamp,
      url: s.url,
    }));
  },

  /**
   * Check if undo is available
   */
  canUndo() {
    return this._undoStack.length > 0;
  },
};

// Export
self.ToolSafety = ToolSafety;
console.log('[tool-safety.js] Loaded: ToolSafety (preview + undo)');