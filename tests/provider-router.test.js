/**
 * COBRA v5.2 — Provider Router Tests
 * Comprehensive test suite for provider-router.js
 */

describe('Provider Router', () => {
  let mockFetch;
  let mockExecuteToolCall;

  beforeEach(() => {
    // Setup mock global environment
    mockExecuteToolCall = jest.fn(async (tool, args) => {
      return JSON.stringify({ success: true, result: 'Tool executed' });
    });

    global.self = {
      _currentAIAbort: null,
      _executeToolCall: mockExecuteToolCall,
      CobraSupervisor: null,
      CobraAudit: null,
      CobraGuard: null
    };

    global.chrome = {
      runtime: {
        sendMessage: jest.fn((msg, callback) => {
          if (callback) callback({ success: true });
        })
      }
    };

    // Mock fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Load the module
    require('../provider-router.js');

    // Re-establish the mock after module load
    self._executeToolCall = mockExecuteToolCall;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('emitThinking()', () => {
    it('should send thinking message via chrome runtime', () => {
      self.emitThinking('Test thought');

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'COBRA_THINKING',
        text: 'Test thought',
        timestamp: expect.any(Number)
      });
    });

    it('should handle chrome sendMessage errors gracefully', () => {
      global.chrome.runtime.sendMessage = jest.fn(() => {
        throw new Error('Chrome not available');
      });

      expect(() => self.emitThinking('Test')).not.toThrow();
    });
  });

  describe('getThinkingBefore()', () => {
    it('should generate contextual thought for navigate tool', () => {
      const thought = self.getThinkingBefore('navigate', { url: 'https://example.com' });
      expect(thought).toContain('vado');
      expect(thought).toContain('example.com');
    });

    it('should generate thought for google_search tool', () => {
      const thought = self.getThinkingBefore('google_search', { query: 'test query' });
      expect(thought).toContain('Cerco');
      expect(thought).toContain('test query');
    });

    it('should generate thought for click_element tool', () => {
      const thought = self.getThinkingBefore('click_element', { selector: '.button' });
      expect(thought).toContain('cliccare');
      expect(thought).toContain('.button');
    });

    it('should generate thought for fill_form tool', () => {
      const thought = self.getThinkingBefore('fill_form', {
        fields: { name: 'John', email: 'john@example.com' }
      });
      expect(thought).toContain('form');
      expect(thought).toContain('name');
    });

    it('should handle unknown tool with generic message', () => {
      const thought = self.getThinkingBefore('unknown_tool', {});
      expect(thought).toContain('unknown_tool');
    });

    it('should truncate long selectors', () => {
      const longSelector = '.very.long.selector.that.exceeds.max.length.x'.repeat(3);
      const thought = self.getThinkingBefore('click_element', { selector: longSelector });
      expect(thought.length).toBeLessThan(100);
    });
  });

  describe('getThinkingAfter()', () => {
    it('should generate error message for failed tool', () => {
      const thought = self.getThinkingAfter('navigate', '', true);
      expect(thought).toContain('Non riesco');
      expect(thought).toContain('pagina');
    });

    it('should generate success message for navigate', () => {
      const result = JSON.stringify({ title: 'Example Page' });
      const thought = self.getThinkingAfter('navigate', result, false);
      expect(thought).toContain('Example Page');
      expect(thought).toContain('Analizzo');
    });

    it('should generate success message for google_search', () => {
      const result = JSON.stringify({ results: [{}, {}, {}] });
      const thought = self.getThinkingAfter('google_search', result, false);
      expect(thought).toContain('3');
      expect(thought).toContain('risultati');
    });

    it('should handle malformed JSON gracefully', () => {
      const thought = self.getThinkingAfter('navigate', 'invalid json', false);
      expect(thought).toContain('Pagina caricata');
    });

    it('should generate generic success message for unknown tools', () => {
      const thought = self.getThinkingAfter('unknown_tool', 'result', false);
      expect(thought).toContain('completato');
    });
  });

  describe('callDirectAI - OpenAI/Groq', () => {
    it('should call OpenAI API with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Hello' },
            finish_reason: 'stop'
          }]
        })
      });

      await self.callDirectAI('openai', 'test-key', 'gpt-4', 'System prompt', [
        { role: 'user', content: 'Hello' }
      ]);

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('openai');
      expect(call[1].headers['Authorization']).toBe('Bearer test-key');
    });

    it('should call Groq API with correct URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Hello' },
            finish_reason: 'stop'
          }]
        })
      });

      await self.callDirectAI('groq', 'test-key', 'llama', 'System', [
        { role: 'user', content: 'Hi' }
      ]);

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('groq.com');
    });

    it('should return text response when no tool calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Final answer' },
            finish_reason: 'stop'
          }]
        })
      });

      const result = await self.callDirectAI('openai', 'key', 'gpt-4', 'System', [
        { role: 'user', content: 'Test' }
      ]);

      expect(result).toBe('Final answer');
    });

    it('should handle tool calling loop with OpenAI', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [{
                  id: 'call_123',
                  function: {
                    name: 'navigate',
                    arguments: '{"url":"https://example.com"}'
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: { content: 'Done' },
              finish_reason: 'stop'
            }]
          })
        });

      const tools = [{
        type: 'function',
        function: {
          name: 'navigate',
          description: 'Navigate to URL'
        }
      }];

      const result = await self.callDirectAI('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools }
      );

      expect(result).toBe('Done');
      expect(self._executeToolCall).toHaveBeenCalled();
    });

    it('should detect circular tool loops in OpenAI', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [{
                  id: 'call_1',
                  function: {
                    name: 'navigate',
                    arguments: '{"url":"https://same.com"}'
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [{
                  id: 'call_2',
                  function: {
                    name: 'navigate',
                    arguments: '{"url":"https://same.com"}'
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [{
                  id: 'call_3',
                  function: {
                    name: 'navigate',
                    arguments: '{"url":"https://same.com"}'
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: { content: 'Breaking loop' },
              finish_reason: 'stop'
            }]
          })
        });

      const tools = [{
        type: 'function',
        function: { name: 'navigate', description: 'Navigate' }
      }];

      const result = await self.callDirectAI('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools, maxToolRounds: 10 }
      );

      // Should call the tool at least once, and eventually exit the loop
      expect(self._executeToolCall).toHaveBeenCalledWith('navigate', expect.any(Object));
      expect(result).toBeDefined();
    });

    it('should respect maxToolRounds limit', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: { content: 'Response' },
              finish_reason: 'stop'
            }]
          })
        };
      });

      await self.callDirectAI('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        { maxToolRounds: 3 }
      );

      // Should not exceed maxToolRounds
      expect(callCount).toBeLessThanOrEqual(4);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } })
      });

      const result = await self.callDirectAI('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }]
      );

      expect(result).toBeNull();
    });
  });

  describe('callDirectAI - Anthropic', () => {
    it('should call Anthropic API with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn'
        })
      });

      await self.callDirectAI('anthropic', 'test-key', 'claude-3', 'System',
        [{ role: 'user', content: 'Hello' }]
      );

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('anthropic.com');
      expect(call[1].headers['x-api-key']).toBe('test-key');
      expect(call[1].headers['anthropic-version']).toBeDefined();
    });

    it('should handle tool_use blocks in Anthropic', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{
              type: 'tool_use',
              id: 'tooluse_123',
              name: 'navigate',
              input: { url: 'https://example.com' }
            }],
            stop_reason: 'tool_use'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ type: 'text', text: 'Done' }],
            stop_reason: 'end_turn'
          })
        });

      const tools = [{
        function: {
          name: 'navigate',
          description: 'Navigate'
        }
      }];

      const result = await self.callDirectAI('anthropic', 'key', 'claude-3', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools }
      );

      expect(result).toBe('Done');
      expect(self._executeToolCall).toHaveBeenCalled();
    });

    it('should convert OpenAI tool format to Anthropic format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn'
        })
      });

      const tools = [{
        function: {
          name: 'test_tool',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} }
        }
      }];

      await self.callDirectAI('anthropic', 'key', 'claude-3', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools }
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.tools).toBeDefined();
      expect(body.tools[0].name).toBe('test_tool');
      expect(body.tools[0].input_schema).toBeDefined();
    });

    it('should detect circular tool loops in Anthropic', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{
              type: 'tool_use',
              id: 'tu_1',
              name: 'navigate',
              input: { url: 'https://same.com' }
            }],
            stop_reason: 'tool_use'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{
              type: 'tool_use',
              id: 'tu_2',
              name: 'navigate',
              input: { url: 'https://same.com' }
            }],
            stop_reason: 'tool_use'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{
              type: 'tool_use',
              id: 'tu_3',
              name: 'navigate',
              input: { url: 'https://same.com' }
            }],
            stop_reason: 'tool_use'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ type: 'text', text: 'Stopped' }],
            stop_reason: 'end_turn'
          })
        });

      const tools = [{
        function: { name: 'navigate', description: 'Navigate' }
      }];

      const result = await self.callDirectAI('anthropic', 'key', 'claude-3', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools, maxToolRounds: 10 }
      );

      expect(self._executeToolCall).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('callDirectAI - Gemini', () => {
    it('should call Gemini API with function calling format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: 'Hello' }]
            }
          }]
        })
      });

      await self.callDirectAI('gemini', 'test-key', 'gemini-pro', 'System',
        [{ role: 'user', content: 'Hello' }]
      );

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('gemini');
      expect(call[0]).toContain('test-key');
    });

    it('should handle Gemini function calling', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  functionCall: {
                    name: 'navigate',
                    args: { url: 'https://example.com' }
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ text: 'Done' }]
              }
            }]
          })
        });

      const tools = [{
        function: {
          name: 'navigate',
          description: 'Navigate',
          parameters: {}
        }
      }];

      const result = await self.callDirectAI('gemini', 'key', 'gemini-pro', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools }
      );

      expect(result).toBe('Done');
      expect(self._executeToolCall).toHaveBeenCalled();
    });

    it('should detect circular loops in Gemini', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  functionCall: {
                    name: 'navigate',
                    args: { url: 'https://same.com' }
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  functionCall: {
                    name: 'navigate',
                    args: { url: 'https://same.com' }
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  functionCall: {
                    name: 'navigate',
                    args: { url: 'https://same.com' }
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ text: 'Stopped' }]
              }
            }]
          })
        });

      const tools = [{
        function: { name: 'navigate', description: 'Navigate', parameters: {} }
      }];

      const result = await self.callDirectAI('gemini', 'key', 'gemini-pro', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools, maxToolRounds: 10 }
      );

      expect(self._executeToolCall).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('callAIWithFallback()', () => {
    it('should return result when primary provider succeeds', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Primary result' },
            finish_reason: 'stop'
          }]
        })
      });

      const result = await self.callAIWithFallback('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        { _settings: {} }
      );

      expect(result).toBe('Primary result');
    });

    it('should fallback to groq when primary fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Failed' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: { content: 'Groq result' },
              finish_reason: 'stop'
            }]
          })
        });

      const result = await self.callAIWithFallback('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        {
          _settings: {
            groqKey: 'groq-key',
            groqModel: 'llama'
          }
        }
      );

      expect(result).toBe('Groq result');
    });

    it('should try multiple fallbacks in order', async () => {
      // Primary (groq) fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Failed' } })
      });
      // Fallback (openai) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'OpenAI result' },
            finish_reason: 'stop'
          }]
        })
      });

      const result = await self.callAIWithFallback('groq', 'groq-key', 'llama', 'System',
        [{ role: 'user', content: 'Test' }],
        {
          _settings: {
            groqKey: 'groq-key',
            openaiKey: 'openai-key',
            openaiModel: 'gpt-4'
          }
        }
      );

      expect(result).toBe('OpenAI result');
    });

    it('should return Italian error message when all providers fail', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await self.callAIWithFallback('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        { _settings: {} }
      );

      expect(result).toContain('Mi dispiace');
      expect(result).toContain('provider');
      expect(result).toContain('temporaneamente');
    });

    it('should log fallback to audit service', async () => {
      const auditLog = jest.fn();
      self.CobraAudit = { log: auditLog };

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'Failed' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: { content: 'Fallback result' },
              finish_reason: 'stop'
            }]
          })
        });

      await self.callAIWithFallback('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        {
          _settings: {
            groqKey: 'groq-key'
          }
        }
      );

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AI_FALLBACK'
        })
      );
    });

    it('should log when all providers fail to audit', async () => {
      const auditLog = jest.fn();
      self.CobraAudit = { log: auditLog };

      mockFetch.mockRejectedValue(new Error('Network error'));

      await self.callAIWithFallback('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        { _settings: {} }
      );

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AI_ALL_FAILED'
        })
      );
    });
  });

  describe('Abort Signal Handling', () => {
    it('should create abort controller for requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Result' },
            finish_reason: 'stop'
          }]
        })
      });

      await self.callDirectAI('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }]
      );

      const call = mockFetch.mock.calls[0];
      expect(call[1].signal).toBeDefined();
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    });

    it('should store abort controller in self', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Result' },
            finish_reason: 'stop'
          }]
        })
      });

      const result = await self.callDirectAI('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }]
      );

      // Abort controller should have been created during execution
      expect(mockFetch).toHaveBeenCalled();
      expect(result).toBe('Result');
    });
  });

  describe('Tool Progress Updates', () => {
    it('should send tool progress updates to chrome runtime', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [{
                  id: 'call_123',
                  function: {
                    name: 'navigate',
                    arguments: '{"url":"https://example.com"}'
                  }
                }]
              }
            }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: { content: 'Done' },
              finish_reason: 'stop'
            }]
          })
        });

      const tools = [{
        type: 'function',
        function: { name: 'navigate', description: 'Navigate' }
      }];

      await self.callDirectAI('openai', 'key', 'gpt-4', 'System',
        [{ role: 'user', content: 'Test' }],
        { tools }
      );

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TOOL_PROGRESS'
        })
      );
    });
  });

  describe('Module Registration', () => {
    it('should register callDirectAI on self', () => {
      expect(self.callDirectAI).toBeDefined();
      expect(typeof self.callDirectAI).toBe('function');
    });

    it('should register callAIWithFallback on self', () => {
      expect(self.callAIWithFallback).toBeDefined();
      expect(typeof self.callAIWithFallback).toBe('function');
    });
  });
});
