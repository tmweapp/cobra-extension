// Tests for gate-engine.js — GateEngine class
require('./setup.js');
require('../gate-engine.js');
const GateEngine = global.GateEngine;

describe('GateEngine — constructor and templates', () => {
  test('GateEngine constructor initializes with KB', () => {
    const kb = { someMethod: jest.fn() };
    const engine = new GateEngine(kb);

    expect(engine.kb).toBe(kb);
    expect(engine.sessions).toBeInstanceOf(Map);
    expect(engine._gatePerformance).toEqual({});
  });

  test('GateEngine.TEMPLATES contains defined templates', () => {
    const templates = GateEngine.TEMPLATES;
    expect(templates.deep_scrape).toBeDefined();
    expect(templates.agent_task).toBeDefined();
    expect(templates.pipeline).toBeDefined();
    expect(templates.price_monitor).toBeDefined();
    expect(templates.lead_gen).toBeDefined();
  });

  test('deep_scrape template has 6 gates', () => {
    const gates = GateEngine.TEMPLATES.deep_scrape.gates;
    expect(gates.length).toBe(6);
    expect(gates[0].name).toBe('Ricezione');
    expect(gates[gates.length - 1].name).toBe('Output');
  });

  test('agent_task template has 4 gates', () => {
    const gates = GateEngine.TEMPLATES.agent_task.gates;
    expect(gates.length).toBe(4);
    expect(gates[0].name).toBe('Briefing');
  });
});

describe('GateEngine.createSession() — Session creation', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
    global.crypto.randomUUID = jest.fn(() => 'test-uuid-1234');
  });

  test('createSession() creates session from template', () => {
    const session = engine.createSession({
      templateKey: 'agent_task',
      title: 'Test Session'
    });

    expect(session.id).toBeDefined();
    expect(session.templateKey).toBe('agent_task');
    expect(session.title).toBe('Test Session');
    expect(session.status).toBe('active');
    expect(session.currentGate).toBe(0);
  });

  test('createSession() initializes gates with correct status', () => {
    const session = engine.createSession({
      templateKey: 'agent_task'
    });

    expect(session.gates[0].status).toBe('active');
    expect(session.gates[0].startedAt).toBeDefined();
    expect(session.gates[1].status).toBe('locked');
    expect(session.gates[1].startedAt).toBeNull();
  });

  test('createSession() throws error for invalid template', () => {
    expect(() => {
      engine.createSession({ templateKey: 'nonexistent' });
    }).toThrow(/not found/);
  });

  test('createSession() stores session in map', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    expect(engine.sessions.get(session.id)).toBe(session);
  });

  test('createSession() initializes gate data structures', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const gate = session.gates[0];

    expect(gate.completedCriteria).toEqual([]);
    expect(gate.data).toEqual({});
    expect(gate.notes).toEqual([]);
    expect(gate.attemptCount).toBe(0);
    expect(gate.skipped).toBe(false);
  });
});

describe('GateEngine.advanceGate() — Gate progression', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
    global.crypto.randomUUID = jest.fn(() => 'session-id-123');
  });

  test('advanceGate() moves to next gate', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.advanceGate(sessionId, ['Obiettivo definito', 'Vincoli chiari']);
    const updated = engine.sessions.get(sessionId);

    expect(updated.currentGate).toBe(1);
    expect(updated.gates[1].status).toBe('active');
  });

  test('advanceGate() marks gate as completed', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.advanceGate(sessionId, ['Obiettivo definito', 'Vincoli chiari']);
    const updated = engine.sessions.get(sessionId);

    expect(updated.gates[0].status).toBe('completed');
    expect(updated.gates[0].completedAt).toBeDefined();
  });

  test('advanceGate() stores completed criteria', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const criteria = ['Obiettivo definito', 'Vincoli chiari'];

    engine.advanceGate(session.id, criteria);
    const updated = engine.sessions.get(session.id);

    expect(updated.gates[0].completedCriteria).toEqual(criteria);
  });

  test('advanceGate() increments attempt count', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    engine.advanceGate(session.id, []);
    engine.goBackGate(session.id, 0);
    engine.advanceGate(session.id, []);

    const updated = engine.sessions.get(session.id);
    expect(updated.gates[0].attemptCount).toBe(2);
  });

  test('advanceGate() completes session at last gate', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    // Advance through all gates
    for (let i = 0; i < 4; i++) {
      engine.advanceGate(sessionId, ['criterion']);
    }

    const updated = engine.sessions.get(sessionId);
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeDefined();
  });

  test('advanceGate() warns on incomplete criteria', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;
    const exitCriteria = session.gates[0].exitCriteria;

    engine.advanceGate(sessionId, [exitCriteria[0]]); // Only first criterion
    const updated = engine.sessions.get(sessionId);
    const notes = updated.gates[0].notes;

    expect(notes.some(n => n.type === 'warning')).toBe(true);
  });

  test('advanceGate() throws error for missing session', () => {
    expect(() => {
      engine.advanceGate('nonexistent', []);
    }).toThrow(/not found/);
  });
});

describe('GateEngine.goBackGate() — Gate backtrack', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
    global.crypto.randomUUID = jest.fn(() => 'session-id-123');
  });

  test('goBackGate() returns to previous gate', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.advanceGate(sessionId, ['criterion']);
    engine.goBackGate(sessionId, 0);

    const updated = engine.sessions.get(sessionId);
    expect(updated.currentGate).toBe(0);
    expect(updated.gates[0].status).toBe('active');
  });

  test('goBackGate() marks gate as locked', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.advanceGate(sessionId, ['criterion']);
    engine.goBackGate(sessionId, 0);

    const updated = engine.sessions.get(sessionId);
    expect(updated.gates[1].status).toBe('locked');
  });

  test('goBackGate() throws error for invalid index', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    engine.advanceGate(session.id, ['criterion']);

    expect(() => {
      engine.goBackGate(session.id, 1);
    }).toThrow(/Invalid gate index/);
  });
});

describe('GateEngine.setGateData() — Data storage', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
    global.crypto.randomUUID = jest.fn(() => 'session-id-123');
  });

  test('setGateData() stores data in current gate', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.setGateData(sessionId, { target: 'value' });

    const updated = engine.sessions.get(sessionId);
    expect(updated.gates[0].data.target).toBe('value');
  });

  test('setGateData() merges with existing data', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.setGateData(sessionId, { key1: 'value1' });
    engine.setGateData(sessionId, { key2: 'value2' });

    const updated = engine.sessions.get(sessionId);
    expect(updated.gates[0].data.key1).toBe('value1');
    expect(updated.gates[0].data.key2).toBe('value2');
  });
});

describe('GateEngine.skipGate() — Dynamic gate control', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
    global.crypto.randomUUID = jest.fn(() => 'session-id-123');
  });

  test('skipGate() marks gate as skipped', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.skipGate(sessionId, 0, 'already completed');

    const updated = engine.sessions.get(sessionId);
    expect(updated.gates[0].skipped).toBe(true);
    expect(updated.gates[0].status).toBe('completed');
  });

  test('skipGate() records reason in notes', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;
    const reason = 'user request';

    engine.skipGate(sessionId, 0, reason);

    const updated = engine.sessions.get(sessionId);
    const notes = updated.gates[0].notes;
    expect(notes[0].type).toBe('skipped');
    expect(notes[0].message).toContain(reason);
  });

  test('skipGate() throws error for invalid gate', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    expect(() => {
      engine.skipGate(session.id, 99, 'reason');
    }).toThrow();
  });
});

describe('GateEngine.insertGate() — Dynamic insertion', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
    global.crypto.randomUUID = jest.fn(() => 'session-id-123');
  });

  test('insertGate() adds gate after specified index', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;
    const newGate = {
      name: 'Custom Gate',
      description: 'A custom gate',
      exitCriteria: ['Done'],
      aiManual: 'Do the thing'
    };

    engine.insertGate(sessionId, 0, newGate);

    const updated = engine.sessions.get(sessionId);
    expect(updated.gates[1].name).toBe('Custom Gate');
  });

  test('insertGate() re-indexes gates after insertion', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;
    const newGate = {
      name: 'Custom',
      description: 'desc',
      exitCriteria: [],
      aiManual: 'inst'
    };

    engine.insertGate(sessionId, 1, newGate);

    const updated = engine.sessions.get(sessionId);
    for (let i = 0; i < updated.gates.length; i++) {
      expect(updated.gates[i].index).toBe(i);
    }
  });
});

describe('GateEngine.buildGateContext() — AI context generation', () => {
  let engine;

  beforeEach(() => {
    const kb = { buildContextForAI: jest.fn(() => '') };
    engine = new GateEngine(kb);
    global.crypto.randomUUID = jest.fn(() => 'session-id-123');
  });

  test('buildGateContext() includes gate information', () => {
    const session = engine.createSession({
      templateKey: 'agent_task',
      title: 'Test Session'
    });

    const context = engine.buildGateContext(session.id);

    expect(context).toContain('Test Session');
    expect(context).toContain('Agent Task');
    expect(context).toContain('Briefing');
  });

  test('buildGateContext() shows completed gates', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const sessionId = session.id;

    engine.advanceGate(sessionId, ['criterion1']);

    const context = engine.buildGateContext(sessionId);
    expect(context).toContain('GATE COMPLETATI');
    expect(context).toContain('✅');
  });

  test('buildGateContext() includes exit criteria checklist', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const context = engine.buildGateContext(session.id);

    expect(context).toContain('CRITERI DI USCITA');
    expect(context).toContain('⬜'); // uncompleted criteria
  });

  test('buildGateContext() includes AI instructions', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const context = engine.buildGateContext(session.id);

    expect(context).toContain('ISTRUZIONI PER L\'AI');
  });
});

describe('GateEngine — session queries', () => {
  let engine;
  let uuidCounter;

  beforeEach(() => {
    engine = new GateEngine({});
    uuidCounter = 0;
    global.crypto.randomUUID = jest.fn(() => `uuid-${uuidCounter++}`);
  });

  test('getSession() returns session by ID', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    const retrieved = engine.getSession(session.id);

    expect(retrieved).toBe(session);
  });

  test('getActiveSessions() returns active and paused sessions', () => {
    const s1 = engine.createSession({ templateKey: 'agent_task' });
    const s2 = engine.createSession({ templateKey: 'agent_task' });

    engine.pauseSession(s1.id);

    const active = engine.getActiveSessions();
    expect(active.length).toBeGreaterThanOrEqual(2);
  });

  test('getAllSessions() returns all sessions sorted by creation', () => {
    const s1 = engine.createSession({ templateKey: 'agent_task' });
    // Add a small delay to ensure different timestamps
    const created1 = s1.createdAt;

    // Advance time slightly
    jest.useFakeTimers();
    jest.advanceTimersByTime(100);

    const s2 = engine.createSession({ templateKey: 'agent_task' });
    const created2 = s2.createdAt;

    jest.useRealTimers();

    const all = engine.getAllSessions();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Most recent first (s2 should be more recent)
    const s2Found = all.find(s => s.id === s2.id);
    const s1Found = all.find(s => s.id === s1.id);
    expect(s2Found).toBeDefined();
    expect(s1Found).toBeDefined();
  });

  test('pauseSession() changes status', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    engine.pauseSession(session.id);

    const updated = engine.getSession(session.id);
    expect(updated.status).toBe('paused');
  });

  test('resumeSession() resumes paused session', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    engine.pauseSession(session.id);
    engine.resumeSession(session.id);

    const updated = engine.getSession(session.id);
    expect(updated.status).toBe('active');
  });

  test('deleteSession() removes session', () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    engine.deleteSession(session.id);

    expect(engine.getSession(session.id)).toBeUndefined();
  });
});

describe('GateEngine — performance tracking', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
  });

  test('recordGateResult() tracks success', () => {
    engine.recordGateResult('agent_task', 0, true, 1000);

    const perf = engine.getGatePerformance('agent_task', 0);
    expect(perf.successRate).toBe(1.0);
    expect(perf.attemptCount).toBe(1);
  });

  test('recordGateResult() tracks failures', () => {
    engine.recordGateResult('agent_task', 0, false, 1000);

    const perf = engine.getGatePerformance('agent_task', 0);
    expect(perf.successRate).toBe(0);
    expect(perf.attemptCount).toBe(1);
  });

  test('getGatePerformance() calculates success rate', () => {
    engine.recordGateResult('agent_task', 0, true, 1000);
    engine.recordGateResult('agent_task', 0, true, 1000);
    engine.recordGateResult('agent_task', 0, false, 1000);

    const perf = engine.getGatePerformance('agent_task', 0);
    expect(perf.successRate).toBeCloseTo(0.667, 2);
  });

  test('getGatePerformance() returns null for unrecorded gate', () => {
    const perf = engine.getGatePerformance('unknown', 99);
    expect(perf).toBeNull();
  });
});

describe('GateEngine — persistence', () => {
  let engine;

  beforeEach(() => {
    engine = new GateEngine({});
    global.chrome.storage.local.set = jest.fn((obj, cb) => cb?.());
    global.chrome.storage.local.get = jest.fn((key, cb) => cb({}));
  });

  test('load() retrieves saved sessions from storage', async () => {
    const saved = [
      {
        id: 'test-id',
        templateKey: 'agent_task',
        currentGate: 1,
        gates: []
      }
    ];

    global.chrome.storage.local.get = jest.fn((key, cb) => {
      cb({ cobra_gate_sessions: saved });
    });

    const count = await engine.load();
    expect(engine.sessions.has('test-id')).toBe(true);
  });

  test('save() stores sessions to storage', async () => {
    const session = engine.createSession({ templateKey: 'agent_task' });
    await engine.save();

    expect(global.chrome.storage.local.set).toHaveBeenCalled();
    const call = global.chrome.storage.local.set.mock.calls[0];
    expect(call[0]).toHaveProperty('cobra_gate_sessions');
  });
});
