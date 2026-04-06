// COBRA v4.0 — Gate Engine
// Sistema a gate forzati per job complessi multi-step
// Ispirato a SwiftPack Studio 7-gate pricelist import

class GateEngine {
  constructor(knowledgeBase) {
    this.kb = knowledgeBase;
    this.sessions = new Map();
    this._gatePerformance = {};
  }

  // ============================================================
  // PERSISTENCE
  // ============================================================
  async load() {
    try {
      const saved = self.cobraPersistence
        ? await self.cobraPersistence.load('cobra_gate_sessions')
        : await new Promise(r => chrome.storage.local.get('cobra_gate_sessions', d => r(d.cobra_gate_sessions)));
      (saved || []).forEach(s => this.sessions.set(s.id, s));
      return (saved || []).length;
    } catch (e) {
      console.error('[GateEngine] load error:', e);
      return 0;
    }
  }

  async save() {
    const arr = Array.from(this.sessions.values());
    try {
      if (self.cobraPersistence) {
        self.cobraPersistence.debouncedSave('cobra_gate_sessions', arr, 300);
      } else {
        await new Promise(r => chrome.storage.local.set({ cobra_gate_sessions: arr }, r));
      }
      // Async write to IndexedDB audit log
      if (self.cobraIDB) {
        self.cobraIDB.appendAuditLog({ tool: 'gate_engine', action: 'save', sessionCount: arr.length }).catch(() => {});
      }
    } catch (e) {
      console.error('[GateEngine] save error:', e);
    }
  }

  // ============================================================
  // GATE TEMPLATES — Predefiniti per tipo operazione
  // ============================================================
  static TEMPLATES = {
    // Scrape complesso multi-sito
    'deep_scrape': {
      name: 'Deep Scrape',
      gates: [
        {
          index: 0, name: 'Ricezione',
          description: 'Definisci obiettivo e siti target',
          exitCriteria: ['Obiettivo chiaro', 'Siti target identificati', 'Formato output scelto'],
          aiManual: 'Chiedi all\'utente COSA vuole ottenere e DA DOVE. Non procedere senza conferma.'
        },
        {
          index: 1, name: 'Ricognizione',
          description: 'Analizza struttura siti, identifica selettori',
          exitCriteria: ['Struttura sito mappata', 'Selettori CSS identificati', 'Ostacoli rilevati (login, CAPTCHA, rate limit)'],
          aiManual: 'Naviga ogni sito target. Identifica dove sono i dati. Salva selettori nella KB.'
        },
        {
          index: 2, name: 'Estrazione',
          description: 'Estrai dati grezzi dai siti',
          exitCriteria: ['Dati estratti da tutti i siti', 'Source ref per ogni dato', 'Nessun errore critico'],
          aiManual: 'Scrapa ogni sito con stealth mode. Per ogni dato, registra da dove viene. Se un sito blocca, prova cascade query.'
        },
        {
          index: 3, name: 'Validazione',
          description: 'Verifica coerenza e qualità dati',
          exitCriteria: ['Dati coerenti', 'Anomalie identificate', 'Utente conferma qualità'],
          aiManual: 'Controlla: dati duplicati? Campi vuoti? Valori anomali? Mostra riepilogo e chiedi conferma.'
        },
        {
          index: 4, name: 'Correzione',
          description: 'Correggi errori e arricchisci dati',
          exitCriteria: ['Correzioni applicate', 'Regole KB salvate', 'Dati puliti'],
          aiManual: 'Applica correzioni utente. OGNI correzione diventa regola KB per il futuro. Mostra prima/dopo.'
        },
        {
          index: 5, name: 'Output',
          description: 'Genera file finale nel formato richiesto',
          exitCriteria: ['File generato', 'Formato corretto', 'Utente soddisfatto'],
          aiManual: 'Genera output (CSV/JSON/Excel). Mostra anteprima. Chiedi se salvare operative prompt.'
        },
      ]
    },

    // Agent task autonomo
    'agent_task': {
      name: 'Agent Task',
      gates: [
        {
          index: 0, name: 'Briefing',
          description: 'Comprendi obiettivo e vincoli',
          exitCriteria: ['Obiettivo definito', 'Vincoli chiari', 'Piano d\'azione approvato'],
          aiManual: 'Chiedi: cosa vuoi ottenere? Ci sono limiti? Proponi piano step-by-step.'
        },
        {
          index: 1, name: 'Navigazione',
          description: 'Naviga ai siti necessari',
          exitCriteria: ['Siti raggiunti', 'Login effettuato se necessario', 'Pagina target trovata'],
          aiManual: 'Naviga usando stealth mode. Se serve login, chiedi credenziali. Se bloccato, prova alternative.'
        },
        {
          index: 2, name: 'Esecuzione',
          description: 'Esegui le azioni richieste',
          exitCriteria: ['Azioni completate', 'Risultati verificati', 'Nessun errore'],
          aiManual: 'Esegui ogni azione del piano. Verifica risultato dopo ogni step. Se errore, riprova o chiedi aiuto.'
        },
        {
          index: 3, name: 'Conferma',
          description: 'Verifica risultato e chiudi',
          exitCriteria: ['Risultato confermato', 'Report generato', 'KB aggiornata'],
          aiManual: 'Mostra risultato all\'utente. Salva nella KB cosa hai imparato. Proponi operative prompt.'
        },
      ]
    },

    // Pipeline multi-step
    'pipeline': {
      name: 'Pipeline',
      gates: [
        {
          index: 0, name: 'Configurazione',
          description: 'Definisci step della pipeline',
          exitCriteria: ['Step definiti', 'Input/output mappati', 'Dipendenze chiare'],
          aiManual: 'Chiedi: quali step? In che ordine? Cosa produce ogni step?'
        },
        {
          index: 1, name: 'Validazione Input',
          description: 'Verifica che tutti gli input siano disponibili',
          exitCriteria: ['Input verificati', 'File accessibili', 'API raggiungibili'],
          aiManual: 'Controlla ogni input: file esiste? API risponde? Credenziali valide?'
        },
        {
          index: 2, name: 'Esecuzione',
          description: 'Esegui ogni step in sequenza',
          exitCriteria: ['Tutti gli step completati', 'Nessun errore bloccante'],
          aiManual: 'Esegui step per step. Se uno fallisce, pausa e chiedi. Non saltare step.'
        },
        {
          index: 3, name: 'Review',
          description: 'Verifica output finale',
          exitCriteria: ['Output corretto', 'Utente soddisfatto', 'Regole KB salvate'],
          aiManual: 'Mostra risultato. Chiedi conferma. Salva lezioni apprese nella KB.'
        },
      ]
    },

    // Monitoraggio prezzi
    'price_monitor': {
      name: 'Price Monitor',
      gates: [
        {
          index: 0, name: 'Setup',
          description: 'Definisci prodotti e siti da monitorare',
          exitCriteria: ['Prodotti definiti', 'Siti selezionati', 'Frequenza impostata'],
          aiManual: 'Chiedi: quali prodotti? Su quali siti? Ogni quanto controllare?'
        },
        {
          index: 1, name: 'Calibrazione',
          description: 'Trova selettori e verifica estrazioni',
          exitCriteria: ['Selettori trovati', 'Prezzi estratti correttamente', 'Baseline salvato'],
          aiManual: 'Visita ogni sito, trova il prezzo, salva selettore nella KB. Verifica con utente.'
        },
        {
          index: 2, name: 'Monitoraggio',
          description: 'Esegui controlli periodici',
          exitCriteria: ['Almeno 1 ciclo completato', 'Dati coerenti'],
          aiManual: 'Esegui scrape periodico. Confronta con baseline. Segnala variazioni.'
        },
        {
          index: 3, name: 'Report',
          description: 'Genera report comparativo',
          exitCriteria: ['Report generato', 'Trend identificati'],
          aiManual: 'Genera report con prezzi, variazioni, trend. Esporta se richiesto.'
        },
      ]
    },

    // Ricerca e lead generation
    'lead_gen': {
      name: 'Lead Generation',
      gates: [
        {
          index: 0, name: 'Target',
          description: 'Definisci profilo lead ideale',
          exitCriteria: ['Settore definito', 'Zona geografica', 'Criteri qualificazione'],
          aiManual: 'Chiedi: che tipo di aziende cerchi? Dove? Quanto grandi? Che servizi?'
        },
        {
          index: 1, name: 'Discovery',
          description: 'Trova aziende candidate',
          exitCriteria: ['Lista iniziale generata', 'Almeno 10 candidati'],
          aiManual: 'Cerca su Google, LinkedIn, directory settoriali. Usa cascade queries per resilienza.'
        },
        {
          index: 2, name: 'Enrichment',
          description: 'Arricchisci dati contatto',
          exitCriteria: ['Email trovate', 'Telefoni trovati', 'Social links trovati'],
          aiManual: 'Per ogni azienda: cerca email, telefono, LinkedIn decision maker. Salva tutto.'
        },
        {
          index: 3, name: 'Qualificazione',
          description: 'Filtra e classifica lead',
          exitCriteria: ['Lead qualificati', 'Score assegnato', 'Top 10 identificati'],
          aiManual: 'Classifica per rilevanza. Assegna score 1-10. Filtra i migliori.'
        },
        {
          index: 4, name: 'Export',
          description: 'Esporta lista finale',
          exitCriteria: ['File generato', 'Formato corretto'],
          aiManual: 'Genera CSV/Excel con tutti i dati. Salva operative prompt per future ricerche.'
        },
      ]
    },
  };

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  createSession({ templateKey, title, config = {} }) {
    const template = GateEngine.TEMPLATES[templateKey];
    if (!template) throw new Error(`Template "${templateKey}" not found`);

    const session = {
      id: crypto.randomUUID(),
      templateKey,
      templateName: template.name,
      title: title || `${template.name} — ${new Date().toLocaleDateString('it')}`,
      status: 'active',     // active | paused | completed | failed | cancelled
      currentGate: 0,
      gates: template.gates.map(g => ({
        ...g,
        status: g.index === 0 ? 'active' : 'locked',   // locked | active | completed | failed
        completedCriteria: [],
        data: {},            // Dati raccolti in questo gate
        startedAt: g.index === 0 ? new Date().toISOString() : null,
        completedAt: null,
        notes: [],
        attemptCount: 0,     // Track retry attempts
        skipped: false,      // Track if gate was skipped
      })),
      config,
      jobIds: [],            // Job associati
      kbRulesCreated: [],    // Regole KB create durante sessione
      conversationId: null,  // ID conversazione chat
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    this.sessions.set(session.id, session);
    this.save();
    return session;
  }

  // ============================================================
  // GATE NAVIGATION
  // ============================================================

  // Avanza al gate successivo (validazione: max +1)
  advanceGate(sessionId, completedCriteria = []) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const current = session.gates[session.currentGate];
    if (!current) throw new Error('No current gate');

    current.attemptCount = (current.attemptCount || 0) + 1;

    // Registra criteri completati
    current.completedCriteria = completedCriteria;
    current.status = 'completed';
    current.completedAt = new Date().toISOString();

    // Verifica se tutti i criteri soddisfatti
    const allCriteriaMet = current.exitCriteria.every(
      c => completedCriteria.includes(c)
    );

    if (!allCriteriaMet) {
      // Permetti avanzamento con warning
      current.notes.push({
        type: 'warning',
        message: `Gate avanzato con criteri mancanti: ${current.exitCriteria.filter(c => !completedCriteria.includes(c)).join(', ')}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Adaptive exit: check for repeated failures
    if (current.attemptCount >= 3 && !allCriteriaMet) {
      const perfKey = `${session.templateKey}:${current.index}`;
      this.recordGateResult(session.templateKey, current.index, false, 0);
      current.notes.push({
        type: 'failure_pattern',
        message: `Gate attempted ${current.attemptCount} times without success. Consider alternative approach or skip.`,
        timestamp: new Date().toISOString(),
      });
    }

    // Avanza
    const nextGateIdx = session.currentGate + 1;
    if (nextGateIdx < session.gates.length) {
      session.currentGate = nextGateIdx;
      session.gates[nextGateIdx].status = 'active';
      session.gates[nextGateIdx].startedAt = new Date().toISOString();
    } else {
      // Tutti i gate completati
      session.status = 'completed';
      session.completedAt = new Date().toISOString();
    }

    session.updatedAt = new Date().toISOString();
    this.save();
    return session;
  }

  // Torna a gate precedente (allowed)
  goBackGate(sessionId, targetGateIdx) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (targetGateIdx < 0 || targetGateIdx >= session.currentGate) {
      throw new Error('Invalid gate index');
    }

    // Marca gate corrente come "needs revisit"
    session.gates[session.currentGate].status = 'locked';
    session.gates[session.currentGate].notes.push({
      type: 'info',
      message: `Tornato a gate ${targetGateIdx} per revisione`,
      timestamp: new Date().toISOString(),
    });

    session.currentGate = targetGateIdx;
    session.gates[targetGateIdx].status = 'active';
    session.updatedAt = new Date().toISOString();
    this.save();
    return session;
  }

  // Salva dati nel gate corrente
  setGateData(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const gate = session.gates[session.currentGate];
    if (gate) {
      gate.data = { ...gate.data, ...data };
      session.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  // ============================================================
  // AI CONTEXT
  // ============================================================

  // Genera contesto gate per il system prompt AI
  buildGateContext(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return '';

    const current = session.gates[session.currentGate];
    const completed = session.gates.filter(g => g.status === 'completed');

    let context = `\n\n--- COBRA GATE SYSTEM ---\n`;
    context += `Sessione: ${session.title}\n`;
    context += `Template: ${session.templateName}\n`;
    context += `Gate attuale: ${current.index}/${session.gates.length - 1} — ${current.name}\n`;
    context += `Descrizione: ${current.description}\n\n`;

    context += `CRITERI DI USCITA (tutti devono essere soddisfatti):\n`;
    current.exitCriteria.forEach((c, i) => {
      const done = current.completedCriteria.includes(c);
      context += `  ${done ? '✅' : '⬜'} ${c}\n`;
    });

    context += `\nISTRUZIONI PER L'AI:\n${current.aiManual}\n`;

    if (completed.length) {
      context += `\nGATE COMPLETATI:\n`;
      completed.forEach(g => {
        context += `  ✅ Gate ${g.index} (${g.name}): ${g.completedCriteria.length}/${g.exitCriteria.length} criteri\n`;
        if (Object.keys(g.data).length) {
          context += `     Dati: ${JSON.stringify(g.data).slice(0, 200)}\n`;
        }
      });
    }

    // Aggiungi regole KB rilevanti
    if (this.kb) {
      const domain = session.config.domain || null;
      const kbContext = this.kb.buildContextForAI({
        domain,
        operationType: session.templateKey,
      });
      if (kbContext) context += kbContext;
    }

    context += `--- FINE GATE SYSTEM ---\n`;
    return context;
  }

  // ============================================================
  // SESSION QUERIES
  // ============================================================

  getSession(id) { return this.sessions.get(id); }

  getActiveSessions() {
    return Array.from(this.sessions.values())
      .filter(s => ['active', 'paused'].includes(s.status))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  getAllSessions() {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  pauseSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s) { s.status = 'paused'; s.updatedAt = new Date().toISOString(); this.save(); }
  }

  resumeSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s && s.status === 'paused') { s.status = 'active'; s.updatedAt = new Date().toISOString(); this.save(); }
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    this.save();
  }

  // ============================================================
  // DYNAMIC GATE MODIFICATION (Adaptive)
  // ============================================================

  skipGate(sessionId, gateIdx, reason) {
    const session = this.sessions.get(sessionId);
    if (!session || gateIdx < 0 || gateIdx >= session.gates.length) {
      throw new Error('Invalid session or gate index');
    }

    const gate = session.gates[gateIdx];
    gate.skipped = true;
    gate.status = 'completed';
    gate.completedAt = new Date().toISOString();
    gate.notes.push({
      type: 'skipped',
      message: `Gate skipped: ${reason}`,
      timestamp: new Date().toISOString(),
    });

    session.updatedAt = new Date().toISOString();
    this.save();
    return session;
  }

  insertGate(sessionId, afterIdx, gateConfig) {
    const session = this.sessions.get(sessionId);
    if (!session || afterIdx < -1 || afterIdx >= session.gates.length) {
      throw new Error('Invalid session or insertion point');
    }

    const newGate = {
      ...gateConfig,
      index: afterIdx + 1,
      status: afterIdx === session.currentGate ? 'active' : 'locked',
      completedCriteria: [],
      data: {},
      startedAt: afterIdx === session.currentGate ? new Date().toISOString() : null,
      completedAt: null,
      notes: [{ type: 'info', message: 'Gate inserted dynamically', timestamp: new Date().toISOString() }],
      attemptCount: 0,
      skipped: false,
    };

    session.gates.splice(afterIdx + 1, 0, newGate);
    // Re-index all gates after insertion
    for (let i = afterIdx + 1; i < session.gates.length; i++) {
      session.gates[i].index = i;
    }

    session.updatedAt = new Date().toISOString();
    this.save();
    return session;
  }

  // ============================================================
  // PERFORMANCE TRACKING (Adaptive)
  // ============================================================

  recordGateResult(templateKey, gateIdx, success, timeMs) {
    const perfKey = `${templateKey}:${gateIdx}`;
    if (!this._gatePerformance[perfKey]) {
      this._gatePerformance[perfKey] = {
        attempts: 0,
        successes: 0,
        totalTime: 0,
        skips: 0,
        lastRecordedAt: null,
      };
    }

    const perf = this._gatePerformance[perfKey];
    perf.attempts += 1;
    if (success) perf.successes += 1;
    if (timeMs >= 0) perf.totalTime += timeMs;
    perf.lastRecordedAt = new Date().toISOString();
  }

  getGatePerformance(templateKey, gateIdx) {
    const perfKey = `${templateKey}:${gateIdx}`;
    const perf = this._gatePerformance[perfKey];
    if (!perf) return null;

    return {
      successRate: perf.attempts > 0 ? (perf.successes / perf.attempts) : 0,
      avgTime: perf.attempts > 0 ? (perf.totalTime / perf.successes || 0) : 0,
      attemptCount: perf.attempts,
      skipRate: perf.skips / (perf.attempts || 1),
    };
  }
}

if (typeof self !== 'undefined') {
  self.GateEngine = GateEngine;
}
