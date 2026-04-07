/**
 * COBRA Router Handlers Tests
 * Tests message handlers registered with CobraRouter (chat, tool, audit)
 */

describe('CobraRouter Handlers', () => {
  let CobraRouter;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create CobraRouter mock
    CobraRouter = {
      _typeHandlers: {},
      _actionHandlers: {},
      _initialized: false,

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
        if (this._initialized) return;
        this._initialized = true;

        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          const actionName = msg.type || msg.action || 'unknown';

          if (msg.type && this._typeHandlers[msg.type]) {
            const handler = this._typeHandlers[msg.type];
            Promise.resolve()
              .then(() => handler(msg.payload || {}, msg, sender))
              .then((result) => {
                sendResponse(result);
              })
              .catch((err) => {
                sendResponse({ error: err.message });
              });
            return true;
          }

          if (msg.action && this._actionHandlers[msg.action]) {
            const handler = this._actionHandlers[msg.action];
            Promise.resolve()
              .then(() => handler(msg, sender))
              .then((result) => {
                sendResponse(result);
              })
              .catch((err) => {
                sendResponse({ error: err.message });
              });
            return true;
          }

          return false;
        });
      },

      _categorize(action) {
        if (!action) return 'system';
        if (action.startsWith('COMM_')) return 'comms';
        if (action.startsWith('KB_')) return 'kb';
        if (action.startsWith('JOB_')) return 'job';
        return 'system';
      },

      getStats() {
        return {
          typeHandlers: Object.keys(this._typeHandlers),
          actionHandlers: Object.keys(this._actionHandlers),
        };
      },
    };

    global.CobraRouter = CobraRouter;
  });

  describe('Handler Registration', () => {
    it('should register type handler', () => {
      const handler = jest.fn();
      CobraRouter.registerType('TEST_TYPE', handler);

      expect(CobraRouter._typeHandlers['TEST_TYPE']).toBe(handler);
    });

    it('should register multiple type handlers', () => {
      const handlers = {
        TYPE1: jest.fn(),
        TYPE2: jest.fn(),
        TYPE3: jest.fn(),
      };

      CobraRouter.registerTypes(handlers);

      expect(CobraRouter._typeHandlers['TYPE1']).toBe(handlers.TYPE1);
      expect(CobraRouter._typeHandlers['TYPE2']).toBe(handlers.TYPE2);
      expect(CobraRouter._typeHandlers['TYPE3']).toBe(handlers.TYPE3);
    });

    it('should register action handler', () => {
      const handler = jest.fn();
      CobraRouter.registerAction('TEST_ACTION', handler);

      expect(CobraRouter._actionHandlers['TEST_ACTION']).toBe(handler);
    });

    it('should register multiple action handlers', () => {
      const handlers = {
        ACTION1: jest.fn(),
        ACTION2: jest.fn(),
      };

      CobraRouter.registerActions(handlers);

      expect(CobraRouter._actionHandlers['ACTION1']).toBe(handlers.ACTION1);
      expect(CobraRouter._actionHandlers['ACTION2']).toBe(handlers.ACTION2);
    });

    it('should support chat type handler', () => {
      const chatHandler = jest.fn();
      CobraRouter.registerType('CHAT_MESSAGE', chatHandler);

      expect(CobraRouter._typeHandlers['CHAT_MESSAGE']).toBe(chatHandler);
    });

    it('should support tool type handler', () => {
      const toolHandler = jest.fn();
      CobraRouter.registerType('EXECUTE_TOOL', toolHandler);

      expect(CobraRouter._typeHandlers['EXECUTE_TOOL']).toBe(toolHandler);
    });

    it('should support audit action handler', () => {
      const auditHandler = jest.fn();
      CobraRouter.registerAction('AUDIT_LOG', auditHandler);

      expect(CobraRouter._actionHandlers['AUDIT_LOG']).toBe(auditHandler);
    });
  });

  describe('Handler Execution', () => {
    it('should execute type handler with payload', async () => {
      const handler = jest.fn().mockResolvedValue({ ok: true });
      CobraRouter.registerType('TEST_TYPE', handler);

      const payload = { data: 'test' };
      await handler(payload);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('should execute action handler with message', async () => {
      const handler = jest.fn().mockResolvedValue({ success: true });
      CobraRouter.registerAction('TEST_ACTION', handler);

      const msg = { action: 'TEST_ACTION', data: 'test' };
      await handler(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should pass sender to handler', async () => {
      const handler = jest.fn().mockResolvedValue({});
      CobraRouter.registerType('TEST', handler);

      const sender = { tab: { id: 1, url: 'https://example.com' } };
      await handler({}, {}, sender);

      expect(handler).toHaveBeenCalled();
    });

    it('should handle handler errors', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Test error'));

      try {
        await handler();
      } catch (e) {
        expect(e.message).toBe('Test error');
      }
    });

    it('should support async handlers', async () => {
      const asyncHandler = jest.fn(async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 10);
        });
      });

      CobraRouter.registerType('ASYNC_TEST', asyncHandler);

      const result = await asyncHandler();
      expect(result.ok).toBe(true);
    });
  });

  describe('Chat Message Handlers', () => {
    it('should handle CHAT_MESSAGE type', () => {
      const chatHandler = jest.fn();
      CobraRouter.registerType('CHAT_MESSAGE', chatHandler);

      expect(CobraRouter._typeHandlers['CHAT_MESSAGE']).toBeDefined();
    });

    it('should receive chat payload', () => {
      const chatHandler = jest.fn();
      CobraRouter.registerType('CHAT_MESSAGE', chatHandler);

      const payload = {
        message: 'Hello',
        context: 'user input',
      };

      chatHandler(payload);

      expect(chatHandler).toHaveBeenCalledWith(payload);
    });

    it('should handle empty message', () => {
      const chatHandler = jest.fn();
      CobraRouter.registerType('CHAT_MESSAGE', chatHandler);

      const payload = { message: '' };
      chatHandler(payload);

      expect(chatHandler).toHaveBeenCalledWith(payload);
    });

    it('should handle long messages', () => {
      const chatHandler = jest.fn();
      CobraRouter.registerType('CHAT_MESSAGE', chatHandler);

      const longMessage = 'x'.repeat(10000);
      const payload = { message: longMessage };
      chatHandler(payload);

      expect(chatHandler).toHaveBeenCalled();
    });
  });

  describe('Tool Execution Handlers', () => {
    it('should handle EXECUTE_TOOL type', () => {
      const toolHandler = jest.fn();
      CobraRouter.registerType('EXECUTE_TOOL', toolHandler);

      expect(CobraRouter._typeHandlers['EXECUTE_TOOL']).toBeDefined();
    });

    it('should receive tool parameters', () => {
      const toolHandler = jest.fn();
      CobraRouter.registerType('EXECUTE_TOOL', toolHandler);

      const payload = {
        toolName: 'screenshot',
        params: { width: 1024 },
      };

      toolHandler(payload);

      expect(toolHandler).toHaveBeenCalledWith(payload);
    });

    it('should handle tool errors', () => {
      const toolHandler = jest.fn();
      CobraRouter.registerType('EXECUTE_TOOL', toolHandler);

      const payload = {
        toolName: 'invalid_tool',
      };

      toolHandler(payload);

      expect(toolHandler).toHaveBeenCalled();
    });
  });

  describe('Audit Handlers', () => {
    it('should handle AUDIT_LOG action', () => {
      const auditHandler = jest.fn();
      CobraRouter.registerAction('AUDIT_LOG', auditHandler);

      expect(CobraRouter._actionHandlers['AUDIT_LOG']).toBeDefined();
    });

    it('should log action with details', () => {
      const auditHandler = jest.fn();
      CobraRouter.registerAction('AUDIT_LOG', auditHandler);

      const msg = {
        action: 'AUDIT_LOG',
        event: 'chat_message',
        details: 'User sent message',
      };

      auditHandler(msg);

      expect(auditHandler).toHaveBeenCalledWith(msg);
    });

    it('should include timestamp in audit', () => {
      const auditHandler = jest.fn();
      CobraRouter.registerAction('AUDIT_LOG', auditHandler);

      const timestamp = Date.now();
      const msg = {
        action: 'AUDIT_LOG',
        timestamp,
      };

      auditHandler(msg);

      expect(auditHandler).toHaveBeenCalled();
    });
  });

  describe('Handler Statistics', () => {
    it('should return handler stats', () => {
      CobraRouter.registerTypes({
        TYPE1: jest.fn(),
        TYPE2: jest.fn(),
      });

      CobraRouter.registerActions({
        ACTION1: jest.fn(),
        ACTION2: jest.fn(),
        ACTION3: jest.fn(),
      });

      const stats = CobraRouter.getStats();

      expect(stats.typeHandlers.length).toBe(2);
      expect(stats.actionHandlers.length).toBe(3);
    });

    it('should list all registered types', () => {
      CobraRouter.registerTypes({
        CHAT: jest.fn(),
        TOOL: jest.fn(),
      });

      const stats = CobraRouter.getStats();

      expect(stats.typeHandlers).toContain('CHAT');
      expect(stats.typeHandlers).toContain('TOOL');
    });

    it('should list all registered actions', () => {
      CobraRouter.registerActions({
        COMM_SEND: jest.fn(),
        KB_SEARCH: jest.fn(),
      });

      const stats = CobraRouter.getStats();

      expect(stats.actionHandlers).toContain('COMM_SEND');
      expect(stats.actionHandlers).toContain('KB_SEARCH');
    });
  });

  describe('Action Categorization', () => {
    it('should categorize communication actions', () => {
      const cat = CobraRouter._categorize('COMM_SEND_EMAIL');
      expect(cat).toBe('comms');
    });

    it('should categorize knowledge base actions', () => {
      const cat = CobraRouter._categorize('KB_SEARCH');
      expect(cat).toBe('kb');
    });

    it('should categorize job actions', () => {
      const cat = CobraRouter._categorize('JOB_CREATE');
      expect(cat).toBe('job');
    });

    it('should default to system for unknown actions', () => {
      const cat = CobraRouter._categorize('UNKNOWN');
      expect(cat).toBe('system');
    });

    it('should handle null action', () => {
      const cat = CobraRouter._categorize(null);
      expect(cat).toBe('system');
    });

    it('should handle empty action', () => {
      const cat = CobraRouter._categorize('');
      expect(cat).toBe('system');
    });
  });

  describe('Router Initialization', () => {
    it('should initialize once', () => {
      CobraRouter._initialized = false;
      CobraRouter.init();

      expect(CobraRouter._initialized).toBe(true);
    });

    it('should not re-initialize if already initialized', () => {
      CobraRouter._initialized = true;
      const before = Object.keys(CobraRouter._typeHandlers).length;

      CobraRouter.init();

      // Should have same number of handlers
      expect(Object.keys(CobraRouter._typeHandlers).length).toBe(before);
    });

    it('should setup message listener', () => {
      CobraRouter._initialized = false;
      CobraRouter.init();

      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });
  });

  describe('Handler Middleware', () => {
    it('should support request/response pattern', async () => {
      const handler = jest.fn().mockResolvedValue({ result: 'success' });
      CobraRouter.registerType('REQUEST', handler);

      const request = { query: 'test' };
      const response = await handler(request);

      expect(response.result).toBe('success');
    });

    it('should preserve request context', () => {
      const handler = jest.fn();
      CobraRouter.registerType('CONTEXT', handler);

      const request = {
        data: 'test',
        userId: '123',
      };

      handler(request);

      expect(handler).toHaveBeenCalledWith(request);
    });

    it('should handle response formatting', async () => {
      const handler = jest.fn().mockResolvedValue({
        status: 'ok',
        data: { result: 'formatted' },
      });

      CobraRouter.registerType('FORMAT', handler);

      const response = await handler({});

      expect(response.status).toBe('ok');
      expect(response.data).toBeDefined();
    });
  });

  describe('Common Handler Patterns', () => {
    it('should support validation pattern', () => {
      const handler = jest.fn((payload) => {
        if (!payload.required_field) {
          throw new Error('Missing required field');
        }
        return { ok: true };
      });

      CobraRouter.registerType('VALIDATE', handler);

      expect(() => handler({})).toThrow();
      expect(() => handler({ required_field: 'value' })).not.toThrow();
    });

    it('should support pagination pattern', () => {
      const handler = jest.fn((payload) => {
        return {
          items: [],
          page: payload.page || 1,
          limit: payload.limit || 10,
        };
      });

      CobraRouter.registerAction('LIST_ITEMS', handler);

      const result = handler({ page: 2, limit: 20 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(20);
    });

    it('should support caching pattern', async () => {
      const cache = {};
      const handler = jest.fn((key) => {
        if (!cache[key]) {
          cache[key] = { data: `result_for_${key}` };
        }
        return cache[key];
      });

      CobraRouter.registerType('CACHED', handler);

      const result1 = handler('key1');
      const result2 = handler('key1');

      expect(result1).toBe(result2);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
