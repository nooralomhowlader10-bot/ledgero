// voiceFollowUp.js — Proactive AI Suggestions & Cross-Linking for Dr. NAM AI
// Generates context-aware follow-up messages and cross-link hints after every action

// ===========================
// 1. CROSS-LINK MAP
// ===========================

const CROSS_LINKS = {
  expense: [
    { hint_bn: 'রিপোর্ট থেকে মাসিক খরচের তুলনা দেখতে পারবেন।', hint_en: 'View monthly expense comparison in Reports.', screen: 'reports' },
    { hint_bn: 'ক্যাটাগরি বলে দিলে আরো সুন্দর রিপোর্ট হবে।', hint_en: 'Mention category for better reports.', action: 'expense_category' },
  ],
  sale: [
    { hint_bn: 'রিপোর্ট থেকে আজকের সেরা বিক্রি দেখুন।', hint_en: 'See today\'s top sales in Reports.', screen: 'reports' },
    { hint_bn: 'বাকিতে দিতে চাইলে বলুন "বাকি দিলাম"।', hint_en: 'Say "baki dilam" for credit sales.', action: 'credit_sale' },
  ],
  stock_sell: [
    { hint_bn: 'ড্যাশবোর্ডে স্টক লেভেল দেখতে পারবেন।', hint_en: 'Check stock levels on Dashboard.', screen: 'dashboard' },
    { hint_bn: 'স্টক কম হলে বলুন "রিস্টক করো"।', hint_en: 'Say "restock koro" to restock.', action: 'restock' },
  ],
  restock: [
    { hint_bn: 'ক্লোজিং এ স্টক মিলিয়ে দেখতে পারবেন।', hint_en: 'Verify stock during Closing.', screen: 'closing' },
    { hint_bn: 'দাম আপডেট করতে চাইলে বলুন।', hint_en: 'Update prices anytime.', action: 'price_update' },
  ],
  due_give: [
    { hint_bn: 'খাতা থেকে সব বাকির তালিকা দেখুন।', hint_en: 'View all dues in Khata.', screen: 'khata' },
    { hint_bn: 'WhatsApp রিমাইন্ডার পাঠাতে চাইলে বলুন।', hint_en: 'Send WhatsApp reminder if needed.', action: 'whatsapp' },
  ],
  due_collect: [
    { hint_bn: 'খাতায় গিয়ে পুরো হিসাব দেখুন।', hint_en: 'See full history in Khata.', screen: 'khata' },
  ],
  product_add: [
    { hint_bn: 'ড্যাশবোর্ড থেকে এক ক্লিকে বিক্রি করুন।', hint_en: 'Quick-sell from Dashboard.', screen: 'dashboard' },
    { hint_bn: 'ক্লোজিং এ স্টক গণনা করুন।', hint_en: 'Count stock during Closing.', screen: 'closing' },
  ],
  contact_add: [
    { hint_bn: 'খাতায় গিয়ে তার বাকি ম্যানেজ করুন।', hint_en: 'Manage dues in Khata.', screen: 'khata' },
    { hint_bn: 'বাকি দিতে চাইলে বলুন "বাকি দিলাম"।', hint_en: 'Say "baki dilam" for credit.', action: 'due_give' },
  ],
  transfer: [
    { hint_bn: 'রিপোর্ট থেকে ফান্ড মুভমেন্ট ট্র্যাক করুন।', hint_en: 'Track fund movement in Reports.', screen: 'reports' },
  ],
  damage: [
    { hint_bn: 'স্টক অডিট করে সব মিলিয়ে দেখুন।', hint_en: 'Run stock audit to verify.', action: 'stock_audit' },
  ],
  salary_pay: [
    { hint_bn: 'রিপোর্ট থেকে মাসিক বেতন খরচ দেখুন।', hint_en: 'View monthly salary costs in Reports.', screen: 'reports' },
  ],
  owner_draw: [
    { hint_bn: 'এটি ব্যক্তিগত তোলা হিসেবে রেকর্ড হয়েছে।', hint_en: 'Recorded as personal draw.', screen: 'reports' },
  ],
  owner_inject: [
    { hint_bn: 'এটি মালিকের মূলধন হিসেবে রেকর্ড হয়েছে।', hint_en: 'Recorded as capital injection.', screen: 'reports' },
  ],
};

// ===========================
// 2. PROACTIVE FOLLOW-UP GENERATOR
// ===========================

/**
 * Generate context-aware follow-up message after an action
 * @param {string} actionType - The action that was just executed
 * @param {object} context - Financial context from extractFinancialContext
 * @param {object} actionResult - Details of the action (amount, contactName, itemName, etc.)
 * @param {string} lang - Language ('bn', 'hi', 'en')
 * @returns {string} Follow-up message (1-2 sentences max)
 */
export function generateFollowUp(actionType, context, actionResult = {}, lang = 'bn') {
  const isBn = lang === 'bn' || lang === 'hi';
  const suggestions = [];

  switch (actionType) {
    case 'expense':
    case 'EXPENSE_DRAFT': {
      const todayExp = context?.totalExpenses || 0;
      if (isBn) {
        suggestions.push(`আজকে মোট খরচ ৳${todayExp}।`);
        if (context?.yesterdayExpenses && todayExp > context.yesterdayExpenses * 1.3) {
          suggestions.push(`⚠️ গতকালের চেয়ে ৩০% বেশি!`);
        }
      } else {
        suggestions.push(`Today's total expenses: ৳${todayExp}.`);
      }
      break;
    }

    case 'sale':
    case 'SALE_DRAFT': {
      const todaySales = context?.totalSales || 0;
      if (isBn) {
        suggestions.push(`আজকের মোট বিক্রি ৳${todaySales}।`);
      } else {
        suggestions.push(`Today's total sales: ৳${todaySales}.`);
      }
      break;
    }

    case 'stock_sell':
    case 'STOCK_SELL_DRAFT': {
      const item = actionResult?.product || actionResult;
      const remaining = (item?.closingStock || 0) - (actionResult?.quantity || 1);
      const itemName = item?.name || actionResult?.itemName || '';
      if (isBn) {
        suggestions.push(`${itemName} এখন ${Math.max(0, remaining)} ${item?.unit || 'টা'} বাকি।`);
        if (remaining <= 5 && remaining >= 0) {
          suggestions.push(`⚠️ স্টক কম! রিস্টক করতে বলুন।`);
        }
      } else {
        suggestions.push(`${itemName}: ${Math.max(0, remaining)} remaining.`);
        if (remaining <= 5) suggestions.push(`⚠️ Low stock! Say "restock".`);
      }
      break;
    }

    case 'restock':
    case 'STOCK_RESTOCK_DRAFT': {
      const item = actionResult?.product || actionResult;
      const newStock = (item?.closingStock || 0) + (actionResult?.quantity || 1);
      if (isBn) {
        suggestions.push(`${item?.name || ''} এর স্টক এখন ${newStock}।`);
      } else {
        suggestions.push(`${item?.name || ''} stock now: ${newStock}.`);
      }
      break;
    }

    case 'due_give':
    case 'DUE_GIVE_DRAFT': {
      const contact = actionResult?.contact || {};
      const newBalance = (contact?.currentBalance || 0) + (actionResult?.amount || 0);
      if (isBn) {
        suggestions.push(`${contact?.name || 'কাস্টমার'} এর মোট বাকি এখন ৳${newBalance}।`);
        if (newBalance > 5000) {
          suggestions.push(`রিমাইন্ডার পাঠাতে চাইলে বলুন।`);
        }
      } else {
        suggestions.push(`${contact?.name || 'Customer'} total due: ৳${newBalance}.`);
      }
      break;
    }

    case 'due_collect':
    case 'DUE_COLLECT_DRAFT': {
      const contact = actionResult?.contact || {};
      const newBalance = (contact?.currentBalance || 0) - (actionResult?.amount || 0);
      if (isBn) {
        suggestions.push(`${contact?.name || 'কাস্টমার'} এর বাকি এখন ৳${Math.max(0, newBalance)}।`);
        if (newBalance <= 0) {
          suggestions.push(`✅ সব বাকি শোধ হয়ে গেছে!`);
        }
      } else {
        suggestions.push(`${contact?.name || 'Customer'} remaining due: ৳${Math.max(0, newBalance)}.`);
      }
      break;
    }

    case 'product_add':
    case 'PRODUCT_ADD_DRAFT': {
      if (isBn) {
        suggestions.push(`পণ্য যোগ হয়েছে। ড্যাশবোর্ড থেকে দ্রুত বিক্রি করুন।`);
      } else {
        suggestions.push(`Product added. Quick-sell from Dashboard.`);
      }
      break;
    }

    case 'contact_add':
    case 'CONTACT_ADD_DRAFT': {
      if (isBn) {
        suggestions.push(`কাস্টমার যোগ হয়েছে। বাকি দিতে চাইলে বলুন।`);
      } else {
        suggestions.push(`Contact added. Say "baki dilam" for credit.`);
      }
      break;
    }

    case 'transfer':
    case 'FUND_TRANSFER_DRAFT': {
      if (isBn) {
        suggestions.push(`ট্রান্সফার সম্পন্ন।`);
      } else {
        suggestions.push(`Transfer completed.`);
      }
      break;
    }

    case 'damage':
    case 'DAMAGE_DRAFT': {
      if (isBn) {
        suggestions.push(`ক্ষতি রেকর্ড হয়েছে। স্টক অটোমেটিক কমে গেছে।`);
      } else {
        suggestions.push(`Damage recorded. Stock auto-adjusted.`);
      }
      break;
    }

    case 'undo':
    case 'UNDO_LAST': {
      if (isBn) {
        suggestions.push(`শেষ কাজ বাতিল হয়েছে।`);
      } else {
        suggestions.push(`Last action undone.`);
      }
      break;
    }

    default:
      break;
  }

  return suggestions.join(' ');
}

// ===========================
// 3. CROSS-LINK HINT GETTER
// ===========================

/**
 * Get a relevant cross-link hint for an action type
 * Rotates through hints to avoid repetition
 */
let hintRotationIdx = 0;

export function getCrossLink(actionType, lang = 'bn') {
  const links = CROSS_LINKS[actionType];
  if (!links || links.length === 0) return '';

  const idx = hintRotationIdx % links.length;
  hintRotationIdx++;

  const link = links[idx];
  const hint = lang === 'en' ? link.hint_en : link.hint_bn;
  return `💡 ${hint}`;
}

// ===========================
// 4. FULL RESPONSE ENRICHER
// ===========================

/**
 * Enrich a response with follow-up and cross-link
 * @param {string} baseReply - The original response text
 * @param {string} actionType - Action type for follow-up generation
 * @param {object} context - Financial context
 * @param {object} actionResult - Action details
 * @param {string} lang - Language
 * @returns {string} Enriched response
 */
export function enrichResponse(baseReply, actionType, context, actionResult = {}, lang = 'bn') {
  const followUp = generateFollowUp(actionType, context, actionResult, lang);
  const crossLink = getCrossLink(actionType, lang);

  const parts = [baseReply];
  if (followUp) parts.push(followUp);
  if (crossLink) parts.push(crossLink);

  return parts.join(' ');
}
