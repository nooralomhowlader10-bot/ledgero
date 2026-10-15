import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useAppMode } from '../Shared/ModeGuard';
import {
  calcItemSummary,
  calcInventoryTotals,
  calcExpectedHandCash,
  calcCashMismatch,
  calcTotalDailyProfit,
  aggregateTransactions,
  formatBDT
} from '../../data/calculations';
import {
  WALLET_KEYS,
  WALLET_LABELS,
  GENERAL_WALLET_LABELS,
  DAY_STATUS,
  SCREENS
} from '../../data/constants';
import { t, translateUnit } from '../../data/translations';
import {
  Package,
  Smartphone,
  Banknote,
  FileText,
  Check,
  AlertTriangle,
  Download,
  Lock,
  ChevronRight,
  ChevronLeft,
  Calculator,
  Sparkles,
  Shield,
  AlertCircle,
  BarChart3,
  Database
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportToGoogleSheets } from '../../firebase/sheetsService';
import { useAuth } from '../../firebase/useAuth';
import { saveDayToCloud } from '../../firebase/firestoreService';
import { exportAllData as exportAllStorageData } from '../../data/storage';
import { useIsOwner } from '../Shared/RoleGuard';
import CashDifferenceModal from './CashDifferenceModal';
import ClosingFinancialDetailModal from './ClosingFinancialDetailModal';

const ClosingScreen = () => {
  const { state, dispatch, userId, exportAllData } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const { sheetsAccessToken, connectGoogleSheets, hasSheetsPermission } = useAuth();
  const isOwner = useIsOwner();
  const { dayData, activeBiz, language } = state;
  const lang = language || 'bn';
  const [currentStep, setCurrentStep] = useState(1);
  const [closingStocks, setClosingStocks] = useState({});
  const [walletBalances, setWalletBalances] = useState({});
  const [actualCash, setActualCash] = useState(0);
  const [sheetsExporting, setSheetsExporting] = useState(false);
  const [sheetsResult, setSheetsResult] = useState(null); // { success, message, url }
  const [showCashDiffModal, setShowCashDiffModal] = useState(false);
  const [showFinancialModal, setShowFinancialModal] = useState(false);
  const [financialModalTab, setFinancialModalTab] = useState('profit');
  const [showTeaHouseModal, setShowTeaHouseModal] = useState(false);
  const [teaFilter, setTeaFilter] = useState('all'); // 'all', 'personal', 'shop'

  // Banknote denominations state for Step 3
  const [denominations, setDenominations] = useState({
    1000: '',
    500: '',
    200: '',
    100: '',
    50: '',
    20: '',
    10: '',
    5: '',
    2: '',
    1: '',
  });
  const [showDenomSheet, setShowDenomSheet] = useState(false);
  const [adjustmentMessage, setAdjustmentMessage] = useState('');

  const totalDenominationSum = useMemo(() => {
    return Object.entries(denominations).reduce((sum, [note, count]) => {
      const noteVal = Number(note) || 0;
      const countVal = parseInt(count, 10) || 0;
      return sum + (noteVal * countVal);
    }, 0);
  }, [denominations]);

  const handleDenominationChange = (note, val) => {
    setDenominations(prev => ({
      ...prev,
      [note]: val === '' ? '' : Math.max(0, parseInt(val, 10) || 0)
    }));
  };

  const handleApplyDenominations = () => {
    setActualCash(totalDenominationSum);
  };

  const handleResetDenominations = () => {
    setDenominations({
      1000: '',
      500: '',
      200: '',
      100: '',
      50: '',
      20: '',
      10: '',
      5: '',
      2: '',
      1: '',
    });
  };

  const getWalletLabel = (key) => dayData?.wallets?.[key]?.label || WALLET_LABELS[key] || GENERAL_WALLET_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  useEffect(() => {
    if (dayData && dayData.inventory) {
      const initialStocks = {};
      dayData.inventory.forEach(item => {
        const currentAvailable = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
        const soldUnits = (dayData?.transactions || [])
          .filter(t => t.type === 'stock_sale' && t.itemId === item.id && !t.reversed && !t.isReversal)
          .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);
        const damagedUnits = (dayData?.transactions || [])
          .filter(t => (t.type === 'stock_damage' || t.type === 'damage_loss') && t.itemId === item.id && !t.reversed && !t.isReversal)
          .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

        let defaultClosing = item.closingStock !== null && item.closingStock !== undefined
          ? item.closingStock 
          : currentAvailable;
        if (defaultClosing === 0 && currentAvailable > 0 && soldUnits === 0 && damagedUnits === 0) {
          defaultClosing = currentAvailable;
        }
        initialStocks[item.id] = defaultClosing;
      });
      setClosingStocks(initialStocks);
    }
    
    if (dayData && dayData.wallets) {
      const initialWallets = {};
      Object.keys(dayData.wallets).forEach(key => {
        if (key !== WALLET_KEYS.HAND_CASH) {
          initialWallets[key] = dayData.wallets[key].current;
        }
      });
      setWalletBalances(initialWallets);
      
      setActualCash(dayData.actualCash !== null ? dayData.actualCash : (dayData.wallets.hand_cash?.current || 0));
    }
  }, [dayData]);

  const inventoryTotals = useMemo(() => calcInventoryTotals(state.dayData?.inventory || []), [state.dayData?.inventory]);
  const txTotals = useMemo(() => aggregateTransactions(state.dayData?.transactions || []), [state.dayData?.transactions]);

  if (!dayData) return <div>No active day</div>;

  const isFinalized = dayData.status === DAY_STATUS.FINALIZED;

  const handleStockChange = (id, value) => {
    const parsed = parseInt(value, 10);
    setClosingStocks(prev => ({
      ...prev,
      [id]: isNaN(parsed) ? 0 : parsed
    }));
  };

  const handleWalletChange = (key, value) => {
    const parsed = parseFloat(value);
    setWalletBalances(prev => ({
      ...prev,
      [key]: isNaN(parsed) ? 0 : parsed
    }));
  };

  // Calculations for Step 1
  const inventoryItems = dayData.inventory.map(item => {
    const currentAvailable = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
    const soldUnits = (dayData?.transactions || [])
      .filter(t => t.type === 'stock_sale' && t.itemId === item.id && !t.reversed && !t.isReversal)
      .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);
    const damagedUnits = (dayData?.transactions || [])
      .filter(t => (t.type === 'stock_damage' || t.type === 'damage_loss') && t.itemId === item.id && !t.reversed && !t.isReversal)
      .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

    let defaultClosing = item.closingStock !== null && item.closingStock !== undefined
      ? item.closingStock 
      : currentAvailable;
    if (defaultClosing === 0 && currentAvailable > 0 && soldUnits === 0 && damagedUnits === 0) {
      defaultClosing = currentAvailable;
    }

    return {
      ...item,
      closingStock: closingStocks[item.id] !== undefined ? closingStocks[item.id] : defaultClosing
    };
  });

  const inventorySummary = inventoryItems.map(item => ({
    ...item,
    ...calcItemSummary(item)
  }));

  // Calculations for Step 3
  // Use transaction-based revenue (txTotals.stockSalesRevenue) which includes ALL cash sales,
  // including non-inventory "নগদ বিক্রি" sales. Inventory-based revenue misses sales without itemId.
  const salesRevenueToUse = txTotals.stockSalesRevenue || 0;
  // For recharge from hand_cash: drawer pays amount, then receives (amount+profit) from customer.
  // Net effect on drawer = only profit. So we subtract the hand_cash recharge amount to avoid double-counting.
  const rechargeIncomeForCash = Math.max(0, (txTotals.rechargeTotal || 0) - (txTotals.rechargeFromHandCash || 0));
  const expectedCash = calcExpectedHandCash({
    openingCash: dayData.wallets.hand_cash?.opening || 0,
    salesRevenue: salesRevenueToUse,
    servicesIncome: txTotals.servicesTotal,
    rechargeIncome: rechargeIncomeForCash + (txTotals.rechargeProfit || 0),
    loanCollected: txTotals.loanCollected,
    loanTaken: txTotals.loanTaken || 0,
    loanRepaid: txTotals.loanRepaid || 0,
    ownerGave: txTotals.ownerGave || 0,
    ownerTook: txTotals.ownerTook || 0,
    expenses: txTotals.expenses,
    personalDraw: txTotals.personalDraw,
    loanGiven: txTotals.loanGiven,
    fundTransferNet: txTotals.fundTransferNet,
    stockPurchases: txTotals.stockPurchasesCost || 0,
    assetPurchases: txTotals.assetPurchases || 0,
    taxPayments: txTotals.taxPayments || 0,
  });

  const cashMismatch = calcCashMismatch(expectedCash, actualCash);

  const totalStockValue = useMemo(() => {
    return (dayData?.inventory || []).reduce((sum, item) => {
      const qty = Number(item.closingStock !== null && item.closingStock !== undefined ? item.closingStock : ((Number(item.openingStock) || 0) + (Number(item.addedStock) || 0))) || 0;
      const price = Number(item.buyPrice) || 0;
      return sum + (qty * price);
    }, 0);
  }, [dayData?.inventory]);

  const digitalWalletsTotal = useMemo(() => {
    return Object.entries(dayData?.wallets || {}).reduce((sum, [k, w]) => {
      if (k === 'hand_cash') return sum;
      return sum + (Number(w?.current) || 0);
    }, 0);
  }, [dayData?.wallets]);

  const totalReceivable = useMemo(() => {
    return (state.contacts || []).reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);
  }, [state.contacts]);

  const currentHandCash = actualCash !== '' && actualCash !== null && actualCash !== undefined ? Number(actualCash) : (dayData?.wallets?.hand_cash?.current || 0);
  const totalStoreWealth = currentHandCash + totalStockValue + digitalWalletsTotal + totalReceivable;

  const handleRoundingAdjustment = () => {
    if (Math.abs(cashMismatch) > 100 || cashMismatch === 0) return;
    
    if (cashMismatch < 0) {
      // Drawer has less cash than expected: record rounding expense
      const shortage = Math.abs(cashMismatch);
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'expense',
          amount: shortage,
          note: lang === 'en' ? 'Rounding Adjustment (Shortage)' : 'খুচরা ভাংতি ও ছাড় সমন্বয় (Rounding Adjustment)',
          category: 'rounding_adjustment',
        }
      });
      setAdjustmentMessage(lang === 'en' ? `✅ Tk ${shortage} rounded as expense adjustment.` : `✅ ৳${shortage} খুচরা ভাংতি/ছাড় খরচ সমন্বয় করা হয়েছে।`);
    } else {
      // Drawer has more cash than expected: record rounding income
      const excess = cashMismatch;
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'service_income',
          serviceType: 'photocopy',
          amount: excess,
          note: lang === 'en' ? 'Rounding Adjustment (Excess Cash)' : 'খুচরা ভাংতি বাড়তি জমা (Rounding Adjustment)',
        }
      });
      setAdjustmentMessage(lang === 'en' ? `✅ Tk ${excess} rounded as extra cash-in.` : `✅ ৳${excess} খুচরা ভাংতি বাড়তি জমা সমন্বয় করা হয়েছে।`);
    }

    setTimeout(() => setAdjustmentMessage(''), 5000);
  };

  // Calculations for Step 4
  const dailyProfit = calcTotalDailyProfit({
    inventoryProfit: inventoryTotals.totalProfit,
    photocopyTotal: txTotals.photocopy,
    studioTotal: txTotals.studio,
    rechargeProfit: txTotals.rechargeProfit || 0,
    totalExpenses: txTotals.expenses,
    damageLoss: txTotals.damageLoss || 0,
    transferFees: txTotals.transferFees || 0,
  });

  // Audited profit directly from itemized transaction trades
  const auditedSalesProfit = (dayData?.transactions || [])
    .filter(tx => !tx.reversed && !tx.isReversal && (tx.type === 'stock_sale' || tx.type === 'cash_sale'))
    .reduce((sum, tx) => sum + (tx.profit !== undefined ? tx.profit : Math.round((tx.amount || 0) * 0.15)), 0);
  const closingAuditedProfit = (dayData?.transactions || []).some(tx => !tx.reversed && !tx.isReversal && (tx.type === 'stock_sale' || tx.type === 'cash_sale'))
    ? (auditedSalesProfit + (txTotals.rechargeProfit || 0) + (txTotals.servicesTotal || 0) - (txTotals.expenses || 0) - (txTotals.damageLoss || 0) - (txTotals.transferFees || 0))
    : dailyProfit;

  // ── Google Sheets Export Handler ──────────────────────────────────────────
  const handleSheetsExport = async (forcePrompt = false) => {
    setSheetsExporting(true);
    setSheetsResult(null);
    
    // Get token — try existing first, then auto-refresh
    let token = sheetsAccessToken;
    if (!token || forcePrompt) {
      try {
        token = await connectGoogleSheets();
      } catch (err) {
        console.warn('Sheets connect was cancelled or failed:', err);
        setSheetsResult({ 
          success: false, 
          needsAuth: true,
          message: lang === 'en' ? 'Google Sheets permission not granted. Click button to connect.' : 'Google Sheets পারমিশন দেওয়া হয়নি। বাটনে ক্লিক করে কানেক্ট করুন।'
        });
        setSheetsExporting(false);
        return;
      }
    }
    
    if (!token) {
      setSheetsResult({ 
        success: false, 
        needsAuth: true,
        message: lang === 'en' ? 'Google Sheets permission not found. Click button to connect.' : 'Google Sheets পারমিশন পাওয়া যায়নি। বাটনে ক্লিক করে কানেক্ট করুন।'
      });
      setSheetsExporting(false);
      return;
    }

    try {
      const result = await exportToGoogleSheets(token, userId, dayData, activeBiz, lang);
      setSheetsResult({ 
        success: true, 
        message: lang === 'en' ? `✅ "${result.tabTitle}" successfully saved to Google Sheets!` : `✅ "${result.tabTitle}" সফলভাবে Google Sheets-এ সেভ হয়েছে!`,
        url: result.url
      });
      dispatch({ type: 'SET_SHEETS_EXPORTED', payload: true });
    } catch (err) {
      console.error('Sheets export error:', err);
      // If token expired (401/403), auto-retry with fresh token
      if (err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('scopes')) {
        try {
          const freshToken = await connectGoogleSheets();
          if (freshToken) {
            const retryResult = await exportToGoogleSheets(freshToken, userId, dayData, activeBiz, lang);
            setSheetsResult({ 
              success: true, 
              message: lang === 'en' ? `✅ "${retryResult.tabTitle}" successfully saved to Google Sheets!` : `✅ "${retryResult.tabTitle}" সফলভাবে Google Sheets-এ সেভ হয়েছে!`,
              url: retryResult.url
            });
            dispatch({ type: 'SET_SHEETS_EXPORTED', payload: true });
            setSheetsExporting(false);
            return;
          }
        } catch (retryErr) {
          console.warn('Auto-retry failed:', retryErr);
        }
        setSheetsResult({ 
          success: false, 
          needsAuth: true,
          message: lang === 'en' ? '❌ Google Sheets permission expired. Click button to reconnect.' : '❌ Google Sheets পারমিশন মেয়াদ শেষ। বাটনে ক্লিক করে আবার কানেক্ট করুন।'
        });
      } else {
        setSheetsResult({ success: false, message: lang === 'en' ? `❌ Sheets export failed: ${err.message}` : `❌ Sheets এক্সপোর্ট ব্যর্থ: ${err.message}` });
      }
    } finally {
      setSheetsExporting(false);
    }
  };

  const handleFinalize = async () => {
    if (window.confirm("Are you sure you want to finalize this day? This action cannot be undone.")) {
      
      // ⭐⭐⭐ CRITICAL: Get Sheets token IMMEDIATELY after confirm() — BEFORE any dispatch!
      // The user gesture from clicking OK on confirm() expires after React re-renders.
      // signInWithPopup() MUST be called while still in user gesture context.
      // Also: ALWAYS get a fresh token (expired tokens in sessionStorage cause silent failures).
      let sheetsToken = null;
      try {
        sheetsToken = await connectGoogleSheets();
      } catch (authErr) {
        console.warn('Sheets auth skipped:', authErr?.message);
        // User cancelled popup or it was blocked — continue with finalize, show manual button later
      }

      // Now proceed with finalize dispatches (safe — we already have the token)
      inventoryItems.forEach(item => {
        dispatch({
          type: 'SET_CLOSING_STOCK',
          payload: { itemId: item.id, quantity: item.closingStock }
        });
      });

      Object.keys(walletBalances).forEach(key => {
        dispatch({
          type: 'UPDATE_WALLET_BALANCE',
          payload: { walletKey: key, balance: walletBalances[key] }
        });
      });

      dispatch({
        type: 'SET_ACTUAL_CASH',
        payload: { amount: actualCash }
      });

      dispatch({ type: 'FINALIZE_DAY' });

      // Build finalized dayData snapshot for export
      const exportData = {
        ...state.dayData,
        actualCash,
        status: 'finalized',
        wallets: { ...state.dayData.wallets },
        teaHouseEntries: state.dayData?.teaHouseEntries || [],
        teaHouseDayPersonal: state.dayData?.teaHouseDayPersonal || 0,
        teaHouseDayShop: state.dayData?.teaHouseDayShop || 0,
        teaHouseMonthlyTab: state.teaHouseMonthlyTab || 0,
      };
      if (exportData.wallets) {
        Object.keys(exportData.wallets).forEach(key => {
          if (key === '_order') return;
          exportData.wallets[key] = {
            ...exportData.wallets[key],
            closing: exportData.wallets[key].current
          };
        });
      }

      // Export to Sheets with the pre-acquired token
      if (sheetsToken) {
        setSheetsExporting(true);
        try {
          const result = await exportToGoogleSheets(sheetsToken, userId, exportData, activeBiz, lang);
          setSheetsResult({
            success: true,
            message: lang === 'en' 
              ? `✅ Day finalized! "${result.tabTitle}" saved to Google Sheets!` 
              : `✅ দিন ফাইনালাইজড! "${result.tabTitle}" Google Sheets-এ সেভ হয়েছে!`,
            url: result.url
          });
          dispatch({ type: 'SET_SHEETS_EXPORTED', payload: true });
        } catch (exportErr) {
          console.error('Sheets export error:', exportErr);
          setSheetsResult({
            success: false,
            message: lang === 'en' 
              ? `❌ Sheets export failed: ${exportErr.message}. Click "Connect Google Sheets" to retry.` 
              : `❌ Sheets এক্সপোর্ট ব্যর্থ: ${exportErr.message}। নিচে "Google Sheets কানেক্ট করুন" ক্লিক করে আবার চেষ্টা করুন।`
          });
        } finally {
          setSheetsExporting(false);
        }
      } else {
        // No token — show manual connect button
        setSheetsResult({
          success: false,
          needsAuth: true,
          message: lang === 'en' 
            ? '⚠️ Google Sheets not connected. Click "Connect Google Sheets" below to export this day\'s data.' 
            : '⚠️ Google Sheets কানেক্ট হয়নি। নিচে "Google Sheets কানেক্ট করুন" ক্লিক করে আজকের ডাটা এক্সপোর্ট করুন।'
        });
      }

      // Save finalized data to cloud
      if (userId && state.activeBizId) {
        saveDayToCloud(userId, state.activeBizId, exportData).catch(err => {
          console.error('Immediate cloud save error:', err);
        });
      }
    }
  };

  const handleReopen = () => {
    if (window.confirm("Reopen this day for editing? You can make changes and finalize again.")) {
      dispatch({ type: 'REOPEN_DAY' });
    }
  };

  const generateExcel = () => {
    // Generate CSV format (opens in Excel)
    const rows = [];
    const dateStr = dayData.dateKey;
    
    // Header
    const bizTitle = activeBiz?.name || 'Ledgero';
    rows.push([`${bizTitle} Daily Report - ${dateStr}`]);
    rows.push([]);
    
    // Wallet Balances
    rows.push(['WALLET BALANCES']);
    rows.push(['Wallet', 'Opening', 'Closing']);
    Object.keys(dayData.wallets).forEach(key => {
      const wallet = dayData.wallets[key];
      const closing = key === 'hand_cash' ? actualCash : (walletBalances[key] ?? wallet.current);
      rows.push([getWalletLabel(key), wallet.opening, closing]);
    });
    // Section 6: Loans & Debts
    rows.push([lang === 'en' ? 'LOANS & DEBTS' : 'LOANS & DEBTS (ধার-দেনা)']);
    rows.push(['Category', 'Opening', 'Today Added', 'Today Settled', 'Closing Balance']);
    rows.push([
      lang === 'en' ? 'Market Due (Receivable)' : 'Market Due (আমার পাওনা)',
      dayData.loans?.openingGiven || 0,
      txTotals.loanGiven,
      txTotals.loanCollected,
      Math.max(0, (dayData.loans?.openingGiven || 0) + txTotals.loanGiven - txTotals.loanCollected)
    ]);
    rows.push([
      lang === 'en' ? 'Market Payable (Due to Supplier)' : 'Market Payable (আমার দেনা)',
      dayData.loans?.openingTaken || 0,
      txTotals.loanTaken || 0,
      txTotals.loanRepaid || 0,
      Math.max(0, (dayData.loans?.openingTaken || 0) + (txTotals.loanTaken || 0) - (txTotals.loanRepaid || 0))
    ]);
    rows.push([]);
    
    // Inventory
    rows.push(['INVENTORY SUMMARY']);
    rows.push(['Item Name', 'Unit', 'Opening', 'Added', 'Closing', 'Units Sold', 'Revenue', 'COGS', 'Profit']);
    inventorySummary.forEach(item => {
      rows.push([item.name, translateUnit(item.unit || 'পিস', lang), item.openingStock, item.addedStock, item.closingStock, item.unitsSold]);
    });
    rows.push(['TOTAL', '', '', '', '', inventoryTotals.totalUnitsSold, inventoryTotals.totalRevenue, inventoryTotals.totalCOGS, inventoryTotals.totalProfit]);
    rows.push([]);
    
    // Transactions
    rows.push(['TRANSACTIONS']);
    rows.push(['Time', 'Type', 'Amount', 'Note', 'From', 'To', 'Customer']);
    dayData.transactions.forEach(tx => {
      rows.push([
        new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tx.type,
        tx.amount,
        tx.note || '',
        tx.fromWallet ? getWalletLabel(tx.fromWallet) : '',
        tx.toWallet ? getWalletLabel(tx.toWallet) : '',
        tx.customerName || ''
      ]);
    });
    rows.push([]);
    
    // Summary
    rows.push(['PROFIT & LOSS']);
    rows.push(['Sales Revenue', inventoryTotals.totalRevenue]);
    rows.push(['COGS', inventoryTotals.totalCOGS]);
    rows.push(['Inventory Profit', inventoryTotals.totalProfit]);
    rows.push(['Service Income', txTotals.servicesTotal]);
    rows.push(['Recharge Profit', txTotals.rechargeProfit || 0]);
    rows.push(['Total Expenses', txTotals.expenses]);
    rows.push(['Personal Draws', txTotals.personalDraw]);
    rows.push(['Net Daily Profit', closingAuditedProfit]);
    rows.push([]);
    rows.push(['CASH RECONCILIATION']);
    rows.push(['Expected Hand Cash', expectedCash]);
    rows.push(['Actual Cash Counted', actualCash]);
    rows.push(['Cash Mismatch', cashMismatch]);
    
    // Convert to CSV
    const csvContent = rows.map(row => 
      row.map(cell => {
        const str = String(cell ?? '');
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    ).join('\n');
    
    // Add BOM for Excel to recognize UTF-8
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bizTitle.replace(/\s+/g, '_')}_${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonBackupDownload = async () => {
    try {
      let data = null;
      if (typeof exportAllData === 'function') {
        data = await exportAllData({ strict: true });
      }
      if (!data || data === '{}') {
        data = exportAllStorageData(state);
      }
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (parsed?.isPartial || parsed?.manifest?.isPartial || (parsed?.manifest?.errors && parsed.manifest.errors.length > 0)) {
        const errorList = (parsed.manifest?.errors || []).join('\n• ');
        const errMsg = lang === 'en'
          ? `⚠️ Incomplete Backup: Cloud backup could not read all collections. To protect accounting integrity, downloading an incomplete backup is prohibited.\n\nErrors:\n• ${errorList}`
          : `⚠️ অসম্পূর্ণ ব্যাকআপ: ক্লাউড থেকে সব ডেটা সম্পূর্ণভাবে পড়া যায়নি। হিসাবের নির্ভুলতা নিশ্চিত করতে অসম্পূর্ণ ব্যাকআপ ডাউনলোড নিষিদ্ধ।\n\nত্রুটিসমূহ:\n• ${errorList}`;
        alert(errMsg);
        return;
      }
      const jsonContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ledgero_backup_${(activeBiz?.name || 'shop').replace(/\s+/g, '_')}_${dayData?.dateKey || 'day'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Ledgero] Backup export error:', err);
      alert(lang === 'en' ? `Backup export failed: ${err.message}` : `ব্যাকআপ এক্সপোর্ট ব্যর্থ হয়েছে: ${err.message}`);
    }
  };

  const generatePDF = () => {
    try {
      const doc = new jsPDF();
      const dateStr = dayData.dateKey;
      const bizTitle = activeBiz?.name || 'Ledgero';
      let currentY = 10;
      
      doc.setFontSize(18);
      doc.text(`${bizTitle} Daily Summary`, 14, currentY + 10);
      doc.setFontSize(12);
      doc.text(`Date: ${dateStr}`, 14, currentY + 18);
      currentY += 26;

      // Section 1: Wallet Balances
      doc.setFontSize(13);
      doc.text('Wallet Balances', 14, currentY);
      currentY += 4;
      
      const walletRows = Object.keys(dayData.wallets).map(key => {
        const wallet = dayData.wallets[key];
        const closing = key === WALLET_KEYS.HAND_CASH ? actualCash : (walletBalances[key] ?? wallet.current);
        return [
          getWalletLabel(key),
          String(wallet.opening),
          String(closing)
        ];
      });
      
      autoTable(doc, {
        startY: currentY,
        head: [['Wallet', 'Opening', 'Closing']],
        body: walletRows,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
      });
      currentY = (doc.lastAutoTable?.finalY || currentY + 30) + 10;

      // Section 2: Inventory
      doc.setFontSize(13);
      doc.text('Inventory Summary', 14, currentY);
      currentY += 4;
      
      const invRows = inventorySummary.map(item => [
        item.name,
        String(item.unitsSold),
        String(item.salesRevenue),
        String(item.cogs),
        String(item.profit)
      ]);
      invRows.push(['TOTAL', String(inventoryTotals.totalUnitsSold), String(inventoryTotals.totalRevenue), String(inventoryTotals.totalCOGS), String(inventoryTotals.totalProfit)]);
      
      autoTable(doc, {
        startY: currentY,
        head: [['Item', 'Sold', 'Revenue', 'COGS', 'Profit']],
        body: invRows,
        theme: 'grid',
        headStyles: { fillColor: [39, 174, 96] },
      });
      currentY = (doc.lastAutoTable?.finalY || currentY + 40) + 10;

      // Section 3: Transactions
      if (dayData.transactions.length > 0) {
        doc.setFontSize(13);
        doc.text('Transactions', 14, currentY);
        currentY += 4;
        
        const txRows = dayData.transactions.map(tx => [
          new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          tx.type,
          tx.note || '',
          String(tx.amount)
        ]);
        
        autoTable(doc, {
          startY: currentY,
          head: [['Time', 'Type', 'Note', 'Amount']],
          body: txRows,
          theme: 'grid',
          headStyles: { fillColor: [142, 68, 173] },
        });
        currentY = (doc.lastAutoTable?.finalY || currentY + 30) + 10;
      }

      // Section 4: Profit/Loss
      doc.setFontSize(13);
      doc.text('Profit & Loss', 14, currentY);
      currentY += 4;
      
      const plRows = [
        ['Sales Revenue', String(inventoryTotals.totalRevenue)],
        ['COGS', String(inventoryTotals.totalCOGS)],
        ['Inventory Profit', String(inventoryTotals.totalProfit)],
        ['Service Income', String(txTotals.servicesTotal)],
        ['Recharge Profit', String(txTotals.rechargeProfit || 0)],
        ['Total Expenses', String(txTotals.expenses)],
        ['Personal Draws', String(txTotals.personalDraw)],
        ['Net Daily Profit', String(closingAuditedProfit)]
      ];
      
      autoTable(doc, {
        startY: currentY,
        head: [['Category', 'Amount (BDT)']],
        body: plRows,
        theme: 'grid',
        headStyles: { fillColor: [231, 76, 60] },
      });
      currentY = (doc.lastAutoTable?.finalY || currentY + 40) + 10;

      // Section 5: Cash Reconciliation
      doc.setFontSize(13);
      doc.text('Cash Reconciliation', 14, currentY);
      currentY += 4;
      
      const cashRows = [
        ['Opening Hand Cash', String(dayData.wallets.hand_cash?.opening || 0)],
        [lang === 'en' ? 'Owner Gave' : 'Owner Gave (মালিক দিল)', String(txTotals.ownerGave || 0)],
        [lang === 'en' ? 'Owner Took' : 'Owner Took (মালিক নিল)', String((txTotals.ownerTook || 0) + (txTotals.personalDraw || 0))],
        ['Expected Hand Cash', String(expectedCash)],
        ['Actual Cash Counted', String(actualCash)],
        ['Cash Mismatch', String(cashMismatch)]
      ];
      
      autoTable(doc, {
        startY: currentY,
        head: [['Description', 'Amount (BDT)']],
        body: cashRows,
        theme: 'grid',
        headStyles: { fillColor: [52, 73, 94] },
      });
      currentY = (doc.lastAutoTable?.finalY || currentY + 30) + 10;

      // Section 6: Loans & Debts
      doc.setFontSize(13);
      doc.text(lang === 'en' ? 'Loans & Debts' : 'Loans & Debts (ধার-দেনা)', 14, currentY);
      currentY += 4;
      
      const loanRows = [
        [
          lang === 'en' ? 'Market Due (Receivable)' : 'Market Due (আমার পাওনা)',
          String(dayData.loans?.openingGiven || 0),
          String(txTotals.loanGiven),
          String(txTotals.loanCollected),
          String(Math.max(0, (dayData.loans?.openingGiven || 0) + txTotals.loanGiven - txTotals.loanCollected))
        ],
        [
          lang === 'en' ? 'Market Payable' : 'Payable (আমার দেনা)',
          String(dayData.loans?.openingTaken || 0),
          String(txTotals.loanTaken || 0),
          String(txTotals.loanRepaid || 0),
          String(Math.max(0, (dayData.loans?.openingTaken || 0) + (txTotals.loanTaken || 0) - (txTotals.loanRepaid || 0)))
        ]
      ];
      
      autoTable(doc, {
        startY: currentY,
        head: [['Loan Type', 'Opening', 'New Today', 'Settled Today', 'Closing']],
        body: loanRows,
        theme: 'grid',
        headStyles: { fillColor: [108, 92, 231] },
      });

      doc.save(`Ledgero_${dateStr}.pdf`);
    } catch (err) {
      console.error('PDF generation error:', err);
      alert('PDF download error: ' + err.message);
    }
  };

  const steps = [
    { num: 1, title: t('step_1_title', lang), icon: Package },
    { num: 2, title: t('step_2_title', lang), icon: Smartphone },
    { num: 3, title: t('step_3_title', lang), icon: Banknote },
    { num: 4, title: t('step_4_title', lang), icon: FileText }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ════ Easy Mode: 1-Page Quick Close ════ */}
      {isEasy && (
        <div className="max-w-lg mx-auto space-y-4 pb-20 sm:pb-8">
          {/* Header */}
          <div className="text-center">
            <p className="text-2xl font-bold">🌙 {lang === 'en' ? 'Close Your Day' : 'দিন শেষ করুন'}</p>
            <p className="text-sm text-gray-500 mt-1">{lang === 'en' ? 'Count your cash and close' : 'ক্যাশ গুনে দিন শেষ করুন'}</p>
          </div>

          {/* Cash Count Card */}
          <div className="bg-white rounded-2xl shadow-md p-5 border border-slate-100">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {lang === 'en' ? '💰 Cash in your drawer right now' : '💰 ক্যাশবক্সে এখন কত টাকা আছে?'}
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={actualCash === 0 && !isFinalized ? '' : actualCash}
              onChange={(e) => setActualCash(e.target.value === '' ? '' : parseFloat(e.target.value))}
              disabled={isFinalized}
              className="w-full text-3xl font-bold text-center border-2 border-gray-200 rounded-xl p-4 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none text-slate-900 bg-white"
              placeholder={lang === 'en' ? 'Tk 0' : '৳ 0'}
            />
            {/* Note Counter Toggle */}
            <button
              type="button"
              onClick={() => setShowDenomSheet(!showDenomSheet)}
              className="mt-3 w-full text-sm text-emerald-600 font-semibold py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 transition-all cursor-pointer border border-emerald-100"
            >
              {showDenomSheet ? (lang === 'en' ? '✕ Close Counter' : '✕ বন্ধ করুন') : (lang === 'en' ? '🧮 Use Note Counter' : '🧮 নোট কাউন্টার ব্যবহার করুন')}
            </button>
          </div>

          {/* Show denomination counter if toggled - reuse existing component */}
          {showDenomSheet && (
            <div className="bg-white rounded-2xl shadow-md p-4 border border-slate-100">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-3 mb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-emerald-600" />
                    {t('counter_sheet_title', lang)}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={handleResetDenominations}
                  className="text-xs text-rose-600 hover:text-rose-700 font-bold px-2 py-1 bg-white rounded-lg border border-rose-200 shadow-2xs transition-colors cursor-pointer"
                >
                  {t('btn_reset', lang)}
                </button>
              </div>

              {/* Denomination Notes Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { note: '1000', color: 'bg-amber-50 text-amber-900 border-amber-200' },
                  { note: '500',  color: 'bg-emerald-50 text-emerald-900 border-emerald-200' },
                  { note: '200',  color: 'bg-teal-50 text-teal-900 border-teal-200' },
                  { note: '100',  color: 'bg-blue-50 text-blue-900 border-blue-200' },
                  { note: '50',   color: 'bg-orange-50 text-orange-900 border-orange-200' },
                  { note: '20',   color: 'bg-green-50 text-green-900 border-green-200' },
                  { note: '10',   color: 'bg-purple-50 text-purple-900 border-purple-200' },
                  { note: '5',    color: 'bg-slate-50 text-slate-800 border-slate-200' },
                  { note: '2',    color: 'bg-slate-50 text-slate-800 border-slate-200' },
                  { note: '1',    color: 'bg-zinc-50 text-zinc-800 border-zinc-200' },
                ].map(({ note, color }) => {
                  const count = denominations[note];
                  const subtotal = (Number(note) || 0) * (parseInt(count, 10) || 0);

                  return (
                    <div key={note} className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-slate-50">
                      <span className={`px-2 py-1 rounded-lg text-xs font-bold border ${color} min-w-[50px] text-center`}>
                        {lang === 'en' ? 'Tk ' : '৳'}{note}
                      </span>
                      <span className="text-slate-400 font-bold text-xs">×</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={count}
                          onChange={(e) => handleDenominationChange(note, e.target.value)}
                          disabled={isFinalized}
                          className="w-14 p-1 text-center text-xs font-bold border border-slate-200 rounded-md focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white text-slate-900"
                        />
                      </div>
                      <span className="text-xs font-black text-slate-800 min-w-[60px] text-right font-mono">
                        ={formatBDT(subtotal, lang)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Total of Denomination Sheet & Apply Button */}
              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs text-slate-600 font-medium">{t('counter_total_label', lang)}</span>
                  <div className="text-lg font-black text-emerald-700">
                    {formatBDT(totalDenominationSum, lang)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyDenominations}
                  disabled={isFinalized || totalDenominationSum <= 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{t('btn_apply_counter', lang)}</span>
                </button>
              </div>
            </div>
          )}

          {/* Cash Match Status */}
          <div className="bg-white rounded-2xl shadow-md p-4 border border-slate-100">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-500">{lang === 'en' ? 'System expects' : 'সিস্টেম বলছে'}</span>
              <span className="text-lg font-bold">{formatBDT(expectedCash, lang)}</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-500">{lang === 'en' ? 'You counted' : 'আপনি গণনা করেছেন'}</span>
              <span className="text-lg font-bold">{formatBDT(Number(actualCash) || 0, lang)}</span>
            </div>
            {actualCash !== '' && actualCash !== null && actualCash !== undefined && (
              <div className="mt-3 space-y-2">
                <div className={`text-center py-2.5 px-3 rounded-xl font-bold text-sm ${
                  Math.abs(Number(actualCash) - expectedCash) <= 5 
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}>
                  {Math.abs(Number(actualCash) - expectedCash) <= 5 
                    ? '✅ ' + (lang === 'en' ? 'Cash Matched!' : 'ক্যাশ মিলেছে!')
                    : `⚠️ ${lang === 'en' ? 'Difference:' : 'পার্থক্য:'} ${formatBDT(Math.abs(Number(actualCash) - expectedCash), lang)} (${Number(actualCash) > expectedCash ? (lang === 'en' ? 'Cash Surplus' : 'ক্যাশ বেশি') : (lang === 'en' ? 'Cash Short' : 'ক্যাশ কম')})`
                  }
                </div>

                <button
                  type="button"
                  onClick={() => setShowCashDiffModal(true)}
                  className="w-full py-2.5 px-3 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 text-blue-900 border border-blue-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                >
                  <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>{lang === 'en' ? '📊 Why this Difference? View Cash Breakdown' : '📊 কেন এই ডিফারেন্স হলো? বিস্তারিত হিসাব দেখুন'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Daily Profit & Outflow Cards with Audit Buttons */}
          <div className="bg-white rounded-2xl shadow-md p-4 border border-slate-100 space-y-3.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                <span>📊</span>
                <span>{lang === 'en' ? "Today's Profit & Expense Summary" : 'আজকের লাভ ও খরচের সারাংশ'}</span>
              </p>
              <span className="text-[11px] font-semibold text-slate-400">
                {lang === 'en' ? 'Click buttons for full audit' : 'বিস্তারিত দেখতে বাটনে চাপুন'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Card 1: Total Profit */}
              <div className="bg-gradient-to-br from-emerald-50 via-teal-50/60 to-emerald-50/30 rounded-2xl p-4 border border-emerald-200/80 shadow-2xs flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-1">
                    <span>📈</span> {lang === 'en' ? 'Total Daily Profit' : 'আজকের মোট লাভ'}
                  </span>
                  <p className="text-2xl sm:text-3xl font-black text-emerald-700 mt-1 font-mono">
                    {formatBDT(closingAuditedProfit, lang)}
                  </p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">
                    {lang === 'en' ? 'Sales profit + Recharge + Services - Expenses' : 'পণ্য বিক্রি লাভ + রিচার্জ + সেবা - দোকান খরচ'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setFinancialModalTab('profit');
                    setShowFinancialModal(true);
                  }}
                  className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'View Profit Breakdown ➔' : '📊 লাভের বিস্তারিত হিসাব দেখুন ➔'}</span>
                </button>
              </div>

              {/* Card 2: Total Expenses & Outflows */}
              <div className="bg-gradient-to-br from-rose-50 via-amber-50/60 to-rose-50/30 rounded-2xl p-4 border border-rose-200/80 shadow-2xs flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-xs font-bold text-rose-800 uppercase tracking-wide flex items-center gap-1">
                    <span>💸</span> {lang === 'en' ? 'Total Expenses & Outflows' : 'আজকের মোট খরচ'}
                  </span>
                  <p className="text-2xl sm:text-3xl font-black text-rose-700 mt-1 font-mono">
                    {formatBDT((txTotals.expenses || 0) + (txTotals.personalDraw || 0) + (txTotals.stockPurchasesCost || 0) + (txTotals.assetPurchases || 0) + (txTotals.taxPayments || 0), lang)}
                  </p>
                  <p className="text-[11px] text-rose-600 mt-0.5">
                    {lang === 'en' ? 'Family draw + Shop expenses + Stock buy' : 'ফ্যামিলি খরচ + দোকান খরচ + নতুন স্টক কেনা'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setFinancialModalTab('expense');
                    setShowFinancialModal(true);
                  }}
                  className="w-full py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'View Expense Breakdown ➔' : '📊 খরচের বিস্তারিত হিসাব দেখুন ➔'}</span>
                </button>
              </div>
            </div>

            {/* Tea House Summary Card */}
            {((state.dayData?.teaHouseDayPersonal || 0) + (state.dayData?.teaHouseDayShop || 0) > 0 || (state.teaHouseMonthlyTab || 0) > 0) && (
              <div className="bg-gradient-to-br from-amber-50 via-orange-50/60 to-yellow-50/30 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-yellow-950/10 rounded-2xl p-4 border border-amber-200/80 dark:border-amber-800/40 shadow-2xs space-y-2">
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide flex items-center gap-1">
                  <span>☕</span> {lang === 'en' ? 'Tea House Expense (Today)' : 'টি-হাউস খরচ (আজ)'}
                </span>
                <div className="flex items-center gap-3">
                  <p className="text-xl font-black text-amber-700 dark:text-amber-400 font-mono">
                    {formatBDT((state.dayData?.teaHouseDayPersonal || 0) + (state.dayData?.teaHouseDayShop || 0), lang)}
                  </p>
                  <div className="flex gap-2 text-[11px]">
                    <span className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                      🏠 {lang === 'en' ? 'Personal' : 'নিজের'}: {formatBDT(state.dayData?.teaHouseDayPersonal || 0, lang)}
                    </span>
                    <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                      🏪 {lang === 'en' ? 'Shop' : 'দোকান'}: {formatBDT(state.dayData?.teaHouseDayShop || 0, lang)}
                    </span>
                  </div>
                </div>
                {(state.teaHouseMonthlyTab || 0) > 0 && (
                  <div className="flex items-center justify-between pt-1 border-t border-amber-200/60 dark:border-amber-700/40">
                    <span className="text-xs text-amber-700 dark:text-amber-400 font-semibold">
                      📊 {lang === 'en' ? 'Monthly Tab' : 'মাসিক বাকি'}: <span className="font-mono font-bold">{formatBDT(state.teaHouseMonthlyTab, lang)}</span>
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowTeaHouseModal(true)}
                  className="w-full py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <span>☕</span>
                  <span>{lang === 'en' ? 'View Tea House Breakdown ➔' : '📊 টি-হাউসের বিস্তারিত দেখুন ➔'}</span>
                </button>
              </div>
            )}

            {/* Tea House Breakdown Modal — matches Expenses Breakdown design */}
            {showTeaHouseModal && (() => {
              const teaEntries = state.dayData?.teaHouseEntries || [];
              const personalEntries = teaEntries.filter(e => e.type === 'personal');
              const shopEntries = teaEntries.filter(e => e.type === 'shop');
              const dayPersonal = state.dayData?.teaHouseDayPersonal || 0;
              const dayShop = state.dayData?.teaHouseDayShop || 0;
              const dayTotal = dayPersonal + dayShop;
              const monthlyTab = state.teaHouseMonthlyTab || 0;
              const monthlyPersonal = state.teaHouseMonthlyPersonal || 0;
              const monthlyShop = state.teaHouseMonthlyShop || 0;
              const isEn = lang === 'en';

              return (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200" onClick={() => setShowTeaHouseModal(false)}>
                  <div 
                    className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[92vh] shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Top Header */}
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-xs bg-gradient-to-tr from-amber-600 to-orange-500">
                          <span className="text-lg">☕</span>
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                            {isEn ? "Today's Tea House Breakdown" : 'আজকের টি-হাউসের পুঙ্খানুপুঙ্খ অডিট রিপোর্ট'}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {isEn ? 'Detailed tea house expense records' : 'প্রতিটি চা-নাস্তা খরচের বিস্তারিত খতিয়ান'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowTeaHouseModal(false)}
                        className="w-8 h-8 rounded-full bg-slate-200/60 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                      >
                        <span className="text-sm font-bold">✕</span>
                      </button>
                    </div>

                    {/* Scrollable Body */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                      {/* Summary Hero Banner */}
                      <div className="rounded-2xl p-4 bg-gradient-to-br from-amber-600 to-orange-700 text-white shadow-md space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-semibold text-amber-100 uppercase tracking-wider">
                              {isEn ? "Today's Tea House Total" : 'আজকের টি-হাউস মোট খরচ'}
                            </p>
                            <h2 className="text-2xl sm:text-3xl font-black text-white mt-0.5">
                              {formatBDT(dayTotal, lang)}
                            </h2>
                          </div>
                          <div className="px-3 py-1.5 rounded-xl bg-white/20 backdrop-blur-xs text-xs font-bold flex items-center gap-1.5">
                            <span>☕</span>
                            <span>{teaEntries.length} {isEn ? 'items' : 'টি আইটেম'}</span>
                          </div>
                        </div>

                        {/* Summary strip */}
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/20 text-xs">
                          <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                            <span className="text-xs text-amber-100 block">🏠 {isEn ? 'Personal' : 'নিজের'}</span>
                            <span className="font-mono font-bold text-white">{formatBDT(dayPersonal, lang)}</span>
                          </div>
                          <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                            <span className="text-xs text-amber-100 block">🏪 {isEn ? 'Shop' : 'দোকানের'}</span>
                            <span className="font-mono font-bold text-white">{formatBDT(dayShop, lang)}</span>
                          </div>
                          <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                            <span className="text-xs text-amber-100 block">📊 {isEn ? 'Monthly Tab' : 'মাসিক বাকি'}</span>
                            <span className="font-mono font-bold text-white">{formatBDT(monthlyTab, lang)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Category Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {/* Personal Card */}
                        <div 
                          onClick={() => setTeaFilter(prev => prev === 'personal' ? 'all' : 'personal')}
                          className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                            teaFilter === 'personal'
                              ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 shadow-xs'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-lg">🏠</span>
                            <span className="text-xs uppercase font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 rounded-full">
                              {personalEntries.length} {isEn ? 'items' : 'টি'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                            {isEn ? 'Personal' : 'নিজের / ব্যক্তিগত'}
                          </p>
                          <p className="text-lg font-black text-indigo-700 dark:text-indigo-400 mt-0.5">
                            {formatBDT(dayPersonal, lang)}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            {isEn ? 'Owner personal consumption' : 'মালিকের নিজের চা-নাস্তা'}
                          </p>
                        </div>

                        {/* Shop Card */}
                        <div 
                          onClick={() => setTeaFilter(prev => prev === 'shop' ? 'all' : 'shop')}
                          className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                            teaFilter === 'shop'
                              ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 shadow-xs'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-lg">🏪</span>
                            <span className="text-xs uppercase font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded-full">
                              {shopEntries.length} {isEn ? 'items' : 'টি'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                            {isEn ? 'Shop' : 'দোকানের / কাস্টমারের'}
                          </p>
                          <p className="text-lg font-black text-amber-700 dark:text-amber-400 mt-0.5">
                            {formatBDT(dayShop, lang)}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            {isEn ? 'Shop business refreshments' : 'দোকানের ব্যবসায়িক চা-নাস্তা'}
                          </p>
                        </div>
                      </div>

                      {/* Filter Pills */}
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                        <span className="text-[11px] font-bold text-slate-400 shrink-0">
                          {isEn ? 'Filter:' : 'ফিল্টার:'}
                        </span>
                        <button
                          onClick={() => setTeaFilter('all')}
                          className={`px-3 py-1 rounded-xl font-bold cursor-pointer transition-colors ${
                            teaFilter === 'all'
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          {isEn ? 'All Items' : 'সব আইটেম'} ({teaEntries.length})
                        </button>
                        <button
                          onClick={() => setTeaFilter('personal')}
                          className={`px-3 py-1 rounded-xl font-bold cursor-pointer transition-colors ${
                            teaFilter === 'personal'
                              ? 'bg-indigo-600 text-white'
                              : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100'
                          }`}
                        >
                          🏠 {isEn ? 'Personal' : 'নিজের'} ({personalEntries.length})
                        </button>
                        <button
                          onClick={() => setTeaFilter('shop')}
                          className={`px-3 py-1 rounded-xl font-bold cursor-pointer transition-colors ${
                            teaFilter === 'shop'
                              ? 'bg-amber-600 text-white'
                              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
                          }`}
                        >
                          🏪 {isEn ? 'Shop' : 'দোকান'} ({shopEntries.length})
                        </button>
                      </div>

                      {/* Itemized List */}
                      <div className="space-y-2">
                        {(() => {
                          let filtered = teaEntries;
                          if (teaFilter === 'personal') filtered = personalEntries;
                          else if (teaFilter === 'shop') filtered = shopEntries;
                          filtered = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                          
                          return filtered.length === 0 ? (
                            <div className="text-center py-8 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 text-xs">
                              {isEn ? 'No tea house entries in this category.' : 'এই ক্যাটাগরিতে কোনো টি-হাউস এন্ট্রি নেই।'}
                            </div>
                          ) : (
                            filtered.map((entry, idx) => {
                              const isPersonal = entry.type === 'personal';
                              const timeStr = entry.timestamp 
                                ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : '';
                              const badgeText = isPersonal 
                                ? (isEn ? 'Personal' : 'নিজের') 
                                : (isEn ? 'Shop' : 'দোকানের');
                              const badgeColor = isPersonal
                                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';

                              return (
                                <div 
                                  key={entry.id || `tea_${idx}`}
                                  className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-2xs flex items-center justify-between gap-3"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                                      isPersonal ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600' : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600'
                                    }`}>
                                      {isPersonal ? '🏠' : '🏪'}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                                        {entry.itemName}
                                      </p>
                                      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                        <span className={`px-2 py-0.5 rounded-md font-semibold text-xs ${badgeColor}`}>
                                          {badgeText}
                                        </span>
                                        <span>•</span>
                                        <span>×{entry.qty}</span>
                                        <span>•</span>
                                        <span>@{formatBDT(entry.price, lang)}</span>
                                        {timeStr && (
                                          <>
                                            <span>•</span>
                                            <span>🕐 {timeStr}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0">
                                    <span className={`font-mono font-black text-xs sm:text-sm px-2.5 py-1 rounded-xl border ${
                                      isPersonal 
                                        ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800'
                                        : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800'
                                    }`}>
                                      -{formatBDT(entry.total, lang)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          );
                        })()}
                      </div>

                      {/* Monthly Tab Summary */}
                      {monthlyTab > 0 && (
                        <div className="rounded-2xl p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">📊 {isEn ? 'Monthly Tab (Unsettled)' : 'মাসিক বাকি (অপরিশোধিত)'}</span>
                            <span className="text-lg font-black text-amber-600 dark:text-amber-400 font-mono">{formatBDT(monthlyTab, lang)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-xl p-2 border border-indigo-200/50">
                              <span className="text-xs text-indigo-600 dark:text-indigo-400 block">🏠 {isEn ? 'Personal Monthly' : 'নিজের মাসিক'}</span>
                              <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">{formatBDT(monthlyPersonal, lang)}</span>
                            </div>
                            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-2 border border-amber-200/50">
                              <span className="text-xs text-amber-600 dark:text-amber-400 block">🏪 {isEn ? 'Shop Monthly' : 'দোকান মাসিক'}</span>
                              <span className="font-mono font-bold text-amber-700 dark:text-amber-300">{formatBDT(monthlyShop, lang)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom Footer */}
                    <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex items-center justify-between">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          {isEn ? "Today's Tea House:" : 'আজকের টি-হাউস খরচ:'}{' '}
                          <strong className="text-amber-600 font-mono text-sm">{formatBDT(dayTotal, lang)}</strong>
                        </span>
                      </div>
                      <button
                        onClick={() => setShowTeaHouseModal(false)}
                        className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                      >
                        {isEn ? 'Close Report' : 'রিপোর্ট বন্ধ করুন'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-xs">
              <div className="bg-emerald-50/60 rounded-xl p-2 text-center border border-emerald-100">
                <span className="text-xs text-emerald-600 block">🟢 {lang === 'en' ? 'Total Received (Cash In)' : 'মোট ক্যাশ পেয়েছি'}</span>
                <span className="font-bold text-emerald-800">{formatBDT(salesRevenueToUse + (txTotals.servicesTotal || 0) + (txTotals.rechargeTotal || 0) + (txTotals.loanCollected || 0) + (txTotals.loanTaken || 0) + (txTotals.ownerGave || 0), lang)}</span>
              </div>
              <div className="bg-rose-50/60 rounded-xl p-2 text-center border border-rose-100">
                <span className="text-xs text-rose-600 block">🔴 {lang === 'en' ? 'Total Given (Cash Out)' : 'মোট ক্যাশ দিয়েছি'}</span>
                <span className="font-bold text-rose-800">{formatBDT((txTotals.expenses || 0) + (txTotals.loanGiven || 0) + (txTotals.loanRepaid || 0) + (txTotals.ownerTook || 0) + (txTotals.personalDraw || 0) + (txTotals.stockPurchasesCost || 0) + (txTotals.assetPurchases || 0) + (txTotals.taxPayments || 0), lang)}</span>
              </div>
            </div>

            {/* Asset Conversion Callout if stock was purchased */}
            {(txTotals.stockPurchasesCost || 0) > 0 && (
              <div className="p-3 bg-purple-50/90 border border-purple-200 rounded-xl flex items-start gap-2.5 text-xs text-purple-950">
                <span className="text-base shrink-0">📦</span>
                <div>
                  <span className="font-bold text-purple-900">
                    {lang === 'en' ? 'New Stock Purchased:' : 'নতুন স্টক কেনা হয়েছে:'} {formatBDT(txTotals.stockPurchasesCost, lang)}
                  </span>
                  <p className="text-[11px] text-purple-700 mt-0.5 leading-relaxed">
                    {lang === 'en'
                      ? 'This cash was converted into shop stock inventory (an asset). No money was lost!'
                      : 'এই টাকা ক্যাশ ড্রয়ার থেকে পরিশোধ হয়ে সরাসরি দোকানের মালামালে (স্টক সম্পদে) যুক্ত হয়েছে — কোনো টাকা ক্ষতি বা মিসিং নয়!'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Total Store Wealth & Assets Card */}
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl shadow-lg p-4 border border-indigo-500/30 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-indigo-800/60">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏛️</span>
                <div>
                  <h4 className="font-bold text-xs sm:text-sm text-white">
                    {lang === 'en' ? 'Total Current Store Wealth (Assets)' : 'দোকানের মোট চলতি সম্পদ (Total Store Wealth)'}
                  </h4>
                  <p className="text-xs text-indigo-300">
                    {lang === 'en' ? 'Cash + Stock + Bank + Receivables' : 'নগদ ক্যাশ + মালামাল স্টক + ব্যাংক + বাকি পাওনা'}
                  </p>
                </div>
              </div>
              <span className="font-mono text-base sm:text-lg font-black text-emerald-400">
                {formatBDT(totalStoreWealth, lang)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">💵 {lang === 'en' ? 'Cash in Drawer' : 'ড্রয়ার ক্যাশ'}</span>
                <span className="font-mono font-bold text-emerald-300">{formatBDT(currentHandCash, lang)}</span>
              </div>
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">📦 {lang === 'en' ? 'Stock Value' : 'মজুদ মালামাল'}</span>
                <span className="font-mono font-bold text-purple-300">{formatBDT(totalStockValue, lang)}</span>
              </div>
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">👥 {lang === 'en' ? 'Due Receivable' : 'বাকি পাওনা'}</span>
                <span className="font-mono font-bold text-amber-300">{formatBDT(totalReceivable, lang)}</span>
              </div>
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">🏦 {lang === 'en' ? 'Bank & Wallets' : 'ব্যাংক ও ওয়ালেট'}</span>
                <span className="font-mono font-bold text-blue-300">{formatBDT(digitalWalletsTotal, lang)}</span>
              </div>
            </div>
          </div>

          {/* Finalize Button */}
          {!isFinalized ? (
            <button
              onClick={handleFinalize}
              disabled={actualCash === '' || actualCash === undefined || actualCash === null}
              className="w-full py-4 rounded-2xl text-lg font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg cursor-pointer flex justify-center items-center gap-2 mb-6"
            >
              <Check className="w-6 h-6" /> {lang === 'en' ? 'Finalize & Close Day' : 'দিন শেষ করুন'}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="w-full bg-emerald-100 text-emerald-800 font-bold py-3 rounded-2xl text-center border border-emerald-200 flex items-center justify-center gap-2">
                <Check className="w-5 h-5" /> {lang === 'en' ? 'Day Finalized' : 'দিন শেষ হয়েছে'}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleJsonBackupDownload}
                  className="flex-1 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold py-2.5 px-3 rounded-xl shadow-2xs hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors flex items-center justify-center gap-2 cursor-pointer text-xs"
                >
                  <Database className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  {lang === 'en' ? 'Download JSON Backup' : '💾 সম্পূর্ণ ব্যাকআপ (JSON)'}
                </button>
                <button
                  type="button"
                  onClick={generatePDF}
                  className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold py-2.5 px-3 rounded-xl shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer text-xs"
                >
                  <Download className="w-4 h-4" />
                  {t('btn_pdf_report', lang)}
                </button>
              </div>
              <button
                onClick={() => dispatch({ type: 'START_NEXT_DAY' })}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-3 text-lg cursor-pointer"
              >
                <span>{t('btn_start_next_day', lang)}</span>
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ════ Advanced Mode: Original 4-Step Wizard ════ */}
      {isAdvanced && (
        <>
          {/* Header & Stepper */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">{t('closing_screen_title', lang)}</h2>
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-slate-200 dark:bg-slate-700 z-0"></div>
          {steps.map(step => {
            const Icon = step.icon;
            const isActive = currentStep === step.num;
            const isCompleted = currentStep > step.num || isFinalized;
            
            return (
              <div key={step.num} className="relative z-10 flex flex-col items-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 transition-all ${
                  isActive ? 'bg-emerald-600 border-emerald-100 text-white ring-2 ring-emerald-500 shadow-sm' :
                  isCompleted ? 'bg-emerald-500 border-white text-white' :
                  'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`mt-2 text-xs sm:text-sm font-bold ${isActive ? 'text-emerald-700 dark:text-emerald-400' : isCompleted ? 'text-emerald-600 dark:text-emerald-500' : 'text-slate-700 dark:text-slate-300'}`}>
                  {step.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step 1: Stock Check */}
      {currentStep === 1 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t('stock_count_title', lang)}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stock_count_desc', lang)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-sm font-bold">
                  <th className="p-4">{t('col_product_name', lang)}</th>
                  <th className="p-4">{t('col_opening_stock', lang)}</th>
                  <th className="p-4">{t('col_added_stock', lang)}</th>
                  <th className="p-4">{t('col_available_stock', lang)}</th>
                  <th className="p-4 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300">{t('col_closing_stock', lang)}</th>
                  <th className="p-4">{t('col_units_sold', lang)}</th>
                  <th className="p-4">{t('col_revenue', lang)}</th>
                  <th className="p-4">{t('col_profit', lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {inventorySummary.map(item => {
                  const available = item.openingStock + item.addedStock;
                  const unitLabel = translateUnit(item.unit || 'পিস', lang);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 font-bold text-slate-900 dark:text-slate-100">
                        {item.name} <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">({unitLabel})</span>
                      </td>
                      <td className="p-4 text-slate-700 dark:text-slate-300 font-semibold">{item.openingStock}</td>
                      <td className="p-4 text-slate-700 dark:text-slate-300 font-semibold">{item.addedStock}</td>
                      <td className="p-4 text-slate-900 dark:text-slate-100 font-bold">{available}</td>
                      <td className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                        <input
                          type="number"
                          min="0"
                          max={available}
                          value={item.closingStock}
                          onChange={(e) => handleStockChange(item.id, e.target.value)}
                          disabled={isFinalized}
                          className="w-24 p-2 border-2 border-emerald-400 rounded-lg font-bold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="p-4 text-slate-900 dark:text-slate-100 font-black">{item.unitsSold}</td>
                      <td className="p-4 text-slate-800 dark:text-slate-200 font-bold">{formatBDT(item.salesRevenue, lang)}</td>
                      <td className={`p-4 font-black ${item.profit > 0 ? 'text-emerald-700 dark:text-emerald-400' : item.profit < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400'}`}>
                        {formatBDT(item.profit, lang)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-100 dark:bg-slate-800/80 border-t-2 border-slate-300 dark:border-slate-700 font-bold">
                <tr>
                  <td colSpan="5" className="p-4 text-right text-slate-700 dark:text-slate-300">{t('totals_label', lang)}</td>
                  <td className="p-4 text-slate-900 dark:text-slate-100 font-black">{inventoryTotals.totalUnitsSold}</td>
                  <td className="p-4 text-slate-900 dark:text-slate-100 font-black">{formatBDT(inventoryTotals.totalRevenue, lang)}</td>
                  <td className={`p-4 font-black ${inventoryTotals.totalProfit > 0 ? 'text-emerald-700 dark:text-emerald-400' : inventoryTotals.totalProfit < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                    {formatBDT(inventoryTotals.totalProfit, lang)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Step 2: Digital Wallets */}
      {currentStep === 2 && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">{t('wallets_verify_title', lang)}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">{t('wallets_verify_desc', lang)}</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(() => {
                const wbKeys = Object.keys(walletBalances);
                if (dayData?.walletOrder?.length > 0) {
                  return [...dayData.walletOrder.filter(k => wbKeys.includes(k)), ...wbKeys.filter(k => !dayData.walletOrder.includes(k))];
                }
                return wbKeys;
              })().map(key => {
                const systemBalance = dayData.wallets[key]?.current || 0;
                const userBalance = walletBalances[key];
                const diff = userBalance - systemBalance;
                
                return (
                  <div key={key} className="border border-slate-200 dark:border-slate-700 rounded-xl p-5 bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200">{getWalletLabel(key)}</h4>
                      <Smartphone className="w-5 h-5 text-slate-500" />
                    </div>
                    
                    <div className="mb-4">
                      <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">{t('calc_balance', lang)}</p>
                      <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{formatBDT(systemBalance, lang)}</p>
                    </div>
                    
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">{t('actual_balance', lang)}</label>
                      <input
                        type="number"
                        value={userBalance}
                        onChange={(e) => handleWalletChange(key, e.target.value)}
                        disabled={isFinalized}
                        className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg font-bold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white dark:bg-slate-800"
                      />
                    </div>
                    
                    {diff !== 0 && !isNaN(diff) && (
                      <div className={`mt-3 text-xs font-bold flex items-center gap-1 ${diff > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        <AlertTriangle className="w-4 h-4" />
                        {diff > 0 ? `+${formatBDT(diff, lang)} ${t('extra_balance', lang)}` : `${formatBDT(Math.abs(diff, lang), lang)} ${t('missing_balance', lang)}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Cash Verification */}
      {currentStep === 3 && (
        <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">{t('drawer_cash_title', lang)}</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">{t('drawer_cash_desc', lang)}</p>
          </div>
          
          <div className="bg-slate-50 dark:bg-slate-800/60 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 mb-8 text-center">
            <p className="text-xs text-slate-600 dark:text-slate-400 uppercase tracking-wider font-bold mb-2">{t('expected_drawer_cash', lang)}</p>
            <p className="text-4xl font-black text-slate-900 dark:text-slate-100">{formatBDT(expectedCash, lang)}</p>
          </div>
          
          <div className="mb-6">
            <label className="block font-bold text-slate-900 dark:text-slate-100 mb-2 text-center text-base sm:text-lg">
              {t('actual_drawer_cash', lang)}
            </label>
            <div className="relative max-w-xs mx-auto">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xl">{lang === 'en' ? 'Tk' : '৳'}</span>
              <input
                type="number"
                value={actualCash}
                onChange={(e) => setActualCash(parseFloat(e.target.value) || 0)}
                disabled={isFinalized}
                className="w-full pl-10 pr-4 py-3 text-2xl font-black border-2 border-emerald-500 rounded-xl focus:ring-4 focus:ring-emerald-500/20 focus:outline-none text-center bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Toggle Denomination Sheet Button */}
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowDenomSheet(!showDenomSheet)}
                className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{showDenomSheet ? t('btn_note_counter_close', lang) : t('btn_note_counter', lang)}</span>
              </button>
            </div>
          </div>

          {/* Banknote Denomination Counter Sheet */}
          {showDenomSheet && (
            <div className="mb-8 p-5 bg-gradient-to-b from-slate-50 to-emerald-50/40 dark:from-slate-800/80 dark:to-slate-850 rounded-2xl border-2 border-emerald-300 dark:border-emerald-700/60 shadow-inner space-y-4">
              <div className="flex items-center justify-between border-b border-emerald-200 dark:border-slate-700 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    {t('counter_sheet_title', lang)}
                  </h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">{t('counter_sheet_desc', lang)}</p>
                </div>
                <button
                  type="button"
                  onClick={handleResetDenominations}
                  className="text-xs text-rose-600 hover:text-rose-700 font-bold px-2 py-1 bg-white dark:bg-slate-800 rounded-lg border border-rose-200 dark:border-rose-900/40 shadow-2xs transition-colors cursor-pointer"
                >
                  {t('btn_reset', lang)}
                </button>
              </div>

              {/* Denomination Notes Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { note: '1000', color: 'bg-amber-100 text-amber-900 border-amber-300' },
                  { note: '500',  color: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
                  { note: '200',  color: 'bg-teal-100 text-teal-900 border-teal-300' },
                  { note: '100',  color: 'bg-blue-100 text-blue-900 border-blue-300' },
                  { note: '50',   color: 'bg-orange-100 text-orange-900 border-orange-300' },
                  { note: '20',   color: 'bg-green-100 text-green-900 border-green-300' },
                  { note: '10',   color: 'bg-purple-100 text-purple-900 border-purple-300' },
                  { note: '5',    color: 'bg-slate-100 text-slate-800 border-slate-300' },
                  { note: '2',    color: 'bg-slate-100 text-slate-800 border-slate-300' },
                  { note: '1',    color: 'bg-zinc-100 text-zinc-800 border-zinc-300' },
                ].map(({ note, color }) => {
                  const count = denominations[note];
                  const subtotal = (Number(note) || 0) * (parseInt(count, 10) || 0);

                  return (
                    <div key={note} className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${color} min-w-[58px] text-center`}>
                        {lang === 'en' ? 'Tk ' : '৳'}{note}
                      </span>
                      <span className="text-slate-400 font-bold text-xs">×</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={count}
                          onChange={(e) => handleDenominationChange(note, e.target.value)}
                          disabled={isFinalized}
                          className="w-16 p-1.5 text-center text-xs font-bold border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                        <span className="text-xs text-slate-500">{lang === 'bn' ? 'টি' : 'pcs'}</span>
                      </div>
                      <span className="text-xs font-black text-slate-800 dark:text-slate-200 min-w-[70px] text-right font-mono">
                        ={formatBDT(subtotal, lang)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Total of Denomination Sheet & Apply Button */}
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-emerald-300 dark:border-emerald-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">{t('counter_total_label', lang)}</span>
                  <div className="text-xl font-black text-emerald-700 dark:text-emerald-400">
                    {formatBDT(totalDenominationSum, lang)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyDenominations}
                  disabled={isFinalized || totalDenominationSum <= 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{t('btn_apply_counter', lang)}</span>
                </button>
              </div>
            </div>
          )}
          
          {/* Mismatch Card */}
          <div className={`p-4 rounded-xl flex items-center justify-center gap-3 border ${
            cashMismatch === 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 
            cashMismatch > 0 ? 'bg-blue-50 text-blue-800 border-blue-300' : 
            'bg-rose-50 text-rose-800 border-rose-300'
          }`}>
            {cashMismatch === 0 ? (
              <>
                <Check className="w-6 h-6 text-emerald-600 shrink-0" />
                <span className="font-bold text-base sm:text-lg">{t('cash_perfect', lang)}</span>
              </>
            ) : cashMismatch > 0 ? (
              <>
                <AlertTriangle className="w-6 h-6 text-blue-600 shrink-0" />
                <span className="font-bold text-base sm:text-lg">{formatBDT(cashMismatch, lang)} {t('cash_surplus', lang)}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
                <span className="font-bold text-base sm:text-lg">{formatBDT(Math.abs(cashMismatch, lang), lang)} {t('cash_shortage', lang)}</span>
              </>
            )}
          </div>

          {/* Auto Reconcile Button if small mismatch exists */}
          {cashMismatch !== 0 && Math.abs(cashMismatch) <= 200 && !isFinalized && (
            <button
              type="button"
              onClick={handleRoundingAdjustment}
              className="w-full mt-2 py-2.5 px-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>
                {lang === 'en'
                  ? `⚡ Auto-Reconcile ${formatBDT(Math.abs(cashMismatch), 'en')} ${cashMismatch > 0 ? 'Excess' : 'Shortage'} to Match Drawer`
                  : `⚡ এই ${formatBDT(Math.abs(cashMismatch), 'bn')} ${cashMismatch > 0 ? 'বাড়তি ক্যাশ' : 'ঘাটতি'} এক ক্লিকে সমন্বয় করে ক্যাশ মিলান`}
              </span>
            </button>
          )}

          {adjustmentMessage && (
            <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold rounded-xl text-center flex items-center justify-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{adjustmentMessage}</span>
            </div>
          )}

          {/* Detailed Cash Difference Breakdown Report Button */}
          <button
            type="button"
            onClick={() => setShowCashDiffModal(true)}
            className="w-full mt-3 py-2.5 px-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 hover:from-blue-100 hover:to-indigo-100 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
          >
            <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{lang === 'en' ? '📊 Why this Difference? View Cash Breakdown' : '📊 কেন এই ডিফারেন্স হলো? বিস্তারিত হিসাব দেখুন'}</span>
          </button>

          {/* Asset Conversion Callout if stock was purchased */}
          {(txTotals.stockPurchasesCost || 0) > 0 && (
            <div className="mt-4 p-3 bg-purple-50/90 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/50 rounded-xl flex items-start gap-2.5 text-xs text-purple-950 dark:text-purple-200">
              <span className="text-base shrink-0">📦</span>
              <div>
                <span className="font-bold text-purple-900 dark:text-purple-300">
                  {lang === 'en' ? 'New Stock Purchased:' : 'নতুন স্টক কেনা হয়েছে:'} {formatBDT(txTotals.stockPurchasesCost, lang)}
                </span>
                <p className="text-[11px] text-purple-700 dark:text-purple-400 mt-0.5 leading-relaxed">
                  {lang === 'en'
                    ? 'This cash was converted into shop stock inventory (an asset). No money was lost!'
                    : 'এই টাকা ক্যাশ ড্রয়ার থেকে পরিশোধ হয়ে সরাসরি দোকানের মালামালে (স্টক সম্পদে) যুক্ত হয়েছে — কোনো টাকা ক্ষতি বা মিসিং নয়!'}
                </p>
              </div>
            </div>
          )}

          {/* Total Store Wealth & Assets Card */}
          <div className="mt-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl shadow-lg p-4 border border-indigo-500/30 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-indigo-800/60">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏛️</span>
                <div>
                  <h4 className="font-bold text-xs sm:text-sm text-white">
                    {lang === 'en' ? 'Total Current Store Wealth (Assets)' : 'দোকানের মোট চলতি সম্পদ (Total Store Wealth)'}
                  </h4>
                  <p className="text-xs text-indigo-300">
                    {lang === 'en' ? 'Cash + Stock + Bank + Receivables' : 'নগদ ক্যাশ + মালামাল স্টক + ব্যাংক + বাকি পাওনা'}
                  </p>
                </div>
              </div>
              <span className="font-mono text-base sm:text-lg font-black text-emerald-400">
                {formatBDT(totalStoreWealth, lang)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">💵 {lang === 'en' ? 'Cash in Drawer' : 'ড্রয়ার ক্যাশ'}</span>
                <span className="font-mono font-bold text-emerald-300">{formatBDT(currentHandCash, lang)}</span>
              </div>
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">📦 {lang === 'en' ? 'Stock Value' : 'মজুদ মালামাল'}</span>
                <span className="font-mono font-bold text-purple-300">{formatBDT(totalStockValue, lang)}</span>
              </div>
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">👥 {lang === 'en' ? 'Due Receivable' : 'বাকি পাওনা'}</span>
                <span className="font-mono font-bold text-amber-300">{formatBDT(totalReceivable, lang)}</span>
              </div>
              <div className="bg-white/10 rounded-xl p-2 border border-white/5">
                <span className="text-xs text-slate-300 block">🏦 {lang === 'en' ? 'Bank & Wallets' : 'ব্যাংক ও ওয়ালেট'}</span>
                <span className="font-mono font-bold text-blue-300">{formatBDT(digitalWalletsTotal, lang)}</span>
              </div>
            </div>
          </div>

          {/* Cash Suspense Account Info */}
          {state.dayData?.transactions?.some(tx => tx.type === 'cash_adjustment') && (
            <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-gray-500" />
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  {lang === 'en' ? 'Suspense Account' : 'সাসপেন্স অ্যাকাউন্ট'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {lang === 'en' 
                  ? 'Previous day\'s cash mismatch has been recorded as an adjustment entry.' 
                  : 'গতকালের ক্যাশ তফাত একটি এডজাস্টমেন্ট এন্ট্রি হিসেবে রেকর্ড করা হয়েছে।'}
              </p>
            </div>
          )}

          {/* 1-Click Rounding & Change Adjustment (খুচরা ভাংতি ও ছাড় সমন্বয়) */}
          {Math.abs(cashMismatch) <= 100 && cashMismatch !== 0 && !isFinalized && (
            <div className="mt-5 p-4 bg-amber-50/90 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-2xl text-center space-y-2.5">
              <div className="flex items-center justify-center gap-2 text-amber-900 dark:text-amber-300 font-bold text-xs sm:text-sm">
                <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>{t('rounding_adj_heading', lang)}</span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-400 max-w-md mx-auto">
                {t('rounding_adj_body', lang)}
              </p>
              <button
                type="button"
                onClick={handleRoundingAdjustment}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs sm:text-sm shadow-sm transition-all transform active:scale-95 cursor-pointer inline-flex items-center gap-2"
              >
                <span>⚖️ {formatBDT(Math.abs(cashMismatch), lang)} {cashMismatch < 0 ? t('btn_adj_discount', lang) : t('btn_adj_excess', lang)}</span>
              </button>
            </div>
          )}

          {adjustmentMessage && (
            <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-bold text-center">
              {adjustmentMessage}
            </div>
          )}
        </div>
      )}

      {/* Step 4: Summary & Finalize */}
      {currentStep === 4 && (
        <div className="space-y-6">
          {/* Profit breakdown — Owner only */}
          {isOwner ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">{t('rev_label', lang)}</p>
              <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{formatBDT(inventoryTotals.totalRevenue, lang)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">{t('cogs_label', lang)}</p>
              <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{formatBDT(inventoryTotals.totalCOGS, lang)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">{t('inv_profit_label', lang)}</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatBDT(inventoryTotals.totalProfit, lang)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">{t('service_income_label', lang)}</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatBDT(txTotals.servicesTotal, lang)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">{t('recharge_profit_label', lang)}</p>
              <p className="text-xl font-bold text-cyan-600 dark:text-cyan-400">+{formatBDT(txTotals.rechargeProfit || 0, lang)}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t('recharge_total_sub', lang)} {formatBDT(txTotals.rechargeTotal || 0, lang)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">{t('expense_label', lang)}</p>
              <p className="text-xl font-bold text-rose-600 dark:text-rose-400">{formatBDT(txTotals.expenses, lang)}</p>
            </div>
            <div className="col-span-1 md:col-span-2 lg:col-span-2 bg-slate-900 p-5 rounded-xl shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-300 font-bold mb-1">{t('net_profit_label', lang)}</p>
                <p className={`text-3xl font-black ${closingAuditedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatBDT(closingAuditedProfit, lang)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-300 font-bold mb-1">{t('mismatch_label', lang)}</p>
                <p className={`text-xl font-black ${cashMismatch === 0 ? 'text-emerald-400' : cashMismatch > 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                  {formatBDT(cashMismatch, lang)}
                </p>
              </div>
            </div>
          </div>
          ) : (
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-3">
              <Shield className="w-6 h-6 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {lang === 'en' ? 'Closing Summary' : 'ক্লোজিং সারাংশ'}
              </h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
              {lang === 'en' 
                ? 'Profit details are visible to the Owner only. You can finalize the day below.'
                : 'লাভের বিবরণ শুধুমাত্র মালিক দেখতে পারবেন। আপনি নিচে দিনটি চূড়ান্ত করতে পারেন।'}
            </p>
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-300 dark:border-emerald-800/40">
                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-bold">{lang === 'en' ? 'Cash Counted' : 'গোনা নগদ'}</p>
                <p className="text-lg font-black text-emerald-950 dark:text-emerald-200">{formatBDT(actualCash, lang)}</p>
              </div>
              <div className={`p-3 rounded-lg border ${cashMismatch === 0 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800/40' : 'bg-rose-50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800/40'}`}>
                <p className={`text-xs font-bold ${cashMismatch === 0 ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}`}>{t('mismatch_label', lang)}</p>
                <p className={`text-lg font-black ${cashMismatch === 0 ? 'text-emerald-950 dark:text-emerald-200' : 'text-rose-600 dark:text-rose-400'}`}>{formatBDT(cashMismatch, lang)}</p>
              </div>
            </div>
          </div>
          )}

          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-3">
              {t('final_wallets_title', lang)} ({Object.keys(dayData.wallets).length} {t('accounts_count', lang)})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-300 dark:border-emerald-800/40">
                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-bold mb-1">{getWalletLabel(WALLET_KEYS.HAND_CASH)}</p>
                <p className="font-black text-emerald-950 dark:text-emerald-200 text-lg">{formatBDT(actualCash, lang)}</p>
              </div>
              {(() => {
                const wbKeys = Object.keys(walletBalances);
                if (dayData?.walletOrder?.length > 0) {
                  return [...dayData.walletOrder.filter(k => wbKeys.includes(k)), ...wbKeys.filter(k => !dayData.walletOrder.includes(k))];
                }
                return wbKeys;
              })().map(key => (
                <div key={key} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-semibold mb-1">{getWalletLabel(key)}</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100 text-lg">{formatBDT(walletBalances[key], lang)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Loans & Debts Summary Card */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm border border-purple-200 dark:border-purple-800/40">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-3">{t('loans_summary_title', lang)}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 rounded-xl">
                <p className="text-xs font-bold text-purple-900 dark:text-purple-300">{t('market_due_label', lang)}</p>
                <p className="text-2xl font-black text-purple-950 dark:text-purple-200 mt-1">
                  {formatBDT(Math.max(0, (dayData.loans?.openingGiven || 0) + txTotals.loanGiven - txTotals.loanCollected), lang)}
                </p>
                <div className="text-[11px] text-purple-700 dark:text-purple-300 font-medium mt-1.5 flex justify-between border-t border-purple-200/60 dark:border-purple-800/40 pt-1">
                  <span>{t('morning_was', lang)} {formatBDT(dayData.loans?.openingGiven || 0, lang)}</span>
                  <span>{t('today_given', lang)} +{formatBDT(txTotals.loanGiven, lang)}</span>
                  <span>{t('today_collected', lang)} -{formatBDT(txTotals.loanCollected, lang)}</span>
                </div>
              </div>

              <div className="p-4 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-300">{t('shop_debt_label', lang)}</p>
                <p className="text-2xl font-black text-amber-950 dark:text-amber-200 mt-1">
                  {formatBDT(Math.max(0, (dayData.loans?.openingTaken || 0) + (txTotals.loanTaken || 0) - (txTotals.loanRepaid || 0)), lang)}
                </p>
                <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium mt-1.5 flex justify-between border-t border-amber-200/60 dark:border-amber-800/40 pt-1">
                  <span>{t('morning_was', lang)} {formatBDT(dayData.loans?.openingTaken || 0, lang)}</span>
                  <span>{t('today_taken', lang)} +{formatBDT(txTotals.loanTaken || 0, lang)}</span>
                  <span>{t('today_repaid', lang)} -{formatBDT(txTotals.loanRepaid || 0, lang)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            {/* Download Buttons Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={handleJsonBackupDownload}
                className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/40 dark:to-blue-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold py-3.5 px-4 rounded-xl shadow-sm hover:from-indigo-100 hover:to-blue-100 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Database className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                {lang === 'en' ? 'Complete JSON Backup' : '💾 ব্যাকআপ ফাইল (JSON)'}
              </button>
              <button
                type="button"
                onClick={generatePDF}
                className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-bold py-3.5 px-4 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-5 h-5" />
                {t('btn_pdf_report', lang)}
              </button>
              <button
                type="button"
                onClick={generateExcel}
                className="bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-400 font-bold py-3.5 px-4 rounded-xl shadow-sm hover:bg-emerald-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileText className="w-5 h-5" />
                {t('btn_excel_report', lang)}
              </button>
            </div>
            
            {/* Finalize / Reopen / Next Day Row */}
            {!isFinalized ? (
              <button
                onClick={handleFinalize}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 px-6 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Lock className="w-5 h-5" />
                {t('btn_finalize_lock', lang)}
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <div className="flex-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-bold py-3.5 px-6 rounded-xl border border-emerald-300 dark:border-emerald-700 flex items-center justify-center gap-2">
                    <Check className="w-5 h-5" />
                    {t('day_finalized_badge', lang)}
                  </div>
                  <button
                    onClick={handleReopen}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-3.5 px-6 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <AlertTriangle className="w-5 h-5" />
                    {t('btn_reopen', lang)}
                  </button>
                </div>

                {/* Google Sheets Export / Connect Button */}
                <button
                  onClick={() => handleSheetsExport(!hasSheetsPermission)}
                  disabled={sheetsExporting}
                  className={`w-full text-white font-bold py-3 px-6 rounded-xl shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed ${
                    hasSheetsPermission 
                      ? 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800' 
                      : 'bg-green-600 hover:bg-green-700 disabled:bg-green-800'
                  }`}
                >
                  {sheetsExporting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>{lang === 'en' ? 'Sending to Google Sheets...' : 'Google Sheets-এ পাঠানো হচ্ছে...'}</span>
                    </>
                  ) : (
                    <span>{hasSheetsPermission ? (lang === 'en' ? '📊 Export to Google Sheets' : '📊 Google Sheets-এ এক্সপোর্ট') : (lang === 'en' ? '📊 Connect Google Sheets' : '📊 Google Sheets কানেক্ট করুন')}</span>
                  )}
                </button>

                {/* Sheets Export Result */}
                {sheetsResult && (
                  <div className={`p-3.5 rounded-xl text-sm font-medium border space-y-2 ${
                    sheetsResult.success 
                      ? 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700'
                      : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700'
                  }`}>
                    <p>{sheetsResult.message}</p>
                    {sheetsResult.needsAuth && (
                      <button
                        onClick={() => handleSheetsExport(true)}
                        className="mt-2 w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-all"
                      >
                        {lang === 'en' ? '🔑 Connect Google Sheets (click here)' : '🔑 Google Sheets কানেক্ট করুন (এখানে ক্লিক করুন)'}
                      </button>
                    )}
                    {sheetsResult.url && (
                      <a 
                        href={sheetsResult.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-block mt-1 text-blue-600 dark:text-blue-400 underline text-xs font-bold"
                      >
                        {lang === 'en' ? '🔗 View in Google Sheets →' : '🔗 Google Sheets-এ দেখুন →'}
                      </a>
                    )}
                  </div>
                )}

                <button
                  onClick={() => dispatch({ type: 'START_NEXT_DAY' })}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-3 text-base sm:text-lg cursor-pointer"
                >
                  <span>{t('btn_start_next_day', lang)}</span>
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex justify-between items-center pt-6 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
          disabled={currentStep === 1}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all cursor-pointer ${
            currentStep === 1 
              ? 'text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/50 cursor-not-allowed border border-transparent' 
              : 'text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <ChevronLeft className="w-5 h-5" />
          {t('btn_prev_step', lang)}
        </button>
        
        {currentStep < 4 && (
          <button
            onClick={() => setCurrentStep(prev => Math.min(4, prev + 1))}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm cursor-pointer"
          >
            {t('btn_next_step', lang)}
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
        </>
      )}

      {/* Cash Difference Breakdown Audit Modal */}
      <CashDifferenceModal
        isOpen={showCashDiffModal}
        onClose={() => setShowCashDiffModal(false)}
        lang={lang}
        openingCash={dayData.wallets?.hand_cash?.opening || 0}
        expectedCash={expectedCash}
        actualCash={actualCash}
        transactions={dayData.transactions || []}
        inventoryTotals={inventoryTotals}
        txTotals={txTotals}
      />

      {/* Financial Detail Audit Modal (Profit & Expense Breakdown) */}
      <ClosingFinancialDetailModal
        isOpen={showFinancialModal}
        onClose={() => setShowFinancialModal(false)}
        initialTab={financialModalTab}
        lang={lang}
        dayData={dayData}
        inventoryTotals={inventoryTotals}
        txTotals={txTotals}
        dailyProfit={closingAuditedProfit}
      />
    </div>
  );
};

export default ClosingScreen;
