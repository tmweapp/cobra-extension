/**
 * COBRA v5.2 — Global Error Boundary
 * Catches all uncaught errors and unhandled rejections.
 * Shows recovery UI instead of silent failures.
 * Requires: global `Toast` object (optional, degrades gracefully).
 */
const CobraErrorBoundary = {
  _errors: [],
  _maxErrors: 50,
  _recoveryShown: false,

  init() {
    // Catch synchronous errors
    window.addEventListener('error', (event) => {
      this._handle({
        type: 'error',
        message: event.message || 'Unknown error',
        source: event.filename || '',
        line: event.lineno || 0,
        col: event.colno || 0,
        stack: event.error?.stack || '',
        timestamp: Date.now()
      });
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      this._handle({
        type: 'rejection',
        message: reason?.message || String(reason) || 'Unhandled promise rejection',
        stack: reason?.stack || '',
        timestamp: Date.now()
      });
    });

    // Catch chrome.runtime errors
    if (chrome?.runtime?.onMessage) {
      const origListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
      // Wrap won't work for existing listeners but covers new ones
    }

    console.log('[ErrorBoundary] Initialized — global error catching active');
  },

  _handle(error) {
    // Deduplicate rapid-fire same errors
    const key = error.message + (error.line || '');
    const recent = this._errors.find(e => (e.message + (e.line || '')) === key && (Date.now() - e.timestamp) < 2000);
    if (recent) return;

    this._errors.push(error);
    if (this._errors.length > this._maxErrors) {
      this._errors = this._errors.slice(-this._maxErrors);
    }

    // Classify severity
    const severity = this._classify(error);

    // Log to console with styling
    console.group(`%c[COBRA Error] ${severity.toUpperCase()}`, `color:${severity === 'critical' ? '#ff4444' : '#ffaa00'};font-weight:bold`);
    console.error(error.message);
    if (error.stack) console.log(error.stack);
    console.groupEnd();

    // User feedback based on severity
    if (severity === 'critical') {
      this._showRecoveryUI(error);
    } else if (severity === 'warning' && typeof Toast !== 'undefined') {
      // Only show toast for warnings that affect UX
      if (this._isUserFacing(error)) {
        Toast.warning(`Errore: ${error.message.substring(0, 80)}`);
      }
    }

    // Audit log if available
    if (typeof CobraAudit !== 'undefined' && CobraAudit.log) {
      try {
        CobraAudit.log({
          action: 'JS_ERROR',
          category: 'system',
          result: 'fail',
          details: `${error.type}: ${error.message}`.substring(0, 500)
        });
      } catch {}
    }
  },

  _classify(error) {
    const msg = (error.message || '').toLowerCase();

    // Critical: things that break core functionality
    if (msg.includes('cannot read properties of null') && error.source?.includes('sidepanel')) return 'critical';
    if (msg.includes('chrome.runtime') && msg.includes('disconnected')) return 'critical';
    if (msg.includes('extension context invalidated')) return 'critical';
    if (msg.includes('quota') && msg.includes('exceeded')) return 'critical';

    // Warning: recoverable issues
    if (msg.includes('network') || msg.includes('fetch')) return 'warning';
    if (msg.includes('timeout')) return 'warning';
    if (error.type === 'rejection') return 'warning';

    // Info: minor issues
    return 'info';
  },

  _isUserFacing(error) {
    const msg = (error.message || '').toLowerCase();
    // Skip noise
    if (msg.includes('resizeobserver')) return false;
    if (msg.includes('script error')) return false;
    if (msg.includes('extension page')) return false;
    return true;
  },

  _showRecoveryUI(error) {
    if (this._recoveryShown) return;
    this._recoveryShown = true;

    const overlay = document.createElement('div');
    overlay.id = 'cobraErrorOverlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;
      background:rgba(10,10,13,0.95);display:flex;flex-direction:column;
      align-items:center;justify-content:center;padding:20px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;max-width:360px;">
        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
        <h2 style="font-size:18px;margin-bottom:8px;color:#ff6b6b;">COBRA — Errore Critico</h2>
        <p style="color:#b0b0b5;font-size:13px;margin-bottom:16px;line-height:1.5;">
          ${this._sanitize(error.message).substring(0, 150)}
        </p>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button id="cobraRecoveryReload" style="
            padding:8px 20px;background:#52bbff;color:#000;border:none;
            border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
          ">Ricarica</button>
          <button id="cobraRecoveryDismiss" style="
            padding:8px 20px;background:rgba(255,255,255,0.1);color:#fff;
            border:1px solid rgba(255,255,255,0.2);border-radius:8px;
            font-size:13px;cursor:pointer;
          ">Ignora</button>
        </div>
        <p style="color:#666;font-size:10px;margin-top:12px;">
          ${this._errors.length} errori registrati in questa sessione
        </p>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('cobraRecoveryReload')?.addEventListener('click', () => {
      location.reload();
    });

    document.getElementById('cobraRecoveryDismiss')?.addEventListener('click', () => {
      overlay.remove();
      this._recoveryShown = false;
    });
  },

  _sanitize(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // Public API
  getErrors() { return [...this._errors]; },
  getStats() {
    const now = Date.now();
    return {
      total: this._errors.length,
      last5min: this._errors.filter(e => now - e.timestamp < 300000).length,
      byType: this._errors.reduce((acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      }, {}),
      bySeverity: this._errors.reduce((acc, e) => {
        const s = this._classify(e);
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {})
    };
  },
  clear() { this._errors = []; }
};

// Auto-initialize
CobraErrorBoundary.init();

// Export for Node.js/Jest environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CobraErrorBoundary;
}

// Export for browser environment
if (typeof self !== 'undefined') {
  self.CobraErrorBoundary = CobraErrorBoundary;
}
