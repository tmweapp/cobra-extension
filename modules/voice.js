/**
 * COBRA v5.2 — Voice Module (Walkie-Talkie + TTS)
 * Extracted from sidepanel.js.
 * ElevenLabs TTS + Web Speech API STT.
 * Requires: global `state`, `Chat`, `Toast`, `Storage` objects.
 */
const Voice = {
  _voices: [],
  _currentAudio: null,

  async loadVoices(forceRefresh = false) {
    if (this._voices.length && !forceRefresh) return this._voices;
    if (!state.settings.elevenKey) {
      console.warn('[Voice] No ElevenLabs key configured');
      return [];
    }
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': state.settings.elevenKey }
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      this._voices = (data.voices || []).map(v => ({
        id: v.voice_id,
        name: v.name,
        category: v.category || 'premade',
        language: v.labels?.language || '',
        gender: v.labels?.gender || '',
        accent: v.labels?.accent || '',
        age: v.labels?.age || '',
        useCase: v.labels?.use_case || '',
        description: v.labels?.description || '',
        previewUrl: v.preview_url || ''
      }));
      console.log(`[Voice] Loaded ${this._voices.length} voices from ElevenLabs`);
    } catch (err) {
      console.error('[Voice] Failed to load voices:', err);
      this._voices = [
        { id: 'uScy1bXtKz8vPzfdFsFw', name: 'Antonio Farina', category: 'cloned', language: 'it', gender: 'male', accent: 'italian', age: 'middle-aged', useCase: 'conversational', description: 'Expressive, warm', previewUrl: '' },
        { id: 'CiwzbDpaN3pQXjTgx3ML', name: 'Aida', category: 'cloned', language: 'it', gender: 'female', accent: 'italian', age: 'middle-aged', useCase: 'conversational', description: 'Sultry', previewUrl: '' },
        { id: 'HuK8QKF35exsCh2e7fLT', name: 'Carmelo La Rosa', category: 'cloned', language: 'it', gender: 'male', accent: 'italian', age: 'middle-aged', useCase: 'e-learning', description: 'Professional', previewUrl: '' },
        { id: 'ImsA1Fn5TNc843fFdz99', name: 'Davide', category: 'cloned', language: 'it', gender: 'male', accent: 'italian', age: 'young', useCase: 'social media', description: 'Young', previewUrl: '' },
        { id: '8KInRSd4DtD5L5gK7itu', name: 'Giusy Giarry', category: 'cloned', language: 'it', gender: 'female', accent: 'sicilian', age: 'middle-aged', useCase: 'conversational', description: 'Conversational', previewUrl: '' },
        { id: 'jHaMmf5SfxgmUrgRYbqt', name: 'Carlo', category: 'cloned', language: 'it', gender: 'male', accent: 'italian', age: 'middle-aged', useCase: 'general', description: 'Italian', previewUrl: '' },
      ];
    }
    return this._voices;
  },

  getFilteredVoices(lang) {
    if (!lang) return this._voices;
    const l = lang.toLowerCase();
    return this._voices.filter(v =>
      v.language.toLowerCase().includes(l) ||
      v.accent.toLowerCase().includes(l)
    );
  },

  populateVoiceSelect(langFilter) {
    const select = document.getElementById('voiceSelect');
    if (!select) return;
    const voices = langFilter ? this.getFilteredVoices(langFilter) : this._voices;
    const currentVoiceId = state.settings.selectedVoiceId || 'uScy1bXtKz8vPzfdFsFw';

    select.innerHTML = '';
    if (voices.length === 0) {
      select.innerHTML = '<option value="">Nessuna voce trovata</option>';
      return;
    }
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (${v.gender || '?'}, ${v.language || '?'}${v.accent ? ', ' + v.accent : ''})`;
      if (v.id === currentVoiceId) opt.selected = true;
      select.appendChild(opt);
    });
    this.updateVoiceInfo(select.value);
  },

  updateVoiceInfo(voiceId) {
    const info = document.getElementById('voiceInfo');
    if (!info) return;
    const voice = this._voices.find(v => v.id === voiceId);
    if (voice) {
      info.textContent = `${voice.name} — ${voice.category} | ${voice.gender} | ${voice.language} | ${voice.useCase || 'general'} | ${voice.description || ''}`;
    } else {
      info.textContent = '';
    }
  },

  async previewVoice(voiceId) {
    if (!voiceId || !state.settings.elevenKey) return;
    if (this._currentAudio) { this._currentAudio.pause(); this._currentAudio = null; }

    const voice = this._voices.find(v => v.id === voiceId);
    if (voice?.previewUrl) {
      this._currentAudio = new Audio(voice.previewUrl);
      this._currentAudio.play();
      return;
    }

    try {
      const sampleText = state.settings.language === 'it'
        ? 'Ciao! Sono la tua voce COBRA. Come posso aiutarti oggi?'
        : 'Hello! I am your COBRA voice assistant. How can I help you today?';

      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': state.settings.elevenKey
        },
        body: JSON.stringify({
          text: sampleText,
          model_id: state.settings.voiceModel || 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });

      if (res.ok) {
        const blob = await res.blob();
        this._currentAudio = new Audio(URL.createObjectURL(blob));
        this._currentAudio.play();
      }
    } catch (e) {
      console.error('[Voice] Preview error:', e);
    }
  },

  async speak(text) {
    if (!state.settings.voice) return;
    if (!text || text.trim().length < 2) return;
    console.log('[Voice] Speaking:', text.substring(0, 80) + '...');

    if (state.settings.elevenKey) {
      try {
        const voiceId = state.settings.selectedVoiceId || 'uScy1bXtKz8vPzfdFsFw';
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': state.settings.elevenKey
          },
          body: JSON.stringify({
            text: text.substring(0, 2000),
            model_id: state.settings.voiceModel || 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              speed: parseFloat(state.settings.voiceSpeed || '1.0')
            }
          })
        });

        if (response.ok) {
          const blob = await response.blob();
          if (this._currentAudio) { this._currentAudio.pause(); this._currentAudio = null; }
          const audioUrl = URL.createObjectURL(blob);
          this._currentAudio = new Audio(audioUrl);
          this._currentAudio.playbackRate = parseFloat(state.settings.voiceSpeed || '1.0');
          this._currentAudio.onerror = (e) => {
            console.error('[Voice] Audio play error:', e);
            this._speakFallback(text);
          };
          await this._currentAudio.play();
          return;
        }
      } catch (e) {
        console.error('[Voice] ElevenLabs TTS error:', e);
      }
    }
    this._speakFallback(text);
  },

  _speakFallback(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.substring(0, 500));
    utter.lang = state.settings.language === 'it' ? 'it-IT' : 'en-US';
    utter.rate = parseFloat(state.settings.voiceSpeed || '1.0');
    const voices = window.speechSynthesis.getVoices();
    const itVoice = voices.find(v => v.lang.startsWith('it'));
    if (itVoice) utter.voice = itVoice;
    window.speechSynthesis.speak(utter);
  },

  _injectionRunning: false,

  // ── WALKIE-TALKIE MODE ──
  startListening() {
    if (this._injectionRunning || state.voiceActive) return;

    const lang = state.settings.language === 'it' ? 'it-IT' : 'en-US';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        state.recognition = new SpeechRecognition();
        state.recognition.lang = lang;
        state.recognition.continuous = true;
        state.recognition.interimResults = true;
        state.recognition.maxAlternatives = 1;

        this._voiceTimeout = setTimeout(() => {
          if (state.voiceActive) Voice.stopListening();
        }, 120000);

        state.recognition.onresult = (event) => {
          let fullTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            fullTranscript += event.results[i][0].transcript;
          }
          const chatInput = document.getElementById('chatInput');
          if (chatInput) {
            chatInput.value = fullTranscript;
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
          }
        };

        state.recognition.onerror = (event) => {
          console.warn('[Voice] Error:', event.error);
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            state.recognition = null;
            if (this._voiceTimeout) { clearTimeout(this._voiceTimeout); this._voiceTimeout = null; }
            Voice._startListeningViaInjection(lang);
          }
        };

        state.recognition.onend = () => {
          if (state.voiceActive) {
            try { state.recognition?.start(); } catch { Voice.stopListening(); }
          }
        };

        state.recognition.start();
        state.voiceActive = true;
        this._updateMicUI(true);
        return;
      } catch (e) {
        console.warn('[Voice] Direct failed:', e.message);
        state.recognition = null;
      }
    }
    this._startListeningViaInjection(lang);
  },

  async _startListeningViaInjection(lang) {
    if (this._injectionRunning) return;
    this._injectionRunning = true;
    state.voiceActive = true;
    this._updateMicUI(true);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        Chat.addMessage('system', 'Naviga su un sito web per usare il microfono.');
        Toast.warning('Microfono: naviga su un sito');
        Voice.stopListening();
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (lang) => {
          return new Promise((resolve) => {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) { resolve({ error: 'SpeechRecognition non disponibile' }); return; }
            const rec = new SR();
            rec.lang = lang;
            rec.continuous = true;
            rec.interimResults = false;
            let fullText = '';
            const maxTimeout = setTimeout(() => { rec.stop(); }, 120000);
            const handler = (event) => {
              if (event.data?.__cobra_voice_stop) {
                window.removeEventListener('message', handler);
                rec.stop();
              }
            };
            window.addEventListener('message', handler);
            rec.onresult = (e) => {
              for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) fullText += e.results[i][0].transcript + ' ';
              }
            };
            rec.onerror = (e) => {
              clearTimeout(maxTimeout);
              window.removeEventListener('message', handler);
              resolve({ error: e.error });
            };
            rec.onend = () => {
              clearTimeout(maxTimeout);
              window.removeEventListener('message', handler);
              resolve({ text: fullText.trim() || null });
            };
            rec.start();
          });
        },
        args: [lang || 'it-IT']
      });

      const result = results?.[0]?.result;
      if (result?.text) {
        const chatInput = document.getElementById('chatInput');
        if (chatInput) chatInput.value = result.text;
      } else if (result?.error && result.error !== 'no-speech') {
        Chat.addMessage('system', `Errore microfono: ${result.error}`);
      }
    } catch (e) {
      console.error('[Voice] Injection error:', e);
      Chat.addMessage('system', 'Errore microfono. Naviga su un sito e riprova.');
    }
    Voice.stopListening();
  },

  _updateMicUI(listening) {
    const micBtn = document.getElementById('micBtn');
    const chatMicBtn = document.getElementById('chatMicBtn');
    const indicator = document.getElementById('listeningIndicator');
    const listeningText = document.getElementById('listeningText');

    if (listening) {
      if (micBtn) { micBtn.classList.add('listening'); micBtn.title = 'Registrando... clicca per fermare'; }
      if (chatMicBtn) chatMicBtn.classList.add('listening');
      if (indicator) indicator.classList.add('active');
      if (listeningText) listeningText.textContent = '🔴 Registrazione — parla, poi premi invio';
    } else {
      if (micBtn) { micBtn.classList.remove('listening'); micBtn.title = 'Microfono (walkie-talkie)'; }
      if (chatMicBtn) chatMicBtn.classList.remove('listening');
      if (indicator) indicator.classList.remove('active');
    }
  },

  stopListening() {
    if (this._voiceTimeout) { clearTimeout(this._voiceTimeout); this._voiceTimeout = null; }
    if (state.recognition) {
      try { state.recognition.onend = null; state.recognition.stop(); } catch {}
      state.recognition = null;
    }
    state.voiceActive = false;
    this._injectionRunning = false;
    this._updateMicUI(false);
  },

  sendAndStop() {
    const chatInput = document.getElementById('chatInput');
    const text = chatInput?.value?.trim();
    this.stopListening();
    if (text) {
      Chat.send(text);
      if (chatInput) chatInput.value = '';
    }
  },

  toggleListening() {
    if (state.voiceActive) {
      this.stopListening();
    } else {
      this.startListening();
    }
  },

  async speakConversational(fullText) {
    if (!state.settings.voice || !state.settings.elevenKey) return;
    if (fullText.length <= 200) {
      this.speak(fullText);
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'VOICE_SUMMARY',
        payload: {
          text: fullText.substring(0, 1500),
          context: 'conversazione vocale con operatore'
        }
      });
      const summary = response?.summary;
      if (summary && summary.length > 5) {
        this.speak(summary);
      } else {
        const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
        this.speak(sentences.slice(0, 2).join(' ').substring(0, 300));
      }
    } catch (e) {
      const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
      this.speak(sentences.slice(0, 2).join(' ').substring(0, 300));
    }
  }
};
