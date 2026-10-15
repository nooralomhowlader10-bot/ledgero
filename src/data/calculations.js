// ── Currency Rounding (IEEE 754 Float Fix) ──────────────────────────
// All BDT currency math must use roundBDT() to prevent floating-point
// errors like 0.1 + 0.2 = 0.30000000000000004.
// This rounds to 2 decimal places using integer arithmetic.

/**
 * Round a currency amount to 2 decimal places (paisa precision).
 * Uses Math.round with integer multiplication to avoid float drift.
 * @param {number} amount - raw float amount
 * @returns {number} rounded to 2 decimal places
 */
export function roundBDT(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// ── Inventory Calculations ──────────────────────────────────────────

/**
 * Calculate units sold from stock movement.
 * Subtracts damagedStock (written-off units) so damaged items are never
 * mistakenly counted as sold units in revenue/profit reports.
 * @returns {number} units sold (clamped to 0 minimum)
 */
export function calcUnitsSold(openingStock, addedStock, closingStock, damagedStock = 0) {
  const open = Number(openingStock) || 0;
  const added = Number(addedStock) || 0;
  const close = closingStock !== undefined && closingStock !== null ? Number(closingStock) : (open + added);
  const damaged = Number(damagedStock) || 0;
  return Math.max(0, (open + added) - close - damaged);
}

/**
 * Calculate sales revenue from units sold.
 */
export function calcSalesRevenue(unitsSold, sellPrice) {
  return roundBDT(unitsSold * sellPrice);
}

/**
 * Calculate cost of goods sold.
 */
export function calcCOGS(unitsSold, buyPrice) {
  return roundBDT(unitsSold * buyPrice);
}

/**
 * Calculate profit for a single item.
 */
export function calcItemProfit(salesRevenue, cogs) {
  return roundBDT(salesRevenue - cogs);
}

/**
 * Calculate full inventory summary for a single item.
 * Uses accumulated FIFO COGS (item.fifoCogs / item.fifoSoldUnits) when available,
 * and subtracts damagedStock so written-off items are excluded from unitsSold.
 * @returns {{ unitsSold, salesRevenue, cogs, profit }}
 */
export function calcItemSummary(item) {
  const unitsSold = calcUnitsSold(
    item.openingStock,
    item.addedStock,
    item.closingStock,
    item.damagedStock || 0
  );
  // P1-1 Fix: Use accumulated actual revenue (fifoRevenue) when available,
  // instead of recalculating from current sellPrice which changes retroactively
  const trackedRevenue = Number(item.fifoRevenue) || 0;
  const salesRevenue = (trackedRevenue > 0 && unitsSold > 0)
    ? roundBDT(trackedRevenue)
    : calcSalesRevenue(unitsSold, item.sellPrice);

  const trackedUnits = Number(item.fifoSoldUnits) || 0;
  const trackedCogs = Number(item.fifoCogs) || 0;
  let cogs;
  if (trackedUnits > 0 && unitsSold >= trackedUnits) {
    const untrackedUnits = unitsSold - trackedUnits;
    cogs = roundBDT(trackedCogs + calcCOGS(untrackedUnits, item.buyPrice));
  } else {
    cogs = calcCOGS(unitsSold, item.buyPrice);
  }

  const profit = calcItemProfit(salesRevenue, cogs);
  return { unitsSold, salesRevenue, cogs, profit };
}

/**
 * Calculate total inventory profit across all items.
 * @param {Array} items - inventory items with stock data
 * @returns {{ totalRevenue, totalCOGS, totalProfit, totalUnitsSold }}
 */
export function calcInventoryTotals(items) {
  let totalRevenue = 0;
  let totalCOGS = 0;
  let totalProfit = 0;
  let totalUnitsSold = 0;

  items.forEach((item) => {
    const summary = calcItemSummary(item);
    totalRevenue += summary.salesRevenue;
    totalCOGS += summary.cogs;
    totalProfit += summary.profit;
    totalUnitsSold += summary.unitsSold;
  });

  return {
    totalRevenue: roundBDT(totalRevenue),
    totalCOGS: roundBDT(totalCOGS),
    totalProfit: roundBDT(totalProfit),
    totalUnitsSold,
  };
}

// ── Cash & Reconciliation ───────────────────────────────────────────

/**
 * Calculate the expected hand cash at end of day.
 *
 * Expected = Opening Cash
 *          + Sales Revenue (from inventory)
 *          + Services Income (photocopy + studio)
 *          + Loan Collected
 *          - Expenses
 *          - Personal Draws
 *          - Loan Given
 *          + Net Fund Transfers IN to cash
 *          - Net Fund Transfers OUT from cash
 */
export function calcExpectedHandCash({
  openingCash,
  salesRevenue,
  servicesIncome,
  rechargeIncome = 0,
  loanCollected,
  loanTaken = 0,
  loanRepaid = 0,
  ownerGave = 0,
  ownerTook = 0,
  expenses,
  personalDraw,
  loanGiven,
  fundTransferNet, // positive = cash received, negative = cash sent out
  assetSales = 0,
  assetPurchases = 0,
  taxPayments = 0,
  stockPurchases = 0,
}) {
  return roundBDT(
    openingCash +
    salesRevenue +
    servicesIncome +
    rechargeIncome +
    loanCollected +
    loanTaken +
    ownerGave +
    assetSales -
    loanRepaid -
    expenses -
    personalDraw -
    ownerTook -
    loanGiven -
    assetPurchases -
    taxPayments -
    stockPurchases +
    fundTransferNet
  );
}

/**
 * Calculate mismatch between expected and actual cash.
 * Positive = extra cash in drawer, Negative = cash missing.
 */
export function calcCashMismatch(expectedCash, actualCash) {
  return roundBDT(actualCash - expectedCash);
}

// ── Daily Profit ────────────────────────────────────────────────────

/**
 * Calculate total daily profit.
 * Profit = Inventory Profit + Services + Recharge Profit - Expenses
 * Note: Personal draws, loans, fund transfers, owner gave/took do NOT affect profit.
 */
export function calcTotalDailyProfit({
  inventoryProfit = 0,
  photocopyTotal = 0,
  studioTotal = 0,
  rechargeProfit = 0,
  totalExpenses = 0,
  damageLoss = 0,
  transferFees = 0,
}) {
  return roundBDT(inventoryProfit + photocopyTotal + studioTotal + rechargeProfit - totalExpenses - damageLoss - transferFees);
}

// ── Transaction Aggregation ─────────────────────────────────────────

/**
 * Aggregate transactions by type for daily summary.
 * @param {Array} transactions
 * @returns {Object} totals by type
 */
export function aggregateTransactions(transactions = []) {
  const totals = {
    expenses: 0,
    personalDraw: 0,
    ownerGave: 0,
    ownerTook: 0,
    loanGiven: 0,
    loanCollected: 0,
    loanTaken: 0,
    loanRepaid: 0,
    fundTransferCashIn: 0,  // cash received from digital wallets
    fundTransferCashOut: 0, // cash sent to digital wallets
    transferFees: 0,
    photocopy: 0,
    studio: 0,
    stockSalesRevenue: 0,
    stockSalesProfit: 0,
    stockPurchasesCost: 0,
    creditSalesRevenue: 0,
    creditSalesCOGS: 0,
    rechargeTotal: 0,
    rechargeProfit: 0,
    rechargeFromRetail: 0,
    rechargeFromBkash: 0,
    rechargeFromNagad: 0,
    rechargeFromHandCash: 0,
    cashAdjustment: 0,
    damageLoss: 0,
  };

  (transactions || []).forEach((tx) => {
    // P0-1 Fix: Skip reversed originals and reversal records so reports show net-zero after reversal
    if (tx.reversed || tx.isReversal) return;
    switch (tx.type) {
      case 'cash_adjustment':
        totals.cashAdjustment += tx.amount || 0;
        break;
      case 'expense':
        if (tx.subType !== 'online_order_refund') {
          totals.expenses += tx.amount || 0;
        }
        break;
      case 'personal_draw':
        totals.personalDraw += tx.amount || 0;
        break;
      case 'owner_gave':
        totals.ownerGave += tx.amount || 0;
        break;
      case 'owner_took':
        totals.ownerTook += tx.amount || 0;
        break;
      case 'loan_given':
      case 'due_given':
      case 'baki_given':
        totals.loanGiven += tx.amount || 0;
        break;
      case 'loan_collected':
      case 'baki_received':
      case 'due_collected':
      case 'due_received':
      case 'debt_collection':
        totals.loanCollected += tx.amount || 0;
        break;
      case 'loan_taken':
        totals.loanTaken += tx.amount || 0;
        break;
      case 'loan_repaid':
        totals.loanRepaid += tx.amount || 0;
        break;
      case 'stock_sale':
        totals.stockSalesRevenue += tx.amount || 0;
        totals.stockSalesProfit += tx.profit || 0;
        break;
      case 'stock_purchase':
        totals.stockPurchasesCost += tx.amount || 0;
        break;
      case 'recharge':
        totals.rechargeTotal += tx.amount || 0;
        totals.rechargeProfit += tx.profit || 0;
        if (tx.fromWallet === 'retail_apps') {
          totals.rechargeFromRetail += tx.amount || 0;
        } else if (tx.fromWallet === 'bkash_personal') {
          totals.rechargeFromBkash += tx.amount || 0;
        } else if (tx.fromWallet === 'nagad_personal') {
          totals.rechargeFromNagad += tx.amount || 0;
        } else if (tx.fromWallet === 'hand_cash') {
          totals.rechargeFromHandCash += tx.amount || 0;
          totals.rechargeFromHandCashProfit = (totals.rechargeFromHandCashProfit || 0) + (tx.profit || 0);
        }
        break;
      case 'fund_transfer':
        if (tx.toWallet === 'hand_cash') {
          totals.fundTransferCashIn += tx.amount || 0;
        }
        if (tx.fromWallet === 'hand_cash') {
          totals.fundTransferCashOut += tx.amount || 0;
        }
        break;
      case 'service_income':
        if (tx.serviceType === 'photocopy') {
          totals.photocopy += tx.amount || 0;
        } else if (tx.serviceType === 'studio') {
          totals.studio += tx.amount || 0;
        }
        break;
      case 'credit_sale':
        totals.creditSalesRevenue += tx.amount || 0;
        totals.creditSalesCOGS += tx.cost || 0;
        break;
      case 'transfer_fee':
        totals.transferFees += tx.amount || 0;
        break;
      case 'damage_loss':
        totals.damageLoss = (totals.damageLoss || 0) + (tx.amount || 0);
        break;
      case 'asset_purchase':
        totals.assetPurchases = (totals.assetPurchases || 0) + (tx.amount || 0);
        break;
      case 'asset_sale':
        totals.assetSales = (totals.assetSales || 0) + (tx.amount || 0);
        break;
      case 'tax_payment':
        totals.taxPayments = (totals.taxPayments || 0) + (tx.amount || 0);
        break;
    }
  });

  totals.fundTransferNet = roundBDT(totals.fundTransferCashIn - totals.fundTransferCashOut);
  totals.servicesTotal = roundBDT(totals.photocopy + totals.studio);

  // Round all accumulated totals to prevent float drift
  Object.keys(totals).forEach(key => {
    if (typeof totals[key] === 'number') {
      totals[key] = roundBDT(totals[key]);
    }
  });

  return totals;
}

// ── Suspense / Cash Adjustment ──────────────────────────────────────

/**
 * Calculate cumulative suspense balance from cash adjustments.
 * Positive = cumulative surplus, Negative = cumulative shortage.
 * @param {Array} transactions - all transactions including cash_adjustment type
 * @returns {number} running suspense total
 */
export function calcCumulativeSuspense(transactions = []) {
  return transactions
    .filter(tx => tx.type === 'cash_adjustment')
    .reduce((sum, tx) => sum + (tx.amount || 0), 0);
}

/**
 * Calculate aging bucket for a contact based on last transaction date.
 * @param {string} lastTxDate - ISO date string or YYYY-MM-DD
 * @param {string} today - YYYY-MM-DD
 * @returns {{ days: number, bucket: string, severity: string }}
 */
export function calcAgingBucket(lastTxDate, today) {
  if (!lastTxDate || !today) return { days: 0, bucket: '0-30', severity: 'low' };
  
  const last = new Date(lastTxDate);
  const now = new Date(today);
  const diffMs = now.getTime() - last.getTime();
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  
  if (days <= 30) return { days, bucket: '0-30', severity: 'low' };
  if (days <= 60) return { days, bucket: '31-60', severity: 'medium' };
  if (days <= 90) return { days, bucket: '61-90', severity: 'high' };
  return { days, bucket: '90+', severity: 'critical' };
}

// ── Formatting Helpers ──────────────────────────────────────────────

/**
 * Format a number as BDT currency string.
 * @param {number} amount
 * @param {string} lang — 'bn' for ৳ symbol, 'en' for Tk
 * @returns {string} e.g. "৳24,500" or "Tk 24,500"
 */
export function formatBDT(amount, lang = 'bn') {
  const symbol = lang === 'en' ? 'Tk ' : '৳';
  if (amount === undefined || amount === null || isNaN(amount)) return `${symbol}0`;
  const absAmount = Math.abs(amount);
  const formatted = absAmount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${formatted}`;
}

/**
 * Format amount with privacy mode masking.
 * @param {number} amount
 * @param {boolean} isPrivacy
 * @param {string} lang — 'bn' or 'en'
 * @returns {string} e.g. "৳ ••••••" or "Tk 24,500"
 */
export function formatBDTWithPrivacy(amount, isPrivacy = false, lang = 'bn') {
  const symbol = lang === 'en' ? 'Tk' : '৳';
  if (isPrivacy) return `${symbol} ••••••`;
  return formatBDT(amount, lang);
}

// ── Multi-Currency Configuration (IAS 21) ───────────────────────────
export const CURRENCIES = {
  BDT: { code: 'BDT', symbol: '৳', name: 'BDT (বাংলাদেশী টাকা)', name_en: 'BDT (Bangladeshi Taka)', rate: 1 },
  USD: { code: 'USD', symbol: '$', name: 'USD (US Dollar)', rate: 0.0083 },
  EUR: { code: 'EUR', symbol: '€', name: 'EUR (Euro)', rate: 0.0076 },
  INR: { code: 'INR', symbol: '₹', name: 'INR (ভারতীয় রুপি)', name_en: 'INR (Indian Rupee)', rate: 0.73 },
  SAR: { code: 'SAR', symbol: '﷼', name: 'SAR (সৌদি রিয়াল)', name_en: 'SAR (Saudi Riyal)', rate: 0.031 },
  AED: { code: 'AED', symbol: 'د.إ', name: 'AED (ইউএই দিরহাম)', name_en: 'AED (UAE Dirham)', rate: 0.031 },
  GBP: { code: 'GBP', symbol: '£', name: 'GBP (ব্রিটিশ পাউন্ড)', name_en: 'GBP (British Pound)', rate: 0.0065 },
};

export function formatAppCurrency(amount, currency = 'BDT', lang = 'bn') {
  const curr = CURRENCIES[currency] || CURRENCIES.BDT;
  const symbol = curr.symbol;
  if (amount === undefined || amount === null || isNaN(amount)) return `${symbol}0`;
  const converted = curr.code === 'BDT' ? amount : amount * curr.rate;
  const absAmount = Math.abs(converted);
  const formatted = absAmount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const sign = converted < 0 ? '-' : '';
  return `${sign}${symbol}${formatted}`;
}
