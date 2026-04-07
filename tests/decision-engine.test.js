// Tests for decision-engine.js — DecisionEngine class
require('./setup.js');
require('../decision-engine.js');
const DecisionEngine = global.DecisionEngine;

describe('DecisionEngine — constructor and initialization', () => {
  test('DecisionEngine constructor initializes properties', () => {
    const kb = {};
    const gate = {};
    const conversation = {};

    const engine = new DecisionEngine(kb, gate, conversation);

    expect(engine.kb).toBe(kb);
    expect(engine.gate).toBe(gate);
    expect(engine.conversation).toBe(conversation);
    expect(engine.toolScores).toEqual({});
    expect(engine.MAX_STRATEGY_ATTEMPTS).toBe(3);
    expect(engine.MAX_TOTAL_TOOL_CALLS).toBe(20);
    expect(engine.MAX_TIMEOUT_MS).toBe(120000);
  });
});

describe('DecisionEngine.analyze() — Intent classification', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
  });

  test('analyze() classifies navigation intent', async () => {
    const result = await global.engine.analyze('naviga a https://example.com', {});
    expect(result.intentClass).toBe('navigation');
    expect(result.entities.url).toBe('https://example.com');
    expect(result.confidence).toBe(0.9);
  });

  test('analyze() classifies form_fill intent', async () => {
    const result = await global.engine.analyze('compila il form con i dati', {});
    expect(result.intentClass).toBe('form_fill');
    expect(result.confidence).toBe(0.8);
  });

  test('analyze() classifies search intent', async () => {
    const result = await global.engine.analyze('cerca "query test" su google', {});
    expect(result.intentClass).toBe('search');
    expect(result.entities.query).toContain('query');
    expect(result.confidence).toBe(0.85);
  });

  test('analyze() classifies extract intent', async () => {
    const result = await global.engine.analyze('estrai i dati dalla pagina', {});
    expect(result.intentClass).toBe('extract');
    expect(result.confidence).toBe(0.75);
  });

  test('analyze() classifies interaction intent', async () => {
    const result = await global.engine.analyze('clicca il pulsante', {});
    expect(result.intentClass).toBe('interaction');
    expect(result.confidence).toBe(0.8);
  });

  test('analyze() defaults to conversation intent', async () => {
    const result = await global.engine.analyze('hello world', {});
    expect(result.intentClass).toBe('conversation');
    expect(result.confidence).toBe(0.6);
  });

  test('analyze() extracts URL from navigation message', async () => {
    const result = await global.engine.analyze('vai a www.example.com/page', {});
    expect(result.entities.url).toContain('www.example.com');
  });

  test('analyze() includes KB domain rules in analysis', async () => {
    const kb = {
      searchByDomain: jest.fn().mockReturnValue([
        { operationType: 'form_fill', priority: 8 }
      ])
    };
    const engine = new DecisionEngine(kb, {}, {});

    const result = await engine.analyze('compila form', { currentUrl: 'https://test.com' });
    expect(kb.searchByDomain).toHaveBeenCalled();
    expect(result.domainRules.length).toBeGreaterThan(0);
  });
});

describe('DecisionEngine.createPlan() — Strategy planning', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
  });

  test('createPlan() generates steps for navigation intent', () => {
    const analysis = {
      intentClass: 'navigation',
      entities: { url: 'https://example.com' },
      domainRules: [],
      context: {}
    };

    const plan = global.engine.createPlan(analysis, []);

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].tool).toBe('navigate');
    expect(plan.priority).toBe('high');
  });

  test('createPlan() generates alternative strategy on retry', () => {
    const analysis = {
      intentClass: 'navigation',
      entities: { url: 'https://example.com' },
      domainRules: [],
      context: {}
    };

    const plan1 = global.engine.createPlan(analysis, []);
    const plan2 = global.engine.createPlan(analysis, [{ attempt: 0 }]);

    // Second strategy should be different
    expect(plan2.steps[0].tool).not.toBe(plan1.steps[0].tool);
  });

  test('createPlan() sets priority based on intent', () => {
    const analysis = {
      intentClass: 'conversation',
      entities: {},
      domainRules: [],
      context: {}
    };

    const plan = global.engine.createPlan(analysis, []);
    expect(plan.priority).toBe('low');
  });

  test('createPlan() estimates time based on steps', () => {
    const analysis = {
      intentClass: 'search',
      entities: { query: 'test' },
      domainRules: [],
      context: {}
    };

    const plan = global.engine.createPlan(analysis, []);
    expect(plan.estimatedTime).toBeGreaterThan(0);
  });

  test('createPlan() handles form_fill with multiple strategies', () => {
    const analysis = {
      intentClass: 'form_fill',
      entities: {},
      domainRules: [],
      context: {}
    };

    const plan0 = global.engine.createPlan(analysis, []);
    const plan1 = global.engine.createPlan(analysis, [{ attempt: 0 }]);
    const plan2 = global.engine.createPlan(analysis, [{ attempt: 0 }, { attempt: 1 }]);

    // All three strategies should differ
    expect(plan0.strategyAttempt).toBe(0);
    expect(plan1.strategyAttempt).toBe(1);
    expect(plan2.strategyAttempt).toBe(2);
  });
});

describe('DecisionEngine.verify() — Result verification', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
  });

  test('verify() scores 0.95 for error-free results', async () => {
    const result = { success: true, completedSteps: 5, totalSteps: 5, actions: [] };
    const analysis = { intentClass: 'navigation' };

    const verified = await global.engine.verify(result, analysis, {});
    expect(verified.score).toBe(0.95);
    expect(verified.success).toBe(true);
  });

  test('verify() scores based on step completion ratio', async () => {
    const result = { success: false, completedSteps: 3, totalSteps: 5, actions: [] };
    const analysis = { intentClass: 'search' };

    const verified = await global.engine.verify(result, analysis, {});
    expect(verified.score).toBe(0.6);
  });

  test('verify() boosts score for navigation with read_page final action', async () => {
    const result = {
      success: false,
      completedSteps: 2,
      totalSteps: 2,
      actions: [
        { tool: 'navigate' },
        { tool: 'read_page' }
      ]
    };
    const analysis = { intentClass: 'navigation' };

    const verified = await global.engine.verify(result, analysis, {});
    expect(verified.score).toBeGreaterThan(0.6);
  });

  test('verify() boosts score for form_fill with successful form action', async () => {
    const result = {
      success: false,
      completedSteps: 2,
      totalSteps: 2,
      actions: [
        { tool: 'get_page_elements' },
        { tool: 'fill_form' }
      ]
    };
    const analysis = { intentClass: 'form_fill' };

    const verified = await global.engine.verify(result, analysis, {});
    expect(verified.score).toBeGreaterThan(0.6);
  });

  test('verify() caps score at 1.0', async () => {
    const result = { success: true, completedSteps: 5, totalSteps: 5, actions: [] };
    const analysis = { intentClass: 'navigation' };

    const verified = await global.engine.verify(result, analysis, {});
    expect(verified.score).toBeLessThanOrEqual(1.0);
  });

  test('verify() returns success true when score > 0.7', async () => {
    const result = { success: true, completedSteps: 4, totalSteps: 5, actions: [] };
    const analysis = { intentClass: 'search' };

    const verified = await global.engine.verify(result, analysis, {});
    expect(verified.success).toBe(true);
  });
});

describe('DecisionEngine._shouldRetry() — Retry logic', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
  });

  test('_shouldRetry() returns false at max attempts', () => {
    const result = global.engine._shouldRetry(2, [], { score: 0.5 });
    expect(result).toBe(false);
  });

  test('_shouldRetry() returns false if all failures are same type', () => {
    const failed = [
      { reason: 'timeout', score: 0.2 },
      { reason: 'timeout', score: 0.1 }
    ];
    const result = global.engine._shouldRetry(0, failed, { score: 0.1 });
    expect(result).toBe(false);
  });

  test('_shouldRetry() returns false if score declining', () => {
    const failed = [
      { reason: 'error1', score: 0.5 },
      { reason: 'error2', score: 0.3 }
    ];
    const result = global.engine._shouldRetry(1, failed, { score: 0.3 });
    expect(result).toBe(false);
  });

  test('_shouldRetry() returns true if making progress', () => {
    const failed = [{ reason: 'error', score: 0.2 }];
    const result = global.engine._shouldRetry(0, failed, { score: 0.4 });
    expect(result).toBe(true);
  });

  test('_shouldRetry() allows one retry with 0 score', () => {
    const result = global.engine._shouldRetry(0, [], { score: 0 });
    expect(result).toBe(true);
  });
});

describe('DecisionEngine._diagnoseFailure() — Failure diagnosis', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
  });

  test('_diagnoseFailure() returns "no actions" if none executed', () => {
    const result = { actions: [] };
    const reason = global.engine._diagnoseFailure(result, {});
    expect(reason).toBe('nessuna azione eseguita');
  });

  test('_diagnoseFailure() extracts element not found error', () => {
    const result = {
      actions: [{ tool: 'click' }],
      errors: [{ error: 'elemento non trovato nel DOM' }]
    };
    const reason = global.engine._diagnoseFailure(result, {});
    expect(reason).toContain('non trovato');
  });

  test('_diagnoseFailure() extracts timeout error', () => {
    const result = {
      actions: [{ tool: 'navigate' }],
      errors: [{ error: 'timeout after 30s' }]
    };
    const reason = global.engine._diagnoseFailure(result, {});
    expect(reason).toContain('timeout');
  });

  test('_diagnoseFailure() reports incomplete steps', () => {
    const result = {
      actions: [{ tool: 'navigate' }],
      completedSteps: 1,
      totalSteps: 3,
      errors: []
    };
    const reason = global.engine._diagnoseFailure(result, {});
    expect(reason).toContain('1');
    expect(reason).toContain('3');
  });
});

describe('DecisionEngine.buildResponse() — Response building', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
  });

  test('buildResponse() indicates full success', () => {
    const result = { success: true, completedSteps: 3, totalSteps: 3, actions: [] };
    const verified = { score: 0.95 };
    const log = ['step1', 'step2', 'step3'];

    const response = global.engine.buildResponse(result, verified, log);
    expect(response.content).toContain('successo');
    expect(response.success).toBe(true);
  });

  test('buildResponse() indicates partial success', () => {
    const result = { success: false, completedSteps: 2, totalSteps: 3, actions: [] };
    const verified = { score: 0.67 };
    const log = ['step1', 'step2'];

    const response = global.engine.buildResponse(result, verified, log);
    expect(response.content).toContain('parzialmente');
    expect(response.content).toContain('2');
    expect(response.content).toContain('3');
  });

  test('buildResponse() includes errors when present', () => {
    const result = {
      success: false,
      completedSteps: 1,
      totalSteps: 2,
      actions: [],
      errors: [{ error: 'test error' }]
    };
    const verified = { score: 0.5 };
    const log = [];

    const response = global.engine.buildResponse(result, verified, log);
    expect(response.content).toContain('test error');
  });

  test('buildResponse() includes success percentage', () => {
    const result = { success: true, completedSteps: 3, totalSteps: 3, actions: [] };
    const verified = { score: 0.85 };
    const log = [];

    const response = global.engine.buildResponse(result, verified, log);
    expect(response.content).toContain('85');
  });
});

describe('DecisionEngine.loadToolScores() — Tool scoring', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
    jest.clearAllMocks();
  });

  test('loadToolScores() loads from storage', async () => {
    const scores = { 'tool1': { success: 5, fail: 2 } };
    global.chrome.storage.local.get = jest.fn((key, cb) => {
      cb({ cobra_tool_scores: scores });
    });

    await global.engine.loadToolScores();
    expect(global.engine.toolScores).toEqual(scores);
  });

  test('loadToolScores() defaults to empty object', async () => {
    global.chrome.storage.local.get = jest.fn((key, cb) => {
      cb({});
    });

    await global.engine.loadToolScores();
    expect(global.engine.toolScores).toEqual({});
  });
});

describe('DecisionEngine._scoreToolSuccess() and _scoreToolFailure()', () => {
  beforeEach(() => {
    const kb = { searchByDomain: () => [] };
    global.engine = new DecisionEngine(kb, {}, {});
  });

  test('_scoreToolSuccess() increments success counter', () => {
    global.engine._scoreToolSuccess('tool_test', {});
    expect(global.engine.toolScores['tool_test'].success).toBe(1);
  });

  test('_scoreToolFailure() increments fail counter', () => {
    global.engine._scoreToolFailure('tool_test', {});
    expect(global.engine.toolScores['tool_test'].fail).toBe(1);
  });

  test('_scoreToolSuccess() initializes if missing', () => {
    global.engine.toolScores = {};
    global.engine._scoreToolSuccess('new_tool', {});
    expect(global.engine.toolScores['new_tool']).toBeDefined();
  });
});
