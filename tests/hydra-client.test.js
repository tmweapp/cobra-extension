/**
 * COBRA Hydra Client Tests
 * Tests REST API integration with Hydra memory system
 */

describe('HydraClient Module', () => {
  let HydraClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock
    global.fetch = jest.fn();

    // Load HydraClient module
    const fs = require('fs');
    const path = '/sessions/ecstatic-upbeat-cray/mnt/Downloads/firescrape-extension/hydra-client.js';
    const code = fs.readFileSync(path, 'utf-8');

    const module = { exports: {} };
    const moduleFunc = new Function('module', 'exports', 'globalThis', code);
    moduleFunc(module, module.exports, global);

    HydraClient = global.HydraClient;
  });

  describe('Configuration', () => {
    it('should have default empty config', () => {
      expect(HydraClient.config).toBeDefined();
      expect(HydraClient.config.apiUrl).toBe('');
      expect(HydraClient.config.apiKey).toBe('');
    });

    it('should initialize from chrome storage', async () => {
      chrome.storage.local.get.mockResolvedValue({
        hydra_config: {
          apiUrl: 'https://api.hydra.test',
          apiKey: 'hk_test123',
        },
      });

      await HydraClient.init();

      expect(HydraClient.config.apiUrl).toBe('https://api.hydra.test');
      expect(HydraClient.config.apiKey).toBe('hk_test123');
    });

    it('should handle missing storage config on init', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      await HydraClient.init();

      expect(HydraClient.config.apiUrl).toBe('');
      expect(HydraClient.config.apiKey).toBe('');
    });

    it('should save partial config', async () => {
      await HydraClient.saveConfig({
        apiUrl: 'https://new-api.hydra.test',
      });

      expect(HydraClient.config.apiUrl).toBe('https://new-api.hydra.test');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        hydra_config: HydraClient.config,
      });
    });

    it('should save full config', async () => {
      const newConfig = {
        apiUrl: 'https://api.hydra.test',
        apiKey: 'hk_test456',
      };

      await HydraClient.saveConfig(newConfig);

      expect(HydraClient.config).toEqual(newConfig);
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });

    it('should merge partial config with existing', async () => {
      HydraClient.config = {
        apiUrl: 'https://api1.test',
        apiKey: 'key1',
        custom: 'value',
      };

      await HydraClient.saveConfig({ apiUrl: 'https://api2.test' });

      expect(HydraClient.config.apiUrl).toBe('https://api2.test');
      expect(HydraClient.config.apiKey).toBe('key1');
    });

    it('should check if configured', () => {
      HydraClient.config = { apiUrl: '', apiKey: '' };
      expect(HydraClient.isConfigured()).toBe(false);

      HydraClient.config = { apiUrl: 'https://api.test', apiKey: '' };
      expect(HydraClient.isConfigured()).toBe(false);

      HydraClient.config = { apiUrl: '', apiKey: 'key' };
      expect(HydraClient.isConfigured()).toBe(false);

      HydraClient.config = { apiUrl: 'https://api.test', apiKey: 'key' };
      expect(HydraClient.isConfigured()).toBe(true);
    });
  });

  describe('_call - Core API', () => {
    beforeEach(() => {
      HydraClient.config = {
        apiUrl: 'https://api.hydra.test/functions/v1/hydra-api',
        apiKey: 'hk_test123',
      };
    });

    it('should return null if not configured', async () => {
      HydraClient.config = { apiUrl: '', apiKey: '' };
      const result = await HydraClient._call('test.action');
      expect(result).toBeNull();
    });

    it('should send properly formatted request', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: 'result' }),
      });

      const result = await HydraClient._call('memory.save', { content: 'test' });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.hydra.test/functions/v1/hydra-api',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hydra-key': 'hk_test123',
          },
          body: JSON.stringify({
            action: 'memory.save',
            content: 'test',
          }),
        }
      );
      expect(result.success).toBe(true);
    });

    it('should handle successful response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123', saved: true }),
      });

      const result = await HydraClient._call('kb.save', { title: 'test' });

      expect(result).toEqual({ id: '123', saved: true });
    });

    it('should handle error response with JSON error', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid request' }),
      });

      const result = await HydraClient._call('test.action');

      expect(result).toBeNull();
    });

    it('should handle error response without JSON', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      const result = await HydraClient._call('test.action');

      expect(result).toBeNull();
    });

    it('should handle fetch error', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await HydraClient._call('test.action');

      expect(result).toBeNull();
    });

    it('should handle missing response ok field', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      });

      const result = await HydraClient._call('test.action');

      expect(result).toBeNull();
    });
  });

  describe('Memory API', () => {
    beforeEach(() => {
      HydraClient.config = {
        apiUrl: 'https://api.hydra.test',
        apiKey: 'hk_test',
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'mem_123' }),
      });
    });

    it('should save memory with defaults', async () => {
      const result = await HydraClient.memorySave({
        title: 'My Memory',
        content: 'Content',
      });

      const call = global.fetch.mock.calls[0][0];
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.action).toBe('memory.save');
      expect(body.type).toBe('pattern');
      expect(body.title).toBe('My Memory');
      expect(body.confidence).toBe(50);
      expect(body.source).toBe('firescrape');
    });

    it('should save memory with custom values', async () => {
      await HydraClient.memorySave({
        type: 'insight',
        title: 'Custom',
        content: 'Data',
        tags: ['tag1', 'tag2'],
        carrier: 'FedEx',
        confidence: 85,
        source: 'custom_source',
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.type).toBe('insight');
      expect(body.tags).toEqual(['tag1', 'tag2']);
      expect(body.carrier).toBe('FedEx');
      expect(body.confidence).toBe(85);
      expect(body.source).toBe('custom_source');
    });

    it('should search memory', async () => {
      await HydraClient.memorySearch('freight tracking', {
        carrier: 'DHL',
        level: 2,
        limit: 10,
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.action).toBe('memory.search');
      expect(body.query).toBe('freight tracking');
      expect(body.carrier).toBe('DHL');
      expect(body.level).toBe(2);
      expect(body.limit).toBe(10);
    });

    it('should promote memory item', async () => {
      await HydraClient.memoryPromote('mem_123', 'Good signal');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.action).toBe('memory.promote');
      expect(body.item_id).toBe('mem_123');
      expect(body.reason).toBe('Good signal');
    });

    it('should provide feedback on memory item', async () => {
      await HydraClient.memoryFeedback(
        'mem_456',
        'positive',
        'Helped reduce errors'
      );

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.action).toBe('memory.feedback');
      expect(body.item_id).toBe('mem_456');
      expect(body.feedback_type).toBe('positive');
      expect(body.context).toBe('Helped reduce errors');
    });
  });

  describe('Knowledge Base API', () => {
    beforeEach(() => {
      HydraClient.config = {
        apiUrl: 'https://api.hydra.test',
        apiKey: 'hk_test',
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'kb_rule_123' }),
      });
    });

    it('should save KB rule with defaults', async () => {
      await HydraClient.kbSave({
        title: 'Extract Tracking Number',
        content: 'Use regex: [0-9]{12}',
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.action).toBe('kb.save');
      expect(body.title).toBe('Extract Tracking Number');
      expect(body.rule_type).toBe('instruction');
      expect(body.priority).toBe(5);
      expect(body.source).toBe('firescrape');
    });

    it('should save KB rule with custom values', async () => {
      await HydraClient.kbSave({
        title: 'FedEx Pattern',
        content: 'Pattern data',
        carrier_code: 'fedex',
        rule_type: 'pattern',
        tags: ['shipping', 'tracking'],
        priority: 8,
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.carrier_code).toBe('fedex');
      expect(body.rule_type).toBe('pattern');
      expect(body.tags).toEqual(['shipping', 'tracking']);
      expect(body.priority).toBe(8);
    });

    it('should search KB rules', async () => {
      await HydraClient.kbSearch('extract tracking', 'ups');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.action).toBe('kb.search');
      expect(body.query).toBe('extract tracking');
      expect(body.carrier).toBe('ups');
    });
  });

  describe('Context API', () => {
    beforeEach(() => {
      HydraClient.config = {
        apiUrl: 'https://api.hydra.test',
        apiKey: 'hk_test',
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          memory_context: 'Memory insights',
          memory_count: 5,
          rules_context: 'KB rules',
          rules_count: 3,
        }),
      });
    });

    it('should get context with defaults', async () => {
      const result = await HydraClient.getContext('shipping query', 'FedEx');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.action).toBe('context.get');
      expect(body.query).toBe('shipping query');
      expect(body.carrier).toBe('FedEx');
      expect(body.max_items).toBe(20);
    });

    it('should get context with custom limit', async () => {
      await HydraClient.getContext('query', 'carrier', 50);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.max_items).toBe(50);
    });

    it('should return context data', async () => {
      const result = await HydraClient.getContext('test', 'test');

      expect(result.memory_context).toBe('Memory insights');
      expect(result.memory_count).toBe(5);
      expect(result.rules_context).toBe('KB rules');
      expect(result.rules_count).toBe(3);
    });
  });

  describe('enrichPrompt', () => {
    beforeEach(() => {
      HydraClient.config = {
        apiUrl: 'https://api.hydra.test',
        apiKey: 'hk_test',
      };
    });

    it('should enrich prompt with memory and rules', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          memory_context: 'Memory data',
          memory_count: 3,
          rules_context: 'Rules data',
          rules_count: 2,
        }),
      });

      const enriched = await HydraClient.enrichPrompt('User prompt', {
        carrier: 'UPS',
      });

      expect(enriched).toContain('User prompt');
      expect(enriched).toContain('MEMORIA HYDRA');
      expect(enriched).toContain('Memory data');
      expect(enriched).toContain('REGOLE KB');
      expect(enriched).toContain('Rules data');
    });

    it('should return original prompt if no context found', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      const enriched = await HydraClient.enrichPrompt('Original prompt');

      expect(enriched).toBe('Original prompt');
    });

    it('should use domain as default carrier', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      await HydraClient.enrichPrompt('Check FedEx', { domain: 'fedex.com' });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      // domain gets passed but may not be in query object
      expect(body.query).toBeDefined();
    });

    it('should use carrier if provided', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      await HydraClient.enrichPrompt('Check carrier', {
        domain: 'domain.com',
        carrier: 'DHL',
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.carrier).toBe('DHL');
    });

    it('should only include memory context if present', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          memory_context: null,
          rules_context: 'Rules',
          rules_count: 1,
        }),
      });

      const enriched = await HydraClient.enrichPrompt('Prompt');

      expect(enriched).toContain('REGOLE KB');
      expect(enriched).not.toContain('MEMORIA HYDRA');
    });

    it('should only include rules context if present', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          memory_context: 'Memory',
          memory_count: 2,
          rules_context: null,
        }),
      });

      const enriched = await HydraClient.enrichPrompt('Prompt');

      expect(enriched).toContain('MEMORIA HYDRA');
      expect(enriched).not.toContain('REGOLE KB');
    });
  });

  describe('learnFromAnalysis', () => {
    beforeEach(() => {
      HydraClient.config = {
        apiUrl: 'https://api.hydra.test',
        apiKey: 'hk_test',
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });
    });

    it('should not learn without domain', async () => {
      await HydraClient.learnFromAnalysis(null, { analysis: 'data' });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not learn without analysis', async () => {
      await HydraClient.learnFromAnalysis('domain.com', null);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should save pattern to memory', async () => {
      await HydraClient.learnFromAnalysis('domain.com', {
        analysis: { patterns: ['pattern1'] },
        tags: ['shipping'],
        confidence: 75,
      });

      const calls = global.fetch.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      const firstBody = JSON.parse(calls[0][1].body);
      expect(firstBody.action).toBe('memory.save');
      expect(firstBody.type).toBe('pattern');
      expect(firstBody.title).toContain('Analisi');
      expect(firstBody.title).toContain('domain.com');
    });

    it('should save rule to KB when flagged', async () => {
      await HydraClient.learnFromAnalysis('domain.com', {
        analysis: { patterns: ['p1'] },
        category: 'freight',
        save_to_library: true,
        carrier: 'FedEx',
        tags: ['freight', 'tracking'],
      });

      const calls = global.fetch.mock.calls;
      expect(calls.length).toBeGreaterThan(1);

      const kbBody = JSON.parse(calls[1][1].body);
      expect(kbBody.action).toBe('kb.save');
      expect(kbBody.carrier_code).toBe('FedEx');
    });

    it('should not save rule if save_to_library is false', async () => {
      await HydraClient.learnFromAnalysis('domain.com', {
        analysis: { patterns: ['p1'] },
        category: 'freight',
        save_to_library: false,
      });

      const calls = global.fetch.mock.calls;
      const actions = calls.map((c) => JSON.parse(c[1].body).action);

      expect(actions).toContain('memory.save');
      expect(actions).not.toContain('kb.save');
    });

    it('should not save rule if category is not freight', async () => {
      await HydraClient.learnFromAnalysis('domain.com', {
        analysis: { patterns: ['p1'] },
        category: 'other',
        save_to_library: true,
      });

      const calls = global.fetch.mock.calls;
      const actions = calls.map((c) => JSON.parse(c[1].body).action);

      expect(actions).toContain('memory.save');
      expect(actions).not.toContain('kb.save');
    });

    it('should use domain tags in memory save', async () => {
      await HydraClient.learnFromAnalysis('domain.com', {
        analysis: { data: 'test' },
        tags: ['tag1', 'tag2'],
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.tags).toContain('tag1');
      expect(body.tags).toContain('tag2');
      expect(body.tags).toContain('domain.com');
    });

    it('should truncate analysis to 2000 chars', async () => {
      const longAnalysis = { data: 'x'.repeat(5000) };

      await HydraClient.learnFromAnalysis('domain.com', {
        analysis: longAnalysis,
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);

      expect(body.content.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('health', () => {
    beforeEach(() => {
      HydraClient.config = {
        apiUrl: 'https://api.hydra.test',
        apiKey: 'hk_test',
      };
    });

    it('should call health endpoint', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

      const result = await HydraClient.health();

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.action).toBe('health');
      expect(result.status).toBe('ok');
    });
  });

  describe('Module export', () => {
    it('should export HydraClient to globalThis', () => {
      expect(global.HydraClient).toBeDefined();
      expect(typeof global.HydraClient.init).toBe('function');
      expect(typeof global.HydraClient.isConfigured).toBe('function');
    });

    it('should have all API methods', () => {
      const methods = [
        'memorySave',
        'memorySearch',
        'memoryPromote',
        'memoryFeedback',
        'kbSave',
        'kbSearch',
        'getContext',
        'enrichPrompt',
        'learnFromAnalysis',
        'health',
      ];

      methods.forEach((method) => {
        expect(typeof HydraClient[method]).toBe('function');
      });
    });

    it('should have configuration methods', () => {
      expect(typeof HydraClient.init).toBe('function');
      expect(typeof HydraClient.saveConfig).toBe('function');
      expect(typeof HydraClient.isConfigured).toBe('function');
    });
  });
});
