import React, { useState, useMemo, useEffect, useRef, Suspense, lazy } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../firebase/useAuth';
import { loadDayFromCloud, saveDayToCloud } from '../../firebase/firestoreService';
import { exportToGoogleSheets } from '../../firebase/sheetsService';
import { 
  WALLET_KEYS, WALLET_LABELS, WALLET_COLORS, 
  GENERAL_WALLET_KEYS, GENERAL_WALLET_LABELS, GENERAL_WALLET_COLORS,
  TX_BADGE_COLORS, TX_LABELS, isTelecomBiz, getTxLabel, getWalletLabel, getCustomWalletColor 
} from '../../data/constants';
import { t, translateUnit } from '../../data/translations';
import { formatBDT, formatBDTWithPrivacy, aggregateTransactions } from '../../data/calculations';
import { 
  Wallet, ArrowRightLeft, Briefcase, MinusCircle, Handshake, 
  ArrowRight, ShoppingBag, Plus, Minus, TrendingUp, Users,
  Smartphone, Zap, CheckCircle2, Search, Package, Trash2,
  FileText, Eye, EyeOff, UserCheck, ShieldCheck,
  RotateCcw, Shield, Landmark, Building2, ClipboardCheck,
  CheckSquare, Square, GraduationCap, FileSpreadsheet, Lock,
  BarChart3, Sparkles, PieChart, LineChart, CreditCard, ChevronRight, ArrowUpRight, TrendingDown,
  X, Send, AlertTriangle, RefreshCw, Globe
} from 'lucide-react';

import RoleGuard, { useIsOwner } from '../Shared/RoleGuard';
import { useAppMode } from '../Shared/ModeGuard';
import AuditLogModal from '../Shared/AuditLogModal';
import VirtualCFOCommentary from '../Analytics/VirtualCFOCommentary';
import CashFlowManager from '../Analytics/CashFlowManager';
import BusinessHealthScorecard from '../Analytics/BusinessHealthScorecard';
import OperationsPipeline from '../Analytics/OperationsPipeline';
import { calculateBusinessHealthScorecard, getOperationsPipeline } from '../../data/analyticsEngine';
import { SCREENS } from '../../data/constants';

import TransferModal from './TransferModal';
import ServiceIncomeModal from './ServiceIncomeModal';
import ExpenseModal from './ExpenseModal';
import LoanModal from './LoanModal';
import AddProductModal from '../Shared/AddProductModal';
import PurchaseStockModal from '../Inventory/PurchaseStockModal';
import OwnerTransactionModal from './OwnerTransactionModal';
import GroupTagadaModal from '../Khata/GroupTagadaModal';
import DamageWriteOffModal from '../Inventory/DamageWriteOffModal';
import AddWalletModal from '../Shared/AddWalletModal';

const CashBoxReportModal = lazy(() => import('./CashBoxReportModal'));
const BankReconciliationModal = lazy(() => import('../Banking/BankReconciliationModal'));
const FixedAssetsModal = lazy(() => import('../Assets/FixedAssetsModal'));
const StockAuditModal = lazy(() => import('../Inventory/StockAuditModal'));
const PayrollModal = lazy(() => import('../Payroll/PayrollModal'));
const ManualJournalModal = lazy(() => import('../Journal/ManualJournalModal'));
const FiscalYearCloseModal = lazy(() => import('../PeriodClose/FiscalYearCloseModal'));
const TutorialModal = lazy(() => import('../Tutorial/TutorialModal'));
const RecurringExpenseManager = lazy(() => import('./RecurringExpenseManager'));
const GoOnlineSetup = lazy(() => import('../PublicStore/GoOnlineSetup'));

export default function DashboardScreen({ isDemoMode = false, onToggleDemoMode = () => {}, initialTab = null, onInitialTabConsumed = () => {} }) {
  const { state, dispatch } = useApp();
  const { dayData, activeBiz, isPrivacyMode, contacts, language } = state;
  const lang = language || 'bn';
  const isOwner = useIsOwner();
  const isAdvanced = state.appMode === 'advanced';
  const isEasy = !isAdvanced;
  const [dashboardTab, setDashboardTab] = useState('treasury'); // default to cash view, not AI

  const [showRecurring, setShowRecurring] = useState(false);
  const [showGoOnline, setShowGoOnline] = useState(false);
  const recurringExpenses = state.dayData?.recurringExpenses || [];
  const todayDate = new Date();
  const currentMonthStr = todayDate.toISOString().slice(0, 7);
  const pendingRecurringCount = recurringExpenses.filter(r => 
    r.isActive && 
    r.dayOfMonth === todayDate.getDate() && 
    r.lastAppliedMonth !== currentMonthStr
  ).length;

  // Handle external tab navigation (e.g., from navbar "Daily Cash Summary")
  React.useEffect(() => {
    if (initialTab) {
      setDashboardTab(initialTab);
      onInitialTabConsumed();
    }
  }, [initialTab]);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const isTelecom = isTelecomBiz(activeBiz?.type, activeBiz?.name);

  const { connectGoogleSheets, userId } = useAuth();
  const [unexportedDay, setUnexportedDay] = useState(null);
  const [bannerExporting, setBannerExporting] = useState(false);
  const [bannerResult, setBannerResult] = useState(null);

  // Check if previous day was not exported to Sheets
  useEffect(() => {
    if (!userId || !state.activeBizId || !dayData) return;
    
    const checkPreviousDay = async () => {
      try {
        // Calculate yesterday's dateKey
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        
        // Try to load yesterday's day from cloud
        const prevDay = await loadDayFromCloud(userId, state.activeBizId, yKey);
        if (prevDay && prevDay.status === 'finalized' && !prevDay.sheetsExported) {
          setUnexportedDay({ dateKey: yKey, dayData: prevDay });
        } else {
          setUnexportedDay(null);
        }
      } catch (err) {
        console.warn('Could not check previous day export status:', err);
      }
    };
    
    checkPreviousDay();
  }, [userId, state.activeBizId, dayData?.dateKey]);

  const handleBannerExport = async () => {
    if (!unexportedDay) return;
    setBannerExporting(true);
    setBannerResult(null);
    try {
      const token = await connectGoogleSheets();
      if (token) {
        const result = await exportToGoogleSheets(token, userId, unexportedDay.dayData, activeBiz, lang);
        setBannerResult({ success: true, message: lang === 'en' ? `✅ "${result.tabTitle}" exported to Google Sheets!` : `✅ "${result.tabTitle}" Google Sheets-এ এক্সপোর্ট হয়েছে!`, url: result.url });
        // Mark as exported in cloud
        try {
          await saveDayToCloud(userId, state.activeBizId, { ...unexportedDay.dayData, sheetsExported: true });
        } catch {}
        setUnexportedDay(null);
      }
    } catch (err) {
      setBannerResult({ success: false, message: lang === 'en' ? `❌ Export failed: ${err.message}` : `❌ এক্সপোর্ট ব্যর্থ: ${err.message}` });
    } finally {
      setBannerExporting(false);
    }
  };

  const scorecard = useMemo(() => calculateBusinessHealthScorecard(state, isDemoMode), [state, isDemoMode]);
  const pipelineData = useMemo(() => getOperationsPipeline(state, isDemoMode), [state, isDemoMode]);

  const [activeModal, setActiveModal] = useState(null);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isPurchaseStockOpen, setIsPurchaseStockOpen] = useState(false);
  const [isDamageModalOpen, setIsDamageModalOpen] = useState(false);
  const [isStockAuditOpen, setIsStockAuditOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isBulkTxMode, setIsBulkTxMode] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState([]);
  const [bulkReportModal, setBulkReportModal] = useState(null);
  const lastProcessedBulkTimestampRef = useRef(0);

  // Synchronize bulk reversal feedback with UI
  useEffect(() => {
    const report = state._bulkReversalReport || dayData?._bulkReversalReport;
    if (report && report.timestamp && report.timestamp !== lastProcessedBulkTimestampRef.current) {
      lastProcessedBulkTimestampRef.current = report.timestamp;
      setBulkReportModal(report);
      if (report.isCompleteSuccess) {
        setSelectedTxIds([]);
        setIsBulkTxMode(false);
      } else if (report.failedIds && report.failedIds.length > 0) {
        setSelectedTxIds(report.failedIds);
      }
    }
  }, [state._bulkReversalReport, dayData?._bulkReversalReport]);

  // Express Rush-Hour Quick Bar state
  const [rushAmount, setRushAmount] = useState('');
  const [rushNote, setRushNote] = useState('');
  const [rushParty, setRushParty] = useState('');
  const [rushPhone, setRushPhone] = useState('');
  const [rushWallet, setRushWallet] = useState('hand_cash');
  const [rushFeedback, setRushFeedback] = useState({ type: '', text: '' });

  // Mobile recharge state (for telecom mode)
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeProfit, setRechargeProfit] = useState('');
  const [rechargeError, setRechargeError] = useState('');
  const [rechargeSuccess, setRechargeSuccess] = useState('');

  // 4 Configurable Recharge Slots
  const [rechargeSlots, setRechargeSlots] = useState(() => {
    try {
      const saved = localStorage.getItem(`telecom_recharge_slots_${activeBiz?.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      }
    } catch {}
    return [null, null, null, null];
  });

  // Selected slot index (0..3)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);

  // Picking slot index for popup modal (0..3 or null)
  const [pickingSlotIndex, setPickingSlotIndex] = useState(null);

  // Persist 4 slots to localStorage
  useEffect(() => {
    if (activeBiz?.id) {
      try {
        localStorage.setItem(`telecom_recharge_slots_${activeBiz?.id}`, JSON.stringify(rechargeSlots));
      } catch {}
    }
  }, [rechargeSlots, activeBiz?.id]);

  const closeModal = () => setActiveModal(null);

  const transactions = dayData?.transactions || [];
  const aggregated = useMemo(() => aggregateTransactions(state.dayData?.transactions || []), [state.dayData?.transactions]);

  // Determine active wallet keys for dashboard (honoring custom walletOrder)
  const allDashWalletKeys = Object.keys(dayData?.wallets || {});
  const activeDashWalletKeys = (dayData?.walletOrder && dayData.walletOrder.length > 0)
    ? [
        ...dayData.walletOrder.filter(k => allDashWalletKeys.includes(k)),
        ...allDashWalletKeys.filter(k => !dayData.walletOrder.includes(k))
      ]
    : allDashWalletKeys;

  // Auto-fill empty recharge slots from active non-hand_cash wallets
  useEffect(() => {
    const isAllEmpty = rechargeSlots.every(s => !s);
    if (isAllEmpty && activeDashWalletKeys.length > 0) {
      const nonCash = activeDashWalletKeys.filter(k => k !== 'hand_cash');
      if (nonCash.length > 0) {
        setRechargeSlots([
          nonCash[0] || null,
          nonCash[1] || null,
          nonCash[2] || null,
          nonCash[3] || null,
        ]);
      }
    }
  }, [activeDashWalletKeys]);

  const openingLoans = dayData?.loans || { openingGiven: 0, openingTaken: 0 };
  const contactsReceivable = (contacts || [])
    .filter(c => c.type === 'customer')
    .reduce((sum, c) => sum + (Number(c.currentBalance) || 0), 0);
  const dayTxReceivable = (openingLoans.openingGiven || 0) + aggregated.loanGiven - aggregated.loanCollected;
  const totalReceivable = contactsReceivable > 0 ? contactsReceivable : dayTxReceivable;

  const contactsPayable = (contacts || [])
    .filter(c => c.type === 'supplier')
    .reduce((sum, c) => sum + (Number(c.currentBalance) || 0), 0);
  const dayTxPayable = (openingLoans.openingTaken || 0) + aggregated.loanTaken - aggregated.loanRepaid;
  const totalPayable = contactsPayable > 0 ? contactsPayable : dayTxPayable;

  // ── 30-Year Veteran Accounting Pillars ────────────────────────────────
  // Pillar 1: Cash Flow vs Operating Net Profit
  const currentHandCash = dayData?.wallets?.hand_cash?.current || 0;
  const openingHandCash = dayData?.wallets?.hand_cash?.opening || 0;

  // Operating Net Profit = Gross Profit from Sales/Services/Recharge - Operating Expenses
  const todayGrossProfit = isTelecom 
    ? (aggregated.servicesTotal + aggregated.rechargeProfit + aggregated.stockSalesProfit)
    : aggregated.stockSalesProfit;
  const todayNetProfit = todayGrossProfit - aggregated.expenses;

  // Pillar 2: Real-time Auto-Tally Cash Audit Equation
  const cashIn = (aggregated.ownerGave || 0) + 
    (aggregated.loanCollected || 0) + 
    (aggregated.servicesTotal || 0) + 
    (aggregated.stockSalesRevenue || 0) + 
    (aggregated.rechargeTotal || 0) + 
    (aggregated.fundTransferCashIn || 0);

  const cashOut = (aggregated.expenses || 0) + 
    (aggregated.personalDraw || 0) + 
    (aggregated.ownerTook || 0) + 
    (aggregated.loanGiven || 0) + 
    (aggregated.loanRepaid || 0) + 
    (aggregated.stockPurchasesCost || 0) + 
    (aggregated.fundTransferCashOut || 0);

  const expectedHandCash = openingHandCash + cashIn - cashOut;
  const cashDiscrepancy = currentHandCash - expectedHandCash;
  const isCashPerfect = Math.abs(cashDiscrepancy) < 0.01;

  // Calculate Total Stock Value
  const totalStockValue = (dayData?.inventory || []).reduce((sum, item) => {
    const currentAvailable = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
    const soldUnits = (dayData?.transactions || [])
      .filter(t => t.type === 'stock_sale' && t.itemId === item.id && !t.reversed && !t.isReversal)
      .reduce((s, t) => s + (Number(t.quantity) || 0), 0);
    const damagedUnits = (dayData?.transactions || [])
      .filter(t => (t.type === 'stock_damage' || t.type === 'damage_loss') && t.itemId === item.id && !t.reversed && !t.isReversal)
      .reduce((s, t) => s + (Number(t.quantity) || 0), 0);

    let currentClosing = item.closingStock !== undefined && item.closingStock !== null 
      ? item.closingStock 
      : currentAvailable;
    if (currentClosing === 0 && currentAvailable > 0 && soldUnits === 0 && damagedUnits === 0) {
      currentClosing = currentAvailable;
    }
    return sum + (currentClosing * (item.buyPrice || 0));
  }, 0);

  const handleQuickSell = (itemId, qty = 1) => {
    dispatch({
      type: 'QUICK_SELL_STOCK',
      payload: { itemId, quantity: qty }
    });
  };

  const handleQuickRestock = (itemId, qty = 1) => {
    dispatch({
      type: 'QUICK_RESTOCK',
      payload: { itemId, quantity: qty, sourceWallet: 'hand_cash' }
    });
  };

  const handleAddProduct = (productData) => {
    // Extract payment info before adding to inventory
    const { paymentWallet, totalCost, ...inventoryData } = productData;
    
    dispatch({
      type: 'ADD_INVENTORY_ITEM',
      payload: inventoryData
    });

    // If product has initial stock and a payment wallet, deduct cost
    if (paymentWallet && totalCost > 0) {
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'stock_purchase',
          amount: totalCost,
          fromWallet: paymentWallet,
          note: `${inventoryData.name} — ${inventoryData.openingStock} ${inventoryData.unit} × ৳${inventoryData.buyPrice} = ৳${totalCost} (${lang === 'en' ? 'New Product Added' : 'নতুন প্রোডাক্ট যোগ'})`
        }
      });
    }
  };

  const handleRemoveProduct = (itemId) => {
    if (window.confirm(t('confirm_delete_product', lang))) {
      dispatch({
        type: 'REMOVE_INVENTORY_ITEM',
        payload: itemId
      });
    }
  };

  const activeRechargeWalletKey = rechargeSlots[selectedSlotIndex] || null;

  const handleClearSlot = (e, index) => {
    e.stopPropagation();
    setRechargeSlots(prev => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  };

  const handleAssignWalletToSlot = (walletKey) => {
    if (pickingSlotIndex !== null) {
      setRechargeSlots(prev => {
        const next = [...prev];
        next[pickingSlotIndex] = walletKey;
        return next;
      });
      setSelectedSlotIndex(pickingSlotIndex);
      setPickingSlotIndex(null);
    }
  };

  const handleRechargeSubmit = (e) => {
    e.preventDefault();
    setRechargeError('');
    setRechargeSuccess('');

    const amountNum = parseFloat(rechargeAmount);
    const profitNum = parseFloat(rechargeProfit) || 0;

    if (!amountNum || amountNum <= 0) {
      setRechargeError(lang === 'en' ? 'Please enter a valid recharge amount' : 'দয়া করে সঠিক রিচার্জের পরিমাণ লিখুন');
      return;
    }

    if (!activeRechargeWalletKey) {
      setRechargeError(lang === 'en' ? 'Please choose a recharge wallet from the 4 slots below' : 'দয়া করে নিচের ৪টি স্লট থেকে যে অ্যাকাউন্ট থেকে টাকা কাটবে তা নির্বাচন করুন');
      return;
    }

    const sourceWalletKey = activeRechargeWalletKey;
    const sourceWallet = dayData?.wallets?.[sourceWalletKey];
    const sourceWalletLabel = sourceWallet?.label || getWalletLabel(sourceWalletKey, lang, sourceWallet);
    const sourceWalletBalance = sourceWallet?.current || 0;

    if (amountNum > sourceWalletBalance) {
      setRechargeError(`${sourceWalletLabel} ${lang === 'en' ? 'has insufficient balance:' : 'অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই:'} ${formatBDT(sourceWalletBalance, lang)}`);
      return;
    }

    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        type: 'recharge',
        amount: amountNum,
        profit: profitNum,
        fromWallet: sourceWalletKey,
        operator: sourceWalletLabel,
        note: `${lang === 'en' ? 'Mobile Recharge' : 'টেলিকম রিচার্জ'} (${sourceWalletLabel})${profitNum > 0 ? ` • লাভ/কমিশন: ${formatBDT(profitNum, lang)}` : ''}`
      }
    });

    const totalCashCollected = ((amountNum || 0) + (profitNum || 0));
    setRechargeSuccess(
      lang === 'en'
        ? `✅ Recharged ${formatBDT(amountNum, 'en')} from ${sourceWalletLabel}! ${formatBDT(totalCashCollected, 'en')} received in Hand Cash.`
        : `✅ ${sourceWalletLabel} থেকে ${formatBDT(amountNum, 'bn')} রিচার্জ সফল! ক্যাশে ${formatBDT(totalCashCollected, 'bn')} জমা হয়েছে।`
    );
    setRechargeAmount('');
    setRechargeProfit('');
    setTimeout(() => setRechargeSuccess(''), 5000);
  };

  const handleRushPartyChange = (e) => {
    const val = e.target.value;
    setRushParty(val);
    const matched = (contacts || []).find(c => c.name.toLowerCase().trim() === val.toLowerCase().trim());
    if (matched && matched.phone && !rushPhone) {
      setRushPhone(matched.phone);
    }
  };

  const handleRushAction = (actionType) => {
    setRushFeedback({ type: '', text: '' });
    const numAmount = parseFloat(rushAmount);

    if (!numAmount || numAmount <= 0) {
      setRushFeedback({ type: 'error', text: t('dash_err_amount_valid', lang) });
      return;
    }

    const note = rushNote.trim();
    const partyName = rushParty.trim();
    const phone = rushPhone.trim();
    const selectedWallet = rushWallet || 'hand_cash';
    const walletLabel = getWalletLabel(selectedWallet, lang);

    if (actionType === 'expense') {
      const currentCash = dayData?.wallets?.[selectedWallet]?.current || 0;
      if (numAmount > currentCash) {
        setRushFeedback({ type: 'error', text: `⚠️ ${walletLabel} ${t('account_no_balance', lang)} ${formatBDT(currentCash, lang)}` });
        return;
      }
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'expense',
          amount: numAmount,
          fromWallet: selectedWallet,
          customerName: partyName || undefined,
          phone: phone || undefined,
          note: note || (partyName ? `${partyName}${phone ? ` (${phone})` : ''} - ${t('rush_cash_expense', lang)}` : t('rush_cash_expense', lang))
        }
      });
      setRushFeedback({ type: 'success', text: `✅ ${formatBDT(numAmount, lang)} ${t('rush_expense_success', lang)} (${walletLabel})` });
    } else if (actionType === 'family_expense' || actionType === 'personal_draw') {
      const currentCash = dayData?.wallets?.[selectedWallet]?.current || 0;
      if (numAmount > currentCash) {
        setRushFeedback({ type: 'error', text: `⚠️ ${walletLabel} ${t('account_no_balance', lang)} ${formatBDT(currentCash, lang)}` });
        return;
      }
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'personal_draw',
          amount: numAmount,
          fromWallet: selectedWallet,
          customerName: partyName || undefined,
          phone: phone || undefined,
          note: note || (partyName ? `${partyName}${phone ? ` (${phone})` : ''} - ${lang === 'en' ? 'Family Expense' : 'ফ্যামিলি খরচ'}` : (lang === 'en' ? 'Family / Personal Expense' : 'মালিকের ব্যক্তিগত / ফ্যামিলি খরচ'))
        }
      });
      setRushFeedback({ type: 'success', text: `✅ ${formatBDT(numAmount, lang)} ${lang === 'en' ? 'recorded as Family / Personal Expense' : 'ফ্যামিলি খরচ হিসেবে রেকর্ড হয়েছে'} (${walletLabel})` });
    } else if (actionType === 'cash_sale') {
      // Mandatory: product name / description
      if (!note) {
        setRushFeedback({ type: 'error', text: lang === 'en' ? '⚠️ Enter product name or description' : '⚠️ পণ্যের নাম বা বিবরণ দিন' });
        return;
      }
      // Smart product match: find product by name to get real profit
      const products = dayData?.products || [];
      const noteLower = (note || '').toLowerCase().trim();
      const matchedProduct = products.find(p => 
        p.name && p.name.toLowerCase().trim() === noteLower
      ) || products.find(p => 
        p.name && noteLower.includes(p.name.toLowerCase().trim())
      );
      
      let realProfit = 0;
      const txPayload = {
        type: 'stock_sale',
        amount: numAmount,
        toWallet: selectedWallet,
        customerName: partyName || undefined,
        phone: phone || undefined,
        note: note || (partyName ? `${partyName}${phone ? ` (${phone})` : ''} - ${t('rush_cash_sale', lang)}` : t('rush_cash_sale', lang))
      };
      
      if (matchedProduct && Number(matchedProduct.buyPrice) > 0) {
        // Real profit = sellAmount - (buyPrice × estimated qty)
        const buyPrice = Number(matchedProduct.buyPrice);
        const sellPrice = Number(matchedProduct.sellPrice) || numAmount;
        const estimatedQty = sellPrice > 0 ? Math.round(numAmount / sellPrice) || 1 : 1;
        realProfit = Math.round(numAmount - (buyPrice * estimatedQty));
        txPayload.profit = Math.max(0, realProfit);
        txPayload.productId = matchedProduct.id;
        txPayload.productName = matchedProduct.name;
      } else {
        // No product match — store 0 profit (honest, not fake 15%)
        txPayload.profit = 0;
      }
      
      dispatch({ type: 'ADD_TRANSACTION', payload: txPayload });
      const profitInfo = matchedProduct ? ` (${lang === 'en' ? 'Profit' : 'লাভ'}: ${formatBDT(realProfit, lang)})` : '';
      setRushFeedback({ type: 'success', text: `✅ ${formatBDT(numAmount, lang)} ${t('rush_sale_success', lang)} (${walletLabel})${profitInfo}` });
    } else if (actionType === 'loan_personal') {
      // "ধার দিলাম" — personal loan given, mandatory party name
      if (!partyName) {
        setRushFeedback({ type: 'error', text: lang === 'en' ? '⚠️ Enter the name of the person you are lending to' : '⚠️ কাকে ধার দিচ্ছেন তার নাম দিন' });
        return;
      }
      const currentCash = dayData?.wallets?.[selectedWallet]?.current || 0;
      if (numAmount > currentCash) {
        setRushFeedback({ type: 'error', text: `⚠️ ${walletLabel} ${t('account_no_balance', lang)} ${formatBDT(currentCash, lang)}` });
        return;
      }
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'loan_given',
          amount: numAmount,
          fromWallet: selectedWallet,
          customerName: partyName,
          phone: phone || undefined,
          note: note || `${partyName}${phone ? ` (${phone})` : ''} ${lang === 'en' ? '- Personal Loan Given' : '- ধার দিলাম'}`
        }
      });
      setRushFeedback({ 
        type: 'success', 
        text: lang === 'en'
          ? `✅ Lent ${formatBDT(numAmount, lang)} to ${partyName} (Deducted from ${walletLabel})!`
          : `✅ ${partyName}-কে ${formatBDT(numAmount, lang)} ধার দেওয়া হয়েছে (${walletLabel} থেকে কাটা হয়েছে)!` 
      });
    } else if (actionType === 'due_given') {
      // "বাকি দিলাম" — mandatory party name
      if (!partyName) {
        setRushFeedback({ type: 'error', text: lang === 'en' ? '⚠️ Enter customer name' : '⚠️ কাস্টমারের নাম দিন' });
        return;
      }
      const currentCash = dayData?.wallets?.[selectedWallet]?.current || 0;
      if (numAmount > currentCash) {
        setRushFeedback({ type: 'error', text: `⚠️ ${walletLabel} ${t('account_no_balance', lang)} ${formatBDT(currentCash, lang)}` });
        return;
      }
      const finalPartyName = partyName;
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'loan_given',
          amount: numAmount,
          fromWallet: selectedWallet,
          customerName: finalPartyName,
          phone: phone || undefined,
          note: note || (partyName ? `${partyName}${phone ? ` (${phone})` : ''} ${t('due_given_to', lang)}` : t('due_given_fallback', lang))
        }
      });
      setRushFeedback({ 
        type: 'success', 
        text: lang === 'en'
          ? `✅ Lent ${formatBDT(numAmount, lang)} on due to ${finalPartyName} (Deducted from ${walletLabel} & added to Due Ledger)!`
          : `✅ ${finalPartyName}-কে ${formatBDT(numAmount, lang)} বাকি দেওয়া হয়েছে (${walletLabel} থেকে কাটা হয়েছে ও বাকির খাতায় যুক্ত হয়েছে)!` 
      });
    } else if (actionType === 'due_collected') {
      const finalPartyName = partyName || (lang === 'en' ? 'Customer' : 'কাস্টমার');
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'loan_collected',
          amount: numAmount,
          toWallet: selectedWallet,
          customerName: finalPartyName,
          phone: phone || undefined,
          note: note || (partyName ? `${partyName}${phone ? ` (${phone})` : ''} ${t('due_paid_fallback', lang)}` : t('due_collected_fallback', lang))
        }
      });
      setRushFeedback({ 
        type: 'success', 
        text: lang === 'en'
          ? `✅ Collected ${formatBDT(numAmount, lang)} due from ${finalPartyName} (Added to ${walletLabel} & adjusted in Ledger)!`
          : `✅ ${finalPartyName} থেকে ${formatBDT(numAmount, lang)} বাকি আদায় (${walletLabel}-এ যোগ হয়েছে ও খাতায় সমন্বয় হয়েছে)!` 
      });
    }

    setRushAmount('');
    setRushNote('');
    setRushParty('');
    setRushPhone('');
    setTimeout(() => setRushFeedback({ type: '', text: '' }), 4000);
  };

  // Filter products by search query
  const inventoryList = (dayData?.inventory || []).filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Shared modals rendered in both modes
  const renderSharedModals = () => (
    <Suspense fallback={null}>
      <TransferModal isOpen={activeModal === 'transfer'} onClose={closeModal} />
      <ServiceIncomeModal isOpen={activeModal === 'service'} onClose={closeModal} />
      <ExpenseModal isOpen={activeModal === 'expense'} onClose={closeModal} />
      <LoanModal isOpen={activeModal === 'loan'} onClose={closeModal} />
      <OwnerTransactionModal isOpen={activeModal === 'owner'} onClose={closeModal} />
      <CashBoxReportModal isOpen={activeModal === 'cashbox_report'} onClose={closeModal} />
      <GroupTagadaModal isOpen={activeModal === 'group_tagada'} onClose={closeModal} />
      <BankReconciliationModal isOpen={activeModal === 'bank_reconcile'} onClose={closeModal} />
      <FixedAssetsModal isOpen={activeModal === 'fixed_assets'} onClose={closeModal} />
      <StockAuditModal 
        isOpen={activeModal === 'stock_audit' || isStockAuditOpen} 
        onClose={() => { closeModal(); setIsStockAuditOpen(false); }} 
      />
      <DamageWriteOffModal
        isOpen={isDamageModalOpen}
        onClose={() => setIsDamageModalOpen(false)}
      />
      <PayrollModal isOpen={activeModal === 'payroll'} onClose={closeModal} />
      <ManualJournalModal isOpen={activeModal === 'manual_journal'} onClose={closeModal} />
      <FiscalYearCloseModal isOpen={activeModal === 'fiscal_close'} onClose={closeModal} />
      <TutorialModal 
        isOpen={activeModal === 'tutorial'} 
        onClose={closeModal}
        onOpenBankReconcile={() => setActiveModal('bank_reconcile')}
        onOpenFixedAssets={() => setActiveModal('fixed_assets')}
        onOpenStockAudit={() => setIsStockAuditOpen(true)}
        onOpenPayroll={() => setActiveModal('payroll')}
        onOpenManualJournal={() => setActiveModal('manual_journal')}
        onOpenFiscalClose={() => setActiveModal('fiscal_close')}
        onOpenShortcuts={() => closeModal()}
      />
      <AuditLogModal 
        isOpen={showAuditLog} 
        onClose={() => setShowAuditLog(false)} 
      />
      {/* ── Bulk Reversal Results Modal ── */}
      {bulkReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                {bulkReportModal.isCompleteSuccess ? (
                  <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <h3 className="text-base font-bold text-white">
                    {bulkReportModal.isCompleteSuccess
                      ? (lang === 'en' ? 'Bulk Reversal Succeeded' : 'বাল্ক রিভার্সাল সম্পূর্ণ সফল')
                      : (lang === 'en' ? 'Partial Bulk Reversal' : 'আংশিক বাল্ক রিভার্সাল')}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {lang === 'en' ? 'Reversal status & dependency breakdown' : 'রিভার্সালের অবস্থা ও ডিপেন্ডেন্সি বিবরণ'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setBulkReportModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <span className="block text-slate-400">{lang === 'en' ? 'Requested' : 'অনুরোধ'}</span>
                <span className="font-bold text-sm text-white">{bulkReportModal.totalRequested}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40">
                <span className="block text-emerald-300">{lang === 'en' ? 'Succeeded' : 'সফল'}</span>
                <span className="font-bold text-sm text-emerald-400">{bulkReportModal.succeededCount}</span>
              </div>
              <div className={`p-2.5 rounded-xl border ${bulkReportModal.failedCount > 0 ? 'bg-rose-950/40 border-rose-800/40' : 'bg-slate-800/60 border-slate-700/60'}`}>
                <span className={`block ${bulkReportModal.failedCount > 0 ? 'text-rose-300' : 'text-slate-400'}`}>
                  {lang === 'en' ? 'Failed' : 'ব্যর্থ'}
                </span>
                <span className={`font-bold text-sm ${bulkReportModal.failedCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                  {bulkReportModal.failedCount}
                </span>
              </div>
            </div>

            {/* Already reversed note if any */}
            {bulkReportModal.alreadyReversedCount > 0 && (
              <div className="p-2.5 rounded-xl bg-sky-950/40 border border-sky-800/40 text-xs text-sky-200">
                ℹ️ {bulkReportModal.alreadyReversedCount} {lang === 'en' ? 'transaction(s) were already previously reversed.' : 'টি লেনদেন ইতিমধ্যে আগেই রিভার্স করা ছিল।'}
              </div>
            )}

            {/* Failed Items Details */}
            {bulkReportModal.failedCount > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Failed Transactions (Unreversed Dependencies):' : 'যেসব লেনদেন রিভার্স করা যায়নি (ডিপেন্ডেন্সি বাধা):'}
                </h4>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {bulkReportModal.failedIds.map(fId => {
                    const tx = transactions.find(t => t.id === fId);
                    return (
                      <div key={fId} className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs space-y-1">
                        <div className="flex justify-between font-medium text-white">
                          <span>{tx?.note || tx?.itemName || tx?.type || fId}</span>
                          <span className="font-bold text-rose-300">{formatBDT(tx?.amount || 0)}</span>
                        </div>
                        <p className="text-[11px] text-rose-200/80 leading-relaxed">
                          {tx?.type === 'stock_purchase' || tx?.type === 'quick_restock'
                            ? (lang === 'en'
                                ? '⚠️ Stock from this purchase has already been sold. You must reverse the downstream sales first before this purchase can be safely reversed.'
                                : '⚠️ এই ক্রয়ের পণ্য ইতিমধ্যে বিক্রি হয়ে গেছে। ক্রয় রিভার্স করার আগে সংশ্লিষ্ট বিক্রয়ের লেনদেনটি রিভার্স করতে হবে।')
                            : (lang === 'en'
                                ? '⚠️ Dependent transaction could not be reversed safely.'
                                : '⚠️ সংযুক্ত নির্ভরশীল লেনদেনের কারণে রিভার্স করা সম্ভব হয়নি।')}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              {bulkReportModal.failedCount > 0 && (
                <button
                  onClick={() => {
                    setSelectedTxIds(bulkReportModal.failedIds);
                    setBulkReportModal(null);
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer"
                >
                  {lang === 'en' ? 'Keep Failed Selected' : 'ব্যর্থগুলো নির্বাচিত রাখুন'}
                </button>
              )}
              <button
                onClick={() => {
                  if (bulkReportModal.isCompleteSuccess) {
                    setSelectedTxIds([]);
                    setIsBulkTxMode(false);
                  }
                  setBulkReportModal(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Close' : 'বন্ধ করুন'}
              </button>
            </div>
          </div>
        </div>
      )}
      <AddProductModal 
        isOpen={isAddProductOpen} 
        onClose={() => setIsAddProductOpen(false)} 
        onAddProduct={handleAddProduct} 
      />
      <PurchaseStockModal
        isOpen={isPurchaseStockOpen}
        onClose={() => setIsPurchaseStockOpen(false)}
        onOpenAddNewProduct={() => setIsAddProductOpen(true)}
      />
      <AddWalletModal
        isOpen={activeModal === 'addWallet'}
        onClose={closeModal}
      />
      <RecurringExpenseManager
        isOpen={showRecurring}
        onClose={() => setShowRecurring(false)}
        state={state}
        dispatch={dispatch}
        lang={lang}
      />
      <GoOnlineSetup
        isOpen={showGoOnline}
        onClose={() => setShowGoOnline(false)}
        state={state}
        dispatch={dispatch}
      />
    </Suspense>
  );

  // ═════════════════════════════════════════════════════════════════
  // 🟢 EASY MODE: 100% CLEAN RETAIL SHOPKEEPER LAYOUT
  // ═════════════════════════════════════════════════════════════════
  if (isEasy) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 pb-16 font-sans">
        
        {/* 1. Easy Mode Hero Cash Summary */}
        <div className="rounded-2xl p-5 bg-gradient-to-r from-emerald-600 via-emerald-600 to-emerald-700 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold opacity-85 uppercase tracking-wide">
                {lang === 'en' ? 'Today Received' : 'আজ মোট পেলাম'}
              </p>
              <p className="text-2xl sm:text-3xl font-black mt-0.5">{formatBDT(cashIn, lang)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold opacity-85 uppercase tracking-wide">
                {lang === 'en' ? 'Today Spent' : 'আজ মোট দিলাম'}
              </p>
              <p className="text-2xl sm:text-3xl font-black mt-0.5">{formatBDT(cashOut, lang)}</p>
            </div>
          </div>
          <div className="mt-4 pt-3.5 border-t border-white/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold opacity-85">
                {lang === 'en' ? 'Cash in Drawer' : 'ক্যাশ ড্রয়ারে আছে'}
              </p>
              <p className="text-3xl sm:text-4xl font-black text-amber-300">
                {formatBDTWithPrivacy(currentHandCash, isPrivacyMode, lang)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveModal('cashbox_report')}
                className="px-3.5 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Drawer Report' : 'ড্রয়ার রিপোর্ট'}</span>
              </button>
              <button
                onClick={() => setActiveModal('owner')}
                className="px-3.5 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Owner' : 'মালিক'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 2. Wallet Balances Overview */}
        <section className="bg-white p-4 rounded-2xl shadow-md space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <span>💰</span> {t('wallet_balances_title', lang)}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRecurring(true)}
                className="relative flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-300 cursor-pointer shadow-xs"
                title={lang === 'en' ? 'Recurring Expenses' : 'মাসিক নির্ধারিত খরচ'}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Monthly' : 'মাসিক খরচ'}</span>
                {pendingRecurringCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-white">{pendingRecurringCount}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowGoOnline(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300 cursor-pointer shadow-xs"
                title={lang === 'en' ? 'Go Online — Let customers order' : 'অনলাইন করুন — কাস্টমার অর্ডার করবে'}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Go Online' : 'অনলাইন'}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('addWallet')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all bg-sky-50 text-sky-700 hover:bg-sky-100 border border-slate-300 cursor-pointer shadow-xs"
                title={lang === 'en' ? 'Add new wallet / account' : 'নতুন ওয়ালেট যোগ করুন'}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Add Wallet' : 'ওয়ালেট যোগ'}</span>
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'TOGGLE_PRIVACY_MODE' })}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                  isPrivacyMode
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {isPrivacyMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{isPrivacyMode ? t('privacy_on', lang) : t('privacy_off', lang)}</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {activeDashWalletKeys.map((key) => {
              const wallet = dayData?.wallets?.[key] || { current: 0, opening: 0 };
              const colors = getCustomWalletColor(key, activeDashWalletKeys, wallet);
              const isHandCash = key === 'hand_cash';
              const label = wallet?.label || getWalletLabel(key, lang, wallet);
              return (
                <div key={key} className={`p-3.5 rounded-xl ${colors.bg || 'bg-gray-100'} ${colors.border || 'border-gray-200'} border flex flex-col justify-between ${isHandCash ? 'ring-2 ring-emerald-400' : ''}`}>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="truncate">{colors.icon || '💰'} {label}</span>
                    {isHandCash && <span className="text-xs bg-emerald-600 text-white font-bold px-1.5 py-0.5 rounded ml-1">DRAWER</span>}
                  </div>
                  <div className="text-xl font-black text-gray-900 mt-2">
                    {formatBDTWithPrivacy(wallet.current, isPrivacyMode, lang)}
                  </div>
                </div>
              );
            })}
            {/* If business has stock items, show total stock value card as well */}
            {totalStockValue > 0 && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>📦 {t('total_stock_value', lang)}</span>
                </div>
                <div className="text-xl font-black text-slate-900 dark:text-white mt-2">
                  {formatBDTWithPrivacy(totalStockValue, isPrivacyMode, lang)}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 2b. Online Orders & Courier Quick Banner */}
        <div 
          onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.ONLINE_ORDERS })}
          className="bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 hover:from-emerald-900 hover:to-teal-900 text-white p-3.5 sm:p-4 rounded-2xl border border-emerald-500/40 shadow-md flex items-center justify-between cursor-pointer transition-all hover:scale-[1.005]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-xl shrink-0">
              🚚
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white truncate">
                  {lang === 'en' ? 'Online Orders & Courier Tracking' : 'অনলাইন অর্ডার ও কুরিয়ার ট্র্যাকিং'}
                </h3>
                <span className="text-[10px] bg-emerald-500 text-slate-950 font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                  F-Commerce
                </span>
              </div>
              <p className="text-xs text-emerald-200/80 mt-0.5 truncate">
                {lang === 'en' 
                  ? `${state.onlineOrders?.length || 0} Orders · Steadfast, Pathao, RedX COD & WhatsApp` 
                  : `${state.onlineOrders?.length || 0}টি অর্ডার · স্টিডফাস্ট, পাঠাও, রেডেক্স COD ও WhatsApp`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 shadow-sm ml-2">
            <span>{lang === 'en' ? 'Orders' : 'অর্ডার দেখুন'}</span>
            <span>→</span>
          </div>
        </div>

        {/* 3. Express Rush-Hour Quick Bar */}
        <section className="bg-slate-50 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 p-1 rounded-2xl shadow-md">
          <div className="bg-white p-4 sm:p-5 rounded-2xl space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500 fill-amber-400" />
              <div>
                <h2 className="text-sm sm:text-base font-black text-gray-900">
                  {t('rush_hour_title', lang)}
                </h2>
                <p className="text-xs text-gray-500">
                  {t('rush_hour_subtitle', lang)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('amount_taka', lang)} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={rushAmount}
                  onChange={(e) => setRushAmount(e.target.value)}
                  placeholder={lang === 'en' ? 'Tk 0' : '৳ 0'}
                  className="w-full px-3 py-2 text-base font-bold border-2 border-slate-300 rounded-xl focus:border-slate-600 focus:outline-none bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('party_name', lang)}
                </label>
                <input
                  type="text"
                  list="quick-contact-list"
                  value={rushParty}
                  onChange={handleRushPartyChange}
                  placeholder={lang === 'en' ? 'Customer / Party Name' : 'কাস্টমার বা ব্যক্তি'}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:border-slate-500 focus:outline-none bg-white"
                />
                <datalist id="quick-contact-list">
                  {(contacts || []).map(c => (
                    <option key={c.id} value={c.name}>
                      {c.phone ? `${c.name} (${c.phone})` : c.name} {c.currentBalance ? `— ${lang === 'en' ? 'Due' : 'বাকি'}: ৳${c.currentBalance}` : ''}
                    </option>
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('party_phone_optional', lang)}
                </label>
                <input
                  type="tel"
                  value={rushPhone}
                  onChange={(e) => setRushPhone(e.target.value)}
                  placeholder={lang === 'en' ? 'Mobile No (Optional)' : 'মোবাইল নম্বর (ঐচ্ছিক)'}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:border-slate-500 focus:outline-none bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
                  <span>{lang === 'en' ? 'Wallet / Account' : 'ওয়ালেট / মাধ্যম'}</span>
                  <span className="text-xs text-sky-600 font-semibold">
                    {formatBDT(dayData?.wallets?.[rushWallet]?.current || 0, lang)}
                  </span>
                </label>
                <select
                  value={rushWallet}
                  onChange={(e) => setRushWallet(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-semibold border border-gray-200 rounded-xl focus:border-slate-500 focus:outline-none bg-white cursor-pointer"
                >
                  {activeDashWalletKeys.map((key) => {
                    const bal = dayData?.wallets?.[key]?.current || 0;
                    const wallet = dayData?.wallets?.[key];
                    const label = wallet?.label || getWalletLabel(key, lang, wallet);
                    const colorScheme = getCustomWalletColor(key, activeDashWalletKeys, wallet);
                    const icon = colorScheme?.icon || '💰';
                    return (
                      <option key={key} value={key}>
                        {icon} {label} ({formatBDT(bal, lang)})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('note_optional', lang)}
                </label>
                <input
                  type="text"
                  list="quick-product-list"
                  value={rushNote}
                  onChange={(e) => setRushNote(e.target.value)}
                  placeholder={lang === 'en' ? 'Item or purpose' : 'পণ্যের নাম / বিবরণ'}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:border-slate-500 focus:outline-none bg-white"
                />
                <datalist id="quick-product-list">
                  {(dayData?.products || []).map(p => (
                    <option key={p.id} value={p.name}>
                      {p.name} — {lang === 'en' ? 'Tk ' : '৳'}{p.sellPrice || 0}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleRushAction('cash_sale')}
                className="flex items-center justify-center gap-1.5 py-3 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all cursor-pointer"
              >
                <span>⚡</span> {t('rush_cash_sale', lang)}
              </button>
              <button
                type="button"
                onClick={() => handleRushAction('loan_personal')}
                className="flex items-center justify-center gap-1.5 py-3 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all cursor-pointer"
                title={lang === 'en' ? 'Personal Loan Given' : 'ব্যক্তিগত ধার দেওয়া'}
              >
                <span>🤝</span> {lang === 'en' ? 'Loan Given' : 'ধার দিলাম'}
              </button>
              <button
                type="button"
                onClick={() => handleRushAction('expense')}
                className="flex items-center justify-center gap-1.5 py-3 px-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all cursor-pointer"
              >
                <span>💸</span> {t('rush_shop_expense', lang)}
              </button>
              <button
                type="button"
                onClick={() => handleRushAction('family_expense')}
                className="flex items-center justify-center gap-1.5 py-3 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all cursor-pointer"
                title={lang === 'en' ? 'Family / Personal Expense' : 'মালিকের ব্যক্তিগত বা ফ্যামিলি খরচ'}
              >
                <span>👨‍👩‍👧</span> {t('rush_family_expense', lang)}
              </button>
              <button
                type="button"
                onClick={() => handleRushAction('due_given')}
                className="flex items-center justify-center gap-1.5 py-3 px-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all cursor-pointer"
              >
                <span>🔴</span> {t('rush_due_given', lang)}
              </button>
              <button
                type="button"
                onClick={() => handleRushAction('due_collected')}
                className="flex items-center justify-center gap-1.5 py-3 px-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all cursor-pointer"
              >
                <span>🟢</span> {t('rush_due_collect', lang)}
              </button>
            </div>

            {rushFeedback.text && (
              <div className={`p-2.5 rounded-xl text-xs font-bold text-center ${
                rushFeedback.type === 'error'
                  ? 'bg-rose-50 border border-rose-200 text-rose-700'
                  : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              }`}>
                {rushFeedback.text}
              </div>
            )}
          </div>
        </section>

        {/* 4. Loans & Debts Widget */}
        <section className="bg-white p-5 rounded-2xl shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-600" />
              {t('due_tracker_title', lang)}
            </h2>
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: 'khata' })}
              className="px-3.5 py-1.5 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded-xl text-xs font-bold transition-all"
            >
              {t('view_full_khata', lang)} ➔
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl dark:bg-slate-800 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('total_receivable_title', lang)}</p>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 mt-1">
                {formatBDTWithPrivacy(totalReceivable, isPrivacyMode, lang)}
              </p>
            </div>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
              <p className="text-xs font-semibold text-amber-700">{t('total_payable_title', lang)}</p>
              <p className="text-2xl sm:text-3xl font-black text-amber-900 mt-1">
                {formatBDTWithPrivacy(totalPayable, isPrivacyMode, lang)}
              </p>
            </div>
          </div>
        </section>

        {/* 5. Mobile Recharge (if telecom) */}
        {isTelecom && (
          <section className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-md border border-sky-100 dark:border-sky-900/40 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sky-100/60 dark:border-sky-900/30 pb-3">
              <h2 className="text-base font-bold text-sky-900 dark:text-sky-200 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                {lang === 'en' ? 'Telecom Recharge' : 'টেলিকম রিচার্জ (Telecom Recharge)'}
              </h2>
              {activeRechargeWalletKey && (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 rounded-xl text-xs font-bold text-sky-800 dark:text-sky-300">
                  <span>{lang === 'en' ? 'Deducting from:' : 'টাকা কাটবে:'}</span>
                  <span className="text-sky-900 dark:text-sky-100 font-extrabold flex items-center gap-1">
                    <span>{getCustomWalletColor(activeRechargeWalletKey, activeDashWalletKeys, dayData?.wallets?.[activeRechargeWalletKey])?.icon}</span>
                    <span>{dayData?.wallets?.[activeRechargeWalletKey]?.label || getWalletLabel(activeRechargeWalletKey, lang, dayData?.wallets?.[activeRechargeWalletKey])}</span>
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    ({formatBDT(dayData?.wallets?.[activeRechargeWalletKey]?.current || 0, lang)})
                  </span>
                </div>
              )}
            </div>

            <form onSubmit={handleRechargeSubmit} className="space-y-4">
              {/* Row 1: Inputs & Submit button */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">{lang === 'en' ? 'Tk' : '৳'}</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(e.target.value)}
                    placeholder={lang === 'en' ? 'Amount' : '৳ পরিমাণ'}
                    className="w-full pl-8 pr-3 py-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 rounded-xl text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">{lang === 'en' ? 'Tk' : '৳'}</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={rechargeProfit}
                    onChange={(e) => setRechargeProfit(e.target.value)}
                    placeholder={lang === 'en' ? 'Commission / Profit' : '৳ কমিশন/লাভ'}
                    className="w-full pl-8 pr-3 py-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 rounded-xl text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <button
                  type="submit"
                  className="py-2.5 px-4 bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-700 hover:to-emerald-700 text-white font-bold rounded-xl text-sm transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{lang === 'en' ? 'Confirm Recharge' : 'রিচার্জ নিশ্চিত করুন'}</span>
                </button>
              </div>

              {/* Row 2: 4 Configurable Recharge Source Slots */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <span>⚡ {lang === 'en' ? 'Select Deduction Source (4 Slots):' : 'কোন অ্যাকাউন্ট থেকে টাকা কাটবে নির্বাচন করুন (৪টি স্লট):'}</span>
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {lang === 'en' ? 'Tap ✕ to change option' : '✕ চাপলে অপশন পরিবর্তন হবে'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {rechargeSlots.map((walletKey, index) => {
                    const isSelected = selectedSlotIndex === index && walletKey !== null;
                    const wallet = walletKey ? dayData?.wallets?.[walletKey] : null;
                    const label = walletKey ? (wallet?.label || getWalletLabel(walletKey, lang, wallet)) : null;
                    const bal = wallet?.current || 0;
                    const colors = walletKey ? getCustomWalletColor(walletKey, activeDashWalletKeys, wallet) : null;
                    const icon = colors?.icon || '📲';

                    if (!walletKey) {
                      return (
                        <button
                          key={`empty-slot-${index}`}
                          type="button"
                          onClick={() => setPickingSlotIndex(index)}
                          className="p-3 border-2 border-dashed border-sky-300 dark:border-sky-800 hover:border-sky-500 rounded-xl bg-sky-50/30 dark:bg-sky-950/20 hover:bg-sky-100/50 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer group min-h-[76px]"
                        >
                          <Plus className="w-4 h-4 text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform" />
                          <span className="text-xs font-bold text-sky-700 dark:text-sky-300">
                            {lang === 'en' ? `+ Set Slot ${index + 1}` : `+ স্লট ${index + 1} বাছুন`}
                          </span>
                        </button>
                      );
                    }

                    return (
                      <div
                        key={`slot-${index}-${walletKey}`}
                        onClick={() => setSelectedSlotIndex(index)}
                        className={`relative p-3 rounded-xl border transition-all cursor-pointer select-none text-left flex flex-col justify-between min-h-[76px] ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-500 ring-2 ring-sky-500 shadow-md scale-[1.02]'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-sky-300 hover:bg-sky-50/20 shadow-2xs'
                        }`}
                      >
                        {/* Cut / Remove button at top-right corner */}
                        <button
                          type="button"
                          onClick={(e) => handleClearSlot(e, index)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center shadow-md transition-all cursor-pointer z-10"
                          title={lang === 'en' ? 'Remove or change this slot' : 'এই স্লট থেকে ওয়ালেটটি সরান বা পরিবর্তন করুন'}
                        >
                          <X className="w-3 h-3" />
                        </button>

                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                          <span className="text-base shrink-0">{icon}</span>
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {label}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-xs font-black text-sky-700 dark:text-sky-400">
                            {formatBDT(bal, lang)}
                          </span>
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {rechargeError && (
                <p className="text-xs text-rose-600 dark:text-rose-400 font-bold bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-xl border border-rose-200 dark:border-rose-900/50">
                  ⚠️ {rechargeError}
                </p>
              )}
              {rechargeSuccess && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
                  {rechargeSuccess}
                </p>
              )}
            </form>

            {/* Modal to pick which wallet to assign to a slot */}
            {pickingSlotIndex !== null && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-sky-600" />
                      {lang === 'en' ? `Choose Wallet for Slot ${pickingSlotIndex + 1}` : `স্লট ${pickingSlotIndex + 1}-এর জন্য ওয়ালেট বাছুন`}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setPickingSlotIndex(null)}
                      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'en'
                      ? 'Select which wallet or account will supply recharge from this button:'
                      : 'রিচার্জের টাকা কোন অ্যাকাউন্ট বা সিম থেকে কাটা হবে তা নির্বাচন করুন:'}
                  </p>

                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {activeDashWalletKeys.map((key) => {
                      const wallet = dayData?.wallets?.[key];
                      const label = wallet?.label || getWalletLabel(key, lang, wallet);
                      const bal = wallet?.current || 0;
                      const colors = getCustomWalletColor(key, activeDashWalletKeys, wallet);
                      const icon = colors?.icon || '💰';
                      const isAlreadyInSlot = rechargeSlots.includes(key);

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleAssignWalletToSlot(key)}
                          className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-sky-500 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 flex items-center justify-between text-left transition-colors cursor-pointer group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg">{icon}</span>
                            <div>
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate">
                                {label}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {formatBDT(bal, lang)}
                              </span>
                            </div>
                          </div>
                          {isAlreadyInSlot && (
                            <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold px-1.5 py-0.5 rounded">
                              {lang === 'en' ? 'In Slot' : 'যুক্ত আছে'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setPickingSlotIndex(null)}
                      className="px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                    >
                      {lang === 'en' ? 'Cancel' : 'বাতিল'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 6. Stock & Inventory Hub with -1, +5, +10 */}
        <section className="bg-white rounded-2xl shadow-md border border-emerald-100 overflow-hidden">
          <div className="p-4 bg-emerald-50/70 border-b border-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-emerald-800 flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-emerald-600" />
                {t('stock_inventory_title', lang)}
              </h2>
              <p className="text-xs text-emerald-700">{t('gen_stock_desc', lang)}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsDamageModalOpen(true)}
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                title={lang === 'en' ? 'Write-off Damaged/Lost Products' : 'নষ্ট বা ক্ষয়ক্ষতি পণ্য বাদ দিন'}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {lang === 'en' ? 'Damage Write-off' : 'নষ্ট পণ্য বাদ দিন'}
              </button>

              <button
                type="button"
                onClick={() => setIsStockAuditOpen(true)}
                className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                title={lang === 'en' ? 'Physical Stock Audit & Count (IAS 2)' : 'শারীরিক স্টক অডিট ও গণনা'}
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                {lang === 'en' ? 'Stock Audit' : 'স্টক অডিট'}
              </button>

              <button
                type="button"
                onClick={() => setIsPurchaseStockOpen(true)}
                className="px-3.5 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                title={lang === 'en' ? 'Purchase stock with cash' : 'নগদ টাকায় নতুন স্টক ক্রয় করুন'}
              >
                <Package className="w-3.5 h-3.5" />
                {lang === 'en' ? '+ Buy Stock' : '+ স্টক ক্রয়'}
              </button>

              <button
                type="button"
                onClick={() => setIsAddProductOpen(true)}
                className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> {t('add_new_product_btn', lang)}
              </button>
              <span className="bg-emerald-100 text-emerald-900 px-3 py-1.5 rounded-xl font-bold text-xs">
                {lang === 'en' ? 'Sales: ' : 'বিক্রি: '}{formatBDT(aggregated.stockSalesRevenue, lang)}
              </span>
            </div>
          </div>

          {/* Search Box */}
          <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_product_placeholder', lang)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-xs text-gray-500 hover:text-gray-700 px-2">
                {lang === 'en' ? 'Clear' : 'মুছুন'}
              </button>
            )}
          </div>

          {/* Product Items List with -1, +5, +10 */}
          <div className="p-4">
            {inventoryList.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                {t('no_products_found', lang)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {inventoryList.map((item) => {
                  const currentAvailable = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
                  const soldUnits = (dayData?.transactions || [])
                    .filter(t => t.type === 'stock_sale' && t.itemId === item.id && !t.reversed && !t.isReversal)
                    .reduce((s, t) => s + (Number(t.quantity) || 0), 0);
                  const damagedUnits = (dayData?.transactions || [])
                    .filter(t => (t.type === 'stock_damage' || t.type === 'damage_loss') && t.itemId === item.id && !t.reversed && !t.isReversal)
                    .reduce((s, t) => s + (Number(t.quantity) || 0), 0);

                  let currentStock = item.closingStock !== undefined && item.closingStock !== null ? item.closingStock : currentAvailable;
                  if (currentStock === 0 && currentAvailable > 0 && soldUnits === 0 && damagedUnits === 0) {
                    currentStock = currentAvailable;
                  }
                  const isOutOfStock = currentStock <= 0;

                  return (
                    <div key={item.id} className="p-3.5 rounded-xl border border-gray-200 bg-white shadow-xs space-y-2.5">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-bold text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-500">
                            {formatBDT(item.sellPrice, lang)} / {translateUnit(item.unit, lang)}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          isOutOfStock ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {currentStock} {translateUnit(item.unit, lang)}
                        </span>
                      </div>

                      {/* Touch Friendly Action Buttons */}
                      <div className="grid grid-cols-3 gap-1.5 pt-1">
                        <button
                          onClick={() => handleQuickSell(item.id, 1)}
                          disabled={isOutOfStock}
                          className="py-2 px-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer text-center"
                        >
                          {lang === 'en' ? 'Sell -1' : 'বিক্রি -১'}
                        </button>
                        <button
                          onClick={() => handleQuickRestock(item.id, 5)}
                          className="py-2 px-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer text-center"
                        >
                          {lang === 'en' ? '+5' : '+৫'}
                        </button>
                        <button
                          onClick={() => handleQuickRestock(item.id, 10)}
                          className="py-2 px-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer text-center"
                        >
                          {lang === 'en' ? '+10' : '+১০'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 7. Daily Quick Actions Grid */}
        <section className="bg-white p-4 rounded-2xl shadow-md space-y-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
            {t('daily_quick_entry_title', lang)}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => setActiveModal('expense')}
              className="flex flex-col items-center justify-center p-4 bg-rose-50/60 border border-rose-200 hover:border-rose-400 rounded-2xl transition-all cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center mb-1.5">
                <MinusCircle className="w-5 h-5" />
              </div>
              <span className="font-bold text-xs text-gray-800">{t('shop_expense_btn', lang)}</span>
              <span className="text-xs text-gray-500">{t('tea_snacks_rent_desc', lang)}</span>
            </button>
            <button
              onClick={() => setActiveModal('loan')}
              className="flex flex-col items-center justify-center p-4 bg-slate-50/60 border border-slate-200 hover:border-slate-400 rounded-2xl transition-all cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center mb-1.5">
                <Handshake className="w-5 h-5" />
              </div>
              <span className="font-bold text-xs text-gray-800">{t('due_debt_btn', lang)}</span>
              <span className="text-xs text-gray-500">{t('receivable_payable_desc', lang)}</span>
            </button>
            <button
              onClick={() => setIsPurchaseStockOpen(true)}
              className="flex flex-col items-center justify-center p-4 bg-sky-50/60 border border-slate-300 hover:border-sky-400 rounded-2xl transition-all cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center mb-1.5">
                <Package className="w-5 h-5" />
              </div>
              <span className="font-bold text-xs text-gray-800">{t('new_product_btn', lang)}</span>
              <span className="text-xs text-gray-500">{t('unit_price_desc', lang)}</span>
            </button>
            <button
              onClick={() => setActiveModal('cashbox_report')}
              className="flex flex-col items-center justify-center p-4 bg-emerald-50/60 border border-emerald-200 hover:border-emerald-400 rounded-2xl transition-all cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-1.5">
                <FileText className="w-5 h-5" />
              </div>
              <span className="font-bold text-xs text-gray-800">{t('cashbox_report_btn', lang)}</span>
              <span className="text-xs text-emerald-600 font-semibold">{t('got_vs_given_desc', lang)}</span>
            </button>
          </div>
        </section>

        {/* 8. Today's Transactions Feed */}
        <section className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <span>📋</span> {t('today_tx_ledger_title', lang)}
            </h2>
            <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
              {transactions.length} {t('count_suffix', lang)}
            </span>
          </div>
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {transactions.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                {t('no_tx_today', lang)}
              </div>
            ) : (
              [...transactions].reverse().map((tx) => (
                <div key={tx.id} className="p-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TX_BADGE_COLORS[tx.type] || 'bg-gray-100 text-gray-700'}`}>
                      {getTxLabel(tx.type, lang)}
                    </span>
                    <span className="text-xs text-gray-600 font-medium">
                      {tx.note || (tx.customerName ? `${t('customer_prefix', lang)} ${tx.customerName}` : '-')}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="font-black text-sm">
                    <span className={['expense', 'personal_draw', 'owner_took', 'loan_given', 'loan_repaid', 'stock_purchase'].includes(tx.type) ? 'text-rose-600' : 'text-emerald-600'}>
                      {['expense', 'personal_draw', 'owner_took', 'loan_given', 'loan_repaid', 'stock_purchase'].includes(tx.type) ? '-' : '+'}
                      {formatBDTWithPrivacy(tx.amount, isPrivacyMode, lang)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* 9. Quick Navigation to Closing */}
        <div className="flex justify-end pt-2">
          <button
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: 'closing' })}
            className="px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-sm font-bold flex items-center gap-2 shadow-lg transition-all cursor-pointer"
          >
            <span>🌙</span> {t('go_to_closing_btn', lang)} <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {renderSharedModals()}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════
  // 🚀 ADVANCED MODE: ENTERPRISE FINANCIAL COMMAND CENTER (IFRS/GAAP)
  // ═════════════════════════════════════════════════════════════════
  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16 font-sans">
      
      {/* ⚠️ Unexported Previous Day Warning Banner */}
      {unexportedDay && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-600 rounded-2xl p-4 space-y-3 shadow-md animate-in fade-in slide-in-from-top duration-300">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                {lang === 'en' ? '⚠️ Previous Day Data Not Exported!' : '⚠️ আগের দিনের ডাটা Google Sheets-এ Export হয়নি!'}
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                {lang === 'en' 
                  ? `Day ${unexportedDay.dateKey} was finalized but not exported to Google Sheets. Click below to export now.`
                  : `${unexportedDay.dateKey} তারিখের দিন ফাইনালাইজ হয়েছে কিন্তু Google Sheets-এ যায়নি। নিচে ক্লিক করে এখনই এক্সপোর্ট করুন।`
                }
              </p>
            </div>
          </div>
          
          {bannerResult ? (
            <div className={`p-3 rounded-xl text-xs font-medium border ${
              bannerResult.success 
                ? 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700'
                : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700'
            }`}>
              <p>{bannerResult.message}</p>
              {bannerResult.url && (
                <a href={bannerResult.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-sky-600 dark:text-sky-400 underline text-xs font-bold">
                  {lang === 'en' ? '🔗 View in Google Sheets →' : '🔗 Google Sheets-এ দেখুন →'}
                </a>
              )}
            </div>
          ) : (
            <button
              onClick={handleBannerExport}
              disabled={bannerExporting}
              className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-800 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-sm transition-all"
            >
              {bannerExporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{lang === 'en' ? 'Exporting...' : 'এক্সপোর্ট হচ্ছে...'}</span>
                </>
              ) : (
                <span>{lang === 'en' ? '📊 Export Previous Day to Google Sheets Now' : '📊 আগের দিনের ডাটা এখনই Google Sheets-এ পাঠান'}</span>
              )}
            </button>
          )}
        </div>
      )}

      {/* 1. Executive Header Banner */}
      <section className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40 shrink-0">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-black text-white">
                  {lang === 'en' ? 'Advanced Dashboard' : 'এন্টারপ্রাইজ ফাইন্যান্সিয়াল কমান্ড সেন্টার'}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Pro
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {lang === 'en' 
                  ? 'Business Health Check, AI Advisor & Cash Flow Forecast' 
                  : 'আন্তর্জাতিক আর্থিক অডিট, এআই ভার্চুয়াল সিএফও ও ৩০ দিনের তারল্য পূর্বাভাস'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Demo Data Mode Pill */}
            <button
              onClick={onToggleDemoMode}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
                isDemoMode
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400/40 hover:bg-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/30'
              }`}
              title={isDemoMode ? 'Click to switch to Live Store Data' : 'Click to preview rich Demo Analytics'}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isDemoMode ? (lang === 'en' ? 'DEMO PREVIEW' : 'ডেমো প্রিভিউ') : (lang === 'en' ? 'LIVE DATA' : 'লাইভ ডেটা')}</span>
            </button>

            {/* Audit Trail Modal Trigger */}
            {isOwner && (
              <button
                onClick={() => setShowAuditLog(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
                title="System Audit Trail"
              >
                <Shield className="w-3.5 h-3.5 text-sky-400" />
                <span>{lang === 'en' ? 'Audit Trail' : 'অডিট লগ'}</span>
              </button>
            )}

            {/* Quick Tutorial Trigger */}
            <button
              onClick={() => setActiveModal('tutorial')}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600/30 to-emerald-600/30 text-emerald-300 hover:text-white border border-emerald-500/40 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Academy Guide"
            >
              <GraduationCap className="w-3.5 h-3.5 text-emerald-400" />
              <span>{lang === 'en' ? 'Academy' : 'একাডেমি'}</span>
            </button>
          </div>
        </div>

        {/* 6 Executive Tab Selector */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto">
          <button
            onClick={() => setDashboardTab('cfo')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              dashboardTab === 'cfo'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>{lang === 'en' ? 'Virtual CFO & Scorecard' : 'ভার্চুয়াল সিএফও ও স্কোরকার্ড'}</span>
          </button>
          <button
            onClick={() => setDashboardTab('cashflow')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              dashboardTab === 'cashflow'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LineChart className="w-3.5 h-3.5 text-emerald-400" />
            <span>{lang === 'en' ? 'Cash Flow Waterfall' : 'ক্যাশ ফ্লো ওয়াটারফল'}</span>
          </button>
          <button
            onClick={() => setDashboardTab('scorecard')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              dashboardTab === 'scorecard'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <PieChart className="w-3.5 h-3.5 text-sky-400" />
            <span>{lang === 'en' ? '14 Financial KPIs' : '১৪টি আর্থিক অনুপাত'}</span>
          </button>
          <button
            onClick={() => setDashboardTab('pipeline')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              dashboardTab === 'pipeline'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5 text-sky-400" />
            <span>{lang === 'en' ? 'Operations Pipeline' : 'অপারেশনস পাইপলাইন'}</span>
          </button>
          <button
            onClick={() => setDashboardTab('treasury')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              dashboardTab === 'treasury'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Landmark className="w-3.5 h-3.5 text-amber-400" />
            <span>{lang === 'en' ? 'Multi-Account Treasury' : 'ট্রেজারি ও মূলধন'}</span>
          </button>
          <button
            onClick={() => setDashboardTab('compliance')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              dashboardTab === 'compliance'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
            <span>{lang === 'en' ? 'IFRS & Audit Suite' : 'আইএফআরএস ও কমপ্লায়েন্স'}</span>
          </button>
        </div>
      </section>

      {/* 2. Executive Tab Viewports */}
      
      {/* Tab: CFO & Scorecard */}
      {dashboardTab === 'cfo' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <VirtualCFOCommentary state={state} isDemoMode={isDemoMode} lang={lang} />
          <BusinessHealthScorecard state={state} isDemoMode={isDemoMode} lang={lang} />
        </div>
      )}

      {/* Tab: Cash Flow Waterfall */}
      {dashboardTab === 'cashflow' && (
        <div className="animate-in fade-in duration-200">
          <CashFlowManager state={state} isDemoMode={isDemoMode} lang={lang} />
        </div>
      )}

      {/* Tab: 14 Financial KPIs Deep Dive */}
      {dashboardTab === 'scorecard' && (
        <div className="animate-in fade-in duration-200">
          <BusinessHealthScorecard state={state} isDemoMode={isDemoMode} lang={lang} />
        </div>
      )}

      {/* Tab: Operations & Payables Pipeline */}
      {dashboardTab === 'pipeline' && (
        <div className="animate-in fade-in duration-200">
          <OperationsPipeline state={state} isDemoMode={isDemoMode} lang={lang} />
        </div>
      )}

      {/* Tab: Multi-Account Treasury */}
      {dashboardTab === 'treasury' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Treasury Balances Cards */}
          <section className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Landmark className="w-5 h-5 text-amber-400" />
                <span>{lang === 'en' ? 'Treasury & Liquidity Accounts' : 'ট্রেজারি ও তারল্য হিসাব'}</span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowRecurring(true)}
                  className="relative px-2.5 py-1 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                  title={lang === 'en' ? 'Recurring Monthly Expenses' : 'মাসিক নির্ধারিত খরচ'}
                >
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                  <span>{lang === 'en' ? 'Monthly Expenses' : 'মাসিক খরচ'}</span>
                  {pendingRecurringCount > 0 && (
                    <span className="w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                      {pendingRecurringCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('cashbox_report')}
                  className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                  title={lang === 'en' ? 'Daily Cash Summary Report' : 'দৈনিক ক্যাশ সামারি রিপোর্ট'}
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{lang === 'en' ? 'Cash Summary' : 'ক্যাশ সামারি'}</span>
                </button>
                <button
                  onClick={() => dispatch({ type: 'TOGGLE_PRIVACY_MODE' })}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                    isPrivacyMode
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                  }`}
                >
                  {isPrivacyMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{isPrivacyMode ? t('privacy_on', lang) : t('privacy_off', lang)}</span>
                </button>
                <button
                  onClick={() => setActiveModal('transfer')}
                  className="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Transfer Funds' : 'তহবিল স্থানান্তর'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Hand Cash Drawer */}
              <div className="p-4 bg-slate-800/90 border border-slate-700/80 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span className="flex items-center gap-1.5">💵 {t('cash_drawer_title', lang)}</span>
                    <span className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-1.5 py-0.2 rounded font-mono">DRAWER</span>
                  </div>
                  <div className="text-2xl font-black text-emerald-400 mt-2">
                    {formatBDTWithPrivacy(currentHandCash, isPrivacyMode, lang)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {lang === 'en' ? 'Opening: ' : 'শুরুর ব্যালেন্স: '}{formatBDTWithPrivacy(openingHandCash, isPrivacyMode, lang)}
                  </p>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-700/60 flex items-center gap-2">
                  <button
                    onClick={() => setActiveModal('cashbox_report')}
                    className="flex-1 py-1 px-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 rounded-lg text-xs font-bold text-center transition-all cursor-pointer"
                  >
                    {t('cashbox_report_btn', lang)}
                  </button>
                  <button
                    onClick={() => setActiveModal('owner')}
                    className="py-1 px-2 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    {t('owner_btn', lang)}
                  </button>
                </div>
              </div>

              {/* Bank Account */}
              <div className="p-4 bg-slate-800/90 border border-slate-700/80 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span className="flex items-center gap-1.5">🏦 {t('bank_account_title', lang)}</span>
                    <span className="text-xs bg-sky-500/20 text-sky-300 border border-sky-400/30 px-1.5 py-0.2 rounded font-mono">BANK</span>
                  </div>
                  <div className="text-2xl font-black text-sky-400 mt-2">
                    {formatBDTWithPrivacy(dayData?.wallets?.bank_account?.current || 0, isPrivacyMode, lang)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {lang === 'en' ? 'Opening: ' : 'শুরুর ব্যালেন্স: '}{formatBDTWithPrivacy(dayData?.wallets?.bank_account?.opening || 0, isPrivacyMode, lang)}
                  </p>
                </div>
                <button
                  onClick={() => setActiveModal('bank_reconcile')}
                  className="mt-3 py-1 px-2 bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/40 rounded-lg text-xs font-bold text-center transition-all cursor-pointer"
                >
                  {lang === 'en' ? 'Reconcile Statement' : 'স্টেটমেন্ট রিকনসিল'}
                </button>
              </div>

              {/* Digital Payment Channels */}
              <div className="p-4 bg-slate-800/90 border border-slate-700/80 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span className="flex items-center gap-1.5">📱 {t('digital_payment_title', lang)}</span>
                    <span className="text-xs bg-pink-500/20 text-pink-300 border border-pink-400/30 px-1.5 py-0.2 rounded font-mono">MFS</span>
                  </div>
                  <div className="text-2xl font-black text-pink-400 mt-2">
                    {formatBDTWithPrivacy(dayData?.wallets?.digital_payment?.current || 0, isPrivacyMode, lang)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {lang === 'en' ? 'Opening: ' : 'শুরুর ব্যালেন্স: '}{formatBDTWithPrivacy(dayData?.wallets?.digital_payment?.opening || 0, isPrivacyMode, lang)}
                  </p>
                </div>
                <div className="mt-3 text-xs text-slate-400">
                  {lang === 'en' ? 'bKash / Nagad / Rocket' : 'বিকাশ / নগদ / রকেট গেটওয়ে'}
                </div>
              </div>

              {/* Capital & Injections */}
              <div className="p-4 bg-slate-800/90 border border-slate-700/80 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span className="flex items-center gap-1.5">👤 {lang === 'en' ? 'Owner Equity' : 'মালিকের মূলধন'}</span>
                    <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.2 rounded font-mono">EQUITY</span>
                  </div>
                  <div className="text-2xl font-black text-amber-400 mt-2">
                    +{formatBDTWithPrivacy(aggregated.ownerGave, isPrivacyMode, lang)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {lang === 'en' ? 'Drawings: ' : 'উত্তোলন: '}-{formatBDTWithPrivacy((aggregated.ownerTook || 0) + (aggregated.personalDraw || 0), isPrivacyMode, lang)}
                  </p>
                </div>
                <button
                  onClick={() => setActiveModal('owner')}
                  className="mt-3 py-1 px-2 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-bold text-center transition-all cursor-pointer"
                >
                  {lang === 'en' ? 'Capital Injections & Draws' : 'মূলধন ও ব্যক্তিগত খরচ'}
                </button>
              </div>
            </div>
          </section>

          {/* Cash Flow Reconciliation & Mathematical Audit Equation */}
          <section className="bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 text-white p-5 rounded-2xl shadow-xl border border-slate-700/80 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/70 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-400 flex items-center justify-center font-bold">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    {t('acc_audit_title', lang)}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {t('acc_audit_desc', lang)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <RoleGuard role="owner">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                    isCashPerfect 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {isCashPerfect ? t('cash_perfect_match', lang) : `${t('cash_diff_label', lang)} ${formatBDT(cashDiscrepancy, lang)}`}
                  </span>
                </RoleGuard>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-800/80 rounded-xl border border-slate-700/60 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                    💵 {t('cash_in_hand_title', lang)}
                  </span>
                  <div className="text-2xl sm:text-3xl font-black text-emerald-400 mt-1">
                    {formatBDTWithPrivacy(currentHandCash, isPrivacyMode, lang)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {t('cash_in_hand_desc', lang)}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-xl font-bold">
                  ৳
                </div>
              </div>

              <RoleGuard role="owner">
                <div className="p-4 bg-slate-800/80 rounded-xl border border-slate-700/60 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                      📈 {t('operating_profit_title', lang)}
                    </span>
                    <div className={`text-2xl sm:text-3xl font-black mt-1 ${
                      todayNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {formatBDTWithPrivacy(todayNetProfit, isPrivacyMode, lang)}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {t('total_income_profit', lang)} ({formatBDT(todayGrossProfit, lang)}) - {t('expense_label2', lang)} ({formatBDT(aggregated.expenses, lang)})
                    </p>
                  </div>
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold border ${
                    todayNetProfit >= 0 
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                      : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  }`}>
                    <TrendingUp className="w-6 h-6" />
                  </div>
                </div>
              </RoleGuard>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap text-slate-300 font-mono text-[11px] sm:text-xs">
                <span className="text-slate-400 font-sans font-bold">{t('auto_tally_eq', lang)}</span>
                <span>{t('opening_cash_eq', lang)} ({formatBDT(openingHandCash, lang)})</span>
                <span className="text-emerald-400 font-bold">+</span>
                <span className="text-emerald-300">{t('cash_in_eq', lang)} ({formatBDT(cashIn, lang)})</span>
                <span className="text-rose-400 font-bold">-</span>
                <span className="text-rose-300">{t('cash_out_eq', lang)} ({formatBDT(cashOut, lang)})</span>
                <span className="text-amber-400 font-bold">=</span>
                <span className="text-white font-bold bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                  {lang === 'en' ? 'Expected in Drawer: ' : 'ড্রয়ারে থাকার কথা '}{formatBDT(expectedHandCash, lang)}
                </span>
              </div>
              <button
                onClick={() => setActiveModal('cashbox_report')}
                className="text-[11px] text-amber-400 hover:text-amber-300 font-bold underline flex items-center gap-1 cursor-pointer"
              >
                {t('view_full_report', lang)}
              </button>
            </div>
          </section>

          {/* Running Summary Cards */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-md">
              <p className="text-xs text-slate-400 font-medium">{t('today_total_expense', lang)}</p>
              <p className="text-xl font-bold text-rose-400 mt-1">{formatBDTWithPrivacy(aggregated.expenses, isPrivacyMode, lang)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-md">
              <p className="text-xs text-slate-400 font-medium">{t('owner_cash_in', lang)}</p>
              <p className="text-xl font-bold text-emerald-400 mt-1">+{formatBDTWithPrivacy(aggregated.ownerGave, isPrivacyMode, lang)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-md">
              <p className="text-xs text-slate-400 font-medium">{t('owner_cash_out', lang)}</p>
              <p className="text-xl font-bold text-amber-400 mt-1">-{formatBDTWithPrivacy((aggregated.ownerTook || 0) + (aggregated.personalDraw || 0), isPrivacyMode, lang)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-md">
              <p className="text-xs text-slate-400 font-medium">{lang === 'en' ? 'Stock Sales Revenue' : 'পণ্য বিক্রি রাজস্ব'}</p>
              <p className="text-xl font-bold text-sky-400 mt-1">{formatBDTWithPrivacy(aggregated.stockSalesRevenue, isPrivacyMode, lang)}</p>
            </div>
          </section>
        </div>
      )}

      {/* Tab: Compliance & IFRS Suite */}
      {dashboardTab === 'compliance' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <section className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-900 rounded-2xl p-5 text-white shadow-xl border border-sky-500/20 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🏛️</span>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    {lang === 'en' ? 'International Accounting & Audit Toolkit' : 'আন্তর্জাতিক অ্যাকাউন্টিং ও অডিট টুলকিট'}
                    <span className="text-xs bg-sky-500/30 text-sky-300 border border-sky-400/30 px-2 py-0.5 rounded-full font-semibold">
                      Advanced Tools
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {lang === 'en' ? 'Manual journal vouchers, FY period lock, bank reconciliation, fixed assets, audits & payroll' : 'জার্নাল ভাউচার, অর্থবছর সমাপনী ও লক, ব্যাংক রিকনসিল, স্থায়ী সম্পদ, অডিট ও পেরোল'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal('tutorial')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-600 text-white font-bold text-xs shadow-md transition-all cursor-pointer w-fit"
              >
                <GraduationCap className="w-4 h-4" />
                <span>{lang === 'en' ? '🎓 Academy & Guide (F4)' : '🎓 টিউটোরিয়াল একাডেমি (F4)'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <button
                onClick={() => setActiveModal('bank_reconcile')}
                className="flex items-center gap-2.5 p-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-all text-left group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
                  <Landmark className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{lang === 'en' ? 'Bank Reconcile' : 'ব্যাংক রিকনসিল'}</p>
                  <p className="text-xs text-slate-400 truncate">{lang === 'en' ? 'Statement Match' : 'স্টেটমেন্ট চেক'}</p>
                </div>
              </button>

              <button
                onClick={() => setActiveModal('fixed_assets')}
                className="flex items-center gap-2.5 p-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-all text-left group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{lang === 'en' ? 'Fixed Assets' : 'স্থায়ী সম্পদ'}</p>
                  <p className="text-xs text-slate-400 truncate">{lang === 'en' ? 'IAS 16 Depreciation' : 'অবচয় হিসাব'}</p>
                </div>
              </button>

              <button
                onClick={() => setActiveModal('stock_audit')}
                className="flex items-center gap-2.5 p-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-all text-left group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
                  <ClipboardCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{lang === 'en' ? 'Stock Audit' : 'স্টক অডিট'}</p>
                  <p className="text-xs text-slate-400 truncate">{lang === 'en' ? 'Physical Count' : 'শারীরিক গণনা'}</p>
                </div>
              </button>

              <button
                onClick={() => setActiveModal('payroll')}
                className="flex items-center gap-2.5 p-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-all text-left group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-500/20 text-slate-300 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{lang === 'en' ? 'Payroll & Staff' : 'বেতন ও কর্মচারী'}</p>
                  <p className="text-xs text-slate-400 truncate">{lang === 'en' ? 'Slips & Booking' : 'পে-স্লিপ ভাউচার'}</p>
                </div>
              </button>

              <button
                onClick={() => setActiveModal('manual_journal')}
                className="flex items-center gap-2.5 p-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-all text-left group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{lang === 'en' ? 'Manual Journal' : 'ম্যানুয়াল জার্নাল'}</p>
                  <p className="text-xs text-slate-400 truncate">{lang === 'en' ? 'Dr/Cr Voucher' : 'ভাউচার এন্ট্রি'}</p>
                </div>
              </button>

              <button
                onClick={() => setActiveModal('fiscal_close')}
                className="flex items-center gap-2.5 p-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-all text-left group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-300 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{lang === 'en' ? 'Fiscal Close' : 'অর্থবছর ক্লোজ'}</p>
                  <p className="text-xs text-slate-400 truncate">{lang === 'en' ? 'Period Lock' : 'হিসাব সমাপনী'}</p>
                </div>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* 3. Enterprise General Ledger & Audit Feed */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              <span>{lang === 'en' ? 'General Ledger Audit Feed' : 'জেনারেল লেজার ও লেনদেন অডিট ফিড'}</span>
            </h2>
            <p className="text-xs text-slate-400">
              {lang === 'en' ? 'Chronological record with real-time audit tags, transfer paths & reverse mechanism' : 'ধারাবাহিক হিসাব বিবরণী, রিভার্সাল অডিট এবং ডেবিট/ক্রেডিট প্রবাহ'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && transactions.length > 0 && (
              <button
                onClick={() => {
                  setIsBulkTxMode(!isBulkTxMode);
                  setSelectedTxIds([]);
                }}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                  isBulkTxMode ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:text-white border border-slate-700'
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>{isBulkTxMode ? (lang === 'en' ? 'Done' : 'সম্পন্ন') : (lang === 'en' ? 'Bulk Select' : 'বাল্ক নির্বাচন')}</span>
              </button>
            )}
            <span className="text-xs bg-slate-800 text-slate-300 font-semibold px-2.5 py-1 rounded-full border border-slate-700">
              {transactions.length} {lang === 'en' ? 'entries' : 'টি এন্ট্রি'}
            </span>
          </div>
        </div>

        {/* Bulk Action Ribbon */}
        {isBulkTxMode && (
          <div className="px-4 py-2.5 bg-sky-950/60 border-b border-sky-900/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const activeTxs = transactions.filter(tx => !tx.reversed && !tx.isReversal);
                  if (selectedTxIds.length === activeTxs.length) {
                    setSelectedTxIds([]);
                  } else {
                    setSelectedTxIds(activeTxs.map(tx => tx.id));
                  }
                }}
                className="font-bold text-sky-300 flex items-center gap-1.5 hover:underline cursor-pointer"
              >
                {selectedTxIds.length > 0 && selectedTxIds.length === transactions.filter(tx => !tx.reversed && !tx.isReversal).length ? (
                  <CheckSquare className="w-4 h-4 text-sky-400" />
                ) : (
                  <Square className="w-4 h-4 text-slate-500" />
                )}
                <span>{lang === 'en' ? 'Select All Active' : 'সব সক্রিয় নির্বাচন'}</span>
              </button>
              <span className="text-slate-400 font-medium">
                ({selectedTxIds.length} {lang === 'en' ? 'selected' : 'নির্বাচিত'})
              </span>
            </div>

            {selectedTxIds.length > 0 && (
              <button
                onClick={() => {
                  const confirmMsg = lang === 'en' 
                    ? `Are you sure you want to reverse ${selectedTxIds.length} transaction(s)?` 
                    : `${selectedTxIds.length} টি লেনদেন মুছে রিভার্স করতে চান?`;
                  if (window.confirm(confirmMsg)) {
                    dispatch({ type: 'BULK_DELETE_TRANSACTIONS', payload: { txIds: selectedTxIds } });
                  }
                }}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? `Reverse Selected (${selectedTxIds.length})` : `রিভার্স করুন (${selectedTxIds.length})`}</span>
              </button>
            )}
          </div>
        )}

        {/* Transactions Table */}
        <div className="divide-y divide-slate-800 max-h-[500px] overflow-y-auto">
          {transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              {t('no_tx_today', lang)}
            </div>
          ) : (
            [...transactions].reverse().map((tx) => (
              <div key={tx.id} className={`p-4 flex items-center justify-between hover:bg-slate-800/60 transition-colors ${selectedTxIds.includes(tx.id) ? 'bg-sky-950/40' : ''}`}>
                <div className="flex items-center gap-3">
                  {isBulkTxMode && !tx.reversed && !tx.isReversal && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTxIds(prev => 
                          prev.includes(tx.id) ? prev.filter(id => id !== tx.id) : [...prev, tx.id]
                        );
                      }}
                      className="text-sky-400 cursor-pointer shrink-0"
                    >
                      {selectedTxIds.includes(tx.id) ? (
                        <CheckSquare className="w-4 h-4 text-sky-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600" />
                      )}
                    </button>
                  )}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {tx.reversed && (
                        <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-bold">
                          ↩️ Reversed
                        </span>
                      )}
                      {tx.isReversal && (
                        <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-full font-bold">
                          ↩️ {lang === 'en' ? 'Reversal' : 'রিভার্সাল'}
                        </span>
                      )}
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${TX_BADGE_COLORS[tx.type] || 'bg-slate-800 text-slate-300'}`}>
                        {getTxLabel(tx.type, lang)}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className={`text-xs font-semibold text-slate-200 ${tx.reversed ? 'line-through opacity-40' : ''}`}>
                      {tx.note || (tx.customerName ? `${t('customer_prefix', lang)} ${tx.customerName}` : '-')}
                    </p>

                    {tx.type === 'fund_transfer' && (
                      <p className={`text-[11px] text-sky-400 font-mono ${tx.reversed ? 'line-through opacity-40' : ''}`}>
                        {getWalletLabel(tx.fromWallet, lang)} ➔ ${getWalletLabel(tx.toWallet, lang)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className={`text-right ${tx.reversed ? 'line-through opacity-40' : ''}`}>
                    <span className={`font-black text-sm sm:text-base font-mono ${
                      ['expense', 'personal_draw', 'owner_took', 'loan_given', 'loan_repaid', 'stock_purchase'].includes(tx.type)
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                    }`}>
                      {['expense', 'personal_draw', 'owner_took', 'loan_given', 'loan_repaid', 'stock_purchase'].includes(tx.type) ? '-' : '+'}
                      {formatBDTWithPrivacy(tx.amount, isPrivacyMode, lang)}
                    </span>

                    {tx.profit !== undefined && tx.profit !== null && tx.profit > 0 && (
                      <p className="text-xs text-emerald-400 font-bold">
                        {lang === 'en' ? 'Profit: +' : 'লাভ: +'}{formatBDTWithPrivacy(tx.profit, isPrivacyMode, lang)}
                      </p>
                    )}
                  </div>

                  {isOwner && !tx.reversed && !tx.isReversal && !isBulkTxMode && (
                    <button
                      onClick={() => {
                        const message = lang === 'en' ? 'Are you sure you want to reverse this transaction?' : 'এই লেনদেন রিভার্স করতে চান?';
                        if (window.confirm(message)) {
                          dispatch({ type: 'DELETE_TRANSACTION', payload: tx.id });
                        }
                      }}
                      className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors cursor-pointer"
                      title={lang === 'en' ? 'Reverse Transaction' : 'রিভার্স করুন'}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {renderSharedModals()}
    </div>
  );
}
