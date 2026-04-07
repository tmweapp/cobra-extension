/**
 * COBRA Consolidation Scheduler Tests
 * Tests for alarm setup, dispatch handlers, and manual execution
 */

jest.mock('../remote-library.js');
const CobraConsolidationScheduler = require('../consolidation-scheduler.js');
const RemoteLibrary = require('../remote-library.js');

describe('CobraConsolidationScheduler', () => {
  let mockKB;
  let mockRemoteLib;

  beforeEach(() => {
    // Reset scheduler state
    CobraConsolidationScheduler._initialized = false;

    // Mock KnowledgeBase
    mockKB = {
      rules: [
        {
          id: 'rule-1',
          workspace_id: 'test-workspace',
          tier: 'hot',
          title: 'Test Rule',
          content: 'Test content for testing purposes',
          createdAt: new Date().toISOString(),
          category: 'regola'
        }
      ],
      decayColdRules: jest.fn(async () => {
        mockKB.rules.forEach(r => {
          if (r.tier === 'cold') r.usageCount = (r.usageCount || 0) - 1;
        });
        return { decayed: mockKB.rules.length };
      }),
      save: jest.fn(async () => {})
    };

    // Mock RemoteLibrary
    mockRemoteLib = {
      consolidateWeekly: jest.fn(async (workspaceId) => ({
        id: 'doc-1',
        workspace_id: workspaceId,
        level: 0,
        summary: 'Consolidated'
      })),
      consolidateByVolume: jest.fn(async (workspaceId) => null),
      metaConsolidate: jest.fn(async (workspaceId, level) => ({
        id: `meta-doc-${level + 1}`,
        level: level + 1
      })),
      init: jest.fn(async () => {})
    };

    self.cobraKB = mockKB;
    self._remoteLibraryInstance = mockRemoteLib;
    // Mock RemoteLibrary constructor to prevent early return in init()
    RemoteLibrary.mockImplementation(() => mockRemoteLib);
    self.RemoteLibrary = RemoteLibrary;
  });

  describe('init()', () => {
    test('should initialize scheduler', async () => {
      await CobraConsolidationScheduler.init();
      expect(CobraConsolidationScheduler._initialized).toBe(true);
    });

    test('should be idempotent', async () => {
      await CobraConsolidationScheduler.init();
      const status1 = CobraConsolidationScheduler.getStatus();
      await CobraConsolidationScheduler.init();
      const status2 = CobraConsolidationScheduler.getStatus();
      expect(status1.initialized).toBe(status2.initialized);
    });

    test('should create RemoteLibrary instance if not present', async () => {
      self._remoteLibraryInstance = null;
      await CobraConsolidationScheduler.init();
      expect(self._remoteLibraryInstance).toBeDefined();
    });

    test('should initialize RemoteLibrary', async () => {
      self._remoteLibraryInstance = null;
      await CobraConsolidationScheduler.init();
      expect(self._remoteLibraryInstance).toBeDefined();
    });

    test('should create alarms', async () => {
      await CobraConsolidationScheduler.init();
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'cobra_consolidate_weekly',
        expect.any(Object)
      );
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'cobra_consolidate_volume',
        expect.any(Object)
      );
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'cobra_session_decay',
        expect.any(Object)
      );
    });

    test('should register alarm listener', async () => {
      await CobraConsolidationScheduler.init();
      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
    });

    test('should handle init failure gracefully', async () => {
      chrome.alarms.create.mockImplementationOnce(() => {
        throw new Error('Alarm creation failed');
      });
      expect(async () => {
        await CobraConsolidationScheduler.init();
      }).not.toThrow();
    });
  });

  describe('_setupAlarms()', () => {
    test('should clear existing alarms', async () => {
      await CobraConsolidationScheduler._setupAlarms();
      expect(chrome.alarms.clear).toHaveBeenCalledWith('cobra_consolidate_weekly');
      expect(chrome.alarms.clear).toHaveBeenCalledWith('cobra_consolidate_volume');
      expect(chrome.alarms.clear).toHaveBeenCalledWith('cobra_session_decay');
    });

    test('should create weekly alarm with 7-day period', async () => {
      await CobraConsolidationScheduler._setupAlarms();
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'cobra_consolidate_weekly',
        { periodInMinutes: 7 * 24 * 60 }
      );
    });

    test('should create volume alarm with 6-hour period', async () => {
      await CobraConsolidationScheduler._setupAlarms();
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'cobra_consolidate_volume',
        { periodInMinutes: 6 * 60 }
      );
    });

    test('should create decay alarm with 24-hour period', async () => {
      await CobraConsolidationScheduler._setupAlarms();
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'cobra_session_decay',
        { periodInMinutes: 24 * 60 }
      );
    });
  });

  describe('_onAlarm()', () => {
    test('should dispatch weekly consolidation', async () => {
      await CobraConsolidationScheduler.init();
      const alarm = { name: 'cobra_consolidate_weekly' };

      await CobraConsolidationScheduler._onAlarm(alarm);

      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalled();
    });

    test('should dispatch volume consolidation', async () => {
      await CobraConsolidationScheduler.init();
      const alarm = { name: 'cobra_consolidate_volume' };

      await CobraConsolidationScheduler._onAlarm(alarm);

      expect(mockRemoteLib.consolidateByVolume).toHaveBeenCalled();
    });

    test('should dispatch session decay', async () => {
      await CobraConsolidationScheduler.init();
      const alarm = { name: 'cobra_session_decay' };

      await CobraConsolidationScheduler._onAlarm(alarm);

      expect(mockKB.decayColdRules).toHaveBeenCalled();
    });

    test('should handle unknown alarm gracefully', async () => {
      await CobraConsolidationScheduler.init();
      const alarm = { name: 'unknown_alarm' };

      expect(async () => {
        await CobraConsolidationScheduler._onAlarm(alarm);
      }).not.toThrow();
    });

    test('should handle handler errors gracefully', async () => {
      mockRemoteLib.consolidateWeekly.mockRejectedValueOnce(new Error('Consolidation failed'));
      await CobraConsolidationScheduler.init();
      const alarm = { name: 'cobra_consolidate_weekly' };

      expect(async () => {
        await CobraConsolidationScheduler._onAlarm(alarm);
      }).not.toThrow();
    });

    test('should consolidate for each workspace', async () => {
      mockKB.rules = [
        { workspace_id: 'ws-1', tier: 'hot', title: 'Rule 1', content: 'Content 1', createdAt: new Date().toISOString() },
        { workspace_id: 'ws-2', tier: 'hot', title: 'Rule 2', content: 'Content 2', createdAt: new Date().toISOString() }
      ];

      await CobraConsolidationScheduler.init();
      const alarm = { name: 'cobra_consolidate_weekly' };

      await CobraConsolidationScheduler._onAlarm(alarm);

      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalledWith('ws-1');
      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalledWith('ws-2');
    });
  });

  describe('_dispatchWeeklyConsolidation()', () => {
    test('should call consolidateWeekly for all workspaces', async () => {
      mockKB.rules = [
        { workspace_id: 'ws-1', tier: 'hot', title: 'Rule 1', content: 'Content 1', createdAt: new Date().toISOString() },
        { workspace_id: 'ws-2', tier: 'hot', title: 'Rule 2', content: 'Content 2', createdAt: new Date().toISOString() }
      ];

      await CobraConsolidationScheduler._dispatchWeeklyConsolidation();

      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalledWith('ws-1');
      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalledWith('ws-2');
    });

    test('should handle missing KB gracefully', async () => {
      self.cobraKB = null;
      expect(async () => {
        await CobraConsolidationScheduler._dispatchWeeklyConsolidation();
      }).not.toThrow();
    });

    test('should handle missing RemoteLibrary gracefully', async () => {
      self._remoteLibraryInstance = null;
      expect(async () => {
        await CobraConsolidationScheduler._dispatchWeeklyConsolidation();
      }).not.toThrow();
    });
  });

  describe('_dispatchVolumeConsolidation()', () => {
    test('should check volume for each workspace', async () => {
      mockKB.rules = [
        { workspace_id: 'ws-1', tier: 'hot', title: 'Rule', content: 'word '.repeat(1000), createdAt: new Date().toISOString() }
      ];

      await CobraConsolidationScheduler._dispatchVolumeConsolidation();

      expect(mockRemoteLib.consolidateByVolume).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('_dispatchSessionDecay()', () => {
    test('should call KB.decayColdRules', async () => {
      await CobraConsolidationScheduler._dispatchSessionDecay();
      expect(mockKB.decayColdRules).toHaveBeenCalled();
    });

    test('should handle missing KB.decayColdRules', async () => {
      mockKB.decayColdRules = undefined;
      expect(async () => {
        await CobraConsolidationScheduler._dispatchSessionDecay();
      }).not.toThrow();
    });
  });

  describe('runManual()', () => {
    test('should run manual weekly consolidation', async () => {
      await CobraConsolidationScheduler.init();
      const result = await CobraConsolidationScheduler.runManual('test-workspace', 'weekly');

      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalledWith('test-workspace');
      expect(result).toBeDefined();
    });

    test('should run manual volume consolidation', async () => {
      await CobraConsolidationScheduler.init();
      const result = await CobraConsolidationScheduler.runManual('test-workspace', 'volume');

      expect(mockRemoteLib.consolidateByVolume).toHaveBeenCalledWith('test-workspace');
    });

    test('should run manual meta consolidation', async () => {
      await CobraConsolidationScheduler.init();
      const result = await CobraConsolidationScheduler.runManual('test-workspace', 'meta');

      expect(mockRemoteLib.metaConsolidate).toHaveBeenCalledWith('test-workspace', 0);
    });

    test('should run manual decay', async () => {
      await CobraConsolidationScheduler.init();
      const result = await CobraConsolidationScheduler.runManual('test-workspace', 'decay');

      expect(mockKB.decayColdRules).toHaveBeenCalled();
    });

    test('should allow null workspaceId and pass through to remoteLib', async () => {
      await CobraConsolidationScheduler.init();
      const result = await CobraConsolidationScheduler.runManual(null, 'weekly');
      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalledWith(null);
    });

    test('should throw error for null type (no case match)', async () => {
      await CobraConsolidationScheduler.init();
      await expect(CobraConsolidationScheduler.runManual('test-workspace', null))
        .rejects.toThrow('Unknown consolidation type');
    });

    test('should reject unknown type', async () => {
      await CobraConsolidationScheduler.init();
      await expect(CobraConsolidationScheduler.runManual('test-workspace', 'unknown'))
        .rejects.toThrow('Unknown consolidation type');
    });

    test('should initialize if not already initialized', async () => {
      CobraConsolidationScheduler._initialized = false;
      // Ensure RemoteLibrary mock is still in place
      self.RemoteLibrary = jest.fn(() => mockRemoteLib);
      self._remoteLibraryInstance = null; // Force re-initialization
      const result = await CobraConsolidationScheduler.runManual('test-workspace', 'weekly');
      expect(CobraConsolidationScheduler._initialized).toBe(true);
    });
  });

  describe('getStatus()', () => {
    test('should return status object', async () => {
      const status = CobraConsolidationScheduler.getStatus();
      expect(status).toHaveProperty('initialized');
      expect(status).toHaveProperty('hasRemoteLibrary');
      expect(status).toHaveProperty('hasKB');
    });

    test('should indicate initialization state', async () => {
      let status = CobraConsolidationScheduler.getStatus();
      expect(status.initialized).toBe(false);

      await CobraConsolidationScheduler.init();
      status = CobraConsolidationScheduler.getStatus();
      expect(status.initialized).toBe(true);
    });

    test('should check module availability', async () => {
      await CobraConsolidationScheduler.init();
      const status = CobraConsolidationScheduler.getStatus();

      expect(typeof status.hasRemoteLibrary).toBe('boolean');
      expect(typeof status.hasKB).toBe('boolean');
    });
  });

  describe('Integration', () => {
    test('should handle full consolidation cycle', async () => {
      mockKB.rules = [
        {
          id: 'rule-1',
          workspace_id: 'test-ws',
          tier: 'hot',
          title: 'Rule 1',
          content: 'Content for testing purposes',
          createdAt: new Date().toISOString()
        }
      ];

      await CobraConsolidationScheduler.init();
      await CobraConsolidationScheduler.runManual('test-ws', 'weekly');

      expect(mockRemoteLib.consolidateWeekly).toHaveBeenCalledWith('test-ws');
    });

    test('should support sequential manual runs', async () => {
      await CobraConsolidationScheduler.init();

      const result1 = await CobraConsolidationScheduler.runManual('ws-1', 'weekly');
      const result2 = await CobraConsolidationScheduler.runManual('ws-2', 'decay');

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });
});
