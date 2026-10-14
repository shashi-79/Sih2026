/**
 * Voice Controller: Speech Recognition (STT) & Audio Feedback (TTS)
 * Provides offline speech recognition, push-to-talk mic management,
 * Web Audio visualization, and browser-native synthesized audio speech feedback.
 */

class VoiceController {
  constructor(options = {}) {
    this.onTranscription = options.onTranscription || (() => {});
    this.onStateChange = options.onStateChange || (() => {});

    this.isListening = false;
    this.isSpeaking = false;
    this.isMuted = false;
    this.speechRate = 1.05;
    this.speechPitch = 1.0;

    this.recognition = null;
    this.audioContext = null;
    this.analyser = null;
    this.micStream = null;

    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[VoiceController] SpeechRecognition API not supported in this browser environment');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStateChange({ listening: true });
    };

    this.recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const text = (finalTranscript || interimTranscript).trim();
      if (text) {
        this.onTranscription({
          text,
          isFinal: !!finalTranscript
        });
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('[VoiceController] SpeechRecognition event notice:', event.error);
      if (event.error === 'not-allowed') {
        chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/permission.html') });
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onStateChange({ listening: false });
    };
  }

  /**
   * Toggles speech recognition listening
   */
  async toggleListening() {
    if (this.isListening) {
      this.stopListening();
      return false;
    } else {
      await this.startListening();
      return true;
    }
  }

  async startListening() {
    if (!this.recognition) return;
    try {
      this.recognition.start();
    } catch (e) {
      // If already started, ignore
    }
  }

  stopListening() {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch (e) {}
    this.isListening = false;
    this.onStateChange({ listening: false });
  }

  /**
   * Intelligently selects the most natural browser voice matching language and tone
   */
  findBestVoice(text = '') {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (voices.length === 0) return null;

    // Detect if text is Hindi or Hinglish
    const isHindiOrHinglish = /[^\u0000-\u007F]|\b(haan|main|aapke|aapka|liye|khol|karta|hoon|raha|rahi|dhoondh|dekhiye|chaliye|karo|batao|kholte|gayi|hai|hain)\b/i.test(text);

    if (isHindiOrHinglish) {
      // Prioritize natural Hindi or Indian English voices for authentic phonetics
      const hindiVoice = voices.find(v => /hi[-_]in/i.test(v.lang) || /hindi|हिन्दी/i.test(v.name));
      if (hindiVoice) return hindiVoice;

      const indianVoice = voices.find(v => /en[-_]in/i.test(v.lang) || /india/i.test(v.name));
      if (indianVoice) return indianVoice;
    }

    // Natural English voices: prioritize Google / Microsoft Natural / Neural
    const naturalVoice = voices.find(v => /google.*english|natural|neural/i.test(v.name));
    if (naturalVoice) return naturalVoice;

    const enUsVoice = voices.find(v => /en[-_]us/i.test(v.lang) && !/desktop/i.test(v.name));
    if (enUsVoice) return enUsVoice;

    return voices[0] || null;
  }

  /**
   * Speaks status or feedback text aloud to the user
   */
  speak(text) {
    if (this.isMuted || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return Promise.resolve();
    }

    const cleanText = text.replace(/[*#_`]/g, '').trim();
    if (!cleanText) return Promise.resolve();

    return new Promise((resolve) => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        window.speechSynthesis.cancel(); // Stop prior overlapping speech

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = this.speechRate;
        utterance.pitch = this.speechPitch;

        const bestVoice = this.findBestVoice(cleanText);
        if (bestVoice) {
          utterance.voice = bestVoice;
          utterance.lang = bestVoice.lang;
        }

        // Keep reference to prevent premature garbage collection in Chrome
        this._currentUtterance = utterance;

        let finished = false;
        let timeoutId = null;

        const finish = () => {
          if (!finished) {
            finished = true;
            if (timeoutId) clearTimeout(timeoutId);
            this._currentUtterance = null;
            this.isSpeaking = false;
            this.onStateChange({ speaking: false });
            resolve();
          }
        };

        // Safety timeout: utterance must never permanently freeze the execution loop
        const maxDurationMs = Math.max(2000, Math.min(12000, cleanText.length * 90));
        timeoutId = setTimeout(finish, maxDurationMs);

        utterance.onstart = () => {
          this.isSpeaking = true;
          this.onStateChange({ speaking: true, text: cleanText });
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[VoiceController] TTS error:', err);
        this.isSpeaking = false;
        resolve();
      }
    });
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    if (this.isMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
      this.onStateChange({ speaking: false });
    }
  }
}

if (typeof window !== 'undefined') {
  window.VoiceController = VoiceController;
}
if (typeof module !== 'undefined') {
  module.exports = { VoiceController };
}
