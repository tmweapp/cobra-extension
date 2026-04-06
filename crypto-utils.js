// COBRA v3 — Crypto Utilities
// AES-GCM per cifratura API keys, HMAC-SHA256 per relay commands

const CryptoUtils = {

  // ============================================================
  // HELPER: Unicode-safe Uint8Array to Base64 conversion
  // Chunks to avoid stack overflow on large data
  // ============================================================
  _uint8ArrayToBase64(arr) {
    const chunkSize = 8192;
    let result = '';
    for (let i = 0; i < arr.length; i += chunkSize) {
      const chunk = arr.slice(i, i + chunkSize);
      result += String.fromCharCode(...chunk);
    }
    return btoa(result);
  },

  _base64ToUint8Array(b64) {
    const binaryString = atob(b64);
    const arr = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      arr[i] = binaryString.charCodeAt(i);
    }
    return arr;
  },

  // ============================================================
  // 1. KEY DERIVATION — Genera chiave AES da passphrase
  // ============================================================
  async _deriveKey(passphrase, salt, iterations = 100000) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  // Genera o recupera la master key (basata su un ID unico per installazione)
  // master_id è equivalente a una passphrase — proteggerla come tale
  async _getMasterKey() {
    let stored = await chrome.storage.local.get(['fs_master_id', 'fs_pbkdf2_iterations']);

    if (!stored.fs_master_id) {
      // Prima installazione: genera ID casuale e salva con iteration count
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      stored.fs_master_id = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      const iterations = 100000;
      await chrome.storage.local.set({
        fs_master_id: stored.fs_master_id,
        fs_pbkdf2_iterations: iterations
      });
      stored.fs_pbkdf2_iterations = iterations;
    }

    // Se manca iteration count (vecchia installazione), usa default e aggiorna
    if (!stored.fs_pbkdf2_iterations) {
      stored.fs_pbkdf2_iterations = 100000;
      await chrome.storage.local.set({ fs_pbkdf2_iterations: 100000 });
    }

    // Genera salt fisso da master_id per coerenza
    const enc = new TextEncoder();
    const saltBase = enc.encode('firescrape-salt-' + stored.fs_master_id.slice(0, 16));
    const salt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      salt[i] = saltBase[i % saltBase.length];
    }

    return this._deriveKey(stored.fs_master_id, salt, stored.fs_pbkdf2_iterations);
  },

  // ============================================================
  // 2. ENCRYPT / DECRYPT — AES-GCM con salt casuale per ogni cifratura
  // ============================================================
  async encrypt(plaintext) {
    if (!plaintext) return null;
    const key = await this._getMasterKey();
    const enc = new TextEncoder();

    // Genera salt casuale per questa cifratura
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );

    // Restituisci salt + iv + ciphertext come base64
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

    return this._uint8ArrayToBase64(combined);
  },

  async decrypt(encryptedB64) {
    if (!encryptedB64) return null;
    try {
      const key = await this._getMasterKey();
      const combined = this._base64ToUint8Array(encryptedB64);

      // Estrai salt, iv e ciphertext
      const salt = combined.slice(0, 16);
      const iv = combined.slice(16, 28);
      const ciphertext = combined.slice(28);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return null; // Chiave cambiata o dati corrotti
    }
  },

  // ============================================================
  // 3. HMAC-SHA256 — Per firmare/verificare comandi relay
  // ============================================================
  async _getHmacKey(secret) {
    const enc = new TextEncoder();
    return crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign', 'verify']
    );
  },

  async sign(data, secret) {
    const key = await this._getHmacKey(secret);
    const enc = new TextEncoder();
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async verify(data, signatureHex, secret) {
    // Validazione: signatureHex deve avere lunghezza pari (2 char per byte)
    if (!signatureHex || typeof signatureHex !== 'string' || signatureHex.length % 2 !== 0) {
      return false;
    }

    try {
      const key = await this._getHmacKey(secret);
      const enc = new TextEncoder();

      // Parse hex string in modo safe
      const hexPairs = signatureHex.match(/.{2}/g);
      if (!hexPairs) return false;

      const sigBytes = new Uint8Array(hexPairs.map(h => parseInt(h, 16)));

      // Usa crypto.subtle.verify per timing-safe comparison
      const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));

      // Fallback check: se subtle.verify fallisce, ritorna false direttamente
      return isValid;
    } catch {
      return false;
    }
  },

  // ============================================================
  // 4. RELAY COMMAND VALIDATION
  // ============================================================
  ALLOWED_COMMAND_TYPES: new Set([
    'nav', 'click', 'type', 'read', 'wait', 'scroll',
    'select', 'formFill', 'snapshot', 'sequence',
    'scrape', 'screenshot'
  ]),

  MAX_SELECTOR_LENGTH: 1000,

  validateCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') {
      return { valid: false, reason: 'Comando non valido: non è un oggetto' };
    }
    if (!cmd.type || typeof cmd.type !== 'string') {
      return { valid: false, reason: 'Comando senza tipo' };
    }
    if (!this.ALLOWED_COMMAND_TYPES.has(cmd.type)) {
      return { valid: false, reason: `Tipo comando non permesso: ${cmd.type}` };
    }

    // Validazione specifica per tipo
    switch (cmd.type) {
      case 'nav':
        if (!cmd.url || typeof cmd.url !== 'string') {
          return { valid: false, reason: 'nav: URL mancante' };
        }
        try { new URL(cmd.url); } catch {
          return { valid: false, reason: 'nav: URL non valido' };
        }
        // Validazione case-insensitive per protocollo
        const urlLower = cmd.url.toLowerCase();
        if (!urlLower.startsWith('http://') && !urlLower.startsWith('https://')) {
          return { valid: false, reason: 'nav: solo HTTP/HTTPS permessi' };
        }
        break;

      case 'click':
      case 'read':
      case 'wait':
      case 'select':
        if (!cmd.selector) {
          return { valid: false, reason: `${cmd.type}: selettore mancante` };
        }
        if (typeof cmd.selector !== 'string' || cmd.selector.length > this.MAX_SELECTOR_LENGTH) {
          return { valid: false, reason: `${cmd.type}: selettore troppo lungo (max ${this.MAX_SELECTOR_LENGTH})` };
        }
        break;

      case 'scroll':
        // scroll non richiede selector
        break;

      case 'type':
        if (!cmd.selector) {
          return { valid: false, reason: 'type: selettore mancante' };
        }
        if (typeof cmd.selector !== 'string' || cmd.selector.length > this.MAX_SELECTOR_LENGTH) {
          return { valid: false, reason: `type: selettore troppo lungo (max ${this.MAX_SELECTOR_LENGTH})` };
        }
        if (typeof cmd.text !== 'string') {
          return { valid: false, reason: 'type: testo mancante' };
        }
        if (cmd.text.length > 5000) {
          return { valid: false, reason: 'type: testo troppo lungo (max 5000)' };
        }
        break;

      case 'formFill':
        if (!cmd.fields || typeof cmd.fields !== 'object') {
          return { valid: false, reason: 'formFill: campi mancanti' };
        }
        break;

      case 'sequence':
        if (!Array.isArray(cmd.steps)) {
          return { valid: false, reason: 'sequence: steps deve essere array' };
        }
        if (cmd.steps.length === 0) {
          return { valid: false, reason: 'sequence: steps non può essere vuoto' };
        }
        if (cmd.steps.length > 50) {
          return { valid: false, reason: 'sequence: max 50 step' };
        }
        // Validazione ricorsiva: verifica ogni step
        for (let i = 0; i < cmd.steps.length; i++) {
          const stepResult = this.validateCommand(cmd.steps[i]);
          if (!stepResult.valid) {
            return { valid: false, reason: `sequence step ${i}: ${stepResult.reason}` };
          }
        }
        break;
    }

    return { valid: true };
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.CryptoUtils = CryptoUtils;
}
