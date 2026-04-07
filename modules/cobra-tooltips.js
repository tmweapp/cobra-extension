/**
 * COBRA v5.2 — Tooltip & First-Run Guidance System
 * Progressive disclosure: highlights key features on first use.
 * Non-invasive — appears as subtle pulses + dismissible tooltips.
 */
const CobraTooltips = {
  _shown: new Set(),
  _storageKey: 'cobra_tooltips_shown',
  _tips: [
    {
      id: 'tip-chat',
      target: '#chatInput',
      text: 'Scrivi qui per parlare con COBRA. Prova: "Analizza questa pagina"',
      view: 'home',
      priority: 1
    },
    {
      id: 'tip-mic',
      target: '#micBtn, #chatMicBtn',
      text: 'Premi per registrare la voce. Premi di nuovo per fermare. Poi invia con Enter.',
      view: 'home',
      priority: 2
    },
    {
      id: 'tip-stop',
      target: '#chatStopBtn',
      text: 'Premi per interrompere la risposta AI in corso.',
      view: 'home',
      priority: 3
    },
    {
      id: 'tip-agents',
      target: '#agentBar',
      text: 'Click per attivare/disattivare agenti. Click destro per impostare il leader.',
      view: 'home',
      priority: 4
    },
    {
      id: 'tip-archivio',
      target: '.nav-tab[data-view="archivio"]',
      text: 'Qui trovi memoria, jobs, knowledge base e file.',
      view: 'home',
      priority: 5
    },
    {
      id: 'tip-comms',
      target: '.nav-tab[data-view="comms"]',
      text: 'WhatsApp, Email e LinkedIn integrati. Sincronizza da web.whatsapp.com.',
      view: 'home',
      priority: 6
    },
    {
      id: 'tip-settings-keys',
      target: '#openaiKey',
      text: 'Inserisci almeno una API key per usare COBRA. Supporta OpenAI, Groq, Gemini, Anthropic.',
      view: 'settings',
      priority: 1
    }
  ],

  async init() {
    try {
      const data = await new Promise(r =>
        chrome.storage.local.get(this._storageKey, d => r(d[this._storageKey]))
      );
      if (Array.isArray(data)) {
        data.forEach(id => this._shown.add(id));
      }
    } catch {}

    // Show tips for current view after a short delay
    setTimeout(() => this._showForView(state?.currentView || 'home'), 1500);

    // Re-check on view switch
    const origSwitch = window.switchView;
    if (origSwitch) {
      window.switchView = (view) => {
        origSwitch(view);
        setTimeout(() => this._showForView(view), 800);
      };
    }
  },

  _showForView(view) {
    const viewTips = this._tips
      .filter(t => t.view === view && !this._shown.has(t.id))
      .sort((a, b) => a.priority - b.priority);

    if (viewTips.length === 0) return;

    // Show only the first unshown tip
    this._showTip(viewTips[0]);
  },

  _showTip(tip) {
    const target = document.querySelector(tip.target);
    if (!target || !target.offsetParent) return; // Element not visible

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'cobra-tooltip';
    tooltip.id = tip.id;
    tooltip.innerHTML = `
      <div class="cobra-tooltip-content">
        <span class="cobra-tooltip-text">${tip.text}</span>
        <button class="cobra-tooltip-dismiss">OK</button>
      </div>
      <div class="cobra-tooltip-arrow"></div>
    `;

    // Position relative to target
    document.body.appendChild(tooltip);
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let top = rect.bottom + 8;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width - 8;
    }
    if (top + tooltipRect.height > window.innerHeight - 8) {
      top = rect.top - tooltipRect.height - 8;
      tooltip.classList.add('cobra-tooltip-above');
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Add subtle pulse to target
    target.classList.add('cobra-highlight-pulse');

    // Dismiss handler
    tooltip.querySelector('.cobra-tooltip-dismiss').onclick = () => {
      this._dismiss(tip.id, tooltip, target);
    };

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (document.getElementById(tip.id)) {
        this._dismiss(tip.id, tooltip, target);
      }
    }, 10000);
  },

  _dismiss(tipId, tooltip, target) {
    this._shown.add(tipId);
    tooltip.classList.add('cobra-tooltip-out');
    if (target) target.classList.remove('cobra-highlight-pulse');
    setTimeout(() => tooltip.remove(), 300);

    // Persist
    chrome.storage.local.set({
      [this._storageKey]: [...this._shown]
    });

    // Show next tip after a brief pause
    setTimeout(() => this._showForView(state?.currentView || 'home'), 600);
  },

  // Reset all tips (for testing or re-onboarding)
  reset() {
    this._shown.clear();
    chrome.storage.local.remove(this._storageKey);
  }
};
