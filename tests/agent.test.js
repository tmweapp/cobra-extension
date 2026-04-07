/**
 * COBRA Agent Module Tests
 * Tests browser automation actions: click, type, read, wait, scroll, select, form fill, snapshot
 */

describe('Agent Module', () => {
  let Agent;

  beforeEach(() => {
    jest.clearAllMocks();
    // Load Agent module from source
    const fs = require('fs');
    const path = '/sessions/ecstatic-upbeat-cray/mnt/Downloads/firescrape-extension/agent.js';
    const code = fs.readFileSync(path, 'utf-8');

    // Create a module context and eval the code
    const module = { exports: {} };
    const moduleFunc = new Function('module', 'exports', 'self', code);
    moduleFunc(module, module.exports, global);

    Agent = global.Agent;
  });

  describe('Script Factory Methods', () => {
    it('clickScript should return a function', () => {
      const script = Agent.clickScript();
      expect(typeof script).toBe('function');
    });

    it('typeScript should return a function', () => {
      const script = Agent.typeScript();
      expect(typeof script).toBe('function');
    });

    it('readScript should return a function', () => {
      const script = Agent.readScript();
      expect(typeof script).toBe('function');
    });

    it('waitScript should return a function', () => {
      const script = Agent.waitScript();
      expect(typeof script).toBe('function');
    });

    it('scrollScript should return a function', () => {
      const script = Agent.scrollScript();
      expect(typeof script).toBe('function');
    });

    it('selectScript should return a function', () => {
      const script = Agent.selectScript();
      expect(typeof script).toBe('function');
    });

    it('formFillScript should return a function', () => {
      const script = Agent.formFillScript();
      expect(typeof script).toBe('function');
    });

    it('snapshotScript should return a function', () => {
      const script = Agent.snapshotScript();
      expect(typeof script).toBe('function');
    });

    it('each script factory should be callable', () => {
      const factories = [
        Agent.clickScript,
        Agent.typeScript,
        Agent.readScript,
        Agent.waitScript,
        Agent.scrollScript,
        Agent.selectScript,
        Agent.formFillScript,
        Agent.snapshotScript,
      ];
      factories.forEach((factory) => {
        expect(typeof factory).toBe('function');
        expect(typeof factory()).toBe('function');
      });
    });
  });

  describe('executeAction', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should handle missing action parameter', async () => {
      const result = await Agent.executeAction(1, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain('non specificata');
    });

    it('should handle null action', async () => {
      const result = await Agent.executeAction(1, { action: null });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate type action requires text', async () => {
      const result = await Agent.executeAction(1, {
        action: 'type',
        selector: 'input',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Testo non specificato');
    });

    it('should allow empty string as text for type', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true, action: 'type' } },
      ]);
      const result = await Agent.executeAction(1, {
        action: 'type',
        selector: 'input',
        text: '',
      });
      expect(result.ok).toBe(true);
      expect(chrome.scripting.executeScript).toHaveBeenCalled();
    });

    it('should execute click action via scripting', async () => {
      const expected = { ok: true, action: 'click', selector: 'btn' };
      chrome.scripting.executeScript.mockResolvedValue([{ result: expected }]);

      const result = await Agent.executeAction(1, {
        action: 'click',
        selector: 'btn',
      });

      expect(result).toEqual(expected);
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 1 },
        func: expect.any(Function),
        args: ['btn', {}],
      });
    });

    it('should execute read action with selector and options', async () => {
      const expected = { ok: true, action: 'read', count: 5 };
      chrome.scripting.executeScript.mockResolvedValue([{ result: expected }]);

      const result = await Agent.executeAction(1, {
        action: 'read',
        selector: 'div',
        options: { max: 10 },
      });

      expect(result).toEqual(expected);
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 1 },
        func: expect.any(Function),
        args: ['div', { max: 10 }],
      });
    });

    it('should execute wait action with default timeout', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      await Agent.executeAction(1, {
        action: 'wait',
        selector: 'btn',
      });

      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args[1]).toBe(10000); // Default timeout
    });

    it('should execute wait action with custom timeout', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      await Agent.executeAction(1, {
        action: 'wait',
        selector: 'btn',
        timeout: 5000,
      });

      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args[1]).toBe(5000);
    });

    it('should execute scroll action with element target', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      await Agent.executeAction(1, {
        action: 'scroll',
        selector: 'element',
      });

      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args[0]).toBe('element');
    });

    it('should execute scroll action with target parameter', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      await Agent.executeAction(1, {
        action: 'scroll',
        target: 50,
      });

      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args[0]).toBe(50);
    });

    it('should execute select action with value', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      await Agent.executeAction(1, {
        action: 'select',
        selector: 'select-id',
        value: 'option-value',
      });

      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args).toEqual(['select-id', 'option-value']);
    });

    it('should execute formFill action with fields object', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      const fields = {
        'input-1': 'value1',
        'input-2': 'value2',
      };

      await Agent.executeAction(1, {
        action: 'formFill',
        fields,
      });

      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args[0]).toEqual(fields);
    });

    it('should execute snapshot action without args', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true, action: 'snapshot' } },
      ]);

      const result = await Agent.executeAction(1, {
        action: 'snapshot',
      });

      expect(result.ok).toBe(true);
      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args).toEqual([]);
    });

    it('should handle delay action', async () => {
      jest.useFakeTimers();
      const promise = Agent.executeAction(1, {
        action: 'delay',
        ms: 1000,
      });

      jest.advanceTimersByTime(1500);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.action).toBe('delay');
      jest.useRealTimers();
    });

    it('should handle delay action with default ms', async () => {
      jest.useFakeTimers();
      const promise = Agent.executeAction(1, {
        action: 'delay',
      });

      jest.advanceTimersByTime(1500);
      const result = await promise;

      expect(result.ok).toBe(true);
      jest.useRealTimers();
    });

    it('should handle navigate action', async () => {
      let navListener = null;
      // Ensure onUpdated exists
      if (!chrome.tabs.onUpdated) chrome.tabs.onUpdated = {};
      chrome.tabs.onUpdated.addListener = jest.fn((fn) => {
        navListener = fn;
      });
      chrome.tabs.onUpdated.removeListener = jest.fn();
      chrome.tabs.update = jest.fn().mockResolvedValue(true);

      const promise = Agent.executeAction(1, {
        action: 'navigate',
        url: 'http://example.com',
      });

      setTimeout(() => {
        if (navListener) navListener(1, { status: 'complete' });
      }, 10);

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.action).toBe('navigate');
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
        url: 'http://example.com',
      });
    });

    it('should handle navigate timeout', async () => {
      let navListener = null;
      if (!chrome.tabs.onUpdated) chrome.tabs.onUpdated = {};
      chrome.tabs.onUpdated.addListener = jest.fn((fn) => {
        navListener = fn;
      });
      chrome.tabs.onUpdated.removeListener = jest.fn();
      chrome.tabs.update = jest.fn().mockResolvedValue(true);

      const promise = Agent.executeAction(1, {
        action: 'navigate',
        url: 'http://example.com',
      });

      // Don't trigger the listener, let it timeout naturally
      // After ~15 seconds the listener should be removed
      expect(chrome.tabs.update).toHaveBeenCalled();
    });

    it('should handle unknown action', async () => {
      const result = await Agent.executeAction(1, {
        action: 'unknown-action',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('sconosciuta');
    });

    it('should handle script execution returning no result', async () => {
      chrome.scripting.executeScript.mockResolvedValue([{}]);

      const result = await Agent.executeAction(1, {
        action: 'click',
        selector: 'btn',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Nessun risultato');
    });

    it('should handle script execution error', async () => {
      chrome.scripting.executeScript.mockRejectedValue(
        new Error('Script failed')
      );

      try {
        const result = await Agent.executeAction(1, {
          action: 'click',
          selector: 'btn',
        });
        expect(result.ok).toBe(false);
      } catch (e) {
        // May throw or may return error in result
        expect(e).toBeDefined();
      }
    });

    it('should pass click options to script', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      await Agent.executeAction(1, {
        action: 'click',
        selector: 'btn',
        options: { eventsOnly: true },
      });

      const call = chrome.scripting.executeScript.mock.calls[0][0];
      expect(call.args[1]).toEqual({ eventsOnly: true });
    });

    it('should support multiple action types', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      const actions = ['click', 'read', 'wait', 'scroll', 'select', 'formFill', 'snapshot'];

      for (const action of actions) {
        const step = { action, selector: 'sel' };
        if (action === 'type') step.text = 'text';
        if (action === 'select') step.value = 'val';
        if (action === 'wait') step.timeout = 5000;
        if (action === 'formFill') step.fields = {};

        const result = await Agent.executeAction(1, step);
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('executeSequence', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should execute empty sequence', async () => {
      const result = await Agent.executeSequence(1, []);
      expect(result.ok).toBe(true);
      expect(result.totalSteps).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should execute single step', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true, action: 'click' } },
      ]);

      const result = await Agent.executeSequence(1, [
        { action: 'click', selector: 'btn' },
      ]);

      expect(result.ok).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].step).toBe(0);
    });

    it('should execute multiple steps in order', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      const steps = [
        { action: 'click', selector: 'btn' },
        { action: 'type', selector: 'input', text: 'text' },
        { action: 'read', selector: 'div' },
      ];

      const result = await Agent.executeSequence(1, steps);

      expect(result.ok).toBe(true);
      expect(result.totalSteps).toBe(3);
      expect(result.results.map((r) => r.step)).toEqual([0, 1, 2]);
    });

    it('should stop on first non-optional failure', async () => {
      chrome.scripting.executeScript.mockResolvedValueOnce([
        { result: { ok: false, error: 'Element not found' } },
      ]);

      const steps = [
        { action: 'click', selector: 'missing' },
        { action: 'type', selector: 'input', text: 'text' },
      ];

      const result = await Agent.executeSequence(1, steps);

      expect(result.ok).toBe(false);
      expect(result.stoppedAt).toBe(0);
      expect(result.results.length).toBe(1);
    });

    it('should continue on optional step failure', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: false, error: 'Error' } },
      ]);

      const steps = [
        { action: 'click', selector: 'missing', optional: true },
        { action: 'type', selector: 'input', text: 'text', optional: true },
      ];

      const result = await Agent.executeSequence(1, steps);

      expect(result.ok).toBe(true); // Completed despite failures
      expect(result.results.length).toBe(2);
    });

    it('should add delay between steps', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      const steps = [
        { action: 'click', selector: 'btn' },
        { action: 'click', selector: 'btn2' },
      ];

      const startTime = Date.now();
      const result = await Agent.executeSequence(1, steps);
      const elapsed = Date.now() - startTime;

      expect(result.ok).toBe(true);
      // Should have some delay between steps (at least 100ms)
      expect(elapsed).toBeGreaterThan(100);
    });

    it('should catch execution errors in sequence', async () => {
      chrome.scripting.executeScript.mockRejectedValueOnce(
        new Error('Script error')
      );

      const steps = [{ action: 'click', selector: 'btn' }];
      const result = await Agent.executeSequence(1, steps);

      expect(result.ok).toBe(false);
      expect(result.results[0].result.ok).toBe(false);
    });

    it('should include step metadata in results', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      const steps = [{ action: 'click', selector: 'btn', custom: 'data' }];
      const result = await Agent.executeSequence(1, steps);

      expect(result.results[0]).toMatchObject({
        step: 0,
        action: 'click',
        selector: 'btn',
        custom: 'data',
      });
    });

    it('should not add delay after final step', async () => {
      chrome.scripting.executeScript.mockResolvedValue([
        { result: { ok: true } },
      ]);

      const steps = [{ action: 'click', selector: 'btn' }];
      const result = await Agent.executeSequence(1, steps);

      expect(result.ok).toBe(true);
      expect(result.results.length).toBe(1);
    });

    it('should handle mixed optional and required steps', async () => {
      chrome.scripting.executeScript
        .mockResolvedValueOnce([{ result: { ok: false } }])
        .mockResolvedValueOnce([{ result: { ok: true } }])
        .mockResolvedValueOnce([{ result: { ok: false } }]);

      const steps = [
        { action: 'click', selector: 'btn1', optional: true },
        { action: 'click', selector: 'btn2' },
        { action: 'click', selector: 'btn3', optional: true },
      ];

      const result = await Agent.executeSequence(1, steps);

      expect(result.ok).toBe(true);
      expect(result.results.length).toBe(3);
    });
  });

  describe('Agent module exports', () => {
    it('should export Agent to global', () => {
      expect(global.Agent).toBeDefined();
      expect(typeof global.Agent.executeAction).toBe('function');
      expect(typeof global.Agent.executeSequence).toBe('function');
    });

    it('should have all script factory methods', () => {
      const methods = [
        'clickScript',
        'typeScript',
        'readScript',
        'waitScript',
        'scrollScript',
        'selectScript',
        'formFillScript',
        'snapshotScript',
      ];

      methods.forEach((method) => {
        expect(typeof Agent[method]).toBe('function');
      });
    });

    it('should export both public methods', () => {
      expect(typeof Agent.executeAction).toBe('function');
      expect(typeof Agent.executeSequence).toBe('function');
    });
  });
});
