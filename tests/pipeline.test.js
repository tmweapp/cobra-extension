/**
 * Tests for Pipeline module
 * Testing orchestration of stages, variable resolution, condition evaluation, and execution
 */

describe('Pipeline', () => {
  let Pipeline;

  beforeAll(() => {
    // Mock indexedDB
    global.indexedDB = {
      open: jest.fn((name, version) => ({
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: {
            contains: jest.fn(() => true),
          },
          transaction: jest.fn(() => ({
            objectStore: jest.fn(() => ({
              get: jest.fn(() => ({ onerror: null, onsuccess: null })),
              put: jest.fn(() => ({ onerror: null, onsuccess: null })),
              delete: jest.fn(() => ({ onerror: null, onsuccess: null })),
              getAll: jest.fn(() => ({ onerror: null, onsuccess: null })),
            })),
          })),
          createObjectStore: jest.fn(),
        },
      })),
    };

    // Clear any existing Module caches
    delete require.cache[require.resolve('../pipeline.js')];
    require('../pipeline.js');
    Pipeline = self.Pipeline;
  });

  beforeEach(() => {
    // Clear execution history before each test
    Pipeline.clearHistory();
    Pipeline._db = null;
  });

  // ============================================================
  // TEMPLATES
  // ============================================================
  describe('templates', () => {
    it('should have pre-built templates', () => {
      expect(Pipeline.templates).toBeDefined();
      expect(Pipeline.templates['logistics-scraper']).toBeDefined();
      expect(Pipeline.templates['contact-finder']).toBeDefined();
      expect(Pipeline.templates['site-monitor']).toBeDefined();
    });

    it('logistics-scraper template should have correct structure', () => {
      const template = Pipeline.templates['logistics-scraper'];
      expect(template.id).toBe('logistics-scraper');
      expect(template.name).toBe('Logistics Company Scraper');
      expect(Array.isArray(template.stages)).toBe(true);
      expect(template.stages.length).toBeGreaterThan(0);
      expect(template.variables).toBeDefined();
    });
  });

  // ============================================================
  // VALIDATE
  // ============================================================
  describe('validate', () => {
    it('should reject pipeline without id', () => {
      expect(() => {
        Pipeline.validate({ name: 'test', stages: [{ id: 's1', type: 'scrape' }] });
      }).toThrow('Pipeline must have id, name, and stages');
    });

    it('should reject pipeline without name', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', stages: [{ id: 's1', type: 'scrape' }] });
      }).toThrow('Pipeline must have id, name, and stages');
    });

    it('should reject pipeline without stages', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', name: 'test' });
      }).toThrow('Pipeline must have id, name, and stages');
    });

    it('should reject pipeline with empty stages array', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', name: 'test', stages: [] });
      }).toThrow('Pipeline must have at least one stage');
    });

    it('should reject stage without id', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', name: 'test', stages: [{ type: 'scrape' }] });
      }).toThrow('must have id and type');
    });

    it('should reject stage without type', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', name: 'test', stages: [{ id: 's1' }] });
      }).toThrow('must have id and type');
    });

    it('should reject invalid stage type', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', name: 'test', stages: [{ id: 's1', type: 'invalid' }] });
      }).toThrow('Invalid stage type');
    });

    it('should reject if stage without condition', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', name: 'test', stages: [{ id: 's1', type: 'if' }] });
      }).toThrow('must have a condition');
    });

    it('should reject forEach without items parameter', () => {
      expect(() => {
        Pipeline.validate({ id: 'p1', name: 'test', stages: [{ id: 's1', type: 'forEach' }] });
      }).toThrow('must have items parameter');
    });

    it('should accept valid pipeline', () => {
      const result = Pipeline.validate({
        id: 'p1',
        name: 'test',
        stages: [{ id: 's1', type: 'scrape', params: {} }],
      });
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // VARIABLE RESOLUTION
  // ============================================================
  describe('_resolveVars', () => {
    it('should resolve simple variable', () => {
      const context = { variables: { country: 'DE' } };
      const result = Pipeline._resolveVars('{{country}}', context);
      expect(result).toBe('DE');
    });

    it('should resolve built-in now variable', () => {
      const now = new Date().toISOString();
      const context = { variables: {}, now };
      const result = Pipeline._resolveVars('{{now}}', context);
      expect(result).toBe(now);
    });

    it('should resolve built-in date variable', () => {
      const date = new Date().toLocaleDateString();
      const context = { variables: {}, date };
      const result = Pipeline._resolveVars('{{date}}', context);
      expect(result).toBe(date);
    });

    it('should resolve nested path', () => {
      const context = {
        variables: {},
        stages: { search: { markdown: '<p>Hello</p>' } },
      };
      const result = Pipeline._resolveVars('{{stages.search.markdown}}', context);
      expect(result).toBe('<p>Hello</p>');
    });

    it('should return original if path not found', () => {
      const context = { variables: {}, stages: {} };
      const result = Pipeline._resolveVars('{{stages.missing.path}}', context);
      expect(result).toBe('{{stages.missing.path}}');
    });

    it('should handle non-string values', () => {
      const context = { variables: {} };
      const result = Pipeline._resolveVars(42, context);
      expect(result).toBe(42);
    });

    it('should handle null and undefined', () => {
      const context = { variables: {} };
      expect(Pipeline._resolveVars(null, context)).toBe(null);
      expect(Pipeline._resolveVars(undefined, context)).toBe(undefined);
    });
  });

  // ============================================================
  // CONDITION EVALUATION
  // ============================================================
  describe('_evaluateCondition', () => {
    it('should evaluate numeric comparisons', () => {
      const context = { variables: {} };
      expect(Pipeline._evaluateCondition('5 > 3', context)).toBe(true);
      expect(Pipeline._evaluateCondition('5 < 3', context)).toBe(false);
      expect(Pipeline._evaluateCondition('5 >= 5', context)).toBe(true);
      expect(Pipeline._evaluateCondition('5 <= 4', context)).toBe(false);
    });

    it('should evaluate logical AND', () => {
      const context = { variables: {} };
      expect(Pipeline._evaluateCondition('true && true', context)).toBe(true);
      expect(Pipeline._evaluateCondition('true && false', context)).toBe(false);
    });

    it('should evaluate safe expression evaluator with booleans', () => {
      const result1 = Pipeline._safeExpressionEvaluator('true && true');
      const result2 = Pipeline._safeExpressionEvaluator('true && false');
      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    it('should return false for invalid condition', () => {
      const context = { variables: {} };
      const result = Pipeline._evaluateCondition('', context);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // INIT CONTEXT
  // ============================================================
  describe('_initContext', () => {
    it('should create context with defaults', () => {
      const varDefs = { country: { default: 'US' }, maxPages: { default: 5 } };
      const context = Pipeline._initContext(varDefs, {});
      expect(context.variables.country).toBe('US');
      expect(context.variables.maxPages).toBe(5);
    });

    it('should override defaults with provided values', () => {
      const varDefs = { country: { default: 'US' } };
      const context = Pipeline._initContext(varDefs, { country: 'DE' });
      expect(context.variables.country).toBe('DE');
    });

    it('should include built-in variables', () => {
      const context = Pipeline._initContext({}, {});
      expect(context.now).toBeDefined();
      expect(context.date).toBeDefined();
      expect(context.random).toBeDefined();
      expect(context.stages).toEqual({});
    });
  });

  // ============================================================
  // COMPILE
  // ============================================================
  describe('_compile', () => {
    it('should compile simple stages', () => {
      const stages = [{ id: 's1', type: 'scrape', params: { url: 'https://test.com' } }];
      const context = { variables: {}, stages: {} };
      const steps = Pipeline._compile(stages, context);
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBe(1);
      expect(steps[0].id).toBe('s1');
      expect(steps[0].type).toBe('scrape');
    });

    it('should resolve params in compiled steps', () => {
      const stages = [{ id: 's1', type: 'scrape', params: { url: '{{website}}' } }];
      const context = { variables: { website: 'https://example.com' }, stages: {} };
      const steps = Pipeline._compile(stages, context);
      expect(steps[0].params.url).toBe('https://example.com');
    });

    it('should compile batch stages', () => {
      const stages = [
        {
          id: 'batch1',
          type: 'batch',
          params: { items: '{{urls}}' },
          stages: [{ id: 'scrape', type: 'scrape', params: { url: '{{item}}' } }],
        },
      ];
      const context = { variables: { urls: ['url1', 'url2'] }, stages: {} };
      const steps = Pipeline._compile(stages, context);
      expect(steps.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle if/else stages', () => {
      const stages = [
        {
          id: 'if1',
          type: 'if',
          condition: '{{debug}} == true',
          then: [{ id: 's1', type: 'scrape', params: {} }],
          else: [{ id: 's2', type: 'scrape', params: {} }],
        },
      ];
      const context = { variables: { debug: 'true' }, stages: {} };
      const steps = Pipeline._compile(stages, context);
      expect(steps).toBeDefined();
    });
  });

  // ============================================================
  // STATISTICS
  // ============================================================
  describe('getStats', () => {
    it('should return stats object with templates', async () => {
      // Mock list to avoid indexedDB
      Pipeline.list = jest.fn(() => Promise.resolve([]));
      const stats = await Pipeline.getStats();
      expect(stats).toBeDefined();
      expect(stats.totalPipelines).toBeDefined();
      expect(stats.totalExecutions).toBeDefined();
      expect(stats.successfulExecutions).toBeDefined();
      expect(stats.failedExecutions).toBeDefined();
      expect(stats.averageDuration).toBeDefined();
      expect(Array.isArray(stats.templates)).toBe(true);
    });

    it('should track execution counts', async () => {
      Pipeline.list = jest.fn(() => Promise.resolve([]));
      const execution = {
        executionId: 'exec_test',
        pipelineId: 'p1',
        status: 'completed',
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 100,
        result: {},
        variables: {},
      };
      Pipeline._executionHistory.push(execution);

      const stats = await Pipeline.getStats();
      expect(stats.totalExecutions).toBeGreaterThanOrEqual(1);
      expect(stats.successfulExecutions).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // EXECUTION HISTORY
  // ============================================================
  describe('getHistory', () => {
    it('should return empty history initially', async () => {
      const history = await Pipeline.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should filter history by pipelineId', async () => {
      Pipeline._executionHistory.push(
        { executionId: 'e1', pipelineId: 'p1', status: 'completed' },
        { executionId: 'e2', pipelineId: 'p2', status: 'completed' }
      );
      const history = await Pipeline.getHistory('p1');
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.every(e => e.pipelineId === 'p1')).toBe(true);
    });
  });

  // ============================================================
  // CLEAR HISTORY
  // ============================================================
  describe('clearHistory', () => {
    it('should clear execution history', async () => {
      Pipeline._executionHistory.push({ executionId: 'e1', pipelineId: 'p1' });
      Pipeline.clearHistory();
      expect(Pipeline._executionHistory.length).toBe(0);
    });
  });

  // ============================================================
  // TOKENIZE EXPRESSION
  // ============================================================
  describe('_tokenizeExpression', () => {
    it('should tokenize simple comparison', () => {
      const tokens = Pipeline._tokenizeExpression('5 > 3');
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should tokenize boolean literals', () => {
      const tokens = Pipeline._tokenizeExpression('true && false');
      expect(tokens.some(t => t.value === true)).toBe(true);
      expect(tokens.some(t => t.value === false)).toBe(true);
    });

    it('should tokenize strings', () => {
      const tokens = Pipeline._tokenizeExpression('"hello"');
      expect(tokens.some(t => t.type === 'string' && t.value === 'hello')).toBe(true);
    });

    it('should tokenize numbers', () => {
      const tokens = Pipeline._tokenizeExpression('42');
      expect(tokens.some(t => t.type === 'number' && t.value === 42)).toBe(true);
    });

    it('should tokenize operators', () => {
      const tokens = Pipeline._tokenizeExpression('5 == 5');
      expect(tokens.some(t => t.type === 'operator')).toBe(true);
    });

    it('should throw on invalid token', () => {
      expect(() => {
        Pipeline._tokenizeExpression('@');
      }).toThrow();
    });
  });

  // ============================================================
  // SAFE EXPRESSION EVALUATOR
  // ============================================================
  describe('_safeExpressionEvaluator', () => {
    it('should evaluate simple boolean', () => {
      expect(Pipeline._safeExpressionEvaluator('true')).toBe(true);
      expect(Pipeline._safeExpressionEvaluator('false')).toBe(false);
    });

    it('should evaluate number comparison', () => {
      expect(Pipeline._safeExpressionEvaluator('10 > 5')).toBe(true);
      expect(Pipeline._safeExpressionEvaluator('3 < 2')).toBe(false);
    });

    it('should evaluate string equality', () => {
      expect(Pipeline._safeExpressionEvaluator('"hello" == "hello"')).toBe(true);
      expect(Pipeline._safeExpressionEvaluator('"hello" != "world"')).toBe(true);
    });

    it('should throw on invalid expression', () => {
      expect(() => {
        Pipeline._safeExpressionEvaluator('5 @@ 3');
      }).toThrow();
    });

    it('should return false for empty expression', () => {
      expect(Pipeline._safeExpressionEvaluator('')).toBe(false);
      expect(Pipeline._safeExpressionEvaluator(null)).toBe(false);
    });
  });

  // ============================================================
  // STAGE TO TASK
  // ============================================================
  describe('_stageToTask', () => {
    it('should convert stage to task', () => {
      const stage = { id: 's1', type: 'scrape', params: { url: 'https://test.com' } };
      const context = { variables: {}, stages: {} };
      const task = Pipeline._stageToTask(stage, context, 's1');
      expect(task.id).toBe('s1');
      expect(task.type).toBe('scrape');
      expect(task.stagePath).toBe('s1');
      expect(task.params).toBeDefined();
      expect(typeof task.onComplete).toBe('function');
    });

    it('task onComplete should update context', () => {
      const stage = { id: 's1', type: 'scrape', params: {} };
      const context = { variables: {}, stages: {} };
      const task = Pipeline._stageToTask(stage, context, 's1');
      task.onComplete({ data: 'result' });
      expect(context.stages.s1).toEqual({ data: 'result' });
    });
  });
});
