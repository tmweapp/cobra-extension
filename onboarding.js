/**
 * COBRA v5.2 - Onboarding Wizard (2-Step)
 * Step 1: Welcome + Nome + 1 API Key
 * Step 2: Completato — tutto il resto si configura da Settings
 */

class OnboardingWizard {
  constructor(containerElement) {
    this.container = containerElement;
    this.currentStep = 0;
    this.data = { profile: {}, settings: {}, apiKeys: {} };
    this.isExiting = false;
  }

  static async shouldShow() {
    return new Promise(resolve => {
      chrome.storage.local.get('cobra_onboarding_complete', result => {
        resolve(!result.cobra_onboarding_complete);
      });
    });
  }

  static launch(containerElement) {
    const wizard = new OnboardingWizard(containerElement);
    wizard.init();
    return wizard;
  }

  async init() {
    this.injectStyles();
    this.createOverlay();
    await this.loadExistingData();
    this.showStep(0);
  }

  injectStyles() {
    if (document.getElementById('cobra-onboarding-styles')) return;
    const style = document.createElement('style');
    style.id = 'cobra-onboarding-styles';
    style.textContent = `
      .cobra-onboarding-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(135deg, #0A0A0D 0%, #1a1a22 100%);
        z-index: 10000; display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #e8eaed; overflow: hidden;
      }
      .cobra-onboarding-container { width: 90%; max-width: 420px; position: relative; }
      .cobra-onboarding-step {
        width: 100%; background: rgba(15, 15, 20, 0.7); backdrop-filter: blur(10px);
        border: 1px solid rgba(82, 187, 255, 0.1); border-radius: 16px;
        padding: 32px; display: flex; flex-direction: column;
        opacity: 0; transform: translateY(20px);
        transition: all 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .cobra-onboarding-step.active { opacity: 1; transform: translateY(0); }
      .cobra-onboarding-step.exit-left { opacity: 0; transform: translateY(-20px); }
      .cobra-animated-logo {
        width: 100px; height: 100px; margin: 0 auto 20px; border-radius: 20px;
        display: flex; align-items: center; justify-content: center; overflow: hidden;
        animation: pulseOrb 2s ease-in-out infinite;
      }
      @keyframes pulseOrb {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(82, 187, 255, 0.3); }
        50% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(82, 187, 255, 0); }
      }
      .cobra-step-title {
        font-size: 24px; font-weight: 700; margin: 0 0 8px 0; color: #52BBFF; text-align: center;
      }
      .cobra-step-subtitle {
        font-size: 13px; color: #a8adb5; margin: 0 0 24px 0; text-align: center; line-height: 1.5;
      }
      .cobra-form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
      .cobra-form-label { font-size: 12px; font-weight: 600; color: #b4b9c2; text-transform: uppercase; letter-spacing: 0.5px; }
      .cobra-form-input, .cobra-form-select {
        background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(82, 187, 255, 0.2);
        color: #e8eaed; padding: 10px 14px; border-radius: 8px; font-size: 14px;
        transition: all 200ms ease; font-family: inherit;
      }
      .cobra-form-input:focus, .cobra-form-select:focus {
        outline: none; border-color: #52BBFF; background: rgba(82, 187, 255, 0.1);
        box-shadow: 0 0 0 3px rgba(82, 187, 255, 0.1);
      }
      .cobra-hint { font-size: 11px; color: #666; margin-top: 4px; }
      .cobra-info-box {
        background: rgba(82,187,255,0.1); border: 1px solid rgba(82,187,255,0.2);
        border-radius: 8px; padding: 10px; font-size: 12px; color: #52BBFF; margin-bottom: 16px;
      }
      .cobra-provider-tabs { display: flex; gap: 0; margin-bottom: 12px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(82,187,255,0.2); }
      .cobra-provider-tab {
        flex: 1; padding: 8px 4px; background: transparent; border: none; color: #888;
        cursor: pointer; font-size: 11px; font-weight: 600; transition: all 200ms ease; text-align: center;
      }
      .cobra-provider-tab.active { background: rgba(82,187,255,0.2); color: #52BBFF; }
      .cobra-provider-tab:hover:not(.active) { background: rgba(82,187,255,0.05); color: #aaa; }
      .cobra-step-footer {
        display: flex; justify-content: space-between; align-items: center;
        padding-top: 20px; border-top: 1px solid rgba(82, 187, 255, 0.1); margin-top: 8px;
      }
      .cobra-progress-dots { display: flex; gap: 8px; }
      .cobra-dot {
        width: 8px; height: 8px; border-radius: 50%; background: rgba(82, 187, 255, 0.2); transition: all 200ms ease;
      }
      .cobra-dot.active { background: #52BBFF; width: 24px; border-radius: 4px; }
      .cobra-btn {
        padding: 10px 20px; border-radius: 8px; border: none; font-size: 14px;
        font-weight: 600; cursor: pointer; transition: all 200ms ease; font-family: inherit;
      }
      .cobra-btn-secondary { background: transparent; border: 1px solid rgba(82, 187, 255, 0.3); color: #52BBFF; }
      .cobra-btn-secondary:hover { background: rgba(82, 187, 255, 0.1); border-color: #52BBFF; }
      .cobra-btn-primary { background: #52BBFF; color: #0A0A0D; }
      .cobra-btn-primary:hover { background: #6fd4ff; box-shadow: 0 0 20px rgba(82, 187, 255, 0.3); }
      .cobra-success-icon { font-size: 56px; text-align: center; margin-bottom: 16px; animation: scaleIn 600ms cubic-bezier(0.2, 0.8, 0.2, 1); }
      @keyframes scaleIn { from { transform: scale(0); } to { transform: scale(1); } }
      .cobra-check-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; color: #a8adb5; }
      .cobra-check-item .check { color: #52BBFF; font-weight: 700; }
    `;
    document.head.appendChild(style);
  }

  createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'cobra-onboarding-overlay';
    overlay.id = 'cobra-onboarding-wizard';
    const container = document.createElement('div');
    container.className = 'cobra-onboarding-container';
    overlay.appendChild(container);
    this.container.appendChild(overlay);
    this.overlay = overlay;
    this.stepContainer = container;
  }

  loadExistingData() {
    return new Promise(resolve => {
      chrome.storage.local.get(['cobra_profile', 'cobra_settings'], result => {
        this.data.profile = result.cobra_profile || {};
        this.data.settings = result.cobra_settings || {};
        this.data.apiKeys = {
          openai_key: this.data.settings.openaiKey || '',
          claude_key: this.data.settings.anthropicKey || '',
          gemini_key: this.data.settings.geminiKey || '',
          groq_key: this.data.settings.groqKey || ''
        };
        resolve();
      });
    });
  }

  getSteps() {
    return [new StepSetup(), new StepCompletato()];
  }

  showStep(index) {
    const steps = this.getSteps();
    if (index >= steps.length || index < 0) return;
    this.currentStep = index;
    const step = steps[index];
    this.stepContainer.innerHTML = '';
    const stepDOM = step.render(this.data);
    this.stepContainer.appendChild(stepDOM);
    setTimeout(() => {
      const stepEl = this.stepContainer.querySelector('.cobra-onboarding-step');
      if (stepEl) stepEl.classList.add('active');
    }, 10);
    const nextBtn = stepDOM.querySelector('[data-action="next"]');
    const completeBtn = stepDOM.querySelector('[data-action="complete"]');
    const teamLoginBtn = stepDOM.querySelector('[data-action="team-login"]');
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextStep());
    if (completeBtn) completeBtn.addEventListener('click', () => this.complete());
    if (teamLoginBtn) teamLoginBtn.addEventListener('click', () => this.showTeamLogin());
    step.attachListeners(stepDOM, this.data);
  }

  showTeamLogin() {
    const stepEl = this.stepContainer.querySelector('.cobra-onboarding-step');
    if (stepEl) {
      stepEl.classList.remove('active');
      stepEl.classList.add('exit-left');
      setTimeout(() => {
        this.stepContainer.innerHTML = '';
        const teamLoginDOM = this.renderTeamLogin();
        this.stepContainer.appendChild(teamLoginDOM);
        setTimeout(() => {
          const newStep = this.stepContainer.querySelector('.cobra-onboarding-step');
          if (newStep) newStep.classList.add('active');
        }, 10);
        this.attachTeamLoginListeners(teamLoginDOM);
      }, 400);
    }
  }

  renderTeamLogin() {
    const step = document.createElement('div');
    step.className = 'cobra-onboarding-step';
    step.innerHTML = `
      <div class="cobra-animated-logo">
        <img src="icons/cobra-logo.png" alt="COBRA" style="width:100%;height:100%;object-fit:contain;">
      </div>
      <h1 class="cobra-step-title">Accesso Team</h1>
      <p class="cobra-step-subtitle">Accedi con le credenziali del tuo account team.</p>

      <div class="cobra-form-group">
        <label class="cobra-form-label">Email</label>
        <input type="email" class="cobra-form-input" id="team-email" placeholder="tuo@email.com">
      </div>

      <div class="cobra-form-group">
        <label class="cobra-form-label">Password</label>
        <input type="password" class="cobra-form-input" id="team-password" placeholder="••••••••">
      </div>

      <div class="cobra-form-group">
        <label class="cobra-form-label">Nome (opzionale)</label>
        <input type="text" class="cobra-form-input" id="team-name" placeholder="Il tuo nome">
      </div>

      <div class="cobra-info-box" id="team-message" style="display:none;"></div>

      <div class="cobra-step-footer" style="flex-direction:column;gap:12px;">
        <button class="cobra-btn cobra-btn-primary" id="team-login-btn" style="width:100%;">Accedi</button>
        <button class="cobra-btn cobra-btn-secondary" id="team-back-btn" style="width:100%;">Indietro</button>
      </div>
    `;
    return step;
  }

  attachTeamLoginListeners(dom) {
    const loginBtn = dom.querySelector('#team-login-btn');
    const backBtn = dom.querySelector('#team-back-btn');
    const messageEl = dom.querySelector('#team-message');
    const emailInput = dom.querySelector('#team-email');
    const passwordInput = dom.querySelector('#team-password');
    const nameInput = dom.querySelector('#team-name');

    backBtn.addEventListener('click', () => {
      const stepEl = this.stepContainer.querySelector('.cobra-onboarding-step');
      stepEl.classList.remove('active');
      stepEl.classList.add('exit-left');
      setTimeout(() => this.showStep(0), 400);
    });

    loginBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const name = nameInput.value.trim();

      if (!email || !password) {
        messageEl.textContent = 'Email e password sono obbligatori';
        messageEl.style.background = 'rgba(255,100,100,0.1)';
        messageEl.style.borderColor = 'rgba(255,100,100,0.2)';
        messageEl.style.color = '#ff6464';
        messageEl.style.display = 'block';
        return;
      }

      loginBtn.disabled = true;
      loginBtn.textContent = 'Accesso in corso...';

      try {
        const API_BASE = 'https://wca-app.vercel.app/api/team-auth';
        const res = await fetch(`${API_BASE}?action=login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data.error || 'Accesso fallito');
        }

        // Save team token and shared keys
        await new Promise((resolve) => {
          chrome.storage.local.set({ cobra_team_token: data.token }, resolve);
        });

        // Update profile with team login
        this.data.profile.name = name || data.user.name || 'utente';
        this.data.settings.fromTeam = true;

        // Save shared keys if available
        if (data.shared_keys) {
          this.data.settings.teamOpenaiKey = data.shared_keys.openai_key || null;
          this.data.settings.teamAnthropicKey = data.shared_keys.anthropic_key || null;
          this.data.settings.teamGeminiKey = data.shared_keys.gemini_key || null;
          this.data.settings.teamGroqKey = data.shared_keys.groq_key || null;
          this.data.settings.teamElevenKey = data.shared_keys.eleven_key || null;
        }

        // Complete onboarding
        this.complete();
      } catch (error) {
        messageEl.textContent = error.message;
        messageEl.style.background = 'rgba(255,100,100,0.1)';
        messageEl.style.borderColor = 'rgba(255,100,100,0.2)';
        messageEl.style.color = '#ff6464';
        messageEl.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Accedi';
      }
    });
  }

  nextStep() {
    const steps = this.getSteps();
    if (this.currentStep < steps.length - 1) {
      this.transitionOut(() => this.showStep(this.currentStep + 1));
    }
  }

  transitionOut(callback) {
    const stepEl = this.stepContainer.querySelector('.cobra-onboarding-step');
    if (stepEl) {
      stepEl.classList.remove('active');
      stepEl.classList.add('exit-left');
      setTimeout(callback, 400);
    } else callback();
  }

  complete() {
    console.log('[Onboarding] Complete() called');
    this.saveAllData().then(() => {
      console.log('[Onboarding] saveAllData() completed, starting transition');
      this.transitionOut(() => {
        this.overlay.style.opacity = '0';
        this.overlay.style.transition = 'opacity 400ms ease';
        setTimeout(() => {
          this.overlay.remove();
          this.isExiting = true;
          // CRITICAL: notify sidepanel to reload settings from storage
          window.dispatchEvent(new CustomEvent('cobra-onboarding-complete'));
          console.log('[Onboarding] Done — dispatched cobra-onboarding-complete');
        }, 400);
      });
    }).catch(err => {
      console.error('[Onboarding] Failed to save data:', err);
      alert('Errore nel salvataggio: ' + err.message);
    });
  }

  saveAllData() {
    console.log('[Onboarding] Saving all data. Current state:', {
      profile: this.data.profile,
      apiKeys: Object.keys(this.data.apiKeys).reduce((acc, k) => ({ ...acc, [k]: this.data.apiKeys[k] ? '***' : '' }), {})
    });

    const mergedSettings = {
      ...(this.data.settings || {}),
      openaiKey: this.data.apiKeys.openai_key || '',
      anthropicKey: this.data.apiKeys.claude_key || '',
      geminiKey: this.data.apiKeys.gemini_key || '',
      groqKey: this.data.apiKeys.groq_key || '',
      stealth: true,
      localMemory: true,
      learning: true,
      kb: true,
      language: 'it'
    };

    console.log('[Onboarding] Merged settings to save:', {
      ...mergedSettings,
      openaiKey: mergedSettings.openaiKey ? '***' : '',
      anthropicKey: mergedSettings.anthropicKey ? '***' : '',
      geminiKey: mergedSettings.geminiKey ? '***' : '',
      groqKey: mergedSettings.groqKey ? '***' : ''
    });

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({
        cobra_profile: this.data.profile,
        cobra_settings: mergedSettings,
        cobra_onboarding_complete: true
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Onboarding] Save failed:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('[Onboarding] Data saved successfully to chrome.storage.local');
          // Verify immediately
          chrome.storage.local.get(['cobra_settings', 'cobra_profile'], (result) => {
            console.log('[Onboarding] Verification - Saved data:', {
              profile: result.cobra_profile,
              settings: result.cobra_settings ? {
                ...result.cobra_settings,
                openaiKey: result.cobra_settings.openaiKey ? '***' : '',
                anthropicKey: result.cobra_settings.anthropicKey ? '***' : '',
                geminiKey: result.cobra_settings.geminiKey ? '***' : '',
                groqKey: result.cobra_settings.groqKey ? '***' : ''
              } : null
            });
            resolve();
          });
        }
      });
    });
  }
}

// ============ STEP 1: Setup (Welcome + Nome + API Key) ============

class StepSetup {
  render(data) {
    const step = document.createElement('div');
    step.className = 'cobra-onboarding-step';
    step.innerHTML = `
      <div class="cobra-animated-logo">
        <img src="icons/cobra-logo.png" alt="COBRA" style="width:100%;height:100%;object-fit:contain;">
      </div>
      <h1 class="cobra-step-title">Benvenuto in COBRA</h1>
      <p class="cobra-step-subtitle">Co-pilota AI nel browser. Scraping, automazione, analisi — tutto dalla sidebar.</p>

      <div class="cobra-form-group">
        <label class="cobra-form-label">Come ti chiami?</label>
        <input type="text" class="cobra-form-input" id="onb-name" placeholder="Il tuo nome" value="${data.profile.name || ''}">
      </div>

      <div class="cobra-info-box">Serve almeno 1 API key per la chat AI. Groq è gratuita su groq.com</div>

      <div class="cobra-provider-tabs">
        <button class="cobra-provider-tab active" data-provider="groq">Groq</button>
        <button class="cobra-provider-tab" data-provider="openai">OpenAI</button>
        <button class="cobra-provider-tab" data-provider="claude">Claude</button>
        <button class="cobra-provider-tab" data-provider="gemini">Gemini</button>
      </div>

      <div class="cobra-form-group" id="onb-key-group">
        <label class="cobra-form-label" id="onb-key-label">Groq API Key</label>
        <input type="password" class="cobra-form-input" id="onb-api-key"
          placeholder="gsk_..." value="${data.apiKeys.groq_key || ''}">
        <div class="cobra-hint" id="onb-key-hint">Gratuita su console.groq.com</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;margin-top:16px;">
        <div style="height:1px;background:rgba(82,187,255,0.1);"></div>
        <button class="cobra-btn cobra-btn-secondary" data-action="team-login" style="width:100%;">🔐 Accesso Team</button>
      </div>

      <div class="cobra-step-footer">
        <div class="cobra-progress-dots">
          <div class="cobra-dot active"></div>
          <div class="cobra-dot"></div>
        </div>
        <button class="cobra-btn cobra-btn-primary" data-action="next">Avanti</button>
      </div>
    `;
    return step;
  }

  attachListeners(dom, data) {
    const nameInput = dom.querySelector('#onb-name');
    const keyInput = dom.querySelector('#onb-api-key');
    const keyLabel = dom.querySelector('#onb-key-label');
    const keyHint = dom.querySelector('#onb-key-hint');

    if (!keyInput) {
      console.error('[Onboarding] keyInput element not found!');
      return;
    }

    let activeProvider = 'groq';

    const providers = {
      groq:   { label: 'Groq API Key',     placeholder: 'gsk_...',     hint: 'Gratuita su console.groq.com',    dataKey: 'groq_key' },
      openai: { label: 'OpenAI API Key',    placeholder: 'sk-...',      hint: 'Da platform.openai.com',          dataKey: 'openai_key' },
      claude: { label: 'Anthropic API Key', placeholder: 'sk-ant-...',  hint: 'Da console.anthropic.com',        dataKey: 'claude_key' },
      gemini: { label: 'Gemini API Key',    placeholder: 'AIzaSy...',   hint: 'Da aistudio.google.com',          dataKey: 'gemini_key' }
    };

    // Save current key before switching
    function saveCurrentKey() {
      const p = providers[activeProvider];
      if (p && keyInput && keyInput.value) {
        data.apiKeys[p.dataKey] = keyInput.value.trim();
        console.log(`[Onboarding] Saved ${activeProvider} key: ${data.apiKeys[p.dataKey].substring(0, 10)}...`);
      }
    }

    // Provider tab switching
    dom.querySelectorAll('.cobra-provider-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        saveCurrentKey();
        dom.querySelectorAll('.cobra-provider-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeProvider = tab.dataset.provider;
        const p = providers[activeProvider];
        keyLabel.textContent = p.label;
        keyInput.placeholder = p.placeholder;
        keyInput.value = data.apiKeys[p.dataKey] || '';
        keyHint.textContent = p.hint;
        console.log(`[Onboarding] Switched to ${activeProvider}, loaded key: ${data.apiKeys[p.dataKey] ? 'YES' : 'NO'}`);
      });
    });

    // Save on input change - CRITICAL: must update data immediately
    if (nameInput) {
      nameInput.addEventListener('input', e => {
        data.profile.name = e.target.value.trim();
        console.log(`[Onboarding] Name updated: ${data.profile.name}`);
      });
    }

    keyInput.addEventListener('input', () => {
      const p = providers[activeProvider];
      if (p) {
        data.apiKeys[p.dataKey] = keyInput.value.trim();
        console.log(`[Onboarding] Key input updated for ${activeProvider}: ${data.apiKeys[p.dataKey].substring(0, 10)}...`);
      }
    });

    // Initial state logging
    console.log('[Onboarding Step1] Listeners attached. Initial data:', {
      name: data.profile.name,
      apiKeys: Object.keys(data.apiKeys).reduce((acc, k) => ({ ...acc, [k]: data.apiKeys[k] ? '***' : '' }), {})
    });
  }
}

// ============ STEP 2: Completato ============

class StepCompletato {
  render(data) {
    const name = data.profile.name || 'utente';
    const hasKey = !!(data.apiKeys.openai_key || data.apiKeys.claude_key || data.apiKeys.gemini_key || data.apiKeys.groq_key);

    const step = document.createElement('div');
    step.className = 'cobra-onboarding-step';
    step.innerHTML = `
      <div class="cobra-success-icon">${hasKey ? '✓' : '⚠️'}</div>
      <h1 class="cobra-step-title">${hasKey ? `Pronto, ${name}!` : 'Quasi pronto!'}</h1>
      <p class="cobra-step-subtitle">${hasKey
        ? 'COBRA è configurato. Puoi sempre modificare tutto dalle Impostazioni.'
        : 'Nessuna API key inserita. La chat AI non funzionerà finché non ne aggiungi una nelle Impostazioni.'
      }</p>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        <div class="cobra-check-item"><span class="check">${data.profile.name ? '✓' : '—'}</span> Profilo: ${data.profile.name || 'Non configurato'}</div>
        <div class="cobra-check-item"><span class="check">${hasKey ? '✓' : '✗'}</span> API Key: ${hasKey ? 'Configurata' : 'Mancante'}</div>
        <div class="cobra-check-item"><span class="check">→</span> Voice, Cloud, KB: configurabili da Impostazioni</div>
      </div>

      <div class="cobra-step-footer">
        <div class="cobra-progress-dots">
          <div class="cobra-dot"></div>
          <div class="cobra-dot active"></div>
        </div>
        <button class="cobra-btn cobra-btn-primary" data-action="complete">Avvia COBRA</button>
      </div>
    `;
    return step;
  }

  attachListeners(dom, data) {}
}
