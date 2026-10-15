import React, { useState } from 'react';
import { formatBDT } from '../../data/calculations';
import { 
  TrendingUp, 
  MinusCircle, 
  X, 
  ShoppingBag, 
  Smartphone, 
  Layers, 
  Home, 
  Store, 
  Package, 
  Clock, 
  CheckCircle2, 
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
  FileSpreadsheet
} from 'lucide-react';

export default function ClosingFinancialDetailModal({
  isOpen,
  onClose,
  initialTab = 'profit', // 'profit' or 'expense'
  lang = 'bn',
  dayData = {},
  inventoryTotals = {},
  txTotals = {},
  dailyProfit = 0
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'profit' or 'expense'
  const [expenseFilter, setExpenseFilter] = useState('all'); // 'all', 'family', 'shop', 'stock'

  // Update tab when initialTab changes on open
  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setExpenseFilter('all');
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const transactions = dayData?.transactions || [];

  // ──────────────────────────────────────────────────────────────────────────
  // 1. PROFIT CALCULATIONS & TRADES
  // ──────────────────────────────────────────────────────────────────────────
  // Stock sales trades
  const stockSaleTrades = transactions.filter(
    tx => !tx.reversed && (tx.type === 'stock_sale' || tx.type === 'cash_sale')
  );

  const totalStockSaleProfit = stockSaleTrades.reduce((sum, tx) => {
    const p = tx.profit !== undefined ? tx.profit : Math.round((tx.amount || 0) * 0.15);
    return sum + p;
  }, 0);

  // Recharge trades
  const rechargeTrades = transactions.filter(
    tx => !tx.reversed && tx.type === 'recharge'
  );
  const totalRechargeProfit = rechargeTrades.reduce((sum, tx) => sum + (tx.profit || 0), 0);

  // Service trades (photocopy, studio, etc.)
  const serviceTrades = transactions.filter(
    tx => !tx.reversed && (tx.type === 'service_sale' || tx.type === 'service_income')
  );
  const totalServiceProfit = serviceTrades.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // Total Gross Profit
  const totalGrossProfit = totalStockSaleProfit + totalRechargeProfit + totalServiceProfit;
  const shopOperatingExpenses = txTotals.expenses || 0;
  const netProfit = totalGrossProfit - shopOperatingExpenses;

  // ──────────────────────────────────────────────────────────────────────────
  // 2. EXPENSE CALCULATIONS & ITEMS
  // ──────────────────────────────────────────────────────────────────────────
  // Family / Personal Expenses
  const familyExpenseItems = transactions.filter(
    tx => !tx.reversed && (tx.type === 'personal_draw' || tx.type === 'owner_took')
  );
  const familyExpenseTotal = familyExpenseItems.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // Shop Operating Expenses
  const shopExpenseItems = transactions.filter(
    tx => !tx.reversed && tx.type === 'expense'
  );
  const shopExpenseTotal = shopExpenseItems.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // Stock Purchases
  const stockPurchaseItems = transactions.filter(
    tx => !tx.reversed && tx.type === 'stock_purchase'
  );
  const stockPurchaseTotal = stockPurchaseItems.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // Other outflows (loan given, asset purchase, tax payment)
  const otherOutflowItems = transactions.filter(
    tx => !tx.reversed && ['loan_given', 'asset_purchase', 'tax_payment'].includes(tx.type)
  );
  const otherOutflowTotal = otherOutflowItems.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // Total Outflow / Spent
  const totalCashSpent = familyExpenseTotal + shopExpenseTotal + stockPurchaseTotal + otherOutflowTotal;

  // Filtered expense list based on sub-filter
  let filteredExpenseItems = [];
  if (expenseFilter === 'all') {
    filteredExpenseItems = [...familyExpenseItems, ...shopExpenseItems, ...stockPurchaseItems, ...otherOutflowItems];
  } else if (expenseFilter === 'family') {
    filteredExpenseItems = familyExpenseItems;
  } else if (expenseFilter === 'shop') {
    filteredExpenseItems = shopExpenseItems;
  } else if (expenseFilter === 'stock') {
    filteredExpenseItems = stockPurchaseItems;
  }
  // Sort descending by timestamp
  filteredExpenseItems = [...filteredExpenseItems].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const isEn = lang === 'en';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div 
        className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[92vh] shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-xs ${
              activeTab === 'profit' 
                ? 'bg-gradient-to-tr from-emerald-600 to-teal-500' 
                : 'bg-gradient-to-tr from-rose-600 to-amber-500'
            }`}>
              {activeTab === 'profit' ? <TrendingUp className="w-5 h-5" /> : <MinusCircle className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                {activeTab === 'profit'
                  ? (isEn ? "Today's Profit Audit Breakdown" : "আজকের লাভের পুঙ্খানুপুঙ্খ অডিট রিপোর্ট")
                  : (isEn ? "Today's Expenses & Outflows Breakdown" : "আজকের খরচের পুঙ্খানুপুঙ্খ অডিট রিপোর্ট")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEn ? "Detailed trade & expense transaction records" : "প্রতিটি কেনা-বেচা, কমিশন ও খরচের খতিয়ান"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200/60 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Primary Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/40 p-1.5 gap-1.5">
          <button
            onClick={() => setActiveTab('profit')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'profit'
                ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs ring-1 ring-emerald-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>{isEn ? 'Profit Breakdown' : '📈 আজকের লাভ (Profit)'}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              {formatBDT(netProfit, lang)}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('expense')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'expense'
                ? 'bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-400 shadow-xs ring-1 ring-rose-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MinusCircle className="w-4 h-4" />
            <span>{isEn ? 'Expenses & Outflows' : '💸 আজকের খরচ (Expenses)'}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">
              {formatBDT(totalCashSpent, lang)}
            </span>
          </button>
        </div>

        {/* Scrollable Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {activeTab === 'profit' ? (
            // ────────────────────────────────────────────────────────────────
            // TAB 1: PROFIT DETAILS
            // ────────────────────────────────────────────────────────────────
            <div className="space-y-4">
              {/* Profit Summary Hero Banner */}
              <div className="rounded-2xl p-4 bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-emerald-100 uppercase tracking-wider">
                      {isEn ? 'Today Net Profit' : 'আজকের মোট নিট লাভ'}
                    </p>
                    <h2 className="text-2xl sm:text-3xl font-black text-white mt-0.5">
                      {formatBDT(netProfit, lang)}
                    </h2>
                  </div>
                  <div className="px-3 py-1.5 rounded-xl bg-white/20 backdrop-blur-xs text-xs font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                    <span>{isEn ? 'Audited Daily Margin' : 'সম্পূর্ণ অডিটকৃত লাভ'}</span>
                  </div>
                </div>

                {/* Equation strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/20 text-xs">
                  <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                    <span className="text-xs text-emerald-100 block">📦 {isEn ? 'Stock Sales Profit' : 'পণ্য বিক্রি লাভ'}</span>
                    <span className="font-mono font-bold text-white">+{formatBDT(totalStockSaleProfit, lang)}</span>
                  </div>
                  <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                    <span className="text-xs text-emerald-100 block">⚡ {isEn ? 'Recharge Profit' : 'রিচার্জ লাভ'}</span>
                    <span className="font-mono font-bold text-white">+{formatBDT(totalRechargeProfit, lang)}</span>
                  </div>
                  <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                    <span className="text-xs text-emerald-100 block">🛠️ {isEn ? 'Services Income' : 'সেবা / স্টুডিও'}</span>
                    <span className="font-mono font-bold text-white">+{formatBDT(totalServiceProfit, lang)}</span>
                  </div>
                  <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                    <span className="text-xs text-emerald-100 block">🏢 {isEn ? 'Deduct Shop Exp' : 'বাদ: দোকান খরচ'}</span>
                    <span className="font-mono font-bold text-rose-200">-{formatBDT(shopOperatingExpenses, lang)}</span>
                  </div>
                </div>
              </div>

              {/* Trade-by-Trade List Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Itemized Profit per Trade / Sale' : 'প্রতিটি বিক্রির লাভ ও মার্জিন তালিকা'}</span>
                  </h4>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {stockSaleTrades.length + rechargeTrades.length + serviceTrades.length} {isEn ? 'trades' : 'টি লেনদেন'}
                  </span>
                </div>

                {stockSaleTrades.length === 0 && rechargeTrades.length === 0 && serviceTrades.length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 text-xs">
                    {isEn ? 'No profit-generating sales recorded today yet.' : 'আজ এখনো কোনো পণ্য বিক্রি বা আয়ের লেনদেন হয়নি।'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Stock Sales Trades */}
                    {stockSaleTrades.map((tx, idx) => {
                      const qty = Number(tx.quantity) || 1;
                      const profit = tx.profit !== undefined ? tx.profit : Math.round((tx.amount || 0) * 0.15);
                      const unitProfit = Math.round((profit / qty) * 100) / 100;
                      const sellPrice = tx.amount ? (tx.amount / qty) : 0;
                      const buyPrice = Math.max(0, sellPrice - unitProfit);

                      return (
                        <div 
                          key={tx.id || `stock_${idx}`}
                          className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-2xs hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
                              📦
                            </div>
                            <div>
                              <p className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">
                                {tx.itemName || tx.note || (isEn ? 'Product Sale' : 'পণ্য বিক্রি')}
                              </p>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                <span>{qty} {tx.unit || (isEn ? 'pcs' : 'পিস')}</span>
                                <span>•</span>
                                <span>{isEn ? 'Sale:' : 'বিক্রি:'} {formatBDT(tx.amount, lang)}</span>
                                {buyPrice > 0 && (
                                  <>
                                    <span>•</span>
                                    <span>{isEn ? 'Cost:' : 'কেনা:'} {formatBDT(buyPrice * qty, lang)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 rounded-xl border border-emerald-200 dark:border-emerald-800">
                              +{formatBDT(profit, lang)}
                            </span>
                            <span className="block text-xs text-slate-400 mt-0.5">
                              {unitProfit > 0 && (lang === 'en' ? `(৳${unitProfit} profit each)` : `(প্রতিটিতে ৳${unitProfit} লাভ)`)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Recharge Trades */}
                    {rechargeTrades.map((tx, idx) => (
                      <div 
                        key={tx.id || `recharge_${idx}`}
                        className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-2xs flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-sm shrink-0">
                            ⚡
                          </div>
                          <div>
                            <p className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">
                              {tx.note || (isEn ? 'Telecom Recharge' : 'মোবাইল রিচার্জ')}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {isEn ? 'Amount:' : 'পরিমাণ:'} {formatBDT(tx.amount, lang)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-black text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 px-2.5 py-1 rounded-xl border border-teal-200 dark:border-teal-800">
                            +{formatBDT(tx.profit || 0, lang)}
                          </span>
                          <span className="block text-xs text-slate-400 mt-0.5">
                            {isEn ? 'Commission' : 'কমিশন/লাভ'}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* Service Trades */}
                    {serviceTrades.map((tx, idx) => (
                      <div 
                        key={tx.id || `service_${idx}`}
                        className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-2xs flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                            🛠️
                          </div>
                          <div>
                            <p className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">
                              {tx.note || (isEn ? 'Service Income' : 'সেবা / স্টুডিও আয়')}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {isEn ? 'Direct Service' : 'সরাসরি সেবা আয়'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="inline-flex items-center gap-0.5 text-xs sm:text-sm font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-1 rounded-xl border border-indigo-200 dark:border-indigo-800">
                            +{formatBDT(tx.amount || 0, lang)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // ────────────────────────────────────────────────────────────────
            // TAB 2: EXPENSES & OUTFLOWS DETAILS
            // ────────────────────────────────────────────────────────────────
            <div className="space-y-4">
              {/* Expenses Summary 3-Card Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* 1. Family Expense */}
                <div 
                  onClick={() => setExpenseFilter(expenseFilter === 'family' ? 'all' : 'family')}
                  className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                    expenseFilter === 'family'
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-lg">👨‍👩‍👧</span>
                    <span className="text-xs uppercase font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 rounded-full">
                      {familyExpenseItems.length} {isEn ? 'items' : 'টি'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                    {isEn ? 'Family / Personal' : 'ফ্যামিলি ও ব্যক্তিগত'}
                  </p>
                  <p className="text-lg font-black text-indigo-700 dark:text-indigo-400 mt-0.5">
                    {formatBDT(familyExpenseTotal, lang)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {isEn ? 'e.g. Mom travel, groceries' : 'মায়ের ভ্রমণ, পরিবারের খরচ'}
                  </p>
                </div>

                {/* 2. Shop Operating Expense */}
                <div 
                  onClick={() => setExpenseFilter(expenseFilter === 'shop' ? 'all' : 'shop')}
                  className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                    expenseFilter === 'shop'
                      ? 'border-rose-500 bg-rose-50/70 dark:bg-rose-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-lg">🏢</span>
                    <span className="text-xs uppercase font-bold text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/60 px-2 py-0.5 rounded-full">
                      {shopExpenseItems.length} {isEn ? 'items' : 'টি'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                    {isEn ? 'Shop Operational' : 'দোকানের খরচ'}
                  </p>
                  <p className="text-lg font-black text-rose-700 dark:text-rose-400 mt-0.5">
                    {formatBDT(shopExpenseTotal, lang)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {isEn ? 'Electricity, snacks, rent' : 'বিদ্যুৎ বিল, চা-নাস্তা, ভাড়া'}
                  </p>
                </div>

                {/* 3. New Stock Purchased */}
                <div 
                  onClick={() => setExpenseFilter(expenseFilter === 'stock' ? 'all' : 'stock')}
                  className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                    expenseFilter === 'stock'
                      ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-lg">📦</span>
                    <span className="text-xs uppercase font-bold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/60 px-2 py-0.5 rounded-full">
                      {stockPurchaseItems.length} {isEn ? 'items' : 'টি'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                    {isEn ? 'New Stock Buy' : 'নতুন স্টক কেনা'}
                  </p>
                  <p className="text-lg font-black text-purple-700 dark:text-purple-400 mt-0.5">
                    {formatBDT(stockPurchaseTotal, lang)}
                  </p>
                  <p className="text-xs text-purple-600 dark:text-purple-400 font-semibold mt-1">
                    {isEn ? 'Converted into Asset!' : 'টাকা স্টকে রূপান্তর হয়েছে'}
                  </p>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                <span className="text-[11px] font-bold text-slate-400 shrink-0">
                  {isEn ? 'Filter:' : 'ফিল্টার:'}
                </span>
                <button
                  onClick={() => setExpenseFilter('all')}
                  className={`px-3 py-1 rounded-xl font-bold cursor-pointer transition-colors ${
                    expenseFilter === 'all'
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {isEn ? 'All Expenses' : 'সব খরচ'} ({filteredExpenseItems.length})
                </button>
                <button
                  onClick={() => setExpenseFilter('family')}
                  className={`px-3 py-1 rounded-xl font-bold cursor-pointer transition-colors ${
                    expenseFilter === 'family'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100'
                  }`}
                >
                  👨‍👩‍👧 {isEn ? 'Family' : 'ফ্যামিলি খরচ'} ({familyExpenseItems.length})
                </button>
                <button
                  onClick={() => setExpenseFilter('shop')}
                  className={`px-3 py-1 rounded-xl font-bold cursor-pointer transition-colors ${
                    expenseFilter === 'shop'
                      ? 'bg-rose-600 text-white'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
                  }`}
                >
                  🏢 {isEn ? 'Shop Expense' : 'দোকান খরচ'} ({shopExpenseItems.length})
                </button>
                <button
                  onClick={() => setExpenseFilter('stock')}
                  className={`px-3 py-1 rounded-xl font-bold cursor-pointer transition-colors ${
                    expenseFilter === 'stock'
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100'
                  }`}
                >
                  📦 {isEn ? 'Stock Purchases' : 'স্টক কেনা'} ({stockPurchaseItems.length})
                </button>
              </div>

              {/* Itemized List */}
              <div className="space-y-2">
                {filteredExpenseItems.length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 text-xs">
                    {isEn ? 'No expense transactions recorded in this category.' : 'এই ক্যাটাগরিতে কোনো খরচের লেনদেন নেই।'}
                  </div>
                ) : (
                  filteredExpenseItems.map((tx, idx) => {
                    const isFamily = tx.type === 'personal_draw' || tx.type === 'owner_took';
                    const isStock = tx.type === 'stock_purchase';
                    const badgeText = isFamily 
                      ? (isEn ? 'Family Draw' : 'ফ্যামিলি খরচ') 
                      : isStock 
                        ? (isEn ? 'Stock Asset' : 'স্টক ক্রয়') 
                        : (isEn ? 'Shop Expense' : 'দোকানের খরচ');

                    const badgeColor = isFamily
                      ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                      : isStock
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';

                    const timeStr = tx.timestamp 
                      ? new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '';

                    return (
                      <div 
                        key={tx.id || `exp_${idx}`}
                        className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-2xs flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                            isFamily ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600' :
                            isStock ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-600' :
                            'bg-rose-50 dark:bg-rose-950/60 text-rose-600'
                          }`}>
                            {isFamily ? '👨‍👩‍👧' : isStock ? '📦' : '💸'}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                              {tx.note || tx.customerName || (isEn ? 'Expense Entry' : 'খরচ এন্ট্রি')}
                            </p>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              <span className={`px-2 py-0.5 rounded-md font-semibold text-xs ${badgeColor}`}>
                                {badgeText}
                              </span>
                              {timeStr && (
                                <>
                                  <span>•</span>
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-slate-400" />
                                    {timeStr}
                                  </span>
                                </>
                              )}
                              {tx.fromWallet && (
                                <>
                                  <span>•</span>
                                  <span>{tx.fromWallet === 'hand_cash' ? (lang === 'en' ? '💵 Cash' : '💵 ক্যাশ') : (wallets[tx.fromWallet]?.label || tx.fromWallet)}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="font-mono font-black text-xs sm:text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-2.5 py-1 rounded-xl border border-rose-200 dark:border-rose-800">
                            -{formatBDT(tx.amount || 0, lang)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {activeTab === 'profit' ? (
              <span>
                {isEn ? 'Total Net Profit:' : 'আজকের নিট লাভ:'}{' '}
                <strong className="text-emerald-600 font-mono text-sm">{formatBDT(netProfit, lang)}</strong>
              </span>
            ) : (
              <span>
                {isEn ? 'Total Cash Outflow:' : 'আজকের মোট খরচ:'}{' '}
                <strong className="text-rose-600 font-mono text-sm">{formatBDT(totalCashSpent, lang)}</strong>
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            {isEn ? 'Close Report' : 'রিপোর্ট বন্ধ করুন'}
          </button>
        </div>
      </div>
    </div>
  );
}
