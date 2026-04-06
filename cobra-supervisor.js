/**
 * COBRA v5.2 — Supervisor Agent
 * Monitors AI execution health, detects stuck states, manages retries.
 *
 * Architecture:
 *   - Heartbeat: tracks last activity timestamp from tool calls
 *   - Watchdog: if no activity for N seconds, intervenes
 *   - Health Reporter: sends status updates to sidepanel
 *   - Retry Manager: retries failed operations with backoff
 *   - Task Tracker: maintains a checklist of what AI is doing
 *
 * Integrates with: provider-router.js (tool progress), bg-chat.js (request lifecycle)
 */

const CobraSupervisor = {
  // State
  _active: false,
  _requestId: null,
  _startedAt: 0,
  _lastActivity: 0,
  _toolsExecuted: [],
  _errors: [],
  _watchdogInterval: null,
  _maxIdleMs: 30000,       // 30s without activity = stuck
  _maxTotalMs: 180000,     // 3 min max per request
  _retryCount: 0,
  _maxRetries: 2,
  _status: 'idle',        // idle | running | stuck | completed | failed | aborted
  _taskPlan: [],           // [{step, status, tool, result}]
  _lastMessage: '',

  // Start monitoring a new AI request
  startRequest(requestId, message) {
    this._active = true;
    this._requestId = requestId || Date.now().toString(36);
    this._startedAt = Date.now();
    this._lastActivity = Date.now();
    this._toolsExecuted = [];
    this._errors = [];
    this._retryCount = 0;
    this._status = 'running';
    this._taskPlan = [];
    this._lastMessage = message || '';

    // Start watchdog
    if (this._watchdogInterval) clearInterval(this._watchdogInterval);
    this._watchdogInterval = setInterval(() => this._watchdogCheck(), 5000);

    this._emit('SUPERVISOR_STATUS', { status: 'running', requestId: this._requestId });
    console.log(`[Supervisor] Request started: ${this._requestId}`);
  },

  // Record tool execution activity (called from provider-router)
  recordActivity(toolName, args, result, isError) {
    if (!this._active) return;
    this._lastActivity = Date.now();

    const entry = {
      tool: toolName,
      args: typeof args === 'object' ? Object.keys(args).join(',') : '',
      isError,
      ts: Date.now(),
      elapsed: Date.now() - this._startedAt
    };
    this._toolsExecuted.push(entry);

    if (isError) {
      this._errors.push({ tool: toolName, ts: Date.now(), result: String(result).slice(0, 200) });
    }

    // Update task plan
    this._taskPlan.push({
      step: this._toolsExecuted.length,
      tool: toolName,
      status: isError ? 'error' : 'ok',
      elapsed: entry.elapsed
    });

    // Detect circular loops
    if (this._toolsExecuted.length >= 3) {
      const last3 = this._toolsExecuted.slice(-3);
      const allSame = last3.every(t => t.tool === last3[0].tool && t.args === last3[0].args);
      if (allSame) {
        console.warn(`[Supervisor] Circular loop detected: ${toolName} x3`);
        this._emit('SUPERVISOR_STATUS', {
          status: 'warning',
          message: `Loop rilevato: ${toolName} ripetuto 3 volte. Tentativo di recupero...`,
          requestId: this._requestId
        });
      }
    }

    // Detect too many errors
    const recentErrors = this._errors.filter(e => Date.now() - e.ts < 30000);
    if (recentErrors.length >= 3) {
      console.warn(`[Supervisor] Too many errors (${recentErrors.length} in 30s)`);
      this._emit('SUPERVISOR_STATUS', {
        status: 'warning',
        message: `Troppi errori recenti (${recentErrors.length}). Potrebbe essere necessario un approccio diverso.`,
        requestId: this._requestId
      });
    }

    // Send progress
    this._emit('SUPERVISOR_PROGRESS', {
      toolsRun: this._toolsExecuted.length,
      errors: this._errors.length,
      elapsed: Date.now() - this._startedAt,
      lastTool: toolName,
      requestId: this._requestId
    });
  },

  // Request completed successfully
  completeRequest(result) {
    if (!this._active) return;
    this._status = 'completed';
    this._active = false;
    if (this._watchdogInterval) { clearInterval(this._watchdogInterval); this._watchdogInterval = null; }

    const elapsed = Date.now() - this._startedAt;
    console.log(`[Supervisor] Request completed in ${(elapsed / 1000).toFixed(1)}s, ${this._toolsExecuted.length} tools, ${this._errors.length} errors`);

    this._emit('SUPERVISOR_STATUS', {
      status: 'completed',
      elapsed,
      toolsRun: this._toolsExecuted.length,
      errors: this._errors.length,
      requestId: this._requestId
    });
  },

  // Request failed
  failRequest(error) {
    if (!this._active) return;
    this._status = 'failed';
    this._active = false;
    if (this._watchdogInterval) { clearInterval(this._watchdogInterval); this._watchdogInterval = null; }

    console.error(`[Supervisor] Request failed: ${error}`);
    this._emit('SUPERVISOR_STATUS', {
      status: 'failed',
      error: String(error).slice(0, 200),
      elapsed: Date.now() - this._startedAt,
      requestId: this._requestId
    });
  },

  // Abort
  abort() {
    if (!this._active) return;
    this._status = 'aborted';
    this._active = false;
    if (this._watchdogInterval) { clearInterval(this._watchdogInterval); this._watchdogInterval = null; }
    console.log('[Supervisor] Request aborted');
    this._emit('SUPERVISOR_STATUS', { status: 'aborted', requestId: this._requestId });
  },

  // Get current health report
  getHealthReport() {
    return {
      active: this._active,
      status: this._status,
      requestId: this._requestId,
      elapsed: this._active ? Date.now() - this._startedAt : 0,
      idleFor: this._active ? Date.now() - this._lastActivity : 0,
      toolsExecuted: this._toolsExecuted.length,
      errors: this._errors.length,
      taskPlan: this._taskPlan.slice(-10),
      lastTool: this._toolsExecuted.length > 0 ? this._toolsExecuted[this._toolsExecuted.length - 1].tool : null
    };
  },

  // ── Watchdog: periodic health check ──
  _watchdogCheck() {
    if (!this._active) return;
    const now = Date.now();
    const idle = now - this._lastActivity;
    const total = now - this._startedAt;

    // Check total timeout
    if (total > this._maxTotalMs) {
      console.warn(`[Supervisor] Total timeout exceeded (${(total / 1000).toFixed(0)}s)`);
      this._emit('SUPERVISOR_STATUS', {
        status: 'timeout',
        message: `Timeout totale superato (${(total / 1000).toFixed(0)}s). L'operazione è stata interrotta.`,
        requestId: this._requestId
      });
      // Broadcast chat response to unblock UI
      this._emit('CHAT_RESPONSE', {
        content: `L'operazione ha superato il tempo massimo (${(total / 1000).toFixed(0)}s). Riprova con una richiesta più specifica.`,
        actions: [],
        saveToMemory: false
      });
      this.abort();
      // Also abort the fetch
      if (self._currentAIAbort) {
        self._currentAIAbort.abort();
        self._currentAIAbort = null;
      }
      return;
    }

    // Check idle timeout
    if (idle > this._maxIdleMs) {
      console.warn(`[Supervisor] Idle timeout (${(idle / 1000).toFixed(0)}s without activity)`);
      this._emit('SUPERVISOR_STATUS', {
        status: 'stuck',
        message: `Nessuna attività per ${(idle / 1000).toFixed(0)}s. Potrebbe essere bloccato.`,
        idle,
        requestId: this._requestId
      });
      // Don't auto-abort yet, just warn — user can press Stop
    }

    // Periodic heartbeat to keep service worker alive
    this._emit('SUPERVISOR_HEARTBEAT', {
      elapsed: total,
      idle,
      toolsRun: this._toolsExecuted.length
    });
  },

  // Emit message to sidepanel
  _emit(type, data) {
    try {
      chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
    } catch {}
  }
};

self.CobraSupervisor = CobraSupervisor;
console.log('[cobra-supervisor.js] Loaded: Supervisor Agent');
