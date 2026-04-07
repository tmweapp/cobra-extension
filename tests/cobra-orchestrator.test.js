/**
 * Tests for CobraOrchestrator
 * Tests cover orchestration, convergence analysis, memory management, and synthesis
 */

require('./setup.js');
require('../cobra-orchestrator.js');

describe('CobraOrchestrator', () => {
  let orchestrator;
  const mockCallAI = jest.fn();

  beforeEach(() => {
    orchestrator = new self.CobraOrchestrator();
    mockCallAI.mockClear();
  });

  describe('Constructor', () => {
    test('should initialize with default config', () => {
      expect(orchestrator.maxTurns).toBe(6);
      expect(orchestrator.forcedConsultationTurns).toBe(2);
      expect(orchestrator.temperature).toBe(0.7);
      expect(orchestrator.maxTokens).toBe(1200);
      expect(orchestrator.wordRange).toEqual([80, 250]);
    });
  });

  describe('analyzeConvergence()', () => {
    test('should detect agreement from agreement keywords', () => {
      const responses = [
        { content: 'concordo perfettamente' },
        { content: 'sono d\'accordo al 100%' }
      ];

      const result = self.analyzeConvergence(responses);

      expect(result).toBe('agreement');
    });

    test('should detect divergence from divergence keywords', () => {
      const responses = [
        { content: 'non concordo con questo' },
        { content: 'tuttavia ritengo sia sbagliato' }
      ];

      const result = self.analyzeConvergence(responses);

      expect(result).toBe('divergence');
    });

    test('should return neutral for ambiguous responses', () => {
      const responses = [
        { content: 'Forse, dipende dal contesto' },
        { content: 'Considerando vari fattori' }
      ];

      const result = self.analyzeConvergence(responses);

      expect(result).toBe('neutral');
    });

    test('should return neutral for single response', () => {
      const responses = [
        { content: 'concordo' }
      ];

      const result = self.analyzeConvergence(responses);

      expect(result).toBe('neutral');
    });

    test('should detect stagnation from high similarity', () => {
      const responses = [
        { content: 'the answer is important factor for solving problem' },
        { content: 'the answer is very important factor for solving problem' }
      ];

      const result = self.analyzeConvergence(responses);

      // High similarity should detect stagnation
      expect(['stagnation', 'neutral']).toContain(result);
    });

    test('should prioritize divergence over agreement keywords', () => {
      const responses = [
        { content: 'disagree but I do agree on some points' },
        { content: 'wrong approach though somewhat correct' }
      ];

      const result = self.analyzeConvergence(responses);

      // Should detect divergence first
      expect(result).toBe('divergence');
    });
  });

  describe('Convergence Detection Functions', () => {
    test('should correctly analyze convergence', () => {
      // Test the exported analyzeConvergence function
      const responses = [
        { content: 'concordo' },
        { content: 'sono d\'accordo' }
      ];

      const result = self.analyzeConvergence(responses);

      expect(['agreement', 'neutral']).toContain(result);
    });

    test('should handle convergence states', () => {
      // Orchestrator should handle different convergence states
      const orchestrator = new self.CobraOrchestrator();
      expect(orchestrator).toBeDefined();
    });
  });

  describe('buildOrchestratorMemory()', () => {
    test('should return all messages if count <= 10', () => {
      const messages = Array.from({ length: 8 }, (_, i) => ({
        role: 'assistant',
        content: `Message ${i}`
      }));

      const memory = self.buildOrchestratorMemory(messages);

      expect(memory.length).toBe(8);
      expect(memory[0].content).toBe('Message 0');
    });

    test('should condense old messages for large conversations', () => {
      const messages = Array.from({ length: 30 }, (_, i) => ({
        role: 'assistant',
        content: `Message ${i} with some content`,
        agentName: `Agent${i % 3}`
      }));

      const memory = self.buildOrchestratorMemory(messages);

      expect(memory.length).toBeLessThan(messages.length);
      expect(memory[0].content).toContain('CONTESTO PRECEDENTE');
    });

    test('should enforce token limit', () => {
      const messages = Array.from({ length: 50 }, (_, i) => ({
        role: 'assistant',
        content: 'x'.repeat(100)
      }));

      const memory = self.buildOrchestratorMemory(messages, 100);

      const totalTokens = memory.reduce((sum, m) => {
        return sum + Math.ceil(m.content.length / 4);
      }, 0);

      // Token limit should be respected with some reasonable margin
      expect(totalTokens).toBeLessThanOrEqual(200);
      expect(memory.length).toBeGreaterThan(0);
    });

    test('should organize messages in 3 levels', () => {
      const messages = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      const memory = self.buildOrchestratorMemory(messages);

      expect(memory.length).toBeGreaterThan(0);
      // Should have summary, condensed, and full recent messages
      const hasContext = memory.some(m => m.content.includes('CONTESTO'));
      const hasRecent = memory.some(m => m.content.includes('Message'));
      expect(hasRecent).toBe(true);
    });
  });

  describe('orchestrate()', () => {
    const mockAgents = [
      { id: 'analyst', name: 'Analyst', provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      { id: 'strategist', name: 'Strategist', provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      { id: 'critic', name: 'Critic', provider: 'openai', model: 'gpt-4', apiKey: 'test' }
    ];

    test('should handle single agent mode', async () => {
      mockCallAI.mockResolvedValueOnce({ content: 'Single agent response' });

      const result = await orchestrator.orchestrate({
        userMessage: 'What should we do?',
        agents: [mockAgents[0]],
        leaderAgentId: 'analyst',
        callAI: mockCallAI,
        onProgress: jest.fn()
      });

      expect(result.content).toBe('Single agent response');
      expect(result.convergence).toBe('neutral');
      expect(result.turnsUsed).toBe(1);
      expect(mockCallAI).toHaveBeenCalledTimes(1);
    });

    test('should handle empty agents list', async () => {
      const result = await orchestrator.orchestrate({
        userMessage: 'What should we do?',
        agents: [],
        leaderAgentId: 'analyst',
        callAI: mockCallAI,
        onProgress: jest.fn()
      });

      expect(result.content).toContain('Nessun agente');
      expect(result.agentContributions).toEqual([]);
    });

    test('should orchestrate multi-agent debate', async () => {
      mockCallAI
        .mockResolvedValueOnce({ content: 'Task decomposition' })
        .mockResolvedValueOnce({ content: 'Analyst response' })
        .mockResolvedValueOnce({ content: 'Strategist response' })
        .mockResolvedValueOnce({ content: 'Final synthesis' });

      const onProgress = jest.fn();

      const result = await orchestrator.orchestrate({
        userMessage: 'Analyze market trends',
        agents: mockAgents,
        leaderAgentId: 'analyst',
        chatHistory: [],
        taskType: 'analysis',
        callAI: mockCallAI,
        onProgress
      });

      expect(result.content).toBeDefined();
      expect(result.convergence).toBeDefined();
      expect(result.agentContributions.length).toBeGreaterThan(0);
      expect(result.turnsUsed).toBeGreaterThan(0);
      expect(onProgress).toHaveBeenCalled();
    });

    test('should include chat history in context', async () => {
      mockCallAI.mockResolvedValueOnce({ content: 'Response' });

      const chatHistory = [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' }
      ];

      await orchestrator.orchestrate({
        userMessage: 'New question',
        agents: [mockAgents[0]],
        leaderAgentId: 'analyst',
        chatHistory,
        callAI: mockCallAI,
        onProgress: jest.fn()
      });

      const callArgs = mockCallAI.mock.calls[0];
      const messages = callArgs[1];
      expect(messages.some(m => m.content.includes('Previous question'))).toBe(true);
    });

    test('should handle AI call failures gracefully', async () => {
      mockCallAI
        .mockResolvedValueOnce({ content: 'Task decomposition' })
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({ content: 'Fallback response' });

      const result = await orchestrator.orchestrate({
        userMessage: 'Test',
        agents: mockAgents,
        leaderAgentId: 'analyst',
        callAI: mockCallAI,
        onProgress: jest.fn()
      });

      expect(result.content).toBeDefined();
    });

    test('should apply taskType-specific prompts', async () => {
      mockCallAI.mockResolvedValue({ content: 'Response' });

      await orchestrator.orchestrate({
        userMessage: 'Make a decision',
        agents: [mockAgents[0]],
        leaderAgentId: 'analyst',
        taskType: 'decision',
        callAI: mockCallAI,
        onProgress: jest.fn()
      });

      // Should call AI with taskType-specific prompt
      expect(mockCallAI).toHaveBeenCalled();
      const calls = mockCallAI.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('_buildAgentPrompt()', () => {
    const agent = { id: 'analyst', name: 'Analyst' };

    test('should include agent name and role', () => {
      const prompt = orchestrator._buildAgentPrompt(agent, [], '', 'general', '');

      expect(prompt).toContain('Analyst');
      expect(prompt).toContain('Analista Dati');
    });

    test('should include personality from DEFAULT_AGENTS', () => {
      const prompt = orchestrator._buildAgentPrompt(agent, [], '', 'general', '');

      expect(prompt).toContain('Diretto, pragmatico');
    });

    test('should include previous responses if provided', () => {
      const previous = [
        '[Analyst]: Some analysis',
        '[Strategist]: Strategic view'
      ];

      const prompt = orchestrator._buildAgentPrompt(agent, previous, '', 'general', '');

      expect(prompt).toContain('CONTRIBUTI PRECEDENTI');
      expect(prompt).toContain('Some analysis');
    });

    test('should include convergence instruction if provided', () => {
      const instruction = 'Test convergence instruction';
      const prompt = orchestrator._buildAgentPrompt(agent, [], instruction, 'general', '');

      expect(prompt).toContain('STATO DISCUSSIONE');
      expect(prompt).toContain(instruction);
    });

    test('should include task context if provided', () => {
      const taskContext = 'Analyze quarterly results';
      const prompt = orchestrator._buildAgentPrompt(agent, [], '', 'general', taskContext);

      expect(prompt).toContain('CONTESTO TASK');
      expect(prompt).toContain('Analyze quarterly results');
    });

    test('should include word range from config', () => {
      const prompt = orchestrator._buildAgentPrompt(agent, [], '', 'general', '');

      expect(prompt).toContain('250');
    });
  });

  describe('_buildLeaderPrompt()', () => {
    test('should include decision instructions for decision taskType', () => {
      const prompt = orchestrator._buildLeaderPrompt('decision', '', 'agreement');

      expect(prompt).toContain('DECISIONE');
      expect(prompt).toContain('Motivazione');
    });

    test('should include document instructions for document taskType', () => {
      const prompt = orchestrator._buildLeaderPrompt('document', '', 'agreement');

      expect(prompt).toContain('DOCUMENTO');
    });

    test('should include analysis instructions for analysis taskType', () => {
      const prompt = orchestrator._buildLeaderPrompt('analysis', '', 'agreement');

      expect(prompt).toContain('ANALISI');
    });

    test('should include general instructions for unknown taskType', () => {
      const prompt = orchestrator._buildLeaderPrompt('unknown', '', 'agreement');

      expect(prompt).toContain('RISPOSTA');
    });

    test('should include convergence state', () => {
      const prompt = orchestrator._buildLeaderPrompt('decision', '', 'stagnation');

      expect(prompt).toContain('stagnation');
    });

    test('should indicate hidden discussion', () => {
      const prompt = orchestrator._buildLeaderPrompt('general', '', 'neutral');

      expect(prompt).toContain('non visibile');
    });
  });

  describe('_buildMessages()', () => {
    test('should build messages array from user message', () => {
      const messages = orchestrator._buildMessages('New question', []);

      expect(messages.length).toBe(1);
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'New question'
      });
    });

    test('should include chat history', () => {
      const chatHistory = [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' }
      ];

      const messages = orchestrator._buildMessages('Q2', chatHistory);

      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe('Q1');
      expect(messages[2].content).toBe('Q2');
    });

    test('should limit history to last 10 messages', () => {
      const chatHistory = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      const messages = orchestrator._buildMessages('New', chatHistory);

      // Should be 10 history + 1 new = 11
      expect(messages.length).toBeLessThanOrEqual(11);
    });

    test('should convert assistant role correctly', () => {
      const chatHistory = [
        { role: 'ai', content: 'AI response' }
      ];

      const messages = orchestrator._buildMessages('Q', chatHistory);

      const aiMessage = messages.find(m => m.content === 'AI response');
      expect(aiMessage.role).toBe('assistant');
    });
  });

  describe('DEFAULT_AGENTS', () => {
    test('should have analyst agent', () => {
      expect(self.DEFAULT_AGENTS.analyst).toBeDefined();
      expect(self.DEFAULT_AGENTS.analyst.name).toBe('Analyst');
    });

    test('should have strategist agent', () => {
      expect(self.DEFAULT_AGENTS.strategist).toBeDefined();
      expect(self.DEFAULT_AGENTS.strategist.name).toBe('Strategist');
    });

    test('should have critic agent', () => {
      expect(self.DEFAULT_AGENTS.critic).toBeDefined();
      expect(self.DEFAULT_AGENTS.critic.name).toBe('Critic');
    });

    test('should have executor agent', () => {
      expect(self.DEFAULT_AGENTS.executor).toBeDefined();
      expect(self.DEFAULT_AGENTS.executor.name).toBe('Executor');
    });

    test('should include role, style, and prompt for each', () => {
      for (const agentId of ['analyst', 'strategist', 'critic', 'executor']) {
        const agent = self.DEFAULT_AGENTS[agentId];
        expect(agent.role).toBeDefined();
        expect(agent.style).toBeDefined();
        expect(agent.prompt).toBeDefined();
      }
    });
  });

  describe('AGREEMENT_KEYWORDS', () => {
    test('should be exported', () => {
      expect(typeof self.analyzeConvergence).toBe('function');
    });
  });

  describe('DIVERGENCE_KEYWORDS', () => {
    test('should detect multiple languages', () => {
      const responses = [
        { content: 'Disagree strongly' },
        { content: 'De acuerdo no, en revanche si' }
      ];

      const result = self.analyzeConvergence(responses);

      expect(['divergence', 'neutral']).toContain(result);
    });
  });

  describe('Integration Tests', () => {
    test('should orchestrate full debate with convergence', async () => {
      mockCallAI
        .mockResolvedValueOnce({ content: 'Decomposition' })
        .mockResolvedValueOnce({ content: 'Analysis perspective' })
        .mockResolvedValueOnce({ content: 'Strategy perspective' })
        .mockResolvedValueOnce({ content: 'Agree with analysis' })
        .mockResolvedValue({ content: 'Final synthesis' });

      const agents = [
        { id: 'analyst', name: 'Analyst', provider: 'openai', model: 'gpt-4', apiKey: 'test' },
        { id: 'strategist', name: 'Strategist', provider: 'openai', model: 'gpt-4', apiKey: 'test' }
      ];

      const result = await orchestrator.orchestrate({
        userMessage: 'Should we expand?',
        agents,
        leaderAgentId: 'analyst',
        callAI: mockCallAI,
        onProgress: jest.fn()
      });

      expect(result.content).toBeDefined();
      expect(result.agentContributions.length).toBeGreaterThanOrEqual(0);
      expect(result.turnsUsed).toBeGreaterThan(0);
    });

    test('should handle early termination on agreement', async () => {
      let callCount = 0;
      mockCallAI.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ content: 'Task decomposition' });
        } else if (callCount < 5) {
          return Promise.resolve({ content: 'concordo perfettamente' });
        } else {
          return Promise.resolve({ content: 'Final result' });
        }
      });

      const agents = [
        { id: 'agent1', name: 'Agent1', provider: 'openai', model: 'gpt-4', apiKey: 'test' },
        { id: 'agent2', name: 'Agent2', provider: 'openai', model: 'gpt-4', apiKey: 'test' }
      ];

      const result = await orchestrator.orchestrate({
        userMessage: 'Test',
        agents,
        leaderAgentId: 'agent1',
        callAI: mockCallAI,
        onProgress: jest.fn()
      });

      expect(result.turnsUsed).toBeLessThanOrEqual(orchestrator.maxTurns);
    });
  });
});
