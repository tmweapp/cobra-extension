// COBRA v3 — Agent Module
// Azioni umane nel browser: click, type, scroll, read, wait, navigate
// Fix: CSS.escape() per selettori, validazione input

const Agent = {

  // ============================================================
  // 1. CLICK
  // ============================================================
  clickScript() {
    return async function(selector, options) {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, error: `Elemento non trovato: ${selector}` };

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));

      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
      await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
      await new Promise(r => setTimeout(r, 50 + Math.random() * 80));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));

      if (typeof el.click === 'function' && !options.eventsOnly) {
        el.click();
      }

      return {
        ok: true,
        action: 'click',
        selector,
        text: el.textContent?.trim().slice(0, 100),
        tag: el.tagName.toLowerCase(),
      };
    };
  },

  // ============================================================
  // 2. TYPE
  // ============================================================
  typeScript() {
    return async function(selector, text) {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, error: `Elemento non trovato: ${selector}` };

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
      el.focus();
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100 + Math.random() * 150));

      if (el.value !== undefined) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        if (el.value !== undefined) {
          el.value += ch;
        } else if (el.isContentEditable) {
          document.execCommand('insertText', false, ch);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));

        const baseDelay = 80;
        const variance = 40;
        const delay = baseDelay + (Math.random() - 0.5) * variance * 2;
        const extra = ' .,;:!?'.includes(ch) ? 100 + Math.random() * 150 : 0;
        await new Promise(r => setTimeout(r, Math.max(30, delay + extra)));
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, action: 'type', selector, length: text.length };
    };
  },

  // ============================================================
  // 3. READ
  // ============================================================
  readScript() {
    return function(selector, options) {
      const els = document.querySelectorAll(selector);
      if (els.length === 0) return { ok: false, error: `Nessun elemento: ${selector}` };

      const results = [...els].slice(0, options.max || 50).map(el => {
        const data = { text: el.textContent?.trim() };
        if (el.href) data.href = el.href;
        if (el.src) data.src = el.src;
        if (el.value !== undefined) data.value = el.value;
        if (el.alt) data.alt = el.alt;
        if (el.title) data.title = el.title;
        data.tag = el.tagName.toLowerCase();
        data.classes = el.className;
        return data;
      });

      return { ok: true, action: 'read', selector, count: results.length, data: results };
    };
  },

  // ============================================================
  // 4. WAIT
  // ============================================================
  waitScript() {
    return function(selector, timeoutMs) {
      return new Promise(resolve => {
        const start = Date.now();
        const check = () => {
          const el = document.querySelector(selector);
          if (el) {
            resolve({ ok: true, action: 'wait', selector, waited: Date.now() - start });
            return;
          }
          if (Date.now() - start > timeoutMs) {
            resolve({ ok: false, error: `Timeout: ${selector} non apparso in ${timeoutMs}ms` });
            return;
          }
          setTimeout(check, 200);
        };
        check();
      });
    };
  },

  // ============================================================
  // 5. SCROLL
  // ============================================================
  scrollScript() {
    return function(target) {
      if (typeof target === 'string') {
        const el = document.querySelector(target);
        if (!el) return { ok: false, error: `Elemento non trovato: ${target}` };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { ok: true, action: 'scroll', target, type: 'element' };
      }
      const y = (target / 100) * document.documentElement.scrollHeight;
      window.scrollTo({ top: y, behavior: 'smooth' });
      return { ok: true, action: 'scroll', target, type: 'position' };
    };
  },

  // ============================================================
  // 6. SELECT
  // ============================================================
  selectScript() {
    return function(selector, value) {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, error: `Select non trovato: ${selector}` };
      if (el.tagName.toLowerCase() !== 'select') {
        return { ok: false, error: `Non è un select: ${el.tagName}` };
      }
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, action: 'select', selector, value };
    };
  },

  // ============================================================
  // 7. FORM FILL
  // ============================================================
  formFillScript() {
    return async function(fields) {
      const results = [];
      for (const [selector, value] of Object.entries(fields)) {
        const el = document.querySelector(selector);
        if (!el) {
          results.push({ selector, ok: false, error: 'non trovato' });
          continue;
        }

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
        el.focus();

        const tag = el.tagName.toLowerCase();
        const type = (el.type || '').toLowerCase();

        if (tag === 'select') {
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (type === 'checkbox' || type === 'radio') {
          if (el.checked !== !!value) el.click();
        } else {
          el.value = '';
          for (const ch of String(value)) {
            el.value += ch;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 60 + Math.random() * 60));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        results.push({ selector, ok: true, tag, type });
        await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      }
      return { ok: true, action: 'formFill', results };
    };
  },

  // ============================================================
  // 8. SNAPSHOT — Con CSS.escape() per selettori sicuri
  // ============================================================
  snapshotScript() {
    return function() {
      // CSS.escape fallback per ambienti senza CSS API
      const cssEscape = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape : (s) => s.replace(/([^\w-])/g, '\\$1');

      // Funzione per costruire selettori sicuri
      function buildSelector(el) {
        if (el.id) {
          return '#' + cssEscape(el.id);
        }
        if (el.name) {
          return `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`;
        }
        if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/).slice(0, 2)
            .map(c => cssEscape(c)).join('.');
          if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
        }
        // Fallback: nth-child
        const parent = el.parentElement;
        if (parent) {
          const siblings = [...parent.children];
          const idx = siblings.indexOf(el) + 1;
          return `${el.tagName.toLowerCase()}:nth-child(${idx})`;
        }
        return el.tagName.toLowerCase();
      }

      const snapshot = {
        url: location.href,
        title: document.title,
        buttons: [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
          .filter(el => el.offsetParent !== null)
          .slice(0, 20)
          .map(el => ({
            text: el.textContent?.trim().slice(0, 60),
            selector: buildSelector(el),
            tag: el.tagName.toLowerCase(),
          })),
        inputs: [...document.querySelectorAll('input, textarea, select')]
          .filter(el => el.offsetParent !== null)
          .slice(0, 20)
          .map(el => ({
            type: el.type || el.tagName.toLowerCase(),
            name: el.name,
            placeholder: el.placeholder,
            value: el.value?.slice(0, 50),
            selector: buildSelector(el),
          })),
        links: [...document.querySelectorAll('a[href]')]
          .filter(el => el.offsetParent !== null)
          .slice(0, 30)
          .map(el => ({
            text: el.textContent?.trim().slice(0, 60),
            href: el.href,
            selector: buildSelector(el),
          })),
        headings: [...document.querySelectorAll('h1,h2,h3')]
          .slice(0, 15)
          .map(el => ({ level: el.tagName, text: el.textContent?.trim().slice(0, 80) })),
        mainText: (document.querySelector('main, article, [role="main"]') || document.body)
          .textContent?.trim().slice(0, 2000),
      };

      return { ok: true, action: 'snapshot', ...snapshot };
    };
  },

  // ============================================================
  // 9. EXECUTE SEQUENCE
  // ============================================================
  async executeSequence(tabId, steps) {
    const results = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const result = await this.executeAction(tabId, step);
        results.push({ step: i, ...step, result });

        if (!result.ok && !step.optional) {
          return { ok: false, stoppedAt: i, reason: result.error, results };
        }

        if (i < steps.length - 1) {
          const delay = 800 + Math.random() * 1200;
          await new Promise(r => setTimeout(r, delay));
        }
      } catch (err) {
        results.push({ step: i, ...step, result: { ok: false, error: err.message } });
        if (!step.optional) {
          return { ok: false, stoppedAt: i, reason: err.message, results };
        }
      }
    }
    return { ok: true, results, totalSteps: steps.length };
  },

  // ============================================================
  // 10. EXECUTE SINGLE ACTION
  // ============================================================
  async executeAction(tabId, step) {
    if (!step || !step.action) {
      return { ok: false, error: 'Azione non specificata' };
    }

    let func, args;

    switch (step.action) {
      case 'click':
        func = this.clickScript();
        args = [step.selector, step.options || {}];
        break;
      case 'type':
        if (!step.text && step.text !== '') return { ok: false, error: 'Testo non specificato per type' };
        func = this.typeScript();
        args = [step.selector, step.text];
        break;
      case 'read':
        func = this.readScript();
        args = [step.selector, step.options || {}];
        break;
      case 'wait':
        func = this.waitScript();
        args = [step.selector, step.timeout || 10000];
        break;
      case 'scroll':
        func = this.scrollScript();
        args = [step.target || step.selector];
        break;
      case 'select':
        func = this.selectScript();
        args = [step.selector, step.value];
        break;
      case 'formFill':
        func = this.formFillScript();
        args = [step.fields];
        break;
      case 'snapshot':
        func = this.snapshotScript();
        args = [];
        break;
      case 'navigate':
        await chrome.tabs.update(tabId, { url: step.url });
        let navigationComplete = false;
        const timeout = setTimeout(() => {
          if (!navigationComplete) {
            chrome.tabs.onUpdated.removeListener(listener);
          }
        }, 15000);
        function listener(id, info) {
          if (id === tabId && info.status === 'complete') {
            navigationComplete = true;
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
        await new Promise(resolve => {
          const check = () => {
            if (navigationComplete) {
              setTimeout(resolve, 800);
            } else {
              setTimeout(check, 100);
            }
          };
          check();
        });
        return { ok: true, action: 'navigate', url: step.url };
      case 'delay':
        const ms = step.ms || 1000;
        await new Promise(r => setTimeout(r, ms + Math.random() * ms * 0.3));
        return { ok: true, action: 'delay', ms };
      default:
        return { ok: false, error: `Azione sconosciuta: ${step.action}` };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });

    return results?.[0]?.result || { ok: false, error: 'Nessun risultato' };
  },
};

// Export to service worker global scope (MV3 compatible)
if (typeof self !== 'undefined') {
  self.Agent = Agent;
}
