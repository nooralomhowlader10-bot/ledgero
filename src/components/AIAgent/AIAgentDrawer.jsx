// AIAgentDrawer.jsx — Intelligent Conversational AI Financial Assistant Drawer
import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Sparkles, 
  X, 
  Send, 
  Mic, 
  MicOff, 
  Key, 
  Trash2, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  Volume2,
  VolumeX,
  Settings,
  Globe,
  Zap,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { 
  extractFinancialContext, 
  processLocalAIQuery, 
  askGeminiAI, 
  getSavedGeminiKey, 
  saveGeminiKey,
  getPoolSize,
  correctVoiceTranscript
} from '../../services/aiAgentService';
import { playNaturalVoice, stopNaturalVoice } from '../../services/naturalVoiceService';
import { extractEntities } from '../../services/voiceEntityExtractor';
import { enrichResponse, generateFollowUp, getCrossLink } from '../../services/voiceFollowUp';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { formatBDT } from '../../data/calculations';
import { SCREENS } from '../../data/constants';

export default function AIAgentDrawer({ isOpen, onClose, state, dispatch, lang = 'bn' }) {
  // Internal language override — chatLang can be 'bn', 'hi', or 'en'
  const [chatLang, setChatLang] = useState(() => {
    try { return localStorage.getItem('nam_ai_lang') || lang; } catch { return lang; }
  });
  const [advancedMode, setAdvancedMode] = useState(() => {
    try { return localStorage.getItem('nam_ai_advanced') === 'true'; } catch { return false; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const isEn = chatLang === 'en';

  // Synchronize internal chatLang with parent app lang
  useEffect(() => {
    if (lang && (lang === 'bn' || lang === 'en') && lang !== chatLang) {
      setChatLang(lang);
      try { localStorage.setItem('nam_ai_lang', lang); } catch {}
    }
  }, [lang]);
  const isHi = chatLang === 'hi';
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // States
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'ai',
      text: chatLang === 'en'
        ? "Hello! I'm Dr. NAM — your PhD-level Chief Financial Officer & AI Business Growth Partner. Ask me anything from live sales, cash drawer audits, and WhatsApp due reminders, to 14-KPI financial health diagnostics, DuPont models, working capital optimization, and business scaling playbooks."
        : chatLang === 'hi'
        ? "नमस्ते! मैं Dr. NAM (नाम) — आपका PhD-स्तरीय चीफ फाइनेंशियल ऑफिसर (CFO) और AI बिज़नेस ग्रोथ पार्टनर। लाइव बिक्री, कैश ऑडिट, बकाया रिमाइंडर से लेकर 14 KPI हेल्थ स्कोर, ब्रेक-ईवन एनालिसिस और बिज़नेस स्केलिंग — कुछ भी पूछें।"
        : "আসসালামু আলাইকুম! আমি ডক্টর NAM (নাম) — আপনার পিএইচডি-লেভেল চিফ ফাইন্যান্সিয়াল অফিসার (CFO) ও এআই বিজনেস গ্রোথ পার্টনার। লাইভ বিক্রি, ক্যাশ অডিট ও বাকি রিমাইন্ডার থেকে শুরু করে ১৪টি কেপিআই হেলথ স্কোর, ব্রেক-ইভেন অ্যানালাইসিস, চলতি মূলধন চক্র ও ব্যবসা স্কেলিং কৌশল—যেকোনো প্রশ্ন বাংলায় করুন।",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [executedActions, setExecutedActions] = useState({});

  const [speechEnabled, setSpeechEnabled] = useState(() => {
    try { return localStorage.getItem('nam_ai_speech') === 'true'; } catch { return false; }
  });
  const [continuousMode, setContinuousMode] = useState(() => {
    try { return localStorage.getItem('nam_ai_continuous') === 'true'; } catch { return false; }
  });
  const [feedback, setFeedback] = useState({});
  const [isFloating, setIsFloating] = useState(() => {
    try { return localStorage.getItem('nam_ai_view_mode') === 'floating'; } catch { return false; }
  });

  const toggleViewMode = () => {
    const next = !isFloating;
    setIsFloating(next);
    try { localStorage.setItem('nam_ai_view_mode', next ? 'floating' : 'drawer'); } catch {}
  };

  const continuousModeRef = useRef(continuousMode);
  continuousModeRef.current = continuousMode;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const speechEnabledRef = useRef(speechEnabled);
  speechEnabledRef.current = speechEnabled;

  // --- Undo Stack: stores last 5 executed actions for voice correction ---
  const lastActionStackRef = useRef([]);
  // --- Pending confirmation for Hands-Free complex actions ---
  const pendingConfirmationRef = useRef(null);

  const handleFeedback = (msgId, type) => {
    setFeedback(prev => ({ ...prev, [msgId]: type }));
  };

  // --- Voice Speaker (ResponsiveVoice primary — proven working) ---
  const speakText = (text, onEnd, overrideLang = null) => {
    if (!speechEnabledRef.current) {
      if (onEnd) onEnd();
      return;
    }
    playNaturalVoice(text, overrideLang || chatLang, {
      onEnd: () => {
        if (onEnd) onEnd();
      }
    });
  };

  // Stop voice playback when drawer closes or unmounts
  useEffect(() => {
    if (!isOpen) {
      stopNaturalVoice();
      stopListening();
    }
    return () => {
      stopNaturalVoice();
      stopListening();
    };
  }, [isOpen]);

  // Voice Input Hook (with 2.5s Pause Tolerance, Silence Debouncing & 60s Inactivity Auto-Shutoff)
  const { isListening, transcript, error: voiceError, startListening, stopListening, isSupported: voiceSupported } = useVoiceInput({
    lang: chatLang,
    pauseSilenceMs: 2500,
    idleTimeoutMs: 60000,
    onIdleTimeout: () => {
      // 60-second inactivity timeout: automatically shut off hands-free mode to prevent eavesdropping
      if (continuousModeRef.current) {
        setContinuousMode(false);
        try { localStorage.setItem('nam_ai_continuous', 'false'); } catch {}
        const idleNotice = chatLang === 'en'
          ? '⏱️ Hands-Free mode turned off automatically after 1 minute of inactivity. Tap the ⚡ button below to resume.'
          : chatLang === 'hi'
          ? '⏱️ 1 मिनट तक कोई आवाज़ न आने पर हैंड्स-फ्री मोड बंद कर दिया गया। पुनः शुरू करने के लिए ⚡ बटन दबाएं।'
          : '⏱️ ১ মিনিট কোনো কথা না থাকায় হ্যান্ডস-ফ্রি মোড বন্ধ করা হয়েছে। পুনরায় চালু করতে নিচে ⚡ বাটনে চাপুন।';
        setMessages(prev => [
          ...prev,
          {
            id: `sys_${Date.now()}`,
            sender: 'ai',
            text: idleNotice,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    },
    onFinalResult: (speechText) => {
      if (!speechText || !speechText.trim()) return;
      const clean = speechText.trim().toLowerCase();

      // Check for voice stop command
      const stopCommands = [
        'stop', 'stop nam', 'thamo', 'thamun', 'bondho', 'bondho koro', 'bye', 'goodbye', 
        'থামো', 'থামুন', 'স্টপ', 'বন্ধ করো', 'বন্ধ করুন', 'বিদায়', 'বিদায়',
        'रुको', 'रुकिए', 'बंद करो', 'अलविदा', 'बस'
      ];
      const isStop = stopCommands.some(cmd => clean === cmd || clean.startsWith(cmd + ' '));

      if (isStop && continuousModeRef.current) {
        setContinuousMode(false);
        try { localStorage.setItem('nam_ai_continuous', 'false'); } catch {}
        stopListening(false);
        const stopReply = chatLang === 'en'
          ? 'Hands-free voice conversation stopped. Tap the mic whenever you want to talk.'
          : chatLang === 'hi'
          ? 'हैंड्स-फ्री बातचीत रोक दी गई है। जब भी जरूरत हो, माइक दबाएं।'
          : 'হ্যান্ডস-ফ্রি মোড বন্ধ করা হলো। প্রয়োজনে আবার কথা বলতে মাইক বাটনে চাপুন।';
        setMessages(prev => [
          ...prev,
          {
            id: `sys_${Date.now()}`,
            sender: 'ai',
            text: stopReply,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        playNaturalVoice(stopReply, chatLang);
        return;
      }

      handleSendMessage(speechText);
    }
  });

  const toggleContinuousMode = () => {
    const next = !continuousMode;
    setContinuousMode(next);
    try { localStorage.setItem('nam_ai_continuous', String(next)); } catch {}
    
    if (next) {
      if (!speechEnabled) {
        setSpeechEnabled(true);
        try { localStorage.setItem('nam_ai_speech', 'true'); } catch {}
      }
      startListening();
    } else {
      stopListening(false);
      stopNaturalVoice();
    }
  };

  // Load saved Gemini API Key
  useEffect(() => {
    const saved = getSavedGeminiKey();
    if (saved) {
      setApiKey(saved);
      setTempApiKey(saved);
    }
  }, []);

  // Update input value when interim speech transcript changes
  useEffect(() => {
    if (isListening && transcript) {
      setInputValue(transcript);
    }
  }, [isListening, transcript]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [messages, isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 200);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle saving API key
  const handleSaveKey = () => {
    saveGeminiKey(tempApiKey);
    setApiKey(tempApiKey);
    setShowKeyConfig(false);
  };

  // Handle removing API key
  const handleRemoveKey = () => {
    saveGeminiKey('');
    setApiKey('');
    setTempApiKey('');
    setShowKeyConfig(false);
  };

  // --- Active Field & Typing Context Detector (for "আমি কি লিখছি / কি করতেছি") ---
  const getActiveInputContext = () => {
    if (typeof document === 'undefined') return null;
    try {
      const drawerEl = document.querySelector('[role="dialog"]');
      const active = document.activeElement;

      // 1. Check if the currently focused element is an input outside the AI drawer
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        if (!drawerEl || !drawerEl.contains(active)) {
          const val = (active.value || '').trim();
          let label = '';
          if (active.id) {
            const lEl = document.querySelector(`label[for="${active.id}"]`);
            if (lEl) label = lEl.textContent.trim();
          }
          if (!label) {
            const parentDiv = active.closest('div');
            const lEl = parentDiv?.querySelector('label') || parentDiv?.parentElement?.querySelector('label');
            if (lEl) label = lEl.textContent.trim();
          }
          label = label.replace(/\s*\*\s*$/, '').trim();
          return {
            fieldLabel: label || active.placeholder || active.name || 'ইনপুট ফিল্ড',
            fieldValue: val,
            isFocused: true
          };
        }
      }

      // 2. If focus is inside drawer, scan for any non-empty input/textarea outside drawer
      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea'))
        .filter(el => !drawerEl || !drawerEl.contains(el));

      const filled = inputs.filter(el => (el.value || '').trim().length > 0);
      if (filled.length > 0) {
        const target = filled[filled.length - 1];
        let label = '';
        if (target.id) {
          const lEl = document.querySelector(`label[for="${target.id}"]`);
          if (lEl) label = lEl.textContent.trim();
        }
        if (!label) {
          const parentDiv = target.closest('div');
          const lEl = parentDiv?.querySelector('label') || parentDiv?.parentElement?.querySelector('label');
          if (lEl) label = lEl.textContent.trim();
        }
        label = label.replace(/\s*\*\s*$/, '').trim();
        return {
          fieldLabel: label || target.placeholder || target.name || 'ইনপুট ফিল্ড',
          fieldValue: target.value.trim(),
          isFocused: false
        };
      }

      return null;
    } catch (e) {
      return null;
    }
  };

  // Process & Send message
  const handleSendMessage = async (customText = null) => {
    const query = (customText || inputValue).trim();
    if (!query || isLoading) return;

    // Add user message
    const userMsg = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      // 1. Extract fresh financial context with live active input
      const activeInput = getActiveInputContext();
      const context = extractFinancialContext(state, activeInput);
      // Find the last assistant message for contextual translation & continuity
      const lastAiMessage = [...messages].reverse().find(m => m.sender === 'ai')?.text || '';
      context.lastAssistantMessage = lastAiMessage;

      let responseData = null;

      // 2. Smart Voice Correction (Phase 3: Gemini corrects Web Speech API errors)
      const inventoryList = state?.dayData?.inventory || [];
      const contactsList = state?.contacts || [];
      let correctedQuery = query;
      try {
        correctedQuery = await correctVoiceTranscript(query, {
          productNames: inventoryList.map(p => p.name).filter(Boolean),
          contactNames: contactsList.map(c => c.name).filter(Boolean)
        });
      } catch { /* use original query on error */ }

      // 2a. Extract structured entities from voice (fuzzy product/contact/wallet/amount matching)
      const voiceEntities = extractEntities(correctedQuery, {
        inventory: inventoryList,
        contacts: contactsList,
        wallets: state?.dayData?.wallets || {}
      });

      // 2b. Parse query with local intent engine
      const localIntent = processLocalAIQuery(correctedQuery, context, chatLang, voiceEntities);
      const ALL_DRAFT_TYPES = [
        'EXPENSE_DRAFT', 'SALE_DRAFT', 'DUE_GIVE_DRAFT', 'DUE_COLLECT_DRAFT', 
        'WHATSAPP_REMINDER', 'NAVIGATE',
        'PRODUCT_ADD_DRAFT', 'STOCK_SELL_DRAFT', 'STOCK_RESTOCK_DRAFT',
        'CONTACT_ADD_DRAFT', 'FUND_TRANSFER_DRAFT', 'OWNER_DRAW_DRAFT', 'OWNER_INJECT_DRAFT',
        'DAMAGE_DRAFT', 'SALARY_DRAFT', 'RECHARGE_DRAFT', 'SERVICE_INCOME_DRAFT',
        'CREDIT_SALE_DRAFT', 'DAY_OPEN_DRAFT', 'DAY_CLOSE_DRAFT', 'UNDO_LAST'
      ];
      const isDraftAction = Boolean(
        localIntent.actionCard && ALL_DRAFT_TYPES.includes(localIntent.actionCard.type)
      );

      // If user commanded a language switch / translation, synchronize drawer language
      if (localIntent.isTranslation && localIntent.targetLang) {
        setChatLang(localIntent.targetLang);
        try { localStorage.setItem('nam_ai_lang', localIntent.targetLang); } catch {}
      }

      const activeLangForQuery = localIntent.targetLang || chatLang;
      const hasGemini = Boolean(apiKey || getPoolSize() > 0);

      // Fast path: If query is an instant intent (greeting, how-are-you, time, date, weather, chit-chat, draft action)
      // or if offline without Gemini key, respond IMMEDIATELY (0ms latency, zero delay)
      if (localIntent.isInstantIntent || isDraftAction || !hasGemini) {
        responseData = localIntent;
      } else {
        // Deep Financial AI reasoning with Gemini (with 6s AbortController timeout & fast lite models)
        try {
          const recentHistory = messages.slice(-6).map(m => ({
            sender: m.sender,
            text: m.text
          }));
          responseData = await askGeminiAI({
            query,
            processedQuery: localIntent.processedQuery,
            history: recentHistory,
            context,
            apiKey: apiKey || 'pool',
            lang: activeLangForQuery
          });
          // Attach any actionCard or targetLang from local parser
          if (localIntent.actionCard) {
            responseData.actionCard = localIntent.actionCard;
          }
          if (localIntent.targetLang) {
            responseData.targetLang = localIntent.targetLang;
          }
        } catch (geminiErr) {
          console.warn('Gemini API call failed or timed out, falling back to local NLP core:', geminiErr);
          responseData = localIntent;
        }
      }

      // Enrich response with proactive follow-up and cross-link hints
      if (responseData.actionCard && responseData.reply) {
        const actionType = responseData.actionCard.type?.replace('_DRAFT', '')?.toLowerCase() || '';
        responseData.reply = enrichResponse(
          responseData.reply, actionType, context, 
          { ...responseData.actionCard, ...voiceEntities }, chatLang
        );
      }

      // Add AI reply message
      const aiMsg = {
        id: `ai_${Date.now()}`,
        sender: 'ai',
        text: responseData.reply,
        actionCard: responseData.actionCard,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, aiMsg]);

      // Auto-execute action in Hands-Free Continuous Mode
      if (continuousModeRef.current && responseData.actionCard) {
        setTimeout(() => {
          handleExecuteAction(responseData.actionCard, aiMsg.id);
        }, 120);
      }

      // Auto-speak response in the appropriate language if speaker enabled
      const speakLanguage = responseData.targetLang || activeLangForQuery;
      speakText(responseData.reply, () => {
        // If Continuous Hands-Free mode is active, auto-reopen mic after Dr. NAM speaks
        if (continuousModeRef.current && isOpenRef.current) {
          setTimeout(() => {
            if (continuousModeRef.current && isOpenRef.current) {
              startListening();
            }
          }, 350);
        }
      }, speakLanguage);
    } catch (err) {
      console.error('AI Error:', err);
      setMessages(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'ai',
          text: isEn 
            ? "Sorry, an unexpected error occurred while processing your request. Please try again."
            : "দুঃখিত, হিসাব প্রসেস করতে একটি সমস্যা হয়েছে। দয়া করে আবার চেষ্টা করুন।",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Execute Action Card
  const handleExecuteAction = (action, msgId) => {
    if (!action || (msgId && executedActions[msgId])) return;

    if (action.type === 'EXPENSE_DRAFT') {
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'expense',
          amount: Number(action.amount),
          category: action.category || (isEn ? 'Entertainment & Snacks' : 'চা/নাস্তা ও আপ্যায়ন'),
          note: action.note || (isEn ? 'AI Entry' : 'AI এন্ট্রি'),
          sourceWalletId: 'hand_cash',
          timestamp: new Date().toISOString()
        }
      });
      const expTxId = `tx_${Date.now()}`;
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'EXPENSE', txId: expTxId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    } else if (action.type === 'SALE_DRAFT') {
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'cash_sale',
          amount: Number(action.amount),
          note: action.note || (isEn ? 'AI Cash Sale' : 'AI ক্যাশ বিক্রি'),
          targetWalletId: 'hand_cash',
          timestamp: new Date().toISOString()
        }
      });
      const saleTxId = `tx_${Date.now()}`;
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'SALE', txId: saleTxId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    } else if (action.type === 'DUE_GIVE_DRAFT') {
      const numAmount = Number(action.amount);
      let contactId = action.contactId;
      const targetName = (action.contactName || '').trim();

      // Find existing contact by name if ID was not supplied
      if (!contactId && targetName && state?.contacts) {
        const existing = state.contacts.find(c => c.name.toLowerCase().trim() === targetName.toLowerCase());
        if (existing) contactId = existing.id;
      }

      // Auto-create contact in Khata if not exists
      if (!contactId && targetName && targetName !== 'কাস্টমার' && targetName.toLowerCase() !== 'customer') {
        contactId = `contact_${Date.now()}`;
        dispatch({
          type: 'ADD_CONTACT',
          payload: {
            id: contactId,
            name: targetName,
            phone: '',
            type: 'customer',
            openingBalance: 0,
            currentBalance: 0,
            note: isEn ? 'Auto Created (NAM AI)' : 'স্বয়ংক্রিয় তৈরি (NAM AI)'
          }
        });
      }

      dispatch({
        type: 'RECORD_CONTACT_TX',
        payload: {
          contactId: contactId,
          contactName: targetName,
          txType: 'customer_due_given',
          amount: numAmount,
          note: action.note || (isEn ? `${targetName || 'Customer'} Due Extended` : `${targetName || 'কাস্টমার'} বাকি দেওয়া`)
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'DUE_GIVE', contactId, amount: numAmount, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    } else if (action.type === 'DUE_COLLECT_DRAFT') {
      const numAmount = Number(action.amount);
      let contactId = action.contactId;
      const targetName = (action.contactName || '').trim();

      if (!contactId && targetName && state?.contacts) {
        const existing = state.contacts.find(c => c.name.toLowerCase().trim() === targetName.toLowerCase());
        if (existing) contactId = existing.id;
      }

      if (!contactId && targetName && targetName !== 'কাস্টমার') {
        contactId = `contact_${Date.now()}`;
        dispatch({
          type: 'ADD_CONTACT',
          payload: {
            id: contactId,
            name: targetName,
            phone: '',
            type: 'customer',
            openingBalance: 0,
            currentBalance: 0,
            note: isEn ? 'Auto-created (NAM AI)' : 'স্বয়ংক্রিয় তৈরি (NAM AI)'
          }
        });
      }

      dispatch({
        type: 'RECORD_CONTACT_TX',
        payload: {
          contactId: contactId,
          contactName: targetName,
          txType: 'customer_paid',
          amount: numAmount,
          note: action.note || (isEn ? `${targetName || 'Customer'} Due Collected` : `${targetName || 'কাস্টমার'} বাকি আদায়`)
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'DUE_COLLECT', contactId, amount: numAmount, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    } else if (action.type === 'WHATSAPP_REMINDER') {
      if (action.url) {
        window.open(action.url, '_blank');
      }
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    } else if (action.type === 'NAVIGATE') {
      if (action.screen) {
        dispatch({ type: 'SET_SCREEN', payload: action.screen });
        if (!isFloating) {
          onClose();
        }
      }
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // ============ NEW ACTION HANDLERS (15 new types) ============

    // Product Add
    else if (action.type === 'PRODUCT_ADD_DRAFT') {
      const txId = `prod_${Date.now()}`;
      dispatch({
        type: 'ADD_INVENTORY_ITEM',
        payload: {
          id: txId,
          name: action.name || action.productName || (isEn ? 'New Product' : 'নতুন পণ্য'),
          unit: action.unit || 'piece',
          buyPrice: Number(action.buyPrice) || 0,
          sellPrice: Number(action.sellPrice) || 0,
          openingStock: Number(action.openingStock || action.quantity) || 0
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'PRODUCT_ADD', itemId: txId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Stock Sell (specific product by name)
    else if (action.type === 'STOCK_SELL_DRAFT') {
      const txId = `sell_${Date.now()}`;
      dispatch({
        type: 'QUICK_SELL_STOCK',
        payload: {
          itemId: action.itemId,
          quantity: Number(action.quantity) || 1
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'STOCK_SELL', txId, itemId: action.itemId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Stock Restock / Purchase
    else if (action.type === 'STOCK_RESTOCK_DRAFT') {
      const txId = `restock_${Date.now()}`;
      dispatch({
        type: 'QUICK_RESTOCK',
        payload: {
          itemId: action.itemId,
          quantity: Number(action.quantity) || 1,
          sourceWallet: action.sourceWallet || 'hand_cash',
          unitCost: Number(action.unitCost || action.buyPrice) || undefined
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'STOCK_RESTOCK', txId, itemId: action.itemId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Contact Add
    else if (action.type === 'CONTACT_ADD_DRAFT') {
      const contactId = `contact_${Date.now()}`;
      dispatch({
        type: 'ADD_CONTACT',
        payload: {
          id: contactId,
          name: action.contactName || action.name || (isEn ? 'New Customer' : 'নতুন কাস্টমার'),
          phone: action.phone || '',
          type: action.contactType || 'customer',
          openingBalance: Number(action.openingBalance) || 0,
          note: action.note || ''
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'CONTACT_ADD', contactId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Fund Transfer
    else if (action.type === 'FUND_TRANSFER_DRAFT') {
      const txId = `tx_${Date.now()}`;
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'fund_transfer',
          amount: Number(action.amount),
          fromWallet: action.fromWallet || 'hand_cash',
          toWallet: action.toWallet || 'bkash_agent',
          note: action.note || (isEn ? 'Fund Transfer' : 'ফান্ড ট্রান্সফার')
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'FUND_TRANSFER', txId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Owner Draw (took money out)
    else if (action.type === 'OWNER_DRAW_DRAFT') {
      const txId = `tx_${Date.now()}`;
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'owner_took',
          amount: Number(action.amount),
          note: action.note || (isEn ? 'Owner Took (Draw)' : 'মালিক নিলেন')
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'OWNER_DRAW', txId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Owner Inject (put money in)
    else if (action.type === 'OWNER_INJECT_DRAFT') {
      const txId = `tx_${Date.now()}`;
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'owner_gave',
          amount: Number(action.amount),
          note: action.note || (isEn ? 'Owner Gave (Deposit)' : 'মালিক দিলেন')
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'OWNER_INJECT', txId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Damage / Write-off
    else if (action.type === 'DAMAGE_DRAFT') {
      dispatch({
        type: 'WRITE_OFF_DAMAGE',
        payload: {
          itemId: action.itemId,
          quantity: Number(action.quantity) || 1,
          reason: action.reason || 'damage',
          note: action.note || (isEn ? 'Inventory Damage / Loss' : 'ক্ষতি/নষ্ট')
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'DAMAGE', itemId: action.itemId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Salary Payment
    else if (action.type === 'SALARY_DRAFT') {
      dispatch({
        type: 'RECORD_SALARY_PAYMENT',
        payload: {
          employeeName: action.employeeName || action.contactName || (isEn ? 'Staff Member' : 'কর্মচারী'),
          month: new Date().toISOString().slice(0, 7),
          netPaid: Number(action.amount),
          wallet: action.wallet || 'hand_cash'
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'SALARY', timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Mobile Recharge
    else if (action.type === 'RECHARGE_DRAFT') {
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'recharge',
          amount: Number(action.amount),
          note: action.note || (isEn ? 'Mobile Recharge' : 'মোবাইল রিচার্জ')
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'RECHARGE', timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Service Income (Photocopy/Studio)
    else if (action.type === 'SERVICE_INCOME_DRAFT') {
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'service_income',
          amount: Number(action.amount),
          serviceType: action.serviceType || 'photocopy',
          note: action.note || (isEn ? 'Service Income' : 'সার্ভিস আয়')
        }
      });
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'SERVICE_INCOME', timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Credit Sale (product sold on credit)
    else if (action.type === 'CREDIT_SALE_DRAFT') {
      let contactId = action.contactId;
      const targetName = (action.contactName || '').trim();

      if (!contactId && targetName && state?.contacts) {
        const existing = state.contacts.find(c => c.name.toLowerCase().trim() === targetName.toLowerCase());
        if (existing) contactId = existing.id;
      }

      if (!contactId && targetName && targetName !== 'কাস্টমার') {
        contactId = `contact_${Date.now()}`;
        dispatch({
          type: 'ADD_CONTACT',
          payload: {
            id: contactId,
            name: targetName,
            phone: '',
            type: 'customer',
            openingBalance: 0,
            currentBalance: 0,
            note: 'স্বয়ংক্রিয় তৈরি (NAM AI)'
          }
        });
      }

      dispatch({
        type: 'RECORD_CONTACT_TX',
        payload: {
          contactId: contactId,
          contactName: targetName,
          txType: 'customer_due_given',
          amount: Number(action.amount),
          note: action.note || (isEn ? `${action.itemName || 'Item'} credit sale` : `${action.itemName || 'পণ্য'} বাকিতে বিক্রি`)
        }
      });

      if (action.itemId) {
        dispatch({
          type: 'QUICK_SELL_STOCK',
          payload: {
            itemId: action.itemId,
            quantity: Number(action.quantity) || 1
          }
        });
      }
      lastActionStackRef.current = [...lastActionStackRef.current.slice(-4), { type: 'CREDIT_SALE', contactId: contactId, timestamp: Date.now() }];
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Open Day
    else if (action.type === 'DAY_OPEN_DRAFT') {
      dispatch({ type: 'OPEN_DAY' });
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Close / Finalize Day
    else if (action.type === 'DAY_CLOSE_DRAFT') {
      dispatch({ type: 'FINALIZE_DAY', payload: {} });
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }

    // Undo Last Action
    else if (action.type === 'UNDO_LAST') {
      const stack = lastActionStackRef.current;
      if (stack.length > 0) {
        const lastAction = stack[stack.length - 1];
        if (lastAction.txId) {
          dispatch({ type: 'DELETE_TRANSACTION', payload: lastAction.txId });
        } else if (lastAction.itemId && lastAction.type === 'PRODUCT_ADD') {
          dispatch({ type: 'REMOVE_INVENTORY_ITEM', payload: lastAction.itemId });
        } else if (lastAction.contactId) {
          dispatch({ type: 'DELETE_CONTACT', payload: lastAction.contactId });
        }
        lastActionStackRef.current = stack.slice(0, -1);
      }
      if (msgId) setExecutedActions(prev => ({ ...prev, [msgId]: true }));
    }
  };

  // Quick prompt suggestions (PhD-level CFO & Daily Operations)
  const quickPrompts = [
    { label: isEn ? "🚀 Growth Playbook" : isHi ? '🚀 ग्रोथ प्लेबुक' : '🚀 ব্যবসার গ্রোথ', query: isEn ? "How can I grow and scale my business?" : isHi ? 'दुकान का बिज़नेस कैसे बढ़ाएं?' : 'দোকানের বিক্রি ও গ্রোথ বাড়ানোর উপায় কী?' },
    { label: isEn ? "🩺 Store Health" : isHi ? '🩺 हेल्थ स्कोर' : '🩺 দোকানের আর্থিক স্বাস্থ্য', query: isEn ? "Analyze my financial health and 14 KPIs" : isHi ? 'दुकान का फाइनेंशियल हेल्थ स्कोर बताओ' : 'দোকানের আর্থিক স্বাস্থ্য ও ১৪টি KPI বিশ্লেষণ করো' },
    { label: isEn ? "⏱️ Cash Runway" : isHi ? '⏱️ कैश रनवे' : '⏱️ ক্যাশ রানওয়ে ও ব্রেক-ইভেন', query: isEn ? "What is my cash runway and break-even point?" : isHi ? 'दुकान का कैश रनवे और ब्रेक-ईवन कितना है?' : 'দোকানের ক্যাশ রানওয়ে ও ব্রেক-ইভেন কত?' },
    { label: isEn ? "📈 Margin Strategy" : isHi ? '📈 मार्जिन रणनीति' : '📈 মার্জিন ও মুনাফা বৃদ্ধি', query: isEn ? "How to optimize profit margins vs markups?" : isHi ? 'मार्जिन और मुनाफा कैसे बढ़ाएं?' : 'মার্জিন ও মুনাফা কিভাবে বাড়াবো?' },
    { label: isEn ? "⚖️ Working Capital" : isHi ? '⚖️ वर्किंग कैपिटल' : '⚖️ চলতি মূলধন ও বাকি আদায়', query: isEn ? "Analyze working capital and debtor collection days" : isHi ? 'वर्किंग कैपिटल और DSO एनालिसिस करो' : 'চলতি মূলধন ও বাকি আদায়ের মেয়াদ বিশ্লেষণ করো' },
    { label: isEn ? "📜 VAT & Tax" : isHi ? '📜 VAT और टैक्स' : '📜 ভ্যাট ও ট্যাক্স', query: isEn ? "Explain Bangladesh VAT and Tax regulations" : isHi ? 'बांग्लादेश में VAT और टैक्स के नियम बताओ' : 'বাংলাদেশে ব্যবসার ভ্যাট ও ট্যাক্সের নিয়ম বলো' },
    { label: isEn ? "📊 Today's Summary" : isHi ? '📊 आज का सारांश' : '📊 আজকের সারসংক্ষেপ', query: isEn ? "Today's summary" : isHi ? 'आज का सारांश बताओ' : 'আজকের সারসংক্ষেপ' },
    { label: isEn ? "💰 Cash in Drawer?" : isHi ? '💰 ड्रॉवर में कैश?' : '💰 ক্যাশ ড্রয়ারে কত?', query: isEn ? 'How much cash in drawer?' : isHi ? 'ड्रॉवर में कितना कैश है?' : 'ক্যাশ ড্রয়ারে কত টাকা আছে?' },
    { label: isEn ? "📋 Customer Dues" : isHi ? '📋 बकाया सूची' : '📋 কার কাছে বাকি?', query: isEn ? 'Who owes money?' : isHi ? 'किसका कितना बकाया है?' : 'কার কার কাছে বাকি পাবো?' },
    { label: isEn ? "🔍 Cash Audit" : isHi ? '🔍 कैश ऑडिट' : '🔍 ক্যাশ অডিট চেক', query: isEn ? 'Check cash drawer audit' : isHi ? 'कैश ड्रॉवर ऑडिट चेक करो' : 'ক্যাশ অডিট চেক করো' }
  ];

  return (
    <div className={
      isFloating 
        ? "fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-50 pointer-events-auto flex flex-col animate-in fade-in slide-in-from-bottom-5 duration-200" 
        : "fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end transition-opacity animate-in fade-in duration-200"
    }>
      {/* Drawer / Floating Container */}
      <div 
        className={
          isFloating
            ? "w-[calc(100vw-24px)] sm:w-[350px] h-[460px] sm:h-[510px] max-h-[85vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-700/80 flex flex-col overflow-hidden ring-1 ring-white/10"
            : "w-full max-w-md bg-white dark:bg-slate-900 h-full flex flex-col shadow-2xl border-l border-slate-200 dark:border-slate-800 transition-transform transform duration-300 ease-out"
        }
        role="dialog"
        aria-label={isFloating ? "NAM AI Floating Copilot" : "NAM AI Drawer"}
      >
        {/* Header */}
        <div className="px-4 py-3.5 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-500 text-white shadow-md">
              <Bot className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold tracking-tight">NAM AI</h3>
                <span className="text-xs px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 font-semibold rounded border border-emerald-500/30">
                  {chatLang === 'en' ? 'EN' : chatLang === 'hi' ? 'हिन्दी' : 'বাংলা'}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${apiKey || getPoolSize() > 0 ? 'bg-indigo-400' : 'bg-emerald-400'}`} />
                {apiKey || getPoolSize() > 0
                  ? (isEn ? `Gemini Cloud Active (${getPoolSize()} Keys Pool)` : `জেমিনাই ক্লাউড সক্রিয় (${getPoolSize()}টি কি পুল)`) 
                  : (isEn ? '100% Free Local Core' : '১০০% ফ্রি লোকাল ইঞ্জিন')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Settings (Language & Advanced Mode) */}
            <button
              onClick={() => { setShowSettings(!showSettings); setShowKeyConfig(false); }}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                showSettings
                  ? 'bg-amber-500 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
              title={isEn ? 'Language & Settings' : isHi ? 'भाषा और सेटिंग्स' : 'ভাষা ও সেটিংস'}
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Voice Speaker Toggle */}
            <button
              onClick={() => {
                const next = !speechEnabled;
                setSpeechEnabled(next);
                try { localStorage.setItem('nam_ai_speech', String(next)); } catch {}
                if (!next) {
                  stopNaturalVoice();
                  if (continuousMode) {
                    setContinuousMode(false);
                    try { localStorage.setItem('nam_ai_continuous', 'false'); } catch {}
                  }
                }
              }}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                speechEnabled
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
              title={isEn ? (speechEnabled ? 'Speaker ON — click to mute' : 'Speaker OFF — click to hear responses') : (speechEnabled ? '🔊 স্পিকার চালু — বন্ধ করতে চাপুন' : '🔇 স্পিকার বন্ধ — চালু করতে চাপুন')}
            >
              {speechEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Gemini API Key Toggle */}
            <button
              onClick={() => { setShowKeyConfig(!showKeyConfig); setShowSettings(false); }}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                showKeyConfig 
                  ? 'bg-indigo-600 text-white' 
                  : apiKey 
                    ? 'text-indigo-300 hover:bg-slate-800' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
              title={isEn ? 'Gemini API Key Settings' : 'জেমিনাই এপিআই সেটিংস'}
            >
              <Key className="w-4 h-4" />
            </button>

            {/* Clear Chat */}
            <button
              onClick={() => setMessages([messages[0]])}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title={isEn ? 'Clear conversation' : 'চ্যাট ক্লিয়ার করুন'}
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* View Mode Toggle: Full Drawer vs Floating PiP */}
            <button
              onClick={toggleViewMode}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title={isFloating 
                ? (isEn ? 'Switch to Full Drawer' : isHi ? 'फुल ड्रॉर में बदलें' : 'ফুল ড্রয়ার মোডে বড় করুন')
                : (isEn ? 'Switch to Floating PiP (Work on app while chatting)' : isHi ? 'फ्लोटिंग पॉप-अप बनाएं' : 'ভাসমান পপ-আপ মোড (পেজে কাজ করার সাথে সাথে চ্যাট)')
              }
            >
              {isFloating ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>

            {/* Close */}
            <button
              onClick={() => {
                stopNaturalVoice();
                onClose();
              }}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Collapsible Gemini API Key Settings Banner */}
        {showKeyConfig && (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                {isEn ? 'Google Gemini API Key (Optional)' : 'গুগল জেমিনাই এপিআই কী (ঐচ্ছিক)'}
              </span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1 hover:underline"
              >
                {isEn ? 'Get Free Key' : 'ফ্রি কি নিন'} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {isEn 
                ? "NAM AI is 100% free and works offline without an API key! Add your free Google AI Studio key to unlock deeper conversational business reasoning." 
                : "NAM (নাম) এআই কোনো এপিআই কী ছাড়াই ১০০% বিনামূল্যে অফলাইনে হিসাব করতে পারে। গভীর পরামর্শ পেতে চাইলে Google AI Studio-র সম্পূর্ণ ফ্রি এপিআই কী এখানে সেভ করতে পারেন।"}
            </p>
            {getPoolSize() > 0 && (
              <div className="flex items-center justify-between p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  {isEn 
                    ? `Multi-Key Pool Active: ${getPoolSize()} Gemini API keys with auto-rotation & rate-limit failover` 
                    : `মাল্টি-কি পুল সক্রিয়: ${getPoolSize()}টি জেমিনাই এপিআই কী অটো-রোটেশন ও ফেইলওভার সহ যুক্ত আছে`}
                </span>
                <span className="font-bold text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-lg shrink-0">
                  {getPoolSize()} Keys
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="password"
                placeholder={isEn ? "Paste Gemini API key here" : "জেমিনাই এপিআই কী এখানে পেস্ট করুন"}
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleSaveKey}
                disabled={!tempApiKey}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors cursor-pointer"
              >
                {isEn ? 'Save' : 'সংরক্ষণ'}
              </button>
              {apiKey && (
                <button
                  onClick={handleRemoveKey}
                  className="px-2.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 font-bold rounded-xl transition-colors cursor-pointer"
                  title="Remove Key"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Language & Advanced Mode Settings Panel */}
        {showSettings && (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs space-y-4 shrink-0">
            {/* Language Selector */}
            <div>
              <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5 mb-2.5">
                <Globe className="w-3.5 h-3.5 text-amber-500" />
                {isEn ? 'AI Response Language' : isHi ? 'AI उत्तर भाषा' : 'AI উত্তরের ভাষা'}
              </span>
              <div className="flex gap-2">
                {[
                  { code: 'bn', label: 'বাংলা', flag: '🇧🇩' },
                  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
                  { code: 'en', label: 'English', flag: '🇬🇧' }
                ].map(({ code, label, flag }) => (
                  <button
                    key={code}
                    onClick={() => {
                      setChatLang(code);
                      try { localStorage.setItem('nam_ai_lang', code); } catch {}
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border-2 ${
                      chatLang === code
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-500/20'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                    }`}
                  >
                    <span className="text-base">{flag}</span> {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                {isEn ? 'Changes AI response language, voice input & speaker output' : isHi ? 'AI उत्तर, वॉइस इनपुट और स्पीकर भाषा बदलें' : 'AI উত্তর, ভয়েস ইনপুট ও স্পিকারের ভাষা পরিবর্তন হবে'}
              </p>
            </div>

            {/* Advanced Mode Toggle */}
            <div className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Zap className={`w-4 h-4 ${advancedMode ? 'text-amber-500' : 'text-slate-400'}`} />
                <div>
                  <p className="font-bold text-slate-800 dark:text-white text-xs">
                    {isEn ? 'Advanced Mode' : isHi ? 'एडवांस्ड मोड' : 'অ্যাডভান্সড মোড'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {isEn ? 'PhD-level deep analysis & formulas' : isHi ? 'PhD-स्तरीय गहन विश्लेषण' : 'পিএইচডি-লেভেল গভীর বিশ্লেষণ ও ফর্মুলা'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const next = !advancedMode;
                  setAdvancedMode(next);
                  try { localStorage.setItem('nam_ai_advanced', String(next)); } catch {}
                }}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                  advancedMode ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  advancedMode ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>

            {advancedMode && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-2.5 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                <strong>⚡ {isEn ? 'Advanced Mode ON' : isHi ? 'एडवांस्ड मोड चालू' : 'অ্যাডভান্সড মোড চালু'}:</strong>{' '}
                {isEn
                  ? 'DuPont decomposition, CCC waterfall, IFRS 9 credit loss models, Monte Carlo cash projections, and full PhD-level formulas will be included in responses.'
                  : isHi
                  ? 'DuPont विश्लेषण, CCC वॉटरफॉल, IFRS 9 क्रेडिट लॉस मॉडल, और पूर्ण PhD-स्तरीय फ़ॉर्मूला उत्तरों में शामिल होंगे।'
                  : 'DuPont বিশ্লেষণ, CCC ওয়াটারফল, IFRS 9 ক্রেডিট লস মডেল, মন্টে কার্লো ক্যাশ প্রজেকশন এবং সম্পূর্ণ পিএইচডি-লেভেল ফর্মুলা উত্তরে অন্তর্ভুক্ত থাকবে।'}
              </div>
            )}
          </div>
        )}

        {/* Quick Suggestion Chips */}
        <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-none flex gap-1.5 shrink-0">
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(p.query)}
              disabled={isLoading}
              className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors shadow-2xs cursor-pointer active:scale-95 shrink-0"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const actionExecuted = executedActions[msg.id];

            return (
              <div 
                key={msg.id} 
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div className={`flex items-start gap-2 max-w-[88%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                  {!isUser && (
                    <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                    isUser 
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-tr-none shadow-sm' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-none shadow-2xs border border-slate-200 dark:border-slate-700/60'
                  }`}>
                    {/* Render message with line breaks & basic markdown bold support */}
                    <div className="space-y-1.5 whitespace-pre-line">
                      {msg.text.split('\n').map((line, lIdx) => {
                        // Render simple bolding **text**
                        const parts = line.split(/(\*\*.*?\*\*)/g);
                        return (
                          <p key={lIdx}>
                            {parts.map((part, pIdx) => {
                              if (part.startsWith('**') && part.endsWith('**')) {
                                return <strong key={pIdx} className="font-bold">{part.slice(2, -2)}</strong>;
                              }
                              return part;
                            })}
                          </p>
                        );
                      })}
                    </div>

                    {!isUser && msg.id !== 'welcome' && (
                      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-700/50">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <button
                            onClick={() => handleFeedback(msg.id, 'up')}
                            className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer ${feedback[msg.id] === 'up' ? 'text-emerald-500 font-bold scale-110' : ''}`}
                            title={isEn ? "Helpful" : isHi ? "सहायक" : "সহায়ক"}
                          >
                            👍
                          </button>
                          <button
                            onClick={() => handleFeedback(msg.id, 'down')}
                            className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer ${feedback[msg.id] === 'down' ? 'text-rose-500 font-bold scale-110' : ''}`}
                            title={isEn ? "Not helpful" : isHi ? "सहायक नहीं" : "সহায়ক নয়"}
                          >
                            👎
                          </button>
                          {feedback[msg.id] && (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium ml-1">
                              {isEn ? 'Thanks!' : isHi ? 'धन्यवाद!' : 'ধন্যবাদ!'}
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-400">
                          {msg.timestamp}
                        </span>
                      </div>
                    )}

                    {isUser && (
                      <span className="block text-[9px] mt-2 text-right text-emerald-100">
                        {msg.timestamp}
                      </span>
                    )}
                  </div>
                </div>

                {/* Render Interactive Action Card if present */}
                {msg.actionCard && (
                  <div className="mt-2.5 ml-9 max-w-[85%] bg-white dark:bg-slate-800/90 border-2 border-emerald-500/40 rounded-2xl p-3 shadow-md">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-2 mb-2">
                      <p className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                        {msg.actionCard.title}
                      </p>
                      {actionExecuted && (
                        <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold rounded-full flex items-center gap-1">
                          <Check className="w-3 h-3" /> {isEn ? 'Completed' : 'সম্পন্ন হয়েছে'}
                        </span>
                      )}
                    </div>

                    {msg.actionCard.type === 'EXPENSE_DRAFT' && (
                      <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Category:' : 'খাত:'}</span>
                          <span className="font-semibold">{msg.actionCard.category}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Amount:' : 'পরিমাণ:'}</span>
                          <span className="font-bold text-rose-600 dark:text-rose-400 text-sm">
                            {formatBDT(msg.actionCard.amount, lang)}
                          </span>
                        </div>
                      </div>
                    )}

                    {msg.actionCard.type === 'SALE_DRAFT' && (
                      <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Sale Type:' : 'ধরন:'}</span>
                          <span className="font-semibold">{isEn ? 'Cash Sale' : 'নগদ বিক্রি'}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Amount:' : 'পরিমাণ:'}</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                            {formatBDT(msg.actionCard.amount, lang)}
                          </span>
                        </div>
                      </div>
                    )}

                    {msg.actionCard.type === 'WHATSAPP_REMINDER' && (
                      <div className="space-y-1.5 mb-3 text-xs">
                        <p className="text-slate-600 dark:text-slate-300">
                          {isEn ? 'Recipient:' : 'প্রাপক:'} <strong>{msg.actionCard.name}</strong> ({msg.actionCard.phone})
                        </p>
                        <p className="text-amber-600 dark:text-amber-400 font-bold">
                          {isEn ? 'Outstanding Due:' : 'বকেয়া:'} {formatBDT(msg.actionCard.balance, lang)}
                        </p>
                      </div>
                    )}

                    {msg.actionCard.type === 'DUE_GIVE_DRAFT' && (
                      <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Customer:' : 'কাস্টমার:'}</span>
                          <span className="font-semibold">{msg.actionCard.contactName || (isEn ? 'Customer' : 'কাস্টমার')}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Due Amount:' : 'বাকির পরিমাণ:'}</span>
                          <span className="font-bold text-purple-600 dark:text-purple-400 text-sm">
                            {formatBDT(msg.actionCard.amount, lang)}
                          </span>
                        </div>
                      </div>
                    )}

                    {msg.actionCard.type === 'DUE_COLLECT_DRAFT' && (
                      <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Customer:' : 'কাস্টমার:'}</span>
                          <span className="font-semibold">{msg.actionCard.contactName || (isEn ? 'Customer' : 'কাস্টমার')}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Collected Amount:' : 'আদায়ের পরিমাণ:'}</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                            {formatBDT(msg.actionCard.amount, lang)}
                          </span>
                        </div>
                      </div>
                    )}

                    {msg.actionCard.type === 'NAVIGATE' && (
                      <div className="space-y-1 mb-3 text-xs">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{isEn ? 'Target Screen:' : 'গন্তব্য:'}</span>
                          <span className="font-bold text-indigo-600 dark:text-indigo-400">
                            {msg.actionCard.screenName || msg.actionCard.screen}
                          </span>
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => handleExecuteAction(msg.actionCard, msg.id)}
                      disabled={actionExecuted}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${
                        actionExecuted
                          ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-98'
                      }`}
                    >
                      {actionExecuted ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          {isEn ? 'Recorded in Ledger' : 'হিসাবে যুক্ত করা হয়েছে'}
                        </>
                      ) : (
                        <>
                          <span>{msg.actionCard.buttonLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && (
            <div className="flex items-center gap-2.5 text-slate-400 text-xs ml-2 py-2">
              <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/80 flex items-center justify-center shadow-xs border border-emerald-500/20 shrink-0">
                <Bot className="w-4 h-4 text-emerald-600 animate-pulse" />
              </div>
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3.5 py-2 rounded-2xl rounded-tl-none text-slate-700 dark:text-slate-200 shadow-2xs border border-slate-200 dark:border-slate-750">
                <span className="text-xs font-medium">
                  {isEn ? 'Dr. NAM is thinking...' : isHi ? 'डॉ. नाम सोच रहे हैं...' : 'ডক্টর নাম ভাবছে...'}
                </span>
                <span className="flex gap-1 items-center ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
          {/* Voice Error notice if any */}
          {voiceError && (
            <p className="text-xs text-rose-500 mb-2 px-1">
              ⚠️ {voiceError}
            </p>
          )}

          {/* Hands-Free / Continuous Listening Status Bar */}
          {continuousMode && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/80 rounded-xl text-xs text-emerald-800 dark:text-emerald-300">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'}`} />
                <span className="font-semibold text-[11px]">
                  {isListening 
                    ? (isEn ? '🎙️ Listening... (say "Stop" or tap to exit)' : isHi ? '🎙️ सुन रहा हूँ... (रोकने के लिए "Stop" कहें)' : '🎙️ শুনছি... (থামাতে "থামো" বা "Stop" বলুন)')
                    : (isEn ? '🔊 Dr. NAM is speaking...' : isHi ? '🔊 डॉ. नाम बोल रहे हैं...' : '🔊 ডক্টর নাম কথা বলছেন...')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {!isListening && (
                  <button
                    type="button"
                    onClick={() => {
                      stopNaturalVoice();
                      setTimeout(() => {
                        startListening();
                      }, 120);
                    }}
                    className="text-xs font-bold px-2 py-0.5 rounded-lg bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/80 text-amber-800 dark:text-amber-200 cursor-pointer transition-colors"
                    title={isEn ? 'Interrupt Dr. NAM and speak now' : 'থামিয়ে কথা বলুন'}
                  >
                    {isEn ? 'Interrupt' : isHi ? 'रोकें' : 'থামিয়ে বলুন'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleContinuousMode}
                  className="text-xs font-bold px-2 py-0.5 rounded-lg bg-emerald-200/60 dark:bg-emerald-900/60 hover:bg-emerald-300 cursor-pointer"
                >
                  {isEn ? 'Exit Hands-Free' : isHi ? 'बंद करें' : 'বন্ধ করুন'}
                </button>
              </div>
            </div>
          )}

          {/* Normal Listening (Single turn) indicator with 2.5s pause info */}
          {!continuousMode && isListening && (
            <div className="flex items-center justify-between px-3 py-1 mb-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-[11px] text-slate-700 dark:text-slate-300 animate-pulse">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                {isEn ? 'Listening... (pauses up to 2.5s supported)' : isHi ? 'सुन रहा हूँ... (2.5s तक रुक सकते हैं)' : 'শুনছি... (থেমে চিন্তা করার জন্য ২.৫ সেকেন্ড সময় পাবেন)'}
              </span>
              <button
                type="button"
                onClick={() => stopListening(true)}
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                {isEn ? 'Send Now' : isHi ? 'अभी भेजें' : 'এখনই পাঠান'}
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Voice Input Button (Single Turn) */}
            {voiceSupported ? (
              <button
                type="button"
                onClick={isListening && !continuousMode ? () => stopListening(true) : () => {
                  if (continuousMode) setContinuousMode(false);
                  startListening();
                }}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  isListening && !continuousMode
                    ? 'bg-rose-600 text-white animate-pulse shadow-md shadow-rose-500/30 ring-2 ring-rose-400'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title={isListening && !continuousMode 
                  ? (isEn ? 'Listening... click to send now' : 'শুনছি... এখনই পাঠাতে ক্লিক করুন') 
                  : (isEn ? 'Voice input (Bangla/Hindi/English)' : 'মুখে কথা বলুন (বাংলা/হিন্দি/ইংরেজি)')}
              >
                {isListening && !continuousMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            ) : null}

            {/* Hands-Free Continuous Voice Mode Button (Next to Mic) */}
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleContinuousMode}
                className={`p-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center ${
                  continuousMode
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-400/60 animate-pulse'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-emerald-600 dark:hover:text-emerald-400'
                }`}
                title={
                  isEn 
                    ? (continuousMode ? '⚡ Hands-Free ON (continuous conversation) — tap to turn OFF' : '⚡ Hands-Free OFF — tap for continuous voice chat') 
                    : isHi 
                    ? (continuousMode ? '⚡ हैंड्स-फ्री चालू (लगातार बातचीत) — बंद करने के लिए दबाएं' : '⚡ हैंड्स-फ्री बंद — बिना रुके लगातार बात करने के लिए दबाएं')
                    : (continuousMode ? '⚡ হ্যান্ডস-ফ্রি মোড চালু (অনবরত কথোপকথন) — বন্ধ করতে চাপুন' : '⚡ হ্যান্ডস-ফ্রি বন্ধ — অনবরত কথা বলতে চালু করুন')
                }
              >
                <Zap className={`w-4 h-4 ${continuousMode ? 'fill-current' : ''}`} />
              </button>
            )}

            {/* Input box */}
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={isListening 
                  ? (isEn ? "Listening to your voice..." : "কথা বলুন, শুনছি...") 
                  : (isEn ? "Ask NAM AI or speak (Alt+A)..." : "NAM-কে হিসাব জিজ্ঞেস করুন বা লিখুন...")}
                className={`w-full pl-3 pr-10 py-2.5 bg-slate-100 dark:bg-slate-800 border rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
                  isListening ? 'border-rose-400 ring-2 ring-rose-300 dark:ring-rose-900/50' : 'border-transparent'
                }`}
              />

              {/* Send button */}
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || isLoading}
                className="absolute right-1.5 top-1.5 bottom-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 text-white rounded-lg transition-colors flex items-center justify-center cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 px-1 text-xs text-slate-400">
            <span>💡 {isEn ? '⚡ Hands-Free: continuous chat • 2.5s pause tolerance • Say "Stop" to exit' : '⚡ হ্যান্ডস-ফ্রি: অনবরত কথা বলা • ২.৫ সেকেন্ড পজ টলারেন্স • থামাতে "Stop" বা "থামো" বলুন'}</span>
            <kbd className="hidden sm:inline-block font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[9px]">Esc to close</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
