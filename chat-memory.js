/**
 * COBRA v5.3 — Chat Memory (Hierarchical)
 * Implementa memoria chat con liveWindow, rolling summary, e temp document store
 * Supporta 3-tier response: synthetic, summary, full
 */

class ChatMemory {
  constructor() {
    // Live window: ultimi N messaggi full-fidelity
    this.liveWindow = [];
    this.MAX_LIVE = 10;

    // Rolling summary: riassunto compatto dei messaggi consolidati
    this.rollingSummary = '';

    // Temporary document store (IndexedDB-backed)
    this.tempDocs = new Map(); // id -> {id, content, title, words}

    // Token budgets
    this.MAX_SUMMARY_TOKENS = 800;
    this.REPACK_THRESHOLD = 800;
    this.TARGET_SUMMARY = 500;
    this.MAX_FULL_TOKENS = 3000;

    // Full recent messages (before consolidation)
    this.FULL_RECENT = 5;

    // Sessions ID per tracking
    this._sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Aggiunge un messaggio alla memoria
   * tier: 'full' (default), 'summary', 'synthetic'
   * Se liveWindow > MAX_LIVE, consolida il messaggio più vecchio
   */
  addMessage(role, content, tier = 'full') {
    const message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      role,
      content,
      tier,
      timestamp: new Date().toISOString(),
    };

    this.liveWindow.push(message);

    // Se eccediamo MAX_LIVE, consolida il messaggio più vecchio
    if (this.liveWindow.length > this.MAX_LIVE) {
      this._consolidateOldest();
    }

    // Se rollingSummary eccede REPACK_THRESHOLD, ricomprimilo
    if (this._estimateTokens(this.rollingSummary) > this.REPACK_THRESHOLD) {
      this._repackSummary();
    }

    // Safety cap: se i full recent superano MAX_FULL_TOKENS, comprimi
    this._safetyCap();

    return message;
  }

  /**
   * Consolida il messaggio più vecchio nel rolling summary
   * Prende dal position 0 se ci sono più di FULL_RECENT messaggi
   */
  _consolidateOldest() {
    if (this.liveWindow.length <= this.FULL_RECENT) {
      return; // Non consolidare se abbiamo pochi messaggi
    }

    // Prendi il primo messaggio
    const oldMsg = this.liveWindow.shift();

    if (!oldMsg) return;

    // Costruisci testo da integrare nel summary
    const msgText = `[${oldMsg.role}]: ${oldMsg.content || '(empty)'}`;

    // Se non c'è un summary ancora, creane uno semplice
    if (!this.rollingSummary || this.rollingSummary.trim() === '') {
      this.rollingSummary = `**Conversation started**\n${msgText}`;
    } else {
      // Estendi il summary con il nuovo messaggio
      this._extendRollingSummary(msgText);
    }
  }

  /**
   * Estende il rolling summary integrando un nuovo messaggio
   * Simula la chiamata AI (in pratica userà askWithThreeTier)
   */
  _extendRollingSummary(newMessage) {
    // Qui simuliamo l'estensione: in realtà verrà richiamato da brain.js
    // Per ora, aggiungi il messaggio al summary in modo semplice
    const lines = this.rollingSummary.split('\n');

    // Prendi le prime 5 righe (mantieni struttura) e aggiungi la nuova
    const summary = lines.slice(0, Math.min(5, lines.length)).join('\n');
    this.rollingSummary = summary + '\n' + newMessage;

    // Se supera TARGET_SUMMARY token, ricomprimilo
    if (this._estimateTokens(this.rollingSummary) > this.TARGET_SUMMARY) {
      this._repackSummary();
    }
  }

  /**
   * Ricomprime il rolling summary se eccede la soglia
   * Lo riduce a TARGET_SUMMARY token mantenendo coerenza
   */
  _repackSummary() {
    if (this._estimateTokens(this.rollingSummary) <= this.TARGET_SUMMARY) {
      return; // Non c'è bisogno di repack
    }

    // Estrai solo le prime linee che soddisfano TARGET_SUMMARY
    const lines = this.rollingSummary.split('\n');
    let packed = '';
    let estimatedTokens = 0;

    for (const line of lines) {
      const lineTokens = this._estimateTokens(line);
      if (estimatedTokens + lineTokens > this.TARGET_SUMMARY) {
        break;
      }
      packed += line + '\n';
      estimatedTokens += lineTokens;
    }

    this.rollingSummary = packed.trim() || this.rollingSummary;
  }

  /**
   * Stima i token approssimativamente
   * Euristica: ~1 token ogni 4 caratteri
   */
  _estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Safety cap: se i full recent superano MAX_FULL_TOKENS, comprimi gli ultimi 2-3
   */
  _safetyCap() {
    // Calcola il totale dei token nei full recent messages
    const recentFullMsgs = this.liveWindow.slice(-this.FULL_RECENT);
    const fullTokens = recentFullMsgs.reduce((sum, m) => sum + this._estimateTokens(m.content || ''), 0);

    if (fullTokens > this.MAX_FULL_TOKENS) {
      // Comprimi i messaggi in eccesso a synthetic
      const excess = fullTokens - this.MAX_FULL_TOKENS;
      const toCompress = recentFullMsgs
        .slice(0, Math.max(1, Math.ceil(excess / 500)))
        .map(m => m.id);

      for (const msgId of toCompress) {
        const msg = this.liveWindow.find(m => m.id === msgId);
        if (msg) {
          // Crea una versione sintetica
          const synth = (msg.content || '').split('\n')[0]; // Prima linea
          msg.content = synth.length > 100 ? synth.substr(0, 100) + '...' : synth;
          msg.tier = 'synthetic';
        }
      }
    }
  }

  /**
   * Restituisce il contesto pronto per il prompt builder
   * { rollingSummary, liveMessages: [{role, content/synthetic}] }
   */
  getPromptContext() {
    const liveMessages = this.liveWindow.map(m => ({
      role: m.role,
      content: m.content,
      tier: m.tier,
    }));

    return {
      rollingSummary: this.rollingSummary,
      liveMessages,
      estimatedLiveTokens: this.liveWindow.reduce((sum, m) => sum + this._estimateTokens(m.content || ''), 0),
    };
  }

  /**
   * Aggiunge un documento lungo al temp store
   * Se text > 800 token, salva in tempDocs e ritorna una reference
   * Ritorna: "[document:id - title - words]"
   */
  addLongDocument(text, title = 'document') {
    const tokenCount = this._estimateTokens(text);

    if (tokenCount <= 800) {
      // Se è abbastanza corto, non usare il temp store
      return null;
    }

    // Genera ID unico per il documento
    const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Conta parole
    const words = text.split(/\s+/).length;

    // Salva nel temp store
    this.tempDocs.set(docId, {
      id: docId,
      content: text,
      title,
      words,
      tokenCount,
      createdAt: new Date().toISOString(),
    });

    // Ritorna reference
    return `[document:${docId} - ${title} - ${words} words]`;
  }

  /**
   * Legge il contenuto di un temp document
   * Usato per lazy loading nei tool call
   */
  readTempDoc(id) {
    const doc = this.tempDocs.get(id);
    if (!doc) {
      return null;
    }

    // Aggiorna lastAccessedAt
    doc.lastAccessedAt = new Date().toISOString();

    return {
      id: doc.id,
      content: doc.content,
      title: doc.title,
      words: doc.words,
    };
  }

  /**
   * Rimuove i temp documents più vecchi di N ore
   */
  clearOldTempDocs(hoursOld = 24) {
    const now = Date.now();
    const threshold = hoursOld * 60 * 60 * 1000;

    for (const [id, doc] of this.tempDocs.entries()) {
      const age = now - new Date(doc.createdAt).getTime();
      if (age > threshold) {
        this.tempDocs.delete(id);
      }
    }
  }

  /**
   * Serializza lo stato della memoria per persistenza
   */
  serialize() {
    return {
      liveWindow: this.liveWindow,
      rollingSummary: this.rollingSummary,
      tempDocs: Array.from(this.tempDocs.entries()).map(([id, doc]) => ({
        id,
        title: doc.title,
        words: doc.words,
        tokenCount: doc.tokenCount,
        createdAt: doc.createdAt,
        lastAccessedAt: doc.lastAccessedAt,
        // Non serializzare il content completo (è troppo grande)
      })),
      sessionId: this._sessionId,
    };
  }

  /**
   * Deserializza lo stato della memoria
   */
  static deserialize(data) {
    const cm = new ChatMemory();

    if (data.liveWindow) {
      cm.liveWindow = data.liveWindow;
    }

    if (data.rollingSummary) {
      cm.rollingSummary = data.rollingSummary;
    }

    if (data.tempDocs && Array.isArray(data.tempDocs)) {
      for (const doc of data.tempDocs) {
        // Nota: content non è disponibile dopo deserialize
        // È responsabilità dell'app ripopolare i temp docs da IndexedDB
        cm.tempDocs.set(doc.id, {
          id: doc.id,
          title: doc.title,
          words: doc.words,
          tokenCount: doc.tokenCount,
          createdAt: doc.createdAt,
          lastAccessedAt: doc.lastAccessedAt,
        });
      }
    }

    if (data.sessionId) {
      cm._sessionId = data.sessionId;
    }

    return cm;
  }

  /**
   * Ottiene statistiche sulla memoria
   */
  getStats() {
    const liveTokens = this.liveWindow.reduce((sum, m) => sum + this._estimateTokens(m.content || ''), 0);
    const summaryTokens = this._estimateTokens(this.rollingSummary);

    return {
      liveWindowCount: this.liveWindow.length,
      liveTokens,
      summaryTokens,
      totalTokens: liveTokens + summaryTokens,
      tempDocsCount: this.tempDocs.size,
      tempDocsTotalWords: Array.from(this.tempDocs.values()).reduce((sum, d) => sum + (d.words || 0), 0),
      sessionId: this._sessionId,
    };
  }
}

// Rendi disponibile globalmente
if (typeof self !== 'undefined') {
  self.ChatMemory = ChatMemory;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChatMemory;
}
