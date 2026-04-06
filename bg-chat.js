/**
 * COBRA v5.2 — Chat Controller
 * Handles: CHAT_MESSAGE, CHAT_ABORT, VOICE_SUMMARY
 *
 * CHAT_MESSAGE uses fire-and-forget pattern:
 *   - Returns {status:'processing'} immediately (no channel timeout)
 *   - Sends result via CHAT_RESPONSE broadcast when done
 *
 * Requires (loaded before this file):
 *   - self.CobraRouter (bg-router.js)
 *   - self.COBRA_TOOLS (tool-registry.js)
 *   - self._executeToolCall (tool-executor.js)
 *   - self.callDirectAI (provider-router.js)
 *   - self.buildSystemPrompt (cobra-kb-seed.js)
 *   - self.decisionEngine (decision-engine.js)
 *   - self.cobraKB (knowledge-base.js)
 */

// Ensure CobraRouter is available
self.CobraRouter = self.CobraRouter || {};

// ============================================================
// Helper: Get settings from Chrome storage
// ============================================================
async function getSettings() {
  return new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
}

// ============================================================
// Async chat processor — runs in background, broadcasts result
// ============================================================
async function _processChatMessage(payload) {
  const message = payload.message || '';
  const history = payload.history || [];
  const userMemories = payload.memories || [];
  const userHabits = payload.habits || {};
  const voiceMode = payload.voiceMode || false;

  // Helper to send result back to sidepanel
  const sendResult = (data) => {
    if (self.CobraSupervisor) {
      if (data.content && !data.content.startsWith('Errore')) {
        self.CobraSupervisor.completeRequest(data.content);
      } else {
        self.CobraSupervisor.failRequest(data.content || 'unknown error');
      }
    }
    chrome.runtime.sendMessage({ type: 'CHAT_RESPONSE', ...data }).catch(() => {});
  };

  // Start supervisor monitoring
  if (self.CobraSupervisor) {
    self.CobraSupervisor.startRequest(null, message);
  }

  try {
    const settings = await getSettings();

    // Ensure KB is loaded
    if (self.cobraKB && !self.cobraKB._loaded) {
      try { await self.cobraKB.load(); } catch {}
    }

    // Get current tab info
    let currentPage = { url: '', title: '', domain: '' };
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        currentPage.url = tab.url || '';
        currentPage.title = tab.title || '';
        try { currentPage.domain = new URL(tab.url).hostname; } catch {}
      }
    } catch {}

    // Build conversation messages
    const messages = [];
    for (const msg of history.slice(-8)) {
      if (!msg.role || !msg.content) continue;
      if (msg.role === 'system') continue;
      let content = String(msg.content).trim();
      if (!content) continue;
      if (msg.role === 'user' && content.length > 800) {
        content = content.substring(0, 800) + '...';
      }
      messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content });
    }

    // Build memory context
    let memoryContext = '';
    if (userMemories.length > 0) {
      memoryContext = '\n\nMEMORIA UTENTE (ultime note salvate):\n' +
        userMemories.slice(0, 5).map(m => `- [${m.type || 'nota'}] ${m.title}: ${typeof m.data === 'string' ? m.data.slice(0, 150) : ''}`).join('\n');
    }

    // Build habits context
    let habitsContext = '';
    if (userHabits.sites && Object.keys(userHabits.sites).length > 0) {
      const topSites = Object.entries(userHabits.sites).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
      habitsContext = `\nSiti frequenti dell'utente: ${topSites.join(', ')}`;
    }

    // Dynamic system prompt
    const systemPrompt = self.buildSystemPrompt
      ? self.buildSystemPrompt({ voiceMode, currentPage, memoryContext, habitsContext, message })
      : `Sei COBRA. Operi nel browser. Esegui, non discuti. Ricevi obiettivo → tools → risultato.${voiceMode ? ' Voce attiva: brevissimo.' : ''}${currentPage.url ? '\nPagina: ' + currentPage.title + ' — ' + currentPage.url : ''}${memoryContext}${habitsContext}`;

    messages.push({ role: 'user', content: message });

    // Token budget
    const estimatedTokens = Math.ceil((systemPrompt.length + messages.map(m => m.content || '').join('').length) / 4);
    if (estimatedTokens > 90000) {
      console.warn(`[COBRA] Token budget exceeded (${estimatedTokens}). Reducing history.`);
      if (messages.length > 4) messages.splice(0, messages.length - 4);
    }

    // Resolve effective keys
    const effectiveKeys = {
      openai: settings.openaiKey || settings.teamOpenaiKey || '',
      anthropic: settings.anthropicKey || settings.teamAnthropicKey || '',
      gemini: settings.geminiKey || settings.teamGeminiKey || '',
      groq: settings.groqKey || settings.teamGroqKey || ''
    };

    // Team access
    if (settings.fromTeam && typeof self.TeamAuth !== 'undefined') {
      try {
        const teamAccess = await self.TeamAuth.checkAccess();
        if (teamAccess && !teamAccess.valid) {
          sendResult({
            content: `Accesso team non valido: ${teamAccess.reason || 'limiti superati'}. Contatta l'admin o inserisci le tue API key nelle Impostazioni.`,
            actions: [{ label: 'Impostazioni', type: 'navigate', url: '' }],
            saveToMemory: false
          });
          return;
        }
        if (teamAccess?.shared_keys) {
          if (!settings.openaiKey && teamAccess.shared_keys.openai_key) effectiveKeys.openai = teamAccess.shared_keys.openai_key;
          if (!settings.anthropicKey && teamAccess.shared_keys.anthropic_key) effectiveKeys.anthropic = teamAccess.shared_keys.anthropic_key;
          if (!settings.geminiKey && teamAccess.shared_keys.gemini_key) effectiveKeys.gemini = teamAccess.shared_keys.gemini_key;
          if (!settings.groqKey && teamAccess.shared_keys.groq_key) effectiveKeys.groq = teamAccess.shared_keys.groq_key;
        }
      } catch (e) { console.warn('[COBRA] Team access check failed:', e); }
    }

    let result = null;
    let usedProvider = null;
    const toolOptions = { tools: self.COBRA_TOOLS, maxToolRounds: 10 };

    // DecisionEngine pre-analysis
    if (self.decisionEngine) {
      try {
        const preAnalysis = await self.decisionEngine.analyze(message, { currentUrl: currentPage.url });
        if (preAnalysis.intentClass !== 'conversation' && preAnalysis.intentClass !== 'unknown' && preAnalysis.confidence >= 0.8) {
          console.log(`[CHAT_MESSAGE] DecisionEngine: ${preAnalysis.intentClass} (${(preAnalysis.confidence * 100).toFixed(0)}%)`);
          try { chrome.runtime.sendMessage({ type: 'TOOL_PROGRESS', tool: 'decision_engine', status: `analisi: ${preAnalysis.intentClass}` }); } catch {}

          const deResult = await self.decisionEngine.processRequest(message, {
            currentUrl: currentPage.url,
            domain: currentPage.domain,
            tabTitle: currentPage.title
          });

          if (deResult && deResult.success) {
            sendResult({
              content: deResult.content || 'Operazione completata.',
              actions: (deResult.actions || []).map(a => ({ label: a.tool, type: 'info' })),
              saveToMemory: true
            });
            return;
          }
          console.log('[CHAT_MESSAGE] DecisionEngine partial/failed, falling through to LLM');
        }
      } catch (deError) {
        console.warn('[CHAT_MESSAGE] DecisionEngine error:', deError.message);
      }
    }

    // Check if aborted
    if (self._currentAIAbort?.signal?.aborted) {
      sendResult({ content: 'Operazione interrotta.', actions: [], saveToMemory: false });
      return;
    }

    // Standard LLM routing
    if (effectiveKeys.anthropic) {
      result = await self.callDirectAI('anthropic', effectiveKeys.anthropic, settings.anthropicModel || 'claude-sonnet-4-20250514', systemPrompt, messages, toolOptions);
      if (result) usedProvider = 'anthropic';
    }
    if (!result && effectiveKeys.openai) {
      result = await self.callDirectAI('openai', effectiveKeys.openai, settings.openaiModel || 'gpt-4o-mini', systemPrompt, messages, toolOptions);
      if (result) usedProvider = 'openai';
    }
    if (!result && effectiveKeys.gemini) {
      result = await self.callDirectAI('gemini', effectiveKeys.gemini, settings.geminiModel || 'gemini-2.0-flash', systemPrompt, messages, toolOptions);
      if (result) usedProvider = 'gemini';
    }
    if (!result && effectiveKeys.groq) {
      result = await self.callDirectAI('groq', effectiveKeys.groq, settings.groqModel || 'llama-3.3-70b-versatile', systemPrompt, messages, toolOptions);
      if (result) usedProvider = 'groq';
    }

    // Track team usage
    if (result && usedProvider && settings.fromTeam && typeof self.TeamAuth !== 'undefined') {
      try { await self.TeamAuth.trackUsage(usedProvider, 500); } catch {}
    }

    // Fallback Brain.think
    if (!result) {
      try {
        await self.Brain.init();
        const context = { habits: userHabits, memories: userMemories, history, domain: currentPage.domain, url: currentPage.url };
        const aiResponse = await self.Brain.think(message, context);
        result = aiResponse.response || (typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse));
      } catch (brainErr) {
        sendResult({
          content: 'Per usare COBRA configura almeno una API key nelle Impostazioni.',
          actions: [{ label: 'Impostazioni', type: 'navigate', url: '' }],
          saveToMemory: false
        });
        return;
      }
    }

    sendResult({
      content: result || 'Nessuna risposta dal server AI.',
      actions: [],
      saveToMemory: false
    });
  } catch (err) {
    sendResult({ content: `Errore: ${err.message}`, actions: [], saveToMemory: false });
  }
}

// ============================================================
// Register handlers on CobraRouter
// ============================================================
self.CobraRouter.registerTypes({
  'CHAT_MESSAGE': (payload) => {
    // Fire-and-forget: start async, return immediately
    _processChatMessage(payload).catch(err => {
      console.error('[CHAT_MESSAGE] Fatal:', err);
      chrome.runtime.sendMessage({ type: 'CHAT_RESPONSE', content: `Errore: ${err.message}`, actions: [], saveToMemory: false }).catch(() => {});
    });
    return { status: 'processing' };
  },

  'CHAT_ABORT': () => {
    if (self._currentAIAbort) {
      self._currentAIAbort.abort();
      self._currentAIAbort = null;
    }
    if (self.CobraSupervisor) self.CobraSupervisor.abort();
    console.log('[COBRA] AI request aborted by user');
    return { ok: true };
  },

  'VOICE_SUMMARY': async (payload) => {
    const { text, context } = payload;
    try {
      const settings = await getSettings();
      const sysPrompt = 'Sei un assistente vocale. Rispondi SOLO con una frase breve (max 30 parole) da dire a voce. Tono naturale e colloquiale, come un collega che parla. Non usare elenchi, formattazione, o emoji. Solo testo parlato.';
      const msgs = [{ role: 'user', content: `Riassumi questo in una frase breve da dire a voce (max 30 parole): ${text.substring(0, 800)}` }];

      const keys = { openai: settings.openaiKey, anthropic: settings.anthropicKey, gemini: settings.geminiKey, groq: settings.groqKey };
      let result = null;
      if (keys.groq) result = await self.callDirectAI('groq', keys.groq, 'llama-3.3-70b-versatile', sysPrompt, msgs);
      if (!result && keys.openai) result = await self.callDirectAI('openai', keys.openai, 'gpt-4o-mini', sysPrompt, msgs);
      if (!result && keys.anthropic) result = await self.callDirectAI('anthropic', keys.anthropic, 'claude-3-5-sonnet-20241022', sysPrompt, msgs);
      if (!result && keys.gemini) result = await self.callDirectAI('gemini', keys.gemini, 'gemini-1.5-flash', sysPrompt, msgs);

      return { summary: result || '' };
    } catch {
      return { summary: '' };
    }
  }
});

console.log('[bg-chat.js] Loaded: CHAT_MESSAGE (fire-and-forget), CHAT_ABORT, VOICE_SUMMARY');
