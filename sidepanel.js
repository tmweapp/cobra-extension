// COBRA v5.2 — Side Panel Controller (4-Screen Architecture)
// Home (Chat+Actions), Archivio (Memoria+KB+Jobs+Cronologia), AI (Orchestration), Settings
// Multi-Agent + Voice + Gate + Supabase Sync

// Toast → loaded from modules/toast.js
// ErrorBoundary → loaded from modules/error-boundary.js

// ============================================================
// STATE — Extended with agents and voice
// ============================================================
const state = {
  currentView: 'home',
  chatHistory: [],
  memories: [],
  habits: { sites: {}, actions: {}, hours: {}, sessions: 0 },
  settings: {
    stealth: true, localMemory: true, cloudSync: false,
    learning: true, kb: true, notifications: false,
    rateLimit: 'balanced', language: 'it',
    supabaseUrl: '', supabaseKey: '',
    elevenKey: '',
    webhookUrl: '',
    orchestration: false, voice: true, voiceSpeed: '1.0',
    openaiKey: '',
    openaiModel: 'gpt-4o-mini',
    anthropicKey: '',
    anthropicModel: 'claude-sonnet-4-20250514',
    geminiKey: '',
    geminiModel: 'gemini-2.0-flash',
    groqKey: '',
    groqModel: 'llama-3.3-70b-versatile'
  },
  // NEW: Agent orchestration
  agents: [
    { id: 'analyst', name: 'Analyst', active: true, provider: 'openai', icon: '📊', imgActive: 'icons/agents/analyst-active.gif', imgInactive: 'icons/agents/newton-static.png' },
    { id: 'strategist', name: 'Strategist', active: false, provider: 'anthropic', icon: '🎯', imgActive: 'icons/agents/strategist-active.gif', imgInactive: 'icons/agents/newton-static.png' },
    { id: 'critic', name: 'Critic', active: false, provider: 'openai', icon: '🔍', imgActive: 'icons/agents/critic-active.gif', imgInactive: 'icons/agents/newton-static.png' },
    { id: 'executor', name: 'Executor', active: false, provider: 'groq', icon: '⚡', imgActive: 'icons/agents/executor-active.gif', imgInactive: 'icons/agents/newton-static.png' }
  ],
  leaderAgentId: 'analyst',
  isOrchestrating: false,
  voiceActive: false,
  recognition: null, // Web Speech API instance
  connectedFolders: {} // File System Access API directory handles { name: handle }
};

// ============================================================
// SECURITY — Sanitize untrusted HTML content to prevent XSS
// ============================================================
function sanitizeHTML(str) {
  if (!str || typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Storage → loaded from modules/storage.js

// ============================================================
// SUPABASE CLIENT — Memory cloud
// ============================================================
const Supabase = {
  get url() { return state.settings.supabaseUrl; },
  get key() { return state.settings.supabaseKey; },
  get headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`
    };
  },
  get connected() { return !!(this.url && this.key); },

  async query(table, method = 'GET', params = '', body = null) {
    if (!this.connected) return null;
    const opts = { method, headers: this.headers };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}${params}`, opts);
      if (!res.ok) throw new Error(`${res.status}`);
      return method === 'GET' ? await res.json() : true;
    } catch (e) {
      console.error('Supabase error:', e);
      return null;
    }
  },

  async uploadMemories() {
    if (!this.connected || !state.memories.length) return false;
    for (const mem of state.memories) {
      if (mem.synced) continue;
      const row = {
        title: mem.title,
        content: JSON.stringify(mem.data),
        type: mem.type || 'scrape',
        tags: mem.tags || [],
        approved: true
      };
      const ok = await this.query('ernesto_memory_items', 'POST', '', row);
      if (ok) mem.synced = true;
    }
    await Storage.saveMemories();
    return true;
  },

  async downloadMemories() {
    if (!this.connected) return [];
    const data = await this.query('ernesto_memory_items', 'GET',
      '?select=title,content,type,tags,updated_at&order=updated_at.desc&limit=50');
    if (!data) return [];
    for (const item of data) {
      const exists = state.memories.find(m => m.title === item.title);
      if (!exists) {
        state.memories.push({
          id: crypto.randomUUID(),
          title: item.title,
          data: item.content,
          type: item.type,
          tags: item.tags || [],
          timestamp: item.updated_at,
          synced: true,
          source: 'cloud'
        });
      }
    }
    await Storage.saveMemories();
    return data;
  },

  async syncHabits() {
    if (!this.connected) return;
    const row = {
      title: `habits_${new Date().toISOString().slice(0, 10)}`,
      content: JSON.stringify(state.habits),
      type: 'habit',
      tags: ['auto', 'learning'],
      approved: true
    };
    await this.query('ernesto_memory_items', 'POST', '', row);
  },

  async testConnection() {
    try {
      const res = await fetch(`${this.url}/rest/v1/`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }
};

// ============================================================
// HABITS TRACKER
// ============================================================
const Habits = {
  trackSite(url) {
    if (!state.settings.learning) return;
    try {
      const host = new URL(url).hostname;
      state.habits.sites[host] = (state.habits.sites[host] || 0) + 1;
    } catch {}
    this.trackHour();
    Storage.saveHabits();
  },
  trackAction(action) {
    if (!state.settings.learning) return;
    state.habits.actions[action] = (state.habits.actions[action] || 0) + 1;
    Storage.saveHabits();
  },
  trackHour() {
    const h = new Date().getHours();
    state.habits.hours[h] = (state.habits.hours[h] || 0) + 1;
  },
  trackSession() {
    state.habits.sessions++;
    Storage.saveHabits();
  },
  getTopSites(n = 3) {
    return Object.entries(state.habits.sites)
      .sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([site, count]) => `${site} (${count}x)`);
  },
  getTopAction() {
    const entries = Object.entries(state.habits.actions);
    if (!entries.length) return 'Nessuna ancora';
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  },
  getPeakHour() {
    const entries = Object.entries(state.habits.hours);
    if (!entries.length) return 'N/D';
    const [hour] = entries.sort((a, b) => b[1] - a[1])[0];
    return `${hour}:00 - ${parseInt(hour) + 1}:00`;
  },
  getSuggestions() {
    const suggestions = [];
    const topSites = this.getTopSites(1);
    if (topSites.length) suggestions.push(`Vuoi scrapare ${topSites[0].split(' (')[0]}? Lo visiti spesso.`);
    const topAction = this.getTopAction();
    if (topAction !== 'Nessuna ancora') suggestions.push(`La tua azione preferita è "${topAction}".`);
    return suggestions;
  }
};

// ============================================================
// AGENT BAR — NEW module for managing active agents
// ============================================================
const AgentBar = {
  render() {
    const container = document.getElementById('agentBar');
    if (!container) return;

    const activeAgents = this.getActiveAgents();
    const isMultiAgent = activeAgents.length > 1;

    container.innerHTML = '';
    state.agents.forEach(agent => {
      const badge = document.createElement('div');
      badge.className = `agent-badge ${agent.active ? 'active' : 'inactive'}`;
      badge.title = `${agent.name} (${agent.provider})`;
      if (agent.imgActive && agent.imgInactive) {
        const src = agent.active ? agent.imgActive : agent.imgInactive;
        badge.innerHTML = `<img class="agent-avatar" src="${src}" alt="${agent.name}" draggable="false">`;
      } else {
        badge.innerHTML = `<span class="agent-icon">${agent.icon}</span>`;
      }

      badge.addEventListener('click', () => {
        this.toggleAgent(agent.id);
      });

      badge.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (agent.active) this.setLeader(agent.id);
      });

      if (agent.id === state.leaderAgentId && isMultiAgent) {
        badge.classList.add('leader');
      }

      container.appendChild(badge);
    });

    const countEl = document.getElementById('agentCount');
    if (countEl) {
      countEl.textContent = `${activeAgents.length} agente${activeAgents.length !== 1 ? 'i' : ''}`;
    }

    const indicator = document.getElementById('orchestratorIndicator');
    if (indicator) {
      indicator.style.display = isMultiAgent ? 'flex' : 'none';
    }

    state.settings.orchestration = isMultiAgent;
    Storage.saveSettings();
  },

  getActiveAgents() {
    return state.agents.filter(a => a.active);
  },

  toggleAgent(agentId) {
    const agent = state.agents.find(a => a.id === agentId);
    if (agent) {
      const activeCount = state.agents.filter(a => a.active).length;
      if (agent.active && activeCount <= 1) {
        Chat.addMessage('system', 'Deve restare almeno un agente attivo.');
        return;
      }
      agent.active = !agent.active;
      if (!agent.active && agent.id === state.leaderAgentId) {
        const newActive = this.getActiveAgents();
        if (newActive.length > 0) {
          state.leaderAgentId = newActive[0].id;
        }
      }
      Storage.save('cobra_agents', state.agents);
      this.render();
    }
  },

  setLeader(agentId) {
    const agent = state.agents.find(a => a.id === agentId);
    if (agent && agent.active) {
      state.leaderAgentId = agentId;
      Storage.save('cobra_leader', agentId);
      this.render();
      Chat.addMessage('system', `${agent.name} è il leader dell'orchestrazione.`);
    }
  }
};

// Voice → loaded from modules/voice.js (430 lines extracted)
// CommChat → loaded from modules/comm-chat.js (250 lines extracted)
//
// Both modules are loaded via <script> tags in sidepanel.html before this file.
// They use the same global `state`, `Chat`, `Toast`, `sanitizeHTML` references.

/* ---- VOICE MODULE SENTINEL ---- */
if (typeof Voice === 'undefined') { console.error('[COBRA] Voice module not loaded! Check modules/voice.js'); }
/* ---- END SENTINEL ---- */

// Voice → modules/voice.js (430 lines extracted)

// ============================================================
// CHAT ENGINE — Updated for multi-agent orchestration
// ============================================================
const Chat = {
  addMessage(role, content, actions = []) {
    if (!role || !content) return null; // Null check
    if (!Array.isArray(state.chatHistory)) state.chatHistory = [];
    const msg = {
      id: crypto.randomUUID(),
      role: String(role),
      content: String(content),
      actions: Array.isArray(actions) ? actions : [],
      timestamp: new Date().toISOString()
    };
    state.chatHistory.push(msg);
    // Limit chat history to prevent unbounded growth
    if (state.chatHistory.length > 1000) state.chatHistory = state.chatHistory.slice(-1000);
    Storage.saveChat();
    this.renderMessage(msg);
    return msg;
  },

  renderMessage(msg) {
    const container = document.getElementById('chatMessages');
    if (!container || !msg) return;

    const el = document.createElement('div');
    el.className = `msg msg-${msg.role || 'unknown'}`;

    let content = msg.content || '';

    // Minimal cleanup: only catch raw JSON that the AI accidentally leaked
    if (msg.role === 'ai' || msg.role === 'assistant') {
      // If the response is ENTIRELY a JSON blob (AI error), show a friendly fallback
      if (/^\s*[\{\[]/.test(content) && /[\}\]]\s*$/.test(content) && content.length > 300) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.error) { content = `Errore: ${parsed.error}`; Toast.error(parsed.error); }
          else if (parsed.ok) content = parsed.message || 'Fatto.';
          else content = 'Sto lavorando...';
        } catch { /* not JSON, show as-is */ }
      }
    }

    // Add avatar for AI messages
    if (msg.role === 'ai' || msg.role === 'assistant') {
      const avatarImg = document.createElement('img');
      avatarImg.className = 'chat-avatar';
      avatarImg.src = 'icons/agents/lei-active.gif';
      avatarImg.alt = 'COBRA';
      avatarImg.draggable = false;
      el.prepend(avatarImg);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'msg-text';
    textSpan.textContent = content;
    el.appendChild(textSpan);

    if (Array.isArray(msg.actions) && msg.actions.length > 0) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'actions';
      msg.actions.forEach(a => {
        if (!a) return;
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = a.label || '';
        btn.addEventListener('click', () => this.handleAction(a));
        actionsDiv.appendChild(btn);
      });
      el.appendChild(actionsDiv);
    }
    container.appendChild(el);
    if (container.scrollHeight) container.scrollTop = container.scrollHeight;
  },

  loadHistory() {
    state.chatHistory.forEach(msg => this.renderMessage(msg));
    const container = document.getElementById('chatMessages');
    if (container) container.scrollTop = container.scrollHeight;
  },

  showTyping() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.classList.add('active');
  },

  hideTyping() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.classList.remove('active');
  },

  detectTaskType(text) {
    const lower = (text || '').toLowerCase();
    if (lower.includes('decid') || lower.includes('scegl') || lower.includes('meglio') || lower.includes('consigl')) return 'decision';
    if (lower.includes('document') || lower.includes('report') || lower.includes('scrivi') || lower.includes('redigi')) return 'document';
    if (lower.includes('analiz') || lower.includes('valut') || lower.includes('studi')) return 'analysis';
    return 'general';
  },

  showOrchestrating(show) {
    state.isOrchestrating = show;
    const indicator = document.getElementById('orchestratorIndicator');
    if (indicator) {
      indicator.style.display = show ? 'flex' : 'none';
      if (show) {
        indicator.innerHTML = '<span class="orchestrating-text">Orchestrating...</span>';
      }
    }
  },

  // Helper to close live log + thinking bubbles after AI response
  _closeLiveUI() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const logGroup = container.querySelector('.cobra-live-log');
    if (logGroup) {
      const entries = logGroup.querySelector('.log-entries');
      const count = entries ? entries.children.length : 0;
      logGroup.classList.add('log-completed');
      const header = logGroup.querySelector('.log-header');
      if (header) header.textContent = `${count} operazioni completate`;
    }
    const thinkBubble = container.querySelector('.cobra-thinking-active');
    if (thinkBubble) {
      thinkBubble.classList.remove('cobra-thinking-active');
      thinkBubble.classList.add('cobra-thinking-done');
      const stream = thinkBubble.querySelector('.thinking-stream');
      if (stream && stream.children.length > 2) {
        while (stream.children.length > 2) stream.removeChild(stream.firstChild);
      }
    }
  },

  // Stop current AI processing
  stopProcessing() {
    chrome.runtime.sendMessage({ type: 'CHAT_ABORT' }).catch(() => {});
    if (this._watchdogTimer) { clearTimeout(this._watchdogTimer); this._watchdogTimer = null; }
    this.hideTyping();
    this._closeLiveUI();
    this.showOrchestrating(false);
    this.showStopBtn(false);
    state._waitingForResponse = false;
    this.addMessage('ai', 'Operazione interrotta.');
    Toast.warning('Operazione interrotta');
  },

  showStopBtn(show) {
    const stopBtn = document.getElementById('chatStopBtn');
    const sendBtn = document.getElementById('chatSend');
    if (stopBtn) stopBtn.style.display = show ? 'inline-flex' : 'none';
    if (sendBtn) sendBtn.style.display = show ? 'none' : 'inline-flex';
  },

  async send(text) {
    if (!text.trim()) return;

    // Reset any stuck state from previous request
    if (state._waitingForResponse) {
      console.warn('[Chat] Previous request still pending — force-resetting');
      this.hideTyping();
      this._closeLiveUI();
      this.showStopBtn(false);
      this.showOrchestrating(false);
    }

    this.addMessage('user', text);
    Habits.trackAction('chat');
    this.showTyping();
    this.showStopBtn(true);
    state._waitingForResponse = true;

    // Watchdog: if no response in 120s, auto-reset
    if (this._watchdogTimer) clearTimeout(this._watchdogTimer);
    this._watchdogTimer = setTimeout(() => {
      if (state._waitingForResponse) {
        console.warn('[Chat] Watchdog: 120s timeout — resetting');
        state._waitingForResponse = false;
        this.hideTyping();
        this._closeLiveUI();
        this.showStopBtn(false);
        this.showOrchestrating(false);
        this.addMessage('ai', 'Timeout: nessuna risposta ricevuta. Il servizio potrebbe essersi interrotto. Riprova.');
      }
    }, 120000);

    const activeAgents = AgentBar.getActiveAgents();

    if (activeAgents.length > 1 && state.settings.orchestration) {
      // MULTI-AGENT — fire and forget, response comes via broadcast
      this.showOrchestrating(true);
      chrome.runtime.sendMessage({
        type: 'ORCHESTRATE',
        payload: {
          message: text,
          agents: activeAgents.map(a => ({ id: a.id, name: a.name, provider: a.provider })),
          leaderAgentId: state.leaderAgentId,
          chatHistory: state.chatHistory.slice(-20),
          taskType: this.detectTaskType(text)
        }
      }).then(response => {
        // ORCHESTRATE still uses sendResponse (shorter calls)
        if (!state._waitingForResponse) return;
        this.hideTyping();
        this._closeLiveUI();
        this.showOrchestrating(false);
        this.showStopBtn(false);
        state._waitingForResponse = false;
        if (response?.content) {
          this.addMessage('ai', response.content, response.actions || []);
          if (state.settings.voice) Voice.speakConversational(response.content);
        }
      }).catch(e => {
        if (!state._waitingForResponse) return;
        this.hideTyping();
        this._closeLiveUI();
        this.showOrchestrating(false);
        this.showStopBtn(false);
        state._waitingForResponse = false;
        this.addMessage('ai', `Errore orchestrazione: ${e.message}`);
      });
    } else {
      // SINGLE AGENT — fire and forget, response comes via CHAT_RESPONSE broadcast
      chrome.runtime.sendMessage({
        type: 'CHAT_MESSAGE',
        payload: {
          message: text,
          history: state.chatHistory.slice(-20),
          habits: state.habits,
          memories: state.memories.slice(-10),
          voiceMode: !!state.settings.voice
        }
      }).catch(e => {
        // Only error if the initial send fails (very rare)
        console.warn('[Chat] sendMessage error:', e.message);
      });
      // Response will arrive via CHAT_RESPONSE broadcast — handled in onMessage listener
    }
  },

  handleAction(action) {
    if (action.label && action.label.includes('Configura')) { switchView('settings'); return; }
    switch (action.type) {
      case 'scrape':
        this.send('Cattura tutti i dati dalla pagina corrente');
        break;
      case 'navigate':
        if (action.url) chrome.runtime.sendMessage({ type: 'NAVIGATE', payload: { url: action.url } });
        else switchView('settings');
        break;
      case 'memory': switchView('archivio'); break;
      case 'jobs': switchView('archivio'); break;
      default: if (action.label) this.send(action.label);
    }
  }
};

// ============================================================
// MEMORY MANAGER
// ============================================================
const Memory = {
  save(title, data, type = 'manual', tags = []) {
    if (!title || !data) return null; // Null check
    if (!Array.isArray(state.memories)) state.memories = [];
    const mem = {
      id: crypto.randomUUID(),
      title: String(title).slice(0, 200), // Bound title length
      data,
      type: type || 'manual',
      tags: Array.isArray(tags) ? tags : [],
      timestamp: new Date().toISOString(),
      synced: false,
      source: 'local'
    };
    state.memories.unshift(mem);
    // Strictly limit to prevent unbounded growth
    if (state.memories.length > 500) state.memories = state.memories.slice(0, 500);
    Storage.saveMemories();
    this.render();
    return mem;
  },

  search(query) {
    if (!query) return state.memories;
    const q = query.toLowerCase();
    return state.memories.filter(m =>
      m.title.toLowerCase().includes(q) ||
      (typeof m.data === 'string' && m.data.toLowerCase().includes(q)) ||
      (m.tags && m.tags.some(t => t.toLowerCase().includes(q)))
    );
  },

  render(items = null) {
    const list = document.getElementById('memoriesList');
    if (!list) return;

    const memories = items || state.memories;
    if (!Array.isArray(memories) || !memories.length) {
      list.innerHTML = '<div class="msg msg-system">Nessuna memoria salvata.</div>';
      return;
    }
    list.innerHTML = memories.slice(0, 30).map(m => {
      if (!m || !m.id) return ''; // Null check
      const dataPreview = typeof m.data === 'string' ? (m.data || '').slice(0, 100) : JSON.stringify(m.data || {}).slice(0, 100);
      return `
      <div class="memory-item" data-id="${sanitizeHTML(m.id || '')}">
        <div class="title">${sanitizeHTML(m.title || 'Untitled')}</div>
        <div class="detail">${sanitizeHTML(dataPreview)}...</div>
        <div class="tags">
          <span class="memory-tag">${sanitizeHTML(m.type || 'note')}</span>
          ${m.source === 'cloud' ? '<span class="memory-tag" style="background:#112211;color:#44cc44;">cloud</span>' : ''}
          ${m.synced ? '<span class="memory-tag" style="background:#112211;color:#44cc44;">sync</span>' : ''}
          ${Array.isArray(m.tags) ? m.tags.map(t => `<span class="memory-tag">${sanitizeHTML(t || '')}</span>`).join('') : ''}
        </div>
      </div>
    `;
    }).join('');
  },

  renderHabits() {
    const topSites = document.getElementById('habitTopSites');
    const topAction = document.getElementById('habitTopAction');
    const peakHour = document.getElementById('habitPeakHour');
    const sessions = document.getElementById('habitSessions');

    if (topSites) {
      const sites = Habits.getTopSites(3);
      topSites.textContent = (Array.isArray(sites) ? sites.join(', ') : '') || 'Nessun dato';
    }
    if (topAction) topAction.textContent = Habits.getTopAction() || 'Nessuna';
    if (peakHour) peakHour.textContent = Habits.getPeakHour() || 'N/D';
    if (sessions) sessions.textContent = state.habits?.sessions || 0;

    const cards = document.querySelectorAll('.habit-card .bar-fill');
    if (cards && cards.length > 0) {
      if (cards[0] && state.habits?.sites) cards[0].style.width = `${Math.min(100, Object.keys(state.habits.sites).length * 10)}%`;
      if (cards[1] && state.habits?.actions) cards[1].style.width = `${Math.min(100, Object.keys(state.habits.actions).length * 15)}%`;
      if (cards[2] && state.habits?.hours) cards[2].style.width = `${Math.min(100, Object.keys(state.habits.hours).length * 8)}%`;
      if (cards[3] && state.habits?.sessions) cards[3].style.width = `${Math.min(100, state.habits.sessions * 5)}%`;
    }
  }
};

// ============================================================
// JOBS UI — Interfaccia Job Manager
// ============================================================
const JobsUI = {
  async loadJobs() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'JOBS_LIST' });
      return response?.jobs || [];
    } catch { return []; }
  },

  async renderJobs() {
    const jobs = await this.loadJobs();
    const active = jobs.filter(j => ['running', 'pending', 'paused'].includes(j.status));
    const completed = jobs.filter(j => j.status === 'completed');

    this.renderList('activeJobsList', active, 'Nessun job attivo.');
    this.renderList('completedJobsList', completed, 'Nessun job completato.');

    const statsEl = document.getElementById('jobStats');
    if (statsEl) {
      statsEl.innerHTML = `
        <span class="stat"><b>${active.length}</b> attivi</span>
        <span class="stat"><b>${completed.length}</b> completati</span>
        <span class="stat"><b>${jobs.filter(j => j.status === 'failed').length}</b> falliti</span>
        <span class="stat"><b>${jobs.length}</b> totali</span>
      `;
    }
  },

  renderList(containerId, jobs, emptyMsg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!Array.isArray(jobs) || !jobs.length) {
      el.innerHTML = `<div class="msg msg-system">${emptyMsg || 'Nessun elemento.'}</div>`;
      return;
    }
    el.innerHTML = jobs.map(j => {
      if (!j || !j.id) return ''; // Null check
      const jobTitle = sanitizeHTML(j.title || (j.id ? j.id.slice(0,8) : 'Job'));
      const jobStatus = sanitizeHTML(j.status || 'unknown');
      return `
      <div class="job-item" data-job-id="${sanitizeHTML(j.id || '')}">
        <div class="job-header">
          <span class="job-title">${jobTitle}</span>
          <span class="job-status ${jobStatus}">${jobStatus}</span>
        </div>
        <div style="font-size:11px;color:var(--text3);">${(Array.isArray(j.items) ? j.items.length : 0) || 0} items</div>
        <div class="job-actions">
          ${j.status === 'running' ? '<button class="btn btn-secondary btn-sm" data-job-action="pause">Pausa</button>' : ''}
          ${j.status === 'paused' ? '<button class="btn btn-secondary btn-sm" data-job-action="resume">Riprendi</button>' : ''}
          ${j.status === 'failed' ? '<button class="btn btn-secondary btn-sm" data-job-action="retry">Riprova</button>' : ''}
          <button class="btn btn-secondary btn-sm" data-job-action="details">Dettagli</button>
        </div>
      </div>
    `;
    }).join('');

    const actionButtons = el.querySelectorAll('[data-job-action]');
    if (actionButtons) {
      actionButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const jobItem = btn.closest('.job-item');
          const jobId = jobItem?.dataset?.jobId;
          const action = btn.dataset?.jobAction;
          if (jobId && action) {
            chrome.runtime.sendMessage({ type: `JOB_${action.toUpperCase()}`, payload: { jobId } });
            setTimeout(() => this.renderJobs(), 500);
          }
        });
      });
    }
  }
};

// ============================================================
// PERSISTENT JOBS UI (v5.2 — CobraJobs engine)
// ============================================================
const PJobsUI = {
  async render() {
    const el = document.getElementById('persistentJobsList');
    if (!el) return;
    try {
      const res = await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_LIST' }, r));
      const jobs = res?.jobs || [];
      if (!jobs.length) { el.innerHTML = '<div class="msg msg-system">Nessun job persistente.</div>'; return; }
      el.innerHTML = jobs.map(j => {
        const stateClass = j.lastRunState || 'idle';
        const stateLabel = { idle: 'Pronto', running: 'In corso', paused: 'In pausa', completed: 'Completato', failed: 'Fallito', cancelled: 'Cancellato' }[stateClass] || stateClass;
        return `<div class="job-item" data-pjob-id="${j.id}">
          <div class="job-header">
            <span class="job-title">${sanitizeHTML(j.name)}</span>
            <span class="job-status ${stateClass}">${stateLabel}</span>
          </div>
          <div style="font-size:11px;color:var(--text3);">${j.stepsCount} step &middot; ${j.runCount} esecuzioni</div>
          <div class="job-actions">
            ${!j.lastRunState || j.lastRunState === 'idle' || j.lastRunState === 'completed' || j.lastRunState === 'failed' || j.lastRunState === 'cancelled'
              ? '<button class="btn btn-secondary btn-sm" data-pjob-action="run">Avvia</button>' : ''}
            ${j.lastRunState === 'running' ? '<button class="btn btn-secondary btn-sm" data-pjob-action="pause">Pausa</button><button class="btn btn-secondary btn-sm" data-pjob-action="cancel">Cancella</button>' : ''}
            ${j.lastRunState === 'paused' ? '<button class="btn btn-secondary btn-sm" data-pjob-action="resume">Riprendi</button>' : ''}
            <button class="btn btn-secondary btn-sm" data-pjob-action="delete" style="color:var(--error);">Elimina</button>
          </div>
        </div>`;
      }).join('');

      el.querySelectorAll('[data-pjob-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const jobId = btn.closest('[data-pjob-id]')?.dataset.pjobId;
          const action = btn.dataset.pjobAction;
          if (!jobId || !action) return;
          if (action === 'run') await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_RUN', jobId }, r));
          else if (action === 'pause') await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_PAUSE' }, r));
          else if (action === 'resume') {
            const jobData = await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_GET', jobId }, r));
            if (jobData?.job?.lastRunId) await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_RESUME', runId: jobData.job.lastRunId }, r));
          }
          else if (action === 'cancel') await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_CANCEL' }, r));
          else if (action === 'delete') await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_DELETE', jobId }, r));
          setTimeout(() => this.render(), 400);
        });
      });
    } catch (e) {
      el.innerHTML = `<div class="msg msg-system">Errore: ${e.message}</div>`;
    }
  },

  async renderActiveRun() {
    const el = document.getElementById('activeRunStatus');
    if (!el) return;
    try {
      const res = await new Promise(r => chrome.runtime.sendMessage({ action: 'PJOB_ACTIVE_RUN' }, r));
      const run = res?.run;
      if (!run) { el.innerHTML = '<span style="color:var(--text3)">Nessuna esecuzione attiva</span>'; return; }
      const pct = Math.round((run.currentStep / run.totalSteps) * 100);
      el.innerHTML = `<div><b>${sanitizeHTML(run.jobName)}</b> — Step ${run.currentStep + 1}/${run.totalSteps} (${pct}%)</div>
        <div style="background:var(--bg3);border-radius:4px;height:6px;margin-top:4px;">
          <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:4px;transition:width 0.3s;"></div>
        </div>`;
    } catch {}
  }
};

// ============================================================
// KB UI — Interfaccia Knowledge Base
// ============================================================
const KBUI = {
  allRules: [],
  currentFilter: 'all',

  async loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'KB_STATS' });
      if (response) {
        const total = document.getElementById('kbTotalRules');
        const domains = document.getElementById('kbDomains');
        const prompts = document.getElementById('kbPrompts');
        if (total) total.textContent = response.activeRules || 0;
        if (domains) domains.textContent = response.domains || 0;
        if (prompts) prompts.textContent = response.operativePrompts || 0;
      }
    } catch {}
  },

  async loadRules(ruleType = null) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'KB_FIND_RULES', payload: { ruleType } });
      return response?.rules || [];
    } catch { return []; }
  },

  async renderRules() {
    this.allRules = await this.loadRules();
    this.applyFilter(this.currentFilter);

    // Setup category filter buttons
    document.querySelectorAll('.kb-cat-filter').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.kb-cat-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.cat;
        this.applyFilter(this.currentFilter);
      };
    });

    // Setup re-seed button
    const reseedBtn = document.getElementById('kbReseed');
    if (reseedBtn) {
      reseedBtn.onclick = async () => {
        if (confirm('Re-seed KB con le entry di sistema? Le entry esistenti con gli stessi titoli verranno aggiornate.')) {
          await chrome.runtime.sendMessage({ type: 'KB_RESEED' });
          await this.renderRules();
          await this.loadStats();
        }
      };
    }

    // Render prompts in promptsTab
    try {
      const response = await chrome.runtime.sendMessage({ type: 'KB_FIND_PROMPTS' });
      const prompts = response?.prompts || [];
      const el = document.getElementById('kbPromptsList');
      if (!el) return;
      if (!prompts.length) {
        el.innerHTML = '<div class="msg msg-system">Nessun operative prompt salvato.</div>';
      } else {
        el.innerHTML = prompts.map(p => `
          <div class="kb-rule">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="kb-title">${sanitizeHTML(p.title || '')}</span>
              <span class="kb-type">prompt</span>
            </div>
            <div class="kb-content">${sanitizeHTML(p.objective || '')}</div>
            <div style="font-size:10px;color:var(--text3);margin-top:4px;">Usato ${p.usageCount || 0}x</div>
          </div>
        `).join('');
      }
    } catch {}
  },

  applyFilter(cat) {
    let filtered = this.allRules;
    if (cat !== 'all') {
      filtered = this.allRules.filter(r => {
        const rCat = r.metadata?.category || r.operationType || '';
        return rCat === cat || (r.tags || []).includes(cat) || r.ruleType === cat;
      });
    }
    this.renderRuleList('kbRulesList', filtered, 'Nessuna entry per questa categoria.');
  },

  renderRuleList(containerId, rules, emptyMsg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!Array.isArray(rules) || !rules.length) {
      el.innerHTML = `<div class="msg msg-system">${emptyMsg || 'Nessun elemento.'}</div>`;
      return;
    }
    el.innerHTML = rules.map(r => {
      if (!r || !r.id) return '';
      const cat = r.metadata?.category || r.operationType || 'other';
      const src = r.source || 'user';
      const catColors = { tool: '#52bbff', workflow: '#a78bfa', behavior: '#34d399', selector: '#fbbf24', correction: '#f87171', pattern: '#fb923c' };
      const catColor = catColors[cat] || '#888';
      const ruleTitle = sanitizeHTML(r.title || 'Untitled');
      const ruleContent = sanitizeHTML((r.content || '').slice(0, 200));
      const ruleDomain = sanitizeHTML(r.domain || '');
      return `
      <div class="kb-rule" data-rule-id="${sanitizeHTML(r.id || '')}" style="cursor:pointer;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="kb-title">${ruleTitle}</span>
          <div style="display:flex;gap:4px;align-items:center;">
            <span style="font-size:9px;padding:1px 5px;border-radius:4px;background:${catColor}22;color:${catColor};border:1px solid ${catColor}44;">${sanitizeHTML(cat)}</span>
            <span style="font-size:9px;color:var(--text3);">${sanitizeHTML(src)}</span>
          </div>
        </div>
        ${r.domain ? `<div style="font-size:10px;color:var(--accent);">${ruleDomain}</div>` : ''}
        <div class="kb-content kb-content-view">${ruleContent}</div>
        <div class="tags" style="margin-top:4px;">
          ${Array.isArray(r.tags) ? r.tags.slice(0, 6).map(t => `<span class="memory-tag">${sanitizeHTML(t || '')}</span>`).join('') : ''}
        </div>
        <div class="kb-edit-panel" style="display:none;margin-top:6px;">
          <textarea class="kb-edit-content" rows="3" style="width:100%;padding:4px 8px;background:var(--bg2);border:1px solid var(--border-color);border-radius:6px;color:var(--text1);font-size:11px;resize:vertical;">${(r.content || '').replace(/"/g, '&quot;')}</textarea>
          <input class="kb-edit-tags" value="${(r.tags || []).join(', ')}" placeholder="Tags" style="width:100%;padding:4px 8px;background:var(--bg2);border:1px solid var(--border-color);border-radius:6px;color:var(--text1);font-size:11px;margin-top:4px;">
          <div style="display:flex;gap:4px;margin-top:4px;">
            <button class="action-btn kb-save-btn" data-id="${sanitizeHTML(r.id)}" style="flex:1;font-size:10px;">Salva</button>
            <button class="action-btn kb-cancel-btn" style="flex:1;font-size:10px;">Annulla</button>
            <button class="action-btn kb-delete-btn" data-id="${sanitizeHTML(r.id)}" style="font-size:10px;color:#f87171;">Elimina</button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    // Attach click handlers for inline editing
    el.querySelectorAll('.kb-rule').forEach(ruleEl => {
      const contentView = ruleEl.querySelector('.kb-content-view');
      const editPanel = ruleEl.querySelector('.kb-edit-panel');
      if (!contentView || !editPanel) return;

      contentView.addEventListener('click', () => {
        // Close all other edit panels
        el.querySelectorAll('.kb-edit-panel').forEach(p => p.style.display = 'none');
        el.querySelectorAll('.kb-content-view').forEach(c => c.style.display = '');
        editPanel.style.display = 'block';
      });

      ruleEl.querySelector('.kb-cancel-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        editPanel.style.display = 'none';
      });

      ruleEl.querySelector('.kb-save-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        const newContent = editPanel.querySelector('.kb-edit-content').value;
        const newTags = editPanel.querySelector('.kb-edit-tags').value.split(',').map(t => t.trim()).filter(Boolean);
        const rule = this.allRules.find(r => r.id === id);
        if (rule) {
          await chrome.runtime.sendMessage({
            type: 'KB_ADD_RULE',
            payload: { ...rule, content: newContent, tags: newTags }
          });
          await this.renderRules();
          await this.loadStats();
        }
      });

      ruleEl.querySelector('.kb-delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        const rule = this.allRules.find(r => r.id === id);
        if (rule && confirm(`Disattivare "${rule.title}"?`)) {
          // Deactivate by marking inactive
          rule.isActive = false;
          await chrome.runtime.sendMessage({
            type: 'KB_ADD_RULE',
            payload: { ...rule, isActive: false }
          });
          await this.renderRules();
          await this.loadStats();
        }
      });
    });
  }
};

// ============================================================
// CODE SECTION — Strumenti sviluppatore
// ============================================================
const CodeSection = {
  async runCode() {
    const editor = document.getElementById('codeEditor');
    const output = document.getElementById('codeOutput');
    const status = document.getElementById('codeStatus');
    if (!editor || !output || !status) return;

    const code = editor.value;
    if (!code.trim()) return;
    output.classList.remove('hidden');
    output.textContent = 'Esecuzione...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('Nessun tab attivo');

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (code) => {
          try { return String(eval(code)); }
          catch (e) { return `Errore: ${e.message}`; }
        },
        args: [code]
      });

      output.textContent = results[0]?.result || 'Nessun output';
      status.textContent = 'Eseguito con successo';
      status.className = 'status success';
      Habits.trackAction('code_run');
    } catch (e) {
      output.textContent = `Errore: ${e.message}`;
      status.textContent = 'Errore di esecuzione';
      status.className = 'status error';
    }
  },

  async analyzePage() {
    const editor = document.getElementById('codeEditor');
    const output = document.getElementById('codeOutput');
    const status = document.getElementById('codeStatus');
    if (!editor || !output || !status) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src).slice(0, 10);
          const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href).slice(0, 10);
          const meta = {};
          document.querySelectorAll('meta').forEach(m => {
            const name = m.getAttribute('name') || m.getAttribute('property');
            if (name) meta[name] = m.content;
          });
          return {
            title: document.title,
            url: location.href,
            doctype: document.doctype ? 'HTML5' : 'Unknown',
            elements: document.querySelectorAll('*').length,
            scripts, styles, meta,
            forms: document.forms.length,
            links: document.links.length,
            images: document.images.length,
          };
        }
      });
      const info = results[0]?.result;
      if (info) {
        editor.value = JSON.stringify(info, null, 2);
        output.classList.remove('hidden');
        output.textContent =
          `Pagina: ${info.title}\nElementi: ${info.elements}\nScript: ${info.scripts.length}\nCSS: ${info.styles.length}\nForm: ${info.forms}\nLink: ${info.links}\nImmagini: ${info.images}`;
      }
    } catch (e) {
      status.textContent = `Errore: ${e.message}`;
      status.className = 'status error';
    }
  },

  async findSelectors() {
    Chat.addMessage('system', 'Apri la chat e descrivi quale elemento vuoi selezionare. COBRA troverà il selettore CSS migliore.');
    switchView('home');
  }
};

// ============================================================
// OPERATIVO SECTION
// ============================================================
const OpsSection = {
  async renderPrompts() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'KB_FIND_PROMPTS' });
      const prompts = response?.prompts || [];
      const el = document.getElementById('operativePromptsList');
      if (!el) return;
      if (!prompts.length) {
        el.innerHTML = '<div class="msg msg-system">Nessuna procedura salvata. Completa un job per salvare la procedura.</div>';
        return;
      }
      el.innerHTML = prompts.map(p => `
        <div class="section-card" data-prompt-id="${sanitizeHTML(p.id || '')}">
          <div class="sc-title">${sanitizeHTML(p.title || '')}</div>
          <div class="sc-desc">${sanitizeHTML(p.objective || '')}</div>
          <div class="sc-stats">
            <span class="stat"><b>${p.usageCount || 0}</b>x usato</span>
            <span class="stat">${sanitizeHTML(p.domain || 'globale')}</span>
          </div>
        </div>
      `).join('');
    } catch {}
  },

  startPipeline() {
    Chat.addMessage('system', 'Avvio pipeline...');
    Chat.send('Avvia una pipeline di scraping');
  },

  startMonitor() {
    Chat.addMessage('system', 'Avvio monitoraggio prezzi...');
    Chat.send('Imposta un monitoraggio prezzi per questa pagina');
  },

  startLeads() {
    Chat.addMessage('system', 'Avvio lead generation...');
    Chat.send('Avvia lead generation su questa pagina');
  }
};

// ============================================================
// ERNESTO SECTION
// ============================================================
const ErnestoSection = {
  async ask(question) {
    if (!question.trim()) return;
    const output = document.getElementById('ernestoResponse');
    if (!output) return;
    output.classList.remove('hidden');
    output.textContent = 'ERNESTO sta pensando...';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ERNESTO_QUERY',
        payload: { question }
      });
      output.textContent = response?.answer || 'Nessuna risposta da ERNESTO.';
    } catch (e) {
      output.textContent = `Errore: ${e.message}`;
    }
  },

  async loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'ERNESTO_STATS' });
      if (response) {
        const listini = document.getElementById('ernestoListini');
        const prodotti = document.getElementById('ernestoProdotti');
        const regole = document.getElementById('ernestoRegole');
        if (listini) listini.textContent = response.listini || 0;
        if (prodotti) prodotti.textContent = response.prodotti || 0;
        if (regole) regole.textContent = response.regole || 0;
      }
    } catch {}
  },

  async importListino() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls,.pdf,.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          await chrome.runtime.sendMessage({
            type: 'ERNESTO_IMPORT',
            payload: {
              filename: file.name,
              data: ev.target.result,
              type: file.type
            }
          });
          Chat.addMessage('ai', `Listino "${file.name}" importato in ERNESTO.`);
        } catch (err) {
          Chat.addMessage('ai', `Errore importazione: ${err.message}`);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }
};

// ============================================================
// GATE UI — Visualizzazione timeline gate
// ============================================================
const GateUI = {
  render(session) {
    const container = document.getElementById('gateTimelineContent');
    const wrapper = document.getElementById('gateTimeline');
    if (!container || !wrapper) return;
    if (!session || !session.gates) {
      wrapper.classList.add('hidden');
      return;
    }
    wrapper.classList.remove('hidden');

    container.innerHTML = session.gates.map(g => `
      <div class="gate-step">
        <div class="gate-dot ${sanitizeHTML(g.status || '')}">${g.status === 'completed' ? '✓' : g.index}</div>
        <div class="gate-info">
          <div class="gate-name">${sanitizeHTML(g.name || '')}</div>
          <div class="gate-desc">${sanitizeHTML(g.description || '')}</div>
          <div class="gate-criteria">
            ${g.exitCriteria.map(c => {
              const done = (g.completedCriteria || []).includes(c);
              return `<div class="${done ? 'done' : ''}">  ${done ? '✅' : '⬜'} ${sanitizeHTML(c || '')}</div>`;
            }).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }
};

// ============================================================
// VIEW SWITCHING
// ============================================================
function switchView(view) {
  if (!view) return;

  // Map legacy view names to new 4-screen structure
  const viewMap = {
    'chat': 'home', 'scrape': 'home', 'agent': 'home',
    'memory': 'archivio', 'jobs': 'archivio', 'kb': 'archivio',
    'operativo': 'home', 'ernesto': 'archivio', 'code': 'home',
    'connessioni': 'settings', 'tools': 'home',
    'home': 'home', 'archivio': 'archivio', 'ai': 'ai', 'comms': 'comms', 'settings': 'settings'
  };
  const mappedView = viewMap[view] || 'home';
  state.currentView = mappedView;

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  const activeTab = document.querySelector(`.nav-tab[data-view="${mappedView}"]`);
  if (activeTab) activeTab.classList.add('active');

  // Views
  document.querySelectorAll('.view').forEach(p => p.classList.remove('active'));
  const panel = document.querySelector(`.view[data-view="${mappedView}"]`);
  if (panel) panel.classList.add('active');

  // Data loading per view
  if (mappedView === 'archivio') {
    Memory.render(); Memory.renderHabits();
    JobsUI.renderJobs();
    PJobsUI.render(); PJobsUI.renderActiveRun();
    KBUI.loadStats(); KBUI.renderRules();
    if (window.loadTasksList) window.loadTasksList();
    if (window.loadFilesList) window.loadFilesList();
    // Auto-switch to relevant sub-tab if navigated from legacy view
    const subTabMap = { 'memory': 'memoriaTab', 'jobs': 'jobsTab', 'kb': 'kbTab', 'files': 'filesTab', 'ernesto': 'cronologiaTab' };
    if (subTabMap[view]) {
      const targetSubTab = document.querySelector(`.sub-tab[data-subtab="${subTabMap[view]}"]`);
      if (targetSubTab) targetSubTab.click();
    }
  }
  if (mappedView === 'ai') { renderAIView(); }
  if (mappedView === 'comms') { renderCommsView(); }
  if (mappedView === 'settings') {
    // Always reload from chrome.storage before populating UI
    Storage.load('cobra_settings').then(saved => {
      if (saved) Object.assign(state.settings, saved);
      loadSettingsUI();
      // Reload voice list for the voice selector
      Voice.loadVoices().then(() => {
        const langFilter = document.getElementById('voiceLangFilter')?.value;
        Voice.populateVoiceSelect(langFilter);
      });
    });
  }
}

function renderAIView() {
  const list = document.getElementById('activeAgentsList');
  if (list) {
    list.innerHTML = state.agents.map(a => `
      <div class="agent-card">
        <div class="agent-info" style="display:flex;align-items:center;gap:8px;">
          ${a.imgActive ? `<img src="${a.active ? a.imgActive : a.imgInactive}" class="agent-avatar" style="width:28px;height:28px;border-radius:50%;${a.active ? '' : 'filter:grayscale(100%) brightness(0.6);'}">` : ''}
          <div>
            <div class="agent-name">${sanitizeHTML(a.name || '')}</div>
            <div class="agent-meta">${sanitizeHTML(a.provider || '')} ${a.id === state.leaderAgentId ? '⭐ Leader' : ''}</div>
          </div>
        </div>
        <div class="toggle-switch agent-toggle ${a.active ? 'active' : ''}" data-agent-id="${sanitizeHTML(a.id || '')}">
          <div class="toggle-knob"></div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.agent-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        AgentBar.toggleAgent(toggle.dataset.agentId);
        renderAIView();
      });
    });
  }
  const countDisplay = document.getElementById('agentCountDisplay');
  if (countDisplay) countDisplay.textContent = AgentBar.getActiveAgents().length;
  const leaderDisplay = document.getElementById('agentLeader');
  const leader = state.agents.find(a => a.id === state.leaderAgentId);
  if (leaderDisplay && leader) leaderDisplay.textContent = '⭐ ' + leader.name;
}

// CommChat + renderCommsView → modules/comm-chat.js (250 lines extracted)

// ============================================================
// SUB-TABS
// ============================================================
function initSubTabs() {
  document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const parent = tab.closest('.view');
      if (!parent) return;
      // Deactivate all sub-tabs
      parent.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
      // Hide all sub-content
      parent.querySelectorAll('.sub-content').forEach(c => {
        c.classList.remove('active');
        c.classList.add('hidden');
      });
      // Activate clicked tab + its content
      tab.classList.add('active');
      const targetId = tab.dataset.subtab;
      const target = document.getElementById(targetId);
      if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
      }
      // Load data for the activated tab
      if (targetId === 'kbTab' || targetId === 'promptsTab') {
        KBUI.loadStats();
        KBUI.renderRules();
      }
      if (targetId === 'jobsTab' && typeof loadTasksList === 'function') {
        loadTasksList();
      }
      if (targetId === 'filesTab' && typeof loadFilesList === 'function') {
        loadFilesList();
      }
    });
  });
}

// ============================================================
// SETTINGS
// ============================================================
function loadPolicyUI() {
  chrome.runtime.sendMessage({ action: 'POLICY_GET_TRUST' }, (res) => {
    const sel = document.getElementById('policyTrustLevel');
    if (sel && res?.trustLevel !== undefined) sel.value = String(res.trustLevel);
  });
}

function savePolicyTrust() {
  const sel = document.getElementById('policyTrustLevel');
  if (!sel) return;
  const level = parseInt(sel.value, 10);
  chrome.runtime.sendMessage({ action: 'POLICY_SET_TRUST', level });
}

function loadSettingsUI() {
  const s = state.settings;
  if (!s) return; // Null check
  // Load Policy trust level
  loadPolicyUI();
  const toggles = {
    'toggleStealth': s.stealth,
    'toggleLocalMemory': s.localMemory,
    'toggleCloudSync': s.cloudSync,
    'toggleLearning': s.learning,
    'toggleKB': s.kb !== false,
    'toggleNotifications': s.notifications,
    'toggleOrchestration': s.orchestration,
    'toggleVoice': s.voice
  };

  Object.entries(toggles).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', !!value);
  });

  const inputs = {
    'rateLimitMode': s.rateLimit,
    'aiLanguage': s.language,
    'supabaseUrl': s.supabaseUrl || '',
    'supabaseKey': s.supabaseKey || '',
    'elevenKey': s.elevenKey || '',
    'webhookUrl': s.webhookUrl || '',
    'voiceSpeed': s.voiceSpeed || '1.0',
    'voiceModel': s.voiceModel || 'eleven_multilingual_v2',
    'openaiKey': s.openaiKey || '',
    'openaiModel': s.openaiModel || 'gpt-4o-mini',
    'anthropicKey': s.anthropicKey || '',
    'anthropicModel': s.anthropicModel || 'claude-3-5-sonnet-20241022',
    'geminiKey': s.geminiKey || '',
    'geminiModel': s.geminiModel || 'gemini-1.5-flash',
    'groqKey': s.groqKey || '',
    'groqModel': s.groqModel || 'llama-3.3-70b-versatile'
  };

  Object.entries(inputs).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value || '');
  });
}

function saveSettingsFromUI() {
  state.settings.rateLimit = document.getElementById('rateLimitMode')?.value || 'balanced';
  state.settings.language = document.getElementById('aiLanguage')?.value || 'it';
  state.settings.supabaseUrl = document.getElementById('supabaseUrl')?.value?.trim() || '';
  state.settings.supabaseKey = document.getElementById('supabaseKey')?.value?.trim() || '';
  state.settings.elevenKey = document.getElementById('elevenKey')?.value?.trim() || '';
  state.settings.webhookUrl = document.getElementById('webhookUrl')?.value?.trim() || '';
  state.settings.voiceSpeed = document.getElementById('voiceSpeed')?.value || '1.0';
  state.settings.voiceModel = document.getElementById('voiceModel')?.value || 'eleven_multilingual_v2';
  state.settings.selectedVoiceId = document.getElementById('voiceSelect')?.value || state.settings.selectedVoiceId || 'uScy1bXtKz8vPzfdFsFw';
  // AI Provider keys
  state.settings.openaiKey = document.getElementById('openaiKey')?.value?.trim() || '';
  state.settings.openaiModel = document.getElementById('openaiModel')?.value || 'gpt-4o-mini';
  state.settings.anthropicKey = document.getElementById('anthropicKey')?.value?.trim() || '';
  state.settings.anthropicModel = document.getElementById('anthropicModel')?.value || 'claude-3-5-sonnet-20241022';
  state.settings.geminiKey = document.getElementById('geminiKey')?.value?.trim() || '';
  state.settings.geminiModel = document.getElementById('geminiModel')?.value || 'gemini-1.5-flash';
  state.settings.groqKey = document.getElementById('groqKey')?.value?.trim() || '';
  state.settings.groqModel = document.getElementById('groqModel')?.value || 'llama-3.3-70b-versatile';

  const toggles = ['toggleStealth', 'toggleLocalMemory', 'toggleCloudSync', 'toggleLearning',
                   'toggleKB', 'toggleNotifications', 'toggleOrchestration', 'toggleVoice'];
  toggles.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const key = id.replace('toggle', '');
      const settingKey = key.charAt(0).toLowerCase() + key.slice(1);
      state.settings[settingKey] = el.classList.contains('active');
    }
  });

  Storage.saveSettings();
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATE', payload: state.settings });

  // Save Communication Hub config
  saveCommConfigFromUI();
}

function loadCommConfigUI() {
  chrome.runtime.sendMessage({ action: 'COMM_GET_CONFIG' }, (res) => {
    if (!res?.success || !res.config) return;
    const c = res.config;
    const el = (id) => document.getElementById(id);
    if (el('commCfgEmail')) el('commCfgEmail').value = c.email || '';
    if (el('commCfgPassword')) el('commCfgPassword').value = c.password || '';
    if (el('commCfgImapHost')) el('commCfgImapHost').value = c.imapHost || '';
    if (el('commCfgImapPort')) el('commCfgImapPort').value = c.imapPort || 993;
    if (el('commCfgSmtpHost')) el('commCfgSmtpHost').value = c.smtpHost || '';
    if (el('commCfgSmtpPort')) el('commCfgSmtpPort').value = c.smtpPort || 587;
    if (el('commCfgProxy')) el('commCfgProxy').value = c.proxyUrl || '';
  });
}

function saveCommConfigFromUI() {
  const el = (id) => document.getElementById(id)?.value?.trim() || '';
  const config = {
    email: el('commCfgEmail'),
    password: el('commCfgPassword'),
    imapHost: el('commCfgImapHost'),
    imapPort: parseInt(el('commCfgImapPort')) || 993,
    imapTls: true,
    smtpHost: el('commCfgSmtpHost'),
    smtpPort: parseInt(el('commCfgSmtpPort')) || 587,
    proxyUrl: el('commCfgProxy'),
    notificationsEnabled: true,
  };
  if (config.email) {
    chrome.runtime.sendMessage({ action: 'COMM_SAVE_CONFIG', config });
  }
}

function setupCommSettingsListeners() {
  // Auto-discover
  const discoverBtn = document.getElementById('commDiscoverBtn');
  if (discoverBtn) discoverBtn.onclick = () => {
    const email = document.getElementById('commCfgEmail')?.value?.trim();
    if (!email) { Chat.addMessage('system', 'Inserisci un indirizzo email prima.'); return; }
    discoverBtn.disabled = true; discoverBtn.textContent = '⏳ Ricerca...';
    chrome.runtime.sendMessage({ action: 'COMM_DISCOVER', email }, (res) => {
      discoverBtn.disabled = false; discoverBtn.textContent = '🔍 Auto-discover server';
      if (res?.success && res.server) {
        const s = res.server;
        const el = (id) => document.getElementById(id);
        if (el('commCfgImapHost')) el('commCfgImapHost').value = s.host || '';
        if (el('commCfgImapPort')) el('commCfgImapPort').value = s.port || 993;
        if (el('commCfgSmtpHost')) el('commCfgSmtpHost').value = s.smtp || '';
        if (el('commCfgSmtpPort')) el('commCfgSmtpPort').value = s.smtpPort || 587;
        Chat.addMessage('system', `✅ Server trovato: ${s.label || s.host} (${s.method})`);
      } else {
        Chat.addMessage('system', '❌ Server non trovato. Inserisci manualmente.');
      }
    });
  };

  // Test connection
  const testBtn = document.getElementById('commTestBtn');
  if (testBtn) testBtn.onclick = () => {
    saveCommConfigFromUI();
    testBtn.disabled = true; testBtn.textContent = '⏳ Test...';
    const status = document.getElementById('commTestStatus');
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'COMM_TEST_CONNECTION' }, (res) => {
        testBtn.disabled = false; testBtn.textContent = '🧪 Test connessione';
        if (status) status.textContent = res?.success ? '✅ Connessione OK!' : `❌ ${res?.error || 'Errore'}`;
      });
    }, 300);
  };
}

// ============================================================
// PAGE CONTEXT — Show current page near input
// ============================================================
function updatePageContext(tab) {
  const el = document.getElementById('pageContext');
  const textEl = document.getElementById('pageContextText');
  if (!el || !textEl) return;

  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
    el.classList.remove('active');
    textEl.textContent = 'Nuova scheda — naviga su un sito';
    return;
  }

  try {
    const url = new URL(tab.url);
    const domain = url.hostname.replace('www.', '');
    const path = url.pathname === '/' ? '' : url.pathname.slice(0, 40);
    textEl.textContent = domain + path;
    el.classList.add('active');
  } catch {
    textEl.textContent = tab.title || tab.url;
    el.classList.add('active');
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await Storage.loadAll();

  // NOTE: Hardcoded API keys have been removed for security.
  // Users must configure their own API keys in the settings.
  // All API keys should be loaded from user input or secure storage.

  Chat.loadHistory();
  loadCommConfigUI();
  setupCommSettingsListeners();

  // Welcome message on first load
  if (state.chatHistory.length === 0) {
    Chat.addMessage('ai',
      'COBRA operativo. Dimmi cosa fare.',
      [
        { label: 'Cattura pagina', type: 'scrape' },
        { label: 'Analizza pagina', type: 'scrape' }
      ]
    );
  }

  Memory.render();
  Memory.renderHabits();
  AgentBar.render();
  loadSettingsUI();
  Habits.trackSession();
  initSubTabs();
  CommChat.init();

  // Tooltip guidance system
  if (typeof CobraTooltips !== 'undefined') CobraTooltips.init();

  // Settings button opens settings view
  document.getElementById('settingsBtn')?.addEventListener('click', () => switchView('settings'));

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) Habits.trackSite(tab.url);
    updatePageContext(tab);
  } catch {}

  // Update page context when tab changes
  chrome.tabs.onActivated?.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      updatePageContext(tab);
    } catch {}
  });
  chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
      updatePageContext(tab);
    }
  });

  // ============================================================
  // CANVAS ACTIVITY CONTROLLER
  // ============================================================
  const canvasActivity = {
    overlay: null,
    feed: null,
    status: null,
    summaryEl: null,
    linksEl: null,
    isActive: false,
    visitedPages: [],

    init() {
      this.overlay = document.getElementById('canvasOverlay');
      this.feed = document.getElementById('canvasFeed');
      this.status = document.getElementById('canvasStatus');
      this.summaryEl = document.getElementById('canvasSummary');
      this.linksEl = document.getElementById('canvasSummaryLinks');
      const closeBtn = document.getElementById('canvasClose');
      if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
    },

    show() {
      if (!this.overlay) this.init();
      this.overlay.classList.add('active');
      this.feed.innerHTML = '';
      this.visitedPages = [];
      this.isActive = true;
      if (this.summaryEl) this.summaryEl.style.display = 'none';
    },

    hide() {
      if (this.overlay) this.overlay.classList.remove('active');
      this.isActive = false;
    },

    addStep(payload) {
      if (!this.isActive) this.show();
      if (!this.feed) return;

      const tool = payload.tool || 'unknown';
      const status = payload.status || 'running';
      const summary = payload.summary || payload.status || tool;

      // Update status
      if (this.status) this.status.textContent = summary;

      // Create card
      const card = document.createElement('div');
      card.className = 'canvas-card';
      card.id = 'canvas-step-' + Date.now();

      const statusClass = status.includes('error') || status.includes('errore') ? 'error' : status.includes('ok') || status.includes('fatto') ? 'ok' : 'running';

      card.innerHTML =
        '<div class="canvas-card-header">' +
          '<span class="canvas-card-tool">' + this._sanitize(tool) + '</span>' +
          '<span class="canvas-card-status ' + statusClass + '">' + this._sanitize(summary) + '</span>' +
        '</div>' +
        '<div class="canvas-card-info" id="' + card.id + '-info"></div>';

      this.feed.appendChild(card);
      card.scrollIntoView({ behavior: 'smooth', block: 'end' });

      // Auto-request screenshot for visual tools
      if (['navigate', 'google_search', 'click_element', 'fill_form'].includes(tool)) {
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'REQUEST_SCREENSHOT' });
        }, 1500);
      }
    },

    addScreenshot(dataUrl, url, title) {
      if (!this.feed) return;
      const cards = this.feed.querySelectorAll('.canvas-card');
      const lastCard = cards[cards.length - 1];
      if (!lastCard) return;

      // Add thumbnail
      const img = document.createElement('img');
      img.className = 'canvas-card-thumb';
      img.src = dataUrl;
      img.alt = title || 'Screenshot';
      const header = lastCard.querySelector('.canvas-card-header');
      if (header) header.after(img);

      // Add URL info
      const info = lastCard.querySelector('.canvas-card-info');
      if (info && url) {
        info.innerHTML = '<a href="#" data-url="' + this._sanitize(url) + '">' + this._sanitize(title || url) + '</a>';
        this.visitedPages.push({ url, title: title || url });
      }
    },

    finish(summary, links) {
      if (this.status) this.status.textContent = 'completato';

      // Show summary section
      if (this.summaryEl && this.visitedPages.length > 0) {
        this.summaryEl.style.display = 'block';
        if (this.linksEl) {
          this.linksEl.innerHTML = this.visitedPages.map(p =>
            '<a href="#" data-url="' + this._sanitize(p.url) + '">' + this._sanitize(p.title) + '</a>'
          ).join('');
        }
      }

      // Auto-hide after 3 seconds if user doesn't interact
      setTimeout(() => {
        if (this.isActive && this.overlay) {
          // Don't auto-hide, just pulse the close button
          const btn = document.getElementById('canvasClose');
          if (btn) btn.style.borderColor = 'var(--primary-cyan)';
        }
      }, 3000);
    },

    _sanitize(str) {
      const d = document.createElement('div');
      d.textContent = str || '';
      return d.innerHTML;
    }
  };

  // Initialize canvas on DOM ready
  canvasActivity.init();

  // Handle canvas link clicks (navigate to page)
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-url]');
    if (link) {
      e.preventDefault();
      const url = link.dataset.url;
      if (url) chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', message: '', action: 'navigate', url });
    }
  });

  // ============================================================
  // FILE ATTACHMENT HANDLER
  // ============================================================
  const attachBtn = document.getElementById('chatAttachBtn');
  const fileInput = document.getElementById('chatFileInput');
  const attachPreview = document.getElementById('attachmentPreview');
  const attachName = document.getElementById('attachmentName');
  const attachRemove = document.getElementById('attachmentRemove');
  let pendingAttachment = null;

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Size limit: 5MB
      if (file.size > 5 * 1024 * 1024) {
        alert('File troppo grande (max 5MB)');
        fileInput.value = '';
        return;
      }

      try {
        let content = '';
        const ext = file.name.split('.').pop().toLowerCase();

        if (['txt', 'csv', 'json', 'html', 'md', 'js', 'css', 'xml'].includes(ext)) {
          content = await file.text();
          if (content.length > 50000) content = content.substring(0, 50000) + '\n\n... (troncato a 50KB)';
        } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
          // For images, convert to base64 description
          content = '[Immagine allegata: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)]';
        } else if (ext === 'pdf') {
          content = '[PDF allegato: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB) — estrazione testo non disponibile nel browser]';
        } else {
          content = '[File allegato: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)]';
        }

        pendingAttachment = {
          name: file.name,
          type: file.type,
          size: file.size,
          ext,
          content
        };

        // Show preview
        if (attachPreview && attachName) {
          attachName.textContent = '📎 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)';
          attachPreview.style.display = 'flex';
        }
      } catch (err) {
        console.error('[Attachment] Error reading file:', err);
        alert('Errore nella lettura del file');
      }

      fileInput.value = '';
    });
  }

  if (attachRemove) {
    attachRemove.addEventListener('click', () => {
      pendingAttachment = null;
      if (attachPreview) attachPreview.style.display = 'none';
    });
  }

  // === NAV ===
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // === CHAT ===
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');

  if (chatSend && chatInput) {
    chatSend.addEventListener('click', () => {
      // Inject attachment content if present
      let fullMessage = chatInput.value;
      if (pendingAttachment) {
        fullMessage = '[FILE: ' + pendingAttachment.name + ']\n' + pendingAttachment.content + '\n\n' + fullMessage;
        pendingAttachment = null;
        if (attachPreview) attachPreview.style.display = 'none';
      }
      Chat.send(fullMessage);
      chatInput.value = '';
      chatInput.style.height = 'auto';
    });

    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatSend.click();
      }
    });

    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });
  }

  // Stop button
  const chatStopBtn = document.getElementById('chatStopBtn');
  if (chatStopBtn) {
    chatStopBtn.addEventListener('click', () => Chat.stopProcessing());
  }

  // === VOICE BUTTONS ===
  const micBtn = document.getElementById('micBtn');
  const chatMicBtn = document.getElementById('chatMicBtn');
  if (micBtn) micBtn.addEventListener('click', () => Voice.toggleListening());
  if (chatMicBtn) chatMicBtn.addEventListener('click', () => Voice.toggleListening());
  const stopListeningBtn = document.getElementById('stopListeningBtn');
  if (stopListeningBtn) stopListeningBtn.addEventListener('click', () => Voice.stopListening());

  // === VOICE SETTINGS (ElevenLabs) ===
  // Load voices when settings are opened
  Voice.loadVoices().then(() => Voice.populateVoiceSelect());

  document.getElementById('voiceLangFilter')?.addEventListener('change', (e) => {
    Voice.populateVoiceSelect(e.target.value);
  });

  document.getElementById('voiceSelect')?.addEventListener('change', (e) => {
    state.settings.selectedVoiceId = e.target.value;
    Voice.updateVoiceInfo(e.target.value);
  });

  document.getElementById('voicePreview')?.addEventListener('click', () => {
    const voiceId = document.getElementById('voiceSelect')?.value;
    if (voiceId) Voice.previewVoice(voiceId);
  });

  document.getElementById('voiceRefresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('voiceRefresh');
    if (btn) btn.textContent = '⏳ Caricamento...';
    await Voice.loadVoices(true);
    Voice.populateVoiceSelect(document.getElementById('voiceLangFilter')?.value);
    if (btn) btn.textContent = '🔄 Aggiorna voci';
  });

  document.getElementById('voiceSpeed')?.addEventListener('input', (e) => {
    const label = document.getElementById('voiceSpeedLabel');
    if (label) label.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
  });

  document.getElementById('voiceModel')?.addEventListener('change', (e) => {
    state.settings.voiceModel = e.target.value;
  });

  // === SPEAKER TOGGLE (header button) ===
  const speakerBtn = document.getElementById('speakerBtn');
  if (speakerBtn) {
    // Init icon based on current state
    speakerBtn.textContent = state.settings.voice ? '🔊' : '🔇';
    speakerBtn.addEventListener('click', () => {
      state.settings.voice = !state.settings.voice;
      speakerBtn.textContent = state.settings.voice ? '🔊' : '🔇';
      // Sync the toggle in settings view
      const toggle = document.getElementById('toggleVoice');
      if (toggle) toggle.classList.toggle('active', state.settings.voice);
      Storage.saveSettings();
      // Stop any playing audio when turning off
      if (!state.settings.voice && Voice._currentAudio) {
        Voice._currentAudio.pause();
        Voice._currentAudio = null;
      }
      console.log('[Voice] Voice mode:', state.settings.voice ? 'ON' : 'OFF');
    });
  }

  // === SETTINGS TOGGLES (.toggle-switch in HTML) ===
  document.querySelectorAll('.toggle-switch').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      const id = toggle.id;
      if (!id) return; // Null check
      if (id === 'toggleStealth') state.settings.stealth = toggle.classList.contains('active');
      if (id === 'toggleLocalMemory') state.settings.localMemory = toggle.classList.contains('active');
      if (id === 'toggleCloudSync') state.settings.cloudSync = toggle.classList.contains('active');
      if (id === 'toggleLearning') state.settings.learning = toggle.classList.contains('active');
      if (id === 'toggleKB') state.settings.kb = toggle.classList.contains('active');
      if (id === 'toggleNotifications') state.settings.notifications = toggle.classList.contains('active');
      if (id === 'toggleOrchestration') state.settings.orchestration = toggle.classList.contains('active');
      if (id === 'toggleVoice') state.settings.voice = toggle.classList.contains('active');
      // toggleClaude is no longer used - removed
      Storage.saveSettings();
    });
  });

  // === CHAT TOOLS (.quick-tool-btn in HTML) ===
  document.querySelectorAll('.quick-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      const commands = {
        cattura: 'Scrapa questa pagina e mostrami i dati principali',
        schermata: 'Fai uno screenshot della pagina attuale',
        estrai: 'Estrai tutti i dati strutturati dalla pagina',
        file: 'Salva il contenuto come file scaricabile',
        excel: 'Crea un file Excel con i dati estratti dalla pagina',
        pdf: 'Genera un PDF con il contenuto della pagina'
      };
      if (chatInput) {
        chatInput.value = commands[tool] || '';
        chatInput.focus();
      }
    });
  });

  // === ACTION MENU ===
  const actionMenuToggle = document.getElementById('actionMenuToggle');
  const actionMenu = document.getElementById('actionMenu');
  if (actionMenuToggle && actionMenu) {
    actionMenuToggle.addEventListener('click', () => {
      actionMenu.classList.toggle('active');
      actionMenuToggle.classList.toggle('active');
    });
  }

  document.querySelectorAll('.action-card').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      const chatInput = document.getElementById('chatInput');
      // Close menu after selection
      const menu = document.getElementById('actionMenu');
      if (menu) menu.classList.remove('active');

      const actionCommands = {
        'scrape': 'Cattura tutti i dati dalla pagina corrente',
        'screenshot': 'Fai uno screenshot della pagina',
        'analyze': 'Analizza i dati della pagina corrente e dimmi cosa trovi di interessante',
        'document': 'Crea un documento con i dati che abbiamo raccolto',
        'kb-search': '',  // switch to KB view
        'monitor': 'Imposta un monitoraggio prezzi per questa pagina',
        'agent': '',  // switch to agent view
        'settings': ''  // switch to settings view
      };

      if (action === 'kb-search') { switchView('kb'); return; }  // maps to archivio + kb sub-tab
      if (action === 'agent') { switchView('ai'); return; }
      if (action === 'settings') { switchView('settings'); return; }

      const cmd = actionCommands[action];
      if (cmd && chatInput) {
        chatInput.value = cmd;
        Chat.send(cmd);
        chatInput.value = '';
      }
    });
  });

  // === SCRAPE ===
  const scrapeBtn = document.getElementById('scrapeBtn');
  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', async () => {
      const status = document.getElementById('scrapeStatus');
      const output = document.getElementById('scrapeOutput');
      if (!status || !output) return;
      status.className = 'status';
      status.textContent = 'Scraping in corso...';
      Habits.trackAction('scrape');

      try {
        const customUrl = document.getElementById('scrapeUrl')?.value?.trim();
        const response = await chrome.runtime.sendMessage({
          type: 'SCRAPE_PAGE',
          payload: { url: customUrl || null }
        });
        if (response && response.content) {
          document.getElementById('scrapePreview').textContent = response.content.slice(0, 2000);
          output.classList.remove('hidden');
          status.className = 'status success';
          status.textContent = `Completato! ${response.content.length} caratteri estratti.`;
          if (state.settings.localMemory) {
            Memory.save(
              `Scrape: ${response.title || 'Pagina'}`,
              response.content.slice(0, 1000), 'scrape',
              [response.url ? new URL(response.url).hostname : 'unknown']
            );
          }
        }
      } catch (e) {
        status.className = 'status error';
        status.textContent = `Errore: ${e.message}`;
      }
    });
  }

  document.getElementById('scrapeCopy')?.addEventListener('click', () => {
    const preview = document.getElementById('scrapePreview');
    if (preview) navigator.clipboard.writeText(preview.textContent);
    Habits.trackAction('copy');
  });

  document.getElementById('scrapeDownload')?.addEventListener('click', () => {
    const preview = document.getElementById('scrapePreview');
    if (!preview) return;
    const text = preview.textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cobra_scrape.txt'; a.click();
    URL.revokeObjectURL(url);
    Habits.trackAction('download');
  });

  document.getElementById('scrapeSaveMemory')?.addEventListener('click', () => {
    const preview = document.getElementById('scrapePreview');
    if (preview) Memory.save('Scrape manuale', preview.textContent, 'scrape');
    const status = document.getElementById('scrapeStatus');
    if (status) status.textContent = 'Salvato in memoria!';
  });

  // === AGENT ===
  const agentStart = document.getElementById('agentStart');
  if (agentStart) {
    agentStart.addEventListener('click', async () => {
      const instruction = document.getElementById('agentInstruction')?.value || '';
      if (!instruction.trim()) return;
      Habits.trackAction('agent');
      const log = document.getElementById('agentLog');
      if (log) {
        log.classList.remove('hidden');
        log.textContent = 'Avvio agent...\n';
      }
      const stop = document.getElementById('agentStop');
      if (stop) stop.disabled = false;

      const templateKey = document.getElementById('agentTemplate')?.value || '';

      chrome.runtime.sendMessage({
        type: 'AGENT_START',
        payload: {
          instruction,
          mode: document.getElementById('agentMode')?.value || 'standard',
          templateKey: templateKey || null,
          habits: state.habits
        }
      });
    });
  }

  // === CODE SECTION ===
  document.querySelectorAll('[data-code-action]').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.codeAction;
      if (action === 'analyze') CodeSection.analyzePage();
      else if (action === 'selectors') CodeSection.findSelectors();
      else if (action === 'generate') {
        if (chatInput) {
          chatInput.value = 'Genera uno script per ';
          switchView('home');
          chatInput.focus();
        }
      } else if (action === 'console') {
        const editor = document.getElementById('codeEditor');
        if (editor) editor.focus();
      } else if (action === 'api-inspector') {
        Chat.addMessage('system', 'API Inspector avviato. Monitoro le chiamate di rete...');
        chrome.runtime.sendMessage({ type: 'INSPECT_API' });
      }
    });
  });

  document.getElementById('codeRun')?.addEventListener('click', () => CodeSection.runCode());
  document.getElementById('codeCopy')?.addEventListener('click', () => {
    const editor = document.getElementById('codeEditor');
    if (editor) navigator.clipboard.writeText(editor.value);
    const status = document.getElementById('codeStatus');
    if (status) {
      status.textContent = 'Copiato!';
      status.className = 'status success';
    }
  });
  document.getElementById('codeSave')?.addEventListener('click', () => {
    const editor = document.getElementById('codeEditor');
    if (!editor) return;
    const code = editor.value;
    if (code.trim()) {
      chrome.runtime.sendMessage({
        type: 'KB_ADD_RULE',
        payload: {
          operationType: 'code',
          ruleType: 'pattern',
          title: `Code snippet ${new Date().toLocaleString('it')}`,
          content: code,
          source: 'user',
          tags: ['code', 'snippet']
        }
      });
      const status = document.getElementById('codeStatus');
      if (status) {
        status.textContent = 'Salvato in KB!';
        status.className = 'status success';
      }
    }
  });

  // === OPERATIVO SECTION ===
  document.querySelectorAll('[data-ops-action]').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.opsAction;
      if (action === 'pipeline') OpsSection.startPipeline();
      else if (action === 'monitor') OpsSection.startMonitor();
      else if (action === 'leads') OpsSection.startLeads();
      else if (action === 'batch') switchView('home');
      else if (action === 'report') {
        if (chatInput) {
          chatInput.value = 'Genera un report con i dati raccolti';
          switchView('home');
          chatInput.focus();
        }
      }
    });
  });

  // === ERNESTO SECTION ===
  document.querySelectorAll('[data-ernesto-action]').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.ernestoAction;
      if (action === 'import') ErnestoSection.importListino();
      else if (action === 'analyze') {
        const input = document.getElementById('ernestoInput');
        if (input) {
          input.value = 'Analizza il listino corrente e identifica anomalie';
          document.getElementById('ernestoAsk')?.click();
        }
      }
      else if (action === 'compare') {
        const input = document.getElementById('ernestoInput');
        if (input) {
          input.value = 'Confronta gli ultimi due listini importati';
          document.getElementById('ernestoAsk')?.click();
        }
      }
      else if (action === 'export') {
        chrome.runtime.sendMessage({ type: 'ERNESTO_EXPORT' });
        Chat.addMessage('ai', 'Esportazione listino in corso...');
      }
      else if (action === 'memory') {
        chrome.runtime.sendMessage({ type: 'ERNESTO_SYNC' });
        Chat.addMessage('ai', 'Sincronizzazione con Supabase...');
      }
    });
  });

  document.getElementById('ernestoAsk')?.addEventListener('click', () => {
    const input = document.getElementById('ernestoInput');
    if (input) {
      ErnestoSection.ask(input.value);
      input.value = '';
    }
  });

  // === ARCHIVIO SEARCH (unified) ===
  const archivioSearch = document.getElementById('archivioSearch');
  if (archivioSearch) {
    archivioSearch.addEventListener('input', async (e) => {
      const q = e.target.value;
      // Search memories
      Memory.render(Memory.search(q));
      // Search KB
      if (q.length > 1) {
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'KB_SEARCH', payload: { query: q }
          });
          if (response?.rules) KBUI.renderRuleList('kbRulesList', response.rules, 'Nessun risultato.');
        } catch {}
      }
    });
  }

  document.getElementById('memorySyncUp')?.addEventListener('click', async () => {
    const status = document.getElementById('memoryStatus');
    if (status) status.textContent = 'Upload in corso...';
    const ok = await Supabase.uploadMemories();
    if (status) {
      status.textContent = ok ? 'Upload completato!' : 'Errore upload.';
      status.className = `status ${ok ? 'success' : 'error'}`;
    }
  });

  document.getElementById('memorySyncDown')?.addEventListener('click', async () => {
    const status = document.getElementById('memoryStatus');
    if (status) status.textContent = 'Download in corso...';
    const data = await Supabase.downloadMemories();
    Memory.render();
    if (status) {
      status.textContent = `Scaricate ${data.length} memorie dal cloud.`;
      status.className = 'status success';
    }
  });

  document.getElementById('memoryClear')?.addEventListener('click', () => {
    if (confirm('Vuoi cancellare TUTTA la memoria locale?')) {
      state.memories = [];
      Storage.saveMemories();
      Memory.render();
    }
  });

  // === KB ===
  document.getElementById('kbExport')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'KB_EXPORT' });
  });

  document.getElementById('kbImport')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const content = ev.target?.result;
          if (content) {
            await chrome.runtime.sendMessage({
              type: 'KB_IMPORT',
              payload: { filename: file.name, data: content }
            });
            Chat.addMessage('ai', `KB file "${file.name}" importato.`);
            KBUI.loadStats();
            KBUI.renderRules();
          }
        } catch (err) {
          Chat.addMessage('ai', `Errore importazione KB: ${err.message}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  document.getElementById('kbSyncCloud')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'KB_SYNC_CLOUD' });
    Chat.addMessage('system', 'Sync KB con Supabase in corso...');
  });

  // === SAVE NEW RULE TO KB ===
  document.getElementById('saveNewRule')?.addEventListener('click', async () => {
    const name = document.getElementById('newRuleName')?.value?.trim();
    const domain = document.getElementById('newRuleDomain')?.value?.trim();
    const ruleType = document.getElementById('newRuleType')?.value || 'rule';
    const content = document.getElementById('newRuleContent')?.value?.trim();
    const tags = document.getElementById('newRuleTags')?.value?.trim();
    if (!name || !content) { Chat.addMessage('system', 'Nome e contenuto sono obbligatori.'); return; }
    await chrome.runtime.sendMessage({
      type: 'KB_ADD_RULE',
      payload: { title: name, domain: domain || 'general', ruleType, content, source: 'user', tags: tags ? tags.split(',').map(t => t.trim()) : [] }
    });
    Chat.addMessage('system', `Regola "${name}" salvata in KB.`);
    // Clear form
    ['newRuleName', 'newRuleDomain', 'newRuleContent', 'newRuleTags'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    KBUI.loadStats();
    KBUI.renderRules();
  });

  // === SAVE NEW PROMPT ===
  document.getElementById('saveNewPrompt')?.addEventListener('click', async () => {
    const title = document.getElementById('newPromptTitle')?.value?.trim();
    const domain = document.getElementById('newPromptDomain')?.value?.trim();
    const content = document.getElementById('newPromptContent')?.value?.trim();
    const tags = document.getElementById('newPromptTags')?.value?.trim();
    if (!title || !content) { Chat.addMessage('system', 'Titolo e contenuto sono obbligatori.'); return; }
    await chrome.runtime.sendMessage({
      type: 'KB_ADD_RULE',
      payload: { title, domain: domain || 'general', ruleType: 'prompt', content, objective: content, source: 'user', tags: tags ? tags.split(',').map(t => t.trim()) : [] }
    });
    Chat.addMessage('system', `Prompt "${title}" salvato.`);
    ['newPromptTitle', 'newPromptDomain', 'newPromptContent', 'newPromptTags'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    KBUI.loadStats();
    KBUI.renderRules();
  });

  // === LOAD TASKS IN ARCHIVE ===
  window.loadTasksList = loadTasksList;
  async function loadTasksList() {
    try {
      const { cobra_tasks = [] } = await chrome.storage.local.get('cobra_tasks');
      const container = document.getElementById('tasksList');
      if (!container) return;
      if (cobra_tasks.length === 0) {
        container.innerHTML = '<div class="msg msg-system">Nessun task salvato. Chiedi a COBRA di creare task multi-step.</div>';
        return;
      }
      container.innerHTML = cobra_tasks.map(t => `
        <div class="kb-rule" style="cursor:pointer;" data-task-id="${sanitizeHTML(t.id || '')}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="kb-title">${sanitizeHTML(t.name || 'Task')}</span>
            <span class="kb-type" style="background:${t.status === 'completed' ? 'rgba(0,255,100,0.2)' : t.status === 'running' ? 'rgba(0,200,255,0.2)' : 'rgba(255,200,0,0.2)'};">${sanitizeHTML(t.status || 'pending')}</span>
          </div>
          <div class="kb-content">${t.steps?.length || 0} step — Step corrente: ${(t.currentStep || 0) + 1}/${t.steps?.length || 0}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:4px;">${t.createdAt ? new Date(t.createdAt).toLocaleString('it') : ''}</div>
          <div style="margin-top:6px;display:flex;gap:4px;">
            <button class="action-btn task-resume" data-task-id="${sanitizeHTML(t.id || '')}" style="font-size:10px;padding:3px 8px;">Riprendi</button>
            <button class="action-btn task-delete" data-task-id="${sanitizeHTML(t.id || '')}" style="font-size:10px;padding:3px 8px;">Elimina</button>
          </div>
        </div>
      `).join('');
      // Resume task
      container.querySelectorAll('.task-resume').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const taskId = btn.dataset.taskId;
          const task = cobra_tasks.find(t => t.id === taskId);
          if (task) {
            switchView('home');
            Chat.send('Riprendi e completa il task: ' + task.name);
          }
        });
      });
      // Delete task
      container.querySelectorAll('.task-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const taskId = btn.dataset.taskId;
          const updated = cobra_tasks.filter(t => t.id !== taskId);
          await chrome.storage.local.set({ cobra_tasks: updated });
          loadTasksList();
        });
      });
    } catch (e) {
      console.error('[Tasks] Load error:', e);
    }
  }

  // === FILES TAB ===
  window.loadFilesList = loadFilesList;
  async function loadFilesList() {
    try {
      const { cobra_files = [] } = await chrome.storage.local.get('cobra_files');
      const container = document.getElementById('filesList');
      const countEl = document.getElementById('filesTotalCount');
      const sizeEl = document.getElementById('filesTotalSize');
      if (!container) return;

      if (countEl) countEl.textContent = cobra_files.length;
      const totalBytes = cobra_files.reduce((sum, f) => sum + (f.size || 0), 0);
      if (sizeEl) sizeEl.textContent = totalBytes > 1024 * 1024 ? (totalBytes / (1024 * 1024)).toFixed(1) + ' MB' : (totalBytes / 1024).toFixed(1) + ' KB';

      if (cobra_files.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text3);font-size:12px;padding:20px;">Nessun file creato. Chiedi a COBRA in chat: "crea un CSV con...", "esporta i dati in JSON", "scrivi un report".</div>';
        return;
      }

      container.innerHTML = cobra_files.sort((a, b) => (b.created || 0) - (a.created || 0)).map(f => {
        const icon = { csv: '📊', json: '📋', html: '🌐', txt: '📝', md: '📄' }[f.ext] || '📎';
        const date = f.created ? new Date(f.created).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const size = f.size > 1024 ? (f.size / 1024).toFixed(1) + ' KB' : (f.size || 0) + ' B';
        return `<div class="kb-rule" style="display:flex;align-items:center;gap:8px;padding:8px 10px;">
          <span style="font-size:18px;">${icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sanitizeHTML(f.filename || 'file')}</div>
            <div style="font-size:10px;color:var(--text3);">${date} · ${size}</div>
          </div>
          <button class="action-btn file-redownload" data-file-id="${sanitizeHTML(f.id || '')}" style="font-size:10px;padding:4px 8px;" title="Scarica di nuovo">⬇️</button>
          <button class="action-btn file-delete" data-file-id="${sanitizeHTML(f.id || '')}" style="font-size:10px;padding:4px 8px;" title="Elimina">🗑️</button>
        </div>`;
      }).join('');

      // Re-download button
      container.querySelectorAll('.file-redownload').forEach(btn => {
        btn.addEventListener('click', async () => {
          const fileId = btn.dataset.fileId;
          const file = cobra_files.find(f => f.id === fileId);
          if (file?.dataUrl) {
            try {
              await chrome.downloads.download({ url: file.dataUrl, filename: file.filename, saveAs: true });
            } catch {
              // dataUrl expired, try recreating from content
              if (file.content) {
                const blob = new Blob([file.content], { type: file.mimeType || 'text/plain' });
                const reader = new FileReader();
                reader.onload = () => chrome.downloads.download({ url: reader.result, filename: file.filename, saveAs: true });
                reader.readAsDataURL(blob);
              }
            }
          } else if (file?.content) {
            const blob = new Blob([file.content], { type: file.mimeType || 'text/plain' });
            const reader = new FileReader();
            reader.onload = () => chrome.downloads.download({ url: reader.result, filename: file.filename, saveAs: true });
            reader.readAsDataURL(blob);
          }
        });
      });

      // Delete button
      container.querySelectorAll('.file-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          const updated = cobra_files.filter(f => f.id !== btn.dataset.fileId);
          await chrome.storage.local.set({ cobra_files: updated });
          loadFilesList();
        });
      });
    } catch (e) {
      console.error('[Files] Load error:', e);
    }
  }

  // Refresh files
  document.getElementById('filesRefresh')?.addEventListener('click', loadFilesList);

  // Clear all files
  document.getElementById('filesClearAll')?.addEventListener('click', async () => {
    await chrome.storage.local.set({ cobra_files: [] });
    loadFilesList();
    const status = document.getElementById('filesStatus');
    if (status) { status.textContent = 'File cancellati.'; status.classList.remove('hidden'); setTimeout(() => status.classList.add('hidden'), 2000); }
  });

  // AI file processing
  document.getElementById('fileAIProcess')?.addEventListener('click', async () => {
    const input = document.getElementById('fileAIInput')?.value?.trim();
    const prompt = document.getElementById('fileAIPrompt')?.value?.trim();
    if (!input) return;
    const fullPrompt = prompt
      ? `${prompt}\n\nDati da elaborare:\n${input}`
      : `Analizza questi dati e crea un file strutturato (CSV, JSON o il formato più adatto):\n${input}`;
    // Send to chat
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.value = fullPrompt;
      document.getElementById('chatSend')?.click();
      // Switch to home view
      document.querySelector('.nav-tab[data-view="home"]')?.click();
    }
  });

  // === CONNECTORS ===
  document.getElementById('saveConnectors')?.addEventListener('click', () => {
    saveSettingsFromUI();
    const status = document.getElementById('connectStatus');
    if (status) {
      status.textContent = 'Tutte le connessioni salvate!';
      status.style.display = 'block';
      // Update status indicators
      ['openai', 'anthropic', 'gemini', 'groq'].forEach(p => {
        const el = document.getElementById(`status${p.charAt(0).toUpperCase() + p.slice(1)}`);
        const key = document.getElementById(`${p}Key`)?.value?.trim();
        if (el) el.textContent = key ? '✓ Attivo' : '-';
      });
      setTimeout(() => { status.style.display = 'none'; }, 3000);
    }
  });

  document.getElementById('testSupabase')?.addEventListener('click', async () => {
    saveSettingsFromUI();
    const status = document.getElementById('connectStatus');
    if (!status) return;
    status.textContent = 'Test connessione...';
    const ok = await Supabase.testConnection();
    status.textContent = ok ? 'Connessione OK!' : 'Connessione fallita.';
    status.className = `status ${ok ? 'success' : 'error'}`;
  });

  // === SETTINGS ===
  document.getElementById('saveSettings')?.addEventListener('click', () => {
    saveSettingsFromUI();
    const status = document.getElementById('settingsStatus');
    if (status) {
      status.textContent = 'Impostazioni salvate!';
      status.className = 'status success';
    }
  });

  document.getElementById('exportData')?.addEventListener('click', () => {
    const data = {
      chatHistory: state.chatHistory,
      memories: state.memories,
      habits: state.habits,
      settings: state.settings,
      agents: state.agents,
      leaderAgentId: state.leaderAgentId,
      exportDate: new Date().toISOString(),
      version: 'COBRA 5.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'cobra_backup.json', saveAs: true });
  });

  document.getElementById('importData')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.chatHistory) { state.chatHistory = data.chatHistory; await Storage.saveChat(); }
          if (data.memories) { state.memories = data.memories; await Storage.saveMemories(); }
          if (data.habits) { state.habits = data.habits; await Storage.saveHabits(); }
          if (data.settings) { Object.assign(state.settings, data.settings); await Storage.saveSettings(); }
          if (data.agents) { state.agents = data.agents; await Storage.save('cobra_agents', data.agents); }
          if (data.leaderAgentId) { state.leaderAgentId = data.leaderAgentId; await Storage.save('cobra_leader', data.leaderAgentId); }
          const status = document.getElementById('settingsStatus');
          if (status) {
            status.textContent = 'Dati importati con successo!';
            status.className = 'status success';
          }
          Memory.render();
          Memory.renderHabits();
          AgentBar.render();
          loadSettingsUI();
        } catch (err) {
          const status = document.getElementById('settingsStatus');
          if (status) {
            status.textContent = 'Errore: file non valido.';
            status.className = 'status error';
          }
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  // === BACKGROUND MESSAGES ===
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // CHAT_RESPONSE — async result from fire-and-forget CHAT_MESSAGE
    if (msg.type === 'CHAT_RESPONSE') {
      if (!state._waitingForResponse) return;
      state._waitingForResponse = false;
      if (Chat._watchdogTimer) { clearTimeout(Chat._watchdogTimer); Chat._watchdogTimer = null; }
      Chat.hideTyping();
      Chat._closeLiveUI();
      Chat.showStopBtn(false);
      if (msg.content) {
        Chat.addMessage('ai', msg.content, msg.actions || []);
        if (msg.saveToMemory) {
          Memory.save(msg.memoryTitle || 'Chat insight', msg.content, 'chat');
        }
        if (state.settings.voice) Voice.speakConversational(msg.content);
      } else {
        Chat.addMessage('ai', 'Nessuna risposta. Riprova.');
      }
      return;
    }

    // STREAMING — token-by-token AI response rendering
    if (msg.type === 'CHAT_STREAM_CHUNK') {
      const container = document.getElementById('chatMessages');
      if (!container) return;

      if (msg.payload?.done) {
        // Stream complete — finalize
        const streamEl = container.querySelector('.cobra-stream-active');
        if (streamEl) {
          streamEl.classList.remove('cobra-stream-active');
          streamEl.classList.add('cobra-stream-done');
        }
        return;
      }

      // Find or create streaming bubble
      let streamBubble = container.querySelector('.cobra-stream-active');
      if (!streamBubble) {
        streamBubble = document.createElement('div');
        streamBubble.className = 'msg msg-ai cobra-stream-active';
        const avatarImg = document.createElement('img');
        avatarImg.className = 'chat-avatar';
        avatarImg.src = 'icons/agents/lei-active.gif';
        avatarImg.alt = 'COBRA';
        avatarImg.draggable = false;
        streamBubble.appendChild(avatarImg);
        const textSpan = document.createElement('span');
        textSpan.className = 'msg-text stream-text';
        streamBubble.appendChild(textSpan);
        container.appendChild(streamBubble);
      }

      const textEl = streamBubble.querySelector('.stream-text');
      if (textEl && msg.payload?.fullText) {
        textEl.textContent = msg.payload.fullText;
      }
      container.scrollTop = container.scrollHeight;
      return;
    }

    // Real-time thinking stream — COBRA's inner monologue
    if (msg.type === 'COBRA_THINKING') {
      const container = document.getElementById('chatMessages');
      if (container && msg.text) {
        // Find or create thinking bubble
        let thinkBubble = container.querySelector('.cobra-thinking-active');
        if (!thinkBubble) {
          thinkBubble = document.createElement('div');
          thinkBubble.className = 'msg msg-ai cobra-thinking-active';
          thinkBubble.innerHTML = '<div class="thinking-stream"></div>';
          container.appendChild(thinkBubble);
        }
        const stream = thinkBubble.querySelector('.thinking-stream');
        if (stream) {
          // Append new thought line
          const line = document.createElement('div');
          line.className = 'thinking-line';
          line.textContent = msg.text;
          stream.appendChild(line);
          // Keep max 8 lines, remove oldest
          while (stream.children.length > 8) stream.removeChild(stream.firstChild);
        }
        container.scrollTop = container.scrollHeight;
      }
      return;
    }
    // Handle tool progress updates from executeToolCall
    if (msg.type === 'TOOL_PROGRESS') {
      const p = msg.payload || msg;
      // Render inline log entry in chat
      const container = document.getElementById('chatMessages');
      if (container) {
        // Find or create the live-log group
        let logGroup = container.querySelector('.cobra-live-log');
        if (!logGroup) {
          logGroup = document.createElement('div');
          logGroup.className = 'cobra-live-log';
          logGroup.innerHTML = '<div class="log-header">⚙️ Esecuzione in corso...</div><div class="log-entries"></div>';
          container.appendChild(logGroup);
        }
        const entries = logGroup.querySelector('.log-entries');
        if (entries) {
          const entry = document.createElement('div');
          entry.className = 'log-entry';
          const toolIcon = { navigate: '🌐', google_search: '🔍', click_element: '👆', fill_form: '📝', execute_js: '⚡', scrape_url: '📄', take_screenshot: '📸', scroll_page: '📜' }[p.tool] || '🔧';
          const statusText = p.summary || p.status || p.tool || '';
          entry.innerHTML = `<span class="log-icon">${toolIcon}</span><span class="log-text">${statusText.length > 120 ? statusText.slice(0, 120) + '...' : statusText}</span><span class="log-time">${new Date().toLocaleTimeString('it', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`;
          entries.appendChild(entry);
          // Keep max 15 entries visible
          while (entries.children.length > 15) entries.removeChild(entries.firstChild);
          container.scrollTop = container.scrollHeight;
        }
      }
      // Also update typing indicator text
      const progressEl = document.getElementById('typingIndicator') || document.querySelector('.typing-indicator');
      if (progressEl) {
        progressEl.textContent = p.summary || p.status || p.tool;
        progressEl.style.display = 'block';
      }
      // Feed canvas overlay
      if (typeof canvasActivity !== 'undefined') {
        canvasActivity.addStep(p);
      }
      return;
    }

    if (msg.type === 'CANVAS_SCREENSHOT') {
      if (typeof canvasActivity !== 'undefined') {
        canvasActivity.addScreenshot(msg.dataUrl, msg.url, msg.title);
      }
      return;
    }

    if (msg.type === 'CANVAS_DONE') {
      if (typeof canvasActivity !== 'undefined') {
        canvasActivity.finish(msg.summary, msg.links);
      }
      return;
    }

    if (msg.type === 'AGENT_LOG') {
      // Render agent log inline in chat
      const container = document.getElementById('chatMessages');
      if (container && msg.text) {
        let logGroup = container.querySelector('.cobra-live-log');
        if (!logGroup) {
          logGroup = document.createElement('div');
          logGroup.className = 'cobra-live-log';
          logGroup.innerHTML = '<div class="log-header">🤖 Agent attivo...</div><div class="log-entries"></div>';
          container.appendChild(logGroup);
        }
        const entries = logGroup.querySelector('.log-entries');
        if (entries) {
          const entry = document.createElement('div');
          entry.className = 'log-entry';
          const text = (msg.text || '').length > 150 ? msg.text.slice(0, 150) + '...' : msg.text;
          entry.innerHTML = `<span class="log-icon">📋</span><span class="log-text">${text}</span><span class="log-time">${new Date().toLocaleTimeString('it', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`;
          entries.appendChild(entry);
          while (entries.children.length > 20) entries.removeChild(entries.firstChild);
          container.scrollTop = container.scrollHeight;
        }
      }
      // Also keep the panel log working
      const log = document.getElementById('agentLog');
      if (log && msg.text) {
        log.textContent += (msg.text || '') + '\n';
        if (log.textContent.length > 10000) {
          log.textContent = log.textContent.slice(-10000);
        }
      }
    }
    if (msg.type === 'AGENT_PROGRESS') {
      const progress = document.getElementById('agentProgress');
      if (progress) progress.style.width = msg.percent + '%';
    }
    if (msg.type === 'AGENT_DONE') {
      const stop = document.getElementById('agentStop');
      if (stop) stop.disabled = true;
      const status = document.getElementById('agentStatus');
      if (status) {
        status.textContent = 'Agent completato!';
        status.className = 'status success';
      }
      if (state.settings.localMemory && msg.result) {
        Memory.save('Agent result', JSON.stringify(msg.result), 'agent');
      }
    }
    if (msg.type === 'GATE_UPDATE') {
      GateUI.render(msg.session);
    }
    if (msg.type === 'SCRAPE_RESULT') {
      Chat.addMessage('ai', `Ho estratto ${msg.chars} caratteri dalla pagina.`, [
        { label: 'Vedi risultato', type: 'scrape' },
        { label: 'Salva in memoria', type: 'memory' }
      ]);
    }
    if (msg.type === 'JOB_UPDATE') {
      if (state.currentView === 'archivio') JobsUI.renderJobs();
    }
    if (msg.type === 'KB_UPDATE') {
      if (state.currentView === 'archivio') { KBUI.loadStats(); KBUI.renderRules(); }
    }
    if (msg.type === 'FILE_CREATED') {
      Chat.addMessage('ai', `File creato: ${msg.filename}`, [
        { label: 'Scarica', type: 'navigate', url: msg.downloadUrl }
      ]);
    }
    if (msg.type === 'ORCHESTRATE_PROGRESS') {
      const indicator = document.getElementById('orchestratorIndicator');
      if (indicator) {
        const textEl = indicator?.querySelector('.orchestrating-text');
        const progressText = msg.text || (msg.phase ? `${msg.phase}${msg.detail ? ': ' + msg.detail : ''}` : msg.detail || 'Orchestrating...');
        if (textEl) textEl.textContent = progressText;
      }
    }

    // Supervisor status messages
    if (msg.type === 'SUPERVISOR_STATUS') {
      if (msg.status === 'stuck' || msg.status === 'warning' || msg.status === 'timeout') {
        // Show warning in typing indicator
        const progressEl = document.getElementById('typingIndicator');
        if (progressEl && msg.message) {
          progressEl.textContent = msg.message;
          progressEl.style.color = '#ff9800';
        }
      }
      if (msg.status === 'timeout') {
        // Supervisor forced abort — reset UI
        state._waitingForResponse = false;
        if (Chat._watchdogTimer) { clearTimeout(Chat._watchdogTimer); Chat._watchdogTimer = null; }
        Chat.hideTyping();
        Chat._closeLiveUI();
        Chat.showStopBtn(false);
      }
    }
    if (msg.type === 'SUPERVISOR_HEARTBEAT') {
      // Keep typing indicator updated with elapsed time
      if (state._waitingForResponse) {
        const progressEl = document.getElementById('typingIndicator');
        if (progressEl && msg.elapsed) {
          const secs = Math.floor(msg.elapsed / 1000);
          const tools = msg.toolsRun || 0;
          progressEl.textContent = tools > 0 ? `${tools} operazioni — ${secs}s` : `Elaborazione... ${secs}s`;
          progressEl.style.color = '';
        }
      }
    }
  });

  // === FILE SYSTEM ACCESS — Multi-folder local file operations ===
  const FileSystem = {
    // All connected folder handles: { name: handle }
    folders: {},

    async connectFolder(hint) {
      try {
        if (!('showDirectoryPicker' in window)) {
          return { error: 'Il browser non supporta l\'accesso ai file locali. Usa Chrome 86+.' };
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const name = handle.name;
        this.folders[name] = handle;
        // Persist in IndexedDB
        try {
          const db = await this._getDB();
          const tx = db.transaction('handles', 'readwrite');
          tx.objectStore('handles').put(handle, name);
        } catch {}
        this._updateUI();
        return { ok: true, folder: name, folders: Object.keys(this.folders) };
      } catch (e) {
        if (e.name === 'AbortError') return { error: 'Selezione cartella annullata dall\'utente.' };
        return { error: e.message };
      }
    },

    async restoreHandles() {
      try {
        const db = await this._getDB();
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const keys = await new Promise(r => { const req = store.getAllKeys(); req.onsuccess = () => r(req.result); req.onerror = () => r([]); });
        for (const key of keys) {
          try {
            const handle = await new Promise(r => { const req = store.get(key); req.onsuccess = () => r(req.result); req.onerror = () => r(null); });
            if (handle) {
              const perm = await handle.queryPermission({ mode: 'readwrite' });
              if (perm === 'granted') {
                this.folders[handle.name] = handle;
              }
            }
          } catch {}
        }
        this._updateUI();
      } catch {}
    },

    _getDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('cobra_fs', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    _updateUI() {
      const btn = document.getElementById('connectFolderBtn');
      const names = Object.keys(this.folders);
      if (btn) {
        if (names.length === 0) btn.textContent = '📂 Connetti Cartella del Computer';
        else btn.textContent = '📂 ' + names.join(', ') + ' — Aggiungi altra';
      }
    },

    _resolveFolder(path) {
      // If path starts with a known folder name, use that folder
      const names = Object.keys(this.folders);
      if (names.length === 0) throw new Error('Nessuna cartella connessa. L\'utente deve cliccare "Connetti Cartella" nel tab Files.');
      for (const name of names) {
        if (path === name || path.startsWith(name + '/')) {
          return { handle: this.folders[name], subPath: path.substring(name.length + 1) || '' };
        }
      }
      // Default: use first connected folder
      return { handle: this.folders[names[0]], subPath: path };
    },

    async _navigateToPath(handle, path) {
      if (!path || path === '/' || path === '.') return handle;
      for (const part of path.split('/').filter(p => p && p !== '.')) {
        handle = await handle.getDirectoryHandle(part);
      }
      return handle;
    },

    async listFiles(args) {
      try {
        const { handle, subPath } = this._resolveFolder(args.path || '');
        const dirHandle = await this._navigateToPath(handle, subPath);
        const files = [];
        const pattern = (args.pattern || '').toLowerCase();
        for await (const [name, h] of dirHandle) {
          if (pattern && !name.toLowerCase().includes(pattern)) continue;
          const entry = { name, type: h.kind };
          if (h.kind === 'file') {
            try { const f = await h.getFile(); entry.size = f.size; entry.modified = f.lastModified; entry.ext = name.split('.').pop(); } catch {}
          }
          files.push(entry);
        }
        files.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
        return { ok: true, folder: handle.name, path: subPath || '/', files: files.slice(0, 100), total: files.length, connectedFolders: Object.keys(this.folders) };
      } catch (e) { return { error: e.message, connectedFolders: Object.keys(this.folders) }; }
    },

    async readFile(args) {
      try {
        const fullPath = args.path || '';
        const { handle, subPath } = this._resolveFolder(fullPath);
        const parts = subPath.split('/').filter(p => p);
        const fileName = parts.pop();
        if (!fileName) return { error: 'Percorso file mancante' };
        const dirHandle = await this._navigateToPath(handle, parts.join('/'));
        const fileHandle = await dirHandle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const ext = fileName.split('.').pop().toLowerCase();
        const textExts = ['txt', 'csv', 'json', 'md', 'html', 'htm', 'xml', 'js', 'css', 'py', 'ts', 'jsx', 'tsx', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log', 'sql', 'sh', 'bat', 'env', 'gitignore', 'conf', 'properties'];
        if (textExts.includes(ext) || file.type.startsWith('text/')) {
          let content = await file.text();
          if (content.length > 50000) content = content.substring(0, 50000) + '\n... [troncato]';
          return { ok: true, name: fileName, folder: handle.name, size: file.size, type: file.type, content };
        }
        return { ok: true, name: fileName, folder: handle.name, size: file.size, type: file.type, binary: true, message: `File binario (${(file.size / 1024).toFixed(1)} KB).` };
      } catch (e) { return { error: e.message }; }
    },

    async saveFile(args) {
      try {
        const fullPath = args.path || '';
        const { handle, subPath } = this._resolveFolder(fullPath);
        const parts = subPath.split('/').filter(p => p);
        const fileName = parts.pop();
        if (!fileName) return { error: 'Nome file mancante' };
        let dirHandle = handle;
        for (const dir of parts) { dirHandle = await dirHandle.getDirectoryHandle(dir, { create: true }); }
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(args.content);
        await writable.close();
        return { ok: true, message: `Salvato: ${handle.name}/${subPath}`, size: args.content.length };
      } catch (e) { return { error: e.message }; }
    },

    async searchFiles(args) {
      try {
        const query = (args.query || '').toLowerCase();
        const searchContent = args.content_search || false;
        const results = [];
        const textExts = ['txt', 'csv', 'json', 'md', 'html', 'xml', 'js', 'css', 'py', 'log', 'sql', 'yaml', 'yml'];

        const searchDir = async (handle, path) => {
          if (results.length >= 50) return;
          for await (const [name, entry] of handle) {
            if (results.length >= 50) return;
            if (entry.kind === 'directory') {
              if (!name.startsWith('.') && name !== 'node_modules' && name !== '__pycache__') {
                await searchDir(entry, path + name + '/');
              }
            } else {
              const fullPath = path + name;
              if (name.toLowerCase().includes(query)) {
                results.push({ path: fullPath, match: 'nome', name });
              } else if (searchContent) {
                const ext = name.split('.').pop().toLowerCase();
                if (textExts.includes(ext)) {
                  try {
                    const file = await entry.getFile();
                    if (file.size < 1000000) {
                      const text = await file.text();
                      if (text.toLowerCase().includes(query)) {
                        const idx = text.toLowerCase().indexOf(query);
                        results.push({ path: fullPath, match: 'contenuto', name, snippet: text.substring(Math.max(0, idx - 40), idx + query.length + 40) });
                      }
                    }
                  } catch {}
                }
              }
            }
          }
        };

        // Search all connected folders
        for (const [folderName, handle] of Object.entries(this.folders)) {
          await searchDir(handle, folderName + '/');
        }
        return { ok: true, results, total: results.length, query, searchedFolders: Object.keys(this.folders) };
      } catch (e) { return { error: e.message }; }
    }
  };

  // Restore folder handles on load
  FileSystem.restoreHandles();

  // FILE_OP message handler — service worker sends these when AI uses file tools
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'FILE_OP') return false;
    const handleOp = async () => {
      // If no folder connected and it's not a connect request, prompt user
      if (msg.op !== 'connect_folder' && Object.keys(FileSystem.folders).length === 0) {
        // Auto-trigger folder picker
        const connectResult = await FileSystem.connectFolder();
        if (!connectResult.ok) return connectResult;
        Chat.addMessage('ai', `Cartella "${connectResult.folder}" connessa.`);
      }
      switch (msg.op) {
        case 'list_local_files': return await FileSystem.listFiles(msg.args || {});
        case 'read_local_file': return await FileSystem.readFile(msg.args || {});
        case 'save_local_file': return await FileSystem.saveFile(msg.args || {});
        case 'search_local_files': return await FileSystem.searchFiles(msg.args || {});
        case 'connect_folder': return await FileSystem.connectFolder(msg.args?.hint);
        default: return { error: 'Operazione sconosciuta: ' + msg.op };
      }
    };
    handleOp().then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  });

  // Connect folder button — can be clicked multiple times to add more folders
  document.getElementById('connectFolderBtn')?.addEventListener('click', async () => {
    const result = await FileSystem.connectFolder();
    if (result.ok) {
      Chat.addMessage('ai', `Cartella "${result.folder}" connessa. Cartelle attive: ${result.folders.join(', ')}`);
      if (typeof loadFilesList === 'function') loadFilesList();
    }
  });

  // === Periodic cloud sync ===
  // Store interval ID for potential cleanup
  let cloudSyncInterval = null;
  if (state.settings.cloudSync) {
    cloudSyncInterval = setInterval(() => {
      Supabase.uploadMemories();
      Supabase.syncHabits();
    }, 300000);
  }

  // Suggestions disabled — COBRA waits for user input, doesn't spam

  // Cleanup intervals on panel close
  window.addEventListener('beforeunload', () => {
    if (typeof cloudSyncInterval !== 'undefined' && cloudSyncInterval) {
      clearInterval(cloudSyncInterval);
    }
  });

  // === Onboarding Check (moved from inline script to comply with CSP) ===
  (async () => {
    try {
      if (typeof OnboardingWizard !== 'undefined' && await OnboardingWizard.shouldShow()) {
        OnboardingWizard.launch(document.getElementById('root') || document.body);
      }
    } catch(e) { console.warn('Onboarding check failed:', e); }
  })();

  // === Reload settings after onboarding completes ===
  window.addEventListener('cobra-onboarding-complete', async () => {
    console.log('[SidePanel] Onboarding completed — reloading settings from storage');
    await Storage.loadAll();
    loadSettingsUI();
    AgentBar.render();
    console.log('[SidePanel] Settings reloaded. Keys:', {
      openai: state.settings.openaiKey ? 'SET' : 'empty',
      anthropic: state.settings.anthropicKey ? 'SET' : 'empty',
      gemini: state.settings.geminiKey ? 'SET' : 'empty',
      groq: state.settings.groqKey ? 'SET' : 'empty'
    });
  });
});
