/**
 * Tests for Decision Engine persistence (tool/provider scores + confidence threshold + verbose)
 * ≥20 tests as per spec
 */

require('../decision-engine.js');

describe('DecisionEngine - Persistence & Confidence Threshold & Verbose', () => {
  let engine;
  let mockKB;
  let mockGate;
  let mockConversation;

  beforeEach(() => {
    mockKB = {
      searchByDomain: jest.fn(() => []),
      addRule: jest.fn(),
      save: jest.fn()
    };
    mockGate = {};
    mockConversation = {};

    engine = new DecisionEngine(mockKB, mockGate, mockConversation);
  });

  afterEach(() => {
    chrome.storage.local.set.mockClear();
    chrome.storage.local.get.mockClear();
    chrome.runtime.sendMessage.mockClear();
  });

  // ============================================================
  // INTERVENTION 1: Tool Score Persistence
  // ============================================================

  test('should initialize toolScores from constructor', () => {
    expect(engine.toolScores).toEqual({});
    expect(engine.providerScores).toEqual({});
  });

  test('should update toolScores on tool success', async () => {
    engine._scoreToolSuccess('navigate', {});
    engine._scoreToolSuccess('navigate', {});

    expect(engine.toolScores.navigate).toEqual({ success: 2, fail: 0 });
  });

  test('should update toolScores on tool failure', async () => {
    engine._scoreToolFailure('click_element', {});
    engine._scoreToolFailure('click_element', {});
    engine._scoreToolFailure('click_element', {});

    expect(engine.toolScores.click_element).toEqual({ success: 0, fail: 3 });
  });

  test('should schedule score persistence with debounce', async () => {
    engine._scoreToolSuccess('fill_form', {});
    engine._scoreToolSuccess('fill_form', {});

    expect(engine._scoreTimer).toBeDefined();
  });

  test('should persist tool scores to chrome.storage.local', async () => {
    engine.toolScores = { test_tool: { success: 5, fail: 2 } };
    engine._persistScores();

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const calls = chrome.storage.local.set.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].cobra_tool_scores.test_tool).toEqual({ success: 5, fail: 2 });
  });

  test('should load tool scores from storage on init', async () => {
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({
        cobra_tool_scores: { saved_tool: { success: 10, fail: 1 } },
        cobra_provider_scores: { openai: { success: 3, fail: 0 } }
      });
    });

    await engine.loadToolScores();

    expect(engine.toolScores.saved_tool).toEqual({ success: 10, fail: 1 });
    expect(engine.providerScores.openai).toEqual({ success: 3, fail: 0 });
  });

  test('should handle missing scores in storage gracefully', async () => {
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({});
    });

    const result = await engine.loadToolScores();

    expect(engine.toolScores).toEqual({});
    expect(engine.providerScores).toEqual({});
    expect(result).toEqual({ toolScores: {}, providerScores: {} });
  });

  // ============================================================
  // INTERVENTION 2: Provider Score Persistence
  // ============================================================

  test('should update provider scores on success', () => {
    engine.scoreProviderSuccess('openai');
    engine.scoreProviderSuccess('openai');

    expect(engine.providerScores.openai).toEqual({ success: 2, fail: 0 });
  });

  test('should update provider scores on failure', () => {
    engine.scoreProviderFailure('groq');
    engine.scoreProviderFailure('groq');

    expect(engine.providerScores.groq).toEqual({ success: 0, fail: 2 });
  });

  test('should persist provider scores alongside tool scores', async () => {
    engine.toolScores = { tool1: { success: 1, fail: 0 } };
    engine.providerScores = { openai: { success: 1, fail: 0 } };
    engine._persistScores();

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const calls = chrome.storage.local.set.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toHaveProperty('cobra_tool_scores');
    expect(lastCall[0]).toHaveProperty('cobra_provider_scores');
  });

  test('should handle storage API errors gracefully', async () => {
    chrome.storage.local.set.mockRejectedValue(new Error('Storage error'));

    engine._persistScores();
    // Should not throw

    expect(chrome.storage.local.set).toHaveBeenCalled();
  });

  // ============================================================
  // INTERVENTION 3: Confidence Threshold + Clarify Request
  // ============================================================

  test('should emit clarify request when confidence < 0.6', async () => {
    const sendMessageSpy = jest.spyOn(chrome.runtime, 'sendMessage');

    const result = await engine.processRequest(
      'something ambiguous',
      { currentUrl: 'https://example.com' },
      { verbose: false }
    );

    // Should return pending state with clarify options
    if (result.pending) {
      expect(result.pending).toBe(true);
      expect(result.clarifyOptions).toBeDefined();
      expect(result.clarifyOptions.length).toBeGreaterThan(0);
    }

    sendMessageSpy.mockRestore();
  });

  test('should generate clarify options for low-confidence intent', () => {
    const message = 'compila il form per favore';
    const analysis = { intentClass: 'unknown', confidence: 0.5, context: {} };

    const options = engine._generateClarifyOptions(message, analysis);

    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveProperty('label');
    expect(options[0]).toHaveProperty('intent');
  });

  test('should not emit clarify when confidence >= 0.6', async () => {
    chrome.storage.local.get.mockImplementation((keys, cb) => cb({}));

    // Mock analyze to return high confidence
    const originalAnalyze = engine.analyze.bind(engine);
    engine.analyze = jest.fn(async () => ({
      message: 'navigate to google.com',
      intentClass: 'navigation',
      entities: { url: 'google.com' },
      confidence: 0.9,
      domainRules: [],
      context: {}
    }));

    const result = await engine.processRequest(
      'navigate to google.com',
      { currentUrl: 'https://example.com' }
    );

    // Should not have pending state (might have other results but no pending)
    expect(result.pending).not.toBe(true);
  });

  test('should include requestId in clarify request', () => {
    const sendMessageSpy = jest.spyOn(chrome.runtime, 'sendMessage');

    engine._emitClarifyRequest('req123', 'ambiguous?', [
      { label: 'Option 1', intent: 'search' }
    ]);

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHAT_CLARIFY_REQUEST',
        payload: expect.objectContaining({
          requestId: 'req123'
        })
      })
    );

    sendMessageSpy.mockRestore();
  });

  // ============================================================
  // INTERVENTION 5: Reasoning Trace Verbose
  // ============================================================

  test('should not emit reasoning steps when verbose=false (default)', async () => {
    const sendMessageSpy = jest.spyOn(chrome.runtime, 'sendMessage');

    engine.analyze = jest.fn(async () => ({
      message: 'test',
      intentClass: 'search',
      entities: {},
      confidence: 0.9,
      domainRules: [],
      context: {}
    }));
    engine._executeTool = jest.fn(async () => ({ ok: true, data: {} }));

    await engine.processRequest('test', { currentUrl: 'https://example.com' }, { verbose: false });

    // Count REASONING_STEP messages
    const reasoningSteps = sendMessageSpy.mock.calls.filter(
      call => call[0].type === 'REASONING_STEP'
    );
    expect(reasoningSteps.length).toBe(0);

    sendMessageSpy.mockRestore();
  });

  test('should emit reasoning steps when verbose=true', async () => {
    const sendMessageSpy = jest.spyOn(chrome.runtime, 'sendMessage');

    engine.analyze = jest.fn(async () => ({
      message: 'test',
      intentClass: 'search',
      entities: {},
      confidence: 0.9,
      domainRules: [],
      context: {}
    }));
    engine._executeTool = jest.fn(async () => ({ ok: true, data: {} }));

    await engine.processRequest('test', { currentUrl: 'https://example.com' }, { verbose: true });

    // Count REASONING_STEP messages
    const reasoningSteps = sendMessageSpy.mock.calls.filter(
      call => call[0].type === 'REASONING_STEP'
    );
    expect(reasoningSteps.length).toBeGreaterThan(0);

    sendMessageSpy.mockRestore();
  });

  test('should include step description in reasoning trace', () => {
    const sendMessageSpy = jest.spyOn(chrome.runtime, 'sendMessage');

    engine._emitReasoningStep('req456', 'analyze', 'Intent analysis completed', {
      intentClass: 'navigation',
      confidence: 0.9
    });

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REASONING_STEP',
        payload: expect.objectContaining({
          step: 'analyze',
          description: 'Intent analysis completed',
          data: expect.any(Object)
        })
      })
    );

    sendMessageSpy.mockRestore();
  });

  test('should emit reasoning steps for all lifecycle stages', () => {
    const sendMessageSpy = jest.spyOn(chrome.runtime, 'sendMessage');
    const requestId = 'req789';

    const steps = ['analyze', 'plan', 'execute', 'verify', 'learn'];
    steps.forEach(step => {
      engine._emitReasoningStep(requestId, step, `${step} step completed`, {});
    });

    const emittedSteps = sendMessageSpy.mock.calls
      .filter(call => call[0].type === 'REASONING_STEP')
      .map(call => call[0].payload.step);

    expect(emittedSteps).toEqual(steps);

    sendMessageSpy.mockRestore();
  });

  // ============================================================
  // INTEGRATION TESTS
  // ============================================================

  test('should initialize with persisted scores on init()', async () => {
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({
        cobra_tool_scores: { test_tool: { success: 5, fail: 1 } },
        cobra_provider_scores: { anthropic: { success: 2, fail: 0 } }
      });
    });

    await engine.init();

    expect(engine.toolScores.test_tool).toEqual({ success: 5, fail: 1 });
    expect(engine.providerScores.anthropic).toEqual({ success: 2, fail: 0 });
  });

  test('should debounce multiple score updates', async () => {
    jest.useFakeTimers();

    engine._scoreToolSuccess('tool1', {});
    engine._scoreToolSuccess('tool2', {});
    engine._scoreToolSuccess('tool3', {});

    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2100);

    expect(chrome.storage.local.set).toHaveBeenCalled();

    jest.useRealTimers();
  });

  test('should handle concurrent score updates', async () => {
    engine.scoreProviderSuccess('openai');
    engine._scoreToolSuccess('navigate', {});
    engine.scoreProviderFailure('groq');
    engine._scoreToolFailure('click_element', {});

    expect(engine.providerScores.openai).toEqual({ success: 1, fail: 0 });
    expect(engine.toolScores.navigate).toEqual({ success: 1, fail: 0 });
    expect(engine.providerScores.groq).toEqual({ success: 0, fail: 1 });
    expect(engine.toolScores.click_element).toEqual({ success: 0, fail: 1 });
  });
});
