import React, { useRef, useState, useEffect, Suspense, lazy } from 'react';
import { useApp } from './context/AppContext';
import { getNextDayKey, getPrevDayKey, getTodayKey } from './data/storage';
import { formatBDT } from './data/calculations';
import { DAY_STATUS, SCREENS, BIZ_TYPES, BIZ_CATEGORIES, getBizCategoryName, FEATURE_META } from './data/constants';
import { t, getDayName, getTimeGreeting } from './data/translations';
import { ChevronDown, Plus, Check, Store, Building2, Eye, EyeOff, Sunrise, LayoutDashboard, BookOpen, Moon, Sun, Sparkles, Layers, Trash2, Clock, Settings, Globe, Calendar, ChevronLeft, ChevronRight, LogOut, BarChart3, Zap, Menu, X, Coffee, RefreshCw } from 'lucide-react';
import { useAppMode } from './components/Shared/ModeGuard';
import { useAuth } from './firebase/useAuth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase/firebaseConfig';
import { syncPublicStoreProducts, deleteBusinessFromCloud } from './firebase/firestoreService';
import LoginScreen from './components/Auth/LoginScreen';

import BusinessCategoryModal from './components/Shared/BusinessCategoryModal';
import LedgeroLogo from './components/Shared/LedgeroLogo';
import CurrencySwitcher from './components/Shared/CurrencySwitcher';
import KeyboardShortcutsModal from './components/Shared/KeyboardShortcutsModal';
import AdvancedMegaNavbar from './components/AdvancedNav/AdvancedMegaNavbar';
import GlobalQuickActionModal from './components/AdvancedNav/GlobalQuickActionModal';
import AIAgentFloatingButton from './components/AIAgent/AIAgentFloatingButton';
import { Keyboard, Landmark, ClipboardCheck, Users, GraduationCap, FileSpreadsheet, Lock, LineChart, Bot, Truck } from 'lucide-react';

// Lazy-loaded screens, AI drawer, and advanced accounting modals for smaller initial bundle
const OpeningScreen = lazy(() => import('./components/Opening/OpeningScreen'));
const DashboardScreen = lazy(() => import('./components/Dashboard/DashboardScreen'));
const KhataScreen = lazy(() => import('./components/Khata/KhataScreen'));
const ClosingScreen = lazy(() => import('./components/Closing/ClosingScreen'));
const ReportsScreen = lazy(() => import('./components/Reports/ReportsScreen'));
const AnalyticsHub = lazy(() => import('./components/Analytics/AnalyticsHub'));
const TeaHouseScreen = lazy(() => import('./components/TeaHouse/TeaHouseScreen'));
const OnlineOrdersScreen = lazy(() => import('./components/OnlineOrders/OnlineOrdersScreen'));
const AIAgentDrawer = lazy(() => import('./components/AIAgent/AIAgentDrawer'));
const ProfileModal = lazy(() => import('./components/Profile/ProfileModal'));
const StockAuditModal = lazy(() => import('./components/Inventory/StockAuditModal'));
const BankReconciliationModal = lazy(() => import('./components/Banking/BankReconciliationModal'));
const FixedAssetsModal = lazy(() => import('./components/Assets/FixedAssetsModal'));
const PayrollModal = lazy(() => import('./components/Payroll/PayrollModal'));
const ManualJournalModal = lazy(() => import('./components/Journal/ManualJournalModal'));
const FiscalYearCloseModal = lazy(() => import('./components/PeriodClose/FiscalYearCloseModal'));
const TutorialModal = lazy(() => import('./components/Tutorial/TutorialModal'));
const CashBoxReportModal = lazy(() => import('./components/Dashboard/CashBoxReportModal'));
const RecurringExpenseManager = lazy(() => import('./components/Dashboard/RecurringExpenseManager'));
const PublicStorefront = lazy(() => import('./components/PublicStore/PublicStorefront'));
const GoOnlineSetup = lazy(() => import('./components/PublicStore/GoOnlineSetup'));

// Public storefront detection — runs BEFORE App mounts (no hooks violation)
const isPublicStore = window.location.pathname.match(/^\/s\/([a-z0-9-]+)/i);

function App() {
  // If this is a public storefront URL, render only the storefront (no auth needed)
  if (isPublicStore) {
    return (
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-slate-50 text-slate-600 font-semibold">লোড হচ্ছে...</div>}>
        <PublicStorefront shopSlug={isPublicStore[1]} />
      </Suspense>
    );
  }

  const { state, dispatch, exportAllData, cloudSyncStatus, lastSyncError, retryCloudSync } = useApp();
  const syncStatus = cloudSyncStatus || state.cloudSyncStatus;
  const syncError = lastSyncError || state.lastSyncError;
  const isSyncProblem = syncStatus === 'error' || syncStatus === 'conflict' || state.cloudInitFailed;
  const { user, isAuthenticated, loading: authLoading, signOut } = useAuth();
  const fileInputRef = useRef(null);
  const dateInputRef = useRef(null);

  const [showBizModal, setShowBizModal] = useState(false);
  const [isCreatingBiz, setIsCreatingBiz] = useState(false);
  const [newBizName, setNewBizName] = useState('');
  const [newBizType, setNewBizType] = useState(BIZ_TYPES[0]);
  const [customBizType, setCustomBizType] = useState('');
  const [showCategoryPickerModal, setShowCategoryPickerModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showStockAuditModal, setShowStockAuditModal] = useState(false);
  const [showBankReconcileModal, setShowBankReconcileModal] = useState(false);
  const [showFixedAssetsModal, setShowFixedAssetsModal] = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [showManualJournalModal, setShowManualJournalModal] = useState(false);
  const [showFiscalCloseModal, setShowFiscalCloseModal] = useState(false);
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [showSideDrawer, setShowSideDrawer] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [showQuickActionModal, setShowQuickActionModal] = useState(false);
  const [showAIAgent, setShowAIAgent] = useState(false);
  const [analyticsInitialTab, setAnalyticsInitialTab] = useState('cfo');
  const [dashboardInitialTab, setDashboardInitialTab] = useState(null);
  const [showCashBoxReportModal, setShowCashBoxReportModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [showGoOnlineModal, setShowGoOnlineModal] = useState(false);
  const isAdvanced = state.appMode === 'advanced';
  const isEasy = !isAdvanced;

  // 🔄 Auto-Sync: Push inventory to online store in 450-op chunks with stale-state concurrency guard and bizId verification
  const storeSyncSeqRef = useRef(0);
  useEffect(() => {
    const activeBizId = state.activeBizId || state.activeBiz?.id || 'biz_1';
    const autoSyncEnabled = localStorage.getItem(`ledgero_auto_sync_${activeBizId}`) === 'true'
      || (localStorage.getItem('ledgero_auto_sync') === 'true' && localStorage.getItem(`ledgero_auto_sync_${activeBizId}`) === null);
    const storeSlug = localStorage.getItem(`ledgero_store_slug_${activeBizId}`)
      || localStorage.getItem('ledgero_store_slug');
    const inventory = state.dayData?.inventory;
    if (!autoSyncEnabled || !storeSlug || !Array.isArray(inventory)) return;

    const mySeq = ++storeSyncSeqRef.current;
    let cancelled = false;
    const shouldAbort = () => cancelled || mySeq !== storeSyncSeqRef.current;

    const timer = setTimeout(async () => {
      if (shouldAbort()) return;
      try {
        // Security & isolation guard: verify that the store slug actually belongs to activeBizId
        const storeRef = doc(db, 'stores', storeSlug);
        const storeSnap = await getDoc(storeRef);
        if (storeSnap.exists()) {
          const storeData = storeSnap.data();
          if (storeData.bizId && storeData.bizId !== activeBizId) {
            console.warn(`[AutoSync Guard] Aborting sync: store ${storeSlug} belongs to business ${storeData.bizId}, but active business is ${activeBizId}`);
            return;
          }
        }

        const result = await syncPublicStoreProducts(storeSlug, inventory, { shouldAbort });
        if (result.aborted || shouldAbort()) return;

        // Also update the store's updatedAt on both owner doc and public info doc
        const nowIso = new Date().toISOString();
        const publicInfoRef = doc(db, 'stores', storeSlug, 'public', 'info');
        await setDoc(storeRef, { updatedAt: nowIso }, { merge: true });
        await setDoc(publicInfoRef, { updatedAt: nowIso }, { merge: true });
      } catch (err) {
        console.error('Auto-sync error:', err);
      }
    }, 2000); // Debounce 2 seconds

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.dayData?.inventory, state.activeBizId]);

  // Mega-Navbar Screen/Modal Selector
  const handleMegaNavSelect = (key) => {
    switch (key) {
      case 'main_dashboard':
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
        break;
      case 'daily_cash':
        setShowCashBoxReportModal(true);
        break;
      case 'recurring_expenses':
        setShowRecurringModal(true);
        break;
      case 'multi_biz':
        setShowBizModal(true);
        break;
      case 'sales_pipeline':
        setAnalyticsInitialTab('pipeline');
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
        break;
      case 'invoices':
      case 'catalog':
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
        break;
      case 'customer_due':
      case 'supplier_due':
      case 'all_contacts':
      case 'customers':
      case 'suppliers':
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.KHATA });
        break;
      case 'bills_payables':
      case 'purchase_orders':
      case 'expense_claims':
        setAnalyticsInitialTab('pipeline');
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
        break;
      case 'cash_flow':
        setAnalyticsInitialTab('cashflow');
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
        break;
      case 'health_scorecards':
        setAnalyticsInitialTab('scorecard');
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
        break;
      case 'virtual_cfo':
        setAnalyticsInitialTab('cfo');
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
        break;
      case 'ai_agent':
        setShowAIAgent(true);
        break;
      case 'standard_reports':
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.REPORTS });
        break;
      case 'bank_rec':
        setShowBankReconcileModal(true);
        break;
      case 'manual_journal':
        setShowManualJournalModal(true);
        break;
      case 'fixed_assets':
        setShowFixedAssetsModal(true);
        break;
      case 'stock_audit':
        setShowStockAuditModal(true);
        break;
      case 'period_lock':
        setShowFiscalCloseModal(true);
        break;
      case 'payroll':
        setShowPayrollModal(true);
        break;
      case 'online_orders':
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ONLINE_ORDERS });
        break;
      default:
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
        break;
    }
  };

  // Quick Action Dispatcher
  const handleQuickAction = (actionId) => {
    switch (actionId) {
      case 'ai_agent':
        setShowAIAgent(true);
        break;
      case 'new_invoice':
      case 'new_expense':
      case 'transfer':
      case 'service_income':
      case 'capital_drawings':
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
        break;
      case 'add_contact':
      case 'open_ledger':
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.KHATA });
        break;
      case 'journal_voucher':
        setShowManualJournalModal(true);
        break;
      case 'bank_recon':
        setShowBankReconcileModal(true);
        break;
      case 'stock_audit':
        setShowStockAuditModal(true);
        break;
      case 'fixed_asset':
        setShowFixedAssetsModal(true);
        break;
      case 'payroll_slips':
        setShowPayrollModal(true);
        break;
      case 'period_lock':
        setShowFiscalCloseModal(true);
        break;
      case 'cashflow_forecast':
        setAnalyticsInitialTab('cashflow');
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
        break;
      case 'health_scorecard':
        setAnalyticsInitialTab('scorecard');
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
        break;
      case 'academy':
        setShowTutorialModal(true);
        break;
      default:
        break;
    }
  };

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        if (e.key === 'Escape') {
          document.activeElement?.blur();
        }
        return;
      }

      // Alt + Key combinations for Advanced Mode
      if (e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'a') {
          e.preventDefault();
          setShowAIAgent(prev => !prev);
          return;
        } else if (k === 'n') {
          e.preventDefault();
          setShowQuickActionModal(prev => !prev);
          return;
        } else if (k === 'i') {
          e.preventDefault();
          dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
          return;
        } else if (k === 'b') {
          e.preventDefault();
          dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
          return;
        } else if (k === 'j') {
          e.preventDefault();
          setShowManualJournalModal(true);
          return;
        } else if (k === 'k') {
          e.preventDefault();
          dispatch({ type: 'SET_SCREEN', payload: SCREENS.KHATA });
          return;
        } else if (k === 'r') {
          e.preventDefault();
          setShowBankReconcileModal(true);
          return;
        } else if (k === 's') {
          e.preventDefault();
          setShowStockAuditModal(true);
          return;
        } else if (k === 'f') {
          e.preventDefault();
          setShowFixedAssetsModal(true);
          return;
        } else if (k === 'p') {
          e.preventDefault();
          setShowPayrollModal(true);
          return;
        } else if (k === 't') {
          e.preventDefault();
          dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
          return;
        }
      }

      if (e.key === 'F1') {
        e.preventDefault();
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
      } else if (e.key === 'F2') {
        e.preventDefault();
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
      } else if (e.key === 'F3' || e.key === 'F7') {
        e.preventDefault();
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.KHATA });
      } else if (e.key === 'F4') {
        e.preventDefault();
        setShowTutorialModal(true);
      } else if (e.key === 'F6') {
        e.preventDefault();
        dispatch({ type: 'SET_SCREEN', payload: SCREENS.REPORTS });
      } else if (e.key === 'F8') {
        e.preventDefault();
        setShowStockAuditModal(true);
      } else if (e.key === 'F9') {
        e.preventDefault();
        setShowManualJournalModal(true);
      } else if (e.key === '?' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal(true);
      } else if (e.key === 'Escape') {
        setShowAIAgent(false);
        setShowShortcutsModal(false);
        setShowStockAuditModal(false);
        setShowBankReconcileModal(false);
        setShowFixedAssetsModal(false);
        setShowPayrollModal(false);
        setShowManualJournalModal(false);
        setShowFiscalCloseModal(false);
        setShowTutorialModal(false);
        setShowProfileModal(false);
        setShowSideDrawer(false);
        setShowQuickActionModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

  // Live Clock — updates every second
  const [liveTime, setLiveTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { businesses = [], activeBizId, activeBiz, dayData, currentScreen, isLoading, isDarkMode, language } = state;
  const lang = language || 'bn';

  useEffect(() => {
    document.title = lang === 'en' ? 'Ledgero — Shop Accounting & Digital Ledger' : 'Ledgero — দোকানের হিসাব';
  }, [lang]);

  // Time-based greeting using translations
  const greeting = getTimeGreeting(liveTime.getHours(), lang);
  const formattedTime = liveTime.toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dayName = getDayName(liveTime.getDay(), lang);

  // ── Auth Gate: Show loading or login screen ──
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-white text-lg font-semibold">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p>{lang === 'en' ? 'Loading Ledgero...' : 'Ledgero লোড হচ্ছে...'}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  if (isLoading || !dayData) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-white text-lg font-semibold">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p>{lang === 'en' ? 'Loading ledger...' : 'হিসাবের খাতা লোড হচ্ছে...'}</p>
        </div>
      </div>
    );
  }

  const isDateToday = dayData?.dateKey === getTodayKey();

  const handleSelectBusiness = (id) => {
    dispatch({ type: 'SWITCH_BUSINESS', payload: id });
    setShowBizModal(false);
  };

  const handleDeleteBusiness = async (e, bizId, bizName) => {
    e.stopPropagation(); // Prevent card click from switching to this business
    if (businesses.length <= 1) {
      alert(lang === 'en' 
        ? '⚠️ The last business cannot be deleted. At least one business must remain.' 
        : '⚠️ শেষ ব্যবসাটি মুছে ফেলা যাবে না। কমপক্ষে একটি ব্যবসা থাকতে হবে।');
      return;
    }
    const confirmed = window.confirm(lang === 'en'
      ? `⚠️ Are you sure you want to permanently delete "${bizName}" and all its records (transactions, khata, cash drawer)?`
      : `⚠️ "${bizName}" ব্যবসাটি এবং এর সকল তথ্য (লেনদেন, বাকি খাতা, ক্যাশ ড্রয়ার) স্থায়ীভাবে মুছে ফেলা হবে।\n\nআপনি কি নিশ্চিত?`);
    if (!confirmed) return;

    try {
      if (user?.uid) {
        await deleteBusinessFromCloud(user.uid, bizId);
      }
      dispatch({ type: 'DELETE_BUSINESS', payload: bizId });
    } catch (err) {
      console.error('Failed to delete business from cloud:', err);
      alert(lang === 'en'
        ? `❌ Could not delete "${bizName}" from cloud storage. Please check your connection and try again.`
        : `❌ ক্লাউড থেকে "${bizName}" মুছে ফেলা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।`);
    }
  };

  const handleCreateBusiness = (e) => {
    e.preventDefault();
    if (!newBizName.trim()) return;

    let finalType = newBizType;
    if ((newBizType === 'অন্যান্য' || newBizType === 'others') && customBizType.trim()) {
      finalType = customBizType.trim();
    }

    const newBiz = {
      id: `biz_${Date.now()}`,
      name: newBizName.trim(),
      type: finalType
    };

    dispatch({ type: 'ADD_BUSINESS', payload: newBiz });

    setNewBizName('');
    setNewBizType(BIZ_TYPES[0]);
    setCustomBizType('');
    setIsCreatingBiz(false);
    setShowBizModal(false);
  };



  const isNotStarted = dayData.status === DAY_STATUS.NOT_STARTED;
  const isOpen = dayData.status === DAY_STATUS.OPEN;

  const handleExport = async () => {
    const data = await exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledgero_${(activeBiz?.name || 'shop').replace(/\s+/g, '_')}_${dayData.dateKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const success = importAllData(event.target.result);
        if (success) {
          alert(lang === 'en' ? 'Data imported successfully! Reloading app...' : 'ডেটা সফলভাবে ইমপোর্ট হয়েছে! অ্যাপ রিলোড হচ্ছে...');
          window.location.reload();
        } else {
          alert(lang === 'en' ? 'Import failed. Please select a valid file.' : 'ইমপোর্ট ব্যর্থ হয়েছে। সঠিক ফাইল নির্বাচন করুন।');
        }
      } catch (err) {
        console.error(err);
        alert(lang === 'en' ? 'Error processing file.' : 'ফাইল প্রসেসিং এ সমস্যা হয়েছে।');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className={`flex flex-col h-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      {/* Hidden Date Input for picker in both modes */}
      <input
        ref={dateInputRef}
        type="date"
        value={dayData.dateKey}
        onChange={(e) => e.target.value && dispatch({ type: 'SWITCH_DATE', payload: e.target.value })}
        className="sr-only"
        tabIndex={-1}
      />

      {/* 🚀 Advanced Mode: Titanium Slate & Emerald MegaNavbar */}
      {isAdvanced && (
        <AdvancedMegaNavbar
          lang={lang}
          onToggleLang={() => dispatch({ type: 'SET_LANGUAGE', payload: lang === 'bn' ? 'en' : 'bn' })}
          activeBiz={activeBiz}
          onOpenBizModal={() => setShowBizModal(true)}
          appMode={state.appMode}
          onToggleAppMode={() => dispatch({ type: 'SET_APP_MODE', payload: 'easy' })}
          dateKey={dayData.dateKey}
          onPrevDay={() => dispatch({ type: 'SWITCH_DATE', payload: getPrevDayKey(dayData.dateKey) })}
          onNextDay={() => dispatch({ type: 'SWITCH_DATE', payload: getNextDayKey(dayData.dateKey) })}
          onPickDate={() => {
            try {
              dateInputRef.current?.showPicker();
            } catch {
              dateInputRef.current?.focus();
            }
          }}
          onSelectScreen={handleMegaNavSelect}
          onOpenQuickAction={() => setShowQuickActionModal(true)}
          isDemoMode={isDemoMode}
          onToggleDemoMode={() => setIsDemoMode(!isDemoMode)}
          onOpenProfile={() => setShowProfileModal(true)}
          onOpenTutorial={() => setShowTutorialModal(true)}
          isPrivacyMode={state.isPrivacyMode}
          onTogglePrivacy={() => dispatch({ type: 'TOGGLE_PRIVACY_MODE' })}
          user={user}
        />
      )}

      {/* ⚡ Easy Mode: Friendly Top Header */}
      {isEasy && (
        <header className="bg-slate-900 text-white px-3 py-2 sm:px-5 sm:py-3 shadow-md z-20 shrink-0">
          <div className="flex items-center justify-between gap-2">
          {/* Shop Brand & Multi-Business Switcher */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <LedgeroLogo size={24} rounded={true} />
              <span className="text-base sm:text-xl font-black tracking-tight text-white">
                Ledgero
              </span>
            </div>
            <button
              onClick={() => setShowBizModal(true)}
              className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/30 px-2 py-1 rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer truncate max-w-[130px] sm:max-w-[200px]"
              title={lang === 'en' ? 'Click to switch or add business' : 'ব্যবসা পরিবর্তন বা নতুন ব্যবসা যোগ করতে ক্লিক করুন'}
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{activeBiz?.name || (lang === 'en' ? 'Business' : 'ব্যবসা')}</span>
              <ChevronDown className="w-3 h-3 opacity-70 shrink-0" />
            </button>
          </div>

          {/* ── Language Toggle & Mode Switcher Pills (Photo 2 Style) ── */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Language Toggle (বাংলা / English) */}
            <button
              onClick={() => dispatch({ type: 'SET_LANGUAGE', payload: lang === 'bn' ? 'en' : 'bn' })}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700/80 px-2.5 py-1 sm:py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title={lang === 'bn' ? 'Switch to English' : 'বাংলায় যান'}
            >
              <Globe className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span>{lang === 'bn' ? 'English' : 'বাংলা'}</span>
            </button>

            {/* Mode Switcher Pill (Photo 2 style: Advanced ⚡ Easy) */}
            <button
              onClick={() => dispatch({ type: 'SET_APP_MODE', payload: 'advanced' })}
              className="flex items-center gap-1 bg-gradient-to-r from-purple-900/90 to-indigo-900/90 hover:from-purple-800 hover:to-indigo-800 text-purple-100 hover:text-white border border-purple-500/60 px-2.5 py-1 sm:py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title={lang === 'bn' ? 'অ্যাডভান্সড মোডে যান' : 'Switch to Advanced Mode'}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="font-extrabold text-white">Advanced</span>
              <span className="text-[10px] text-purple-300 font-semibold">⚡ Easy</span>
            </button>
          </div>

          {/* Center Date Switcher (Prominent & High Contrast in desktop mode) */}
          <div className="hidden sm:flex items-center gap-1 sm:gap-1.5 bg-slate-800/95 hover:bg-slate-800 border border-slate-600/80 rounded-xl px-2 py-1 sm:px-3 sm:py-1.5 shadow-sm text-xs sm:text-sm">
            <button
              onClick={() => dispatch({ type: 'SWITCH_DATE', payload: getPrevDayKey(dayData.dateKey) })}
              className="p-1 rounded-lg hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white transition-all cursor-pointer"
              title={t('prev_day', lang)}
            >
              <ChevronLeft className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>

            {/* Clickable Date Display with Calendar Icon */}
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() => {
                  try {
                    dateInputRef.current?.showPicker();
                  } catch {
                    dateInputRef.current?.focus();
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-slate-700/70 text-amber-300 hover:text-amber-200 font-bold transition-all cursor-pointer"
                title={t('pick_date', lang)}
              >
                <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="tabular-nums tracking-wide">{dayData.dateKey}</span>
                {isDateToday && (
                  <span className="hidden md:inline text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded-full font-semibold">
                    {t('today_badge', lang)}
                  </span>
                )}
              </button>

              {/* Native Date Picker Input Triggered by button */}
              <input
                ref={dateInputRef}
                type="date"
                value={dayData.dateKey}
                onChange={(e) => e.target.value && dispatch({ type: 'SWITCH_DATE', payload: e.target.value })}
                className="absolute inset-0 opacity-0 pointer-events-none w-0 h-0"
                tabIndex={-1}
              />
            </div>

            <button
              onClick={() => dispatch({ type: 'SWITCH_DATE', payload: getNextDayKey(dayData.dateKey) })}
              className="p-1 rounded-lg hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white transition-all cursor-pointer"
              title={t('next_day', lang)}
            >
              <ChevronRight className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>

            {/* Jump to Today Button if not on today */}
            {!isDateToday && (
              <button
                onClick={() => dispatch({ type: 'SWITCH_DATE', payload: getTodayKey() })}
                className="hidden lg:flex items-center ml-1 px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/30 rounded-md text-[11px] font-bold transition-all cursor-pointer"
                title={lang === 'bn' ? 'আজকের তারিখে ফিরে যান' : 'Jump to Today'}
              >
                {t('today_badge', lang)}
              </button>
            )}
          </div>

          {/* Right: Live Clock, Dark Mode, Privacy Eye & Status Badge */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Live Clock, Day & Greeting — DESKTOP ONLY */}
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 px-2.5 py-1 rounded-lg">
              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-bold text-amber-300 tabular-nums">{formattedTime}</span>
              <span className="text-[10px] text-slate-500">•</span>
              <span className="text-[10px] font-semibold text-cyan-300">{dayName}</span>
              <span className="text-[10px] text-slate-500">•</span>
              <span className="text-[10px] text-slate-300">{greeting.emoji} {greeting.text}</span>
            </div>

            {/* Dark Mode Toggle — DESKTOP ONLY */}
            <button
              onClick={() => dispatch({ type: 'TOGGLE_DARK_MODE' })}
              className={`hidden sm:flex p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer items-center gap-1.5 ${
                isDarkMode 
                  ? 'bg-indigo-500 text-white border-indigo-400 shadow-sm ring-1 ring-indigo-400/40' 
                  : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:bg-slate-700'
              }`}
              title={isDarkMode ? (lang === 'en' ? 'Switch to Light Mode' : 'লাইট মোডে যান') : (lang === 'en' ? 'Switch to Dark Mode' : 'ডার্ক মোডে যান')}
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-4 h-4 shrink-0" />
                  <span className="hidden md:inline">{t('light_mode', lang)}</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 shrink-0" />
                  <span className="hidden md:inline">{t('dark_mode', lang)}</span>
                </>
              )}
            </button>

            {/* User Avatar — DESKTOP ONLY */}
            {user && (
              <button
                onClick={() => setShowProfileModal(true)}
                className="hidden sm:flex items-center gap-1 cursor-pointer rounded-lg p-0.5 hover:ring-2 hover:ring-emerald-400/50 transition-all"
                title={t('profile_title', lang)}
              >
                {user.photoURL ? (
                  <img 
                    src={user.photoURL} 
                    alt={user.displayName || 'User'} 
                    className="w-7 h-7 rounded-full border-2 border-emerald-400/50"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold border-2 border-emerald-400/50">
                    {(user.displayName || 'U')[0].toUpperCase()}
                  </div>
                )}
              </button>
            )}

            {/* Multi-Currency Switcher (IAS 21) — DESKTOP */}
            <div className="hidden sm:flex items-center">
              <CurrencySwitcher />
            </div>

            {/* NAM AI Assistant Trigger — DESKTOP */}
            <button
              onClick={() => setShowAIAgent(true)}
              className="hidden sm:flex p-1.5 sm:px-3 sm:py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer items-center gap-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white border-emerald-400/50 shadow-sm active:scale-95 group"
              title={lang === 'en' ? 'NAM AI Assistant (Press Alt+A)' : 'NAM (নাম) এআই সহকারী (Alt+A চাপুন)'}
            >
              <Bot className="w-3.5 h-3.5 text-emerald-200 group-hover:animate-bounce shrink-0" />
              <span className="font-extrabold tracking-wide">NAM AI</span>
              <span className="hidden md:inline text-[9px] font-mono bg-black/25 px-1 py-0.2 rounded border border-white/20 text-emerald-100">
                Alt+A
              </span>
            </button>

            {/* Keyboard Shortcuts Trigger — DESKTOP */}
            <button
              onClick={() => setShowShortcutsModal(true)}
              className="hidden lg:flex p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer items-center gap-1.5 bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:bg-slate-700"
              title={lang === 'en' ? 'Keyboard Shortcuts (Press ? or Ctrl+/)' : 'কীবোর্ড শর্টকাট (? চাপুন)'}
            >
              <Keyboard className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden xl:inline text-[11px]">{lang === 'en' ? 'Shortcuts' : 'শর্টকাট'}</span>
            </button>

            {/* Ledgero Academy / Tutorial Guide — DESKTOP */}
            <button
              onClick={() => setShowTutorialModal(true)}
              className="hidden lg:flex p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer items-center gap-1.5 bg-gradient-to-r from-emerald-600/25 to-teal-600/25 text-emerald-300 hover:text-white border-emerald-500/50 hover:bg-emerald-600/40 shadow-xs active:scale-95"
              title={lang === 'en' ? 'Tutorial & In-App Guide (Press F4)' : 'টিউটোরিয়াল ও নির্দেশিকা (F4)'}
            >
              <GraduationCap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="hidden xl:inline text-[11px]">{lang === 'en' ? 'Tutorial Guide' : 'টিউটোরিয়াল'}</span>
            </button>

            {/* Privacy Eye — DESKTOP ONLY */}
            <button
              onClick={() => dispatch({ type: 'TOGGLE_PRIVACY_MODE' })}
              className={`hidden sm:flex p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer items-center gap-1.5 ${
                state.isPrivacyMode 
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm ring-1 ring-amber-400/40' 
                  : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:bg-slate-700'
              }`}
              title={state.isPrivacyMode ? (lang === 'en' ? 'Privacy Mode ON' : 'প্রাইভেসি মোড চালু') : (lang === 'en' ? 'Privacy Mode OFF' : 'প্রাইভেসি মোড বন্ধ')}
            >
              {state.isPrivacyMode ? (
                <>
                  <EyeOff className="w-4 h-4 text-slate-950 shrink-0" />
                  <span className="hidden md:inline">{t('privacy_on', lang)}</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-slate-300 shrink-0" />
                  <span className="hidden md:inline">{t('privacy_off', lang)}</span>
                </>
              )}
            </button>

            {/* Status Badge — Desktop Only */}
            <span className={`hidden sm:inline-flex px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider ${
              isNotStarted ? 'bg-slate-700 text-slate-300' : 
              isOpen ? 'bg-emerald-600 text-white' : 
              dayData.status === DAY_STATUS.CLOSING ? 'bg-amber-500 text-white' : 
              'bg-blue-600 text-white'
            }`}>
              {dayData.status.replace('_', ' ')}
            </span>

            {/* 🤖 NAM AI Trigger — MOBILE */}
            <button
              onClick={() => setShowAIAgent(true)}
              className="sm:hidden p-1.5 px-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white border border-emerald-400/50 hover:opacity-90 transition-all cursor-pointer flex items-center gap-1 shadow-xs"
              title={lang === 'en' ? 'NAM AI Assistant' : 'NAM AI (নাম এআই)'}
            >
              <Bot className="w-4 h-4 text-emerald-100 animate-pulse" />
              <span className="text-[11px] font-black">NAM</span>
            </button>

            {/* ☰ Hamburger Menu — MOBILE ONLY */}
            <button
              onClick={() => setShowSideDrawer(true)}
              className="sm:hidden p-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:text-white hover:bg-slate-700 transition-all cursor-pointer"
              title="Menu"
            >
              <Menu className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Mobile Sub-bar: Single Clean Date & Status Strip */}
        <div className="flex sm:hidden items-center justify-between mt-2 pt-2 border-t border-slate-800/90 text-xs">
          {/* Mobile Date Switcher */}
          <div className="flex items-center gap-1 bg-slate-800/90 border border-slate-700/80 rounded-lg px-2 py-1">
            <button
              onClick={() => dispatch({ type: 'SWITCH_DATE', payload: getPrevDayKey(dayData.dateKey) })}
              className="p-0.5 text-slate-300 hover:text-white transition-colors"
              title={t('prev_day', lang)}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => {
                try {
                  dateInputRef.current?.showPicker();
                } catch {
                  dateInputRef.current?.focus();
                }
              }}
              className="flex items-center gap-1 text-amber-300 font-bold text-xs px-1"
              title={t('pick_date', lang)}
            >
              <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="tabular-nums">{dayData.dateKey}</span>
            </button>

            <button
              onClick={() => dispatch({ type: 'SWITCH_DATE', payload: getNextDayKey(dayData.dateKey) })}
              className="p-0.5 text-slate-300 hover:text-white transition-colors"
              title={t('next_day', lang)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {isDateToday ? (
              <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1 py-0.2 rounded font-semibold ml-0.5">
                {t('today_badge', lang)}
              </span>
            ) : (
              <button
                onClick={() => dispatch({ type: 'SWITCH_DATE', payload: getTodayKey() })}
                className="text-[9px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/30 px-1.5 py-0.2 rounded font-bold ml-0.5 transition-colors"
                title={lang === 'bn' ? 'আজকের তারিখে ফিরে যান' : 'Jump to Today'}
              >
                {t('today_badge', lang)}
              </button>
            )}
          </div>

          {/* Mobile Status Badge */}
          {/* Cloud Sync Status Badge */}
          {syncStatus === 'saving' && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-sky-300 border border-sky-400/30">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              <span>{lang === 'en' ? 'Syncing...' : 'সিঙ্ক হচ্ছে...'}</span>
            </span>
          )}
          {syncStatus === 'saved' && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
              <Check className="w-2.5 h-2.5" />
              <span>{lang === 'en' ? 'Cloud Synced' : 'ক্লাউড সিঙ্কড'}</span>
            </span>
          )}

          {/* Status Badge */}
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
            isNotStarted ? 'bg-slate-700 text-slate-300' : 
            isOpen ? 'bg-emerald-600 text-white' : 
            dayData.status === DAY_STATUS.CLOSING ? 'bg-amber-500 text-white' : 
            'bg-blue-600 text-white'
          }`}>
            {dayData.status.replace('_', ' ')}
          </span>
        </div>
      </header>
      )}

      {/* ⚠️ Cloud Sync Alert / Retry Banner (Gate A5) */}
      {isSyncProblem && (
        <div className="bg-amber-500/15 dark:bg-amber-950/50 border-b border-amber-500/30 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs z-30 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-2.5 w-2.5 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
            </span>
            <div className="truncate">
              <span className="font-bold text-amber-800 dark:text-amber-300">
                {syncStatus === 'conflict'
                  ? (lang === 'en' ? '⚠️ Sync Conflict: ' : '⚠️ ক্লাউড কনফ্লিক্ট: ')
                  : (lang === 'en' ? '⚠️ Cloud Save Failed / Offline: ' : '⚠️ ক্লাউডে সেভ ব্যর্থ / অফলাইন: ')}
              </span>
              <span className="text-amber-700 dark:text-amber-400">
                {syncError 
                  ? syncError 
                  : (syncStatus === 'conflict'
                      ? (lang === 'en' ? 'Changes from another device detected.' : 'অন্য ডিভাইস থেকে পরিবর্তন শনাক্ত হয়েছে।')
                      : (lang === 'en' ? 'Changes are kept safely on this device. Click to retry syncing.' : 'তথ্য এই ডিভাইসে সুরক্ষিত আছে। ক্লাউডে পাঠাতে পুনরায় চেষ্টা করুন।'))}
              </span>
            </div>
          </div>
          <button
            onClick={() => retryCloudSync && retryCloudSync()}
            className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer text-xs"
            title={lang === 'en' ? 'Retry cloud synchronization' : 'ক্লাউডে পুনরায় সেভ করার চেষ্টা করুন'}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Retry Sync' : 'ক্লাউডে পুনরায় সেভ করুন'}</span>
          </button>
        </div>
      )}

      {/* ═══ Mobile Side Drawer (slides from right) ═══ */}
      {showSideDrawer && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50 sm:hidden" onClick={() => setShowSideDrawer(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-72 bg-white dark:bg-slate-900 z-50 sm:hidden shadow-2xl overflow-y-auto animate-slideInRight">
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-4 border-b dark:border-slate-700">
              <div className="flex items-center gap-2">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold">
                    {(user?.displayName || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-bold text-gray-800 dark:text-white truncate max-w-[160px]">{user?.displayName}</p>
                  <p className="text-[10px] text-gray-500 dark:text-slate-400 truncate max-w-[160px]">{user?.email}</p>
                </div>
              </div>
              <button onClick={() => setShowSideDrawer(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Mode Indicator Bar */}
            <div className={`px-4 py-2.5 ${isAdvanced ? 'bg-purple-600' : 'bg-emerald-600'} text-white`}>
              <div className="flex items-center gap-2 text-xs font-bold">
                {isAdvanced ? <Sparkles className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                {isAdvanced ? (lang === 'en' ? 'Advanced Mode' : 'অ্যাডভান্স মোড') : (lang === 'en' ? 'Easy Mode' : 'ইজি মোড')}
              </div>
            </div>

            {/* Drawer Menu Items */}
            <div className="p-3 space-y-1">
              {/* Profile */}
              <button onClick={() => { setShowSideDrawer(false); setShowProfileModal(true); }} 
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                <Settings className="w-4 h-4 text-gray-400" /> {lang === 'en' ? 'Settings & Profile' : 'সেটিংস ও প্রোফাইল'}
              </button>

              {/* Dark Mode */}
              <button onClick={() => dispatch({ type: 'TOGGLE_DARK_MODE' })} 
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                <span className="flex items-center gap-3">
                  {isDarkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-gray-400" />}
                  {isDarkMode ? (lang === 'en' ? 'Light Mode' : 'লাইট মোড') : (lang === 'en' ? 'Dark Mode' : 'ডার্ক মোড')}
                </span>
                <div className={`w-9 h-5 rounded-full relative transition-colors ${isDarkMode ? 'bg-indigo-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isDarkMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
              </button>

              {/* Language */}
              <button onClick={() => dispatch({ type: 'SET_LANGUAGE', payload: lang === 'bn' ? 'en' : 'bn' })} 
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                <span className="flex items-center gap-3">
                  <Globe className="w-4 h-4 text-gray-400" />
                  {lang === 'en' ? 'Language' : 'ভাষা'}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                  {lang === 'bn' ? 'বাংলা' : 'EN'}
                </span>
              </button>

              {/* Privacy */}
              <button onClick={() => dispatch({ type: 'TOGGLE_PRIVACY_MODE' })} 
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                <span className="flex items-center gap-3">
                  {state.isPrivacyMode ? <EyeOff className="w-4 h-4 text-amber-500" /> : <Eye className="w-4 h-4 text-gray-400" />}
                  {lang === 'en' ? 'Privacy Mode' : 'প্রাইভেসি মোড'}
                </span>
                <div className={`w-9 h-5 rounded-full relative transition-colors ${state.isPrivacyMode ? 'bg-amber-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${state.isPrivacyMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
              </button>

              {/* NAM AI Assistant Button */}
              <button 
                onClick={() => { setShowSideDrawer(false); setShowAIAgent(true); }} 
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-500/15 via-teal-500/15 to-indigo-500/15 hover:from-emerald-500/25 hover:to-indigo-500/25 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-pointer transition-all shadow-xs"
              >
                <span className="flex items-center gap-2.5">
                  <Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  {lang === 'en' ? 'NAM AI Assistant' : 'NAM (নাম) এআই সহকারী'}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow-xs">
                  {lang === 'en' ? 'NAM' : 'ফ্রি এআই'}
                </span>
              </button>

              {/* Divider */}
              <div className="border-t dark:border-slate-700 my-2" />

              {/* Mode Switch */}
              <div className="px-3 py-2">
                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-2">
                  {lang === 'en' ? 'App Mode' : 'অ্যাপ মোড'}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => dispatch({ type: 'SET_APP_MODE', payload: 'easy' })}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                      isEasy ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'
                    }`}>
                    <Zap className="w-3 h-3" /> {lang === 'en' ? 'Easy' : 'ইজি'}
                  </button>
                  <button onClick={() => dispatch({ type: 'SET_APP_MODE', payload: 'advanced' })}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                      isAdvanced ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'
                    }`}>
                    <Sparkles className="w-3 h-3" /> {lang === 'en' ? 'Advanced' : 'অ্যাডভান্স'}
                  </button>
                </div>
              </div>

              {/* Feature Toggles (Advanced Only) */}
              {isAdvanced && (
                <div className="px-3 py-2">
                  <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1.5">
                    {lang === 'en' ? 'Feature Modules' : 'ফিচার মডিউল'}
                  </p>
                  {Object.entries(FEATURE_META).map(([key, meta]) => (
                    <div key={key} className="flex items-center justify-between py-1.5 cursor-pointer" onClick={() => dispatch({ type: 'TOGGLE_FEATURE', payload: key })}>
                      <span className="text-xs text-gray-600 dark:text-slate-300 flex items-center gap-1.5">
                        <span>{meta.icon}</span>
                        {lang === 'en' ? meta.en : meta.bn}
                      </span>
                      <div className={`w-8 h-4.5 rounded-full relative transition-colors ${state.featureFlags?.[key] ? 'bg-purple-500' : 'bg-gray-300 dark:bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${state.featureFlags?.[key] ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Currency Selector (IAS 21) */}
              <div className="px-3 py-2">
                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1.5">
                  {lang === 'en' ? 'Currency' : 'মুদ্রা'}
                </p>
                <CurrencySwitcher />
              </div>

              {/* Accounting & Management Modals */}
              <div className="px-3 py-2">
                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1.5">
                  {lang === 'en' ? 'Accounting & Audit' : 'অ্যাকাউন্টিং ও অডিট'}
                </p>
                <div className="space-y-1">
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowTutorialModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 cursor-pointer transition-colors"
                  >
                    <GraduationCap className="w-4 h-4 text-emerald-600" />
                    <span>{lang === 'en' ? '🎓 Academy & Tutorial (F4)' : '🎓 টিউটোরিয়াল ও গাইড (F4)'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setAnalyticsInitialTab('cfo'); dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS }); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold text-teal-800 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-900/50 cursor-pointer transition-colors"
                  >
                    <BarChart3 className="w-4 h-4 text-teal-600" />
                    <span>{lang === 'en' ? '📊 Analytics & Virtual CFO' : '📊 অ্যানালিটিক্স ও ভার্চুয়াল সিএফও'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowBankReconcileModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <Landmark className="w-4 h-4 text-emerald-600" />
                    <span>{lang === 'en' ? 'Bank Reconciliation' : 'ব্যাংক রিকনসিলিয়েশন'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowFixedAssetsModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <span>{lang === 'en' ? 'Fixed Assets (IAS 16)' : 'স্থায়ী সম্পদ রেজিস্টার'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowStockAuditModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <ClipboardCheck className="w-4 h-4 text-amber-600" />
                    <span>{lang === 'en' ? 'Stock Audit (IAS 2)' : 'শারীরিক স্টক অডিট'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowPayrollModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <Users className="w-4 h-4 text-purple-600" />
                    <span>{lang === 'en' ? 'Payroll & Staff' : 'বেতন ও কর্মচারী'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowManualJournalModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-sky-600" />
                    <span>{lang === 'en' ? 'Manual Journal (F9)' : 'ম্যানুয়াল জার্নাল ভাউচার (F9)'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowFiscalCloseModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <Lock className="w-4 h-4 text-rose-600" />
                    <span>{lang === 'en' ? 'Fiscal Year Close & Lock' : 'অর্থবছর সমাপনী ও লক'}</span>
                  </button>
                  <button
                    onClick={() => { setShowSideDrawer(false); setShowShortcutsModal(true); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <Keyboard className="w-4 h-4 text-sky-600" />
                    <span>{lang === 'en' ? 'Keyboard Shortcuts' : 'কীবোর্ড শর্টকাট'}</span>
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t dark:border-slate-700 my-2" />

              {/* Sign Out */}
              <button onClick={signOut} 
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer">
                <LogOut className="w-4 h-4" /> {lang === 'en' ? 'Sign Out' : 'লগ আউট'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Advanced Mode Accent Bar — DESKTOP */}
      {isAdvanced && (
        <div className="hidden sm:flex h-1 bg-gradient-to-r from-purple-600 via-violet-500 to-indigo-600 shrink-0" />
      )}

      {/* Multi-Business Modal (Inspired by Photo 5) */}
      {showBizModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base sm:text-lg font-bold text-gray-800 flex items-center gap-2">
                <Store className="w-5 h-5 text-amber-600" />
                {lang === 'en' ? `Businesses (${businesses.length}/10)` : `ব্যবসা সমূহ (${businesses.length}/১০)`}
              </h3>
              <button 
                onClick={() => { setShowBizModal(false); setIsCreatingBiz(false); }}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {!isCreatingBiz ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  {lang === 'en' ? 'Your saved businesses (click to switch):' : 'আপনার সংরক্ষিত ব্যবসা প্রতিষ্ঠান সমূহ (ক্লিক করে পরিবর্তন করুন):'}
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {businesses.map(b => {
                    const isActive = b.id === activeBizId;
                    return (
                      <div
                        key={b.id}
                        onClick={() => handleSelectBusiness(b.id)}
                        className={`p-3.5 rounded-xl border-2 cursor-pointer flex items-center justify-between transition-all ${
                          isActive 
                            ? 'border-emerald-500 bg-emerald-50/50 shadow-sm ring-1 ring-emerald-400' 
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-sm text-gray-900 truncate">{b.name}</p>
                            {isActive && (
                              <span className="text-[10px] bg-emerald-600 text-white font-bold px-1.5 py-0.5 rounded shrink-0">
                                {lang === 'en' ? 'Active' : 'সক্রিয়'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{getBizCategoryName(b.type, lang)}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isActive && (
                            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shadow-xs">
                              ✓
                            </div>
                          )}
                          {businesses.length > 1 && (
                            <button
                              onClick={(e) => handleDeleteBusiness(e, b.id, b.name)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all cursor-pointer"
                              title={lang === 'en' ? 'Delete business' : 'ব্যবসা মুছুন'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={() => setIsCreatingBiz(true)}
                  className="w-full mt-3 py-3 border-2 border-indigo-500 hover:border-indigo-600 text-indigo-600 hover:bg-indigo-50 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" /> {lang === 'en' ? '+ Add New Business' : '+ নতুন ব্যবসা যোগ করুন'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateBusiness} className="space-y-3.5">
                <p className="text-xs text-gray-500">
                  {lang === 'en' ? 'Enter new business details:' : 'নতুন ব্যবসা প্রতিষ্ঠানের তথ্য দিন:'}
                </p>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {lang === 'en' ? 'Business Name *' : 'ব্যবসা প্রতিষ্ঠানের নাম *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={newBizName}
                    onChange={(e) => setNewBizName(e.target.value)}
                    placeholder={lang === 'en' ? 'e.g. Apex Hardware, Blue Star Store' : 'যেমন: মায়ের দোয়া হার্ডওয়্যার'}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                    autoFocus
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-gray-700">
                      {lang === 'en' ? 'Business Type *' : 'ব্যবসার ধরন *'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCategoryPickerModal(true)}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" /> {lang === 'en' ? 'Pick from grid' : 'গ্রিড থেকে বাছুন'}
                    </button>
                  </div>

                  {/* Visual Card that triggers the Category Modal */}
                  <div
                    onClick={() => setShowCategoryPickerModal(true)}
                    className="p-3 bg-gradient-to-r from-indigo-50/70 to-slate-50 border-2 border-indigo-200 hover:border-indigo-400 rounded-xl cursor-pointer flex items-center justify-between transition-all group shadow-2xs mb-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-2xl p-1 bg-white rounded-lg shadow-2xs border border-gray-100">
                        {BIZ_CATEGORIES.find(c => c.name === newBizType || c.id === newBizType)?.icon || '🏪'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 group-hover:text-indigo-700 truncate">
                          {getBizCategoryName(newBizType, lang)}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {lang === 'en' ? 'Click to view 18+ business categories' : 'ক্লিক করে ১৮+ ক্যাটাগরির তালিকা দেখুন'}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-indigo-600 bg-white border border-indigo-200 group-hover:bg-indigo-600 group-hover:text-white px-2.5 py-1 rounded-lg transition-all shrink-0">
                      {lang === 'en' ? 'Change ❯' : 'পরিবর্তন ❯'}
                    </span>
                  </div>

                  {/* Dropdown alternative */}
                  <select
                    value={newBizType}
                    onChange={(e) => setNewBizType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  >
                    {BIZ_CATEGORIES.map(cat => (
                      <option key={cat.id} value={cat.name}>
                        {lang === 'en' ? cat.name_en : cat.name}
                      </option>
                    ))}
                  </select>

                  {/* Custom Input when 'অন্যান্য' is chosen */}
                  {(newBizType === 'অন্যান্য' || newBizType === 'others') && (
                    <div className="mt-2.5 p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-1 animate-in fade-in duration-200">
                      <label className="block text-xs font-bold text-amber-900 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        {lang === 'en' ? 'Enter your custom business type in detail: *' : 'আপনার ব্যবসার ধরণ বিস্তারিত লিখুন: *'}
                      </label>
                      <input
                        type="text"
                        required
                        value={customBizType}
                        onChange={(e) => setCustomBizType(e.target.value)}
                        placeholder={lang === 'en' ? 'e.g. Hotel & Restaurant, Laundry, Cafe, Clinic' : 'যেমন: হোটেল ও রেস্টুরেন্ট, লন্ড্রি, ক্যাফে, ক্লিনিক'}
                        className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        autoFocus
                      />
                      <p className="text-[10px] text-amber-800">
                        {lang === 'en'
                          ? '💡 Entering a specific type will configure tailored accounting ledgers for your business.'
                          : '💡 নির্দিষ্ট ধরণ লিখলে আপনার ব্যবসার জন্য সঠিক হিসাব খাতা তৈরি হবে।'}
                      </p>
                    </div>
                  )}

                  <p className="text-[11px] text-gray-500 mt-1">
                    {lang === 'en'
                      ? '* Cashbox, inventory tracking, and dashboard will be configured automatically based on business type.'
                      : '* ব্যবসার ধরনের উপর ভিত্তি করে ক্যাশবাক্স, স্টক হিসাব এবং ড্যাশবোর্ড স্বয়ংক্রিয়ভাবে সাজানো হবে।'}
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreatingBiz(false)}
                    className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors"
                  >
                    {lang === 'en' ? 'Back' : 'ফিরে যান'}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-sm transition-colors"
                  >
                    {lang === 'en' ? 'Confirm' : 'নিশ্চিত করুন'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Category Picker Modal matching Photo 5 */}
      <BusinessCategoryModal
        isOpen={showCategoryPickerModal}
        onClose={() => setShowCategoryPickerModal(false)}
        selectedCategory={newBizType}
        initialCustomType={customBizType}
        onSelectCategory={(cat, custom) => {
          setNewBizType(cat);
          if (custom) setCustomBizType(custom);
        }}
      />

      <Suspense fallback={null}>
        {/* Profile & Settings Modal */}
        {showProfileModal && (
          <ProfileModal 
            isOpen={showProfileModal} 
            onClose={() => setShowProfileModal(false)}
            onOpenTutorial={() => setShowTutorialModal(true)}
            isDemoMode={isDemoMode}
            onToggleDemoMode={() => setIsDemoMode(!isDemoMode)}
          />
        )}

        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal
          isOpen={showShortcutsModal}
          onClose={() => setShowShortcutsModal(false)}
        />

        {/* Stock Audit Modal (IAS 2) */}
        {showStockAuditModal && (
          <StockAuditModal
            isOpen={showStockAuditModal}
            onClose={() => setShowStockAuditModal(false)}
          />
        )}

        {/* Bank Reconciliation Modal */}
        {showBankReconcileModal && (
          <BankReconciliationModal
            isOpen={showBankReconcileModal}
            onClose={() => setShowBankReconcileModal(false)}
          />
        )}

        {/* Fixed Assets Register Modal (IAS 16) */}
        {showFixedAssetsModal && (
          <FixedAssetsModal
            isOpen={showFixedAssetsModal}
            onClose={() => setShowFixedAssetsModal(false)}
          />
        )}

        {/* Payroll & Staff Salary Slips Modal */}
        {showPayrollModal && (
          <PayrollModal
            isOpen={showPayrollModal}
            onClose={() => setShowPayrollModal(false)}
          />
        )}

        {/* Manual Journal Entry Voucher (IAS 1 / GAAP) */}
        {showManualJournalModal && (
          <ManualJournalModal
            isOpen={showManualJournalModal}
            onClose={() => setShowManualJournalModal(false)}
          />
        )}

        {/* Fiscal Year Closing & Period Lock (IAS 1/8) */}
        {showFiscalCloseModal && (
          <FiscalYearCloseModal
            isOpen={showFiscalCloseModal}
            onClose={() => setShowFiscalCloseModal(false)}
          />
        )}

        {/* Ledgero Academy & Tutorial Modal */}
        {showTutorialModal && (
          <TutorialModal
            isOpen={showTutorialModal}
            onClose={() => setShowTutorialModal(false)}
            onOpenBankReconcile={() => { setShowTutorialModal(false); setShowBankReconcileModal(true); }}
            onOpenFixedAssets={() => { setShowTutorialModal(false); setShowFixedAssetsModal(true); }}
            onOpenStockAudit={() => { setShowTutorialModal(false); setShowStockAuditModal(true); }}
            onOpenPayroll={() => { setShowTutorialModal(false); setShowPayrollModal(true); }}
            onOpenManualJournal={() => { setShowTutorialModal(false); setShowManualJournalModal(true); }}
            onOpenFiscalClose={() => { setShowTutorialModal(false); setShowFiscalCloseModal(true); }}
            onOpenShortcuts={() => { setShowTutorialModal(false); setShowShortcutsModal(true); }}
          />
        )}

        {/* Daily Cash Summary (CashBox Report) Modal */}
        {showCashBoxReportModal && (
          <CashBoxReportModal
            isOpen={showCashBoxReportModal}
            onClose={() => setShowCashBoxReportModal(false)}
          />
        )}

        {/* Monthly Recurring Expenses Modal */}
        {showRecurringModal && (
          <RecurringExpenseManager
            isOpen={showRecurringModal}
            onClose={() => setShowRecurringModal(false)}
            state={state}
            dispatch={dispatch}
            lang={lang}
          />
        )}

        {/* Go Online — Public Store Setup Modal */}
        {showGoOnlineModal && (
          <GoOnlineSetup
            isOpen={showGoOnlineModal}
            onClose={() => setShowGoOnlineModal(false)}
            state={state}
            dispatch={dispatch}
            lang={lang}
          />
        )}
      </Suspense>

      {/* Global Quick-Action Command Palette (Alt+N) */}
      <GlobalQuickActionModal
        isOpen={showQuickActionModal}
        onClose={() => setShowQuickActionModal(false)}
        onAction={handleQuickAction}
        lang={lang}
      />

      {/* Navigation: Easy Mode Desktop Tabs (Hidden in Advanced Mode since MegaNavbar handles it) */}
      {isEasy && (
        <nav className={`hidden sm:flex border-b px-6 gap-6 z-10 shrink-0 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
          <button
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.OPENING })}
            className={`py-3 px-1 border-b-2 font-bold text-xs sm:text-sm whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              currentScreen === SCREENS.OPENING
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-indigo-600'
            }`}
          >
            <Sunrise className="w-4 h-4" />
            <span>{t('nav_opening', lang)}</span>
          </button>

          <button
            disabled={isNotStarted}
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD })}
            className={`py-3 px-1 border-b-2 font-bold text-xs sm:text-sm whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              isNotStarted ? 'opacity-50 cursor-not-allowed border-transparent text-slate-400' :
              currentScreen === SCREENS.DASHBOARD
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-indigo-600'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>{t('nav_dashboard', lang)}</span>
          </button>

          <button
            disabled={isNotStarted}
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.TEAHOUSE })}
            className={`py-3 px-1 border-b-2 font-bold text-xs sm:text-sm whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              isNotStarted ? 'opacity-50 cursor-not-allowed border-transparent text-slate-400' :
              currentScreen === SCREENS.TEAHOUSE
                ? 'border-amber-600 text-amber-600'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-amber-600'
            }`}
          >
            <Coffee className="w-4 h-4" />
            <span>{lang === 'en' ? 'Tea House' : 'টি-হাউস'}</span>
          </button>

          <button
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.ONLINE_ORDERS })}
            className={`py-3 px-1 border-b-2 font-bold text-xs sm:text-sm whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              currentScreen === SCREENS.ONLINE_ORDERS
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-emerald-600'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>{lang === 'en' ? 'Online Orders' : 'অনলাইন অর্ডার'}</span>
          </button>

          {/* Go Online — Public Store Setup */}
          <button
            onClick={() => setShowGoOnlineModal(true)}
            className="py-3 px-3 border-b-2 border-transparent font-bold text-xs sm:text-sm whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer bg-gradient-to-r from-emerald-500/10 to-teal-500/10 hover:from-emerald-500/20 hover:to-teal-500/20 text-emerald-600 dark:text-emerald-400 rounded-t-lg relative group"
          >
            <Globe className="w-4 h-4" />
            <span>{lang === 'en' ? 'Go Online' : 'অনলাইন দোকান'}</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </button>

          <button
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.KHATA })}
            className={`py-3 px-1 border-b-2 font-bold text-xs sm:text-sm whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              currentScreen === SCREENS.KHATA
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-600 hover:text-sky-600'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>{t('nav_khata', lang)}</span>
          </button>

          <button
            disabled={isNotStarted}
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.CLOSING })}
            className={`py-3 px-1 border-b-2 font-bold text-xs sm:text-sm whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              isNotStarted ? 'opacity-50 cursor-not-allowed border-transparent text-slate-400' :
              currentScreen === SCREENS.CLOSING
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-indigo-600'
            }`}
          >
            <Moon className="w-4 h-4" />
            <span>{t('nav_closing', lang)}</span>
          </button>

          {/* NAM AI Assistant Desktop Tab Button */}
          <button
            onClick={() => setShowAIAgent(true)}
            className="py-2.5 px-3.5 my-1.5 rounded-xl border border-emerald-500/40 font-bold text-xs sm:text-sm whitespace-nowrap text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 flex items-center gap-2 cursor-pointer ml-auto bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 hover:from-emerald-100 hover:to-teal-100 transition-all shadow-xs active:scale-95 group"
            title={lang === 'en' ? 'NAM AI Financial Assistant (Alt + A)' : 'NAM (নাম) এআই হিসাব সহকারী (Alt + A)'}
          >
            <Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
            <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 dark:from-emerald-400 dark:to-teal-300 bg-clip-text text-transparent font-black">
              ✨ {lang === 'en' ? 'NAM AI' : 'NAM (নাম) এআই'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-mono">
              Alt+A
            </span>
          </button>
        </nav>
      )}

      {/* Main Content Area (With bottom padding on mobile for Bottom App Bar) */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-5 md:p-6 pb-32 sm:pb-8">
        <div className="max-w-7xl mx-auto h-full">
          <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-500 font-semibold">{lang === 'en' ? 'Loading screen...' : 'লোড হচ্ছে...'}</div>}>
            {currentScreen === SCREENS.OPENING && <OpeningScreen />}
            {currentScreen === SCREENS.DASHBOARD && (
              <DashboardScreen 
                isDemoMode={isDemoMode} 
                onToggleDemoMode={() => setIsDemoMode(!isDemoMode)}
                initialTab={dashboardInitialTab}
                onInitialTabConsumed={() => setDashboardInitialTab(null)}
              />
            )}
            {currentScreen === SCREENS.KHATA && <KhataScreen />}
            {currentScreen === SCREENS.REPORTS && <ReportsScreen />}
            {currentScreen === SCREENS.CLOSING && <ClosingScreen />}
            {currentScreen === SCREENS.TEAHOUSE && <TeaHouseScreen />}
            {currentScreen === SCREENS.ONLINE_ORDERS && <OnlineOrdersScreen />}
            {currentScreen === SCREENS.ANALYTICS && (
              <AnalyticsHub 
                state={state} 
                isDemoMode={isDemoMode} 
                onToggleDemoMode={() => setIsDemoMode(!isDemoMode)} 
                lang={lang}
                initialTab={analyticsInitialTab}
              />
            )}
          </Suspense>
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className={`sm:hidden fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md border-t shadow-2xl px-2 py-1.5 flex items-center justify-around ${isDarkMode ? 'bg-slate-900/95 border-slate-700' : 'bg-white/95 border-slate-200'}`}>
        {isAdvanced ? (
          <>
            {/* Tab 1: Command Center */}
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD })}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.DASHBOARD 
                  ? 'text-emerald-500 font-bold scale-105' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Command' : 'কমান্ড'}</span>
            </button>

            {/* Tab: Online Orders 🚚 */}
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.ONLINE_ORDERS })}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.ONLINE_ORDERS 
                  ? 'text-emerald-400 font-bold scale-105' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Truck className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Orders' : 'অর্ডার'}</span>
            </button>

            {/* Tab 2: Analytics */}
            <button
              onClick={() => {
                setAnalyticsInitialTab('cfo');
                dispatch({ type: 'SET_SCREEN', payload: SCREENS.ANALYTICS });
              }}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.ANALYTICS 
                  ? 'text-cyan-400 font-bold scale-105' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LineChart className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Analytics' : 'অ্যানালিটিক্স'}</span>
            </button>

            {/* Tab 3: Quick Action Hub (+) */}
            <button
              onClick={() => setShowQuickActionModal(true)}
              className="flex flex-col items-center justify-center -mt-4 bg-emerald-600 hover:bg-emerald-500 text-white w-11 h-11 rounded-full shadow-lg shadow-emerald-950/60 border-2 border-slate-900 transition-transform active:scale-95 cursor-pointer"
              title="Quick Action"
            >
              <Plus className="w-6 h-6 stroke-[3]" />
            </button>

            {/* Tab 4: Ledger & Khata */}
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.KHATA })}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.KHATA 
                  ? 'text-sky-400 font-bold scale-105' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Ledger' : 'খতিয়ান'}</span>
            </button>

            {/* Tab 5: Financial Reports */}
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.REPORTS })}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.REPORTS 
                  ? 'text-purple-400 font-bold scale-105' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Reports' : 'রিপোর্ট'}</span>
            </button>
          </>
        ) : (
          <>
            {/* Retail Easy Mode Mobile Tabs */}
            {/* Tab 1: Opening */}
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.OPENING })}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.OPENING 
                  ? 'text-indigo-600 font-bold scale-105' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Sunrise className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{t('mob_opening', lang)}</span>
            </button>

            {/* Tab 2: Dashboard */}
            <button
              disabled={isNotStarted}
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD })}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                isNotStarted ? 'opacity-40 cursor-not-allowed text-slate-400' :
                currentScreen === SCREENS.DASHBOARD 
                  ? 'text-indigo-600 font-bold scale-105' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <LayoutDashboard className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{t('mob_dashboard', lang)}</span>
            </button>

            {/* Tab: Tea House ☕ */}
            <button
              disabled={isNotStarted}
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.TEAHOUSE })}
              className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
                isNotStarted ? 'opacity-40 cursor-not-allowed text-slate-400' :
                currentScreen === SCREENS.TEAHOUSE 
                  ? 'text-amber-600 font-bold scale-105' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Coffee className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Tea' : 'টি-হাউস'}</span>
            </button>

            {/* Tab: Online Orders 🚚 */}
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.ONLINE_ORDERS })}
              className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.ONLINE_ORDERS 
                  ? 'text-emerald-600 font-bold scale-105' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Truck className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Orders' : 'অর্ডার'}</span>
            </button>

            {/* Tab 3: Khata */}
            <button
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.KHATA })}
              className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
                currentScreen === SCREENS.KHATA 
                  ? 'text-sky-600 font-bold scale-105' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <BookOpen className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{t('mob_khata', lang)}</span>
            </button>

            {/* Tab: Reports (Owner only) */}
            {state.userRole === 'owner' && (
              <button
                onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.REPORTS })}
                className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                  currentScreen === SCREENS.REPORTS 
                    ? 'text-purple-600 font-bold scale-105' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <BarChart3 className="w-5 h-5 mb-0.5" />
                <span className="text-[10px] tracking-tight">{lang === 'en' ? 'Reports' : 'রিপোর্ট'}</span>
              </button>
            )}

            {/* Tab 4: Closing */}
            <button
              disabled={isNotStarted || state.userRole === 'staff'}
              onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.CLOSING })}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
                (isNotStarted || state.userRole === 'staff') ? 'opacity-40 cursor-not-allowed text-slate-400' :
                currentScreen === SCREENS.CLOSING 
                  ? 'text-indigo-600 font-bold scale-105' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Moon className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{t('mob_closing', lang)}</span>
            </button>
          </>
        )}
      </nav>

      {/* Desktop Footer (Hidden on mobile to keep screen ultra-clean) */}
      <footer className="hidden sm:flex bg-slate-900 text-slate-400 py-3 px-5 justify-between items-center text-xs shrink-0">
        <div>
          &copy; {new Date().getFullYear()} {activeBiz?.name} — Ledgero System
        </div>
        <div className="flex gap-4">
          <button onClick={handleExport} className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer">
            {t('export_backup', lang)}
          </button>
          <button onClick={handleImportClick} className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer">
            {t('import_backup', lang)}
          </button>
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </footer>

      {/* Ledgero AI Floating Launcher Button */}
      <AIAgentFloatingButton 
        onClick={() => setShowAIAgent(true)} 
        lang={lang} 
      />

      {/* Ledgero AI Conversational Drawer */}
      {showAIAgent && (
        <Suspense fallback={null}>
          <AIAgentDrawer
            isOpen={showAIAgent}
            onClose={() => setShowAIAgent(false)}
            state={state}
            dispatch={dispatch}
            lang={lang}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
