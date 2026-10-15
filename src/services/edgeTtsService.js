/**
 * Edge TTS Service module for Ledgero app.
 * Provides text-to-speech using an Edge TTS proxy or falls back to Web Speech API.
 */

const VOICE_MAP = {
  bn: 'bn-BD-NabanitaNeural',
  hi: 'hi-IN-SwaraNeural',
  en: 'en-US-JennyNeural'
};

const DEFAULT_RATE = '+0%';
const DEFAULT_VOLUME = '+0%';

let EDGE_TTS_PROXY_URL = '';
let currentAudioElement = null;
let currentSpeechSynthesisUtterance = null;
let isPlaying = false;

/**
 * Set the proxy endpoint for Edge TTS.
 * @param {string} url - The proxy URL.
 */
export function setProxyUrl(url) {
  EDGE_TTS_PROXY_URL = url;
}

/**
 * Check if TTS is supported.
 * @returns {boolean} True if supported.
 */
export function isSupported() {
  return typeof window !== 'undefined' && (!!EDGE_TTS_PROXY_URL || ('speechSynthesis' in window));
}

/**
 * Get available native voices.
 * @returns {SpeechSynthesisVoice[]} List of voices.
 */
export function getAvailableVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

/**
 * Stop any ongoing speech (audio or native).
 */
export function stop() {
  isPlaying = false;
  
  if (currentAudioElement) {
    currentAudioElement.pause();
    currentAudioElement.currentTime = 0;
    currentAudioElement = null;
  }
  
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Sanitize text for TTS.
 * @param {string} text - Input text.
 * @returns {string} Sanitized text.
 */
function sanitizeText(text) {
  if (!text) return '';
  return text
    // Strip markdown bold and italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    // Strip emojis
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    // Strip bullet points at line starts
    .replace(/^[•\-*]\s+/gm, '')
    // Convert newlines to commas for short pauses
    .replace(/\n+/g, ', ')
    // Convert currency symbol
    .replace(/৳/g, 'টাকা')
    .trim();
}

/**
 * Fallback native speech synthesis.
 * @param {string} text - The text to speak.
 * @param {string} [lang='bn'] - The language code.
 * @returns {Promise<void>} Resolves when speech ends.
 */
export function speakNative(text, lang = 'bn') {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return reject(new Error('Speech synthesis not supported'));
    }
    
    stop();
    isPlaying = true;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'bn' ? 'bn-BD' : lang === 'hi' ? 'hi-IN' : 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      let selectedVoice = null;
      if (lang === 'bn') {
        selectedVoice = voices.find(v => v.name.includes('Bangla') || v.name.includes('Bengali') || v.name.includes('bn-BD') || v.name.includes('bn-IN'));
      } else if (lang === 'hi') {
        selectedVoice = voices.find(v => v.name.includes('Hindi') || v.name.includes('hi-IN'));
      } else {
        selectedVoice = voices.find(v => v.name.includes('Jenny') || v.name.includes('Google US English') || v.name.includes('Microsoft Jenny'));
      }
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
    }

    utterance.onend = () => {
      isPlaying = false;
      resolve();
    };
    utterance.onerror = (e) => {
      isPlaying = false;
      reject(e);
    };

    currentSpeechSynthesisUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Main entry point for speaking text.
 * @param {string} text - The text to speak.
 * @param {string} [lang='bn'] - The language code (bn, hi, en).
 * @param {Object} [options={}] - Additional options.
 * @returns {Promise<void>} Resolves when speech finishes.
 */
export async function speak(text, lang = 'bn', options = {}) {
  const cleanText = sanitizeText(text);
  if (!cleanText) return;

  stop();
  isPlaying = true;

  // Chunking logic
  if (cleanText.length > 500) {
    const chunks = cleanText.split(/(?<=[.!?।])\s+/);
    for (const chunk of chunks) {
      if (!isPlaying) break; // Stopped midway
      if (chunk.trim()) {
        await speakSingle(chunk, lang, options).catch(e => {
          console.error('Error speaking chunk, falling back to native', e);
          return speakNative(chunk, lang);
        });
      }
    }
    return;
  }

  return speakSingle(cleanText, lang, options).catch(e => {
    console.error('TTS failed, falling back to native', e);
    return speakNative(cleanText, lang);
  });
}

/**
 * Internal method to speak a single string.
 */
async function speakSingle(text, lang, options) {
  if (!EDGE_TTS_PROXY_URL) {
    return speakNative(text, lang);
  }

  const voice = VOICE_MAP[lang] || VOICE_MAP['bn'];
  const requestBody = {
    text,
    voice,
    rate: DEFAULT_RATE,
    ...options
  };

  try {
    const response = await fetch(EDGE_TTS_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      currentAudioElement = audio;
      
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      
      audio.play().catch(e => {
        URL.revokeObjectURL(url);
        reject(e);
      });
    });
  } catch (error) {
    throw error;
  }
}
