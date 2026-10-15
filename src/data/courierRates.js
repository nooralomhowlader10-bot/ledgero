// ── Bangladesh Courier Rate Table (2024-2025 Data) ──────────────────
// Source: Official courier websites + merchant portals

export const COURIERS = {
  steadfast: {
    id: 'steadfast',
    name: 'Steadfast',
    name_bn: 'স্টেডফাস্ট',
    icon: '🟢',
    insideDhaka: 60,
    outsideDhaka: 130,
    subDistrict: 135,
    codPercent: 1,
    returnChargePercent: 0, // Generally free for contracted merchants
    paymentCycle: 'Next day (on request)',
    paymentCycle_bn: 'পরের দিন (রিকোয়েস্ট করলে)',
    trackingUrl: 'https://steadfast.com.bd/t/', // + tracking_code
    hasApi: true,
    weightLimitKg: 1,
    extraPerKg: 20,
  },
  pathao: {
    id: 'pathao',
    name: 'Pathao Courier',
    name_bn: 'পাঠাও কুরিয়ার',
    icon: '🔴',
    insideDhaka: 70,
    outsideDhaka: 110,
    subDistrict: 120,
    codPercent: 1,
    returnChargePercent: 50, // 50% of delivery cost outside Dhaka
    paymentCycle: 'Next day (auto)',
    paymentCycle_bn: 'পরের দিন (অটো)',
    trackingUrl: 'https://merchant.pathao.com/tracking/', // + consignment_id
    hasApi: true,
    weightLimitKg: 0.5,
    extraPerKg: 20,
  },
  redx: {
    id: 'redx',
    name: 'RedX',
    name_bn: 'রেডএক্স',
    icon: '🔵',
    insideDhaka: 65,
    outsideDhaka: 120,
    subDistrict: 130,
    codPercent: 0, // 0% inside Dhaka, 1% outside
    codPercentOutside: 1,
    returnChargePercent: 50,
    paymentCycle: 'Next day (guarantee)',
    paymentCycle_bn: 'পরের দিন (গ্যারান্টি)',
    trackingUrl: 'https://redx.com.bd/track-parcel/', // + parcel_id
    hasApi: true,
    weightLimitKg: 1,
    extraPerKg: 15,
  },
  paperfly: {
    id: 'paperfly',
    name: 'Paperfly',
    name_bn: 'পেপারফ্লাই',
    icon: '🟡',
    insideDhaka: 70,
    outsideDhaka: 130,
    subDistrict: 130,
    codPercent: 0, // 0% inside Dhaka, 1% outside
    codPercentOutside: 1,
    returnChargePercent: 0, // No additional return charge
    paymentCycle: 'Next working day',
    paymentCycle_bn: 'পরের কার্যদিবস',
    trackingUrl: 'https://go.paperfly.com.bd/merchant/tracking/', 
    hasApi: true,
    weightLimitKg: 1,
    extraPerKg: 15,
  },
  ecourier: {
    id: 'ecourier',
    name: 'eCourier',
    name_bn: 'ই-কুরিয়ার',
    icon: '🟣',
    insideDhaka: 80,
    outsideDhaka: 130,
    subDistrict: 160,
    codPercent: 1, // 1% or ৳10 whichever is higher (inside), 2% outside
    codPercentOutside: 2,
    codMinimum: 10,
    codMinimumOutside: 20,
    returnChargePercent: 50,
    paymentCycle: 'InstaPay (instant to bKash)',
    paymentCycle_bn: 'ইনস্টাপে (তাৎক্ষণিক বিকাশে)',
    trackingUrl: 'https://ecourier.com.bd/tracking/',
    hasApi: true,
    weightLimitKg: 1,
    extraPerKg: 30,
  },
  sundarban: {
    id: 'sundarban',
    name: 'Sundarban Courier',
    name_bn: 'সুন্দরবন কুরিয়ার',
    icon: '🌿',
    insideDhaka: 80,
    outsideDhaka: 140,
    subDistrict: 150,
    codPercent: 1,
    returnChargePercent: 100,
    paymentCycle: 'Manual (branch visit)',
    paymentCycle_bn: 'ম্যানুয়াল (ব্রাঞ্চে যেতে হবে)',
    trackingUrl: 'https://www.sundarbancourier.com/tracking/',
    hasApi: false,
    weightLimitKg: 1,
    extraPerKg: 25,
  },
  other: {
    id: 'other',
    name: 'Other / নিজে ডেলিভারি',
    name_bn: 'অন্যান্য / নিজে ডেলিভারি',
    icon: '📦',
    insideDhaka: 0,
    outsideDhaka: 0,
    subDistrict: 0,
    codPercent: 0,
    returnChargePercent: 0,
    paymentCycle: 'N/A',
    paymentCycle_bn: 'প্রযোজ্য নয়',
    trackingUrl: '',
    hasApi: false,
    weightLimitKg: 0,
    extraPerKg: 0,
  },
};

// Order status definitions with State Machine transitions
export const ORDER_STATUSES = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  SETTLED: 'settled',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
};

export const ORDER_STATUS_LABELS = {
  [ORDER_STATUSES.DRAFT]: { bn: 'খসড়া', en: 'Draft' },
  [ORDER_STATUSES.CONFIRMED]: { bn: 'কনফার্মড', en: 'Confirmed' },
  [ORDER_STATUSES.PACKED]: { bn: 'প্যাক করা হয়েছে', en: 'Packed' },
  [ORDER_STATUSES.SHIPPED]: { bn: 'কুরিয়ারে দেওয়া হয়েছে', en: 'Shipped' },
  [ORDER_STATUSES.DELIVERED]: { bn: 'ডেলিভারি সফল', en: 'Delivered' },
  [ORDER_STATUSES.SETTLED]: { bn: 'টাকা পাওয়া গেছে', en: 'Settled' },
  [ORDER_STATUSES.RETURNED]: { bn: 'ফেরত এসেছে (RTO)', en: 'Returned (RTO)' },
  [ORDER_STATUSES.CANCELLED]: { bn: 'বাতিল', en: 'Cancelled' },
};

export const ORDER_STATUS_COLORS = {
  [ORDER_STATUSES.DRAFT]: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  [ORDER_STATUSES.CONFIRMED]: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  [ORDER_STATUSES.PACKED]: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  [ORDER_STATUSES.SHIPPED]: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  [ORDER_STATUSES.DELIVERED]: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  [ORDER_STATUSES.SETTLED]: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  [ORDER_STATUSES.RETURNED]: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  [ORDER_STATUSES.CANCELLED]: 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
};

// State Machine: valid transitions
export const VALID_TRANSITIONS = {
  [ORDER_STATUSES.DRAFT]: [ORDER_STATUSES.CONFIRMED, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.CONFIRMED]: [ORDER_STATUSES.PACKED, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.PACKED]: [ORDER_STATUSES.SHIPPED, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.SHIPPED]: [ORDER_STATUSES.DELIVERED, ORDER_STATUSES.RETURNED],
  [ORDER_STATUSES.DELIVERED]: [ORDER_STATUSES.SETTLED],
  [ORDER_STATUSES.SETTLED]: [], // terminal
  [ORDER_STATUSES.RETURNED]: [], // terminal
  [ORDER_STATUSES.CANCELLED]: [], // terminal
};

// Payment status definitions
export const PAYMENT_STATUSES = {
  AWAITING_PAYMENT: 'awaiting_payment',
  SUBMITTED_FOR_VERIFICATION: 'submitted_for_verification',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  DUE_ON_DELIVERY: 'due_on_delivery',
  PAID_ON_DELIVERY: 'paid_on_delivery',
};

export const PAYMENT_STATUS_LABELS = {
  [PAYMENT_STATUSES.AWAITING_PAYMENT]: { bn: 'পেমেন্ট বাকি (অপেক্ষমান)', en: 'Awaiting Payment' },
  [PAYMENT_STATUSES.SUBMITTED_FOR_VERIFICATION]: { bn: 'যাচাই প্রক্রিয়াধীন (TrxID জমা)', en: 'Submitted for Verification' },
  [PAYMENT_STATUSES.VERIFIED]: { bn: 'পেমেন্ট নিশ্চিত', en: 'Payment Verified' },
  [PAYMENT_STATUSES.REJECTED]: { bn: 'পেমেন্ট মেলেনি (বাতিল)', en: 'Payment Rejected' },
  [PAYMENT_STATUSES.DUE_ON_DELIVERY]: { bn: 'ডেলিভারিতে প্রদেয় (COD)', en: 'Due on Delivery' },
  [PAYMENT_STATUSES.PAID_ON_DELIVERY]: { bn: 'পরিশোধিত', en: 'Paid on Delivery' },
};

export const PAYMENT_STATUS_COLORS = {
  [PAYMENT_STATUSES.AWAITING_PAYMENT]: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700',
  [PAYMENT_STATUSES.SUBMITTED_FOR_VERIFICATION]: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-300 dark:border-sky-700',
  [PAYMENT_STATUSES.VERIFIED]: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700',
  [PAYMENT_STATUSES.REJECTED]: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-300 dark:border-rose-700',
  [PAYMENT_STATUSES.DUE_ON_DELIVERY]: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
  [PAYMENT_STATUSES.PAID_ON_DELIVERY]: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border border-green-300 dark:border-green-700',
};

/**
 * Maps incoming order payment method (e.g. 'bkash_manual', 'nagad_manual', 'rocket_manual')
 * to the best available ledger wallet in state.dayData.wallets.
 * Supports:
 * - General retail: 'bkash', 'nagad', 'rocket', 'digital_payment'
 * - Telecom businesses: 'bkash_personal', 'bkash_agent', 'nagad_personal', 'nagad_uddokta', 'rocket_personal'
 * Does NOT fall back to 'hand_cash' for mobile banking! Returns empty string if no safe match.
 */
export function getRecommendedWalletForPayment(paymentMethod, wallets = {}) {
  const keys = Object.keys(wallets || {});
  if (keys.length === 0) return '';

  const method = String(paymentMethod || '').toLowerCase();
  
  if (method.includes('bkash')) {
    const exact = keys.find(k => k === 'bkash');
    if (exact) return exact;
    const personal = keys.find(k => k === 'bkash_personal');
    if (personal) return personal;
    const prefix = keys.find(k => k.startsWith('bkash_'));
    if (prefix) return prefix;
    if (keys.includes('digital_payment')) return 'digital_payment';
  } else if (method.includes('nagad')) {
    const exact = keys.find(k => k === 'nagad');
    if (exact) return exact;
    const personal = keys.find(k => k === 'nagad_personal');
    if (personal) return personal;
    const uddokta = keys.find(k => k === 'nagad_uddokta');
    if (uddokta) return uddokta;
    const prefix = keys.find(k => k.startsWith('nagad_'));
    if (prefix) return prefix;
    if (keys.includes('digital_payment')) return 'digital_payment';
  } else if (method.includes('rocket')) {
    const exact = keys.find(k => k === 'rocket');
    if (exact) return exact;
    const personal = keys.find(k => k === 'rocket_personal');
    if (personal) return personal;
    const prefix = keys.find(k => k.startsWith('rocket_'));
    if (prefix) return prefix;
    if (keys.includes('digital_payment')) return 'digital_payment';
  }

  return keys.includes('digital_payment') ? 'digital_payment' : '';
}

/**
 * Validates whether a receiving wallet is compatible with an order's payment method.
 * Enforces strict accounting isolation: mobile banking payments can NEVER be settled
 * into hand_cash or mismatched provider wallets.
 */
export function isWalletCompatibleWithPayment(paymentMethod, walletKey) {
  if (!walletKey) return false;
  const method = String(paymentMethod || '').toLowerCase();
  const wallet = String(walletKey || '').toLowerCase();

  // Cash on delivery can be received in hand_cash, bank, or courier receivables
  if (method === 'cod') {
    return true;
  }

  // Mobile banking must match provider or generic digital_payment; NEVER hand_cash
  if (method.includes('bkash')) {
    return wallet === 'bkash' || wallet.startsWith('bkash_') || wallet === 'digital_payment';
  }
  if (method.includes('nagad')) {
    return wallet === 'nagad' || wallet.startsWith('nagad_') || wallet === 'digital_payment';
  }
  if (method.includes('rocket')) {
    return wallet === 'rocket' || wallet.startsWith('rocket_') || wallet === 'digital_payment';
  }

  return wallet === 'digital_payment';
}

/**
 * Calculate courier charges and net settlement for an order.
 * @param {string} courierId - courier key from COURIERS
 * @param {number} codAmount - cash to be collected on delivery
 * @param {boolean} isInsideDhaka - delivery location
 * @param {number} weightKg - parcel weight (optional)
 * @returns {{ deliveryCharge, codFee, totalCourierCost, netFromCourier, returnCharge }}
 */
export function calculateCourierCharges(courierId, codAmount, isInsideDhaka = true, weightKg = 0.5) {
  const courier = COURIERS[courierId] || COURIERS.other;
  
  // Delivery charge
  let deliveryCharge = isInsideDhaka ? courier.insideDhaka : courier.outsideDhaka;
  
  // Extra weight
  if (weightKg > courier.weightLimitKg && courier.extraPerKg > 0) {
    const extraKg = Math.ceil(weightKg - courier.weightLimitKg);
    deliveryCharge += extraKg * courier.extraPerKg;
  }
  
  // COD fee
  let codPercent = isInsideDhaka ? courier.codPercent : (courier.codPercentOutside ?? courier.codPercent);
  let codFee = Math.round((codAmount * codPercent) / 100);
  
  // Minimum COD fee (eCourier special case)
  if (courier.codMinimum && isInsideDhaka) {
    codFee = Math.max(codFee, courier.codMinimum);
  }
  if (courier.codMinimumOutside && !isInsideDhaka) {
    codFee = Math.max(codFee, courier.codMinimumOutside);
  }
  
  const totalCourierCost = deliveryCharge + codFee;
  const isDeficit = totalCourierCost > codAmount;
  const shortfall = isDeficit ? totalCourierCost - codAmount : 0;
  const netFromCourier = Math.max(0, codAmount - totalCourierCost);
  
  // Return charge (if RTO)
  const returnCharge = Math.round(deliveryCharge * (courier.returnChargePercent / 100));
  
  return {
    deliveryCharge,
    codFee,
    totalCourierCost,
    netFromCourier,
    shortfall,
    isDeficit,
    rawNetBalance: codAmount - totalCourierCost,
    returnCharge,
  };
}

/**
 * Generate WhatsApp confirmation message template
 */
export function generateWhatsAppMessage(order, courierSettings, lang = 'bn') {
  const items = (order.items || []).map(item => 
    `${item.productName} × ${item.quantity}`
  ).join('\n');
  
  const paymentMethods = [];
  if (courierSettings.bkashNumber) paymentMethods.push(`📱 বিকাশ: ${courierSettings.bkashNumber} (Send Money)`);
  if (courierSettings.nagadNumber) paymentMethods.push(`📱 নগদ: ${courierSettings.nagadNumber}`);
  if (courierSettings.rocketNumber) paymentMethods.push(`📱 রকেট: ${courierSettings.rocketNumber}`);

  if (lang === 'en') {
    return `🛍️ Order Confirmation!\n\nProduct: ${items}\nPrice: Tk ${order.totalAmount} (Cash on Delivery)\n\n✅ To confirm, send Tk ${order.deliveryCharge} delivery charge:\n\n${paymentMethods.join('\n')}\n\nPlease send your TrxID after payment.\nThank you! 🙏`;
  }
  
  return `🛍️ আপনার অর্ডার কনফার্ম করুন!\n\nপণ্য: ${items}\nমূল্য: ৳${order.totalAmount} (ক্যাশ অন ডেলিভারিতে দিবেন)\n\n✅ অর্ডার কনফার্ম করতে ৳${order.deliveryCharge} ডেলিভারি চার্জ আগে পাঠান:\n\n${paymentMethods.join('\n')}\n\nপাঠানোর পর ট্রানজাকশন আইডি (TrxID) এখানে পাঠান।\nধন্যবাদ! 🙏`;
}

/**
 * Generate courier tracking link
 */
export function getCourierTrackingLink(courierId, trackingNumber) {
  const courier = COURIERS[courierId];
  if (!courier || !courier.trackingUrl || !trackingNumber) return null;
  return courier.trackingUrl + trackingNumber;
}

/**
 * Get courier list for dropdown
 */
export function getCourierOptions(lang = 'bn') {
  return Object.values(COURIERS).map(c => ({
    value: c.id,
    label: lang === 'en' ? c.name : c.name_bn,
    icon: c.icon,
  }));
}

/**
 * Actionable bilingual error messages for online order courier settlement
 */
export function getSettleErrorMessage(err, isEn = false) {
  if (!err) return '';
  switch (err.code) {
    case 'missing_settlement_wallet':
      return isEn
        ? `Settlement wallet '${err.wallet || ''}' was not found. Please select an active wallet.`
        : `টাকা গ্রহণের ওয়ালেট '${err.wallet || ''}' পাওয়া যায়নি। দয়া করে একটি সচল ওয়ালেট নির্বাচন করুন।`;
    case 'net_fee_mismatch':
      return isEn
        ? `Net amount mismatch: Expected ৳${err.expectedNet}, provided ৳${err.netAmount} (Discrepancy: ৳${err.discrepancy}). Check 'Approve Adjustment' below and provide reason.`
        : `কুরিয়ার থেকে প্রাপ্ত টাকার গরমিল: প্রত্যাশিত ৳${err.expectedNet}, দেওয়া হয়েছে ৳${err.netAmount} (পার্থক্য: ৳${err.discrepancy})। নিচে 'সমন্বয় অনুমোদন' টিক দিন ও কারণ লিখুন।`;
    case 'courier_fee_exceeds_cod':
      return isEn
        ? `Courier fee (৳${err.courierExpense}) exceeds COD collection (৳${err.codAmount}) by ৳${err.shortfall}. Cannot settle as positive payout.`
        : `কুরিয়ার খরচ (৳${err.courierExpense}) কন্ডিশন COD (৳${err.codAmount})-এর চেয়ে ৳${err.shortfall} বেশি। সাধারণ সেটেলমেন্ট সম্ভব নয়।`;
    case 'missing_adjustment_reason':
      return isEn
        ? 'An adjustment reason (minimum 3 characters) is required when approving fee adjustment.'
        : 'সমন্বয় অনুমোদনের জন্য কারণ (কমপক্ষে ৩ অক্ষর) উল্লেখ করা বাধ্যতামূলক।';
    case 'invalid_settlement_amounts':
      return isEn
        ? 'COD amount, courier charge, or COD fee are invalid numbers.'
        : 'COD বা কুরিয়ার চার্জের পরিমাণ সঠিক সংখ্যা নয়।';
    case 'negative_settlement_amount':
      return isEn
        ? 'Net settlement amount cannot be negative.'
        : 'নেট সেটেলমেন্টের পরিমাণ ঋণাত্মক হতে পারে না।';
    case 'net_exceeds_cod':
      return isEn
        ? `Net settlement (৳${err.netAmount}) cannot exceed recorded COD obligation (৳${err.codAmount}).`
        : `নেট টাকা (৳${err.netAmount}) মোট COD পাওনা (৳${err.codAmount})-এর চেয়ে বেশি হতে পারে না।`;
    default:
      return err.message || (isEn ? 'Settlement could not be completed.' : 'সেটেলমেন্ট সম্পন্ন করা যায়নি।');
  }
}

