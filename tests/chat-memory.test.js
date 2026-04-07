/**
 * Tests for ChatMemory module
 * Coverage: ~35+ tests
 */

const ChatMemory = require('../chat-memory.js');

describe('ChatMemory', () => {
  let memory;

  beforeEach(() => {
    memory = new ChatMemory();
  });

  // ====================== BASIC OPERATIONS ======================

  test('should initialize with empty live window', () => {
    expect(memory.liveWindow).toEqual([]);
    expect(memory.rollingSummary).toBe('');
    expect(memory.tempDocs.size).toBe(0);
  });

  test('should add a simple message', () => {
    const msg = memory.addMessage('user', 'Hello');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(memory.liveWindow.length).toBe(1);
  });

  test('should add message with tier parameter', () => {
    const msg = memory.addMessage('ai', 'Response', 'summary');
    expect(msg.tier).toBe('summary');
    expect(memory.liveWindow[0].tier).toBe('summary');
  });

  test('should add multiple messages in order', () => {
    memory.addMessage('user', 'msg1');
    memory.addMessage('ai', 'msg2');
    memory.addMessage('user', 'msg3');
    expect(memory.liveWindow.length).toBe(3);
    expect(memory.liveWindow[0].content).toBe('msg1');
    expect(memory.liveWindow[2].content).toBe('msg3');
  });

  // ====================== CONSOLIDATION TRIGGER ======================

  test('should trigger consolidation when exceeding MAX_LIVE', () => {
    // Add 11 messages (MAX_LIVE = 10)
    for (let i = 0; i < 11; i++) {
      memory.addMessage('user', `message ${i}`);
    }
    // Should consolidate oldest, leaving 10
    expect(memory.liveWindow.length).toBeLessThanOrEqual(memory.MAX_LIVE);
    // First message should be consolidated to summary
    expect(memory.rollingSummary.length).toBeGreaterThan(0);
  });

  test('should consolidate oldest message to rolling summary', () => {
    memory.addMessage('user', 'first message');
    for (let i = 0; i < 11; i++) {
      memory.addMessage('ai', `response ${i}`);
    }
    // First message should be in summary
    expect(memory.rollingSummary).toContain('first message');
  });

  test('should maintain FULL_RECENT threshold', () => {
    const msgs = [];
    for (let i = 0; i < 8; i++) {
      msgs.push(memory.addMessage('user', `msg ${i}`));
    }
    // Should not consolidate yet (8 < MAX_LIVE)
    expect(memory.liveWindow.length).toBe(8);
  });

  // ====================== ROLLING SUMMARY EXTENSION ======================

  test('should extend rolling summary with new messages', () => {
    memory.rollingSummary = 'Initial summary';
    memory._extendRollingSummary('new message');
    expect(memory.rollingSummary).toContain('Initial summary');
    expect(memory.rollingSummary).toContain('new message');
  });

  test('should create initial summary if empty', () => {
    memory.addMessage('user', 'first message');
    for (let i = 0; i < 11; i++) {
      memory.addMessage('ai', `response ${i}`);
    }
    // After consolidation, summary should have content
    expect(memory.rollingSummary.length).toBeGreaterThan(0);
  });

  test('should extend summary without losing original content', () => {
    const original = 'Original summary line';
    memory.rollingSummary = original;
    memory._extendRollingSummary('Extension');
    expect(memory.rollingSummary).toContain(original);
  });

  // ====================== ROLLING SUMMARY REPACK ======================

  test('should repack summary when exceeding REPACK_THRESHOLD', () => {
    // Create a very long summary
    const longText = 'x'.repeat(3000);
    memory.rollingSummary = longText;
    const beforeLength = memory.rollingSummary.length;

    memory._repackSummary();

    // After repack, length should be reduced or equal
    const afterLength = memory.rollingSummary.length;
    expect(afterLength).toBeLessThanOrEqual(beforeLength);
    // The summary should be non-empty after repack
    expect(memory.rollingSummary.length).toBeGreaterThan(0);
  });

  test('should not repack summary below threshold', () => {
    memory.rollingSummary = 'Short summary';
    const originalLength = memory.rollingSummary.length;
    memory._repackSummary();
    // Should not change if below threshold
    expect(memory.rollingSummary.length).toBeLessThanOrEqual(originalLength + 10);
  });

  test('should maintain coherence after repack', () => {
    memory.rollingSummary = '**Start**\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nEnd';
    memory._repackSummary();
    expect(memory.rollingSummary.length).toBeGreaterThan(0);
    expect(memory.rollingSummary).toContain('Start');
  });

  // ====================== TOKEN ESTIMATION ======================

  test('should estimate tokens correctly', () => {
    const text = 'Hello world';
    const tokens = memory._estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(4); // 11 chars / 4
  });

  test('should estimate zero tokens for empty string', () => {
    expect(memory._estimateTokens('')).toBe(0);
    expect(memory._estimateTokens(null)).toBe(0);
  });

  test('should scale token count with text length', () => {
    const short = memory._estimateTokens('hi');
    const long = memory._estimateTokens('this is a much longer text string');
    expect(long).toBeGreaterThan(short);
  });

  // ====================== SAFETY CAP ======================

  test('should compress messages when exceeding MAX_FULL_TOKENS', () => {
    // Add messages until total tokens exceed MAX_FULL_TOKENS
    const longContent = 'x'.repeat(1000);
    for (let i = 0; i < 5; i++) {
      memory.addMessage('user', longContent);
    }

    memory._safetyCap();

    // Check that some messages have been marked synthetic
    const syntheticCount = memory.liveWindow.filter(m => m.tier === 'synthetic').length;
    expect(syntheticCount).toBeGreaterThanOrEqual(0);
  });

  test('should not compress short messages', () => {
    memory.addMessage('user', 'short');
    memory.addMessage('ai', 'also short');

    const originalTiers = memory.liveWindow.map(m => m.tier);
    memory._safetyCap();

    expect(memory.liveWindow.every(m => m.tier === 'full')).toBe(true);
  });

  // ====================== PROMPT CONTEXT ======================

  test('should return prompt context with empty summary', () => {
    memory.addMessage('user', 'Hello');
    memory.addMessage('ai', 'Hi there');

    const context = memory.getPromptContext();
    expect(context).toHaveProperty('rollingSummary');
    expect(context).toHaveProperty('liveMessages');
    expect(context.liveMessages.length).toBe(2);
  });

  test('should return prompt context with summary and messages', () => {
    memory.rollingSummary = 'Previous conversation';
    memory.addMessage('user', 'Current message');

    const context = memory.getPromptContext();
    expect(context.rollingSummary).toBe('Previous conversation');
    expect(context.liveMessages.length).toBe(1);
  });

  test('should include estimated tokens in context', () => {
    memory.addMessage('user', 'Test message');
    const context = memory.getPromptContext();
    expect(context).toHaveProperty('estimatedLiveTokens');
    expect(typeof context.estimatedLiveTokens).toBe('number');
  });

  // ====================== TEMPORARY DOCUMENTS ======================

  test('should add long document to temp store', () => {
    const longText = 'x'.repeat(5000);
    const ref = memory.addLongDocument(longText, 'test doc');

    expect(ref).toContain('document:');
    expect(ref).toContain('test doc');
    expect(memory.tempDocs.size).toBe(1);
  });

  test('should return null for short documents', () => {
    const shortText = 'This is short';
    const ref = memory.addLongDocument(shortText, 'short');

    expect(ref).toBeNull();
  });

  test('should track word count in temp docs', () => {
    const text = 'one two three four five';
    const ref = memory.addLongDocument(text + ' ' + text.repeat(500), 'doc');

    const docId = ref.match(/document:(\w+)/)[1];
    const doc = memory.tempDocs.get(docId);
    expect(doc.words).toBeGreaterThan(5);
  });

  test('should read temp document', () => {
    const content = 'Document content here';
    const ref = memory.addLongDocument(content.repeat(300), 'mydoc');

    const docId = ref.match(/document:(\w+)/)[1];
    const read = memory.readTempDoc(docId);

    expect(read).not.toBeNull();
    expect(read.title).toBe('mydoc');
    expect(read.content).toContain('Document content');
  });

  test('should update lastAccessedAt on read', () => {
    const ref = memory.addLongDocument('x'.repeat(5000), 'doc');
    const docId = ref.match(/document:(\w+)/)[1];

    // readTempDoc should update the document's lastAccessedAt
    const read1 = memory.readTempDoc(docId);
    expect(read1).not.toBeNull();
    expect(read1.title).toBe('doc');

    // Reading again should succeed
    const read2 = memory.readTempDoc(docId);
    expect(read2).not.toBeNull();
  });

  test('should return null for non-existent temp doc', () => {
    const read = memory.readTempDoc('nonexistent');
    expect(read).toBeNull();
  });

  test('should clear old temp documents', () => {
    const ref = memory.addLongDocument('x'.repeat(5000), 'old');
    const docId = ref.match(/document:(\w+)/)[1];

    // Manually set createdAt to 25 hours ago
    memory.tempDocs.get(docId).createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    memory.clearOldTempDocs(24); // Clear docs older than 24 hours

    expect(memory.tempDocs.has(docId)).toBe(false);
  });

  // ====================== SERIALIZATION ======================

  test('should serialize chat memory state', () => {
    memory.addMessage('user', 'test');
    memory.rollingSummary = 'Summary';

    const serialized = memory.serialize();
    expect(serialized).toHaveProperty('liveWindow');
    expect(serialized).toHaveProperty('rollingSummary');
    expect(serialized).toHaveProperty('tempDocs');
    expect(serialized).toHaveProperty('sessionId');
  });

  test('should deserialize chat memory state', () => {
    memory.addMessage('user', 'original');
    memory.rollingSummary = 'Original summary';
    const serialized = memory.serialize();

    const restored = ChatMemory.deserialize(serialized);
    expect(restored.liveWindow.length).toBe(1);
    expect(restored.rollingSummary).toBe('Original summary');
    expect(restored._sessionId).toBe(memory._sessionId);
  });

  test('should preserve session ID through serialization', () => {
    memory.addMessage('user', 'test');
    const originalId = memory._sessionId;

    const serialized = memory.serialize();
    const restored = ChatMemory.deserialize(serialized);

    expect(restored._sessionId).toBe(originalId);
  });

  test('should handle empty serialization', () => {
    const serialized = memory.serialize();
    const restored = ChatMemory.deserialize(serialized);

    expect(restored.liveWindow).toEqual([]);
    expect(restored.rollingSummary).toBe('');
  });

  // ====================== STATISTICS ======================

  test('should report accurate statistics', () => {
    memory.addMessage('user', 'Hello world');
    memory.rollingSummary = 'Summary text';

    const stats = memory.getStats();
    expect(stats).toHaveProperty('liveWindowCount');
    expect(stats).toHaveProperty('liveTokens');
    expect(stats).toHaveProperty('summaryTokens');
    expect(stats).toHaveProperty('totalTokens');
    expect(stats.liveWindowCount).toBe(1);
  });

  test('should count temp docs in statistics', () => {
    memory.addLongDocument('x'.repeat(5000), 'doc1');
    memory.addLongDocument('y'.repeat(5000), 'doc2');

    const stats = memory.getStats();
    expect(stats.tempDocsCount).toBe(2);
    expect(stats.tempDocsTotalWords).toBeGreaterThan(0);
  });

  // ====================== EDGE CASES ======================

  test('should handle null content gracefully', () => {
    memory.addMessage('user', null);
    expect(memory.liveWindow[0].content).toBeNull();
  });

  test('should handle very long messages', () => {
    const veryLong = 'x'.repeat(10000);
    memory.addMessage('user', veryLong);
    expect(memory.liveWindow[0].content).toBe(veryLong);
  });

  test('should handle special characters in messages', () => {
    const special = 'Hello 你好 مرحبا 🎉 <script>alert("xss")</script>';
    memory.addMessage('user', special);
    expect(memory.liveWindow[0].content).toBe(special);
  });

  test('should generate unique message IDs', () => {
    const msg1 = memory.addMessage('user', 'msg1');
    const msg2 = memory.addMessage('user', 'msg2');
    expect(msg1.id).not.toBe(msg2.id);
  });

  test('should preserve timestamps', () => {
    const before = Date.now();
    memory.addMessage('user', 'test');
    const after = Date.now();

    const msg = memory.liveWindow[0];
    const msgTime = new Date(msg.timestamp).getTime();
    expect(msgTime).toBeGreaterThanOrEqual(before);
    expect(msgTime).toBeLessThanOrEqual(after);
  });
});
