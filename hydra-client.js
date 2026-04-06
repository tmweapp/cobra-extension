// ══════════════════════════════════════════════════════════════
// COBRA → Hydra Memory Client
// Collega COBRA al cervello centrale Hydra via REST API
// ══════════════════════════════════════════════════════════════

const HydraClient = {

  config: {
    apiUrl: '',      // e.g. https://xxx.supabase.co/functions/v1/hydra-api
    apiKey: '',      // Hydra API key (hk_...)
  },

  // ── Init: load config from chrome.storage ──
  async init() {
    const stored = await chrome.storage.local.get('hydra_config');
    if (stored.hydra_config) {
      Object.assign(this.config, stored.hydra_config);
    }
  },

  async saveConfig(partial) {
    Object.assign(this.config, partial);
    await chrome.storage.local.set({ hydra_config: this.config });
  },

  isConfigured() {
    return !!(this.config.apiUrl && this.config.apiKey);
  },

  // ── Core API call ──
  async _call(action, data = {}) {
    if (!this.isConfigured()) {
      console.warn('[Hydra] Non configurato. Vai su Impostazioni → Hydra.');
      return null;
    }

    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hydra-key': this.config.apiKey,
        },
        body: JSON.stringify({ action, ...data }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Hydra API error: ${response.status}`);
      }

      return await response.json();
    } catch (e) {
      console.error('[Hydra]', action, 'failed:', e.message);
      return null;
    }
  },

  // ══════════════════════════════════════════════════════════════
  // MEMORY API
  // ══════════════════════════════════════════════════════════════

  // Salva un item nella memoria Hydra
  async memorySave({ type, title, content, tags, carrier, confidence, source }) {
    return this._call('memory.save', {
      type: type || 'pattern',
      title,
      content,
      tags: tags || [],
      carrier,
      confidence: confidence || 50,
      source: source || 'firescrape',
    });
  },

  // Cerca nella memoria
  async memorySearch(query, { carrier, level, limit } = {}) {
    return this._call('memory.search', { query, carrier, level, limit });
  },

  // Promuovi un item (L1→L2→L3)
  async memoryPromote(itemId, reason) {
    return this._call('memory.promote', { item_id: itemId, reason });
  },

  // Feedback su un item
  async memoryFeedback(itemId, type, context) {
    return this._call('memory.feedback', {
      item_id: itemId,
      feedback_type: type,  // 'positive' | 'negative'
      context,
    });
  },

  // ══════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE API
  // ══════════════════════════════════════════════════════════════

  // Salva una regola KB
  async kbSave({ title, content, carrier_code, rule_type, tags, priority }) {
    return this._call('kb.save', {
      title,
      content,
      carrier_code,
      rule_type: rule_type || 'instruction',
      tags: tags || [],
      priority: priority || 5,
      source: 'firescrape',
    });
  },

  // Cerca regole KB
  async kbSearch(query, carrier) {
    return this._call('kb.search', { query, carrier });
  },

  // ══════════════════════════════════════════════════════════════
  // CONTEXT API (per arricchire il prompt di Brain)
  // ══════════════════════════════════════════════════════════════

  // Ottieni contesto RAG (memoria + regole) per un carrier/query
  async getContext(query, carrier, maxItems) {
    return this._call('context.get', {
      query,
      carrier,
      max_items: maxItems || 20,
    });
  },

  // ══════════════════════════════════════════════════════════════
  // CONVENIENCE: Integrazione con Brain.think()
  // ══════════════════════════════════════════════════════════════

  // Prima di chiamare Claude, arricchisci il prompt con la memoria Hydra
  async enrichPrompt(userPrompt, { carrier, domain } = {}) {
    const context = await this.getContext(
      domain || carrier || userPrompt.slice(0, 100),
      carrier
    );

    if (!context) return userPrompt;

    let enriched = userPrompt;

    if (context.memory_context) {
      enriched += `\n\n--- MEMORIA HYDRA (${context.memory_count} items) ---\n${context.memory_context}`;
    }

    if (context.rules_context) {
      enriched += `\n\n--- REGOLE KB (${context.rules_count} rules) ---\n${context.rules_context}`;
    }

    return enriched;
  },

  // Dopo che Brain riceve una risposta, salva i risultati in Hydra
  async learnFromAnalysis(domain, analysis) {
    if (!analysis || !domain) return;

    // Salva pattern appreso
    if (analysis.analysis) {
      await this.memorySave({
        type: 'pattern',
        title: `Analisi: ${domain}`,
        content: JSON.stringify(analysis.analysis).slice(0, 2000),
        tags: [...(analysis.tags || []), domain],
        confidence: analysis.confidence || 50,
        source: 'firescrape_analysis',
      });
    }

    // Salva regola se l'AI ha identificato un pattern ricorrente
    if (analysis.save_to_library && analysis.category === 'freight') {
      await this.kbSave({
        title: `Pattern scraping: ${domain}`,
        content: JSON.stringify(analysis),
        carrier_code: analysis.carrier || null,
        rule_type: 'pattern',
        tags: analysis.tags || [],
      });
    }
  },

  // ══════════════════════════════════════════════════════════════
  // HEALTH
  // ══════════════════════════════════════════════════════════════

  async health() {
    return this._call('health');
  },
};

// Export globale per Chrome extension
if (typeof globalThis !== 'undefined') {
  globalThis.HydraClient = HydraClient;
}
