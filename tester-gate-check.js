// ============================================================
// COBRA — Tester Gate Check
// Redirects to tester-gate.html if no valid session exists.
// Must be loaded as first script in sidepanel.html <head>.
// ============================================================

(function () {
  'use strict';
  try {
    chrome.storage.local.get('cobra_tester_session', data => {
      const session = data && data.cobra_tester_session;
      if (!session || !session.code) {
        window.location.replace('tester-gate.html');
        return;
      }
      // Session valid — expose to app
      window.__cobraTesterSession = session;
    });
  } catch (e) {
    // In non-extension context (test/dev) just skip
    console.warn('[COBRA-Gate] Skipping gate check:', e.message);
  }
})();
