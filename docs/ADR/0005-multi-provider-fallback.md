# ADR-0005: Multi-Provider AI with Fallback Chain

**Status**: Accepted

**Date**: 2024-03-27

---

## Context

COBRA needed AI capabilities without vendor lock-in:
1. If primary provider is down, fallback to secondary
2. Support multiple model tiers (gpt-4, gpt-4-mini, llama, etc.)
3. Allow user choice via settings
4. Streaming responses for real-time UX

---

## Decision

Implement **provider-router.js** with fallback chain:

```javascript
const providers = [
  {name: 'openai', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini'},
  {name: 'anthropic', url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4'},
  {name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b'},
  {name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', model: 'gemini-2.0-flash'}
];

async function callAI(systemPrompt, messages) {
  for (const provider of providers) {
    try {
      const result = await callProvider(provider, systemPrompt, messages);
      return result;  // Success
    } catch (err) {
      console.warn(`[ProviderRouter] ${provider.name} failed:`, err.message);
      continue;  // Try next provider
    }
  }
  throw new Error('All providers failed');
}
```

**Per-Provider Adapters:**
- OpenAI: SSE streaming
- Anthropic: text/event-stream
- Groq: OpenAI-compatible (fallback to OpenAI code)
- Gemini: Polling (no streaming)

---

## Consequences

### Positive

1. **Resilience**: If provider down, auto-fallback to next
2. **Cost optimization**: Users can choose cheaper models
3. **Model comparison**: Switch models for A/B testing
4. **Real-time feedback**: Streaming shows partial responses

### Negative

1. **Complexity**: Multiple adapter code paths
2. **Latency variance**: Different providers have different speeds
3. **Inconsistent output**: Different models generate different responses

---

## Implementation

```javascript
// In sidepanel settings, user configures:
{
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-4-20250514',
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  geminiKey: '',
  geminiModel: 'gemini-2.0-flash'
}

// ProviderRouter selects based on agent or settings
async function selectProvider(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  const provider = agent.provider || 'openai';
  // return configured API key and model for provider
}
```

---

## Fallback Order

```
User Request
  ↓
[1] Try Primary Provider (user selected or agent assigned)
  ├─ Validate API key exists
  ├─ Attempt streaming (if supported)
  └─ On error: next
  ↓
[2] Try Secondary (next configured provider)
  ├─ Validate API key
  ├─ Attempt streaming
  └─ On error: next
  ↓
[3] Try Tertiary...
  ↓
[4] All failed → Return error "All providers failed"
```

---

## References

- OpenAI API: https://platform.openai.com/docs/api-reference
- Anthropic Claude: https://docs.anthropic.com/
- Groq API: https://console.groq.com/docs
- Google Gemini: https://ai.google.dev/docs
