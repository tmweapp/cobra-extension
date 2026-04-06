// COBRA v3 — Brain Module
// Agente Claude integrato con knowledge base Supabase
// Gestisce: decisioni, prompt, token budget, apprendimento
// API keys cifrate con AES-GCM via CryptoUtils

const Brain = {

  // ============================================================
  // CONFIG
  // ============================================================
  config: {
    // Claude API (chiavi cifrate in storage, qui solo in memoria decifrate)
    claudeApiKey: '',
    claudeModel: 'claude-sonnet-4-20250514',
    claudeMaxTokens: 1024,

    // Supabase (knowledge base)
    supabaseUrl: '',
    supabaseKey: '',

    // Token budget
    dailyTokenBudget: 50000,
    tokensUsedToday: 0,
    tokenResetDate: null,

    // System prompt
    systemPrompt: `Sei l'agente AI di COBRA, un sistema di intelligence logistica.

RUOLO:
- Analizzi pagine web scrappate e ne estrai informazioni commerciali utili
- Decidi quali azioni fare nel browser (click, navigate, type, scroll)
- Costruisci e aggiorni una knowledge base di aziende, contatti e segnali logistici
- Risparmi token: prima cerchi nella knowledge base locale, poi chiedi solo se necessario

REGOLE:
1. Prima di ogni analisi AI, controlla se esiste già nella libreria (tag + dominio)
2. Se trovi dati recenti (<30 giorni) → usali senza consumare token
3. Ogni output deve avere: tags, categoria, confidence score
4. Rispondi SEMPRE in JSON strutturato
5. Se ricevi uno snapshot di pagina, indica le prossime azioni da fare
6. Non ripetere analisi già fatte sullo stesso dominio

OUTPUT FORMAT:
{
  "analysis": { ... },
  "tags": ["tag1", "tag2"],
  "category": "company|contact|freight|news|trigger",
  "confidence": 0-100,
  "next_actions": [{ "action": "...", "selector": "...", "reason": "..." }],
  "save_to_library": true/false,
  "token_saved": true/false
}`,
  },

  // Init promise for race condition prevention (FIX 1)
  _initPromise: null,

  // ============================================================
  // 1. INIT — Carica config da storage (con decifratura)
  // ============================================================
  async init() {
    // Prevent concurrent init() calls (FIX 1)
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    return this._initPromise;
  },

  async _doInit() {
    // Ensure CryptoUtils is loaded before using
    if (typeof CryptoUtils === 'undefined') {
      console.warn('[Brain] CryptoUtils not available yet, skipping decryption');
      return;
    }

    const brainCfg = self.cobraPersistence
      ? await self.cobraPersistence.load('brain_config')
      : (await chrome.storage.local.get('brain_config')).brain_config;
    if (brainCfg) {
      const cfg = brainCfg;
      // Decifra le chiavi sensibili (with defensive checks)
      if (cfg._encApiKey && typeof CryptoUtils.decrypt === 'function') {
        try {
          cfg.claudeApiKey = await CryptoUtils.decrypt(cfg._encApiKey) || '';
          delete cfg._encApiKey;
        } catch (e) {
          console.error('[Brain] Failed to decrypt Claude API key:', e.message);
        }
      }
      if (cfg._encSupaKey && typeof CryptoUtils.decrypt === 'function') {
        try {
          cfg.supabaseKey = await CryptoUtils.decrypt(cfg._encSupaKey) || '';
          delete cfg._encSupaKey;
        } catch (e) {
          console.error('[Brain] Failed to decrypt Supabase key:', e.message);
        }
      }
      Object.assign(this.config, cfg);
    }
    // Reset token counter giornaliero
    const today = new Date().toDateString();
    if (this.config.tokenResetDate !== today) {
      this.config.tokensUsedToday = 0;
      this.config.tokenResetDate = today;
      await this.saveConfig();
    }

    // Init Hydra Memory client (cervello condiviso)
    if (typeof HydraClient !== 'undefined' && HydraClient.init) {
      try {
        await HydraClient.init();
      } catch (e) {
        console.warn('[Brain] HydraClient initialization failed:', e.message);
      }
    }
  },

  async saveConfig() {
    // Salva con chiavi cifrate — mai in chiaro
    const toSave = { ...this.config };
    if (toSave.claudeApiKey) {
      toSave._encApiKey = await CryptoUtils.encrypt(toSave.claudeApiKey);
      delete toSave.claudeApiKey;
    }
    if (toSave.supabaseKey) {
      toSave._encSupaKey = await CryptoUtils.encrypt(toSave.supabaseKey);
      delete toSave.supabaseKey;
    }
    if (self.cobraPersistence) {
      await self.cobraPersistence.save('brain_config', toSave);
    } else {
      await chrome.storage.local.set({ brain_config: toSave });
    }
  },

  async updateConfig(partial) {
    // FIX 2: Don't overwrite existing config with empty strings
    const merged = { ...this.config };
    for (const key in partial) {
      const value = partial[key];
      // Skip empty string values for sensitive keys — don't clear stored keys
      if (key === 'claudeApiKey' || key === 'supabaseKey') {
        if (value === '') {
          // Empty string: keep existing value, don't overwrite
          continue;
        }
      }
      merged[key] = value;
    }
    Object.assign(this.config, merged);
    await this.saveConfig();
  },

  // ============================================================
  // 2. THINK — Chiedi a Claude (con budget check + knowledge check)
  // ============================================================
  async think(userPrompt, context = {}) {
    if (!this.config.claudeApiKey) {
      throw new Error('API key Claude non configurata. Vai su Brain → Impostazioni.');
    }

    // Budget check
    if (this.config.tokensUsedToday >= this.config.dailyTokenBudget) {
      throw new Error(`Budget token giornaliero esaurito (${this.config.dailyTokenBudget}). Riprova domani.`);
    }

    // Knowledge check — cerca prima nella libreria locale
    let domain = null;
    if (context.domain) {
      domain = context.domain;
    } else if (context.url) {
      try { domain = new URL(context.url).hostname; } catch {}
    }

    // Check Library for cached results (defensive: ensure Library is loaded)
    if (domain && context.type && typeof Library !== 'undefined' && Library.search) {
      try {
        const existing = await Library.search({ domain, category: context.type });
        if (existing.length > 0) {
          const recent = existing.find(e => (Date.now() - e.created_at) < 30 * 24 * 60 * 60 * 1000);
          if (recent) {
            return {
              ...recent.data,
              _fromLibrary: true,
              _tokenSaved: true,
              _libraryId: recent.id,
            };
          }
        }
      } catch (e) {
        console.warn('[Brain] Library search failed:', e.message);
      }
    }

    // Arricchisci prompt con memoria Hydra (cervello condiviso)
    let enrichedPrompt = userPrompt;
    if (typeof HydraClient !== 'undefined' && HydraClient.isConfigured()) {
      try {
        enrichedPrompt = await HydraClient.enrichPrompt(userPrompt, {
          carrier: context.carrier,
          domain,
        });
      } catch (e) {
        console.warn('[Brain] Hydra context enrichment failed:', e.message);
      }
    }

    // Costruisci messaggi
    const messages = [{ role: 'user', content: this._buildPrompt(enrichedPrompt, context) }];

    // Calcola max tokens in base al budget rimasto
    const budgetLeft = this.config.dailyTokenBudget - this.config.tokensUsedToday;
    const maxTokens = Math.min(this.config.claudeMaxTokens, budgetLeft);

    // Chiama Claude
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.claudeApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.config.claudeModel,
        max_tokens: maxTokens,
        system: this.config.systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude API error: ${response.status}`);
    }

    const data = await response.json();

    // Track token usage
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    this.config.tokensUsedToday += tokensUsed;
    await this.saveConfig();

    // Parse risposta
    const text = data.content?.[0]?.text || '';
    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
    } catch {
      parsed = { raw: text };
    }

    // Auto-save in libreria locale (defensive: ensure Library is loaded)
    if (parsed.save_to_library && domain && typeof Library !== 'undefined' && Library.add) {
      try {
        await Library.add({
          domain,
          url: context.url,
          category: parsed.category || 'analysis',
          tags: parsed.tags || [],
          data: parsed,
          confidence: parsed.confidence || 50,
        });
      } catch (e) {
        console.warn('[Brain] Library save failed:', e.message);
      }

      // Sync con Supabase (legacy)
      if (this.config.supabaseUrl && this.syncToSupabase) {
        try {
          await this.syncToSupabase(domain, parsed);
        } catch (e) {
          console.warn('[Brain] Supabase sync failed:', e.message);
        }
      }

      // Salva anche in Hydra Memory (cervello condiviso)
      if (typeof HydraClient !== 'undefined' && HydraClient.learnFromAnalysis) {
        HydraClient.learnFromAnalysis(domain, parsed).catch(e =>
          console.warn('[Brain] Hydra learn failed:', e.message)
        );
      }
    }

    return {
      ...parsed,
      _tokensUsed: tokensUsed,
      _totalTokensToday: this.config.tokensUsedToday,
      _budgetRemaining: this.config.dailyTokenBudget - this.config.tokensUsedToday,
    };
  },

  // ============================================================
  // 3. ANALYZE PAGE
  // ============================================================
  async analyzePage(scrapeData, snapshotData) {
    const context = {
      url: scrapeData?.metadata?.url || snapshotData?.url,
      domain: null,
      type: 'company',
    };
    try { context.domain = new URL(context.url).hostname; } catch {}

    const prompt = `Analizza questa pagina web per intelligence logistica.

CONTENUTO PAGINA (Markdown):
${(scrapeData?.markdown || '').slice(0, 3000)}

ELEMENTI INTERATTIVI:
- Bottoni: ${JSON.stringify(snapshotData?.buttons?.slice(0, 10) || [])}
- Input: ${JSON.stringify(snapshotData?.inputs?.slice(0, 10) || [])}
- Link principali: ${JSON.stringify(snapshotData?.links?.slice(0, 15) || [])}

DOMANDE:
1. Che tipo di azienda è? (spedizioniere, cliente, altro)
2. Ci sono segnali logistici? (shipping, export, import, warehouse, lanes)
3. Quali paesi sono collegati?
4. C'è un form di contatto o login da compilare?
5. Quali sono le prossime azioni consigliate nel browser?

Rispondi in JSON con il formato specificato nel system prompt.`;

    return await this.think(prompt, context);
  },

  // ============================================================
  // 4. DECIDE NEXT
  // ============================================================
  async decideNext(currentState) {
    const prompt = `Basandoti sullo stato corrente, decidi la prossima azione.

STATO:
- URL: ${currentState.url}
- Titolo: ${currentState.title}
- Elementi visibili: ${currentState.buttonsCount} bottoni, ${currentState.inputsCount} input, ${currentState.linksCount} link
- Obiettivo: ${currentState.goal || 'raccogliere informazioni logistiche'}

Rispondi con un JSON contenente "next_actions": un array di azioni Agent da eseguire.
Ogni azione: { "action": "click|type|scroll|navigate|wait|read", "selector": "...", "text": "...", "reason": "..." }`;

    return await this.think(prompt, { url: currentState.url, type: 'decision' });
  },

  // ============================================================
  // 5. SUPABASE SYNC
  // ============================================================
  async syncToSupabase(domain, data) {
    if (!this.config.supabaseUrl || !this.config.supabaseKey) return;

    try {
      // Validazione URL Supabase
      const url = new URL(this.config.supabaseUrl);
      if (!url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.in')) {
        console.warn('[Brain] URL Supabase non valido');
        return;
      }

      await fetch(`${this.config.supabaseUrl}/rest/v1/knowledge_base`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.supabaseKey,
          'Authorization': `Bearer ${this.config.supabaseKey}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          domain,
          category: data.category || 'analysis',
          tags: data.tags || [],
          data: data,
          confidence: data.confidence || 50,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.warn('[Brain] Supabase sync error:', e.message);
    }
  },

  async searchSupabase(query) {
    if (!this.config.supabaseUrl || !this.config.supabaseKey) return [];

    try {
      const params = new URLSearchParams();
      if (query.domain) params.set('domain', `eq.${query.domain}`);
      if (query.category) params.set('category', `eq.${query.category}`);
      if (query.tag) params.set('tags', `cs.{${query.tag}}`);
      params.set('order', 'updated_at.desc');
      params.set('limit', '20');

      const resp = await fetch(`${this.config.supabaseUrl}/rest/v1/knowledge_base?${params}`, {
        headers: {
          'apikey': this.config.supabaseKey,
          'Authorization': `Bearer ${this.config.supabaseKey}`,
        },
      });
      return await resp.json();
    } catch {
      return [];
    }
  },

  // ============================================================
  // 6. BUILD PROMPT (ottimizzato)
  // ============================================================
  _buildPrompt(userPrompt, context) {
    const parts = [userPrompt];
    if (context.url) parts.push(`\nURL: ${context.url}`);
    if (context.domain) parts.push(`Dominio: ${context.domain}`);
    return parts.join('\n');
  },

  // ============================================================
  // 7. STATS
  // ============================================================
  async getStats() {
    let libraryStats = null;
    // Defensive: ensure Library is loaded and available
    if (typeof Library !== 'undefined' && Library.getStats) {
      try {
        libraryStats = await Library.getStats();
      } catch (e) {
        console.warn('[Brain] Library stats failed:', e.message);
        libraryStats = { entries: 0, searches: 0 };
      }
    }

    return {
      tokensUsedToday: this.config.tokensUsedToday,
      dailyBudget: this.config.dailyTokenBudget,
      budgetRemaining: this.config.dailyTokenBudget - this.config.tokensUsedToday,
      budgetPercent: Math.round(((this.config.dailyTokenBudget - this.config.tokensUsedToday) / this.config.dailyTokenBudget) * 100),
      model: this.config.claudeModel,
      supabaseConnected: !!(this.config.supabaseUrl && this.config.supabaseKey),
      claudeConfigured: !!this.config.claudeApiKey,
      library: libraryStats || { entries: 0, searches: 0 },
    };
  },
};

// ============================================================
// LIBRARY — IndexedDB-backed per performance
// ============================================================
const Library = {

  _dbName: 'COBRALibrary',
  _dbVersion: 2,  // FIX 7: Bump version to trigger onupgradeneeded for new tags index
  _storeName: 'entries',
  _db: null,

  // Apri/crea database
  async _getDb() {
    // FIX 3: Check if connection is still open before returning cached db
    if (this._db) {
      try {
        // Test connection by attempting a readonly transaction
        const tx = this._db.transaction(this._storeName, 'readonly');
        tx.abort();
        return this._db;
      } catch (e) {
        // Connection is closed, reset and reconnect
        this._db = null;
      }
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, this._dbVersion);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          const store = db.createObjectStore(this._storeName, { keyPath: 'id' });
          store.createIndex('domain', 'domain', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
          // Indice composto per ricerche domain+category
          store.createIndex('domain_category', ['domain', 'category'], { unique: false });
          // FIX 5: Add tags multiEntry index for efficient tag queries
          store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        } else {
          // FIX 7: Check if tags index exists before creating (for version upgrades)
          const store = event.target.transaction.objectStore(this._storeName);
          if (!store.indexNames.contains('tags')) {
            store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          }
        }
      };
      request.onsuccess = () => {
        this._db = request.result;
        // FIX 3: Listen for db.onclose event to handle unexpected closes
        this._db.onclose = () => {
          this._db = null;
        };
        resolve(this._db);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Aggiungi entry
  async add(entry) {
    const db = await this._getDb();
    const id = 'fs_lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const record = {
      id,
      domain: entry.domain || '',
      url: entry.url || '',
      category: entry.category || 'unknown',
      tags: entry.tags || [],
      data: entry.data,
      confidence: entry.confidence || 50,
      created_at: Date.now(),
      accessed: 0,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },

  // Cerca nella libreria (usa indici IndexedDB)
  async search(query = {}) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const store = tx.objectStore(this._storeName);
      let results = [];
      let request;

      // Usa indice composto se possibile
      if (query.domain && query.category) {
        request = store.index('domain_category').getAll([query.domain, query.category]);
      } else if (query.domain) {
        request = store.index('domain').getAll(query.domain);
      } else if (query.category) {
        request = store.index('category').getAll(query.category);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        results = request.result || [];

        // Filtra per tag
        if (query.tag) {
          results = results.filter(r => (r.tags || []).includes(query.tag));
        }

        // Filtra per testo libero
        // FIX 6: Add size guard to prevent O(n) JSON.stringify on large datasets
        if (query.text) {
          const lower = query.text.toLowerCase();
          const maxScanned = 10000;  // Scan max 10000 entries
          results = results.slice(0, maxScanned).filter(r => {
            const json = JSON.stringify(r.data || {}).toLowerCase();
            return json.includes(lower);
          });
        }

        // Ordina per data decrescente
        results.sort((a, b) => b.created_at - a.created_at);

        // Limite
        if (query.limit) results = results.slice(0, query.limit);

        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Per dominio
  async getByDomain(domain) {
    return this.search({ domain });
  },

  // Tutti i tag unici
  async getAllTags() {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const request = tx.objectStore(this._storeName).getAll();
      request.onsuccess = () => {
        const tagSet = new Set();
        (request.result || []).forEach(r => (r.tags || []).forEach(t => tagSet.add(t)));
        resolve([...tagSet].sort());
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Categorie con conteggi
  async getCategories() {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const request = tx.objectStore(this._storeName).getAll();
      request.onsuccess = () => {
        const cats = {};
        (request.result || []).forEach(r => {
          const c = r.category || 'unknown';
          cats[c] = (cats[c] || 0) + 1;
        });
        resolve(cats);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Statistiche
  async getStats() {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const request = tx.objectStore(this._storeName).getAll();
      request.onsuccess = () => {
        const all = request.result || [];
        const domains = new Set();
        const tags = new Set();
        const categories = {};
        all.forEach(r => {
          if (r.domain) domains.add(r.domain);
          (r.tags || []).forEach(t => tags.add(t));
          const c = r.category || 'unknown';
          categories[c] = (categories[c] || 0) + 1;
        });
        resolve({ total: all.length, domains: domains.size, tags: tags.size, categories });
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Elimina
  async remove(id) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Svuota
  async clear() {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const req = tx.objectStore(this._storeName).clear();
      req.onsuccess = () => resolve({ cleared: true });
      req.onerror = () => reject(req.error);
    });
  },

  // Export
  async exportAll() {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const request = tx.objectStore(this._storeName).getAll();
      request.onsuccess = () => {
        const entries = {};
        (request.result || []).forEach(r => { entries[r.id] = r; });
        resolve(entries);
      };
      request.onerror = () => reject(request.error);
    });
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.Brain = Brain;
  globalThis.Library = Library;
}
