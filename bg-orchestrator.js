// COBRA v5.2 — Orchestrator Module
// Handles: ORCHESTRATE multi-agent orchestration
// Dependencies: CobraRouter (global), CobraOrchestrator, Brain

// Ensure CobraRouter is available
self.CobraRouter = self.CobraRouter || {};

async function getSettings() {
  return new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
}

self.CobraRouter.registerTypes({
  'ORCHESTRATE': async (payload) => {
    try {
      const { message, agents, leaderAgentId, chatHistory, taskType } = payload;

      // Build agent configs with API keys from storage
      const agentConfigs = [];
      for (const agent of agents) {
        // Get API key for this provider from settings
        const settings = await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
        let apiKey = '';
        let model = '';

        // Map provider to API key and model
        if (agent.provider === 'openai') {
          apiKey = settings.openaiKey || '';
          model = settings.openaiModel || 'gpt-4o-mini';
        } else if (agent.provider === 'anthropic') {
          apiKey = settings.anthropicKey || '';
          model = settings.anthropicModel || 'claude-3-5-sonnet-20241022';
        } else if (agent.provider === 'groq') {
          apiKey = settings.groqKey || '';
          model = settings.groqModel || 'llama-3.3-70b-versatile';
        } else if (agent.provider === 'gemini') {
          apiKey = settings.geminiKey || '';
          model = settings.geminiModel || 'gemini-1.5-flash';
        }

        if (apiKey) {
          agentConfigs.push({ ...agent, apiKey, model });
        }
      }

      if (agentConfigs.length === 0) {
        return { content: 'Nessuna API key configurata per gli agenti selezionati. Vai in Connessioni per configurarle.' };
      }

      // The callAI function bridges orchestrator to actual API calls
      const callAI = async (systemPrompt, messages, config) => {
        try {
          // Use callDirectAI with the agent's provider and API key
          // callDirectAI is exported from bg-chat.js
          if (!self.callDirectAI) {
            throw new Error('callDirectAI not available from bg-chat.js');
          }
          const result = await self.callDirectAI(
            config.provider,
            config.apiKey,
            config.model,
            systemPrompt,
            messages,
            { tools: self.COBRA_TOOLS || [], maxToolRounds: 3 }
          );
          if (result) {
            return { content: result };
          }
          // Fallback to Brain.think if direct API fails
          console.warn(`[Orchestrator] callDirectAI failed for ${config.provider}, trying Brain.think`);
          const brainResult = await (self.Brain?.think || Brain?.think)(messages[messages.length - 1]?.content || '', {
            systemPrompt,
            history: messages.slice(0, -1)
          });
          return { content: brainResult?.response || brainResult?.content || '' };
        } catch (err) {
          console.error('[Orchestrator] AI call error for', config.provider, ':', err);
          return { content: '' };
        }
      };

      // Run orchestration (Phase 0: initialization, Phase 2: finalization)
      const result = await cobraOrchestrator.orchestrate({
        userMessage: message,
        agents: agentConfigs,
        leaderAgentId,
        chatHistory,
        taskType,
        callAI,
        onProgress: (phase, detail) => {
          // Send progress to sidepanel
          chrome.runtime.sendMessage({
            type: 'ORCHESTRATE_PROGRESS',
            phase, detail
          }).catch(() => {});
        }
      });

      // Generate a conversational voice summary (NOT the full text)
      let voiceSummary = '';
      if (result.content && result.content.length > 100) {
        // Create a brief conversational summary for voice
        const firstSentence = result.content.split(/[.!?]\s/)[0];
        if (result.turnsUsed > 1) {
          voiceSummary = `Ho consultato ${result.agentContributions.length} prospettive diverse e ${result.convergence === 'agreement' ? 'c\'è accordo' : 'ci sono opinioni diverse'}. ${firstSentence}. Guarda i dettagli nella chat.`;
        } else {
          voiceSummary = `${firstSentence}. Ho messo tutto nella chat per te.`;
        }
      }

      return {
        content: result.content,
        convergence: result.convergence,
        turnsUsed: result.turnsUsed,
        agentCount: result.agentContributions.length,
        voiceSummary
      };
    } catch (err) {
      console.error('[ORCHESTRATE] Error during orchestration:', err);
      return {
        content: `Errore durante l'orchestrazione: ${err.message}`,
        convergence: 'error',
        turnsUsed: 0,
        agentCount: 0,
        voiceSummary: `Si è verificato un errore: ${err.message}`
      };
    }
  }
});
