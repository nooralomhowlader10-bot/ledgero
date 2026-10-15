// ── Wallet Definitions ──────────────────────────────────────────────
export const WALLET_KEYS = {
  HAND_CASH: 'hand_cash',
  BKASH_AGENT: 'bkash_agent',
  BKASH_PERSONAL: 'bkash_personal',
  NAGAD_UDDOKTA: 'nagad_uddokta',
  NAGAD_PERSONAL: 'nagad_personal',
  RETAIL_APPS: 'retail_apps',
  DUTCH_BANGLA: 'dutch_bangla',
  JANATA_BANK: 'janata_bank',
};

export const WALLET_LABELS = {
  [WALLET_KEYS.HAND_CASH]: 'Hand Cash',
  [WALLET_KEYS.BKASH_AGENT]: 'bKash Agent',
  [WALLET_KEYS.BKASH_PERSONAL]: 'bKash Personal',
  [WALLET_KEYS.NAGAD_UDDOKTA]: 'Nagad Uddokta',
  [WALLET_KEYS.NAGAD_PERSONAL]: 'Nagad Personal',
  [WALLET_KEYS.RETAIL_APPS]: 'Retail Apps',
  [WALLET_KEYS.DUTCH_BANGLA]: 'Dutch-Bangla Bank',
  [WALLET_KEYS.JANATA_BANK]: 'Janata Bank',
  rocket: 'Rocket',
  upay: 'Upay',
  city_bank: 'City Bank',
  brac_bank: 'BRAC Bank',
  islami_bank: 'Islami Bank',
  sonali_bank: 'Sonali Bank',
  eastern_bank: 'Eastern Bank (EBL)',
  bank_asia: 'Bank Asia',
};

export const WALLET_COLORS = {
  [WALLET_KEYS.HAND_CASH]: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: '💵' },
  [WALLET_KEYS.BKASH_AGENT]: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', icon: '📱' },
  [WALLET_KEYS.BKASH_PERSONAL]: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-600', icon: '📲' },
  [WALLET_KEYS.NAGAD_UDDOKTA]: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: '🟠' },
  [WALLET_KEYS.NAGAD_PERSONAL]: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600', icon: '🔶' },
  [WALLET_KEYS.RETAIL_APPS]: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: '📡' },
  [WALLET_KEYS.DUTCH_BANGLA]: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: '🏦' },
  [WALLET_KEYS.JANATA_BANK]: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', icon: '🏛️' },
  rocket: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: '🚀' },
  upay: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: '📱' },
  city_bank: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: '🏦' },
  brac_bank: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: '🏦' },
  islami_bank: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: '🏦' },
  sonali_bank: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: '🏛️' },
};

// ── General / Retail Store Wallets (For Grocery, Hardware, Pharmacy, etc.) ────
export const GENERAL_WALLET_KEYS = {
  HAND_CASH: 'hand_cash',
  BANK_ACCOUNT: 'bank_account',
  DIGITAL_PAYMENT: 'digital_payment',
};

export const GENERAL_WALLET_LABELS = {
  [GENERAL_WALLET_KEYS.HAND_CASH]: 'ক্যাশ ড্রয়ার',
  [GENERAL_WALLET_KEYS.BANK_ACCOUNT]: 'ব্যাংক অ্যাকাউন্ট',
  [GENERAL_WALLET_KEYS.DIGITAL_PAYMENT]: 'বিকাশ / নগদ পেমেন্ট',
};

export const GENERAL_WALLET_LABELS_EN = {
  [GENERAL_WALLET_KEYS.HAND_CASH]: 'Cash Drawer',
  [GENERAL_WALLET_KEYS.BANK_ACCOUNT]: 'Bank Account',
  [GENERAL_WALLET_KEYS.DIGITAL_PAYMENT]: 'bKash / Nagad Payment',
};

export function getWalletLabel(key, lang = 'bn', walletData = null) {
  if (walletData && typeof walletData === 'object' && walletData.label) {
    return walletData.label;
  }
  if (WALLET_LABELS[key]) return WALLET_LABELS[key];
  if (lang === 'en') {
    return GENERAL_WALLET_LABELS_EN[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return GENERAL_WALLET_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export const GENERAL_WALLET_COLORS = {
  [GENERAL_WALLET_KEYS.HAND_CASH]: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: '💵' },
  [GENERAL_WALLET_KEYS.BANK_ACCOUNT]: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: '🏦' },
  [GENERAL_WALLET_KEYS.DIGITAL_PAYMENT]: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', icon: '📱' },
};

// ── Wallet Categories (for custom wallet icon selection) ─────────────
export const WALLET_CATEGORIES = [
  { id: 'cash',             name: 'নগদ টাকা / ক্যাশ',          name_en: 'Cash / Hand Cash',         icon: '💵' },
  { id: 'bank',             name: 'ব্যাংক',                     name_en: 'Bank Account',             icon: '🏦' },
  { id: 'mobile_banking',   name: 'মোবাইল ব্যাংকিং',           name_en: 'Mobile Banking',           icon: '📱' },
  { id: 'telecom_recharge', name: 'টেলিকম / রিচার্জ (Top Up)', name_en: 'Telecom / Mobile Recharge', icon: '📲' },
  { id: 'digital_wallet',   name: 'ডিজিটাল ওয়ালেট / পেমেন্ট অ্যাপ', name_en: 'Digital Wallet / Payment App', icon: '💳' },
  { id: 'crypto',           name: 'ক্রিপ্টোকারেন্সি',           name_en: 'Cryptocurrency',           icon: '🪙' },
  { id: 'merchant',         name: 'মার্চেন্ট / POS',            name_en: 'Merchant / POS Account',   icon: '🏪' },
  { id: 'microfinance',     name: 'সমিতি / মাইক্রোফাইন্যান্স',  name_en: 'Co-op / Microfinance',     icon: '🤝' },
  { id: 'other',            name: 'অন্যান্য',                   name_en: 'Others',                   icon: '💰' },
];

export function getWalletCategoryIcon(categoryId) {
  const cat = WALLET_CATEGORIES.find(c => c.id === categoryId);
  return cat?.icon || '💰';
}

// Auto-detect category for known wallet keys
export function detectWalletCategory(key) {
  if (key === 'hand_cash') return 'cash';
  const lk = (key || '').toLowerCase();
  if (['retail_apps', 'flexiload', 'easyload', 'recharge', 'telecom', 'gp_load', 'robi_load', 'bl_load', 'airtel_load', 'teletalk_load'].some(k => lk.includes(k))) return 'telecom_recharge';
  if (['bkash_agent', 'bkash_personal', 'nagad_uddokta', 'nagad_personal', 'rocket', 'upay', 'mcash', 'surecash', 'digital_payment'].includes(lk)) return 'mobile_banking';
  if (['dutch_bangla', 'janata_bank', 'bank_account', 'city_bank', 'brac_bank', 'islami_bank', 'sonali_bank', 'eastern_bank', 'bank_asia'].includes(lk)) return 'bank';
  return 'other';
}

// Color rotation for custom/user-added wallets (icons now come from category)
export const CUSTOM_WALLET_COLORS = [
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700' },
  { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-700' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' },
  { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700' },
  { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
  { bg: 'bg-lime-50', border: 'border-lime-200', text: 'text-lime-700' },
  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', text: 'text-fuchsia-700' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700' },
];

export function getCustomWalletColor(key, allKeys, walletData) {
  // Get the base color scheme
  let colorScheme;
  if (WALLET_COLORS[key]) {
    colorScheme = { ...WALLET_COLORS[key] };
  } else if (GENERAL_WALLET_COLORS[key]) {
    colorScheme = { ...GENERAL_WALLET_COLORS[key] };
  } else {
    const knownKeys = new Set([...Object.values(WALLET_KEYS), ...Object.values(GENERAL_WALLET_KEYS)]);
    const customKeys = allKeys.filter(k => !knownKeys.has(k));
    const index = customKeys.indexOf(key);
    colorScheme = { ...CUSTOM_WALLET_COLORS[(index >= 0 ? index : 0) % CUSTOM_WALLET_COLORS.length] };
  }
  // Override icon with category icon
  const category = walletData?.category || detectWalletCategory(key);
  colorScheme.icon = getWalletCategoryIcon(category);
  return colorScheme;
}

export function createGeneralWallets() {
  const wallets = {};
  Object.values(GENERAL_WALLET_KEYS).forEach((key) => {
    wallets[key] = { opening: 0, current: 0 };
  });
  return wallets;
}

// ── Default Wallets for Telecom (all zero for first run) ────────────
export function createDefaultWallets() {
  const wallets = {};
  Object.values(WALLET_KEYS).forEach((key) => {
    wallets[key] = { opening: 0, current: 0 };
  });
  return wallets;
}

// ── Product Units (প্রোডাক্ট এর ইউনিট) ──────────────────────────────
export const PRODUCT_UNITS = [
  { key: 'piece', label: 'পিস', label_en: 'Piece (pcs)' },
  { key: 'kg', label: 'কেজি', label_en: 'Kilogram (kg)' },
  { key: 'liter', label: 'লিটার', label_en: 'Liter (L)' },
  { key: 'item', label: 'টি', label_en: 'Item' },
  { key: 'dozen', label: 'ডজন', label_en: 'Dozen' },
  { key: 'sack', label: 'বস্তা', label_en: 'Sack / Bag' },
  { key: 'set', label: 'সেট', label_en: 'Set' },
  { key: 'yard', label: 'গজ', label_en: 'Yard' },
  { key: 'packet', label: 'প্যাকেট', label_en: 'Packet' },
  { key: 'carton', label: 'কার্টুন', label_en: 'Carton / Box' },
  { key: 'sqm', label: 'স্কয়ার মিটার', label_en: 'Sq. Meter' },
  { key: 'sqft', label: 'স্কয়ার ফিট', label_en: 'Sq. Feet' },
  { key: 'feet', label: 'ফুট', label_en: 'Feet' },
  { key: 'inch', label: 'ইঞ্চি', label_en: 'Inch' },
  { key: 'meter', label: 'মিটার', label_en: 'Meter' },
  { key: 'others', label: 'অন্যান্য', label_en: 'Others' },
];

// ── Business Categories & Helper (Photo 5 Inspired) ─────────────────
export const BIZ_CATEGORIES = [
  { id: 'grocery', name: 'মুদি বা জেনারেল স্টোর', name_en: 'Grocery or General Store', icon: '🧺' },
  { id: 'fashion', name: 'ফ্যাশন বা কাপড়ের ব্যবসা', name_en: 'Fashion & Clothing Store', icon: '🧶' },
  { id: 'telecom', name: 'মোবাইল ব্যাংকিং ও রিচার্জ পয়েন্ট', name_en: 'Mobile Banking & Recharge Point', icon: '🔋' },
  { id: 'bakery', name: 'বেকারি ও কনফেকশনারি', name_en: 'Bakery & Confectionery', icon: '🧁' },
  { id: 'furniture', name: 'গৃহস্থালি ও ফার্নিচার', name_en: 'Home Decor & Furniture', icon: '🛋️' },
  { id: 'library', name: 'লাইব্রেরি ও স্টেশনারি', name_en: 'Library & Stationery Shop', icon: '✏️' },
  { id: 'shoes', name: 'জুতার দোকান', name_en: 'Shoe Store / Footwear', icon: '👠' },
  { id: 'wholesale', name: 'ডিলার/ডিস্ট্রিবিউটর বা পাইকারি ব্যবসা', name_en: 'Wholesale & Distribution', icon: '👨‍💼' },
  { id: 'hardware', name: 'হার্ডওয়্যার ও স্যানিটারি', name_en: 'Hardware & Sanitary', icon: '🛠️' },
  { id: 'pharmacy', name: 'ফার্মেসি', name_en: 'Pharmacy / Drugstore', icon: '💊' },
  { id: 'cosmetics', name: 'কসমেটিকস, বিউটি ও জুয়েলারি', name_en: 'Cosmetics, Beauty & Jewelry', icon: '💄' },
  { id: 'restaurant', name: 'রেস্টুরেন্ট বা মিষ্টির দোকান / হোটেল', name_en: 'Restaurant, Sweets & Hotel', icon: '🍰' },
  { id: 'electronics', name: 'মোবাইল, কম্পিউটার ও ইলেকট্রনিক্স', name_en: 'Mobile, Computer & Electronics', icon: '💻' },
  { id: 'agriculture', name: 'কৃষি পণ্য ও উপকরণ', name_en: 'Agro Products & Feeds', icon: '🥕' },
  { id: 'construction', name: 'রড-সিমেন্ট/নির্মাণ সামগ্রী', name_en: 'Construction & Building Materials', icon: '🛒' },
  { id: 'automobile', name: 'গাড়ি ও অটো পার্টস', name_en: 'Automobile & Auto Parts', icon: '🚗' },
  { id: 'tailor', name: 'টেইলার্স', name_en: 'Tailoring & Stitching', icon: '🪡' },
  { id: 'personal', name: 'ব্যক্তিগত হিসাব রাখি', name_en: 'Personal Accounts', icon: '👤' },
  { id: 'others', name: 'অন্যান্য', name_en: 'Others (Custom Business Type)', icon: '🏪' },
];

export const BIZ_TYPES = BIZ_CATEGORIES.map(c => c.name);

export function getBizCategoryName(name, lang = 'bn') {
  if (!name) return '';
  if (lang === 'bn') return name;
  const cat = BIZ_CATEGORIES.find(c => c.name === name || c.id === name || c.name_en === name);
  return cat?.name_en || name;
}

export function isTelecomBiz(bizType, bizName) {
  const t = `${bizType || ''} ${bizName || ''}`.toLowerCase();
  return t.includes('মোবাইল') || t.includes('টেলিকম') || t.includes('রিচার্জ') || t.includes('telecom') || t.includes('flexiload');
}

// ── Transaction Types ───────────────────────────────────────────────
export const TX_TYPES = {
  EXPENSE: 'expense',
  PERSONAL_DRAW: 'personal_draw',
  OWNER_GAVE: 'owner_gave',
  OWNER_TOOK: 'owner_took',
  LOAN_GIVEN: 'loan_given',
  LOAN_COLLECTED: 'loan_collected',
  LOAN_TAKEN: 'loan_taken',
  LOAN_REPAID: 'loan_repaid',
  FUND_TRANSFER: 'fund_transfer',
  TRANSFER_FEE: 'transfer_fee',
  SERVICE_INCOME: 'service_income',
  STOCK_SALE: 'stock_sale',
  STOCK_PURCHASE: 'stock_purchase',
  STOCK_ADDED: 'stock_added',
  CREDIT_SALE: 'credit_sale',
  RECHARGE: 'recharge',
  CASH_ADJUSTMENT: 'cash_adjustment',
  DAMAGE_LOSS: 'damage_loss',
  ASSET_PURCHASE: 'asset_purchase',
  ASSET_SALE: 'asset_sale',
  TAX_PAYMENT: 'tax_payment',
};

export const TX_LABELS = {
  [TX_TYPES.EXPENSE]: 'দোকানের খরচ',
  [TX_TYPES.PERSONAL_DRAW]: 'মালিক নিল',
  [TX_TYPES.OWNER_GAVE]: 'মালিক দিল',
  [TX_TYPES.OWNER_TOOK]: 'মালিক নিল',
  [TX_TYPES.LOAN_GIVEN]: 'ধার দেওয়া',
  [TX_TYPES.LOAN_COLLECTED]: 'ধার আদায়',
  [TX_TYPES.LOAN_TAKEN]: 'ধার আনা',
  [TX_TYPES.LOAN_REPAID]: 'ধার শোধ',
  [TX_TYPES.FUND_TRANSFER]: 'ফান্ড ট্রান্সফার',
  [TX_TYPES.TRANSFER_FEE]: 'ট্রান্সফার ফি',
  [TX_TYPES.SERVICE_INCOME]: 'সার্ভিস ইনকাম',
  [TX_TYPES.STOCK_SALE]: 'পণ্য বিক্রি',
  [TX_TYPES.STOCK_PURCHASE]: 'নতুন পণ্য ক্রয়',
  [TX_TYPES.STOCK_ADDED]: 'স্টক যুক্ত',
  [TX_TYPES.CREDIT_SALE]: 'বাকিতে বিক্রয়',
  [TX_TYPES.RECHARGE]: 'মোবাইল রিচার্জ',
  [TX_TYPES.CASH_ADJUSTMENT]: 'ক্যাশ এডজাস্টমেন্ট',
  [TX_TYPES.DAMAGE_LOSS]: 'নষ্ট/ক্ষতিগ্রস্ত পণ্য',
  [TX_TYPES.ASSET_PURCHASE]: 'স্থায়ী সম্পদ ক্রয়',
  [TX_TYPES.ASSET_SALE]: 'স্থায়ী সম্পদ বিক্রয়',
  [TX_TYPES.TAX_PAYMENT]: 'ট্যাক্স/ভ্যাট পরিশোধ',
};

export const TX_LABELS_EN = {
  [TX_TYPES.EXPENSE]: 'Expense',
  [TX_TYPES.PERSONAL_DRAW]: 'Personal Draw',
  [TX_TYPES.OWNER_GAVE]: 'Owner Gave (Cash In)',
  [TX_TYPES.OWNER_TOOK]: 'Owner Took (Cash Out)',
  [TX_TYPES.LOAN_GIVEN]: 'Loan Given (Lend)',
  [TX_TYPES.LOAN_COLLECTED]: 'Loan Collected',
  [TX_TYPES.LOAN_TAKEN]: 'Loan Taken (Borrow)',
  [TX_TYPES.LOAN_REPAID]: 'Loan Repaid',
  [TX_TYPES.FUND_TRANSFER]: 'Fund Transfer',
  [TX_TYPES.TRANSFER_FEE]: 'Transfer Fee',
  [TX_TYPES.SERVICE_INCOME]: 'Service Income',
  [TX_TYPES.STOCK_SALE]: 'Stock Sale',
  [TX_TYPES.STOCK_PURCHASE]: 'Stock Purchase',
  [TX_TYPES.STOCK_ADDED]: 'Stock Added',
  [TX_TYPES.CREDIT_SALE]: 'Credit Sale (Due)',
  [TX_TYPES.RECHARGE]: 'Mobile Recharge',
  [TX_TYPES.CASH_ADJUSTMENT]: 'Cash Adjustment',
  [TX_TYPES.DAMAGE_LOSS]: 'Inventory Damage / Loss',
  [TX_TYPES.ASSET_PURCHASE]: 'Asset Purchase',
  [TX_TYPES.ASSET_SALE]: 'Asset Sale',
  [TX_TYPES.TAX_PAYMENT]: 'Tax Payment',
};

export function getTxLabel(type, lang = 'bn') {
  if (lang === 'en') {
    return TX_LABELS_EN[type] || type;
  }
  return TX_LABELS[type] || type;
};

export const TX_BADGE_COLORS = {
  [TX_TYPES.EXPENSE]: 'bg-rose-100 text-rose-700',
  [TX_TYPES.PERSONAL_DRAW]: 'bg-yellow-100 text-yellow-700',
  [TX_TYPES.OWNER_GAVE]: 'bg-emerald-100 text-emerald-800',
  [TX_TYPES.OWNER_TOOK]: 'bg-amber-100 text-amber-800',
  [TX_TYPES.LOAN_GIVEN]: 'bg-purple-100 text-purple-700',
  [TX_TYPES.LOAN_COLLECTED]: 'bg-green-100 text-green-700',
  [TX_TYPES.LOAN_TAKEN]: 'bg-amber-100 text-amber-700',
  [TX_TYPES.LOAN_REPAID]: 'bg-indigo-100 text-indigo-700',
  [TX_TYPES.FUND_TRANSFER]: 'bg-blue-100 text-blue-700',
  [TX_TYPES.TRANSFER_FEE]: 'bg-orange-100 text-orange-700',
  [TX_TYPES.SERVICE_INCOME]: 'bg-teal-100 text-teal-700',
  [TX_TYPES.STOCK_SALE]: 'bg-emerald-100 text-emerald-700',
  [TX_TYPES.STOCK_PURCHASE]: 'bg-indigo-100 text-indigo-700',
  [TX_TYPES.STOCK_ADDED]: 'bg-gray-100 text-gray-700',
  [TX_TYPES.CREDIT_SALE]: 'bg-violet-100 text-violet-700',
  [TX_TYPES.RECHARGE]: 'bg-cyan-100 text-cyan-800',
  [TX_TYPES.CASH_ADJUSTMENT]: 'bg-gray-100 text-gray-600',
  [TX_TYPES.DAMAGE_LOSS]: 'bg-red-100 text-red-800',
  [TX_TYPES.ASSET_PURCHASE]: 'bg-blue-100 text-blue-800',
  [TX_TYPES.ASSET_SALE]: 'bg-teal-100 text-teal-800',
  [TX_TYPES.TAX_PAYMENT]: 'bg-purple-100 text-purple-800',
};

// ── Expense Categories ──────────────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  { id: 'tea_snacks', label: 'চা-নাস্তা / আপ্যায়ন', label_en: 'Tea & Snacks', icon: '☕' },
  { id: 'electricity', label: 'বিদ্যুৎ বিল', label_en: 'Electricity', icon: '⚡' },
  { id: 'bazar', label: 'দোকানের বাজার / মুদি', label_en: 'Market & Supplies', icon: '🛒' },
  { id: 'packaging', label: 'প্যাকেজিং ব্যাগ / পলিথিন', label_en: 'Packaging Bags', icon: '🛍️' },
  { id: 'rent', label: 'দোকান ভাড়া', label_en: 'Shop Rent', icon: '🏠' },
  { id: 'salary', label: 'কর্মচারী বেতন', label_en: 'Staff Salary', icon: '👤' },
  { id: 'transport', label: 'যাতায়াত / পরিবহন', label_en: 'Transport / Fare', icon: '🚗' },
  { id: 'repair', label: 'মেরামত / মেইনটেন্যান্স', label_en: 'Repair / Maintenance', icon: '🔧' },
  { id: 'medicine', label: 'চিকিৎসা / ঔষধ', label_en: 'Medicine & Health', icon: '💊' },
  { id: 'food', label: 'খাবার খরচ', label_en: 'Food / Meals', icon: '🍽️' },
  { id: 'mobile', label: 'মোবাইল বিল', label_en: 'Mobile Bill', icon: '📱' },
  { id: 'internet', label: 'ইন্টারনেট / ওয়াইফাই', label_en: 'Internet / Wifi', icon: '🌐' },
  { id: 'cleaning', label: 'পরিচ্ছন্নতা সামগ্রী', label_en: 'Cleaning & Wash', icon: '🧹' },
  { id: 'marketing', label: 'বিজ্ঞাপন / প্রচার', label_en: 'Marketing / Ads', icon: '📢' },
  { id: 'tax', label: 'ট্যাক্স / ট্রেড লাইসেন্স', label_en: 'Tax / Trade License', icon: '🏛️' },
  { id: 'supplies', label: 'অফিস সাপ্লাই / স্টেশনারি', label_en: 'Stationery & Supplies', icon: '📦' },
  { id: 'other', label: 'অন্যান্য খরচ', label_en: 'Other Expense', icon: '📋' },
];
export const DEFAULT_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;

// ── Service Types ───────────────────────────────────────────────────
export const SERVICE_TYPES = {
  PHOTOCOPY: 'photocopy',
  STUDIO: 'studio',
};

export const SERVICE_LABELS = {
  [SERVICE_TYPES.PHOTOCOPY]: 'Photocopy',
  [SERVICE_TYPES.STUDIO]: 'Studio',
};

// ── Default Inventory Catalog for Telecom ───────────────────────────
export const DEFAULT_INVENTORY = [
  { id: 'bl_min_19', name: 'BL Minute Card 19', unit: 'পিস', buyPrice: 18.25, sellPrice: 19 },
  { id: 'bl_min_29', name: 'BL Minute Card 29', unit: 'পিস', buyPrice: 28, sellPrice: 29 },
  { id: 'bl_min_40', name: 'BL Minute Card 40', unit: 'পিস', buyPrice: 39, sellPrice: 40 },
  { id: 'bl_min_69', name: 'BL Minute Card 69', unit: 'পিস', buyPrice: 67, sellPrice: 69 },
  { id: 'bl_min_109', name: 'BL Minute Card 109', unit: 'পিস', buyPrice: 106, sellPrice: 109 },
  { id: 'gp_min_28', name: 'GP Minute Card 28', unit: 'পিস', buyPrice: 27, sellPrice: 28 },
  { id: 'gp_min_48', name: 'GP Minute Card 48', unit: 'পিস', buyPrice: 46.50, sellPrice: 48 },
  { id: 'gp_min_94', name: 'GP Minute Card 94', unit: 'পিস', buyPrice: 91, sellPrice: 94 },
  { id: 'gp_sim', name: 'GP SIM Card', unit: 'পিস', buyPrice: 180, sellPrice: 200 },
  { id: 'bl_sim', name: 'BL SIM Card', unit: 'পিস', buyPrice: 150, sellPrice: 180 },
  { id: 'robi_sim', name: 'Robi SIM Card', unit: 'পিস', buyPrice: 160, sellPrice: 190 },
];

// ── Day Status ──────────────────────────────────────────────────────
export const DAY_STATUS = {
  NOT_STARTED: 'not_started',
  OPEN: 'open',
  CLOSING: 'closing',
  FINALIZED: 'finalized',
};

// ── Screen / Tab Names ──────────────────────────────────────────────
export const SCREENS = {
  OPENING: 'opening',
  DASHBOARD: 'dashboard',
  KHATA: 'khata',
  CLOSING: 'closing',
  REPORTS: 'reports',
  ANALYTICS: 'analytics',
  TEAHOUSE: 'teahouse',
  ONLINE_ORDERS: 'online_orders',
};

// ── User Roles ──────────────────────────────────────────────────────
export const USER_ROLES = {
  OWNER: 'owner',
  STAFF: 'staff',
};

// ── Staff Permission Config ─────────────────────────────────────────
// Defines what staff members CANNOT see/do
export const STAFF_RESTRICTIONS = {
  hiddenSections: ['dailyProfit', 'netProfit', 'grossProfit', 'totalRevenue', 'cashMismatch'],
  blockedActions: ['deleteTransaction', 'editOpeningBalance', 'accessClosing', 'accessSettings', 'manageStaff', 'viewAuditLog', 'exportData'],
  blockedScreens: ['closing'],
};

// ── VAT / Tax Configuration ─────────────────────────────────────────
export const VAT_RATES = [
  { id: 'none', rate: 0, label: 'No VAT', label_bn: 'ভ্যাট নেই' },
  { id: 'vat_5', rate: 5, label: '5% VAT', label_bn: '৫% ভ্যাট' },
  { id: 'vat_7_5', rate: 7.5, label: '7.5% VAT', label_bn: '৭.৫% ভ্যাট' },
  { id: 'vat_10', rate: 10, label: '10% VAT', label_bn: '১০% ভ্যাট' },
  { id: 'vat_15', rate: 15, label: '15% VAT', label_bn: '১৫% ভ্যাট' },
  { id: 'custom', rate: 0, label: 'Custom', label_bn: 'কাস্টম' },
];

/**
 * Calculate VAT amount and total including VAT.
 * @param {number} amount — base amount before tax
 * @param {number} vatRate — VAT percentage (e.g. 15 for 15%)
 * @returns {{ vatAmount: number, totalWithVat: number }}
 */
export function calcVAT(amount, vatRate = 0) {
  const vatAmount = Math.round((amount * vatRate) / 100);
  return { vatAmount, totalWithVat: amount + vatAmount };
}

// ── App Modes ───────────────────────────────────────────────────────
export const APP_MODES = {
  EASY: 'easy',
  ADVANCED: 'advanced',
};

// ── Advanced Feature Flags (all OFF by default in Easy Mode) ────────
export const ADVANCED_FEATURES = {
  doubleEntry: false,
  taxTracking: false,
  fixedAssets: false,
  bankReconciliation: false,
  perpetualInventory: false,
  advancedInvoicing: false,
  comparativeReports: false,
  transactionTags: false,
  payroll: false,
  multiCurrency: false,
};

// ── Feature Metadata (labels for UI toggles) ────────────────────────
export const FEATURE_META = {
  doubleEntry:        { en: 'Double-Entry Accounting', bn: 'ডাবল-এন্ট্রি হিসাব', icon: '📒' },
  taxTracking:        { en: 'VAT / Tax Tracking', bn: 'ভ্যাট / ট্যাক্স ট্র্যাকিং', icon: '🧾' },
  fixedAssets:        { en: 'Fixed Assets & Depreciation', bn: 'স্থায়ী সম্পদ ও অবচয়', icon: '🏭' },
  bankReconciliation: { en: 'Bank Reconciliation', bn: 'ব্যাংক রিকনসিলিয়েশন', icon: '🏦' },
  perpetualInventory: { en: 'Auto COGS on Sale', bn: 'বিক্রিতে অটো খরচ পোস্ট', icon: '📦' },
  advancedInvoicing:  { en: 'Advanced Invoice', bn: 'অ্যাডভান্স ইনভয়েস', icon: '📄' },
  comparativeReports: { en: 'Comparative Reports', bn: 'তুলনামূলক রিপোর্ট', icon: '📊' },
  transactionTags:    { en: 'Transaction Tags', bn: 'ট্রানজেকশন ট্যাগ', icon: '🏷️' },
  payroll:            { en: 'Payroll', bn: 'বেতন ব্যবস্থাপনা', icon: '💰' },
  multiCurrency:      { en: 'Multi-Currency', bn: 'মাল্টি-কারেন্সি', icon: '💱' },
};

// ── Default Chart of Accounts (retail shop) ─────────────────────────
export const DEFAULT_COA = [
  // Assets
  { id: 'cash_in_hand', name: 'Cash in Hand', name_bn: 'হাতে নগদ', type: 'ASSET', isSystem: true },
  { id: 'bkash', name: 'bKash', name_bn: 'বিকাশ', type: 'ASSET', isSystem: true },
  { id: 'nagad', name: 'Nagad', name_bn: 'নগদ', type: 'ASSET', isSystem: true },
  { id: 'bank_account', name: 'Bank Account', name_bn: 'ব্যাংক একাউন্ট', type: 'ASSET', isSystem: true },
  { id: 'inventory', name: 'Inventory', name_bn: 'মজুদ পণ্য', type: 'ASSET', isSystem: true },
  { id: 'fixed_assets', name: 'Fixed Assets', name_bn: 'স্থায়ী সম্পদ', type: 'ASSET', isSystem: true },
  { id: 'accounts_receivable', name: 'Accounts Receivable', name_bn: 'পাওনা (আদায়যোগ্য)', type: 'ASSET', isSystem: true },
  // Liabilities
  { id: 'accounts_payable', name: 'Accounts Payable', name_bn: 'দেনা (পরিশোধযোগ্য)', type: 'LIABILITY', isSystem: true },
  { id: 'loans_payable', name: 'Loans Payable', name_bn: 'ঋণ গ্রহণ', type: 'LIABILITY', isSystem: true },
  { id: 'vat_output', name: 'VAT Output (Payable)', name_bn: 'আউটপুট ভ্যাট', type: 'LIABILITY', isSystem: true },
  { id: 'vat_input', name: 'VAT Input (Receivable)', name_bn: 'ইনপুট ভ্যাট', type: 'ASSET', isSystem: true },
  // Equity
  { id: 'owners_capital', name: "Owner's Capital", name_bn: 'মালিকের মূলধন', type: 'EQUITY', isSystem: true },
  { id: 'owners_drawings', name: "Owner's Drawings", name_bn: 'ব্যক্তিগত উত্তোলন', type: 'EQUITY', isSystem: true },
  { id: 'retained_earnings', name: 'Retained Earnings', name_bn: 'সঞ্চিত মুনাফা', type: 'EQUITY', isSystem: true },
  // Revenue
  { id: 'sales_revenue', name: 'Sales Revenue', name_bn: 'বিক্রয় আয়', type: 'REVENUE', isSystem: true },
  { id: 'credit_sales_revenue', name: 'Credit Sales Revenue', name_bn: 'বাকি বিক্রয় আয়', type: 'REVENUE', isSystem: true },
  { id: 'service_revenue', name: 'Service Revenue', name_bn: 'সেবা আয়', type: 'REVENUE', isSystem: true },
  { id: 'interest_income', name: 'Interest Income', name_bn: 'সুদ আয়', type: 'REVENUE', isSystem: true },
  // Expenses
  { id: 'cogs', name: 'Cost of Goods Sold', name_bn: 'বিক্রিত পণ্যের ব্যয়', type: 'EXPENSE', isSystem: true },
  { id: 'operating_expenses', name: 'Operating Expenses', name_bn: 'পরিচালন ব্যয়', type: 'EXPENSE', isSystem: true },
  { id: 'salary_expense', name: 'Salary Expense', name_bn: 'বেতন খরচ', type: 'EXPENSE', isSystem: true },
  { id: 'rent_expense', name: 'Rent Expense', name_bn: 'ভাড়া খরচ', type: 'EXPENSE', isSystem: true },
  { id: 'transfer_fee_expense', name: 'Transfer Fee', name_bn: 'ট্রান্সফার ফি', type: 'EXPENSE', isSystem: true },
  { id: 'inventory_loss', name: 'Inventory Loss / Damage', name_bn: 'নষ্ট/ক্ষতিগ্রস্ত পণ্যের ব্যয়', type: 'EXPENSE', isSystem: true },
];
