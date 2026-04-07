// Tests for brain.js — Brain module and Library
require('./setup.js');
require('../brain.js');
const Brain = global.Brain;
const Library = global.Library;

describe('Brain — config and initialization', () => {
  beforeEach(() => {
    // Reset brain config
    Brain.config.claudeApiKey = '';
    Brain.config.supabaseUrl = '';
    Brain.config.supabaseKey = '';
    Brain.config.tokensUsedToday = 0;
    Brain._initPromise = null;
  });

  test('Brain.config has default values', () => {
    expect(Brain.config.claudeModel).toBe('claude-sonnet-4-20250514');
    expect(Brain.config.claudeMaxTokens).toBe(1024);
    expect(Brain.config.dailyTokenBudget).toBe(50000);
  });

  test('Brain.init() prevents race conditions on concurrent calls', async () => {
    const p1 = Brain.init();
    const p2 = Brain.init();
    const result = await Promise.all([p1, p2]);
    expect(result[0]).toBeUndefined();
    expect(result[1]).toBeUndefined();
  });

  test('Brain.updateConfig() merges partial config without clearing sensitive keys', async () => {
    Brain.config.claudeApiKey = 'secret-key';
    await Brain.updateConfig({ dailyTokenBudget: 100000, claudeApiKey: '' });
    // Empty string should not overwrite existing sensitive key
    expect(Brain.config.claudeApiKey).toBe('secret-key');
    expect(Brain.config.dailyTokenBudget).toBe(100000);
  });

  test('Brain.updateConfig() allows updating sensitive keys with non-empty values', async () => {
    await Brain.updateConfig({ claudeApiKey: 'new-key' });
    expect(Brain.config.claudeApiKey).toBe('new-key');
  });
});

describe('Brain.think() — Claude API calls with budget checks', () => {
  beforeEach(() => {
    Brain.config.claudeApiKey = 'test-key';
    Brain.config.tokensUsedToday = 0;
  });

  test('think() throws error if API key not configured', async () => {
    Brain.config.claudeApiKey = '';
    await expect(Brain.think('test')).rejects.toThrow(/API key Claude non configurata/);
  });

  test('think() throws error if daily token budget exhausted', async () => {
    Brain.config.tokensUsedToday = 50000;
    Brain.config.dailyTokenBudget = 50000;
    await expect(Brain.think('test')).rejects.toThrow(/Budget token giornaliero esaurito/);
  });

  test('think() builds prompt with URL and domain context', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ text: '{"raw":"response"}' }]
      })
    });

    const result = await Brain.think('analyze this', {
      url: 'https://example.com/page',
      domain: 'example.com'
    });

    const call = global.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.messages[0].content).toContain('https://example.com/page');
  });

  test('think() tracks token usage across calls', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ text: '{"raw":"response"}' }]
      })
    });

    const before = Brain.config.tokensUsedToday;
    await Brain.think('test');
    expect(Brain.config.tokensUsedToday).toBe(before + 150);
  });

  test('think() handles API error response', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } })
    });

    await expect(Brain.think('test')).rejects.toThrow(/Unauthorized/);
  });

  test('think() parses JSON from response text', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ text: 'Some text before {"analysis":"data"} some text after' }]
      })
    });

    const result = await Brain.think('test');
    expect(result.analysis).toBe('data');
    expect(result._tokensUsed).toBe(15);
  });

  test('think() returns raw text if no JSON found', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ text: 'Plain text response' }]
      })
    });

    const result = await Brain.think('test');
    expect(result.raw).toBe('Plain text response');
  });
});

describe('Brain.analyzePage() — Page analysis workflow', () => {
  beforeEach(() => {
    Brain.config.claudeApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ text: '{"category":"company"}' }]
      })
    });
  });

  test('analyzePage() extracts domain from URL', async () => {
    const scrapeData = {
      metadata: { url: 'https://test.com/page' },
      markdown: 'page content'
    };
    const snapshotData = { buttons: [], inputs: [], links: [] };

    await Brain.analyzePage(scrapeData, snapshotData);

    const call = global.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.messages[0].content).toContain('test.com');
  });

  test('analyzePage() passes page data to think()', async () => {
    const scrapeData = {
      metadata: { url: 'https://test.com' },
      markdown: 'company info here'
    };
    const snapshotData = {
      buttons: ['Button1'],
      inputs: ['input1'],
      links: ['link1']
    };

    await Brain.analyzePage(scrapeData, snapshotData);

    const call = global.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const prompt = body.messages[0].content;
    expect(prompt).toContain('company info here');
    expect(prompt).toContain('Button1');
  });
});

describe('Brain.decideNext() — Next action decision', () => {
  beforeEach(() => {
    Brain.config.claudeApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ text: '{"next_actions":[]}' }]
      })
    });
  });

  test('decideNext() creates decision prompt with current state', async () => {
    const state = {
      url: 'https://example.com',
      title: 'Test Page',
      buttonsCount: 5,
      inputsCount: 3,
      linksCount: 10,
      goal: 'collect data'
    };

    await Brain.decideNext(state);

    const call = global.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const prompt = body.messages[0].content;
    expect(prompt).toContain('5 bottoni');
    expect(prompt).toContain('3 input');
    expect(prompt).toContain('collect data');
  });
});

describe('Brain.getStats() — Statistics', () => {
  test('getStats() returns token usage stats', async () => {
    Brain.config.tokensUsedToday = 1000;
    Brain.config.dailyTokenBudget = 50000;
    Brain.config.claudeModel = 'claude-sonnet-4-20250514';
    Brain.config.claudeApiKey = 'key';

    const stats = await Brain.getStats();
    expect(stats.tokensUsedToday).toBe(1000);
    expect(stats.budgetRemaining).toBe(49000);
    expect(stats.budgetPercent).toBe(98);
    expect(stats.claudeConfigured).toBe(true);
  });

  test('getStats() returns Supabase connection status', async () => {
    Brain.config.supabaseUrl = 'https://test.supabase.co';
    Brain.config.supabaseKey = 'key';

    const stats = await Brain.getStats();
    expect(stats.supabaseConnected).toBe(true);
  });
});

describe('Brain._buildPrompt() — Prompt construction', () => {
  test('_buildPrompt() includes URL and domain', () => {
    const prompt = Brain._buildPrompt('analyze this', {
      url: 'https://example.com/page',
      domain: 'example.com'
    });
    expect(prompt).toContain('analyze this');
    expect(prompt).toContain('https://example.com/page');
    expect(prompt).toContain('example.com');
  });

  test('_buildPrompt() works with empty context', () => {
    const prompt = Brain._buildPrompt('test', {});
    expect(prompt).toBe('test');
  });
});

describe('Brain.syncToSupabase() — Knowledge sync', () => {
  test('syncToSupabase() validates Supabase URL', async () => {
    Brain.config.supabaseUrl = 'https://invalid-domain.com';
    Brain.config.supabaseKey = 'key';
    global.console.warn = jest.fn();

    await Brain.syncToSupabase('example.com', {});
    expect(global.console.warn).toHaveBeenCalledWith(expect.stringContaining('URL Supabase non valido'));
  });

  test('syncToSupabase() sends valid data structure', async () => {
    Brain.config.supabaseUrl = 'https://test.supabase.co';
    Brain.config.supabaseKey = 'key';
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true });

    await Brain.syncToSupabase('example.com', {
      category: 'company',
      tags: ['tag1'],
      confidence: 85
    });

    const call = global.fetch.mock.calls[0];
    expect(call[0]).toContain('/rest/v1/knowledge_base');
    const body = JSON.parse(call[1].body);
    expect(body.domain).toBe('example.com');
    expect(body.tags).toEqual(['tag1']);
  });
});

describe('Library — structure and methods exist', () => {
  test('Library.add is a function', () => {
    expect(typeof Library.add).toBe('function');
  });

  test('Library.search is a function', () => {
    expect(typeof Library.search).toBe('function');
  });

  test('Library.getByDomain is a function', () => {
    expect(typeof Library.getByDomain).toBe('function');
  });

  test('Library.getAllTags is a function', () => {
    expect(typeof Library.getAllTags).toBe('function');
  });

  test('Library.getCategories is a function', () => {
    expect(typeof Library.getCategories).toBe('function');
  });

  test('Library.getStats is a function', () => {
    expect(typeof Library.getStats).toBe('function');
  });

  test('Library.remove is a function', () => {
    expect(typeof Library.remove).toBe('function');
  });

  test('Library.clear is a function', () => {
    expect(typeof Library.clear).toBe('function');
  });

  test('Library.exportAll is a function', () => {
    expect(typeof Library.exportAll).toBe('function');
  });

  test('Library._dbName is COBRALibrary', () => {
    expect(Library._dbName).toBe('COBRALibrary');
  });

  test('Library._dbVersion is 2', () => {
    expect(Library._dbVersion).toBe(2);
  });

  test('Library._storeName is entries', () => {
    expect(Library._storeName).toBe('entries');
  });
});
