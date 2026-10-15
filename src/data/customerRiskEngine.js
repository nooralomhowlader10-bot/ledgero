/**
 * src/data/customerRiskEngine.js
 * Automated Customer Fraud & RTO Prevention Engine for Ledgero F-Commerce
 */

export function normalizePhoneNumber(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('880')) return '0' + digits.slice(3);
  if (digits.startsWith('88') && digits.length >= 12) return digits.slice(2);
  return digits;
}

export const FRAUD_RISK_LEVELS = {
  HIGH: 'high',         // 🔴 High Risk (multiple RTOs or manually blacklisted)
  MODERATE: 'moderate', // 🟡 Moderate Risk (1 RTO or multiple cancellations)
  LOW: 'low',           // 🟢 Low Risk / Trusted (completed orders, 0 RTO)
  NEUTRAL: 'neutral',   // ⚪ Neutral (new customer, no history)
};

/**
 * Evaluates the fraud & RTO risk of a customer based on historical orders and blacklist registry.
 * 
 * @param {Object} params
 * @param {string} params.phone - Customer phone number
 * @param {Array} params.onlineOrders - All shop online orders
 * @param {Object} params.customerBlacklist - Saved customer blacklist map
 * @param {number} params.deliveryCharge - Standard or current order delivery charge
 * @param {string} params.language - 'bn' or 'en'
 * @returns {Object} Comprehensive risk report
 */
export function evaluateCustomerRisk({
  phone = '',
  onlineOrders = [],
  customerBlacklist = {},
  deliveryCharge = 100,
  language = 'bn',
}) {
  const normPhone = normalizePhoneNumber(phone);
  const isEn = language === 'en';

  if (!normPhone || normPhone.length < 6) {
    return {
      phone: normPhone,
      riskLevel: FRAUD_RISK_LEVELS.NEUTRAL,
      rtoCount: 0,
      deliveredCount: 0,
      cancelledCount: 0,
      totalOrders: 0,
      isManuallyBlacklisted: false,
      blacklistReason: '',
      hasWarning: false,
      warningTitle: '',
      warningMessage: '',
      actionAdvice: '',
      badgeLabel: isEn ? 'New' : 'নতুন',
      badgeColor: 'slate',
      recommendedAdvance: 0,
    };
  }

  // Find all historical orders for this customer (normalized phone match)
  const customerOrders = (onlineOrders || []).filter(o => {
    return normalizePhoneNumber(o.customerPhone) === normPhone;
  });

  let deliveredCount = 0;
  let returnedCount = 0;
  let cancelledCount = 0;
  let pendingCount = 0;

  customerOrders.forEach(o => {
    const s = o.status;
    if (s === 'delivered' || s === 'settled') deliveredCount += 1;
    else if (s === 'returned') returnedCount += 1;
    else if (s === 'cancelled') cancelledCount += 1;
    else if (['draft', 'confirmed', 'packed', 'shipped'].includes(s)) pendingCount += 1;
  });

  const blacklistRecord = customerBlacklist[normPhone] || customerBlacklist[phone] || null;
  const blacklistRto = Number(blacklistRecord?.rtoCount) || 0;
  const isManuallyBlacklisted = Boolean(blacklistRecord?.isManuallyBlacklisted);
  const blacklistReason = blacklistRecord?.reason || '';

  const totalEffectiveRto = Math.max(returnedCount, blacklistRto);
  const totalCompleted = deliveredCount + totalEffectiveRto;
  const rtoRate = totalCompleted > 0 ? (totalEffectiveRto / totalCompleted) : 0;

  let riskLevel = FRAUD_RISK_LEVELS.NEUTRAL;

  if (isManuallyBlacklisted || totalEffectiveRto >= 2) {
    riskLevel = FRAUD_RISK_LEVELS.HIGH;
  } else if (totalEffectiveRto === 1 || cancelledCount >= 2) {
    riskLevel = FRAUD_RISK_LEVELS.MODERATE;
  } else if (deliveredCount >= 1 && totalEffectiveRto === 0) {
    riskLevel = FRAUD_RISK_LEVELS.LOW;
  }

  const hasWarning = riskLevel === FRAUD_RISK_LEVELS.HIGH || riskLevel === FRAUD_RISK_LEVELS.MODERATE;
  let warningTitle = '';
  let warningMessage = '';
  let actionAdvice = '';
  let badgeLabel = '';
  let badgeColor = 'slate';

  if (riskLevel === FRAUD_RISK_LEVELS.HIGH) {
    badgeColor = 'rose';
    badgeLabel = isEn ? 'High RTO Risk' : 'উচ্চ রিটার্ন ঝুঁকি';
    warningTitle = isEn
      ? `⚠️ High Fraud Risk: ${totalEffectiveRto} Past RTOs`
      : `⚠️ ফ্রড ও রিটার্ন ঝুঁকি: অতীতে ${totalEffectiveRto} বার পার্সেল ফেরত (RTO) হয়েছে!`;
    warningMessage = isEn
      ? `This customer has a high return history (${totalEffectiveRto} returned out of ${totalCompleted} orders).`
      : `এই গ্রাহকের অতীতে ${totalEffectiveRto}টি পার্সেল রিটার্ন আসার রেকর্ড রয়েছে। ${blacklistReason ? `(কারণ: ${blacklistReason})` : ''}`;
    actionAdvice = isEn
      ? `Collect at least Tk ${deliveryCharge} delivery charge in advance via bKash/Nagad before shipping.`
      : `পার্সেল বুক করার পূর্বে ডেলিভারি চার্জ (৳${deliveryCharge}) বিকাশ/নগদে অগ্রিম গ্রহণ করুন।`;
  } else if (riskLevel === FRAUD_RISK_LEVELS.MODERATE) {
    badgeColor = 'amber';
    badgeLabel = isEn ? 'Moderate Risk' : 'মাঝারি ঝুঁকি';
    warningTitle = isEn
      ? `⚠️ Moderate Risk: 1 Past RTO / Cancellation`
      : `⚠️ সতর্কতা: অতীতে ১টি পার্সেল রিটার্ন/বাতিল হয়েছে`;
    warningMessage = isEn
      ? `Customer has 1 previous returned or cancelled parcel.`
      : `এই গ্রাহকের পূর্বে ১টি পার্সেল রিটার্ন বা বাতিলের রেকর্ড আছে।`;
    actionAdvice = isEn
      ? `Collecting advance delivery charge is recommended.`
      : `অগ্রিম ডেলিভারি চার্জ নেওয়া নিরাপদ হতে পারে।`;
  } else if (riskLevel === FRAUD_RISK_LEVELS.LOW) {
    badgeColor = 'emerald';
    badgeLabel = isEn ? `Trusted (${deliveredCount} Delivered)` : `বিশ্বস্ত ক্রেতা (${deliveredCount}টি সফল)`;
  } else {
    badgeColor = 'slate';
    badgeLabel = isEn ? 'New Customer' : 'নতুন ক্রেতা';
  }

  return {
    phone: normPhone,
    riskLevel,
    rtoCount: totalEffectiveRto,
    deliveredCount,
    cancelledCount,
    totalOrders: customerOrders.length,
    isManuallyBlacklisted,
    blacklistReason,
    hasWarning,
    warningTitle,
    warningMessage,
    actionAdvice,
    badgeLabel,
    badgeColor,
    recommendedAdvance: hasWarning ? deliveryCharge : 0,
  };
}

/**
 * Deterministically blacklists a customer in state.
 */
export function blacklistCustomerInState(state, payload) {
  const rawPhone = typeof payload === 'string' ? payload : (payload?.phone || '');
  const phone = normalizePhoneNumber(rawPhone);
  if (!phone) return state;
  const current = { ...(state?.customerBlacklist || {}) };
  current[phone] = {
    rtoCount: Number(payload?.rtoCount) >= 0 ? Number(payload.rtoCount) : (current[phone]?.rtoCount || 1),
    isManuallyBlacklisted: true,
    reason: (typeof payload === 'object' && payload?.reason) ? payload.reason : (state?.language === 'en' ? 'Manually blacklisted' : 'ম্যানুয়ালি ব্ল্যাকলিস্টেড'),
    updatedAt: new Date().toISOString(),
    lastRtoDate: current[phone]?.lastRtoDate || new Date().toISOString(),
  };
  return {
    ...state,
    customerBlacklist: current,
  };
}

/**
 * Deterministically unblacklists a customer in state.
 */
export function unblacklistCustomerInState(state, payload) {
  const rawPhone = typeof payload === 'string' ? payload : (payload?.phone || '');
  const phone = normalizePhoneNumber(rawPhone);
  if (!phone) return state;
  const current = { ...(state?.customerBlacklist || {}) };
  delete current[phone];
  return {
    ...state,
    customerBlacklist: current,
  };
}

/**
 * Updates customer blacklist map upon parcel return (RTO) with phone normalization.
 */
export function recordRtoInBlacklist(blacklist, rawPhone) {
  const phone = normalizePhoneNumber(rawPhone);
  if (!phone) return blacklist || {};
  const current = { ...(blacklist || {}) };
  const existing = current[phone] || { rtoCount: 0 };
  current[phone] = {
    ...existing,
    rtoCount: (existing.rtoCount || 0) + 1,
    lastRtoDate: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return current;
}

