// COBRA v5.2 — Background Service Worker (Modular Bootstrap)
// Loads all modules and initializes the extension.
// Handler logic lives in bg-*.js modules.

// ============================================================
// SIDE PANEL — Apri al click icona
// ============================================================
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ============================================================
// IMPORT MODULES — Order matters!
// ============================================================
// 0. Error boundary & logging (must load first)
try {
  importScripts('error-boundary.js', 'cobra-logger.js');
  CobraErrorBoundary.init();
  CobraLogger.init('info');
} catch (e) {
  console.error('[COBRA] Error loading error boundary/logger:', e);
}

// 1. Core utilities (no dependencies)
try {
  importScripts(
    'crypto-utils.js', 'stealth.js', 'rate-limiter.js', 'cache.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading core utils:', e);
}

// 1b. Result wrapper + Error codes + Policy + Guard + Contracts (no dependencies, used by everything)
try {
  importScripts(
    'cobra-result.js',
    'cobra-error-codes.js',
    'cobra-policy.js',
    'cobra-guard.js',
    'cobra-contracts.js',
    'cobra-audit.js',
    'cobra-selector-stats.js',
    'cobra-jobs.js',
    'cobra-supervisor.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading v5.2 architecture modules:', e);
}

// 2. Infrastructure: persistence + IndexedDB + team auth
try {
  importScripts(
    'persistence-manager.js',
    'cobra-indexeddb.js',
    'team-auth.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading infrastructure:', e);
}

// 3. Chat Memory & Hierarchical System (new modules)
try {
  importScripts(
    'chat-memory.js',
    'temp-docs.js',
    'three-tier-response.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading chat memory modules:', e);
}

// 3. Functional modules (may depend on core utils)
try {
  importScripts(
    'agent.js', 'hydra-client.js', 'brain.js',
    'task-runner.js', 'file-manager.js', 'connectors.js', 'pipeline.js',
    'elevenlabs.js', 'job-manager.js',
    'knowledge-base.js', 'gate-engine.js', 'conversation-engine.js',
    'decision-engine.js',
    'file-creator.js', 'cobra-orchestrator.js',
    'cobra-kb-seed.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading functional modules:', e);
}

// 3b. Session & Library Modules (new)
try {
  importScripts(
    'session-diary.js',
    'remote-library.js',
    'consolidation-scheduler.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading session & library modules:', e);
}

// 3c. Tool layer (extracted from bg-chat.js)
try {
  importScripts(
    'tool-registry.js',
    'tool-safety.js',
    'tool-executor.js',
    'provider-router.js',
    'cobra-streaming.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading tool layer:', e);
}

// 4. Message router (must load before handler modules)
try {
  importScripts('bg-router.js');
} catch (e) {
  console.error('[COBRA] Error loading bg-router:', e);
}

// ============================================================
// CUSTOM ERROR TYPES
// ============================================================
class COBRAError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'COBRAError';
    this.code = code;
    this.details = details;
  }
}
self.COBRAError = COBRAError;

// ============================================================
// INFRASTRUCTURE INSTANCES — PersistenceManager + IndexedDB
// ============================================================
const cobraPersistence = new PersistenceManager();
const cobraIDB = new CobraIndexedDB();
self.cobraPersistence = cobraPersistence;
self.cobraIDB = cobraIDB;

// ============================================================
// COBRA ENGINE INSTANCES — Shared via self.* (BEFORE handler imports)
// ============================================================
const cobraKB = new KnowledgeBase();
const cobraGate = new GateEngine(cobraKB);
const cobraConversation = new ConversationEngine();
const cobraKBSync = new KBCloudSync(cobraKB);
const cobraOrchestrator = new CobraOrchestrator();

// Export instances for handler modules
self.cobraKB = cobraKB;
self.cobraGate = cobraGate;
self.cobraConversation = cobraConversation;
self.cobraKBSync = cobraKBSync;
self.cobraOrchestrator = cobraOrchestrator;

// Decision Engine — central orchestrator (created HERE so it has KB/Gate/Conversation)
const cobraDecisionEngine = new DecisionEngine(cobraKB, cobraGate, cobraConversation);
self.decisionEngine = cobraDecisionEngine;

// Session Diary & Remote Library — new modules for session management
const cobraSessionDiary = new SessionDiary('generic', cobraKB, self.Brain);
self.cobraSessionDiary = cobraSessionDiary;

// 4b. Communication Hub (config + autodiscover + handlers)
try {
  importScripts('comm-config.js', 'comm-autodiscover.js', 'bg-comms.js');
  console.log('[COBRA] Communication Hub loaded');
} catch (e) {
  console.error('[COBRA] Error loading Communication Hub:', e);
}

// 5. Handler modules (register on CobraRouter) — NOW loaded AFTER engine instances
try {
  importScripts(
    'bg-chat.js',
    'bg-scraper.js',
    'bg-orchestrator.js',
    'bg-kb.js',
    'bg-jobs.js',
    'bg-files.js',
    'bg-session.js'
  );
} catch (e) {
  console.error('[COBRA] Error loading handler modules:', e);
}

// 6. Dev keys (optional — file may not exist in production)
try { importScripts('cobra-dev-keys.js'); } catch (e) { /* dev keys file not present, OK */ }

// Seed KB on first load
seedKBIfEmpty().catch(e => console.warn('[KB-Seed] Error:', e));

// ============================================================
// RELAY CONFIG (Claude Bridge)
// ============================================================
const RELAY = {
  api: "https://wca-app.vercel.app/api/claude-bridge",
  polling: false,
  pollTimer: false,
  tabsTimer: false,
  lastPollTs: 0,
  commandsExecuted: 0,
  lastCommand: null,
  log: [],
  consecutiveFailures: 0,
  maxFailures: 5,
  circuitOpen: false,
  circuitResetTimer: null,
  hmacSecret: '',
};
self.RELAY = RELAY;

function relayLog(entry) {
  RELAY.log.unshift({ ...entry, ts: Date.now() });
  if (RELAY.log.length > 50) RELAY.log.pop();
}
self.relayLog = relayLog;

// ============================================================
// RELAY HANDLERS — Registered on router
// ============================================================
async function startRelayAlarms() {
  RELAY.consecutiveFailures = 0;
  RELAY.circuitOpen = false;
  await chrome.alarms.create('relay-poll', { periodInMinutes: 0.05 });
  await chrome.alarms.create('relay-tabs', { periodInMinutes: 0.2 });
  RELAY.pollTimer = true;
  RELAY.tabsTimer = true;
  await chrome.storage.local.set({ relayPolling: true });
  await relaySendTabs();
  relayLog({ type: 'relay', event: 'started' });
}

function relayCircuitTrip() {
  RELAY.circuitOpen = true;
  relayLog({ type: 'circuit-breaker', event: 'OPEN', failures: RELAY.consecutiveFailures });
  RELAY.circuitResetTimer = setTimeout(() => {
    RELAY.circuitOpen = false;
    RELAY.consecutiveFailures = 0;
    relayLog({ type: 'circuit-breaker', event: 'HALF-OPEN' });
  }, 30000);
}

async function relayPoll() {
  if (RELAY.polling || RELAY.circuitOpen) return;
  RELAY.polling = true;
  try {
    const resp = await fetch(`${RELAY.api}?action=poll`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    RELAY.lastPollTs = Date.now();
    RELAY.consecutiveFailures = 0;

    if (data.ok && data.command) {
      const validation = CryptoUtils.validateCommand(data.command);
      if (!validation.valid) {
        relayLog({ type: 'command-rejected', reason: validation.reason, command: data.command?.type });
        RELAY.polling = false;
        return;
      }

      if (RELAY.hmacSecret && data.signature) {
        const payload = JSON.stringify(data.command);
        const valid = await CryptoUtils.verify(payload, data.signature, RELAY.hmacSecret);
        if (!valid) { relayLog({ type: 'command-rejected', reason: 'Firma HMAC non valida' }); RELAY.polling = false; return; }
      } else if (RELAY.hmacSecret && !data.signature) {
        relayLog({ type: 'command-rejected', reason: 'Firma HMAC mancante' }); RELAY.polling = false; return;
      }

      RELAY.lastCommand = data.command;
      RELAY.commandsExecuted++;
      relayLog({ type: 'command-in', command: data.command });

      const result = await relayExecuteCommand(data.command);
      relayLog({ type: 'command-out', result: { ok: result.ok || !result.error } });

      try {
        await fetch(RELAY.api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'done', result })
        });
      } catch (e) {
        relayLog({ type: 'error', message: 'Failed to send result: ' + e.message });
      }
    }
  } catch (e) {
    RELAY.consecutiveFailures++;
    relayLog({ type: 'error', message: e.message, failures: RELAY.consecutiveFailures });
    if (RELAY.consecutiveFailures >= RELAY.maxFailures) relayCircuitTrip();
  }
  RELAY.polling = false;
}

async function relayExecuteCommand(cmd) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = cmd.tabId || tab?.id;
    if (!tabId) return { error: 'Nessun tab attivo' };

    switch (cmd.type) {
      case 'nav':
        if (!self.isValidHttpUrl(cmd.url)) return { error: 'URL non valido' };
        await chrome.tabs.update(tabId, { url: cmd.url, active: true });
        await self.waitForTabLoad(tabId);
        return { ok: true, tabId, url: cmd.url };
      case 'click': return await Agent.executeAction(tabId, { action: 'click', selector: cmd.selector, options: cmd.options });
      case 'type': return await Agent.executeAction(tabId, { action: 'type', selector: cmd.selector, text: cmd.text });
      case 'read': return await Agent.executeAction(tabId, { action: 'read', selector: cmd.selector, options: cmd.options });
      case 'wait': return await Agent.executeAction(tabId, { action: 'wait', selector: cmd.selector, timeout: cmd.timeout });
      case 'scroll': return await Agent.executeAction(tabId, { action: 'scroll', target: cmd.target || cmd.selector });
      case 'select': return await Agent.executeAction(tabId, { action: 'select', selector: cmd.selector, value: cmd.value });
      case 'formFill': return await Agent.executeAction(tabId, { action: 'formFill', fields: cmd.fields });
      case 'snapshot':
        const snap = await chrome.scripting.executeScript({ target: { tabId }, func: Agent.snapshotScript() });
        return snap?.[0]?.result || { ok: false };
      case 'sequence': return await Agent.executeSequence(tabId, cmd.steps);
      case 'scrape': return await self.scrapeTab(tabId);
      case 'screenshot': return { screenshot: await chrome.tabs.captureVisibleTab(null, { format: 'png' }), tabId };
      default: return { error: `Comando non permesso: ${cmd.type}` };
    }
  } catch (e) { return { error: e.message }; }
}

async function relaySendTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const simple = tabs.map(t => {
      try {
        const url = new URL(t.url);
        return { id: t.id, url: url.hostname + url.pathname, title: t.title, active: t.active };
      } catch { return { id: t.id, url: t.url, title: t.title, active: t.active }; }
    });
    await fetch(RELAY.api, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tabs', result: simple })
    });
  } catch {}
}

// Register relay handlers on router
CobraRouter.registerActions({
  'relay-start': async () => { if (RELAY.pollTimer) return { status: 'already_running' }; await startRelayAlarms(); return { status: 'started' }; },
  'relay-stop': async () => {
    await chrome.alarms.clear('relay-poll'); await chrome.alarms.clear('relay-tabs');
    RELAY.pollTimer = false; RELAY.tabsTimer = false;
    if (RELAY.circuitResetTimer) { clearTimeout(RELAY.circuitResetTimer); RELAY.circuitResetTimer = null; }
    RELAY.circuitOpen = false;
    await chrome.storage.local.set({ relayPolling: false });
    relayLog({ type: 'relay', event: 'stopped' });
    return { status: 'stopped' };
  },
  'relay-status': async () => ({
    connected: !!RELAY.pollTimer, lastPollTs: RELAY.lastPollTs,
    commandsExecuted: RELAY.commandsExecuted, lastCommand: RELAY.lastCommand,
    log: RELAY.log.slice(0, 20), api: RELAY.api,
    circuitOpen: RELAY.circuitOpen, consecutiveFailures: RELAY.consecutiveFailures,
  }),
  'relay-send-tabs': async () => { await relaySendTabs(); return { ok: true }; },
  'UNDO_LAST_TOOL': async () => {
    if (!self.ToolSafety) return { error: 'ToolSafety not loaded' };
    return await self.ToolSafety.undo();
  },
  'TOOL_UNDO_STATUS': async () => {
    if (!self.ToolSafety) return { canUndo: false, stack: [] };
    return { canUndo: self.ToolSafety.canUndo(), stack: self.ToolSafety.getUndoStack() };
  },
  'KB_HEALTH': async () => {
    return self.cobraKB ? self.cobraKB.getHealthReport() : { error: 'KB not loaded' };
  },
  // ── v5.2 Policy Engine ──
  'POLICY_GET_TRUST': async () => self.CobraPolicy ? { trustLevel: self.CobraPolicy.getTrustLevel() } : { error: 'Policy not loaded' },
  'POLICY_SET_TRUST': async (msg) => self.CobraPolicy ? { ok: await self.CobraPolicy.setTrustLevel(msg.level) } : { error: 'Policy not loaded' },
  'POLICY_CONFIRM': async (msg) => self.CobraPolicy ? { valid: self.CobraPolicy.confirm(msg.token) } : { error: 'Policy not loaded' },
  'POLICY_PENDING': async () => self.CobraPolicy ? { pending: self.CobraPolicy.getPendingConfirmations() } : { error: 'Policy not loaded' },
  // ── v5.2 Persistent Jobs Engine ──
  // Helper: flatten Result {success,data} to plain {ok, ...data} for sendMessage
  'PJOB_CREATE': async (msg) => { if (!self.CobraJobs) return { error: 'Jobs not loaded' }; const r = await self.CobraJobs.create(msg.def); return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message }; },
  'PJOB_RUN': async (msg) => { if (!self.CobraJobs) return { error: 'Jobs not loaded' }; const r = await self.CobraJobs.run(msg.jobId); return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message }; },
  'PJOB_PAUSE': async (msg) => { if (!self.CobraJobs) return { error: 'Jobs not loaded' }; const r = await self.CobraJobs.pause(msg.runId); return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message }; },
  'PJOB_RESUME': async (msg) => { if (!self.CobraJobs) return { error: 'Jobs not loaded' }; const r = await self.CobraJobs.resume(msg.runId); return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message }; },
  'PJOB_CANCEL': async (msg) => { if (!self.CobraJobs) return { error: 'Jobs not loaded' }; const r = await self.CobraJobs.cancel(msg.runId); return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message }; },
  'PJOB_RETRY': async (msg) => { if (!self.CobraJobs) return { error: 'Jobs not loaded' }; const r = await self.CobraJobs.retry(msg.jobId); return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message }; },
  'PJOB_LIST': async () => self.CobraJobs ? { jobs: self.CobraJobs.listJobs() } : { error: 'Jobs not loaded' },
  'PJOB_GET': async (msg) => self.CobraJobs ? { job: self.CobraJobs.getJob(msg.jobId) } : { error: 'Jobs not loaded' },
  'PJOB_DELETE': async (msg) => { if (!self.CobraJobs) return { error: 'Jobs not loaded' }; const r = await self.CobraJobs.deleteJob(msg.jobId); return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message }; },
  'PJOB_ACTIVE_RUN': async () => self.CobraJobs ? { run: self.CobraJobs.getActiveRun() } : { error: 'Jobs not loaded' },
  // ── v5.2 Supervisor ──
  'SUPERVISOR_HEALTH': async () => self.CobraSupervisor ? self.CobraSupervisor.getHealthReport() : { error: 'Supervisor not loaded' },
  // ── v5.2 Guard (rate limit + circuit breaker) ──
  'GUARD_STATS': async () => self.CobraGuard ? self.CobraGuard.getStats() : { error: 'Guard not loaded' },
  'GUARD_RESET': async () => { if (self.CobraGuard) { self.CobraGuard.reset(); return { ok: true }; } return { error: 'Guard not loaded' }; },
  // ── v5.2 Audit Log ──
  'AUDIT_QUERY': async (msg) => self.CobraAudit ? { entries: await self.CobraAudit.query(msg.filter || {}) } : { error: 'Audit not loaded' },
  'AUDIT_STATS': async () => self.CobraAudit ? await self.CobraAudit.getStats() : { error: 'Audit not loaded' },
  'AUDIT_EXPORT': async (msg) => self.CobraAudit ? await self.CobraAudit.export(msg.filter || {}) : { error: 'Audit not loaded' },
  // ── v5.2 Selector Stats ──
  'SELECTOR_STATS_SUMMARY': async () => self.CobraSelectorStats ? self.CobraSelectorStats.getSummary() : { error: 'SelectorStats not loaded' },
  'SELECTOR_STATS_RANKED': async (msg) => self.CobraSelectorStats ? { ranked: self.CobraSelectorStats.getRanked(msg.domain) } : { error: 'SelectorStats not loaded' },
  'REQUEST_SCREENSHOT': async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { error: 'No active tab' };
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
      chrome.runtime.sendMessage({
        type: 'CANVAS_SCREENSHOT',
        dataUrl,
        url: tab.url || '',
        title: tab.title || ''
      });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  },
});

// ============================================================
// NATIVE MESSAGING — Bridge per software esterno
// ============================================================
let nativePort = null;

function connectNativeBridge() {
  try {
    nativePort = chrome.runtime.connectNative('com.firescrape.bridge');
    nativePort.onMessage.addListener(async (msg) => {
      const bridgeId = msg._bridgeId;
      delete msg._bridgeId;
      let response;
      try {
        // Use router's action handlers for native bridge messages
        const handler = CobraRouter._actionHandlers[msg.action];
        if (handler) {
          response = await handler(msg);
        } else {
          response = { error: 'Unknown action: ' + msg.action, code: 'UNKNOWN_ACTION' };
        }
      } catch (err) {
        response = { error: err.message, code: err.code || 'UNKNOWN' };
      }
      if (nativePort) {
        try { nativePort.postMessage({ ...response, _bridgeId: bridgeId }); } catch {}
      }
    });
    nativePort.onDisconnect.addListener(() => {
      console.log('[COBRA] Native bridge disconnected', chrome.runtime.lastError?.message || '');
      nativePort = null;
      setTimeout(connectNativeBridge, 5000);
    });
    console.log('[COBRA] Native bridge connected');
  } catch (err) {
    console.log('[COBRA] Native bridge not available:', err.message);
    nativePort = null;
  }
}

// ============================================================
// INITIALIZE — Start everything
// ============================================================
(async () => {
  try {
    // 0. Init IndexedDB (non-blocking — falls back to chrome.storage)
    cobraIDB.init().then(() => {
      console.log('[COBRA] IndexedDB ready');
      // Migrate KB rules to IndexedDB if not done yet
      chrome.storage.local.get('cobra_idb_migrated', async (d) => {
        if (!d.cobra_idb_migrated && cobraKB.rules.length > 0) {
          try {
            await cobraIDB.bulkPut('kb_rules', cobraKB.rules);
            chrome.storage.local.set({ cobra_idb_migrated: true });
            console.log(`[COBRA] Migrated ${cobraKB.rules.length} KB rules to IndexedDB`);
          } catch (e) { console.warn('[COBRA] IDB migration failed (non-fatal):', e); }
        }
      });
    }).catch(e => console.warn('[COBRA] IndexedDB init failed (non-fatal):', e));

    // 1. Load engines
    await cobraKB.load();
    await cobraGate.load();
    await cobraConversation.load();
    await cobraDecisionEngine.loadToolScores().catch(() => {});
    console.log('[COBRA] Engines loaded: KB, Gate, Conversation, DecisionEngine');

    // 1b. Initialize v5.2 architecture modules (NON-BLOCKING — never freeze startup)
    Promise.all([
      self.CobraPolicy?.init().catch(e => console.warn('[COBRA] Policy init:', e.message)),
      self.CobraSelectorStats?.init().catch(e => console.warn('[COBRA] SelectorStats init:', e.message)),
      self.CobraJobs?.init().catch(e => console.warn('[COBRA] Jobs init:', e.message)),
      cobraSessionDiary.init().catch(e => console.warn('[COBRA] SessionDiary init:', e.message)),
      CobraConsolidationScheduler.init().catch(e => console.warn('[COBRA] ConsolidationScheduler init:', e.message)),
    ]).then(() => console.log('[COBRA] v5.2 modules initialized')).catch(() => {});

    // KB maintenance: recalculate scores + garbage collect on startup
    try {
      const scoreUpdated = cobraKB.recalculateAllScores();
      const gcResult = cobraKB.garbageCollect();
      if (scoreUpdated > 0 || gcResult.removed > 0) {
        console.log(`[COBRA] KB maintenance: ${scoreUpdated} scores updated, ${gcResult.removed} rules purged`);
      }
    } catch (e) { console.warn('[COBRA] KB maintenance failed (non-fatal):', e); }

    // 2. Initialize message router (single listener for all messages)
    CobraRouter.init();
    console.log('[COBRA] Router initialized');

    // 3. Set UI mode
    chrome.storage.local.get('cobra_settings', data => {
      try {
        const settings = data.cobra_settings || {};
        const panelPath = settings.uiMode === 'canvas' ? 'sidepanel-canvas.html' : 'sidepanel.html';
        chrome.sidePanel.setOptions({ path: panelPath }).catch(() => {});
      } catch (e) {
        console.error('[COBRA] Error setting UI mode:', e);
      }
    });

    // 4. Connect native bridge
    connectNativeBridge();
  } catch (e) {
    console.error('[COBRA] Critical initialization error:', e);
  }
})();

// UI mode switch listener
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.cobra_settings) {
    const newSettings = changes.cobra_settings.newValue || {};
    const panelPath = newSettings.uiMode === 'canvas' ? 'sidepanel-canvas.html' : 'sidepanel.html';
    chrome.sidePanel.setOptions({ path: panelPath }).catch(() => {});
  }
});

// ============================================================
// SERVICE WORKER LIFECYCLE — MV3 Compatible
// ============================================================
chrome.runtime.onInstalled.addListener(async () => {
  const { relayPolling } = await chrome.storage.local.get(['relayPolling']);
  if (relayPolling && !RELAY.pollTimer) await startRelayAlarms();
  console.log('[COBRA] Extension installed/updated');
});

chrome.runtime.onStartup.addListener(async () => {
  const { relayPolling } = await chrome.storage.local.get(['relayPolling']);
  if (relayPolling && !RELAY.pollTimer) {
    await startRelayAlarms();
    console.log('[COBRA] Relay restored on startup');
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === 'relay-poll') await relayPoll();
    else if (alarm.name === 'relay-tabs') await relaySendTabs();
    else if (alarm.name === 'cache-cleanup') {
      try { await Cache.cleanup(); } catch (e) { console.error('[COBRA] Cache cleanup error:', e); }
      try { await TaskRunner.cleanup(); } catch (e) { console.error('[COBRA] TaskRunner cleanup error:', e); }
    }
    else if (alarm.name === 'task-runner-tick') {
      try { await TaskRunner.restore(); } catch (e) { console.error('[COBRA] TaskRunner restore error:', e); }
    }
  } catch (e) {
    console.error('[COBRA] Alarm handler error for', alarm.name, ':', e);
  }
});

console.log('[COBRA v5.2] Bootstrap loaded — modular architecture');
