/**
 * COBRA v5.2 — Streaming AI Response Handler
 * Service worker module: streams AI responses token-by-token.
 * Falls back to non-streaming callDirectAI if streaming fails.
 *
 * Registers: self.callStreamingAI
 * Requires: self.callDirectAI, self._currentAIAbort
 */

async function callStreamingAI(provider, apiKey, model, systemPrompt, messages, options = {}) {
  const abortController = new AbortController();
  self._currentAIAbort = abortController;
  const signal = abortController.signal;

  try {
    // Only OpenAI-compatible and Anthropic support streaming
    if (provider === 'openai' || provider === 'groq') {
      return await _streamOpenAI(provider, apiKey, model, systemPrompt, messages, signal);
    }
    if (provider === 'anthropic') {
      return await _streamAnthropic(apiKey, model, systemPrompt, messages, signal);
    }
    // Gemini: no streaming support, fallback
    return await self.callDirectAI(provider, apiKey, model, systemPrompt, messages, options);
  } catch (err) {
    if (err.name === 'AbortError') {
      return '[interrotto]';
    }
    console.warn(`[Streaming] ${provider} stream failed, falling back to non-streaming:`, err.message);
    // Fallback to non-streaming
    try {
      return await self.callDirectAI(provider, apiKey, model, systemPrompt, messages, options);
    } catch (fallbackErr) {
      console.error('[Streaming] Fallback also failed:', fallbackErr.message);
      return null;
    }
  }
}

async function _streamOpenAI(provider, apiKey, model, systemPrompt, messages, signal) {
  const baseUrl = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const apiMessages = [{ role: 'system', content: systemPrompt }, ...messages];

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      max_tokens: 3000,
      temperature: 0.7,
      stream: true
    }),
    signal
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${res.status}`);
  }

  return await _processSSEStream(res.body, signal, (chunk) => {
    // OpenAI SSE format: data: {"choices":[{"delta":{"content":"token"}}]}
    try {
      const parsed = JSON.parse(chunk);
      return parsed.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
  });
}

async function _streamAnthropic(apiKey, model, systemPrompt, messages, signal) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system: systemPrompt,
      messages,
      temperature: 0.7,
      stream: true
    }),
    signal
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${res.status}`);
  }

  return await _processSSEStream(res.body, signal, (chunk) => {
    // Anthropic SSE: event: content_block_delta, data: {"delta":{"text":"token"}}
    try {
      const parsed = JSON.parse(chunk);
      if (parsed.type === 'content_block_delta') {
        return parsed.delta?.text || '';
      }
      return '';
    } catch { return ''; }
  });
}

async function _processSSEStream(body, signal, extractToken) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let tokenCount = 0;

  try {
    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          const token = extractToken(data);
          if (token) {
            fullText += token;
            tokenCount++;

            // Emit streaming chunk to sidepanel every few tokens
            if (tokenCount % 3 === 0 || token.includes('\n')) {
              try {
                chrome.runtime.sendMessage({
                  type: 'CHAT_STREAM_CHUNK',
                  payload: {
                    chunk: token,
                    fullText,
                    tokenCount,
                    done: false
                  }
                });
              } catch {} // sidepanel may not be listening
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Send final complete message
  try {
    chrome.runtime.sendMessage({
      type: 'CHAT_STREAM_CHUNK',
      payload: {
        chunk: '',
        fullText,
        tokenCount,
        done: true
      }
    });
  } catch {}

  return fullText;
}

self.callStreamingAI = callStreamingAI;
console.log('[cobra-streaming.js] Loaded: callStreamingAI registered');
