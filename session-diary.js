/**
 * COBRA v5.2 — Session Diary Engine
 * Registers sessions with AI-generated briefings, logs events, and consolidates findings
 * Persistence via IndexedDB store 'cobra_sessions'
 *
 * @example
 * const diary = new SessionDiary(workspaceId, kb, brain);
 * const {sessionId, briefing} = await diary.start(workspaceId);
 * diary.appendEvent(sessionId, {type: 'action', payload: {...}});
 * const consolidation = await diary.consolidate(sessionId);
 */

class SessionDiary {
  constructor(workspaceId, kb, brain) {
    this.workspaceId = workspaceId || 'generic';
    this.kb = kb; // KnowledgeBase instance
    this.brain = brain; // Brain instance
    this._db = null;
    this._initialized = false;
    this._DB_NAME = 'cobra_diary';
    this._STORE = 'cobra_sessions';
    this._VERSION = 1;
  }

  // ══════════════════════════════════════════════════════
  // INIT — apri/crea IndexedDB
  // ══════════════════════════════════════════════════════
  async init() {
    if (this._initialized) return;
    try {
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(this._DB_NAME, this._VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this._STORE)) {
            const store = db.createObjectStore(this._STORE, { keyPath: 'id', autoIncrement: true });
            store.createIndex('workspaceId', 'workspaceId', { unique: false });
            store.createIndex('startedAt', 'startedAt', { unique: false });
            store.createIndex('status', 'status', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      this._initialized = true;
      console.log('[SessionDiary] Initialized — IndexedDB ready');
    } catch (e) {
      console.error('[SessionDiary] Init failed:', e);
      throw e;
    }
  }

  // ══════════════════════════════════════════════════════
  // START — crea record sessione + genera briefing
  // ══════════════════════════════════════════════════════
  async start(workspaceId) {
    if (!this._initialized) await this.init();
    if (!this.kb) throw new Error('KnowledgeBase not available');
    if (!this.brain) throw new Error('Brain not available');

    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Carica il context del workspace dalla KB
    const workspaceContext = this.kb.getWorkspaceContext?.(workspaceId) || {
      guide: 'No guide available',
      milestones: [],
      recentActions: []
    };

    // Genera briefing dall'AI
    const briefing = await this._generateBriefing(workspaceContext);

    // Crea record sessione
    const sessionRecord = {
      id: sessionId,
      workspaceId,
      startedAt: now,
      status: 'active', // active | completed | cancelled
      briefing,
      events: [],
      createdAt: now,
      updatedAt: now
    };

    // Salva su IndexedDB
    await this._write(sessionRecord);

    return {
      sessionId,
      briefing
    };
  }

  // ══════════════════════════════════════════════════════
  // _GENERATE_BRIEFING — chiama AI per briefing markdown
  // ══════════════════════════════════════════════════════
  async _generateBriefing(workspaceContext) {
    try {
      if (!self.Brain || !self.Brain.askClaude) {
        return '## Briefing Operativo\n(IA non disponibile)';
      }

      const prompt = `Componi un briefing operativo per questa sessione di lavoro.
Usa: guida workspace, milestone attive, ultime azioni rilevanti.
Output: markdown strutturato MAX 800 token con sezioni:
- Contesto (cosa stiamo facendo)
- Regole Attive (quali regole sono in gioco)
- Esempi Recenti (cosa è stato fatto ultimamente)
- Attenzioni (cosa prestare attenzione)

WORKSPACE CONTEXT:
${JSON.stringify(workspaceContext, null, 2)}

Rispondi SOLO in markdown, niente altro.`;

      const response = await self.Brain.askClaude(prompt, { tokens: 800 });
      return response || '## Briefing Operativo\n(Generazione fallita)';
    } catch (e) {
      console.error('[SessionDiary] _generateBriefing error:', e);
      return '## Briefing Operativo\n(Errore nella generazione)';
    }
  }

  // ══════════════════════════════════════════════════════
  // APPEND_EVENT — registra evento nella sessione
  // ══════════════════════════════════════════════════════
  async appendEvent(sessionId, event) {
    if (!this._initialized) await this.init();

    const session = await this._read(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const eventRecord = {
      timestamp: new Date().toISOString(),
      type: event.type || 'unknown', // action, error, decision, consolidation
      payload: event.payload || {},
      source: event.source || 'manual'
    };

    session.events.push(eventRecord);
    session.updatedAt = new Date().toISOString();

    await this._update(sessionId, session);
    return eventRecord;
  }

  // ══════════════════════════════════════════════════════
  // CONSOLIDATE — AI genera riassunto + candidati regole
  // ══════════════════════════════════════════════════════
  async consolidate(sessionId) {
    if (!this._initialized) await this.init();
    if (!self.Brain || !self.Brain.askClaude) {
      throw new Error('Brain.askClaude not available');
    }

    const session = await this._read(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Prepara dati per consolidamento
    const eventsText = session.events
      .map(e => `[${e.timestamp}] ${e.type}: ${JSON.stringify(e.payload)}`)
      .join('\n');

    const prompt = `Consolida questa sessione di lavoro. Hai registrato questi eventi:
${eventsText}

Analizza e fornisci (in JSON):
1. "summary": 5-10 punti chiave della sessione
2. "new_rules": candidati per nuove regole [{title, content, domain, operationType}]
3. "milestones": candidati per nuovi milestone [{title, description}]
4. "guide_updates": suggerimenti per aggiornare la guida workspace

Rispondi SOLO in JSON valido.`;

    const response = await self.Brain.askClaude(prompt, { tokens: 1200 });

    let consolidation = {
      summary: [],
      new_rules: [],
      milestones: [],
      guide_updates: []
    };

    try {
      consolidation = JSON.parse(response);
    } catch (e) {
      console.warn('[SessionDiary] Failed to parse consolidation JSON:', e);
      consolidation.summary = ['Consolidamento completato con errore JSON'];
    }

    // Applica i candidati
    if (consolidation.new_rules && consolidation.new_rules.length > 0) {
      await this._promoteCandidates(consolidation);
    }

    // Marca sessione come completata
    session.status = 'completed';
    session.consolidation = consolidation;
    session.consolidatedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    await this._update(sessionId, session);

    return consolidation;
  }

  // ══════════════════════════════════════════════════════
  // _PROMOTE_CANDIDATES — aggiungi regole candidate alla KB
  // ══════════════════════════════════════════════════════
  async _promoteCandidates(consolidation) {
    if (!this.kb || !consolidation.new_rules) return;

    for (const ruleCandidate of consolidation.new_rules) {
      try {
        // Usa addRuleWithAutoTag se disponibile
        if (this.kb.addRuleWithAutoTag) {
          await this.kb.addRuleWithAutoTag({
            domain: ruleCandidate.domain || null,
            operationType: ruleCandidate.operationType || 'general',
            ruleType: 'instruction',
            title: ruleCandidate.title,
            content: ruleCandidate.content,
            source: 'session_consolidation',
            priority: 5,
            metadata: { session_derived: true }
          });
        } else if (this.kb.addRule) {
          this.kb.addRule({
            domain: ruleCandidate.domain || null,
            operationType: ruleCandidate.operationType || 'general',
            ruleType: 'instruction',
            title: ruleCandidate.title,
            content: ruleCandidate.content,
            source: 'session_consolidation',
            priority: 5
          });
        }
      } catch (e) {
        console.error('[SessionDiary] Failed to add rule candidate:', e);
      }
    }

    // Salva KB
    if (this.kb.save) {
      await this.kb.save().catch(() => {});
    }
  }

  // ══════════════════════════════════════════════════════
  // QUERY METHODS
  // ══════════════════════════════════════════════════════
  async getActiveSession() {
    if (!this._initialized) await this.init();
    const sessions = await this._query({ status: 'active' });
    return sessions.length > 0 ? sessions[0] : null;
  }

  async closeSession(sessionId) {
    const session = await this._read(sessionId);
    if (!session) return null;
    session.status = 'cancelled';
    session.closedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    await this._update(sessionId, session);
    return session;
  }

  async getSession(sessionId) {
    return this._read(sessionId);
  }

  async listSessions(workspaceId, { limit = 20, offset = 0 } = {}) {
    if (!this._initialized) await this.init();
    const sessions = await this._query({ workspaceId });
    return sessions
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(offset, offset + limit);
  }

  // ══════════════════════════════════════════════════════
  // IndexedDB HELPERS
  // ══════════════════════════════════════════════════════
  async _write(record) {
    if (!this._db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([this._STORE], 'readwrite');
      const store = tx.objectStore(this._STORE);
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async _read(id) {
    if (!this._db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([this._STORE], 'readonly');
      const store = tx.objectStore(this._STORE);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async _update(id, record) {
    record.updatedAt = new Date().toISOString();
    return this._write(record);
  }

  async _query(filter = {}) {
    if (!this._db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([this._STORE], 'readonly');
      const store = tx.objectStore(this._STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result;
        const filtered = all.filter(record => {
          for (const [key, value] of Object.entries(filter)) {
            if (record[key] !== value) return false;
          }
          return true;
        });
        resolve(filtered);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

// Export per moduli
self.SessionDiary = SessionDiary;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionDiary;
}
