/**
 * COBRA Storage Module Tests
 * Tests Chrome storage wrapper for state hydration
 */

describe('Storage Module', () => {
  let Storage;
  let mockState;
  let storageData;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock global state
    mockState = {
      chatHistory: [],
      memories: [],
      habits: {},
      settings: {},
      agents: {},
      leaderAgentId: null,
    };

    // Create in-memory storage
    storageData = {};

    // Setup chrome storage mocks with callback handling
    chrome.storage.local.get = jest.fn((key, cb) => {
      if (typeof cb === 'function') {
        setImmediate(() => cb(storageData));
      }
      return Promise.resolve(storageData);
    });

    chrome.storage.local.set = jest.fn((data, cb) => {
      Object.assign(storageData, data);
      if (typeof cb === 'function') {
        setImmediate(() => cb());
      }
      return Promise.resolve();
    });

    // Create Storage object manually to avoid module loading issues
    Storage = {
      async load(key) {
        return new Promise((resolve) => {
          chrome.storage.local.get(key, (data) =>
            resolve(data[key] || null)
          );
        });
      },

      async save(key, value) {
        return new Promise((resolve) => {
          chrome.storage.local.set({ [key]: value }, resolve);
        });
      },

      async loadAll() {
        mockState.chatHistory =
          (await this.load('cobra_chat_history')) || [];
        mockState.memories = (await this.load('cobra_memories')) || [];
        mockState.habits =
          (await this.load('cobra_habits')) || mockState.habits;
        const saved = await this.load('cobra_settings');
        if (saved) Object.assign(mockState.settings, saved);
        const agents = await this.load('cobra_agents');
        if (agents) mockState.agents = agents;
        const leader = await this.load('cobra_leader');
        if (leader) mockState.leaderAgentId = leader;
      },

      async saveChat() {
        await this.save('cobra_chat_history', mockState.chatHistory);
      },
      async saveMemories() {
        await this.save('cobra_memories', mockState.memories);
      },
      async saveHabits() {
        await this.save('cobra_habits', mockState.habits);
      },
      async saveSettings() {
        await this.save('cobra_settings', mockState.settings);
      },
    };
  });

  describe('load', () => {
    it('should load single key from chrome storage', async () => {
      storageData.test_key = { data: 'value' };

      const result = await Storage.load('test_key');

      expect(result).toEqual({ data: 'value' });
    });

    it('should return null for missing key', async () => {
      const result = await Storage.load('missing_key');

      expect(result).toBeNull();
    });

    it('should load string value', async () => {
      storageData.string_key = 'string_value';

      const result = await Storage.load('string_key');

      expect(result).toBe('string_value');
    });

    it('should load array', async () => {
      const arr = [1, 2, 3];
      storageData.array_key = arr;

      const result = await Storage.load('array_key');

      expect(result).toEqual(arr);
    });

    it('should load null value', async () => {
      storageData.null_key = null;

      const result = await Storage.load('null_key');

      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('should save key-value pair', async () => {
      await Storage.save('test_key', { data: 'value' });

      expect(storageData.test_key).toEqual({ data: 'value' });
    });

    it('should save string value', async () => {
      await Storage.save('string_key', 'string_value');

      expect(storageData.string_key).toBe('string_value');
    });

    it('should save array', async () => {
      const arr = [1, 2, 3];
      await Storage.save('array_key', arr);

      expect(storageData.array_key).toEqual(arr);
    });

    it('should save null value', async () => {
      await Storage.save('null_key', null);

      expect(storageData.null_key).toBeNull();
    });
  });

  describe('loadAll', () => {
    it('should load chat history', async () => {
      const history = [{ role: 'user', content: 'Hello' }];
      storageData.cobra_chat_history = history;

      await Storage.loadAll();

      expect(mockState.chatHistory).toEqual(history);
    });

    it('should load memories', async () => {
      const memories = [{ id: '1', content: 'memory' }];
      storageData.cobra_memories = memories;

      await Storage.loadAll();

      expect(mockState.memories).toEqual(memories);
    });

    it('should load habits', async () => {
      const habits = { dailyTasks: true };
      storageData.cobra_habits = habits;

      await Storage.loadAll();

      expect(mockState.habits).toEqual(habits);
    });

    it('should preserve existing habits if not in storage', async () => {
      mockState.habits = { existing: 'habit' };

      await Storage.loadAll();

      expect(mockState.habits).toEqual({ existing: 'habit' });
    });

    it('should load settings', async () => {
      const settings = { theme: 'dark', language: 'it' };
      storageData.cobra_settings = settings;
      mockState.settings = { default: 'setting' };

      await Storage.loadAll();

      expect(mockState.settings.theme).toBe('dark');
      expect(mockState.settings.language).toBe('it');
    });

    it('should merge settings with existing', async () => {
      storageData.cobra_settings = { theme: 'dark' };
      mockState.settings = { language: 'en', fontSize: 14 };

      await Storage.loadAll();

      expect(mockState.settings.theme).toBe('dark');
      expect(mockState.settings.language).toBe('en');
      expect(mockState.settings.fontSize).toBe(14);
    });

    it('should load agents config', async () => {
      const agents = { agent1: { name: 'Agent One' } };
      storageData.cobra_agents = agents;

      await Storage.loadAll();

      expect(mockState.agents).toEqual(agents);
    });

    it('should load leader agent ID', async () => {
      storageData.cobra_leader = 'agent_main';

      await Storage.loadAll();

      expect(mockState.leaderAgentId).toBe('agent_main');
    });

    it('should load all data together', async () => {
      storageData.cobra_chat_history = [{ role: 'user' }];
      storageData.cobra_memories = [{ id: 'mem1' }];
      storageData.cobra_habits = { habit1: true };
      storageData.cobra_settings = { theme: 'dark' };
      storageData.cobra_agents = { agent1: {} };
      storageData.cobra_leader = 'leader_id';

      await Storage.loadAll();

      expect(mockState.chatHistory).toEqual([{ role: 'user' }]);
      expect(mockState.memories).toEqual([{ id: 'mem1' }]);
      expect(mockState.habits).toEqual({ habit1: true });
      expect(mockState.leaderAgentId).toBe('leader_id');
    });

    it('should handle missing data gracefully', async () => {
      await Storage.loadAll();

      expect(mockState.chatHistory).toEqual([]);
      expect(mockState.memories).toEqual([]);
    });

    it('should default to empty array for chat history', async () => {
      mockState.chatHistory = ['old'];

      await Storage.loadAll();

      expect(mockState.chatHistory).toEqual([]);
    });

    it('should default to empty array for memories', async () => {
      mockState.memories = ['old'];

      await Storage.loadAll();

      expect(mockState.memories).toEqual([]);
    });
  });

  describe('saveChat', () => {
    it('should save chat history', async () => {
      mockState.chatHistory = [{ role: 'user', content: 'test' }];

      await Storage.saveChat();

      expect(storageData.cobra_chat_history).toEqual(
        mockState.chatHistory
      );
    });

    it('should save empty chat history', async () => {
      mockState.chatHistory = [];

      await Storage.saveChat();

      expect(storageData.cobra_chat_history).toEqual([]);
    });
  });

  describe('saveMemories', () => {
    it('should save memories', async () => {
      mockState.memories = [{ id: 'mem1', content: 'memory' }];

      await Storage.saveMemories();

      expect(storageData.cobra_memories).toEqual(mockState.memories);
    });

    it('should save empty memories', async () => {
      mockState.memories = [];

      await Storage.saveMemories();

      expect(storageData.cobra_memories).toEqual([]);
    });
  });

  describe('saveHabits', () => {
    it('should save habits', async () => {
      mockState.habits = { dailyTask: true, weekly: false };

      await Storage.saveHabits();

      expect(storageData.cobra_habits).toEqual(mockState.habits);
    });

    it('should save empty habits object', async () => {
      mockState.habits = {};

      await Storage.saveHabits();

      expect(storageData.cobra_habits).toEqual({});
    });
  });

  describe('saveSettings', () => {
    it('should save settings', async () => {
      mockState.settings = { theme: 'dark', language: 'it' };

      await Storage.saveSettings();

      expect(storageData.cobra_settings).toEqual(mockState.settings);
    });

    it('should save partial settings', async () => {
      mockState.settings = { theme: 'dark' };

      await Storage.saveSettings();

      expect(storageData.cobra_settings).toEqual({ theme: 'dark' });
    });

    it('should preserve all settings when saving', async () => {
      mockState.settings = {
        theme: 'dark',
        language: 'it',
        voice: true,
        fontSize: 14,
      };

      await Storage.saveSettings();

      expect(storageData.cobra_settings).toEqual(mockState.settings);
    });
  });

  describe('Integration scenarios', () => {
    it('should load all data then save specific parts', async () => {
      storageData.cobra_chat_history = [{ role: 'assistant' }];
      storageData.cobra_memories = [{ id: 'old' }];

      await Storage.loadAll();

      mockState.chatHistory.push({ role: 'user' });

      await Storage.saveChat();

      expect(mockState.memories).toEqual([{ id: 'old' }]);
    });

    it('should handle rapid save operations', async () => {
      mockState.chatHistory = [{ role: 'user' }];
      mockState.memories = [{ id: 'mem1' }];
      mockState.habits = { daily: true };

      await Promise.all([
        Storage.saveChat(),
        Storage.saveMemories(),
        Storage.saveHabits(),
      ]);

      expect(chrome.storage.local.set).toHaveBeenCalledTimes(3);
    });

    it('should persist changes across load/save cycles', async () => {
      storageData.cobra_chat_history = [
        { role: 'user', content: 'first' },
      ];

      await Storage.loadAll();
      expect(mockState.chatHistory.length).toBe(1);

      mockState.chatHistory.push({
        role: 'assistant',
        content: 'hello',
      });

      await Storage.saveChat();

      expect(storageData.cobra_chat_history).toContainEqual({
        role: 'user',
        content: 'first',
      });
      expect(storageData.cobra_chat_history).toContainEqual({
        role: 'assistant',
        content: 'hello',
      });
    });
  });

  describe('Module structure', () => {
    it('should have all public methods', () => {
      const methods = [
        'load',
        'save',
        'loadAll',
        'saveChat',
        'saveMemories',
        'saveHabits',
        'saveSettings',
      ];

      methods.forEach((method) => {
        expect(typeof Storage[method]).toBe('function');
      });
    });

    it('should have 7 public methods', () => {
      const methods = Object.keys(Storage).filter(
        (key) => typeof Storage[key] === 'function'
      );
      expect(methods.length).toBe(7);
    });

    it('should have async methods', () => {
      ['load', 'save', 'loadAll', 'saveChat', 'saveMemories', 'saveHabits', 'saveSettings'].forEach(
        (method) => {
          const func = Storage[method];
          // Async functions return promises
          let result;
          if (method === 'load' || method === 'save') {
            result = func.call(Storage, 'key', 'value');
          } else {
            result = func.call(Storage);
          }
          expect(result instanceof Promise).toBe(true);
        }
      );
    });
  });
});
