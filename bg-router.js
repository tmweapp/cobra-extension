// COBRA v5.2 — Central Message Router
// Single point of message dispatch with error isolation per handler

const CobraRouter = {
  _typeHandlers: {},    // msg.type handlers (COBRA protocol)
  _actionHandlers: {},  // msg.action handlers (legacy protocol)
  _initialized: false,  // Guard against double initialization

  registerType(type, handler) {
    this._typeHandlers[type] = handler;
  },

  registerTypes(map) {
    Object.entries(map).forEach(([type, handler]) => {
      this._typeHandlers[type] = handler;
    });
  },

  registerAction(action, handler) {
    this._actionHandlers[action] = handler;
  },

  registerActions(map) {
    Object.entries(map).forEach(([action, handler]) => {
      this._actionHandlers[action] = handler;
    });
  },

  init() {
    // Guard against double initialization
    if (this._initialized) {
      console.warn('[CobraRouter] init() called multiple times, ignoring');
      return;
    }
    this._initialized = true;

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // Type-based handlers (COBRA protocol) take priority
      if (msg.type && this._typeHandlers[msg.type]) {
        const handler = this._typeHandlers[msg.type];
        Promise.resolve()
          .then(() => handler(msg.payload || {}, msg, sender))
          .then(result => sendResponse(result))
          .catch(err => {
            console.error(`[CobraRouter] Error in type handler '${msg.type}':`, err);
            sendResponse({ error: err.message, code: err.code || 'HANDLER_ERROR' });
          });
        return true; // Keep sendResponse channel open
      }

      // Action-based handlers (legacy protocol)
      if (msg.action && this._actionHandlers[msg.action]) {
        const handler = this._actionHandlers[msg.action];
        Promise.resolve()
          .then(() => handler(msg, sender))
          .then(result => sendResponse(result))
          .catch(err => {
            console.error(`[CobraRouter] Error in action handler '${msg.action}':`, err);
            sendResponse({ error: err.message, code: err.code || 'HANDLER_ERROR' });
          });
        return true;
      }

      // Unknown message type or action — log warning and return error
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

      // No type or action found
      return false;
    });

    console.log('[CobraRouter] Initialized with',
      Object.keys(this._typeHandlers).length, 'type handlers,',
      Object.keys(this._actionHandlers).length, 'action handlers');
  },

  getStats() {
    return {
      typeHandlers: Object.keys(this._typeHandlers),
      actionHandlers: Object.keys(this._actionHandlers),
    };
  }
};

self.CobraRouter = CobraRouter;
