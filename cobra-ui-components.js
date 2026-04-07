/**
 * COBRA v5.2 — UI Component System
 * Mini framework per decomposizione progressiva di sidepanel.js.
 * Ogni componente è un oggetto con: mount(), unmount(), update().
 * Registrati in CobraUI, renderizzati on-demand per view.
 *
 * NON è React/Vue — è vanilla JS con struttura.
 * Obiettivo: permettere split graduale del monolite sidepanel.js
 * senza riscrivere tutto in una volta.
 */

const CobraUI = {
  _components: {},   // name → { mount, unmount, update, _mounted }
  _activeView: null,
  _viewComponents: {}, // view → [componentName, ...]

  /**
   * Registra un componente UI
   * @param {string} name - Nome univoco
   * @param {Object} component - { mount(container), unmount(), update(data), view?: string }
   */
  register(name, component) {
    if (this._components[name]) {
      console.warn(`[CobraUI] Component '${name}' already registered, overwriting`);
    }
    this._components[name] = { ...component, _mounted: false, _container: null };

    // Auto-associate to view if specified
    if (component.view) {
      if (!this._viewComponents[component.view]) this._viewComponents[component.view] = [];
      this._viewComponents[component.view].push(name);
    }
  },

  /**
   * Monta un componente in un container DOM
   */
  mount(name, containerId) {
    const comp = this._components[name];
    if (!comp) { console.warn(`[CobraUI] Component '${name}' not found`); return; }
    if (comp._mounted) return; // already mounted

    const container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;

    if (!container) { console.warn(`[CobraUI] Container '${containerId}' not found for '${name}'`); return; }

    comp._container = container;
    comp._mounted = true;
    if (comp.mount) comp.mount(container);
  },

  /**
   * Smonta un componente
   */
  unmount(name) {
    const comp = this._components[name];
    if (!comp || !comp._mounted) return;
    if (comp.unmount) comp.unmount();
    comp._mounted = false;
    comp._container = null;
  },

  /**
   * Aggiorna un componente con nuovi dati
   */
  update(name, data) {
    const comp = this._components[name];
    if (!comp || !comp._mounted) return;
    if (comp.update) comp.update(data, comp._container);
  },

  /**
   * Monta tutti i componenti di una view
   */
  mountView(viewName) {
    this._activeView = viewName;
    const comps = this._viewComponents[viewName] || [];
    for (const name of comps) {
      const comp = this._components[name];
      if (comp && comp.containerId) {
        this.mount(name, comp.containerId);
      }
    }
  },

  /**
   * Smonta tutti i componenti della view precedente
   */
  unmountView(viewName) {
    const comps = this._viewComponents[viewName] || [];
    for (const name of comps) {
      this.unmount(name);
    }
  },

  /**
   * Lista tutti i componenti registrati
   */
  list() {
    return Object.entries(this._components).map(([name, comp]) => ({
      name,
      mounted: comp._mounted,
      view: comp.view || null
    }));
  },

  /**
   * Helper: crea un elemento DOM con attributi e figli
   */
  el(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (key === 'className') element.className = val;
      else if (key === 'style' && typeof val === 'object') Object.assign(element.style, val);
      else if (key.startsWith('on') && typeof val === 'function') element.addEventListener(key.slice(2).toLowerCase(), val);
      else if (key === 'innerHTML') element.innerHTML = val;
      else if (key === 'textContent') element.textContent = val;
      else element.setAttribute(key, val);
    }
    for (const child of children) {
      if (typeof child === 'string') element.appendChild(document.createTextNode(child));
      else if (child instanceof Node) element.appendChild(child);
    }
    return element;
  },

  /**
   * Helper: sanitize HTML (XSS prevention)
   */
  sanitize(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// ══════════════════════════════════════════════════════
// EXAMPLE: Audit Dashboard Component (self-contained)
// ══════════════════════════════════════════════════════
CobraUI.register('audit-dashboard', {
  view: 'settings',
  containerId: null, // Will be set when mounted

  mount(container) {
    this._container = container;
    this._render();
    this._interval = setInterval(() => this._render(), 30000); // refresh every 30s
  },

  unmount() {
    if (this._interval) clearInterval(this._interval);
    if (this._container) this._container.innerHTML = '';
  },

  async _render() {
    if (!this._container) return;
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'AUDIT_STATS' }, resolve);
      });
      if (!res || res.error) {
        this._container.innerHTML = '<div style="color:#666;font-size:11px;">Audit log non disponibile</div>';
        return;
      }

      const { total, last24h, last1h, byResult, topActions } = res;
      const el = CobraUI.el;

      this._container.innerHTML = '';
      this._container.appendChild(el('div', { className: 'setting-sub-label', textContent: `Audit Log — ${total} entries totali` }));

      // Stats row
      const row = el('div', { style: { display: 'flex', gap: '12px', marginTop: '4px', fontSize: '11px' } },
        el('span', { style: { color: '#52BBFF' }, textContent: `1h: ${last1h}` }),
        el('span', { style: { color: '#25d366' }, textContent: `24h: ${last24h}` }),
        el('span', { style: { color: '#e74c3c' }, textContent: `Errori: ${byResult?.fail || 0}` }),
        el('span', { style: { color: '#f1c40f' }, textContent: `Bloccati: ${byResult?.blocked || 0}` })
      );
      this._container.appendChild(row);

      // Top actions
      if (topActions?.length > 0) {
        const actList = el('div', { style: { marginTop: '6px', fontSize: '10px', color: '#888' } });
        actList.textContent = 'Top: ' + topActions.slice(0, 5).map(a => `${a.action}(${a.count})`).join(', ');
        this._container.appendChild(actList);
      }
    } catch {
      this._container.innerHTML = '<div style="color:#666;font-size:11px;">Errore caricamento audit</div>';
    }
  }
});

// Export
window.CobraUI = CobraUI;
