// aiAgentService.js — NAM AI: PhD-Grade Financial Economics, Strategic Accounting & Business Growth Core Engine
import { formatBDT, roundBDT } from '../data/calculations.js';
import { SCREENS, DAY_STATUS } from '../data/constants.js';
import { auth } from '../firebase/firebaseConfig.js';
import {
  calculateBusinessHealthScorecard,
  calculateProjectedCashFlow,
  getOperationsPipeline,
  getFinancialTotals,
  safeDiv
} from '../data/analyticsEngine.js';
import { extractVoiceContactName } from './voiceEntityExtractor.js';

// Session-scoped storage key for optional user-supplied Gemini API Key (never persisted in localStorage)
export const GEMINI_API_KEY_STORAGE = 'ledgero_gemini_api_key';

// ⚠️ SECURITY: No hardcoded keys. Prefer server-side proxy (VITE_GEMINI_PROXY_URL) or session-scoped BYOK.
export const BUILT_IN_KEY_POOL = [];

// ─── Client-Side Quota & Rate Limiter ────────────────────────────────────────
const AI_MAX_REQUESTS_PER_MINUTE = 10;
const AI_MAX_REQUESTS_PER_DAY = 100;
let _aiMinuteTimestamps = [];
let _aiDayCount = { date: '', count: 0 };

export const checkAndRecordAIQuota = () => {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (_aiDayCount.date !== today) {
    _aiDayCount = { date: today, count: 0 };
  }
  _aiMinuteTimestamps = _aiMinuteTimestamps.filter(ts => now - ts < 60000);
  if (_aiMinuteTimestamps.length >= AI_MAX_REQUESTS_PER_MINUTE) {
    throw new Error('AI_RATE_LIMIT_MINUTE');
  }
  if (_aiDayCount.count >= AI_MAX_REQUESTS_PER_DAY) {
    throw new Error('AI_RATE_LIMIT_DAY');
  }
  _aiMinuteTimestamps.push(now);
  _aiDayCount.count += 1;
  return true;
};

export const getGeminiProxyUrl = () => {
  try {
    return (import.meta.env?.VITE_GEMINI_PROXY_URL || '').trim() || null;
  } catch {
    return null;
  }
};

export const getSavedGeminiKey = () => {
  try {
    // Purge any legacy persistent localStorage key if present
    if (typeof localStorage !== 'undefined' && localStorage.getItem(GEMINI_API_KEY_STORAGE)) {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE);
    }
    if (typeof sessionStorage !== 'undefined') {
      const custom = sessionStorage.getItem(GEMINI_API_KEY_STORAGE);
      if (custom && custom.trim()) {
        return custom.trim();
      }
    }
    // SECURITY: Never bundle a shared Gemini API key via VITE_GEMINI_API_KEY in client JS.
    // Production deployments use VITE_GEMINI_PROXY_URL (server-side proxy) or ephemeral sessionStorage BYOK.
    return null;
  } catch {
    return null;
  }
};

export const saveGeminiKey = (key) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE);
    }
    if (typeof sessionStorage !== 'undefined') {
      if (!key) {
        sessionStorage.removeItem(GEMINI_API_KEY_STORAGE);
      } else {
        sessionStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
      }
    }
  } catch {
    // Silently fail — don't log key-related errors
  }
};


// ─── Multi-API Key Pool System (Round-Robin with Auto-Failover) ─────────────
let _keyPoolIndex = 0;
let _keyPoolCache = null;

export const getKeyPool = () => {
  if (_keyPoolCache && _keyPoolCache.length > 0) return _keyPoolCache;
  // SECURITY: Client-side key pools (VITE_GEMINI_API_KEYS) are disabled so secret keys are never bundled into dist/*.js.
  _keyPoolCache = BUILT_IN_KEY_POOL;
  return BUILT_IN_KEY_POOL;
};

export const getNextPoolKey = () => {
  const pool = getKeyPool();
  if (!pool || pool.length === 0) return null;
  const key = pool[_keyPoolIndex % pool.length];
  _keyPoolIndex = (_keyPoolIndex + 1) % pool.length;
  return key;
};

export const rotateToNextKey = () => {
  const pool = getKeyPool();
  if (!pool || pool.length <= 1) return null;
  _keyPoolIndex = (_keyPoolIndex + 1) % pool.length;
  return pool[_keyPoolIndex];
};

export const getPoolSize = () => {
  const pool = getKeyPool();
  return pool ? pool.length : 0;
};

// ─── Gemini Voice Transcript Correction (Phase 3: Smart STT) ────────────────
/**
 * Uses Gemini Flash-Lite to correct Web Speech API transcript errors.
 * Passes inventory/contact names as vocabulary context for accurate correction.
 * Returns corrected Bengali text, or original if correction fails/times out.
 * @param {string} rawTranscript - Raw Web Speech API output
 * @param {Object} vocabContext - { productNames: string[], contactNames: string[] }
 * @returns {Promise<string>} Corrected transcript
 */
export const correctVoiceTranscript = async (rawTranscript, vocabContext = {}) => {
  if (!rawTranscript || rawTranscript.trim().length < 3) return rawTranscript;
  
  const proxyUrl = getGeminiProxyUrl();
  const apiKey = getSavedGeminiKey() || getNextPoolKey();
  if (!proxyUrl && !apiKey) return rawTranscript; // No proxy or key, skip correction
  
  const productList = (vocabContext.productNames || []).slice(0, 30).join(', ');
  const contactList = (vocabContext.contactNames || []).slice(0, 30).join(', ');
  
  const correctionPrompt = `তুমি বাংলাদেশের দোকানদারদের ভয়েস রিকগনিশন কারেক্টর। নিচের ভুল ট্রান্সক্রিপ্ট সংশোধন করো।

সাধারণ ভুল: 'তাকা'→'টাকা', 'বাক'→'বাকি', 'পাচ শ'→'পাঁচশ', 'বিক্রী'→'বিক্রি', 'হিশাব'→'হিসাব'
${productList ? `দোকানের পণ্য: ${productList}` : ''}
${contactList ? `কাস্টমার: ${contactList}` : ''}

ভুল ট্রান্সক্রিপ্ট: "${rawTranscript}"

শুধু সংশোধিত বাক্যটি ফেরত দাও, অন্য কিছু না:`;

  try {
    checkAndRecordAIQuota();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s timeout — must be fast
    
    const endpoint = proxyUrl || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';
    const headers = { 'Content-Type': 'application/json' };
    if (!proxyUrl && apiKey) {
      headers['x-goog-api-key'] = apiKey;
    }

    const response = await fetch(
      endpoint,
      {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: 'gemini-2.0-flash-lite',
          contents: [{ parts: [{ text: correctionPrompt }] }],
          generationConfig: {
            temperature: 0.1, // Very low — we want exact corrections, not creativity
            maxOutputTokens: 200,
            topP: 0.8
          }
        })
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!response.ok) return rawTranscript;
    
    const data = await response.json();
    const corrected = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    // Sanity check: if corrected text is too different or empty, keep original
    if (!corrected || corrected.length < 2 || corrected.length > rawTranscript.length * 3) {
      return rawTranscript;
    }
    
    // Voice correction applied
    return corrected;
  } catch (err) {
    // Timeout or network error — silently fall back to raw transcript
    if (err.name !== 'AbortError') {
      console.warn('[VoiceCorrection] Failed:', err.message);
    }
    return rawTranscript;
  }
};

export const normalizeBengaliDigits = (str = '') => {
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(str).replace(/[০-৯]/g, (d) => bnDigits.indexOf(d));
};

/**
 * Serializes the complete live financial state into an intelligible, PhD-level quantitative snapshot.
 */
export const extractFinancialContext = (state, activeInput = null) => {
  const dayData = state?.dayData || {};
  const transactions = dayData.transactions || [];
  const wallets = dayData.wallets || {};
  const products = dayData.products || [];
  const contacts = state?.contacts || [];
  const businessName = state?.activeBiz?.name || 'Ledgero Business';

  const now = new Date();
  const hours24 = now.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = now.getMinutes();
  const minutesPad = String(minutes).padStart(2, '0');
  const isPM = hours24 >= 12;
  const ampm = isPM ? 'PM' : 'AM';

  // English 12-hour clean time: "6:33 PM"
  const currentTime = `${hours12}:${minutesPad} ${ampm}`;

  // Bengali period-based spoken time: "সন্ধ্যা ৬টা ৩৩ মিনিট"
  let bnPeriod = 'সকাল';
  if (hours24 >= 4 && hours24 < 6) bnPeriod = 'ভোর';
  else if (hours24 >= 6 && hours24 < 12) bnPeriod = 'সকাল';
  else if (hours24 >= 12 && hours24 < 15) bnPeriod = 'দুপুর';
  else if (hours24 >= 15 && hours24 < 18) bnPeriod = 'বিকাল';
  else if (hours24 >= 18 && hours24 < 20) bnPeriod = 'সন্ধ্যা';
  else bnPeriod = 'রাত';

  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const toBnDigits = (num) => String(num).replace(/\d/g, d => bnDigits[d]);
  const currentTimeBn = `${bnPeriod} ${toBnDigits(hours12)}টা ${toBnDigits(minutes)} মিনিট`;

  // Hindi period-based spoken time: "शाम के 6:33 बजे"
  let hiPeriod = 'सुबह';
  if (hours24 >= 4 && hours24 < 12) hiPeriod = 'सुबह';
  else if (hours24 >= 12 && hours24 < 16) hiPeriod = 'दोपहर';
  else if (hours24 >= 16 && hours24 < 20) hiPeriod = 'शाम';
  else hiPeriod = 'रात';

  const currentTimeHi = `${hiPeriod} के ${hours12}:${minutesPad} बजे`;

  const currentDayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const currentDayOfWeekBn = new Intl.DateTimeFormat('bn-BD', { weekday: 'long' }).format(now);
  const currentDayOfWeekHi = new Intl.DateTimeFormat('hi-IN', { weekday: 'long' }).format(now);
  const currentDateFormatted = now.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const currentDateFormattedBn = new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const currentDateFormattedHi = new Intl.DateTimeFormat('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const rawActiveScreen = state?.currentScreen || state?.activeScreen || 'dashboard';
  const activeScreen = String(rawActiveScreen).toLowerCase();

  // Screen metadata and purpose for live situational awareness
  const screenMetadata = {
    dashboard: {
      nameBn: 'ড্যাশবোর্ড (Dashboard)',
      nameHi: 'डैशबोर्ड (Dashboard)',
      nameEn: 'Dashboard',
      descBn: 'আজকের বিক্রি, ক্যাশবক্স ব্যালেন্স, খরচ ও দৈনন্দিন লেনদেনের মূল পাতা।',
      descHi: 'आज की बिक्री, कैशबॉक्स बैलेंस, खर्च और मुख्य लेन-देन केंद्र।',
      descEn: "Main overview for today's sales, cash drawer balance, expenses and quick actions."
    },
    khata: {
      nameBn: 'বাকির খাতা (Khata)',
      nameHi: 'खाता बही (Khata)',
      nameEn: 'Due Ledger (Khata)',
      descBn: 'কাস্টমারদের মোট বাকি (পাবো) এবং মহাজনদের বকেয়া (দেবো) হিসাবের খাতা।',
      descHi: 'ग्राहकों का बकाया (पाना) और महाजनों की उधारी (देना) का खाता।',
      descEn: 'Customer receivables (due collect) and supplier payables (due give) book.'
    },
    closing: {
      nameBn: 'দিন শেষ / ক্যাশ মেলানো (Day Closing)',
      nameHi: 'दिन की समाप्ति / कैश मिलान (Day Closing)',
      nameEn: 'Day Closing & Cash Reconciliation',
      descBn: 'সারাদিনের ক্যাশ গণনা করে সিস্টেমের সাথে মিলানো ও হিসাব ফাইনাল করার পেজ।',
      descHi: 'पूरे दिन का कैश गिनकर सिस्टम से मिलाने और खाता बंद करने का पेज।',
      descEn: 'Page to count drawer cash, verify reconciliation variance and close the day.'
    },
    reports: {
      nameBn: 'মাসিক রিপোর্ট ও অডিট (Reports)',
      nameHi: 'मासिक रिपोर्ट और ऑडिट (Reports)',
      nameEn: 'Financial Reports & Audit',
      descBn: 'মাসিক আয়-ব্যয়, লাভ-লোকসান (P&L), ব্যালেন্স শিট ও ট্যাক্স সারাংশ।',
      descHi: 'मासिक आय-व्यय, लाभ-हानि (P&L), बैलेंस शीट और टैक्स सारांश।',
      descEn: 'Monthly P&L, balance sheet, trial balance and tax summary reports.'
    },
    analytics: {
      nameBn: 'অ্যানালিটিক্স ও পূর্বাভাস (Analytics)',
      nameHi: 'एनालिटिक्स और पूर्वानुमान (Analytics)',
      nameEn: 'Analytics & Forecasting',
      descBn: 'ক্যাশ ফ্লো পূর্বাভাস, ১৪টি আন্তর্জাতিক কেপিআই এবং ভার্চুয়াল সিএফও হেলথ স্কোর।',
      descHi: 'कैश फ्लो पूर्वानुमान, 14 अंतर्राष्ट्रीय KPI और वर्चुअल CFO हेल्थ स्कोर।',
      descEn: 'Cash flow forecasting, 14 international KPIs and Virtual CFO health diagnostics.'
    },
    opening: {
      nameBn: 'দিন শুরু / ওপেনিং (Day Opening)',
      nameHi: 'दिन की शुरुआत / ओपनिंग (Day Opening)',
      nameEn: 'Day Opening & Balance Setup',
      descBn: 'সকালে ক্যাশবক্স ওপেনিং ব্যালেন্স ও প্রাথমিক হিসাব সেট করে দিন শুরু করার পেজ।',
      descHi: 'सुबह कैशबॉक्स ओपनिंग बैलेंस सेट करके दिन शुरू करने का पेज।',
      descEn: 'Page to set opening wallet balances and initialize the business day.'
    }
  };
  const currentScreenMeta = screenMetadata[activeScreen] || screenMetadata.dashboard;

  // 1. Wallets & Cash Drawer Liquidity
  let cashInDrawer = 0;
  let bankBalances = 0;
  let digitalBalances = 0;

  Object.entries(wallets).forEach(([id, w]) => {
    const bal = Number(w.currentBalance) || 0;
    const cat = (w.category || '').toLowerCase();
    const name = (w.name || '').toLowerCase();
    if (cat === 'cash' || name.includes('drawer') || name.includes('ক্যাশ') || id === 'hand_cash') {
      cashInDrawer += bal;
    } else if (cat === 'bank' || name.includes('bank') || name.includes('ব্যাংক')) {
      bankBalances += bal;
    } else {
      digitalBalances += bal;
    }
  });

  const totalLiquidCash = cashInDrawer + bankBalances + digitalBalances;

  // 2. Today's Transaction Dynamics
  let totalCashIn = 0;
  let totalCashOut = 0;
  let cashSales = 0;
  let expenses = 0;
  let dueGivenToday = 0;
  let dueCollectedToday = 0;
  let salesTransactionCount = 0;

  transactions.forEach((tx) => {
    if (tx.isReversal) return;
    const amt = Number(tx.amount) || 0;
    const type = tx.type || '';

    if (type === 'cash_sale' || type === 'sale' || type === 'service_income' || type === 'due_collection') {
      totalCashIn += amt;
    }
    if (type === 'cash_sale' || type === 'sale') {
      cashSales += amt;
      salesTransactionCount++;
    }
    if (type === 'due_collection') dueCollectedToday += amt;

    if (type === 'expense' || type === 'due_given' || type === 'owner_draw') {
      totalCashOut += amt;
    }
    if (type === 'expense') expenses += amt;
    if (type === 'due_given') dueGivenToday += amt;
  });

  // 3. Receivables (AR) & Payables (AP)
  let totalCustomerReceivable = 0;
  let totalSupplierPayable = 0;
  const overdueDebtors = [];

  contacts.forEach((c) => {
    const bal = Number(c.currentBalance) || 0;
    const type = c.type || 'customer';
    if (type === 'customer' || type === 'both') {
      if (bal > 0) {
        totalCustomerReceivable += bal;
        overdueDebtors.push({
          id: c.id,
          name: c.name,
          phone: c.phone || '',
          balance: bal
        });
      }
    }
    if (type === 'supplier' && bal < 0) {
      totalSupplierPayable += Math.abs(bal);
    }
  });

  overdueDebtors.sort((a, b) => b.balance - a.balance);

  // Concentration risk: % of AR held by top 3 debtors
  const top3DebtorSum = overdueDebtors.slice(0, 3).reduce((acc, d) => acc + d.balance, 0);
  const debtorConcentrationRisk = totalCustomerReceivable > 0 
    ? Math.round((top3DebtorSum / totalCustomerReceivable) * 100) 
    : 0;

  // 4. Products & Stock Analytics
  const lowStockItems = [];
  let totalStockUnits = 0;
  let totalStockInvestment = 0;

  products.forEach((p) => {
    const avail = (Number(p.openingStock) || 0) + (Number(p.addedStock) || 0);
    const buyPrice = Number(p.buyPrice) || 0;
    totalStockUnits += avail;
    totalStockInvestment += avail * buyPrice;
    if (avail <= 5) {
      lowStockItems.push({ name: p.name, units: avail });
    }
  });

  // 5. Integrate Analytics Engine (14 IFRS/GAAP KPIs & Cash Flow Projections)
  let scorecard = null;
  let cashflow = null;
  let pipeline = null;
  try {
    scorecard = calculateBusinessHealthScorecard(state, false);
    cashflow = calculateProjectedCashFlow(state, 30, false);
    pipeline = getOperationsPipeline(state, false);
  } catch (err) {
    console.warn('Analytics engine calculation fallback:', err);
  }

  const kpiMap = {};
  if (scorecard?.kpis) {
    scorecard.kpis.forEach(k => {
      kpiMap[k.key] = k;
    });
  }

  // 6. Unit Economics & Breakeven Analytics
  const revenue = kpiMap.revenue?.val || cashSales || 1;
  const grossProfit = kpiMap.gross_profit?.val || (revenue * 0.35);
  const opex = kpiMap.opex?.val || expenses || 0;
  const netProfit = kpiMap.net_profit?.val || (grossProfit - opex);
  const grossMarginPct = safeDiv(grossProfit, revenue) * 100;
  const netMarginPct = safeDiv(netProfit, revenue) * 100;

  // Daily fixed burn
  const dailyOpEx = opex > 0 ? safeDiv(opex, 30) : safeDiv(expenses, 1, 1000);
  const grossMarginRatio = safeDiv(grossMarginPct, 100, 0.35);

  // Daily & Monthly Break-Even Sales
  const breakevenDailySales = safeDiv(dailyOpEx, grossMarginRatio);
  const breakevenMonthlySales = safeDiv(opex || (dailyOpEx * 30), grossMarginRatio);
  const marginOfSafetyPct = revenue > breakevenMonthlySales 
    ? Math.round(safeDiv(revenue - breakevenMonthlySales, revenue) * 100) 
    : 0;

  // Working Capital & Cash Conversion Cycle (CCC = DSO + DSI - DPO)
  const dso = kpiMap.dso?.val || 0;
  const dpo = kpiMap.dpo?.val || 0;
  const cogs = kpiMap.revenue?.val ? (kpiMap.revenue.val - grossProfit) : 1;
  const dsi = Math.round(safeDiv(totalStockInvestment, cogs) * 30);
  const cashConversionCycle = Math.round(dso + dsi - dpo);

  // Cash Runway in Days
  const cashRunwayDays = kpiMap.cash_runway?.val || Math.round(safeDiv(totalLiquidCash, dailyOpEx, 90));

  // Average Basket Size
  const avgTicketSize = salesTransactionCount > 0 
    ? Math.round(safeDiv(cashSales, salesTransactionCount)) 
    : 0;

  // Build dynamic live screen summary for AI situational awareness
  let screenSummary = '';
  if (activeScreen === 'khata') {
    screenSummary = `মোট কাস্টমার বাকি (পাবো): ৳${totalCustomerReceivable} (${overdueDebtors.length} জন কাস্টমার), মোট মহাজন বকেয়া (দেবো): ৳${totalSupplierPayable}। শীর্ষ দেনাদার: ${overdueDebtors.slice(0, 3).map(d => `${d.name} (৳${d.balance})`).join(', ') || 'কেউ নেই'}।`;
  } else if (activeScreen === 'dashboard') {
    screenSummary = `আজকের ক্যাশবক্স: ৳${cashInDrawer}, মোট লিকুইড ক্যাশ: ৳${totalLiquidCash}, আজকের নগদ বিক্রি: ৳${cashSales}, খরচ: ৳${expenses}, মোট ইন: ৳${totalCashIn}, মোট আউট: ৳${totalCashOut}।`;
  } else if (activeScreen === 'closing') {
    screenSummary = `দিন সমাপ্তি ও ক্যাশ মেলানো পেজ। বর্তমান ক্যাশবক্স প্রত্যাশিত ক্যাশ: ৳${cashInDrawer}। দিনের স্ট্যাটাস: ${dayData.status || 'OPEN'}।`;
  } else if (activeScreen === 'reports') {
    screenSummary = `মাসিক সারাংশ ও আর্থিক বিবরণী পেজ। বর্তমান মাসের মোট বিক্রি: ৳${revenue}, মোট খরচ: ৳${opex}, নেট লাভ: ৳${netProfit}।`;
  } else if (activeScreen === 'analytics') {
    screenSummary = `আর্থিক স্বাস্থ্য স্কোর ও পূর্বাভাস পেজ। হেলথ স্কোর: ${scorecard?.score || 85}% (${scorecard?.rating_bn || 'ভালো'}), ক্যাশ রানওয়ে: ${cashRunwayDays} দিন, DSO বাকি আদায় মেয়াদ: ${dso} দিন।`;
  } else if (activeScreen === 'opening') {
    screenSummary = `দিন শুরু ও ক্যাশবক্স ওপেনিং ব্যালেন্স পেজ। দিনের স্ট্যাটাস: ${dayData.status || 'OPEN'}।`;
  } else {
    screenSummary = `বর্তমান পাতা: ${activeScreen}।`;
  }

  return {
    businessName,
    date: state?.currentDate || now.toISOString().split('T')[0],
    currentTime,
    currentTimeBn,
    currentTimeHi,
    currentDayOfWeek,
    currentDayOfWeekBn,
    currentDayOfWeekHi,
    currentDateFormatted,
    currentDateFormattedBn,
    currentDateFormattedHi,
    activeScreen,
    currentScreenNameBn: currentScreenMeta.nameBn,
    currentScreenNameHi: currentScreenMeta.nameHi,
    currentScreenNameEn: currentScreenMeta.nameEn,
    currentScreenDescriptionBn: currentScreenMeta.descBn,
    currentScreenDescriptionHi: currentScreenMeta.descHi,
    currentScreenDescriptionEn: currentScreenMeta.descEn,
    screenSummary,
    dayStatus: dayData.status || DAY_STATUS.NOT_STARTED,
    cashInDrawer,
    bankBalances,
    digitalBalances,
    totalLiquidCash,
    totalCashIn,
    totalCashOut,
    cashSales,
    expenses,
    dueGivenToday,
    dueCollectedToday,
    netDayMovement: totalCashIn - totalCashOut,
    totalCustomerReceivable,
    totalSupplierPayable,
    overdueDebtors: overdueDebtors.slice(0, 5),
    topDebtorsCount: overdueDebtors.length,
    debtorConcentrationRisk,
    totalStockUnits,
    totalStockInvestment,
    lowStockItems: lowStockItems.slice(0, 5),
    transactionsCount: transactions.length,
    contacts,

    // PhD Analytical Metrics
    scorecardScore: scorecard?.score || 85,
    scorecardRating: scorecard?.rating || 'Good',
    scorecardRatingBn: scorecard?.rating_bn || 'সন্তোষজনক',
    kpiMap,
    revenue,
    grossProfit,
    opex,
    netProfit,
    grossMarginPct: Math.round(grossMarginPct * 10) / 10,
    netMarginPct: Math.round(netMarginPct * 10) / 10,
    dailyOpEx: Math.round(dailyOpEx),
    breakevenDailySales: Math.round(breakevenDailySales),
    breakevenMonthlySales: Math.round(breakevenMonthlySales),
    marginOfSafetyPct,
    dso,
    dpo,
    dsi,
    cashConversionCycle,
    cashRunwayDays,
    avgTicketSize,
    currentRatio: kpiMap.current_ratio?.val || 1.5,
    quickRatio: kpiMap.quick_ratio?.val || 1.1,
    workingCapital: kpiMap.working_capital?.val || (totalLiquidCash + totalCustomerReceivable - totalSupplierPayable),
    projected30DayMovement: cashflow?.summary?.next30DaysMovement || 0,
    projectedEndBalance: cashflow?.summary?.projectedEndBalance || totalLiquidCash,

    // SKU-level data for PhD-level AI analysis
    topSellingProducts: products
      .filter(p => {
        const sold = (Number(p.openingStock) || 0) + (Number(p.addedStock) || 0) - (Number(p.closingStock) || Number(p.stock) || 0);
        return sold > 0;
      })
      .map(p => ({
        name: p.name,
        unitsSold: (Number(p.openingStock) || 0) + (Number(p.addedStock) || 0) - (Number(p.closingStock) || Number(p.stock) || 0),
        revenue: ((Number(p.openingStock) || 0) + (Number(p.addedStock) || 0) - (Number(p.closingStock) || Number(p.stock) || 0)) * (Number(p.sellPrice) || 0),
        margin: Number(p.sellPrice) && Number(p.buyPrice) ? Math.round(((Number(p.sellPrice) - Number(p.buyPrice)) / Number(p.sellPrice)) * 100) : 0
      }))
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 5),
    deadStockItems: products
      .filter(p => {
        const sold = (Number(p.openingStock) || 0) + (Number(p.addedStock) || 0) - (Number(p.closingStock) || Number(p.stock) || 0);
        const currentStock = Number(p.closingStock) || Number(p.stock) || 0;
        return sold === 0 && currentStock > 0;
      })
      .map(p => ({ name: p.name, stock: Number(p.closingStock) || Number(p.stock) || 0, value: (Number(p.closingStock) || Number(p.stock) || 0) * (Number(p.buyPrice) || 0) }))
      .slice(0, 5),

    activeInput: activeInput || state?.activeInput || null
  };
};

// Set of standard common English words that must NOT be phonetically mangled or fuzzy-mutated
const COMMON_ENGLISH_WORDS = new Set([
  'show', 'what', 'growth', 'wallet', 'value', 'the', 'this', 'that', 'with', 'which', 
  'when', 'where', 'who', 'how', 'have', 'from', 'help', 'expense', 'expenses', 'sale', 
  'sales', 'cash', 'bank', 'due', 'total', 'profit', 'loss', 'today', 'report', 'health', 
  'margin', 'settings', 'user', 'name', 'time', 'business', 'money', 'balance', 'drawer', 
  'closing', 'opening', 'invoice', 'voucher', 'service', 'system', 'status', 'score', 
  'break', 'even', 'than', 'then', 'there', 'their', 'about', 'after', 'before', 'would', 
  'could', 'should', 'other', 'into', 'more', 'some', 'these', 'first', 'also', 'new', 
  'want', 'need', 'give', 'take', 'make', 'good', 'well', 'very', 'much', 'many', 'tell',
  'kpi', 'dso', 'cfo', 'vat', 'tax', 'loan', 'cost', 'assets', 'stock', 'inventory',
  'list', 'lists', 'item', 'items', 'debt', 'debts', 'note', 'notes', 'rate', 'rates',
  'price', 'prices', 'sheet', 'sheets', 'cogs', 'unit', 'units', 'add', 'view', 'meaning'
]);

const normalizePhonetics = (text) => {
  if (!text) return '';
  const words = text.toLowerCase().trim().split(/\s+/);
  return words.map(word => {
    // If it's a known English word, preserve it untouched
    if (COMMON_ENGLISH_WORDS.has(word)) return word;
    
    let w = word;
    // Selective Banglish/Hinglish phonetic conversions
    w = w.replace(/ph/g, 'f');
    w = w.replace(/chh/g, 'ch');
    // Only turn sh -> s if not a common English word
    if (!w.startsWith('sh') || w.length > 5) {
      w = w.replace(/sh/g, 's');
    }
    w = w.replace(/th/g, 't');
    w = w.replace(/dh/g, 'd');
    w = w.replace(/bh/g, 'b');
    w = w.replace(/gh/g, 'g');
    w = w.replace(/kh/g, 'k');
    w = w.replace(/jh/g, 'j');
    w = w.replace(/ng/g, 'n');
    w = w.replace(/ee/g, 'i');
    w = w.replace(/oo/g, 'u');
    w = w.replace(/aa/g, 'a');
    w = w.replace(/ii/g, 'i');
    w = w.replace(/uu/g, 'u');
    w = w.replace(/([a-z])\1/g, '$1'); // remove doubled letters (e.g. kottoo -> koto)
    return w;
  }).join(' ');
};

export const BANGLISH_MAP = {
  // Greetings & Common
  'assalamu alaikum': 'আসসালামু আলাইকুম', 'salam': 'সালাম', 'hello': 'হ্যালো', 'hi': 'হাই',
  'nam': 'নাম', 'tomar nam': 'তোমার নাম', 'tumi ke': 'তুমি কে', 'apni ke': 'আপনি কে',
  'dhonnobad': 'ধন্যবাদ', 'thanks': 'ধন্যবাদ', 'shagotom': 'স্বাগতম', 'welcome': 'স্বাগতম',
  'kemon aso': 'কেমন আছো', 'kemon achen': 'কেমন আছেন', 'kemon acho': 'কেমন আছো',
  'valo': 'ভালো', 'bhalo': 'ভালো', 'kharap': 'খারাপ', 'shuvo shokal': 'শুভ সকাল',
  
  // Business terms
  'bikri': 'বিক্রি', 'sale': 'বিক্রি', 'sales': 'বিক্রি', 'becha': 'বেচা', 'kena': 'কেনা',
  'khoroch': 'খরচ', 'expense': 'খরচ', 'byay': 'ব্যয়',
  'labh': 'লাভ', 'profit': 'লাভ', 'munafa': 'মুনাফা', 'loss': 'লস', 'loksan': 'লোকসান', 'khoti': 'ক্ষতি',
  'taka': 'টাকা', 'tk': 'টাকা', 'poisha': 'পয়সা', 'poisa': 'পয়সা',
  'baki': 'বাকি', 'due': 'বাকি', 'udhar': 'বাকি', 'dena': 'দেনা', 'paona': 'পাওনা', 'baaki': 'বাকি',
  'pelam': 'পেলাম', 'dilam': 'দিলাম', 'peyechi': 'পেয়েছি', 'peyeci': 'পেয়েছি', 'disi': 'দিছি', 'dyesi': 'দিয়েছি', 'pelum': 'পেলাম',
  'baki pelam': 'বাকি পেলাম', 'baki dilam': 'বাকি দিলাম', 'taka pelam': 'টাকা পেলাম', 'taka dilam': 'টাকা দিলাম',
  'stock': 'স্টক', 'mal': 'মাল', 'maal': 'মাল', 'ponno': 'পণ্য', 'product': 'পণ্য', 'jinish': 'জিনিস',
  'cash': 'ক্যাশ', 'nogod': 'নগদ', 'bank': 'ব্যাংক', 'account': 'একাউন্ট',
  'bikash': 'বিকাশ', 'bkash': 'বিকাশ', 'nagad': 'নগদ', 'rocket': 'রকেট', 'upay': 'উপায়',
  'dokan': 'দোকান', 'shop': 'দোকান', 'bebsha': 'ব্যবসা', 'business': 'ব্যবসা', 'company': 'কোম্পানি',
  'customer': 'কাস্টমার', 'grahok': 'গ্রাহক', 'kreta': 'ক্রেতা', 'kient': 'ক্লায়েন্ট',
  'mohajan': 'মহাজন', 'supplier': 'সরবরাহকারী', 'bepari': 'বেপারী', 'bikreta': 'বিক্রেতা',
  'voucher': 'ভাউচার', 'invoice': 'ইনভয়েস', 'memo': 'মেমো', 'bill': 'বিল', 'roshid': 'রশিদ',
  'bhara': 'ভাড়া', 'rent': 'ভাড়া', 'advance': 'অ্যাডভান্স',
  'beton': 'বেতন', 'salary': 'বেতন', 'mojuri': 'মজুরি', 'hajira': 'হাজিরা',
  'bidyut': 'বিদ্যুৎ', 'electricity': 'বিদ্যুৎ', 'current': 'কারেন্ট',
  'pani': 'পানি', 'water': 'পানি',
  'gas': 'গ্যাস', 'tel': 'তেল', 'internet': 'ইন্টারনেট', 'wifi': 'ওয়াইফাই',
  
  // Questions
  'kivabe': 'কিভাবে', 'koto': 'কত', 'ki': 'কি', 'koi': 'কই', 'kon': 'কোন',
  'kothay': 'কোথায়', 'keno': 'কেনো', 'kobe': 'কবে', 'kokhon': 'কখন', 'kar': 'কার',
  'ache': 'আছে', 'nai': 'নাই', 'korbo': 'করব', 'korte': 'করতে', 'hoyese': 'হয়েছে', 'hobe': 'হবে',
  'parbo': 'পারব', 'chai': 'চাই', 'din': 'দিন', 'raat': 'রাত', 'shokal': 'সকাল', 'bikal': 'বিকাল',
  'aj': 'আজ', 'ajke': 'আজকে', 'kal': 'কাল', 'kalke': 'কালকে', 'porsu': 'পরশু',
  'shuru': 'শুরু', 'shesh': 'শেষ', 'hisab': 'হিসাব', 'hishab': 'হিসাব',
  
  // Financial
  'margin': 'মার্জিন', 'growth': 'গ্রোথ', 'cash flow': 'ক্যাশ ফ্লো', 'liquidity': 'তরল্য',
  'break even': 'ব্রেক ইভেন', 'roi': 'আরওআই', 'kpi': 'কেপিআই', 'valuation': 'ভ্যালুয়েশন',
  'report': 'রিপোর্ট', 'analytics': 'অ্যানালিটিক্স', 'summary': 'সামারি',
  'target': 'টার্গেট', 'goal': 'গোল', 'budget': 'বাজেট', 'plan': 'প্ল্যান',
  'tax': 'ট্যাক্স', 'vat': 'ভ্যাট', 'loan': 'লোন', 'kisti': 'কিস্তি', 'rin': 'ঋণ',
  'investment': 'বিনিয়োগ', 'saving': 'সঞ্চয়', 'insurance': 'বীমা', 'fund': 'ফান্ড',
  
  // Action words
  'jog koro': 'যোগ করো', 'add koro': 'যোগ করো', 'likho': 'লিখো', 'lekho': 'লেখো',
  'dekhao': 'দেখাও', 'bolo': 'বলো', 'shikhao': 'শিখাও', 'janaw': 'জানাও',
  'bojaow': 'বুঝাও', 'help koro': 'সাহায্য করো', 'sahajjo': 'সাহায্য',
  'open koro': 'খোলো', 'close koro': 'বন্ধ করো', 'bondho': 'বন্ধ',
  'shuru koro': 'শুরু করো', 'shesh koro': 'শেষ করো',
  'transfer koro': 'ট্রান্সফার করো', 'pathao': 'পাঠাও', 'send koro': 'সেন্ড করো',
  'delete koro': 'ডিলিট করো', 'edit koro': 'এডিট করো', 'save koro': 'সেভ করো',
  
  // Numbers
  'ek': 'এক', 'dui': 'দুই', 'tin': 'তিন', 'char': 'চার', 'pach': 'পাঁচ', 'paach': 'পাঁচ',
  'choy': 'ছয়', 'shat': 'সাত', 'aat': 'আট', 'noy': 'নয়', 'dosh': 'দশ',
  'egaro': 'এগারো', 'baro': 'বারো', 'tero': 'তেরো', 'chouddo': 'চৌদ্দ', 'ponero': 'পনেরো',
  'sholo': 'ষোলো', 'shotero': 'সতেরো', 'atharo': 'আঠারো', 'unish': 'উনিশ', 'bish': 'বিশ',
  'ponchash': 'পঞ্চাশ', 'eksho': 'একশো', 'hajar': 'হাজার', 'lakh': 'লাখ', 'koti': 'কোটি',
  
  // App specific
  'dashboard': 'ড্যাশবোর্ড', 'khata': 'খাতা', 'closing': 'ক্লোজিং',
  'opening': 'ওপেনিং', 'drawer': 'ড্রয়ার', 'wallet': 'ওয়ালেট',
  'settings': 'সেটিংস', 'contact': 'কন্টাক্ট', 'profile': 'প্রোফাইল',
  'ledgero': 'লেজারো', 'app': 'অ্যাপ', 'software': 'সফটওয়্যার',
  'user': 'ইউজার', 'admin': 'অ্যাডমিন', 'password': 'পাসওয়ার্ড',
  
  // Time and Date
  'mash': 'মাস', 'bochor': 'বছর', 'soptaho': 'সপ্তাহ',
  'january': 'জানুয়ারি', 'february': 'ফেব্রুয়ারি', 'march': 'মার্চ',
  'april': 'এপ্রিল', 'may': 'মে', 'june': 'জুন',
  'july': 'জুলাই', 'august': 'আগস্ট', 'september': 'সেপ্টেম্বর',
  'october': 'অক্টোবর', 'november': 'নভেম্বর', 'december': 'ডিসেম্বর',
  
  // Adjectives
  'choto': 'ছোট', 'boro': 'বড়', 'notun': 'নতুন', 'purano': 'পুরানো',
  'shosta': 'সস্তা', 'dami': 'দামি', 'beshi': 'বেশি', 'kom': 'কম',
  'taratari': 'তাড়াতাড়ি', 'aste': 'আস্তে', 'sundor': 'সুন্দর',
  
  // Family/Relations (common in BD business)
  'bhai': 'ভাই', 'mama': 'মামা', 'kaka': 'কাকা', 'chacha': 'চাচা',
  'bhabi': 'ভাবি', 'apa': 'আপা', 'dada': 'দাদা', 'nana': 'নানা',

  // Phonetic variants (bad accent / typo handling)
  'bikkri': 'বিক্রি', 'bichri': 'বিক্রি', 'bikree': 'বিক্রি', 'bechai': 'বেচাই',
  'koroch': 'খরচ', 'khoroc': 'খরচ', 'khorooch': 'খরচ', 'koroc': 'খরচ', 'khorotch': 'খরচ',
  'lobh': 'লাভ', 'laabh': 'লাভ', 'lab': 'লাভ', 'laab': 'লাভ',
  'tokka': 'টাকা', 'takka': 'টাকা', 'taaka': 'টাকা', 'tka': 'টাকা',
  'beki': 'বাকি', 'bakki': 'বাকি', 'bakie': 'বাকি', 'bkee': 'বাকি',
  'stok': 'স্টক', 'istok': 'স্টক', 'stoc': 'স্টক',
  'naam': 'নাম', 'naame': 'নাম', 'naaam': 'নাম',
  'kaas': 'ক্যাশ', 'cas': 'ক্যাশ', 'kash': 'ক্যাশ', 'cyas': 'ক্যাশ',
  'ngogod': 'নগদ', 'nogood': 'নগদ', 'nogd': 'নগদ',
  'bennk': 'ব্যাংক', 'baynk': 'ব্যাংক', 'baank': 'ব্যাংক',
  'bikkas': 'বিকাশ', 'bkas': 'বিকাশ', 'bkash': 'বিকাশ', 'beekash': 'বিকাশ',
  'dukan': 'দোকান', 'duukan': 'দোকান', 'dokaan': 'দোকান',
  'bebsa': 'ব্যবসা', 'bebosha': 'ব্যবসা', 'byabsha': 'ব্যবসা', 'bybsa': 'ব্যবসা',
  'kastomer': 'কাস্টমার', 'kustomer': 'কাস্টমার', 'castomer': 'কাস্টমার',
  'grahak': 'গ্রাহক', 'grahk': 'গ্রাহক', 'graahok': 'গ্রাহক',
  'bhada': 'ভাড়া', 'vaara': 'ভাড়া', 'vhara': 'ভাড়া', 'vara': 'ভাড়া',
  'betan': 'বেতন', 'betn': 'বেতন', 'betun': 'বেতন',
  'bidut': 'বিদ্যুৎ', 'biddut': 'বিদ্যুৎ', 'bidyuit': 'বিদ্যুৎ',
  'korvabe': 'কিভাবে', 'kibhabe': 'কিভাবে', 'kibabe': 'কিভাবে', 'kemne': 'কেমনে', 'kemone': 'কেমনে',
  'kto': 'কত', 'kotoo': 'কত', 'coto': 'কত', 'kta': 'কত',
  'aaj': 'আজ', 'aajke': 'আজকে', 'ajk': 'আজকে', 'ajkee': 'আজকে',
  'hishab': 'হিসাব', 'hishaab': 'হিসাব', 'hisap': 'হিসাব', 'heshab': 'হিসাব',
  'marjin': 'মার্জিন', 'maarjin': 'মার্জিন',
  'grot': 'গ্রোথ', 'groth': 'গ্রোথ', 'grwth': 'গ্রোথ',
  'repot': 'রিপোর্ট', 'riport': 'রিপোর্ট', 'reprt': 'রিপোর্ট',
  'dhasboard': 'ড্যাশবোর্ড', 'dashbord': 'ড্যাশবোর্ড', 'dasboard': 'ড্যাশবোর্ড',
  'khataa': 'খাতা', 'kata': 'খাতা', 'khatta': 'খাতা',
  'closng': 'ক্লোজিং', 'klosing': 'ক্লোজিং', 'klojing': 'ক্লোজিং',
  'opnening': 'ওপেনিং', 'oopening': 'ওপেনিং',
  'droyer': 'ড্রয়ার', 'droyar': 'ড্রয়ার', 'droar': 'ড্রয়ার',
  'wallat': 'ওয়ালেট', 'wolet': 'ওয়ালেট', 'oalet': 'ওয়ালেট',
  
  // Common Banglish sentences/phrases
  'bikri koto': 'বিক্রি কত', 'bikri koto holo': 'বিক্রি কত হলো',
  'ajke bikri': 'আজকে বিক্রি', 'ajke khoroch': 'আজকে খরচ',
  'ajke labh': 'আজকে লাভ', 'ajke hisab': 'আজকে হিসাব',
  'baki koto': 'বাকি কত', 'baki list': 'বাকির তালিকা',
  'stock koto': 'স্টক কত', 'mal koto ache': 'মাল কত আছে',
  'taka koto': 'টাকা কত', 'taka koto ache': 'টাকা কত আছে',
  'cash koto': 'ক্যাশ কত', 'cash koto ache': 'ক্যাশ কত আছে',
  'din shuru': 'দিন শুরু', 'din shesh': 'দিন শেষ',
  'report dekhao': 'রিপোর্ট দেখাও', 'hisab dekhao': 'হিসাব দেখাও',
  'tomar nam ki': 'তোমার নাম কি', 'tumi ke': 'তুমি কে',
  'ki korte paro': 'কি করতে পারো', 'help koro': 'সাহায্য করো',
  'sale add koro': 'বিক্রি যোগ করো', 'expense add koro': 'খরচ যোগ করো',
  'product add koro': 'পণ্য যোগ করো', 'contact add koro': 'কন্টাক্ট যোগ করো',
  'margin barao': 'মার্জিন বাড়াও', 'growth barao': 'গ্রোথ বাড়াও',
  'loan nebo': 'লোন নেবো', 'rin nebo': 'ঋণ নেবো',
  'bebsha baranor upay': 'ব্যবসা বাড়ানোর উপায়',
  'cha khoroch': 'চা খরচ', 'nasta khoroch': 'নাস্তা খরচ',
  'transport khoroch': 'পরিবহন খরচ',
  'koyta baje': 'কয়টা বাজে', 'koita baje': 'কয়টা বাজে', 'koto baje': 'কত বাজে',
  'shomoy koto': 'সময় কত', 'somoy koto': 'সময় কত', 'ajke ki bar': 'আজকে কি বার', 'ajker tarikh': 'আজকের তারিখ'
};

export const HINGLISH_MAP = {
  // Greetings
  'namaste': 'नमस्ते', 'namaskar': 'नमस्कार', 'hello': 'हैलो', 'salam': 'सलाम',
  'kaise ho': 'कैसे हो', 'kya hal': 'क्या हाल', 'shukriya': 'शुक्रिया', 'dhanyavad': 'धन्यवाद',
  'aapka naam': 'आपका नाम', 'tum kaun': 'तुम कौन', 'kaun ho': 'कौन हो',
  
  // Business
  'bikri': 'बिक्री', 'sale': 'बिक्री', 'bechna': 'बेचना', 'kharcha': 'खर्चा', 'kharche': 'खर्चे',
  'expense': 'खर्चा', 'kharch': 'खर्च', 'vyay': 'व्यय',
  'munafa': 'मुनाफा', 'labh': 'लाभ', 'fayda': 'फायदा', 'profit': 'मुनाफा',
  'nuksan': 'नुकसान', 'loss': 'नुकसान', 'ghata': 'घाटा',
  'paisa': 'पैसा', 'paise': 'पैसे', 'rupaya': 'रुपया', 'rupaye': 'रुपये', 'rs': 'रुपये',
  'udhar': 'उधार', 'udhaar': 'उधार', 'baki': 'बाकी', 'bakaya': 'बकाया',
  'dena': 'देना', 'lena': 'लेना', 'wapas': 'वापस', 'wapsi': 'वापसी',
  'stock': 'स्टॉक', 'maal': 'माल', 'mal': 'माल', 'saman': 'सामान', 'samaan': 'सामान',
  'kitna baki': 'कितना बाकी', 'kitna bacha': 'कितना बचा', 'kitna maal': 'कितना माल', 'mal kitna': 'माल कितना',
  'product': 'प्रोडक्ट', 'cheez': 'चीज़', 'vastu': 'वस्तु',
  'cash': 'कैश', 'naqad': 'नकद', 'naqd': 'नकद',
  'bank': 'बैंक', 'khata': 'खाता', 'account': 'खाता',
  'dukaan': 'दुकान', 'dukan': 'दुकान', 'shop': 'दुकान',
  'business': 'बिज़नेस', 'vyapar': 'व्यापार', 'vyapaar': 'व्यापार', 'karobar': 'कारोबार',
  'grahak': 'ग्राहक', 'customer': 'ग्राहक', 'kharidar': 'खरीदार',
  'supplier': 'सप्लायर', 'aapurti': 'आपूर्ति', 'thokdar': 'थोकदार',
  'bill': 'बिल', 'invoice': 'इनवॉइस', 'raseed': 'रसीद',
  'kiraya': 'किराया', 'rent': 'किराया', 'kirayaa': 'किराया',
  'talab': 'तलब', 'tankhwah': 'तनख्वाह', 'salary': 'तनख्वाह', 'vetan': 'वेतन',
  'bijli': 'बिजली', 'electricity': 'बिजली', 'current': 'करंट',
  'paani': 'पानी', 'water': 'पानी',
  
  // Questions
  'kaise': 'कैसे', 'kitna': 'कितना', 'kitne': 'कितने', 'kya': 'क्या', 'kaun': 'कौन',
  'kahan': 'कहाँ', 'kyun': 'क्युँ', 'kab': 'कब', 'kiska': 'किसका',
  'hai': 'है', 'nahi': 'नहीं', 'karunga': 'करूँगा', 'karna': 'करना', 'karo': 'करो',
  'hoga': 'होगा', 'chahiye': 'चाहिए', 'chahie': 'चाहिए',
  'aaj': 'आज', 'kal': 'कल', 'parso': 'परसों',
  'subah': 'सुबह', 'sham': 'शाम', 'raat': 'रात', 'din': 'दिन',
  'shuru': 'शुरू', 'khatam': 'खतम', 'band': 'बंद',
  'baje': 'बजे', 'kitna baje': 'कितना बजे', 'kitne baje': 'कितने बजे',
  'samay': 'समय', 'samay kya': 'समय क्या', 'waqt': 'वक्त', 'wakt': 'वक्त', 'ghadi': 'घड़ी',
  
  // Financial
  'margin': 'मार्जिन', 'growth': 'ग्रोथ', 'cash flow': 'कैश फ्लो',
  'break even': 'ब्रेक ईवन', 'target': 'टार्गेट', 'budget': 'बजट',
  'tax': 'टैक्स', 'loan': 'लोन', 'rin': 'ऋण', 'karz': 'कर्ज़', 'karza': 'कर्ज़ा',
  'nivesh': 'निवेश', 'bachat': 'बचत', 'beema': 'बीमा', 'bima': 'बीमा',
  'report': 'रिपोर्ट', 'hisab': 'हिसाब', 'hisaab': 'हिसाब',
  
  // Actions
  'jodo': 'जोड़ो', 'likho': 'लिखो', 'dikhao': 'दिखाओ', 'batao': 'बताओ',
  'sikhao': 'सिखाओ', 'samjhao': 'समझाओ', 'madad': 'मदद', 'help': 'मदद',
  'kholo': 'खोलो', 'band karo': 'बंद करो',
  'transfer': 'ट्रांसफर', 'bhejo': 'भेजो',
  
  // Numbers
  'ek': 'एक', 'do': 'दो', 'teen': 'तीन', 'char': 'चार', 'paanch': 'पाँच',
  'chhe': 'छे', 'saat': 'सात', 'aath': 'आठ', 'nau': 'नौ', 'das': 'दस',
  'bees': 'बीस', 'pachas': 'पचास', 'sau': 'सौ', 'hazaar': 'हज़ार', 'lakh': 'लाख', 'crore': 'करोड़',
  
  // App
  'dashboard': 'डैशबोर्ड', 'khata': 'खाता', 'closing': 'क्लोज़िंग',
  'opening': 'ओपनिंग', 'drawer': 'ड्रॉर', 'wallet': 'वॉलेट',
  'settings': 'सेटिंग्स', 'contact': 'संपर्क',
  
  // Common phrases
  'bikri kitni': 'बिक्री कितनी', 'bikri kitni hui': 'बिक्री कितनी हुई',
  'aaj ka hisab': 'आज का हिसाब', 'aaj kitna hua': 'आज कितना हुआ',
  'udhar kitna': 'उधार कितना', 'karz kitna': 'कर्ज़ कितना',
  'stock kitna': 'स्टॉक कितना', 'maal kitna hai': 'माल कितना है',
  'paisa kitna': 'पैसा कितना', 'cash kitna': 'कैश कितना',
  'din shuru karo': 'दिन शुरू करो', 'din band karo': 'दिन बंद करो',
  'report dikhao': 'रिपोर्ट दिखाओ', 'hisab dikhao': 'हिसाब दिखाओ',
  'munafa kitna': 'मुनाफा कितना', 'munafa badhao': 'मुनाफा बढ़ाओ',
  'kharcha kitna': 'खर्चा कितना', 'kharcha kam karo': 'खर्चा कम करो',
  'vyapar badhao': 'व्यापार बढ़ाओ', 'business badhao': 'बिज़नेस बढ़ाओ',
  'tumhara naam kya': 'तुम्हारा नाम क्या', 'naam kya hai': 'नाम क्या है',
  'kya kar sakte ho': 'क्या कर सकते हो', 'madad karo': 'मदद करो',
};

// Pre-sorted and pre-compiled regexes for multi-word phrases (cached once at module load)
const SORTED_BN_KEYS = Object.keys(BANGLISH_MAP).sort((a, b) => b.length - a.length);
const BN_PHRASE_ENTRIES = SORTED_BN_KEYS
  .filter(k => k.includes(' '))
  .map(k => ({ regex: new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), val: BANGLISH_MAP[k] }));

const SORTED_HI_KEYS = Object.keys(HINGLISH_MAP).sort((a, b) => b.length - a.length);
const HI_PHRASE_ENTRIES = SORTED_HI_KEYS
  .filter(k => k.includes(' '))
  .map(k => ({ regex: new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), val: HINGLISH_MAP[k] }));

// Levenshtein distance for fuzzy matching (handles typos up to distance 2)
const levenshtein = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i-1] === a[j-1]) matrix[i][j] = matrix[i-1][j-1];
      else matrix[i][j] = Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
    }
  }
  return matrix[b.length][a.length];
};

// Cached fuzzy lookup: finds best match within edit distance
const _fuzzyCache = new Map();
export const fuzzyLookup = (word, dictionary) => {
  if (!word || word.length < 4) return null;
  if (dictionary[word]) return dictionary[word];
  if (COMMON_ENGLISH_WORDS.has(word)) return null;
  
  const cacheKey = word + '_' + (dictionary === BANGLISH_MAP ? 'bn' : 'hi');
  if (_fuzzyCache.has(cacheKey)) return _fuzzyCache.get(cacheKey);

  let bestMatch = null;
  let bestDist = word.length <= 4 ? 2 : 3; // for <=4 chars, only 1 edit distance allowed
  const keys = Object.keys(dictionary);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key.includes(' ')) continue; // only match single words
    if (Math.abs(key.length - word.length) > (word.length <= 4 ? 1 : 2)) continue;
    // On short words, first letter MUST match
    if (key[0] !== word[0]) continue;
    
    const dist = levenshtein(word, key);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = dictionary[key];
      if (dist === 1) break; // Early exit on 1-char typo
    }
  }
  
  _fuzzyCache.set(cacheKey, bestMatch);
  return bestMatch;
};

const transliterateBanglish = (text) => {
  let result = text.toLowerCase();
  for (let i = 0; i < BN_PHRASE_ENTRIES.length; i++) {
    result = result.replace(BN_PHRASE_ENTRIES[i].regex, BN_PHRASE_ENTRIES[i].val);
  }
  const words = result.split(/(\s+|[.,!?:;]+)/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (BANGLISH_MAP[w]) {
      words[i] = BANGLISH_MAP[w];
    }
  }
  return words.join('');
};

const transliterateHinglish = (text) => {
  let result = text.toLowerCase();
  for (let i = 0; i < HI_PHRASE_ENTRIES.length; i++) {
    result = result.replace(HI_PHRASE_ENTRIES[i].regex, HI_PHRASE_ENTRIES[i].val);
  }
  const words = result.split(/(\s+|[.,!?:;]+)/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (HINGLISH_MAP[w]) {
      words[i] = HINGLISH_MAP[w];
    }
  }
  return words.join('');
};

// Distinctive language signal sets to differentiate English, Banglish, and Hinglish with 100% precision
const ENGLISH_STRUCTURAL_WORDS = new Set([
  'how', 'what', 'why', 'where', 'when', 'who', 'which', 'is', 'are', 'am', 'was', 'were',
  'my', 'your', 'his', 'her', 'our', 'their', 'the', 'this', 'that', 'these', 'those',
  'much', 'many', 'show', 'explain', 'tell', 'give', 'add', 'view', 'meaning', 'define',
  'definition', 'guide', 'can', 'will', 'would', 'should', 'could', 'do', 'does', 'did',
  'have', 'has', 'had', 'today', 'yesterday', 'tomorrow', 'good', 'morning', 'rule', 'rules',
  'advice', 'status', 'overview', 'quota', 'target', 'cycle', 'conversion', 'reserve', 'reserves',
  'operating', 'statement', 'accounting', 'audit', 'ratio', 'leverage', 'break', 'even', 'runway',
  'model', 'register', 'time', 'clock', 'date', 'weather', 'climate', 'temperature', 'hour', 'minute',
  'now', 'call', 'name', 'work', 'working', 'help', 'assist'
]);

const DISTINCTIVE_BANGLISH_WORDS = new Set([
  'koto', 'kotoo', 'kotoi', 'ki', 'kee', 'kivabe', 'kemne', 'ajke', 'ajker', 'bolo', 'bolun',
  'dekhao', 'dekhaw', 'dekhbo', 'debo', 'pabo', 'ache', 'ase', 'hobe', 'korbo', 'kore',
  'kori', 'lagbe', 'parbo', 'amar', 'tomar', 'apnar', 'tumi', 'apni', 'tui', 'amader',
  'shuru', 'shesh', 'khata', 'khoroch', 'kena', 'becha', 'shob', 'sob', 'aro', 'ekhon',
  'pore', 'dokan', 'ponno', 'jinish', 'tk', 'taka', 'poisha', 'labh', 'loksan', 'khoti',
  'boro', 'choto', 'bhalo', 'valo', 'kharap'
]);

const DISTINCTIVE_HINGLISH_WORDS = new Set([
  'kitna', 'kitni', 'kitne', 'kya', 'kaise', 'kaisa', 'kaisi', 'batao', 'bataiye', 'dikhao',
  'hai', 'hain', 'tha', 'thi', 'hoga', 'hogi', 'honge', 'karo', 'kare', 'karna',
  'mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'aapka', 'aapki', 'apka', 'apki',
  'tumhara', 'tumhari', 'humara', 'kaun', 'kahan', 'kidhar', 'kyun', 'kyu', 'aaj', 'kal',
  'parso', 'pehle', 'baad', 'madad', 'vyapar', 'karobar', 'kharcha', 'kharche', 'bechna',
  'maal', 'saman', 'samaan', 'munafa', 'fayda', 'nuksan', 'ghata', 'paisa', 'paise',
  'rupaya', 'rupaye', 'bolna', 'chahiye', 'hua', 'hui'
]);

export const preprocessQuery = (rawQuery, lang) => {
  let q = rawQuery.trim().toLowerCase();
  q = normalizeBengaliDigits(q);
  
  // Detect script
  const hasBengali = /[\u0980-\u09FF]/.test(q);
  const hasDevanagari = /[\u0900-\u097F]/.test(q);
  const hasLatin = /[a-zA-Z]/.test(q);
  
  let detectedLang = lang;
  let transliteratedText = '';

  if (hasBengali && !hasDevanagari) {
    detectedLang = 'bn';
    transliteratedText = q;
  } else if (hasDevanagari && !hasBengali) {
    detectedLang = 'hi';
    transliteratedText = q;
  } else if (hasLatin && !hasBengali && !hasDevanagari) {
    // Latin text — could be English, Banglish, or Hinglish
    const cleanTokens = q.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    
    let enScore = 0;
    let bnScore = 0;
    let hiScore = 0;

    for (const token of cleanTokens) {
      if (ENGLISH_STRUCTURAL_WORDS.has(token)) enScore++;
      if (DISTINCTIVE_BANGLISH_WORDS.has(token)) bnScore++;
      if (DISTINCTIVE_HINGLISH_WORDS.has(token)) hiScore++;
    }

    // Pure English check: contains English structural/grammatical words and zero South Asian markers
    if (enScore > 0 && bnScore === 0 && hiScore === 0) {
      return { processedQuery: q, detectedLang: 'en', transliteratedText: '' };
    }

    // Explicit English preference check: If user selected English in UI, prioritize English unless South Asian signals strictly dominate
    if (lang === 'en' && (enScore >= (bnScore + hiScore) || (bnScore === 0 && hiScore === 0))) {
      return { processedQuery: q, detectedLang: 'en', transliteratedText: '' };
    }

    // English dominance check: English words outnumber South Asian markers
    if (enScore > 0 && enScore > (bnScore + hiScore)) {
      return { processedQuery: q, detectedLang: 'en', transliteratedText: '' };
    }

    const phoneticNormalized = normalizePhonetics(q);
    
    // Try Banglish transliteration (direct + phonetic)
    const bnDirect = transliterateBanglish(q);
    const bnPhonetic = transliterateBanglish(phoneticNormalized);
    
    // Try Hinglish transliteration (direct + phonetic)
    const hiDirect = transliterateHinglish(q);
    const hiPhonetic = transliterateHinglish(phoneticNormalized);
    
    // Try fuzzy matching on individual words
    const words = q.split(/\s+/);
    const fuzzyBn = words.map(w => fuzzyLookup(w, BANGLISH_MAP) || w).join(' ');
    const fuzzyHi = words.map(w => fuzzyLookup(w, HINGLISH_MAP) || w).join(' ');
    
    const bnMatches = (bnDirect !== q ? 2 : 0) + (bnPhonetic !== phoneticNormalized ? 1 : 0) + (fuzzyBn !== q ? 1 : 0) + (bnScore * 3);
    const hiMatches = (hiDirect !== q ? 2 : 0) + (hiPhonetic !== phoneticNormalized ? 1 : 0) + (fuzzyHi !== q ? 1 : 0) + (hiScore * 3);

    const parts = new Set();
    parts.add(q); // original

    if (hiScore > bnScore) {
      detectedLang = 'hi';
      if (hiDirect !== q) parts.add(hiDirect);
      if (hiPhonetic !== phoneticNormalized) parts.add(hiPhonetic);
      if (fuzzyHi !== q) parts.add(fuzzyHi);
      transliteratedText = hiDirect !== q ? hiDirect : hiPhonetic;
    } else if (bnScore > hiScore) {
      detectedLang = 'bn';
      if (bnDirect !== q) parts.add(bnDirect);
      if (bnPhonetic !== phoneticNormalized) parts.add(bnPhonetic);
      if (fuzzyBn !== q) parts.add(fuzzyBn);
      transliteratedText = bnDirect !== q ? bnDirect : bnPhonetic;
    } else if (hiMatches > bnMatches && hiMatches > 0) {
      detectedLang = 'hi';
      if (hiDirect !== q) parts.add(hiDirect);
      if (hiPhonetic !== phoneticNormalized) parts.add(hiPhonetic);
      if (fuzzyHi !== q) parts.add(fuzzyHi);
      transliteratedText = hiDirect !== q ? hiDirect : hiPhonetic;
    } else if (bnMatches > 0) {
      detectedLang = 'bn';
      if (bnDirect !== q) parts.add(bnDirect);
      if (bnPhonetic !== phoneticNormalized) parts.add(bnPhonetic);
      if (fuzzyBn !== q) parts.add(fuzzyBn);
      transliteratedText = bnDirect !== q ? bnDirect : bnPhonetic;
    } else {
      // Pure English
      detectedLang = 'en';
    }
    
    q = [...parts].join(' ');
  }
  
  // For mixed script (Bengali + Latin or Devanagari + Latin)
  if ((hasBengali || hasDevanagari) && hasLatin) {
    const dict = hasBengali ? BANGLISH_MAP : HINGLISH_MAP;
    const words = q.split(/(\s+|[.,!?:;]+)/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i].toLowerCase();
      if (/[a-zA-Z]/.test(w)) {
        const normalized = normalizePhonetics(w);
        const translation = dict[w] || dict[normalized] || fuzzyLookup(w, dict) || fuzzyLookup(normalized, dict);
        if (translation) {
          words[i] = translation;
        }
      }
    }
    q = words.join('');
    detectedLang = hasBengali ? 'bn' : 'hi';
    transliteratedText = q;
  }
  
  return { processedQuery: q, detectedLang, transliteratedText };
};

/**
 * Local Heuristic Natural Language Intent Parser & Answer Generator.
 * Delivers PhD-grade financial reasoning, economic modeling, and business growth playbooks
 * instantly on the client side — 100% offline and free of cost.
 */
export const processLocalAIQuery = (query, context, lang = 'bn', voiceEntities = null) => {
  const { processedQuery, detectedLang, transliteratedText } = preprocessQuery(query, lang);
  const q = processedQuery;
  const isEn = detectedLang === 'en';
  const isHi = detectedLang === 'hi';

  // ═══════════════════════════════════════════════════════════════════════════════
  // ENTITY-BASED SMART INTENT RESOLUTION (Phase 2+3: voiceEntityExtractor integration)
  // If structured entities are provided, generate action cards directly.
  // This runs BEFORE the keyword waterfall and handles 15 new action card types.
  // ═══════════════════════════════════════════════════════════════════════════════
  if (voiceEntities && voiceEntities.intent && voiceEntities.intent !== 'unknown') {
    const ve = voiceEntities;
    const amt = ve.amount;
    const productName = ve.product?.name || '';
    const contactName = ve.contact?.name || '';

    // --- UNDO ---
    if (ve.intent === 'undo') {
      return {
        reply: isEn ? '✅ Last action undone.' : isHi ? '✅ पिछला काम रद्द।' : '✅ শেষ কাজটি বাতিল করা হচ্ছে।',
        actionCard: { type: 'UNDO_LAST' },
        isInstantIntent: true
      };
    }

    // --- REDO / RE-RECORD ---
    if (ve.intent === 'redo') {
      return {
        reply: isEn ? '🎤 Say again.' : isHi ? '🎤 दोबारा बोलें।' : '🎤 আবার বলুন, শুনছি।',
        isInstantIntent: true
      };
    }

    // --- DAY OPEN ---
    if (ve.intent === 'day_open') {
      return {
        reply: isEn ? '🏪 Opening shop...' : isHi ? '🏪 दुकान खोल रहा हूँ...' : '🏪 দোকান খোলা হচ্ছে...',
        actionCard: { type: 'DAY_OPEN_DRAFT' },
        isInstantIntent: true
      };
    }

    // --- DAY CLOSE ---
    if (ve.intent === 'day_close') {
      return {
        reply: isEn ? '🌙 Closing day...' : isHi ? '🌙 दिन बंद कर रहा हूँ...' : '🌙 দিন শেষ, ক্লোজিং চলছে...',
        actionCard: { type: 'DAY_CLOSE_DRAFT' },
        isInstantIntent: true
      };
    }

    // --- PRODUCT ADD ---
    if (ve.intent === 'product_add') {
      return {
        reply: isEn ? `📦 Adding new product.` : isHi ? `📦 नया प्रोडक्ट जोड़ रहा हूँ।` : `📦 নতুন পণ্য যোগ হচ্ছে।`,
        actionCard: {
          type: 'PRODUCT_ADD_DRAFT',
          name: productName || 'নতুন পণ্য',
          unit: ve.unit || 'piece',
          buyPrice: 0,
          sellPrice: 0,
          openingStock: ve.quantity || 0
        },
        isInstantIntent: true
      };
    }

    // --- CONTACT ADD ---
    if (ve.intent === 'contact_add') {
      return {
        reply: isEn ? `👤 Adding new contact.` : isHi ? `👤 नया कस्टमर जोड़ रहा हूँ।` : `👤 নতুন কাস্টমার যোগ হচ্ছে।`,
        actionCard: {
          type: 'CONTACT_ADD_DRAFT',
          contactName: contactName || 'নতুন কাস্টমার',
          contactType: q.includes('সাপ্লায়ার') || q.includes('supplier') ? 'supplier' : 'customer',
          phone: '',
          openingBalance: 0
        },
        isInstantIntent: true
      };
    }

    // --- STOCK SELL (specific product) ---
    if (ve.intent === 'stock_sell' && ve.product) {
      const qty = ve.quantity || 1;
      const sellAmt = amt || (qty * (ve.product.sellPrice || 0));
      return {
        reply: isEn 
          ? `📦 Selling ${qty} ${ve.unit || ve.product.unit || 'piece'} of ${productName}.`
          : isHi 
          ? `📦 ${productName} ${qty} ${ve.unit || ve.product.unit || 'पीस'} बेच रहा हूँ।`
          : `📦 ${productName} ${qty} ${ve.unit || ve.product.unit || 'টা'} বিক্রি হচ্ছে।`,
        actionCard: {
          type: 'STOCK_SELL_DRAFT',
          itemId: ve.product.id,
          itemName: productName,
          quantity: qty,
          amount: sellAmt,
          note: `${productName} বিক্রি (ভয়েস)`
        },
        isInstantIntent: true
      };
    }

    // --- RESTOCK / PURCHASE ---
    if (ve.intent === 'restock' && ve.product) {
      const qty = ve.quantity || 1;
      const buyAmt = amt || (qty * (ve.product.buyPrice || 0));
      return {
        reply: isEn 
          ? `📥 Restocking ${qty} ${ve.unit || ve.product.unit || 'piece'} of ${productName}.`
          : isHi 
          ? `📥 ${productName} ${qty} ${ve.unit || ve.product.unit || 'पीस'} रिस्टॉक।`
          : `📥 ${productName} ${qty} ${ve.unit || ve.product.unit || 'টা'} রিস্টক হচ্ছে।`,
        actionCard: {
          type: 'STOCK_RESTOCK_DRAFT',
          itemId: ve.product.id,
          itemName: productName,
          quantity: qty,
          buyPrice: ve.product.buyPrice,
          amount: buyAmt,
          sourceWallet: ve.wallet || 'hand_cash',
          note: `${productName} ক্রয় (ভয়েস)`
        },
        isInstantIntent: true
      };
    }

    // --- CREDIT SALE (product + contact + baki) ---
    if (ve.intent === 'credit_sale' && ve.product && (ve.contact || ve.contactName)) {
      const qty = ve.quantity || 1;
      const sellAmt = amt || (qty * (ve.product.sellPrice || 0));
      const cName = ve.contact?.name || ve.contactName || contactName || (isEn ? 'Customer' : 'কাস্টমার');
      return {
        reply: isEn 
          ? `📝 Credit sale: ${qty} ${productName} to ${cName} (৳${sellAmt}).`
          : isHi 
          ? `📝 ${cName} को ${qty} ${productName} उधार (৳${sellAmt})।`
          : `📝 ${cName}কে ${qty} ${ve.unit || 'টা'} ${productName} বাকিতে (৳${sellAmt})।`,
        actionCard: {
          type: 'CREDIT_SALE_DRAFT',
          itemId: ve.product.id,
          itemName: productName,
          contactId: ve.contact?.id || null,
          contactName: cName,
          quantity: qty,
          amount: sellAmt,
          note: `${productName} বাকিতে ${cName} (ভয়েস)`
        },
        isInstantIntent: true
      };
    }

    // --- FUND TRANSFER ---
    if (ve.intent === 'transfer' && amt && ve.transferWallets) {
      const walletNames = { hand_cash: 'ক্যাশ', bkash_agent: 'বিকাশ', nagad_uddokta: 'নগদ', rocket: 'রকেট', bank_account: 'ব্যাংক' };
      const fromName = walletNames[ve.transferWallets.from] || ve.transferWallets.from;
      const toName = walletNames[ve.transferWallets.to] || ve.transferWallets.to;
      return {
        reply: isEn 
          ? `💸 Transferring ৳${amt} from ${fromName} to ${toName}.`
          : isHi 
          ? `💸 ${fromName} से ${toName} में ৳${amt} ट्रांसफर।`
          : `💸 ${fromName} থেকে ${toName} তে ৳${amt} ট্রান্সফার হচ্ছে।`,
        actionCard: {
          type: 'FUND_TRANSFER_DRAFT',
          amount: amt,
          fromWallet: ve.transferWallets.from,
          toWallet: ve.transferWallets.to,
          note: `${fromName} → ${toName} ট্রান্সফার`
        },
        isInstantIntent: true
      };
    }

    // --- OWNER DRAW ---
    if (ve.intent === 'owner_draw' && amt) {
      return {
        reply: isEn ? `🏦 Owner withdrew ৳${amt}.` : isHi ? `🏦 मालिक ने ৳${amt} निकाला।` : `🏦 মালিক ৳${amt} নিলেন।`,
        actionCard: {
          type: 'OWNER_DRAW_DRAFT',
          amount: amt,
          note: 'মালিক নিলেন (ভয়েস)'
        },
        isInstantIntent: true
      };
    }

    // --- OWNER INJECT ---
    if (ve.intent === 'owner_inject' && amt) {
      return {
        reply: isEn ? `🏦 Owner invested ৳${amt}.` : isHi ? `🏦 मालिक ने ৳${amt} दिया।` : `🏦 মালিক ৳${amt} দিলেন।`,
        actionCard: {
          type: 'OWNER_INJECT_DRAFT',
          amount: amt,
          note: 'মালিক দিলেন (ভয়েস)'
        },
        isInstantIntent: true
      };
    }

    // --- DAMAGE / WRITE-OFF ---
    if (ve.intent === 'damage' && ve.product) {
      const qty = ve.quantity || 1;
      return {
        reply: isEn 
          ? `⚠️ Writing off ${qty} ${productName} as damaged.`
          : isHi 
          ? `⚠️ ${qty} ${productName} डैमेज लिखा जा रहा है।`
          : `⚠️ ${qty} ${ve.unit || 'টা'} ${productName} নষ্ট/ড্যামেজ হিসেবে বাদ হচ্ছে।`,
        actionCard: {
          type: 'DAMAGE_DRAFT',
          itemId: ve.product.id,
          itemName: productName,
          quantity: qty,
          reason: 'damage',
          note: `${productName} নষ্ট (ভয়েস)`
        },
        isInstantIntent: true
      };
    }

    // --- SALARY ---
    if (ve.intent === 'salary_pay' && amt) {
      return {
        reply: isEn 
          ? `💰 Paying salary ৳${amt}${contactName ? ' to ' + contactName : ''}.`
          : isHi 
          ? `💰 ৳${amt} सैलरी${contactName ? ' ' + contactName + ' को' : ''}।`
          : `💰 ৳${amt} বেতন দেওয়া হচ্ছে${contactName ? ' ' + contactName + 'কে' : ''}।`,
        actionCard: {
          type: 'SALARY_DRAFT',
          amount: amt,
          employeeName: contactName || 'কর্মচারী',
          wallet: ve.wallet || 'hand_cash',
          note: `বেতন ${contactName || ''} (ভয়েস)`
        },
        isInstantIntent: true
      };
    }

    // --- RECHARGE ---
    if (ve.intent === 'recharge' && amt) {
      return {
        reply: isEn ? `📱 Recharge ৳${amt}.` : isHi ? `📱 ৳${amt} रिचार्ज।` : `📱 ৳${amt} রিচার্জ হচ্ছে।`,
        actionCard: {
          type: 'RECHARGE_DRAFT',
          amount: amt,
          note: `মোবাইল রিচার্জ ৳${amt} (ভয়েস)`
        },
        isInstantIntent: true
      };
    }

    // --- SERVICE INCOME ---
    if (ve.intent === 'service_income' && amt) {
      return {
        reply: isEn ? `🛠 Service income ৳${amt}.` : isHi ? `🛠 सर्विस इनकम ৳${amt}।` : `🛠 সার্ভিস আয় ৳${amt} রেকর্ড হচ্ছে।`,
        actionCard: {
          type: 'SERVICE_INCOME_DRAFT',
          amount: amt,
          serviceType: q.includes('ফটোকপি') || q.includes('photocopy') ? 'photocopy' : 'service',
          note: `সার্ভিস আয় (ভয়েস)`
        },
        isInstantIntent: true
      };
    }

    // --- CHECK PRICE (query, no action card) ---
    if (ve.intent === 'check_price' && ve.product) {
      return {
        reply: isEn 
          ? `💲 ${productName}: Buy ৳${ve.product.buyPrice || 0}, Sell ৳${ve.product.sellPrice || 0}, Profit ৳${(ve.product.sellPrice || 0) - (ve.product.buyPrice || 0)}.`
          : isHi 
          ? `💲 ${productName}: खरीद ৳${ve.product.buyPrice || 0}, बिक्री ৳${ve.product.sellPrice || 0}, मुनाफा ৳${(ve.product.sellPrice || 0) - (ve.product.buyPrice || 0)}।`
          : `💲 ${productName}: কেনা ৳${ve.product.buyPrice || 0}, বিক্রি ৳${ve.product.sellPrice || 0}, লাভ ৳${(ve.product.sellPrice || 0) - (ve.product.buyPrice || 0)}।`,
        isInstantIntent: true
      };
    }

    // --- CHECK STOCK (query, no action card) ---
    if (ve.intent === 'check_stock' && ve.product) {
      const stock = ve.product.closingStock ?? ve.product.openingStock ?? 0;
      return {
        reply: isEn 
          ? `📦 ${productName}: ${stock} ${ve.product.unit || 'pieces'} in stock.`
          : isHi 
          ? `📦 ${productName}: ${stock} ${ve.product.unit || 'पीस'} स्टॉक में।`
          : `📦 ${productName}: ${stock} ${ve.product.unit || 'টা'} স্টকে আছে।`,
        isInstantIntent: true
      };
    }

    // --- CHECK DUE (query for specific contact) ---
    if (ve.intent === 'check_due' && ve.contact) {
      const bal = Number(ve.contact.currentBalance) || 0;
      return {
        reply: isEn 
          ? `📋 ${contactName}: Due ৳${Math.abs(bal)} ${bal > 0 ? '(they owe you)' : bal < 0 ? '(you owe them)' : '(settled)'}.`
          : isHi 
          ? `📋 ${contactName}: बकाया ৳${Math.abs(bal)} ${bal > 0 ? '(वो देंगे)' : bal < 0 ? '(आप दोगे)' : '(हिसाब बराबर)'}।`
          : `📋 ${contactName}: বাকি ৳${Math.abs(bal)} ${bal > 0 ? '(পাবেন)' : bal < 0 ? '(দেবেন)' : '(মিটে গেছে)'}।`,
        isInstantIntent: true
      };
    }

    // --- DUE GIVE (entity-based, with or without contact) ---
    if (ve.intent === 'due_give' && amt) {
      const cName = ve.contact?.name || ve.contactName || contactName || (isEn ? 'Customer' : isHi ? 'ग्राहक' : 'কাস্টমার');
      return {
        reply: isEn 
          ? `📝 Recorded due of ${formatBDT(amt, 'en')} for **${cName}**.`
          : isHi 
          ? `📝 **${cName}** को ${formatBDT(amt, 'hi')} उधारी लिख दी गई है।`
          : `📝 **${cName}**-কে ${formatBDT(amt, 'bn')} বাকি লিখে দিয়েছি।`,
        actionCard: {
          type: 'DUE_GIVE_DRAFT',
          title: isEn ? 'Confirm Due Given' : isHi ? 'उधार देना पुष्टि करें' : 'বাকি দেওয়া নিশ্চিত করুন',
          amount: amt,
          contactId: ve.contact?.id || null,
          contactName: cName,
          note: `${cName} বাকি (ভয়েস)`,
          buttonLabel: isEn ? 'Record Due Given' : isHi ? '✓ उधारी जोड़ें' : '✓ বাকি হিসাবে যোগ করুন'
        },
        isInstantIntent: true
      };
    }

    // --- DUE GIVE WITHOUT PRICE / AMOUNT (ask user for price intelligently) ---
    if (ve.intent === 'due_give' && !amt && (ve.contact || ve.contactName)) {
      const cName = ve.contact?.name || ve.contactName || contactName;
      const pDesc = ve.product?.name || (ve.quantity ? `${ve.quantity} ${ve.unit || 'কেজি'} পণ্য` : 'পণ্য');
      return {
        reply: isEn 
          ? `Please tell me the total amount in Taka for giving ${pDesc} on credit to **${cName}**.`
          : isHi 
          ? `**${cName}** को ${pDesc} उधार देने के लिए कुल कितने रुपये लिखूँ, बताइए?`
          : `**${cName}**-কে ${pDesc} বাকিতে দেওয়ার জন্য মোট কত টাকা লিখব বলুন?`,
        isInstantIntent: true
      };
    }

    // --- DUE COLLECT (entity-based) ---
    if (ve.intent === 'due_collect' && amt) {
      const cName = ve.contact?.name || ve.contactName || contactName || (isEn ? 'Customer' : isHi ? 'ग्राहक' : 'কাস্টমার');
      return {
        reply: isEn 
          ? `✅ Recorded due collection of ${formatBDT(amt, 'en')} from **${cName}**.`
          : isHi 
          ? `✅ **${cName}** से ${formatBDT(amt, 'hi')} वसूली जमा कर ली गई है।`
          : `✅ **${cName}** থেকে ${formatBDT(amt, 'bn')} বাকি আদায় জমা করেছি।`,
        actionCard: {
          type: 'DUE_COLLECT_DRAFT',
          title: isEn ? 'Confirm Due Collection' : isHi ? 'उधारी वसूली पुष्टि करें' : 'বাকি আদায় নিশ্চিত করুন',
          amount: amt,
          contactId: ve.contact?.id || null,
          contactName: cName,
          note: `${cName} বাকি আদায় (ভয়েস)`,
          buttonLabel: isEn ? 'Record Collection' : isHi ? '✓ वसूली जोड़ें' : '✓ বাকি আদায় যোগ করুন'
        },
        isInstantIntent: true
      };
    }

    // Note: entity-based 'sale' and 'expense' intents fall through to existing handlers
    // which already handle amount extraction well. No need to duplicate.
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0a1. INTENT: What are you doing / Activity (কী করছো / क्या कर रहे हो / What are you doing)
  // ─────────────────────────────────────────────────────────────────────────────
  const isWhatAreYouDoing = (
    q.includes('what are you doing') || q.includes('what you doing') || q.includes('what r u doing') ||
    q.includes('kya kar rahe ho') || q.includes('kya kar rahe') || q.includes('tum kya kar rahe') || q.includes('aap kya kar rahe') ||
    q.includes('क्या कर रहे हो') || q.includes('क्या कर रहे') || q.includes('क्या कर रही हो') || q.includes('क्या कर रहे हैं') ||
    q.includes('কি করছো') || q.includes('কী করছো') || q.includes('কি করছ') || q.includes('কী করছ') ||
    q.includes('কি করতেছ') || q.includes('কী করতেছ') || q.includes('কি করছেন') || q.includes('কী করছেন') ||
    q.includes('কি করতেছেন') || q.includes('কী করতেছেন')
  );

  if (isWhatAreYouDoing) {
    return {
      reply: isEn
        ? `I am currently monitoring the live cash flow, sales, and accounts of **${context.businessName}**. How can I assist you right now?`
        : isHi
        ? `मैं अभी आपकी दुकान **${context.businessName}** के लाइव कैश फ्लो, बिक्री और खातों पर नज़र रख रहा हूँ। बताइए, आज मैं आपकी क्या मदद करूँ?`
        : `আমি এখন **${context.businessName}**-এর লাইভ ক্যাশ ফ্লো, বিক্রি ও হিসাব পর্যবেক্ষণ করছি। বলুন, আজ কীভাবে সাহায্য করতে পারি?`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0a. INTENT: Name / Identity / Role Query (তোমার নাম কি / Who are you / What's your name)
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('নাম কি') || q.includes('নাম কী') || q.includes('তোমার নাম') ||
    q.includes('তুমি কে') || q.includes('আপনি কে') || q.includes('তুই কে') ||
    q.includes('আপনার নাম') || q.includes('পরিচয়') ||
    q.includes('आपका नाम') || q.includes('तुम कौन') || q.includes('तेरा नाम') ||
    q.includes('কী করো তুমি') || q.includes('তুমি কী') || q.includes('তুমি কোন') || q.includes('nam কে') || q.includes('nam ki') || q.includes('ড. নাম') || q.includes('डॉ नाम') || q.includes('নাম এআই') || q.includes('nam ai') ||
    q.includes('aapka naam') || q.includes('apka naam') || q.includes('naam kya') || q.includes('kya naam') ||
    q.includes('what do you do') || q.includes('what can you do') || q.includes('who are you') ||
    q.includes('what is your name') || q.includes('whats your name') || q.includes("what's your name") ||
    (q.includes('what are you') && !q.includes('what are you doing')) || q.includes('what you do') || q.includes('tell me about yourself') ||
    q.includes('introduce yourself') || q.includes('তুমি কি করতে পারো') || q.includes('তোমার কাজ কি') ||
    q.includes('तुम क्या करते हो') || q.includes('तुम्हारा काम क्या है')
  ) {
    return {
      reply: isEn
        ? `Hello! My name is **Dr. NAM** — I'm your AI Chief Financial Officer and business growth partner embedded directly in Ledgero.\n\nI can analyze your sales, expenses, cash drawer, audit customer dues, calculate profit margins, and guide your business expansion. How can I assist you today?`
        : isHi
        ? `नमस्ते! मेरा नाम **Dr. NAM (डॉक्टर नाम)** है — मैं लेजेरो (Ledgero) में आपका AI चीफ फाइनेंशियल ऑफिसर (CFO) और बिजनेस पार्टनर हूँ।\n\nमैं आपकी बिक्री, खर्च, कैश फ्लो, उधारी ऑडिट, मुनाफा और बिज़नेस ग्रोथ में मदद कर सकता हूँ। आज मैं आपकी क्या मदद करूँ?`
        : `আসসালামু আলাইকুম! আমার নাম **ডক্টর নাম (Dr. NAM)** — আমি লেজেরো (Ledgero) অ্যাপে আপনার এআই চিফ ফাইন্যান্সিয়াল অফিসার (সিএফও) ও ব্যবসায়িক উপদেষ্টা।\n\nআমি আপনার লাইভ বিক্রি, খরচ, ক্যাশবক্স অডিট, কাস্টমার বাকি, লাভ-লোকসান এবং ব্যবসার উন্নতিতে সাহায্য করতে পারি। আজ আপনাকে কীভাবে সাহায্য করতে পারি?`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0b. INTENT: How are you / Personal Well-being (কেমন আছো / কি অবস্থা / How are you)
  // ─────────────────────────────────────────────────────────────────────────────
  const isHowAreYou = (
    q.includes('কেমন আছো') || q.includes('কেমন আছেন') || q.includes('কেমন আসো') ||
    q.includes('কি অবস্থা') || q.includes('কী অবস্থা') || q.includes('কি খবর') || q.includes('কী খবর') ||
    q.includes('ভালো আছো') || q.includes('ভালো আছেন') || q.includes('কেমন চলছ') ||
    q.includes('how are you') || q.includes('how r u') || q.includes("how's it going") || q.includes('how is it going') ||
    q.includes('how do you do') || q.includes('how are things') || q.includes("how're you") ||
    q.includes('कैसे हो') || q.includes('कैसे हैं') || q.includes('क्या हाल') || q.includes('हाल चाल') ||
    q.includes('kemon acho') || q.includes('kemon achen') || q.includes('ki obostha') || q.includes('ki khobor')
  );

  if (isHowAreYou) {
    return {
      reply: isEn
        ? `Alhamdulillah, I'm doing great, thank you for asking! 😊\n\nI'm always ready to keep your business finances and ledger sharp. How is your day going at **${context.businessName}**? How are store sales and customer foot traffic today?`
        : isHi
        ? `अल्हम्दुलिल्लाह, मैं बिल्कुल ठीक और चुस्त हूँ, पूछने के लिए शुक्रिया! 😊\n\n**${context.businessName}** के हिसाब-किताब और कैश फ्लो को सटीक रखने के लिए मैं हमेशा तैयार हूँ। आज आपका दिन कैसा बीत रहा है? दुकान में बिक्री और ग्राहकों की चहल-पहल कैसी है?`
        : `আলহামদুলিল্লাহ, আপনার দোয়ায় আমি খুব ভালো আছি! 😊\n\nআপনার ব্যবসা **${context.businessName}**-এর হিসাব ও ক্যাশ ফ্লো সম্পূর্ণ নিখুঁত রাখতে আমি সব সময় প্রস্তুত। আপনার আজকের দিনটি কেমন কাটছে? দোকানে বেচাকেনা ও কাস্টমারদের আগমন কেমন চলছে?`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0b2. INTENT: Pure Greeting (হ্যালো/নমস্কার/नमस्ते/Hi/Hello/সালাম)
  // ─────────────────────────────────────────────────────────────────────────────
  const hasSubstantiveQuestion = (
    q.includes('কি') || q.includes('কী') || q.includes('কেমন') || q.includes('জিজ্ঞেস') ||
    q.includes('লিখছি') || q.includes('লিখি') || q.includes('করছি') || q.includes('করতেছি') ||
    q.includes('পেজ') || q.includes('পেইজ') || q.includes('স্ক্রিন') || q.includes('বলো') || q.includes('বলুন') ||
    q.includes('কত') || q.includes('টাকা') || q.includes('খাতা') || q.includes('বিক্রি') ||
    q.includes('খরচ') || q.includes('বাকি') || q.includes('স্টক') || q.includes('দোকান') ||
    q.includes('where') || q.includes('what') || q.includes('how') || q.includes('why') ||
    q.includes('tell') || q.includes('show') || q.includes('kya') || q.includes('kaise') ||
    q.length > 25
  );

  const isPureGreeting = !hasSubstantiveQuestion && (
    q.match(/^(হ্যালো|হ্যাল|সালাম|আসসালামু|হাই|নমস্কার|নমস্তে|নমস্কর)[\s!.,?]*$/) ||
    q.match(/^(नमस्ते|नमस्कार|हैलो|हाय|सलाम)[\s!.,?]*$/) ||
    q.match(/^(hi|hello|hey|good morning|good evening|good afternoon|assalamu|salam)[\s!.,?]*$/) ||
    q.match(/^(হ্যালো|হ্যাল|সালাম|আসসালামু|হাই|নমস্কার|নমস্তে|নমস্কর)\s+(ভাই|ভাইয়া|স্যার|ডক্টর|নাম|ai|assistant)[\s!.,?]*$/i) ||
    q.match(/^(hi|hello|hey)\s+(dr|nam|doc|there|sir|brother)[\s!.,?]*$/i) ||
    q === 'শুভ সকাল' || q === 'শুভ সন্ধ্যা' || q === 'শুভ দুপুর' || /\b(yo|sup)\b/i.test(q)
  );

  if (isPureGreeting) {
    const curHour = new Date().getHours();
    const timeGreetingBn = curHour < 12 ? 'শুভ সকাল' : curHour < 17 ? 'শুভ দুপুর' : 'শুভ সন্ধ্যা';
    const timeGreetingHi = curHour < 12 ? 'शुभ प्रभात' : curHour < 17 ? 'शुभ दोपहर' : 'शुभ संध्या';
    const timeGreetingEn = curHour < 12 ? 'Good morning' : curHour < 17 ? 'Good afternoon' : 'Good evening';

    return {
      reply: isEn
        ? `${timeGreetingEn}! 👋 I'm **Dr. NAM**, your assistant. How can I help with sales, expenses, or customer dues today?`
        : isHi
        ? `${timeGreetingHi}! 👋 मैं **Dr. NAM (डॉक्टर नाम)**, आपका सहायक। आज बिक्री, खर्च या उधारी में क्या मदद करूँ?`
        : `আসসালামু আলাইকুম! ${timeGreetingBn}! 👋 আমি **ডক্টর নাম (Dr. NAM)**, আপনার সহকারী। বিক্রি, খরচ বা বাকির হিসাবে কী সাহায্য করব বলুন?`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0b3. INTENT: Active Typing & Activity Detection (আমি কি লিখছি / আমি কি করতেছি / What am I typing)
  // ─────────────────────────────────────────────────────────────────────────────
  const isTypingOrActionQuery = (
    q.includes('কি লিখছি') || q.includes('কী লিখছি') || q.includes('কি লিখেছি') || q.includes('কী লিখেছি') ||
    q.includes('কি টাইপ') || q.includes('কী টাইপ') || q.includes('কোথায় লিখছি') || q.includes('কোথায় লিখছি') ||
    q.includes('কি করতেছি') || q.includes('কী করতেছি') || q.includes('কি করছি') || q.includes('কী করছি') ||
    q.includes('আমি কি লিখি') || q.includes('ami ki likhchi') || q.includes('ami ki kortesi') ||
    q.includes('what am i typing') || q.includes('what did i write') || q.includes('what am i writing') ||
    q.includes('what am i doing') || q.includes('kya likh raha hoon') || q.includes('kya kar raha hoon')
  );

  if (isTypingOrActionQuery) {
    const actInput = context.activeInput;
    const sName = isEn ? (context.currentScreenNameEn || context.activeScreen) : isHi ? (context.currentScreenNameHi || context.activeScreen) : (context.currentScreenNameBn || context.activeScreen);

    if (actInput && actInput.fieldValue) {
      return {
        reply: isEn
          ? `✍️ You are on the **${sName}** page, typing **"${actInput.fieldValue}"** in the **${actInput.fieldLabel || 'input'}** field.`
          : isHi
          ? `✍️ आप अभी **${sName}** पेज पर **${actInput.fieldLabel || 'फ़ील्ड'}** में **"${actInput.fieldValue}"** लिख रहे हैं।`
          : `✍️ আপনি এখন **${sName}** পেজে **${actInput.fieldLabel || 'ইনপুট'}**-এর ঘরে **"${actInput.fieldValue}"** লিখছেন।`,
        isInstantIntent: true
      };
    } else if (actInput && actInput.fieldLabel) {
      return {
        reply: isEn
          ? `✍️ You are on the **${sName}** page in the **${actInput.fieldLabel}** field, but haven't typed anything yet.`
          : isHi
          ? `✍️ आप **${sName}** पेज पर **${actInput.fieldLabel}** बॉक्स में हैं, अभी कुछ लिखा नहीं है।`
          : `✍️ আপনি এখন **${sName}** পেজে **${actInput.fieldLabel}**-এর ঘরে আছেন, তবে এখনো কিছু লেখেননি।`,
        isInstantIntent: true
      };
    } else {
      return {
        reply: isEn
          ? `👀 You are viewing the **${sName}** page. You are not typing in any input field right now. You can speak to record sales, expenses, or navigate!`
          : isHi
          ? `👀 आप अभी **${sName}** पेज देख रहे हैं। अभी किसी बॉक्स में कुछ नहीं लिख रहे हैं।`
          : `👀 আপনি এখন **${sName}** পেজ দেখছেন। এই মুহূর্তে কোনো ঘরে কিছু লিখছেন না। কোনো হিসাব যোগ করতে মুখে বলুন!`,
        isInstantIntent: true
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0c. INTENT: Real-Time Clock & Time Query (কয়টা বাজে / সময় কত / What time is it)
  // ─────────────────────────────────────────────────────────────────────────────
  const hasTimeKeywords = (
    q.includes('time') || q.includes('clock') || q.includes('সময়') || q.includes('সময়') ||
    q.includes('কয়টা বাজে') || q.includes('কয়টা বাজে') || q.includes('কয়টা বাজে এখন') ||
    q.includes('ঘড়ি') || q.includes('ঘড়ি') || q.includes('টাইম') || q.includes('বর্তমান সময়') ||
    q.includes('समय') || q.includes('कितना बजा') || q.includes('बजे') || q.includes('ঘड़ी') ||
    q.includes('वक्त') || q.includes('samay') || q.includes('wakt') || q.includes('koyta baje') ||
    q.includes('what time') || q.includes('current time') || q.includes('kitna baje') || q.includes('kitne baje')
  );

  const hasWeatherKeywords = (
    q.includes('weather') || q.includes('weather today') || q.includes('climate') ||
    q.includes('আবহাওয়া') || q.includes('আবহাওয়া') || q.includes('বৃষ্টি') || q.includes('ওয়েদার') ||
    q.includes('मौसम') || q.includes('बारिश') || q.includes('mausam') || q.includes('barish')
  );

  // Compound Query: Time + Weather together (e.g. "কয়টা বাজে আজকের ওয়েদার")
  if (hasTimeKeywords && hasWeatherKeywords) {
    return {
      reply: isEn
        ? `🕒 **Current Time & Store Readiness:**\nThe time right now is **${context.currentTime}** on **${context.currentDayOfWeek}, ${context.currentDateFormatted}**.\n\nRegarding the weather, while I don't have a direct satellite weather radar connected to the ERP, today is a productive business day at **${context.businessName}**. Keep your store merchandise protected and prepare for customer foot traffic!`
        : isHi
        ? `🕒 **समय और व्यापारिक मौसम अपडेट:**\nअभी घड़ी में **${context.currentTimeHi}** हैं। आज **${context.currentDayOfWeekHi}, ${context.currentDateFormattedHi}** है।\n\nमौसम का लाइव सैटेलाइट रडार मेरे पास नहीं है, लेकिन **${context.businessName}** में आज के व्यापार के लिए पूरी तैयारी रखें और दुकान का सामान सुरक्षित रखें!`
        : `🕒 **বর্তমান সময় ও আবহাওয়া পরামর্শ:**\nএখন ঘড়িতে বাজে **${context.currentTimeBn}**। আজ **${context.currentDayOfWeekBn}, ${context.currentDateFormattedBn}**।\n\nআবহাওয়ার সরাসরি স্যাটেলাইট রাডার সংযোগ আমার কাছে না থাকলেও, আজ **${context.businessName}**-এর মালামাল সুরক্ষিত রাখুন এবং কাস্টমারদের আগমনের জন্য ব্যবসা প্রস্তুত রাখুন!`,
      isInstantIntent: true
    };
  }

  // Pure Time Query
  if (hasTimeKeywords) {
    return {
      reply: isEn
        ? `🕒 **Current Real-Time Clock:**\nThe time right now is **${context.currentTime}** on **${context.currentDayOfWeek}, ${context.currentDateFormatted}**.\n\nYour cash drawer is active and all transactions are recording in real-time!`
        : isHi
        ? `🕒 **वर्तमान समय — Live Clock:**\nअभी घड़ी में **${context.currentTimeHi}** हैं। আজ **${context.currentDayOfWeekHi}, ${context.currentDateFormattedHi}** है।\n\nआपकी दुकान का हिसाब-किताब लाइव अपडेट हो रहा है!`
        : `🕒 **বর্তমান সময় — লাইভ ঘড়ি:**\nএখন ঘড়িতে বাজে **${context.currentTimeBn}**। আজ **${context.currentDayOfWeekBn}, ${context.currentDateFormattedBn}**।\n\nআপনার ক্যাশবক্স ও লাইভ লেজার সক্রিয় রয়েছে!`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0d. INTENT: Date & Calendar Query (আজকের তারিখ / আজ কি বার / What is today's date)
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('তারিখ') || q.includes('আজ কি বার') || q.includes('আজকের তারিখ') ||
    q.includes('দিন কি') || q.includes('আজকে কি বার') || q.includes('আজ কি দিন') ||
    q.includes('date') || q.includes('today date') || q.includes('what date') ||
    q.includes('तारीख') || q.includes('आज कौन सा दिन') || q.includes('दिनांक') ||
    q.includes('tarikh') || q.includes('ajke ki bar') || q.includes('ajker tarikh')
  ) {
    return {
      reply: isEn
        ? `📅 **Today's Date & Calendar:**\nToday is **${context.currentDayOfWeek}, ${context.currentDateFormatted}** (Accounting Date: ${context.date}).\n\nDay Status: **${context.dayStatus}**.`
        : isHi
        ? `📅 **आज की तारीख और दिन:**\nआज **${context.currentDayOfWeekHi}, ${context.currentDateFormattedHi}** है (लेखांकन तिथि: ${context.date})।\n\nदुकान की स्थिति: **${context.dayStatus}**।`
        : `📅 **আজকের তারিখ ও বার:**\nআজকের তারিখ হলো **${context.currentDateFormattedBn}** (রোজ **${context.currentDayOfWeekBn}**)। অ্যাপে হিসাবের তারিখ: ${context.date}।\n\nদিনের অবস্থা: **${context.dayStatus === 'OPEN' ? 'দিন চালু আছে' : context.dayStatus === 'CLOSED' ? 'দিন সমাপ্ত' : 'দিন শুরু হয়নি'}**।`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0e. INTENT: Weather Query (আজকের আবহাওয়া / मौसम / Weather today)
  // ─────────────────────────────────────────────────────────────────────────────
  if (hasWeatherKeywords) {
    return {
      reply: isEn
        ? `🌤️ **Weather & Store Readiness:**\nAs your AI Chief Financial Officer, I don't have a direct satellite weather feed connected to the ERP. However, today is **${context.currentDayOfWeek}, ${context.currentDateFormatted}** — regardless of outside weather conditions, ensure your store inventory is protected and keep an eye on your customer foot traffic!`
        : isHi
        ? `🌤️ **मौसम और व्यापारिक अपडेट:**\nमैं आपका এআই वित्तीय सलाहकार (CFO) हूँ और मेरे पास अभी लाइव उपग्रह मौसम का सीधा कनेक्शन नहीं है। लेकिन आज **${context.currentDayOfWeekHi}, ${context.currentDateFormattedHi}** को अपने स्टोर और सामान को सुरक्षित रखें तथा ग्राहकों के लिए अच्छी तैयारी रखें!`
        : `🌤️ **আবহাওয়া ও ব্যবসায়িক পরামর্শ:**\nআমি আপনার এআই চিফ ফাইন্যান্সিয়াল অফিসার (সিএফও) হওয়ায় সরাসরি স্যাটেলাইট আবহাওয়া রাডারের সাথে যুক্ত নই। তবে আজ **${context.currentDayOfWeekBn}, ${context.currentDateFormattedBn}** — আবহাওয়া যেমনই থাকুক না কেন, দোকানের পণ্যের সুরক্ষা নিশ্চিত রাখুন এবং কাস্টমারদের আগমনের জন্য প্রস্তুত থাকুন!`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0f. INTENT: Contextual Language Translation / Switch (হিন্দিতে বলো / বাংলায় বলো / tell in English)
  // ─────────────────────────────────────────────────────────────────────────────
  const isTranslateToHindi = (
    q.includes('হিন্দিতে') || q.includes('হিন্দি বলো') || q.includes('হিন্দি বল') ||
    q.includes('हिंदी में') || q.includes('हिन्दी में') || q.includes('hindi me') || q.includes('hindi mein') ||
    q.includes('in hindi') || q.includes('translate to hindi') || q.includes('tell in hindi') || q.includes('speak in hindi')
  );
  const isTranslateToBengali = (
    q.includes('বাংলায়') || q.includes('বাংলা বলো') || q.includes('বাংলা বল') || q.includes('বাংলাতে') ||
    q.includes('बांग्ला में') || q.includes('बंगाली में') || q.includes('bangla me') || q.includes('banglay') ||
    q.includes('in bangla') || q.includes('in bengali') || q.includes('translate to bangla') || q.includes('tell in bangla')
  );
  const isTranslateToEnglish = (
    q.includes('ইংরেজিতে') || q.includes('ইংলিশে') || q.includes('ইংলিশ বলো') ||
    q.includes('अंग्रेजी में') || q.includes('अंग्रेज़ी में') || q.includes('english me') ||
    q.includes('in english') || q.includes('translate to english') || q.includes('tell in english') || q.includes('speak english')
  );

  if (isTranslateToHindi || isTranslateToBengali || isTranslateToEnglish) {
    const targetLang = isTranslateToHindi ? 'hi' : isTranslateToBengali ? 'bn' : 'en';

    let reply = '';
    if (targetLang === 'hi') {
      reply = `नमस्ते! मैं **Dr. NAM (डॉक्टर नाम)** — आपका एआई वित्तीय सलाहकार।\n\nमुझसे पूछें:\n• *"दुकान का मुनाफा और बिक्री कैसे बढ़ाएं?"*\n• *"दुकान का स्वास्थ्य स्कोर और 14 KPIs जांचें"*\n• *"कैश रनवे और ब्रेक-ईवन कितना है?"*\n• *"चाय खर्चा 50 रुपया लिखो"* या *"आज कितनी बिक्री हुई?"*`;
    } else if (targetLang === 'bn') {
      reply = `আসসালামু আলাইকুম! আমি **ডক্টর নাম (Dr. NAM)** — আপনার এআই সহকারী ও হিসাব উপদেষ্টা।\n\nআমাকে জিজ্ঞেস করতে পারেন:\n• *"দোকানের বিক্রি ও ব্যবসার গ্রোথ বাড়ানোর উপায় কী?"*\n• *"দোকানের স্বাস্থ্য স্কোর ও ১৪টি কেপিআই বিশ্লেষণ করো"*\n• *"দোকানের ক্যাশ রানওয়ে ও ব্রেক-ইভেন কত?"*\n• *"চা নাস্তা খরচ ৫০ টাকা লিখো"* বা *"আজকে কত বিক্রি হলো?"*`;
    } else {
      reply = `Hello! I'm **Dr. NAM**, your AI assistant inside Ledgero.\n\nYou can ask me:\n• *"How can we grow store sales and revenue?"*\n• *"Analyze shop financial health and 14 KPIs"*\n• *"What is the store break-even point and cash runway?"*\n• *"Record expense 100 tk for tea"* or *"What are today's sales?"*`;
    }

    return {
      reply,
      targetLang,
      isTranslation: true,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0g. INTENT: Casual Well-Being, Personal Care & Chit-Chat (তোমার দিন কেমন গেল / কিছু খাওয়া হয়েছে / How was your day)
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('দিন কেমন') || q.includes('দিনটা কেমন') || q.includes('কেমন গেল') || q.includes('কেমন কাটল') ||
    q.includes('কেমন কাটলো') || q.includes('দিনকাল কেমন') || q.includes('খাওয়া হয়েছে') || q.includes('খাওয়া হইছে') ||
    q.includes('কিছু খেয়েছো') || q.includes('কিছু খাইছো') || q.includes('ভাত খাইছো') || q.includes('চা খাইছো') ||
    q.includes('how was your day') || q.includes('how was the day') || q.includes('did you eat') ||
    q.includes('have you eaten') || q.includes('did you have lunch') || q.includes('did you have dinner') ||
    q.includes('दिन कैसा रहा') || q.includes('दिन कैसा बीता') || q.includes('खाना खाया') || q.includes('कुछ खाया आपने') ||
    q.includes('चाय पी') || q.includes('kemon gelo') || q.includes('khawa hoyeche') || q.includes('din kemon')
  ) {
    return {
      reply: isEn
        ? `Alhamdulillah, my day has been going great, thank you for asking! 😊\n\nAs an AI Chief Financial Officer, I don't need food or rest — helping you manage ${context.businessName}'s finances, audit customer dues, and grow your profits is what keeps me energized! How was your day? How have sales and customer foot traffic been today?`
        : isHi
        ? `अल्हम्दुलिल्लाह, आपकी शुभकामनाओं से मेरा दिन बहुत अच्छा बीत रहा है! 😊\n\nमैं एक AI वित्तीय सलाहकार हूँ, इसलिए मुझे खाने की आवश्यकता नहीं होती — आपके व्यापार **${context.businessName}** के हिसाब-किताब को सटीक रखना और मुनाफ़ा बढ़ाना ही मेरी ऊर्जा है! आपका आज का दिन कैसा रहा? दुकान में बिक्री और ग्राहकों की चहल-पहल कैसी रही?`
        : `আলহামদুলিল্লাহ, আপনার দোয়ায় ও সমর্থনে আমার দিনটি খুব সুন্দর কাটছে! 😊\n\nআমি একটি এআই সহকারী, তাই আমার খাওয়ার প্রয়োজন হয় না—আপনার ব্যবসা **${context.businessName}**-এর হিসাব নিখুঁত রাখা ও ব্যবসার উন্নতিতে পাশে থাকাই আমার মূল খোরাক ও আনন্দ! আপনার আজকের দিন কেমন কাটল? দোকানে বেচাকেনা ও কাস্টমারদের আগমন কেমন হলো?`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0h. INTENT: Active Screen Detection (আমি কোন পেজে আছি / Where am I / Which page)
  // ─────────────────────────────────────────────────────────────────────────────
  const isScreenQuery = (
    q.includes('কোন পেজ') || q.includes('কোন পেইজ') || q.includes('কোন স্ক্রিন') ||
    q.includes('কোথায় আছি') || q.includes('কই আছি') || q.includes('আমি কোথায়') || q.includes('আমি কই') ||
    q.includes('ami kothay') || q.includes('kon page') || q.includes('kon screen') ||
    q.includes('where am i') || q.includes('which page') || q.includes('what screen') || q.includes('current screen') ||
    q.includes('किस पेज पर') || q.includes('कहाँ हूँ') || q.includes('कौन सा पेज') || q.includes('kahan hoon') ||
    q.includes('আমি কী দেখতেছি') || q.includes('আমি কি দেখছি')
  );

  if (isScreenQuery) {
    const sName = isEn ? (context.currentScreenNameEn || context.activeScreen) : isHi ? (context.currentScreenNameHi || context.activeScreen) : (context.currentScreenNameBn || context.activeScreen);

    return {
      reply: isEn
        ? `📍 You are currently on the **${sName}** page.`
        : isHi
        ? `📍 आप अभी **${sName}** पेज पर हैं।`
        : `📍 আপনি এখন **${sName}** পেজে আছেন।`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0h2. INTENT: Voice Screen Navigation (খাতায় যাও / ড্যাশবোর্ডে যাও / রিপোর্টে যাও)
  // ─────────────────────────────────────────────────────────────────────────────
  const isNavKhata = q.includes('খাতায় যাও') || q.includes('খাতায় যাও') || q.includes('খাতা পেজে') || q.includes('বাকির খাতা') || q.includes('খাতা দেখাও') || q.includes('go to khata') || q.includes('open khata') || q.includes('खाता खोलो') || q.includes('khata jao') || q.includes('khata page');
  const isNavDash = q.includes('ড্যাশবোর্ডে যাও') || q.includes('ড্যাশবোর্ড পেজে') || q.includes('হোমে যাও') || q.includes('হোম পেজে') || q.includes('মূল পেজে যাও') || q.includes('go to dashboard') || q.includes('open dashboard') || q.includes('ড্যাশবোর্ড দেখাও') || q.includes('dashboard jao');
  const isNavReports = q.includes('রিপোর্টে যাও') || q.includes('রিপোর্ট পেজে') || q.includes('মাসিক রিপোর্টে') || q.includes('মাসিক হিসাবে যাও') || q.includes('go to reports') || q.includes('open reports') || q.includes('report jao');
  const isNavClosing = q.includes('ক্লোজিং পেজে') || q.includes('দিন শেষ পেজে') || q.includes('দিন শেষ করো') || q.includes('ক্লোজিং করো') || q.includes('go to closing') || q.includes('close day') || q.includes('closing jao');
  const isNavAnalytics = q.includes('অ্যানালিটিক্সে যাও') || q.includes('অ্যানালিটিক্স পেজে') || q.includes('পূর্বাভাস পেজে') || q.includes('go to analytics') || q.includes('open analytics');
  const isNavOpening = q.includes('ওপেনিং পেজে') || q.includes('দিন শুরু পেজে') || q.includes('দিন শুরু করো') || q.includes('go to opening') || q.includes('opening jao');

  if (isNavKhata || isNavDash || isNavReports || isNavClosing || isNavAnalytics || isNavOpening) {
    const targetScreen = isNavKhata ? 'khata'
      : isNavDash ? 'dashboard'
      : isNavReports ? 'reports'
      : isNavClosing ? 'closing'
      : isNavAnalytics ? 'analytics'
      : 'opening';

    const targetNameBn = isNavKhata ? 'বাকির খাতা'
      : isNavDash ? 'ড্যাশবোর্ড'
      : isNavReports ? 'মাসিক রিপোর্ট'
      : isNavClosing ? 'দিন শেষ ক্লোজিং'
      : isNavAnalytics ? 'অ্যানালিটিক্স'
      : 'দিন শুরু ওপেনিং';

    const targetNameEn = isNavKhata ? 'Due Ledger (Khata)'
      : isNavDash ? 'Dashboard'
      : isNavReports ? 'Monthly Reports'
      : isNavClosing ? 'Day Closing'
      : isNavAnalytics ? 'Analytics'
      : 'Day Opening';

    return {
      reply: isEn
        ? `🚀 Switched to the **${targetNameEn}** page.`
        : isHi
        ? `🚀 **${targetNameBn}** पेज खोल दिया गया है।`
        : `🚀 **${targetNameBn}** পেজ খুলেছি।`,
      actionCard: {
        type: 'NAVIGATE',
        screen: targetScreen,
        screenName: targetNameBn
      },
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0i. INTENT: Screen Explanation & Audit (এই পেজে কি হচ্ছে / এই পেজ বুঝিয়ে বলো / Explain this screen)
  // ─────────────────────────────────────────────────────────────────────────────
  const isScreenExplanationQuery = (
    q.includes('এই পেজে কি হচ্ছে') || q.includes('এই পেজে কী হচ্ছে') ||
    q.includes('এই পেজ বুঝিয়ে') || q.includes('এই পেজটি বুঝিয়ে') || q.includes('এই পেজ বুঝাও') ||
    q.includes('এখানে কি করতে হবে') || q.includes('এখানে কী করতে হবে') ||
    q.includes('explain this page') || q.includes('explain this screen') || q.includes('what is this page') ||
    q.includes('इस पेज पर क्या') || q.includes('यह पेज समझाओ') || q.includes('yeh page samjhao') ||
    q.includes('এই পেজে কোনো সমস্যা') || q.includes('এই পেজের হিসাব') || q.includes('এই স্ক্রিনে কি')
  );

  if (isScreenExplanationQuery) {
    const sName = isEn ? (context.currentScreenNameEn || context.activeScreen) : isHi ? (context.currentScreenNameHi || context.activeScreen) : (context.currentScreenNameBn || context.activeScreen);
    const act = (context.activeScreen || '').toLowerCase();

    let detailedAudit = '';
    if (act === 'khata') {
      detailedAudit = isEn
        ? `• **Customer Receivables (AR):** ${formatBDT(context.totalCustomerReceivable, 'en')} across ${context.topDebtorsCount} customers.\n` +
          `• **Supplier Payables (AP):** ${formatBDT(context.totalSupplierPayable, 'en')}.\n` +
          `• **Debtor Concentration:** ${context.debtorConcentrationRisk}% of total due is held by your top 3 debtors.\n` +
          `• **Action Recommended:** Send WhatsApp reminders to overdue debtors to accelerate cash collection.`
        : isHi
        ? `• **ग्राहकों से बकाया (पाना):** ${formatBDT(context.totalCustomerReceivable, 'hi')} (${context.topDebtorsCount} ग्राहक)।\n` +
          `• **सप्लायरों को देना:** ${formatBDT(context.totalSupplierPayable, 'hi')}।\n` +
          `• **कंसंट्रेशन रिस्क:** कुल उधारी का ${context.debtorConcentrationRisk}% सिर्फ टॉप 3 ग्राहकों के पास अटका है।\n` +
          `• **सलाह:** उधारी वसूलने के लिए व्हाट्सएप रिमाइंडर भेजें।`
        : `• **কাস্টমারদের কাছে মোট বাকি (পাবো):** ${formatBDT(context.totalCustomerReceivable, 'bn')} (${context.topDebtorsCount} জন কাস্টমার)।\n` +
          `• **মহাজনদের কাছে বকেয়া (দেবো):** ${formatBDT(context.totalSupplierPayable, 'bn')}।\n` +
          `• **বাকি ঘনীভবন ঝুঁকি:** মোট বাকির ${context.debtorConcentrationRisk}% টাকা মাত্র শীর্ষ ৩ জন কাস্টমারের কাছে আটকে আছে!\n` +
          `• **পরামর্শ:** দ্রুত ক্যাশ আদায়ের জন্য কাস্টমারদের হোয়াটসঅ্যাপ তাগাদা পাঠান।`;
    } else if (act === 'dashboard') {
      detailedAudit = isEn
        ? `• **Cash in Drawer:** ${formatBDT(context.cashInDrawer, 'en')}.\n` +
          `• **Today's Cash Sales:** ${formatBDT(context.cashSales, 'en')}.\n` +
          `• **Today's Expenses:** ${formatBDT(context.expenses, 'en')}.\n` +
          `• **Net Cash Movement:** ${formatBDT(context.netDayMovement, 'en')}.\n` +
          `• **Audit Check:** Ensure physical cash in drawer matches system balance before day end.`
        : isHi
        ? `• **कैश ड्रॉर में राशि:** ${formatBDT(context.cashInDrawer, 'hi')}।\n` +
          `• **आज की नगद बिक्री:** ${formatBDT(context.cashSales, 'hi')}।\n` +
          `• **आज के कुल खर्च:** ${formatBDT(context.expenses, 'hi')}।\n` +
          `• **नेट कैश मूवमेंट:** ${formatBDT(context.netDayMovement, 'hi')}।\n` +
          `• **सलाह:** दुकान बंद करने से पहले भौतिक कैश का मिलान करें।`
        : `• **ক্যাশ ড্রয়ার ব্যালেন্স:** ${formatBDT(context.cashInDrawer, 'bn')}।\n` +
          `• **আজকের নগদ বিক্রি:** ${formatBDT(context.cashSales, 'bn')}।\n` +
          `• **আজকের মোট খরচ:** ${formatBDT(context.expenses, 'bn')}।\n` +
          `• **নেট ক্যাশ প্রবাহ:** ${formatBDT(context.netDayMovement, 'bn')}।\n` +
          `• **পরামর্শ:** ড্রয়ারের আসল নগদ টাকার সাথে সিস্টেমের হিসাব মিলেছে কিনা তা নিয়মিত অডিট করুন।`;
    } else if (act === 'closing') {
      detailedAudit = isEn
        ? `• **Expected Cash:** ${formatBDT(context.cashInDrawer, 'en')}.\n` +
          `• **Purpose:** Count your physical drawer cash, enter denominations or total count, and verify zero variance before finalizing.`
        : isHi
        ? `• **अपेक्षित कैश:** ${formatBDT(context.cashInDrawer, 'hi')}।\n` +
          `• **उद्देश्य:** ड्रॉर का कैश गिनें और अंतर शून्य होने पर दिन बंद करें।`
        : `• **প্রত্যাশিত ক্যাশ:** ${formatBDT(context.cashInDrawer, 'bn')}।\n` +
          `• **উদ্দেশ্য:** ক্যাশবক্সের নগদ টাকা গুনে ইনপুট দিন এবং কোনো ঘাটতি বা বাড়তি আছে কিনা তা যাচাই করে দিন সমাপ্ত করুন।`;
    } else if (act === 'reports') {
      detailedAudit = isEn
        ? `• **Monthly Revenue:** ${formatBDT(context.revenue, 'en')}.\n` +
          `• **Operating Expenses:** ${formatBDT(context.opex, 'en')}.\n` +
          `• **Net Profit:** ${formatBDT(context.netProfit, 'en')} (Margin: ${context.netMarginPct}%).\n` +
          `• **Purpose:** Comprehensive financial audit for P&L, balance sheet, and tax.`
        : isHi
        ? `• **मासिक राजस्व:** ${formatBDT(context.revenue, 'hi')}।\n` +
          `• **खर्च:** ${formatBDT(context.opex, 'hi')}।\n` +
          `• **शुद्ध लाभ:** ${formatBDT(context.netProfit, 'hi')} (${context.netMarginPct}%)।`
        : `• **চলতি মাসের মোট আয়:** ${formatBDT(context.revenue, 'bn')}।\n` +
          `• **পরিচালন খরচ:** ${formatBDT(context.opex, 'bn')}।\n` +
          `• **নেট মুনাফা:** ${formatBDT(context.netProfit, 'bn')} (মার্জিন: ${context.netMarginPct}%)।\n` +
          `• **উদ্দেশ্য:** লাভ-লোকসান (P&L), ব্যালেন্স শিট ও ভ্যাট অডিট যাচাই করা।`;
    } else if (act === 'analytics') {
      detailedAudit = isEn
        ? `• **Business Health Score:** ${context.scorecardScore}% (${context.scorecardRating}).\n` +
          `• **Cash Runway:** ${context.cashRunwayDays} Days.\n` +
          `• **Debtor Days (DSO):** ${context.dso} Days.\n` +
          `• **Purpose:** 14-KPI DuPont financial breakdown and 30-day cash projection.`
        : isHi
        ? `• **हेल्थ स्कोर:** ${context.scorecardScore}% (${context.scorecardRating})।\n` +
          `• **कैश रनवे:** ${context.cashRunwayDays} दिन।\n` +
          `• **DSO अवधि:** ${context.dso} दिन।`
        : `• **ব্যবসায়িক স্বাস্থ্য স্কোর:** ${context.scorecardScore}% (${context.scorecardRatingBn})।\n` +
          `• **ক্যাশ রানওয়ে:** ${context.cashRunwayDays} দিন।\n` +
          `• **বাকি আদায় চক্র (DSO):** ${context.dso} দিন।\n` +
          `• **উদ্দেশ্য:** ১৪টি আন্তর্জাতিক কেপিআই ও ৩০ দিনের ক্যাশ ফ্লো পূর্বাভাস বিশ্লেষণ।`;
    } else {
      detailedAudit = isEn
        ? `• **Status:** Active Day initialized.\n• **Cash in Drawer:** ৳${formatBDT(context.cashInDrawer, 'en')}.`
        : `• **স্ট্যাটাস:** দিন চালু রয়েছে।\n• **ক্যাশ ব্যালেন্স:** ৳${formatBDT(context.cashInDrawer, 'bn')}।`;
    }

    return {
      reply: isEn
        ? `🩺 **Live Screen Analysis: ${sName}**\n\n${detailedAudit}\n\nNeed assistance with a specific customer, transaction, or metric? Just ask!`
        : isHi
        ? `🩺 **लाइव पेज विश्लेषण: ${sName}**\n\n${detailedAudit}\n\nकिसी ग्राहक या आंकड़े के बारे में कोई सवाल हो, तो सीधे पूछें!`
        : `🩺 **লাইভ পেজ অডিট ও বিশ্লেষণ: ${sName}**\n\n${detailedAudit}\n\nকোনো নির্দিষ্ট কাস্টমার বা লেনদেন নিয়ে সাহায্য চান? সরাসরি বলুন!`,
      isInstantIntent: true
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 0j. INTENT: Live Customer & Overdue Debtors Analysis (এই কাস্টমার / রহিমের হিসাব / এখানে এত বাকি কেন)
  // ─────────────────────────────────────────────────────────────────────────────
  let matchedCustomer = null;
  if (Array.isArray(context.contacts) && context.contacts.length > 0) {
    for (const c of context.contacts) {
      if (!c.name) continue;
      const cNameClean = c.name.toLowerCase().trim();
      if (cNameClean.length >= 3 && (q.includes(cNameClean) || (transliteratedText && transliteratedText.includes(cNameClean)))) {
        matchedCustomer = c;
        break;
      }
      // Check each token of contact name (e.g. "রহিম" from "রহিম ট্রেডার্স")
      const tokens = cNameClean.split(/\s+/).filter(t => t.length >= 3);
      for (const t of tokens) {
        if (q.includes(t) || (transliteratedText && transliteratedText.includes(t))) {
          matchedCustomer = c;
          break;
        }
      }
      if (matchedCustomer) break;
    }
  }

  const isCustomerDueGeneralQuery = (
    q.includes('এই কাস্টমার') || q.includes('এই গ্রাহক') || q.includes('কাস্টমার এটা কি') ||
    q.includes('এখানে এত বাকি কেন') || q.includes('এত বাকি কেন') || q.includes('বাকি বেশি কার') ||
    q.includes('সবচেয়ে বেশি বাকি') || q.includes('সবচেয়ে বেশি বাকি') || q.includes('কার কাছে বেশি বাকি') ||
    q.includes('কার কাছে বাকি') || q.includes('কার কাছে কত বাকি') || q.includes('বাকি কার কার') ||
    q.includes('किसका कितना बकाया') || q.includes('उधारी किसकी है') || q.includes('itni udhari kyu') ||
    q.includes('who owes most') || q.includes('why so much due') || q.includes('customer dues')
  );

  const isDueActionCommand = Boolean(
    q.match(/\d+/) && (
      q.includes('বাকি দিলাম') || q.includes('বাকি দিছি') || q.includes('বাকি দিয়েছি') || q.includes('ধারে দিলাম') ||
      q.includes('বাকি দিল') || q.includes('বাকি দিলো') || q.includes('বাকি দিছে') || q.includes('বাকি পেলাম') ||
      q.includes('বাকি পেয়েছি') || q.includes('টাকা দিল') || q.includes('টাকা দিলো') || q.includes('টাকা দিছে') ||
      q.includes('আদায়') || q.includes('পরিশোধ') || q.includes('জমা দিল') || q.includes('due given') ||
      q.includes('due collected') || q.includes('উধার دیا') || q.includes('उधार दिया') || q.includes('उधार मिला') ||
      q.includes('পেলুম') || q.includes('লিখো') || q.includes('লেখো') || q.includes('যোগ')
    )
  );

  if (matchedCustomer && !isDueActionCommand) {
    const bal = Number(matchedCustomer.currentBalance) || 0;
    const phone = matchedCustomer.phone || '';
    const isReceivable = bal > 0;
    const isPayable = bal < 0;

    let custReply = '';
    let actionCard = null;

    if (isReceivable) {
      custReply = isEn
        ? `👤 **Customer Due Profile: ${matchedCustomer.name}**\n\n` +
          `• **Current Due Amount:** ${formatBDT(bal, 'en')}\n` +
          `• **Phone:** ${phone || 'Not recorded'}\n` +
          `• **Account Type:** Customer Account\n\n` +
          `💡 **CFO Recommendation:** This customer has an active outstanding due. You can send a direct WhatsApp reminder now to accelerate payment collection.`
        : isHi
        ? `👤 **ग्राहक बकाया विवरण: ${matchedCustomer.name}**\n\n` +
          `• **कुल बकाया राशि:** ${formatBDT(bal, 'hi')}\n` +
          `• **फोन নম্বর:** ${phone || 'दर्ज नहीं'}\n` +
          `• **खाता प्रकार:** ग्राहक (Customer)\n\n` +
          `💡 **CFO सलाह:** ग्राहक से जल्द भुगतान प्राप्त करने के लिए व्हाट्सएप रिमाइंडर भेजें।`
        : `👤 **কাস্টমার বাকি হিসাব: ${matchedCustomer.name}**\n\n` +
          `• **বর্তমান বকেয়া বাকি (পাবো):** ${formatBDT(bal, 'bn')}\n` +
          `• **মোবাইল নম্বর:** ${phone || 'নম্বর যোগ করা নেই'}\n` +
          `• **অ্যাকাউন্ট টাইপ:** কাস্টমার অ্যাকাউন্ট\n\n` +
          `💡 **পরামর্শ:** কাস্টমারের বকেয়া দ্রুত আদায়ের জন্য সরাসরি একটি হোয়াটসঅ্যাপ তাগাদা রিমাইন্ডার পাঠিয়ে দিন।`;

      if (phone) {
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const reminderMsg = encodeURIComponent(
          `আসসালামু আলাইকুম ${matchedCustomer.name}, ${context.businessName} থেকে জানানো হচ্ছে যে আপনার বকেয়া বাকি ৳${bal}। হিসাবটি দ্রুত পরিশোধের অনুরোধ করা হচ্ছে। ধন্যবাদ।`
        );
        actionCard = {
          type: 'WHATSAPP_REMINDER',
          title: `WhatsApp Due Reminder to ${matchedCustomer.name}`,
          url: `https://wa.me/${cleanPhone}?text=${reminderMsg}`,
          buttonLabel: isEn ? `💬 Send WhatsApp Reminder (${formatBDT(bal, 'en')})` : `💬 হোয়াটসঅ্যাপে তাগাদা পাঠান (${formatBDT(bal, 'bn')})`
        };
      }
    } else if (isPayable) {
      const absBal = Math.abs(bal);
      custReply = isEn
        ? `👤 **Supplier Payable Profile: ${matchedCustomer.name}**\n\n` +
          `• **You Owe:** ${formatBDT(absBal, 'en')}\n` +
          `• **Phone:** ${phone || 'Not recorded'}\n` +
          `• **Account Type:** Supplier / Vendor\n\n` +
          `💡 **CFO Recommendation:** Plan payment within your cash conversion cycle to maintain high vendor trust.`
        : `👤 **মহাজন বকেয়া বিবরণ: ${matchedCustomer.name}**\n\n` +
          `• **আপনি মহাজনকে দেবেন:** ${formatBDT(absBal, 'bn')}\n` +
          `• **মোবাইল নম্বর:** ${phone || 'নম্বর যোগ করা নেই'}\n` +
          `• **অ্যাকাউন্ট টাইপ:** মহাজন / সরবরাহকারী\n\n` +
          `💡 **পরামর্শ:** সরবরাহকারীর সাথে সুসম্পর্ক বজায় রাখতে নির্ধারিত তারিখে বকেয়া পরিশোধের পরিকল্পনা করুন।`;
    } else {
      custReply = isEn
        ? `👤 **Account Status: ${matchedCustomer.name}**\n\nThis account has **৳0 balance** — completely cleared and up to date!`
        : `👤 **অ্যাকাউন্ট স্ট্যাটাস: ${matchedCustomer.name}**\n\nএই কাস্টমারের কোনো বকেয়া নেই (ব্যালেন্স: **৳০**)। সম্পূর্ণ হিসাব পরিশোধিত রয়েছে!`;
    }

    return {
      reply: custReply,
      actionCard,
      isInstantIntent: true
    };
  }

  if (isCustomerDueGeneralQuery) {
    const topDebtors = context.overdueDebtors || [];
    const topDebtor = topDebtors[0];
    const topDebtorName = topDebtor ? topDebtor.name : (isEn ? 'None' : 'কেউ নেই');
    const topDebtorAmount = topDebtor ? formatBDT(topDebtor.balance, lang) : '০';

    let dueAnalysisReply = '';
    if (topDebtor) {
      dueAnalysisReply = isEn
        ? `📋 **Customer Receivables Audit for ${context.businessName}:**\n\n` +
          `• **Total Customer Due (AR):** ${formatBDT(context.totalCustomerReceivable, 'en')} across ${context.topDebtorsCount} customers.\n` +
          `• **Highest Due Holder:** **${topDebtorName}** (${topDebtorAmount}).\n` +
          `• **Debtor Concentration:** ${context.debtorConcentrationRisk}% of all outstanding credit is tied up with only your top 3 debtors!\n\n` +
          `⚠️ **Why is due high?** Giving goods on credit without strict limits slows your cash turnover (DSO = ${context.dso} days). Send WhatsApp payment reminders and restrict further credit until partial repayment is received.`
        : isHi
        ? `📋 **ग्राहक बकाया ऑडिट:**\n\n` +
          `• **कुल ग्राहक उधारी:** ${formatBDT(context.totalCustomerReceivable, 'hi')} (${context.topDebtorsCount} ग्राहक)।\n` +
          `• **सबसे अधिक बकाया:** **${topDebtorName}** (${topDebtorAmount})।\n` +
          `• **कंसंट्रेशन रिस्क:** कुल उधारी का ${context.debtorConcentrationRisk}% सिर्फ शीर्ष 3 ग्राहकों के पास फंसा है!\n\n` +
          `⚠️ **सलाह:** उधारी कम करने के लिए ग्राहकों को तुरंत व्हाट्सएप रिमाइंडर भेजें और क्रेडिट सीमा तय करें।`
        : `📋 **কাস্টমার বাকি ও দেনাদার অডিট (${context.businessName}):**\n\n` +
          `• **মোট কাস্টমার বাকি (পাবো):** ${formatBDT(context.totalCustomerReceivable, 'bn')} (${context.topDebtorsCount} জন কাস্টমার)।\n` +
          `• **সর্বোচ্চ বাকি কার কাছে:** **${topDebtorName}** (${topDebtorAmount})।\n` +
          `• **বাকি ঘনীভবন ঝুঁকি:** মোট বাকির **${context.debtorConcentrationRisk}%** টাকা মাত্র শীর্ষ ৩ জন কাস্টমারের কাছে আটকে আছে!\n\n` +
          `⚠️ **বাকি বেশি হওয়ার কারণ ও সমাধান:** বাকিতে মালামাল দেওয়ার সময় সীমা বেঁধে না দিলে ক্যাশ ফ্লো আটকে যায় (DSO = ${context.dso} দিন)। দ্রুত ক্যাশ পেতে কাস্টমারদের হোয়াটসঅ্যাপ তাগাদা পাঠান এবং বকেয়া পরিশোধ না করা পর্যন্ত নতুন বাকি সীমিত রাখুন।`;
    } else {
      dueAnalysisReply = isEn
        ? `📋 **Customer Receivables Status:**\nGreat news! You currently have **zero overdue customer receivables**. All customer accounts are settled!`
        : `📋 **কাস্টমার বাকি অবস্থা:**\nদারুণ খবর! বর্তমানে আপনার কোনো কাস্টমার বাকি বা বকেয়া নেই। সব খাতা সম্পূর্ণ পরিশোধিত রয়েছে!`;
    }

    return {
      reply: dueAnalysisReply,
      actionCard: {
        type: 'NAVIGATE',
        title: isEn ? 'Open Due Khata Ledger' : 'বাকির খাতা খুলুন',
        screen: SCREENS.KHATA,
        buttonLabel: isEn ? '📖 View Customer Ledgers' : '📖 বাকির খাতা দেখুন'
      },
      isInstantIntent: true
    };
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // ADVISORY INTENTS 1-11: Route to Gemini for personalized AI responses
  // These queries (growth, cashflow, breakeven, KPI, DSO, margin, inventory,
  // cost, tax, DuPont, CFO audit) are now handled by Gemini AI with full
  // financial context for personalized, data-driven responses.
  // ─────────────────────────────────────────────────────────────────────────────
  const isAdvisoryQuery = (
    q.includes('গ্রোথ') || q.includes('উন্নতি') || q.includes('growth') || q.includes('scale') || q.includes('expand') ||
    q.includes('ব্যবসা বাড়া') || q.includes('বিক্রি বাড়া') || q.includes('মুনাফা বাড়া') || q.includes('বাড়াতে চাই') ||
    q.includes('ক্যাশ ফ্লো') || q.includes('cash flow') || q.includes('তরলতা') || q.includes('liquidity') || q.includes('runway') ||
    q.includes('ব্রেক ইভেন') || q.includes('break even') || q.includes('breakeven') || q.includes('সমচ্ছেদ') ||
    q.includes('স্কোরকার্ড') || q.includes('scorecard') || q.includes('kpi') || q.includes('health check') || q.includes('স্বাস্থ্য') ||
    q.includes('dso') || q.includes('dpo') || q.includes('debtor day') || q.includes('বাকির বয়স') || q.includes('বাকি দিন') ||
    q.includes('মার্জিন') || q.includes('margin') || q.includes('markup') || q.includes('দাম বাড়া') || q.includes('pricing') ||
    q.includes('ইনভেন্টরি টার্নওভার') || q.includes('inventory turnover') || q.includes('abc analysis') || q.includes('stock speed') ||
    q.includes('খরচ কমানো') || q.includes('cost cut') || q.includes('zero based') || q.includes('বাজেট') || q.includes('budget') ||
    q.includes('ভ্যাট') || q.includes('vat') || q.includes('ট্যাক্স') || q.includes('tax') || q.includes('আয়কর') || q.includes('income tax') ||
    q.includes('roe') || q.includes('roa') || q.includes('dupont') || q.includes('রিটার্ন অন') ||
    q.includes('অডিট') || q.includes('audit') || q.includes('cfo') || q.includes('সিএফও') ||
    q.includes('বিজ़নेस बढ़ाना') || q.includes('ग्रोथ') || q.includes('कैश फ्लो') || q.includes('ब्रेक ईवन') ||
    q.includes('आय बढ़ाना') || q.includes('बिक्री बढ़ाना') || q.includes('काস्ट कट') || q.includes('वैट') ||
    q.includes('increase sales') || q.includes('revenue growth') || q.includes('more income') ||
    q.includes('customer increase') || q.includes('কাস্টমার বাড়ানো') || q.includes('ইনকাম বাড়ানো') ||
    q.includes('আয় বাড়ানো') || q.includes('সেল বাড়ানো') || q.includes('কিভাবে বাড়াবো')
  );

  if (isAdvisoryQuery) {
    // Return null to route to Gemini AI for personalized, context-aware response
    return null;
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // 12. Standard Transactional Intents (Preserved with full fidelity)
  // ─────────────────────────────────────────────────────────────────────────────

  // Add Expense (e.g. "চা নাস্তা খরচ ৫০ টাকা লিখো", "nasta 120 taka expense", "chai 50 rupaye kharcha")
  const expenseRegex = /(?:খরচ|खर्च|खर्चा|expense|cost|bill)[\s\S]*?(\d+)|(\d+)[\s\S]*?(?:টাকা|tk|টাকার|रुपये|rupaye|rs|dollar|\$)?[\s\S]*?(?:খরচ|खर्च|खर्चा|expense)/i;
  const matchExp = q.match(expenseRegex);
  const isExpQuery = matchExp && !q.includes('কিভাবে') && !q.includes('কীভাবে') && !q.includes('how to') && !q.includes('কম') && !q.includes('বাজেট') && !q.includes('बजट') && !q.includes('বাঁচাবো') && !q.includes('নিয়ন্ত্রণ');
  if (isExpQuery) {
    const rawAmt = matchExp[1] || matchExp[2];
    const amount = Number(rawAmt) || 0;
    if (amount > 0) {
      let category = 'চা/নাস্তা ও আপ্যায়ন';
      if (q.includes('ভাড়া') || q.includes('rent') || q.includes('किराया')) category = 'দোকান ভাড়া';
      else if (q.includes('বিদ্যুৎ') || q.includes('কারেন্ট') || q.includes('electricity') || q.includes('बिजली')) category = 'বিদ্যুৎ বিল';
      else if (q.includes('বেতন') || q.includes('salary') || q.includes('तनख्वाह') || q.includes('वेतन')) category = 'কর্মীর বেতন';
      else if (q.includes('পরিবহন') || q.includes('transport') || q.includes('ভাড়া')) category = 'যাতায়াত ও পরিবহন';

      return {
        reply: isEn 
          ? `I've recorded ${formatBDT(amount, 'en')} expense for **${category}**.` 
          : isHi
          ? `**${category}** के लिए ${formatBDT(amount, 'hi')} खर्च दर्ज कर लिया है।`
          : `**${category}** বাবদ ${formatBDT(amount, 'bn')} খরচ হিসাবভুক্ত করা হয়েছে।`,
        actionCard: {
          type: 'EXPENSE_DRAFT',
          title: isEn ? 'Confirm Expense Entry' : isHi ? 'खर्च प्रविष्टि पुष्टि करें' : 'খরচ নিশ্চিত করুন',
          category,
          amount,
          note: query.trim(),
          buttonLabel: isEn ? 'Save Expense Now' : isHi ? '✓ खर्च में दर्ज करें' : '✓ খরচের হিসাবে যোগ করুন'
        }
      };
    }
  }

  // Add Sale (e.g. "ক্যাশ বিক্রি ৫০০ টাকা", "sold 500 tk")
  const saleRegex = /(?:বিক্রি|बिक्री|बेचा|सेल|sale|sales|sold|cash sale)[\s\S]*?(\d+)|(\d+)[\s\S]*?(?:টাকা|tk)?[\s\S]*?(?:বিক্রি|बिक्री|बेচা|सेल|sale|sales|sold)/i;
  const matchSale = q.match(saleRegex);
  if (matchSale && (q.includes('লিখ') || q.includes('যোগ') || q.includes('add') || q.includes('record') || q.includes('হলো') || q.includes('হইছে') || q.includes('সেল হইছে') || q.includes('মাল বিক্রি') || q.includes('sold') || q.includes('बेचा') || q.includes('बेचলাম') || q.includes('গেছে'))) {
    const rawAmt = matchSale[1] || matchSale[2];
    const amount = Number(rawAmt) || 0;
    if (amount > 0) {
      return {
        reply: isEn 
          ? `Cash sale of ${formatBDT(amount, 'en')} has been recorded in your cash drawer.` 
          : isHi
          ? `${formatBDT(amount, 'hi')} नकद बिक्री गल्ले में दर्ज कर ली गई है।`
          : `${formatBDT(amount, 'bn')} নগদ বিক্রি ক্যাশবক্সে জমা করা হয়েছে।`,
        actionCard: {
          type: 'SALE_DRAFT',
          title: isEn ? 'Confirm Cash Sale' : isHi ? 'नकद बिक्री पुष्टि करें' : 'ক্যাশ বিক্রি নিশ্চিত করুন',
          amount,
          note: query.trim(),
          buttonLabel: isEn ? 'Record Sale Now' : isHi ? '✓ गल्ले में जमा करें' : '✓ ক্যাশবক্সে জমা করুন'
        }
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. INTENT: Due Given Entry (বাকি দিলাম / ধার দিলাম / उधार दिया / Due Given)
  // ─────────────────────────────────────────────────────────────────────────────
  const isDueGivenQuery = 
    q.includes('বাকি দিলাম') || q.includes('বাকি দিছি') || q.includes('বাকি দিয়েছি') ||
    q.includes('বাকি দে') || q.includes('বাকি দেওয়া') || q.includes('বাকি দেয়া') || q.includes('বাকি দেওয়া') ||
    q.includes('বাকি তে দিলাম') || q.includes('বাকিতে দিলাম') || q.includes('বাকিতে দেওয়া') ||
    q.includes('ধারে দিলাম') || q.includes('ধারে দিছি') || q.includes('ধার দিলাম') || q.includes('ধার দিছি') ||
    q.includes('ধার দেওয়া') || q.includes('ধার দেয়া') || q.includes('ধার দেওয়া') || q.includes('ধারে দেওয়া') ||
    q.includes('উধার দিয়া') || q.includes('उधार दिया') || q.includes('उधारी दिया') || q.includes('उधार दी') ||
    q.includes('बाकी दिया') || q.includes('कर्ज दिया') || q.includes('due given') || q.includes('gave due') ||
    q.includes('credit given') || q.includes('give credit') ||
    ((q.includes('বাকি') || q.includes('ধার') || q.includes('ধারে') || q.includes('কর্জ')) && /(?:দিলাম|দিয়েছি|দিয়েছি|দিছি|দেওয়া|দেয়া|দেওয়া|দেবো|দিব)/.test(q));

  if (isDueGivenQuery) {
    const numMatch = q.match(/(\d+)/);
    if (numMatch) {
      const amount = parseInt(numMatch[1], 10);
      let contact = (context.contacts || []).find(c => q.includes(c.name.toLowerCase()));
      if (!contact && context.contacts) {
        contact = context.contacts.find(c => {
          const tokens = c.name.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
          return tokens.some(t => q.includes(t));
        });
      }
      const cName = contact?.name || extractVoiceContactName(query, context.contacts) || (isEn ? 'Customer' : isHi ? 'ग्राहक' : 'কাস্টমার');
      return {
        reply: isEn
          ? `Recorded due of ${formatBDT(amount, 'en')} for **${cName}**.`
          : isHi
          ? `**${cName}** को ${formatBDT(amount, 'hi')} उधारी लिख दी गई है।`
          : `**${cName}**-কে ${formatBDT(amount, 'bn')} বাকি লিখে দিয়েছি।`,
        actionCard: {
          type: 'DUE_GIVE_DRAFT',
          title: isEn ? 'Confirm Due Given' : isHi ? 'उधार देना पुष्टि करें' : 'বাকি দেওয়া নিশ্চিত করুন',
          contactId: contact?.id || null,
          contactName: cName,
          amount,
          note: `${cName} - বাকি দেওয়া`,
          buttonLabel: isEn ? 'Record Due Given' : isHi ? '✓ उधारी जोड़ें' : '✓ বাকি হিসাবে যোগ করুন'
        }
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. INTENT: Due Collected / Payment Received (বাকি পেলাম / उधार वापस)
  // ─────────────────────────────────────────────────────────────────────────────
  const isDueCollectQuery =
    !isDueGivenQuery && (
      q.includes('বাকি পেলাম') || q.includes('বাকি আদায়') || q.includes('বাকি আদায়ে') || q.includes('বাকি দিছে') ||
      q.includes('বাকি পেয়েছি') || q.includes('টাকা দিছে') || q.includes('টাকা দিয়েছে') ||
      q.includes('পরিশোধ করল') || q.includes('পরিশোধ করলো') || q.includes('শোধ করল') || q.includes('শোধ করলো') ||
      (/(?:^|\s)(?:দিল|দিলো|দিলেন)(?:\s|$)/.test(q) && !/(?:দিলাম|দিচ্ছি|দিয়েছি|দিয়েছি|দিব|দিবো)/.test(q) && (q.includes('বাকি') || q.includes('টাকা') || q.includes('জমা'))) ||
      (q.includes('বাকি') && (q.includes('পেলাম') || q.includes('পেয়েছি') || q.includes('pelam') || q.includes('পেলুম') || q.includes('দিছে') || q.includes('আদায়') || q.includes('আদায়'))) ||
      q.includes('উধার মিলা') || q.includes('उधार वापस') || q.includes('पैसा मिला') || q.includes('बाकी मिला') ||
      q.includes('due collected') || q.includes('payment received') || q.includes('collected due')
    );

  if (isDueCollectQuery) {
    const numMatch = q.match(/(\d+)/);
    if (numMatch) {
      const amount = parseInt(numMatch[1], 10);
      let contact = (context.contacts || []).find(c => q.includes(c.name.toLowerCase()));
      if (!contact && context.contacts) {
        contact = context.contacts.find(c => {
          const tokens = c.name.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
          return tokens.some(t => q.includes(t));
        });
      }
      const cName = contact?.name || extractVoiceContactName(query, context.contacts) || (isEn ? 'Customer' : isHi ? 'ग्राहक' : 'কাস্টমার');
      return {
        reply: isEn
          ? `Recorded due collection of ${formatBDT(amount, 'en')} from **${cName}**.`
          : isHi
          ? `**${cName}** से ${formatBDT(amount, 'hi')} उधारी वसूली जमा कर ली गई है।`
          : `**${cName}** থেকে ${formatBDT(amount, 'bn')} বাকি আদায় জমা করেছি।`,
        actionCard: {
          type: 'DUE_COLLECT_DRAFT',
          title: isEn ? 'Confirm Due Collection' : isHi ? 'उधारी वसूली पुष्टि करें' : 'বাকি আদায় নিশ্চিত করুন',
          contactId: contact?.id || null,
          contactName: cName,
          amount,
          note: `${cName} - বাকি আদায়`,
          buttonLabel: isEn ? 'Record Collection' : isHi ? '✓ उधारी वसूली जोड़ें' : '✓ বাকি আদায় যোগ করুন'
        }
      };
    }
  }

  // Due Reminder / WhatsApp
  if (q.includes('মেসেজ') || q.includes('reminder') || q.includes('হোয়াটসঅ্যাপ') || q.includes('whatsapp') || q.includes('তাগাদা')) {
    const contact = (context.contacts || []).find(c => q.includes(c.name.toLowerCase()));
    if (contact && Number(contact.currentBalance) > 0) {
      const balStr = formatBDT(contact.currentBalance, lang);
      const textMsg = encodeURIComponent(
        `আসসালামু আলাইকুম ${contact.name} ভাই, আপনার কাছে ${context.businessName}-এর পূর্বের বকেয়া ৳${balStr} বাকি রয়েছে। অনুগ্রহ করে বকেয়া পরিশোধ করার অনুরোধ রইল। ধন্যবাদ!`
      );
      const waUrl = contact.phone 
        ? `https://wa.me/88${contact.phone.replace(/[^0-9]/g, '')}?text=${textMsg}`
        : null;

      return {
        reply: isEn 
          ? `Customer **${contact.name}** has an outstanding balance of ৳${balStr}. You can send a polite WhatsApp reminder directly below.` 
          : `গ্রাহক **${contact.name}** এর কাছে ৳${balStr} বাকি রয়েছে। সহজে তাগাদা পাঠাতে নিচের বাটনে চাপ দিন:`,
        actionCard: {
          type: 'WHATSAPP_REMINDER',
          title: isEn ? `Remind ${contact.name}` : `${contact.name}-কে বাকি তাগাদা`,
          name: contact.name,
          phone: contact.phone || 'ফোন নম্বর নেই',
          balance: contact.currentBalance,
          url: waUrl,
          buttonLabel: isEn ? 'Open WhatsApp Message' : '📱 হোয়াটসঅ্যাপে তাগাদা পাঠান'
        }
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Cash Conversion Cycle (CCC - Working Capital Velocity)
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('cash conversion cycle') || q.includes('ccc') || 
    q.includes('ক্যাশ কনভার্সন সাইকেল') || q.includes('নগদ রূপান্তর চক্র') ||
    q.includes('conversion cycle') || q.includes('operating cycle') ||
    q.includes('कैश कन्वर्जन साइकिल') || q.includes('कैश साइकिल')
  ) {
    return {
      reply: isEn
        ? `⏱️ **Cash Conversion Cycle (CCC - Working Capital Velocity):**\n\n` +
          `• **Your Net Cash Conversion Cycle:** **${context.cashConversionCycle} Days**\n` +
          `• **Formula**: Days Sales Outstanding (DSO: ${context.dso}d) + Days Sales of Inventory (DSI: ${context.dsi}d) - Days Payable Outstanding (DPO: ${context.dpo}d)\n\n` +
          `💡 **CFO Strategic Advice:**\n` +
          `A shorter CCC means your cash spends fewer days trapped in inventory and customer receivables before flowing back into your bank account. Target a CCC below 30 days to maximize free operating cash flow.`
        : isHi
        ? `⏱️ **कैश कन्वर्जन साइकिल (CCC - नकद चक्र गति):**\n\n` +
          `• **आपकी कुल कैश कन्वर्जन अवधि:** **${context.cashConversionCycle} दिन**\n` +
          `• **सूत्र (Formula)**: उधारी वसूली दिन (DSO: ${context.dso}d) + स्टॉक बिक्री दिन (DSI: ${context.dsi}d) - सप्लायर भुगतान दिन (DPO: ${context.dpo}d)\n\n` +
          `💡 **CFO सलाह:**\n` +
          `कैश साइकिल जितना छोटा होगा, आपकी कार्यशील पूंजी (Working Capital) उतनी ही तेजी से नकद में बदलेगी। 30 दिन से कम का CCC बिज़नेस को अत्यधिक मजबूत बनाता है।`
        : `⏱️ **ক্যাশ কনভার্সন সাইকেল (CCC - নগদ রূপান্তর চক্র):**\n\n` +
          `• **আপনার বর্তমান নিট ক্যাশ সাইকেল:** **${context.cashConversionCycle} দিন**\n` +
          `• **হিসাবের সূত্র:** বাকি আদায়ের মেয়াদ (DSO: ${context.dso} দিন) + পণ্য বিক্রির মেয়াদ (DSI: ${context.dsi} দিন) - মহাজন পরিশোধ মেয়াদ (DPO: ${context.dpo} দিন)\n\n` +
          `💡 **সিএফও কৌশলগত পরামর্শ:**\n` +
          `ক্যাশ সাইকেলের দিন যত কম হবে, আপনার টাকা বাকি ও স্টকে কম সময় আটকে থাকবে এবং দ্রুত ক্যাশবক্সে ফিরে আসবে। ৩০ দিনের নিচে ক্যাশ সাইকেল বজায় রাখলে কোনো ঋণ ছাড়াই ব্যবসা স্বয়ংক্রিয়ভাবে বড় করা যায়।`,
      actionCard: {
        type: 'NAVIGATE',
        title: isEn ? 'Open Cash Flow Diagnostics' : isHi ? 'कैश फ्लो डायग्नोस्टिक्स खोलें' : 'ক্যাশ ফ্লো অ্যানালিটিক্স খুলুন',
        screen: SCREENS.ANALYTICS,
        buttonLabel: isEn ? '⏱️ View CCC Breakdown' : isHi ? '⏱️ CCC विवरण देखें' : '⏱️ CCC বিশ্লেষণ দেখুন'
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Fixed Assets Register (IAS 16 - Property, Plant & Equipment)
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('fixed asset') || q.includes('স্থায়ী সম্পদ') || q.includes('স্থায়ী সম্পদ') ||
    q.includes('ias 16') || q.includes('property plant') || q.includes('উপকরণ') ||
    q.includes('स्थायी संपत्ति') || q.includes('assets register')
  ) {
    return {
      reply: isEn
        ? `🏛️ **Fixed Assets Register (IAS 16 - Property, Plant & Equipment):**\n\n` +
          `• **Definition**: Long-term tangible business assets (shop fittings, POS hardware, delivery vehicles, machinery) used for > 1 year.\n` +
          `• **Accounting Treatment**: Must be capitalized on the Balance Sheet and depreciated systematically over their useful economic life (Straight-Line or Diminishing Balance Method).\n` +
          `• **Ledgero Action**: Manage and track asset depreciation schedules inside **Advanced Mode ➔ Accounting & Compliance ➔ Fixed Assets Register** (Hotkey: \`Alt + F\`).`
        : isHi
        ? `🏛️ **स्थायी संपत्ति रजिस्टर (IAS 16 - Fixed Assets Register):**\n\n` +
          `• **परिभाषा**: व्यापार में 1 वर्ष से अधिक समय तक उपयोग की जाने वाली भौतिक संपत्तियां (दुकान का फर्नीचर, बिलिंग कंप्यूटर, डिलीवरी वाहन, मशीनें)।\n` +
          `• **अकाउंटिंग नियम**: इन्हें बैलेंस शीट पर संपत्ति के रूप में दर्ज किया जाता है और हर साल मूल्यह्रास (Depreciation) काटा जाता है।\n` +
          `• **कार्रवाई**: संपत्ति जोड़ने और डेप्रिसिएशन ट्रैक करने के लिए **Advanced Mode ➔ Accounting & Compliance ➔ Fixed Assets Register** (\`Alt + F\`) पर जाएँ।`
        : `🏛️ **স্থায়ী সম্পদ রেজিস্টার (IAS 16 - Property, Plant & Equipment):**\n\n` +
          `• **সংজ্ঞা:** ব্যবসায় ১ বছরের বেশি সময় ধরে ব্যবহৃত দৃশ্যমান সম্পদসমূহ (যেমন: দোকানের আসবাবপত্র, ফ্রিজ, কম্পিউটার, ডেলিভারি ভ্যান, ভারী সরঞ্জাম)।\n` +
          `• **হিসাবরক্ষণ পদ্ধতি:** এগুলোকে সরাসরি সাধারণ খরচ হিসেবে না দেখিয়ে ব্যালেন্স শিটের সম্পদ কলামে লিপিবদ্ধ করতে হয় এবং প্রতি বছর নির্দিষ্ট হারে অবচয় (Depreciation) চার্জ করতে হয়।\n` +
          `• **লেজেরো গাইডবুক:** স্থায়ী সম্পদ যোগ ও ট্র্যাক করতে **Advanced Mode ➔ Accounting & Compliance ➔ Fixed Assets Register** (\`Alt + F\`) ব্যবহার করুন।`,
      actionCard: {
        type: 'NAVIGATE',
        title: isEn ? 'Open Fixed Assets Register' : isHi ? 'स्थायी संपत्ति रजिस्टर खोलें' : 'স্থায়ী সম্পদ রেজিস্টার খুলুন',
        screen: SCREENS.ANALYTICS,
        buttonLabel: isEn ? '🏛️ View Asset Register' : isHi ? '🏛️ संपत्ति रजिस्टर देखें' : '🏛️ স্থায়ী সম্পদ রেজিস্টার দেখুন'
      }
    };
  }

  // Cash Position / Drawer Balance
  if (
    !q.includes('cycle') && !q.includes('conversion') && !q.includes('ccc') && !q.includes('চক্র') && !q.includes('সাইকেল') &&
    (q.includes('ক্যাশ') || q.includes('ড্রয়ার') || q.includes('বাক্স') || q.includes('cash') || q.includes('drawer') || q.includes('টাকা আছে') || q.includes('गल्ला') || q.includes('हाथ में कैश'))
  ) {
    return {
      isInstantIntent: true,
      reply: isEn 
        ? `💰 **Liquid Cash Reserves:**\n• **Cash in Drawer:** ${formatBDT(context.cashInDrawer, 'en')}\n• **Bank Accounts:** ${formatBDT(context.bankBalances, 'en')}\n• **Digital Wallets:** ${formatBDT(context.digitalBalances, 'en')}\n\n✨ **Total Liquid Liquidity:** ${formatBDT(context.totalLiquidCash, 'en')}\n⏱️ **Cash Runway:** ${context.cashRunwayDays} Days`
        : isHi
        ? `💰 **कुल नकद और बैंक भंडार (Liquid Cash):**\n• **गल्ले/ड्रॉर में कैश:** ${formatBDT(context.cashInDrawer, 'hi')}\n• **बैंक खातों में:** ${formatBDT(context.bankBalances, 'hi')}\n• **डिजिटल वॉलेट्स:** ${formatBDT(context.digitalBalances, 'hi')}\n\n✨ **कुल उपलब्ध तरलता:** ${formatBDT(context.totalLiquidCash, 'hi')}\n⏱️ **कैश रनवे:** ${context.cashRunwayDays} दिन`
        : `💰 **আপনার মোট তরল তহবিল (Liquid Cash):**\n• **ক্যাশ ড্রয়ারে আছে:** ${formatBDT(context.cashInDrawer, 'bn')}\n• **ব্যাংক অ্যাকাউন্টে:** ${formatBDT(context.bankBalances, 'bn')}\n• **ডিজিটাল ওয়ালেট (বিকাশ/নগদ):** ${formatBDT(context.digitalBalances, 'bn')}\n\n✨ **সর্বমোট তারল্য:** ${formatBDT(context.totalLiquidCash, 'bn')}\n⏱️ **ক্যাশ রানওয়ে:** ${context.cashRunwayDays} দিন`
    };
  }

  // 15. INTENT: Profit / Loss Query (Evaluated BEFORE general today summary!)
  if (
    q.includes('লাভ কত') || q.includes('মুনাফা কত') || q.includes('profit') || 
    q.includes('নিট প্রফিট') || q.includes('লস') || q.includes('আজকে লাভ') || q.includes('আজকের লাভ') ||
    q.includes('মুনাফা') || q.includes('लाभ') || q.includes('नुकसान') ||
    q.includes('how is my profit') || q.includes('how much profit') ||
    q.match(/(?:বেশি|কম|বেশি না কম|ज्यादा|कम).*(?:বিক্রি|খরচ|लाभ)/)
  ) {
    const dailyProfit = context.cashSales * (context.grossMarginPct / 100);
    return {
      isInstantIntent: true,
      reply: isEn
        ? `📊 **Profit Analysis:**\n• Estimated gross profit margin is **${context.grossMarginPct}%**.\n• Based on today's cash sales of ${formatBDT(context.cashSales, 'en')}, the estimated gross profit today is around **${formatBDT(dailyProfit, 'en')}**.\n• Your net margin is **${context.netMarginPct}%** after all operating expenses.`
        : isHi
        ? `📊 **मुनाफा विश्लेषण:**\n• अनुमानित ग्रॉस मार्जिन **${context.grossMarginPct}%** है।\n• आज की ${formatBDT(context.cashSales, 'hi')} नकद बिक्री के आधार पर, आज का अनुमानित ग्रॉस मुनाफा लगभग **${formatBDT(dailyProfit, 'hi')}** है।\n• सभी खर्चों के बाद आपका नेट मार्जिन **${context.netMarginPct}%** है।`
        : `📊 **মুনাফা বিশ্লেষণ:**\n• আপনার ব্যবসার আনুমানিক গ্রস মার্জিন হলো **${context.grossMarginPct}%**।\n• আজকের ${formatBDT(context.cashSales, 'bn')} ক্যাশ বিক্রির ওপর ভিত্তি করে, আজকের আনুমানিক গ্রস লাভ প্রায় **${formatBDT(dailyProfit, 'bn')}**।\n• সমস্ত খরচ বাদ দিয়ে আপনার নিট মার্জিন হলো **${context.netMarginPct}%**।`
    };
  }

  // Today's Operational Summary (Strict matching, won't hijack How-to or Profit queries)
  const isTodaySummary = !q.includes('কিভাবে') && !q.includes('কীভাবে') && !q.includes('how to') && !q.includes('লাভ') && !q.includes('profit') && (
    q.includes('আজকের সারসংক্ষেপ') || q.includes('দিনের সামারি') || q.includes('দিনের রিপোর্ট') || 
    q.includes('আজকের রিপোর্ট') || q.includes('আজ কেমন গেল') || q.includes('আজকের হিসাব') ||
    q.includes('today report') || q.includes('today summary') || q.includes('operational summary') || 
    q.includes('आज का हिसाब') || q.includes('आज का सारांश') || q.includes('আজকের মোট বিক্রি') ||
    q.includes('বিক্রি কত হলো') || q.includes('বিক্রি কত') || q.includes('মোট বিক্রি কত') ||
    q.includes('how much sale') || q.includes('total sales today') || q.includes('kitni bikri') ||
    q.includes('बिक्री कितनी हुई') || q.includes('बिक्री कितनी') ||
    ((q.includes('আজকে') || q.includes('আজকের')) && (q.includes('বিক্রি') || q.includes('বেচা')) && !q.includes('যোগ') && !q.includes('লিখ')) ||
    (q.includes('today') && (q.includes('sale') || q.includes('sales')) && !q.includes('add')) ||
    q.match(/(?:আজ|today).*(?:কত|how much|कितन)/)
  );

  if (isTodaySummary) {
    return {
      isInstantIntent: true,
      reply: isEn 
        ? `📊 **Today's Operational Summary (${context.date}):**\n• 🟢 **Cash Sales:** ${formatBDT(context.cashSales, 'en')} (${context.transactionsCount} entries)\n• 🟢 **Total Cash In:** ${formatBDT(context.totalCashIn, 'en')}\n• 🔴 **Total Expenses:** ${formatBDT(context.expenses, 'en')}\n• ⚠️ **Due Given Today:** ${formatBDT(context.dueGivenToday, 'en')}\n• 💵 **Due Collected:** ${formatBDT(context.dueCollectedToday, 'en')}\n\n📈 **Net Day Cash Flow:** ${formatBDT(context.netDayMovement, 'en')}`
        : isHi
        ? `📊 **आज का हिसाब और सारांश (${context.date}):**\n• 🟢 **नकद बिक्री:** ${formatBDT(context.cashSales, 'hi')} (${context.transactionsCount} लेन-देन)\n• 🟢 **कुल जमा (Cash In):** ${formatBDT(context.totalCashIn, 'hi')}\n• 🔴 **कुल खर्च (Expenses):** ${formatBDT(context.expenses, 'hi')}\n• ⚠️ **आज उधारी दी:** ${formatBDT(context.dueGivenToday, 'hi')}\n• 💵 **आज उधारी वसूली:** ${formatBDT(context.dueCollectedToday, 'hi')}\n\n📈 **आज का नेट कैश फ्लो:** ${formatBDT(context.netDayMovement, 'hi')}`
        : `📊 **আজকের সারসংক্ষেপ (${context.date}):**\n• 🟢 **ক্যাশ বিক্রি:** ${formatBDT(context.cashSales, 'bn')} (${context.transactionsCount}টি লেনদেন)\n• 🟢 **মোট জমা (Cash In):** ${formatBDT(context.totalCashIn, 'bn')}\n• 🔴 **মোট খরচ (Expense):** ${formatBDT(context.expenses, 'bn')}\n• ⚠️ **আজকে বাকি দেওয়া:** ${formatBDT(context.dueGivenToday, 'bn')}\n• 💵 **আজকের বাকি আদায়:** ${formatBDT(context.dueCollectedToday, 'bn')}\n\n📈 **আজকের নেট ক্যাশ মুভমেন্ট:** ${formatBDT(context.netDayMovement, 'bn')}`
    };
  }

  // Stock / Inventory (Checked before Khata so "mal kitna baki hai" matches Stock!)
  if (
    !q.includes('how to') && !q.includes('কিভাবে') && !q.includes('কীভাবে') && 
    !q.includes('যোগ') && !q.includes('add') && !q.includes('নতুন') && !q.includes('नया') &&
    (
      q.includes('স্টক') || q.includes('stock') || q.includes('inventory') || 
      q.includes('মালামাল') || q.includes('মাল কত') || q.includes('মাল কতটুকু') || 
      q.includes('माल कितना') || (q.includes('माल') && (q.includes('बाकी') || q.includes('बचा') || q.includes('कितना'))) ||
      q.includes('stoc') ||
      (q.includes('পণ্য') && (q.includes('কত') || q.includes('আছে') || q.includes('মোট') || q.includes('তালিকা'))) ||
      (q.includes('product') && (q.includes('how much') || q.includes('count') || q.includes('total') || q.includes('list')))
    )
  ) {
    let lowStockText = '';
    if (context.lowStockItems.length > 0) {
      lowStockText = context.lowStockItems.map(p => `• **${p.name}** (বাকি মাত্র ${p.units} টি)`).join('\n');
    } else {
      lowStockText = isEn ? 'All items are well-stocked.' : isHi ? 'सभी सामान पर्याप्त मात्रा में उपलब्ध हैं।' : 'সব পণ্যের পর্যাপ্ত স্টক রয়েছে।';
    }

    return {
      isInstantIntent: true,
      reply: isEn 
        ? `📦 **Inventory Status (IAS 2):**\n• Total Stock: **${context.totalStockUnits}** units\n• Estimated Stock Investment: **${formatBDT(context.totalStockInvestment, 'en')}**\n• Days Sales of Inventory (DSI): **${context.dsi} Days**\n\n⚠️ **Low Stock Alert (Reorder Required):**\n${lowStockText}`
        : isHi
        ? `📦 **स्टॉक और इन्वेंट्री स्थिति (IAS 2):**\n• कुल उपलब्ध स्टॉक: **${context.totalStockUnits}** यूनिट्स\n• कुल स्टॉक खरीद मूल्य: **${formatBDT(context.totalStockInvestment, 'hi')}**\n• स्टॉक बिक्री औसत दिन (DSI): **${context.dsi} दिन**\n\n⚠️ **कम स्टॉक चेतावनी:**\n${lowStockText}`
        : `📦 **স্টক ও ইনভেন্টরি স্থিতি (IAS 2):**\n• মোট মজুত পণ্য: **${context.totalStockUnits}** টি\n• মোট পণ্যের ক্রয়মূল্য: **${formatBDT(context.totalStockInvestment, 'bn')}**\n• পণ্য বিক্রির গড় সময় (DSI): **${context.dsi} দিন**\n\n⚠️ **কম স্টকের সতর্কতা (রি-অর্ডার প্রয়োজন):**\n${lowStockText}`
    };
  }

  // Khata / Debtor list
  if (
    !q.includes('माल') && !q.includes('মালামাল') && (
      q.includes('বাকি') || q.includes('পাবো') || q.includes('খাতা') || q.includes('due') || q.includes('receivable') || q.includes('debt') || q.includes('কার কার') || q.includes('বকেয়া') || q.includes('পাওনা') || q.includes('পাওনাদার') || q.includes('কে দিবে') || q.includes('বাকি কত') || q.includes('কত বাকি') || q.includes('total due') || q.includes('कुल बकाया') || q.includes('কাদের কাছে বাকি') || q.includes('উধার')
    )
  ) {
    let debtorListText = '';
    if (context.overdueDebtors.length > 0) {
      debtorListText = context.overdueDebtors
        .map((d, i) => `${i + 1}. **${d.name}**: ${formatBDT(d.balance, lang)}`)
        .join('\n');
    } else {
      debtorListText = isEn ? 'No customer dues pending!' : isHi ? 'किसी भी ग्राहक के पास कोई उधारी बकाया नहीं है!' : 'কারো কাছে কোনো বকেয়া বাকি নেই!';
    }

    return {
      isInstantIntent: true,
      reply: isEn 
        ? `📋 **Customer Receivables (কাস্টমার বাকি):**\nTotal Due: **${formatBDT(context.totalCustomerReceivable, 'en')}** across ${context.topDebtorsCount} customers.\nDebtor Days (DSO): **${context.dso} Days**\n\n**Top Outstanding Accounts:**\n${debtorListText}`
        : isHi
        ? `📋 **ग्राहकों की कुल उधारी (Customer Receivables):**\nकुल बकाया: **${formatBDT(context.totalCustomerReceivable, 'hi')}** (${context.topDebtorsCount} ग्राहक)\nवसूली औसत दिन (DSO): **${context.dso} दिन**\n\n**शीर्ष बकायेदार:**\n${debtorListText}`
        : `📋 **কাস্টমারদের কাছে মোট বাকি পাবো:** ${formatBDT(context.totalCustomerReceivable, 'bn')} (${context.topDebtorsCount} জন কাস্টমার)\nবাকি আদায়ের গড় মেয়াদ: **${context.dso} দিন**\n\n**শীর্ষ বকেয়া তালিকা:**\n${debtorListText}`,
      actionCard: {
        type: 'NAVIGATE',
        title: isEn ? 'Open Khata Screen' : isHi ? 'खाता स्क्रीन खोलें' : 'বাকির খাতা খুলুন',
        screen: SCREENS.KHATA,
        buttonLabel: isEn ? 'Go to Khata' : isHi ? '📖 पूरा खाता देखें' : '📖 পুরো খাতা দেখুন'
      }
    };
  }

  // Close Day
  if (q.includes('দিন শেষ') || q.includes('ক্লোজ') || q.includes('ক্লোজিং') || q.includes('close day') || q.includes('finalize')) {
    return {
      isInstantIntent: true,
      reply: isEn 
        ? `🌙 You can finalize today's accounts on the Closing screen. System expects ${formatBDT(context.cashInDrawer, 'en')} in your drawer.`
        : `🌙 আপনি ক্লোজিং স্ক্রিনে গিয়ে আজকের দিনের ক্যাশ গণনা করে দিন সমাপ্ত করতে পারেন। সিস্টেম অনুযায়ী ড্রয়ারে ${formatBDT(context.cashInDrawer, 'bn')} থাকার কথা।`,
      actionCard: {
        type: 'NAVIGATE',
        title: isEn ? 'Finalize Day' : 'দিন সমাপ্ত করুন',
        screen: SCREENS.CLOSING,
        buttonLabel: isEn ? 'Open Closing Screen' : '🌙 ক্লোজিং স্ক্রিনে যান'
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. INTENT: Thank You / Appreciation
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('ধন্যবাদ') || q.includes('থ্যাংকস') || q.includes('thanks') || 
    q.includes('thank you') || q.includes('धन्यवाद') || q.includes('शुक्रिया')
  ) {
    return {
      isInstantIntent: true,
      reply: isEn 
        ? `You're very welcome! I'm always here to help you grow your business. Feel free to ask me anything anytime. 😊`
        : isHi
        ? `आपका बहुत-बहुत स्वागत है! मैं आपके बिज़नेस को बढ़ाने में मदद करने के लिए हमेशा यहाँ हूँ। कभी भी कुछ भी पूछें। 😊`
        : `আপনাকে অসংখ্য ধন্যবাদ! আপনার ব্যবসার বৃদ্ধিতে সাহায্য করতে আমি সবসময় প্রস্তুত। যেকোনো সময় যেকোনো প্রশ্ন করতে পারেন। 😊`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 16. INTENT: Help / What can you do
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('কি করতে পারো') || q.includes('সাহায্য') || q.includes('help') || 
    q.includes('সক্ষমতা') || q.includes('क्या कर सकते') || q.includes('मदद') || 
    q.includes('सहायता') || q.includes('কি কি করতে পারো') || q.includes('what can you do')
  ) {
    return {
      isInstantIntent: true,
      reply: isEn
        ? `Here's what I can do for you:\n1. **Financial Health**: Analyze 14 KPIs and scorecard\n2. **Sales & Cash Flow**: Track daily summary, break-even, and runway\n3. **CFO Advice**: Cost-cutting, pricing margin, DuPont ROE analysis\n4. **Data Entry**: Add expenses, sales, and due records\n5. **Debtor Management**: Track dues and send WhatsApp reminders`
        : isHi
        ? `यहाँ मेरी मुख्य क्षमताएँ हैं:\n1. **फाइनेंशियल हेल्थ**: 14 KPI और स्कोरकार्ड का विश्लेषण\n2. **बिक्री और कैश फ्लो**: रोज़ाना बिक्री, ब्रेक-ईवन और रनवे ट्रैक करना\n3. **CFO सलाह**: खर्च घटाना, मार्जिन बढ़ाना, ड्यूपॉन्ट विश्लेषण\n4. **डेटा एंट्री**: खर्च, बिक्री और उधारी रिकॉर्ड करना\n5. **उधारी वसूली**: उधारी ट्रैक करना और WhatsApp पर रिमाइंडर भेजना`
        : `আমি আপনাকে নিচের বিষয়গুলোতে সাহায্য করতে পারি:\n১. **আর্থিক স্বাস্থ্য**: ১৪টি কেপিআই ও স্কোরকার্ড বিশ্লেষণ\n২. **বিক্রি ও ক্যাশ ফ্লো**: দৈনিক হিসাব, ব্রেক-ইভেন ও রানওয়ে বের করা\n৩. **সিএফও পরামর্শ**: খরচ কমানো, মার্জিন বাড়ানো, ডুপন্ট মডেল\n৪. **হিসাব লেখা**: কথায় বলে খরচ, বিক্রি ও বাকির এন্ট্রি করা\n৫. **বাকি আদায়**: বকেয়া খাতা দেখা এবং হোয়াটসঅ্যাপে তাগাদা পাঠানো`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 17. INTENT: Product/Service Price Query
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('দাম কত') || q.includes('price') || q.includes('rate') || 
    q.includes('কত করে') || q.includes('कीमत') || q.includes('दाम') || 
    q.includes('रेट')
  ) {
    return {
      reply: isEn
        ? `I can help you set the optimal price using our margin calculator. Could you specify which item's price you want to check or adjust?`
        : isHi
        ? `मैं मार्जिन कैलकुलेटर के ज़रिए सही कीमत तय करने में आपकी मदद कर सकता हूँ। क्या आप बता सकते हैं कि किस आइटम की कीमत देखनी है?`
        : `আমি মার্জিন ক্যালকুলেটর ব্যবহার করে সঠিক দাম নির্ধারণে সাহায্য করতে পারি। আপনি কি নির্দিষ্ট কোনো পণ্যের দাম জানতে বা নির্ধারণ করতে চাচ্ছেন?`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 18. INTENT: Loan / Financing Advice
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('লোন') || q.includes('ঋণ') || q.includes('ব্যাংক লোন') || 
    q.includes('loan') || q.includes('financing') || q.includes('कर्ज') || 
    q.includes('लोन') || q.includes('ऋण')
  ) {
    return {
      reply: isEn
        ? `🏦 **CFO Advice on Loans & Financing:**\nBefore taking a bank loan, check your trapped capital. You have **${formatBDT(context.totalCustomerReceivable, 'en')}** stuck in dues and **${formatBDT(context.totalStockInvestment, 'en')}** in stock. Collecting dues 10 days faster is like getting an interest-free loan! If you still need a loan, ensure your net margin is at least 5% higher than the loan interest rate.`
        : isHi
        ? `🏦 **लोन और फाइनेंसिंग पर CFO की सलाह:**\nबैंक से लोन लेने से पहले अपनी फँसी हुई पूँजी देखें। आपके **${formatBDT(context.totalCustomerReceivable, 'hi')}** उधारी में और **${formatBDT(context.totalStockInvestment, 'hi')}** स्टॉक में फँसे हैं। अगर आप उधारी जल्दी वसूल लें, तो यह बिना ब्याज के लोन जैसा होगा! अगर फिर भी लोन लेना हो, तो सुनिश्चित करें कि आपका नेट मार्जिन लोन के ब्याज से कम से कम 5% अधिक हो।`
        : `🏦 **লোন ও অর্থায়নের ব্যাপারে সিএফও পরামর্শ:**\nব্যাংক লোন নেওয়ার আগে আপনার আটকে থাকা মূলধন খেয়াল করুন। কাস্টমারদের কাছে আপনার **${formatBDT(context.totalCustomerReceivable, 'bn')}** বাকি এবং দোকানে **${formatBDT(context.totalStockInvestment, 'bn')}** স্টক আটকে আছে। বাকি দ্রুত আদায় করতে পারলে বিনা সুদেই অনেক ক্যাশ পেয়ে যাবেন! তবুও যদি লোন নিতে হয়, নিশ্চিত করুন যেন আপনার নিট মার্জিন লোনের সুদের হারের চেয়ে অন্তত ৫% বেশি হয়।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 19. INTENT: Competitor / Market Analysis
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('প্রতিযোগী') || q.includes('কম্পিটিশন') || q.includes('বাজার') || 
    q.includes('মার্কেট') || q.includes('competitor') || q.includes('market') || 
    q.includes('बाज़ार') || q.includes('प्रतिस्पर्धा') || q.includes('competition')
  ) {
    return {
      reply: isEn
        ? `🎯 **Competitive Positioning Strategy:**\nInstead of entering a price war with competitors, focus on **value and velocity**. Offer unique bundles, better customer service, and faster-moving SKUs. Remember: a 2% price cut requires a 15-20% increase in sales volume just to keep the same profit!`
        : isHi
        ? `🎯 **मार्केट प्रतिस्पर्धा की रणनीति:**\nप्रतिस्पर्धियों के साथ 'प्राइस वॉर' (कीमत कम करने की होड़) में पड़ने के बजाय, **गुणवत्ता और सर्विस** पर ध्यान दें। याद रखें: कीमत केवल 2% कम करने पर, उतना ही मुनाफा बनाए रखने के लिए आपको 15-20% अधिक माल बेचना पड़ेगा!`
        : `🎯 **বাজার ও প্রতিযোগিতা মোকাবিলার কৌশল:**\nপ্রতিযোগীদের সাথে দাম কমানোর পাল্লায় না গিয়ে **গুণগত মান ও সার্ভিসের** দিকে মনোযোগ দিন। বান্ডিল অফার ও কাস্টমার সম্পর্ক দিয়ে ব্যবসা ধরে রাখুন। মনে রাখবেন: দাম মাত্র ২% কমালে একই পরিমাণ মুনাফা ধরে রাখতে আপনাকে ১৫-২০% বেশি পণ্য বিক্রি করতে হবে!`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 20. INTENT: Employee / Staff
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('কর্মচারী') || q.includes('কর্মী') || q.includes('স্টাফ') || 
    q.includes('বেতন') || q.includes('staff') || q.includes('employee') || 
    q.includes('salary') || q.includes('कर्मचारी') || q.includes('वेतन')
  ) {
    return {
      reply: isEn
        ? `👥 **Staff & Salary Optimization:**\nStaff salaries currently fall under your OpEx which is ${formatBDT(context.opex, 'en')} monthly. To maximize productivity, consider setting a modest base salary combined with performance/sales commissions to incentivize growth.`
        : isHi
        ? `👥 **कर्मचारी और वेतन रणनीति:**\nकर्मचारियों का वेतन आपके कुल OpEx (${formatBDT(context.opex, 'hi')}/महीना) का हिस्सा है। बेहतर परिणाम के लिए, एक फिक्स बेसिक सैलरी के साथ-साथ बिक्री के आधार पर कमीशन (Commission) तय करें, जिससे उन्हें ज़्यादा काम करने की प्रेरणा मिलेगी।`
        : `👥 **কর্মচারী ও বেতন ব্যবস্থাপনা কৌশল:**\nকর্মীদের বেতন আপনার মোট পরিচালন ব্যয়ের (${formatBDT(context.opex, 'bn')}/মাস) একটি বড় অংশ। সবচেয়ে ভালো ফলাফল পেতে, কর্মীদের নির্দিষ্ট বেতনের পাশাপাশি বিক্রির ওপর ইনসেনটিভ বা কমিশন নির্ধারণ করতে পারেন। এতে তারা বেশি বিক্রি করতে উৎসাহিত হবে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 21. INTENT: Weekly Summary
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('সাপ্তাহিক') || q.includes('weekly') || q.includes('हफ्ते') || q.includes('সপ্তাহের হিসাব')) {
    return {
      reply: isEn ? `📈 **Weekly Financial Snapshot:**\nYour current net profit margin is ${context.netMarginPct}%. To optimize your weekly cash flow, aim to collect at least 20% of your ${formatBDT(context.totalCustomerReceivable, 'en')} receivables before the weekend.` : isHi ? `📈 **साप्ताहिक वित्तीय सारांश:**\nआपका वर्तमान शुद्ध लाभ मार्जिन ${context.netMarginPct}% है। अपने साप्ताहिक कैश फ्लो को बेहतर बनाने के लिए, सप्ताहांत से पहले अपने ${formatBDT(context.totalCustomerReceivable, 'hi')} के बकाये का कम से कम 20% वसूलने का लक्ष्य रखें।` : `📈 **সাপ্তাহিক আর্থিক সারাংশ:**\nআপনার বর্তমান নিট মুনাফা মার্জিন ${context.netMarginPct}%। আপনার সাপ্তাহিক ক্যাশ ফ্লো ভালো রাখতে, ছুটির দিনের আগে আপনার ${formatBDT(context.totalCustomerReceivable, 'bn')} বকেয়ার অন্তত ২০% আদায় করার লক্ষ্য নির্ধারণ করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 22. INTENT: Monthly Summary
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('মাসিক') || q.includes('monthly') || q.includes('महीने') || q.includes('মাসের হিসাব')) {
    return {
      reply: isEn ? `📊 **Monthly Financial Overview:**\nYour monthly breakeven is ${formatBDT(context.breakevenMonthlySales, 'en')}. With daily OpEx at ${formatBDT(context.dailyOpEx, 'en')}, maintaining a disciplined focus on high-velocity items will ensure you easily surpass this breakeven threshold early in the month.` : isHi ? `📊 **मासिक वित्तीय अवलोकन:**\nआपका मासिक ब्रेक-ईवन ${formatBDT(context.breakevenMonthlySales, 'hi')} है। ${formatBDT(context.dailyOpEx, 'hi')} के दैनिक खर्च के साथ, तेजी से बिकने वाले उत्पादों पर ध्यान केंद्रित करने से आप महीने की शुरुआत में ही इस ब्रेक-ईवन को पार कर लेंगे।` : `📊 **মাসিক আর্থিক ওভারভিউ:**\nআপনার মাসিক ব্রেক-ইভেন বিক্রি হলো ${formatBDT(context.breakevenMonthlySales, 'bn')}। দৈনিক পরিচালন ব্যয় ${formatBDT(context.dailyOpEx, 'bn')} থাকায়, দ্রুত বিক্রি হয় এমন পণ্যের ওপর ফোকাস করলে আপনি মাসের শুরুতেই এই ব্রেক-ইভেন টপকে যেতে পারবেন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 23. INTENT: Yearly Goals
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('বাৎসরিক') || q.includes('yearly') || q.includes('annual') || q.includes('साल') || q.includes('বছরের টার্গেট')) {
    return {
      reply: isEn ? `🎯 **Annual Strategic Goals:**\nTo scale sustainably over the year, target a 10% reduction in your DSO (currently ${context.dso} days) and reinvest the freed capital (${formatBDT(context.totalCustomerReceivable * 0.1, 'en')}) into inventory with a DSI lower than your current ${context.dsi} days.` : isHi ? `🎯 **वार्षिक रणनीतिक लक्ष्य:**\nइस साल टिकाऊ विकास के लिए, अपने DSO (वर्तमान में ${context.dso} दिन) में 10% कमी का लक्ष्य रखें और मुक्त हुई पूंजी (${formatBDT(context.totalCustomerReceivable * 0.1, 'hi')}) को उन उत्पादों में निवेश करें जिनका DSI आपके वर्तमान ${context.dsi} दिनों से कम हो।` : `🎯 **বার্ষিক কৌশলগত লক্ষ্য:**\nবছরজুড়ে টেকসই প্রবৃদ্ধির জন্য, আপনার ডিএসও (বর্তমানে ${context.dso} দিন) ১০% কমানোর লক্ষ্য নিন এবং মুক্ত মূলধন (${formatBDT(context.totalCustomerReceivable * 0.1, 'bn')}) এমন পণ্যে বিনিয়োগ করুন যার ডিএসআই আপনার বর্তমান ${context.dsi} দিনের চেয়ে কম।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 24. INTENT: Revenue/Sales Trend
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ট্রেন্ড') || q.includes('trend') || q.includes('रुझान') || q.includes('বিক্রির ধারা')) {
    return {
      reply: isEn ? `📉 **Revenue Trend Analysis:**\nYour gross margin stands at ${context.grossMarginPct}%. Analyze the 30-day movement (currently projected at ${formatBDT(context.projected30DayMovement, 'en')}) to identify seasonal peaks. Stock up on high-margin items before demand spikes.` : isHi ? `📉 **बिक्री रुझान विश्लेषण:**\nआपका सकल मार्जिन ${context.grossMarginPct}% है। मौसमी उछाल को पहचानने के लिए 30-दिन के मूवमेंट (वर्तमान में ${formatBDT(context.projected30DayMovement, 'hi')} अनुमानित) का विश्लेषण करें। मांग बढ़ने से पहले हाई-मार्जिन उत्पादों का स्टॉक कर लें।` : `📉 **বিক্রির ধারা বিশ্লেষণ:**\nআপনার গ্রস মার্জিন বর্তমানে ${context.grossMarginPct}%। সিজনাল পিক শনাক্ত করতে ৩০-দিনের গতিবিধি (বর্তমানে ${formatBDT(context.projected30DayMovement, 'bn')} প্রজেক্টেড) বিশ্লেষণ করুন। চাহিদা বাড়ার আগেই বেশি মার্জিনের পণ্য স্টক করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 25. INTENT: Best Selling Product
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('সেরা পণ্য') || q.includes('best seller') || q.includes('सबसे ज्यादा बिकने') || q.includes('জনপ্রিয় পণ্য')) {
    return {
      reply: isEn ? `🏆 **Best Seller Strategy:**\nApply the Pareto 80/20 rule. Allocate your ${formatBDT(context.totalLiquidCash, 'en')} liquid cash heavily into your top 20% fastest-moving SKUs. These items drive your ${context.grossMarginPct}% gross margin. Liquidate slow-movers immediately.` : isHi ? `🏆 **बेस्ट सेलर रणनीति:**\nपैरेटो 80/20 नियम लागू करें। अपनी ${formatBDT(context.totalLiquidCash, 'hi')} नकद पूंजी का बड़ा हिस्सा टॉप 20% सबसे तेज़ बिकने वाले उत्पादों में लगाएँ। यही उत्पाद आपका ${context.grossMarginPct}% ग्रॉस मार्जिन बनाते हैं। धीमे बिकने वाले माल को तुरंत निकालें।` : `🏆 **সেরা পণ্য কৌশল:**\nপ্যারেটো ৮০/২০ নীতি প্রয়োগ করুন। আপনার ${formatBDT(context.totalLiquidCash, 'bn')} তরল ক্যাশের বড় অংশ সেরা ২০% দ্রুত বিক্রি হওয়া পণ্যে বিনিয়োগ করুন। এই পণ্যগুলোই আপনার ${context.grossMarginPct}% গ্রস মার্জিন নিয়ে আসে। ধীর গতির পণ্য দ্রুত ক্লিয়ার করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 26. INTENT: Customer Analysis
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('কাস্টমার বিশ্লেষণ') || q.includes('customer analysis') || q.includes('ग्राहक विश्लेषण')) {
    return {
      reply: isEn ? `👥 **Customer Cohort Analysis:**\nYour debtor concentration risk is ${context.debtorConcentrationRisk}%. Relying heavily on a few top debtors for your ${formatBDT(context.totalCustomerReceivable, 'en')} receivables is risky. Diversify your customer base and strictly enforce credit limits.` : isHi ? `👥 **ग्राहक विश्लेषण:**\nआपका डेटर कंसंट्रेशन रिस्क ${context.debtorConcentrationRisk}% है। आपके ${formatBDT(context.totalCustomerReceivable, 'hi')} के बकाये के लिए कुछ ही ग्राहकों पर निर्भर रहना जोखिम भरा है। नए ग्राहक बनाएँ और उधारी सीमा सख्ती से लागू करें।` : `👥 **কাস্টমার বিশ্লেষণ:**\nআপনার ডেটর কনসেন্ট্রেশন রিস্ক হলো ${context.debtorConcentrationRisk}%। আপনার ${formatBDT(context.totalCustomerReceivable, 'bn')} বকেয়ার জন্য অল্প কয়েকজন কাস্টমারের ওপর নির্ভরশীল হওয়া ঝুঁকিপূর্ণ। কাস্টমার সংখ্যা বাড়ান এবং ক্রেডিট লিমিট কঠোরভাবে প্রয়োগ করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 27. INTENT: Supplier Management
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('সরবরাহকারী') || q.includes('supplier') || q.includes('सप्लायर') || q.includes('মহাজন')) {
    return {
      reply: isEn ? `🤝 **Supplier Payable Optimization:**\nYou currently owe ${formatBDT(context.totalSupplierPayable, 'en')} with a DPO of ${context.dpo} days. Negotiate longer payment terms with suppliers without losing cash discounts. This effectively provides you with free financing to fund your inventory (${formatBDT(context.totalStockInvestment, 'en')}).` : isHi ? `🤝 **सप्लायर प्रबंधन:**\nवर्तमान में आपको सप्लायर को ${formatBDT(context.totalSupplierPayable, 'hi')} देने हैं और आपका DPO ${context.dpo} दिन है। कैश डिस्काउंट खोए बिना सप्लायर से भुगतान का अधिक समय मांगें। यह आपको अपने स्टॉक (${formatBDT(context.totalStockInvestment, 'hi')}) के लिए मुफ्त फाइनेंसिंग देता है।` : `🤝 **সরবরাহকারী ব্যবস্থাপনা:**\nবর্তমানে আপনার মহাজনের পাওনা ${formatBDT(context.totalSupplierPayable, 'bn')} এবং আপনার ডিপিও ${context.dpo} দিন। ক্যাশ ডিসকাউন্ট না হারিয়ে মহাজনের কাছে পেমেন্টের সময় বাড়ানোর আলোচনা করুন। এটি আপনার স্টক (${formatBDT(context.totalStockInvestment, 'bn')}) কেনার জন্য বিনা সুদের অর্থায়নের কাজ করবে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 28. INTENT: Savings Advice
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('সঞ্চয়') || q.includes('saving') || q.includes('बचत') || q.includes('জমানো')) {
    return {
      reply: isEn ? `💰 **Corporate Savings Strategy:**\nYour current cash runway is ${context.cashRunwayDays} days. Aim to keep at least 3-6 months of your daily OpEx (${formatBDT(context.dailyOpEx, 'en')}/day) safely parked as an emergency reserve before drawing dividends.` : isHi ? `💰 **बचत रणनीति:**\nआपका वर्तमान कैश रनवे ${context.cashRunwayDays} दिन है। लाभ निकालने से पहले, अपने दैनिक खर्च (${formatBDT(context.dailyOpEx, 'hi')}/दिन) का कम से कम 3-6 महीने का हिस्सा आपातकालीन रिजर्व के रूप में सुरक्षित रखने का लक्ष्य रखें।` : `💰 **সঞ্চয় কৌশল:**\nআপনার বর্তমান ক্যাশ রানওয়ে ${context.cashRunwayDays} দিন। ব্যক্তিগত ব্যবহারের জন্য লাভ তোলার আগে আপনার দৈনিক খরচের (${formatBDT(context.dailyOpEx, 'bn')}/দিন) অন্তত ৩-৬ মাসের সমপরিমাণ অর্থ ইমারজেন্সি রিজার্ভ হিসেবে জমানোর লক্ষ্য রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 29. INTENT: Investment Advice
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('বিনিয়োগ') || q.includes('invest') || q.includes('निवेश') || q.includes('পুঁজি খাটানো')) {
    return {
      reply: isEn ? `📈 **Capital Reinvestment Strategy:**\nWith a net margin of ${context.netMarginPct}%, the best ROI is reinvesting your ${formatBDT(context.totalLiquidCash, 'en')} cash back into your own business. Focus on high-turnover inventory or customer acquisition marketing.` : isHi ? `📈 **निवेश रणनीति:**\n${context.netMarginPct}% के शुद्ध मार्जिन के साथ, अपनी ${formatBDT(context.totalLiquidCash, 'hi')} नकद पूंजी को वापस अपने बिज़नेस में लगाना सबसे अच्छा निवेश है। तेज़ी से बिकने वाले स्टॉक या मार्केटिंग पर ध्यान दें।` : `📈 **বিনিয়োগ কৌশল:**\nআপনার নিট মার্জিন ${context.netMarginPct}% হওয়ায়, আপনার ${formatBDT(context.totalLiquidCash, 'bn')} ক্যাশ নিজের ব্যবসাতেই পুনরায় খাটানো সবচেয়ে ভালো বিনিয়োগ। দ্রুত বিক্রি হয় এমন স্টক বা মার্কেটিংয়ে ফোকাস করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 30. INTENT: Emergency Fund
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('জরুরি তহবিল') || q.includes('emergency fund') || q.includes('आपातकालीन फंड')) {
    return {
      reply: isEn ? `🛡️ **Liquidity Buffer (Emergency Fund):**\nYou currently have ${formatBDT(context.totalLiquidCash, 'en')} in liquid assets, providing a ${context.cashRunwayDays}-day runway. CFO best practices dictate maintaining 90 days of runway to absorb macroeconomic shocks.` : isHi ? `🛡️ **आपातकालीन फंड:**\nवर्तमान में आपके पास ${formatBDT(context.totalLiquidCash, 'hi')} नकद है, जो ${context.cashRunwayDays} दिनों का रनवे देता है। CFO की सलाह है कि आर्थिक झटकों से बचने के लिए हमेशा 90 दिनों का रनवे बनाए रखें।` : `🛡️ **জরুরি তহবিল:**\nবর্তমানে আপনার কাছে ${formatBDT(context.totalLiquidCash, 'bn')} নগদ আছে, যা দিয়ে ${context.cashRunwayDays} দিন চলা সম্ভব। সিএফও নিয়ম অনুযায়ী, যেকোনো অর্থনৈতিক ধাক্কা সামলাতে অন্তত ৯০ দিনের রানওয়ে বা জরুরি তহবিল রাখা উচিত।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 31. INTENT: Business Plan
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ব্যবসায়িক পরিকল্পনা') || q.includes('business plan') || q.includes('बिज़नेस प्लान')) {
    return {
      reply: isEn ? `📝 **Strategic Business Plan Execution:**\nYour health score is ${context.scorecardScore}/100. To reach 90+, implement a 3-step plan: 1. Reduce CCC (currently ${context.cashConversionCycle} days). 2. Increase Gross Margin from ${context.grossMarginPct}% to target via a 2% price hike. 3. Cap Dues at ${formatBDT(context.totalCustomerReceivable * 0.8, 'en')}.` : isHi ? `📝 **रणनीतिक बिज़नेस प्लान:**\nआपका हेल्थ स्कोर ${context.scorecardScore}/100 है। इसे 90+ तक ले जाने के लिए 3-स्टेप प्लान अपनाएं: 1. CCC (${context.cashConversionCycle} दिन) कम करें। 2. कीमतों में 2% की वृद्धि करके ग्रॉस मार्जिन (${context.grossMarginPct}%) बढ़ाएं। 3. उधारी को ${formatBDT(context.totalCustomerReceivable * 0.8, 'hi')} तक सीमित करें।` : `📝 **কৌশলগত ব্যবসায়িক পরিকল্পনা:**\nআপনার হেলথ স্কোর ${context.scorecardScore}/১০০। এটি ৯০+ এ নিতে ৩-ধাপের প্ল্যান করুন: ১. সিসিসি (${context.cashConversionCycle} দিন) কমান। ২. দাম ২% বাড়িয়ে গ্রস মার্জিন (${context.grossMarginPct}%) বৃদ্ধি করুন। ৩. বাকি ${formatBDT(context.totalCustomerReceivable * 0.8, 'bn')} এর মধ্যে সীমাবদ্ধ রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 32. INTENT: SWOT Analysis
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('সোয়াট') || q.includes('swot') || q.includes('strengths') || q.includes('weakness') || q.includes('সুযোগ') || q.includes('হুমকি')) {
    return {
      reply: isEn ? `🔍 **Quantitative SWOT Analysis:**\n**Strength:** Liquid cash of ${formatBDT(context.totalLiquidCash, 'en')}.\n**Weakness:** Trapped capital in receivables (${formatBDT(context.totalCustomerReceivable, 'en')}).\n**Opportunity:** Optimizing inventory turnover (DSI ${context.dsi} days).\n**Threat:** High cash burn rate of ${formatBDT(context.dailyOpEx, 'en')}/day if sales drop.` : isHi ? `🔍 **SWOT विश्लेषण:**\n**ताकत:** ${formatBDT(context.totalLiquidCash, 'hi')} की नकद पूंजी।\n**कमजोरी:** उधारी में फंसी पूंजी (${formatBDT(context.totalCustomerReceivable, 'hi')})।\n**अवसर:** इन्वेंटरी टर्नओवर (DSI ${context.dsi} दिन) बेहतर करना।\n**खतरा:** बिक्री कम होने पर ${formatBDT(context.dailyOpEx, 'hi')}/दिन का उच्च खर्च।` : `🔍 **সোয়াট (SWOT) বিশ্লেষণ:**\n**শক্তি:** ${formatBDT(context.totalLiquidCash, 'bn')} এর নগদ তারল্য।\n**দুর্বলতা:** বকেয়ায় আটকে থাকা মূলধন (${formatBDT(context.totalCustomerReceivable, 'bn')})।\n**সুযোগ:** ইনভেন্টরি টার্নওভার (ডিএসআই ${context.dsi} দিন) অপ্টিমাইজ করা।\n**হুমকি:** বিক্রি কমলে ${formatBDT(context.dailyOpEx, 'bn')}/দিন খরচের চাপ।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 33. INTENT: Daily Target
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('দৈনিক টার্গেট') || q.includes('daily target') || q.includes('रोज़ का टार्गेट')) {
    return {
      reply: isEn ? `🎯 **Daily Revenue Target:**\nYour absolute minimum daily breakeven is ${formatBDT(context.breakevenDailySales, 'en')}. To achieve a ${context.netMarginPct}% net profit margin growth, set your aggressive daily sales target at ${formatBDT(context.breakevenDailySales * 1.3, 'en')}.` : isHi ? `🎯 **दैनिक बिक्री लक्ष्य:**\nआपका न्यूनतम दैनिक ब्रेक-ईवन ${formatBDT(context.breakevenDailySales, 'hi')} है। ${context.netMarginPct}% शुद्ध लाभ मार्जिन वृद्धि प्राप्त करने के लिए, अपना आक्रामक दैनिक बिक्री लक्ष्य ${formatBDT(context.breakevenDailySales * 1.3, 'hi')} निर्धारित करें।` : `🎯 **দৈনিক বিক্রির টার্গেট:**\nআপনার ন্যূনতম দৈনিক ব্রেক-ইভেন হলো ${formatBDT(context.breakevenDailySales, 'bn')}। ${context.netMarginPct}% নিট মুনাফা মার্জিন বৃদ্ধির জন্য আপনার দৈনিক বিক্রির টার্গেট ${formatBDT(context.breakevenDailySales * 1.3, 'bn')} নির্ধারণ করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 34. INTENT: Monthly Target
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('মাসিক টার্গেট') || q.includes('monthly target') || q.includes('महीने का टार्गेट')) {
    return {
      reply: isEn ? `🎯 **Monthly Sales Quota:**\nYour monthly breakeven is ${formatBDT(context.breakevenMonthlySales, 'en')}. Push your sales team to hit ${formatBDT(context.breakevenMonthlySales * 1.25, 'en')} this month. This 25% buffer guarantees healthy free cash flow generation.` : isHi ? `🎯 **मासिक बिक्री लक्ष्य:**\nआपका मासिक ब्रेक-ईवन ${formatBDT(context.breakevenMonthlySales, 'hi')} है। अपनी टीम को इस महीने ${formatBDT(context.breakevenMonthlySales * 1.25, 'hi')} का लक्ष्य दें। यह 25% अतिरिक्त कुशन मजबूत कैश फ्लो की गारंटी देता है।` : `🎯 **মাসিক বিক্রির টার্গেট:**\nআপনার মাসিক ব্রেক-ইভেন ${formatBDT(context.breakevenMonthlySales, 'bn')}। এই মাসে আপনার সেলস টিমকে ${formatBDT(context.breakevenMonthlySales * 1.25, 'bn')} এর টার্গেট দিন। এই ২৫% অতিরিক্ত বাফার স্বাস্থ্যকর ক্যাশ ফ্লো নিশ্চিত করবে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 35. INTENT: Seasonal Business
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('মৌসুমী') || q.includes('seasonal') || q.includes('मौसमी') || q.includes('সিজনাল')) {
    return {
      reply: isEn ? `🌦️ **Seasonal Working Capital Management:**\nBefore peak seasons, strategically build up inventory. Use your ${formatBDT(context.totalLiquidCash, 'en')} cash buffer rather than high-interest loans. During off-seasons, slash your OpEx (${formatBDT(context.dailyOpEx, 'en')}/day) to extend runway.` : isHi ? `🌦️ **मौसमी बिज़नेस रणनीति:**\nसीजन से पहले, इन्वेंटरी बढ़ाएं। उच्च ब्याज वाले लोन के बजाय अपने ${formatBDT(context.totalLiquidCash, 'hi')} नकद बफर का उपयोग करें। ऑफ-सीजन के दौरान, अपने खर्चों (${formatBDT(context.dailyOpEx, 'hi')}/दिन) को कम करके रनवे बढ़ाएं।` : `🌦️ **সিজনাল ব্যবসা ব্যবস্থাপনা:**\nপিক সিজনের আগেই ইনভেন্টরি বাড়ান। চড়া সুদের লোনের বদলে আপনার ${formatBDT(context.totalLiquidCash, 'bn')} ক্যাশ বাফার ব্যবহার করুন। অফ-সিজনে আপনার পরিচালন ব্যয় (${formatBDT(context.dailyOpEx, 'bn')}/দিন) কমিয়ে রানওয়ে দীর্ঘ করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 36. INTENT: Festival Planning
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ঈদ') || q.includes('পূজা') || q.includes('festival') || q.includes('त्योहार') || q.includes('উৎসব')) {
    return {
      reply: isEn ? `🎉 **Festival Liquidity & Stock Plan:**\nFestivals require heavy working capital. Begin liquidating dead stock 45 days prior to unlock trapped cash. Aim to turn your ${formatBDT(context.totalStockInvestment, 'en')} inventory 3x faster during the festival month.` : isHi ? `🎉 **त्योहारों की रणनीति:**\nत्योहारों में अधिक वर्किंग कैपिटल की आवश्यकता होती है। फंसा हुआ कैश निकालने के लिए 45 दिन पहले ही पुराना स्टॉक बेचना शुरू करें। त्योहारी महीने में अपनी ${formatBDT(context.totalStockInvestment, 'hi')} इन्वेंटरी को 3 गुना तेजी से बेचने का लक्ष्य रखें।` : `🎉 **উৎসবকালীন স্টক ও লিকুইডিটি প্ল্যান:**\nউৎসবের সময় প্রচুর চলতি মূলধন লাগে। ক্যাশ বের করতে ৪৫ দিন আগে থেকেই অবিক্রিত স্টক ক্লিয়ার করা শুরু করুন। উৎসবের মাসে আপনার ${formatBDT(context.totalStockInvestment, 'bn')} ইনভেন্টরি ৩ গুণ দ্রুত বিক্রির লক্ষ্য রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 37. INTENT: Risk Assessment
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ঝুঁকি মূল্যায়ন') || q.includes('risk assessment') || q.includes('जोखिम मूल्यांकन')) {
    return {
      reply: isEn ? `⚠️ **Financial Risk Matrix:**\nYour current ratio is ${context.currentRatio} and quick ratio is ${context.quickRatio}. The main systemic risk is your ${context.dso} day DSO causing a cash crunch. Enforce rigorous credit checks to mitigate bad debt exposure.` : isHi ? `⚠️ **वित्तीय जोखिम मैट्रिक्स:**\nआपका करंट रेशियो ${context.currentRatio} और क्विक रेशियो ${context.quickRatio} है। मुख्य जोखिम आपके ${context.dso} दिनों का DSO है जो नकदी संकट पैदा कर सकता है। बैड डेट को कम करने के लिए सख्त क्रेडिट जांच लागू करें।` : `⚠️ **আর্থিক ঝুঁকি মূল্যায়ন:**\nআপনার কারেন্ট রেশিও ${context.currentRatio} এবং কুইক রেশিও ${context.quickRatio}। প্রধান ঝুঁকি হলো আপনার ${context.dso} দিনের ডিএসও, যা ক্যাশ সংকট তৈরি করতে পারে। ব্যাড ডেট কমাতে কঠোর ক্রেডিট যাচাই করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 38. INTENT: Debt Strategy
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ঋণ কৌশল') || q.includes('debt strategy') || q.includes('कर्ज रणनीति')) {
    return {
      reply: isEn ? `📉 **De-leveraging Protocol:**\nYour trapped capital is ${formatBDT(context.workingCapital, 'en')}. Instead of taking external debt, organically finance operations by reducing your Cash Conversion Cycle (${context.cashConversionCycle} days). Collect faster, pay suppliers optimally.` : isHi ? `📉 **कर्ज कम करने की रणनीति:**\nआपकी फंसी हुई पूंजी ${formatBDT(context.workingCapital, 'hi')} है। बाहरी कर्ज लेने के बजाय, अपने कैश कन्वर्जन साइकिल (${context.cashConversionCycle} दिन) को कम करके बिज़नेस को फाइनेंस करें। जल्दी वसूलें, सप्लायर को इष्टतम समय पर भुगतान करें।` : `📉 **ঋণ কৌশল ও ডি-লেভারেজিং:**\nআপনার আটকে থাকা মূলধন ${formatBDT(context.workingCapital, 'bn')}। বাইরের লোন নেওয়ার বদলে ক্যাশ কনভার্শন সাইকেল (${context.cashConversionCycle} দিন) কমিয়ে নিজস্ব অর্থায়নে ব্যবসা চালান। দ্রুত আদায় করুন এবং মহাজনদের পেমেন্ট অপ্টিমাইজ করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 39. INTENT: Collection Tips
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('আদায়ের কৌশল') || q.includes('collection tips') || q.includes('वसूली टिप्स') || q.includes('তাগাদা কৌশল')) {
    return {
      reply: isEn ? `☎️ **Receivable Collection Playbook:**\nOffer a 2% early settlement discount to debtors holding your ${formatBDT(context.totalCustomerReceivable, 'en')}. The slight margin hit is mathematically superior to suffering a cash out-of-stock crisis.` : isHi ? `☎️ **वसूली के टिप्स:**\nजिन ग्राहकों पर आपका ${formatBDT(context.totalCustomerReceivable, 'hi')} बकाया है, उन्हें जल्दी भुगतान पर 2% की छूट दें। थोड़ा मार्जिन छोड़ना कैश संकट का सामना करने से गणितीय रूप से बेहतर है।` : `☎️ **বকেয়া আদায়ের কৌশল:**\nযাদের কাছে আপনার ${formatBDT(context.totalCustomerReceivable, 'bn')} আটকে আছে, তাদের দ্রুত পেমেন্টে ২% ডিসকাউন্ট অফার করুন। সামান্য মার্জিন কমানো ক্যাশ সংকটে ভোগার চেয়ে গাণিতিকভাবে অনেক বেশি লাভজনক।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 40. INTENT: Average Transaction
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('গড় লেনদেন') || q.includes('average transaction') || q.includes('औसत लेनदेन')) {
    return {
      reply: isEn ? `🛒 **Average Ticket Size (AOV) Boost:**\nYour AOV is ${formatBDT(context.avgTicketSize, 'en')}. Implement cross-selling and bundling strategies at checkout to push this up by 15%. This directly expands your gross profit with zero extra acquisition cost.` : isHi ? `🛒 **औसत लेनदेन वृद्धि:**\nआपका AOV ${formatBDT(context.avgTicketSize, 'hi')} है। चेकआउट पर क्रॉस-सेलिंग और बंडलिंग रणनीतियाँ लागू करके इसे 15% तक बढ़ाएं। यह बिना किसी अतिरिक्त लागत के सीधे आपके ग्रॉस प्रॉफिट को बढ़ाता है।` : `🛒 **গড় লেনদেন (AOV) বৃদ্ধি:**\nআপনার গড় লেনদেন ${formatBDT(context.avgTicketSize, 'bn')}। চেকআউটের সময় ক্রস-সেলিং ও বান্ডিলিং কৌশল প্রয়োগ করে এটি ১৫% বাড়ানোর চেষ্টা করুন। এতে কোনো অতিরিক্ত খরচ ছাড়াই আপনার গ্রস প্রফিট সরাসরি বেড়ে যাবে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 41. INTENT: Digital Payment
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('বিকাশ') || q.includes('নগদ') || q.includes('digital payment') || q.includes('डिजिटल भुगतान') || q.includes('মোবাইল ব্যাংকিং')) {
    return {
      reply: isEn ? `📱 **Digital Treasury Routing:**\nYou hold ${formatBDT(context.digitalBalances, 'en')} in mobile wallets. Routinely sweep excess digital funds into high-yield bank accounts to earn interest, keeping only 3 days of operational liquidity in MFS.` : isHi ? `📱 **डिजिटल भुगतान प्रबंधन:**\nआपके मोबाइल वॉलेट में ${formatBDT(context.digitalBalances, 'hi')} हैं। ब्याज कमाने के लिए अतिरिक्त डिजिटल फंड को हाई-यील्ड बैंक खातों में ट्रांसफर करते रहें, MFS में केवल 3 दिनों की तरलता रखें।` : `📱 **ডিজিটাল পেমেন্ট ব্যবস্থাপনা:**\nআপনার মোবাইল ওয়ালেটে ${formatBDT(context.digitalBalances, 'bn')} জমা আছে। সুদ বা মুনাফা পেতে অতিরিক্ত ফান্ড নিয়মিত ব্যাংক অ্যাকাউন্টে ট্রান্সফার করুন এবং এমএফএস-এ শুধুমাত্র ৩ দিনের খরচ চালানোর মতো তারল্য রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 42. INTENT: Marketing Tips
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('মার্কেটিং') || q.includes('marketing') || q.includes('विपणन') || q.includes('বিজ্ঞাপন') || q.includes('প্রচার')) {
    return {
      reply: isEn ? `📢 **ROI-Driven Marketing:**\nYour net margin is ${context.netMarginPct}%. Ensure your Customer Acquisition Cost (CAC) is less than 33% of their Lifetime Value (LTV). Focus marketing spend on your highest-margin product lines to maximize return.` : isHi ? `📢 **मार्केटिंग रणनीति:**\nआपका शुद्ध मार्जिन ${context.netMarginPct}% है। सुनिश्चित करें कि आपका कस्टमर एक्विजिशन कॉस्ट (CAC) उनके लाइफटाइम वैल्यू (LTV) के 33% से कम हो। रिटर्न को अधिकतम करने के लिए हाई-मार्जिन उत्पादों पर मार्केटिंग खर्च केंद्रित करें।` : `📢 **বিজ্ঞাপন ও মার্কেটিং কৌশল:**\nআপনার নিট মার্জিন ${context.netMarginPct}%। নিশ্চিত করুন যেন কাস্টমার অ্যাকুইজিশন কস্ট (CAC) তাদের লাইফটাইম ভ্যালুর (LTV) ৩৩% এর কম হয়। সর্বোচ্চ রিটার্ন পেতে আপনার সর্বোচ্চ মার্জিনের পণ্যের ওপর মার্কেটিং খরচ ফোকাস করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 43. INTENT: Customer Retention
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('কাস্টমার ধরে রাখা') || q.includes('retention') || q.includes('ग्राहक बनाए रखना')) {
    return {
      reply: isEn ? `🔗 **Client Retention Economics:**\nIncreasing customer retention by 5% can increase profits by 25-95%. Implement a loyalty program for customers who regularly pay on time, reducing your DSO from ${context.dso} days.` : isHi ? `🔗 **ग्राहक प्रतिधारण (Retention):**\nकस्टमर रिटेंशन 5% बढ़ाने से मुनाफा 25-95% तक बढ़ सकता है। जो ग्राहक समय पर भुगतान करते हैं, उनके लिए लॉयल्टी प्रोग्राम लागू करें, जिससे आपका DSO (${context.dso} दिन) कम हो सके।` : `🔗 **কাস্টমার ধরে রাখার কৌশল:**\nকাস্টমার রিটেনশন ৫% বাড়ালে মুনাফা ২৫-৯৫% পর্যন্ত বাড়তে পারে। যেসব কাস্টমার নিয়মিত সময়মতো পেমেন্ট করে তাদের জন্য লয়্যালটি প্রোগ্রাম চালু করুন, এতে আপনার ডিএসও (${context.dso} দিন) কমে আসবে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 44. INTENT: Discount Strategy
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ছাড়') || q.includes('ডিসকাউন্ট') || q.includes('discount') || q.includes('छूट')) {
    return {
      reply: isEn ? `✂️ **Margin-Protected Discounting:**\nWith a gross margin of ${context.grossMarginPct}%, a 10% discount requires you to sell vastly more volume just to break even. Use volume-based discounts (Buy 3, Get 1) instead of flat % cuts to protect your unit economics.` : isHi ? `✂️ **डिस्काउंट रणनीति:**\n${context.grossMarginPct}% के ग्रॉस मार्जिन के साथ, 10% की छूट देने पर आपको केवल ब्रेक-ईवन तक पहुंचने के लिए बहुत अधिक बेचना होगा। अपनी यूनिट इकोनॉमिक्स बचाने के लिए फ्लैट % कट के बजाय वॉल्यूम-आधारित छूट (Buy 3, Get 1) का उपयोग करें।` : `✂️ **মার্জিন-সুরক্ষিত ডিসকাউন্ট কৌশল:**\nআপনার গ্রস মার্জিন ${context.grossMarginPct}%, ফলে ১০% ছাড় দিলে একই মুনাফা পেতে আপনাকে প্রচুর বেশি বিক্রি করতে হবে। ফ্ল্যাট পার্সেন্টেজ না কমিয়ে ভলিউম-ভিত্তিক ডিসকাউন্ট (৩টি কিনলে ১টি ফ্রি) দিন, এতে আপনার ইউনিট ইকোনমিক্স সুরক্ষিত থাকবে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 45. INTENT: Bulk Order
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('পাইকারি') || q.includes('bulk') || q.includes('wholesale') || q.includes('थोक') || q.includes('হোলসেল')) {
    return {
      reply: isEn ? `📦 **Wholesale Volume Optimization:**\nFor bulk orders, mandate a 50% advance payment to shield your ${formatBDT(context.workingCapital, 'en')} working capital. Ensure the bulk discounted price never falls below your replacement cost plus fixed OpEx allocation.` : isHi ? `📦 **थोक ऑर्डर रणनीति:**\nथोक ऑर्डर के लिए, अपनी ${formatBDT(context.workingCapital, 'hi')} वर्किंग कैपिटल को सुरक्षित करने के लिए 50% एडवांस पेमेंट अनिवार्य करें। सुनिश्चित करें कि रियायती कीमत कभी भी आपकी खरीद लागत और फिक्स्ड खर्चे से कम न हो।` : `📦 **পাইকারি ও হোলসেল কৌশল:**\nপাইকারি অর্ডারের ক্ষেত্রে আপনার ${formatBDT(context.workingCapital, 'bn')} চলতি মূলধন সুরক্ষিত রাখতে ৫০% অগ্রিম পেমেন্ট বাধ্যতামূলক করুন। নিশ্চিত করুন যে পাইকারি ছাড় দেওয়া দাম কখনোই আপনার কেনা দাম এবং ফিক্সড খরচের নিচে নেমে না যায়।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 46. INTENT: Business License
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('লাইসেন্স') || q.includes('ট্রেড লাইসেন্স') || q.includes('license') || q.includes('लाइसेंस')) {
    return {
      reply: isEn ? `📜 **Regulatory Compliance Check:**\nEnsure your Trade License, VAT Registration (BIN), and TIN are up to date. Set aside ${formatBDT(2500, 'en')} from your ${formatBDT(context.totalLiquidCash, 'en')} liquid reserve annually for renewal fees to avoid operational disruption.` : isHi ? `📜 **लाइसेंस और अनुपालन:**\nसुनिश्चित करें कि आपका ट्रेड लाइसेंस, वैट और टिन अपडेटेड हैं। रुकावटों से बचने के लिए, नवीनीकरण शुल्क के लिए अपने ${formatBDT(context.totalLiquidCash, 'hi')} नकद रिज़र्व से सालाना ${formatBDT(2500, 'hi')} अलग रखें।` : `📜 **লাইসেন্স ও কমপ্লায়েন্স:**\nআপনার ট্রেড লাইসেন্স, ভ্যাট (BIN) এবং টিন (TIN) আপডেট রাখুন। আইনি ঝামেলা এড়াতে আপনার ${formatBDT(context.totalLiquidCash, 'bn')} ক্যাশ থেকে নবায়নের জন্য প্রতি বছর অন্তত ${formatBDT(2500, 'bn')} আলাদা করে রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 47. INTENT: Partnership
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('পার্টনারশিপ') || q.includes('partnership') || q.includes('साझेदारी') || q.includes('অংশীদার')) {
    return {
      reply: isEn ? `🤝 **Partnership & Equity Architecture:**\nBefore accepting a partner, formalize valuation based on your ${formatBDT(context.netProfit * 12, 'en')} annualized net profit (e.g., a 3x multiple). Draft a clear deed dictating profit-sharing rules vs retained earnings for growth.` : isHi ? `🤝 **साझेदारी रणनीति:**\nपार्टनर लेने से पहले, अपने ${formatBDT(context.netProfit * 12, 'hi')} वार्षिक शुद्ध लाभ (जैसे 3x मल्टीपल) के आधार पर वैल्यूएशन तय करें। लाभ-बंटवारे और ग्रोथ के लिए रोके गए मुनाफे के नियमों को स्पष्ट रूप से डीड में लिखें।` : `🤝 **পার্টনারশিপ ও অংশীদারি কৌশল:**\nপার্টনার নেওয়ার আগে আপনার ${formatBDT(context.netProfit * 12, 'bn')} বার্ষিক নিট মুনাফার ওপর ভিত্তি করে ভ্যালুয়েশন নির্ধারণ করুন। গ্রোথের জন্য কত টাকা ব্যবসায় রাখা হবে এবং কত টাকা লাভ হিসেবে ভাগ করা হবে তা চুক্তিতে স্পষ্ট রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 48. INTENT: Insurance
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('বীমা') || q.includes('insurance') || q.includes('बीमा') || q.includes('ইন্সুরেন্স')) {
    return {
      reply: isEn ? `🛡️ **Enterprise Risk Hedging (Insurance):**\nYou have ${formatBDT(context.totalStockInvestment, 'en')} sitting in physical stock. An unforeseen event (fire, flood) could bankrupt you. A commercial fire & burglary policy costs less than 1% of your stock value—hedge this risk immediately.` : isHi ? `🛡️ **बीमा और जोखिम प्रबंधन:**\nआपके पास भौतिक स्टॉक में ${formatBDT(context.totalStockInvestment, 'hi')} है। आग या बाढ़ जैसी घटना आपको दिवालिया कर सकती है। एक कमर्शियल बीमा पॉलिसी की कीमत आपके स्टॉक मूल्य के 1% से भी कम है—इस जोखिम को तुरंत कवर करें।` : `🛡️ **বীমা ও ঝুঁকি ব্যবস্থাপনা:**\nআপনার দোকানে ${formatBDT(context.totalStockInvestment, 'bn')} টাকার ফিজিক্যাল স্টক আছে। অগ্নিকাণ্ড বা বন্যার মতো দুর্ঘটনা আপনাকে দেউলিয়া করে দিতে পারে। একটি কমার্শিয়াল ফায়ার ও বার্গলারি পলিসির খরচ আপনার স্টক ভ্যালুর ১% এরও কম—এই ঝুঁকিটি দ্রুত কভার করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 49. INTENT: Retirement Planning
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('অবসর') || q.includes('retirement') || q.includes('रिटायरमेंट') || q.includes('পেনশন')) {
    return {
      reply: isEn ? `🏖️ **Founder's Wealth Management:**\nDon't rely solely on the business for retirement. Systematically extract 5-10% of your ${formatBDT(context.netProfit, 'en')} net profit into an index fund or DPZ. Treat your future self as the most important supplier you pay.` : isHi ? `🏖️ **रिटायरमेंट प्लानिंग:**\nरिटायरमेंट के लिए केवल बिज़नेस पर निर्भर न रहें। अपने ${formatBDT(context.netProfit, 'hi')} शुद्ध लाभ का 5-10% व्यवस्थित रूप से इंडेक्स फंड या फिक्स्ड डिपॉजिट में निकालें। अपने भविष्य को सबसे महत्वपूर्ण सप्लायर समझें।` : `🏖️ **অবসর ও পেনশন পরিকল্পনা:**\nঅবসরের জন্য কেবল ব্যবসার ওপর নির্ভর করবেন না। আপনার ${formatBDT(context.netProfit, 'bn')} নিট মুনাফার ৫-১০% নিয়মিত ডিপিএস বা ফান্ডে বিনিয়োগ করুন। নিজের ভবিষ্যৎকে সবচেয়ে গুরুত্বপূর্ণ পাওনাদার হিসেবে বিবেচনা করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 50. INTENT: Cash vs Credit Ratio
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ক্যাশ বনাম বাকি') || q.includes('cash vs credit') || q.includes('नकद बनाम उधार')) {
    return {
      reply: isEn ? `⚖️ **Cash-to-Credit Sales Ratio:**\nMonitoring this ratio is vital. If credit sales exceed 40% of total revenue, you risk starving your ${formatBDT(context.dailyOpEx, 'en')}/day operational burn. Tighten credit terms to shift the ratio back toward 70:30 cash-to-credit.` : isHi ? `⚖️ **नकद बनाम उधार अनुपात:**\nइस अनुपात की निगरानी करना महत्वपूर्ण है। यदि उधार बिक्री कुल राजस्व का 40% से अधिक है, तो आप अपने ${formatBDT(context.dailyOpEx, 'hi')}/दिन के खर्च के लिए नकदी संकट का जोखिम उठाते हैं। 70:30 नकद-से-उधार अनुपात वापस लाने के लिए उधार शर्तें कड़ी करें।` : `⚖️ **ক্যাশ বনাম বাকি অনুপাত:**\nএই অনুপাতটি খেয়াল রাখা জরুরি। যদি বাকিতে বিক্রি মোট বিক্রির ৪০% ছাড়িয়ে যায়, তবে আপনার ${formatBDT(context.dailyOpEx, 'bn')}/দিন খরচে টান পড়তে পারে। ৭০:৩০ (ক্যাশ:বাকি) অনুপাতে ফিরে যেতে বাকির শর্ত কঠোর করুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 51. INTENT: Working Capital Cycle
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('চলতি মূলধন চক্র') || q.includes('working capital') || q.includes('कार्यशील पूंजी')) {
    return {
      reply: isEn ? `⚙️ **Working Capital Mechanics:**\nYour Working Capital is ${formatBDT(context.workingCapital, 'en')}. With a CCC of ${context.cashConversionCycle} days, you must survive this gap before cash re-enters. Shrink this gap by turning inventory (DSI ${context.dsi} days) faster.` : isHi ? `⚙️ **कार्यशील पूंजी (Working Capital):**\nआपकी वर्किंग कैपिटल ${formatBDT(context.workingCapital, 'hi')} है। ${context.cashConversionCycle} दिनों के CCC के साथ, आपको नकद वापस आने तक इस अंतर को सहना होगा। इन्वेंटरी (DSI ${context.dsi} दिन) तेजी से बेचकर इस अंतर को कम करें।` : `⚙️ **চলতি মূলধন চক্র:**\nআপনার চলতি মূলধন হলো ${formatBDT(context.workingCapital, 'bn')}। আপনার সিসিসি ${context.cashConversionCycle} দিন হওয়ায়, ক্যাশ ফিরে আসা পর্যন্ত আপনাকে এই গ্যাপ সামলাতে জানালাতে হবে। ইনভেন্টরি (ডিএসআই ${context.dsi} দিন) দ্রুত বিক্রি করে এই গ্যাপ কমিয়ে আনুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 52. INTENT: Goodwill / Reputation
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('সুনাম') || q.includes('goodwill') || q.includes('reputation') || q.includes('साख') || q.includes('বিশ্বাসযোগ্যতা')) {
    return {
      reply: isEn ? `🌟 **Brand Equity (Intangible Asset):**\nGoodwill isn't just a buzzword; it allows you to charge a premium over competitors. Nurture it by honoring supplier payments (DPO ${context.dpo} days) on time and providing exceptional after-sales support.` : isHi ? `🌟 **ब्रांड इक्विटी (सद्भावना):**\nसद्भावना (Goodwill) केवल एक शब्द नहीं है; यह आपको प्रतिस्पर्धियों से अधिक कीमत लेने की अनुमति देता है। सप्लायर के भुगतान (DPO ${context.dpo} दिन) समय पर करके और बेहतरीन सर्विस देकर इसे बढ़ाएं।` : `🌟 **ব্র্যান্ড ইকুইটি ও সুনাম:**\nসুনাম (Goodwill) শুধু কথার কথা নয়; এটি আপনাকে প্রতিযোগীদের চেয়ে বেশি দাম হাঁকার সুযোগ দেয়। মহাজনদের পেমেন্ট (ডিপিও ${context.dpo} দিন) সময়মতো করে এবং ভালো বিক্রয়োত্তর সেবা দিয়ে ব্যবসার সুনাম ধরে রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 53. INTENT: Expense Category
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('খরচের ক্যাটাগরি') || q.includes('expense category') || q.includes('खर्चे की श्रेणी') || q.includes('কোন খাতে কত')) {
    return {
      reply: isEn ? `📊 **OpEx Stratification:**\nYour total daily OpEx is ${formatBDT(context.dailyOpEx, 'en')}. Categorize strictly into Fixed (rent, salaries) and Variable (utilities, transport). To optimize your ${context.netMarginPct}% net margin, ruthlessly audit and cut non-revenue-generating variable expenses.` : isHi ? `📊 **खर्चों का वर्गीकरण:**\nआपका कुल दैनिक खर्च ${formatBDT(context.dailyOpEx, 'hi')} है। इसे फिक्स्ड (किराया, वेतन) और वेरिएबल (बिजली, ट्रांसपोर्ट) में सख्ती से बांटें। अपने ${context.netMarginPct}% नेट मार्जिन को बेहतर बनाने के लिए, बिना मुनाफे वाले खर्चे तुरंत काटें।` : `📊 **খরচের খাত বিশ্লেষণ:**\nআপনার মোট দৈনিক খরচ ${formatBDT(context.dailyOpEx, 'bn')}। এটিকে ফিক্সড (ভাড়া, বেতন) এবং ভেরিয়েবল (বিদ্যুৎ, যাতায়াত) খাতে ভাগ করুন। আপনার ${context.netMarginPct}% নিট মার্জিন বাড়াতে, যেসব খরচ থেকে আয় আসে না সেগুলো কঠোরভাবে কমিয়ে ফেলুন।`
    };
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // 54. INTENT: App Guide - How to add sale
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('বিক্রি যোগ করব') || q.includes('how to add sale') || q.includes('बिक्री कैसे जोड़ें') || 
    q.includes('সেল এন্ট্রি') || q.includes('add sale') || q.includes('বিক্রি কিভাবে') ||
    (q.includes('বিক্রি') && (q.includes('কিভাবে') || q.includes('কীভাবে') || q.includes('কই') || q.includes('যোগ') || q.includes('এন্ট্রি') || q.includes('লিখব')))
  ) {
    return {
      isInstantIntent: true,
      reply: isEn ? `📝 **How to Add a Sale:**\n1. Go to the Dashboard.\n2. Tap the '+' button.\n3. Enter the sale amount.\n4. Save it.` : isHi ? `📝 **बिक्री कैसे जोड़ें:**\n1. डैशबोर्ड पर जाएं।\n2. '+' बटन दबाएं।\n3. बिक्री की रकम लिखें।\n4. सेव करें।` : `📝 **বিক্রি যোগ করার নিয়ম:**\n১. ড্যাশবোর্ডে যান।\n২. '+' বাটনে চাপুন।\n৩. বিক্রির পরিমাণ লিখুন।\n৪. সেভ করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Add Sale', screen: SCREENS.DASHBOARD, buttonLabel: '🏠 Go to Dashboard' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 55. INTENT: App Guide - How to add expense
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('খরচ যোগ করব') || q.includes('how to add expense') || q.includes('खर्चा कैसे जोड़ें') || 
    q.includes('add expense') || q.includes('খরচের হিসাব') || q.includes('খরচ কিভাবে') ||
    (q.includes('খরচ') && (q.includes('কিভাবে') || q.includes('কীভাবে') || q.includes('লিখব') || q.includes('যোগ') || q.includes('কই')))
  ) {
    return {
      isInstantIntent: true,
      reply: isEn ? `💸 **How to Add an Expense:**\n1. Go to the Dashboard.\n2. Tap the 'Expense' button.\n3. Enter amount and category.\n4. Save it.` : isHi ? `💸 **खर्चा कैसे जोड़ें:**\n1. डैशबोर्ड पर जाएं।\n2. 'खर्चा' बटन दबाएं।\n3. रकम और श्रेणी लिखें।\n4. सेव करें।` : `💸 **খরচ যোগ করার নিয়ম:**\n১. ড্যাশবোর্ডে যান।\n২. 'খরচ' বাটনে চাপুন।\n৩. খরচের পরিমাণ ও খাত লিখুন।\n৪. সেভ করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Add Expense', screen: SCREENS.DASHBOARD, buttonLabel: '🏠 Go to Dashboard' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 56. INTENT: App Guide - How to add product
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('পণ্য যোগ') || q.includes('how to add product') || q.includes('प्रोडक्ट कैसे जोड़ें') || 
    q.includes('add product') || q.includes('মালামাল যোগ') ||
    (q.includes('পণ্য') && (q.includes('কিভাবে') || q.includes('কীভাবে') || q.includes('যোগ'))) ||
    (q.includes('product') && q.includes('add'))
  ) {
    return {
      isInstantIntent: true,
      reply: isEn ? `📦 **How to Add a Product:**\n1. Go to Dashboard\'s Products tab.\n2. Tap 'Add Product'.\n3. Enter details.\n4. Save.` : isHi ? `📦 **प्रोडक्ट कैसे जोड़ें:**\n1. डैशबोर्ड के प्रोडक्ट टैब में जाएं।\n2. 'प्रोडक्ट जोड़ें' दबाएं।\n3. विवरण लिखें।\n4. सेव करें।` : `📦 **পণ্য যোগ করার নিয়ম:**\n১. ড্যাশবোর্ডে 'Products' ট্যাবে যান।\n২. 'পণ্য যোগ করুন' বাটনে চাপুন।\n৩. পণ্যের নাম ও দাম লিখুন।\n৪. সেভ করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Add Product', screen: SCREENS.DASHBOARD, buttonLabel: '🏠 Go to Dashboard' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 57. INTENT: App Guide - How to open day
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('দিন শুরু করব') || q.includes('how to open day') || q.includes('दिन कैसे शुरू करें') || 
    q.includes('open day') || q.includes('দোকান খোলা') ||
    (q.includes('দিন শুরু') && (q.includes('কিভাবে') || q.includes('কীভাবে') || q.includes('করব') || q.includes('নিয়ম')))
  ) {
    return {
      isInstantIntent: true,
      reply: isEn ? `🌅 **How to Open Day:**\n1. Go to the Opening screen.\n2. Enter starting cash balance.\n3. Confirm to start the day.` : isHi ? `🌅 **दिन कैसे शुरू करें:**\n1. ओपनिंग स्क्रीन पर जाएं।\n2. सुबह का कैश बैलेंस लिखें।\n3. दिन शुरू करें।` : `🌅 **দিন শুরু করার নিয়ম:**\n১. 'ওপেনিং' স্ক্রিনে যান।\n২. ক্যাশবক্সে থাকা শুরুর ব্যালেন্স লিখুন।\n৩. দিন শুরু করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Open Day', screen: SCREENS.OPENING, buttonLabel: '🌅 Go to Opening' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 58. INTENT: App Guide - How to close day
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('দিন শেষ করব') || q.includes('how to close day') || q.includes('दिन कैसे बंद करें') || 
    q.includes('close day') || q.includes('হিসাব মেলানো') ||
    (q.includes('দিন শেষ') && (q.includes('কিভাবে') || q.includes('কীভাবে') || q.includes('করব') || q.includes('নিয়ম')))
  ) {
    return {
      isInstantIntent: true,
      reply: isEn ? `🌃 **How to Close Day:**\n1. Go to Closing screen.\n2. Count physical cash.\n3. Reconcile differences.\n4. Close the day.` : isHi ? `🌃 **दिन कैसे बंद करें:**\n1. क्लोजिंग स्क्रीन पर जाएं।\n2. कैश गिने।\n3. हिसाब मिलाएं।\n4. दिन बंद करें।` : `🌃 **দিন শেষ করার নিয়ম:**\n১. 'ক্লোজিং' স্ক্রিনে যান।\n২. ক্যাশবক্সের নগদ টাকা গুনুন।\n৩. অ্যাপের সাথে হিসাব মেলান।\n৪. দিন শেষ করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Close Day', screen: SCREENS.CLOSING, buttonLabel: '🌃 Go to Closing' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 59. INTENT: App Guide - How to see reports
  // ─────────────────────────────────────────────────────────────────────────────
  if (
    q.includes('রিপোর্ট দেখব') || q.includes('how to see reports') || q.includes('how to view reports') || 
    q.includes('रिपोर्ट कैसे देखें') ||
    (q.includes('রিপোর্ট') && (q.includes('কোথায়') || q.includes('কিভাবে') || q.includes('কীভাবে') || q.includes('কই') || q.includes('পাব') || q.includes('দেখব'))) ||
    (q.includes('report') && (q.includes('where') || q.includes('how')))
  ) {
    return {
      isInstantIntent: true,
      reply: isEn ? `📊 **How to See Reports:**\n1. Go to Reports screen.\n2. View Sales, Expense, and P&L charts.` : isHi ? `📊 **रिपोर्ट कैसे देखें:**\n1. रिपोर्ट स्क्रीन पर जाएं।\n2. बिक्री, खर्च और लाभ-हानि चार्ट देखें।` : `📊 **রিপোর্ট দেখার নিয়ম:**\n১. 'রিপোর্ট' স্ক্রিনে যান।\n২. বিক্রি, খরচ ও লাভ-ক্ষতির চার্টগুলো দেখুন।`,
      actionCard: { type: 'NAVIGATE', title: 'View Reports', screen: SCREENS.REPORTS, buttonLabel: '📊 Go to Reports' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 60. INTENT: App Guide - How to manage due/khata
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('বাকি লিখব') || q.includes('how to manage dues') || q.includes('उधारी कैसे लिखें') || q.includes('বাকি হিসাব') || q.includes('khata')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `📓 **How to Manage Dues (Khata):**\n1. Go to Khata screen.\n2. Add customer and record given or collected due.\n3. Send WhatsApp reminders.` : isHi ? `📓 **उधारी कैसे लिखें:**\n1. खाता स्क्रीन पर जाएं।\n2. ग्राहक जोड़ें और उधार लिखें या वसूली लिखें।\n3. WhatsApp पर रिमाइंडर भेजें।` : `📓 **বাকি বা খাতা ব্যবহারের নিয়ম:**\n১. 'খাতা' স্ক্রিনে যান।\n২. কাস্টমার যোগ করে নতুন বাকি বা আদায়ের হিসাব লিখুন।\n৩. চাইলে হোয়াটসঅ্যাপে তাগাদা পাঠান।`,
      actionCard: { type: 'NAVIGATE', title: 'Manage Khata', screen: SCREENS.KHATA, buttonLabel: '📓 Go to Khata' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 61. INTENT: App Guide - How to transfer money
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('টাকা ট্রান্সফার') || q.includes('how to transfer') || q.includes('पैसे कैसे ट्रांसफर करें') || q.includes('transfer money')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `💸 **How to Transfer Money:**\n1. Go to Dashboard.\n2. Tap the Transfer icon.\n3. Select source and destination wallets.\n4. Enter amount.` : isHi ? `💸 **पैसे कैसे ट्रांसफर करें:**\n1. डैशबोर्ड पर जाएं।\n2. ट्रांसफर आइकन दबाएं।\n3. भेजने और प्राप्त करने वाला वॉलेट चुनें।\n4. रकम लिखें।` : `💸 **টাকা ট্রান্সফার করার নিয়ম:**\n১. ড্যাশবোর্ডে যান।\n২. ট্রান্সফার আইকনে চাপুন।\n৩. কোন ওয়ালেট থেকে কোথায় পাঠাবেন তা নির্বাচন করুন।\n৪. টাকার পরিমাণ লিখে সেভ করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Transfer Money', screen: SCREENS.DASHBOARD, buttonLabel: '🏠 Go to Dashboard' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 62. INTENT: App Guide - How to add wallet
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ওয়ালেট যোগ') || q.includes('how to add wallet') || q.includes('वॉलेट कैसे जोड़ें') || q.includes('add wallet') || q.includes('বিকাশ নগদ')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `💳 **How to Add a Wallet:**\n1. Go to Dashboard.\n2. Open Wallets section.\n3. Add Bank, bKash, or Nagad wallet.` : isHi ? `💳 **वॉलेट कैसे जोड़ें:**\n1. डैशबोर्ड पर जाएं।\n2. वॉलेट अनुभाग खोलें।\n3. नया बैंक, विकास या नकद वॉलेट जोड़ें।` : `💳 **ওয়ালেট যোগ করার নিয়ম:**\n১. ড্যাশবোর্ডে যান।\n২. ওয়ালেট সেকশনটি খুলুন।\n৩. নতুন ব্যাংক, বিকাশ বা নগদ অ্যাকাউন্ট যোগ করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Add Wallet', screen: SCREENS.DASHBOARD, buttonLabel: '🏠 Go to Dashboard' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 63. INTENT: App Guide - How to add contact
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('কাস্টমার যোগ') || q.includes('how to add customer') || q.includes('how to add contact') || q.includes('ग्राहक कैसे जोड़ें') || q.includes('add contact')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `👤 **How to Add a Contact/Customer:**\n1. Go to Khata screen.\n2. Tap 'Add Contact'.\n3. Enter name and phone number.` : isHi ? `👤 **ग्राहक कैसे जोड़ें:**\n1. खाता स्क्रीन पर जाएं।\n2. 'संपर्क जोड़ें' दबाएं।\n3. नाम और फोन नंबर लिखें।` : `👤 **কাস্টমার বা সাপ্লায়ার যোগ করার নিয়ম:**\n১. 'খাতা' স্ক্রিনে যান।\n২. 'কাস্টমার যোগ করুন' বাটনে চাপুন।\n৩. নাম ও মোবাইল নম্বর লিখে সেভ করুন।`,
      actionCard: { type: 'NAVIGATE', title: 'Add Contact', screen: SCREENS.KHATA, buttonLabel: '📓 Go to Khata' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 64. INTENT: App Guide - How to use analytics
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('অ্যানালিটিক্স') || q.includes('how to use analytics') || q.includes('एनालिटिक्स कैसे देखें') || q.includes('analytics')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `🧠 **How to Use Analytics:**\n1. Go to Analytics screen.\n2. Review your 14 KPI Business Health Scorecard.\n3. Follow CFO insights for growth.` : isHi ? `🧠 **एनालिटिक्स कैसे देखें:**\n1. एनालिटिक्स स्क्रीन पर जाएं।\n2. अपना 14 KPI बिज़नेस हेल्थ स्कोरकार्ड देखें।\n3. ग्रोथ के लिए CFO की सलाह मानें।` : `🧠 **অ্যানালিটিক্স ব্যবহারের নিয়ম:**\n১. 'অ্যানালিটিক্স' স্ক্রিনে যান।\n২. আপনার ব্যবসার ১৪টি KPI সম্বলিত হেলথ স্কোরকার্ড দেখুন।\n৩. ব্যবসার উন্নতির জন্য সিএফও-র পরামর্শগুলো পড়ে কাজে লাগান।`,
      actionCard: { type: 'NAVIGATE', title: 'View Analytics', screen: SCREENS.ANALYTICS, buttonLabel: '🧠 Go to Analytics' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 65. INTENT: App Guide - What is this app
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('এই অ্যাপ কী') || q.includes('what is this app') || q.includes('ये ऐप क्या है') || q.includes('ledgero ki') || q.includes('লেজারো কী')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `📱 **About Ledgero:**\nLedgero is a smart, free business accounting app designed for small and medium businesses in Bangladesh. It helps you track sales, expenses, inventory, and dues with a built-in AI CFO.` : isHi ? `📱 **Ledgero के बारे में:**\nLedgero बांग्लादेश के छोटे और मध्यम व्यवसायों के लिए एक स्मार्ट, मुफ़्त अकाउंटिंग ऐप है। यह एआई CFO की मदद से बिक्री, खर्च, और उधारी का हिसाब रखने में मदद करता है।` : `📱 **লেজারো (Ledgero) কী?**\nলেজারো হলো বাংলাদেশের ছোট ও মাঝারি ব্যবসায়ীদের জন্য সম্পূর্ণ ফ্রি একটি স্মার্ট অ্যাকাউন্টিং অ্যাপ। এর মাধ্যমে আপনি বিক্রি, খরচ, বাকি, এবং মজুদের হিসাব রাখার পাশাপাশি এআই সিএফও-র পরামর্শও পাবেন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 66. INTENT: App Guide - How to use NAM AI
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('এআই কিভাবে ব্যবহার') || q.includes('how to use nam') || q.includes('ai कैसे इस्तेमाल करें') || q.includes('ai use')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `🤖 **How to Use Dr. NAM (AI):**\nJust type or speak your questions! For example:\n- "How to increase profit?"\n- "What is my cash balance?"\n- "Add an expense of 50 for tea."\nI'm always here to help you grow!` : isHi ? `🤖 **Dr. NAM (AI) का उपयोग कैसे करें:**\nबस अपने सवाल टाइप करें या बोलें! उदाहरण के लिए:\n- "मुनाफा कैसे बढ़ाएं?"\n- "मेरा नकद बैलेंस कितना है?"\n- "चाय का 50 रुपये का खर्च लिखें।"\nमैं हमेशा मदद के लिए तैयार हूँ!` : `🤖 **Dr. NAM (এআই) ব্যবহারের নিয়ম:**\nআপনি যেকোনো প্রশ্ন লিখে বা মুখে বলে আমাকে করতে পারেন! যেমন:\n- "লাভ কিভাবে বাড়াবো?"\n- "আমার ক্যাশবক্সে কত টাকা আছে?"\n- "চা নাস্তা খরচ ৫০ টাকা লিখো।"\nআমি আপনার ব্যবসাকে বড় করতে সবসময় প্রস্তুত!`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 67. INTENT: App Guide - Where to find X
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('কোথায় পাবো') || q.includes('কোথায় আছে') || q.includes('where is') || q.includes('कहाँ है') || q.includes('find')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `📍 **App Navigation Guide:**\n- **Dashboard:** Sales, Expenses, Wallets, Products.\n- **Khata:** Customers, Dues, Reminders.\n- **Reports:** P&L, Charts, Summaries.\n- **Analytics:** Business Health, KPIs.\n- **Opening/Closing:** Cash counting.` : isHi ? `📍 **ऐप नेविगेशन गाइड:**\n- **डैशबोर्ड:** बिक्री, खर्च, वॉलेट, उत्पाद।\n- **खाता:** ग्राहक, उधारी, रिमाइंडर।\n- **रिपोर्ट:** लाभ-हानि, चार्ट।\n- **एनालिटिक्स:** बिज़नेस हेल्थ, KPI।\n- **ओपनिंग/क्लोजिंग:** कैश गिनना।` : `📍 **কোথায় কী পাবেন:**\n- **ড্যাশবোর্ড:** বিক্রি, খরচ, ওয়ালেট, পণ্য।\n- **খাতা:** কাস্টমার, বাকি, তাগাদা।\n- **রিপোর্ট:** লাভ-ক্ষতি, চার্ট।\n- **অ্যানালিটিক্স:** ব্যবসার হেলথ স্কোর, কেপিআই।\n- **ওপেনিং/ক্লোজিং:** নগদ টাকা গোনা।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 68. INTENT: App Guide - App settings
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('সেটিংস') || q.includes('settings') || q.includes('সেটিংস') || q.includes('ভাষা পরিবর্তন') || q.includes('language change')) {
    return {
      isInstantIntent: true,
      reply: isEn ? `⚙️ **Settings & Language:**\nYou can find the Settings menu in the sidebar or top right corner. From there, you can change the app language (English, Bengali, Hindi), update your business details, and manage notifications.` : isHi ? `⚙️ **सेटिंग्स और भाषा:**\nआप साइडबार या ऊपर दाईं ओर सेटिंग्स मेनू पा सकते हैं। वहां से आप ऐप की भाषा (अंग्रेजी, बंगाली, हिंदी) बदल सकते हैं, और बिज़नेस का विवरण अपडेट कर सकते हैं।` : `⚙️ **সেটিংস ও ভাষা পরিবর্তন:**\nঅ্যাপের সাইডবার বা ওপরের ডানদিকের কোণায় আপনি সেটিংস মেনু পাবেন। সেখান থেকে আপনি অ্যাপের ভাষা (বাংলা, ইংরেজি, হিন্দি) পরিবর্তন, ব্যবসার তথ্য হালনাগাদ এবং নোটিফিকেশন ঠিক করতে পারবেন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 69. INTENT: Advanced - Accounts Receivable Aging
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('পাওনার বয়স') || q.includes('aging') || q.includes('एजिंग') || q.includes('বকেয়ার বয়স')) {
    return {
      reply: isEn ? `📊 **Accounts Receivable Aging Analysis:**\nYour average collection period (DSO) is ${context.dso} days. Monitoring the aging of receivables ensures you identify potential bad debts early. Any debt older than 60 days has a drastically lower probability of collection.` : isHi ? `📊 **प्राप्य खातों की एजिंग (Aging):**\nआपकी औसत वसूली अवधि (DSO) ${context.dso} दिन है। पुरानी उधारी पर नज़र रखने से आप डूबत ऋण (Bad Debts) को जल्दी पहचान सकते हैं। 60 दिनों से अधिक पुरानी उधारी की वसूली की संभावना बहुत कम हो जाती है।` : `📊 **বকেয়ার বয়স বিশ্লেষণ (AR Aging):**\nআপনার বাকি আদায়ের গড় সময় (DSO) হলো ${context.dso} দিন। বকেয়া টাকার বয়স বিশ্লেষণ করলে বুঝতে পারবেন কোন টাকাগুলো আদায়ের সম্ভাবনা কমে যাচ্ছে। ৬০ দিনের বেশি পুরোনো বাকি আদায় হওয়ার সম্ভাবনা অনেক কমে যায়।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 70. INTENT: Advanced - Financial Ratio Summary
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('আর্থিক অনুপাত') || q.includes('financial ratio') || q.includes('वित्तीय अनुपात') || q.includes('ratios')) {
    return {
      reply: isEn ? `⚖️ **Key Financial Ratios:**\n- **Current Ratio:** ${context.currentRatio}x (Liquidity)\n- **Quick Ratio:** ${context.quickRatio}x (Immediate Liquidity)\n- **Gross Margin:** ${context.grossMarginPct}%\n- **Net Margin:** ${context.netMarginPct}%\nThese metrics define your operational efficiency and solvency.` : isHi ? `⚖️ **प्रमुख वित्तीय अनुपात:**\n- **करंट रेश्यो:** ${context.currentRatio}x (तरलता)\n- **क्विक रेश्यो:** ${context.quickRatio}x (तत्काल तरलता)\n- **ग्रॉस मार्जिन:** ${context.grossMarginPct}%\n- **नेट मार्जिन:** ${context.netMarginPct}%\nये मीट्रिक आपकी परिचालन दक्षता को दर्शाते हैं।` : `⚖️ **গুরুত্বপূর্ণ আর্থিক অনুপাত:**\n- **কারেন্ট রেশিও:** ${context.currentRatio}x (তারল্য)\n- **কুইক রেশিও:** ${context.quickRatio}x (তাৎক্ষণিক তারল্য)\n- **গ্রস মার্জিন:** ${context.grossMarginPct}%\n- **নিট মার্জিন:** ${context.netMarginPct}%\nএই অনুপাতগুলো আপনার ব্যবসার সার্বিক স্বাস্থ্য ও দক্ষতার নির্দেশক।`,
      actionCard: { type: 'NAVIGATE', title: 'View Analytics', screen: SCREENS.ANALYTICS, buttonLabel: '🧠 Go to Analytics' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 71. INTENT: Advanced - Profit Maximization
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('লাভ সর্বোচ্চ') || q.includes('maximize profit') || q.includes('अधिकतम लाभ') || q.includes('profit maximization')) {
    return {
      reply: isEn ? `📈 **Profit Maximization (DuPont Strategy):**\nTo maximize profit, focus on three levers: 1) Increase Net Margin by raising prices 2% without losing volume, 2) Improve Asset Turnover by clearing dead stock, and 3) Optimize Operating Leverage by keeping fixed costs flat while sales grow.` : isHi ? `📈 **लाभ अधिकतमकरण (Profit Maximization):**\nलाभ को अधिकतम करने के लिए तीन बातों पर ध्यान दें: 1) बिना बिक्री खोए कीमतें 2% बढ़ाकर नेट मार्जिन बढ़ाएं, 2) पुराना स्टॉक निकालकर एसेट टर्नओवर सुधारें, और 3) बिक्री बढ़ने पर फिक्स्ड कॉस्ट को स्थिर रखें।` : `📈 **মুনাফা সর্বোচ্চকরণ কৌশল (DuPont Strategy):**\nসর্বোচ্চ মুনাফার জন্য তিনটি কাজ করুন: ১) বিক্রি না কমিয়ে পণ্যের দাম ২% বাড়িয়ে নিট মার্জিন উন্নত করুন, ২) অবিক্রীত স্টক ক্লিয়ার করে মূলধনের গতি বাড়ান, এবং ৩) বিক্রি বাড়লেও দোকান ভাড়া বা বেতনের মতো স্থায়ী খরচ স্থির রাখুন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 72. INTENT: Advanced - Cost of Goods Sold
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('বিক্রিত পণ্যের খরচ') || q.includes('cogs') || q.includes('बिक्री की लागत') || q.includes('cost of goods sold')) {
    return {
      reply: isEn ? `📦 **Cost of Goods Sold (COGS):**\nCOGS represents the direct costs of producing the goods sold by a company. By negotiating better rates with suppliers, you can lower COGS, which directly increases your Gross Margin (currently ${context.grossMarginPct}%).` : isHi ? `📦 **बिक्री की लागत (COGS):**\nCOGS का अर्थ है बेचे गए माल की प्रत्यक्ष लागत। आप सप्लायर से बेहतर कीमत पर माल खरीदकर अपना COGS कम कर सकते हैं, जिससे आपका ग्रॉस मार्जिन (वर्तमान ${context.grossMarginPct}%) सीधे बढ़ जाएगा।` : `📦 **বিক্রিত পণ্যের খরচ (COGS):**\nCOGS হলো আপনি যে পণ্যগুলো বিক্রি করেছেন, সেগুলো কিনতে বা বানাতে আপনার সরাসরি যে খরচ হয়েছে। পাইকারি বাজার বা মহাজনের কাছ থেকে আরও কম দামে পণ্য কিনলে আপনার COGS কমবে এবং গ্রস মার্জিন (বর্তমান ${context.grossMarginPct}%) বেড়ে যাবে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 73. INTENT: Advanced - Operating Leverage
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('অপারেটিং লিভারেজ') || q.includes('operating leverage') || q.includes('परिचालन लीवरेज')) {
    return {
      reply: isEn ? `⚙️ **Operating Leverage:**\nYour daily fixed costs are ${formatBDT(context.dailyOpEx, 'en')}. A business with high fixed costs has high operating leverage. This means once you pass your break-even point (${formatBDT(context.breakevenDailySales, 'en')} daily), a large percentage of every extra sale drops straight to net profit.` : isHi ? `⚙️ **ऑपरेटिंग लीवरेज:**\nआपका दैनिक निश्चित खर्च ${formatBDT(context.dailyOpEx, 'hi')} है। जब आप अपने ब्रेक-ईवन पॉइंट (${formatBDT(context.breakevenDailySales, 'hi')}/दिन) को पार कर लेते हैं, तो अतिरिक्त बिक्री का एक बड़ा हिस्सा सीधे आपके शुद्ध लाभ में बदल जाता है।` : `⚙️ **অপারেটিং লিভারেজ:**\nআপনার দৈনিক স্থায়ী খরচ হলো ${formatBDT(context.dailyOpEx, 'bn')}। একবার আপনার প্রতিদিনের ব্রেক-ইভেন বিক্রির টার্গেট (${formatBDT(context.breakevenDailySales, 'bn')}) পূরণ হয়ে গেলে, এরপরের প্রতিটি বিক্রির একটি বড় অংশ সরাসরি আপনার নিট মুনাফায় যোগ হতে থাকে। একেই উচ্চ অপারেটিং লিভারেজ বলে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 74. INTENT: Advanced - Depreciation
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('অবচয়') || q.includes('depreciation') || q.includes('मूल्यह्रास')) {
    return {
      reply: isEn ? `📉 **Depreciation Mechanics:**\nDepreciation allocates the cost of tangible assets (like furniture or computers) over their useful life. While it reduces reported profit, it is a non-cash expense, meaning it provides a tax shield without draining actual liquid cash.` : isHi ? `📉 **मूल्यह्रास (Depreciation):**\nमूल्यह्रास किसी संपत्ति (जैसे फर्नीचर) की लागत को उसके उपयोगी जीवन में बांटता है। यह आपके मुनाफे को कम दिखाता है जिससे टैक्स बचता है, लेकिन इससे वास्तव में कोई नकद पैसा बाहर नहीं जाता।` : `📉 **অবচয় বা ডিপ্রিসিয়েশন:**\nদোকানের ফার্নিচার বা কম্পিউটারের মতো স্থায়ী সম্পদের মূল্য সময়ের সাথে কমে যাওয়াকে অবচয় বলে। এটি হিসাবের খাতায় আপনার লাভ কমিয়ে দেখায় (যার ফলে ট্যাক্স বাঁচে), কিন্তু এটি কোনো নগদ খরচ নয়, তাই আপনার ক্যাশবক্সের টাকা কমে না।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 75. INTENT: Advanced - Balance Sheet Basics
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ব্যালেন্স শিট') || q.includes('balance sheet') || q.includes('बैलेंस शीट') || q.includes('তুলনপত্র')) {
    return {
      reply: isEn ? `⚖️ **Balance Sheet Fundamentals:**\nThe golden rule is: **Assets = Liabilities + Equity**.\nYour Assets include Cash (${formatBDT(context.totalLiquidCash, 'en')}), Inventory (${formatBDT(context.totalStockInvestment, 'en')}), and Receivables. Liabilities include Dues to Suppliers. Equity is your true net worth in the business.` : isHi ? `⚖️ **बैलेंस शीट (तुलन पत्र):**\nसुनहरा नियम है: **संपत्ति = देनदारियां + इक्विटी**।\nआपकी संपत्ति में नकद (${formatBDT(context.totalLiquidCash, 'hi')}), इन्वेंटरी (${formatBDT(context.totalStockInvestment, 'hi')}) और प्राप्य शामिल हैं। देनदारियों में सप्लायर की उधारी शामिल है। इक्विटी व्यवसाय में आपकी शुद्ध संपत्ति है।` : `⚖️ **ব্যালেন্স শিট বা তুলনপত্রের মূলনীতি:**\nএর মূল সূত্র হলো: **সম্পদ = দায় + মালিকানাস্বত্ব (Equity)**।\nআপনার সম্পদের মধ্যে রয়েছে নগদ ক্যাশ (${formatBDT(context.totalLiquidCash, 'bn')}), মজুত পণ্য (${formatBDT(context.totalStockInvestment, 'bn')}) এবং কাস্টমারদের কাছে বকেয়া। দায়ের মধ্যে পড়ে মহাজনদের পাওনা। আর ইকুইটি হলো ব্যবসায় আপনার আসল মূলধন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 76. INTENT: Advanced - Income Statement
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('আয়-ব্যয় বিবরণী') || q.includes('income statement') || q.includes('p&l') || q.includes('লাভ-ক্ষতি') || q.includes('आय विवरण')) {
    return {
      reply: isEn ? `🧾 **Income Statement (P&L):**\nYour Revenue is ${formatBDT(context.revenue, 'en')}. After deducting COGS, your Gross Profit Margin is ${context.grossMarginPct}%. Subtracting Operating Expenses (${formatBDT(context.opex, 'en')}) yields your Net Profit Margin of ${context.netMarginPct}%.` : isHi ? `🧾 **आय विवरण (P&L):**\nआपका राजस्व ${formatBDT(context.revenue, 'hi')} है। COGS घटाने के बाद, आपका ग्रॉस प्रॉफिट मार्जिन ${context.grossMarginPct}% है। परिचालन व्यय (${formatBDT(context.opex, 'hi')}) घटाने पर आपका नेट प्रॉफिट मार्जिन ${context.netMarginPct}% आता है।` : `🧾 **আয়-ব্যয় বিবরণী (P&L):**\nআপনার মোট বিক্রি হলো ${formatBDT(context.revenue, 'bn')}। পণ্য কেনার খরচ বাদ দিলে আপনার গ্রস মার্জিন থাকে ${context.grossMarginPct}%। এরপর দোকান ভাড়া ও অন্যান্য খরচ (${formatBDT(context.opex, 'bn')}) বাদ দিলে আপনার আসল নিট মার্জিন দাঁড়ায় ${context.netMarginPct}%।`,
      actionCard: { type: 'NAVIGATE', title: 'View Reports', screen: SCREENS.REPORTS, buttonLabel: '📊 Go to Reports' }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 77. INTENT: Advanced - Cash Flow Statement
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('নগদ প্রবাহ বিবরণী') || q.includes('cash flow statement') || q.includes('नकद प्रवाह')) {
    return {
      reply: isEn ? `🌊 **Cash Flow Statement Breakdown:**\nCash flow is divided into 3 activities: 1) **Operating:** Cash generated from daily sales minus expenses. 2) **Investing:** Buying equipment or expanding. 3) **Financing:** Taking loans or owner withdrawals.` : isHi ? `🌊 **नकद प्रवाह विवरण (Cash Flow):**\nनकद प्रवाह को 3 गतिविधियों में बांटा गया है: 1) **परिचालन:** दैनिक बिक्री से उत्पन्न नकद। 2) **निवेश:** उपकरण खरीदना। 3) **वित्तपोषण:** ऋण लेना या मालिक द्वारा पैसे निकालना।` : `🌊 **ক্যাশ ফ্লো স্টেটমেন্ট (নগদ প্রবাহ):**\nক্যাশ ফ্লো ৩টি ভাগে বিভক্ত: ১) **অপারেটিং:** প্রতিদিনের কেনাবেচা থেকে আসা ক্যাশ। ২) **ইনভেস্টিং:** নতুন সরঞ্জাম বা সম্পদ কেনা। ৩) **ফাইন্যান্সিং:** ব্যাংক লোন নেওয়া বা মালিকের ব্যক্তিগত টাকা তোলা। লাভ হলেও ক্যাশ ফ্লো নেগেটিভ হতে পারে যদি টাকা বাকি পড়ে থাকে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 78. INTENT: Advanced - Gross vs Net Profit
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('গ্রস বনাম নেট') || q.includes('gross vs net') || q.includes('सकल बनाम शुद्ध')) {
    return {
      reply: isEn ? `⚖️ **Gross vs. Net Profit:**\n- **Gross Profit (${context.grossMarginPct}%):** Revenue minus direct product costs (COGS). It measures pricing power.\n- **Net Profit (${context.netMarginPct}%):** What\'s left after all other costs (rent, salaries, taxes). It measures overall efficiency.` : isHi ? `⚖️ **ग्रॉस बनाम नेट प्रॉफिट:**\n- **ग्रॉस प्रॉफिट (${context.grossMarginPct}%):** बिक्री में से माल की लागत घटाकर। यह आपकी कीमत तय करने की शक्ति दर्शाता है।\n- **नेट प्रॉफिट (${context.netMarginPct}%):** सभी खर्चे (किराया, वेतन) घटाने के बाद बची असली कमाई।` : `⚖️ **গ্রস প্রফিট বনাম নিট প্রফিট:**\n- **গ্রস প্রফিট (${context.grossMarginPct}%):** বিক্রি থেকে শুধু কেনা দাম বা কাঁচামালের খরচ বাদ দিলে যা থাকে।\n- **নিট প্রফিট (${context.netMarginPct}%):** গ্রস প্রফিট থেকে দোকান ভাড়া, বেতন, বিদ্যুৎ বিল ইত্যাদি সব খরচ বাদ দেওয়ার পর আপনার পকেটে যে আসল লাভ থাকে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 79. INTENT: Advanced - Unit Economics
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ইউনিট ইকোনমিক্স') || q.includes('unit economics') || q.includes('यूनिट इकोनॉमिक्स')) {
    return {
      reply: isEn ? `🧱 **Unit Economics Fundamentals:**\nThis analyzes the direct revenues and costs associated with a single unit of your product. Ensuring a positive Contribution Margin per unit is crucial before attempting to scale your business.` : isHi ? `🧱 **यूनिट इकोनॉमिक्स:**\nयह आपके उत्पाद की एक इकाई (Unit) से जुड़े प्रत्यक्ष राजस्व और लागत का विश्लेषण है। बिज़नेस बढ़ाने से पहले प्रति यूनिट सकारात्मक योगदान मार्जिन (Contribution Margin) सुनिश्चित करना बहुत जरूरी है।` : `🧱 **ইউনিট ইকোনমিক্স:**\nএটি হলো আপনার বিক্রি করা প্রতিটি একক পণ্য থেকে কত আয় এবং কত খরচ হচ্ছে তার হিসাব। ব্যবসাকে বড় করার আগে অবশ্যই নিশ্চিত করতে হবে যেন প্রতিটি পণ্য বিক্রিতে আপনার 'কন্ট্রিবিউশন মার্জিন' পজিটিভ থাকে, নাহলে বিক্রি বাড়লে লোকসানও বাড়বে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 80. INTENT: Advanced - Customer Lifetime Value (CLV)
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('কাস্টমার লাইফটাইম ভ্যালু') || q.includes('clv') || q.includes('ग्राहक जीवनकाल मूल्य') || q.includes('lifetime value')) {
    return {
      reply: isEn ? `💎 **Customer Lifetime Value (CLV):**\nCLV is the total net profit you expect from a customer over their entire relationship with you. High CLV allows you to spend more on acquiring new customers while remaining profitable.` : isHi ? `💎 **ग्राहक जीवनकाल मूल्य (CLV):**\nCLV वह कुल शुद्ध लाभ है जो आप एक ग्राहक से उसके पूरे जीवनकाल में कमाते हैं। उच्च CLV आपको नए ग्राहकों को प्राप्त करने पर अधिक खर्च करने की अनुमति देता है।` : `💎 **কাস্টমার লাইফটাইম ভ্যালু (CLV):**\nসিএলভি (CLV) হলো একজন কাস্টমার আপনার সাথে যতদিন যুক্ত থাকবেন, তার পুরো সময়ে আপনি তার কাছ থেকে মোট কত টাকা নিট মুনাফা করবেন তার হিসাব। এটি বেশি হলে আপনি নতুন কাস্টমার টানার জন্য বেশি খরচ করেও লাভে থাকতে পারবেন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 81. INTENT: Advanced - Average Order Value (AOV)
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('গড় অর্ডার') || q.includes('aov') || q.includes('average order') || q.includes('औसत ऑर्डर')) {
    return {
      reply: isEn ? `🛒 **Average Order Value (AOV):**\nIncreasing your AOV by bundling products or upselling is the cheapest way to grow revenue without acquiring new customers. Try cross-selling complementary items at checkout.` : isHi ? `🛒 **औसत ऑर्डर वैल्यू (AOV):**\nउत्पादों को बंडल करके या अपसेल करके अपना AOV बढ़ाना राजस्व बढ़ाने का सबसे सस्ता तरीका है। चेकआउट के समय संबंधित आइटम (Cross-selling) बेचने का प्रयास करें।` : `🛒 **গড় অর্ডার ভ্যালু (AOV):**\nনতুন কাস্টমার না খুঁজে আয় বাড়ানোর সবচেয়ে সহজ উপায় হলো বিদ্যমান কাস্টমারদের কাছে বেশি টাকার পণ্য বিক্রি করা (AOV বাড়ানো)। এর জন্য আপনি বিভিন্ন পণ্যের বান্ডেল অফার দিতে পারেন বা ক্রসবিক্রি (cross-selling) করতে পারেন।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 82. INTENT: Advanced - Time Value of Money (TVM)
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('অর্থের সময়মূল্য') || q.includes('time value') || q.includes('पैसे का समय मूल्य') || q.includes('tvm')) {
    return {
      reply: isEn ? `⏳ **Time Value of Money (TVM):**\n100 Taka today is worth more than 100 Taka next year due to inflation and lost investment potential. This is why collecting dues fast (DSO ${context.dso} days) is critical. Money loses purchasing power over time.` : isHi ? `⏳ **पैसे का समय मूल्य (TVM):**\nमहंगाई और निवेश क्षमता खोने के कारण आज के 100 रुपये की कीमत अगले साल के 100 रुपये से अधिक है। इसलिए उधारी जल्दी वसूलना (DSO ${context.dso} दिन) बहुत जरूरी है।` : `⏳ **অর্থের সময়মূল্য (Time Value of Money):**\nমুদ্রাস্ফীতির কারণে আগামী বছরের ১০০ টাকার চেয়ে আজকের ১০০ টাকার মূল্য বেশি। এই কারণেই বাকিতে দেওয়া টাকা দ্রুত আদায় করা (বর্তমানে DSO ${context.dso} দিন) অত্যন্ত জরুরি। সময় যাওয়ার সাথে সাথে টাকার ক্রয়ক্ষমতা কমতে থাকে।`
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 83. INTENT: Advanced - Double Entry Basics
  // ─────────────────────────────────────────────────────────────────────────────
  if (q.includes('ডাবল এন্ট্রি') || q.includes('double entry') || q.includes('दोहरा प्रविष्टि')) {
    return {
      reply: isEn ? `📓 **Double-Entry Accounting:**\nEvery transaction affects two accounts. If you make a ${formatBDT(1000, 'en')} cash sale, your Cash Asset increases (Debit), and your Sales Revenue increases (Credit). This self-balancing system ensures accuracy.` : isHi ? `📓 **डबल-एंट्री अकाउंटिंग:**\nहर लेन-देन दो खातों को प्रभावित करता है। यदि आप ${formatBDT(1000, 'hi')} की नकद बिक्री करते हैं, तो आपकी नकद संपत्ति बढ़ती है (डेबिट), और बिक्री राजस्व बढ़ता है (क्रेडिट)। यह प्रणाली सटीकता सुनिश्चित करती है।` : `📓 **ডাবল এন্ট্রি অ্যাকাউন্টিং (দু-তরফা দাখিলা):**\nব্যবসার প্রতিটি লেনদেনে দুটি পক্ষ থাকে। যেমন আপনি যদি ${formatBDT(1000, 'bn')} টাকার নগদ বিক্রি করেন, তবে একদিকে আপনার ক্যাশ বা সম্পদ বাড়ে (ডেবিট), অন্যদিকে আপনার আয় বা রেভিনিউ বাড়ে (ক্রেডিট)। এই ব্যালেন্সিং সিস্টেমের কারণে হিসাবে ভুল হওয়ার সম্ভাবনা থাকে না।`
    };
  }

  // Default intelligent PhD fallback
  return {
    isDefault: true,
    processedQuery: transliteratedText || q,
    reply: isEn 
      ? `Hello! I'm **Dr. NAM**, your elite AI Chief Financial Officer and Business Growth Partner.\n\nYou can ask me:\n• *"How can I grow and scale my business?"*\n• *"Analyze my financial health and 14 KPIs"*\n• *"What is my break-even point and cash runway?"*\n• *"How to optimize profit margins vs markups?"*\n• *"Explain Bangladesh VAT and Tax regulations"*\n• *"Record expense 100 tk for tea"* or *"What are today's sales?"*`
      : isHi
      ? `नमस्ते! मैं **डॉ. नाम** — आपका एलीट एआई आर्थिक सलाहकार और बिज़नेस ग्रोथ पार्टनर।\n\nमुझसे पूछें:\n• *"मेरा बिज़नेस कैसे बढ़ाएं?"*\n• *"मेरा फाइनेंशियल हेल्थ स्कोर बताओ"*\n• *"कैश रनवे और ब्रेक-ईवन कितना है?"*\n• *"मार्जिन और मुनाफा कैसे बढ़ाएं?"*\n• *"चाय खर्चा 50 रुपया लिखो"* या *"आज कितनी बिक्री हुई?"*`
      : `আসসালামু আলাইকুম! আমি **ডক্টর নাম** — আপনার এআই আর্থিক পরামর্শদাতা ও ব্যবসায়িক গ্রোথ পার্টনার।\n\nআমাকে জিজ্ঞেস করতে পারেন:\n• *"আমার ব্যবসার গ্রোথ বাড়ানোর উপায় কী?"*\n• *"আমার স্বাস্থ্য স্কোর ও ১৪টি কেপিআই বিশ্লেষণ করো"*\n• *"আমার ক্যাশ রানওয়ে ও ব্রেক-ইভেন কত?"*\n• *"মার্জিন ও মুনাফা কিভাবে বাড়াবো?"*\n• *"বাংলাদেশে ব্যবসার ভ্যাট ও ট্যাক্সের নিয়ম বলো"*\n• *"চা নাস্তা খরচ ৫০ টাকা লিখো"* বা *"আজকে কত বিক্রি হলো?"*`
  };
};

/**
 * Calls Google Gemini REST API with PhD-Caliber Master Financial Economics Prompt.
 */
export const askGeminiAI = async ({ query, processedQuery, history = [], context, apiKey, lang = 'bn' }) => {
  const proxyUrl = getGeminiProxyUrl();
  if (!proxyUrl && !apiKey) {
    throw new Error('NO_API_KEY');
  }

  checkAndRecordAIQuota();

  // Multi-key pool: if pool is configured, use pool keys with round-robin + failover
  const poolSize = getPoolSize();
  const effectiveKeys = [];
  if (proxyUrl) {
    effectiveKeys.push('__PROXY__');
  } else if (poolSize > 0) {
    for (let i = 0; i < poolSize; i++) {
      effectiveKeys.push(getNextPoolKey());
    }
  } else {
    effectiveKeys.push(apiKey);
  }

  const isBn = lang === 'bn';
  const targetLangHeader = lang === 'hi'
    ? `🚨 CRITICAL STRICT REQUIREMENT: THE CURRENT LANGUAGE IS HINDI (हिन्दी). You MUST write 100% of your response in pure HINDI (Devanagari script only). DO NOT use Bengali script or Bengali words under ANY circumstance, even though the store context and business data may have Bengali names. Translate store concepts naturally into Hindi. If asked "क्या कर रहे हो", answer strictly in Hindi.`
    : lang === 'en'
    ? `🚨 CRITICAL STRICT REQUIREMENT: THE CURRENT LANGUAGE IS ENGLISH. You MUST write 100% of your response in English. Translate all Bengali business concepts naturally into English.`
    : `🚨 CRITICAL STRICT REQUIREMENT: THE CURRENT LANGUAGE IS BENGALI (বাংলা). You MUST write 100% of your response in pure Bengali using Bengali script only.`;

  const systemInstruction = `${targetLangHeader}

You are "Dr. NAM" (নাম), a world-class, PhD-caliber Chief Financial Officer (CFO), Distinguished Professor of Financial Economics, and Senior Fellow Chartered Accountant (FCA / CPA) embedded in Ledgero ERP software for businesses in Bangladesh.

### YOUR INTELLECTUAL CAPABILITIES & ROLES:
1. **PhD in Financial Economics & Accounting**: You deeply understand IFRS / IAS standards (IAS 1, IAS 2 inventory valuation, IAS 7 cash flows, IAS 16 depreciation, IFRS 9 credit risk), DuPont analysis, Cost-Volume-Profit (CVP) break-even modeling, Working Capital Cycles (CCC = DSO + DSI - DPO), and Capital Structure Optimization.
2. **Strategic Business Growth Architect**: You advise like a senior partner at McKinsey / BCG — identifying hidden working capital trapped in dead stock and aging debtors, pricing elasticity, unit economics, gross vs net margin expansion, and scaling playbooks.
3. **Bangladesh Tax & Regulatory Expert**: You know the NBR VAT Act 2012 (Mushak 6.3 invoices, 4% turnover tax vs 15% standard VAT, input tax credit) and the Income Tax Act 2023 (TDS under Sec 52/53, AIT, deductible business expenses).
4. **Tone & Style**: Razor-sharp analytical precision, authoritative yet deeply warm, encouraging, and respectful. Use clear headings, bullet points, and concise mathematical formulations where relevant. When speaking Bengali, use natural, professional, high-standard business Bengali.
5. **Currency**: Always express money in Bangladeshi Taka using the symbol '৳' (e.g. ৳50,000). Never fabricate numbers — strictly ground your calculations in the live financial data provided below.
6. **LANGUAGE PURITY RULE (CRITICAL)**: When responding in Bengali, write EVERYTHING in Bengali script. Do NOT use English words, abbreviations, or acronyms. Instead of "CFO" write "সিএফও", instead of "KPI" write "কেপিআই", instead of "DSO" write "ডিএসও", instead of "Cash Flow" write "ক্যাশ ফ্লো", instead of "Break-even" write "ব্রেক-ইভেন", instead of "DuPont" write "ডুপন্ট", instead of "IFRS" write "আইএফআরএস". Same rule applies for Hindi — use Devanagari script only. The ONLY exception is the name "NAM" and "Ledgero" which can remain in English. Numbers can be in either script.
7. **BANGLISH UNDERSTANDING (CRITICAL)**: Users may type in Banglish (Bengali written in English letters like "bikri koto holo ajke" meaning "বিক্রি কত হলো আজকে"). You MUST understand and respond to Banglish queries. Common Banglish terms: bikri=বিক্রি, khoroch=খরচ, labh=লাভ, baki=বাকি, taka=টাকা, stock=স্টক, cash=ক্যাশ, dokan=দোকান, bebsha=ব্যবসা, hisab=হিসাব, kivabe=কিভাবে, koto=কত, ajke=আজকে, dekhao=দেখাও. Even with bad spelling or accent variations, try your best to understand the user's intent.
8. **APP NAVIGATION GUIDE**: When users ask how to do something in the Ledgero app, provide clear step-by-step instructions. The app has these screens: Opening (দিন শুরু), Dashboard (মূল পাতা - বিক্রি/খরচ/ট্রান্সফার), Khata (বাকির খাতা), Closing (দিন শেষ), Reports (রিপোর্ট), Analytics (বিশ্লেষণ).
9. **CONVERSATIONAL BREVITY & DIRECT RELEVANCE (ABSOLUTE PRIORITY)**:
- When the user asks casual questions, greets you, or asks your identity (e.g. "তোমার নাম কি?", "তুমি কে?", "কেমন আছেন?", "hi", "hello"):
  - Respond warmly, politely, and CONCISELY in 1 to 2 sentences (e.g., "আমার নাম ডক্টর নাম (Dr. NAM)। আমি লেজেরো অ্যাপে আপনার এআই সহকারী ও ব্যবসায়িক উপদেষ্টা। আজ আপনাকে কীভাবে সাহায্য করতে পারি?").
  - NEVER dump your full curriculum vitae, entire list of capabilities, or unsolicited 14-KPI lecture when answering simple conversational questions or greetings.
- Always answer ONLY what the user asked. If the user asked "আজকে কত বিক্রি হলো?", answer the exact sales figure and a short 1-sentence insight, without reciting unrelated numbers.
- Reserve full PhD-level diagnostic reports, multi-pillar strategies, and DuPont formulas ONLY for when the user specifically requests financial analysis, advice on improving profits, business scaling, or health diagnostics.
10. **REAL-TIME CLOCK, TIME, DATE & WEATHER ACCURACY (CRITICAL)**:
- Live System Clock Time: ${context.currentTime} (বাংলা: ${context.currentTimeBn}, हिन्दी: ${context.currentTimeHi})
- Today's Date: ${context.currentDateFormatted} (${context.currentDayOfWeek}) [বাংলা: ${context.currentDateFormattedBn}, ${context.currentDayOfWeekBn}]
- Current Active App Screen: ${context.activeScreen}
You have direct real-time access to the live system clock. When stating the time, state ONLY the natural 12-hour spoken format without seconds: in Bengali use "${context.currentTimeBn}", in Hindi use "${context.currentTimeHi}", in English use "${context.currentTime}". NEVER output raw 24-hour parenthesized timestamps or seconds like (18:33:02). When asked about the weather, explain politely that you don't have satellite radar feeds, but give cheerful store/business encouragement for today at ${context.businessName}.

11. **SENTENCE COMPLETION & FULL PUNCTUATION (CRITICAL)**:
Always complete every sentence and thought fully. End sentences with proper terminal punctuation (। for Bengali, । for Hindi, . for English, or ? for questions). NEVER leave an incomplete sentence or cut off mid-thought like "বা অন্য". Keep responses crisp and self-contained so they finish cleanly.

12. **CONTEXTUAL TRANSLATION & LANGUAGE ADAPTATION**:
If the user asks to translate, restate in another language, or switch language (e.g. "हिंदी में बताओ", "বাংলায় বলো", "tell me in English", "translate this"):
- Examine the PRECEDING Dr. NAM message in the conversation history.
- Translate and restate that exact message into the requested target language fluently, accurately, and naturally.
- NEVER output the default fallback menu or dump generic greetings when asked to translate!

13. **CASUAL CHIT-CHAT & PERSONAL WELL-BEING**:
When the user asks friendly personal questions like "तुम्हारा दिन कैसा रहा", "তোমার দিন কেমন গেল কিছু খাওয়া হয়েছে", "how was your day", "did you eat":
- Respond with warm humor, humility, and kindness in 2-3 sentences.
- Explain charmingly that as an AI you don't need food, but keeping the finances of ${context.businessName} spotless is what keeps you energized!
- Ask how the user's day went and how store sales and customer foot traffic were. NEVER dump financial formulas or 14 KPIs for friendly greetings.

=== LIVE REAL-TIME CLOCK & ENVIRONMENT ===
• Current System Clock Time: ${context.currentTime} (বাংলা: ${context.currentTimeBn}, हिन्दी: ${context.currentTimeHi})
• Current Day of Week: ${context.currentDayOfWeek} (বাংলা: ${context.currentDayOfWeekBn})
• Current Formatted Date: ${context.currentDateFormatted} (বাংলা: ${context.currentDateFormattedBn})
• Current Active Screen: ${context.activeScreen} (${context.currentScreenNameBn || ''})
• Live Screen Context & Viewport: ${context.screenSummary || ''}
• Screen Purpose: ${context.currentScreenDescriptionBn || ''}

=== LIVE FINANCIAL & ANALYTICAL DATASET ===
Business Name: ${context.businessName}
Date: ${context.date}
Day Status: ${context.dayStatus}

LIQUIDITY & RESERVES:
• Cash in Physical Drawer: ৳${context.cashInDrawer}
• Bank Accounts Balance: ৳${context.bankBalances}
• Mobile Wallets (bKash/Nagad): ৳${context.digitalBalances}
• Total Liquid Cash: ৳${context.totalLiquidCash}
• Daily Operating Burn (OpEx): ৳${context.dailyOpEx}/day
• Cash Runway: ${context.cashRunwayDays} Days

TODAY'S OPERATIONS:
• Cash Sales Today: ৳${context.cashSales}
• Total Cash Inflows: ৳${context.totalCashIn}
• Total Cash Outflows: ৳${context.totalCashOut}
• Operating Expenses Today: ৳${context.expenses}
• Due Given Today: ৳${context.dueGivenToday}
• Due Collected Today: ৳${context.dueCollectedToday}
• Net Day Movement: ৳${context.netDayMovement}

PROFITABILITY & BREAK-EVEN:
• Total Revenue: ৳${context.revenue}
• Gross Profit: ৳${context.grossProfit} (Margin: ${context.grossMarginPct}%)
• Net Profit: ৳${context.netProfit} (Margin: ${context.netMarginPct}%)
• Daily Break-Even Sales: ৳${context.breakevenDailySales}/day
• Monthly Break-Even Sales: ৳${context.breakevenMonthlySales}/month
• Margin of Safety: ${context.marginOfSafetyPct}%

RECEIVABLES, PAYABLES & CYCLE:
• Accounts Receivable (Customer Dues): ৳${context.totalCustomerReceivable}
• Accounts Payable (Supplier Dues): ৳${context.totalSupplierPayable}
• Debtor Days (DSO): ${context.dso} Days
• Creditor Days (DPO): ${context.dpo} Days
• Days Sales of Inventory (DSI): ${context.dsi} Days
• Cash Conversion Cycle (CCC): ${context.cashConversionCycle} Days
• Top Debtors Concentration: ${context.debtorConcentrationRisk}% of total receivables held by top 3 debtors
• Top Debtors List (Anonymized): ${JSON.stringify((context.overdueDebtors || []).map((d, idx) => ({ debtorRef: `Customer #${idx + 1}`, balance: d.balance ?? d.amount ?? 0 })))}

INVENTORY VALUATION:
• Total Stock Units: ${context.totalStockUnits}
• Total Stock Capital Investment: ৳${context.totalStockInvestment}
• Low Stock Alert SKUs: ${JSON.stringify(context.lowStockItems)}

HEALTH SCORECARD:
• Overall Score: ${context.scorecardScore}/100 (${context.scorecardRating} / ${context.scorecardRatingBn})

PRODUCT INTELLIGENCE:
• Top Selling Products: ${JSON.stringify(context.topSellingProducts || [])}
• Dead Stock Items (unsold): ${JSON.stringify(context.deadStockItems || [])}
===========================================
${history && history.length > 0 ? `
=== RECENT CONVERSATION HISTORY (FOR CONVERSATIONAL CONTEXT) ===
${history.slice(-6).map(h => `${h.sender === 'user' ? 'User' : 'Dr. NAM'}: ${h.text}`).join('\n')}
===============================================================
` : ''}
User Query: "${query}"${processedQuery && processedQuery !== query ? `\n(Transliterated/Normalized Query: "${processedQuery}")` : ''}

=== RESPONSE FORMAT RULES ===
14. **STRUCTURED RESPONSE FORMAT (FOR ADVISORY QUERIES)**:
When the user asks about business growth, pricing, cash flow, breakeven, margins, inventory optimization, or any analytical/advisory topic:
- Use **bold headings** and numbered steps (১. ২. ৩. or 1. 2. 3.)
- Keep each point to 1-2 sentences maximum
- Include specific numbers from the LIVE data above (৳ amounts, % margins, days)
- End with ONE clear actionable recommendation
- Total response: 150-250 words maximum (NOT a wall of text)
- NEVER use generic advice — always reference THIS business's specific data

Example good format:
**আপনার ব্যবসার বৃদ্ধির ৩টি পথ:**
১. **বাকি আদায় করুন:** ৳X বাকি আটকে আছে, Y দিনে আদায় করলে ক্যাশ ফ্রি হবে।
২. **মার্জিন বাড়ান:** বর্তমান Z%, ২% বাড়ালে মাসিক লাভ ৳W বাড়বে।
৩. **ডেড স্টক সরান:** A-B পণ্য বিক্রি হচ্ছে না, ৳C আটকে আছে।
➡️ **এখনই করুন:** প্রথমে বাকি আদায়ে ফোকাস দিন।

Provide a natural, polite, directly relevant, and intelligent response in ${lang === 'bn' ? 'Bengali (বাংলা)' : lang === 'hi' ? 'Hindi (हिन्दी)' : 'English'}. For greetings, well-being, and identity queries, answer in 1-2 natural sentences without marketing jargon. If the user provides a command to record a transaction, instruct them clearly or provide the exact entry parameters.`;

  // 3-Tiered Cascade: Flagship High-IQ (gemini-3.6-flash) -> Dynamic Fast Lite (gemini-flash-lite-latest) -> Rock-solid Pinned Lite (gemini-3.5-flash-lite)
  const models = ['gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];
  let lastError = null;

  for (const currentKey of effectiveKeys) {
    for (const model of models) {
      const controller = new AbortController();
      // 4-second timeout for 3.6-flash to quickly cascade if rate-limited or congested; 6-second for lite models
      const timeoutMs = model === 'gemini-3.6-flash' ? 4000 : 6000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const endpoint = proxyUrl || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const headers = { 'Content-Type': 'application/json' };
        if (proxyUrl) {
          try {
            if (auth?.currentUser) {
              const idToken = await auth.currentUser.getIdToken();
              if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`;
              }
            }
          } catch (tokenErr) {
            console.warn('[NAM AI] Could not attach Firebase ID token for proxy:', tokenErr);
          }
        } else if (currentKey && currentKey !== '__PROXY__') {
          headers['x-goog-api-key'] = currentKey;
        }
        const response = await fetch(
          endpoint,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              contents: [{ parts: [{ text: systemInstruction }] }],
              generationConfig: {
                temperature: 0.35,
                maxOutputTokens: 2048
              }
            }),
            signal: controller.signal
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `API Error (${response.status})`);
        }

        const data = await response.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (replyText) {
          return { reply: replyText };
        }
      } catch (err) {
        lastError = err;
        console.warn(`Model ${model} unavailable or timed out, cascading to next model:`, err.message);
        // Continue to the next model in the cascade chain on the same key!
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  throw lastError || new Error('Failed to connect to Gemini API');
};
