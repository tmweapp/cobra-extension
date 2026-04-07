// ============================================================
// COBRA — Theme Loader
// Legge il tema salvato da chrome.storage, lo applica al <html>,
// e monta un theme switcher flottante che cambia tema con un click.
// ============================================================

(function () {
  'use strict';

  const THEMES = ['aurora', 'linen', 'carbon'];
  const DEFAULT_THEME = 'aurora';
  const STORAGE_KEY = 'cobra_theme';

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);
    updateSwitcherActive(theme);
  }

  function updateSwitcherActive(theme) {
    const sw = document.getElementById('cobra-theme-switcher');
    if (!sw) return;
    sw.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === theme);
    });
  }

  async function loadTheme() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(STORAGE_KEY, data => {
          resolve(data[STORAGE_KEY] || DEFAULT_THEME);
        });
      } catch (e) { resolve(DEFAULT_THEME); }
    });
  }

  async function saveTheme(theme) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: theme }, resolve);
      } catch (e) { resolve(); }
    });
  }

  function mountSwitcher() {
    if (document.getElementById('cobra-theme-switcher')) return;
    const sw = document.createElement('div');
    sw.id = 'cobra-theme-switcher';
    sw.className = 'cobra-theme-switcher';
    sw.innerHTML = THEMES.map(t => `
      <button type="button" data-theme="${t}">
        <span class="cobra-theme-dot dot-${t}"></span>
        ${t.charAt(0).toUpperCase() + t.slice(1)}
      </button>
    `).join('');
    document.body.appendChild(sw);

    sw.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const theme = btn.dataset.theme;
        applyTheme(theme);
        await saveTheme(theme);
      });
    });
  }

  // Apply theme IMMEDIATELY (before DOM ready, to avoid FOUC)
  loadTheme().then(applyTheme);

  // Mount switcher after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSwitcher);
  } else {
    mountSwitcher();
  }

  // Expose for console debugging
  window.cobraSetTheme = (t) => {
    applyTheme(t);
    saveTheme(t);
  };
  window.cobraGetTheme = () => document.documentElement.getAttribute('data-theme');
})();
