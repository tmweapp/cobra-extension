// COBRA v3.2 — ElevenLabs Integration Module
// TTS (Text-to-Speech), STT (Speech-to-Text), Voice Management, Agent Config
// Usa API ElevenLabs v1: https://api.elevenlabs.io/v1

const ElevenLabs = (() => {
  const API_BASE = 'https://api.elevenlabs.io/v1';
  let _config = {
    apiKey: 'sk_a62bbdb3b474fad9df5f621bdb85aca47d2153a5b6e3541f',
    defaultVoiceId: 'uScy1bXtKz8vPzfdFsFw',
    defaultModel: 'eleven_multilingual_v2',
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    speakerBoost: true,
    outputFormat: 'mp3_44100_128',
    language: 'it',
  };
  let _voices = [];       // cache voci disponibili
  let _agents = [];       // agenti configurati
  let _initDone = false;

  // ========== HTTP ==========
  async function _fetch(path, options = {}) {
    if (!_config.apiKey) throw new Error('ElevenLabs API key non configurata');
    const url = `${API_BASE}${path}`;
    const headers = {
      'xi-api-key': _config.apiKey,
      ...options.headers,
    };
    if (options.json) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.json);
      delete options.json;
    }
    const resp = await fetch(url, { ...options, headers });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      let errMsg = `ElevenLabs API error ${resp.status}`;
      try { errMsg = JSON.parse(errBody)?.detail?.message || errMsg; } catch {}
      throw new Error(errMsg);
    }
    return resp;
  }

  async function _json(path, options) {
    const resp = await _fetch(path, options);
    return resp.json();
  }

  // ========== INIT ==========
  async function init() {
    if (_initDone) return;
    const stored = await chrome.storage.local.get(['fs_elevenlabs_config', 'fs_elevenlabs_voices', 'fs_elevenlabs_agents']);
    if (stored.fs_elevenlabs_config) {
      Object.assign(_config, stored.fs_elevenlabs_config);
    }
    if (stored.fs_elevenlabs_voices) {
      _voices = stored.fs_elevenlabs_voices;
    }
    if (stored.fs_elevenlabs_agents) {
      _agents = stored.fs_elevenlabs_agents;
    }
    _initDone = true;
  }

  async function _saveConfig() {
    await chrome.storage.local.set({ fs_elevenlabs_config: _config });
  }
  async function _saveVoices() {
    await chrome.storage.local.set({ fs_elevenlabs_voices: _voices });
  }
  async function _saveAgents() {
    await chrome.storage.local.set({ fs_elevenlabs_agents: _agents });
  }

  // ========== CONFIG ==========
  function getConfig() {
    return { ..._config, apiKey: _config.apiKey ? '***' : '' };
  }

  async function setConfig(newConfig) {
    // Non sovrascrivere apiKey con stringa vuota se già presente
    if (newConfig.apiKey === '' && _config.apiKey) delete newConfig.apiKey;
    Object.assign(_config, newConfig);
    await _saveConfig();
    return { ok: true };
  }

  // ========== ACCOUNT ==========
  async function getSubscription() {
    return _json('/user/subscription');
  }

  async function getUsage() {
    return _json('/user');
  }

  // ========== VOICES ==========
  async function listVoices(forceRefresh = false) {
    if (_voices.length && !forceRefresh) return _voices;

    try {
      const data = await _json('/voices');
      if (!data.voices || data.voices.length === 0) {
        console.warn('[ElevenLabs] API returned no voices, using fallback');
        throw new Error('No voices in API response');
      }

      _voices = (data.voices || []).map(v => ({
        id: v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels || {},
        previewUrl: v.preview_url,
        language: v.labels?.language || '',
        gender: v.labels?.gender || '',
        useCase: v.labels?.use_case || '',
        description: v.labels?.description || '',
        isCloned: v.category === 'cloned',
      }));

      // Set first available voice as default if none configured
      if (_voices.length && !_config.defaultVoiceId) {
        _config.defaultVoiceId = _voices[0].id;
        console.log('[ElevenLabs] Set default voice to:', _voices[0].name, '(' + _voices[0].id + ')');
        await _saveConfig();
      }

      await _saveVoices();
      console.log('[ElevenLabs] Loaded', _voices.length, 'voices from API');
      return _voices;
    } catch (err) {
      console.warn('[ElevenLabs] Failed to load voices from API:', err.message);
      // Fallback to well-known ElevenLabs preset voices
      const presetVoices = [
        { id: 'uScy1bXtKz8vPzfdFsFw', name: 'Antonio Farina', category: 'cloned', language: 'it', gender: 'male', useCase: 'conversational', description: 'Expressive, warm Italian voice' },
        { id: 'CiwzbDpaN3pQXjTgx3ML', name: 'Aida', category: 'cloned', language: 'it', gender: 'female', useCase: 'conversational', description: 'Sultry Italian voice' },
        { id: 'HuK8QKF35exsCh2e7fLT', name: 'Carmelo La Rosa', category: 'cloned', language: 'it', gender: 'male', useCase: 'e-learning', description: 'Professional Italian voice' },
        { id: 'ImsA1Fn5TNc843fFdz99', name: 'Davide', category: 'cloned', language: 'it', gender: 'male', useCase: 'social media', description: 'Young Italian voice' },
      ];
      _voices = presetVoices.map(v => ({
        id: v.id,
        name: v.name,
        category: v.category,
        labels: { language: v.language, gender: v.gender, use_case: v.useCase },
        previewUrl: '',
        language: v.language,
        gender: v.gender,
        useCase: v.useCase,
        description: v.description,
        isCloned: false,
      }));

      if (!_config.defaultVoiceId && _voices.length) {
        _config.defaultVoiceId = _voices[0].id;
        await _saveConfig();
      }

      console.log('[ElevenLabs] Using', _voices.length, 'fallback voices');
      await _saveVoices();
      return _voices;
    }
  }

  async function getVoice(voiceId) {
    return _json(`/voices/${voiceId}`);
  }

  async function searchVoices(query) {
    if (!_voices.length) await listVoices();
    const q = query.toLowerCase();
    return _voices.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.language.toLowerCase().includes(q) ||
      v.gender.toLowerCase().includes(q) ||
      v.useCase.toLowerCase().includes(q) ||
      v.category.toLowerCase().includes(q)
    );
  }

  // Filtra per lingua
  async function getVoicesByLanguage(lang) {
    if (!_voices.length) await listVoices();
    const l = lang.toLowerCase();
    return _voices.filter(v =>
      v.language.toLowerCase().includes(l) ||
      v.labels?.accent?.toLowerCase().includes(l)
    );
  }

  // ========== MODELS ==========
  async function listModels() {
    return _json('/models');
  }

  // ========== TEXT TO SPEECH ==========
  async function speak(text, options = {}) {
    let voiceId = options.voiceId || _config.defaultVoiceId;

    // Auto-load voices if not available
    if (!voiceId) {
      await listVoices();
      voiceId = _config.defaultVoiceId;
    }

    if (!voiceId) throw new Error('Nessuna voce disponibile. Configura ElevenLabs API key.');
    if (!text || typeof text !== 'string') throw new Error('Testo mancante');
    if (text.length > 5000) throw new Error('Testo troppo lungo (max 5000 caratteri)');

    const payload = {
      text,
      model_id: options.model || _config.defaultModel,
      voice_settings: {
        stability: options.stability ?? _config.stability,
        similarity_boost: options.similarityBoost ?? _config.similarityBoost,
        style: options.style ?? _config.style,
        use_speaker_boost: options.speakerBoost ?? _config.speakerBoost,
      },
    };

    if (options.language) {
      payload.language_code = options.language;
    }

    const format = options.format || _config.outputFormat;
    const resp = await _fetch(
      `/text-to-speech/${voiceId}?output_format=${format}`,
      { method: 'POST', json: payload }
    );

    const arrayBuffer = await resp.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: _getMimeType(format) });
    const audioUrl = URL.createObjectURL(blob);

    return {
      audioUrl,
      blob,
      size: arrayBuffer.byteLength,
      format,
      voiceId,
      text: text.slice(0, 100),
    };
  }

  // TTS con streaming (per testi lunghi)
  async function speakStream(text, options = {}) {
    let voiceId = options.voiceId || _config.defaultVoiceId;

    // Auto-load voices if not available
    if (!voiceId) {
      await listVoices();
      voiceId = _config.defaultVoiceId;
    }

    if (!voiceId) throw new Error('Nessuna voce disponibile. Configura ElevenLabs API key.');

    const payload = {
      text,
      model_id: options.model || _config.defaultModel,
      voice_settings: {
        stability: options.stability ?? _config.stability,
        similarity_boost: options.similarityBoost ?? _config.similarityBoost,
      },
    };

    const format = options.format || _config.outputFormat;
    const resp = await _fetch(
      `/text-to-speech/${voiceId}/stream?output_format=${format}`,
      { method: 'POST', json: payload }
    );

    return {
      stream: resp.body,
      format,
      mimeType: _getMimeType(format),
    };
  }

  // ========== SPEECH TO TEXT ==========
  async function transcribe(audioBlob, options = {}) {
    if (!_config.apiKey) throw new Error('ElevenLabs API key non configurata');
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
    if (options.language) formData.append('language_code', options.language);
    if (options.model) formData.append('model_id', options.model);

    const resp = await fetch(`${API_BASE}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': _config.apiKey },
      body: formData,
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`STT error ${resp.status}: ${errBody}`);
    }

    const data = await resp.json();
    return {
      text: data.text || '',
      language: data.language_code || '',
      words: data.words || [],
      confidence: data.confidence || 0,
    };
  }

  // Registra audio dal microfono e trascrivi
  async function recordAndTranscribe(durationMs = 5000, options = {}) {
    // Verifica permessi microfono (funziona solo in popup/offscreen)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks = [];

    return new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        try {
          const result = await transcribe(blob, options);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };

      mediaRecorder.onerror = (err) => {
        stream.getTracks().forEach(t => t.stop());
        reject(new Error('Errore registrazione: ' + err.message));
      };

      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, Math.min(durationMs, 60000)); // max 60s
    });
  }

  // ========== AGENTS (Conversational AI) ==========
  async function listAgentsAPI() {
    return _json('/convai/agents');
  }

  async function createAgent(agentConfig) {
    const payload = {
      name: agentConfig.name || 'COBRA Agent',
      conversation_config: {
        tts: {
          voice_id: agentConfig.voiceId || _config.defaultVoiceId,
          model_id: agentConfig.model || _config.defaultModel,
        },
        stt: {
          provider: 'elevenlabs',
        },
        agent: {
          prompt: {
            prompt: agentConfig.systemPrompt || 'Sei un assistente vocale per COBRA, uno strumento di web intelligence.',
          },
          first_message: agentConfig.firstMessage || 'Ciao! Come posso aiutarti?',
          language: agentConfig.language || _config.language,
        },
      },
    };

    const result = await _json('/convai/agents/create', {
      method: 'POST',
      json: payload,
    });

    // Salva in locale
    const agent = {
      id: result.agent_id,
      name: agentConfig.name,
      voiceId: agentConfig.voiceId || _config.defaultVoiceId,
      systemPrompt: agentConfig.systemPrompt || '',
      language: agentConfig.language || _config.language,
      createdAt: Date.now(),
    };
    _agents.push(agent);
    await _saveAgents();

    return { ...result, agent };
  }

  async function getAgent(agentId) {
    return _json(`/convai/agents/${agentId}`);
  }

  async function updateAgent(agentId, updates) {
    const result = await _json(`/convai/agents/${agentId}`, {
      method: 'PATCH',
      json: updates,
    });

    // Aggiorna locale
    const idx = _agents.findIndex(a => a.id === agentId);
    if (idx >= 0) {
      Object.assign(_agents[idx], updates);
      await _saveAgents();
    }

    return result;
  }

  async function deleteAgent(agentId) {
    await _fetch(`/convai/agents/${agentId}`, { method: 'DELETE' });
    _agents = _agents.filter(a => a.id !== agentId);
    await _saveAgents();
    return { ok: true };
  }

  // Agenti locali salvati
  function getLocalAgents() {
    return [..._agents];
  }

  async function saveLocalAgent(agent) {
    const idx = _agents.findIndex(a => a.id === agent.id);
    if (idx >= 0) {
      _agents[idx] = { ..._agents[idx], ...agent };
    } else {
      _agents.push({ ...agent, id: agent.id || `local_${Date.now()}`, createdAt: Date.now() });
    }
    await _saveAgents();
    return { ok: true };
  }

  async function removeLocalAgent(agentId) {
    _agents = _agents.filter(a => a.id !== agentId);
    await _saveAgents();
    return { ok: true };
  }

  // ========== VOICE PREVIEW ==========
  async function previewVoice(voiceId) {
    const voice = _voices.find(v => v.id === voiceId);
    if (voice?.previewUrl) {
      return { audioUrl: voice.previewUrl };
    }
    // Genera preview con testo breve
    return speak('Ciao, questa è un\'anteprima della mia voce.', { voiceId });
  }

  // ========== PRONUNCIA PAGINA (integra con Brain) ==========
  async function speakPageSummary(options = {}) {
    // Chiedi a Brain di riassumere, poi leggi ad alta voce
    const brainResult = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'brain-think', prompt: options.prompt || 'Riassumi il contenuto principale di questa pagina in 2-3 frasi brevi in italiano.' },
        resp => resp?.error ? reject(new Error(resp.error)) : resolve(resp)
      );
    });

    const text = brainResult?.raw || brainResult?.answer || 'Nessun contenuto da leggere.';
    return speak(text.slice(0, 5000), options);
  }

  // ========== HISTORY ==========
  async function getHistory(pageSize = 100) {
    return _json(`/history?page_size=${pageSize}`);
  }

  // ========== SOUND EFFECTS ==========
  async function soundEffect(text, options = {}) {
    const payload = {
      text,
      duration_seconds: options.duration || null,
      prompt_influence: options.influence || 0.3,
    };

    const resp = await _fetch('/sound-generation', {
      method: 'POST',
      json: payload,
    });

    const arrayBuffer = await resp.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    return { audioUrl: URL.createObjectURL(blob), blob, size: arrayBuffer.byteLength };
  }

  // ========== HELPERS ==========
  function _getMimeType(format) {
    if (format.startsWith('mp3')) return 'audio/mpeg';
    if (format.startsWith('pcm')) return 'audio/pcm';
    if (format.startsWith('ulaw')) return 'audio/basic';
    return 'audio/mpeg';
  }

  // Lingue supportate per STT/TTS
  function getSupportedLanguages() {
    return [
      { code: 'it', name: 'Italiano' },
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Español' },
      { code: 'fr', name: 'Français' },
      { code: 'de', name: 'Deutsch' },
      { code: 'pt', name: 'Português' },
      { code: 'pl', name: 'Polski' },
      { code: 'ja', name: '日本語' },
      { code: 'ko', name: '한국어' },
      { code: 'zh', name: '中文' },
      { code: 'nl', name: 'Nederlands' },
      { code: 'tr', name: 'Türkçe' },
      { code: 'sv', name: 'Svenska' },
      { code: 'id', name: 'Bahasa Indonesia' },
      { code: 'fil', name: 'Filipino' },
      { code: 'hi', name: 'हिन्दी' },
      { code: 'ar', name: 'العربية' },
      { code: 'cs', name: 'Čeština' },
      { code: 'da', name: 'Dansk' },
      { code: 'fi', name: 'Suomi' },
      { code: 'el', name: 'Ελληνικά' },
      { code: 'ms', name: 'Bahasa Melayu' },
      { code: 'ro', name: 'Română' },
      { code: 'uk', name: 'Українська' },
      { code: 'bg', name: 'Български' },
      { code: 'hr', name: 'Hrvatski' },
      { code: 'sk', name: 'Slovenčina' },
      { code: 'ta', name: 'தமிழ்' },
    ];
  }

  // Stats
  async function getStats() {
    const sub = await getSubscription().catch(() => null);
    return {
      voicesLoaded: _voices.length,
      agentsConfigured: _agents.length,
      defaultVoice: _config.defaultVoiceId || 'none',
      defaultModel: _config.defaultModel,
      language: _config.language,
      subscription: sub ? {
        tier: sub.tier,
        characterCount: sub.character_count,
        characterLimit: sub.character_limit,
        remainingCharacters: (sub.character_limit || 0) - (sub.character_count || 0),
      } : null,
    };
  }

  // ========== PUBLIC API ==========
  return {
    init,
    getConfig,
    setConfig,
    // Account
    getSubscription,
    getUsage,
    getStats,
    // Voices
    listVoices,
    getVoice,
    searchVoices,
    getVoicesByLanguage,
    previewVoice,
    // Models
    listModels,
    // TTS
    speak,
    speakStream,
    speakPageSummary,
    // STT
    transcribe,
    recordAndTranscribe,
    // Agents
    listAgentsAPI,
    createAgent,
    getAgent,
    updateAgent,
    deleteAgent,
    getLocalAgents,
    saveLocalAgent,
    removeLocalAgent,
    // Sound FX
    soundEffect,
    // History
    getHistory,
    // Languages
    getSupportedLanguages,
  };
})();

// Export to service worker global scope (MV3 compatible)
if (typeof self !== 'undefined') {
  self.ElevenLabs = ElevenLabs;
}
