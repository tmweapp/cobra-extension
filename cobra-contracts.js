/**
 * COBRA v5.2 — Message Contracts & Validation
 * Valida tutti i messaggi in ingresso al router prima del dispatch.
 * Previene payload malformati, stringhe troppo lunghe, azioni sconosciute.
 */

const CobraContracts = {

  ALLOWED_TYPES: new Set([
    'CHAT_MESSAGE', 'CHAT_ABORT', 'CHAT_CLARIFY_REQUEST', 'CHAT_CLARIFY_RESPONSE',
    'SCRAPE', 'BATCH_SCRAPE', 'CRAWL',
    'GET_BRAIN', 'SET_BRAIN',
    'GET_SETTINGS', 'SET_SETTINGS',
    'TAB_INFO', 'PAGE_CONTEXT',
    'SUPERVISOR_HEALTH',
    'PING', 'HEALTH_CHECK',
    'REASONING_STEP', 'TOOL_WARN_CONFIRM'
  ]),

  ALLOWED_ACTIONS: new Set([
    'COMM_SEND_EMAIL', 'COMM_TEST', 'COMM_DISCOVER',
    'COMM_SEND_WA', 'COMM_WA_CHAT_LIST', 'COMM_WA_MESSAGES',
    'COMM_WA_OPEN_CHAT', 'COMM_WA_GET_CHATS',
    'COMM_SEND_LINKEDIN', 'COMM_CHECK_EMAILS',
    'FILE_LIST', 'FILE_READ', 'FILE_SEARCH', 'FILE_SAVE',
    'KB_SEARCH', 'KB_SAVE', 'KB_UPDATE', 'KB_DELETE', 'KB_RULES', 'KB_STATS',
    'KB_DETECT_WORKSPACE', 'KB_GET_WORKSPACE_CONTEXT', 'KB_ADD_RULE_AUTO', 'KB_CONFIRM_RULE', 'KB_DECAY_RULES',
    'JOB_CREATE', 'JOB_START', 'JOB_PAUSE', 'JOB_RESUME', 'JOB_CANCEL',
    'JOB_GET', 'JOB_LIST', 'PJOB_CREATE', 'PJOB_GET', 'PJOB_LIST',
    'PJOB_UPDATE', 'PJOB_DELETE', 'PJOB_RUN', 'PJOB_STOP',
    'PJOB_GET_ACTIVE_RUN', 'PJOB_ADD_RUN',
    'PERSIST_SAVE', 'PERSIST_GET', 'PERSIST_KEYS',
    'IDB_SAVE', 'IDB_GET', 'IDB_SEARCH', 'IDB_DELETE', 'IDB_CLEAR',
    'ORCHESTRATOR_RUN',
    'SELECTOR_STATS_GET', 'SELECTOR_STATS_RECORD',
    'SUPERVISOR_HEALTH',
    'GUARD_STATS', 'GUARD_RESET',
    'AUDIT_QUERY', 'AUDIT_STATS', 'AUDIT_EXPORT',
    'GET_BRAIN', 'SET_BRAIN',
    'TOOL_WARN_CONFIRM',
    'SESSION_START', 'SESSION_END', 'SESSION_APPEND_EVENT', 'SESSION_GET_BRIEFING',
    'SESSION_CONSOLIDATE', 'SESSION_LIST',
    'REMOTE_SEARCH', 'REMOTE_DEEP_READ', 'REMOTE_CONSOLIDATE', 'REMOTE_STATS',
  ]),

  MAX_MESSAGE_LENGTH: 50000,
  MAX_STRING: 5000,
  MAX_GOAL: 2000,
  MAX_SELECTOR: 500,
  MAX_URL: 2048,

  validateMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      return { ok: false, error: 'Messaggio deve essere un oggetto', code: 'INVALID_MESSAGE' };
    }
    if (!msg.type && !msg.action) {
      return { ok: false, error: 'Messaggio senza type né action', code: 'MISSING_ACTION' };
    }
    if (msg.type && !this.ALLOWED_TYPES.has(msg.type)) {
      return { ok: false, error: `Type non consentito: ${msg.type}`, code: 'UNKNOWN_TYPE' };
    }
    if (msg.action && !this.ALLOWED_ACTIONS.has(msg.action)) {
      return { ok: false, error: `Action non consentita: ${msg.action}`, code: 'UNKNOWN_ACTION' };
    }
    try {
      const size = JSON.stringify(msg).length;
      if (size > this.MAX_MESSAGE_LENGTH) {
        return { ok: false, error: `Messaggio troppo grande: ${size}/${this.MAX_MESSAGE_LENGTH}`, code: 'MESSAGE_TOO_LARGE' };
      }
    } catch {
      return { ok: false, error: 'Messaggio non serializzabile', code: 'INVALID_MESSAGE' };
    }
    return { ok: true };
  },

  validateChatPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'Chat payload richiesto', code: 'INVALID_PAYLOAD' };
    }
    if (typeof payload.message !== 'string' || !payload.message.trim()) {
      return { ok: false, error: 'Messaggio chat vuoto', code: 'EMPTY_MESSAGE' };
    }
    if (payload.message.length > this.MAX_GOAL) {
      return { ok: false, error: `Messaggio troppo lungo: ${payload.message.length}/${this.MAX_GOAL}`, code: 'MESSAGE_TOO_LONG' };
    }
    return { ok: true };
  },

  validateToolPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'Tool payload richiesto', code: 'INVALID_PAYLOAD' };
    }
    if (payload.selector && (typeof payload.selector !== 'string' || payload.selector.length > this.MAX_SELECTOR)) {
      return { ok: false, error: 'Selettore non valido o troppo lungo', code: 'INVALID_SELECTOR' };
    }
    if (payload.url && (typeof payload.url !== 'string' || payload.url.length > this.MAX_URL)) {
      return { ok: false, error: 'URL non valido o troppo lungo', code: 'INVALID_URL' };
    }
    if (payload.text && (typeof payload.text !== 'string' || payload.text.length > this.MAX_STRING)) {
      return { ok: false, error: 'Testo troppo lungo', code: 'TEXT_TOO_LONG' };
    }
    return { ok: true };
  },

  sanitize(text) {
    if (typeof text !== 'string') return text;
    return text
      .replace(/[\w.-]+@[\w.-]+\.\w{2,}/g, '[EMAIL]')
      .replace(/\b\d{10,}\b/g, '[NUMBER]')
      .replace(/\b[A-Za-z0-9]{20,}\b/g, '[TOKEN]')
      .substring(0, 2000);
  },

  isValidString(val, maxLen = 2000) {
    return typeof val === 'string' && val.length > 0 && val.length <= maxLen;
  }
};

self.CobraContracts = CobraContracts;
console.log('[cobra-contracts.js] Loaded: Message validation (' +
  CobraContracts.ALLOWED_TYPES.size + ' types, ' +
  CobraContracts.ALLOWED_ACTIONS.size + ' actions)');
