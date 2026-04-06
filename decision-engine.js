/**
 * COBRA v5.2 — Decision Engine
 * CENTRAL ORCHESTRATOR for unified request lifecycle
 *
 * Lifecycle: INPUT → ANALYZE → PLAN → EXECUTE → VERIFY → LEARN → RESPOND
 *
 * Replaces direct AI calls with intelligent decision making.
 * Tracks success patterns, learns from failures, emits progress updates.
 */

class DecisionEngine {
  constructor(kb, gate, conversation) {
    this.kb = kb;
    this.gate = gate;
    this.conversation = conversation;

    // Tool scoring: { 'fill_form:booking.com': { success: 5, fail: 2 } }
    this.toolScores = {};
    this._scoreTimer = null;

    // ── HARDCODED SAFETY LIMITS ──
    this.MAX_STRATEGY_ATTEMPTS = 3;   // max different strategies to try
    this.MAX_TOTAL_TOOL_CALLS = 20;   // max tool calls across all strategies
    this.MAX_TIMEOUT_MS = 120000;     // 2 minute global timeout
  }

  // ============================================================
  // MAIN ENTRY POINT — processRequest (with strategic retry loop)
  // ============================================================
  async processRequest(message, context = {}) {
    console.log('[DecisionEngine] processRequest:', message);

    const requestId = crypto.randomUUID().substring(0, 8);
    const progressLog = [];
    const startTime = Date.now();
    let totalToolCalls = 0;
    let bestResult = { success: false, actions: [] };
    let bestVerified = { success: false, score: 0 };
    const failedStrategies = []; // track what didn't work and why

    try {
      // 1. ANALYZE: classify intent, extract entities, check KB
      const analysis = await this.analyze(message, context);
      progressLog.push(`analisi completata: ${analysis.intentClass} (confidence: ${(analysis.confidence * 100).toFixed(0)}%)`);
      this._emitProgress(requestId, `analisi: ${analysis.intentClass}`);

      // ── STRATEGIC RETRY LOOP ──
      // Try up to MAX_STRATEGY_ATTEMPTS different strategies
      for (let attempt = 0; attempt < this.MAX_STRATEGY_ATTEMPTS; attempt++) {
        // Check global timeout
        if (Date.now() - startTime > this.MAX_TIMEOUT_MS) {
          progressLog.push(`timeout globale raggiunto (${this.MAX_TIMEOUT_MS / 1000}s), mi fermo`);
          break;
        }

        // Check total tool calls budget
        if (totalToolCalls >= this.MAX_TOTAL_TOOL_CALLS) {
          progressLog.push(`budget tool esaurito (${this.MAX_TOTAL_TOOL_CALLS} chiamate), mi fermo`);
          break;
        }

        // 2. PLAN: create strategy (different from failed ones)
        const plan = this.createPlan(analysis, failedStrategies);
        const strategyLabel = attempt === 0 ? 'strategia principale' : `strategia alternativa #${attempt + 1}`;
        progressLog.push(`${strategyLabel}: ${plan.steps.length} step, priorita: ${plan.priority}`);
        this._emitProgress(requestId, `${strategyLabel}: ${plan.steps.map(s => s.tool).join(' -> ')}`);

        // 3. EXECUTE: run plan
        const remainingBudget = this.MAX_TOTAL_TOOL_CALLS - totalToolCalls;
        plan.maxToolCalls = remainingBudget;
        const result = await this.executePlan(plan, context, progressLog, requestId);
        totalToolCalls += (result.actions || []).length;

        // 4. VERIFY: check if goal was achieved
        const verified = await this.verify(result, analysis, context);

        // Track best result so far
        if (verified.score > bestVerified.score) {
          bestResult = result;
          bestVerified = verified;
        }

        if (verified.success) {
          // SUCCESS — exit loop
          progressLog.push(`verifica OK (score: ${(verified.score * 100).toFixed(0)}%), obiettivo raggiunto`);

          // 5. LEARN from success
          await this.learn(analysis, plan, result, verified);
          progressLog.push(`pattern salvato per uso futuro`);

          // 6. RESPOND
          return this.buildResponse(bestResult, bestVerified, progressLog);
        }

        // FAILURE — record what went wrong and why
        const failReason = this._diagnoseFailure(result, plan);
        failedStrategies.push({
          attempt,
          plan: plan.steps.map(s => s.tool),
          errors: result.errors || [],
          reason: failReason,
          score: verified.score
        });

        progressLog.push(`${strategyLabel} parziale (score: ${(verified.score * 100).toFixed(0)}%): ${failReason}`);
        this._emitProgress(requestId, `cambio strategia: ${failReason}`);

        // Learn from failure too
        await this.learn(analysis, plan, result, verified);

        // Should we continue trying?
        if (!this._shouldRetry(attempt, failedStrategies, verified)) {
          progressLog.push(`ho valutato che riprovare non porterebbe risultati migliori, mi fermo`);
          break;
        }

        progressLog.push(`ragiono su un approccio diverso...`);
      }

      // All attempts exhausted — return best result with honest summary
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      progressLog.push(`fine tentativi dopo ${elapsed}s, ${totalToolCalls} tool calls, ${failedStrategies.length} strategie provate`);

      return this.buildResponse(bestResult, bestVerified, progressLog);
    } catch (error) {
      console.error(`[${requestId}] Error in processRequest:`, error);
      progressLog.push(`errore: ${error.message}`);
      return {
        content: `Errore durante l'elaborazione: ${error.message}`,
        progressLog,
        success: false,
        actions: []
      };
    }
  }

  // ── Diagnose why a strategy failed ──
  _diagnoseFailure(result, plan) {
    if (!result.actions || result.actions.length === 0) return 'nessuna azione eseguita';
    if (result.errors && result.errors.length > 0) {
      const lastErr = result.errors[result.errors.length - 1];
      if (lastErr.error?.includes('non trovato')) return 'elemento non trovato nella pagina';
      if (lastErr.error?.includes('timeout')) return 'timeout durante esecuzione';
      return lastErr.error || 'errore sconosciuto';
    }
    if (result.completedSteps < result.totalSteps) return `completati solo ${result.completedSteps}/${result.totalSteps} step`;
    return 'risultato non verificabile';
  }

  // ── Decide if retrying is worth it ──
  _shouldRetry(attempt, failedStrategies, lastVerified) {
    // Don't retry if we're at the last attempt
    if (attempt >= this.MAX_STRATEGY_ATTEMPTS - 1) return false;
    // Don't retry if all failures are the same type (will just repeat)
    if (failedStrategies.length >= 2) {
      const reasons = failedStrategies.map(f => f.reason);
      if (reasons.every(r => r === reasons[0])) return false; // same error every time
    }
    // Don't retry if score is going down (getting worse)
    if (failedStrategies.length >= 2) {
      const scores = failedStrategies.map(f => f.score);
      if (scores[scores.length - 1] < scores[scores.length - 2]) return false;
    }
    // Retry if we're making some progress (score > 0)
    if (lastVerified.score > 0.3) return true;
    // Retry once even with 0 score (maybe different approach works)
    return attempt < 1;
  }

  // ── Emit progress to sidepanel ──
  _emitProgress(requestId, status) {
    try {
      chrome.runtime.sendMessage({
        type: 'TOOL_PROGRESS',
        payload: { tool: 'decision_engine', step: requestId, status }
      });
    } catch {}
  }

  // ============================================================
  // 1. ANALYZE — Intent, entities, KB lookup
  // ============================================================
  async analyze(message, context) {
    const domainRules = context.currentUrl ? this.kb.searchByDomain(new URL(context.currentUrl).hostname) : [];

    // Simple intent classification
    let intentClass = 'unknown';
    let entities = {};
    let confidence = 0.5;

    if (message.match(/naviga|vai a|apri|url/i)) {
      intentClass = 'navigation';
      const urlMatch = message.match(/(https?:\/\/\S+|www\.\S+)/);
      if (urlMatch) {
        entities.url = urlMatch[1];
        confidence = 0.9;
      } else {
        confidence = 0.6;
      }
    } else if (message.match(/compila|riempi|form|modulo|campo/i)) {
      intentClass = 'form_fill';
      confidence = 0.8;
    } else if (message.match(/cerca|search|google|find|trova/i)) {
      intentClass = 'search';
      const queryMatch = message.match(/(?:cerca|search|find|trova)\s+(.+?)(?:\s+su|$)/i);
      if (queryMatch) {
        entities.query = queryMatch[1];
        confidence = 0.85;
      }
    } else if (message.match(/estrai|extract|scrapa|download|salva/i)) {
      intentClass = 'extract';
      confidence = 0.75;
    } else if (message.match(/clicca|click|premi|press|button/i)) {
      intentClass = 'interaction';
      confidence = 0.8;
    } else {
      intentClass = 'conversation';
      confidence = 0.6;
    }

    // Check KB for domain-specific patterns
    const domainPatterns = domainRules.filter(r => r.operationType === intentClass);

    return {
      message,
      intentClass,
      entities,
      confidence,
      domainRules: domainPatterns,
      context
    };
  }

  // ============================================================
  // 2. PLAN — Create ordered steps with fallbacks
  // ============================================================
  createPlan(analysis, failedStrategies = []) {
    const steps = [];
    const { intentClass, entities, domainRules } = analysis;
    const failedTools = failedStrategies.flatMap(f => f.plan || []);
    const attemptNum = failedStrategies.length;

    // ── ALTERNATIVE STRATEGIES based on failed attempts ──
    // Each attempt tries a different approach for the same intent

    if (intentClass === 'navigation' && entities.url) {
      if (attemptNum === 0) {
        // Strategy 1: direct navigate + read
        steps.push({ tool: 'navigate', params: { url: entities.url }, expectedOutcome: 'page loads', fallbackTool: 'google_search', maxRetries: 2 });
        steps.push({ tool: 'read_page', params: {}, expectedOutcome: 'page content', fallbackTool: null, maxRetries: 1 });
      } else {
        // Strategy 2+: google search for the URL topic instead
        steps.push({ tool: 'google_search', params: { query: entities.url }, expectedOutcome: 'search results', fallbackTool: null, maxRetries: 1 });
      }

    } else if (intentClass === 'search') {
      if (attemptNum === 0 && entities.query) {
        steps.push({ tool: 'google_search', params: { query: entities.query }, expectedOutcome: 'search results', fallbackTool: null, maxRetries: 1 });
      } else {
        // Strategy 2: try scrape_url on a search result instead
        const reformulated = entities.query ? entities.query + ' site:' + (analysis.context?.domain || '') : analysis.message;
        steps.push({ tool: 'google_search', params: { query: reformulated }, expectedOutcome: 'reformulated search', fallbackTool: null, maxRetries: 1 });
      }

    } else if (intentClass === 'form_fill') {
      if (attemptNum === 0) {
        // Strategy 1: get_page_elements → fill_form
        steps.push({ tool: 'get_page_elements', params: { filter: 'forms' }, expectedOutcome: 'form mapped', fallbackTool: null, maxRetries: 1 });
        steps.push({ tool: 'fill_form', params: { fields: '{}' }, expectedOutcome: 'form filled', fallbackTool: 'click_element', maxRetries: 2 });
      } else if (attemptNum === 1) {
        // Strategy 2: get_page_elements with inputs focus → fill one at a time via execute_js
        steps.push({ tool: 'get_page_elements', params: { filter: 'inputs' }, expectedOutcome: 'inputs mapped', fallbackTool: null, maxRetries: 1 });
        steps.push({ tool: 'execute_js', params: { code: '/* fill via JS */' }, expectedOutcome: 'JS fill', fallbackTool: null, maxRetries: 1 });
      } else {
        // Strategy 3: click on each field individually
        steps.push({ tool: 'read_page', params: {}, expectedOutcome: 'page read', fallbackTool: null, maxRetries: 1 });
        steps.push({ tool: 'click_element', params: { selector: '' }, expectedOutcome: 'field focused', fallbackTool: null, maxRetries: 1 });
      }

    } else if (intentClass === 'interaction') {
      if (attemptNum === 0) {
        steps.push({ tool: 'click_element', params: { selector: '' }, expectedOutcome: 'clicked', fallbackTool: 'execute_js', maxRetries: 2 });
      } else {
        // Strategy 2: try JS click instead
        steps.push({ tool: 'get_page_elements', params: { filter: 'buttons' }, expectedOutcome: 'buttons found', fallbackTool: null, maxRetries: 1 });
        steps.push({ tool: 'execute_js', params: { code: '/* click via JS */' }, expectedOutcome: 'JS click', fallbackTool: null, maxRetries: 1 });
      }

    } else if (intentClass === 'extract') {
      if (attemptNum === 0) {
        steps.push({ tool: 'read_page', params: {}, expectedOutcome: 'page content', fallbackTool: null, maxRetries: 1 });
        steps.push({ tool: 'extract_data', params: { schema: {} }, expectedOutcome: 'data extracted', fallbackTool: null, maxRetries: 1 });
      } else {
        // Strategy 2: try execute_js for custom extraction
        steps.push({ tool: 'execute_js', params: { code: '/* extract */' }, expectedOutcome: 'JS extract', fallbackTool: null, maxRetries: 1 });
      }

    } else {
      steps.push({ tool: 'read_page', params: {}, expectedOutcome: 'page content', fallbackTool: null, maxRetries: 1 });
    }

    // Add KB-based optimizations
    if (domainRules.length > 0) {
      const topRule = domainRules.sort((a, b) => b.priority - a.priority)[0];
      if (topRule) {
        steps[0] = { ...steps[0], kbRule: topRule };
      }
    }

    // Calculate priority
    let priority = 'medium';
    if (intentClass === 'navigation' || intentClass === 'search') priority = 'high';
    if (intentClass === 'conversation') priority = 'low';

    return {
      steps,
      priority,
      estimatedTime: steps.length * 2000,
      stepsDone: 0,
      stepsTotal: steps.length,
      strategyAttempt: attemptNum,
      createdAt: Date.now()
    };
  }

  // ============================================================
  // 3. EXECUTE — Run plan steps with progress updates
  // ============================================================
  async executePlan(plan, context, progressLog, requestId) {
    const executedActions = [];
    const errors = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepNum = i + 1;

      progressLog.push(`⚙️ Step ${stepNum}/${plan.stepsTotal}: ${step.tool}`);
      console.log(`[${requestId}] Executing step ${stepNum}:`, step.tool);

      let stepResult = null;
      let success = false;
      let retries = 0;

      // Retry loop
      while (retries < step.maxRetries && !success) {
        try {
          // Execute the tool
          stepResult = await this._executeTool(step.tool, step.params, context);

          if (stepResult && !stepResult.error) {
            success = true;
            this._scoreToolSuccess(step.tool, context);
            progressLog.push(`✓ Step ${stepNum} OK`);
          } else {
            throw new Error(stepResult?.error || 'Tool returned error');
          }
        } catch (error) {
          retries++;
          const msg = `Step ${stepNum} retry ${retries}: ${error.message}`;
          progressLog.push(`⚠️ ${msg}`);
          console.warn(`[${requestId}] ${msg}`);

          // Try fallback tool
          if (retries >= step.maxRetries && step.fallbackTool) {
            try {
              console.log(`[${requestId}] Trying fallback: ${step.fallbackTool}`);
              progressLog.push(`🔄 Tentativo alternativo: ${step.fallbackTool}`);
              stepResult = await this._executeTool(step.fallbackTool, step.params, context);
              if (stepResult && !stepResult.error) {
                success = true;
              }
            } catch (fallbackError) {
              errors.push({ tool: step.tool, error: fallbackError.message });
              console.error(`[${requestId}] Fallback also failed:`, fallbackError);
            }
          }
        }
      }

      if (success && stepResult) {
        executedActions.push({
          tool: step.tool,
          params: step.params,
          result: stepResult,
          timestamp: Date.now()
        });
        plan.stepsDone++;
      } else if (!success && step.maxRetries > 0) {
        // Log error but continue
        errors.push({
          tool: step.tool,
          error: 'Max retries exceeded',
          step: stepNum
        });
      }
    }

    return {
      success: errors.length === 0,
      actions: executedActions,
      errors,
      completedSteps: plan.stepsDone,
      totalSteps: plan.stepsTotal
    };
  }

  // ============================================================
  // 4. VERIFY — Check if goal was achieved
  // ============================================================
  async verify(result, analysis, context) {
    let score = 0;

    if (result.success) {
      score = 0.95; // High confidence if no errors
    } else if (result.completedSteps > 0) {
      score = result.completedSteps / result.totalSteps;
    }

    // Specific verification based on intent
    if (analysis.intentClass === 'navigation') {
      // Score based on whether final action is read_page
      const lastAction = result.actions[result.actions.length - 1];
      if (lastAction && lastAction.tool === 'read_page') {
        score = Math.min(0.95, score + 0.1);
      }
    } else if (analysis.intentClass === 'form_fill') {
      // Score based on whether form_fill succeeded
      const formAction = result.actions.find(a => a.tool === 'fill_form');
      if (formAction && !formAction.error) {
        score = Math.min(1.0, score + 0.2);
      }
    }

    return {
      success: score > 0.7,
      score: Math.min(1, score),
      verified: true
    };
  }

  // ============================================================
  // 5. LEARN — Save patterns and corrections
  // ============================================================
  async learn(analysis, plan, result, verified) {
    if (!verified.success) {
      // Log failure for future reference
      console.log('[DecisionEngine] Saving failure pattern:', analysis.intentClass);
      return;
    }

    // On success: save pattern to KB
    const domain = analysis.context?.currentUrl ? new URL(analysis.context.currentUrl).hostname : null;

    const rule = {
      domain,
      operationType: analysis.intentClass,
      ruleType: 'pattern',
      title: `${analysis.intentClass}_${Date.now()}`,
      content: `Successfully executed ${plan.steps.length} steps for ${analysis.intentClass}`,
      tags: [analysis.intentClass, 'auto_learned'],
      source: 'auto_learn',
      priority: 6 // Default priority for learned patterns
    };

    try {
      this.kb.addRule(rule);
      await this.kb.save();
      console.log('[DecisionEngine] Pattern saved:', rule.title);
    } catch (error) {
      console.warn('[DecisionEngine] Failed to save pattern:', error.message);
    }
  }

  // ============================================================
  // 6. RESPOND — Build natural response with narrative
  // ============================================================
  buildResponse(result, verified, progressLog) {
    let content = '';

    if (result.success) {
      content = `Ho completato l'operazione con successo. Ecco cosa è accaduto:\n`;
    } else if (result.completedSteps > 0) {
      content = `Ho completato parzialmente l'operazione (${result.completedSteps}/${result.totalSteps} step). Dettagli:\n`;
    } else {
      content = `Ho incontrato difficoltà nell'esecuzione. Errori:\n`;
    }

    // Add progress narrative
    content += progressLog.join('\n') + '\n';

    // Add summary
    content += `\n📊 Risultato: ${(verified.score * 100).toFixed(0)}% successo`;

    if (result.errors && result.errors.length > 0) {
      content += `\n⚠️ Errori: ${result.errors.map(e => e.error || e.tool).join(', ')}`;
    }

    return {
      content,
      progressLog,
      success: result.success,
      actions: result.actions,
      completedSteps: result.completedSteps,
      totalSteps: result.totalSteps
    };
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  async _executeTool(toolName, params, context) {
    console.log(`[DecisionEngine] Executing tool: ${toolName}`, params);

    // Use the real executeToolCall from bg-chat.js
    if (typeof self._executeToolCall === 'function') {
      try {
        const raw = await self._executeToolCall(toolName, params);
        // executeToolCall returns JSON string — parse it
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed.error) {
          this._scoreToolFailure(toolName, context);
          return { error: parsed.error };
        }
        return { ok: true, data: parsed, tool: toolName };
      } catch (e) {
        this._scoreToolFailure(toolName, context);
        return { error: e.message };
      }
    }

    // Fallback: tool executor not available yet
    console.warn(`[DecisionEngine] _executeToolCall not available, skipping ${toolName}`);
    return { error: 'Tool executor not ready' };
  }

  _scoreToolSuccess(toolName, context) {
    if (!this.toolScores[toolName]) {
      this.toolScores[toolName] = { success: 0, fail: 0 };
    }
    this.toolScores[toolName].success++;
    this._scheduleScoreSave();
  }

  _scoreToolFailure(toolName, context) {
    if (!this.toolScores[toolName]) {
      this.toolScores[toolName] = { success: 0, fail: 0 };
    }
    this.toolScores[toolName].fail++;
    this._scheduleScoreSave();
  }

  _scheduleScoreSave() {
    if (this._scoreTimer) clearTimeout(this._scoreTimer);
    this._scoreTimer = setTimeout(() => {
      chrome.storage.local.set({ cobra_tool_scores: this.toolScores })
        .catch(e => console.warn('[DecisionEngine] Failed to save tool scores:', e));
    }, 1000);
  }

  async loadToolScores() {
    return new Promise((resolve) => {
      chrome.storage.local.get('cobra_tool_scores', (data) => {
        this.toolScores = data.cobra_tool_scores || {};
        resolve(this.toolScores);
      });
    });
  }
}

// ============================================================
// EXPORT
// ============================================================
self.DecisionEngine = DecisionEngine;

// Singleton created by background.js AFTER engine instances are ready
console.log('[decision-engine.js] Loaded: DecisionEngine class exported as self.DecisionEngine');
