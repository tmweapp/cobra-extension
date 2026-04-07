// ============================================================
// COBRA — Token Budget Enforcement
// Tracks tokens per session, warns at 70%, blocks at 95%.
// ============================================================

(function () {
  'use strict';

  const DEFAULT_BUDGET = 50000;       // tokens per session
  const WARN_THRESHOLD = 0.7;
  const BLOCK_THRESHOLD = 0.95;
  const STORAGE_KEY = 'cobra_token_budget';

  const state = {
    used: 0,
    budget: DEFAULT_BUDGET,
    session: null,
    listeners: [],
    warned: false,
  };

  async function load() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(STORAGE_KEY, data => {
          const saved = data[STORAGE_KEY] || {};
          const today = new Date().toISOString().slice(0, 10);
          if (saved.session === today) {
            state.used = saved.used || 0;
            state.budget = saved.budget || DEFAULT_BUDGET;
          } else {
            state.used = 0;
            state.budget = saved.budget || DEFAULT_BUDGET;
          }
          state.session = today;
          resolve(state);
        });
      } catch (e) { resolve(state); }
    });
  }

  async function persist() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set({
          [STORAGE_KEY]: {
            used: state.used,
            budget: state.budget,
            session: state.session,
          }
        }, resolve);
      } catch (e) { resolve(); }
    });
  }

  function pct() { return state.used / state.budget; }

  function notify() {
    state.listeners.forEach(fn => {
      try { fn({ used: state.used, budget: state.budget, pct: pct() }); } catch {}
    });
  }

  function showToast(message, type) {
    const existing = document.getElementById('cobra-budget-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'cobra-budget-toast';
    toast.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:100000;
      padding:14px 20px;background:var(--glass-bg,#13131a);
      border:1px solid ${type === 'block' ? '#FF3B30' : '#FFD700'};
      border-left:4px solid ${type === 'block' ? '#FF3B30' : '#FFD700'};
      border-radius:12px;color:var(--text-primary,#fff);
      font-size:13px;font-family:inherit;max-width:320px;
      box-shadow:0 12px 32px rgba(0,0,0,0.4);
      backdrop-filter:blur(20px);
    `;
    toast.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px">${type === 'block' ? '⛔ Budget esaurito' : '⚠ Attenzione budget'}</div>
      <div style="opacity:0.8;font-size:12px">${message}</div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  async function consume(tokens) {
    if (!state.session) await load();
    // Reset on new day
    const today = new Date().toISOString().slice(0, 10);
    if (state.session !== today) {
      state.used = 0;
      state.session = today;
      state.warned = false;
    }

    state.used += Math.max(0, Math.round(tokens || 0));

    // Warn once at threshold
    if (!state.warned && pct() >= WARN_THRESHOLD && pct() < BLOCK_THRESHOLD) {
      state.warned = true;
      showToast(`Hai usato ${Math.round(pct() * 100)}% del budget giornaliero (${state.used}/${state.budget} token).`, 'warn');
    }

    await persist();
    notify();

    // Block if over limit
    if (pct() >= BLOCK_THRESHOLD) {
      showToast(`Budget giornaliero esaurito (${state.used}/${state.budget}). Attendi reset notte o aumenta budget in Settings.`, 'block');
      return { allowed: false, reason: 'budget_exceeded', used: state.used, budget: state.budget };
    }
    return { allowed: true, used: state.used, budget: state.budget };
  }

  async function check() {
    if (!state.session) await load();
    return { allowed: pct() < BLOCK_THRESHOLD, used: state.used, budget: state.budget, pct: pct() };
  }

  async function setBudget(newBudget) {
    state.budget = Math.max(1000, parseInt(newBudget, 10) || DEFAULT_BUDGET);
    await persist();
    notify();
  }

  async function reset() {
    state.used = 0;
    state.warned = false;
    await persist();
    notify();
  }

  function onChange(fn) {
    state.listeners.push(fn);
    return () => { state.listeners = state.listeners.filter(l => l !== fn); };
  }

  // Auto-load on script load
  load();

  // Expose API
  window.CobraTokenBudget = { consume, check, setBudget, reset, onChange, get state() { return { ...state }; } };
})();
