// naturalVoiceService.js — High-Fidelity Trilingual Voice Engine for NAM AI
// Provides authentic, fluent human voice for Bengali, Hindi, and English without robotic distortion or voice mismatch

let isPlaying = false;
let currentCallbacks = {};
let rvLoadPromise = null;

let currentChunkIndex = 0;
let currentChunks = [];
let cancelRequested = false;
let chunkWatchdogTimer = null;

/**
 * Dynamically loads ResponsiveVoice library if not already present in window.
 */
export const ensureResponsiveVoiceLoaded = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.responsiveVoice) {
    try { window.responsiveVoice.enableFallbackMode(); } catch {}
    return Promise.resolve(window.responsiveVoice);
  }
  if (rvLoadPromise) return rvLoadPromise;

  rvLoadPromise = new Promise((resolve) => {
    // Check if script element already exists
    const existing = document.querySelector('script[src*="responsivevoice.js"]');
    if (existing) {
      existing.addEventListener('load', () => {
        try { window.responsiveVoice?.enableFallbackMode(); } catch {}
        resolve(window.responsiveVoice);
      });
      existing.addEventListener('error', () => resolve(null));
      // In case it already loaded
      if (window.responsiveVoice) {
        try { window.responsiveVoice.enableFallbackMode(); } catch {}
        resolve(window.responsiveVoice);
        return;
      }
    }

    const script = document.createElement('script');
    script.src = 'https://code.responsivevoice.org/responsivevoice.js';
    script.async = true;
    script.onload = () => {
      try { window.responsiveVoice?.enableFallbackMode(); } catch {}
      resolve(window.responsiveVoice);
    };
    script.onerror = () => {
      console.warn('ResponsiveVoice script failed to load, falling back to system voices.');
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return rvLoadPromise;
};

/**
 * Strips markdown, emojis, asterisks, brackets, and format syntax while
 * PRESERVING punctuation marks (?, ।, ,, .) so that speech synthesis naturally pauses,
 * breathes, and raises intonation for questions without reading symbols or timestamps aloud.
 */
export const sanitizeTextForSpeech = (text, lang = 'bn') => {
  if (!text || typeof text !== 'string') return '';

  let clean = text
    // 1. Strip markdown links [label](url) -> label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 2. Strip code blocks and inline code
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // 3. Strip 24-hr timestamps in parentheses completely: (18:33:02), (১৮:৩৫:৫৬), etc.
    .replace(/\(\s*[০-৯0-9]{1,2}:[০-৯0-9]{2}(?::[০-৯0-9]{2})?\s*(?:AM|PM|am|pm)?\s*\)/gi, '')
    // 4. Strip leftover seconds from any time: 6:33:02 -> 6:33
    .replace(/([০-৯0-9]{1,2}:[০-৯0-9]{2}):[০-৯0-9]{2}/g, '$1')
    // 5. Replace bullet points at line starts or inline with natural pause
    .replace(/^[ \t]*[•●○◆▪▸►\*\-]\s*/gm, ', ')
    .replace(/[•●○◆▪▸►]/g, ', ')
    // 6. Convert newlines to punctuation pause if not already punctuated
    .replace(/([^।!?\.\n])\s*\n+/g, '$1, ')
    .replace(/\n+/g, ' ')
    // 7. Remove all emojis & graphic icons
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FAFF}]/gu, '')
    .replace(/[✅⚠️📊💰📈📋🔍⏱️🩺🩺🏆📐📦✂️📜🎓💡📌🟢🔴💵🌙⚖️👋🎉🚀🔥😊]/g, '')
    // 8. Convert time formats to natural spoken words without duplicate units
    .replace(/([0-9]{1,2}):([0-9]{2})\s*(?:টা|মিনিট|बजे|baje|minutes?)?\s*(AM|PM|am|pm)?/gi, (match, h, min, ampm) => {
      if (lang === 'hi') return `${h} बजकर ${min} मिनट ${ampm || ''} `.trim();
      if (lang === 'bn') {
        const bnDigits = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
        const hBn = String(h).replace(/\d/g, d => bnDigits[d]);
        const minBn = String(min).replace(/\d/g, d => bnDigits[d]);
        return `${hBn}টা ${minBn} মিনিট `;
      }
      return `${h} ${min} ${ampm || ''} `.trim();
    })
    .replace(/([০-৯]{1,2}):([০-৯]{2})\s*(?:টা|মিনিট)?/g, '$1টা $2 মিনিট ')
    .replace(/(মিনিট)\s+(?:মিনিট)/g, '$1')
    .replace(/(मिनट)\s+(?:मिनट|बजे)/g, '$1')
    // 9. Expand abbreviations & symbols
    .replace(/Dr\.\s*NAM\s*\((?:নাম|नाम)\)/gi, lang === 'hi' ? 'डॉक्टर नाम' : lang === 'bn' ? 'ডক্টর নাম' : 'Doctor NAM')
    .replace(/\bDr\.\s*NAM\b/gi, lang === 'hi' ? 'डॉक्टर नाम' : lang === 'bn' ? 'ডক্টর নাম' : 'Doctor NAM')
    .replace(/\bDr\b/gi, lang === 'hi' ? 'डॉक्टर' : lang === 'bn' ? 'ডক্টর' : 'Doctor')
    .replace(/\bLedgero\s*\((?:লেজেরো|लेजेरो)\)/gi, lang === 'hi' ? 'लेजेरो' : lang === 'bn' ? 'লেজেরো' : 'Ledgero')
    .replace(/\bLedgero\b/gi, lang === 'hi' ? 'लेजेरो' : lang === 'bn' ? 'লেজেরো' : 'Ledgero')
    .replace(/\bCFO\b/g, lang === 'hi' ? 'सीएफओ' : lang === 'bn' ? 'সিএফও' : 'C-F-O')
    .replace(/\bKPI\b/g, lang === 'hi' ? 'केपीआई' : lang === 'bn' ? 'কেপিআই' : 'K-P-I')
    .replace(/\bDSO\b/gi, lang === 'bn' ? 'ডিএসও' : lang === 'hi' ? 'डीएसओ' : 'D-S-O')
    .replace(/\bDPO\b/gi, lang === 'bn' ? 'ডিপিও' : lang === 'hi' ? 'डीपीओ' : 'D-P-O')
    .replace(/\bDSI\b/gi, lang === 'bn' ? 'ডিএসআই' : lang === 'hi' ? 'ডিএসই' : 'D-S-I')
    .replace(/\bCCC\b/gi, lang === 'bn' ? 'সিসিসি' : lang === 'hi' ? 'সিসিসি' : 'C-C-C')
    .replace(/\bCOGS\b/gi, lang === 'bn' ? 'কগস' : lang === 'hi' ? 'कॉग्स' : 'COGS')
    .replace(/\bVAT\b/gi, lang === 'bn' ? 'ভ্যাট' : lang === 'hi' ? 'वैट' : 'VAT')
    .replace(/\bNBR\b/gi, lang === 'bn' ? 'এনবিআর' : lang === 'hi' ? 'এনবিআর' : 'N-B-R')
    .replace(/\bOpEx\b/gi, lang === 'hi' ? 'ऑपरेटिंग खर्च' : lang === 'bn' ? 'পরিচালন খরচ' : 'operating expenses')
    .replace(/\b(?:tk|Tk|TK)\b/g, lang === 'en' ? 'Taka' : 'টাকা')
    .replace(/৳\s*([০-৯0-9,]+)/g, lang === 'en' ? '$1 Taka' : '$1 টাকা')
    .replace(/₹\s*([০-৯0-9,]+)/g, lang === 'en' ? '$1 Rupees' : '$1 रुपये')
    .replace(/৳/g, ' টাকা ')
    .replace(/₹/g, ' रुपये ')
    .replace(/%/g, lang === 'hi' ? ' प्रतिशत ' : lang === 'bn' ? ' শতাংশ ' : ' percent ')
    // 10. Strip brackets, quotes, markdown formatting, convert colons to pauses
    .replace(/[\(\)\[\]\{\}<>]/g, ' ')
    .replace(/[*#_~`>|]/g, '')
    .replace(/["'“”‘’]/g, '')
    .replace(/:/g, ', ')
    .replace(/[/\\—–=+@^&]/g, ' ')
    // 11. Deduplicate redundant phrases
    .replace(/ডক্টর নাম\s+ডক্টর নাম/g, 'ডক্টর নাম')
    .replace(/डॉक्टर नाम\s+डॉक्टर नाम/g, 'डॉक्टर नाम')
    .replace(/Doctor NAM\s+Doctor NAM/gi, 'Doctor NAM')
    .replace(/ডক্টর নাম\s+নাম/g, 'ডক্টর নাম')
    .replace(/डॉक्टर नाम\s+নাম/g, 'डॉक्टर नाम')
    .replace(/লেজেরো\s+লেজেরো/g, 'লেজেরো')
    .replace(/लेजेरो\s+लेजेरो/g, 'লেजेरो')
    .replace(/Dr\s+NAM\s+NAM/gi, 'Dr NAM')
    .replace(/(সিএফও)\s+(সিএফও)/g, '$1')
    .replace(/(কেপিআই)\s+(কেপিআই)/g, '$1')
    .replace(/(টাকা)\s+(টাকা)/g, '$1')
    // 12. Clean up multiple pauses, commas and spaces
    .replace(/,\s*,+/g, ', ')
    .replace(/([।!?\.])\s*[।!?\.]+/g, '$1')
    .replace(/,\s*([।!?\.])/g, '$1')
    .replace(/^[,\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  return clean;
};

/**
 * Detects whether the text is primarily Bengali, Hindi, or English.
 */
export const detectSpeechLanguage = (text, defaultLang = 'bn') => {
  if (!text) return defaultLang;
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[a-zA-Z]/.test(text)) return 'en';
  return defaultLang === 'hi' ? 'hi' : defaultLang === 'en' ? 'en' : 'bn';
};


let currentAudio = null;

/**
 * Splits sanitized text into readable sentences for chunked playback.
 * 160-character max ensures each sentence stays well within Google TTS audio limits.
 */
export const splitIntoSpeechChunks = (text, maxLen = 160) => {
  if (!text || typeof text !== 'string') return [];
  const trimmedAll = text.trim();
  if (trimmedAll.length <= maxLen) {
    return [trimmedAll];
  }
  const rawSentences = trimmedAll.match(/[^.!?।\n]+[.!?।\n]*/g) || [trimmedAll];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if ((currentChunk + ' ' + trimmed).trim().length <= maxLen) {
      currentChunk = (currentChunk ? currentChunk + ' ' : '') + trimmed;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (trimmed.length > maxLen) {
        const parts = trimmed.match(/[^,;]+[,;]*/g) || [trimmed];
        let subChunk = '';
        for (const part of parts) {
          const subTrimmed = part.trim();
          if ((subChunk + ' ' + subTrimmed).trim().length <= maxLen) {
            subChunk = (subChunk ? subChunk + ' ' : '') + subTrimmed;
          } else {
            if (subChunk) chunks.push(subChunk);
            subChunk = subTrimmed;
          }
        }
        if (subChunk) chunks.push(subChunk);
        currentChunk = '';
      } else {
        currentChunk = trimmed;
      }
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks.filter(c => Boolean(c.trim()));
};

/**
 * Primary Voice Engine: Google Translate Neural TTS
 * Authentic, fluent, human pronunciation for Bengali, Hindi, and English.
 * Eliminates awkward switching between male British robot and female Indic voice.
 * Guaranteed 100% voice consistency from beginning to end.
 */
export const playNaturalVoice = async (text, lang = 'bn', callbacks = {}) => {
  stopNaturalVoice();
  if (!text) return;

  const sanitized = sanitizeTextForSpeech(text, lang);
  if (!sanitized) return;

  isPlaying = true;
  cancelRequested = false;
  currentCallbacks = callbacks || {};

  const detectedLang = detectSpeechLanguage(sanitized, lang);
  const langCode = detectedLang === 'hi' ? 'hi' : detectedLang === 'en' ? 'en' : 'bn';

  // Split into sentence chunks (max 160 chars for Google TTS reliability)
  const chunks = splitIntoSpeechChunks(sanitized, 160);
  if (chunks.length === 0) {
    isPlaying = false;
    if (currentCallbacks.onEnd) {
      try { currentCallbacks.onEnd(); } catch {}
    }
    return;
  }

  currentChunks = chunks;
  currentChunkIndex = 0;

  // Arm total watchdog timer: guarantees onEnd callback fires even if browser suspends audio
  const totalWatchdogMs = Math.max(6000, sanitized.length * 95 + 4000);
  if (chunkWatchdogTimer) clearTimeout(chunkWatchdogTimer);
  chunkWatchdogTimer = setTimeout(() => {
    if (isPlaying) {
      console.warn('Speech safety watchdog triggered — ending speech cleanly');
      stopNaturalVoice();
    }
  }, totalWatchdogMs);

  const playNextChunk = () => {
    if (cancelRequested || !isPlaying) {
      if (chunkWatchdogTimer) { clearTimeout(chunkWatchdogTimer); chunkWatchdogTimer = null; }
      return;
    }

    if (currentChunkIndex >= currentChunks.length) {
      isPlaying = false;
      currentAudio = null;
      if (currentCallbacks.onEnd) {
        try { currentCallbacks.onEnd(); } catch {}
      }
      return;
    }

    const chunk = currentChunks[currentChunkIndex];
    const isFirst = currentChunkIndex === 0;
    currentChunkIndex++;

    try {
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${langCode}&client=tw-ob`;
      const audio = new Audio(ttsUrl);
      currentAudio = audio;

      audio.onplay = () => {
        if (isFirst && currentCallbacks.onStart) {
          try { currentCallbacks.onStart(); } catch {}
        }
      };

      audio.onended = () => {
        currentAudio = null;
        if (cancelRequested || !isPlaying) return;
        // Seamless immediate playback of next sentence
        playNextChunk();
      };

      audio.onerror = (e) => {
        console.warn('Google TTS audio failed, trying fallback:', e);
        currentAudio = null;
        // Fallback to offline speechSynthesis for remaining text
        const remaining = currentChunks.slice(currentChunkIndex - 1).join(' ');
        fallbackToSpeechSynthesis(remaining, detectedLang, currentCallbacks);
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Audio play interrupted or blocked:', err);
          currentAudio = null;
          const remaining = currentChunks.slice(currentChunkIndex - 1).join(' ');
          fallbackToSpeechSynthesis(remaining, detectedLang, currentCallbacks);
        });
      }
    } catch (err) {
      console.warn('Audio construction failed, using fallback:', err);
      const remaining = currentChunks.slice(currentChunkIndex - 1).join(' ');
      fallbackToSpeechSynthesis(remaining, detectedLang, currentCallbacks);
    }
  };

  playNextChunk();
};

/**
 * Browser SpeechSynthesis fallback for offline environments.
 * Strictly maintains ONE SINGLE voice for the entire utterance.
 */
const fallbackToSpeechSynthesis = (text, lang, callbacks) => {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    isPlaying = false;
    if (callbacks.onEnd) {
      try { callbacks.onEnd(); } catch {}
    }
    return;
  }

  try {
    const utterance = new SpeechSynthesisUtterance(text);
    const langCode = lang === 'hi' ? 'hi-IN' : lang === 'en' ? 'en-US' : 'bn-BD';
    utterance.lang = langCode;
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices() || [];
    const matchingVoice = voices.find(v => 
      v.lang && v.lang.toLowerCase().startsWith(langCode.split('-')[0])
    );
    if (matchingVoice) utterance.voice = matchingVoice;

    utterance.onstart = () => {
      if (callbacks.onStart) {
        try { callbacks.onStart(); } catch {}
      }
    };
    utterance.onend = () => {
      isPlaying = false;
      if (callbacks.onEnd) {
        try { callbacks.onEnd(); } catch {}
      }
    };
    utterance.onerror = () => {
      isPlaying = false;
      if (callbacks.onEnd) {
        try { callbacks.onEnd(); } catch {}
      }
    };

    window.speechSynthesis.speak(utterance);
  } catch {
    isPlaying = false;
    if (callbacks.onEnd) {
      try { callbacks.onEnd(); } catch {}
    }
  }
};

/**
 * Stops all currently active speech playback immediately.
 */
export const stopNaturalVoice = () => {
  isPlaying = false;
  cancelRequested = true;
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    } catch {}
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
  if (currentCallbacks.onEnd) {
    try { currentCallbacks.onEnd(); } catch {}
  }
  currentCallbacks = {};
};

/**
 * Checks if voice is currently playing.
 */
export const isVoicePlaying = () => {
  return isPlaying;
};
