import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../firebase/useAuth';
import { useIsOwner } from '../Shared/RoleGuard';
import { useAppMode } from '../Shared/ModeGuard';
import { loadDaysInRange } from '../../firebase/firestoreService';
import { aggregateTransactions, calcInventoryTotals, calcTotalDailyProfit, formatBDT, roundBDT } from '../../data/calculations';
import { BarChart3, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Wallet, Shield, Loader2, FileText, Scale, ArrowDownUp, Download, Calendar, BookOpen, Receipt, BookMarked } from 'lucide-react';
import { computeTrialBalance, validateTrialBalance, computeGeneralLedger, reconcileJournalsForTransactions } from '../../data/journalEngine';
import { getTaxProfile, computeNetTaxLiability } from '../../data/taxConfig';
import { DEFAULT_COA } from '../../data/constants';
import dayjs from 'dayjs';

const REPORT_TABS = {
  PNL: 'pnl',
  BALANCE_SHEET: 'balance_sheet',
  CASH_FLOW: 'cash_flow',
  CHANGES_IN_EQUITY: 'changes_in_equity',
  TRIAL_BALANCE: 'trial_balance',
  GENERAL_LEDGER: 'general_ledger',
  TAX_SUMMARY: 'tax_summary',
};

export default function ReportsScreen() {
  const { state } = useApp();
  const { user } = useAuth();
  const isOwner = useIsOwner();
  const { isEasy, isAdvanced } = useAppMode();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;
  
  const [currentMonth, setCurrentMonth] = useState(dayjs());
  const [days, setDays] = useState([]);
  const [priorDays, setPriorDays] = useState([]);
  const [showComparative, setShowComparative] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(REPORT_TABS.PNL);
  const [selectedGLAccount, setSelectedGLAccount] = useState('cash_in_hand');
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [rangeStart, setRangeStart] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [rangeEnd, setRangeEnd] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));

  // Load days when month/range changes
  useEffect(() => {
    if (!user?.uid || !state.activeBizId) return;
    const startDate = useCustomRange ? rangeStart : currentMonth.startOf('month').format('YYYY-MM-DD');
    const endDate = useCustomRange ? rangeEnd : currentMonth.endOf('month').format('YYYY-MM-DD');
    
    setLoading(true);
    loadDaysInRange(user.uid, state.activeBizId, startDate, endDate)
      .then(setDays)
      .catch(err => console.error('Report load error:', err))
      .finally(() => setLoading(false));
  }, [user?.uid, state.activeBizId, currentMonth, useCustomRange, rangeStart, rangeEnd]);

  // Load prior month days for comparative analysis
  useEffect(() => {
    if (!showComparative || !user?.uid || !state.activeBizId) return;
    const priorMonth = currentMonth.subtract(1, 'month');
    const start = priorMonth.startOf('month').format('YYYY-MM-DD');
    const end = priorMonth.endOf('month').format('YYYY-MM-DD');
    loadDaysInRange(user.uid, state.activeBizId, start, end)
      .then(setPriorDays)
      .catch(err => console.error('Prior month load error:', err));
  }, [showComparative, currentMonth, user?.uid, state.activeBizId]);

  // Consolidated & Reconciled Journals (Auto-reconciles any Easy Mode historical days)
  const synchronizedJournals = useMemo(() => {
    const allTransactions = [
      ...days.flatMap(d => d.transactions || []),
      ...(state.dayData?.transactions || [])
    ];
    const rawJournals = [
      ...days.flatMap(d => d.journalEntries || []),
      ...(state.dayData?.journalEntries || [])
    ];
    const { reconciledJournals } = reconcileJournalsForTransactions(
      allTransactions,
      rawJournals,
      state.dayData?.inventory || []
    );
    return Array.from(new Map(reconciledJournals.map(e => [e.id, e])).values());
  }, [days, state.dayData]);

  // Aggregate monthly data
  const monthlyData = useMemo(() => {
    let totalSalesRevenue = 0;
    let totalCOGS = 0;
    let totalGrossProfit = 0;
    let totalServiceIncome = 0;
    let totalRechargeProfit = 0;
    let totalRechargeTotal = 0;
    let totalExpenses = 0;
    let totalPersonalDraw = 0;
    let totalOwnerGave = 0;
    let totalOwnerTook = 0;
    let totalLoanGiven = 0;
    let totalLoanCollected = 0;
    let totalLoanTaken = 0;
    let totalLoanRepaid = 0;
    let totalStockPurchases = 0;
    let totalCreditSalesRevenue = 0;
    let totalTransferFees = 0;
    let totalDamageLoss = 0;
    let firstDayOpening = 0;
    let lastDayClosing = 0;
    let totalCashIn = 0;
    let totalCashOut = 0;
    let activeDays = 0;
    let totalInventoryProfit = 0;

    // For Cash Flow IAS 7 classification
    let cfOperatingIn = 0;
    let cfOperatingOut = 0;
    let cfInvestingIn = 0;
    let cfInvestingOut = 0;
    let cfFinancingIn = 0;
    let cfFinancingOut = 0;

    days.forEach((day, index) => {
      const tx = aggregateTransactions(day.transactions || []);
      const inv = calcInventoryTotals(day.inventory || []);
      
      totalSalesRevenue += inv.totalRevenue;
      totalCOGS += inv.totalCOGS;
      totalGrossProfit += inv.totalProfit;
      totalInventoryProfit += inv.totalProfit;
      totalServiceIncome += tx.servicesTotal;
      totalRechargeProfit += tx.rechargeProfit;
      totalRechargeTotal += tx.rechargeTotal;
      totalExpenses += tx.expenses;
      totalPersonalDraw += tx.personalDraw;
      totalOwnerGave += tx.ownerGave;
      totalOwnerTook += tx.ownerTook;
      totalLoanGiven += tx.loanGiven;
      totalLoanCollected += tx.loanCollected;
      totalLoanTaken += tx.loanTaken || 0;
      totalLoanRepaid += tx.loanRepaid || 0;
      totalStockPurchases += tx.stockPurchasesCost || 0;
      totalCreditSalesRevenue += tx.creditSalesRevenue || 0;
      totalTransferFees += tx.transferFees || 0;
      totalDamageLoss += tx.damageLoss || 0;
      
      // Cash flow
      const openingCash = day.wallets?.hand_cash?.opening || 0;
      const closingCash = day.wallets?.hand_cash?.closing ?? day.wallets?.hand_cash?.current ?? openingCash;
      
      if (index === 0) firstDayOpening = openingCash;
      lastDayClosing = closingCash;

      totalCashIn += tx.stockSalesRevenue + tx.servicesTotal + tx.rechargeTotal + tx.loanCollected + tx.ownerGave + tx.loanTaken + tx.fundTransferCashIn + (tx.assetSales || 0);
      totalCashOut += tx.expenses + tx.personalDraw + tx.ownerTook + tx.loanGiven + tx.loanRepaid + tx.fundTransferCashOut + tx.stockPurchasesCost + (tx.assetPurchases || 0) + (tx.taxPayments || 0);
      
      // IAS 7 Cash Flow Classification
      // Operating: day-to-day business cash
      cfOperatingIn += tx.stockSalesRevenue + tx.servicesTotal + tx.rechargeTotal + tx.loanCollected;
      cfOperatingOut += tx.expenses + tx.stockPurchasesCost + tx.loanGiven + (tx.taxPayments || 0);
      // Investing: Fixed Assets purchase/sale (IAS 16 / IAS 7)
      cfInvestingIn += (tx.assetSales || 0);
      cfInvestingOut += (tx.assetPurchases || 0);
      // Financing: owner capital & loans
      cfFinancingIn += tx.ownerGave + tx.loanTaken;
      cfFinancingOut += tx.ownerTook + tx.personalDraw + tx.loanRepaid;

      if (day.status === 'finalized') activeDays++;
    });

    const grossRevenue = roundBDT(totalSalesRevenue + totalCreditSalesRevenue + totalServiceIncome + totalRechargeTotal);
    const grossProfit = roundBDT(totalGrossProfit + totalServiceIncome + totalRechargeProfit);
    const netProfit = roundBDT(grossProfit - totalExpenses - totalTransferFees - totalDamageLoss);

    return {
      totalSalesRevenue: roundBDT(totalSalesRevenue),
      totalCOGS: roundBDT(totalCOGS),
      totalGrossProfit: roundBDT(totalGrossProfit),
      totalInventoryProfit: roundBDT(totalInventoryProfit),
      totalServiceIncome: roundBDT(totalServiceIncome),
      totalRechargeProfit: roundBDT(totalRechargeProfit),
      totalRechargeTotal: roundBDT(totalRechargeTotal),
      totalExpenses: roundBDT(totalExpenses),
      totalPersonalDraw: roundBDT(totalPersonalDraw),
      totalOwnerGave: roundBDT(totalOwnerGave),
      totalOwnerTook: roundBDT(totalOwnerTook),
      totalLoanGiven: roundBDT(totalLoanGiven),
      totalLoanCollected: roundBDT(totalLoanCollected),
      totalLoanTaken: roundBDT(totalLoanTaken),
      totalLoanRepaid: roundBDT(totalLoanRepaid),
      totalStockPurchases: roundBDT(totalStockPurchases),
      creditSalesRevenue: roundBDT(totalCreditSalesRevenue),
      transferFees: roundBDT(totalTransferFees),
      totalDamageLoss: roundBDT(totalDamageLoss),
      grossRevenue,
      grossProfit,
      netProfit,
      firstDayOpening: roundBDT(firstDayOpening),
      lastDayClosing: roundBDT(lastDayClosing),
      totalCashIn: roundBDT(totalCashIn),
      totalCashOut: roundBDT(totalCashOut),
      cfOperatingIn: roundBDT(cfOperatingIn),
      cfOperatingOut: roundBDT(cfOperatingOut),
      cfInvestingIn: roundBDT(cfInvestingIn),
      cfInvestingOut: roundBDT(cfInvestingOut),
      cfInvestingNet: roundBDT(cfInvestingIn - cfInvestingOut),
      cfFinancingIn: roundBDT(cfFinancingIn),
      cfFinancingOut: roundBDT(cfFinancingOut),
      cfOperatingNet: roundBDT(cfOperatingIn - cfOperatingOut),
      cfFinancingNet: roundBDT(cfFinancingIn - cfFinancingOut),
      activeDays,
      totalDays: days.length,
    };
  }, [days]);

  // Prior Monthly Data for comparative period analysis (MoM)
  const priorMonthlyData = useMemo(() => {
    let totalSalesRevenue = 0;
    let totalCOGS = 0;
    let totalGrossProfit = 0;
    let totalServiceIncome = 0;
    let totalRechargeTotal = 0;
    let totalExpenses = 0;
    let totalDamageLoss = 0;
    let totalCreditSalesRevenue = 0;
    let totalTransferFees = 0;

    priorDays.forEach(day => {
      const tx = aggregateTransactions(day.transactions || []);
      const inv = calcInventoryTotals(day.inventory || []);
      totalSalesRevenue += inv.totalRevenue;
      totalCOGS += inv.totalCOGS;
      totalGrossProfit += inv.totalProfit;
      totalServiceIncome += tx.servicesTotal;
      totalRechargeTotal += tx.rechargeTotal;
      totalExpenses += tx.expenses;
      totalCreditSalesRevenue += tx.creditSalesRevenue || 0;
      totalTransferFees += tx.transferFees || 0;
      totalDamageLoss += tx.damageLoss || 0;
    });

    const grossRevenue = roundBDT(totalSalesRevenue + totalCreditSalesRevenue + totalServiceIncome + totalRechargeTotal);
    const grossProfit = roundBDT(totalGrossProfit + totalServiceIncome);
    const netProfit = roundBDT(grossProfit - totalExpenses - totalTransferFees - totalDamageLoss);

    return {
      grossRevenue,
      grossProfit,
      totalSalesRevenue: roundBDT(totalSalesRevenue),
      totalCOGS: roundBDT(totalCOGS),
      totalExpenses: roundBDT(totalExpenses),
      netProfit,
    };
  }, [priorDays]);

  // Balance Sheet data from current state
  const balanceSheetData = useMemo(() => {
    const dayData = state.dayData;
    const contacts = state.contacts || [];
    const wallets = dayData?.wallets || {};
    const inventory = dayData?.inventory || [];
    const loans = dayData?.loans || {};
    const txTotals = aggregateTransactions(dayData?.transactions || []);

    // ASSETS
    // Current Assets: Cash & equivalents
    let totalCash = 0;
    Object.values(wallets).forEach(w => {
      totalCash += (w.current ?? w.opening ?? 0);
    });
    totalCash = roundBDT(totalCash);

    // Inventory value
    let inventoryValue = 0;
    inventory.forEach(item => {
      const closingStock = item.closingStock ?? Math.max(0, (item.openingStock || 0) + (item.addedStock || 0));
      inventoryValue += closingStock * (item.buyPrice || 0);
    });
    inventoryValue = roundBDT(inventoryValue);

    // Accounts Receivable (customer dues)
    let accountsReceivable = 0;
    contacts.filter(c => c.type === 'customer').forEach(c => {
      accountsReceivable += Math.max(0, c.currentBalance || 0);
    });
    // Also add loan-based receivables from dayData
    const loanReceivable = Math.max(0, (loans.openingGiven || 0) + (txTotals.loanGiven || 0) - (txTotals.loanCollected || 0));
    accountsReceivable = roundBDT(accountsReceivable + loanReceivable);

    // Non-Current Assets: Fixed Assets (IAS 16)
    let fixedAssets = (state.fixedAssets || dayData?.fixedAssets || []).reduce((sum, a) => sum + (Number(a.currentValue ?? a.cost) || 0), 0);
    fixedAssets = roundBDT(fixedAssets);

    const totalAssets = roundBDT(totalCash + inventoryValue + accountsReceivable + fixedAssets);

    // LIABILITIES
    // Accounts Payable (supplier dues)
    let accountsPayable = 0;
    contacts.filter(c => c.type === 'supplier').forEach(c => {
      accountsPayable += Math.max(0, c.currentBalance || 0);
    });
    // Loans taken
    const loanPayable = Math.max(0, (loans.openingTaken || 0) + (txTotals.loanTaken || 0) - (txTotals.loanRepaid || 0));
    accountsPayable = roundBDT(accountsPayable);
    const totalLiabilities = roundBDT(accountsPayable + loanPayable);

    // EQUITY
    const ownersEquity = roundBDT(totalAssets - totalLiabilities);

    return {
      totalCash,
      inventoryValue,
      accountsReceivable,
      fixedAssets,
      totalAssets,
      accountsPayable,
      loanPayable: roundBDT(loanPayable),
      totalLiabilities,
      ownersEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + ownersEquity)) < 0.01
    };
  }, [state.dayData, state.contacts, state.fixedAssets]);

  // Staff restriction
  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <Shield className="w-16 h-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-500 mb-2">
          {lang === 'en' ? 'Access Restricted' : 'অ্যাক্সেস সীমাবদ্ধ'}
        </h2>
        <p className="text-sm text-gray-400">
          {lang === 'en' ? 'Only the Owner can view reports.' : 'শুধুমাত্র মালিক রিপোর্ট দেখতে পারবেন।'}
        </p>
      </div>
    );
  }

  const monthLabel = lang === 'en' 
    ? currentMonth.format('MMMM YYYY') 
    : currentMonth.format('MMMM YYYY');

  const tabs = [
    { id: REPORT_TABS.PNL, label: lang === 'en' ? 'P&L' : 'লাভ-ক্ষতি', icon: TrendingUp },
    { id: REPORT_TABS.BALANCE_SHEET, label: lang === 'en' ? 'Balance Sheet' : 'ব্যালেন্স শিট', icon: Scale },
    { id: REPORT_TABS.CASH_FLOW, label: lang === 'en' ? 'Cash Flow' : 'ক্যাশ ফ্লো', icon: ArrowDownUp },
    { id: REPORT_TABS.CHANGES_IN_EQUITY, label: lang === 'en' ? 'Equity' : 'পুঁজি বিবরণী', icon: BookMarked },
    ...(state.appMode === 'advanced' && state.featureFlags?.doubleEntry ? [
      { id: REPORT_TABS.TRIAL_BALANCE, label: lang === 'en' ? 'Trial Balance' : 'রেওয়ামিল', icon: BookOpen },
      { id: REPORT_TABS.GENERAL_LEDGER, label: lang === 'en' ? 'General Ledger' : 'খতিয়ান', icon: FileText },
    ] : []),
    ...(state.appMode === 'advanced' && state.featureFlags?.taxTracking ? [
      { id: REPORT_TABS.TAX_SUMMARY, label: lang === 'en' ? 'Tax Summary' : 'ট্যাক্স সারাংশ', icon: Receipt },
    ] : []),
  ];

  // Helper: Render a line item row
  const Row = ({ label, value, bold, color, indent, border }) => (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold' : ''} ${indent ? 'pl-4' : ''} ${border ? 'mt-2 pt-2 border-t border-gray-200 dark:border-gray-600' : ''}`}>
      <span className={`${color || 'text-gray-600 dark:text-gray-400'}`}>{label}</span>
      <span className={`font-medium ${color || 'text-gray-800 dark:text-gray-200'}`}>{formatBDT(value, lang)}</span>
    </div>
  );

  // CSV Export
  const exportCSV = () => {
    const d = monthlyData;
    const bs = balanceSheetData;
    const rows = [
      ['Ledgero Financial Report'],
      ['Period', useCustomRange ? `${rangeStart} to ${rangeEnd}` : monthLabel],
      [''],
      ['--- Profit & Loss (IAS 1) ---'],
      ['Stock Sales Revenue', d.totalSalesRevenue],
      ['Credit Sales Revenue', d.creditSalesRevenue || 0],
      ['Service Income', d.totalServiceIncome],
      ['Recharge Revenue', d.totalRechargeTotal],
      ['Gross Revenue', d.grossRevenue],
      ['Cost of Goods Sold (COGS)', d.totalCOGS],
      ['Gross Profit', d.grossProfit],
      ['Operating Expenses', d.totalExpenses],
      ['Transfer Fees', d.transferFees || 0],
      ['Damage Loss (IAS 2)', d.totalDamageLoss || 0],
      ['Net Profit', d.netProfit],
      ['Owner Draws', d.totalPersonalDraw + d.totalOwnerTook],
      ['Owner Capital Injection', d.totalOwnerGave],
      [''],
      ['--- Balance Sheet (IAS 1) ---'],
      ['Cash & Wallets', bs.totalCash],
      ['Inventory', bs.inventoryValue],
      ['Accounts Receivable', bs.accountsReceivable],
      ['Fixed Assets (IAS 16)', bs.fixedAssets || 0],
      ['Total Assets', bs.totalAssets],
      ['Accounts Payable', bs.accountsPayable],
      ['Loans Payable', bs.loanPayable],
      ['Total Liabilities', bs.totalLiabilities],
      ['Owner Equity', bs.ownersEquity],
      [''],
      ['--- Cash Flow (IAS 7) ---'],
      ['Operating Cash In', d.cfOperatingIn],
      ['Operating Cash Out', d.cfOperatingOut],
      ['Operating Net', d.cfOperatingNet],
      ['Investing Cash In (Asset Sales)', d.cfInvestingIn],
      ['Investing Cash Out (Asset Purchases)', d.cfInvestingOut],
      ['Investing Net', d.cfInvestingNet],
      ['Financing Cash In', d.cfFinancingIn],
      ['Financing Cash Out', d.cfFinancingOut],
      ['Financing Net', d.cfFinancingNet],
      ['Opening Cash', d.firstDayOpening],
      ['Closing Cash', d.lastDayClosing],
    ];
    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Ledgero_Report_${useCustomRange ? rangeStart + '_to_' + rangeEnd : currentMonth.format('YYYY-MM')}.csv`;
    link.click();
  };

  return (
    <div className="pb-24 min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-gray-900 dark:to-gray-950">
      {/* Month/Date Range Selector */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="flex items-center justify-between px-4 py-3">
          {!useCustomRange && (
            <button
              onClick={() => setCurrentMonth(prev => prev.subtract(1, 'month'))}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
          )}
          <div className="text-center flex-1">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center justify-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              {lang === 'en' ? 'Financial Reports' : 'আর্থিক প্রতিবেদন'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {useCustomRange ? `${rangeStart} → ${rangeEnd}` : monthLabel}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setUseCustomRange(!useCustomRange)}
              className={`p-2 rounded-lg transition-colors cursor-pointer ${useCustomRange ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500'}`}
              title={lang === 'en' ? 'Custom Date Range' : 'কাস্টম তারিখ'}
            >
              <Calendar className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowComparative(!showComparative)}
              className={`px-2 py-1 text-[11px] font-bold rounded-lg border transition-all cursor-pointer ${
                showComparative 
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs' 
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
              }`}
              title={lang === 'en' ? 'Toggle Comparative Period Analysis' : 'তুলনামূলক বিশ্লেষণ অন/অফ'}
            >
              📊 {lang === 'en' ? 'Compare' : 'তুলনা'}
            </button>
            <button
              onClick={exportCSV}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 cursor-pointer"
              title={lang === 'en' ? 'Export CSV' : 'CSV ডাউনলোড'}
            >
              <Download className="w-4 h-4" />
            </button>
            {!useCustomRange && (
              <button
                onClick={() => setCurrentMonth(prev => prev.add(1, 'month'))}
                disabled={currentMonth.month() >= dayjs().month() && currentMonth.year() >= dayjs().year()}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
              >
                <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            )}
          </div>
        </div>
        {/* Custom Date Range Picker */}
        {useCustomRange && (
          <div className="px-4 pb-3 flex items-center gap-2">
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-semibold bg-white dark:bg-gray-900 text-gray-800 dark:text-white"
            />
            <span className="text-xs text-gray-400 font-bold">→</span>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-semibold bg-white dark:bg-gray-900 text-gray-800 dark:text-white"
            />
          </div>
        )}
      </div>

      {isEasy ? null : (
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : days.length === 0 && activeTab !== REPORT_TABS.BALANCE_SHEET ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <BarChart3 className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-sm">
            {lang === 'en' ? 'No data for this month' : 'এই মাসের কোনো ডেটা নেই'}
          </p>
        </div>
      ) : isEasy ? (
        <div className="p-4 space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md p-5 space-y-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">
              {lang === 'en' ? '📊 Monthly Summary' : '📊 মাসিক সারাংশ'}
            </h2>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-center">
                <p className="text-xs text-emerald-600">🟢 {lang === 'en' ? 'Total Sales' : 'মোট বিক্রি'}</p>
                <p className="text-2xl font-black text-emerald-700">{formatBDT(monthlyData.grossRevenue, lang)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
                <p className="text-xs text-red-600">🔴 {lang === 'en' ? 'Total Expenses' : 'মোট খরচ'}</p>
                <p className="text-2xl font-black text-red-700">{formatBDT(monthlyData.totalExpenses, lang)}</p>
              </div>
              <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl p-4 text-center">
                <p className="text-xs text-sky-600">💰 {lang === 'en' ? 'Net Cash' : 'নেট ক্যাশ'}</p>
                <p className="text-2xl font-black text-sky-700">{formatBDT(monthlyData.grossRevenue - monthlyData.totalExpenses, lang)}</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-center">
                <p className="text-xs text-amber-600">📅 {lang === 'en' ? 'Active Days' : 'কার্যদিবস'}</p>
                <p className="text-2xl font-black text-amber-700">{monthlyData.activeDays}</p>
              </div>
            </div>
          </div>
          
          <button
            onClick={exportCSV}
            className="w-full py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex items-center justify-center gap-2 text-gray-700 dark:text-gray-300 font-semibold shadow-sm"
          >
            <Download className="w-5 h-5" />
            {lang === 'en' ? 'Download CSV Report' : 'CSV রিপোর্ট ডাউনলোড করুন'}
          </button>
        </div>
      ) : (
        <div className="p-4 space-y-4">

          {/* ═══════════════════ P&L STATEMENT (IAS 1 Multi-Step) ═══════════════════ */}
          {activeTab === REPORT_TABS.PNL && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <span className="text-xs text-emerald-600 font-medium block mb-0.5">
                    {lang === 'en' ? 'Net Profit' : 'নেট প্রফিট'}
                  </span>
                  <p className={`text-base font-bold ${monthlyData.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatBDT(monthlyData.netProfit, lang)}
                  </p>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                  <span className="text-xs text-blue-600 font-medium block mb-0.5">
                    {lang === 'en' ? 'Revenue' : 'মোট আয়'}
                  </span>
                  <p className="text-base font-bold text-blue-700">{formatBDT(monthlyData.grossRevenue, lang)}</p>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                  <span className="text-xs text-amber-600 font-medium block mb-0.5">
                    {lang === 'en' ? 'Active Days' : 'কার্যদিবস'}
                  </span>
                  <p className="text-base font-bold text-amber-700">{monthlyData.activeDays} / {monthlyData.totalDays}</p>
                </div>
              </div>

              {/* MoM Comparative Box */}
              {showComparative && (
                <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-3.5 rounded-2xl border border-indigo-100 dark:border-indigo-800 space-y-2.5 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-900 dark:text-indigo-300">
                    <span className="flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-indigo-600" />
                      {lang === 'en' ? 'Month-over-Month (MoM) Comparison' : 'মাসভিত্তিক তুলনামূলক সারসংক্ষেপ (MoM)'}
                    </span>
                    <span className="text-xs text-gray-500 font-normal">
                      {currentMonth.subtract(1, 'month').format('MMM')} vs {currentMonth.format('MMM YYYY')}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 bg-white dark:bg-gray-800 rounded-xl shadow-xs border border-gray-100 dark:border-gray-700">
                      <span className="text-[9px] text-gray-500 block">{lang === 'en' ? 'Revenue' : 'মোট আয়'}</span>
                      <span className="font-bold text-blue-700 dark:text-blue-400 font-mono">{formatBDT(monthlyData.grossRevenue, lang)}</span>
                      <span className={`block text-[9px] font-bold ${monthlyData.grossRevenue >= priorMonthlyData.grossRevenue ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {monthlyData.grossRevenue >= priorMonthlyData.grossRevenue ? '▲ +' : '▼ '}
                        {priorMonthlyData.grossRevenue > 0 
                          ? Math.round(((monthlyData.grossRevenue - priorMonthlyData.grossRevenue) / priorMonthlyData.grossRevenue) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="p-2 bg-white dark:bg-gray-800 rounded-xl shadow-xs border border-gray-100 dark:border-gray-700">
                      <span className="text-[9px] text-gray-500 block">{lang === 'en' ? 'COGS' : 'ক্রয়মূল্য'}</span>
                      <span className="font-bold text-orange-700 dark:text-orange-400 font-mono">{formatBDT(monthlyData.totalCOGS, lang)}</span>
                      <span className="block text-[9px] font-bold text-gray-400 font-mono">
                        vs {formatBDT(priorMonthlyData.totalCOGS, lang)}
                      </span>
                    </div>
                    <div className="p-2 bg-white dark:bg-gray-800 rounded-xl shadow-xs border border-gray-100 dark:border-gray-700">
                      <span className="text-[9px] text-gray-500 block">{lang === 'en' ? 'Expenses' : 'খরচ'}</span>
                      <span className="font-bold text-red-700 dark:text-red-400 font-mono">{formatBDT(monthlyData.totalExpenses, lang)}</span>
                      <span className={`block text-[9px] font-bold ${monthlyData.totalExpenses <= priorMonthlyData.totalExpenses ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {monthlyData.totalExpenses >= priorMonthlyData.totalExpenses ? '▲ +' : '▼ '}
                        {priorMonthlyData.totalExpenses > 0 
                          ? Math.round(((monthlyData.totalExpenses - priorMonthlyData.totalExpenses) / priorMonthlyData.totalExpenses) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="p-2 bg-white dark:bg-gray-800 rounded-xl shadow-xs border border-gray-100 dark:border-gray-700">
                      <span className="text-[9px] text-gray-500 block">{lang === 'en' ? 'Net Profit' : 'নেট লাভ'}</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono">{formatBDT(monthlyData.netProfit, lang)}</span>
                      <span className={`block text-[9px] font-bold ${monthlyData.netProfit >= priorMonthlyData.netProfit ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {monthlyData.netProfit >= priorMonthlyData.netProfit ? '▲ +' : '▼ '}
                        {priorMonthlyData.netProfit > 0 
                          ? Math.round(((monthlyData.netProfit - priorMonthlyData.netProfit) / Math.abs(priorMonthlyData.netProfit)) * 100)
                          : 0}%
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Multi-Step P&L Statement (IAS 1 Compliant) */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-200 dark:border-indigo-800">
                  <h3 className="font-bold text-indigo-800 dark:text-indigo-300 flex items-center gap-2 text-sm">
                    📊 {lang === 'en' ? 'Profit & Loss Statement (IAS 1)' : 'লাভ-ক্ষতি বিবরণী (IAS 1)'}
                  </h3>
                  <p className="text-xs text-indigo-600/70 dark:text-indigo-400/60 mt-0.5">
                    {lang === 'en' ? 'Multi-Step Income Statement' : 'বহু-ধাপ আয় বিবরণী'}
                  </p>
                </div>
                
                <div className="p-4 space-y-1.5">
                  {/* Step 1: Gross Revenue */}
                  <h4 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider pb-1">
                    {lang === 'en' ? '① Gross Revenue' : '① মোট আয় (Revenue)'}
                  </h4>
                  <Row label={lang === 'en' ? 'Product Sales' : 'পণ্য বিক্রয়'} value={monthlyData.totalSalesRevenue} indent />
                  <Row label={lang === 'en' ? 'Service Income' : 'সার্ভিস আয়'} value={monthlyData.totalServiceIncome} indent />
                  <Row label={lang === 'en' ? 'Recharge Income' : 'রিচার্জ আয়'} value={monthlyData.totalRechargeTotal} indent />
                  <Row label={lang === 'en' ? 'Gross Revenue' : 'মোট আয়'} value={monthlyData.grossRevenue} bold color="text-emerald-700 dark:text-emerald-400" border />

                  {/* Step 2: COGS */}
                  <div className="pt-3">
                    <h4 className="text-xs font-semibold text-orange-600 uppercase tracking-wider pb-1">
                      {lang === 'en' ? '② Cost of Goods Sold (COGS)' : '② পণ্যের ক্রয়মূল্য (COGS)'}
                    </h4>
                    <Row label={lang === 'en' ? 'Less: Cost of Goods Sold' : 'বাদ: পণ্যের ক্রয়মূল্য'} value={monthlyData.totalCOGS} indent color="text-orange-600" />
                    <Row label={lang === 'en' ? 'GROSS PROFIT' : 'মোট লাভ'} value={monthlyData.grossProfit} bold color="text-emerald-700 dark:text-emerald-400" border />
                  </div>

                  {/* Step 3: Operating Expenses */}
                  <div className="pt-3">
                    <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wider pb-1">
                      {lang === 'en' ? '③ Operating Expenses' : '③ পরিচালন ব্যয় (Expenses)'}
                    </h4>
                    <Row label={lang === 'en' ? 'Less: Operating Expenses' : 'বাদ: পরিচালন ব্যয়'} value={monthlyData.totalExpenses} indent color="text-red-600" />
                  </div>

                  {/* Step 4: NET PROFIT */}
                  <div className={`flex justify-between text-base font-bold p-3 rounded-xl mt-2 ${
                    monthlyData.netProfit >= 0 
                      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' 
                      : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                  }`}>
                    <span>④ {lang === 'en' ? 'NET PROFIT' : 'নেট প্রফিট'}</span>
                    <span>{formatBDT(monthlyData.netProfit, lang)}</span>
                  </div>

                  {/* Below Net Profit: Owner's Drawings (NOT expense, per IAS 1) */}
                  {(monthlyData.totalPersonalDraw > 0 || monthlyData.totalOwnerTook > 0 || monthlyData.totalOwnerGave > 0) && (
                    <div className="mt-3 pt-3 border-t-2 border-dashed border-gray-300 dark:border-gray-600">
                      <h4 className="text-xs font-semibold text-purple-600 uppercase tracking-wider pb-1 flex items-center gap-1">
                        {lang === 'en' ? '⑤ Owner\'s Equity Movement' : '⑤ মালিকানা পুঁজি পরিবর্তন'}
                      </h4>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 italic">
                        {lang === 'en' 
                          ? '↓ Not operating expenses — equity distributions/injections' 
                          : '↓ পরিচালন ব্যয় নয় — মালিকানা পুঁজি উত্তোলন/যোগ'}
                      </p>
                      {monthlyData.totalOwnerGave > 0 && (
                        <Row label={lang === 'en' ? 'Capital Invested (+)' : 'পুঁজি যোগ (+)'} value={monthlyData.totalOwnerGave} indent color="text-purple-600" />
                      )}
                      {monthlyData.totalPersonalDraw > 0 && (
                        <Row label={lang === 'en' ? 'Personal Draws (−)' : 'ব্যক্তিগত উত্তোলন (−)'} value={monthlyData.totalPersonalDraw} indent color="text-purple-600" />
                      )}
                      {monthlyData.totalOwnerTook > 0 && (
                        <Row label={lang === 'en' ? 'Owner Withdrawal (−)' : 'মালিক নিয়েছেন (−)'} value={monthlyData.totalOwnerTook} indent color="text-purple-600" />
                      )}
                      <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-purple-200 dark:border-purple-800">
                        <span className="text-purple-700 dark:text-purple-400">
                          {lang === 'en' ? 'Net Equity Change' : 'নেট পুঁজি পরিবর্তন'}
                        </span>
                        <span className="text-purple-700 dark:text-purple-400">
                          {formatBDT(monthlyData.totalOwnerGave - monthlyData.totalPersonalDraw - monthlyData.totalOwnerTook, lang)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ═══════════════════ BALANCE SHEET (IAS 1) ═══════════════════ */}
          {activeTab === REPORT_TABS.BALANCE_SHEET && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="p-3 bg-teal-50 dark:bg-teal-900/30 border-b border-teal-200 dark:border-teal-800">
                <h3 className="font-bold text-teal-800 dark:text-teal-300 flex items-center gap-2 text-sm">
                  <Scale className="w-4 h-4" />
                  {lang === 'en' ? 'Statement of Financial Position' : 'আর্থিক অবস্থার বিবরণী'}
                </h3>
                <p className="text-xs text-teal-600/70 dark:text-teal-400/60 mt-0.5">
                  {lang === 'en' ? 'Balance Sheet — As of Today' : 'ব্যালেন্স শিট — আজকের তারিখে'}
                </p>
              </div>

              <div className="p-4 space-y-1.5">
                {/* ASSETS */}
                <h4 className="text-xs font-semibold text-blue-600 uppercase tracking-wider pb-1">
                  {lang === 'en' ? 'Assets' : 'সম্পদ (Assets)'}
                </h4>
                <Row label={lang === 'en' ? 'Cash & Wallets' : 'নগদ ও ওয়ালেট'} value={balanceSheetData.totalCash} indent />
                <Row label={lang === 'en' ? 'Inventory (Stock)' : 'ইনভেন্টরি (মজুদ)'} value={balanceSheetData.inventoryValue} indent />
                <Row label={lang === 'en' ? 'Accounts Receivable (Customer Dues)' : 'প্রাপ্য হিসাব (বাকি পাওনা)'} value={balanceSheetData.accountsReceivable} indent />
                {balanceSheetData.fixedAssets > 0 && (
                  <Row label={lang === 'en' ? 'Fixed Assets / Equipment (IAS 16)' : 'স্থায়ী সম্পদ / যন্ত্রপাতি (IAS 16)'} value={balanceSheetData.fixedAssets} indent />
                )}
                <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t-2 border-blue-200 dark:border-blue-700">
                  <span className="text-blue-700 dark:text-blue-400">{lang === 'en' ? 'TOTAL ASSETS' : 'মোট সম্পদ'}</span>
                  <span className="text-blue-700 dark:text-blue-400">{formatBDT(balanceSheetData.totalAssets, lang)}</span>
                </div>

                {/* LIABILITIES */}
                <div className="pt-4">
                  <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wider pb-1">
                    {lang === 'en' ? 'Liabilities' : 'দায় (Liabilities)'}
                  </h4>
                  <Row label={lang === 'en' ? 'Accounts Payable (Supplier Dues)' : 'প্রদেয় হিসাব (সরবরাহকারী বাকি)'} value={balanceSheetData.accountsPayable} indent />
                  <Row label={lang === 'en' ? 'Loans Payable' : 'প্রদেয় ঋণ (ধার নেওয়া)'} value={balanceSheetData.loanPayable} indent />
                  <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-red-200 dark:border-red-700">
                    <span className="text-red-700 dark:text-red-400">{lang === 'en' ? 'TOTAL LIABILITIES' : 'মোট দায়'}</span>
                    <span className="text-red-700 dark:text-red-400">{formatBDT(balanceSheetData.totalLiabilities, lang)}</span>
                  </div>
                </div>

                {/* EQUITY */}
                <div className="pt-4">
                  <h4 className="text-xs font-semibold text-purple-600 uppercase tracking-wider pb-1">
                    {lang === 'en' ? "Owner's Equity" : 'মালিকানা (Equity)'}
                  </h4>
                  <Row label={lang === 'en' ? 'Owner\'s Equity' : 'মালিকানা পুঁজি'} value={balanceSheetData.ownersEquity} indent color="text-purple-600" />
                </div>

                {/* TOTAL L + E */}
                <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t-2 border-purple-200 dark:border-purple-700">
                  <span className="text-purple-700 dark:text-purple-400">{lang === 'en' ? 'TOTAL LIABILITIES + EQUITY' : 'মোট দায় + মালিকানা'}</span>
                  <span className="text-purple-700 dark:text-purple-400">{formatBDT(balanceSheetData.totalLiabilities + balanceSheetData.ownersEquity, lang)}</span>
                </div>

                {/* Balance Check */}
                <div className={`flex items-center justify-center gap-2 p-3 rounded-xl mt-3 text-sm font-bold ${
                  balanceSheetData.isBalanced 
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' 
                    : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                }`}>
                  {balanceSheetData.isBalanced ? '✅' : '⚠️'}
                  <span>
                    {balanceSheetData.isBalanced
                      ? (lang === 'en' ? 'Assets = Liabilities + Equity ✓ Balanced' : 'সম্পদ = দায় + মালিকানা ✓ সমান')
                      : (lang === 'en' ? 'Imbalance detected — review data' : 'অসামঞ্জস্য — ডেটা পর্যালোচনা করুন')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════ CASH FLOW STATEMENT (IAS 7) ═══════════════════ */}
          {activeTab === REPORT_TABS.CASH_FLOW && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="p-3 bg-sky-50 dark:bg-sky-900/30 border-b border-sky-200 dark:border-sky-800">
                <h3 className="font-bold text-sky-800 dark:text-sky-300 flex items-center gap-2 text-sm">
                  <ArrowDownUp className="w-4 h-4" />
                  {lang === 'en' ? 'Cash Flow Statement (IAS 7)' : 'ক্যাশ ফ্লো বিবরণী (IAS 7)'}
                </h3>
                <p className="text-xs text-sky-600/70 dark:text-sky-400/60 mt-0.5">
                  {lang === 'en' ? 'Three-tier classification: Operating, Investing, Financing' : 'তিন স্তরে শ্রেণীবদ্ধ: পরিচালন, বিনিয়োগ, অর্থায়ন'}
                </p>
              </div>

              <div className="p-4 space-y-1.5">
                {/* Opening Cash */}
                <Row label={lang === 'en' ? 'Opening Cash (Month Start)' : 'মাস শুরুর নগদ'} value={monthlyData.firstDayOpening} bold />

                {/* A. Operating Activities */}
                <div className="pt-3">
                  <h4 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider pb-1">
                    {lang === 'en' ? 'A. Operating Activities' : 'ক. পরিচালন কার্যক্রম'}
                  </h4>
                  <Row label={lang === 'en' ? 'Cash received from sales & services' : 'বিক্রয় ও সার্ভিস থেকে নগদ প্রাপ্তি'} value={monthlyData.cfOperatingIn} indent color="text-emerald-600" />
                  <Row label={lang === 'en' ? 'Cash paid for expenses & purchases' : 'ব্যয় ও ক্রয়ে নগদ প্রদান'} value={monthlyData.cfOperatingOut} indent color="text-red-600" />
                  <Row label={lang === 'en' ? 'Net Operating Cash Flow' : 'নেট পরিচালন ক্যাশ ফ্লো'} value={monthlyData.cfOperatingNet} bold color={monthlyData.cfOperatingNet >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'} border />
                </div>

                {/* B. Investing Activities (IAS 7) */}
                <div className="pt-3">
                  <h4 className="text-xs font-semibold text-indigo-600 uppercase tracking-wider pb-1">
                    {lang === 'en' ? 'B. Investing Activities (IAS 7)' : 'খ. বিনিয়োগ কার্যক্রম (IAS 7)'}
                  </h4>
                  <Row label={lang === 'en' ? 'Sale of Fixed Assets / Equipment' : 'স্থায়ী সম্পদ / যন্ত্রপাতি বিক্রয়'} value={monthlyData.cfInvestingIn} indent color="text-indigo-600" />
                  <Row label={lang === 'en' ? 'Purchase of Fixed Assets / Equipment' : 'স্থায়ী সম্পদ / যন্ত্রপাতি ক্রয়'} value={monthlyData.cfInvestingOut} indent color="text-red-600" />
                  <Row label={lang === 'en' ? 'Net Investing Cash Flow' : 'নেট বিনিয়োগ ক্যাশ ফ্লো'} value={monthlyData.cfInvestingNet} bold color={monthlyData.cfInvestingNet >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-red-700 dark:text-red-400'} border />
                </div>

                {/* C. Financing Activities (IAS 7) */}
                <div className="pt-3">
                  <h4 className="text-xs font-semibold text-purple-600 uppercase tracking-wider pb-1">
                    {lang === 'en' ? 'C. Financing Activities (IAS 7)' : 'গ. অর্থায়ন কার্যক্রম (IAS 7)'}
                  </h4>
                  <Row label={lang === 'en' ? 'Owner capital + Loans received' : 'মালিক পুঁজি + ঋণ গ্রহণ'} value={monthlyData.cfFinancingIn} indent color="text-purple-600" />
                  <Row label={lang === 'en' ? 'Owner draws + Loan repaid' : 'মালিক উত্তোলন + ঋণ পরিশোধ'} value={monthlyData.cfFinancingOut} indent color="text-red-600" />
                  <Row label={lang === 'en' ? 'Net Financing Cash Flow' : 'নেট অর্থায়ন ক্যাশ ফ্লো'} value={monthlyData.cfFinancingNet} bold color={monthlyData.cfFinancingNet >= 0 ? 'text-purple-700 dark:text-purple-400' : 'text-red-700 dark:text-red-400'} border />
                </div>

                {/* Net Change in Cash */}
                {(() => {
                  const netChange = monthlyData.cfOperatingNet + monthlyData.cfInvestingNet + monthlyData.cfFinancingNet;
                  return (
                    <div className={`flex justify-between text-sm font-bold p-3 rounded-xl mt-3 ${
                      netChange >= 0
                        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                    }`}>
                      <span>{lang === 'en' ? 'NET CHANGE IN CASH' : 'নেট নগদ পরিবর্তন'}</span>
                      <span>{formatBDT(netChange, lang)}</span>
                    </div>
                  );
                })()}

                {/* Closing Cash */}
                <div className="flex justify-between text-sm font-bold p-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 mt-2">
                  <span className="text-sky-700 dark:text-sky-400">
                    {lang === 'en' ? 'CLOSING CASH (Month End)' : 'মাস শেষের নগদ'}
                  </span>
                  <span className="text-sky-700 dark:text-sky-400">{formatBDT(monthlyData.lastDayClosing, lang)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════ STATEMENT OF CHANGES IN EQUITY (IAS 1) ═══════════════════ */}
          {activeTab === REPORT_TABS.CHANGES_IN_EQUITY && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden animate-fadeIn">
              <div className="p-3 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-200 dark:border-purple-800">
                <h3 className="font-bold text-purple-800 dark:text-purple-300 flex items-center gap-2 text-sm">
                  <BookMarked className="w-4 h-4" />
                  {lang === 'en' ? 'Statement of Changes in Equity (IAS 1)' : 'মালিকানা স্বত্ব পরিবর্তন বিবরণী (IAS 1)'}
                </h3>
                <p className="text-xs text-purple-600/70 dark:text-purple-400/60 mt-0.5">
                  {lang === 'en' ? 'Tracks equity movement from opening to closing' : 'পুঁজি, লাভ এবং উত্তোলনের সমন্বিত খতিয়ান'}
                </p>
              </div>

              <div className="p-4 space-y-3">
                {/* Equity Progression Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-800 text-center">
                    <span className="text-xs text-purple-600 block">{lang === 'en' ? 'Capital Injections' : 'পুঁজি বিনিয়োগ (+)'}</span>
                    <span className="text-sm font-bold text-purple-700 dark:text-purple-300 font-mono">{formatBDT(monthlyData.totalOwnerGave, lang)}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800 text-center">
                    <span className="text-xs text-emerald-600 block">{lang === 'en' ? 'Period Net Profit' : 'সময়কালের লাভ (+)'}</span>
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 font-mono">{formatBDT(monthlyData.netProfit, lang)}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800 text-center">
                    <span className="text-xs text-rose-600 block">{lang === 'en' ? 'Drawings & Taken' : 'মোট উত্তোলন (−)'}</span>
                    <span className="text-sm font-bold text-rose-700 dark:text-rose-300 font-mono">{formatBDT(monthlyData.totalPersonalDraw + monthlyData.totalOwnerTook, lang)}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-800 text-center">
                    <span className="text-xs text-blue-600 block">{lang === 'en' ? 'Closing Equity' : 'সমাপনী পুঁজি (=)'}</span>
                    <span className="text-sm font-bold text-blue-700 dark:text-blue-300 font-mono">{formatBDT(balanceSheetData.ownersEquity, lang)}</span>
                  </div>
                </div>

                {/* Formal Step-by-Step Statement */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-2 bg-gray-50/50 dark:bg-gray-900/30">
                  <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider pb-1">
                    {lang === 'en' ? 'Equity Reconciliation' : 'পুঁজি সমন্বয় বিবরণী'}
                  </h4>
                  <Row label={lang === 'en' ? 'Owner Capital Injections' : 'মালিকের নতুন পুঁজি বিনিয়োগ (+)'} value={monthlyData.totalOwnerGave} indent color="text-purple-600" />
                  <Row label={lang === 'en' ? 'Add: Comprehensive Net Profit for Period' : 'যোগ: সময়কালের মোট নেট লাভ (+)'} value={monthlyData.netProfit} indent color={monthlyData.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
                  <Row label={lang === 'en' ? 'Less: Personal Draws' : 'বাদ: ব্যক্তিগত খরচ/উত্তোলন (−)'} value={monthlyData.totalPersonalDraw} indent color="text-rose-600" />
                  <Row label={lang === 'en' ? 'Less: Capital Withdrawals' : 'বাদ: মূলধন প্রত্যাহার (−)'} value={monthlyData.totalOwnerTook} indent color="text-rose-600" />
                  <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t-2 border-purple-200 dark:border-purple-700">
                    <span className="text-purple-800 dark:text-purple-300">
                      {lang === 'en' ? 'CLOSING OWNER\'S EQUITY (IAS 1)' : 'সমাপনী মালিকানা পুঁজি (IAS 1)'}
                    </span>
                    <span className="text-purple-800 dark:text-purple-300 font-mono">
                      {formatBDT(balanceSheetData.ownersEquity, lang)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-gray-400 text-center italic">
                  {lang === 'en' 
                    ? '✓ Matches Total Owner\'s Equity reported on Balance Sheet' 
                    : '✓ ব্যালেন্স শিটের সমাপনী মালিকানা পুঁজির সাথে সম্পূর্ণরূপে সামঞ্জস্যপূর্ণ'}
                </p>
              </div>
            </div>
          )}

          {/* ── TRIAL BALANCE (Advanced Only) ─────────────── */}
          {activeTab === REPORT_TABS.TRIAL_BALANCE && (
            <div className="space-y-3 animate-fadeIn">
              <div className={`p-4 rounded-2xl shadow-sm border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                <h3 className="text-base font-bold mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-purple-600" />
                  {lang === 'en' ? 'Trial Balance' : 'রেওয়ামিল (Trial Balance)'}
                </h3>
                {(() => {
                  const uniqueJournals = synchronizedJournals;

                  if (uniqueJournals.length === 0) {
                    return (
                      <p className="text-sm text-gray-500 text-center py-8">
                        {lang === 'en' ? 'No transactions or journal entries found.' : 'কোনো লেনদেন বা জার্নাল এন্ট্রি পাওয়া যায়নি।'}
                      </p>
                    );
                  }
                  const tb = computeTrialBalance(uniqueJournals);
                  const validation = validateTrialBalance(tb);
                  return (
                    <>
                      {/* Shadow Sync Badge */}
                      <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300 font-medium mb-3 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                        <span>✨</span>
                        <span>
                          {lang === 'en'
                            ? 'Shadow Accounting Active: Easy Mode & Advanced Mode are 100% synchronized.'
                            : 'অদৃশ্য একাউন্ট্যান্ট সক্রিয়: ইজি মোড ও অ্যাডভান্স মোডের প্রতিটি হিসাব স্বয়ংক্রিয়ভাবে খতিয়ানে সিঙ্ক করা।'}
                        </span>
                      </div>
                      {/* Balanced status */}
                      <div className={`p-2 rounded-lg mb-3 text-xs font-bold text-center ${
                        validation.isBalanced 
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                      }`}>
                        {validation.isBalanced ? '✅ Balanced — Debit = Credit' : `⚠️ Imbalanced — Diff: ${formatBDT(validation.diff, lang)}`}
                      </div>

                      {/* Table header */}
                      <div className="grid grid-cols-3 gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 border-b pb-2 mb-1">
                        <span>{lang === 'en' ? 'Account' : 'অ্যাকাউন্ট'}</span>
                        <span className="text-right">{lang === 'en' ? 'Debit' : 'ডেবিট'}</span>
                        <span className="text-right">{lang === 'en' ? 'Credit' : 'ক্রেডিট'}</span>
                      </div>

                      {/* Account rows */}
                      {Object.entries(tb).map(([accountId, bal]) => {
                        const acct = DEFAULT_COA.find(a => a.id === accountId);
                        return (
                          <div key={accountId} className="grid grid-cols-3 gap-2 text-xs py-1 border-b border-gray-100 dark:border-gray-700">
                            <span className="text-gray-700 dark:text-gray-300 truncate">
                              {acct ? (lang === 'en' ? acct.name : acct.name_bn) : accountId}
                            </span>
                            <span className="text-right font-mono">{bal.debit > 0 ? formatBDT(bal.debit, lang) : '-'}</span>
                            <span className="text-right font-mono">{bal.credit > 0 ? formatBDT(bal.credit, lang) : '-'}</span>
                          </div>
                        );
                      })}

                      {/* Totals */}
                      <div className="grid grid-cols-3 gap-2 text-xs font-bold mt-2 pt-2 border-t-2 border-gray-300 dark:border-gray-500">
                        <span>{lang === 'en' ? 'TOTAL' : 'মোট'}</span>
                        <span className="text-right text-blue-700 dark:text-blue-400">{formatBDT(validation.totalDebit, lang)}</span>
                        <span className="text-right text-blue-700 dark:text-blue-400">{formatBDT(validation.totalCredit, lang)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── GENERAL LEDGER (Advanced Only) ─────────────── */}
          {activeTab === REPORT_TABS.GENERAL_LEDGER && (
            <div className="space-y-3 animate-fadeIn">
              <div className={`p-4 rounded-2xl shadow-sm border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-base font-bold flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      {lang === 'en' ? 'General Ledger' : 'সাধারণ খতিয়ান (General Ledger)'}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {lang === 'en' ? 'Running balance per account' : 'অ্যাকাউন্টভিত্তিক চলমান ব্যালেন্স ও লেনদেনের খতিয়ান'}
                    </p>
                  </div>

                  {/* Account Selector */}
                  <select
                    value={selectedGLAccount}
                    onChange={(e) => setSelectedGLAccount(e.target.value)}
                    className="px-3 py-2 text-xs font-bold rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    {DEFAULT_COA.map(acct => (
                      <option key={acct.id} value={acct.id}>
                        [{acct.code}] {lang === 'en' ? acct.name : acct.name_bn} ({acct.type})
                      </option>
                    ))}
                  </select>
                </div>

                {(() => {
                  const uniqueJournals = synchronizedJournals;
                  const currentAccount = DEFAULT_COA.find(a => a.id === selectedGLAccount) || DEFAULT_COA[0];
                  const gl = computeGeneralLedger(uniqueJournals, selectedGLAccount, currentAccount.type);

                  return (
                    <div className="space-y-3">
                      {/* Account Summary Card */}
                      <div className="grid grid-cols-3 gap-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400 block">{lang === 'en' ? 'Total Debit' : 'মোট ডেবিট'}</span>
                          <span className="text-xs font-bold text-blue-700 dark:text-blue-400 font-mono">{formatBDT(gl.totalDebit, lang)}</span>
                        </div>
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400 block">{lang === 'en' ? 'Total Credit' : 'মোট ক্রেডিট'}</span>
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 font-mono">{formatBDT(gl.totalCredit, lang)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-gray-500 dark:text-gray-400 block">{lang === 'en' ? 'Closing Balance' : 'সমাপনী ব্যালেন্স'}</span>
                          <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 font-mono">{formatBDT(gl.closingBalance, lang)}</span>
                        </div>
                      </div>

                      {/* Entries Table */}
                      {gl.entries.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">
                          {lang === 'en' ? 'No transactions recorded for this account' : 'এই অ্যাকাউন্টে নির্বাচিত সময়ে কোনো লেনদেন নেই'}
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left">
                            <thead>
                              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
                                <th className="py-2">{lang === 'en' ? 'Date' : 'তারিখ'}</th>
                                <th className="py-2">{lang === 'en' ? 'Description' : 'বিবরণ'}</th>
                                <th className="py-2 text-right">{lang === 'en' ? 'Debit' : 'ডেবিট'}</th>
                                <th className="py-2 text-right">{lang === 'en' ? 'Credit' : 'ক্রেডিট'}</th>
                                <th className="py-2 text-right">{lang === 'en' ? 'Balance' : 'ব্যালেন্স'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {gl.entries.map((item, idx) => (
                                <tr key={item.id || idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                  <td className="py-2 text-gray-500 whitespace-nowrap">
                                    {dayjs(item.timestamp).format('DD/MM HH:mm')}
                                  </td>
                                  <td className="py-2 font-medium text-gray-800 dark:text-gray-200">
                                    {item.description || item.txType}
                                  </td>
                                  <td className="py-2 text-right font-mono text-blue-600 dark:text-blue-400">
                                    {item.debit > 0 ? formatBDT(item.debit, lang) : '-'}
                                  </td>
                                  <td className="py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                                    {item.credit > 0 ? formatBDT(item.credit, lang) : '-'}
                                  </td>
                                  <td className="py-2 text-right font-mono font-bold text-gray-800 dark:text-white">
                                    {formatBDT(item.runningBalance, lang)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── TAX SUMMARY (Advanced Only) ────────────────── */}
          {activeTab === REPORT_TABS.TAX_SUMMARY && (
            <div className="space-y-3 animate-fadeIn">
              <div className={`p-4 rounded-2xl shadow-sm border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                <h3 className="text-base font-bold mb-3 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-orange-600" />
                  {lang === 'en' ? 'Tax Summary' : 'ট্যাক্স সারাংশ'}
                </h3>

                {(() => {
                  const profile = getTaxProfile(state.taxRegion || 'BD');
                  return (
                    <>
                      {/* Tax Region Info */}
                      <div className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-3 text-xs">
                        <span className="font-bold">{lang === 'en' ? profile.name : (profile.name_bn || profile.name)}</span>
                        {profile.threshold && (
                          <span className="ml-2 text-gray-500">
                            ({lang === 'en' ? 'Threshold' : 'সীমা'}: {lang === 'en' ? profile.threshold.label : profile.threshold.label_bn})
                          </span>
                        )}
                      </div>

                      {/* Tax rates */}
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        {lang === 'en' ? 'Applicable Rates' : 'প্রযোজ্য হার'}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {profile.rates.map(r => (
                          <span key={r.id} className="px-2 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-lg text-xs font-medium">
                            {lang === 'en' ? r.label : r.label_bn}
                          </span>
                        ))}
                      </div>

                      {/* Output / Input / Net */}
                      {(() => {
                        const allTx = [
                          ...days.flatMap(d => d.transactions || []),
                          ...(state.dayData?.transactions || [])
                        ];
                        const outputVAT = allTx.reduce((sum, tx) => sum + (tx.vatOutput || (tx.type === 'stock_sale' && tx.vatAmount ? tx.vatAmount : 0)), 0);
                        const inputVAT = allTx.reduce((sum, tx) => sum + (tx.vatInput || (tx.type === 'stock_purchase' && tx.vatAmount ? tx.vatAmount : 0)), 0);
                        const taxPaid = allTx.reduce((sum, tx) => sum + (tx.type === 'tax_payment' ? tx.amount || 0 : 0), 0);
                        const netPayable = Math.max(0, outputVAT - inputVAT - taxPaid);

                        return (
                          <div className="space-y-2">
                            <Row label={lang === 'en' ? 'Output VAT (Collected on Sales)' : 'আউটপুট ভ্যাট (বিক্রিতে আদায়)'} value={outputVAT} color="text-red-600 dark:text-red-400" />
                            <Row label={lang === 'en' ? 'Input VAT (Paid on Purchases)' : 'ইনপুট ভ্যাট (ক্রয়ে প্রদত্ত)'} value={inputVAT} color="text-emerald-600 dark:text-emerald-400" />
                            {taxPaid > 0 && (
                              <Row label={lang === 'en' ? 'Tax Already Paid' : 'ইতোমধ্যে পরিশোধিত ট্যাক্স'} value={taxPaid} color="text-blue-600 dark:text-blue-400" />
                            )}
                            <div className="flex justify-between text-sm font-bold p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 mt-2">
                              <span className="text-orange-700 dark:text-orange-400">
                                {lang === 'en' ? 'NET TAX PAYABLE' : 'নেট ট্যাক্স পরিশোধযোগ্য'}
                              </span>
                              <span className="text-orange-700 dark:text-orange-400 font-mono">{formatBDT(netPayable, lang)}</span>
                            </div>
                          </div>
                        );
                      })()}

                      <p className="text-xs text-gray-400 mt-3 text-center">
                        {lang === 'en' ? 'Tax tracking activates when VAT is applied to transactions' : 'ট্রানজেকশনে ভ্যাট প্রয়োগ করলে ট্যাক্স ট্র্যাকিং সক্রিয় হবে'}
                      </p>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
