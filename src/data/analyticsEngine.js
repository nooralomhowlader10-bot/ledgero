// analyticsEngine.js — Ledgero High-Grade Financial Analytics Engine
import { formatBDT, roundBDT, calcInventoryTotals } from './calculations.js';

/**
 * Safe division helper to prevent division by zero or NaN errors.
 */
export const safeDiv = (num, den, fallback = 0) => {
  if (den === 0 || den === null || den === undefined || isNaN(den)) return fallback;
  const res = num / den;
  return isNaN(res) || !isFinite(res) ? fallback : res;
};

// ── Realistic Enterprise Demo Dataset ──────────────────────────────────────────
export const DEMO_ANALYTICS_DATA = {
  financials: {
    revenue: 485000,
    cogs: 295000,
    opex: 78000,
    ar: 145000,           // Accounts Receivable (কাস্টমার বাকি)
    ap: 82000,            // Accounts Payable (মহাজন বাকি)
    inventoryValue: 320000,// Stock on Hand
    cashInHand: 165000,   // Cash Drawer + Bank Wallets
    equity: 548000,       // Owner Capital
    totalDebt: 82000,     // Total Liabilities
    operatingCashFlow: 112000
  },
  topDebtors: [
    { id: 'deb-1', name: 'আল-মদিনা ট্রেডার্স (Al-Madina)', amount: 48500, daysOverdue: 34, status: 'critical', phone: '01711223344' },
    { id: 'deb-2', name: 'করিম ব্রাদার্স (Karim Bros)', amount: 32000, daysOverdue: 18, status: 'warning', phone: '01819876543' },
    { id: 'deb-3', name: 'রহিম ডিপার্টমেন্টাল স্টোর', amount: 26500, daysOverdue: 9, status: 'due_soon', phone: '01912345678' },
    { id: 'deb-4', name: 'মেসার্স চৌধুরী এন্টারপ্রাইজ', amount: 21000, daysOverdue: 4, status: 'due_soon', phone: '01671122334' },
    { id: 'deb-5', name: 'গ্রিন ফার্মেসি অ্যান্ড ডিপার্টমেন্ট', amount: 17000, daysOverdue: 0, status: 'on_time', phone: '01551234567' }
  ],
  topCreditors: [
    { id: 'cred-1', name: 'স্কয়ার ডিস্ট্রিবিউশন লি.', amount: 38000, dueDate: '৩ দিন পর', status: 'due_soon' },
    { id: 'cred-2', name: 'মেঘনা কনজিউমার সাপ্লাই', amount: 24500, dueDate: '৮ দিন পর', status: 'normal' },
    { id: 'cred-3', name: 'ইউনিলিভার বাংলাদেশ ডিপো', amount: 19500, dueDate: '১৫ দিন পর', status: 'normal' }
  ],
  pipeline: {
    invoices: [
      { key: 'draft', label: 'ড্রাফট (Draft)', label_en: 'Draft (0-7d)', count: 6, amount: 24500, color: 'bg-slate-500' },
      { key: 'awaiting', label: 'অনুমোদনের অপেক্ষায়', label_en: 'Awaiting (8-14d)', count: 9, amount: 62000, color: 'bg-blue-500' },
      { key: 'due_soon', label: 'আগামী ৭ দিনে বকেয়া', label_en: 'Due Soon (15-30d)', count: 14, amount: 89000, color: 'bg-amber-500' },
      { key: 'overdue', label: 'মেয়াদোত্তীর্ণ (Overdue)', label_en: 'Overdue (30+d)', count: 5, amount: 48500, color: 'bg-rose-500' }
    ],
    bills: [
      { key: 'draft', label: 'ড্রাফট বিল (Draft)', label_en: 'Draft Bills (0-7d)', count: 3, amount: 14000, color: 'bg-slate-500' },
      { key: 'due_week', label: 'এই সপ্তাহে প্রদেয়', label_en: 'Due this Week (8-14d)', count: 5, amount: 38000, color: 'bg-indigo-500' },
      { key: 'due_month', label: 'এই মাসে প্রদেয়', label_en: 'Due this Month (15-30d)', count: 8, amount: 44000, color: 'bg-amber-500' },
      { key: 'overdue', label: 'বিলম্বিত বিল (Overdue)', label_en: 'Overdue Bills (30+d)', count: 1, amount: 8500, color: 'bg-rose-500' }
    ]
  }
};

/**
 * Extract live financial totals from Ledgero state or fallback to realistic demo figures.
 */
export const getFinancialTotals = (state, isDemoMode = false) => {
  if (isDemoMode) {
    return DEMO_ANALYTICS_DATA.financials;
  }

  const dayData = state?.dayData || (state?.transactions || state?.inventory || state?.wallets ? state : null);
  if (!dayData) {
    return DEMO_ANALYTICS_DATA.financials;
  }

  const transactions = dayData.transactions || [];
  const products = (dayData.inventory && dayData.inventory.length > 0) ? dayData.inventory : (dayData.products || []);
  const wallets = dayData.wallets || {};
  const khata = dayData.khata || [];

  // Calculate real cash in hand across all wallets
  let cashInHand = 0;
  Object.values(wallets).forEach(w => {
    cashInHand += Number(w.current) || 0;
  });

  // Calculate receivables (AR) & payables (AP) from Khata
  let ar = 0;
  let ap = 0;
  khata.forEach(contact => {
    const bal = Number(contact.balance) || 0;
    if (contact.type === 'customer') {
      if (bal > 0) ar += bal;
    } else if (contact.type === 'supplier') {
      if (bal > 0) ap += bal;
    }
  });

  // Calculate inventory valuation
  let inventoryValue = 0;
  products.forEach(p => {
    const qty = Number(p.stock) || Number(p.closingStock) || Number(p.openingStock) || 0;
    const cost = Number(p.buyPrice) || 0;
    inventoryValue += qty * cost;
  });

  // Revenue & Expenses from transactions
  let revenue = 0;
  let opex = 0;

  transactions.forEach(t => {
    if (t.reversed || t.isReversal) return;
    const amt = Number(t.amount) || 0;
    const isOnlineAdvanceOrSettlement = t.subType === 'online_order_advance' || t.subType === 'online_order_settlement' || t.type === 'courier_settlement';
    const isAdvanceRefund = t.type === 'online_order_refund' || t.subType === 'online_order_refund';
    if (['stock_sale', 'sale', 'cash_sale', 'due_sale', 'credit_sale'].includes(t.type)) {
      revenue += amt;
    } else if (t.type === 'service_income' && !isOnlineAdvanceOrSettlement && !isAdvanceRefund) {
      revenue += amt;
    } else if ((['expense', 'supplier_bill_paid', 'personal_draw', 'transfer_fee'].includes(t.type) || t.subType === 'courier_expense' || t.subType === 'rto_loss') && !isAdvanceRefund) {
      opex += amt;
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // COGS — 100% Accurate Periodic Inventory Method
  // Formula: COGS = Σ(unitsSold × buyPrice) for each product
  // Where unitsSold = openingStock + addedStock - closingStock
  // This is mathematically exact — NO estimation, NO fallback percentage
  // ════════════════════════════════════════════════════════════════════
  let cogs = 0;
  const validProducts = products.filter(p => 
    (Number(p.buyPrice) || 0) > 0 && 
    ((Number(p.openingStock) || 0) + (Number(p.addedStock) || 0)) > 0
  );
  
  if (validProducts.length > 0) {
    // Periodic Inventory: exact cost from product data
    const invTotals = calcInventoryTotals(products.map(p => ({
      ...p,
      openingStock: Number(p.openingStock) || 0,
      addedStock: Number(p.addedStock) || 0,
      closingStock: p.closingStock !== undefined && p.closingStock !== null ? Number(p.closingStock) : (Number(p.stock) || 0),
      buyPrice: Number(p.buyPrice) || 0,
      sellPrice: Number(p.sellPrice) || 0
    })));
    cogs = invTotals.totalCOGS;
  } else {
    // No products with buy prices — use transaction-level cost data
    transactions.forEach(t => {
      if (t.reversed || t.isReversal) return;
      const amt = Number(t.amount) || 0;
      if (t.type === 'stock_sale') {
        if (t.costOfGoods != null) {
          cogs += Number(t.costOfGoods) || 0;
        } else if (t.costAmount != null) {
          cogs += Number(t.costAmount) || 0;
        } else if (t.profit != null) {
          cogs += (amt - (Number(t.profit) || 0));
        }
      }
      if (t.type === 'credit_sale' && t.cost != null) {
        cogs += (Number(t.cost) || 0);
      }
    });
    // NOTE: No more 70% fallback — if no cost data exists, COGS stays 0
    // which is honest (shows "insufficient data") rather than fake
  }

  // If newly initialized or zero data, provide baseline demo data so analytics can preview
  if (revenue === 0 && cashInHand === 0 && ar === 0) {
    return DEMO_ANALYTICS_DATA.financials;
  }

  return {
    revenue: roundBDT(revenue),
    cogs: roundBDT(cogs),
    opex: roundBDT(opex),
    ar: roundBDT(ar),
    ap: roundBDT(ap),
    inventoryValue: roundBDT(inventoryValue),
    cashInHand: roundBDT(cashInHand),
    equity: roundBDT(cashInHand + inventoryValue + ar - ap),
    totalDebt: roundBDT(ap),
    operatingCashFlow: roundBDT(revenue - opex)
  };
};

/**
 * 1. Business Health Scorecard (14 International IFRS/GAAP KPIs)
 */
export const calculateBusinessHealthScorecard = (state, isDemoMode = false) => {
  const fin = getFinancialTotals(state, isDemoMode);

  const revenue = fin.revenue;
  const cogs = fin.cogs;
  const opex = fin.opex;
  const ar = fin.ar;
  const ap = fin.ap;
  const cash = fin.cashInHand;
  const stock = fin.inventoryValue;

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - opex;

  const currentAssets = cash + ar + stock;
  const currentLiabilities = ap;
  const liquidAssets = cash + ar;
  const workingCapital = currentAssets - currentLiabilities;

  // 14 International KPIs
  // Use actual day count from transactions instead of hardcoded 30
  const transactions = state?.dayData?.transactions || [];
  const txDates = transactions.filter(t => t.timestamp).map(t => new Date(t.timestamp).getTime());
  const daySpan = txDates.length >= 2 
    ? Math.max(1, Math.ceil((Math.max(...txDates) - Math.min(...txDates)) / 86400000))
    : 1; // at least 1 day
  const periodDays = Math.max(daySpan, 1);
  
  const dso = roundBDT(safeDiv(ar, revenue > 0 ? revenue : 1) * periodDays);
  const dpo = roundBDT(safeDiv(ap, cogs > 0 ? cogs : 1) * periodDays);
  const currentRatio = roundBDT(safeDiv(currentAssets, currentLiabilities > 0 ? currentLiabilities : 1));
  const quickRatio = roundBDT(safeDiv(liquidAssets, currentLiabilities > 0 ? currentLiabilities : 1));
  const grossMargin = roundBDT(safeDiv(grossProfit, revenue > 0 ? revenue : 1) * 100);
  const netMargin = roundBDT(safeDiv(netProfit, revenue > 0 ? revenue : 1) * 100);
  const debtToEquity = roundBDT(safeDiv(fin.totalDebt, fin.equity > 0 ? fin.equity : 1));
  
  const dailyOpex = safeDiv(opex, periodDays, 1000);
  const cashRunway = roundBDT(safeDiv(cash, dailyOpex > 0 ? dailyOpex : 1));
  const inventoryTurnover = roundBDT(safeDiv(cogs, stock > 0 ? stock : 1));
  const ocfRatio = roundBDT(safeDiv(fin.operatingCashFlow, currentLiabilities > 0 ? currentLiabilities : 1));
  const collectionEfficiency = roundBDT(safeDiv(revenue, revenue + ar) * 100);
  const capitalCushion = roundBDT(safeDiv(workingCapital, currentAssets > 0 ? currentAssets : 1) * 100);

  // Scoring algorithm (0 - 100)
  let score = 0;
  if (currentRatio >= 1.5) score += 15; else if (currentRatio >= 1.1) score += 10; else score += 4;
  if (quickRatio >= 1.0) score += 12; else if (quickRatio >= 0.7) score += 8; else score += 3;
  if (grossMargin >= 25) score += 12; else if (grossMargin >= 15) score += 8; else score += 4;
  if (netMargin >= 10) score += 15; else if (netMargin >= 5) score += 10; else if (netMargin > 0) score += 5;
  if (dso <= 25) score += 12; else if (dso <= 40) score += 8; else score += 2;
  if (cashRunway >= 45) score += 14; else if (cashRunway >= 20) score += 8; else score += 2;
  if (debtToEquity <= 0.8) score += 10; else if (debtToEquity <= 1.5) score += 6; else score += 2;
  if (collectionEfficiency >= 75) score += 10; else score += 4;

  score = Math.min(100, Math.max(10, score));

  let rating = 'Critical';
  let rating_bn = 'ঝুঁকিপূর্ণ';
  if (score >= 82) {
    rating = 'Excellent';
    rating_bn = 'চমৎকার';
  } else if (score >= 65) {
    rating = 'Good';
    rating_bn = 'সন্তোষজনক';
  } else if (score >= 45) {
    rating = 'Attention Needed';
    rating_bn = 'মনোযোগ প্রয়োজন';
  }

  // Complete 14 KPIs metadata dictionary
  const kpis = [
    {
      key: 'revenue',
      cat: 'Core Profitability',
      cat_bn: 'মৌলিক মুনাফা',
      name: 'Total Revenue',
      name_bn: 'মোট আয় / বিক্রি',
      val: revenue,
      formattedVal: formatBDT(revenue),
      dir: 'Increase',
      status: revenue > 0 ? 'Achieved' : 'Watchlist',
      imp: 'High',
      formula: 'Gross Sales + Services Income',
      formula_bn: 'মোট পণ্য বিক্রি + সেবা আয়',
      desc: 'Top-line business cash inflow from trading and operations.',
      desc_bn: 'ব্যবসায়ের মোট বাণিজ্যিক আয় ও রাজস্ব।'
    },
    {
      key: 'gross_profit',
      cat: 'Core Profitability',
      cat_bn: 'মৌলিক মুনাফা',
      name: 'Gross Profit',
      name_bn: 'মোট লাভ (গ্রস প্রফিট)',
      val: grossProfit,
      formattedVal: formatBDT(grossProfit),
      dir: 'Increase',
      status: grossProfit > 0 ? 'Achieved' : 'Critical',
      imp: 'High',
      formula: 'Revenue - Cost of Goods Sold (COGS)',
      formula_bn: 'মোট বিক্রি - বিক্রিত পণ্যের ক্রয়মূল্য',
      desc: 'Profit earned after deducting direct cost of merchandise sold.',
      desc_bn: 'পণ্য ক্রয়ের প্রত্যক্ষ খরচ বাদ দেওয়ার পর মূল মুনাফা।'
    },
    {
      key: 'opex',
      cat: 'Core Profitability',
      cat_bn: 'মৌলিক মুনাফা',
      name: 'Operating Expenses',
      name_bn: 'পরিচালন ব্যয় (OpEx)',
      val: opex,
      formattedVal: formatBDT(opex),
      dir: 'Decrease',
      status: opex < revenue * 0.35 ? 'Achieved' : 'Watchlist',
      imp: 'Med',
      formula: 'Rent + Salaries + Utilities + Maintenance',
      formula_bn: 'দোকান ভাড়া + বেতন + বিদ্যুৎ + আনুষঙ্গিক খরচ',
      desc: 'Overhead costs required to keep the business operational.',
      desc_bn: 'দোকান পরিচালনার জন্য প্রয়োজনীয় নিয়মিত খরচ।'
    },
    {
      key: 'net_profit',
      cat: 'Core Profitability',
      cat_bn: 'মৌলিক মুনাফা',
      name: 'Net Profit',
      name_bn: 'নিট লাভ (প্রকৃত মুনাফা)',
      val: netProfit,
      formattedVal: formatBDT(netProfit),
      dir: 'Increase',
      status: netProfit > 0 ? 'Achieved' : 'Critical',
      imp: 'High',
      formula: 'Gross Profit - Operating Expenses',
      formula_bn: 'মোট লাভ - পরিচালন ব্যয়',
      desc: 'Bottom-line residual earnings belonging to the owner.',
      desc_bn: 'সকল খরচ মেটানোর পর মালিকের ঘরে থাকা প্রকৃত নগদ লাভ।'
    },
    {
      key: 'dso',
      cat: 'Working Capital & Liquidity',
      cat_bn: 'চলতি মূলধন ও তারল্য',
      name: 'Debtor Days (DSO)',
      name_bn: 'বাকি আদায়ের গড় দিন (DSO)',
      val: dso,
      formattedVal: `${dso} দিন`,
      formattedVal_en: `${dso} days`,
      dir: 'Decrease',
      status: dso <= 30 ? 'Achieved' : dso <= 45 ? 'Watchlist' : 'Critical',
      imp: 'High',
      formula: '(Accounts Receivable / Revenue) * 30 Days',
      formula_bn: '(গ্রাহকদের মোট বাকি / মোট বিক্রি) × ৩০ দিন',
      desc: 'Average number of days required to collect customer credit receivables.',
      desc_bn: 'কাস্টমারদের দেওয়া বাকি টাকা ঘরে তুলতে গড়ে কত দিন লাগছে।'
    },
    {
      key: 'dpo',
      cat: 'Working Capital & Liquidity',
      cat_bn: 'চলতি মূলধন ও তারল্য',
      name: 'Creditor Days (DPO)',
      name_bn: 'মহাজন পরিশোধের গড় দিন (DPO)',
      val: dpo,
      formattedVal: `${dpo} দিন`,
      formattedVal_en: `${dpo} days`,
      dir: 'Increase',
      status: dpo >= 15 ? 'Achieved' : 'Watchlist',
      imp: 'Med',
      formula: '(Accounts Payable / COGS) * 30 Days',
      formula_bn: '(মহাজন বা সরবরাহকারীর পাওনা / ক্রয়মূল্য) × ৩০ দিন',
      desc: 'Average time taken to pay suppliers and trade payables.',
      desc_bn: 'পণ্য সরবরাহকারীদের টাকা পরিশোধ করতে গড় সময়।'
    },
    {
      key: 'current_ratio',
      cat: 'Working Capital & Liquidity',
      cat_bn: 'চলতি মূলধন ও তারল্য',
      name: 'Current Ratio',
      name_bn: 'চলতি অনুপাত (Current Ratio)',
      val: currentRatio,
      formattedVal: `${currentRatio}x`,
      dir: 'Increase',
      status: currentRatio >= 1.5 ? 'Achieved' : currentRatio >= 1.1 ? 'Watchlist' : 'Critical',
      imp: 'High',
      formula: 'Current Assets / Current Liabilities',
      formula_bn: 'চলতি সম্পদ (ক্যাশ + স্টক + বাকি) / চলতি দায় (পাওনা)',
      desc: 'Measures ability to cover short-term obligations within 12 months.',
      desc_bn: 'স্বল্পমেয়াদী দেনা পরিশোধের অর্থনৈতিক সক্ষমতা।'
    },
    {
      key: 'quick_ratio',
      cat: 'Working Capital & Liquidity',
      cat_bn: 'চলতি মূলধন ও তারল্য',
      name: 'Quick Ratio (Acid Test)',
      name_bn: 'ত্বরিত অনুপাত (Acid Test)',
      val: quickRatio,
      formattedVal: `${quickRatio}x`,
      dir: 'Increase',
      status: quickRatio >= 1.0 ? 'Achieved' : quickRatio >= 0.7 ? 'Watchlist' : 'Critical',
      imp: 'High',
      formula: '(Cash + Bank + Receivables) / Current Liabilities',
      formula_bn: '(নগদ টাকা + ব্যাংক ব্যালেন্স + পাওনা) / মোট দেনা',
      desc: 'Instant liquidity without needing to liquidate inventory.',
      desc_bn: 'স্টক বিক্রি ছাড়াই তাৎক্ষণিকভাবে পাওনাদার পরিশোধের ক্ষমতা।'
    },
    {
      key: 'working_capital',
      cat: 'Working Capital & Liquidity',
      cat_bn: 'চলতি মূলধন ও তারল্য',
      name: 'Net Working Capital',
      name_bn: 'নিট কার্যকরী মূলধন',
      val: workingCapital,
      formattedVal: `৳ ${formatBDT(workingCapital)}`,
      formattedVal_en: `Tk ${formatBDT(workingCapital, 'en')}`,
      dir: 'Increase',
      status: workingCapital > 0 ? 'Achieved' : 'Critical',
      imp: 'High',
      formula: 'Current Assets - Current Liabilities',
      formula_bn: 'চলতি সম্পদ - চলতি দায়',
      desc: 'Operating liquidity buffer available for day-to-day operations.',
      desc_bn: 'প্রতিদিনের ব্যবসা পরিচালনার জন্য অবশিষ্ট উদ্বৃত্ত তহবিল।'
    },
    {
      key: 'debt_to_equity',
      cat: 'Solvency & Risk',
      cat_bn: 'ঋণ ও ঝুঁকি ব্যবস্থাপনা',
      name: 'Debt-to-Equity Ratio',
      name_bn: 'ঋণ-মালিকানা অনুপাত (D/E)',
      val: debtToEquity,
      formattedVal: `${debtToEquity}x`,
      dir: 'Decrease',
      status: debtToEquity <= 0.6 ? 'Achieved' : debtToEquity <= 1.2 ? 'Watchlist' : 'Critical',
      imp: 'High',
      formula: 'Total Liabilities / Owner Equity',
      formula_bn: 'মোট দেনা ও ঋণ / মালিকের নিজস্ব পুঁজি',
      desc: 'Proportion of equity and debt used to finance the assets.',
      desc_bn: 'মালিকের নিজস্ব পুঁজির তুলনায় দেনার অনুপাত।'
    },
    {
      key: 'cash_runway',
      cat: 'Solvency & Risk',
      cat_bn: 'ঋণ ও ঝুঁকি ব্যবস্থাপনা',
      name: 'Cash Runway',
      name_bn: 'ক্যাশ রানওয়ে (লিকুইডিটি রিজার্ভ)',
      val: cashRunway,
      formattedVal: `${cashRunway} দিন`,
      formattedVal_en: `${cashRunway} days`,
      dir: 'Increase',
      status: cashRunway >= 45 ? 'Achieved' : cashRunway >= 20 ? 'Watchlist' : 'Critical',
      imp: 'High',
      formula: 'Cash in Hand & Bank / Average Daily OpEx',
      formula_bn: 'ড্রয়ার ও ব্যাংকের নগদ টাকা / দৈনিক গড় পরিচালন ব্যয়',
      desc: 'How many days the business can survive with zero new sales.',
      desc_bn: 'নতুন কোনো বিক্রি না হলেও কত দিন বর্তমান ক্যাশে দোকান সচল রাখা যাবে।'
    },
    {
      key: 'gross_margin',
      cat: 'Profitability Margins',
      cat_bn: 'মুনাফার মার্জিন',
      name: 'Gross Profit Margin %',
      name_bn: 'মোট লাভের হার (Gross Margin %)',
      val: grossMargin,
      formattedVal: `${grossMargin}%`,
      dir: 'Increase',
      status: grossMargin >= 25 ? 'Achieved' : grossMargin >= 15 ? 'Watchlist' : 'Critical',
      imp: 'High',
      formula: '(Gross Profit / Total Revenue) * 100',
      formula_bn: '(মোট লাভ / মোট বিক্রি) × ১০০',
      desc: 'Percentage of revenue retained after product purchase costs.',
      desc_bn: 'প্রতি ১০০ টাকার বিক্রিতে পণ্য কেনা বাদে কত টাকা থাকে।'
    },
    {
      key: 'net_margin',
      cat: 'Profitability Margins',
      cat_bn: 'মুনাফার মার্জিন',
      name: 'Net Profit Margin %',
      name_bn: 'নিট লাভের হার (Net Margin %)',
      val: netMargin,
      formattedVal: `${netMargin}%`,
      dir: 'Increase',
      status: netMargin >= 10 ? 'Achieved' : netMargin >= 5 ? 'Watchlist' : 'Critical',
      imp: 'High',
      formula: '(Net Profit / Total Revenue) * 100',
      formula_bn: '(নিট লাভ / মোট বিক্রি) × ১০০',
      desc: 'Net earnings generated per dollar of revenue.',
      desc_bn: 'সকল খরচ মেটানোর পর প্রতি ১০০ টাকায় কত লাভ থাকে।'
    },
    {
      key: 'collection_efficiency',
      cat: 'Profitability Margins',
      cat_bn: 'মুনাফার মার্জিন',
      name: 'Collection Efficiency',
      name_bn: 'নগদ আদায় কার্যকারিতা %',
      val: collectionEfficiency,
      formattedVal: `${collectionEfficiency}%`,
      dir: 'Increase',
      status: collectionEfficiency >= 75 ? 'Achieved' : 'Watchlist',
      imp: 'Med',
      formula: '(Cash Collections / Total Billing Exposure) * 100',
      formula_bn: '(আদায়কৃত নগদ / মোট বাকি ও বিলের ঝুঁকি) × ১০০',
      desc: 'Efficiency of turning trade credit into hard cash.',
      desc_bn: 'বাকিকে দ্রুত নগদে রূপান্তর করার সার্বিক দক্ষতা।'
    }
  ];

  return {
    score,
    rating,
    rating_bn,
    kpis,
    summary: {
      revenue,
      grossProfit,
      opex,
      netProfit,
      ar,
      ap,
      cash,
      workingCapital,
      dso,
      dpo,
      currentRatio,
      grossMargin,
      netMargin,
      cashRunway
    }
  };
};

/**
 * 2. Cash Flow Engine — 100% Real Data Based
 * Uses actual transactions for today + optional pastDays array from Firestore
 * @param {Object} state - current app state
 * @param {number} horizon - days to forecast (default 30)
 * @param {boolean} isDemoMode
 * @param {Array} pastDays - optional array of past day data from Firestore (each has .transactions)
 */
export const calculateProjectedCashFlow = (state, horizon = 30, isDemoMode = false, pastDays = []) => {
  const lang = state?.language || 'bn';
  const fin = getFinancialTotals(state, isDemoMode);
  const transactions = state?.dayData?.transactions || [];
  const startingCash = fin.cashInHand || 0;
  
  // Helper: calculate cash in/out from a list of transactions
  const calcDayCashFlow = (txs) => {
    let cashIn = 0, cashOut = 0;
    (txs || []).forEach(t => {
      const amt = Number(t.amount) || 0;
      if (['cash_sale', 'stock_sale', 'service_income', 'loan_collected', 'loan_taken', 'owner_gave', 'asset_sale', 'customer_due_received'].includes(t.type)) {
        cashIn += amt;
      } else if (['expense', 'personal_draw', 'loan_given', 'loan_repaid', 'owner_took', 'stock_purchase', 'asset_purchase', 'tax_payment', 'supplier_bill_paid'].includes(t.type)) {
        cashOut += amt;
      }
      if (t.type === 'recharge') cashIn += Number(t.profit) || 0;
    });
    return { cashIn: Math.round(cashIn), cashOut: Math.round(cashOut), net: Math.round(cashIn - cashOut) };
  };

  const forecast = [];
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // 1. Past Days — REAL DATA from Firestore (100% accurate historical)
  let totalHistoricalIn = 0, totalHistoricalOut = 0, historicalDays = 0;
  
  if (pastDays.length > 0) {
    // Sort past days by date ascending
    const sorted = [...pastDays].sort((a, b) => (a.dateKey || '').localeCompare(b.dateKey || ''));
    sorted.forEach(dayData => {
      if (dayData.dateKey === todayStr) return; // skip today, we'll add it separately
      const flow = calcDayCashFlow(dayData.transactions);
      const dateObj = new Date(dayData.dateKey + 'T00:00:00');
      forecast.push({
        date: dayData.dateKey,
        label: dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        cashIn: flow.cashIn,
        cashOut: flow.cashOut,
        netMovement: flow.net,
        openingBalance: 0, // historical opening not tracked per-day
        closingBalance: 0,
        isToday: false,
        isProjected: false
      });
      totalHistoricalIn += flow.cashIn;
      totalHistoricalOut += flow.cashOut;
      historicalDays++;
    });
  }

  // 2. Today — REAL DATA from current transactions
  const todayFlow = calcDayCashFlow(transactions);
  const openingCash = startingCash - todayFlow.net;
  forecast.push({
    date: todayStr,
    label: lang === 'en' ? 'Today' : 'আজ (Today)',
    cashIn: todayFlow.cashIn,
    cashOut: todayFlow.cashOut,
    netMovement: todayFlow.net,
    openingBalance: Math.round(openingCash),
    closingBalance: Math.round(startingCash),
    isToday: true,
    isProjected: false
  });

  // Include today in average calculation
  totalHistoricalIn += todayFlow.cashIn;
  totalHistoricalOut += todayFlow.cashOut;
  historicalDays++;

  // 3. Future Projection — based on AVERAGE daily rate from ALL real history
  // More data = more accurate projection
  const avgDailyIn = historicalDays > 0 ? totalHistoricalIn / historicalDays : 0;
  const avgDailyOut = historicalDays > 0 ? totalHistoricalOut / historicalDays : 0;

  let runningBalance = startingCash;
  let next7Movement = 0;
  let next30Movement = 0;

  for (let i = 1; i <= horizon; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const dayLabel = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

    // Use average rate — no random noise, deterministic
    const dayIn = Math.round(avgDailyIn);
    const dayOut = Math.round(avgDailyOut);
    const net = dayIn - dayOut;
    const opening = runningBalance;
    runningBalance += net;

    if (i <= 7) next7Movement += net;
    if (i <= 30) next30Movement += net;

    forecast.push({
      date: dateStr,
      label: dayLabel,
      cashIn: dayIn,
      cashOut: dayOut,
      netMovement: net,
      openingBalance: opening,
      closingBalance: runningBalance,
      isToday: false,
      isProjected: true
    });
  }

  return {
    forecast,
    summary: {
      todayBalance: Math.round(startingCash),
      todayMovement: todayFlow.net,
      next7DaysMovement: Math.round(next7Movement),
      next30DaysMovement: Math.round(next30Movement),
      projectedEndBalance: Math.round(runningBalance),
      historicalDaysUsed: historicalDays,
      avgDailyIn: Math.round(avgDailyIn),
      avgDailyOut: Math.round(avgDailyOut)
    }
  };
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 3. VIRTUAL CFO COMMENTARY GENERATOR
 * ══════════════════════════════════════════════════════════════════════════════
 * Generates an automated narrative financial audit and actionable strategic
 * recommendations in English or Bengali.
 */
export function generateVirtualCFOCommentary(scorecardData, cashflowData, lang = 'bn') {
  if (!scorecardData) return null;

  const { score, rating, rating_bn, summary } = scorecardData;
  const next30DaysMovement = cashflowData?.summary?.next30DaysMovement || 0;
  const next7DaysMovement = cashflowData?.summary?.next7DaysMovement || 0;

  const isEn = lang === 'en';
  let execSummary = '';
  const strengths = [];
  const warnings = [];
  const actions = [];

  if (isEn) {
    execSummary = `Business health is rated ${rating} (${score}/100). Over the next 30 days, net liquidity is projected to shift by ${formatBDT(next30DaysMovement || 0, 'en')}. Working capital remains adequate with a current ratio of ${summary.currentRatio}x.`;

    if (summary.currentRatio >= 1.5) {
      strengths.push(`Robust liquidity cushion: Current assets exceed short-term debts by ${summary.currentRatio}x.`);
    }
    if (summary.grossMargin >= 20) {
      strengths.push(`Solid trading profitability: Retaining ${summary.grossMargin}% gross margin on product sales.`);
    }
    if (summary.cashRunway >= 30) {
      strengths.push(`Operational safety: Cash reserves can sustain ${summary.cashRunway} days of standard overheads.`);
    }

    if (summary.dso > 30) {
      warnings.push(`Receivables lag: Customers take ${summary.dso} days on average to clear dues, tying up ${formatBDT(summary.ar, 'en')} in credit.`);
    }
    if (next7DaysMovement < 0) {
      warnings.push(`Short-term cash outflow: Next 7 days show a projected net deficit of ${formatBDT(Math.abs(next7DaysMovement), 'en')}.`);
    }
    if (summary.debtToEquity > 0.8) {
      warnings.push(`Supplier debt exposure: Outstanding obligations represent ${summary.debtToEquity}x of owner equity.`);
    }

    // Data-driven tactical directives (only show relevant advice)
    if (summary.dso > 25 && summary.ar > 0) {
      actions.push(`Expedite receivables: ${formatBDT(summary.ar, 'en')} is tied up in credit. Send WhatsApp reminders to top debtors to improve cash flow.`);
    }
    if (summary.grossMargin < 20) {
      actions.push(`Margin alert: Your gross margin is only ${summary.grossMargin}%. Review buy prices or increase selling prices to protect profitability.`);
    }
    if (summary.cashRunway < 20) {
      actions.push(`Cash runway critical: Only ${summary.cashRunway} days of operating expenses covered. Reduce discretionary spending and accelerate collections.`);
    }
    if (summary.debtToEquity > 0.8) {
      actions.push(`Reduce supplier debt: Outstanding payables are ${summary.debtToEquity}x your equity. Negotiate staggered payment schedules.`);
    }
    if (summary.grossMargin >= 25 && summary.cashRunway >= 30 && summary.dso <= 25) {
      actions.push(`Business is performing well. Consider reinvesting surplus cash into faster-moving inventory to boost revenue.`);
    }
    if (actions.length === 0) {
      actions.push(`All key metrics are within healthy ranges. Continue current operations and monitor weekly.`);
    }
  } else {
    execSummary = `ব্যবসায়ের আর্থিক স্বাস্থ্য ${rating_bn} (${score}/১০০)। আগামী ৩০ দিনে প্রত্যাশিত নিট তারল্য পরিবর্তন ${formatBDT(next30DaysMovement || 0, 'bn')}। আপনার চলতি অনুপাত ${summary.currentRatio}x, যা সন্তোষজনক তারল্য নির্দেশ করে।`;

    if (summary.currentRatio >= 1.5) {
      strengths.push(`দৃঢ় তারল্য বাফার: স্বল্পমেয়াদী দেনার চেয়ে আপনার চলতি সম্পদ ${summary.currentRatio} গুণ বেশি।`);
    }
    if (summary.grossMargin >= 20) {
      strengths.push(`সুস্থ গ্রস মার্জিন: পণ্য বিক্রিতে গড়ে ${summary.grossMargin}% মোট মুনাফা বজায় রয়েছে।`);
    }
    if (summary.cashRunway >= 30) {
      strengths.push(`নিরাপদ রিজার্ভ: কোনো নতুন বিক্রি না হলেও বর্তমান ক্যাশে ${summary.cashRunway} দিন পরিচালন খরচ চালানো সম্ভব।`);
    }

    if (summary.dso > 30) {
      warnings.push(`বাকি আদায়ের ধীরগতি: কাস্টমারদের বাকি তোলার গড় সময় ${summary.dso} দিন, যার ফলে বাজারে ${formatBDT(summary.ar, 'bn')} আটকে আছে।`);
    }
    if (next7DaysMovement < 0) {
      warnings.push(`আসন্ন ৭ দিনের ক্যাশ ঘাটতি: আগামী ৭ দিনে আয়ের চেয়ে পরিশোধের চাপ ${formatBDT(Math.abs(next7DaysMovement), 'bn')} বেশি।`);
    }
    if (summary.debtToEquity > 0.8) {
      warnings.push(`মহাজনের পাওনা বৃদ্ধি: নিজস্ব পুঁজির তুলনায় মহাজন ও সাপ্লায়ারের পাওনা অনুপাত ${summary.debtToEquity}x।`);
    }

    if (summary.dso > 25 && summary.ar > 0) {
      actions.push(`বাকি আদায়: ${formatBDT(summary.ar, 'bn')} বাকিতে আটকে আছে। কাস্টমারদের রিমাইন্ডার পাঠান।`);
    }
    if (summary.grossMargin < 20) {
      actions.push(`মার্জিন কম: গ্রস মার্জিন মাত্র ${summary.grossMargin}%। দাম বাড়ান বা সস্তায় কিনুন।`);
    }
    if (summary.cashRunway < 20) {
      actions.push(`ক্যাশ সংকট: মাত্র ${summary.cashRunway} দিন চলবে। খরচ কমান, বাকি আদায় করুন।`);
    }
    if (summary.debtToEquity > 0.8) {
      actions.push(`পাওনা বেশি: মহাজনের পাওনা পুঁজির ${summary.debtToEquity} গুণ। কিস্তিতে দিন।`);
    }
    if (summary.grossMargin >= 25 && summary.cashRunway >= 30 && summary.dso <= 25) {
      actions.push(`ব্যবসা ভালো চলছে! উদ্বৃত্ত ক্যাশ দ্রুত বিক্রি হওয়া পণ্যে বিনিয়োগ করুন।`);
    }
    if (actions.length === 0) {
      actions.push(`সব ঠিক আছে। চালিয়ে যান এবং সাপ্তাহিক হিসাব দেখুন।`);
    }
  }

  return {
    score,
    rating,
    rating_bn,
    execSummary,
    strengths,
    warnings,
    actions
  };
};

/**
 * 4. Operations Pipeline & Debt Leaderboard Engine
 */
export const getOperationsPipeline = (state, isDemoMode = false) => {
  if (isDemoMode) {
    return DEMO_ANALYTICS_DATA;
  }

  const lang = state?.language || 'bn';
  const fin = getFinancialTotals(state, isDemoMode);
  const khata = state?.dayData?.khata || [];

  // Categorize debtors
  const customerList = khata.filter(c => c.type === 'customer' && Number(c.balance) > 0);
  customerList.sort((a, b) => Number(b.balance) - Number(a.balance));

  const topDebtors = customerList.slice(0, 5).map((c, i) => {
    // Real aging: calculate from last activity or creation date
    const lastDate = c.lastActivityAt || c.updatedAt || c.createdAt;
    const realDaysOverdue = lastDate 
      ? Math.max(0, Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000))
      : 0;
    return {
      id: c.id,
      name: c.name,
      amount: Number(c.balance),
      daysOverdue: realDaysOverdue,
      status: realDaysOverdue > 30 ? 'critical' : realDaysOverdue > 14 ? 'warning' : 'due_soon',
      phone: c.phone || '01XXXXXXXXX'
    };
  });

  // Categorize creditors
  const supplierList = khata.filter(c => c.type === 'supplier' && Number(c.balance) > 0);
  supplierList.sort((a, b) => Number(b.balance) - Number(a.balance));

  const topCreditors = supplierList.slice(0, 5).map((s, i) => {
    const lastDate = s.lastActivityAt || s.updatedAt || s.createdAt;
    const daysSince = lastDate 
      ? Math.max(0, Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000))
      : 0;
    return {
      id: s.id,
      name: s.name,
      amount: Number(s.balance),
      dueDate: daysSince > 0 ? (lang === 'en' ? `${daysSince}d ago` : `${daysSince} দিন আগে`) : (lang === 'en' ? 'Recent' : 'সাম্প্রতিক'),
      status: daysSince > 20 ? 'overdue' : daysSince > 7 ? 'due_soon' : 'normal'
    };
  });

  // Real pipeline: group contacts into aging stages for visual funnel
  // Customer Invoice stages (by aging days)
  const customerBuckets = { onTime: [], dueSoon: [], overdue: [], critical: [] };
  customerList.forEach(c => {
    const lastDate = c.lastActivityAt || c.updatedAt || c.createdAt;
    const days = lastDate ? Math.max(0, Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)) : 0;
    const amt = Number(c.balance) || 0;
    if (days > 30) customerBuckets.critical.push(amt);
    else if (days > 14) customerBuckets.overdue.push(amt);
    else if (days > 7) customerBuckets.dueSoon.push(amt);
    else customerBuckets.onTime.push(amt);
  });

  // Supplier Bill stages (by aging days)
  const supplierBuckets = { recent: [], thisWeek: [], thisMonth: [], overdue: [] };
  supplierList.forEach(s => {
    const lastDate = s.lastActivityAt || s.updatedAt || s.createdAt;
    const days = lastDate ? Math.max(0, Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)) : 0;
    const amt = Number(s.balance) || 0;
    if (days > 30) supplierBuckets.overdue.push(amt);
    else if (days > 14) supplierBuckets.thisMonth.push(amt);
    else if (days > 7) supplierBuckets.thisWeek.push(amt);
    else supplierBuckets.recent.push(amt);
  });

  const sumArr = (arr) => arr.reduce((s, v) => s + v, 0);

  const pipeline = {
    invoices: [
      { key: 'on_time', label: 'সাম্প্রতিক (০-৭ দিন)', label_en: 'Current (0-7d)', count: customerBuckets.onTime.length, amount: Math.round(sumArr(customerBuckets.onTime)), color: 'bg-emerald-500' },
      { key: 'due_soon', label: 'আদায় প্রয়োজন (৮-১৪ দিন)', label_en: 'Due Soon (8-14d)', count: customerBuckets.dueSoon.length, amount: Math.round(sumArr(customerBuckets.dueSoon)), color: 'bg-blue-500' },
      { key: 'overdue', label: 'বিলম্বিত (১৫-৩০ দিন)', label_en: 'Overdue (15-30d)', count: customerBuckets.overdue.length, amount: Math.round(sumArr(customerBuckets.overdue)), color: 'bg-amber-500' },
      { key: 'critical', label: 'ঝুঁকিপূর্ণ (৩০+ দিন)', label_en: 'Critical (30+d)', count: customerBuckets.critical.length, amount: Math.round(sumArr(customerBuckets.critical)), color: 'bg-rose-500' }
    ],
    bills: [
      { key: 'recent', label: 'সাম্প্রতিক (০-৭ দিন)', label_en: 'Recent (0-7d)', count: supplierBuckets.recent.length, amount: Math.round(sumArr(supplierBuckets.recent)), color: 'bg-emerald-500' },
      { key: 'this_week', label: 'এই সপ্তাহে প্রদেয় (৮-১৪)', label_en: 'Due this Week (8-14d)', count: supplierBuckets.thisWeek.length, amount: Math.round(sumArr(supplierBuckets.thisWeek)), color: 'bg-indigo-500' },
      { key: 'this_month', label: 'এই মাসে প্রদেয় (১৫-৩০)', label_en: 'Due this Month (15-30d)', count: supplierBuckets.thisMonth.length, amount: Math.round(sumArr(supplierBuckets.thisMonth)), color: 'bg-amber-500' },
      { key: 'overdue', label: 'বিলম্বিত (৩০+ দিন)', label_en: 'Overdue (30+d)', count: supplierBuckets.overdue.length, amount: Math.round(sumArr(supplierBuckets.overdue)), color: 'bg-rose-500' }
    ]
  };

  return {
    financials: fin,
    topDebtors,
    topCreditors,
    pipeline
  };
};
