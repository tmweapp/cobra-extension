/**
 * Integration Tests — Storage Round-Trip
 * Tests that data written to chrome.storage can be read back consistently
 */
require('./setup');

// Simulate a simple in-memory storage backend for chrome.storage.local
const memoryStore = {};

chrome.storage.local.get = jest.fn((keys, cb) => {
  if (typeof keys === 'string') {
    const result = {};
    if (memoryStore[keys] !== undefined) result[keys] = memoryStore[keys];
    if (typeof cb === 'function') cb(result);
    return Promise.resolve(result);
  }
  if (Array.isArray(keys)) {
    const result = {};
    for (const k of keys) {
      if (memoryStore[k] !== undefined) result[k] = memoryStore[k];
    }
    if (typeof cb === 'function') cb(result);
    return Promise.resolve(result);
  }
  if (typeof cb === 'function') cb({});
  return Promise.resolve({});
});

chrome.storage.local.set = jest.fn((data, cb) => {
  Object.assign(memoryStore, data);
  if (typeof cb === 'function') cb();
  return Promise.resolve();
});

// Replicate Storage object from sidepanel.js
const Storage = {
  async load(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, data => resolve(data[key] || null));
    });
  },
  async save(key, value) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },
};

beforeEach(() => {
  Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
});

describe('Storage — Round-Trip', () => {
  test('save and load string', async () => {
    await Storage.save('test_key', 'hello');
    const result = await Storage.load('test_key');
    expect(result).toBe('hello');
  });

  test('save and load object', async () => {
    const obj = { name: 'COBRA', version: '5.2', settings: { stealth: true } };
    await Storage.save('test_obj', obj);
    const result = await Storage.load('test_obj');
    expect(result).toEqual(obj);
  });

  test('save and load array', async () => {
    const arr = [1, 'two', { three: 3 }];
    await Storage.save('test_arr', arr);
    const result = await Storage.load('test_arr');
    expect(result).toEqual(arr);
  });

  test('load returns null for missing key', async () => {
    const result = await Storage.load('nonexistent');
    expect(result).toBeNull();
  });

  test('save overwrites previous value', async () => {
    await Storage.save('overwrite', 'first');
    await Storage.save('overwrite', 'second');
    const result = await Storage.load('overwrite');
    expect(result).toBe('second');
  });

  test('multiple keys are isolated', async () => {
    await Storage.save('key_a', 'value_a');
    await Storage.save('key_b', 'value_b');
    expect(await Storage.load('key_a')).toBe('value_a');
    expect(await Storage.load('key_b')).toBe('value_b');
  });
});

describe('Storage — Settings Symmetry', () => {
  test('settings saved = settings loaded', async () => {
    const settings = {
      stealth: true,
      localMemory: true,
      cloudSync: false,
      learning: true,
      kb: true,
      notifications: false,
      rateLimit: 'balanced',
      language: 'it',
      openaiKey: '',
      openaiModel: 'gpt-4o-mini',
      anthropicKey: '',
      anthropicModel: 'claude-sonnet-4-20250514',
      geminiKey: '',
      geminiModel: 'gemini-2.0-flash',
      groqKey: '',
      groqModel: 'llama-3.3-70b-versatile',
      elevenKey: '',
      orchestration: false,
      voice: true,
      voiceSpeed: '1.0',
    };

    await Storage.save('cobra_settings', settings);
    const loaded = await Storage.load('cobra_settings');
    expect(loaded).toEqual(settings);
  });

  test('settings merge preserves existing values', async () => {
    // Simulate initial state with defaults
    const defaults = { stealth: true, openaiKey: '', language: 'it' };
    // Simulate saved settings with user customization
    const saved = { openaiKey: 'sk-user-key', language: 'en' };

    const merged = { ...defaults, ...saved };
    expect(merged.stealth).toBe(true);          // from defaults
    expect(merged.openaiKey).toBe('sk-user-key'); // from saved
    expect(merged.language).toBe('en');            // from saved
  });

  test('chat history preserves message order', async () => {
    const history = [
      { role: 'user', content: 'Hello', ts: 1000 },
      { role: 'ai', content: 'Hi there', ts: 1001 },
      { role: 'user', content: 'Scrape this', ts: 1002 },
    ];

    await Storage.save('cobra_chat_history', history);
    const loaded = await Storage.load('cobra_chat_history');
    expect(loaded.length).toBe(3);
    expect(loaded[0].role).toBe('user');
    expect(loaded[2].content).toBe('Scrape this');
  });

  test('habits accumulate correctly', async () => {
    const habits = {
      sites: { 'example.com': 5, 'google.com': 3 },
      actions: { scrape: 10, navigate: 20 },
      hours: { '9': 5, '14': 8 },
      sessions: 15,
    };

    await Storage.save('cobra_habits', habits);
    const loaded = await Storage.load('cobra_habits');
    expect(loaded.sessions).toBe(15);
    expect(loaded.sites['example.com']).toBe(5);
  });
});
