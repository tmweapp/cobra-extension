// COBRA v5.2 — Centralized Constants
// All magic numbers and default values in one place.

const COBRA_DEFAULTS = Object.freeze({
  // AI Provider defaults
  OPENAI_MODEL: 'gpt-4o-mini',
  ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
  GEMINI_MODEL: 'gemini-2.0-flash',
  GROQ_MODEL: 'llama-3.3-70b-versatile',
  ELEVENLABS_MODEL: 'eleven_multilingual_v2',
  ELEVENLABS_VOICE_ID: 'uScy1bXtKz8vPzfdFsFw',

  // Timeouts (ms)
  SCRIPT_EXECUTION_TIMEOUT: 15000,
  TAB_LOAD_TIMEOUT: 30000,
  FETCH_TIMEOUT: 30000,

  // Limits
  MAX_CHAT_HISTORY: 200,
  MAX_SELECTOR_LENGTH: 500,
  MAX_JS_CODE_LENGTH: 10000,
  MAX_SEARCH_QUERY_LENGTH: 1000,
  ACTION_LOG_MAX_SIZE: 50,

  // Rate limiting
  DEFAULT_RATE_LIMIT_MODE: 'balanced',

  // Persistence keys
  STORAGE_KEYS: Object.freeze({
    CHAT_HISTORY: 'cobra_chat_history',
    MEMORIES: 'cobra_memories',
    HABITS: 'cobra_habits',
    SETTINGS: 'cobra_settings',
    AGENTS: 'cobra_agents',
    LEADER: 'cobra_leader',
    POLICY: 'cobra_policy',
  }),

  // Language
  DEFAULT_LANGUAGE: 'it',

  // Voice
  DEFAULT_VOICE_SPEED: '1.0',

  // Selector Stats
  SELECTOR_STATS_FLUSH_INTERVAL: 60000,
  SELECTOR_STATS_TTL_DAYS: 30,
  SELECTOR_STATS_MAX_PER_DOMAIN: 200,

  // Policy
  DEFAULT_TRUST_LEVEL: 2,
  CONFIRMATION_TOKEN_TTL: 120000,

  // Jobs
  JOB_MAX_RETRIES: 3,
});

// Make available in both service worker and page contexts
if (typeof self !== 'undefined') self.COBRA_DEFAULTS = COBRA_DEFAULTS;
if (typeof window !== 'undefined') window.COBRA_DEFAULTS = COBRA_DEFAULTS;
