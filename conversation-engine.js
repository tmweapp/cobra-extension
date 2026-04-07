/**
 * COBRA v4.0 - Motore Conversazione
 * Gestisce la cronologia conversazioni con persistenza e riassunto dinamico
 * Engine per conversazioni AI con rolling summary per gestire il contesto
 */

class ConversationEngine {
  constructor() {
    // Mappa delle conversazioni in memoria {id -> conversation}
    this.conversations = new Map();
    // ID dell'ultima conversazione attiva
    this.activeConversationId = null;
    // Timer per il salvataggio debounced
    this.saveTimeout = null;
    // Soglia per il rolling summary (adattiva: 8-20 in base alla lunghezza messaggi)
    this.summaryThreshold = 10;
    this._baseSummaryThreshold = 10;
    // Mutex/flag to prevent concurrent summarization
    this._summarizingConversations = new Set();
    // Chat memory per conversazione {convId -> ChatMemory}
    this.chatMemories = new Map();
  }

  /**
   * Carica tutte le conversazioni da chrome.storage.local
   * Restituisce una promise che resolve quando il caricamento è completo
   */
  async load() {
    try {
      let conversations, activeId;
      if (self.cobraPersistence) {
        [conversations, activeId] = await Promise.all([
          self.cobraPersistence.load('cobra_conversations'),
          self.cobraPersistence.load('cobra_activeConversationId')
        ]);
      } else {
        const result = await new Promise((resolve, reject) => {
          chrome.storage.local.get(['cobra_conversations', 'cobra_activeConversationId'], (r) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(r);
          });
        });
        conversations = result.cobra_conversations;
        activeId = result.cobra_activeConversationId;
      }

      this.conversations.clear();
      for (const [id, conv] of Object.entries(conversations || {})) {
        this.conversations.set(id, conv);
      }
      this.activeConversationId = activeId || null;
    } catch (e) {
      console.error('[ConversationEngine] Load error:', e);
    }
  }

  /**
   * Salva tutte le conversazioni in chrome.storage.local (con debounce)
   * Debouncing a 800ms per evitare scritture eccessive
   */
  save() {
    // Cancella il timeout precedente se esiste
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Imposta un nuovo timeout per il salvataggio debounced
    this.saveTimeout = setTimeout(() => {
      const conversationsObject = {};
      for (const [id, conv] of this.conversations.entries()) {
        conversationsObject[id] = conv;
      }

      if (self.cobraPersistence) {
        Promise.all([
          self.cobraPersistence.save('cobra_conversations', conversationsObject),
          self.cobraPersistence.save('cobra_activeConversationId', this.activeConversationId)
        ]).catch(e => console.error('[ConversationEngine] Save error:', e));
      } else {
        chrome.storage.local.set({
          cobra_conversations: conversationsObject,
          cobra_activeConversationId: this.activeConversationId
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('Errore salvataggio conversazioni:', chrome.runtime.lastError);
          }
        });
      }

      this.saveTimeout = null;
    }, 800);
  }

  /**
   * Crea una nuova conversazione
   * Restituisce {id, title, messages: [], summary: '', metadata, createdAt, updatedAt}
   * Crea anche una ChatMemory associata
   */
  createConversation(title, metadata = {}) {
    // Genera un ID univoco per la conversazione
    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();

    const conversation = {
      id,
      title,
      messages: [],
      summary: '',
      metadata,
      createdAt: now,
      updatedAt: now
    };

    this.conversations.set(id, conversation);
    this.activeConversationId = id;

    // Crea ChatMemory per questa conversazione
    if (typeof ChatMemory !== 'undefined') {
      this.chatMemories.set(id, new ChatMemory());
    }

    this.save();

    return conversation;
  }

  /**
   * Aggiunge un messaggio a una conversazione
   * role: 'user' | 'ai' | 'system' | 'tool'
   * content: il testo del messaggio
   * metadata: dati aggiuntivi opzionali
   * tier: 'full' (default), 'summary', 'synthetic' - per ChatMemory
   *
   * Attiva automaticamente il rolling summary se i messaggi superano la soglia
   * Aggiunge anche a ChatMemory se disponibile
   */
  addMessage(convId, role, content, metadata = {}, tier = 'full') {
    const conversation = this.conversations.get(convId);
    if (!conversation) {
      throw new Error(`Conversazione non trovata: ${convId}`);
    }

    // Crea il messaggio
    const message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      role,
      content,
      metadata,
      timestamp: new Date().toISOString()
    };

    // Aggiunge il messaggio alla cronologia
    conversation.messages.push(message);
    conversation.updatedAt = new Date().toISOString();

    // Aggiunge a ChatMemory
    const chatMemory = this.chatMemories.get(convId);
    if (chatMemory) {
      chatMemory.addMessage(role, content, tier);
    }

    // Controlla se è necessario eseguire il rolling summary (soglia adattiva)
    const adaptiveThreshold = this._adaptThreshold(conversation);
    if (conversation.messages.length > adaptiveThreshold) {
      this.rollingSummary(convId);
    }

    // Imposta questa conversazione come attiva
    this.activeConversationId = convId;
    this.save();

    return message;
  }

  /**
   * Ottiene il contesto prompt da ChatMemory per una conversazione
   * Ritorna { rollingSummary, liveMessages }
   */
  getPromptContext(convId) {
    const chatMemory = this.chatMemories.get(convId);
    if (!chatMemory) {
      return null;
    }
    return chatMemory.getPromptContext();
  }

  /**
   * Ottiene statistiche ChatMemory per una conversazione
   */
  getChatMemoryStats(convId) {
    const chatMemory = this.chatMemories.get(convId);
    if (!chatMemory) {
      return null;
    }
    return chatMemory.getStats();
  }

  /**
   * Ottiene una conversazione completa per ID
   */
  getConversation(convId) {
    const conversation = this.conversations.get(convId);
    if (!conversation) {
      throw new Error(`Conversazione non trovata: ${convId}`);
    }
    return conversation;
  }

  /**
   * Ottiene l'ultima conversazione attiva
   * Restituisce null se non esiste nessuna conversazione attiva
   */
  getActiveConversation() {
    if (!this.activeConversationId) {
      return null;
    }
    return this.conversations.get(this.activeConversationId) || null;
  }

  /**
   * Costruisce una stringa di contesto per l'AI
   * Combina il riassunto precedente + ultimi N messaggi
   * Ideale per l'iniezione nel system prompt
   *
   * maxMessages: numero massimo di messaggi recenti da includere (default: 20)
   */
  buildContextForAI(convId, maxMessages = 20) {
    const conversation = this.conversations.get(convId);
    if (!conversation) {
      throw new Error(`Conversazione non trovata: ${convId}`);
    }

    let context = '';

    // Aggiungi il riassunto se disponibile
    if (conversation.summary && conversation.summary.trim() !== '') {
      context += `## Contesto Precedente (Riassunto)\n${conversation.summary}\n\n`;
    }

    // Aggiungi i messaggi recenti
    const recentMessages = conversation.messages.slice(-maxMessages);

    if (recentMessages.length > 0) {
      context += `## Messaggi Recenti\n`;
      for (const msg of recentMessages) {
        context += `[${msg.role.toUpperCase()}]: ${msg.content}\n`;
      }
    }

    return context;
  }

  /**
   * Esegue il rolling summary
   * Riassume i messaggi più vecchi (mantenendo gli ultimi summaryThreshold messaggi)
   * Salva il riassunto compatto nella conversation.summary
   *
   * Questa funzione simula il riassunto (in un'implementazione reale,
   * potrebbe essere inviato a un servizio di sintesi AI)
   */
  rollingSummary(convId) {
    const conversation = this.conversations.get(convId);
    if (!conversation) {
      throw new Error(`Conversazione non trovata: ${convId}`);
    }

    // Prevent concurrent summarization for the same conversation
    if (this._summarizingConversations.has(convId)) {
      return; // Already summarizing, skip this call
    }

    const messages = conversation.messages;
    if (messages.length <= this.summaryThreshold) {
      return; // Non c'è abbastanza da riassumere
    }

    // Mark this conversation as being summarized
    this._summarizingConversations.add(convId);

    try {
      // Backup messages before modifying
      const messageBackup = JSON.parse(JSON.stringify(messages));

      // Identifica i messaggi da riassumere (tutti tranne gli ultimi N)
      const oldMessages = messages.slice(0, -this.summaryThreshold);
      const recentMessages = messages.slice(-this.summaryThreshold);

      if (oldMessages.length === 0) {
        return;
      }

      // Costruisce un testo riepilogativo dai messaggi vecchi
      // Formato semplice: estrae il contenuto principale
      let summaryText = '';

      // Raggruppa i messaggi per ruolo
      const byRole = {};
      for (const msg of oldMessages) {
        if (!byRole[msg.role]) {
          byRole[msg.role] = [];
        }
        // Add null check for message.content to prevent crashes
        byRole[msg.role].push(msg.content || '(empty)');
      }

      // Crea un riassunto strutturato
      summaryText += `**Riassunto conversazione precedente (${oldMessages.length} messaggi)**\n`;

      for (const [role, contents] of Object.entries(byRole)) {
        const contentPreview = contents
          .map(c => {
            const text = String(c);
            return text.substring(0, 100) + (text.length > 100 ? '...' : '');
          })
          .join(' | ');
        summaryText += `- **${role}**: ${contentPreview}\n`;
      }

      // Aggiorna il riassunto della conversazione
      conversation.summary = summaryText;
      conversation.updatedAt = new Date().toISOString();

      // CRITICAL FIX: Remove old messages after summary is created
      // Keep only the last 10 messages to prevent indefinite accumulation
      conversation.messages = recentMessages;

      // Add max message limit: if messages exceed 500, trim the oldest
      if (conversation.messages.length > 500) {
        conversation.messages = conversation.messages.slice(-500);
      }

      this.save();
    } catch (err) {
      console.error(`Error during rollingSummary for ${convId}:`, err);
      // On error, restore from backup
      if (conversation && messages) {
        const messageBackup = JSON.parse(JSON.stringify(messages));
        conversation.messages = messageBackup;
      }
    } finally {
      // Always clear the mutex flag
      this._summarizingConversations.delete(convId);
    }
  }

  /**
   * Adaptive summary threshold based on message complexity
   * Short messages = higher threshold (less frequent summaries)
   * Long messages = lower threshold (more frequent summaries)
   */
  _adaptThreshold(conversation) {
    if (!conversation || !conversation.messages.length) return this._baseSummaryThreshold;
    const recentMsgs = conversation.messages.slice(-5);
    const avgLen = recentMsgs.reduce((sum, m) => sum + (m.content || '').length, 0) / recentMsgs.length;

    if (avgLen > 2000) return Math.max(6, this._baseSummaryThreshold - 4);  // Long msgs: summarize sooner
    if (avgLen > 500) return this._baseSummaryThreshold;                     // Normal
    if (avgLen < 100) return Math.min(20, this._baseSummaryThreshold + 5);   // Short msgs: wait longer
    return this._baseSummaryThreshold;
  }

  /**
   * Get prioritized messages for AI context
   * Tool results and system messages get lower priority
   * User messages and AI responses with actions get higher priority
   */
  getPrioritizedContext(convId, maxTokenEstimate = 4000) {
    const conversation = this.conversations.get(convId);
    if (!conversation) return '';

    const messages = conversation.messages;
    if (!messages.length) return conversation.summary || '';

    // Assign priority scores
    const scored = messages.map((msg, idx) => {
      let priority = 1;
      if (msg.role === 'user') priority = 3;
      if (msg.role === 'ai' && (msg.content || '').includes('tool_call')) priority = 2.5;
      if (msg.role === 'ai') priority = Math.max(priority, 2);
      if (msg.role === 'tool') priority = 0.5;
      if (msg.role === 'system') priority = 0.5;
      // Recency boost: last 5 messages get +2
      if (idx >= messages.length - 5) priority += 2;
      // Error messages get priority boost
      if ((msg.content || '').toLowerCase().includes('error')) priority += 0.5;
      return { ...msg, _priority: priority, _idx: idx };
    });

    // Sort by priority (descending), then by recency
    scored.sort((a, b) => b._priority - a._priority || b._idx - a._idx);

    // Fill context up to estimated token limit (~4 chars per token)
    let context = '';
    if (conversation.summary) {
      context += `[Summary] ${conversation.summary}\n\n`;
    }

    let usedChars = context.length;
    const maxChars = maxTokenEstimate * 4;
    const selectedMsgs = [];

    for (const msg of scored) {
      const line = `[${msg.role.toUpperCase()}]: ${msg.content || '(empty)'}\n`;
      if (usedChars + line.length > maxChars) continue;
      selectedMsgs.push({ ...msg, _line: line });
      usedChars += line.length;
    }

    // Re-sort selected by original index for chronological order
    selectedMsgs.sort((a, b) => a._idx - b._idx);
    context += selectedMsgs.map(m => m._line).join('');

    return context;
  }

  /**
   * Get conversation statistics
   */
  getConversationStats(convId) {
    const conv = this.conversations.get(convId);
    if (!conv) return null;

    const msgs = conv.messages;
    const roles = {};
    let totalLen = 0;
    msgs.forEach(m => {
      roles[m.role] = (roles[m.role] || 0) + 1;
      totalLen += (m.content || '').length;
    });

    return {
      messageCount: msgs.length,
      byRole: roles,
      avgMessageLength: msgs.length ? Math.round(totalLen / msgs.length) : 0,
      hasSummary: !!conv.summary,
      summaryLength: (conv.summary || '').length,
      adaptiveThreshold: this._adaptThreshold(conv),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  /**
   * Elimina una conversazione per ID
   * Cancella anche la ChatMemory associata
   */
  deleteConversation(convId) {
    if (this.conversations.has(convId)) {
      this.conversations.delete(convId);

      // Cancella ChatMemory
      if (this.chatMemories.has(convId)) {
        // Pulisci temp docs della sessione
        const chatMemory = this.chatMemories.get(convId);
        if (chatMemory && chatMemory._sessionId && typeof cobraTempDocs !== 'undefined') {
          cobraTempDocs.clearSession(chatMemory._sessionId).catch(e =>
            console.warn('[ConversationEngine] Failed to clear temp docs:', e.message)
          );
        }
        this.chatMemories.delete(convId);
      }

      // Se era la conversazione attiva, svuota activeConversationId
      if (this.activeConversationId === convId) {
        this.activeConversationId = null;
      }

      this.save();
    }
  }

  /**
   * Elenca tutte le conversazioni ordinate per updatedAt (decrescente)
   * Restituisce un array di conversazioni
   */
  listConversations() {
    const conversations = Array.from(this.conversations.values());
    return conversations.sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime();
      const timeB = new Date(b.updatedAt).getTime();
      return timeB - timeA; // Più recente prima
    });
  }

  /**
   * Esporta una conversazione come JSON
   * Utile per il backup o la condivisione
   */
  exportConversation(convId) {
    const conversation = this.conversations.get(convId);
    if (!conversation) {
      throw new Error(`Conversazione non trovata: ${convId}`);
    }

    // Crea una copia profonda per l'esportazione
    const exported = JSON.parse(JSON.stringify(conversation));

    // Aggiungi metadata di esportazione
    exported.exportedAt = new Date().toISOString();
    exported.exportedFrom = 'COBRA v4.0';

    return exported;
  }
}

// Rendi la classe disponibile globalmente per importScripts nel service worker
if (typeof self !== 'undefined') {
  self.ConversationEngine = ConversationEngine;
}
