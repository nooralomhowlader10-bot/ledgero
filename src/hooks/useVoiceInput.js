// useVoiceInput.js — Web Speech API Hook for Voice Recognition (Bengali & English)
import { useState, useEffect, useRef, useCallback } from 'react';

// Common voice recognition corrections for Bengali accent & business domain
const postProcessVoice = (text) => {
  let t = text;

  // === FINANCIAL TERMS (most critical for accuracy) ===
  t = t.replace(/selling/gi, 'সেলিং');
  t = t.replace(/by cree/gi, 'বিক্রি');
  t = t.replace(/buy cree/gi, 'বিক্রি');
  t = t.replace(/big ri/gi, 'বিক্রি');
  t = t.replace(/bikri/gi, 'বিক্রি');
  t = t.replace(/core oche/gi, 'খরচ');
  t = t.replace(/kho?r[ou]?ch/gi, 'খরচ');
  t = t.replace(/ta ka/gi, 'টাকা');
  t = t.replace(/taka/gi, 'টাকা');
  t = t.replace(/teka/gi, 'টাকা');
  t = t.replace(/ba ki/gi, 'বাকি');
  t = t.replace(/baki/gi, 'বাকি');
  t = t.replace(/baqi/gi, 'বাকি');
  t = t.replace(/hi sab/gi, 'হিসাব');
  t = t.replace(/hishab/gi, 'হিসাব');
  t = t.replace(/hisab/gi, 'হিসাব');
  t = t.replace(/hi shab/gi, 'হিসাব');
  t = t.replace(/muna?fa/gi, 'মুনাফা');
  t = t.replace(/lab/gi, 'লাভ');
  t = t.replace(/laab/gi, 'লাভ');
  t = t.replace(/loss/gi, 'লস');
  t = t.replace(/profit/gi, 'প্রফিট');

  // === ACTION VERBS ===
  t = t.replace(/di lam/gi, 'দিলাম');
  t = t.replace(/dilam/gi, 'দিলাম');
  t = t.replace(/ni lam/gi, 'নিলাম');
  t = t.replace(/nilam/gi, 'নিলাম');
  t = t.replace(/kinlam/gi, 'কিনলাম');
  t = t.replace(/kin lam/gi, 'কিনলাম');
  t = t.replace(/bech lam/gi, 'বেচলাম');
  t = t.replace(/bechlam/gi, 'বেচলাম');
  t = t.replace(/kato/gi, 'কাটো');
  t = t.replace(/mucho/gi, 'মুছো');

  // === WALLET & PAYMENT ===
  t = t.replace(/bi ?ka?sh/gi, 'বিকাশ');
  t = t.replace(/no ?god/gi, 'নগদ');
  t = t.replace(/rocket/gi, 'রকেট');
  t = t.replace(/bank/gi, 'ব্যাংক');
  t = t.replace(/cash/gi, 'ক্যাশ');
  t = t.replace(/drawer/gi, 'ড্রয়ার');

  // === UNITS ===
  t = t.replace(/kg/gi, 'কেজি');
  t = t.replace(/kilo/gi, 'কেজি');
  t = t.replace(/ki lo/gi, 'কেজি');
  t = t.replace(/ke gi/gi, 'কেজি');
  t = t.replace(/liter/gi, 'লিটার');
  t = t.replace(/li tar/gi, 'লিটার');
  t = t.replace(/piece/gi, 'পিস');
  t = t.replace(/dozen/gi, 'ডজন');
  t = t.replace(/packet/gi, 'প্যাকেট');
  t = t.replace(/carton/gi, 'কার্টুন');

  // === PRODUCT TERMS ===
  t = t.replace(/re ?stock/gi, 'রিস্টক');
  t = t.replace(/stock/gi, 'স্টক');
  t = t.replace(/product/gi, 'প্রোডাক্ট');
  t = t.replace(/pro ?dact/gi, 'প্রোডাক্ট');
  t = t.replace(/item/gi, 'আইটেম');
  t = t.replace(/damage/gi, 'ড্যামেজ');
  t = t.replace(/expired/gi, 'মেয়াদ শেষ');

  // === BUSINESS TERMS ===
  t = t.replace(/cus ?to ?mer/gi, 'কাস্টমার');
  t = t.replace(/sup ?pli ?er/gi, 'সাপ্লায়ার');
  t = t.replace(/salary/gi, 'বেতন');
  t = t.replace(/sal ?ary/gi, 'বেতন');
  t = t.replace(/recharge/gi, 'রিচার্জ');
  t = t.replace(/flexiload/gi, 'ফ্লেক্সিলোড');
  t = t.replace(/transfer/gi, 'ট্রান্সফার');
  t = t.replace(/service/gi, 'সার্ভিস');
  t = t.replace(/photo ?copy/gi, 'ফটোকপি');

  // === COMMANDS ===
  t = t.replace(/open/gi, 'ওপেন');
  t = t.replace(/close/gi, 'ক্লোজ');
  t = t.replace(/undo/gi, 'কাটো');
  t = t.replace(/add/gi, 'যোগ');

  // === GREETINGS ===
  t = t.replace(/salon/gi, 'সালাম');
  t = t.replace(/assalamu/gi, 'আসসালামু');
  t = t.replace(/nam kee/gi, 'নাম কি');

  // === HINDI CORRECTIONS ===
  t = t.replace(/could knee/gi, 'कितनी');
  t = t.replace(/key tone/gi, 'कितना');
  t = t.replace(/car chase/gi, 'खर्चा');
  t = t.replace(/mood alpha/gi, 'मुनाफा');
  t = t.replace(/his ab/gi, 'हिसाब');
  t = t.replace(/naam us stay/gi, 'नमस्ते');

  return t;
};


export const useVoiceInput = ({ 
  lang = 'bn', 
  pauseSilenceMs = 2500, 
  idleTimeoutMs = 60000,
  onTranscriptChange, 
  onFinalResult,
  onIdleTimeout
} = {}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const idleTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const latestTranscriptRef = useRef('');
  const activeSessionRef = useRef(false);

  const speechLang = lang === 'en' ? 'en-US' : lang === 'hi' ? 'hi-IN' : 'bn-BD';
  const isSupported = typeof window !== 'undefined' && 
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback((sendPending = true) => {
    clearTimers();
    
    if (sendPending && activeSessionRef.current) {
      const pendingText = latestTranscriptRef.current.trim();
      if (pendingText) {
        latestTranscriptRef.current = '';
        if (onFinalResult) onFinalResult(pendingText);
      }
    }

    activeSessionRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn('Speech stop error:', err);
      }
    }
    setIsListening(false);
  }, [clearTimers, onFinalResult]);

  const startListening = useCallback(() => {
    clearTimers();
    setError(null);
    setTranscript('');
    latestTranscriptRef.current = '';

    if (!isSupported) {
      setError(lang === 'en' ? 'Voice recognition not supported in this browser' : 'এই ব্রাউজারে ভয়েস রিকগনিশন সুবিধা নেই');
      return;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      // Keep continuous listening open so user can pause and think mid-sentence
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLang;
      recognition.maxAlternatives = 5;

      recognition.onstart = () => {
        activeSessionRef.current = true;
        setIsListening(true);
        // Idle timeout: if user opens mic and says nothing within idleTimeoutMs (60s), automatically stop
        idleTimerRef.current = setTimeout(() => {
          if (activeSessionRef.current && !latestTranscriptRef.current.trim()) {
            stopListening(false);
            if (onIdleTimeout) onIdleTimeout();
          }
        }, idleTimeoutMs);
      };

      recognition.onresult = (event) => {
        // Any speech received: clear initial idle timeout and re-arm
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        idleTimerRef.current = setTimeout(() => {
          if (activeSessionRef.current && !latestTranscriptRef.current.trim()) {
            stopListening(false);
            if (onIdleTimeout) onIdleTimeout();
          }
        }, idleTimeoutMs);

        // Accumulate complete utterance across all fragments
        let fullTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          const item = event.results[i];
          let bestAlt = item[0];
          for (let a = 1; a < item.length; a++) {
            if (item[a].confidence > bestAlt.confidence) {
              bestAlt = item[a];
            }
          }
          if (bestAlt && bestAlt.transcript) {
            fullTranscript += (fullTranscript ? ' ' : '') + bestAlt.transcript.trim();
          }
        }

        fullTranscript = postProcessVoice(fullTranscript.replace(/\s+/g, ' ').trim());

        if (fullTranscript) {
          latestTranscriptRef.current = fullTranscript;
          setTranscript(fullTranscript);
          if (onTranscriptChange) onTranscriptChange(fullTranscript);
        }

        // Reset silence debounce timer on every new speech fragment
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        // Wait for 2.5 seconds of unbroken silence before auto-submitting
        silenceTimerRef.current = setTimeout(() => {
          const textToSubmit = latestTranscriptRef.current.trim();
          if (textToSubmit && activeSessionRef.current) {
            latestTranscriptRef.current = '';
            activeSessionRef.current = false;
            if (onFinalResult) onFinalResult(textToSubmit);
            stopListening(false);
          }
        }, pauseSilenceMs);
      };

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
          setError(event.error);
        }
        clearTimers();
        activeSessionRef.current = false;
        setIsListening(false);
      };

      recognition.onend = () => {
        clearTimers();
        // If recognition ended naturally and we have pending text that wasn't finalized yet, finalize it
        if (activeSessionRef.current) {
          const pending = latestTranscriptRef.current.trim();
          if (pending) {
            latestTranscriptRef.current = '';
            if (onFinalResult) onFinalResult(pending);
          }
        }
        activeSessionRef.current = false;
        setIsListening(false);
      };

      recognition.start();
    } catch (err) {
      console.warn('Speech recognition start failed or transitional:', err);
      // Auto-retry once if browser was in transitional state (e.g. InvalidStateError)
      if (err.name === 'InvalidStateError' || (err.message && err.message.includes('already started'))) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          startListening();
        }, 300);
        return;
      }
      setError(err.message || 'Speech failed to start');
      clearTimers();
      activeSessionRef.current = false;
      setIsListening(false);
    }
  }, [clearTimers, isSupported, speechLang, lang, pauseSilenceMs, idleTimeoutMs, onTranscriptChange, onFinalResult, onIdleTimeout, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      // User tapped mic button to stop — immediately submit what they said
      stopListening(true);
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const resetTranscript = useCallback(() => {
    clearTimers();
    latestTranscriptRef.current = '';
    setTranscript('');
    setError(null);
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [clearTimers]);

  return {
    isListening,
    transcript,
    error,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
    resetTranscript
  };
};
