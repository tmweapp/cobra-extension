/**
 * COBRA Session Diary Tests
 * Tests for start, appendEvent, consolidate, promotion, and IndexedDB persistence
 */

const SessionDiary = require('../session-diary.js');

describe('SessionDiary', () => {
  let diary;
  let mockKB;
  let mockBrain;

  beforeEach(() => {
    // Mock KnowledgeBase
    mockKB = {
      rules: [
        {
          id: 'rule-1',
          workspace_id: 'test-workspace',
          title: 'Test Rule',
          content: 'Test content',
          tier: 'hot',
          createdAt: new Date().toISOString(),
          category: 'regola',
          tags: ['test']
        }
      ],
      getWorkspaceContext: jest.fn(() => ({
        guide: 'Test workspace guide',
        milestones: [{ id: 'M-1', title: 'Test Milestone' }],
        recentActions: [{ timestamp: new Date().toISOString(), action: 'test_action' }]
      })),
      addRuleWithAutoTag: jest.fn(async (rule) => {
        mockKB.rules.push({ ...rule, id: crypto.randomUUID() });
        return true;
      }),
      addRule: jest.fn(async (rule) => {
        mockKB.rules.push({ ...rule, id: crypto.randomUUID() });
        return true;
      }),
      save: jest.fn(async () => {})
    };

    // Mock Brain
    mockBrain = {
      askClaude: jest.fn()
        .mockImplementationOnce(async (prompt, opts) => {
          // First call: briefing
          return '## Briefing Operativo\n- Contesto: test\n- Regole: active\n- Esempi: recent\n- Attenzioni: none';
        })
        .mockImplementation(async (prompt, opts) => {
          // Subsequent calls: consolidation
          if (prompt.includes('Consolida')) {
            return JSON.stringify({
              summary: ['Point 1', 'Point 2', 'Point 3'],
              new_rules: [
                { title: 'New Rule', content: 'New content', domain: null, operationType: 'general' }
              ],
              milestones: [],
              guide_updates: []
            });
          }
          return '{}';
        })
    };

    diary = new SessionDiary('test-workspace', mockKB, mockBrain);

    // Mock self.Brain for consolidate() and other methods that use self.Brain
    self.Brain = mockBrain;
  });

  describe('init()', () => {
    test('should initialize IndexedDB', async () => {
      await diary.init();
      expect(diary._initialized).toBe(true);
      expect(diary._db).not.toBeNull();
    });

    test('should be idempotent', async () => {
      await diary.init();
      const db1 = diary._db;
      await diary.init();
      const db2 = diary._db;
      expect(db1).toBe(db2);
    });
  });

  describe('start()', () => {
    test('should create session with briefing', async () => {
      await diary.init();
      const result = await diary.start('test-workspace');

      expect(result.sessionId).toBeDefined();
      expect(result.briefing).toBeDefined();
      expect(result.briefing).toContain('Briefing Operativo');
    });

    test('should call mockBrain.askClaude with workspace context', async () => {
      await diary.init();
      await diary.start('test-workspace');

      expect(mockBrain.askClaude).toHaveBeenCalled();
      const [prompt] = mockBrain.askClaude.mock.calls[0];
      expect(prompt).toContain('briefing');
    });

    test('should persist session to IndexedDB', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      const session = await diary.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session.workspaceId).toBe('test-workspace');
      expect(session.status).toBe('active');
    });

    test('should fail if KB not available', async () => {
      diary.kb = null;
      await diary.init();
      await expect(diary.start('test-workspace')).rejects.toThrow('KnowledgeBase');
    });

    test('should fail if Brain not available', async () => {
      diary.brain = null;
      await diary.init();
      await expect(diary.start('test-workspace')).rejects.toThrow('Brain');
    });
  });

  describe('appendEvent()', () => {
    test('should append event to session', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      const event = { type: 'action', payload: { action: 'click', selector: '#button' } };
      await diary.appendEvent(sessionId, event);

      const session = await diary.getSession(sessionId);
      expect(session.events).toHaveLength(1);
      expect(session.events[0].type).toBe('action');
      expect(session.events[0].payload.action).toBe('click');
    });

    test('should support multiple events', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      await diary.appendEvent(sessionId, { type: 'action', payload: { action: 'click' } });
      await diary.appendEvent(sessionId, { type: 'decision', payload: { decision: 'yes' } });
      await diary.appendEvent(sessionId, { type: 'error', payload: { error: 'failed' } });

      const session = await diary.getSession(sessionId);
      expect(session.events).toHaveLength(3);
      expect(session.events[2].type).toBe('error');
    });

    test('should timestamp each event', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      await diary.appendEvent(sessionId, { type: 'action', payload: {} });
      const session = await diary.getSession(sessionId);

      expect(session.events[0].timestamp).toBeDefined();
      const eventTime = new Date(session.events[0].timestamp).getTime();
      expect(Math.abs(eventTime - Date.now())).toBeLessThan(1000); // within 1 second
    });

    test('should fail if session not found', async () => {
      await diary.init();
      await expect(diary.appendEvent('non-existent-session', { type: 'action', payload: {} }))
        .rejects.toThrow('not found');
    });

    test('should set source to manual by default', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      await diary.appendEvent(sessionId, { type: 'action', payload: {} });
      const session = await diary.getSession(sessionId);

      expect(session.events[0].source).toBe('manual');
    });

    test('should respect custom source', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      await diary.appendEvent(sessionId, { type: 'action', payload: {}, source: 'auto_learn' });
      const session = await diary.getSession(sessionId);

      expect(session.events[0].source).toBe('auto_learn');
    });
  });

  describe('consolidate()', () => {
    test('should consolidate session with AI', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.appendEvent(sessionId, { type: 'action', payload: { action: 'click' } });

      const consolidation = await diary.consolidate(sessionId);

      expect(consolidation.summary).toBeDefined();
      expect(Array.isArray(consolidation.summary)).toBe(true);
    });

    test('should mark session as completed', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.consolidate(sessionId);

      const session = await diary.getSession(sessionId);
      expect(session.status).toBe('completed');
    });

    test('should store consolidation result', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.consolidate(sessionId);

      const session = await diary.getSession(sessionId);
      expect(session.consolidation).toBeDefined();
      expect(session.consolidation.summary).toBeDefined();
    });

    test('should promote new rule candidates', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.consolidate(sessionId);

      expect(mockKB.addRuleWithAutoTag).toHaveBeenCalled();
    });

    test('should set consolidatedAt timestamp', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.consolidate(sessionId);

      const session = await diary.getSession(sessionId);
      expect(session.consolidatedAt).toBeDefined();
      const time = new Date(session.consolidatedAt).getTime();
      expect(Math.abs(time - Date.now())).toBeLessThan(1000);
    });

    test('should handle JSON parse error gracefully', async () => {
      mockBrain.askClaude.mockResolvedValueOnce('invalid json {');
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      const consolidation = await diary.consolidate(sessionId);
      expect(consolidation.summary).toEqual(['Consolidamento completato con errore JSON']);
    });
  });

  describe('_promoteCandidates()', () => {
    test('should add rules via KB.addRuleWithAutoTag', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.appendEvent(sessionId, { type: 'action', payload: {} });

      await diary.consolidate(sessionId);

      expect(mockKB.addRuleWithAutoTag).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Rule',
          content: 'New content',
          source: 'session_consolidation'
        })
      );
    });

    test('should fallback to addRule if addRuleWithAutoTag not available', async () => {
      mockKB.addRuleWithAutoTag = undefined;
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      await diary.consolidate(sessionId);

      expect(mockKB.addRule).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Rule',
          source: 'session_consolidation'
        })
      );
    });

    test('should call KB.save after adding rules', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.consolidate(sessionId);

      expect(mockKB.save).toHaveBeenCalled();
    });

    test('should handle promotion errors gracefully', async () => {
      mockKB.addRuleWithAutoTag.mockRejectedValueOnce(new Error('Add failed'));
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      expect(async () => {
        await diary.consolidate(sessionId);
      }).not.toThrow();
    });
  });

  describe('getActiveSession()', () => {
    test('should return an active session if exists', async () => {
      // Use a fresh diary for this test to avoid cross-contamination
      const freshDiary = new SessionDiary('fresh-workspace', mockKB, mockBrain);
      await freshDiary.init();
      const { sessionId } = await freshDiary.start('fresh-workspace');

      const active = await freshDiary.getActiveSession();
      expect(active).toBeDefined();
      expect(active.status).toBe('active');
    });

    test('should only return sessions with active status', async () => {
      // Use a fresh diary for this test
      const freshDiary = new SessionDiary('test-workspace-unique', mockKB, mockBrain);
      await freshDiary.init();
      const { sessionId } = await freshDiary.start('test-workspace-unique');

      // Close the session
      await freshDiary.closeSession(sessionId);
      const closed = await freshDiary.getSession(sessionId);
      expect(closed.status).toBe('cancelled');

      // getActiveSession should skip closed sessions
      const active = await freshDiary.getActiveSession();
      if (active) {
        // If there's an active session, it must not be the closed one
        expect(active.id).not.toBe(sessionId);
      }
    });
  });

  describe('closeSession()', () => {
    test('should mark session as cancelled', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      await diary.closeSession(sessionId);

      const session = await diary.getSession(sessionId);
      expect(session.status).toBe('cancelled');
    });

    test('should set closedAt timestamp', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      await diary.closeSession(sessionId);

      const session = await diary.getSession(sessionId);
      expect(session.closedAt).toBeDefined();
    });

    test('should return null if session not found', async () => {
      await diary.init();
      const result = await diary.closeSession('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('listSessions()', () => {
    test('should list all sessions for workspace', async () => {
      await diary.init();
      await diary.start('test-workspace');
      await diary.start('test-workspace');

      const sessions = await diary.listSessions('test-workspace');
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    test('should respect limit', async () => {
      await diary.init();
      await diary.start('test-workspace');
      await diary.start('test-workspace');
      await diary.start('test-workspace');

      const sessions = await diary.listSessions('test-workspace', { limit: 2 });
      expect(sessions.length).toBeLessThanOrEqual(2);
    });

    test('should respect offset', async () => {
      await diary.init();
      const s1 = (await diary.start('test-workspace')).sessionId;
      const s2 = (await diary.start('test-workspace')).sessionId;

      const page1 = await diary.listSessions('test-workspace', { limit: 1, offset: 0 });
      const page2 = await diary.listSessions('test-workspace', { limit: 1, offset: 1 });

      expect(page1.length).toBe(1);
      expect(page2.length).toBe(1);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    test('should sort by startedAt descending', async () => {
      await diary.init();
      await diary.start('test-workspace');
      await new Promise(r => setTimeout(r, 100));
      await diary.start('test-workspace');

      const sessions = await diary.listSessions('test-workspace');
      expect(new Date(sessions[0].startedAt) >= new Date(sessions[1].startedAt)).toBe(true);
    });

    test('should filter by workspace', async () => {
      await diary.init();
      await diary.start('workspace-1');
      await diary.start('workspace-2');

      const sessions1 = await diary.listSessions('workspace-1');
      const sessions2 = await diary.listSessions('workspace-2');

      expect(sessions1.every(s => s.workspaceId === 'workspace-1')).toBe(true);
      expect(sessions2.every(s => s.workspaceId === 'workspace-2')).toBe(true);
    });
  });

  describe('getSession()', () => {
    test('should retrieve session by id', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      const session = await diary.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session.id).toBe(sessionId);
    });

    test('should return null if not found', async () => {
      await diary.init();
      const session = await diary.getSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('_generateBriefing()', () => {
    test('should generate markdown briefing', async () => {
      const briefing = await diary._generateBriefing({ guide: 'Test guide', milestones: [], recentActions: [] });
      expect(briefing).toContain('Briefing');
    });

    test('should use Brain from self.Brain if diary.brain fails', async () => {
      // Create a new diary where brain is not available initially but self.Brain is
      const diaryNoBrain = new SessionDiary('test-workspace', mockKB, null);
      self.Brain = mockBrain;
      const briefing = await diaryNoBrain._generateBriefing({ guide: 'Test guide', milestones: [], recentActions: [] });
      expect(briefing).toContain('Briefing');
    });

    test('should handle error fallback gracefully', async () => {
      mockBrain.askClaude.mockRejectedValueOnce(new Error('API error'));
      const diaryNoBrain = new SessionDiary('test-workspace', mockKB, null);
      self.Brain = { askClaude: async () => { throw new Error('fail'); } };
      const briefing = await diaryNoBrain._generateBriefing({ guide: 'Test', milestones: [], recentActions: [] });
      expect(briefing).toContain('Briefing Operativo');
    });
  });

  describe('IndexedDB persistence', () => {
    test('should store multiple sessions separately', async () => {
      await diary.init();
      const s1 = await diary.start('workspace-1');
      const s2 = await diary.start('workspace-2');

      const session1 = await diary.getSession(s1.sessionId);
      const session2 = await diary.getSession(s2.sessionId);

      expect(session1.workspaceId).toBe('workspace-1');
      expect(session2.workspaceId).toBe('workspace-2');
    });

    test('should preserve event order', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');

      for (let i = 0; i < 5; i++) {
        await diary.appendEvent(sessionId, { type: 'action', payload: { index: i } });
      }

      const session = await diary.getSession(sessionId);
      expect(session.events.map(e => e.payload.index)).toEqual([0, 1, 2, 3, 4]);
    });

    test('should persist across init/deinit cycles', async () => {
      await diary.init();
      const { sessionId } = await diary.start('test-workspace');
      await diary.appendEvent(sessionId, { type: 'action', payload: { data: 'test' } });

      // Simulate reinitialization
      const diary2 = new SessionDiary('test-workspace', mockKB, mockBrain);
      await diary2.init();

      const session = await diary2.getSession(sessionId);
      expect(session.events).toHaveLength(1);
      expect(session.events[0].payload.data).toBe('test');
    });
  });
});
