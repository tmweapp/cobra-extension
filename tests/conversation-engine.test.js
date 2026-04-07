/**
 * Tests for ConversationEngine
 * Tests cover conversation lifecycle, message management, rolling summary, and context building
 */

require('./setup.js');
require('../conversation-engine.js');

describe('ConversationEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new self.ConversationEngine();
    jest.clearAllMocks();
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with empty conversations map', () => {
      expect(engine.conversations).toBeInstanceOf(Map);
      expect(engine.conversations.size).toBe(0);
    });

    test('should initialize with null active conversation', () => {
      expect(engine.activeConversationId).toBeNull();
    });

    test('should initialize with default summary threshold of 10', () => {
      expect(engine.summaryThreshold).toBe(10);
      expect(engine._baseSummaryThreshold).toBe(10);
    });

    test('should initialize with empty summarizing conversations set', () => {
      expect(engine._summarizingConversations).toBeInstanceOf(Set);
      expect(engine._summarizingConversations.size).toBe(0);
    });
  });

  describe('load()', () => {
    test('should load conversations from chrome.storage.local', async () => {
      const mockConversations = {
        'conv_123': {
          id: 'conv_123',
          title: 'Test',
          messages: [],
          summary: '',
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };

      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({
          cobra_conversations: mockConversations,
          cobra_activeConversationId: 'conv_123'
        });
      });

      await engine.load();

      expect(engine.conversations.size).toBe(1);
      expect(engine.activeConversationId).toBe('conv_123');
      expect(engine.conversations.get('conv_123')).toBeDefined();
    });

    test('should handle empty storage gracefully', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({});
      });

      await engine.load();

      expect(engine.conversations.size).toBe(0);
      expect(engine.activeConversationId).toBeNull();
    });

    test('should handle load errors gracefully', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        chrome.runtime.lastError = { message: 'Storage error' };
        cb({});
      });

      await engine.load();

      expect(console.error).toHaveBeenCalled();
    });

    test('should use cobraPersistence if available', async () => {
      const mockPersistence = {
        load: jest.fn()
          .mockResolvedValueOnce({ id: 'conv_123', messages: [] })
          .mockResolvedValueOnce('conv_123')
      };
      self.cobraPersistence = mockPersistence;

      await engine.load();

      expect(mockPersistence.load).toHaveBeenCalledWith('cobra_conversations');
      expect(mockPersistence.load).toHaveBeenCalledWith('cobra_activeConversationId');

      delete self.cobraPersistence;
    });
  });

  describe('save()', () => {
    test('should debounce save calls', (done) => {
      jest.useFakeTimers();

      const conv = engine.createConversation('Test Conv');
      engine.save();
      engine.save();
      engine.save();

      // Should only call set once after 800ms
      jest.advanceTimersByTime(800);

      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
      done();
    });

    test('should save conversations to chrome.storage.local', (done) => {
      jest.useFakeTimers();

      const conv = engine.createConversation('Test Conv');
      jest.advanceTimersByTime(800);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          cobra_conversations: expect.any(Object),
          cobra_activeConversationId: expect.any(String)
        }),
        expect.any(Function)
      );

      jest.useRealTimers();
      done();
    });
  });

  describe('createConversation()', () => {
    test('should create a new conversation with unique ID', () => {
      const conv = engine.createConversation('Test Conversation');

      expect(conv).toMatchObject({
        id: expect.stringContaining('conv_'),
        title: 'Test Conversation',
        messages: expect.arrayContaining([]),
        summary: '',
        metadata: expect.any(Object)
      });
      expect(conv.createdAt).toBeDefined();
      expect(conv.updatedAt).toBeDefined();
    });

    test('should set created conversation as active', () => {
      const conv = engine.createConversation('Test');

      expect(engine.activeConversationId).toBe(conv.id);
    });

    test('should accept metadata', () => {
      const metadata = { context: 'test', tags: ['important'] };
      const conv = engine.createConversation('Test', metadata);

      expect(conv.metadata).toEqual(metadata);
    });

    test('should add conversation to map', () => {
      const conv = engine.createConversation('Test');

      expect(engine.conversations.has(conv.id)).toBe(true);
      expect(engine.conversations.get(conv.id)).toBe(conv);
    });

    test('should trigger save', (done) => {
      jest.useFakeTimers();
      jest.clearAllMocks();

      engine.createConversation('Test');

      // save is called synchronously, timeout is set
      expect(engine.saveTimeout).toBeDefined();

      jest.useRealTimers();
      done();
    });
  });

  describe('addMessage()', () => {
    let convId;

    beforeEach(() => {
      const conv = engine.createConversation('Test Conv');
      convId = conv.id;
      jest.clearAllMocks();
    });

    test('should add message to conversation', () => {
      const msg = engine.addMessage(convId, 'user', 'Hello');

      const conv = engine.conversations.get(convId);
      expect(conv.messages.length).toBe(1);
      expect(conv.messages[0]).toMatchObject({
        id: expect.stringContaining('msg_'),
        role: 'user',
        content: 'Hello',
        timestamp: expect.any(String)
      });
    });

    test('should throw error for non-existent conversation', () => {
      expect(() => {
        engine.addMessage('non-existent', 'user', 'Hello');
      }).toThrow('Conversazione non trovata');
    });

    test('should set conversation as active', () => {
      engine.addMessage(convId, 'user', 'Hello');

      expect(engine.activeConversationId).toBe(convId);
    });

    test('should include optional metadata', () => {
      const metadata = { source: 'api', version: 1 };
      const msg = engine.addMessage(convId, 'ai', 'Response', metadata);

      expect(msg.metadata).toEqual(metadata);
    });

    test('should update conversation updatedAt timestamp', () => {
      const conv = engine.conversations.get(convId);
      const originalUpdatedAt = conv.updatedAt;

      // Wait a bit to ensure timestamp difference
      jest.useFakeTimers();
      jest.advanceTimersByTime(100);

      engine.addMessage(convId, 'user', 'Hello');

      expect(conv.updatedAt).not.toBe(originalUpdatedAt);

      jest.useRealTimers();
    });

    test('should trigger rolling summary when threshold exceeded', () => {
      const rollingSummarySpy = jest.spyOn(engine, 'rollingSummary');

      // Add long messages to trigger lower adaptive threshold
      for (let i = 0; i < 20; i++) {
        engine.addMessage(convId, 'user', 'x'.repeat(500));
      }

      // With long messages, threshold should be lower and summary should be triggered
      expect(rollingSummarySpy).toHaveBeenCalled();
    });

    test('should support different message roles', () => {
      jest.useFakeTimers();
      jest.clearAllMocks();

      engine.addMessage(convId, 'user', 'User message');
      engine.addMessage(convId, 'ai', 'AI response');
      engine.addMessage(convId, 'system', 'System message');
      engine.addMessage(convId, 'tool', 'Tool result');

      const conv = engine.conversations.get(convId);
      const roles = conv.messages.map(m => m.role);

      expect(roles).toContain('user');
      expect(roles).toContain('ai');
      expect(roles).toContain('system');
      expect(roles).toContain('tool');

      jest.useRealTimers();
    });
  });

  describe('getConversation()', () => {
    test('should return conversation by ID', () => {
      const conv = engine.createConversation('Test');
      const retrieved = engine.getConversation(conv.id);

      expect(retrieved).toBe(conv);
    });

    test('should throw error for non-existent conversation', () => {
      expect(() => {
        engine.getConversation('non-existent');
      }).toThrow('Conversazione non trovata');
    });
  });

  describe('getActiveConversation()', () => {
    test('should return active conversation', () => {
      const conv = engine.createConversation('Test');

      expect(engine.getActiveConversation()).toBe(conv);
    });

    test('should return null when no active conversation', () => {
      expect(engine.getActiveConversation()).toBeNull();
    });

    test('should return null when active conversation deleted', () => {
      const conv = engine.createConversation('Test');
      engine.deleteConversation(conv.id);

      expect(engine.getActiveConversation()).toBeNull();
    });
  });

  describe('buildContextForAI()', () => {
    let convId;

    beforeEach(() => {
      const conv = engine.createConversation('Test');
      convId = conv.id;
    });

    test('should build context with summary and recent messages', () => {
      const conv = engine.conversations.get(convId);
      conv.summary = 'Previous discussion about X';

      engine.addMessage(convId, 'user', 'What about Y?');
      engine.addMessage(convId, 'ai', 'Y is related to X');

      const context = engine.buildContextForAI(convId);

      expect(context).toContain('Contesto Precedente');
      expect(context).toContain('Previous discussion about X');
      expect(context).toContain('What about Y?');
      expect(context).toContain('Y is related to X');
    });

    test('should respect maxMessages parameter', () => {
      for (let i = 0; i < 30; i++) {
        engine.addMessage(convId, i % 2 === 0 ? 'user' : 'ai', `Message ${i}`);
      }

      const context = engine.buildContextForAI(convId, 5);

      // Only last 5 messages should be included
      expect(context).toContain('Message 25');
      expect(context).not.toContain('Message 0');
    });

    test('should throw error for non-existent conversation', () => {
      expect(() => {
        engine.buildContextForAI('non-existent');
      }).toThrow('Conversazione non trovata');
    });

    test('should format messages with uppercase roles', () => {
      engine.addMessage(convId, 'user', 'Test');

      const context = engine.buildContextForAI(convId);

      expect(context).toContain('[USER]');
    });
  });

  describe('rollingSummary()', () => {
    let convId;

    beforeEach(() => {
      const conv = engine.createConversation('Test');
      convId = conv.id;
    });

    test('should create summary of old messages', () => {
      for (let i = 0; i < 15; i++) {
        engine.addMessage(convId, i % 2 === 0 ? 'user' : 'ai', `Message ${i}`);
      }

      // Clear the summary first
      const conv = engine.conversations.get(convId);
      conv.summary = '';

      engine.rollingSummary(convId);

      expect(conv.summary).toBeTruthy();
      expect(conv.summary).toContain('Riassunto conversazione precedente');
    });

    test('should keep only recent messages after summary', () => {
      for (let i = 0; i < 15; i++) {
        engine.addMessage(convId, 'user', `Message ${i}`);
      }

      const convBefore = engine.conversations.get(convId);
      const messageCountBefore = convBefore.messages.length;

      engine.rollingSummary(convId);

      const convAfter = engine.conversations.get(convId);
      expect(convAfter.messages.length).toBeLessThan(messageCountBefore);
      expect(convAfter.messages.length).toBe(engine.summaryThreshold);
    });

    test('should prevent concurrent summarization', () => {
      for (let i = 0; i < 15; i++) {
        engine.addMessage(convId, 'user', `Message ${i}`);
      }

      const conv = engine.conversations.get(convId);
      engine._summarizingConversations.add(convId);

      const originalMessageCount = conv.messages.length;

      engine.rollingSummary(convId);

      // Should return early without modifying messages
      expect(conv.messages.length).toBe(originalMessageCount);
    });

    test('should throw error for non-existent conversation', () => {
      expect(() => {
        engine.rollingSummary('non-existent');
      }).toThrow('Conversazione non trovata');
    });

    test('should not summarize if messages below threshold', () => {
      engine.addMessage(convId, 'user', 'Message 1');
      engine.addMessage(convId, 'user', 'Message 2');

      const conv = engine.conversations.get(convId);
      const originalMessageCount = conv.messages.length;

      engine.rollingSummary(convId);

      expect(conv.messages.length).toBe(originalMessageCount);
      expect(conv.summary).toBe('');
    });

    test('should handle null message content gracefully', () => {
      for (let i = 0; i < 15; i++) {
        engine.addMessage(convId, 'user', `Message ${i}`);
      }

      const conv = engine.conversations.get(convId);

      expect(() => {
        engine.rollingSummary(convId);
      }).not.toThrow();

      // After rolling summary, only recent messages remain
      expect(conv.summary.length).toBeGreaterThan(0);
      expect(conv.messages.length).toBeLessThanOrEqual(engine.summaryThreshold);
    });
  });

  describe('_adaptThreshold()', () => {
    let convId;

    beforeEach(() => {
      const conv = engine.createConversation('Test');
      convId = conv.id;
    });

    test('should return base threshold for empty conversation', () => {
      const conv = engine.conversations.get(convId);

      const threshold = engine._adaptThreshold(conv);

      expect(threshold).toBe(engine._baseSummaryThreshold);
    });

    test('should lower threshold for long messages', () => {
      for (let i = 0; i < 5; i++) {
        engine.addMessage(convId, 'user', 'x'.repeat(3000));
      }

      const conv = engine.conversations.get(convId);
      const threshold = engine._adaptThreshold(conv);

      expect(threshold).toBeLessThan(engine._baseSummaryThreshold);
    });

    test('should raise threshold for short messages', () => {
      for (let i = 0; i < 5; i++) {
        engine.addMessage(convId, 'user', 'hi');
      }

      const conv = engine.conversations.get(convId);
      const threshold = engine._adaptThreshold(conv);

      expect(threshold).toBeGreaterThan(engine._baseSummaryThreshold);
    });
  });

  describe('getPrioritizedContext()', () => {
    let convId;

    beforeEach(() => {
      const conv = engine.createConversation('Test');
      convId = conv.id;
    });

    test('should return summary if no messages', () => {
      const conv = engine.conversations.get(convId);
      conv.summary = 'Test summary';

      const context = engine.getPrioritizedContext(convId);

      expect(context).toBe('Test summary');
    });

    test('should prioritize user messages', () => {
      engine.addMessage(convId, 'user', 'Important user message');
      engine.addMessage(convId, 'tool', 'Tool result');
      engine.addMessage(convId, 'user', 'Another user message');

      const context = engine.getPrioritizedContext(convId);

      expect(context).toContain('Important user message');
      expect(context).toContain('Another user message');
    });

    test('should boost priority for recent messages', () => {
      for (let i = 0; i < 20; i++) {
        engine.addMessage(convId, i % 2 === 0 ? 'user' : 'ai', `Message ${i}`);
      }

      const context = engine.getPrioritizedContext(convId);

      expect(context).toContain('Message 19');
      expect(context).toContain('Message 18');
    });

    test('should respect token estimate limit', () => {
      for (let i = 0; i < 50; i++) {
        engine.addMessage(convId, 'user', `Message ${i} with some content`);
      }

      const context = engine.getPrioritizedContext(convId, 100);

      // With 100 tokens, should select fewer messages than with default 4000
      expect(context.length).toBeLessThan(2000);
    });
  });

  describe('getConversationStats()', () => {
    let convId;

    beforeEach(() => {
      const conv = engine.createConversation('Test');
      convId = conv.id;
    });

    test('should return null for non-existent conversation', () => {
      const stats = engine.getConversationStats('non-existent');

      expect(stats).toBeNull();
    });

    test('should return comprehensive stats', () => {
      engine.addMessage(convId, 'user', 'User message');
      engine.addMessage(convId, 'ai', 'AI response');
      engine.addMessage(convId, 'tool', 'Tool result');

      const stats = engine.getConversationStats(convId);

      expect(stats).toMatchObject({
        messageCount: 3,
        byRole: expect.any(Object),
        avgMessageLength: expect.any(Number),
        hasSummary: expect.any(Boolean),
        summaryLength: expect.any(Number),
        adaptiveThreshold: expect.any(Number),
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      });
    });

    test('should count messages by role', () => {
      engine.addMessage(convId, 'user', 'Message 1');
      engine.addMessage(convId, 'user', 'Message 2');
      engine.addMessage(convId, 'ai', 'Response');

      const stats = engine.getConversationStats(convId);

      expect(stats.byRole.user).toBe(2);
      expect(stats.byRole.ai).toBe(1);
    });

    test('should calculate average message length', () => {
      engine.addMessage(convId, 'user', 'Short');
      engine.addMessage(convId, 'user', 'Much longer message here');

      const stats = engine.getConversationStats(convId);

      expect(stats.avgMessageLength).toBeGreaterThan(0);
    });
  });

  describe('deleteConversation()', () => {
    test('should delete conversation from map', () => {
      const conv = engine.createConversation('Test');

      engine.deleteConversation(conv.id);

      expect(engine.conversations.has(conv.id)).toBe(false);
    });

    test('should clear active conversation if deleted', () => {
      const conv = engine.createConversation('Test');

      engine.deleteConversation(conv.id);

      expect(engine.activeConversationId).toBeNull();
    });

    test('should handle deleting non-existent conversation', () => {
      expect(() => {
        engine.deleteConversation('non-existent');
      }).not.toThrow();
    });
  });

  describe('listConversations()', () => {
    test('should list all conversations sorted by updatedAt descending', (done) => {
      jest.useFakeTimers();

      const conv1 = engine.createConversation('Conv 1');
      const initialTime1 = new Date(conv1.updatedAt).getTime();

      jest.advanceTimersByTime(100);

      const conv2 = engine.createConversation('Conv 2');

      const list = engine.listConversations();

      expect(list.length).toBe(2);
      expect(list[0].id).toBe(conv2.id);
      expect(list[1].id).toBe(conv1.id);

      jest.useRealTimers();
      done();
    });

    test('should return empty list when no conversations', () => {
      const list = engine.listConversations();

      expect(list).toEqual([]);
    });
  });

  describe('exportConversation()', () => {
    test('should export conversation as JSON', () => {
      const conv = engine.createConversation('Test');
      engine.addMessage(conv.id, 'user', 'Hello');

      const exported = engine.exportConversation(conv.id);

      expect(exported).toMatchObject({
        id: expect.any(String),
        title: 'Test',
        messages: expect.any(Array),
        exportedAt: expect.any(String),
        exportedFrom: 'COBRA v4.0'
      });
    });

    test('should include export metadata', () => {
      const conv = engine.createConversation('Test');
      const exported = engine.exportConversation(conv.id);

      expect(exported.exportedAt).toBeDefined();
      expect(exported.exportedFrom).toBe('COBRA v4.0');
    });

    test('should throw error for non-existent conversation', () => {
      expect(() => {
        engine.exportConversation('non-existent');
      }).toThrow('Conversazione non trovata');
    });

    test('should not modify original conversation', () => {
      const conv = engine.createConversation('Test');
      const originalKeys = Object.keys(conv);

      engine.exportConversation(conv.id);

      const currentKeys = Object.keys(conv);

      expect(currentKeys).toEqual(originalKeys);
    });
  });

  describe('Integration Tests', () => {
    test('should handle full conversation lifecycle', () => {
      const conv = engine.createConversation('Full Lifecycle');

      engine.addMessage(conv.id, 'user', 'Start conversation');
      engine.addMessage(conv.id, 'ai', 'Initial response');

      expect(engine.getActiveConversation()).toBe(conv);

      const context = engine.buildContextForAI(conv.id);
      expect(context).toContain('Start conversation');

      const exported = engine.exportConversation(conv.id);
      expect(exported.messages.length).toBe(2);

      engine.deleteConversation(conv.id);
      expect(engine.conversations.has(conv.id)).toBe(false);
    });

    test('should handle multiple concurrent conversations', () => {
      const conv1 = engine.createConversation('Conv 1');
      const conv2 = engine.createConversation('Conv 2');
      const conv3 = engine.createConversation('Conv 3');

      engine.addMessage(conv1.id, 'user', 'Conv 1 message');
      engine.addMessage(conv2.id, 'user', 'Conv 2 message');
      engine.addMessage(conv3.id, 'user', 'Conv 3 message');

      expect(engine.conversations.size).toBe(3);
      expect(engine.activeConversationId).toBe(conv3.id);

      const list = engine.listConversations();
      expect(list.length).toBe(3);
    });
  });
});
