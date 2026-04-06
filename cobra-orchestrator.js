// COBRA Multi-Agent Orchestrator v1.0
// Orchestrazione dietro le quinte: gli agenti dibattono internamente,
// l'utente riceve SOLO il risultato finale dal Leader.
// Basato su RadioChat convergence-driven architecture, adattato per COBRA.

// ============================================================
// CONVERGENCE DETECTION
// ============================================================
const AGREEMENT_KEYWORDS = [
  'concordo', "sono d'accordo", 'esatto', 'perfetto', 'giusto', 'condivido',
  'agree', 'exactly', 'correct', 'right', 'indeed', 'absolutely',
  'de acuerdo', 'exactamente', "d'accord", 'einverstanden', 'genau'
];
const DIVERGENCE_KEYWORDS = [
  'non concordo', 'dissento', 'sbagliato', 'invece', 'tuttavia', 'però',
  'disagree', 'however', 'wrong', 'but', 'actually', 'on the contrary',
  'sin embargo', 'en revanche', 'allerdings', 'andererseits'
];

function analyzeConvergence(responses) {
  if (responses.length < 2) return 'neutral';
  const texts = responses.map(r => (r.content || '').toLowerCase());

  // Stagnation: Jaccard similarity > 0.7 tra risposte (increased from 0.55 to reduce false positives)
  const words = texts.map(t => new Set(t.split(/\s+/).filter(w => w.length > 3)));
  let stagnantPairs = 0;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const intersection = [...words[i]].filter(w => words[j].has(w)).length;
      const union = new Set([...words[i], ...words[j]]).size;
      if (union > 0 && intersection / union > 0.7) stagnantPairs++;
    }
  }
  // Fix: check if stagnantPairs is significant relative to total possible pairs
  const totalPairs = (words.length * (words.length - 1)) / 2;
  if (totalPairs > 0 && stagnantPairs / totalPairs >= 0.5) return 'stagnation';

  let agreeCount = 0, disagreeCount = 0;
  for (const t of texts) {
    // Fix: check DIVERGENCE_KEYWORDS first to avoid "disagree" matching "agree"
    let isDivergent = false;
    if (DIVERGENCE_KEYWORDS.some(k => {
      const regex = new RegExp(`\\b${k}\\b`, 'i');
      return regex.test(t);
    })) {
      disagreeCount++;
      isDivergent = true;
    }
    // Only count agreement if not already counted as divergence
    if (!isDivergent && AGREEMENT_KEYWORDS.some(k => {
      const regex = new RegExp(`\\b${k}\\b`, 'i');
      return regex.test(t);
    })) {
      agreeCount++;
    }
  }
  if (agreeCount >= 2) return 'agreement';
  if (disagreeCount >= 2) return 'divergence';
  return 'neutral';
}

function getConvergenceInstruction(state) {
  const instructions = {
    agreement: 'Gli agenti sono in accordo. Cerca possibili criticità o aspetti trascurati prima di concludere.',
    divergence: 'Ci sono opinioni diverse. Cerca punti di sintesi e proponi un compromesso costruttivo.',
    stagnation: 'La discussione si sta ripetendo. Porta una prospettiva COMPLETAMENTE NUOVA o concludi con una decisione.',
    neutral: ''
  };
  return instructions[state] || '';
}

// ============================================================
// AGENT PERSONALITIES (built-in defaults)
// ============================================================
const DEFAULT_AGENTS = {
  analyst: {
    id: 'analyst', name: 'Analyst',
    role: 'Analista Dati e Tecnologo',
    style: 'Diretto, pragmatico, basato su evidenze concrete.',
    prompt: 'Analizza con dati, fatti verificabili e riferimenti concreti. Proponi soluzioni pratiche.'
  },
  strategist: {
    id: 'strategist', name: 'Strategist',
    role: 'Pensatore Strategico',
    style: 'Riflessivo, visione a lungo termine, analisi sistemica.',
    prompt: 'Considera le implicazioni profonde, i rischi, le opportunità a lungo termine. Visione olistica.'
  },
  critic: {
    id: 'critic', name: 'Critic',
    role: 'Analista Critico',
    style: 'Preciso, strutturato, identifica punti deboli.',
    prompt: 'Trova falle logiche, presupposti nascosti, rischi non considerati. Sfida le assunzioni.'
  },
  executor: {
    id: 'executor', name: 'Executor',
    role: 'Esperto Operativo',
    style: 'Concreto, orientato all\'azione, va dritto al punto.',
    prompt: 'Proponi azioni concrete, passi successivi, tempistiche. Semplifica e rendi operativo.'
  }
};

// ============================================================
// MEMORY SYSTEM (3-level for orchestrator)
// ============================================================
function buildOrchestratorMemory(messages, maxTokens = 4000) {
  const estimateTokens = (text) => Math.ceil(text.length / 4);

  if (messages.length <= 10) {
    return messages.map(m => ({
      role: m.role || 'assistant',
      content: m.content
    }));
  }

  const result = [];
  const fullCount = Math.min(10, messages.length);
  const condensedCount = Math.min(10, messages.length - fullCount);

  // L3: Summary of oldest messages
  if (messages.length > 20) {
    const oldMessages = messages.slice(0, messages.length - 20);
    const summaryText = oldMessages.map(m =>
      `[${m.agentName || 'Agent'}]: ${(m.content || '').substring(0, 80)}`
    ).join(' | ');
    result.push({ role: 'user', content: `[CONTESTO PRECEDENTE] ${summaryText.substring(0, 500)}` });
  }

  // L2: Condensed middle messages
  const condensedStart = Math.max(0, messages.length - fullCount - condensedCount);
  const condensedEnd = messages.length - fullCount;
  for (let i = condensedStart; i < condensedEnd; i++) {
    const m = messages[i];
    const firstSentence = (m.content || '').split(/[.!?]\s/)[0].substring(0, 120);
    result.push({
      role: m.role || 'assistant',
      content: `[${m.agentName || 'Agent'}]: ${firstSentence}`
    });
  }

  // L1: Full recent messages
  for (let i = messages.length - fullCount; i < messages.length; i++) {
    result.push({
      role: messages[i].role || 'assistant',
      content: messages[i].content
    });
  }

  // Token enforcement
  let total = result.reduce((acc, m) => acc + estimateTokens(m.content), 0);
  while (total > maxTokens && result.length > 2) {
    const removed = result.splice(1, 1);
    total -= estimateTokens(removed[0].content);
  }

  return result;
}

// ============================================================
// ORCHESTRATOR ENGINE
// ============================================================
class CobraOrchestrator {
  constructor() {
    this.maxTurns = 6;
    this.forcedConsultationTurns = 2;
    this.temperature = 0.7;
    this.maxTokens = 1200;
    this.wordRange = [80, 250];
  }

  /**
   * Orchestrate: chiama più agenti dietro le quinte, restituisce solo il risultato finale.
   * @param {Object} params
   * @param {string} params.userMessage - Il messaggio/richiesta dell'utente
   * @param {Array} params.agents - Array di agent configs [{id, name, provider, model, apiKey}]
   * @param {string} params.leaderAgentId - ID dell'agente leader (produce output finale)
   * @param {Array} params.chatHistory - Storico chat per contesto
   * @param {string} params.taskType - 'decision'|'document'|'analysis'|'general'
   * @param {Function} params.callAI - Funzione per chiamare AI: (systemPrompt, messages, config) => response
   * @param {Function} params.onProgress - Callback progresso: (phase, detail) => void
   * @returns {Object} { content, convergence, agentContributions, turnsUsed }
   */
  async orchestrate({ userMessage, agents, leaderAgentId, chatHistory = [], taskType = 'general', callAI, onProgress }) {
    if (!agents || agents.length === 0) {
      return { content: 'Nessun agente configurato.', convergence: 'neutral', agentContributions: [], turnsUsed: 0 };
    }

    // Single agent mode — no orchestration needed
    if (agents.length === 1) {
      onProgress?.('single', 'Elaborazione...');
      const agent = agents[0];
      const systemPrompt = this._buildAgentPrompt(agent, [], '', taskType, userMessage);
      const messages = this._buildMessages(userMessage, chatHistory);
      const result = await callAI(systemPrompt, messages, {
        provider: agent.provider, model: agent.model, apiKey: agent.apiKey,
        temperature: this.temperature, maxTokens: this.maxTokens * 2
      });
      return {
        content: result.content || 'Nessuna risposta.',
        convergence: 'neutral',
        agentContributions: [{ agent: agent.name, content: result.content }],
        turnsUsed: 1
      };
    }

    const leader = agents.find(a => a.id === leaderAgentId) || agents[0];
    const debaters = agents.filter(a => a.id !== leader.id);
    const allResponses = [];
    let convergence = 'neutral';
    let turnsUsed = 0;

    onProgress?.('start', `Orchestrazione con ${agents.length} agenti...`);

    // === PHASE 0: Task Decomposition (Leader) ===
    onProgress?.('decompose', 'Analisi richiesta...');
    const decomposePrompt = `Sei il coordinatore di un team di ${agents.length} esperti AI.
Analizza questa richiesta e produci una decomposizione CONCISA:
OBIETTIVO: [1 frase]
SOTTO-OBIETTIVI: [max 3 punti]
CRITERI DI SUCCESSO: [max 2 punti]
Rispondi SOLO con la decomposizione, niente altro. Max 100 parole.`;

    let taskDecomposition;
    try {
      const decomposeResult = await callAI(decomposePrompt,
        [{ role: 'user', content: userMessage }],
        { provider: leader.provider, model: leader.model, apiKey: leader.apiKey, temperature: 0.3, maxTokens: 300 }
      );
      taskDecomposition = decomposeResult?.content || userMessage;
    } catch (err) {
      console.error('[Orchestrator] Phase 0 failed:', err);
      taskDecomposition = userMessage; // Fallback to original message
    }

    // === PHASE 1: Debate (behind the scenes) ===
    for (let turn = 0; turn < this.maxTurns; turn++) {
      turnsUsed = turn + 1;
      const isForced = turn < this.forcedConsultationTurns;

      // Decide which agents speak this turn
      let speakingAgents;
      if (isForced || convergence === 'divergence') {
        speakingAgents = debaters; // All debaters speak
      } else if (convergence === 'agreement' && turn >= 3) {
        break; // Consensus reached, go to synthesis
      } else {
        // Smart rotation: pick 1-2 agents
        const idx = turn % debaters.length;
        speakingAgents = [debaters[idx]];
        if (debaters.length > 2 && Math.random() < 0.3) {
          const other = debaters[(idx + 1) % debaters.length];
          speakingAgents.push(other);
        }
      }

      const convergenceInstruction = getConvergenceInstruction(convergence);
      const turnResponses = [];

      for (const agent of speakingAgents) {
        const previousInTurn = turnResponses.map(r => `[${r.agentName}]: ${(r.content || '').substring(0, 300)}`);
        const allPrevious = allResponses.map(r => `[${r.agentName}]: ${(r.content || '').substring(0, 200)}`);

        const systemPrompt = this._buildAgentPrompt(
          agent, allPrevious.concat(previousInTurn),
          convergenceInstruction, taskType, taskDecomposition
        );

        const memoryMessages = buildOrchestratorMemory(allResponses);
        memoryMessages.push({ role: 'user', content: userMessage });

        try {
          const result = await callAI(systemPrompt, memoryMessages, {
            provider: agent.provider, model: agent.model, apiKey: agent.apiKey,
            temperature: this.temperature, maxTokens: this.maxTokens
          });

          if (result.content) {
            const response = {
              agentName: agent.name, agentId: agent.id,
              content: result.content, turn,
              role: 'assistant'
            };
            turnResponses.push(response);
            allResponses.push(response);
          }
        } catch (err) {
          console.error(`[Orchestrator] Error ${agent.name}:`, err);
        }
      }

      // Skip logic: if no new value added, break early
      if (turnResponses.length === 0) break;

      // Analyze convergence
      const recentResponses = allResponses.slice(-Math.min(6, allResponses.length));
      convergence = analyzeConvergence(recentResponses);

      onProgress?.('debate', `Turno ${turn + 1}/${this.maxTurns} — ${convergence}`);

      // Early termination on strong agreement after min turns
      if (convergence === 'agreement' && turn >= 2) break;
      if (convergence === 'stagnation' && turn >= 3) break;
    }

    // === PHASE 2: Leader Synthesis ===
    onProgress?.('synthesis', 'Sintesi finale...');

    // Guard: if all agents failed, return early
    if (allResponses.length === 0) {
      return { content: 'Nessun agente ha prodotto una risposta valida.', convergence: 'neutral', agentContributions: [], turnsUsed };
    }

    const contributionsSummary = allResponses.map(r =>
      `**${r.agentName}** (turno ${r.turn + 1}):\n${r.content}`
    ).join('\n\n---\n\n');

    const leaderPrompt = this._buildLeaderPrompt(taskType, taskDecomposition, convergence);
    const leaderMessages = [
      { role: 'user', content: `RICHIESTA UTENTE: ${userMessage}\n\n` +
        `DECOMPOSIZIONE TASK:\n${taskDecomposition}\n\n` +
        `CONTRIBUTI TEAM (${allResponses.length} messaggi, convergenza: ${convergence}):\n\n${contributionsSummary}\n\n` +
        `Produci la risposta finale per l'utente.` }
    ];

    let finalContent;
    try {
      const leaderResult = await callAI(leaderPrompt, leaderMessages, {
        provider: leader.provider, model: leader.model, apiKey: leader.apiKey,
        temperature: 0.4, maxTokens: this.maxTokens * 3
      });
      finalContent = leaderResult?.content || 'Errore nella sintesi finale.';
    } catch (err) {
      console.error('[Orchestrator] Phase 2 failed:', err);
      // Fallback: return best contribution
      finalContent = allResponses.length > 0
        ? allResponses[allResponses.length - 1].content
        : 'Errore: nessuna risposta generata.';
    }

    onProgress?.('done', 'Completato');

    return {
      content: finalContent,
      convergence,
      agentContributions: allResponses.map(r => ({
        agent: r.agentName, content: r.content, turn: r.turn
      })),
      turnsUsed
    };
  }

  // ── Build agent system prompt ──────────────────────────────
  _buildAgentPrompt(agent, previousResponses, convergenceInstruction, taskType, taskContext) {
    const personality = DEFAULT_AGENTS[agent.id] || {};
    const parts = [];

    parts.push(`# ${agent.name} — ${personality.role || 'Agente AI'}`);
    parts.push(`Sei parte di un team di esperti AI che collabora per rispondere all'utente.`);
    parts.push('');

    if (personality.style) parts.push(`STILE: ${personality.style}`);
    if (personality.prompt) parts.push(`ISTRUZIONI: ${personality.prompt}`);
    parts.push('');

    parts.push(`REGOLE:
- Aggiungi VALORE NUOVO, non ripetere ciò che è già stato detto
- Se concordi, approfondisci o estendi
- Se dissenti, spiega perché con argomentazioni concrete
- Sii CONCRETO: numeri, esempi, azioni specifiche
- Max ${this.wordRange[1]} parole`);

    if (previousResponses.length > 0) {
      parts.push('\n--- CONTRIBUTI PRECEDENTI ---');
      parts.push(previousResponses.slice(-4).join('\n'));
      parts.push('Costruisci sulla base di quanto detto. Non ripetere.');
    }

    if (convergenceInstruction) {
      parts.push(`\n--- STATO DISCUSSIONE ---\n${convergenceInstruction}`);
    }

    if (taskContext) {
      parts.push(`\n--- CONTESTO TASK ---\n${taskContext}`);
    }

    return parts.join('\n');
  }

  // ── Build leader synthesis prompt ──────────────────────────
  _buildLeaderPrompt(taskType, taskDecomposition, convergence) {
    const typeInstructions = {
      decision: `Produci una DECISIONE chiara con:
1. La scelta raccomandata (1-2 frasi)
2. Motivazione (basata sui contributi del team)
3. Rischi identificati
4. Prossimi passi concreti`,
      document: `Produci un DOCUMENTO strutturato:
1. Integra i contributi migliori di ogni agente
2. Elimina ridondanze e risolvi contraddizioni
3. Struttura con sezioni chiare
4. Conclusioni operative`,
      analysis: `Produci un'ANALISI completa:
1. Sintesi dei punti chiave emersi
2. Punti di accordo e disaccordo
3. Insight più importanti
4. Raccomandazioni concrete`,
      general: `Produci una RISPOSTA completa:
1. Integra le prospettive migliori del team
2. Rispondi in modo diretto e concreto
3. Includi azioni o suggerimenti pratici`
    };

    return `Sei il LEADER di un team di esperti AI.
Hai coordinato una discussione interna (non visibile all'utente) su un task.
Ora devi produrre la RISPOSTA FINALE per l'utente.

L'utente NON vede la discussione del team. Vede SOLO la tua risposta.
Scrivi come se fossi tu a rispondere direttamente, integrando i migliori contributi.
NON menzionare "il team", "gli agenti", o "la discussione".
Rispondi in modo naturale, come un singolo assistente molto competente.

CONVERGENZA RAGGIUNTA: ${convergence}

${typeInstructions[taskType] || typeInstructions.general}

Sii concreto, diretto, e operativo. Niente preamboli inutili.`;
  }

  // ── Build messages array ───────────────────────────────────
  _buildMessages(userMessage, chatHistory) {
    const messages = [];
    const recent = chatHistory.slice(-10);
    for (const msg of recent) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    }
    messages.push({ role: 'user', content: userMessage });
    return messages;
  }
}

// Export for service worker
self.CobraOrchestrator = CobraOrchestrator;
self.DEFAULT_AGENTS = DEFAULT_AGENTS;
self.analyzeConvergence = analyzeConvergence;
self.buildOrchestratorMemory = buildOrchestratorMemory;
