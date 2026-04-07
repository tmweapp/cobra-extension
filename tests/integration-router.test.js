/**
 * Integration Tests — Message Router
 * Tests CobraRouter dispatching to type and action handlers
 */
require('./setup');
require('../bg-router');

const CobraRouter = global.CobraRouter;

beforeEach(() => {
  // Reset router state
  CobraRouter._typeHandlers = {};
  CobraRouter._actionHandlers = {};
  CobraRouter._initialized = false;
  // Reset chrome mock
  chrome.runtime.onMessage.addListener.mockClear();
});

describe('CobraRouter — Integration', () => {
  describe('Handler registration', () => {
    test('registerType adds type handler', () => {
      const handler = jest.fn();
      CobraRouter.registerType('TEST_TYPE', handler);
      expect(CobraRouter._typeHandlers['TEST_TYPE']).toBe(handler);
    });

    test('registerTypes adds multiple handlers', () => {
      CobraRouter.registerTypes({
        'TYPE_A': jest.fn(),
        'TYPE_B': jest.fn(),
      });
      expect(Object.keys(CobraRouter._typeHandlers).length).toBe(2);
    });

    test('registerAction adds action handler', () => {
      const handler = jest.fn();
      CobraRouter.registerAction('doSomething', handler);
      expect(CobraRouter._actionHandlers['doSomething']).toBe(handler);
    });

    test('registerActions adds multiple action handlers', () => {
      CobraRouter.registerActions({
        'action1': jest.fn(),
        'action2': jest.fn(),
      });
      expect(Object.keys(CobraRouter._actionHandlers).length).toBe(2);
    });
  });

  describe('Initialization', () => {
    test('init registers chrome.runtime.onMessage listener', () => {
      CobraRouter.init();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    test('init is idempotent (double call ignored)', () => {
      CobraRouter.init();
      CobraRouter.init();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message dispatching', () => {
    let messageListener;

    beforeEach(() => {
      CobraRouter.init();
      messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    });

    test('dispatches type-based messages to correct handler', async () => {
      const handler = jest.fn().mockResolvedValue({ result: 'ok' });
      CobraRouter.registerType('CHAT_MESSAGE', handler);

      const sendResponse = jest.fn();
      const result = messageListener(
        { type: 'CHAT_MESSAGE', payload: { text: 'hello' } },
        { tab: { id: 1 } },
        sendResponse
      );

      expect(result).toBe(true); // async response
      await new Promise(r => setTimeout(r, 10));
      expect(handler).toHaveBeenCalledWith(
        { text: 'hello' },
        expect.objectContaining({ type: 'CHAT_MESSAGE' }),
        expect.anything()
      );
    });

    test('dispatches action-based messages to correct handler', async () => {
      const handler = jest.fn().mockResolvedValue({ success: true });
      CobraRouter.registerAction('SCRAPE_PAGE', handler);

      const sendResponse = jest.fn();
      messageListener(
        { action: 'SCRAPE_PAGE', url: 'https://example.com' },
        { tab: { id: 1 } },
        sendResponse
      );

      await new Promise(r => setTimeout(r, 10));
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SCRAPE_PAGE' }),
        expect.anything()
      );
    });

    test('type handlers take priority over action handlers', async () => {
      const typeHandler = jest.fn().mockResolvedValue('type');
      const actionHandler = jest.fn().mockResolvedValue('action');
      CobraRouter.registerType('DUAL', typeHandler);
      CobraRouter.registerAction('DUAL', actionHandler);

      const sendResponse = jest.fn();
      messageListener({ type: 'DUAL', action: 'DUAL', payload: {} }, {}, sendResponse);

      await new Promise(r => setTimeout(r, 10));
      expect(typeHandler).toHaveBeenCalled();
      expect(actionHandler).not.toHaveBeenCalled();
    });

    test('unknown type returns error', () => {
      const sendResponse = jest.fn();
      const result = messageListener({ type: 'NONEXISTENT' }, {}, sendResponse);

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('NONEXISTENT') })
      );
    });

    test('unknown action returns error', () => {
      const sendResponse = jest.fn();
      const result = messageListener({ action: 'NONEXISTENT' }, {}, sendResponse);

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('NONEXISTENT') })
      );
    });

    test('message with no type or action returns false', () => {
      const sendResponse = jest.fn();
      const result = messageListener({}, {}, sendResponse);
      expect(result).toBe(false);
    });

    test('handler errors are caught and returned', async () => {
      CobraRouter.registerType('FAIL', () => {
        throw new Error('Handler crashed');
      });

      const sendResponse = jest.fn();
      messageListener({ type: 'FAIL', payload: {} }, {}, sendResponse);

      await new Promise(r => setTimeout(r, 10));
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Handler crashed',
          code: 'HANDLER_ERROR',
        })
      );
    });

    test('async handler errors are caught', async () => {
      CobraRouter.registerAction('ASYNC_FAIL', async () => {
        throw new Error('Async explosion');
      });

      const sendResponse = jest.fn();
      messageListener({ action: 'ASYNC_FAIL' }, {}, sendResponse);

      await new Promise(r => setTimeout(r, 10));
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Async explosion' })
      );
    });
  });

  describe('getStats', () => {
    test('returns registered handler names', () => {
      CobraRouter.registerType('A', jest.fn());
      CobraRouter.registerType('B', jest.fn());
      CobraRouter.registerAction('c', jest.fn());

      const stats = CobraRouter.getStats();
      expect(stats.typeHandlers).toContain('A');
      expect(stats.typeHandlers).toContain('B');
      expect(stats.actionHandlers).toContain('c');
    });
  });
});
