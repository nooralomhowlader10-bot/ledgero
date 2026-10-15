// voiceEntityExtractor.js — Smart Entity Extraction Engine for Dr. NAM AI
// Extracts structured data from natural Bengali/Hindi/English voice input

// ===========================
// 1. FUZZY STRING MATCHING
// ===========================

/**
 * Levenshtein distance between two strings (case-insensitive)
 */
export function levenshteinDistance(a, b) {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  const m = al.length, n = bl.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = al[i - 1] === bl[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Fuzzy match a word against a list of candidates
 * Returns best match if distance <= threshold, else null
 */
export function fuzzyMatch(word, candidates, threshold = 2) {
  if (!word || word.length < 2 || !candidates?.length) return null;
  let best = null, bestDist = threshold + 1;
  for (const candidate of candidates) {
    if (Math.abs(word.length - candidate.length) > threshold) continue;
    const dist = levenshteinDistance(word, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return bestDist <= threshold ? { match: best, distance: bestDist } : null;
}

// ===========================
// 2. BENGALI NUMBER PARSING
// ===========================

const BENGALI_DIGIT_MAP = { '০': 0, '১': 1, '২': 2, '৩': 3, '৪': 4, '৫': 5, '৬': 6, '৭': 7, '৮': 8, '৯': 9 };
const HINDI_DIGIT_MAP = { '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9 };

const WORD_TO_NUM = {
  'এক': 1, 'দুই': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7, 'আট': 8, 'নয়': 9, 'দশ': 10,
  'এগারো': 11, 'বারো': 12, 'তেরো': 13, 'চৌদ্দ': 14, 'পনেরো': 15, 'ষোলো': 16, 'সতেরো': 17, 'আঠারো': 18, 'উনিশ': 19, 'বিশ': 20,
  'পঁচিশ': 25, 'ত্রিশ': 30, 'পঁয়ত্রিশ': 35, 'চল্লিশ': 40, 'পঞ্চাশ': 50, 'ষাট': 60, 'সত্তর': 70, 'আশি': 80, 'নব্বই': 90,
  'একশ': 100, 'একশো': 100, 'দুইশ': 200, 'দুইশো': 200, 'তিনশ': 300, 'তিনশো': 300, 'চারশ': 400, 'চারশো': 400,
  'পাঁচশ': 500, 'পাঁচশো': 500, 'ছয়শ': 600, 'ছয়শো': 600, 'সাতশ': 700, 'সাতশো': 700, 'আটশ': 800, 'আটশো': 800, 'নয়শ': 900, 'নয়শো': 900,
  'হাজার': 1000, 'লক্ষ': 100000, 'লাখ': 100000,
  'সাড়ে': 0.5, 'দেড়': 1.5, 'আড়াই': 2.5,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  'बीस': 20, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90,
  'सौ': 100, 'हज़ार': 1000, 'हजार': 1000, 'लाख': 100000,
  'डेढ़': 1.5, 'ढाई': 2.5, 'साढ़े': 0.5,
  'ek': 1, 'dui': 2, 'tin': 3, 'char': 4, 'pach': 5, 'chhoy': 6, 'shat': 7, 'aat': 8, 'noy': 9, 'dosh': 10,
  'bish': 20, 'trish': 30, 'chollish': 40, 'poncash': 50, 'shottor': 70, 'ashi': 80, 'nobboi': 90,
  'eksho': 100, 'duisho': 200, 'tinsho': 300, 'charsho': 400, 'pachsho': 500,
  'hajar': 1000, 'hazar': 1000, 'lakh': 100000,
  'share': 0.5, 'sare': 0.5, 'der': 1.5, 'arai': 2.5,
};

export function normalizeDigits(text) {
  return text.replace(/[০-৯]/g, d => BENGALI_DIGIT_MAP[d])
    .replace(/[०-९]/g, d => HINDI_DIGIT_MAP[d]);
}

export function extractAmounts(text) {
  const amounts = [];
  const normalized = normalizeDigits(text);

  const qtyUnitsPattern = /^\s*(?:কেজি|কে\.জি|কেজি\.|লিটার|পিস|টা|টি|ডজন|গ্রাম|কেজিতে|বস্তা|প্যাকেট|কার্টুন|পাতা|কেজির|kg|kilo|litre|liter|piece|pcs|gm|gram|packet|dozen|sack|carton)(?:\s|$|[।,!?.\-])/i;

  const digitPattern = /(\d+(?:\.\d+)?)\s*(টাকা|তাকা|tk|taka|৳|rupee|रुपय|रुपये|টাকায়)?/gi;
  let match;
  while ((match = digitPattern.exec(normalized)) !== null) {
    const val = parseFloat(match[1]);
    const currencySuffix = match[2];
    const afterMatch = normalized.slice(match.index + match[0].length);

    if (!currencySuffix && qtyUnitsPattern.test(afterMatch)) {
      continue;
    }

    if (val > 0 && val < 10000000) {
      amounts.push({ 
        value: val, 
        original: match[0], 
        startIdx: match.index,
        hasExplicitCurrency: Boolean(currencySuffix)
      });
    }
  }

  const words = text.split(/\s+/);
  let pendingMultiplier = null;

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[,।.]/g, '');
    const numVal = WORD_TO_NUM[w];
    if (numVal === undefined) { pendingMultiplier = null; continue; }

    // If next word is a quantity unit (e.g. 'দুই কেজি'), this word-number is a quantity, NOT money!
    if (i + 1 < words.length) {
      const nextWord = words[i + 1].toLowerCase();
      if (qtyUnitsPattern.test(' ' + nextWord)) {
        pendingMultiplier = null;
        continue;
      }
    }

    if (numVal < 1 || numVal === 1.5 || numVal === 2.5) {
      pendingMultiplier = numVal;
      continue;
    }

    let finalVal = numVal;
    if (i + 1 < words.length) {
      const nextW = words[i + 1].replace(/[,।.]/g, '');
      const nextVal = WORD_TO_NUM[nextW];
      if (nextVal && (nextVal === 1000 || nextVal === 100000)) {
        finalVal = numVal * nextVal;
        i++;
      }
    }

    if (pendingMultiplier !== null) {
      if (pendingMultiplier === 0.5) {
        const unit = finalVal >= 1000 ? 1000 : finalVal >= 100 ? 100 : 1;
        finalVal = finalVal + unit / 2;
      } else {
        finalVal = pendingMultiplier * finalVal;
      }
      pendingMultiplier = null;
    }

    if (!amounts.some(a => Math.abs(a.value - finalVal) < 1)) {
      amounts.push({ value: finalVal, original: w, startIdx: text.indexOf(w) });
    }
  }

  return amounts;
}

export function extractPrimaryAmount(text) {
  const amounts = extractAmounts(text);
  if (amounts.length === 0) return null;
  if (amounts.length === 1) return amounts[0].value;

  const takaIdx = Math.max(
    text.indexOf('টাকা'), text.indexOf('তাকা'), text.indexOf('tk'),
    text.indexOf('taka'), text.indexOf('৳'), text.indexOf('টাকায়')
  );
  if (takaIdx >= 0) {
    let closest = amounts[0];
    let minDist = Math.abs(amounts[0].startIdx - takaIdx);
    for (const a of amounts) {
      const dist = Math.abs(a.startIdx + a.original.length - takaIdx);
      if (dist < minDist) { minDist = dist; closest = a; }
    }
    return closest.value;
  }
  return Math.max(...amounts.map(a => a.value));
}

// ===========================
// 3. QUANTITY + UNIT EXTRACTION
// ===========================

const UNIT_ALIASES = {
  'কেজি': 'kg', 'কেজিতে': 'kg', 'কেজির': 'kg',
  'লিটার': 'liter', 'লিটারে': 'liter',
  'পিস': 'piece', 'পিসে': 'piece', 'পিসের': 'piece', 'টা': 'piece', 'টি': 'piece', 'খানা': 'piece', 'গো': 'piece',
  'ডজন': 'dozen', 'ডজনে': 'dozen',
  'বস্তা': 'sack', 'বস্তায়': 'sack',
  'প্যাকেট': 'packet', 'প্যাকেটে': 'packet',
  'কার্টুন': 'carton', 'কার্টুনে': 'carton',
  'গজ': 'yard', 'মিটার': 'meter', 'ফুট': 'feet', 'ইঞ্চি': 'inch', 'সেট': 'set',
  'kg': 'kg', 'kilo': 'kg', 'kegi': 'kg',
  'liter': 'liter', 'litre': 'liter',
  'piece': 'piece', 'pcs': 'piece', 'pis': 'piece', 'ta': 'piece', 'ti': 'piece',
  'dozen': 'dozen', 'dojon': 'dozen',
  'bosta': 'sack', 'packet': 'packet', 'pack': 'packet', 'carton': 'carton', 'set': 'set',
  'किलो': 'kg', 'लीटर': 'liter', 'पीस': 'piece',
};

export function extractQuantity(text) {
  const normalized = normalizeDigits(text);
  const unitNames = Object.keys(UNIT_ALIASES).join('|');
  const digitUnitPattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${unitNames})`, 'gi');
  let match = digitUnitPattern.exec(normalized);
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: UNIT_ALIASES[match[2].toLowerCase()] || match[2],
      original: match[0]
    };
  }

  const words = text.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const numVal = WORD_TO_NUM[words[i]];
    const unitVal = UNIT_ALIASES[words[i + 1].toLowerCase?.() || words[i + 1]];
    if (numVal && numVal >= 1 && unitVal) {
      return { quantity: numVal, unit: unitVal, original: `${words[i]} ${words[i + 1]}` };
    }
  }
  return null;
}

// ===========================
// 4. PRODUCT RESOLUTION
// ===========================

export function resolveProduct(text, inventory) {
  if (!inventory?.length) return null;
  const q = text.toLowerCase();

  for (const item of inventory) {
    const name = item.name?.toLowerCase();
    const nameBn = item.name_bn?.toLowerCase();
    if (name && q.includes(name)) return { ...item, matchType: 'exact' };
    if (nameBn && q.includes(nameBn)) return { ...item, matchType: 'exact' };
  }

  const queryWords = q.split(/\s+/).filter(w => w.length >= 2);
  let bestMatch = null, bestDist = Infinity;

  for (const item of inventory) {
    const itemName = item.name?.toLowerCase();
    if (!itemName || itemName.length < 2) continue;

    for (const word of queryWords) {
      if (/^(টাকা|taka|tk|কেজি|kg|পিস|লিটার|বিক্রি|কিনলাম|খরচ|বাকি|দিলাম|দিল|নিলাম|হলো|\d+)$/i.test(word)) continue;

      const dist = levenshteinDistance(word, itemName);
      const threshold = itemName.length <= 3 ? 1 : 2;
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        bestMatch = { ...item, matchType: 'fuzzy', distance: dist };
      }
    }
  }
  return bestMatch;
}

// ===========================
// 5. CONTACT RESOLUTION
// ===========================

const BN_SUFFIXES = /(?:কে|র|ের|এর|দের|গো|রা|দেরকে|কেও|তে|য়|ো)$/;

// Non-name stopwords that might appear before 'কে', 'রে', 'को' or end with them
const CONTACT_STOPWORDS = new Set([
  'কাকে', 'কাউকে', 'থেকে', 'থাকে', 'সবাইকে', 'প্রত্যেককে', 'আজকে', 'কালকে', 'সকালে',
  'বিকালে', 'সন্ধ্যায়', 'আগে', 'পরে', 'বিকাশে', 'নগদে', 'রকেটে', 'ব্যাংকে', 'ক্যাশে',
  'দোকানে', 'খাতায়', 'হাতে', 'ড্রয়ারে', 'টাকায়', 'কেজিতে', 'লিটারে', 'প্যাকেটে',
  'বাকি', 'বাকিতে', 'ধারে', 'কর্জ', 'দেনা', 'নগদ', 'টাকা', 'পয়সা', 'ক্যাশ',
  'আমি', 'তুমি', 'আমরা', 'তারা', 'মুদির', 'দোকান', 'কাউন্টার', 'কাস্টমার', 'সাপ্লায়ার',
  'পণ্য', 'মাল', 'আইটেম', 'চিনি', 'চাল', 'ডাল', 'তেল', 'লবণ', 'পেঁয়াজ', 'আলু',
  'ভাড়া', 'ভাড়া', 'বিল', 'বিদ্যুৎ', 'কারেন্ট', 'ট্যাক্স',
  'দিলাম', 'দেওয়া', 'দেওয়া', 'নিলাম', 'পেলুম', 'পেলাম', 'পাইছি', 'দিছি', 'দিল', 'দিলো',
  'তাকে', 'আমাকে', 'তোমাকে', 'আপনাকে', 'ওকে', 'একে', 'যাকে', 'আজ', 'কাল', 'পরশু',
  'kg', 'kilo', 'liter', 'packet', 'piece', 'tk', 'taka', 'cash', 'bank', 'bkash', 'nagad',
  'মুঝকো', 'हमको', 'तुमको', 'उसको', 'सबको', 'दुकान', 'खाता', 'नकद', 'उधार', 'बाकी',
  'मुझको', 'आपको', 'इसको', 'उसको', 'किसको'
]);

export function extractVoiceContactName(text, contacts = []) {
  if (contacts && contacts.length > 0) {
    const q = text.toLowerCase();
    for (const c of contacts) {
      if (c.name && q.includes(c.name.toLowerCase())) {
        return c.name;
      }
    }
  }

  const clean = text.replace(/[,।!?]/g, ' ').trim();
  const words = clean.split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (CONTACT_STOPWORDS.has(w.toLowerCase())) {
      // Check if it's "থেকে" / "হতে" e.g. "রহিম থেকে"
      if ((w === 'থেকে' || w === 'হতে' || w === 'সে') && i > 0) {
        const prev = words[i - 1];
        if (prev.length >= 2 && !CONTACT_STOPWORDS.has(prev.toLowerCase()) && !/^\d+/.test(prev)) {
          return prev;
        }
      }
      continue;
    }

    // Check if word ends with কে or রে (e.g. "রহিমকে", "করিমরে", "জুবায়েরকে")
    if (w.endsWith('কে') || w.endsWith('রে')) {
      let stem = w.slice(0, -2);
      // Handle "ভাইকে" -> look at previous word if any e.g. "রহিম ভাইকে"
      if (stem === 'ভাই' || stem === 'দা' || stem === 'চাচা' || stem === 'কাকু') {
        if (i > 0 && !CONTACT_STOPWORDS.has(words[i - 1].toLowerCase()) && !/^\d+/.test(words[i - 1])) {
          return `${words[i - 1]} ${stem}`;
        }
      }
      if (stem.length >= 2 && !CONTACT_STOPWORDS.has(stem.toLowerCase()) && !/^\d+/.test(stem)) {
        return stem;
      }
    }

    // Check standalone 'কে' / 'রে' (e.g. "রহিম কে")
    if ((w === 'কে' || w === 'রে') && i > 0) {
      const prev = words[i - 1];
      if (prev.length >= 2 && !CONTACT_STOPWORDS.has(prev.toLowerCase()) && !/^\d+/.test(prev)) {
        return prev;
      }
    }

    // Check Hindi "को" e.g. "रहीम को"
    if (w === 'को' && i > 0) {
      const prev = words[i - 1];
      if (prev.length >= 2 && !CONTACT_STOPWORDS.has(prev.toLowerCase()) && !/^\d+/.test(prev)) {
        return prev;
      }
    }
  }

  // Pattern: "ধার দেওয়া <Name>" / "বাকি দেওয়া <Name>" / "ধার দেওয়া <Name>"
  const dewaMatch = clean.match(/(?:ধার|বাকি|ধারে|বাকিতে|কর্জ)\s+(?:দেওয়া|দেয়া|দেওয়া|দিলাম|দিছি|দিয়েছি|দিয়েছি)\s+([\u0980-\u09FFA-Za-z]+)/i);
  if (dewaMatch) {
    const candidate = dewaMatch[1].replace(/(?:কে|রে)$/, '').trim();
    if (!CONTACT_STOPWORDS.has(candidate.toLowerCase()) && candidate.length >= 2 && !/^\d+/.test(candidate)) {
      return candidate;
    }
  }

  // Pattern: English "to <Name>", "from <Name>", "due to <Name>"
  const enMatch = clean.match(/(?:to|from|for)\s+([A-Za-z]+)/i);
  if (enMatch) {
    const candidate = enMatch[1].trim();
    if (!['me', 'us', 'him', 'her', 'them', 'due', 'cash', 'credit', 'shop'].includes(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return null;
}

export function resolveContact(text, contacts) {
  if (!contacts?.length) return null;
  const q = text.toLowerCase();

  for (const contact of contacts) {
    const name = contact.name?.toLowerCase();
    if (name && q.includes(name)) return { ...contact, matchType: 'exact' };
  }

  const words = text.split(/\s+/);
  for (const word of words) {
    const stripped = word.replace(BN_SUFFIXES, '');
    if (stripped.length < 2) continue;
    for (const contact of contacts) {
      const name = contact.name?.toLowerCase();
      if (!name) continue;
      if (stripped.toLowerCase() === name) return { ...contact, matchType: 'suffix_strip' };
    }
  }

  let bestMatch = null, bestDist = Infinity;
  for (const contact of contacts) {
    const name = contact.name?.toLowerCase();
    if (!name || name.length < 2) continue;
    for (const word of words) {
      const stripped = word.replace(BN_SUFFIXES, '').toLowerCase();
      if (stripped.length < 2) continue;
      if (/^(টাকা|taka|tk|বাকি|দিলাম|দিল|নিলাম|জমা|খরচ|বিক্রি|কিনলাম|\d+)$/i.test(stripped)) continue;

      const dist = levenshteinDistance(stripped, name);
      const threshold = name.length <= 3 ? 1 : 2;
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        bestMatch = { ...contact, matchType: 'fuzzy', distance: dist };
      }
    }
  }
  return bestMatch;
}

// ===========================
// 6. WALLET RESOLUTION
// ===========================

const WALLET_ALIASES = {
  'বিকাশ': 'bkash_agent', 'বিকাশে': 'bkash_agent', 'বিকাশের': 'bkash_agent',
  'নগদ': 'nagad_uddokta', 'নগদে': 'nagad_uddokta', 'নগদের': 'nagad_uddokta',
  'রকেট': 'rocket', 'রকেটে': 'rocket',
  'ব্যাংক': 'bank_account', 'ব্যাংকে': 'bank_account', 'ব্যাংকের': 'bank_account',
  'ক্যাশ': 'hand_cash', 'হাতে': 'hand_cash', 'ড্রয়ার': 'hand_cash',
  'bkash': 'bkash_agent', 'bikash': 'bkash_agent',
  'nagad': 'nagad_uddokta', 'rocket': 'rocket',
  'bank': 'bank_account', 'cash': 'hand_cash', 'drawer': 'hand_cash',
};

export function resolveWallet(text, availableWallets) {
  const q = text.toLowerCase();
  if (q.includes('নগদ টাকা') || q.includes('হাতে নগদ')) return 'hand_cash';
  if (q.includes('বিকাশ থেকে') || q.includes('বিকাশে')) return 'bkash_agent';

  for (const [alias, walletKey] of Object.entries(WALLET_ALIASES)) {
    if (q.includes(alias)) {
      if (availableWallets && !availableWallets[walletKey]) continue;
      return walletKey;
    }
  }
  return 'hand_cash';
}

export function resolveTransferWallets(text, availableWallets) {
  const q = text.toLowerCase();
  const fromToPattern = /(বিকাশ|নগদ|রকেট|ব্যাংক|ক্যাশ|bkash|nagad|rocket|bank|cash)\s*(?:থেকে|from|se|হতে)\s*(বিকাশ|নগদ|রকেট|ব্যাংক|ক্যাশ|bkash|nagad|rocket|bank|cash)\s*(?:তে|এ|to|me)?/i;
  const match = fromToPattern.exec(q);
  if (match) {
    const fromKey = WALLET_ALIASES[match[1].toLowerCase()] || 'hand_cash';
    const toKey = WALLET_ALIASES[match[2].toLowerCase()] || 'hand_cash';
    return { from: fromKey, to: toKey };
  }
  return null;
}

// ===========================
// 7. EXPENSE CATEGORY RESOLUTION
// ===========================

const CATEGORY_ALIASES = {
  'ভাড়া': 'rent', 'rent': 'rent', 'দোকান ভাড়া': 'rent',
  'বিদ্যুৎ': 'electricity', 'electric': 'electricity', 'কারেন্ট': 'electricity',
  'বেতন': 'salary', 'salary': 'salary', 'মাইনে': 'salary',
  'পরিবহন': 'transport', 'ভ্যান': 'transport', 'গাড়ি': 'transport', 'transport': 'transport', 'রিকশা': 'transport',
  'মেরামত': 'repair', 'repair': 'repair',
  'খাবার': 'food', 'চা': 'food', 'নাস্তা': 'food', 'food': 'food', 'মিষ্টি': 'food', 'বিস্কুট': 'food',
  'মোবাইল': 'mobile', 'ফোন': 'mobile', 'mobile': 'mobile',
  'ইন্টারনেট': 'internet', 'internet': 'internet', 'wifi': 'internet',
  'বিজ্ঞাপন': 'marketing', 'মার্কেটিং': 'marketing', 'marketing': 'marketing',
  'ট্যাক্স': 'tax', 'ভ্যাট': 'tax', 'tax': 'tax',
  'সাপ্লাই': 'supplies', 'supply': 'supplies', 'কাগজ': 'supplies',
};

export function resolveExpenseCategory(text) {
  const q = text.toLowerCase();
  for (const [alias, cat] of Object.entries(CATEGORY_ALIASES)) {
    if (q.includes(alias)) return cat;
  }
  return 'other';
}

// ===========================
// 8. INTENT CLASSIFICATION
// ===========================

const INTENT_PATTERNS = {
  undo: { keywords: ['কাটো', 'মুছো', 'undo', 'বাতিল', 'ফেরত', 'delete last', 'রিভার্স', 'ভুল হয়েছে', 'ভুল'] },
  redo: { keywords: ['আবার বলো', 'আবার বল', 'রিসেট', 'reset', 'আবার', 'again', 'redo', 'আবার রেকর্ড'] },
  day_open: { keywords: ['দোকান খোলো', 'দোকান চালু', 'ওপেন', 'start day', 'শুরু করো'] },
  day_close: { keywords: ['দোকান বন্ধ', 'দিন শেষ', 'ক্লোজ', 'end day', 'বন্ধ করো', 'ফাইনালাইজ'] },
  product_add: { keywords: ['প্রোডাক্ট যোগ', 'পণ্য যোগ', 'নতুন পণ্য', 'নতুন প্রোডাক্ট', 'আইটেম যোগ', 'product add', 'add product', 'নতুন আইটেম', 'পণ্য এড'] },
  contact_add: { keywords: ['নতুন কাস্টমার', 'কাস্টমার যোগ', 'নতুন পার্টি', 'add customer', 'new customer', 'নতুন সাপ্লায়ার', 'add supplier', 'খাতায় যোগ'] },
  damage: { keywords: ['নষ্ট', 'ড্যামেজ', 'damage', 'expired', 'মেয়াদ', 'পচে গেছে', 'ভেঙে গেছে', 'নষ্ট হয়ে গেছে', 'চুরি'] },
  salary_pay: { keywords: ['বেতন', 'স্যালারি', 'মাইনে', 'salary'] },
  service_income: { keywords: ['ফটোকপি', 'photocopy', 'স্টুডিও', 'studio', 'সার্ভিস'] },
  recharge: { keywords: ['রিচার্জ', 'recharge', 'flexiload', 'ফ্লেক্সি', 'ফ্লেক্সিলোড'] },
  transfer: { keywords: ['ট্রান্সফার', 'transfer', 'পাঠাও', 'সরাও'] },
  check_price: { keywords: ['দাম কত', 'price', 'কত করে', 'রেট কত', 'প্রাইস'] },
  check_stock: { keywords: ['কত আছে', 'স্টক', 'stock', 'কয়টা আছে', 'মজুদ'] },
  check_due: { keywords: ['কত বাকি', 'বাকি কত', 'due', 'পাওনা কত', 'কত ধার'] },
  check_balance: { keywords: ['ব্যালেন্স', 'balance', 'কত আছে', 'কত টাকা', 'ক্যাশ কত', 'ড্রয়ারে কত'] },
};

export function classifyIntent(text, entities = {}) {
  const q = text.toLowerCase();

  // Correction intents (highest priority)
  for (const kw of INTENT_PATTERNS.undo.keywords) {
    if (q.includes(kw)) return { intent: 'undo', confidence: 'high', matchedKeyword: kw };
  }
  for (const kw of INTENT_PATTERNS.redo.keywords) {
    if (q.includes(kw)) return { intent: 'redo', confidence: 'high', matchedKeyword: kw };
  }

  // Day management
  for (const kw of INTENT_PATTERNS.day_open.keywords) {
    if (q.includes(kw)) return { intent: 'day_open', confidence: 'high', matchedKeyword: kw };
  }
  for (const kw of INTENT_PATTERNS.day_close.keywords) {
    if (q.includes(kw)) return { intent: 'day_close', confidence: 'high', matchedKeyword: kw };
  }

  // Product add
  for (const kw of INTENT_PATTERNS.product_add.keywords) {
    if (q.includes(kw)) return { intent: 'product_add', confidence: 'high', matchedKeyword: kw };
  }

  // Contact add
  for (const kw of INTENT_PATTERNS.contact_add.keywords) {
    if (q.includes(kw)) return { intent: 'contact_add', confidence: 'high', matchedKeyword: kw };
  }

  // Damage
  for (const kw of INTENT_PATTERNS.damage.keywords) {
    if (q.includes(kw)) return { intent: 'damage', confidence: 'high', matchedKeyword: kw };
  }

  // Salary (needs amount)
  for (const kw of INTENT_PATTERNS.salary_pay.keywords) {
    if (q.includes(kw) && entities.amount) return { intent: 'salary_pay', confidence: 'high', matchedKeyword: kw };
  }

  // Service income
  for (const kw of INTENT_PATTERNS.service_income.keywords) {
    if (q.includes(kw)) return { intent: 'service_income', confidence: 'high', matchedKeyword: kw };
  }

  // Recharge
  for (const kw of INTENT_PATTERNS.recharge.keywords) {
    if (q.includes(kw)) return { intent: 'recharge', confidence: 'high', matchedKeyword: kw };
  }

  // Transfer
  for (const kw of INTENT_PATTERNS.transfer.keywords) {
    if (q.includes(kw)) return { intent: 'transfer', confidence: 'high', matchedKeyword: kw };
  }

  // Query intents
  for (const kw of INTENT_PATTERNS.check_price.keywords) {
    if (q.includes(kw)) return { intent: 'check_price', confidence: 'high', matchedKeyword: kw };
  }
  for (const kw of INTENT_PATTERNS.check_stock.keywords) {
    if (q.includes(kw) && entities.product) return { intent: 'check_stock', confidence: 'high', matchedKeyword: kw };
  }
  for (const kw of INTENT_PATTERNS.check_due.keywords) {
    if (q.includes(kw) && entities.contact) return { intent: 'check_due', confidence: 'high', matchedKeyword: kw };
  }
  for (const kw of INTENT_PATTERNS.check_balance.keywords) {
    if (q.includes(kw)) return { intent: 'check_balance', confidence: 'high', matchedKeyword: kw };
  }

  // Due give/collect
  const hasDueWord = ['বাকি', 'ধার', 'ধারে', 'বাকিতে', 'বাকী', 'পাওনা', 'দেনা', 'কর্জ', 'উধার', 'उधार', 'बाकी', 'due', 'credit', 'loan', 'দিল', 'দিলাম'].some(w => q.includes(w));

  const iGave = /(?:দিলাম|দিয়েছি|দিয়েছি|দিছি|দিতেছি|দেওয়া|দেয়া|দেওয়া|দেবো|দিব|লিখো|লিখে|দাও|দিতে|दिया|दी|देना|gave|give|given|lend|lent)/i.test(q);
  const theyGave = /(?:পেলাম|পেয়েছি|পেয়েছি|পাইলাম|পাইছি|আদায়|আদায়ের|আদায়|শোধ|পরিশোধ|জমা|উসুল|মিলা|मिला|collected|received|repaid|paid)/i.test(q) ||
    (/(?:^|\s)(?:দিল|দিলো|দিলেন)(?:\s|$)/.test(q) && !/(?:দিলাম|দিচ্ছি|দিয়েছি|দিয়েছি|দিব|দিবো)/.test(q));

  if (hasDueWord && (entities.contact || entities.contactName)) {
    if (theyGave && !iGave) return { intent: 'due_collect', confidence: 'high', matchedKeyword: 'বাকি collect' };
    if (iGave) return { intent: 'due_give', confidence: 'high', matchedKeyword: 'বাকি give' };
    if (/(?:কে|রে|\s+को|\s+to)\b/i.test(q)) return { intent: 'due_give', confidence: 'high', matchedKeyword: 'বাকি কে' };
    if (/(?:থেকে|হতে|সে|\s+from)\b/i.test(q)) return { intent: 'due_collect', confidence: 'high', matchedKeyword: 'বাকি থেকে' };
    return { intent: 'due_give', confidence: 'medium', matchedKeyword: 'বাকি' };
  }

  // Owner actions
  if (!entities.contact && !entities.contactName) {
    const ownerDrawKw = ['আমি নিলাম', 'মালিক নিল', 'তুলে নিলাম', 'ড্র'];
    const ownerInjectKw = ['আমি দিলাম', 'মালিক দিল', 'পুঁজি দিলাম', 'দোকানে দিলাম'];
    for (const kw of ownerDrawKw) {
      if (q.includes(kw) && !hasDueWord) return { intent: 'owner_draw', confidence: 'medium', matchedKeyword: kw };
    }
    for (const kw of ownerInjectKw) {
      if (q.includes(kw) && !hasDueWord) return { intent: 'owner_inject', confidence: 'medium', matchedKeyword: kw };
    }
  }

  // Stock sell (product + sale word)
  if (entities.product) {
    const sellKw = ['বিক্রি', 'বেচলাম', 'বেচ', 'sell', 'sale'];
    for (const kw of sellKw) {
      if (q.includes(kw)) return { intent: 'stock_sell', confidence: 'high', matchedKeyword: kw };
    }
  }

  // Restock (product + buy word)
  if (entities.product) {
    const buyKw = ['কিনলাম', 'কিনেছি', 'কেনা', 'রিস্টক', 'restock', 'buy', 'purchase', 'আনলাম', 'মাল আনলাম', 'স্টক'];
    for (const kw of buyKw) {
      if (q.includes(kw)) return { intent: 'restock', confidence: 'high', matchedKeyword: kw };
    }
  }

  // Generic sale
  const saleKw = ['বিক্রি', 'বিক্রয়', 'সেল', 'sale', 'sell', 'bikri', 'বেচলাম'];
  for (const kw of saleKw) {
    if (q.includes(kw)) return { intent: 'sale', confidence: 'high', matchedKeyword: kw };
  }

  // Generic expense
  const expenseKw = ['খরচ', 'খরছ', 'expense', 'khoroch', 'kharcha', 'ব্যয়', 'খরচা'];
  for (const kw of expenseKw) {
    if (q.includes(kw)) return { intent: 'expense', confidence: 'high', matchedKeyword: kw };
  }

  // Due without contact
  if (hasDueWord && entities.amount) {
    if (theyGave && !iGave) return { intent: 'due_collect', confidence: 'high', matchedKeyword: 'বাকি collect' };
    if (iGave) return { intent: 'due_give', confidence: 'high', matchedKeyword: 'বাকি দিলাম' };
    return { intent: 'due_give', confidence: 'medium', matchedKeyword: 'বাকি দিলাম' };
  }

  return { intent: 'unknown', confidence: 'low', matchedKeyword: null };
}

// ===========================
// 9. MASTER ENTITY EXTRACTION
// ===========================

export function extractEntities(text, context = {}) {
  const inventory = context.inventory || [];
  const contacts = context.contacts || [];
  const wallets = context.wallets || {};

  const amount = extractPrimaryAmount(text);
  const quantityInfo = extractQuantity(text);
  const category = resolveExpenseCategory(text);

  const product = resolveProduct(text, inventory);
  const contact = resolveContact(text, contacts);
  const contactName = contact ? contact.name : extractVoiceContactName(text, contacts);
  const wallet = resolveWallet(text, wallets);
  const transferWallets = resolveTransferWallets(text, wallets);

  const entities = {
    amount,
    quantity: quantityInfo?.quantity || null,
    unit: quantityInfo?.unit || product?.unit || null,
    product: product || null,
    contact: contact || null,
    contactName: contactName || null,
    wallet,
    transferWallets,
    category,
    raw: text
  };

  const intentResult = classifyIntent(text, entities);
  entities.intent = intentResult.intent;
  entities.intentConfidence = intentResult.confidence;
  entities.matchedKeyword = intentResult.matchedKeyword;

  // Infer defaults
  if ((entities.intent === 'stock_sell' || entities.intent === 'restock') && !entities.quantity && entities.product) {
    entities.quantity = 1;
  }
  if (entities.intent === 'due_give' && entities.product) {
    entities.intent = 'credit_sale';
  }
  if (!entities.amount && entities.product) {
    if (entities.intent === 'stock_sell' || entities.intent === 'sale') {
      entities.amount = (entities.quantity || 1) * entities.product.sellPrice;
    } else if (entities.intent === 'restock') {
      entities.amount = (entities.quantity || 1) * entities.product.buyPrice;
    }
  }

  return entities;
}
