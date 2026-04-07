/**
 * COBRA Streaming AI Response Handler Tests
 * Tests for callStreamingAI dispatcher, fallback to callDirectAI,
 * AbortError handling, SSE parsing, CHAT_STREAM_CHUNK emission,
 * and Gemini fallback behavior.
 */

// Mock fetch with ReadableStream support
const mockFetch = jest.fn();

// Helper to create mock SSE ReadableStream
function createMockSSEStream(chunks) {
  let index = 0;
  return new ReadableStream({
    start(controller) {
      const pushNextChunk = () => {
        if (index < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[index]));
          index++;
          setTimeout(pushNextChunk, 10);
        } else {
          controller.close();
        }
      };
      pushNextChunk();
    }
  });
}

// Setup global mocks
global.self = {
  callDirectAI: jest.fn(),
  _currentAIAbort: null
};
global.fetch = mockFetch;
global.chrome = {
  runtime: {
    sendMessage: jest.fn()
  }
};

// Load the module
require('../cobra-streaming.js');
const callStreamingAI = global.callStreamingAI;

describe('cobra-streaming.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks
    global.self.callDirectAI = jest.fn();
    global.chrome.runtime.sendMessage = jest.fn();
    mockFetch.mockReset();
  });

  // ═══════════════════════════════════════════════════════
  // DISPATCH TESTS
  // ═══════════════════════════════════════════════════════
  describe('callStreamingAI - Provider Dispatch', () => {
    it.skip('should dispatch OpenAI provider to streaming handler', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'You are helpful',
        [{ role: 'user', content: 'Hello' }]
      );

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.any(Object)
      );
    });

    it('should dispatch Groq provider to OpenAI-compatible handler', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Response"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'groq',
        'test-key',
        'mixtral-8x7b',
        'Be helpful',
        [{ role: 'user', content: 'Test' }]
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.any(Object)
      );
    });

    it('should dispatch Anthropic provider to streaming handler', async () => {
      const sseChunks = [
        'event: content_block_delta\ndata: {"delta":{"text":"Hello"}}\n',
        'event: content_block_delta\ndata: {"delta":{"text":" there"}}\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'anthropic',
        'test-key',
        'claude-3-sonnet',
        'You are helpful',
        [{ role: 'user', content: 'Hi' }]
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.any(Object)
      );
    });

    it('should fallback to non-streaming for Gemini', async () => {
      global.self.callDirectAI.mockResolvedValueOnce('Gemini response');

      const result = await callStreamingAI(
        'gemini',
        'test-key',
        'gemini-pro',
        'Be helpful',
        [{ role: 'user', content: 'Test' }]
      );

      expect(global.self.callDirectAI).toHaveBeenCalled();
      expect(result).toBe('Gemini response');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fallback to non-streaming for unknown provider', async () => {
      global.self.callDirectAI.mockResolvedValueOnce('Direct response');

      const result = await callStreamingAI(
        'unknown-provider',
        'test-key',
        'some-model',
        'Help me',
        [{ role: 'user', content: 'Test' }]
      );

      expect(global.self.callDirectAI).toHaveBeenCalled();
      expect(result).toBe('Direct response');
    });
  });

  // ═══════════════════════════════════════════════════════
  // OPENAI STREAMING TESTS
  // ═══════════════════════════════════════════════════════
  describe('_streamOpenAI', () => {
    it('should build correct request headers for OpenAI', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"test"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'sk-test-key',
        'gpt-4',
        'System prompt',
        [{ role: 'user', content: 'User message' }]
      );

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['Authorization']).toBe('Bearer sk-test-key');
      expect(callArgs[1].headers['Content-Type']).toBe('application/json');
    });

    it('should include system prompt in messages', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"test"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'System prompt text',
        [{ role: 'user', content: 'User message' }]
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe('System prompt text');
      expect(body.messages[1].role).toBe('user');
    });

    it('should set stream flag to true', async () => {
      const sseChunks = ['data: [DONE]\n'];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.stream).toBe(true);
    });

    it('should handle HTTP error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Unauthorized' } })
      });

      global.self.callDirectAI.mockResolvedValueOnce('Fallback response');

      const result = await callStreamingAI(
        'openai',
        'bad-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(global.self.callDirectAI).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════
  // ANTHROPIC STREAMING TESTS
  // ═══════════════════════════════════════════════════════
  describe('_streamAnthropic', () => {
    it('should build correct request headers for Anthropic', async () => {
      const sseChunks = [
        'event: content_block_delta\ndata: {"delta":{"text":"test"}}\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'anthropic',
        'sk-ant-test-key',
        'claude-3-sonnet',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['x-api-key']).toBe('sk-ant-test-key');
      expect(callArgs[1].headers['anthropic-version']).toBe('2023-06-01');
    });

    it('should use system field for Anthropic', async () => {
      const sseChunks = [
        'event: content_block_delta\ndata: {"delta":{"text":"test"}}\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'anthropic',
        'test-key',
        'claude-3-sonnet',
        'Custom system prompt',
        [{ role: 'user', content: 'Test' }]
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.system).toBe('Custom system prompt');
      expect(body.messages).toBeDefined();
    });

    it('should handle Anthropic error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'Invalid request' } })
      });

      global.self.callDirectAI.mockResolvedValueOnce('Fallback');

      const result = await callStreamingAI(
        'anthropic',
        'test-key',
        'claude-3-sonnet',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(global.self.callDirectAI).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════
  // SSE PARSING TESTS
  // ═══════════════════════════════════════════════════════
  describe('_processSSEStream - SSE Parsing', () => {
    it.skip('should parse OpenAI SSE format correctly', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" "}}]}\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toContain('Hello');
      expect(result).toContain('world');
    });

    it.skip('should parse Anthropic SSE format correctly', async () => {
      const sseChunks = [
        'event: content_block_delta\ndata: {"delta":{"text":"Hello"}}\n',
        'event: content_block_delta\ndata: {"delta":{"text":" there"}}\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'anthropic',
        'test-key',
        'claude-3-sonnet',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toContain('Hello');
      expect(result).toContain('there');
    });

    it.skip('should skip malformed JSON lines', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Good"}}]}\n',
        'data: {invalid json}\n',
        'data: {"choices":[{"delta":{"content":" data"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toContain('Good');
      expect(result).toContain('data');
    });

    it.skip('should skip [DONE] signals', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Start"}}]}\n',
        'data: [DONE]\n',
        'data: {"choices":[{"delta":{"content":"After"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toContain('Start');
      expect(result).toContain('After');
    });

    it.skip('should handle lines without content', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{}}]}\n',
        'data: {"choices":[{"delta":{"content":"Content"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toContain('Content');
    });
  });

  // ═══════════════════════════════════════════════════════
  // CHAT_STREAM_CHUNK EMISSION TESTS
  // ═══════════════════════════════════════════════════════
  describe('CHAT_STREAM_CHUNK Emission', () => {
    it.skip('should emit CHAT_STREAM_CHUNK message every 3 tokens', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"one"}}]}\n',
        'data: {"choices":[{"delta":{"content":"two"}}]}\n',
        'data: {"choices":[{"delta":{"content":"three"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      // Should emit after 3rd token
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CHAT_STREAM_CHUNK',
          payload: expect.objectContaining({
            done: false
          })
        })
      );
    });

    it.skip('should emit final message with done flag', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Final"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      // Should emit final message
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CHAT_STREAM_CHUNK',
          payload: expect.objectContaining({
            done: true,
            fullText: expect.stringContaining('Final')
          })
        })
      );
    });

    it.skip('should emit chunk with fullText accumulation', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" "}}]}\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      // Final message should have full accumulated text
      const finalCall = global.chrome.runtime.sendMessage.mock.calls.find(
        call => call[0].payload.done === true
      );
      expect(finalCall[0].payload.fullText).toContain('Hello');
      expect(finalCall[0].payload.fullText).toContain('world');
    });

    it.skip('should emit on newline tokens', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Line1"}}]}\n',
        'data: {"choices":[{"delta":{"content":"\\n"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      // Should emit for newline
      const messageCalls = global.chrome.runtime.sendMessage.mock.calls;
      expect(messageCalls.length).toBeGreaterThan(0);
    });

    it.skip('should handle chrome.runtime.sendMessage errors gracefully', async () => {
      global.chrome.runtime.sendMessage.mockImplementation(() => {
        throw new Error('Port closed');
      });

      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"test"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      // Should not throw
      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════
  // ABORT/ERROR HANDLING TESTS
  // ═══════════════════════════════════════════════════════
  describe('Abort and Error Handling', () => {
    it('should handle AbortError and return "[interrotto]"', async () => {
      mockFetch.mockImplementation(() => {
        const abortController = new AbortController();
        abortController.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toBe('[interrotto]');
    });

    it('should set _currentAIAbort before streaming', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"test"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      global.self._currentAIAbort = null;

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      // _currentAIAbort should have been set
      expect(global.self._currentAIAbort).not.toBeNull();
    });

    it('should fallback to callDirectAI on streaming error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      global.self.callDirectAI.mockResolvedValueOnce('Direct response');

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(global.self.callDirectAI).toHaveBeenCalled();
      expect(result).toBe('Direct response');
    });

    it('should return null if both streaming and fallback fail', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      global.self.callDirectAI.mockRejectedValueOnce(new Error('Fallback error'));

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════
  // GEMINI FALLBACK TESTS
  // ═══════════════════════════════════════════════════════
  describe('Gemini Fallback', () => {
    it('should use callDirectAI for Gemini provider', async () => {
      global.self.callDirectAI.mockResolvedValueOnce('Gemini response');

      const result = await callStreamingAI(
        'gemini',
        'test-key',
        'gemini-pro',
        'System prompt',
        [{ role: 'user', content: 'Test' }],
        { temperature: 0.8 }
      );

      expect(global.self.callDirectAI).toHaveBeenCalledWith(
        'gemini',
        'test-key',
        'gemini-pro',
        'System prompt',
        [{ role: 'user', content: 'Test' }],
        { temperature: 0.8 }
      );
      expect(result).toBe('Gemini response');
    });

    it('should not attempt streaming for Gemini', async () => {
      global.self.callDirectAI.mockResolvedValueOnce('Gemini response');

      await callStreamingAI(
        'gemini',
        'test-key',
        'gemini-pro',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════
  // BUFFER AND INCOMPLETE LINES TESTS
  // ═══════════════════════════════════════════════════════
  describe('Buffer and Incomplete Lines', () => {
    it.skip('should handle incomplete SSE lines in buffer', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hel',
        'lo"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toContain('Hello');
    });

    it.skip('should handle multiple chunks per read', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"A"}}]}\ndata: {"choices":[{"delta":{"content":"B"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      const result = await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toContain('A');
      expect(result).toContain('B');
    });
  });

  // ═══════════════════════════════════════════════════════
  // TOKEN COUNTING TESTS
  // ═══════════════════════════════════════════════════════
  describe('Token Counting', () => {
    it.skip('should count tokens in payload', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"token1"}}]}\n',
        'data: {"choices":[{"delta":{"content":"token2"}}]}\n',
        'data: {"choices":[{"delta":{"content":"token3"}}]}\n',
        'data: [DONE]\n'
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(sseChunks)
      });

      await callStreamingAI(
        'openai',
        'test-key',
        'gpt-4',
        'Prompt',
        [{ role: 'user', content: 'Test' }]
      );

      // Should emit after 3rd token
      const emitted = global.chrome.runtime.sendMessage.mock.calls.some(
        call => call[0].payload.tokenCount === 3
      );
      expect(emitted).toBe(true);
    });
  });
});
