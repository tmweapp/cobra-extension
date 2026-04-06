// COBRA v5.2 — Scraper Module
// Handles: scraping, crawling, screenshots, extraction
// Extracted from background.js

// Ensure CobraRouter is available
self.CobraRouter = self.CobraRouter || {};

// ============================================================
// UTILITIES
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Helper: esegui operazione su tab con try-finally cleanup
async function withTab(url, fn) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabLoad(tab.id);
    return await fn(tab);
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}

// URL validation
function isValidHttpUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function scrapeTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
  if (!results?.[0]?.result) throw new COBRAError('Nessun contenuto estratto', 'SCRAPE_EMPTY');
  return results[0].result;
}

async function extractLinks(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith('http'))
  });
  return results?.[0]?.result || [];
}

function relayLog(entry) {
  RELAY.log.unshift({ ...entry, ts: Date.now() });
  if (RELAY.log.length > 50) RELAY.log.pop();
}

// ============================================================
// SCRAPE PROTETTO (con cache + stealth)
// ============================================================
async function protectedScrape(url, options = {}) {
  const { cacheType = 'domain', skipCache = false } = options;
  if (!skipCache) {
    const cached = await Cache.get(cacheType, url);
    if (cached) return { ...cached, _fromCache: true };
  }
  const check = RateLimiter.canRequest(url);
  if (!check.allowed) {
    const wait = Math.min(check.retryAfter, 120000); // max 2 min wait
    await sleep(wait);
  }

  return await withTab(url, async (tab) => {
    await Stealth.browseNaturally(tab.id, { scroll: true, readTime: 'read' });
    await Stealth.domainAwareDelay(url);
    const result = await scrapeTab(tab.id);
    RateLimiter.recordRequest(url);
    if (!skipCache) await Cache.set(cacheType, url, result);
    return result;
  });
}

// Export utilities for other modules
self.sleep = sleep;
self.waitForTabLoad = waitForTabLoad;
self.withTab = withTab;
self.isValidHttpUrl = isValidHttpUrl;
self.scrapeTab = scrapeTab;
self.extractLinks = extractLinks;
self.protectedScrape = protectedScrape;

// ============================================================
// TYPE HANDLERS (COBRA protocol)
// ============================================================

self.CobraRouter.registerTypes({
  'SCRAPE_PAGE': async (payload) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          content: document.body.innerText,
          title: document.title,
          url: location.href,
          html: document.documentElement.outerHTML.slice(0, 50000)
        })
      });

      if (!results?.[0]?.result) throw new COBRAError('Nessun contenuto estratto', 'SCRAPE_EMPTY');

      const data = results[0].result;

      // Record selector stats for scrape success on this domain
      if (self.CobraSelectorStats && data.url) {
        try { self.CobraSelectorStats.recordSuccess(new URL(data.url).hostname, 'body.innerText', 1); } catch {}
      }

      return data;
    } catch (err) {
      throw new COBRAError(`Scrape fallito: ${err.message}`, 'SCRAPE_FAILED');
    }
  },

  'NAVIGATE': async (payload) => {
    try {
      const url = payload.url;
      if (!url) throw new COBRAError('URL mancante', 'INVALID_URL');
      if (!isValidHttpUrl(url)) throw new COBRAError('URL non valido', 'INVALID_URL');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');

      await chrome.tabs.update(tab.id, { url });
      return { ok: true, url };
    } catch (err) {
      throw new COBRAError(`Navigazione fallita: ${err.message}`, 'NAVIGATE_FAILED');
    }
  },

  'INSPECT_API': async (payload) => {
    return { ok: true, message: 'API Inspector avviato' };
  }
});

// ============================================================
// ACTION HANDLERS (legacy protocol)
// ============================================================

async function handleScrape(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');
  const url = tab.url;
  if (!msg.skipCache) {
    const cached = await Cache.get('domain', url);
    if (cached) return { ...cached, _fromCache: true };
  }
  const result = await scrapeTab(tab.id);
  RateLimiter.recordRequest(url);
  await Cache.set('domain', url, result);
  return result;
}

// ============================================================
// CRAWL (con stato persistente)
// ============================================================
const crawlState = {
  queue: [], visited: new Set(), results: [], running: false,
  config: { maxPages: 50, delay: 800, sameDomain: true, maxDepth: 3 },
};

async function handleCrawlStart(msg) {
  if (crawlState.running) throw new COBRAError('Crawl già in corso', 'CRAWL_RUNNING');
  if (!msg.url || !isValidHttpUrl(msg.url)) throw new COBRAError('URL non valido', 'INVALID_URL');

  const config = { ...crawlState.config, ...msg.config };
  crawlState.config = config;
  crawlState.running = true;
  crawlState.visited = new Set();
  crawlState.results = [];
  crawlState.queue = [{ url: msg.url, depth: 0 }];
  const startDomain = new URL(msg.url).hostname;

  (async () => {
    while (crawlState.queue.length > 0 && crawlState.running) {
      if (crawlState.results.length >= config.maxPages) break;
      const { url, depth } = crawlState.queue.shift();
      if (crawlState.visited.has(url) || depth > config.maxDepth) continue;
      crawlState.visited.add(url);

      let tab = null;
      try {
        const cached = await Cache.get('domain', url);
        if (cached) {
          crawlState.results.push({ url, depth, ...cached, _fromCache: true });
          broadcastProgress();
          continue;
        }
        const check = RateLimiter.canRequest(url);
        if (!check.allowed) await sleep(Math.min(check.retryAfter, 30000));
        await sleep(Stealth.gaussianRandom(config.delay, config.delay * 0.4));
        if (Stealth.shouldInsertNoise()) await Stealth.noiseDelay();
        const session = await Stealth.checkSession();
        if (session.shouldPause) await sleep(session.pauseMs);

        tab = await chrome.tabs.create({ url, active: false });
        await waitForTabLoad(tab.id);
        await Stealth.scrollTab(tab.id);
        await sleep(500 + Math.random() * 1000);
        const result = await scrapeTab(tab.id);
        const links = await extractLinks(tab.id);
        await chrome.tabs.remove(tab.id);
        tab = null; // Segnala che il tab è stato chiuso

        RateLimiter.recordRequest(url);
        await Cache.set('domain', url, result);
        crawlState.results.push({ url, depth, ...result });

        const newLinks = [];
        for (const link of links) {
          try {
            const lu = new URL(link);
            if (config.sameDomain && lu.hostname !== startDomain) continue;
            lu.hash = '';
            const clean = lu.href;
            if (crawlState.visited.has(clean) || /\.(pdf|jpg|png|gif|zip|mp4|mp3|exe|css|js)$/i.test(lu.pathname)) continue;
            newLinks.push({ url: clean, depth: depth + 1 });
          } catch {}
        }
        crawlState.queue.push(...Stealth.shuffleUrls(newLinks));
        broadcastProgress();
      } catch (err) {
        crawlState.results.push({ url, depth, error: err.message });
      } finally {
        // Cleanup: chiudi tab se ancora aperto
        if (tab?.id) {
          try { await chrome.tabs.remove(tab.id); } catch {}
        }
      }
    }
    crawlState.running = false;
    broadcastProgress();
  })();
  return { status: 'started', config };
}

async function handleCrawlStop() {
  crawlState.running = false;
  return { status: 'stopped', pages: crawlState.results.length };
}

async function handleCrawlStatus() {
  return {
    running: crawlState.running,
    visited: crawlState.visited.size,
    queued: crawlState.queue.length,
    results: crawlState.results.length,
    pages: crawlState.results,
  };
}

function broadcastProgress() {
  chrome.runtime.sendMessage({
    action: 'crawl-progress',
    visited: crawlState.visited.size,
    queued: crawlState.queue.length,
    results: crawlState.results.length,
    running: crawlState.running,
  }).catch(() => {});
}

// ============================================================
// MAP (con try-finally)
// ============================================================
async function handleMap(msg) {
  if (!msg.url || !isValidHttpUrl(msg.url)) throw new COBRAError('URL non valido', 'INVALID_URL');
  const startUrl = msg.url;
  const maxUrls = Math.min(msg.maxUrls || 200, 500);
  const startDomain = new URL(startUrl).hostname;
  const visited = new Set();
  const queue = [startUrl];
  const urlMap = [];

  while (queue.length > 0 && urlMap.length < maxUrls) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    const cacheKey = 'map:' + url;
    const cached = await Cache.get('search', cacheKey);
    if (cached) {
      urlMap.push(cached);
      if (cached.links) cached.links.forEach(l => { if (!visited.has(l)) queue.push(l); });
      continue;
    }

    const check = RateLimiter.canRequest(url);
    if (!check.allowed) await sleep(Math.min(check.retryAfter, 15000));

    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await waitForTabLoad(tab.id);
      await sleep(Stealth.gaussianRandom(1500, 500));

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          title: document.title,
          links: [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith('http')),
          meta: {
            description: document.querySelector('meta[name="description"]')?.content || '',
            type: document.querySelector('meta[property="og:type"]')?.content || 'page',
          }
        })
      });

      RateLimiter.recordRequest(url);
      const data = results?.[0]?.result;
      if (data) {
        const entry = { url, title: data.title, ...data.meta, linksCount: data.links.length, links: data.links };
        urlMap.push(entry);
        await Cache.set('search', cacheKey, entry);
        for (const link of data.links) {
          try {
            const u = new URL(link);
            if (u.hostname === startDomain && !visited.has(u.origin + u.pathname)) {
              queue.push(u.origin + u.pathname);
            }
          } catch {}
        }
      }
    } catch {} finally {
      if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
    }
  }
  return { urls: urlMap.map(({ links, ...rest }) => rest), total: urlMap.length };
}

// ============================================================
// BATCH (con try-finally per ogni tab)
// ============================================================
async function handleBatch(msg) {
  const urls = (msg.urls || []).filter(u => isValidHttpUrl(u));
  if (urls.length === 0) throw new COBRAError('Nessun URL valido', 'NO_URLS');
  const concurrency = Math.min(msg.concurrency || 3, 5);
  const results = [];
  const shuffled = Stealth.shuffleUrls(urls);

  for (let i = 0; i < shuffled.length; i += concurrency) {
    const batch = shuffled.slice(i, i + concurrency);
    const promises = batch.map(async (url) => {
      try {
        const cached = await Cache.get('domain', url);
        if (cached) return { url, ...cached, _fromCache: true };
        const check = RateLimiter.canRequest(url);
        if (!check.allowed) await sleep(Math.min(check.retryAfter, 15000));

        return await withTab(url, async (tab) => {
          await Stealth.browseNaturally(tab.id, { scroll: true, readTime: 'quick' });
          const result = await scrapeTab(tab.id);
          RateLimiter.recordRequest(url);
          await Cache.set('domain', url, result);
          return { url, ...result };
        });
      } catch (err) { return { url, error: err.message }; }
    });
    results.push(...await Promise.all(promises));
    if (i + concurrency < shuffled.length) await sleep(Stealth.gaussianRandom(3000, 1000));
  }
  return { results, total: results.length };
}

// ============================================================
// SCREENSHOT
// ============================================================
async function handleScreenshot(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');
  const format = msg.format || 'png';
  const quality = msg.quality || 90;
  if (msg.fullPage) return await captureFullPage(tab.id, format, quality);
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: format === 'jpg' ? 'jpeg' : 'png', quality });
  return { screenshot: dataUrl, format, url: tab.url, title: tab.title };
}

async function captureFullPage(tabId, format, quality) {
  const dims = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight })
  });
  const { scrollHeight, clientHeight } = dims[0].result;
  const screenshots = [];
  let scrollY = 0;
  let iterations = 0;
  const maxIterations = 50;  // Prevent infinite loop

  while (scrollY < scrollHeight && iterations < maxIterations) {
    iterations++;
    await chrome.scripting.executeScript({ target: { tabId }, func: (y) => window.scrollTo(0, y), args: [scrollY] });
    await sleep(200);
    screenshots.push({
      dataUrl: await chrome.tabs.captureVisibleTab(null, { format: format === 'jpg' ? 'jpeg' : 'png', quality }),
      scrollY,
    });
    scrollY += clientHeight;
  }
  await chrome.scripting.executeScript({ target: { tabId }, func: () => window.scrollTo(0, 0) });
  return { screenshots, format, totalHeight: scrollHeight, viewportHeight: clientHeight };
}

// ============================================================
// EXTRACT (con validazione schema + ReDoS protection)
// ============================================================
async function handleExtract(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');
  if (!msg.schema || typeof msg.schema !== 'object') {
    throw new COBRAError('Schema non valido', 'INVALID_SCHEMA');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (schema) => {
      const extracted = {};
      for (const [key, selector] of Object.entries(schema)) {
        // Validazione: key alfanumerico
        if (!/^[\w\-]+$/.test(key)) continue;
        // ReDoS protection: limit selector length
        if (selector.length > 200) continue;
        try {
          if (selector.startsWith('//')) {
            const r = document.evaluate(selector, document, null, XPathResult.STRING_TYPE, null);
            extracted[key] = r.stringValue.trim();
          } else if (selector.startsWith('regex:')) {
            const m = document.body.textContent.match(new RegExp(selector.replace('regex:', ''), 'i'));
            extracted[key] = m ? m[1] || m[0] : null;
          } else {
            const els = document.querySelectorAll(selector);
            extracted[key] = els.length === 0 ? null : els.length === 1 ? els[0].textContent.trim() : [...els].map(e => e.textContent.trim());
          }
        } catch {
          extracted[key] = null;
        }
      }
      return extracted;
    },
    args: [msg.schema]
  });
  return { data: results?.[0]?.result, url: tab.url };
}

// Register action handlers on CobraRouter
self.CobraRouter.registerActions({
  'scrape': handleScrape,
  'crawl-start': handleCrawlStart,
  'crawl-stop': handleCrawlStop,
  'crawl-status': handleCrawlStatus,
  'map': handleMap,
  'batch': handleBatch,
  'screenshot': handleScreenshot,
  'extract': handleExtract
});

console.log('[COBRA] Scraper module (bg-scraper.js) loaded');
