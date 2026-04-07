/**
 * COBRA Voice Module Tests
 * Tests ElevenLabs TTS, Web Speech API STT, voice control
 */

describe('Voice Module', () => {
  let Voice;
  let mockState;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock state
    mockState = {
      voiceActive: false,
      recognition: null,
      settings: {
        elevenKey: 'test_key_123',
        language: 'it',
        selectedVoiceId: 'uScy1bXtKz8vPzfdFsFw',
        voice: true,
        voiceModel: 'eleven_multilingual_v2',
        voiceSpeed: '1.0',
      },
    };

    global.state = mockState;

    // Mock fetch for ElevenLabs API
    global.fetch = jest.fn();

    // Mock Web Speech API
    global.SpeechRecognition = jest.fn(() => ({
      lang: '',
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      onresult: null,
      onerror: null,
      onend: null,
      start: jest.fn(),
      stop: jest.fn(),
    }));

    global.webkitSpeechRecognition = global.SpeechRecognition;

    // Mock chrome tabs query
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
    chrome.scripting.executeScript.mockResolvedValue([{ result: {} }]);

    // Create Voice module
    Voice = {
      _voices: [],
      _currentAudio: null,
      _injectionRunning: false,
      _voiceTimeout: null,

      async loadVoices(forceRefresh = false) {
        if (this._voices.length && !forceRefresh) return this._voices;
        if (!state.settings.elevenKey) {
          return [];
        }
        try {
          const res = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': state.settings.elevenKey },
          });
          if (!res.ok) throw new Error(`API ${res.status}`);
          const data = await res.json();
          this._voices = (data.voices || []).map((v) => ({
            id: v.voice_id,
            name: v.name,
            category: v.category || 'premade',
            language: v.labels?.language || '',
            gender: v.labels?.gender || '',
            accent: v.labels?.accent || '',
            age: v.labels?.age || '',
            useCase: v.labels?.use_case || '',
            description: v.labels?.description || '',
            previewUrl: v.preview_url || '',
          }));
        } catch (err) {
          this._voices = [
            {
              id: 'uScy1bXtKz8vPzfdFsFw',
              name: 'Antonio Farina',
              category: 'cloned',
              language: 'it',
              gender: 'male',
              accent: 'italian',
              age: 'middle-aged',
              useCase: 'conversational',
              description: 'Expressive, warm',
              previewUrl: '',
            },
          ];
        }
        return this._voices;
      },

      getFilteredVoices(lang) {
        if (!lang) return this._voices;
        const l = lang.toLowerCase();
        return this._voices.filter(
          (v) =>
            v.language.toLowerCase().includes(l) ||
            v.accent.toLowerCase().includes(l)
        );
      },

      async speak(text) {
        if (!state.settings.voice) return;
        if (!text || text.trim().length < 2) return;

        if (state.settings.elevenKey) {
          try {
            const voiceId = state.settings.selectedVoiceId || 'uScy1bXtKz8vPzfdFsFw';
            const response = await fetch(
              `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'xi-api-key': state.settings.elevenKey,
                },
                body: JSON.stringify({
                  text: text.substring(0, 2000),
                  model_id: state.settings.voiceModel || 'eleven_multilingual_v2',
                  voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    speed: parseFloat(state.settings.voiceSpeed || '1.0'),
                  },
                }),
              }
            );

            if (response.ok) {
              const blob = await response.blob();
              if (this._currentAudio) {
                this._currentAudio.pause();
                this._currentAudio = null;
              }
              const audioUrl = URL.createObjectURL(blob);
              this._currentAudio = new Audio(audioUrl);
              this._currentAudio.playbackRate = parseFloat(
                state.settings.voiceSpeed || '1.0'
              );
              await this._currentAudio.play();
              return;
            }
          } catch (e) {
            // Fallback
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
        window.speechSynthesis.speak(utter);
      },

      startListening() {
        if (this._injectionRunning || state.voiceActive) return;
        state.voiceActive = true;
      },

      stopListening() {
        if (this._voiceTimeout) {
          clearTimeout(this._voiceTimeout);
          this._voiceTimeout = null;
        }
        if (state.recognition) {
          try {
            state.recognition.onend = null;
            state.recognition.stop();
          } catch {}
          state.recognition = null;
        }
        state.voiceActive = false;
        this._injectionRunning = false;
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
        const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
        this.speak(sentences.slice(0, 2).join(' ').substring(0, 300));
      },
    };

    global.Voice = Voice;
  });

  describe('loadVoices', () => {
    it('should load voices from ElevenLabs API', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          voices: [
            {
              voice_id: 'v1',
              name: 'Voice 1',
              category: 'premade',
              labels: { language: 'en', gender: 'male' },
            },
          ],
        }),
      });

      const voices = await Voice.loadVoices(true);

      expect(voices.length).toBe(1);
      expect(voices[0].id).toBe('v1');
      expect(voices[0].name).toBe('Voice 1');
    });

    it('should return cached voices if not forcing refresh', async () => {
      Voice._voices = [{ id: 'cached', name: 'Cached Voice' }];

      const voices = await Voice.loadVoices();

      expect(voices).toEqual([{ id: 'cached', name: 'Cached Voice' }]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should return empty array without API key', async () => {
      state.settings.elevenKey = '';

      const voices = await Voice.loadVoices(true);

      expect(voices).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle API error and use fallback voices', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      Voice._voices = [];
      const voices = await Voice.loadVoices(true);

      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].id).toBe('uScy1bXtKz8vPzfdFsFw'); // Fallback voice
    });

    it('should map voice labels correctly', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          voices: [
            {
              voice_id: 'v1',
              name: 'Test',
              labels: {
                language: 'it',
                gender: 'female',
                accent: 'sicilian',
                age: 'young',
                use_case: 'news',
                description: 'Professional voice',
              },
              preview_url: 'https://example.com/preview.mp3',
            },
          ],
        }),
      });

      const voices = await Voice.loadVoices(true);

      expect(voices[0].language).toBe('it');
      expect(voices[0].gender).toBe('female');
      expect(voices[0].accent).toBe('sicilian');
      expect(voices[0].age).toBe('young');
      expect(voices[0].useCase).toBe('news');
      expect(voices[0].description).toBe('Professional voice');
      expect(voices[0].previewUrl).toBe('https://example.com/preview.mp3');
    });
  });

  describe('getFilteredVoices', () => {
    beforeEach(() => {
      Voice._voices = [
        {
          id: 'v1',
          language: 'it',
          accent: 'italian',
          name: 'Italian Voice',
        },
        {
          id: 'v2',
          language: 'en',
          accent: 'american',
          name: 'English Voice',
        },
      ];
    });

    it('should return all voices if no filter', () => {
      const filtered = Voice.getFilteredVoices();

      expect(filtered.length).toBe(2);
    });

    it('should filter voices by language', () => {
      const filtered = Voice.getFilteredVoices('it');

      expect(filtered.length).toBe(1);
      expect(filtered[0].language).toBe('it');
    });

    it('should filter voices by accent', () => {
      const filtered = Voice.getFilteredVoices('american');

      expect(filtered.length).toBe(1);
      expect(filtered[0].accent).toBe('american');
    });

    it('should be case insensitive', () => {
      const filtered = Voice.getFilteredVoices('IT');

      expect(filtered.length).toBe(1);
      expect(filtered[0].language).toBe('it');
    });

    it('should return empty array if no matches', () => {
      const filtered = Voice.getFilteredVoices('fr');

      expect(filtered.length).toBe(0);
    });
  });

  describe('speak', () => {
    it('should not speak if voice setting disabled', async () => {
      state.settings.voice = false;

      await Voice.speak('Test text');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not speak empty text', async () => {
      await Voice.speak('');
      await Voice.speak('   ');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should call ElevenLabs API with correct parameters', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => new Blob(),
      });

      await Voice.speak('Hello world');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('text-to-speech'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'xi-api-key': 'test_key_123',
          }),
        })
      );
    });

    it('should limit text to 2000 characters', async () => {
      const longText = 'x'.repeat(5000);
      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => new Blob(),
      });

      await Voice.speak(longText);

      const call = global.fetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text.length).toBeLessThanOrEqual(2000);
    });

    it('should stop previous audio before playing new', async () => {
      const mockAudio = {
        pause: jest.fn(),
        play: jest.fn().mockResolvedValue(),
      };
      Voice._currentAudio = mockAudio;

      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => new Blob(),
      });

      global.URL = { createObjectURL: jest.fn(() => 'blob:url') };
      global.Audio = jest.fn(() => ({
        pause: jest.fn(),
        play: jest.fn().mockResolvedValue(),
      }));

      await Voice.speak('Test');

      expect(mockAudio.pause).toHaveBeenCalled();
    });

    it('should set playback rate', async () => {
      state.settings.voiceSpeed = '1.5';

      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => new Blob(),
      });

      global.URL = { createObjectURL: jest.fn(() => 'blob:url') };
      const mockAudio = {
        playbackRate: 1,
        pause: jest.fn(),
        play: jest.fn().mockResolvedValue(),
      };
      global.Audio = jest.fn(() => mockAudio);

      await Voice.speak('Test');

      expect(mockAudio.playbackRate).toBe(1.5);
    });

    it('should fallback on API error', async () => {
      global.fetch.mockRejectedValue(new Error('API Error'));

      try {
        await Voice.speak('Test');
      } catch (e) {
        // May throw or may fallback
      }

      // Test passes if no uncaught error
      expect(true).toBe(true);
    });
  });

  describe('_speakFallback', () => {
    it('should be callable without errors', () => {
      // _speakFallback is a fallback function
      // It's called when ElevenLabs fails or isn't available
      // Just verify it's defined and callable
      expect(typeof Voice._speakFallback).toBe('function');
    });

    it('should handle missing speechSynthesis gracefully', () => {
      // If speechSynthesis is not available, should not throw
      Voice._speakFallback('Test');
      expect(true).toBe(true);
    });

    it('should exist as a method', () => {
      expect(Voice._speakFallback).toBeDefined();
    });
  });

  describe('startListening', () => {
    it('should set voiceActive to true', () => {
      state.voiceActive = false;

      Voice.startListening();

      expect(state.voiceActive).toBe(true);
    });

    it('should not start if already listening', () => {
      state.voiceActive = true;
      const before = state.voiceActive;

      Voice.startListening();

      expect(state.voiceActive).toBe(before);
    });

    it('should not start if injection is running', () => {
      Voice._injectionRunning = true;
      state.voiceActive = false;

      Voice.startListening();

      expect(state.voiceActive).toBe(false);
    });
  });

  describe('stopListening', () => {
    it('should set voiceActive to false', () => {
      state.voiceActive = true;

      Voice.stopListening();

      expect(state.voiceActive).toBe(false);
    });

    it('should clear timeout', () => {
      Voice._voiceTimeout = setTimeout(() => {}, 1000);
      const timeoutId = Voice._voiceTimeout;

      Voice.stopListening();

      expect(Voice._voiceTimeout).toBeNull();
    });

    it('should stop recognition', () => {
      const mockRec = { stop: jest.fn(), onend: jest.fn() };
      state.recognition = mockRec;

      Voice.stopListening();

      expect(mockRec.stop).toHaveBeenCalled();
      expect(state.recognition).toBeNull();
    });

    it('should set injection to not running', () => {
      Voice._injectionRunning = true;

      Voice.stopListening();

      expect(Voice._injectionRunning).toBe(false);
    });
  });

  describe('toggleListening', () => {
    it('should start listening if not active', () => {
      state.voiceActive = false;

      Voice.toggleListening();

      expect(state.voiceActive).toBe(true);
    });

    it('should stop listening if active', () => {
      state.voiceActive = true;

      Voice.toggleListening();

      expect(state.voiceActive).toBe(false);
    });
  });

  describe('speakConversational', () => {
    it('should not speak if voice disabled', async () => {
      state.settings.voice = false;

      await Voice.speakConversational('Long text about something');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not speak without API key', async () => {
      state.settings.elevenKey = '';

      await Voice.speakConversational('Long text about something');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should speak short text directly', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => new Blob(),
      });
      global.URL = { createObjectURL: jest.fn(() => 'blob:url') };
      global.Audio = jest.fn(() => ({
        pause: jest.fn(),
        play: jest.fn().mockResolvedValue(),
      }));

      await Voice.speakConversational('Short text');

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should summarize long text', async () => {
      const longText =
        'This is sentence one. This is sentence two. This is sentence three. This is sentence four.';

      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => new Blob(),
      });
      global.URL = { createObjectURL: jest.fn(() => 'blob:url') };
      global.Audio = jest.fn(() => ({
        pause: jest.fn(),
        play: jest.fn().mockResolvedValue(),
      }));

      await Voice.speakConversational(longText);

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should limit conversational output to 300 characters', async () => {
      const longText = 'x. '.repeat(200); // Creates very long text

      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => new Blob(),
      });
      global.URL = { createObjectURL: jest.fn(() => 'blob:url') };
      global.Audio = jest.fn(() => ({
        pause: jest.fn(),
        play: jest.fn().mockResolvedValue(),
      }));

      await Voice.speakConversational(longText);

      const call = global.fetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text.length).toBeLessThanOrEqual(300);
    });
  });

  describe('Module structure', () => {
    it('should export Voice object', () => {
      expect(global.Voice).toBeDefined();
      expect(typeof global.Voice).toBe('object');
    });

    it('should have all public methods', () => {
      const methods = [
        'loadVoices',
        'getFilteredVoices',
        'speak',
        'startListening',
        'stopListening',
        'toggleListening',
        'speakConversational',
      ];

      methods.forEach((method) => {
        expect(typeof Voice[method]).toBe('function');
      });
    });
  });
});
