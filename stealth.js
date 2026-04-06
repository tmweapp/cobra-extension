// COBRA v3 — Stealth Module
// Comportamento naturale: delay, scroll, navigazione umana
// Fix: domain matching case-insensitive con endsWith

const Stealth = {

  // ============================================================
  // 1. DELAY UMANI (distribuzione gaussiana)
  // ============================================================
  gaussianRandom(mean, stdDev) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    // Use sensible floor instead of clamping to 0
    return Math.max(mean * 0.1, mean + z * stdDev);
  },

  async humanDelay(type = 'read') {
    const profiles = {
      quick:    { mean: 1500,  std: 500  },
      read:     { mean: 4000,  std: 1500 },
      think:    { mean: 7000,  std: 2500 },
      navigate: { mean: 2500,  std: 800  },
      scroll:   { mean: 800,   std: 300  },
      type:     { mean: 150,   std: 60   },
    };
    const p = profiles[type] || profiles.read;
    const delay = this.gaussianRandom(p.mean, p.std);
    return new Promise(resolve => setTimeout(resolve, delay));
  },

  // ============================================================
  // 2. SCROLL NATURALE
  // ============================================================
  getScrollScript() {
    return function() {
      return new Promise(resolve => {
        const totalHeight = document.documentElement.scrollHeight;
        const viewHeight = window.innerHeight;
        let currentY = 0;
        const targetY = Math.min(totalHeight * 0.7, viewHeight * 3);

        function scrollStep() {
          if (currentY >= targetY) { resolve(); return; }
          const progress = currentY / targetY;
          let speed;
          if (progress < 0.2) speed = 40 + Math.random() * 30;
          else if (progress < 0.8) speed = 80 + Math.random() * 60;
          else speed = 30 + Math.random() * 20;

          currentY += speed;
          window.scrollTo({ top: currentY, behavior: 'auto' });
          const pause = Math.random() < 0.1 ? 800 + Math.random() * 1500 : 30 + Math.random() * 80;
          setTimeout(scrollStep, pause);
        }
        scrollStep();
      });
    };
  },

  async scrollTab(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: this.getScrollScript(),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ============================================================
  // 3. NAVIGAZIONE NON LINEARE
  // ============================================================
  shuffleUrls(urls) {
    const arr = [...urls];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  shouldInsertNoise() {
    return Math.random() < 0.10;
  },

  async noiseDelay() {
    const delay = 5000 + Math.random() * 10000;
    return new Promise(resolve => setTimeout(resolve, delay));
  },

  // ============================================================
  // 4. SESSION MANAGEMENT
  // ============================================================
  sessionLimits: {
    maxPagesPerSession: 15,
    sessionPauseMinutes: 5,
    maxSessionsPerHour: 3,
    currentSession: { pages: 0, startTime: Date.now() },
  },

  async init() {
    try {
      const stored = await chrome.storage.local.get('stealth_session');
      if (stored.stealth_session) {
        this.sessionLimits.currentSession = stored.stealth_session;
      }
    } catch (err) {
      console.error('Failed to restore stealth session:', err);
    }
  },

  async _persistSession() {
    try {
      await chrome.storage.local.set({ stealth_session: this.sessionLimits.currentSession });
    } catch (err) {
      console.error('Failed to persist stealth session:', err);
    }
  },

  async checkSession() {
    const s = this.sessionLimits;
    s.currentSession.pages++;
    await this._persistSession();

    if (s.currentSession.pages >= s.maxPagesPerSession) {
      const pauseMs = s.sessionPauseMinutes * 60 * 1000 * (0.8 + Math.random() * 0.4);
      s.currentSession.pages = 0;
      s.currentSession.startTime = Date.now() + pauseMs;
      await this._persistSession();
      return { shouldPause: true, pauseMs };
    }
    return { shouldPause: false };
  },

  // ============================================================
  // 5. FINGERPRINT
  // ============================================================
  getFingerprint() {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      cookiesEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },

  // ============================================================
  // 6. BROWSE NATURALLY
  // ============================================================
  async browseNaturally(tabId, options = {}) {
    const { scroll = true, readTime = 'read', checkLimits = true } = options;

    let cumulativeDelay = 0;
    const maxTotalWait = 60000; // 60 seconds max total wait

    if (checkLimits) {
      const session = await this.checkSession();
      if (session.shouldPause) {
        const waitTime = Math.min(session.pauseMs, maxTotalWait - cumulativeDelay);
        await new Promise(r => setTimeout(r, waitTime));
        cumulativeDelay += waitTime;
      }
    }

    const quickDelay = 1500 + Math.random() * 500;
    await new Promise(r => setTimeout(r, quickDelay));
    cumulativeDelay += quickDelay;

    if (scroll && cumulativeDelay < maxTotalWait) {
      const scrollResult = await this.scrollTab(tabId);
      if (!scrollResult.ok) {
        console.warn('Scroll failed:', scrollResult.error);
      }
    }

    const readDelay = Math.min(4000 + Math.random() * 1500, maxTotalWait - cumulativeDelay);
    await new Promise(r => setTimeout(r, readDelay));
    cumulativeDelay += readDelay;

    if (this.shouldInsertNoise() && cumulativeDelay < maxTotalWait) {
      const noiseDelay = Math.min(5000 + Math.random() * 10000, maxTotalWait - cumulativeDelay);
      await new Promise(r => setTimeout(r, noiseDelay));
    }
  },

  // ============================================================
  // 7. DOMAIN-AWARE BEHAVIOR
  // Fix: case-insensitive matching con endsWith
  // ============================================================
  domainProfiles: {
    'linkedin.com':  { delayMultiplier: 2.5, maxPerHour: 20,  scrollDepth: 0.3 },
    'facebook.com':  { delayMultiplier: 2.0, maxPerHour: 15,  scrollDepth: 0.3 },
    'default':       { delayMultiplier: 1.0, maxPerHour: 60,  scrollDepth: 0.7 },
  },

  getProfile(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      for (const [domain, profile] of Object.entries(this.domainProfiles)) {
        if (domain === 'default') continue;
        // endsWith per match corretto (es. "it.linkedin.com" → "linkedin.com")
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          return profile;
        }
      }
    } catch {}
    return this.domainProfiles.default;
  },

  async domainAwareDelay(url, type = 'read') {
    const profile = this.getProfile(url);
    const baseDelay = this.gaussianRandom(4000, 1500);
    const finalDelay = baseDelay * profile.delayMultiplier;
    return new Promise(resolve => setTimeout(resolve, finalDelay));
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.Stealth = Stealth;
}
