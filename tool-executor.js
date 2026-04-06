/**
 * COBRA v5.2 — Tool Executor
 * Executes browser tools called by the AI.
 * Extracted from bg-chat.js for modularity.
 *
 * Requires: self.cobraKB, self.isValidHttpUrl, self.waitForTabLoad, self.sleep
 */

// ============================================================
// Timeout wrapper for chrome.scripting.executeScript
// ============================================================
async function execScriptWithTimeout(tabId, func, args = [], timeout = 15000) {
  return Promise.race([
    chrome.scripting.executeScript({ target: { tabId }, func, args }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Script execution timeout (' + timeout + 'ms)')), timeout))
  ]);
}

// ============================================================
// Tool Safety Layer — Validation
// ============================================================
function validateToolArgs(name, args) {
  const validators = {
    'navigate': (a) => a.url && /^https?:\/\//.test(a.url),
    'click_element': (a) => a.selector && a.selector.length < 500,
    'fill_form': (a) => a.fields && (typeof a.fields === 'object' || a.fields.length < 5000),
    'execute_js': (a) => a.code && a.code.length < 10000,
    'scrape_url': (a) => a.url && /^https?:\/\//.test(a.url),
    'google_search': (a) => a.query && a.query.length < 1000
  };
  const v = validators[name];
  return v ? v(args) : true;
}

// ============================================================
// Action log for audit trail
// ============================================================
const actionLog = [];
function logAction(tool, args, result, tabId) {
  actionLog.push({
    tool,
    args,
    result,
    timestamp: new Date().toISOString(),
    tabId
  });
  if (actionLog.length > 50) {
    actionLog.shift();
  }
}

// ============================================================
// Auto-dismiss cookie/privacy popups
// ============================================================
async function dismissCookiePopups(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Common cookie consent selectors (covers 95%+ of sites)
        const selectors = [
          // Buttons by text content
          ...['Accetta', 'Accetta tutti', 'Accept', 'Accept all', 'Accept All', 'Accept All Cookies',
           'Agree', 'Agree & Continue', 'OK', 'Got it', 'I Agree', 'Allow All', 'Allow all cookies',
           'Consenti', 'Consenti tutto', 'Accetto', 'Ho capito', 'Va bene', 'Continua',
           'Tout accepter', 'Akzeptieren', 'Alle akzeptieren', 'Aceptar todo',
           'Reject All', 'Reject all', 'Rifiuta tutti', 'Rifiuta', 'Decline', 'Decline All',
           'Solo necessari', 'Only necessary', 'Nur notwendige'].map(text => `button`),
          // Common IDs and classes
          '#onetrust-accept-btn-handler',
          '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
          '#CybotCookiebotDialogBodyButtonDecline',
          '.cookie-consent-accept',
          '.cc-accept', '.cc-dismiss', '.cc-allow',
          '[data-testid="cookie-policy-manage-dialog-btn-accept"]',
          '[data-cookiebanner="accept_button"]',
          '.js-cookie-consent-agree',
          '#cookie-consent-accept', '#accept-cookies', '#acceptCookies',
          '.gdpr-accept', '.gdpr-consent-accept',
          '#didomi-notice-agree-button',
          '.fc-cta-consent', '.fc-primary-button',
          '#sp-cc-accept', // Amazon
          '[aria-label="Accept cookies"]', '[aria-label="Accetta cookie"]',
          '.qc-cmp2-summary-buttons button:first-child',
          '#consent-accept', '#consent_accept',
          '.iubenda-cs-accept-btn',
          '#truste-consent-button',
          '.evidon-banner-acceptbutton',
        ];

        // Strategy 1: Try common selectors directly
        for (const sel of selectors) {
          try {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
              btn.click();
              return { dismissed: true, method: 'selector', selector: sel };
            }
          } catch {}
        }

        // Strategy 2: Find buttons by text content
        const acceptTexts = [
          'accetta', 'accept', 'agree', 'consenti', 'allow', 'ok', 'got it',
          'ho capito', 'va bene', 'continua', 'continue', 'akzeptieren',
          'tout accepter', 'aceptar', 'rifiuta tutti', 'reject all', 'decline all',
          'solo necessari', 'only necessary'
        ];

        const buttons = document.querySelectorAll('button, a[role="button"], [class*="cookie"] button, [class*="consent"] button, [class*="privacy"] button, [id*="cookie"] button');
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text.length > 0 && text.length < 50 && acceptTexts.some(t => text.includes(t))) {
            if (btn.offsetParent !== null) {
              btn.click();
              return { dismissed: true, method: 'text_match', text: btn.textContent.trim() };
            }
          }
        }

        // Strategy 3: Remove common overlay elements entirely
        const overlaySelectors = [
          '#onetrust-banner-sdk', '#onetrust-consent-sdk',
          '#CybotCookiebotDialog', '.CookieConsent',
          '#cookie-law-info-bar', '.cookie-banner',
          '#gdpr-cookie-notice', '.cc-window',
          '#didomi-host', '.fc-consent-root',
          '[class*="cookie-banner"]', '[class*="cookie-consent"]',
          '[class*="gdpr-banner"]', '[id*="cookie-banner"]',
        ];

        for (const sel of overlaySelectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              el.remove();
              // Also restore body scroll
              document.body.style.overflow = '';
              document.documentElement.style.overflow = '';
              return { dismissed: true, method: 'overlay_remove', selector: sel };
            }
          } catch {}
        }

        return { dismissed: false };
      }
    });
  } catch (e) {
    // Non-critical, ignore errors
  }
}
self.dismissCookiePopups = dismissCookiePopups;

// ============================================================
// Deep Page Expansion — Open all hidden content before reading
// ============================================================
async function expandPageContent(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        let expanded = 0;

        // 1. Open all <details> elements
        document.querySelectorAll('details:not([open])').forEach(el => {
          el.setAttribute('open', '');
          expanded++;
        });

        // 2. Click all accordion triggers (common patterns)
        const accordionSelectors = [
          '[data-toggle="collapse"]:not(.show)',
          '[aria-expanded="false"]',
          '.accordion-button.collapsed',
          '.collapse-trigger:not(.active)',
          '[class*="accordion"]:not([class*="open"]):not([class*="active"])',
          '[class*="expandable"]:not([class*="expanded"])',
          '.faq-question', '.faq-toggle',
          '[class*="toggle"]:not(.active):not(.open)',
        ];
        for (const sel of accordionSelectors) {
          document.querySelectorAll(sel).forEach(el => {
            try {
              el.click();
              expanded++;
            } catch {}
          });
        }

        // 3. Open all dropdown menus / select options visibility
        document.querySelectorAll('select').forEach(sel => {
          const options = [];
          sel.querySelectorAll('option').forEach(opt => {
            options.push({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected });
          });
          // Store options as data attribute for AI to read
          sel.setAttribute('data-cobra-options', JSON.stringify(options));
          expanded++;
        });

        // 4. Click tab triggers to reveal all tab content
        const tabSelectors = [
          '[role="tab"]',
          '.nav-tabs .nav-link',
          '.tab-button', '.tab-trigger',
          '[data-toggle="tab"]', '[data-bs-toggle="tab"]',
        ];
        const clickedTabs = new Set();
        for (const sel of tabSelectors) {
          document.querySelectorAll(sel).forEach(el => {
            const id = el.getAttribute('data-target') || el.getAttribute('href') || el.id;
            if (!clickedTabs.has(id)) {
              try { el.click(); clickedTabs.add(id); expanded++; } catch {}
            }
          });
        }

        // 5. Expand "Show more" / "Read more" buttons
        const showMoreTexts = ['show more', 'read more', 'see more', 'load more', 'view all',
          'mostra tutto', 'vedi tutto', 'leggi tutto', 'carica altro', 'espandi',
          'mehr anzeigen', 'voir plus', 'ver más'];
        document.querySelectorAll('button, a, span[role="button"]').forEach(el => {
          const text = (el.textContent || '').trim().toLowerCase();
          if (text.length < 30 && showMoreTexts.some(t => text.includes(t))) {
            try { el.click(); expanded++; } catch {}
          }
        });

        // 6. Force-show hidden elements that might contain content
        document.querySelectorAll('[style*="display: none"], [style*="display:none"], .hidden, .d-none, [hidden]').forEach(el => {
          // Only show if it looks like content (not modals/overlays)
          if (el.textContent.length > 50 && !el.classList.contains('modal') && !el.classList.contains('overlay')) {
            el.style.display = '';
            el.removeAttribute('hidden');
            el.classList.remove('hidden', 'd-none');
            expanded++;
          }
        });

        // 7. Gather all select/dropdown options into a readable summary
        const dropdownSummary = [];
        document.querySelectorAll('select').forEach(sel => {
          const label = sel.getAttribute('aria-label') || sel.getAttribute('name') || sel.id || 'select';
          const opts = Array.from(sel.options).map(o => o.textContent.trim()).filter(t => t);
          if (opts.length > 0) {
            dropdownSummary.push(`[${label}]: ${opts.join(', ')}`);
          }
        });

        return { expanded, dropdownSummary };
      }
    });
    return result?.[0]?.result || { expanded: 0, dropdownSummary: [] };
  } catch (e) {
    return { expanded: 0, dropdownSummary: [], error: e.message };
  }
}
self.expandPageContent = expandPageContent;

// ============================================================
// Main tool executor
// ============================================================
async function executeToolCall(name, args) {
  const startTime = Date.now();

  // Validate tool arguments before execution
  if (!validateToolArgs(name, args)) {
    const error = JSON.stringify({ error: `Argomenti non validi per ${name}` });
    console.error(`[TOOL-VALIDATION] ${name} failed validation:`, args);
    return error;
  }

  try {
    let result;
    switch (name) {
      case 'navigate': {
        const url = args.url;
        if (!self.isValidHttpUrl(url)) return JSON.stringify({ error: 'URL non valido' });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        await chrome.tabs.update(tab.id, { url });
        await self.waitForTabLoad(tab.id);
        // Auto-dismiss cookie/privacy popups before reading content
        await self.sleep(800);
        await dismissCookiePopups(tab.id);
        await self.sleep(300);
        // Expand hidden content (dropdowns, accordions, tabs)
        await expandPageContent(tab.id);
        await self.sleep(300);
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            title: document.title,
            url: location.href,
            text: document.body.innerText.substring(0, 8000)
          })
        });
        const pageData = results?.[0]?.result || {};
        return JSON.stringify({ ok: true, title: pageData.title, url: pageData.url, preview: (pageData.text || '').substring(0, 2000) });
      }

      case 'google_search': {
        const query = encodeURIComponent(args.query);
        const searchUrl = `https://www.google.com/search?q=${query}&hl=it`;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        await chrome.tabs.update(tab.id, { url: searchUrl });
        await self.waitForTabLoad(tab.id);
        await self.sleep(800);
        await dismissCookiePopups(tab.id);
        await self.sleep(700);
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const items = [];
            document.querySelectorAll('div.g, div[data-sokoban-container]').forEach((el, i) => {
              if (i >= 10) return;
              const titleEl = el.querySelector('h3');
              const linkEl = el.querySelector('a[href]');
              const snippetEl = el.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]');
              if (titleEl && linkEl) {
                items.push({
                  title: titleEl.textContent.trim(),
                  url: linkEl.href,
                  snippet: snippetEl?.textContent?.trim() || ''
                });
              }
            });
            // Also grab featured snippets, knowledge panels
            const featured = document.querySelector('[data-attrid], .hgKElc, .IZ6rdc');
            const featuredText = featured ? featured.textContent.trim().substring(0, 500) : '';
            return { results: items, featured: featuredText, pageText: document.body.innerText.substring(0, 6000) };
          }
        });
        const searchData = results?.[0]?.result || { results: [], pageText: '' };
        return JSON.stringify(searchData);
      }

      case 'read_page': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            title: document.title,
            url: location.href,
            lang: document.documentElement.lang || 'unknown',
            text: document.body.innerText.substring(0, 4000)
          })
        });
        return JSON.stringify(results?.[0]?.result || { error: 'Nessun contenuto' });
      }

      case 'scrape_url': {
        const url = args.url;
        if (!self.isValidHttpUrl(url)) return JSON.stringify({ error: 'URL non valido' });
        let tab = null;
        try {
          tab = await chrome.tabs.create({ url, active: false });
          await self.waitForTabLoad(tab.id);
          await self.sleep(1000);
          // Expand hidden content (dropdowns, accordions, tabs)
          await expandPageContent(tab.id);
          await self.sleep(300);
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({
              title: document.title,
              url: location.href,
              text: document.body.innerText.substring(0, 10000)
            })
          });
          return JSON.stringify(results?.[0]?.result || { error: 'Nessun contenuto' });
        } finally {
          if (tab?.id) try { await chrome.tabs.remove(tab.id); } catch {}
        }
      }

      case 'execute_js': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });

        const code = args.code;
        if (!code || typeof code !== 'string') {
          return JSON.stringify({ error: 'Codice non valido' });
        }

        // Input validation: reject dangerous patterns
        const dangerousPatterns = [
          /chrome\s*\.\s*storage/i,
          /chrome\s*\.\s*runtime/i,
          /chrome\s*\.\s*tabs/i,
          /fetch\s*\(\s*['"](?!https?:\/\/[a-zA-Z0-9._-]+[a-zA-Z0-9._-]*\.(?:[a-zA-Z]{2,}|localhost))/i,
          /XMLHttpRequest/i
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(code)) {
            return JSON.stringify({ error: 'Accesso a risorse non permesse' });
          }
        }

        // Code size limit: max 10000 chars
        if (code.length > 10000) {
          return JSON.stringify({ error: 'Codice troppo lungo (max 10000 caratteri)' });
        }

        // Content scripts CAN use new Function/eval in MV3 (isolated world).
        // But service worker CANNOT — so we pass code as string arg and eval inside content script.
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (codeStr) => {
            try {
              const fn = new Function(codeStr);
              return fn();
            } catch(e) {
              // Fallback: try MAIN world via script tag with blob URL
              try {
                const id = '__cobra_' + Date.now();
                const blob = new Blob([
                  `try{window["${id}"]=(function(){${codeStr}})()}catch(e){window["${id}"]={error:e.message}}`
                ], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                const s = document.createElement('script');
                s.src = url;
                document.documentElement.appendChild(s);
                s.remove();
                URL.revokeObjectURL(url);
                const r = window[id];
                delete window[id];
                return r !== undefined ? r : { ok: true };
              } catch(e2) {
                return { error: e2.message };
              }
            }
          },
          args: [code]
        });
        const result = results?.[0]?.result;
        return JSON.stringify(result !== undefined ? result : { ok: true });
      }

      case 'screenshot': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 90 });
        return JSON.stringify({ ok: true, screenshot: dataUrl.substring(0, 100) + '...', message: 'Screenshot catturato e disponibile.' });
      }

      case 'click_element': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        const selector = args.selector;

        // Helper function for click logic (reused for main frame + iframes)
        const clickFunc = async (sel) => {
          const findElement = (root) => {
            let el = null;
            if (sel.startsWith('text:')) {
              const searchText = sel.substring(5).toLowerCase().trim();
              const allEls = root.querySelectorAll('a, button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], [onclick], [data-action], [tabindex], span, div, li, p, label, [class*="btn"], [class*="button"], [class*="accept"], [class*="consent"], [class*="agree"], [id*="accept"], [id*="consent"]');
              let bestMatch = null;
              let bestScore = 0;
              for (const e of allEls) {
                const rect = e.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue; // skip invisible
                const txt = (e.textContent || '').toLowerCase().trim();
                const val = (e.value || '').toLowerCase();
                const aria = (e.ariaLabel || e.getAttribute('aria-label') || '').toLowerCase();
                const title = (e.title || '').toLowerCase();
                const dataText = (e.dataset?.text || e.dataset?.label || '').toLowerCase();
                // Exact match
                if (txt === searchText || val === searchText || aria === searchText) { el = e; break; }
                // Scoring
                let score = 0;
                if (txt.includes(searchText)) score = 10 - Math.min(5, Math.abs(txt.length - searchText.length) / 10);
                if (val.includes(searchText)) score = Math.max(score, 8);
                if (aria.includes(searchText)) score = Math.max(score, 9);
                if (title.includes(searchText)) score = Math.max(score, 7);
                if (dataText.includes(searchText)) score = Math.max(score, 7);
                // Bonus for button/link elements
                if (score > 0 && (e.tagName === 'BUTTON' || e.tagName === 'A' || e.getAttribute('role') === 'button')) score += 2;
                if (score > bestScore) { bestScore = score; bestMatch = e; }
              }
              if (!el && bestMatch) el = bestMatch;
            } else {
              el = root.querySelector(sel);
            }
            if (!el) {
              const cleanSel = sel.startsWith('text:') ? sel.substring(5).trim() : sel;
              try {
                const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${cleanSel.toLowerCase()}')]`;
                const xr = document.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                el = xr.singleNodeValue;
              } catch {}
            }
            return el;
          };

          // Search main document
          let el = findElement(document);

          // Search inside shadow DOMs
          if (!el) {
            const walkShadow = (root) => {
              for (const node of root.querySelectorAll('*')) {
                if (node.shadowRoot) {
                  const found = findElement(node.shadowRoot);
                  if (found) return found;
                  const deeper = walkShadow(node.shadowRoot);
                  if (deeper) return deeper;
                }
              }
              return null;
            };
            el = walkShadow(document);
          }

          if (!el) return { error: 'Elemento non trovato: ' + sel, hint: 'Provo negli iframe...' };

          // Scroll into view and WAIT for it to settle
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Small delay to let scroll finish and any lazy-loaded content appear
          await new Promise(r => setTimeout(r, 400));

          // Click sequence: focus → pointer events → click (like a real user)
          el.focus();
          try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); } catch {}
          try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); } catch {}
          await new Promise(r => setTimeout(r, 80));
          try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true })); } catch {}
          try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })); } catch {}
          el.click();
          try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch {}

          return { ok: true, clicked: el.tagName, text: (el.textContent || '').trim().substring(0, 80), href: el.href || '' };
        };

        // First try main frame
        let results = await execScriptWithTimeout(tab.id, clickFunc, [selector]);
        let r = results?.[0]?.result;

        // If not found in main frame, try ALL frames (cookie consent is often in iframe)
        if (r?.error && r?.hint?.includes('iframe')) {
          try {
            results = await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              func: clickFunc,
              args: [selector]
            });
            // Find the frame that succeeded
            for (const frame of results || []) {
              if (frame?.result?.ok) { r = frame.result; break; }
            }
          } catch (e) { /* some frames may block injection, that's ok */ }
        }

        // Auto-dismiss any popups triggered by click
        await self.sleep(300);
        await dismissCookiePopups(tab.id);
        await self.sleep(2000);
        return JSON.stringify(r || { error: 'No result' });
      }

      case 'fill_form': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        let fields = {};
        if (typeof args.fields === 'object' && args.fields !== null) {
          fields = args.fields;
        } else if (typeof args.fields === 'string') {
          try { fields = JSON.parse(args.fields); } catch { return JSON.stringify({ error: 'JSON fields non valido: ' + args.fields }); }
        } else {
          return JSON.stringify({ error: 'fields mancante' });
        }

        // Process ONE field at a time with delays between each
        const filled = {};
        for (const [sel, value] of Object.entries(fields)) {
          try {
            const results = await execScriptWithTimeout(tab.id, async (sel, value) => {
              const delay = ms => new Promise(r => setTimeout(r, ms));

              // --- FIND ELEMENT ---
              const findInput = (sel) => {
                try { const el = document.querySelector(sel); if (el) return el; } catch {}
                const searchText = sel.toLowerCase().replace(/[^a-z0-9\sàèìòù]/g, '');
                if (!searchText) return null;
                const all = document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="searchbox"], [role="textbox"], [role="listbox"]');
                for (const inp of all) {
                  const rect = inp.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) continue;
                  const texts = [inp.placeholder, inp.name, inp.id, inp.ariaLabel, inp.getAttribute('aria-label'), inp.dataset?.id, inp.dataset?.name].map(s => (s || '').toLowerCase());
                  if (texts.some(t => t.includes(searchText))) return inp;
                }
                const labels = document.querySelectorAll('label');
                for (const lbl of labels) {
                  if ((lbl.textContent || '').toLowerCase().includes(searchText)) {
                    const forId = lbl.getAttribute('for');
                    if (forId) { const inp = document.getElementById(forId); if (inp) return inp; }
                    const inp = lbl.querySelector('input, textarea, select'); if (inp) return inp;
                  }
                }
                // Shadow DOM
                const walkShadow = (root) => {
                  for (const node of root.querySelectorAll('*')) {
                    if (node.shadowRoot) {
                      for (const inp of node.shadowRoot.querySelectorAll('input, textarea, select, [role="combobox"]')) {
                        const texts = [inp.placeholder, inp.ariaLabel, inp.getAttribute('aria-label')].map(s => (s || '').toLowerCase());
                        if (texts.some(t => t.includes(searchText))) return inp;
                      }
                      const deeper = walkShadow(node.shadowRoot); if (deeper) return deeper;
                    }
                  }
                  return null;
                };
                return walkShadow(document);
              };

              const el = findInput(sel);
              if (!el) return { field: sel, status: 'non trovato', hint: 'verifica il selettore con get_page_elements' };

              el.scrollIntoView({ behavior: 'smooth', block: 'center' });

              // --- HANDLE <SELECT> DROPDOWN ---
              if (el.tagName === 'SELECT') {
                el.focus();
                const valLower = value.toLowerCase();
                let matched = null;
                for (const opt of el.options) {
                  if (opt.value.toLowerCase() === valLower || opt.textContent.trim().toLowerCase() === valLower) { matched = opt; break; }
                }
                if (!matched) {
                  for (const opt of el.options) {
                    if (opt.value.toLowerCase().includes(valLower) || opt.textContent.trim().toLowerCase().includes(valLower)) { matched = opt; break; }
                  }
                }
                if (matched) {
                  el.value = matched.value;
                  matched.selected = true;
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  return { field: sel, status: 'ok', type: 'select', selected: matched.textContent.trim() };
                }
                return { field: sel, status: 'opzione non trovata', options: [...el.options].slice(0, 10).map(o => o.textContent.trim()) };
              }

              // --- HANDLE CUSTOM DROPDOWN (role=combobox, role=listbox, autocomplete) ---
              const role = el.getAttribute('role');
              const isCombobox = role === 'combobox' || role === 'searchbox' || el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('aria-autocomplete');

              // --- TYPE INTO FIELD ---
              el.focus();
              el.click();

              // Clear field
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.select?.();
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
              }

              // Type character by character for comboboxes (they need time to show suggestions)
              if (isCombobox && value.length <= 30) {
                for (let i = 0; i < value.length; i++) {
                  const char = value[i];
                  el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));
                  document.execCommand('insertText', false, char);
                  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                  el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));
                }
              } else {
                // Standard insert for regular inputs
                const inserted = document.execCommand('insertText', false, value);
                if (!inserted || el.value !== value) {
                  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
                    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                  if (nativeSet) nativeSet.call(el, value);
                  else el.value = value;
                }
                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              }

              // Verify the value was accepted
              const finalVal = el.value || el.textContent || '';
              const accepted = finalVal.toLowerCase().includes(value.toLowerCase().substring(0, 5));
              return {
                field: sel,
                status: accepted ? 'ok' : 'inserito ma non verificato',
                type: el.tagName + (isCombobox ? ' (combobox)' : ''),
                value: finalVal.substring(0, 50),
                isCombobox
              };
            }, [sel, value]);
            const r = results?.[0]?.result || { field: sel, status: 'errore esecuzione' };
            filled[sel] = r;

            // If it's a combobox, wait for suggestions dropdown to appear, then select
            if (r.isCombobox && r.status === 'ok') {
              await self.sleep(1500); // Wait for autocomplete suggestions
              // Try to click the first suggestion
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (value) => {
                  const valLower = value.toLowerCase();
                  // Look for suggestion popups
                  const suggestions = document.querySelectorAll('[role="option"], [role="listbox"] li, .suggestion, .autocomplete-item, [class*="suggestion"], [class*="option"], [class*="result"], [class*="dropdown"] li, [class*="menu"] li, [data-testid*="option"]');
                  for (const s of suggestions) {
                    const rect = s.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    if ((s.textContent || '').toLowerCase().includes(valLower.substring(0, 4))) {
                      s.scrollIntoView({ block: 'center' });
                      s.click();
                      try { s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch {}
                      try { s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch {}
                      return { clicked: s.textContent.trim().substring(0, 80) };
                    }
                  }
                  return { clicked: null };
                },
                args: [value]
              });
            }

            // Delay between fields — let the page digest each input
            await self.sleep(800);

          } catch (e) {
            filled[sel] = { field: sel, status: 'errore: ' + e.message };
          }
        }
        return JSON.stringify(filled);
      }

      case 'get_page_elements': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        const filter = args.filter || 'all';
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (f) => {
            const result = { url: location.href, title: document.title };
            const getVisible = (el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            };
            if (f === 'all' || f === 'buttons') {
              result.buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
                .filter(getVisible).slice(0, 20)
                .map(b => ({ text: (b.textContent || b.value || '').trim().substring(0, 80), id: b.id, class: b.className?.substring?.(0, 50), type: b.type }));
            }
            if (f === 'all' || f === 'links') {
              result.links = [...document.querySelectorAll('a[href]')]
                .filter(getVisible).slice(0, 30)
                .map(a => ({ text: a.textContent.trim().substring(0, 80), href: a.href.substring(0, 200) }));
            }
            if (f === 'all' || f === 'inputs') {
              result.inputs = [...document.querySelectorAll('input, select, textarea')]
                .filter(getVisible).slice(0, 20)
                .map(i => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder, value: i.value?.substring(0, 50), selector: i.id ? '#' + i.id : (i.name ? `[name="${i.name}"]` : '') }));
            }
            if (f === 'all' || f === 'forms') {
              result.forms = [...document.querySelectorAll('form')].slice(0, 5)
                .map(f => ({ action: f.action, method: f.method, id: f.id, inputs: f.querySelectorAll('input, select, textarea').length }));
            }
            return result;
          },
          args: [filter]
        });
        return JSON.stringify(results?.[0]?.result || { error: 'No result' });
      }

      case 'crawl_website': {
        const url = args.url;
        if (!self.isValidHttpUrl(url)) return JSON.stringify({ error: 'URL non valido' });
        const maxPages = args.maxPages || 10;
        const sameDomain = args.sameDomain !== false;
        // Use the crawl handler from bg-scraper via action
        const result = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'crawl-start', url, config: { maxPages, sameDomain, maxDepth: 2, delay: 800 } }, resolve);
        });
        // Wait for crawl to finish (poll status)
        let attempts = 0;
        while (attempts < 60) {
          await self.sleep(2000);
          const status = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'crawl-status' }, resolve);
          });
          if (!status?.running) {
            const pages = (status?.pages || []).map(p => ({
              url: p.url,
              title: p.title || '',
              text: (p.content || p.text || '').substring(0, 2000),
              error: p.error
            }));
            return JSON.stringify({ pages: pages.slice(0, maxPages), total: pages.length });
          }
          attempts++;
        }
        return JSON.stringify({ error: 'Crawl timeout', partial: true });
      }

      case 'extract_data': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'Nessun tab attivo' });
        const schema = args.schema || {};
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (s) => {
            const extracted = {};
            for (const [key, selector] of Object.entries(s)) {
              try {
                if (selector.startsWith('//')) {
                  const r = document.evaluate(selector, document, null, XPathResult.STRING_TYPE, null);
                  extracted[key] = r.stringValue.trim();
                } else {
                  const els = document.querySelectorAll(selector);
                  extracted[key] = els.length === 0 ? null : els.length === 1 ? els[0].textContent.trim() : [...els].map(e => e.textContent.trim());
                }
              } catch { extracted[key] = null; }
            }
            return extracted;
          },
          args: [schema]
        });
        return JSON.stringify({ data: results?.[0]?.result, url: tab.url });
      }

      case 'save_to_kb': {
        try {
          await self.cobraKB.load();
          const tags = args.tags ? args.tags.split(',').map(t => t.trim()) : [];
          tags.push(args.type || 'rule');
          const rule = self.cobraKB.addRule({
            domain: args.domain || null,
            operationType: args.type || 'pattern',
            ruleType: 'instruction',
            title: args.name,
            content: args.content,
            source: 'ai_learned',
            priority: 7,
            tags,
            metadata: { category: args.type || 'pattern' }
          });
          return JSON.stringify({ ok: true, id: rule.id, message: `Salvato in KB: "${args.name}" per dominio "${args.domain || 'globale'}"` });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      case 'search_kb': {
        try {
          await self.cobraKB.load();
          let results = [];
          if (args.domain) {
            results = self.cobraKB.findRules({ domain: args.domain });
          }
          if (!results.length && args.query) {
            results = self.cobraKB.searchRules(args.query);
          }
          const items = (results || []).slice(0, 10).map(r => ({
            title: r.title,
            domain: r.domain,
            category: r.metadata?.category || r.operationType,
            content: (r.content || '').substring(0, 300),
            tags: r.tags,
            source: r.source
          }));
          return JSON.stringify({ results: items, total: items.length });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      case 'create_file': {
        try {
          const mimeType = args.type || 'text/plain';
          const blob = new Blob([args.content], { type: mimeType });
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          const downloadPath = 'COBRA/' + (args.filename || 'file.txt');
          await chrome.downloads.download({
            url: dataUrl,
            filename: downloadPath,
            saveAs: false
          });
          // Save file reference to storage for Files tab
          const ext = (args.filename || '').split('.').pop()?.toLowerCase() || 'txt';
          const { cobra_files = [] } = await chrome.storage.local.get('cobra_files');
          cobra_files.push({
            id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            filename: args.filename,
            ext,
            mimeType,
            size: args.content.length,
            content: args.content.length < 500000 ? args.content : null, // store content only if < 500KB
            created: Date.now()
          });
          // Keep last 100 files
          if (cobra_files.length > 100) cobra_files.splice(0, cobra_files.length - 100);
          await chrome.storage.local.set({ cobra_files });
          return JSON.stringify({ ok: true, message: `File "${args.filename}" creato e scaricato.` });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      case 'create_task': {
        try {
          let steps = [];
          if (Array.isArray(args.steps)) { steps = args.steps; }
          else if (typeof args.steps === 'string') { try { steps = JSON.parse(args.steps); } catch { steps = [{ description: args.steps }]; } }
          else { steps = [{ description: String(args.steps) }]; }
          const task = {
            id: 'task_' + Date.now(),
            name: args.name,
            steps,
            status: 'pending',
            currentStep: 0,
            createdAt: Date.now(),
            schedule: args.schedule || null
          };
          // Save task to storage
          const { cobra_tasks = [] } = await chrome.storage.local.get('cobra_tasks');
          cobra_tasks.push(task);
          await chrome.storage.local.set({ cobra_tasks });
          return JSON.stringify({ ok: true, taskId: task.id, message: `Task "${args.name}" creato con ${steps.length} step.`, task });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      case 'list_tasks': {
        try {
          const { cobra_tasks = [] } = await chrome.storage.local.get('cobra_tasks');
          const tasks = cobra_tasks.map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            currentStep: t.currentStep,
            totalSteps: t.steps?.length || 0,
            createdAt: t.createdAt,
            schedule: t.schedule
          }));
          return JSON.stringify({ tasks, total: tasks.length });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      case 'save_memory': {
        try {
          const memory = {
            id: 'mem_' + Date.now(),
            title: args.title,
            data: args.content,
            type: 'nota',
            tags: args.tags ? args.tags.split(',').map(t => t.trim()) : [],
            timestamp: Date.now()
          };
          const { cobra_memories = [] } = await chrome.storage.local.get('cobra_memories');
          cobra_memories.push(memory);
          await chrome.storage.local.set({ cobra_memories });
          return JSON.stringify({ ok: true, message: `Memoria salvata: "${args.title}"` });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      case 'batch_scrape': {
        try {
          let urls = [];
          if (Array.isArray(args.urls)) { urls = args.urls; }
          else if (typeof args.urls === 'string') { try { urls = JSON.parse(args.urls); } catch { urls = [args.urls]; } }
          urls = urls.filter(u => self.isValidHttpUrl(u)).slice(0, 10);
          if (urls.length === 0) return JSON.stringify({ error: 'Nessun URL valido' });

          const results = [];
          for (const url of urls) {
            let tab = null;
            try {
              tab = await chrome.tabs.create({ url, active: false });
              await self.waitForTabLoad(tab.id);
              await self.sleep(800);
              const r = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => ({ title: document.title, url: location.href, text: document.body.innerText.substring(0, 3000) })
              });
              results.push(r?.[0]?.result || { url, error: 'No content' });
            } catch (e) {
              results.push({ url, error: e.message });
            } finally {
              if (tab?.id) try { await chrome.tabs.remove(tab.id); } catch {}
            }
          }
          return JSON.stringify({ results, total: results.length });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      // === LOCAL FILE SYSTEM TOOLS ===
      // These tools communicate with the side panel which has File System Access API
      case 'list_local_files':
      case 'read_local_file':
      case 'save_local_file':
      case 'search_local_files': {
        try {
          // Send file operation to side panel and wait for response
          const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout: il side panel non risponde')), 30000);
            chrome.runtime.sendMessage({
              type: 'FILE_OP',
              op: name,
              args: args
            }, (result) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(result);
              }
            });
          });
          return JSON.stringify(response || { error: 'Nessuna risposta dal file system' });
        } catch (e) {
          if (e.message.includes('Nessuna cartella connessa') || e.message.includes('non risponde')) {
            return JSON.stringify({ error: 'Nessuna cartella connessa. Chiedi all\'utente di connettere una cartella dal pannello COBRA (icona cartella o Archivio > Files > Connetti Cartella).' });
          }
          return JSON.stringify({ error: e.message });
        }
      }

      case 'kb_update': {
        try {
          await self.cobraKB.load();
          const tags = (args.tags || '').split(',').map(t => t.trim()).filter(Boolean);
          tags.push(args.category);
          const rule = self.cobraKB.addRule({
            domain: args.domain || null,
            operationType: args.category || 'pattern',
            ruleType: 'instruction',
            title: args.title,
            content: args.content,
            source: 'ai_learned',
            priority: 7,
            tags,
            metadata: { category: args.category, learnedAt: new Date().toISOString() }
          });
          return JSON.stringify({ ok: true, id: rule.id, title: rule.title });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      case 'kb_delete': {
        try {
          await self.cobraKB.load();
          const rule = self.cobraKB.rules.find(r => r.isActive && r.title === args.title);
          if (!rule) return JSON.stringify({ error: `Entry "${args.title}" non trovata` });
          self.cobraKB.deactivateRule(rule.id);
          return JSON.stringify({ ok: true, deactivated: args.title });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      }

      // ── Communication Hub Tools ──
      case 'send_email': {
        if (!self.CommHub) return JSON.stringify({ error: 'Communication Hub non caricato' });
        const emailResult = await self.CommHub.sendEmail({ to: args.to, cc: args.cc, subject: args.subject, body: args.body });
        return JSON.stringify(emailResult);
      }

      case 'send_whatsapp': {
        if (!self.CommHub) return JSON.stringify({ error: 'Communication Hub non caricato' });
        const waResult = await self.CommHub.sendWhatsApp({ phone: args.phone, text: args.text });
        return JSON.stringify(waResult);
      }

      case 'send_linkedin': {
        if (!self.CommHub) return JSON.stringify({ error: 'Communication Hub non caricato' });
        const liResult = await self.CommHub.sendLinkedIn({ recipient: args.recipient, text: args.text });
        return JSON.stringify(liResult);
      }

      case 'check_emails': {
        if (!self.CommHub) return JSON.stringify({ error: 'Communication Hub non caricato' });
        const syncResult = await self.CommHub.syncEmails();
        return JSON.stringify(syncResult);
      }

      case 'read_inbox': {
        if (!self.CommHub) return JSON.stringify({ error: 'Communication Hub non caricato' });
        const emails = await self.CommHub.getEmails();
        const limit = args.limit || 10;
        const recent = emails.slice(0, limit).map(e => ({
          uid: e.uid, from: e.from, subject: e.subject, date: e.date,
          snippet: e.snippet, unread: e.unread, flagged: e.flagged
        }));
        return JSON.stringify({ success: true, count: recent.length, total: emails.length, emails: recent });
      }

      default:
        return JSON.stringify({ error: `Tool sconosciuto: ${name}` });
    }

    // Log successful action
    const duration = Date.now() - startTime;
    logAction(name, args, result, null);

    // Auto-capture screenshot for visual tools → canvas overlay
    const visualTools = ['navigate', 'google_search', 'click_element', 'fill_form', 'execute_js'];
    if (visualTools.includes(name)) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          // Small delay for page to settle after action
          await new Promise(r => setTimeout(r, 500));
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
          chrome.runtime.sendMessage({
            type: 'CANVAS_SCREENSHOT',
            dataUrl,
            url: tab.url || '',
            title: tab.title || ''
          });
        }
      } catch (e) {
        // Screenshot capture is non-critical, ignore errors
      }
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[executeToolCall] ${name} error (${duration}ms):`, err);
    const result = JSON.stringify({ error: err.message });
    logAction(name, args, result);
    return result;
  }
}

// ============================================================
// Per-tool timeout configuration (ms)
// ============================================================
const TOOL_TIMEOUTS = {
  navigate: 30000,
  google_search: 25000,
  scrape_url: 30000,
  deep_scrape: 60000,
  execute_js: 15000,
  click_element: 10000,
  fill_form: 15000,
  scroll_page: 5000,
  wait_for_element: 20000,
  read_page_content: 10000,
  get_page_links: 10000,
  take_screenshot: 8000,
  get_tab_info: 3000,
  extract_table: 15000,
  extract_structured_data: 20000,
  _default: 20000,
};

// ============================================================
// Hardened executor: timeout + retry + Policy + Result wrapper
// ============================================================
async function executeToolCallHardened(name, args, context = {}) {
  const timeout = TOOL_TIMEOUTS[name] || TOOL_TIMEOUTS._default;
  const maxRetries = (self.TOOL_RISK_MAP && self.TOOL_RISK_MAP[name] === 'safe') ? 2 : 1;

  // ── Policy check (v5.2) — lightweight, NO async tab queries ──
  if (self.CobraPolicy) {
    try {
      // Use url from args if available (no chrome.tabs.query — too slow)
      const checkUrl = context.url || args.url || '';
      const policyResult = self.CobraPolicy.check(name, args, { ...context, url: checkUrl });
      if (!policyResult.success) {
        return self.Result ? self.Result.serialize(policyResult) : JSON.stringify({ error: policyResult.message, code: policyResult.code });
      }
    } catch (e) {
      // Policy failure is never blocking
    }
  }

  // ── Capture pre-state for undo on risky/destructive tools ──
  if (self.ToolSafety) {
    const risk = (self.TOOL_RISK_MAP && self.TOOL_RISK_MAP[name]) || 'safe';
    if (risk !== 'safe') {
      await self.ToolSafety.capturePreState(name, args).catch(() => {});
    }
  }

  // ── Get domain for selector stats ──
  let currentDomain = null;
  try { if (args.url) currentDomain = new URL(args.url).hostname; } catch {}

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        executeToolCall(name, args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Tool timeout: ${name} exceeded ${timeout}ms`)), timeout)
        ),
      ]);

      // ── Selector stats: record success ──
      if (self.CobraSelectorStats && currentDomain && args.selector) {
        self.CobraSelectorStats.recordSuccess(currentDomain, args.selector);
      }

      // ── Audit log via IDB ──
      if (self.cobraIDB) {
        self.cobraIDB.appendAuditLog({
          tool: name, args: _sanitizeArgs(args), success: true,
          duration: Date.now() - (context._startTime || Date.now()), attempt
        }).catch(() => {});
      }

      return result;
    } catch (err) {
      const isLastAttempt = attempt >= maxRetries;

      // ── Selector stats: record failure ──
      if (self.CobraSelectorStats && currentDomain && args.selector) {
        self.CobraSelectorStats.recordFailure(currentDomain, args.selector);
      }

      if (self.CobraLogger) {
        self.CobraLogger.warn('ToolExecutor', `${name} attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      }
      if (self.CobraErrorBoundary) {
        self.CobraErrorBoundary.capture('tool_execution', err, { tool: name, attempt, maxRetries });
      }

      if (isLastAttempt) {
        // ── Audit log failure ──
        if (self.cobraIDB) {
          self.cobraIDB.appendAuditLog({
            tool: name, args: _sanitizeArgs(args), success: false,
            error: err.message, attempts: attempt
          }).catch(() => {});
        }

        // Return structured error via Result if available
        if (self.Result) {
          return self.Result.serialize(self.Result.fail('SCRIPT_TIMEOUT', err.message, { tool: name, attempts: attempt }));
        }
        return JSON.stringify({ error: err.message, tool: name, attempts: attempt });
      }

      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

// Sanitize args for audit log (strip long content)
function _sanitizeArgs(args) {
  if (!args) return {};
  const clean = { ...args };
  if (clean.code && clean.code.length > 200) clean.code = clean.code.substring(0, 200) + '…';
  if (clean.content && clean.content.length > 200) clean.content = clean.content.substring(0, 200) + '…';
  if (clean.fields && typeof clean.fields === 'string' && clean.fields.length > 200) {
    clean.fields = clean.fields.substring(0, 200) + '…';
  }
  return clean;
}

// ============================================================
// Exports for Service Worker
// ============================================================
self.execScriptWithTimeout = execScriptWithTimeout;
self._executeToolCall = executeToolCallHardened;
self.executeToolCall = executeToolCallHardened; // alias for CobraJobs
self.validateToolArgs = validateToolArgs;
self.actionLog = actionLog;
self.TOOL_TIMEOUTS = TOOL_TIMEOUTS;

console.log('[tool-executor.js] Loaded: executeToolCall + safety + policy + result wrapper');
