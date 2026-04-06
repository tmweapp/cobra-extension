/**
 * COBRA v5.2 — Structured Error Codes
 * Centralized error code registry with severity levels and categories.
 * Every error in COBRA should reference a code from this file.
 */

const COBRA_ERRORS = Object.freeze({
  // ── General ──
  UNKNOWN:          { code: 'UNKNOWN',          severity: 'error',   category: 'general',    message: 'Errore sconosciuto' },
  INTERNAL:         { code: 'INTERNAL',         severity: 'error',   category: 'general',    message: 'Errore interno COBRA' },
  NOT_IMPLEMENTED:  { code: 'NOT_IMPLEMENTED',  severity: 'error',   category: 'general',    message: 'Funzionalità non implementata' },
  INVALID_ARGS:     { code: 'INVALID_ARGS',     severity: 'warn',    category: 'validation', message: 'Argomenti non validi' },
  MISSING_PARAM:    { code: 'MISSING_PARAM',    severity: 'warn',    category: 'validation', message: 'Parametro mancante' },

  // ── Tab / Browser ──
  NO_ACTIVE_TAB:    { code: 'NO_ACTIVE_TAB',    severity: 'warn',    category: 'browser',    message: 'Nessun tab attivo' },
  TAB_CLOSED:       { code: 'TAB_CLOSED',       severity: 'warn',    category: 'browser',    message: 'Tab chiuso prima del completamento' },
  TAB_LOAD_TIMEOUT: { code: 'TAB_LOAD_TIMEOUT', severity: 'warn',    category: 'browser',    message: 'Timeout caricamento pagina' },
  INJECT_FAILED:    { code: 'INJECT_FAILED',    severity: 'error',   category: 'browser',    message: 'Iniezione script fallita' },
  SCRIPT_TIMEOUT:   { code: 'SCRIPT_TIMEOUT',   severity: 'warn',    category: 'browser',    message: 'Timeout esecuzione script' },
  INVALID_URL:      { code: 'INVALID_URL',      severity: 'warn',    category: 'browser',    message: 'URL non valido' },

  // ── Selector / DOM ──
  SELECTOR_NOT_FOUND:   { code: 'SELECTOR_NOT_FOUND',   severity: 'warn',  category: 'dom', message: 'Elemento non trovato' },
  SELECTOR_AMBIGUOUS:   { code: 'SELECTOR_AMBIGUOUS',   severity: 'info',  category: 'dom', message: 'Selettore ambiguo — troppi match' },
  ELEMENT_NOT_VISIBLE:  { code: 'ELEMENT_NOT_VISIBLE',  severity: 'warn',  category: 'dom', message: 'Elemento non visibile' },
  ELEMENT_NOT_CLICKABLE:{ code: 'ELEMENT_NOT_CLICKABLE', severity: 'warn', category: 'dom', message: 'Elemento non cliccabile' },

  // ── Network / API ──
  NETWORK_ERROR:    { code: 'NETWORK_ERROR',    severity: 'error',   category: 'network',    message: 'Errore di rete' },
  API_ERROR:        { code: 'API_ERROR',        severity: 'error',   category: 'network',    message: 'Errore API' },
  API_RATE_LIMIT:   { code: 'API_RATE_LIMIT',   severity: 'warn',    category: 'network',    message: 'Rate limit raggiunto' },
  API_AUTH_FAILED:  { code: 'API_AUTH_FAILED',  severity: 'error',   category: 'network',    message: 'Autenticazione API fallita' },
  FETCH_TIMEOUT:    { code: 'FETCH_TIMEOUT',    severity: 'warn',    category: 'network',    message: 'Timeout richiesta HTTP' },

  // ── Policy / Security ──
  POLICY_BLOCKED:       { code: 'POLICY_BLOCKED',       severity: 'warn',  category: 'policy', message: 'Azione bloccata dalla policy' },
  POLICY_CONFIRM_NEEDED:{ code: 'POLICY_CONFIRM_NEEDED', severity: 'info', category: 'policy', message: 'Conferma utente richiesta' },
  DOMAIN_LOCKED:        { code: 'DOMAIN_LOCKED',        severity: 'warn',  category: 'policy', message: 'Dominio non consentito' },
  TRUST_INSUFFICIENT:   { code: 'TRUST_INSUFFICIENT',   severity: 'warn',  category: 'policy', message: 'Livello di trust insufficiente' },
  DANGEROUS_PATTERN:    { code: 'DANGEROUS_PATTERN',    severity: 'error', category: 'policy', message: 'Pattern pericoloso rilevato' },

  // ── Storage / Persistence ──
  STORAGE_FULL:     { code: 'STORAGE_FULL',     severity: 'error',   category: 'storage',    message: 'Storage pieno' },
  STORAGE_ERROR:    { code: 'STORAGE_ERROR',    severity: 'error',   category: 'storage',    message: 'Errore storage' },
  IDB_ERROR:        { code: 'IDB_ERROR',        severity: 'error',   category: 'storage',    message: 'Errore IndexedDB' },

  // ── Jobs ──
  JOB_NOT_FOUND:    { code: 'JOB_NOT_FOUND',    severity: 'warn',   category: 'jobs',       message: 'Job non trovato' },
  JOB_ALREADY_RUNNING:{ code: 'JOB_ALREADY_RUNNING', severity: 'info', category: 'jobs',     message: 'Job già in esecuzione' },
  JOB_STEP_FAILED:  { code: 'JOB_STEP_FAILED',  severity: 'warn',   category: 'jobs',       message: 'Step del job fallito' },
  JOB_CANCELLED:    { code: 'JOB_CANCELLED',    severity: 'info',    category: 'jobs',       message: 'Job cancellato' },
  JOB_MAX_RETRIES:  { code: 'JOB_MAX_RETRIES',  severity: 'error',  category: 'jobs',       message: 'Max tentativi raggiunto' },

  // ── Communication Hub ──
  COMM_NOT_CONFIGURED: { code: 'COMM_NOT_CONFIGURED', severity: 'warn', category: 'comms', message: 'Comunicazione non configurata' },
  COMM_SEND_FAILED:    { code: 'COMM_SEND_FAILED',    severity: 'error', category: 'comms', message: 'Invio messaggio fallito' },
  COMM_IMAP_ERROR:     { code: 'COMM_IMAP_ERROR',     severity: 'error', category: 'comms', message: 'Errore IMAP' },

  // ── KB ──
  KB_ENTRY_NOT_FOUND:  { code: 'KB_ENTRY_NOT_FOUND',  severity: 'info', category: 'kb', message: 'Entry KB non trovata' },
  KB_CONFLICT:         { code: 'KB_CONFLICT',         severity: 'warn', category: 'kb', message: 'Conflitto KB — entry duplicata' },
});

/**
 * Lookup error definition by code string
 * @param {string} code
 * @returns {Object} Error definition or UNKNOWN
 */
function getErrorDef(code) {
  return COBRA_ERRORS[code] || COBRA_ERRORS.UNKNOWN;
}

self.COBRA_ERRORS = COBRA_ERRORS;
self.getErrorDef = getErrorDef;
console.log('[cobra-error-codes.js] Loaded:', Object.keys(COBRA_ERRORS).length, 'error codes');
