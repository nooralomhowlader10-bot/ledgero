/**
 * taxConfig.js — Country-Specific Tax Profiles
 * 
 * Covers Bangladesh (NBR), India (GST), Pakistan (FBR),
 * Nepal, Sri Lanka, and a Custom profile.
 * 
 * Used when Advanced Mode → taxTracking feature is ON.
 */

export const TAX_PROFILES = {
  BD: {
    name: 'Bangladesh (NBR)',
    name_bn: 'বাংলাদেশ (NBR)',
    currency: 'BDT',
    currencySymbol: '৳',
    rates: [
      { id: 'vat_15',      rate: 15,   label: 'Standard VAT 15%',    label_bn: 'স্ট্যান্ডার্ড ভ্যাট ১৫%' },
      { id: 'vat_10',      rate: 10,   label: 'Truncated 10%',       label_bn: 'সংক্ষিপ্ত ১০%' },
      { id: 'vat_7_5',     rate: 7.5,  label: 'Truncated 7.5%',      label_bn: 'সংক্ষিপ্ত ৭.৫%' },
      { id: 'vat_5',       rate: 5,    label: 'Truncated 5%',        label_bn: 'সংক্ষিপ্ত ৫%' },
      { id: 'turnover_4',  rate: 4,    label: 'Turnover Tax 4%',     label_bn: 'টার্নওভার ট্যাক্স ৪%' },
      { id: 'exempt',      rate: 0,    label: 'Exempt / Zero',       label_bn: 'অব্যাহতি / শূন্য' },
    ],
    threshold: { amount: 5000000, label: 'BDT 50 Lakh', label_bn: '৫০ লক্ষ টাকা' },
    invoiceForm: 'Mushak 6.3',
    returnForm: 'Mushak 9.1',
    returnFrequency: 'Monthly',
    binRequired: true, // Business Identification Number
  },

  IN: {
    name: 'India (GST)',
    name_bn: 'ভারত (GST)',
    currency: 'INR',
    currencySymbol: '₹',
    rates: [
      { id: 'gst_28', rate: 28, label: 'GST 28%',   label_bn: 'GST ২৮%' },
      { id: 'gst_18', rate: 18, label: 'GST 18%',   label_bn: 'GST ১৮%' },
      { id: 'gst_12', rate: 12, label: 'GST 12%',   label_bn: 'GST ১২%' },
      { id: 'gst_5',  rate: 5,  label: 'GST 5%',    label_bn: 'GST ৫%' },
      { id: 'gst_0',  rate: 0,  label: 'Nil Rated',  label_bn: 'শূন্য হার' },
    ],
    threshold: { amount: 4000000, label: 'INR 40 Lakh', label_bn: '₹৪০ লক্ষ' },
    hasMultiLayer: true, // CGST + SGST for intra-state
    returnForms: ['GSTR-1', 'GSTR-3B', 'GSTR-9'],
    returnFrequency: 'Monthly',
    gstinRequired: true, // GST Identification Number
  },

  PK: {
    name: 'Pakistan (FBR)',
    name_bn: 'পাকিস্তান (FBR)',
    currency: 'PKR',
    currencySymbol: 'Rs',
    rates: [
      { id: 'st_18',   rate: 18, label: 'Sales Tax 18%', label_bn: 'সেলস ট্যাক্স ১৮%' },
      { id: 'st_0',    rate: 0,  label: 'Exempt',         label_bn: 'অব্যাহতি' },
    ],
    threshold: { amount: 3000000, label: 'PKR 3 Million', label_bn: 'PKR ৩০ লক্ষ' },
    returnFrequency: 'Monthly',
  },

  NP: {
    name: 'Nepal',
    name_bn: 'নেপাল',
    currency: 'NPR',
    currencySymbol: 'रू',
    rates: [
      { id: 'vat_13', rate: 13, label: 'VAT 13%', label_bn: 'ভ্যাট ১৩%' },
      { id: 'vat_0',  rate: 0,  label: 'Exempt',   label_bn: 'অব্যাহতি' },
    ],
    threshold: { amount: 5000000, label: 'NPR 5 Million', label_bn: 'NPR ৫০ লক্ষ' },
    returnFrequency: 'Monthly',
  },

  LK: {
    name: 'Sri Lanka',
    name_bn: 'শ্রীলঙ্কা',
    currency: 'LKR',
    currencySymbol: 'Rs',
    rates: [
      { id: 'vat_18', rate: 18, label: 'VAT 18%', label_bn: 'ভ্যাট ১৮%' },
      { id: 'vat_0',  rate: 0,  label: 'Exempt',   label_bn: 'অব্যাহতি' },
    ],
    threshold: { amount: 60000000, label: 'LKR 60 Million', label_bn: 'LKR ৬ কোটি' },
    returnFrequency: 'Quarterly',
  },

  CUSTOM: {
    name: 'Custom / Other',
    name_bn: 'কাস্টম / অন্যান্য',
    currency: '',
    currencySymbol: '',
    rates: [
      { id: 'custom_rate', rate: 0, label: 'Custom Rate', label_bn: 'কাস্টম হার' },
    ],
    threshold: null,
    returnFrequency: '',
  },
};

/**
 * Get the tax profile for a given region code.
 * @param {string} regionCode - e.g. 'BD', 'IN', 'PK'
 * @returns {Object} Tax profile
 */
export function getTaxProfile(regionCode = 'BD') {
  return TAX_PROFILES[regionCode] || TAX_PROFILES.CUSTOM;
}

/**
 * Calculate tax with input/output tracking.
 * @param {number} amount - Base amount
 * @param {number} rate - Tax rate percentage
 * @param {'output'|'input'} direction - Output = on sales, Input = on purchases
 * @returns {{ baseAmount, taxAmount, totalAmount, direction }}
 */
export function calculateTax(amount, rate, direction = 'output') {
  const taxAmount = Math.round((amount * rate) / 100);
  return {
    baseAmount: amount,
    taxAmount,
    totalAmount: amount + taxAmount,
    rate,
    direction,
  };
}

/**
 * Compute net tax liability from transactions.
 * @param {Array} taxEntries - Array of { taxAmount, direction }
 * @returns {{ outputTotal, inputTotal, netPayable }}
 */
export function computeNetTaxLiability(taxEntries = []) {
  let outputTotal = 0; // Tax collected on sales
  let inputTotal = 0;  // Tax paid on purchases

  taxEntries.forEach(entry => {
    if (entry.direction === 'output') {
      outputTotal += entry.taxAmount || 0;
    } else {
      inputTotal += entry.taxAmount || 0;
    }
  });

  return {
    outputTotal: Math.round(outputTotal),
    inputTotal: Math.round(inputTotal),
    netPayable: Math.round(outputTotal - inputTotal),
  };
}
