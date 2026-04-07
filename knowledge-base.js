// COBRA v4.0 — Knowledge Base Engine
// Auto-alimentata: impara da correzioni utente, pattern ricorrenti, regole per dominio
// Ispirato a SwiftPack Studio knowledge_rules + WCA memory system

class KnowledgeBase {
  constructor() {
    this.rules = [];
    this.operativePrompts = [];
    this._loaded = false;
    this._loadingPromise = null;
    this._tagIndex = {};
    this._domainIndex = {};
    // Workspace partitioning indexes
    this._workspaceIndex = {};
    this._milestoneIndex = {};
    this._categoryIndex = {};
  }

  // ============================================================
  // PERSISTENCE
  // ============================================================
  async load() {
    if (this._loaded) return;
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = (async () => {
      try {
        // Try PersistenceManager first, fallback to direct chrome.storage
        if (self.cobraPersistence) {
          const [rules, prompts] = await Promise.all([
            self.cobraPersistence.load('cobra_kb_rules'),
            self.cobraPersistence.load('cobra_operative_prompts')
          ]);
          this.rules = rules || [];
          this.operativePrompts = prompts || [];
        } else {
          const data = await new Promise(resolve => {
            chrome.storage.local.get(['cobra_kb_rules', 'cobra_operative_prompts'], resolve);
          });
          this.rules = data.cobra_kb_rules || [];
          this.operativePrompts = data.cobra_operative_prompts || [];
        }
        // Migration: rules legacy senza workspace_id → set default
        this.rules = this.rules.map(r => {
          if (!r.workspace_id) r.workspace_id = 'generic';
          if (!r.tier) r.tier = 'hot';
          if (r.confirmCount === undefined) r.confirmCount = 0;
          if (!r.category) r.category = 'regola';
          if (!r.entities) r.entities = [];
          if (!r.keywords_extra) r.keywords_extra = [];
          return r;
        });
        this._buildIndices();
        this._loaded = true;
        this._loadingPromise = null;
        return { rules: this.rules.length, prompts: this.operativePrompts.length };
      } catch (e) {
        this._loadingPromise = null;
        console.error('[KB] Load error:', e);
        throw e;
      }
    })();
    return this._loadingPromise;
  }

  async save() {
    if (self.cobraPersistence) {
      await Promise.all([
        self.cobraPersistence.save('cobra_kb_rules', this.rules),
        self.cobraPersistence.save('cobra_operative_prompts', this.operativePrompts)
      ]);
      // Also write to IndexedDB if available (async, non-blocking)
      if (self.cobraIDB && self.cobraIDB._db) {
        self.cobraIDB.bulkPut('kb_rules', this.rules).catch(() => {});
      }
    } else {
      return new Promise(resolve => {
        chrome.storage.local.set({
          cobra_kb_rules: this.rules,
          cobra_operative_prompts: this.operativePrompts,
        }, resolve);
      });
    }
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 500);
  }

  // ============================================================
  // RULES — Regole per dominio/operazione
  // ============================================================
  // rule_type: "instruction" | "correction" | "pattern" | "preference" | "format" | "selector"
  // source: "user" | "ai_suggestion" | "auto_learn" | "correction"

  addRule({
    domain = null,       // "amazon.com", "booking.com", null = globale
    operationType,       // "scrape" | "navigate" | "extract" | "login" | "search"
    ruleType = 'instruction',
    title,
    content,
    source = 'user',
    priority = 5,        // 1-10
    tags = [],
    metadata = {},
    sourceJobId = null,
    workspace_id = 'generic',  // Workspace partition
    tier = 'hot',              // 'milestone' | 'hot' | 'cold'
    confirmCount = 0,
    category = 'regola',       // 'cliente' | 'processo' | 'eccezione' | 'regola' | 'template'
    entities = [],
    keywords_extra = [],
  }) {
    // Validation: reject if title or content is empty/null
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new Error('Rule title cannot be empty');
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new Error('Rule content cannot be empty');
    }

    // Dedup: se esiste regola con stesso domain+title, aggiorna
    const existing = this.rules.findIndex(r =>
      r.domain === domain && r.title === title && r.operationType === operationType
    );

    const rule = {
      id: existing >= 0 ? this.rules[existing].id : crypto.randomUUID(),
      domain,
      operationType,
      ruleType,
      title,
      content,
      source,
      priority,
      tags,
      metadata,
      sourceJobId,
      workspace_id,
      tier,
      confirmCount,
      category,
      entities,
      keywords_extra,
      isActive: true,
      version: existing >= 0 ? (this.rules[existing].version || 0) + 1 : 1,
      previousContent: existing >= 0 ? this.rules[existing].content : null,
      createdAt: existing >= 0 ? this.rules[existing].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      score: existing >= 0 ? this.rules[existing].score : priority,
      usageCount: existing >= 0 ? this.rules[existing].usageCount : 0,
      failureCount: existing >= 0 ? this.rules[existing].failureCount : 0,
      lastUsedAt: existing >= 0 ? this.rules[existing].lastUsedAt : null,
      useCount: existing >= 0 ? (this.rules[existing].useCount || 0) : 0,
    };

    if (existing >= 0) {
      this.rules[existing] = rule;
    } else {
      this.rules.push(rule);
    }

    this._updateIndices(rule);
    this._scheduleSave();
    return rule;
  }

  // Cerca regole per dominio + operazione
  findRules({ domain = null, operationType = null, ruleType = null, tags = [], maxResults = 15 }) {
    const filtered = this.rules
      .filter(r => {
        if (!r.isActive) return false;
        // Match domain: regola specifica O regola globale (domain=null)
        if (domain) {
          if (r.domain !== null && r.domain !== domain) return false;
        }
        if (operationType && r.operationType !== operationType) return false;
        if (ruleType && r.ruleType !== ruleType) return false;
        if (tags.length > 0 && !tags.some(t => (r.tags || []).includes(t))) return false;
        return true;
      })
      .map(r => {
        this._applyDecay(r);
        return r;
      })
      .sort((a, b) => {
        // Priorità dominio specifico > globale
        if (a.domain && !b.domain) return -1;
        if (!a.domain && b.domain) return 1;
        // Poi per score (adaptive ranking)
        if (a.score !== b.score) return b.score - a.score;
        // Fallback a priority
        return b.priority - a.priority;
      });

    return filtered.slice(0, maxResults);
  }

  // Cerca regole per testo libero
  searchRules(query) {
    if (!query) return this.rules.filter(r => r.isActive);
    const q = query.toLowerCase();
    return this.rules.filter(r =>
      r.isActive && (
        (r.title || '').toLowerCase().includes(q) ||
        (r.content || '').toLowerCase().includes(q) ||
        (r.domain || '').toLowerCase().includes(q) ||
        (r.tags || []).some(t => t.toLowerCase().includes(q))
      )
    );
  }

  // Cerca regole per dominio (usa indice O(1))
  searchByDomain(domain) {
    if (!domain) return [];
    const ids = this._domainIndex[domain] || [];
    return ids
      .map(id => this.rules.find(r => r.id === id))
      .filter(r => r && r.isActive)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // Disattiva regola (soft delete con versioning)
  deactivateRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.isActive = false;
      rule.updatedAt = new Date().toISOString();
      this._removeFromIndices(rule);
      this._scheduleSave();
    }
  }

  // ============================================================
  // RULE SCORING & DECAY (Active KB)
  // ============================================================

  boostRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.score = Math.min(10, (rule.score || rule.priority) + 1);
      rule.usageCount = (rule.usageCount || 0) + 1;
      rule.lastUsedAt = new Date().toISOString();
      this._scheduleSave();
    }
  }

  penalizeRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.score = Math.max(0, (rule.score || rule.priority) - 0.5);
      rule.failureCount = (rule.failureCount || 0) + 1;
      rule.lastUsedAt = new Date().toISOString();
      this._scheduleSave();
    }
  }

  _applyDecay(rule) {
    if (!rule.lastUsedAt || rule.score === 0) return;
    const now = new Date();
    const lastUsed = new Date(rule.lastUsedAt);
    const daysSinceUse = (now - lastUsed) / (1000 * 60 * 60 * 24);
    if (daysSinceUse > 0) {
      rule.score = Math.max(0, rule.score - (0.1 * Math.floor(daysSinceUse)));
    }
  }

  detectConflicts(domain) {
    const domainRules = this.rules.filter(r => r.isActive && (r.domain === domain || r.domain === null));
    const conflicts = [];
    const fieldMap = {};

    domainRules.forEach(rule => {
      if (rule.ruleType === 'selector') {
        try {
          const parsed = JSON.parse(rule.content);
          const key = `${rule.operationType}_${rule.purpose || 'default'}`;
          if (fieldMap[key] && fieldMap[key].content !== rule.content) {
            conflicts.push({ ruleId1: fieldMap[key].id, ruleId2: rule.id, field: key });
          }
          fieldMap[key] = { id: rule.id, content: rule.content };
        } catch {}
      }
    });

    return conflicts;
  }

  // ============================================================
  // INDEXING (Fast lookups)
  // ============================================================

  _buildIndices() {
    this._tagIndex = {};
    this._domainIndex = {};
    this._workspaceIndex = {};
    this._milestoneIndex = {};
    this._categoryIndex = {};
    this.rules.forEach(r => {
      if (r.isActive) {
        // Tag index
        (r.tags || []).forEach(tag => {
          if (!this._tagIndex[tag]) this._tagIndex[tag] = [];
          if (!this._tagIndex[tag].includes(r.id)) this._tagIndex[tag].push(r.id);
        });
        // Domain index
        if (r.domain) {
          if (!this._domainIndex[r.domain]) this._domainIndex[r.domain] = [];
          if (!this._domainIndex[r.domain].includes(r.id)) this._domainIndex[r.domain].push(r.id);
        }
        // Workspace index
        const ws = r.workspace_id || 'generic';
        if (!this._workspaceIndex[ws]) this._workspaceIndex[ws] = [];
        if (!this._workspaceIndex[ws].includes(r.id)) this._workspaceIndex[ws].push(r.id);
        // Milestone index
        if (r.tier === 'milestone') {
          if (!this._milestoneIndex[ws]) this._milestoneIndex[ws] = [];
          if (!this._milestoneIndex[ws].includes(r.id)) this._milestoneIndex[ws].push(r.id);
        }
        // Category index
        const cat = r.category || 'regola';
        if (!this._categoryIndex[cat]) this._categoryIndex[cat] = [];
        if (!this._categoryIndex[cat].includes(r.id)) this._categoryIndex[cat].push(r.id);
      }
    });
  }

  _updateIndices(rule) {
    if (rule.isActive) {
      (rule.tags || []).forEach(tag => {
        if (!this._tagIndex[tag]) this._tagIndex[tag] = [];
        if (!this._tagIndex[tag].includes(rule.id)) this._tagIndex[tag].push(rule.id);
      });
      if (rule.domain) {
        if (!this._domainIndex[rule.domain]) this._domainIndex[rule.domain] = [];
        if (!this._domainIndex[rule.domain].includes(rule.id)) this._domainIndex[rule.domain].push(rule.id);
      }
      // Workspace index
      const ws = rule.workspace_id || 'generic';
      if (!this._workspaceIndex[ws]) this._workspaceIndex[ws] = [];
      if (!this._workspaceIndex[ws].includes(rule.id)) this._workspaceIndex[ws].push(rule.id);
      // Milestone index
      if (rule.tier === 'milestone') {
        if (!this._milestoneIndex[ws]) this._milestoneIndex[ws] = [];
        if (!this._milestoneIndex[ws].includes(rule.id)) this._milestoneIndex[ws].push(rule.id);
      }
      // Category index
      const cat = rule.category || 'regola';
      if (!this._categoryIndex[cat]) this._categoryIndex[cat] = [];
      if (!this._categoryIndex[cat].includes(rule.id)) this._categoryIndex[cat].push(rule.id);
    }
  }

  _removeFromIndices(rule) {
    (rule.tags || []).forEach(tag => {
      if (this._tagIndex[tag]) {
        this._tagIndex[tag] = this._tagIndex[tag].filter(id => id !== rule.id);
      }
    });
    if (rule.domain && this._domainIndex[rule.domain]) {
      this._domainIndex[rule.domain] = this._domainIndex[rule.domain].filter(id => id !== rule.id);
    }
    // Workspace index
    const ws = rule.workspace_id || 'generic';
    if (this._workspaceIndex[ws]) {
      this._workspaceIndex[ws] = this._workspaceIndex[ws].filter(id => id !== rule.id);
    }
    // Milestone index
    if (this._milestoneIndex[ws]) {
      this._milestoneIndex[ws] = this._milestoneIndex[ws].filter(id => id !== rule.id);
    }
    // Category index
    const cat = rule.category || 'regola';
    if (this._categoryIndex[cat]) {
      this._categoryIndex[cat] = this._categoryIndex[cat].filter(id => id !== rule.id);
    }
  }

  // Statistiche KB
  getStats() {
    const active = this.rules.filter(r => r.isActive);
    const domains = new Set(active.map(r => r.domain).filter(Boolean));
    const types = {};
    active.forEach(r => { types[r.ruleType] = (types[r.ruleType] || 0) + 1; });
    return {
      totalRules: this.rules.length,
      activeRules: active.length,
      domains: domains.size,
      domainList: [...domains],
      byType: types,
      bySource: active.reduce((acc, r) => { acc[r.source] = (acc[r.source] || 0) + 1; return acc; }, {}),
      operativePrompts: this.operativePrompts.length,
    };
  }

  // ============================================================
  // AUTO-LEARN — Impara da correzioni utente
  // ============================================================

  // Quando utente corregge un risultato scrape, salva la correzione come regola
  learnFromCorrection({ domain, field, wrongValue, correctValue, context }) {
    return this.addRule({
      domain,
      operationType: 'scrape',
      ruleType: 'correction',
      title: `Correzione ${field} su ${domain}`,
      content: `Quando scrapi ${domain}, il campo "${field}" potrebbe contenere "${wrongValue}". ` +
               `Il valore corretto è "${correctValue}". ${context || ''}`,
      source: 'auto_learn',
      priority: 7,
      tags: ['auto_correction', field, domain].filter(Boolean),
    });
  }

  // Impara selettore CSS corretto per un sito
  learnSelector({ domain, purpose, selector, fallbackSelector }) {
    return this.addRule({
      domain,
      operationType: 'extract',
      ruleType: 'selector',
      title: `Selettore: ${purpose} su ${domain}`,
      content: JSON.stringify({ primary: selector, fallback: fallbackSelector }),
      source: 'auto_learn',
      priority: 8,
      tags: ['selector', purpose, domain].filter(Boolean),
    });
  }

  // Impara formato/struttura di un sito
  learnSiteFormat({ domain, structure }) {
    this.addRule({
      domain,
      operationType: 'scrape',
      ruleType: 'format',
      title: `Formato sito: ${domain}`,
      content: JSON.stringify(structure),
      source: 'auto_learn',
      priority: 6,
      tags: ['format', 'structure', domain].filter(Boolean),
    });
  }

  // Impara preferenza utente
  learnPreference({ key, value, context }) {
    this.addRule({
      domain: null, // globale
      operationType: 'preference',
      ruleType: 'preference',
      title: `Preferenza: ${key}`,
      content: JSON.stringify({ key, value, context }),
      source: 'auto_learn',
      priority: 5,
      tags: ['preference', key],
    });
  }

  // ============================================================
  // WORKSPACE PARTITION & AUTO-TAGGING
  // ============================================================

  detectWorkspace(message) {
    const msg = (message || '').toLowerCase();
    const keywords = {
      fatturazione: ['fattura', 'fatturazione', 'iva', 'scadenza', 'pagamento', 'fatturato', 'invoice'],
      credito: ['credito', 'insoluto', 'sollecito', 'moroso', 'debito', 'recovery', 'collection'],
      pricing: ['prezzo', 'listino', 'sconto', 'margine', 'pricing', 'tariff', 'preventivo'],
      commerciale: ['lead', 'offerta', 'cliente nuovo', 'trattativa', 'prospetto', 'commercial'],
    };

    // Track best match
    let bestWs = 'generic';
    let bestScore = 0;

    for (const [wsId, kwords] of Object.entries(keywords)) {
      const matches = kwords.filter(k => {
        // Use word boundary matching for single words
        if (k.includes(' ')) {
          return msg.includes(k);
        } else {
          return msg.match(new RegExp(`\\b${k}\\b`));
        }
      }).length;
      if (matches > bestScore) {
        bestScore = matches;
        bestWs = wsId;
      }
    }

    const confidence = bestScore > 0 ? Math.min(100, bestScore * 25) : 0;
    return { workspaceId: bestWs, confidence };
  }

  getWorkspaceContext(workspaceId) {
    const wsId = workspaceId || 'generic';
    const ruleIds = this._workspaceIndex[wsId] || [];
    const milestoneIds = this._milestoneIndex[wsId] || [];

    const rules = ruleIds.map(id => this.rules.find(r => r.id === id)).filter(Boolean);
    const milestones = milestoneIds.map(id => this.rules.find(r => r.id === id)).filter(Boolean);
    const hotRules = rules.filter(r => r.tier === 'hot' && r.isActive).slice(0, 5);
    const prompts = this.findOperativePrompt({ tags: [wsId] });

    return {
      workspace: wsId,
      guide: {
        milestones: milestones.map(r => ({ id: r.id, title: r.title, content: r.content })),
        hotRules: hotRules.map(r => ({ id: r.id, title: r.title, content: r.content })),
      },
      operativePrompts: prompts.slice(0, 3),
      totalRules: rules.length,
    };
  }

  async addRuleWithAutoTag(rule, brainInstance) {
    // Se brainInstance disponibile, chiama AI per extract tag
    let autoTag = { category: 'regola', entities: [], keywords_extra: [] };

    if (brainInstance && typeof brainInstance.extractTags === 'function') {
      try {
        autoTag = await brainInstance.extractTags(rule.content);
      } catch (e) {
        console.warn('[KB] Auto-tag AI failed, using fallback:', e.message);
        autoTag = this._heuristicTag(rule.content);
      }
    } else {
      autoTag = this._heuristicTag(rule.content);
    }

    // Merge auto-tags nel rule
    const enrichedRule = {
      ...rule,
      category: rule.category || autoTag.category,
      entities: rule.entities || autoTag.entities,
      keywords_extra: rule.keywords_extra || autoTag.keywords_extra,
      workspace_id: rule.workspace_id || 'generic',
      tier: rule.tier || 'hot',
      confirmCount: rule.confirmCount || 0,
    };

    return this.addRule(enrichedRule);
  }

  _heuristicTag(content) {
    const c = (content || '').toLowerCase();
    let category = 'regola';
    const entities = [];
    const keywords_extra = [];

    if (c.includes('cliente') || c.includes('customer')) category = 'cliente';
    else if (c.includes('processo') || c.includes('process')) category = 'processo';
    else if (c.includes('eccezione') || c.includes('exception')) category = 'eccezione';
    else if (c.includes('template')) category = 'template';

    const entityMatch = c.match(/cliente[:\s]+(\w+)/gi);
    if (entityMatch) entities.push(...entityMatch.map(e => e.split(/[:\s]+/)[1]));

    const words = c.split(/\s+/).slice(0, 20);
    keywords_extra.push(...words.filter(w => w.length > 4).slice(0, 5));

    return { category, entities, keywords_extra };
  }

  confirmRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return;

    rule.confirmCount = (rule.confirmCount || 0) + 1;
    rule.lastUsedAt = new Date().toISOString();

    // Promozione: confirmCount >= 2 e tier='hot' → 'milestone'
    if (rule.confirmCount >= 2 && rule.tier === 'hot') {
      rule.tier = 'milestone';
      // Rebuild milestone index
      const ws = rule.workspace_id || 'generic';
      if (!this._milestoneIndex[ws]) this._milestoneIndex[ws] = [];
      if (!this._milestoneIndex[ws].includes(rule.id)) {
        this._milestoneIndex[ws].push(rule.id);
      }
    }

    this._scheduleSave();
  }

  markRuleUsed(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.useCount = (rule.useCount || 0) + 1;
      rule.lastUsedAt = new Date().toISOString();
      this._scheduleSave();
    }
  }

  decayColdRules() {
    const now = Date.now();
    const threshold = 90 * 24 * 60 * 60 * 1000; // 90 giorni
    let decayed = 0;

    this.rules.forEach(r => {
      if (!r.isActive || r.tier !== 'hot') return;
      if (!r.lastUsedAt) return;

      const daysSinceUse = (now - new Date(r.lastUsedAt).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceUse > 90) {
        r.tier = 'cold';
        decayed++;
      }
    });

    if (decayed > 0) {
      this._buildIndices();
      this._scheduleSave();
    }
    return decayed;
  }

  searchByTags(tags, workspaceId) {
    if (!tags || tags.length === 0) return [];
    const wsId = workspaceId;
    let wsRuleIds = [];

    // If workspace specified, filter to that workspace
    if (wsId) {
      wsRuleIds = this._workspaceIndex[wsId] || [];
    }

    const results = [];
    tags.forEach(tag => {
      const tagRuleIds = this._tagIndex[tag] || [];
      tagRuleIds.forEach(id => {
        // If workspace specified, only include rules from that workspace
        if (wsId && !wsRuleIds.includes(id)) return;

        if (!results.some(r => r.id === id)) {
          const rule = this.rules.find(r => r.id === id);
          if (rule && rule.isActive) results.push(rule);
        }
      });
    });

    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // ============================================================
  // OPERATIVE PROMPTS — Procedure salvate
  // ============================================================

  saveOperativePrompt({
    title,
    domain = null,
    objective,
    procedure = [],    // Array di step testuali
    criteria = [],     // Array di criteri di uscita
    tags = [],
    sourceJobId = null,
  }) {
    const existing = this.operativePrompts.findIndex(p =>
      p.title === title && p.domain === domain
    );

    const prompt = {
      id: existing >= 0 ? this.operativePrompts[existing].id : crypto.randomUUID(),
      title,
      domain,
      objective,
      procedure,
      criteria,
      tags,
      sourceJobId,
      isActive: true,
      version: existing >= 0 ? (this.operativePrompts[existing].version || 0) + 1 : 1,
      createdAt: existing >= 0 ? this.operativePrompts[existing].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: existing >= 0 ? (this.operativePrompts[existing].usageCount || 0) : 0,
    };

    if (existing >= 0) {
      this.operativePrompts[existing] = prompt;
    } else {
      this.operativePrompts.push(prompt);
    }

    this._scheduleSave();
    return prompt;
  }

  findOperativePrompt({ domain = null, tags = [] }) {
    return this.operativePrompts
      .filter(p => {
        if (!p.isActive) return false;
        if (domain && p.domain && p.domain !== domain) return false;
        if (tags.length > 0 && !tags.some(t => (p.tags || []).includes(t))) return false;
        return true;
      })
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  incrementPromptUsage(promptId) {
    const p = this.operativePrompts.find(x => x.id === promptId);
    if (p) {
      p.usageCount = (p.usageCount || 0) + 1;
      p.lastUsedAt = new Date().toISOString();
      this._scheduleSave();
    }
  }

  // ============================================================
  // CONTEXT BUILDER — Costruisci contesto per AI
  // ============================================================

  // Genera blocco di contesto KB per il system prompt dell'AI
  buildContextForAI({ domain, operationType, maxRules = 10 }) {
    const rules = this.findRules({ domain, operationType }).slice(0, maxRules);
    const prompts = this.findOperativePrompt({ domain }).slice(0, 3);

    if (!rules.length && !prompts.length) return '';

    let context = '\n\n--- COBRA KNOWLEDGE BASE ---\n';

    if (rules.length) {
      context += `\nRegole attive per ${domain || 'globale'} (${operationType || 'tutte'}):\n`;
      rules.forEach((r, i) => {
        context += `[${i + 1}] ${r.title} (${r.ruleType}, score:${(r.score || r.priority).toFixed(1)}, used:${r.usageCount || 0}x)\n`;
        context += `    ${r.content}\n`;
      });
    }

    if (prompts.length) {
      context += `\nProcedure operative:\n`;
      prompts.forEach(p => {
        context += `- ${p.title}: ${p.objective}\n`;
        if (p.procedure.length) {
          context += `  Steps: ${p.procedure.join(' → ')}\n`;
        }
      });
    }

    context += '--- FINE KB ---\n';
    return context;
  }

  // ============================================================
  // ACTIVE KB — Automatic Ranking, Garbage Collection, Conflict Resolution
  // ============================================================

  // Compute dynamic score based on usage, failures, recency, and base priority
  computeDynamicScore(rule) {
    const base = rule.priority || 5;
    const usage = Math.min(rule.usageCount || 0, 50) * 0.1; // max +5 from usage
    const failures = (rule.failureCount || 0) * 0.3; // penalty per failure
    const successRate = (rule.usageCount > 0)
      ? ((rule.usageCount - (rule.failureCount || 0)) / rule.usageCount) * 2
      : 0; // max +2 from success rate

    // Recency bonus: used in last 7 days = +1, last 30 = +0.5
    let recency = 0;
    if (rule.lastUsedAt) {
      const daysAgo = (Date.now() - new Date(rule.lastUsedAt).getTime()) / 86400000;
      if (daysAgo < 7) recency = 1;
      else if (daysAgo < 30) recency = 0.5;
    }

    return Math.max(0, Math.min(10, base + usage - failures + successRate + recency));
  }

  // Recalculate all rule scores based on dynamic scoring
  recalculateAllScores() {
    let updated = 0;
    this.rules.forEach(r => {
      if (!r.isActive) return;
      const newScore = this.computeDynamicScore(r);
      if (Math.abs(newScore - (r.score || 0)) > 0.1) {
        r.score = Math.round(newScore * 100) / 100;
        updated++;
      }
    });
    if (updated > 0) this._scheduleSave();
    return updated;
  }

  // Garbage collect dead rules: inactive for 90+ days with score < 1
  garbageCollect() {
    const now = Date.now();
    const threshold = 90 * 86400000; // 90 days
    const before = this.rules.length;

    this.rules = this.rules.filter(r => {
      // Keep active rules
      if (r.isActive) return true;
      // Keep recently deactivated
      const updatedAt = new Date(r.updatedAt || r.createdAt).getTime();
      if (now - updatedAt < threshold) return true;
      // Remove old inactive
      return false;
    });

    // Also auto-deactivate rules with very low score and no recent usage
    this.rules.forEach(r => {
      if (!r.isActive) return;
      if ((r.score || 0) < 0.5 && (r.usageCount || 0) > 5 && (r.failureCount || 0) > (r.usageCount || 0) * 0.7) {
        r.isActive = false;
        r.notes = (r.notes || '') + ' [Auto-deactivated: low score + high failure rate]';
        this._removeFromIndices(r);
      }
    });

    const removed = before - this.rules.length;
    if (removed > 0) {
      this._buildIndices();
      this._scheduleSave();
    }
    return { removed, autoDeactivated: this.rules.filter(r => !r.isActive && (r.notes || '').includes('Auto-deactivated')).length };
  }

  // Auto-resolve conflicts: keep highest-scoring rule, deactivate others
  autoResolveConflicts(domain) {
    const conflicts = this.detectConflicts(domain);
    const resolved = [];

    conflicts.forEach(({ ruleId1, ruleId2, field }) => {
      const r1 = this.rules.find(r => r.id === ruleId1);
      const r2 = this.rules.find(r => r.id === ruleId2);
      if (!r1 || !r2) return;

      const score1 = this.computeDynamicScore(r1);
      const score2 = this.computeDynamicScore(r2);

      const loser = score1 >= score2 ? r2 : r1;
      const winner = score1 >= score2 ? r1 : r2;

      loser.isActive = false;
      loser.notes = (loser.notes || '') + ` [Conflict resolved: superseded by ${winner.id} on ${field}]`;
      this._removeFromIndices(loser);

      resolved.push({ field, winner: winner.id, loser: loser.id });
    });

    if (resolved.length > 0) this._scheduleSave();
    return resolved;
  }

  // Get health report for KB
  getHealthReport() {
    const active = this.rules.filter(r => r.isActive);
    const lowScore = active.filter(r => (r.score || 0) < 2);
    const neverUsed = active.filter(r => !(r.usageCount > 0));
    const highFailure = active.filter(r => (r.failureCount || 0) > 3 && (r.failureCount || 0) > (r.usageCount || 0) * 0.5);
    const stale = active.filter(r => {
      if (!r.lastUsedAt) return false;
      return (Date.now() - new Date(r.lastUsedAt).getTime()) > 60 * 86400000; // 60 days
    });

    return {
      totalActive: active.length,
      healthy: active.length - lowScore.length - highFailure.length,
      lowScore: lowScore.map(r => ({ id: r.id, title: r.title, score: r.score })),
      neverUsed: neverUsed.length,
      highFailure: highFailure.map(r => ({ id: r.id, title: r.title, failRate: r.failureCount / (r.usageCount || 1) })),
      stale: stale.length,
      conflicts: this.detectConflicts(null).length,
    };
  }

  // ============================================================
  // EXPORT / IMPORT
  // ============================================================
  exportAll() {
    return {
      rules: this.rules,
      operativePrompts: this.operativePrompts,
      exportDate: new Date().toISOString(),
      version: '4.0',
    };
  }

  async importAll(data) {
    if (data.rules) this.rules = data.rules;
    if (data.operativePrompts) this.operativePrompts = data.operativePrompts;
    await this.save();
  }
}

// ============================================================
// SUPABASE KB SYNC
// ============================================================
class KBCloudSync {
  constructor(kb) {
    this.kb = kb;
  }

  async uploadToSupabase(supabaseUrl, supabaseKey) {
    if (!supabaseUrl || !supabaseKey) return false;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    };

    for (const rule of this.kb.rules) {
      if (rule._synced) continue;
      try {
        await fetch(`${supabaseUrl}/rest/v1/ernesto_memory_items`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: `[KB] ${rule.title}`,
            content: JSON.stringify(rule),
            type: 'kb_rule',
            tags: rule.tags || [],
            approved: true,
          }),
        });
        rule._synced = true;
      } catch {}
    }

    this.kb.save();
    return true;
  }

  async downloadFromSupabase(supabaseUrl, supabaseKey) {
    if (!supabaseUrl || !supabaseKey) return [];
    const headers = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    };

    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/ernesto_memory_items?type=eq.kb_rule&select=title,content&order=updated_at.desc&limit=100`,
        { headers }
      );
      if (!res.ok) return [];
      const data = await res.json();

      for (const item of data) {
        try {
          const rule = JSON.parse(item.content);
          const exists = this.kb.rules.find(r => r.id === rule.id);
          if (!exists) {
            rule._synced = true;
            this.kb.rules.push(rule);
          }
        } catch {}
      }

      this.kb.save();
      return data;
    } catch {
      return [];
    }
  }
}

if (typeof self !== 'undefined') {
  self.KnowledgeBase = KnowledgeBase;
  self.KBCloudSync = KBCloudSync;
}
