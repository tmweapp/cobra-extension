/**
 * COBRA v5.2 — Remote Library Engine
 * Biblioteca remota a livelli illimitati con consolidamento periodico.
 * Persistence via IndexedDB store 'kb_remote_library'
 *
 * Schema documento:
 * {
 *   id, workspace_id, level (0=raw, 1=libro, 2=enciclopedia, ...), period,
 *   tags[], category, keywords_extra[], summary (200 char), full (markdown),
 *   source_ids[], milestone_refs[], created_at, updated_at
 * }
 *
 * @example
 * const lib = new RemoteLibrary();
 * await lib.init();
 * await lib.consolidateWeekly(workspaceId);
 * const results = await lib.searchByIndex('query', workspaceId);
 */

class RemoteLibrary {
  constructor() {
    this._db = null;
    this._initialized = false;
    this._DB_NAME = 'cobra_library';
    this._STORE = 'kb_remote_library';
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
            const store = db.createObjectStore(this._STORE, { keyPath: 'id' });
            store.createIndex('workspace_id', 'workspace_id', { unique: false });
            store.createIndex('level', 'level', { unique: false });
            store.createIndex('period', 'period', { unique: false });
            store.createIndex('created_at', 'created_at', { unique: false });
            store.createIndex('category', 'category', { unique: false });
            // Nota: tags[] e keywords_extra[] non si possono indicizzare direttamente in IDB
            // useremo filtri in memoria per searchByIndex
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      this._initialized = true;
      console.log('[RemoteLibrary] Initialized — IndexedDB ready');
    } catch (e) {
      console.error('[RemoteLibrary] Init failed:', e);
      throw e;
    }
  }

  // ══════════════════════════════════════════════════════
  // CONSOLIDATE_WEEKLY — prende regole/diari ultimi 7gg, crea doc livello 0
  // ══════════════════════════════════════════════════════
  async consolidateWeekly(workspaceId) {
    if (!this._initialized) await this.init();
    if (!self.Brain || !self.Brain.askClaude) {
      throw new Error('Brain.askClaude not available');
    }

    const kb = self.cobraKB || self.KB;
    if (!kb) throw new Error('KnowledgeBase not available');

    // Raccogli regole hot/warm dei giorni scorsi
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    const hotRules = (kb.rules || []).filter(r => {
      const ruleTime = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      return (
        r.workspace_id === workspaceId &&
        r.tier !== 'milestone' &&
        ruleTime > sevenDaysAgo
      );
    });

    if (hotRules.length === 0) {
      console.log('[RemoteLibrary] No hot rules to consolidate for week');
      return null;
    }

    // Prepara testo per riassunto AI
    const rulesText = hotRules
      .map(r => `- [${r.tier}] ${r.title}: ${r.content.substring(0, 100)}...`)
      .join('\n');

    const prompt = `Consolida queste regole di lavoro in un documento di libreria (livello 0 - raw).
Il documento deve essere una sintesi markdown di massimo 3000 caratteri.

REGOLE DA CONSOLIDARE:
${rulesText}

Genera un documento di consolidamento che:
1. Riassuma i punti principali
2. Identifichi pattern ricorrenti
3. Suggerisca tag per categorizzazione
4. Menzioni eventuali riferimenti a milestone (se rilevante)

Rispondi in JSON: {
  "title": "Titolo del documento",
  "summary": "Riassunto max 200 char",
  "full": "Contenuto markdown completo",
  "tags": ["tag1", "tag2"],
  "category": "category_name"
}`;

    const response = await self.Brain.askClaude(prompt, { tokens: 1500 });
    let docData = null;
    try {
      docData = JSON.parse(response);
    } catch (e) {
      console.error('[RemoteLibrary] Failed to parse consolidation JSON:', e);
      return null;
    }

    // Crea documento livello 0
    const doc = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      level: 0, // raw
      period: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      tags: docData.tags || [],
      category: docData.category || 'consolidation',
      keywords_extra: [],
      summary: (docData.summary || '').substring(0, 200),
      full: docData.full || docData.summary || '',
      source_ids: hotRules.map(r => r.id), // riferimenti alle regole original
      milestone_refs: [], // non consolidare le milestone
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Salva documento
    await this._write(doc);

    // Marca regole original come consolidate
    for (const rule of hotRules) {
      if (rule.consolidation_metadata) {
        rule.consolidation_metadata.consolidated_into = doc.id;
      } else {
        rule.consolidation_metadata = { consolidated_into: doc.id };
      }
      rule.tier = 'cold'; // degrada a cold dopo consolidamento
    }

    // Salva KB con regole aggiornate
    if (kb.save) {
      await kb.save().catch(() => {});
    }

    console.log(`[RemoteLibrary] Weekly consolidation: created doc ${doc.id}`);
    return doc;
  }

  // ══════════════════════════════════════════════════════
  // CONSOLIDATE_BY_VOLUME — trigger se sum(words) hot rules > 20000
  // ══════════════════════════════════════════════════════
  async consolidateByVolume(workspaceId, volumeThreshold = 20000) {
    if (!this._initialized) await this.init();

    const kb = self.cobraKB || self.KB;
    if (!kb) throw new Error('KnowledgeBase not available');

    // Conta parole in regole hot
    const hotRules = (kb.rules || []).filter(r =>
      r.workspace_id === workspaceId && r.tier === 'hot'
    );

    const totalWords = hotRules.reduce((sum, r) => {
      const words = (r.content || '').split(/\s+/).length;
      return sum + words;
    }, 0);

    console.log(`[RemoteLibrary] Volume check: ${totalWords} words (threshold: ${volumeThreshold})`);

    if (totalWords <= volumeThreshold) {
      return null;
    }

    // Trigger consolidamento
    return this.consolidateWeekly(workspaceId);
  }

  // ══════════════════════════════════════════════════════
  // META_CONSOLIDATE — ogni N documenti stesso livello → fonde in livello+1
  // NESSUN CAP SU LIVELLI — illimitati!
  // ══════════════════════════════════════════════════════
  async metaConsolidate(workspaceId, level, docsPerMeta = 5) {
    if (!this._initialized) await this.init();
    if (!self.Brain || !self.Brain.askClaude) {
      throw new Error('Brain.askClaude not available');
    }

    // Trova documenti a questo livello per workspace
    const docs = await this._queryByLevel(workspaceId, level);

    if (docs.length < docsPerMeta) {
      console.log(`[RemoteLibrary] Not enough docs at level ${level} to meta-consolidate`);
      return null;
    }

    // Prendi i primi docsPerMeta da fondere
    const docsToMerge = docs.slice(0, docsPerMeta);
    const mergedSummaries = docsToMerge.map(d => d.summary || d.full.substring(0, 200)).join('\n');

    const prompt = `Consolida questi ${docsToMerge.length} documenti in uno più astratto di livello ${level + 1}.
Ogni documento è una sintesi di regole/lavoro a livello ${level}.

DOCUMENTI:
${mergedSummaries}

Crea un documento di mezzo livello (enciclopedia/trattato) che:
1. Astratti i concetti comuni
2. Identifichi pattern di alto livello
3. Riassuma in modo più generale (max 400 char summary)
4. Mantenga link ai documenti originali via source_ids

Rispondi in JSON: {
  "title": "Titolo astratto",
  "summary": "Riassunto max 400 char",
  "full": "Contenuto markdown del livello superiore",
  "tags": ["tag1", "tag2"],
  "category": "category_name"
}`;

    const response = await self.Brain.askClaude(prompt, { tokens: 2000 });
    let docData = null;
    try {
      docData = JSON.parse(response);
    } catch (e) {
      console.error('[RemoteLibrary] Failed to parse meta-consolidation JSON:', e);
      return null;
    }

    // Crea documento livello superiore
    const metaDoc = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      level: level + 1, // NESSUN CAP — livello aumenta sempre
      period: new Date().toISOString().split('T')[0],
      tags: docData.tags || [],
      category: docData.category || 'meta',
      keywords_extra: [],
      summary: (docData.summary || '').substring(0, 400),
      full: docData.full || docData.summary || '',
      source_ids: docsToMerge.map(d => d.id), // riferimenti ai doc di livello inferiore
      milestone_refs: this._extractMilestoneRefs(docsToMerge),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await this._write(metaDoc);
    console.log(`[RemoteLibrary] Meta-consolidation: created doc ${metaDoc.id} at level ${level + 1}`);

    // Ricorsivamente meta-consolida se raggiunto numero sufficiente al nuovo livello
    const docsAtNewLevel = await this._queryByLevel(workspaceId, level + 1);
    if (docsAtNewLevel.length >= docsPerMeta) {
      return this.metaConsolidate(workspaceId, level + 1, docsPerMeta);
    }

    return metaDoc;
  }

  // ══════════════════════════════════════════════════════
  // SEARCH_BY_INDEX — lookup veloce su indici (no deep read)
  // ══════════════════════════════════════════════════════
  async searchByIndex(query, workspaceId = null, { limit = 10 } = {}) {
    if (!this._initialized) await this.init();

    const allDocs = await this._getAll();

    // Filtra per workspace
    let results = allDocs;
    if (workspaceId) {
      results = results.filter(d => d.workspace_id === workspaceId);
    }

    // Filtra per query (case-insensitive su title, summary, tags, category, keywords_extra)
    const queryLower = query.toLowerCase();
    results = results.filter(d => {
      const titleMatch = (d.title || '').toLowerCase().includes(queryLower);
      const summaryMatch = (d.summary || '').toLowerCase().includes(queryLower);
      const tagsMatch = (d.tags || []).some(t => t.toLowerCase().includes(queryLower));
      const categoryMatch = (d.category || '').toLowerCase().includes(queryLower);
      const keywordsMatch = (d.keywords_extra || []).some(k => k.toLowerCase().includes(queryLower));
      return titleMatch || summaryMatch || tagsMatch || categoryMatch || keywordsMatch;
    });

    // Ordina per livello e data
    results.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    // Restituisci solo summary (max 200 char) per shortlist rapida
    return results.slice(0, limit).map(d => ({
      id: d.id,
      title: d.title,
      level: d.level,
      category: d.category,
      summary: d.summary,
      tags: d.tags,
      created_at: d.created_at
    }));
  }

  // ══════════════════════════════════════════════════════
  // DEEP_READ — legge full di docs specifici (max 5 alla volta)
  // ══════════════════════════════════════════════════════
  async deepRead(docIds) {
    if (!this._initialized) await this.init();
    if (!Array.isArray(docIds) || docIds.length === 0) return [];

    // Limit a 5 per controllare token
    const idsToRead = docIds.slice(0, 5);
    const docs = [];

    for (const docId of idsToRead) {
      const doc = await this._read(docId);
      if (doc) {
        docs.push(doc);
      }
    }

    return docs;
  }

  // ══════════════════════════════════════════════════════
  // GET_STATS — statistiche sulla libreria
  // ══════════════════════════════════════════════════════
  async getStats() {
    if (!this._initialized) await this.init();

    const allDocs = await this._getAll();

    const byLevel = {};
    const byWorkspace = {};
    let totalSizeKB = 0;

    for (const doc of allDocs) {
      // Conta documenti per livello
      if (!byLevel[doc.level]) byLevel[doc.level] = 0;
      byLevel[doc.level]++;

      // Conta documenti per workspace
      if (!byWorkspace[doc.workspace_id]) byWorkspace[doc.workspace_id] = 0;
      byWorkspace[doc.workspace_id]++;

      // Calcola dimensione approssimativa
      const docSize = JSON.stringify(doc).length / 1024;
      totalSizeKB += docSize;
    }

    return {
      totalDocs: allDocs.length,
      byLevel,
      byWorkspace,
      totalSizeKB: Math.round(totalSizeKB * 10) / 10
    };
  }

  // ══════════════════════════════════════════════════════
  // HELPERS — IndexedDB + utility
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

  async _getAll() {
    if (!this._db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([this._STORE], 'readonly');
      const store = tx.objectStore(this._STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async _queryByLevel(workspaceId, level) {
    const allDocs = await this._getAll();
    return allDocs.filter(d => d.workspace_id === workspaceId && d.level === level);
  }

  _extractMilestoneRefs(docs) {
    const refs = [];
    for (const doc of docs) {
      if (doc.milestone_refs && Array.isArray(doc.milestone_refs)) {
        refs.push(...doc.milestone_refs);
      }
    }
    return [...new Set(refs)]; // dedup
  }

  // ══════════════════════════════════════════════════════
  // DELETE — rimuove documento per gestione storage
  // ══════════════════════════════════════════════════════
  async delete(docId) {
    if (!this._db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction([this._STORE], 'readwrite');
      const store = tx.objectStore(this._STORE);
      const req = store.delete(docId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

// Export per moduli
self.RemoteLibrary = RemoteLibrary;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RemoteLibrary;
}
