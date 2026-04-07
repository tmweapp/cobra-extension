/**
 * COBRA v5.3 — Three-Tier Response Generator
 * Genera 3 livelli di risposta (synthetic, summary, full) in singola chiamata JSON
 */

const ThreeTierResponse = {

  /**
   * Costruisce il prompt per generare risposta 3-tier
   * Aggiunge istruzioni di output JSON al system prompt
   */
  buildThreeTierPrompt(systemPrompt, userMessage, context = {}) {
    const threeTierInstruction = `
IMPORTANT: You MUST respond ALWAYS in valid JSON format with exactly this structure:
{
  "synthetic": "<one-sentence summary, max 20 words>",
  "summary": "<summary with max 3 sentences, max 100 words>",
  "full": "<complete response for the user, no length limit>"
}

Ensure all JSON keys are lowercase and all values are non-empty strings.
Do NOT include markdown code blocks, do NOT include "json" prefix, just the raw JSON object.`;

    const enhancedSystem = systemPrompt + '\n' + threeTierInstruction;

    let enhancedPrompt = userMessage;
    if (context.previousContext) {
      enhancedPrompt = `Context: ${context.previousContext}\n\nUser message: ${userMessage}`;
    }
    if (context.metadata) {
      enhancedPrompt += `\n\nMetadata: ${JSON.stringify(context.metadata)}`;
    }

    return {
      systemPrompt: enhancedSystem,
      userPrompt: enhancedPrompt,
    };
  },

  /**
   * Parsa la risposta 3-tier da Claude
   * Ritorna { synthetic, summary, full } o fallback euristico
   */
  parseThreeTierResponse(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') {
      return this._fallbackParse('Invalid response');
    }

    // Rimuovi code blocks markdown se presenti
    let cleaned = rawResponse.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    // Prova il parsing JSON
    try {
      const parsed = JSON.parse(cleaned);

      // Valida struttura
      if (
        typeof parsed === 'object' &&
        typeof parsed.synthetic === 'string' &&
        typeof parsed.summary === 'string' &&
        typeof parsed.full === 'string'
      ) {
        // Valida lunghezze
        if (parsed.synthetic && parsed.summary && parsed.full) {
          return {
            synthetic: parsed.synthetic,
            summary: parsed.summary,
            full: parsed.full,
            _parsed: true,
          };
        }
      }
    } catch (e) {
      // JSON parsing failed, fallback to heuristics
    }

    // Fallback euristico se parsing fallisce
    return this._fallbackParse(rawResponse);
  },

  /**
   * Fallback parsing: genera synthetic/summary euristicamente
   * synthetic = prima frase
   * summary = prime 3 frasi
   * full = testo completo
   */
  _fallbackParse(text) {
    const sentences = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let synthetic = '';
    if (sentences.length > 0) {
      synthetic = sentences[0].substr(0, 100);
      if (sentences[0].length > 100) {
        synthetic += '...';
      }
    } else {
      synthetic = text.substr(0, 50) + (text.length > 50 ? '...' : '');
    }

    let summary = '';
    if (sentences.length > 0) {
      summary = sentences.slice(0, 3).join('. ');
      if (summary.length > 300) {
        summary = summary.substr(0, 297) + '...';
      }
    } else {
      summary = text.substr(0, 200);
    }

    return {
      synthetic: synthetic || '(no response)',
      summary: summary || '(no summary)',
      full: text,
      _parsed: false, // Indica che è fallback
    };
  },

  /**
   * Valida che la risposta abbia la struttura 3-tier corretta
   */
  validateThreeTier(response) {
    if (!response || typeof response !== 'object') {
      return false;
    }

    return (
      typeof response.synthetic === 'string' &&
      response.synthetic.length > 0 &&
      typeof response.summary === 'string' &&
      response.summary.length > 0 &&
      typeof response.full === 'string' &&
      response.full.length > 0
    );
  },

  /**
   * Estima i token approssimativamente (per validazione)
   */
  _estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  },

  /**
   * Valida i limiti token per la risposta 3-tier
   */
  validateTokenLimits(response, limits = {}) {
    const defaultLimits = {
      syntheticMax: 50,   // ~1 frase = 20 parole
      summaryMax: 300,    // ~3 frasi
      fullMax: 2000,      // Default no limit, ma possiamo controllare
    };

    const finalLimits = { ...defaultLimits, ...limits };

    const syntheticTokens = this._estimateTokens(response.synthetic);
    const summaryTokens = this._estimateTokens(response.summary);
    const fullTokens = this._estimateTokens(response.full);

    return {
      valid:
        syntheticTokens <= finalLimits.syntheticMax &&
        summaryTokens <= finalLimits.summaryMax &&
        fullTokens <= finalLimits.fullMax,
      syntheticTokens,
      summaryTokens,
      fullTokens,
      violations: {
        synthetic: syntheticTokens > finalLimits.syntheticMax,
        summary: summaryTokens > finalLimits.summaryMax,
        full: fullTokens > finalLimits.fullMax,
      },
    };
  },
};

// Rendi disponibile globalmente
if (typeof self !== 'undefined') {
  self.ThreeTierResponse = ThreeTierResponse;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThreeTierResponse;
}
