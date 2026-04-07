/**
 * bg-comms.js — Communication Hub handler for COBRA
 * ──────────────────────────────────────────────────
 * Email (IMAP/SMTP via proxy), WhatsApp (tab injection), LinkedIn (tab injection)
 * Registers on CobraRouter for seamless integration
 */

(function() {
  'use strict';

  const CFG_KEY = 'comm_config';
  const EMAILS_KEY = 'comm_cached_emails';
  const SENT_KEY = 'comm_sent_log';
  const SYNC_STATE_KEY = 'comm_sync_state';
  const STATS_KEY = 'comm_stats';

  let syncing = false;

  const ERR = self.CommConfig?.ERR || {};
  const DEFAULTS = self.CommConfig?.DEFAULTS || { storageMode: 'local', batchSize: 25, syncInterval: 15 };
  // Result wrapper available via self.Result for internal use only (not for sendMessage returns)

  // ── Storage helpers ─────────────────────────────────────────

  async function getCommConfig() {
    const { [CFG_KEY]: cfg } = await chrome.storage.local.get(CFG_KEY);
    return cfg || null;
  }

  async function saveCommConfig(cfg) {
    await chrome.storage.local.set({ [CFG_KEY]: cfg });
  }

  async function getCachedEmails() {
    const { [EMAILS_KEY]: emails } = await chrome.storage.local.get(EMAILS_KEY);
    return emails || [];
  }

  async function setCachedEmails(emails) {
    await chrome.storage.local.set({ [EMAILS_KEY]: emails.slice(0, 200) });
  }

  async function getSyncState() {
    const { [SYNC_STATE_KEY]: s } = await chrome.storage.local.get(SYNC_STATE_KEY);
    return s || { lastUid: 0, totalDownloaded: 0, lastSyncAt: null };
  }

  async function updateSyncState(patch) {
    const cur = await getSyncState();
    const updated = { ...cur, ...patch };
    await chrome.storage.local.set({ [SYNC_STATE_KEY]: updated });
    return updated;
  }

  async function getCommStats() {
    const { [STATS_KEY]: s } = await chrome.storage.local.get(STATS_KEY);
    return s || { totalEmails: 0, syncCount: 0, errors: 0, sentCount: 0, sentEmail: 0, sentWhatsapp: 0, sentLinkedin: 0 };
  }

  async function updateCommStats(patch) {
    const cur = await getCommStats();
    const updated = { ...cur, ...patch };
    await chrome.storage.local.set({ [STATS_KEY]: updated });
    return updated;
  }

  async function logSent(channel, recipient, preview) {
    const { [SENT_KEY]: log } = await chrome.storage.local.get(SENT_KEY);
    const entries = log || [];
    entries.unshift({ channel, recipient, preview: (preview || '').slice(0, 80), sentAt: new Date().toISOString() });
    await chrome.storage.local.set({ [SENT_KEY]: entries.slice(0, 500) });
    const stats = await getCommStats();
    const key = `sent${channel.charAt(0).toUpperCase() + channel.slice(1)}`;
    await updateCommStats({ sentCount: (stats.sentCount || 0) + 1, [key]: (stats[key] || 0) + 1 });
  }

  // ── Send: Email via SMTP proxy ──────────────────────────────

  async function handleSendEmail(params) {
    const cfg = await getCommConfig();
    if (!cfg?.email || !cfg?.proxyUrl) return { success: false, code: 'COMM_NOT_CONFIGURED', error: 'Email non configurata' };

    const { to, cc, subject, body } = params;
    if (!to) return { success: false, error: 'Destinatario mancante' };

    try {
      const res = await fetch(`${cfg.proxyUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cfg.email, password: cfg.password,
          smtpHost: cfg.smtpHost || cfg.imapHost?.replace('imap', 'smtp'),
          smtpPort: cfg.smtpPort || 587,
          smtpSecurity: cfg.smtpSecurity || 'starttls',
          to, cc: cc || undefined,
          subject: subject || '(senza oggetto)',
          body: body || '',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { success: false, error: err.error || 'Invio fallito' };
      }

      const result = await res.json();
      await logSent('email', to, subject);
      return { success: true, messageId: result.messageId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Send: WhatsApp via tab injection ────────────────────────

  async function handleSendWhatsApp(params) {
    const { phone, text } = params;
    if (!phone || !text) return { success: false, error: 'Numero o messaggio mancante' };

    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
    const waUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;

    try {
      const tabId = await openOrReuseTab('https://web.whatsapp.com/*', waUrl);
      await waitForTab(tabId, 20000);

      // Poll for WhatsApp to be ready (send button or text input visible)
      const ready = await waitForElement(tabId, [
        '[data-testid="send"]', 'button[aria-label*="Send"]',
        'button[aria-label*="Invia"]', 'span[data-icon="send"]',
        '[data-testid="conversation-compose-box-input"]'
      ], 15000);

      if (!ready) {
        return { success: true, method: 'prefilled', note: 'WhatsApp aperto — messaggio precompilato, premi Invio per inviare' };
      }

      // Try to click send button with retry
      const sendResult = await executeWithRetry(tabId, () => {
        const selectors = ['[data-testid="send"]', 'button[aria-label*="Send"]', 'button[aria-label*="Invia"]', 'span[data-icon="send"]'];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { (el.closest('button') || el).click(); return { success: true, method: 'auto-send' }; }
        }
        return { success: true, method: 'prefilled', note: 'Messaggio precompilato — premi Invio per inviare' };
      });

      const result = sendResult?.[0]?.result || { success: false, error: 'Iniezione fallita' };
      if (result.success) await logSent('whatsapp', phone, text);
      return result;
    } catch (err) {
      return { success: false, error: `WhatsApp: ${err.message}` };
    }
  }

  // ── Send: LinkedIn via tab injection ────────────────────────

  async function handleSendLinkedIn(params) {
    const { recipient, text } = params;
    if (!recipient || !text) return { success: false, error: 'Destinatario o messaggio mancante' };

    try {
      const isUrl = recipient.startsWith('http');
      let tabId;

      if (isUrl) {
        const profileUrl = recipient.replace(/\/$/, '');
        tabId = await openOrReuseTab('https://www.linkedin.com/*', profileUrl);
      } else {
        const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(recipient)}`;
        tabId = await openOrReuseTab('https://www.linkedin.com/*', searchUrl);
      }

      await waitForTab(tabId, 20000);

      // Wait for page content to render
      await waitForElement(tabId, ['button', '[data-test-id]', '.scaffold-layout'], 8000);

      // Click "Message" button with improved detection
      const clickResult = await executeWithRetry(tabId, () => {
        const btns = Array.from(document.querySelectorAll('button'));
        // Exact match first
        let msgBtn = btns.find(b => {
          const t = b.textContent.trim().toLowerCase();
          return t === 'message' || t === 'messaggio';
        });
        // Fallback: starts with message/messaggio
        if (!msgBtn) {
          msgBtn = btns.find(b => /^(message|messaggio)/i.test(b.textContent.trim()) && b.offsetParent !== null);
        }
        // Fallback: aria-label
        if (!msgBtn) {
          msgBtn = document.querySelector('button[aria-label*="essage"], button[aria-label*="essaggio"]');
        }
        if (msgBtn) { msgBtn.click(); return { success: true }; }
        return { success: false, error: 'Pulsante Messaggio non trovato' };
      });

      if (!clickResult?.[0]?.result?.success) {
        return { success: false, error: clickResult?.[0]?.result?.error || 'Pulsante Messaggio non trovato su LinkedIn' };
      }

      // Wait for message compose to appear
      await waitForElement(tabId, [
        '[role="textbox"][contenteditable="true"]',
        '.msg-form__contenteditable [contenteditable="true"]',
        'div[data-placeholder][contenteditable="true"]',
      ], 8000);

      // Type and send
      const sendResult = await executeWithRetry(tabId, (messageText) => {
        const selectors = [
          '[role="textbox"][contenteditable="true"]',
          '.msg-form__contenteditable [contenteditable="true"]',
          'div[data-placeholder][contenteditable="true"]',
        ];
        let textbox = null;
        for (const sel of selectors) { textbox = document.querySelector(sel); if (textbox) break; }
        if (!textbox) return { success: false, error: 'Campo messaggio non trovato' };

        textbox.focus();
        textbox.innerHTML = '';

        // Use clipboard-like paste for reliable input
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', messageText);
        textbox.dispatchEvent(new InputEvent('insertFromPaste', {
          inputType: 'insertFromPaste', data: messageText,
          dataTransfer, bubbles: true, cancelable: true,
        }));

        // Fallback: direct set
        if (!textbox.textContent || textbox.textContent.trim() !== messageText.trim()) {
          textbox.textContent = messageText;
          textbox.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Click send after brief delay
        setTimeout(() => {
          const sendBtns = Array.from(document.querySelectorAll('button'));
          const sendBtn = sendBtns.find(b => {
            const label = (b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
            return label === 'send' || label === 'invia';
          }) || document.querySelector('.msg-form__send-button, button[type="submit"]');
          if (sendBtn?.offsetParent) sendBtn.click();
        }, 500);

        return { success: true, method: 'inject' };
      }, [text]);

      const result = sendResult?.[0]?.result || { success: false, error: 'Iniezione LinkedIn fallita' };
      if (result.success) await logSent('linkedin', recipient, text);
      return result;
    } catch (err) {
      return { success: false, error: `LinkedIn: ${err.message}` };
    }
  }

  // ── Sync: Email fetch via IMAP proxy ────────────────────────

  async function runEmailSync() {
    const cfg = await getCommConfig();
    if (!cfg?.email || !cfg?.proxyUrl) return { success: false, error: 'Configurazione incompleta' };
    if (syncing) return { success: false, error: 'Sync già in corso' };

    syncing = true;
    const startTime = Date.now();
    let downloaded = 0, errors = 0;

    try {
      const syncState = await getSyncState();

      const res = await fetch(`${cfg.proxyUrl}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cfg.email, password: cfg.password,
          host: cfg.imapHost, port: cfg.imapPort, tls: cfg.imapTls !== false,
          lastUid: syncState.lastUid,
          batchSize: cfg.batchSize || DEFAULTS.batchSize,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Errore proxy' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const { emails = [], highestUid = syncState.lastUid, totalInbox = 0 } = await res.json();

      if (emails.length > 0) {
        downloaded = emails.length;

        // Update cache
        const existing = await getCachedEmails();
        const existingUids = new Set(existing.map(e => e.uid));
        const newEmails = emails
          .filter(e => !existingUids.has(e.uid))
          .map(e => ({
            uid: e.uid,
            subject: e.subject || '(senza oggetto)',
            from: e.from || '', to: e.to || '',
            date: e.date || new Date().toISOString(),
            snippet: (e.bodyText || '').slice(0, 120),
            bodyHtml: e.bodyHtml || null,
            bodyText: e.bodyText || null,
            unread: true, flagged: false,
            hasAttachments: !!(e.attachments?.length),
            attachments: e.attachments || [],
          }));

        await setCachedEmails([...newEmails, ...existing].slice(0, 200));

        // Notify
        if (cfg.notificationsEnabled !== false && newEmails.length > 0) {
          const title = newEmails.length === 1
            ? (newEmails[0].from.split('<')[0].trim() || 'Nuova email')
            : `${newEmails.length} nuove email`;
          const message = newEmails.length === 1
            ? (newEmails[0].subject || '')
            : newEmails.slice(0, 3).map(e => `${e.from.split('<')[0].trim()}: ${e.subject.slice(0, 40)}`).join('\n');
          chrome.notifications.create(`cobra-email-${Date.now()}`, {
            type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1,
          });
        }

        try { chrome.runtime.sendMessage({ action: 'emailsUpdated' }); } catch {}
      }

      await updateSyncState({ lastUid: highestUid, totalDownloaded: (syncState.totalDownloaded || 0) + downloaded, lastSyncAt: new Date().toISOString() });
      const prev = await getCommStats();
      await updateCommStats({ totalEmails: prev.totalEmails + downloaded, syncCount: prev.syncCount + 1, errors: prev.errors + errors });

      return { success: true, downloaded, totalInbox, highestUid, duration: Date.now() - startTime };
    } catch (err) {
      const prev = await getCommStats();
      await updateCommStats({ errors: prev.errors + 1 });
      return { success: false, error: err.message };
    } finally {
      syncing = false;
    }
  }

  // ── Test IMAP connection ────────────────────────────────────

  async function testImapConnection() {
    const cfg = await getCommConfig();
    if (!cfg?.proxyUrl) return { success: false, error: 'Proxy non configurato' };
    try {
      const res = await fetch(`${cfg.proxyUrl}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cfg.email, password: cfg.password,
          host: cfg.imapHost, port: cfg.imapPort, tls: cfg.imapTls !== false,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Test fallito' }));
        return { success: false, error: err.error };
      }
      return { success: true, ...(await res.json()) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Improved: checks if tab is already loaded before waiting
  function waitForTab(tabId, timeoutMs = 20000) {
    return new Promise(resolve => {
      function listener(id, info) {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // Resolve anyway on timeout
      }, timeoutMs);

      // Check if tab is already loaded
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) { resolve(); return; }
        if (tab && tab.status === 'complete') {
          clearTimeout(timer);
          resolve();
          return;
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  // Open or reuse existing tab (handles race condition)
  async function openOrReuseTab(queryUrl, navigateUrl) {
    const tabs = await chrome.tabs.query({ url: queryUrl });
    if (tabs.length > 0) {
      try {
        const updated = await chrome.tabs.update(tabs[0].id, { url: navigateUrl, active: true });
        return updated.id;
      } catch {
        // Tab was closed between query and update — create new
        const tab = await chrome.tabs.create({ url: navigateUrl, active: true });
        return tab.id;
      }
    }
    const tab = await chrome.tabs.create({ url: navigateUrl, active: true });
    return tab.id;
  }

  // Poll for an element to appear in the tab (replaces fixed sleep)
  async function waitForElement(tabId, selectors, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          args: [selectors],
          func: (sels) => sels.some(s => document.querySelector(s)),
        });
        if (result?.[0]?.result) return true;
      } catch {}
      await sleep(600);
    }
    return false;
  }

  // Execute script with retry (handles transient injection failures)
  async function executeWithRetry(tabId, func, args = [], maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const opts = { target: { tabId }, func };
        if (args.length > 0) opts.args = args;
        const result = await chrome.scripting.executeScript(opts);
        if (result && result.length > 0) return result;
      } catch (err) {
        if (i === maxRetries - 1) throw err;
        await sleep(Math.pow(2, i) * 800);
      }
    }
    return null;
  }

  // ── WhatsApp: Read conversations from open tab ──────────────

  const WA_CHATS_KEY = 'comm_wa_chats'; // { [phone]: { name, messages: [{text, from, ts}], lastTs } }

  async function getWaChats() {
    const { [WA_CHATS_KEY]: chats } = await chrome.storage.local.get(WA_CHATS_KEY);
    return chats || {};
  }

  async function saveWaChats(chats) {
    // Limit per conversation
    for (const key of Object.keys(chats)) {
      if (chats[key].messages && chats[key].messages.length > 200) {
        chats[key].messages = chats[key].messages.slice(-200);
      }
    }
    await chrome.storage.local.set({ [WA_CHATS_KEY]: chats });
  }

  // Scrape visible chats list from WhatsApp Web
  async function scrapeWaChatList() {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (!tabs.length) return { success: false, error: 'Apri web.whatsapp.com prima' };

    const tabId = tabs[0].id;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const chatItems = document.querySelectorAll('[data-testid="cell-frame-container"]');
          const chats = [];
          chatItems.forEach(item => {
            try {
              const nameEl = item.querySelector('[data-testid="cell-frame-title"] span[title]') ||
                             item.querySelector('span[title]');
              const lastMsgEl = item.querySelector('[data-testid="last-msg-status"]') ||
                                item.querySelector('span[title]:not(:first-child)') ||
                                item.querySelector('span.matched-text');
              const timeEl = item.querySelector('[data-testid="cell-frame-secondary"] span') ||
                             item.querySelector('div._ak8i');
              const unreadEl = item.querySelector('[data-testid="icon-unread-count"]') ||
                               item.querySelector('span[data-icon="unread-count"]') ||
                               item.querySelector('span.aumms1qt');

              const name = nameEl?.getAttribute('title') || nameEl?.textContent || '';
              const lastMsg = lastMsgEl?.textContent || '';
              const time = timeEl?.textContent || '';
              const unread = !!unreadEl;

              if (name) {
                chats.push({ name, lastMsg: lastMsg.slice(0, 100), time, unread });
              }
            } catch {}
          });
          return chats.slice(0, 50);
        }
      });
      return { success: true, chats: results?.[0]?.result || [] };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Scrape messages from currently open conversation
  async function scrapeWaMessages() {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (!tabs.length) return { success: false, error: 'Apri web.whatsapp.com prima' };

    const tabId = tabs[0].id;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Get current chat name
          const headerEl = document.querySelector('[data-testid="conversation-header"] span[title]') ||
                           document.querySelector('header span[title]');
          const chatName = headerEl?.getAttribute('title') || headerEl?.textContent || 'Sconosciuto';

          // Get messages
          const msgEls = document.querySelectorAll('[data-testid="msg-container"]');
          const messages = [];
          msgEls.forEach(el => {
            try {
              const isOut = el.querySelector('[data-testid="msg-dblcheck"]') ||
                            el.querySelector('[data-icon="msg-dblcheck"]') ||
                            el.querySelector('[data-icon="msg-check"]') ||
                            el.classList.contains('message-out');
              const textEl = el.querySelector('[data-testid="balloon-text"] span.selectable-text') ||
                             el.querySelector('.copyable-text span.selectable-text') ||
                             el.querySelector('span.selectable-text');
              const timeEl = el.querySelector('[data-testid="msg-meta"] span') ||
                             el.querySelector('span[data-testid="msg-time"]') ||
                             el.querySelector('.copyable-text[data-pre-plain-text]');

              const text = textEl?.textContent || '';
              let time = timeEl?.textContent || '';

              // Try to get time from data attribute
              if (!time && timeEl) {
                const attr = el.querySelector('[data-pre-plain-text]');
                if (attr) time = attr.getAttribute('data-pre-plain-text') || '';
              }

              if (text) {
                messages.push({
                  text: text.slice(0, 2000),
                  from: isOut ? 'me' : 'them',
                  time: time.trim()
                });
              }
            } catch {}
          });
          return { chatName, messages: messages.slice(-100) };
        }
      });
      const data = results?.[0]?.result;
      if (data) {
        // Store in local cache
        const chats = await getWaChats();
        const key = data.chatName.replace(/[^a-zA-Z0-9\s]/g, '').trim();
        if (!chats[key]) chats[key] = { name: data.chatName, messages: [], lastTs: Date.now() };
        chats[key].messages = data.messages;
        chats[key].lastTs = Date.now();
        await saveWaChats(chats);
      }
      return { success: true, ...data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Open a specific chat in WhatsApp
  async function openWaChat(contactName) {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (!tabs.length) {
      await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: true });
      return { success: true, note: 'WhatsApp Web aperto. Aspetta il caricamento e riprova.' };
    }
    const tabId = tabs[0].id;
    try {
      // Search for contact and click
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        args: [contactName],
        func: (name) => {
          // Try to find and click on the search box first
          const searchBox = document.querySelector('[data-testid="chat-list-search"] [contenteditable="true"]') ||
                            document.querySelector('[data-testid="search-input"]') ||
                            document.querySelector('div[title="Search input textbox"]');
          if (searchBox) {
            searchBox.focus();
            searchBox.textContent = name;
            searchBox.dispatchEvent(new Event('input', { bubbles: true }));

            // Wait a bit then click the first result
            return new Promise(resolve => {
              setTimeout(() => {
                const results = document.querySelectorAll('[data-testid="cell-frame-container"]');
                for (const r of results) {
                  const span = r.querySelector('span[title]');
                  if (span && span.getAttribute('title')?.toLowerCase().includes(name.toLowerCase())) {
                    r.click();
                    resolve({ success: true, opened: span.getAttribute('title') });
                    return;
                  }
                }
                // Click first result anyway
                if (results.length > 0) {
                  results[0].click();
                  const firstSpan = results[0].querySelector('span[title]');
                  resolve({ success: true, opened: firstSpan?.getAttribute('title') || name });
                } else {
                  resolve({ success: false, error: 'Contatto non trovato' });
                }
              }, 1000);
            });
          }
          return { success: false, error: 'Search box non trovato su WhatsApp Web' };
        }
      });
      return results?.[0]?.result || { success: false, error: 'Injection fallita' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── Register on CobraRouter ─────────────────────────────────

  if (typeof CobraRouter !== 'undefined' && CobraRouter.registerActions) {
    CobraRouter.registerActions({
      'COMM_SAVE_CONFIG':    async (p) => { await saveCommConfig(p.config); return { success: true }; },
      'COMM_GET_CONFIG':     async () => ({ success: true, config: await getCommConfig() }),
      'COMM_DISCOVER':       async (p) => {
        const cfg = await getCommConfig();
        const result = await self.CommAutoDiscover.discover(p.email, cfg?.proxyUrl);
        return { success: true, server: result };
      },
      'COMM_TEST_CONNECTION': async () => await testImapConnection(),
      'COMM_SYNC_NOW':       async () => await runEmailSync(),
      'COMM_GET_STATUS':     async () => {
        const [syncState, stats, cfg] = await Promise.all([getSyncState(), getCommStats(), getCommConfig()]);
        return { success: true, syncState, stats, config: cfg, syncing };
      },
      'COMM_GET_EMAILS':     async () => ({ success: true, emails: await getCachedEmails() }),
      'COMM_MARK_READ':      async (p) => {
        const emails = await getCachedEmails();
        await setCachedEmails(emails.map(e => e.uid === p.uid ? { ...e, unread: false } : e));
        return { success: true };
      },
      'COMM_SEND_EMAIL':     async (p) => await handleSendEmail(p),
      'COMM_SEND_WHATSAPP':  async (p) => await handleSendWhatsApp(p),
      'COMM_SEND_LINKEDIN':  async (p) => await handleSendLinkedIn(p),
      'COMM_WA_CHAT_LIST':   async () => await scrapeWaChatList(),
      'COMM_WA_MESSAGES':    async () => await scrapeWaMessages(),
      'COMM_WA_OPEN_CHAT':   async (p) => await openWaChat(p.name),
      'COMM_WA_GET_CHATS':   async () => ({ success: true, chats: await getWaChats() }),
      'COMM_GET_SENT_LOG':   async () => {
        const { [SENT_KEY]: log } = await chrome.storage.local.get(SENT_KEY);
        return { success: true, log: log || [] };
      },
    });
    console.log('[COBRA] Communication Hub registered on CobraRouter');
  }

  // ── Expose globally for tool-executor ───────────────────────

  self.CommHub = {
    sendEmail: handleSendEmail,
    sendWhatsApp: handleSendWhatsApp,
    sendLinkedIn: handleSendLinkedIn,
    syncEmails: runEmailSync,
    getEmails: getCachedEmails,
    getConfig: getCommConfig,
    saveConfig: saveCommConfig,
    getStats: getCommStats,
    testConnection: testImapConnection,
  };

})();
