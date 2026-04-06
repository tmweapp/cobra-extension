// COBRA v5.2 — Knowledge Base, Gate, Conversation & ERNESTO Module
// Extracted handler registry for Knowledge Base, Gate Engine, Conversation, File Creator, ERNESTO, and Settings

async function getSettings() {
  return new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
}

self.CobraRouter = self.CobraRouter || {};

self.CobraRouter.registerTypes({
  // ============================================================
  // KNOWLEDGE BASE HANDLERS
  // ============================================================

  'KB_STATS': async () => self.cobraKB.getStats(),

  'KB_FIND_RULES': async (payload) => ({ rules: self.cobraKB.findRules(payload || {}) }),

  'KB_SEARCH': async (payload) => ({ rules: self.cobraKB.searchRules(payload.query) }),

  'KB_ADD_RULE': async (payload) => ({ rule: self.cobraKB.addRule(payload) }),

  'KB_FIND_PROMPTS': async (payload) => ({ prompts: self.cobraKB.findOperativePrompt(payload || {}) }),

  'KB_EXPORT': async () => {
    const data = self.cobraKB.exportAll();
    const json = JSON.stringify(data, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    chrome.downloads.download({ url: dataUrl, filename: 'cobra_kb_export.json', saveAs: true });
    return { ok: true };
  },

  'KB_SYNC_CLOUD': async () => {
    const settings = await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
    if (settings.supabaseUrl && settings.supabaseKey) {
      await self.cobraKBSync.uploadToSupabase(settings.supabaseUrl, settings.supabaseKey);
      await self.cobraKBSync.downloadFromSupabase(settings.supabaseUrl, settings.supabaseKey);
    }
    return { ok: true };
  },

  'KB_IMPORT': async (payload) => {
    // Import KB data from external source
    if (payload.rules && Array.isArray(payload.rules)) {
      for (const rule of payload.rules) {
        self.cobraKB.addRule(rule);
      }
    }
    return { ok: true, imported: payload.rules?.length || 0 };
  },

  'KB_RESEED': async () => {
    // Force re-seed from COBRA_KB_SEED
    if (typeof self.seedKBIfEmpty === 'function') {
      // Remove existing system entries first
      for (const rule of self.cobraKB.rules) {
        if (rule.source === 'system') rule.isActive = false;
      }
      await self.cobraKB.save();
      // Re-seed
      for (const entry of (self.COBRA_KB_SEED || [])) {
        self.cobraKB.addRule({
          domain: null,
          operationType: entry.operationType,
          ruleType: entry.ruleType,
          title: entry.title,
          content: entry.content,
          source: 'system',
          priority: entry.priority,
          tags: [...(entry.tags || []), entry.category],
          metadata: { category: entry.category, seedVersion: '5.2' }
        });
      }
      await self.cobraKB.save();
    }
    return { ok: true, total: self.cobraKB.rules.filter(r => r.isActive).length };
  },

  // ============================================================
  // GATE ENGINE HANDLERS
  // ============================================================

  'GATE_CREATE': async (payload) => self.cobraGate.createSession(payload),

  'GATE_ADVANCE': async (payload) => self.cobraGate.advanceGate(payload.sessionId, payload.completedCriteria),

  'GATE_BACK': async (payload) => self.cobraGate.goBackGate(payload.sessionId, payload.targetGateIdx),

  'GATE_SET_DATA': async (payload) => { self.cobraGate.setGateData(payload.sessionId, payload.data); return { ok: true }; },

  'GATE_CONTEXT': async (payload) => ({ context: self.cobraGate.buildGateContext(payload.sessionId) }),

  'GATE_SESSION': async (payload) => self.cobraGate.getSession(payload.sessionId),

  'GATE_ACTIVE': async () => ({ sessions: self.cobraGate.getActiveSessions() }),

  'GATE_ALL': async () => ({ sessions: self.cobraGate.getAllSessions() }),

  // ============================================================
  // CONVERSATION ENGINE HANDLERS
  // ============================================================

  'CONV_CREATE': async (payload) => self.cobraConversation.createConversation(payload.title, payload.metadata),

  'CONV_MESSAGE': async (payload) => self.cobraConversation.addMessage(payload.convId, payload.role, payload.content, payload.metadata),

  'CONV_GET': async (payload) => self.cobraConversation.getConversation(payload.convId),

  'CONV_ACTIVE': async () => self.cobraConversation.getActiveConversation(),

  'CONV_CONTEXT': async (payload) => ({ context: self.cobraConversation.buildContextForAI(payload.convId, payload.maxMessages) }),

  'CONV_LIST': async () => ({ conversations: self.cobraConversation.listConversations() }),

  // ============================================================
  // FILE CREATOR HANDLER
  // ============================================================

  'FILE_CREATE': async (payload) => {
    FileCreator.createFromTemplate(payload.type, payload.data);
    return { ok: true, filename: payload.data.filename };
  },

  // ============================================================
  // ERNESTO HANDLERS
  // ============================================================

  'ERNESTO_QUERY': async (payload) => {
    // Cerca nelle memorie cloud per rispondere
    const settings = await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
    if (!settings.supabaseUrl || !settings.supabaseKey) return { answer: 'ERNESTO non connesso. Configura Supabase in Connettori.' };
    try {
      const headers = { 'apikey': settings.supabaseKey, 'Authorization': `Bearer ${settings.supabaseKey}` };
      const res = await fetch(`${settings.supabaseUrl}/rest/v1/ernesto_memory_items?select=title,content&type=eq.pricelist&limit=5`, { headers });
      const data = await res.json();
      return { answer: `Ho trovato ${data.length} listini. Dati: ${JSON.stringify(data).slice(0, 500)}` };
    } catch (e) { return { answer: `Errore ERNESTO: ${e.message}` }; }
  },

  'ERNESTO_STATS': async () => {
    const settings = await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
    if (!settings.supabaseUrl || !settings.supabaseKey) return { listini: 0, prodotti: 0, regole: 0 };
    try {
      const headers = { 'apikey': settings.supabaseKey, 'Authorization': `Bearer ${settings.supabaseKey}` };
      const res = await fetch(`${settings.supabaseUrl}/rest/v1/ernesto_memory_items?select=type&limit=1000`, { headers });
      const data = await res.json();
      return {
        listini: data.filter(d => d.type === 'pricelist').length,
        prodotti: data.filter(d => d.type === 'product').length,
        regole: data.filter(d => d.type === 'kb_rule').length,
      };
    } catch { return { listini: 0, prodotti: 0, regole: 0 }; }
  },

  'ERNESTO_IMPORT': async (payload) => {
    // Salva in Supabase
    const settings = await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
    if (!settings.supabaseUrl || !settings.supabaseKey) throw new Error('Supabase non configurato');
    const headers = { 'Content-Type': 'application/json', 'apikey': settings.supabaseKey, 'Authorization': `Bearer ${settings.supabaseKey}` };
    await fetch(`${settings.supabaseUrl}/rest/v1/ernesto_memory_items`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: `Listino: ${payload.filename}`, content: payload.data, type: 'pricelist', tags: ['import', 'listino'], approved: true })
    });
    return { ok: true };
  },

  'ERNESTO_EXPORT': async () => {
    const settings = await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
    if (!settings.supabaseUrl || !settings.supabaseKey) return { ok: false };
    const headers = { 'apikey': settings.supabaseKey, 'Authorization': `Bearer ${settings.supabaseKey}` };
    const res = await fetch(`${settings.supabaseUrl}/rest/v1/ernesto_memory_items?type=eq.pricelist&select=*`, { headers });
    const data = await res.json();
    FileCreator.createJSON(data, 'ernesto_export.json');
    return { ok: true };
  },

  'ERNESTO_SYNC': async () => {
    await cobraKBSync.uploadToSupabase(
      (await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})))).supabaseUrl,
      (await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})))).supabaseKey
    );
    return { ok: true };
  },

  // ============================================================
  // SETTINGS HANDLER
  // ============================================================

  'SETTINGS_UPDATE': async (payload) => {
    await new Promise(r => chrome.storage.local.set({ cobra_settings: payload }, r));
    return { ok: true };
  },
});

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getSettings };
}
