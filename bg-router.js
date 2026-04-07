// COBRA v5.2 — Central Message Router
// Single point of message dispatch with error isolation per handler
// Now with: contract validation, audit logging, guard integration

/**
 * @module CobraRouter
 * @description Central message router for COBRA extension.
 * Single point of message dispatch with contract validation, audit logging, and guard integration.
 * Supports two protocols: type-based (COBRA) and action-based (legacy).
 */
const CobraRouter = {
  /** @type {Object<string, Function>} msg.type → handler map */
  _typeHandlers: {},
  /** @type {Object<string, Function>} msg.action → handler map */
  _actionHandlers: {},
  /** @type {boolean} Guard against double initialization */
  _initialized: false,

  /**
   * Register a single type handler.
   * @param {string} type - Message type (e.g. 'CHAT_MESSAGE')
   * @param {Function} handler - Async handler (payload, msg, sender) → result
   */
  registerType(type, handler) {
    this._typeHandlers[type] = handler;
  },

  /** @param {Object<string, Function>} map - {type: handler} pairs */
  registerTypes(map) {
    Object.entries(map).forEach(([type, handler]) => {
      this._typeHandlers[type] = handler;
    });
  },

  /**
   * Register a single action handler.
   * @param {string} action - Action name (e.g. 'COMM_SEND_EMAIL')
   * @param {Function} handler - Async handler (msg, sender) → result
   */
  registerAction(action, handler) {
    this._actionHandlers[action] = handler;
  },

  registerActions(map) {
    Object.entries(map).forEach(([action, handler]) => {
      this._actionHandlers[action] = handler;
    });
  },

  /**
   * Initialize the router. Sets up chrome.runtime.onMessage listener.
   * Idempotent — second call is ignored.
   * Flow: contract validation → handler dispatch → audit log
   */
  init() {
    if (this._initialized) {
      console.warn('[CobraRouter] init() called multiple times, ignoring');
      return;
    }
    this._initialized = true;

    // Init audit log
    if (self.CobraAudit) {
      self.CobraAudit.init().catch(e => console.warn('[CobraRouter] Audit init error:', e));
      self.CobraAudit.logSystem('ROUTER_INIT', 'Router initialized');
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      const actionName = msg.type || msg.action || 'unknown';
      const tabUrl = sender?.tab?.url || '';
      const startTs = Date.now();

      // ── 1. Contract validation ──
      if (self.CobraContracts) {
        const v = self.CobraContracts.validateMessage(msg);
        if (!v.ok) {
          console.warn(`[CobraRouter] Contract rejected:`, v.error);
          if (self.CobraAudit) self.CobraAudit.log({ action: actionName, category: 'guard', hostname: '', result: 'blocked', details: v.error });
          sendResponse({ error: v.error, code: v.code || 'CONTRACT_VIOLATION' });
          return false;
        }
      }

      // ── 2. Type-based handlers (COBRA protocol) ──
      if (msg.type && this._typeHandlers[msg.type]) {
        const handler = this._typeHandlers[msg.type];
        Promise.resolve()
          .then(() => handler(msg.payload || {}, msg, sender))
          .then(result => {
            if (self.CobraAudit) self.CobraAudit.log({ action: msg.type, category: 'chat', hostname: tabUrl, result: 'ok', durationMs: Date.now() - startTs });
            sendResponse(result);
          })
          .catch(err => {
            console.error(`[CobraRouter] Error in type handler '${msg.type}':`, err);
            if (self.CobraAudit) self.CobraAudit.log({ action: msg.type, category: 'chat', hostname: tabUrl, result: 'fail', details: err.message, durationMs: Date.now() - startTs });
            sendResponse({ error: err.message, code: err.code || 'HANDLER_ERROR' });
          });
        return true;
      }

      // ── 3. Action-based handlers (legacy protocol) ──
      if (msg.action && this._actionHandlers[msg.action]) {
        const handler = this._actionHandlers[msg.action];
        Promise.resolve()
          .then(() => handler(msg, sender))
          .then(result => {
            if (self.CobraAudit) self.CobraAudit.log({ action: msg.action, category: this._categorize(msg.action), hostname: tabUrl, result: 'ok', durationMs: Date.now() - startTs });
            sendResponse(result);
          })
          .catch(err => {
            console.error(`[CobraRouter] Error in action handler '${msg.action}':`, err);
            if (self.CobraAudit) self.CobraAudit.log({ action: msg.action, category: this._categorize(msg.action), hostname: tabUrl, result: 'fail', details: err.message, durationMs: Date.now() - startTs });
            sendResponse({ error: err.message, code: err.code || 'HANDLER_ERROR' });
          });
        return true;
      }

      // ── 4. Unknown ──
      if (msg.type) {
        console.warn(`[CobraRouter] Unknown message type: '${msg.type}'`);
        sendResponse({ error: 'Unknown message type: ' + msg.type, code: 'UNKNOWN_TYPE' });
        return false;
      }
      if (msg.action) {
        console.warn(`[CobraRouter] Unknown action: '${msg.action}'`);
        sendResponse({ error: 'Unknown action: ' + msg.action, code: 'UNKNOWN_ACTION' });
        return false;
      }
      return false;
    });

    console.log('[CobraRouter] Initialized with',
      Object.keys(this._typeHandlers).length, 'type handlers,',
      Object.keys(this._actionHandlers).length, 'action handlers');
  },

  // Auto-categorize actions for audit
  _categorize(action) {
    if (!action) return 'system';
    if (action.startsWith('COMM_')) return 'comms';
    if (action.startsWith('KB_')) return 'kb';
    if (action.startsWith('JOB_') || action.startsWith('PJOB_')) return 'job';
    if (action.startsWith('FILE_')) return 'tool';
    if (action.startsWith('GUARD_')) return 'guard';
    if (action.startsWith('POLICY_')) return 'policy';
    if (action.startsWith('AUDIT_')) return 'system';
    if (action.startsWith('SELECTOR_')) return 'tool';
    return 'system';
  },

  getStats() {
    return {
      typeHandlers: Object.keys(this._typeHandlers),
      actionHandlers: Object.keys(this._actionHandlers),
    };
  }
};

self.CobraRouter = CobraRouter;
