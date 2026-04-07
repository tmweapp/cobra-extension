// Comprehensive Jest tests for bg-router.js
// Tests message routing, handler registration, contract validation, audit logging, and error handling

describe('CobraRouter', () => {
  let CobraRouter;
  let sendResponse;
  let messageListener;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    jest.resetModules();

    // Mock CobraAudit before loading the module
    global.self.CobraAudit = {
      init: jest.fn(() => Promise.resolve()),
      log: jest.fn(),
      logSystem: jest.fn(),
    };

    // Mock CobraContracts before loading the module
    global.self.CobraContracts = {
      validateMessage: jest.fn(msg => ({ ok: true })),
    };

    // Reset chrome mocks
    global.chrome.runtime.onMessage.addListener.mockClear();

    // Load the module - this will register self.CobraRouter
    require('../bg-router.js');
    CobraRouter = global.self.CobraRouter;

    // Mock sendResponse function used in message listener
    sendResponse = jest.fn();

    // Capture the message listener when init() is called
    messageListener = null;
    global.chrome.runtime.onMessage.addListener.mockImplementation((listener) => {
      messageListener = listener;
    });
  });

  // =====================================================================
  // 1. registerType / registerTypes — registers handlers correctly
  // =====================================================================

  describe('registerType', () => {
    it('should register a single type handler', () => {
      const handler = jest.fn();
      CobraRouter.registerType('TEST_TYPE', handler);

      expect(CobraRouter._typeHandlers['TEST_TYPE']).toBe(handler);
    });

    it('should overwrite an existing type handler', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      CobraRouter.registerType('TEST_TYPE', handler1);
      CobraRouter.registerType('TEST_TYPE', handler2);

      expect(CobraRouter._typeHandlers['TEST_TYPE']).toBe(handler2);
    });
  });

  describe('registerTypes', () => {
    it('should register multiple type handlers from a map', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      CobraRouter.registerTypes({
        TYPE_A: handler1,
        TYPE_B: handler2,
        TYPE_C: handler3,
      });

      expect(CobraRouter._typeHandlers['TYPE_A']).toBe(handler1);
      expect(CobraRouter._typeHandlers['TYPE_B']).toBe(handler2);
      expect(CobraRouter._typeHandlers['TYPE_C']).toBe(handler3);
    });

    it('should handle empty map gracefully', () => {
      CobraRouter.registerTypes({});
      expect(Object.keys(CobraRouter._typeHandlers)).toHaveLength(0);
    });

    it('should overwrite existing handlers when re-registering types', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      CobraRouter.registerTypes({ TYPE_A: handler1 });
      CobraRouter.registerTypes({ TYPE_A: handler2 });

      expect(CobraRouter._typeHandlers['TYPE_A']).toBe(handler2);
    });
  });

  // =====================================================================
  // 2. registerAction / registerActions — registers handlers correctly
  // =====================================================================

  describe('registerAction', () => {
    it('should register a single action handler', () => {
      const handler = jest.fn();
      CobraRouter.registerAction('TEST_ACTION', handler);

      expect(CobraRouter._actionHandlers['TEST_ACTION']).toBe(handler);
    });

    it('should overwrite an existing action handler', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      CobraRouter.registerAction('TEST_ACTION', handler1);
      CobraRouter.registerAction('TEST_ACTION', handler2);

      expect(CobraRouter._actionHandlers['TEST_ACTION']).toBe(handler2);
    });
  });

  describe('registerActions', () => {
    it('should register multiple action handlers from a map', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      CobraRouter.registerActions({
        ACTION_A: handler1,
        ACTION_B: handler2,
        ACTION_C: handler3,
      });

      expect(CobraRouter._actionHandlers['ACTION_A']).toBe(handler1);
      expect(CobraRouter._actionHandlers['ACTION_B']).toBe(handler2);
      expect(CobraRouter._actionHandlers['ACTION_C']).toBe(handler3);
    });

    it('should handle empty map gracefully', () => {
      CobraRouter.registerActions({});
      expect(Object.keys(CobraRouter._actionHandlers)).toHaveLength(0);
    });

    it('should overwrite existing handlers when re-registering actions', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      CobraRouter.registerActions({ ACTION_A: handler1 });
      CobraRouter.registerActions({ ACTION_A: handler2 });

      expect(CobraRouter._actionHandlers['ACTION_A']).toBe(handler2);
    });
  });

  // =====================================================================
  // 3. init() — sets _initialized, calls CobraAudit.init, adds chrome listener
  // =====================================================================

  describe('init()', () => {
    beforeEach(() => {
      // Reset _initialized flag
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
    });

    it('should set _initialized to true', () => {
      expect(CobraRouter._initialized).toBe(false);
      CobraRouter.init();
      expect(CobraRouter._initialized).toBe(true);
    });

    it('should call CobraAudit.init() when available', async () => {
      CobraRouter.init();
      await new Promise(resolve => setImmediate(resolve)); // Wait for promise chain

      expect(global.self.CobraAudit.init).toHaveBeenCalled();
    });

    it('should call CobraAudit.logSystem with ROUTER_INIT', async () => {
      CobraRouter.init();
      await new Promise(resolve => setImmediate(resolve));

      expect(global.self.CobraAudit.logSystem).toHaveBeenCalledWith(
        'ROUTER_INIT',
        'Router initialized'
      );
    });

    it('should add chrome.runtime.onMessage listener', () => {
      CobraRouter.init();
      expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('should handle CobraAudit.init() rejection gracefully', async () => {
      global.self.CobraAudit.init.mockRejectedValueOnce(new Error('Init failed'));
      CobraRouter.init();
      await new Promise(resolve => setImmediate(resolve));

      // Should not throw, just log warning
      expect(global.console.warn).toHaveBeenCalled();
    });

    it('should work when CobraAudit is not available', () => {
      global.self.CobraAudit = null;
      expect(() => CobraRouter.init()).not.toThrow();
      expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('should log handler counts when initialized', () => {
      CobraRouter.registerType('TYPE_A', jest.fn());
      CobraRouter.registerAction('ACTION_A', jest.fn());

      CobraRouter.init();

      expect(global.console.log).toHaveBeenCalledWith(
        '[CobraRouter] Initialized with',
        1,
        'type handlers,',
        1,
        'action handlers'
      );
    });
  });

  // =====================================================================
  // 4. init() double-call guard — second call is ignored
  // =====================================================================

  describe('init() double-call guard', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
    });

    it('should ignore second call to init()', () => {
      global.chrome.runtime.onMessage.addListener.mockClear();

      CobraRouter.init();
      const callCountAfterFirst = global.chrome.runtime.onMessage.addListener.mock.calls.length;

      CobraRouter.init();
      const callCountAfterSecond = global.chrome.runtime.onMessage.addListener.mock.calls.length;

      expect(callCountAfterFirst).toBe(1);
      expect(callCountAfterSecond).toBe(1); // No additional call
    });

    it('should log warning on second init() call', () => {
      global.console.warn.mockClear();

      CobraRouter.init();
      CobraRouter.init();

      expect(global.console.warn).toHaveBeenCalledWith(
        '[CobraRouter] init() called multiple times, ignoring'
      );
    });

    it('should not call CobraAudit.init() twice', async () => {
      global.self.CobraAudit.init.mockClear();

      CobraRouter.init();
      CobraRouter.init();
      await new Promise(resolve => setImmediate(resolve));

      expect(global.self.CobraAudit.init).toHaveBeenCalledTimes(1);
    });
  });

  // =====================================================================
  // 5. Contract validation — rejects invalid messages via CobraContracts.validateMessage
  // =====================================================================

  describe('Contract validation', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
      CobraRouter.registerType('VALID_TYPE', jest.fn(() => ({ success: true })));
      CobraRouter.init();
    });

    it('should reject message when contract validation fails', async () => {
      global.self.CobraContracts.validateMessage.mockReturnValueOnce({
        ok: false,
        error: 'Invalid payload',
        code: 'INVALID_PAYLOAD',
      });

      const msg = { type: 'VALID_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Invalid payload',
        code: 'INVALID_PAYLOAD',
      });
    });

    it('should log contract rejection to audit', async () => {
      global.self.CobraContracts.validateMessage.mockReturnValueOnce({
        ok: false,
        error: 'Contract violation',
        code: 'VIOLATION',
      });

      const msg = { type: 'VALID_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(global.self.CobraAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VALID_TYPE',
          category: 'guard',
          result: 'blocked',
          details: 'Contract violation',
        })
      );
    });

    it('should not call handler when contract validation fails', async () => {
      const handler = jest.fn();
      CobraRouter._typeHandlers = {};
      CobraRouter.registerType('VALID_TYPE', handler);

      global.self.CobraContracts.validateMessage.mockReturnValueOnce({
        ok: false,
        error: 'Validation failed',
      });

      const msg = { type: 'VALID_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not log to audit when CobraAudit is unavailable', async () => {
      global.self.CobraAudit = null;

      global.self.CobraContracts.validateMessage.mockReturnValueOnce({
        ok: false,
        error: 'Validation failed',
      });

      const msg = { type: 'VALID_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalled();
    });

    it('should use default code when contract validation does not provide one', async () => {
      global.self.CobraContracts.validateMessage.mockReturnValueOnce({
        ok: false,
        error: 'Some error',
        // no code provided
      });

      const msg = { type: 'VALID_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Some error',
        code: 'CONTRACT_VIOLATION',
      });
    });
  });

  // =====================================================================
  // 6. Type handler dispatch — calls correct handler, returns result via sendResponse
  // =====================================================================

  describe('Type handler dispatch', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
      CobraRouter.init();
    });

    it('should call type handler with payload, msg, and sender', async () => {
      const handler = jest.fn(() => ({ success: true }));
      CobraRouter.registerType('TEST_TYPE', handler);

      const payload = { data: 'test' };
      const msg = { type: 'TEST_TYPE', payload };
      const sender = { tab: { url: 'https://example.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(handler).toHaveBeenCalledWith(payload, msg, sender);
    });

    it('should return handler result via sendResponse', async () => {
      const result = { success: true, data: 'response' };
      CobraRouter.registerType('TEST_TYPE', jest.fn(() => result));

      const msg = { type: 'TEST_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith(result);
    });

    it('should handle undefined payload by passing empty object', async () => {
      const handler = jest.fn();
      CobraRouter.registerType('TEST_TYPE', handler);

      const msg = { type: 'TEST_TYPE' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(handler).toHaveBeenCalledWith({}, msg, sender);
    });

    it('should support async type handlers', async () => {
      const handler = jest.fn(() => Promise.resolve({ async: true }));
      CobraRouter.registerType('ASYNC_TYPE', handler);

      const msg = { type: 'ASYNC_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({ async: true });
    });

    it('should return true from listener to indicate async sendResponse', () => {
      CobraRouter.registerType('TEST_TYPE', jest.fn(() => ({ result: true })));

      const msg = { type: 'TEST_TYPE', payload: {} };
      const sender = {};

      const result = messageListener(msg, sender, sendResponse);

      expect(result).toBe(true);
    });
  });

  // =====================================================================
  // 7. Action handler dispatch — calls correct handler with full msg
  // =====================================================================

  describe('Action handler dispatch', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
      CobraRouter.init();
    });

    it('should call action handler with full msg and sender', async () => {
      const handler = jest.fn(() => ({ success: true }));
      CobraRouter.registerAction('TEST_ACTION', handler);

      const msg = { action: 'TEST_ACTION', data: 'test' };
      const sender = { tab: { url: 'https://example.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(handler).toHaveBeenCalledWith(msg, sender);
    });

    it('should return handler result via sendResponse', async () => {
      const result = { success: true, data: 'response' };
      CobraRouter.registerAction('TEST_ACTION', jest.fn(() => result));

      const msg = { action: 'TEST_ACTION' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith(result);
    });

    it('should support async action handlers', async () => {
      const handler = jest.fn(() => Promise.resolve({ async: true }));
      CobraRouter.registerAction('ASYNC_ACTION', handler);

      const msg = { action: 'ASYNC_ACTION' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({ async: true });
    });

    it('should prioritize type handlers over action handlers', async () => {
      const typeHandler = jest.fn(() => ({ type: 'handler' }));
      const actionHandler = jest.fn(() => ({ action: 'handler' }));

      CobraRouter.registerType('BOTH', typeHandler);
      CobraRouter.registerAction('BOTH', actionHandler);

      const msg = { type: 'BOTH', action: 'BOTH' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(typeHandler).toHaveBeenCalled();
      expect(actionHandler).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({ type: 'handler' });
    });

    it('should return true from listener to indicate async sendResponse', () => {
      CobraRouter.registerAction('TEST_ACTION', jest.fn(() => ({ result: true })));

      const msg = { action: 'TEST_ACTION' };
      const sender = {};

      const result = messageListener(msg, sender, sendResponse);

      expect(result).toBe(true);
    });
  });

  // =====================================================================
  // 8. Error handling — handler throws, sendResponse gets error
  // =====================================================================

  describe('Error handling', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
      CobraRouter.init();
    });

    it('should catch type handler errors and send error response', async () => {
      const error = new Error('Handler failed');
      CobraRouter.registerType('ERROR_TYPE', jest.fn(() => {
        throw error;
      }));

      const msg = { type: 'ERROR_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Handler failed',
        code: 'HANDLER_ERROR',
      });
    });

    it('should catch action handler errors and send error response', async () => {
      const error = new Error('Action failed');
      CobraRouter.registerAction('ERROR_ACTION', jest.fn(() => {
        throw error;
      }));

      const msg = { action: 'ERROR_ACTION' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Action failed',
        code: 'HANDLER_ERROR',
      });
    });

    it('should catch promise rejections in type handlers', async () => {
      CobraRouter.registerType('REJECT_TYPE', jest.fn(() =>
        Promise.reject(new Error('Promise rejected'))
      ));

      const msg = { type: 'REJECT_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Promise rejected',
        code: 'HANDLER_ERROR',
      });
    });

    it('should catch promise rejections in action handlers', async () => {
      CobraRouter.registerAction('REJECT_ACTION', jest.fn(() =>
        Promise.reject(new Error('Promise rejected'))
      ));

      const msg = { action: 'REJECT_ACTION' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Promise rejected',
        code: 'HANDLER_ERROR',
      });
    });

    it('should use custom error code if provided by handler', async () => {
      const error = new Error('Custom error');
      error.code = 'CUSTOM_CODE';

      CobraRouter.registerType('ERROR_TYPE', jest.fn(() => {
        throw error;
      }));

      const msg = { type: 'ERROR_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Custom error',
        code: 'CUSTOM_CODE',
      });
    });

    it('should log errors to console', async () => {
      global.console.error.mockClear();
      const error = new Error('Test error');
      CobraRouter.registerType('ERROR_TYPE', jest.fn(() => {
        throw error;
      }));

      const msg = { type: 'ERROR_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(global.console.error).toHaveBeenCalledWith(
        "[CobraRouter] Error in type handler 'ERROR_TYPE':",
        error
      );
    });

    it('should handle errors with no message property', async () => {
      CobraRouter.registerType('ERROR_TYPE', jest.fn(() => {
        throw { custom: 'error object' };
      }));

      const msg = { type: 'ERROR_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalled();
      expect(sendResponse.mock.calls[0][0]).toHaveProperty('error');
    });
  });

  // =====================================================================
  // 9. Audit logging — logs ok/fail with correct category, durationMs
  // =====================================================================

  describe('Audit logging', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
      global.self.CobraAudit.log.mockClear();
      CobraRouter.init();
    });

    it('should log successful type handler execution with ok result', async () => {
      CobraRouter.registerType('TEST_TYPE', jest.fn(() => ({ success: true })));

      const msg = { type: 'TEST_TYPE', payload: {} };
      const sender = { tab: { url: 'https://example.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      const calls = global.self.CobraAudit.log.mock.calls;
      const successLog = calls.find(call => call[0].result === 'ok');

      expect(successLog).toBeDefined();
      expect(successLog[0]).toEqual(
        expect.objectContaining({
          action: 'TEST_TYPE',
          category: 'chat',
          result: 'ok',
          hostname: 'https://example.com',
        })
      );
    });

    it('should include durationMs in audit log', async () => {
      CobraRouter.registerType('TEST_TYPE', jest.fn(() => ({ success: true })));

      const msg = { type: 'TEST_TYPE', payload: {} };
      const sender = { tab: { url: 'https://example.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      const calls = global.self.CobraAudit.log.mock.calls;
      const successLog = calls.find(call => call[0].result === 'ok');

      expect(successLog[0]).toHaveProperty('durationMs');
      expect(typeof successLog[0].durationMs).toBe('number');
      expect(successLog[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should log failed type handler execution with fail result', async () => {
      CobraRouter.registerType('ERROR_TYPE', jest.fn(() => {
        throw new Error('Handler error');
      }));

      const msg = { type: 'ERROR_TYPE', payload: {} };
      const sender = { tab: { url: 'https://example.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      const calls = global.self.CobraAudit.log.mock.calls;
      const failLog = calls.find(call => call[0].result === 'fail');

      expect(failLog).toBeDefined();
      expect(failLog[0]).toEqual(
        expect.objectContaining({
          action: 'ERROR_TYPE',
          category: 'chat',
          result: 'fail',
          details: 'Handler error',
        })
      );
    });

    it('should log action handler with correct category from _categorize', async () => {
      CobraRouter.registerAction('KB_QUERY', jest.fn(() => ({ success: true })));

      const msg = { action: 'KB_QUERY' };
      const sender = { tab: { url: 'https://example.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      const calls = global.self.CobraAudit.log.mock.calls;
      const log = calls.find(call => call[0].action === 'KB_QUERY');

      expect(log[0]).toEqual(
        expect.objectContaining({
          category: 'kb',
        })
      );
    });

    it('should handle missing tab URL gracefully', async () => {
      CobraRouter.registerType('TEST_TYPE', jest.fn(() => ({ success: true })));

      const msg = { type: 'TEST_TYPE', payload: {} };
      const sender = {}; // No tab

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      const calls = global.self.CobraAudit.log.mock.calls;
      const log = calls.find(call => call[0].result === 'ok');

      expect(log[0]).toEqual(
        expect.objectContaining({
          hostname: '',
        })
      );
    });

    it('should not log to audit when CobraAudit is unavailable', async () => {
      global.self.CobraAudit = null;
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter.init();

      CobraRouter.registerType('TEST_TYPE', jest.fn(() => ({ success: true })));

      const msg = { type: 'TEST_TYPE', payload: {} };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalled();
    });

    it('should include all required fields in success log', async () => {
      CobraRouter.registerAction('COMM_SEND', jest.fn(() => ({ success: true })));

      const msg = { action: 'COMM_SEND' };
      const sender = { tab: { url: 'https://test.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      const calls = global.self.CobraAudit.log.mock.calls;
      const log = calls.find(call => call[0].result === 'ok');

      expect(log[0]).toEqual(
        expect.objectContaining({
          action: expect.any(String),
          category: expect.any(String),
          hostname: expect.any(String),
          result: 'ok',
          durationMs: expect.any(Number),
        })
      );
    });

    it('should include error details in fail log', async () => {
      CobraRouter.registerAction('FILE_DELETE', jest.fn(() => {
        throw new Error('Permission denied');
      }));

      const msg = { action: 'FILE_DELETE' };
      const sender = { tab: { url: 'https://test.com' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      const calls = global.self.CobraAudit.log.mock.calls;
      const log = calls.find(call => call[0].result === 'fail');

      expect(log[0]).toEqual(
        expect.objectContaining({
          details: 'Permission denied',
          result: 'fail',
        })
      );
    });
  });

  // =====================================================================
  // 10. _categorize() — COMM_* → comms, KB_* → kb, JOB_/PJOB_* → job, etc.
  // =====================================================================

  describe('_categorize()', () => {
    it('should categorize COMM_ actions as comms', () => {
      expect(CobraRouter._categorize('COMM_SEND')).toBe('comms');
      expect(CobraRouter._categorize('COMM_RECEIVE')).toBe('comms');
      expect(CobraRouter._categorize('COMM_DELETE')).toBe('comms');
    });

    it('should categorize KB_ actions as kb', () => {
      expect(CobraRouter._categorize('KB_QUERY')).toBe('kb');
      expect(CobraRouter._categorize('KB_INDEX')).toBe('kb');
      expect(CobraRouter._categorize('KB_SEARCH')).toBe('kb');
    });

    it('should categorize JOB_ actions as job', () => {
      expect(CobraRouter._categorize('JOB_SUBMIT')).toBe('job');
      expect(CobraRouter._categorize('JOB_STATUS')).toBe('job');
      expect(CobraRouter._categorize('JOB_CANCEL')).toBe('job');
    });

    it('should categorize PJOB_ actions as job', () => {
      expect(CobraRouter._categorize('PJOB_SUBMIT')).toBe('job');
      expect(CobraRouter._categorize('PJOB_STATUS')).toBe('job');
      expect(CobraRouter._categorize('PJOB_RESULT')).toBe('job');
    });

    it('should categorize FILE_ actions as tool', () => {
      expect(CobraRouter._categorize('FILE_READ')).toBe('tool');
      expect(CobraRouter._categorize('FILE_WRITE')).toBe('tool');
      expect(CobraRouter._categorize('FILE_DELETE')).toBe('tool');
    });

    it('should categorize GUARD_ actions as guard', () => {
      expect(CobraRouter._categorize('GUARD_CHECK')).toBe('guard');
      expect(CobraRouter._categorize('GUARD_VERIFY')).toBe('guard');
    });

    it('should categorize POLICY_ actions as policy', () => {
      expect(CobraRouter._categorize('POLICY_ENFORCE')).toBe('policy');
      expect(CobraRouter._categorize('POLICY_UPDATE')).toBe('policy');
    });

    it('should categorize AUDIT_ actions as system', () => {
      expect(CobraRouter._categorize('AUDIT_LOG')).toBe('system');
      expect(CobraRouter._categorize('AUDIT_REPORT')).toBe('system');
    });

    it('should categorize SELECTOR_ actions as tool', () => {
      expect(CobraRouter._categorize('SELECTOR_FIND')).toBe('tool');
      expect(CobraRouter._categorize('SELECTOR_QUERY')).toBe('tool');
    });

    it('should default unknown actions to system', () => {
      expect(CobraRouter._categorize('UNKNOWN')).toBe('system');
      expect(CobraRouter._categorize('RANDOM_ACTION')).toBe('system');
      expect(CobraRouter._categorize('TEST')).toBe('system');
    });

    it('should handle null action gracefully', () => {
      expect(CobraRouter._categorize(null)).toBe('system');
    });

    it('should handle undefined action gracefully', () => {
      expect(CobraRouter._categorize(undefined)).toBe('system');
    });

    it('should handle empty string gracefully', () => {
      expect(CobraRouter._categorize('')).toBe('system');
    });

    it('should be case-sensitive for prefix matching', () => {
      expect(CobraRouter._categorize('comm_test')).toBe('system');
      expect(CobraRouter._categorize('kb_test')).toBe('system');
      expect(CobraRouter._categorize('job_test')).toBe('system');
    });
  });

  // =====================================================================
  // 11. Unknown type/action — returns error with UNKNOWN_TYPE/UNKNOWN_ACTION
  // =====================================================================

  describe('Unknown type/action handling', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
      CobraRouter.init();
    });

    it('should return UNKNOWN_TYPE error for unknown type', () => {
      const msg = { type: 'UNKNOWN_TYPE', payload: {} };
      const sender = {};

      const result = messageListener(msg, sender, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Unknown message type: UNKNOWN_TYPE',
        code: 'UNKNOWN_TYPE',
      });
      expect(result).toBe(false);
    });

    it('should return UNKNOWN_ACTION error for unknown action', () => {
      const msg = { action: 'UNKNOWN_ACTION' };
      const sender = {};

      const result = messageListener(msg, sender, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Unknown action: UNKNOWN_ACTION',
        code: 'UNKNOWN_ACTION',
      });
      expect(result).toBe(false);
    });

    it('should log warning for unknown type', () => {
      global.console.warn.mockClear();

      const msg = { type: 'UNKNOWN_TYPE' };
      const sender = {};

      messageListener(msg, sender, sendResponse);

      expect(global.console.warn).toHaveBeenCalledWith(
        "[CobraRouter] Unknown message type: 'UNKNOWN_TYPE'"
      );
    });

    it('should log warning for unknown action', () => {
      global.console.warn.mockClear();

      const msg = { action: 'UNKNOWN_ACTION' };
      const sender = {};

      messageListener(msg, sender, sendResponse);

      expect(global.console.warn).toHaveBeenCalledWith(
        "[CobraRouter] Unknown action: 'UNKNOWN_ACTION'"
      );
    });

    it('should return false for unknown type with no further processing', () => {
      const msg = { type: 'UNKNOWN_TYPE' };
      const sender = {};

      const result = messageListener(msg, sender, sendResponse);

      expect(result).toBe(false);
    });

    it('should return false for unknown action with no further processing', () => {
      const msg = { action: 'UNKNOWN_ACTION' };
      const sender = {};

      const result = messageListener(msg, sender, sendResponse);

      expect(result).toBe(false);
    });

    it('should not call handler for unknown type', () => {
      const handler = jest.fn();
      CobraRouter.registerType('REGISTERED_TYPE', handler);

      const msg = { type: 'UNKNOWN_TYPE' };
      const sender = {};

      messageListener(msg, sender, sendResponse);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not call handler for unknown action', () => {
      const handler = jest.fn();
      CobraRouter.registerAction('REGISTERED_ACTION', handler);

      const msg = { action: 'UNKNOWN_ACTION' };
      const sender = {};

      messageListener(msg, sender, sendResponse);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle message with both type and action where type is unknown', () => {
      const msg = { type: 'UNKNOWN_TYPE', action: 'UNKNOWN_ACTION' };
      const sender = {};

      messageListener(msg, sender, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'UNKNOWN_TYPE' })
      );
    });

    it('should handle message with no type or action', () => {
      const msg = { data: 'some data' };
      const sender = {};

      const result = messageListener(msg, sender, sendResponse);

      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // 12. getStats() — returns typeHandlers and actionHandlers keys
  // =====================================================================

  describe('getStats()', () => {
    beforeEach(() => {
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
    });

    it('should return object with typeHandlers and actionHandlers properties', () => {
      const stats = CobraRouter.getStats();

      expect(stats).toHaveProperty('typeHandlers');
      expect(stats).toHaveProperty('actionHandlers');
    });

    it('should return empty arrays when no handlers are registered', () => {
      const stats = CobraRouter.getStats();

      expect(stats.typeHandlers).toEqual([]);
      expect(stats.actionHandlers).toEqual([]);
    });

    it('should return array of type handler keys', () => {
      CobraRouter.registerTypes({
        TYPE_A: jest.fn(),
        TYPE_B: jest.fn(),
        TYPE_C: jest.fn(),
      });

      const stats = CobraRouter.getStats();

      expect(stats.typeHandlers).toContain('TYPE_A');
      expect(stats.typeHandlers).toContain('TYPE_B');
      expect(stats.typeHandlers).toContain('TYPE_C');
      expect(stats.typeHandlers).toHaveLength(3);
    });

    it('should return array of action handler keys', () => {
      CobraRouter.registerActions({
        ACTION_A: jest.fn(),
        ACTION_B: jest.fn(),
      });

      const stats = CobraRouter.getStats();

      expect(stats.actionHandlers).toContain('ACTION_A');
      expect(stats.actionHandlers).toContain('ACTION_B');
      expect(stats.actionHandlers).toHaveLength(2);
    });

    it('should include both type and action handlers in separate arrays', () => {
      CobraRouter.registerTypes({
        TYPE_1: jest.fn(),
        TYPE_2: jest.fn(),
      });
      CobraRouter.registerActions({
        ACTION_1: jest.fn(),
        ACTION_2: jest.fn(),
        ACTION_3: jest.fn(),
      });

      const stats = CobraRouter.getStats();

      expect(stats.typeHandlers).toHaveLength(2);
      expect(stats.actionHandlers).toHaveLength(3);
    });

    it('should return fresh arrays on each call', () => {
      CobraRouter.registerType('TYPE_A', jest.fn());

      const stats1 = CobraRouter.getStats();
      const stats2 = CobraRouter.getStats();

      expect(stats1.typeHandlers).toEqual(stats2.typeHandlers);
      expect(stats1.typeHandlers).not.toBe(stats2.typeHandlers); // Different array instances
    });

    it('should reflect changes when handlers are added', () => {
      const stats1 = CobraRouter.getStats();
      expect(stats1.typeHandlers).toHaveLength(0);

      CobraRouter.registerType('NEW_TYPE', jest.fn());
      const stats2 = CobraRouter.getStats();

      expect(stats2.typeHandlers).toHaveLength(1);
      expect(stats2.typeHandlers).toContain('NEW_TYPE');
    });

    it('should reflect changes when handlers are overwritten', () => {
      CobraRouter.registerType('TYPE_A', jest.fn());
      const stats1 = CobraRouter.getStats();

      CobraRouter.registerType('TYPE_B', jest.fn());
      const stats2 = CobraRouter.getStats();

      expect(stats1.typeHandlers).toHaveLength(1);
      expect(stats2.typeHandlers).toHaveLength(2);
    });
  });

  // =====================================================================
  // Additional edge case tests
  // =====================================================================

  describe('Edge cases', () => {
    beforeEach(() => {
      CobraRouter._initialized = false;
      CobraRouter._typeHandlers = {};
      CobraRouter._actionHandlers = {};
      CobraRouter.init();
    });

    it('should handle messages with null payload', async () => {
      const handler = jest.fn();
      CobraRouter.registerType('TEST_TYPE', handler);

      const msg = { type: 'TEST_TYPE', payload: null };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      // When payload is null/undefined, router converts it to empty object
      expect(handler).toHaveBeenCalledWith({}, msg, sender);
    });

    it('should handle messages with undefined sender', async () => {
      const handler = jest.fn(() => ({ success: true }));
      CobraRouter.registerType('TEST_TYPE', handler);

      const msg = { type: 'TEST_TYPE', payload: {} };

      messageListener(msg, undefined, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should handle handler returning null', async () => {
      CobraRouter.registerType('NULL_TYPE', jest.fn(() => null));

      const msg = { type: 'NULL_TYPE' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith(null);
    });

    it('should handle handler returning undefined', async () => {
      CobraRouter.registerType('UNDEFINED_TYPE', jest.fn(() => undefined));

      const msg = { type: 'UNDEFINED_TYPE' };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith(undefined);
    });

    it('should handle very long action name', async () => {
      const longName = 'ACTION_' + 'A'.repeat(1000);
      CobraRouter.registerAction(longName, jest.fn(() => ({ success: true })));

      const msg = { action: longName };
      const sender = {};

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should measure duration accurately for slow handlers', async () => {
      CobraRouter.registerType('SLOW_TYPE', jest.fn(() =>
        new Promise(resolve => {
          setTimeout(() => resolve({ success: true }), 50);
        })
      ));

      global.self.CobraAudit.log.mockClear();

      const msg = { type: 'SLOW_TYPE' };
      const sender = { tab: { url: '' } };

      messageListener(msg, sender, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 100));

      const calls = global.self.CobraAudit.log.mock.calls;
      const log = calls.find(call => call[0].result === 'ok');

      expect(log[0].durationMs).toBeGreaterThanOrEqual(50);
    });

    it('should handle handler that sends response multiple times (only first counts)', async () => {
      const multiSendResponse = jest.fn();
      CobraRouter.registerType('MULTI_TYPE', jest.fn(() => ({ first: true })));

      const msg = { type: 'MULTI_TYPE' };
      const sender = {};

      messageListener(msg, sender, multiSendResponse);
      await new Promise(resolve => setImmediate(resolve));

      expect(multiSendResponse).toHaveBeenCalledTimes(1);
    });
  });
});
