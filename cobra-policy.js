/**
 * COBRA v5.2 — Policy Engine
 * Controls what tools can do based on trust levels, domain rules,
 * and confirmation requirements.
 *
 * Trust levels: 0 (untrusted) → 1 (basic) → 2 (standard) → 3 (trusted) → 4 (admin)
 * Domain locks: restrict certain tools to specific domains
 * Confirmation: require user approval for high-risk actions
 *
 * Ported from v10 with bug fixes:
 *   - Banking/social regex anchored properly (no false positives)
 *   - Confirmation tokens have TTL + single-use
 *   - Domain matching uses proper URL parsing
 */

const CobraPolicy = {
  // ── Trust Levels ──
  TRUST: Object.freeze({
    UNTRUSTED: 0,
    BASIC: 1,
    STANDARD: 2,
    TRUSTED: 3,
    ADMIN: 4
  }),

  // Current trust level (persisted in chrome.storage)
  _trustLevel: 2, // default: STANDARD

  // ── Domain Classification ──
  // Anchored regexes to avoid false positives (v10 bug fix)
  _sensitivePatterns: {
    banking: [
      /^(www\.)?([a-z0-9-]+\.)?(bank|banking|banca|fineco|intesasanpaolo|unicredit|bnl|mediolanum|postepay|poste)\./i,
      /^(www\.)?(paypal|stripe|wise|revolut|n26)\./i,
      /^(online|internet|home|my)?banking\./i
    ],
    social: [
      /^(www\.)?(facebook|fb|instagram|twitter|x|tiktok|snapchat|reddit)\.com$/i,
      /^(www\.)?(linkedin)\.com$/i
    ],
    auth: [
      /^(accounts|login|signin|auth|sso|oauth)\./i,
      /^(www\.)?(okta|auth0|keycloak)\./i
    ],
    email: [
      /^(mail|webmail|outlook|web\.whatsapp)\./i,
      /^(www\.)?gmail\.com$/i
    ]
  },

  // ── Tool Trust Requirements ──
  // Minimum trust level required to execute each tool
  _toolTrustMap: {
    // Safe tools — anyone can run
    navigate: 0, google_search: 0, read_page: 0, screenshot: 0,
    get_page_elements: 0, search_kb: 0, list_tasks: 0,
    list_local_files: 0, read_local_file: 0, search_local_files: 0,
    check_emails: 0, read_inbox: 0, batch_scrape: 0,
    scrape_url: 0, crawl_website: 0, extract_data: 0,

    // Risky tools — need STANDARD (2)
    click_element: 2, fill_form: 2, save_to_kb: 2, kb_update: 2,
    create_file: 2, create_task: 2, save_memory: 2,
    save_local_file: 2, kb_delete: 2,

    // Communication — need STANDARD (2) + confirmation
    send_email: 2, send_whatsapp: 2, send_linkedin: 2,

    // Destructive — need TRUSTED (3) + confirmation
    execute_js: 3
  },

  // ── Domain Lock Rules ──
  // Tools that can only operate on certain domains
  _domainLocks: {
    // send_whatsapp can only inject into WhatsApp Web
    send_whatsapp: { allow: [/^web\.whatsapp\.com$/i] },
    // send_linkedin can only inject into LinkedIn
    send_linkedin: { allow: [/^(www\.)?linkedin\.com$/i] },
  },

  // ── Confirmation Tokens ──
  // Single-use tokens with TTL (v10 bug fix: was missing expiry)
  _confirmationTokens: new Map(),
  _tokenTTL: 120000, // 2 minutes

  // ── Initialization ──
  async init() {
    try {
      const data = await chrome.storage.local.get('cobra_policy');
      if (data.cobra_policy) {
        this._trustLevel = data.cobra_policy.trustLevel ?? 2;
      }
    } catch (e) {
      console.warn('[CobraPolicy] Init failed, using defaults:', e.message);
    }
    console.log('[CobraPolicy] Initialized — trust level:', this._trustLevel);
  },

  async setTrustLevel(level) {
    if (level < 0 || level > 4) return false;
    this._trustLevel = level;
    await chrome.storage.local.set({ cobra_policy: { trustLevel: level } });
    return true;
  },

  getTrustLevel() {
    return this._trustLevel;
  },

  // ── Domain Analysis ──
  /**
   * Classify a URL's domain into categories
   * @param {string} url
   * @returns {{ hostname: string, categories: string[], isSensitive: boolean }}
   */
  classifyDomain(url) {
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return { hostname: url || '', categories: [], isSensitive: false };
    }

    const categories = [];
    for (const [cat, patterns] of Object.entries(this._sensitivePatterns)) {
      if (patterns.some(p => p.test(hostname))) {
        categories.push(cat);
      }
    }

    return {
      hostname,
      categories,
      isSensitive: categories.length > 0
    };
  },

  // ── Pre-Execution Policy Check ──
  /**
   * Check if a tool execution is allowed under current policy.
   * Returns Result.ok() if allowed, Result.fail() if blocked.
   *
   * @param {string} toolName
   * @param {Object} args
   * @param {Object} [context] - { url, tabId, confirmationToken }
   * @returns {Object} Result
   */
  check(toolName, args, context = {}) {
    const R = self.Result;
    const E = self.COBRA_ERRORS;

    // 1. Trust level check
    const requiredTrust = this._toolTrustMap[toolName];
    if (requiredTrust !== undefined && this._trustLevel < requiredTrust) {
      return R.fail(
        E.TRUST_INSUFFICIENT.code,
        `${toolName} richiede trust level ${requiredTrust}, attuale: ${this._trustLevel}`,
        { toolName, required: requiredTrust, current: this._trustLevel }
      );
    }

    // 2. Domain lock check
    const lock = this._domainLocks[toolName];
    if (lock && context.url) {
      let hostname;
      try { hostname = new URL(context.url).hostname.toLowerCase(); } catch { hostname = ''; }
      const allowed = lock.allow.some(p => p.test(hostname));
      if (!allowed) {
        return R.fail(
          E.DOMAIN_LOCKED.code,
          `${toolName} non consentito su ${hostname}`,
          { toolName, hostname, allowedPatterns: lock.allow.map(p => p.source) }
        );
      }
    }

    // 3. Sensitive domain warning (non-blocking, adds flag)
    let domainInfo = null;
    const urlToCheck = args.url || context.url;
    if (urlToCheck) {
      domainInfo = this.classifyDomain(urlToCheck);
    }

    // 4. Confirmation check for destructive/risky on sensitive domains
    const risk = (self.TOOL_RISK_MAP && self.TOOL_RISK_MAP[toolName]) || 'safe';
    const needsConfirm = risk === 'destructive' ||
      (risk === 'risky' && domainInfo?.isSensitive) ||
      ['send_email', 'send_whatsapp', 'send_linkedin'].includes(toolName);

    if (needsConfirm) {
      // Check for valid confirmation token
      if (context.confirmationToken) {
        const token = this._confirmationTokens.get(context.confirmationToken);
        if (token && token.toolName === toolName && Date.now() - token.ts < this._tokenTTL) {
          // Consume token (single-use — v10 bug fix)
          this._confirmationTokens.delete(context.confirmationToken);
          // Fall through — confirmed
        } else {
          // Token invalid or expired
          this._confirmationTokens.delete(context.confirmationToken);
          return R.fail(
            E.POLICY_CONFIRM_NEEDED.code,
            `Token di conferma non valido o scaduto per ${toolName}`,
            { toolName, needsConfirm: true }
          );
        }
      } else {
        // No token — generate one and ask for confirmation
        const newToken = this._generateToken(toolName);
        return R.fail(
          E.POLICY_CONFIRM_NEEDED.code,
          `${toolName} richiede conferma utente`,
          { toolName, needsConfirm: true, confirmationToken: newToken, domainInfo }
        );
      }
    }

    // 5. Dangerous pattern detection in args
    if (args.url) {
      // Block javascript: and data: URIs in navigation
      if (/^(javascript|data):/i.test(args.url)) {
        return R.fail(
          E.DANGEROUS_PATTERN.code,
          'URL con protocollo pericoloso bloccato',
          { url: args.url.substring(0, 100) }
        );
      }
    }

    if (args.code) {
      // Block chrome.* API access in execute_js
      if (/chrome\s*\.\s*(storage|runtime|tabs|extension|cookies)/i.test(args.code)) {
        return R.fail(
          E.DANGEROUS_PATTERN.code,
          'Accesso a Chrome API non consentito',
          { codeSnippet: args.code.substring(0, 200) }
        );
      }
    }

    return R.ok({
      allowed: true,
      toolName,
      risk,
      domainInfo,
      trustLevel: this._trustLevel
    });
  },

  // ── Confirmation Token Management ──
  _generateToken(toolName) {
    const token = `ct_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    this._confirmationTokens.set(token, { toolName, ts: Date.now() });

    // Cleanup expired tokens
    for (const [k, v] of this._confirmationTokens) {
      if (Date.now() - v.ts > this._tokenTTL) {
        this._confirmationTokens.delete(k);
      }
    }

    return token;
  },

  /**
   * Confirm a pending action (called from UI)
   */
  confirm(token) {
    return this._confirmationTokens.has(token);
  },

  /**
   * Get all pending confirmations
   */
  getPendingConfirmations() {
    const pending = [];
    for (const [token, data] of this._confirmationTokens) {
      if (Date.now() - data.ts < this._tokenTTL) {
        pending.push({ token, ...data, expiresIn: this._tokenTTL - (Date.now() - data.ts) });
      }
    }
    return pending;
  }
};

self.CobraPolicy = CobraPolicy;
console.log('[cobra-policy.js] Loaded: Policy Engine (trust/domain/confirm)');
