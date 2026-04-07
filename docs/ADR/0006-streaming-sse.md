# ADR-0006: Server-Sent Events (SSE) for Token Streaming

**Status**: Accepted

**Date**: 2024-03-27

---

## Context

User experience improved with real-time token visibility:
- Instead of waiting 5s for full response, see tokens appear live
- Better perceived latency
- Can abort long responses early

---

## Decision

Implement **streaming handlers** for SSE-supporting providers:

```javascript
async function callStreamingAI(provider, apiKey, model, systemPrompt, messages) {
  const abortController = new AbortController();
  self._currentAIAbort = abortController;

  try {
    if (provider === 'openai' || provider === 'groq') {
      return await _streamOpenAI(provider, apiKey, model, systemPrompt, messages, abortController.signal);
    }
    if (provider === 'anthropic') {
      return await _streamAnthropic(apiKey, model, systemPrompt, messages, abortController.signal);
    }
    // Gemini: fallback to polling
    return await callDirectAI(provider, apiKey, model, systemPrompt, messages);
  } catch (err) {
    if (err.name === 'AbortError') return '[interrupted]';
    // Fallback to non-streaming
    return await callDirectAI(provider, apiKey, model, systemPrompt, messages);
  }
}

// Each chunk emitted to sidepanel
async function _processSSEStream(stream, signal, chunkParser) {
  const reader = stream.getReader();
  let fullText = '';

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;

    const chunk = new TextDecoder().decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      const token = chunkParser(data);
      fullText += token;

      // Emit to sidepanel
      chrome.runtime.sendMessage({
        type: 'COBRA_CHUNK',
        text: token,
        timestamp: Date.now()
      }).catch(() => {});
    }
  }

  return fullText;
}
```

---

## Consequences

### Positive

1. **Real-time UX**: User sees tokens as they arrive
2. **Responsive**: Can abort before full response generated
3. **Bandwidth efficient**: Stream instead of buffering

### Negative

1. **Complexity**: Multiple stream formats (OpenAI vs Anthropic)
2. **Abort handling**: Must cancel fetch and cleanup
3. **Error mid-stream**: Partial response already displayed

---

## Supported Providers

| Provider | Streaming | Format |
|----------|-----------|--------|
| OpenAI | Yes | SSE (data: {...}) |
| Anthropic | Yes | text/event-stream |
| Groq | Yes | SSE (OpenAI-compatible) |
| Gemini | No | Polling fallback |

---

## References

- Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- Fetch AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
