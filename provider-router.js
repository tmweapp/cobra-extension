/**
 * COBRA v5.2 — Provider Router
 * Multi-provider AI function with tool calling.
 * Supports: OpenAI, Groq, Anthropic, Gemini
 * Extracted from bg-chat.js for modularity.
 *
 * Requires: self._executeToolCall (from tool-executor.js)
 */

// ============================================================
// Thinking Stream — Human-like reasoning messages in chat
// ============================================================
function emitThinking(text) {
  try {
    chrome.runtime.sendMessage({
      type: 'COBRA_THINKING',
      text: text,
      timestamp: Date.now()
    });
  } catch(e) {}
}

// Generate contextual thinking message based on tool + args
function getThinkingBefore(toolName, args) {
  const thoughts = {
    navigate: () => `Ok, vado su ${(args.url || '').replace(/^https?:\/\//, '').split('/')[0]}...`,
    google_search: () => `Cerco "${args.query}"... vediamo cosa esce.`,
    click_element: () => `Provo a cliccare su ${args.selector ? args.selector.slice(0, 40) : 'elemento'}...`,
    fill_form: () => {
      const fields = typeof args.fields === 'object' ? Object.keys(args.fields) : [];
      return `Compilo il form${fields.length ? ': ' + fields.slice(0, 3).join(', ') : ''}...`;
    },
    execute_js: () => `Eseguo uno script sulla pagina per analizzarla meglio...`,
    scrape_url: () => `Estraggo il contenuto da ${(args.url || '').replace(/^https?:\/\//, '').split('/')[0]}...`,
    read_page_content: () => `Leggo il contenuto della pagina...`,
    scroll_page: () => `Scorro la pagina per vedere di più...`,
    take_screenshot: () => `Faccio uno screenshot della situazione attuale...`,
    get_page_links: () => `Raccolgo i link dalla pagina...`,
    extract_table: () => `Estraggo una tabella dalla pagina...`,
    extract_structured_data: () => `Analizzo i dati strutturati della pagina...`,
    wait_for_element: () => `Aspetto che l'elemento appaia...`,
    get_tab_info: () => `Controllo le informazioni del tab...`,
  };
  const fn = thoughts[toolName];
  return fn ? fn() : `Eseguo ${toolName}...`;
}

function getThinkingAfter(toolName, result, isError) {
  if (isError) {
    const errors = {
      navigate: `Non riesco ad aprire la pagina. Provo un altro approccio...`,
      click_element: `Non trovo l'elemento da cliccare. Verifico la pagina...`,
      fill_form: `Problema con il form. Controllo i campi disponibili...`,
      google_search: `Problema con la ricerca. Riprovo...`,
    };
    return errors[toolName] || `Hmm, ${toolName} ha dato errore. Vediamo come procedere...`;
  }
  const success = {
    navigate: () => {
      try {
        const r = JSON.parse(result);
        return `Sono sulla pagina "${(r.title || '').slice(0, 50)}". Analizzo il contenuto...`;
      } catch { return `Pagina caricata. Vediamo cosa c'è...`; }
    },
    google_search: () => {
      try {
        const r = JSON.parse(result);
        const count = r.results?.length || 0;
        return `Trovati ${count} risultati. Li analizzo...`;
      } catch { return `Risultati trovati. Analizzo...`; }
    },
    click_element: () => `Ok, cliccato. Verifico il risultato...`,
    fill_form: () => `Form compilato. Verifico...`,
    read_page_content: () => `Contenuto letto. Elaboro le informazioni...`,
    scrape_url: () => `Contenuto estratto. Lo analizzo...`,
  };
  const fn = success[toolName];
  return fn ? fn() : `${toolName} completato. Proseguo...`;
}

// Global abort controller for current AI request
self._currentAIAbort = null;

async function callDirectAI(provider, apiKey, model, systemPrompt, messages, options = {}) {
  const { tools = null, maxToolRounds = 5 } = options;
  // Create abort controller for this request
  const abortController = new AbortController();
  self._currentAIAbort = abortController;
  const signal = abortController.signal;
  try {
    if (provider === 'openai' || provider === 'groq') {
      const baseUrl = provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const apiMessages = [{ role: 'system', content: systemPrompt }, ...messages];

      let round = 0;
      const toolCallLog = [];
      while (round < maxToolRounds) {
        round++;
        const body = { model, messages: apiMessages, max_tokens: 3000, temperature: 0.7 };
        if (tools && round <= maxToolRounds) {
          body.tools = tools;
          body.tool_choice = 'auto';
        }
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || res.status); }
        const data = await res.json();
        const choice = data.choices?.[0];
        if (!choice) return '';

        // If the AI wants to call tools
        if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length > 0) {
          const assistantMsg = choice.message;
          apiMessages.push(assistantMsg);

          for (const tc of assistantMsg.tool_calls) {
            console.log(`[COBRA Tool] Executing: ${tc.function.name}`, tc.function.arguments);
            let args = {};
            try { args = JSON.parse(tc.function.arguments); } catch {}
            emitThinking(getThinkingBefore(tc.function.name, args));

            // Check for circular tool loop
            const argsHash = JSON.stringify(args).substring(0, 50);
            const toolKey = tc.function.name + ':' + argsHash;
            const sameToolCount = toolCallLog.filter(t => t === toolKey).length;
            if (sameToolCount >= 3) {
              console.warn(`[COBRA] Circular tool loop detected: ${tc.function.name} called 3+ times with same args. Breaking.`);
              apiMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify({ error: 'Circular loop: strumento chiamato ripetutamente con gli stessi parametri. Prova un approccio diverso.' })
              });
              break;
            }
            toolCallLog.push(toolKey);

            const result = await self._executeToolCall(tc.function.name, args);
            const isErr = result && result.includes('"error"');
            if (self.CobraSupervisor) self.CobraSupervisor.recordActivity(tc.function.name, args, result, isErr);
            emitThinking(getThinkingAfter(tc.function.name, result, isErr));
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result
            });

            // Send progress update to sidepanel
            try {
              chrome.runtime.sendMessage({
                type: 'TOOL_PROGRESS',
                payload: {
                  tool: tc.function.name,
                  step: round,
                  total: maxToolRounds,
                  status: result && result.includes('error') ? 'error' : 'ok',
                  summary: `${tc.function.name}... ${result && result.includes('error') ? 'errore' : 'fatto'}`
                }
              });
            } catch(e) {} // sidepanel may not be listening, that's OK
          }
          // Continue the loop so AI can process tool results
          continue;
        }

        // AI returned a text response (done)
        return choice.message?.content || '';
      }
      // Max rounds reached — get the last text response, not tool results
      for (let i = apiMessages.length - 1; i >= 0; i--) {
        const m = apiMessages[i];
        if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content;
      }
      return 'Operazione completata.';
    }

    if (provider === 'anthropic') {
      // Anthropic tool use
      const anthropicTools = tools ? tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      })) : undefined;

      const apiMessages = [...messages];
      let round = 0;
      const toolCallLog = [];
      while (round < maxToolRounds) {
        round++;
        const body = { model, max_tokens: 3000, system: systemPrompt, messages: apiMessages, temperature: 0.7 };
        if (anthropicTools) body.tools = anthropicTools;
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify(body),
          signal
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || res.status); }
        const data = await res.json();

        // Check for tool use
        const toolUseBlocks = data.content?.filter(b => b.type === 'tool_use') || [];
        const textBlocks = data.content?.filter(b => b.type === 'text') || [];

        if (toolUseBlocks.length > 0 && data.stop_reason === 'tool_use') {
          apiMessages.push({ role: 'assistant', content: data.content });
          const toolResults = [];
          for (const tu of toolUseBlocks) {
            console.log(`[COBRA Tool] Executing: ${tu.name}`, tu.input);
            emitThinking(getThinkingBefore(tu.name, tu.input || {}));

            // Check for circular tool loop
            const argsHash = JSON.stringify(tu.input || {}).substring(0, 50);
            const toolKey = tu.name + ':' + argsHash;
            const sameToolCount = toolCallLog.filter(t => t === toolKey).length;
            if (sameToolCount >= 3) {
              console.warn(`[COBRA] Circular tool loop detected: ${tu.name} called 3+ times with same args. Breaking.`);
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ error: 'Circular loop: strumento chiamato ripetutamente con gli stessi parametri. Prova un approccio diverso.' }) });
              break;
            }
            toolCallLog.push(toolKey);

            const result = await self._executeToolCall(tu.name, tu.input || {});
            const isErr = result && result.includes('"error"');
            if (self.CobraSupervisor) self.CobraSupervisor.recordActivity(tu.name, tu.input || {}, result, isErr);
            emitThinking(getThinkingAfter(tu.name, result, isErr));
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });

            // Send progress update to sidepanel
            try {
              chrome.runtime.sendMessage({
                type: 'TOOL_PROGRESS',
                payload: {
                  tool: tu.name,
                  step: round,
                  total: maxToolRounds,
                  status: result && result.includes('error') ? 'error' : 'ok',
                  summary: `${tu.name}... ${result && result.includes('error') ? 'errore' : 'fatto'}`
                }
              });
            } catch(e) {} // sidepanel may not be listening, that's OK
          }
          apiMessages.push({ role: 'user', content: toolResults });
          continue;
        }

        // Return text response
        return textBlocks.map(b => b.text).join('\n') || '';
      }
      return '';
    }

    if (provider === 'gemini') {
      // Gemini with function calling
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

      const geminiTools = tools ? [{
        functionDeclarations: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        }))
      }] : undefined;

      let round = 0;
      const toolCallLog = [];
      while (round < maxToolRounds) {
        round++;
        const body = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 3000, temperature: 0.7 }
        };
        if (geminiTools) body.tools = geminiTools;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || res.status); }
        const data = await res.json();
        const candidate = data.candidates?.[0];
        if (!candidate) return '';

        const parts = candidate.content?.parts || [];
        const funcCalls = parts.filter(p => p.functionCall);
        const textParts = parts.filter(p => p.text);

        if (funcCalls.length > 0) {
          contents.push({ role: 'model', parts });
          const responseParts = [];
          for (const fc of funcCalls) {
            console.log(`[COBRA Tool] Executing: ${fc.functionCall.name}`, fc.functionCall.args);
            emitThinking(getThinkingBefore(fc.functionCall.name, fc.functionCall.args || {}));

            // Check for circular tool loop
            const argsHash = JSON.stringify(fc.functionCall.args || {}).substring(0, 50);
            const toolKey = fc.functionCall.name + ':' + argsHash;
            const sameToolCount = toolCallLog.filter(t => t === toolKey).length;
            if (sameToolCount >= 3) {
              console.warn(`[COBRA] Circular tool loop detected: ${fc.functionCall.name} called 3+ times with same args. Breaking.`);
              let parsed = { error: 'Circular loop: strumento chiamato ripetutamente con gli stessi parametri. Prova un approccio diverso.' };
              responseParts.push({ functionResponse: { name: fc.functionCall.name, response: parsed } });
              break;
            }
            toolCallLog.push(toolKey);

            const result = await self._executeToolCall(fc.functionCall.name, fc.functionCall.args || {});
            let parsed = {};
            try { parsed = JSON.parse(result); } catch { parsed = { result }; }
            const isErr = parsed.error ? true : false;
            if (self.CobraSupervisor) self.CobraSupervisor.recordActivity(fc.functionCall.name, fc.functionCall.args || {}, result, isErr);
            emitThinking(getThinkingAfter(fc.functionCall.name, result, isErr));
            responseParts.push({ functionResponse: { name: fc.functionCall.name, response: parsed } });

            // Send progress update to sidepanel
            try {
              chrome.runtime.sendMessage({
                type: 'TOOL_PROGRESS',
                payload: {
                  tool: fc.functionCall.name,
                  step: round,
                  total: maxToolRounds,
                  status: parsed.error ? 'error' : 'ok',
                  summary: `${fc.functionCall.name}... ${parsed.error ? 'errore' : 'fatto'}`
                }
              });
            } catch(e) {} // sidepanel may not be listening, that's OK
          }
          contents.push({ role: 'user', parts: responseParts });
          continue;
        }

        return textParts.map(p => p.text).join('\n') || '';
      }
      return '';
    }

    return null;
  } catch (err) {
    console.error(`[callDirectAI] ${provider} error:`, err);
    return null;
  }
}

self.callDirectAI = callDirectAI;
self.COBRA_TOOLS = COBRA_TOOLS;

console.log('[provider-router.js] Loaded: callDirectAI registered');
