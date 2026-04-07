// ============================================================
// COBRA — Knowledge Base Import / Export
// Supporta JSON (nativo) + CSV (semplice) + Markdown headings.
// ============================================================

(function () {
  'use strict';

  const VERSION = '5.3-beta1';

  // -------- EXPORT --------
  async function exportAll(format = 'json') {
    const payload = await collectState();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let blob, filename;

    if (format === 'json') {
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      filename = `cobra-kb-export-${stamp}.json`;
    } else if (format === 'markdown') {
      blob = new Blob([toMarkdown(payload)], { type: 'text/markdown' });
      filename = `cobra-kb-export-${stamp}.md`;
    } else if (format === 'csv') {
      blob = new Blob([toCsv(payload)], { type: 'text/csv' });
      filename = `cobra-kb-export-${stamp}.csv`;
    } else {
      throw new Error('Unknown format: ' + format);
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true, filename, size: blob.size };
  }

  async function collectState() {
    const storage = await new Promise(r =>
      chrome.storage.local.get(null, d => r(d || {}))
    );
    const payload = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      tester: storage.cobra_tester_session || null,
      settings: storage.cobra_settings || {},
      theme: storage.cobra_theme || 'aurora',
      budget: storage.cobra_token_budget || null,
      kb: {},
    };

    // Include Brain IndexedDB if accessible
    if (window.Brain && typeof window.Brain.exportAll === 'function') {
      try { payload.kb.brain = await window.Brain.exportAll(); } catch {}
    }
    // Chat memory
    if (window.ChatMemory && typeof window.ChatMemory.exportAll === 'function') {
      try { payload.kb.chatMemory = await window.ChatMemory.exportAll(); } catch {}
    }
    // Remote library
    if (window.RemoteLibrary && typeof window.RemoteLibrary.exportAll === 'function') {
      try { payload.kb.remoteLibrary = await window.RemoteLibrary.exportAll(); } catch {}
    }
    // Session diary
    if (window.SessionDiary && typeof window.SessionDiary.exportAll === 'function') {
      try { payload.kb.sessionDiary = await window.SessionDiary.exportAll(); } catch {}
    }
    return payload;
  }

  function toMarkdown(payload) {
    const lines = [
      `# COBRA Knowledge Base Export`,
      ``,
      `- **Version**: ${payload.version}`,
      `- **Exported**: ${payload.exportedAt}`,
      `- **Tester**: ${payload.tester?.name || 'N/A'}`,
      `- **Theme**: ${payload.theme}`,
      ``,
      `## Settings`,
      '```json',
      JSON.stringify(payload.settings, null, 2),
      '```',
      ``,
      `## Knowledge Base`,
      '```json',
      JSON.stringify(payload.kb, null, 2),
      '```',
      ``,
    ];
    return lines.join('\n');
  }

  function toCsv(payload) {
    const rows = [['type', 'id', 'title', 'content', 'tags']];
    const walk = (section, items) => {
      if (!items) return;
      if (Array.isArray(items)) {
        items.forEach(it => {
          rows.push([
            section,
            String(it.id || ''),
            String(it.title || it.name || '').replace(/"/g, '""'),
            String(it.content || it.text || '').replace(/"/g, '""').slice(0, 500),
            (it.tags || []).join(';'),
          ]);
        });
      }
    };
    const kb = payload.kb || {};
    walk('brain', kb.brain?.entries || kb.brain);
    walk('chatMemory', kb.chatMemory?.entries || kb.chatMemory);
    walk('library', kb.remoteLibrary?.entries || kb.remoteLibrary);
    walk('diary', kb.sessionDiary?.entries || kb.sessionDiary);
    return rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  }

  // -------- IMPORT --------
  async function importFromFile(file) {
    if (!file) throw new Error('No file provided');
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error('File non è un JSON valido. Solo export JSON sono importabili.');
    }
    if (!payload.version || !payload.kb) {
      throw new Error('Formato non riconosciuto. Serve un export Cobra valido.');
    }
    return applyImport(payload);
  }

  async function applyImport(payload) {
    const report = { applied: [], skipped: [], errors: [] };

    // Settings (merge, never override tester session or keys)
    if (payload.settings && typeof payload.settings === 'object') {
      try {
        const current = await new Promise(r =>
          chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {}))
        );
        const merged = { ...payload.settings, ...current }; // current wins to protect API keys
        await new Promise(r =>
          chrome.storage.local.set({ cobra_settings: merged }, r)
        );
        report.applied.push('settings');
      } catch (e) { report.errors.push('settings: ' + e.message); }
    }

    // Theme
    if (payload.theme) {
      try {
        await new Promise(r => chrome.storage.local.set({ cobra_theme: payload.theme }, r));
        report.applied.push('theme');
      } catch (e) { report.errors.push('theme: ' + e.message); }
    }

    // KB modules (each module handles its own importAll)
    const kb = payload.kb || {};
    const modules = [
      ['brain', window.Brain],
      ['chatMemory', window.ChatMemory],
      ['remoteLibrary', window.RemoteLibrary],
      ['sessionDiary', window.SessionDiary],
    ];
    for (const [name, mod] of modules) {
      if (kb[name] && mod && typeof mod.importAll === 'function') {
        try {
          await mod.importAll(kb[name]);
          report.applied.push(name);
        } catch (e) {
          report.errors.push(`${name}: ${e.message}`);
        }
      } else if (kb[name]) {
        report.skipped.push(name + ' (module not available)');
      }
    }

    return report;
  }

  // -------- UI HELPERS --------
  function promptImport() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return reject(new Error('No file selected'));
        try {
          const report = await importFromFile(file);
          resolve(report);
        } catch (e) { reject(e); }
      };
      input.click();
    });
  }

  // Expose API
  window.CobraKBIO = { exportAll, importFromFile, applyImport, promptImport };
})();
