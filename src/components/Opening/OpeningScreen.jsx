import { useState, useEffect, Suspense, lazy } from 'react';
import { useApp } from '../../context/AppContext';
import { useAppMode } from '../Shared/ModeGuard';
import { formatBDT } from '../../data/calculations';
import { 
  WALLET_KEYS, WALLET_LABELS, WALLET_COLORS, 
  GENERAL_WALLET_KEYS, GENERAL_WALLET_LABELS, GENERAL_WALLET_COLORS,
  DAY_STATUS, SCREENS, isTelecomBiz, getWalletLabel, getBizCategoryName, 
  getCustomWalletColor, WALLET_CATEGORIES, detectWalletCategory 
} from '../../data/constants';
import { t, getTimeGreeting, translateUnit } from '../../data/translations';
import { Sunrise, Plus, Check, Package, Trash2, Edit3, Save, Users, X, ChevronLeft, ChevronRight, AlertTriangle, ClipboardCheck, Zap, CheckSquare, Square } from 'lucide-react';
import AddProductModal from '../Shared/AddProductModal';
import DamageWriteOffModal from '../Inventory/DamageWriteOffModal';
import PinLockModal, { hashPin } from '../Shared/PinLockModal';
import AddWalletModal from '../Shared/AddWalletModal';
import EditProductModal from '../Shared/EditProductModal';
import EditWalletModal from '../Shared/EditWalletModal';
import OpeningAdjustmentModal from '../Shared/OpeningAdjustmentModal';

const StockAuditModal = lazy(() => import('../Inventory/StockAuditModal'));

export default function OpeningScreen() {
  const { state, dispatch } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const { dayData, activeBiz, language, editLockEnabled, editLockPinHash } = state;
  const lang = language || 'bn';
  const isTelecom = isTelecomBiz(activeBiz?.type, activeBiz?.name);

  const { status, wallets = {}, inventory = [], loans } = dayData;

  const isNotStarted = status === DAY_STATUS.NOT_STARTED;
  const isFinalized = status === DAY_STATUS.FINALIZED;

  const [isEditingOpening, setIsEditingOpening] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isDamageModalOpen, setIsDamageModalOpen] = useState(false);
  const [isStockAuditOpen, setIsStockAuditOpen] = useState(false);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountCategory, setNewAccountCategory] = useState('bank');
  const [showPinModal, setShowPinModal] = useState(false);

  // New states for product editing, bulk selection, wallet editing, and morning adjustment
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingWallet, setEditingWallet] = useState(null);
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);

  // Determine active wallet keys (use stored order if available)
  const activeWalletKeys = (() => {
    const allKeys = Object.keys(wallets);
    if (dayData.walletOrder && dayData.walletOrder.length > 0) {
      // Use stored order, but include any new keys not in the order
      const orderedKeys = dayData.walletOrder.filter(k => allKeys.includes(k));
      const newKeys = allKeys.filter(k => !dayData.walletOrder.includes(k));
      return [...orderedKeys, ...newKeys];
    }
    return allKeys;
  })();

  const getLabel = (key) => {
    return wallets[key]?.label || getWalletLabel(key, lang, wallets[key]);
  };

  const getWalletColor = (key) => {
    return getCustomWalletColor(key, activeWalletKeys, wallets[key]);
  };

  // Local state for wallet inputs
  const [walletInputs, setWalletInputs] = useState(() => {
    const inputs = {};
    activeWalletKeys.forEach(key => {
      inputs[key] = String(wallets[key]?.opening ?? 0);
    });
    return inputs;
  });

  // Local state for opening loans
  const [loanInputs, setLoanInputs] = useState(() => ({
    openingGiven: String(loans?.openingGiven || 0),
    openingTaken: String(loans?.openingTaken || 0),
  }));

  // Keep walletInputs and loanInputs in sync when dayData or active business changes
  useEffect(() => {
    const inputs = {};
    Object.keys(dayData.wallets || {}).forEach(key => {
      inputs[key] = String(dayData.wallets[key]?.opening ?? 0);
    });
    setWalletInputs(inputs);

    setLoanInputs({
      openingGiven: String(dayData.loans?.openingGiven || 0),
      openingTaken: String(dayData.loans?.openingTaken || 0),
    });
  }, [dayData.dateKey, dayData.loans, dayData.wallets]);

  // Reset editing mode when date changes
  useEffect(() => {
    setIsEditingOpening(false);
  }, [dayData.dateKey]);

  const handleWalletInput = (key, value) => {
    setWalletInputs(prev => ({ ...prev, [key]: value }));
  };

  const saveAllWalletsAndLoans = () => {
    Object.keys(walletInputs).forEach(key => {
      const amount = parseFloat(walletInputs[key]) || 0;
      dispatch({
        type: 'SET_WALLET_OPENING',
        payload: { walletKey: key, amount }
      });
    });

    dispatch({
      type: 'SET_OPENING_LOANS',
      payload: {
        openingGiven: parseFloat(loanInputs.openingGiven) || 0,
        openingTaken: parseFloat(loanInputs.openingTaken) || 0,
      }
    });

    setIsEditingOpening(false);
    setSelectedProductIds([]);
  };

  const handleOpeningStockChange = (itemId, val) => {
    const quantity = parseFloat(val) || 0;
    dispatch({
      type: 'SET_OPENING_STOCK',
      payload: { itemId, quantity }
    });
  };

  const handleAddedStockChange = (itemId, val) => {
    const quantity = parseFloat(val) || 0;
    dispatch({
      type: 'ADD_STOCK',
      payload: { itemId, quantity }
    });
  };

  const handleRemoveItem = (itemId) => {
    if (window.confirm(t('delete_item', lang))) {
      dispatch({ type: 'REMOVE_INVENTORY_ITEM', payload: itemId });
      setSelectedProductIds(prev => prev.filter(id => id !== itemId));
    }
  };

  // Inventory Selection & Bulk Deletion
  const handleToggleSelectProduct = (itemId) => {
    setSelectedProductIds(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  const handleToggleSelectAllProducts = () => {
    if (inventory.length === 0) return;
    if (selectedProductIds.length === inventory.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(inventory.map(item => item.id));
    }
  };

  const handleBulkDeleteProducts = () => {
    if (selectedProductIds.length === 0) return;
    const count = selectedProductIds.length;
    const confirmMsg = lang === 'en'
      ? `Are you sure you want to delete ${count} selected product(s)?`
      : `আপনি কি নিশ্চিত যে নির্বাচিত ${count}টি পণ্য মুছে ফেলতে চান?`;
    if (window.confirm(confirmMsg)) {
      dispatch({
        type: 'BULK_REMOVE_INVENTORY_ITEMS',
        payload: selectedProductIds
      });
      setSelectedProductIds([]);
    }
  };

  // Keep selectedProductIds in sync if inventory items change
  useEffect(() => {
    const existingIds = new Set(inventory.map(i => i.id));
    setSelectedProductIds(prev => prev.filter(id => existingIds.has(id)));
  }, [inventory]);

  const handleAddAccount = () => {
    const name = newAccountName.trim();
    if (!name) return;
    // Create a safe key from the name
    const walletKey = name.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, '_').replace(/^_|_$/g, '') || `custom_${Date.now()}`;
    dispatch({
      type: 'ADD_WALLET',
      payload: { walletKey, label: name, category: newAccountCategory }
    });
    // Also set it in local walletInputs
    setWalletInputs(prev => ({ ...prev, [walletKey]: '0' }));
    setNewAccountName('');
    setNewAccountCategory('bank');
    setIsAddAccountOpen(false);
  };

  const handleRemoveWallet = (key) => {
    if (key === 'hand_cash') {
      alert(t('cannot_delete_cash', lang));
      return;
    }
    const label = getLabel(key);
    const bal = Number(wallets[key]?.current) || Number(wallets[key]?.opening) || 0;
    const confirmMsg = bal > 0
      ? (lang === 'en'
          ? `⚠️ Warning: "${label}" has a balance of ${formatBDT(bal, 'en')}.\n\nAre you sure you want to delete this account?`
          : `⚠️ সতর্কতা: "${label}" অ্যাকাউন্টে ${formatBDT(bal, 'bn')} ব্যালেন্স রয়েছে!\n\nআপনি কি নিশ্চিতভাবে এই ওয়ালেটটি মুছে ফেলতে চান?`)
      : (lang === 'en'
          ? `Are you sure you want to delete "${label}"?`
          : `আপনি কি নিশ্চিতভাবে "${label}" ওয়ালেটটি মুছে ফেলতে চান?`);

    if (window.confirm(confirmMsg)) {
      dispatch({ type: 'REMOVE_WALLET', payload: key });
      setWalletInputs(prev => {
        const { [key]: removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleMoveWallet = (key, direction) => {
    const currentIndex = activeWalletKeys.indexOf(key);
    const newIndex = currentIndex + direction; // -1 = left, +1 = right
    if (newIndex < 0 || newIndex >= activeWalletKeys.length) return;
    const newOrder = [...activeWalletKeys];
    [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];
    dispatch({ type: 'REORDER_WALLETS', payload: newOrder });
  };

  const handleAddProduct = (productData) => {
    dispatch({
      type: 'ADD_INVENTORY_ITEM',
      payload: productData
    });
  };

  const handleConfirmOpening = () => {
    saveAllWalletsAndLoans();
    dispatch({ type: 'OPEN_DAY' });
    dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD });
  };

  // Quick statistics for current inventory
  const totalItemsCount = inventory.length;
  const totalStockUnits = inventory.reduce((sum, item) => {
    return sum + (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
  }, 0);
  const totalStockInvestment = inventory.reduce((sum, item) => {
    const qty = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
    return sum + (qty * (Number(item.buyPrice) || 0));
  }, 0);

  // Live clock for greeting
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const tTimer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tTimer);
  }, []);

  const greetingInfo = getTimeGreeting(now.getHours(), lang);
  const timeStr = now.toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Sunrise className="w-7 h-7 text-amber-500 shrink-0" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {greetingInfo.text}! {greetingInfo.emoji} — {activeBiz?.name}
            </h1>
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs mt-1.5 flex flex-wrap items-center gap-2">
            <span>{t('date_label', lang)}: <strong className="font-bold text-slate-900 dark:text-slate-200">{dayData.dateKey}</strong></span>
            {isAdvanced && (
              <>
                <span>•</span>
                <span>{t('time_label', lang)}: <strong className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">{timeStr}</strong></span>
                <span>•</span>
                <span>{t('type_label', lang)}: <strong className="font-semibold text-slate-800 dark:text-amber-300">{getBizCategoryName(activeBiz?.type, lang)}</strong></span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isEditingOpening ? (
            <button
              onClick={saveAllWalletsAndLoans}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {t('save_opening', lang)}
            </button>
          ) : (
            <button
              onClick={() => {
                if (editLockEnabled) {
                  setShowPinModal(true);
                } else {
                  setIsEditingOpening(true);
                }
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              {editLockEnabled ? '🔒' : <Edit3 className="w-4 h-4" />}
              {t('edit_opening', lang)}
            </button>
          )}
        </div>
      </div>

      {/* Wallet Balances Grid */}
      <div className={`bg-white dark:bg-slate-900 p-5 ${isEasy ? 'rounded-2xl shadow-md border-0' : 'rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm'}`}>
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>💼</span> {t('opening_balances', lang)}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isEditingOpening 
                ? t('opening_balances_desc_editing', lang)
                : t('opening_balances_desc_auto', lang)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">{activeWalletKeys.length} {t('accounts_count', lang)}</span>
            {isEditingOpening && (
              <>
                <button
                  type="button"
                  onClick={() => setIsAdjustmentModalOpen(true)}
                  className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                  title={lang === 'en' ? 'Pre-Opening Expense or Cash Adjustment' : 'সকালের প্রারম্ভিক খরচ বা ক্যাশ সমন্বয়'}
                >
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>{lang === 'en' ? 'Morning Adjustment' : '⚡ সকালের খরচ/সমন্বয়'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(true)}
                  className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                  title={lang === 'en' ? 'Add new wallet / account' : 'নতুন ওয়ালেট যোগ করুন'}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Add Wallet' : 'নতুন ওয়ালেট'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${isEditingOpening ? 'gap-5' : 'gap-3.5'}`}>
          {activeWalletKeys.map((key) => {
            const colors = getWalletColor(key);
            const label = getLabel(key);
            const isHandCash = key === 'hand_cash';

            const cardClasses = isEasy
              ? `p-4 sm:p-5 rounded-2xl shadow-sm border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-900/10 transition-all relative ${isHandCash ? 'ring-2 ring-emerald-500 shadow-md' : ''}`
              : `p-3.5 rounded-lg border ${colors.border || 'border-slate-200'} ${colors.bg || 'bg-slate-50'} transition-all relative ${isHandCash ? 'ring-2 ring-emerald-500 shadow-xs' : ''} shadow-sm`;

            return (
              <div 
                key={key} 
                className={cardClasses}
              >
                {/* Delete button — shown in edit mode, hidden for hand_cash */}
                {isEditingOpening && !isHandCash && (
                  <button
                    onClick={() => handleRemoveWallet(key)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center shadow-md transition-all cursor-pointer z-10"
                    title={t('delete_account', lang)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Move buttons — shown in edit mode */}
                {isEditingOpening && (
                  <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1 z-10">
                    <button
                      onClick={() => handleMoveWallet(key, -1)}
                      disabled={activeWalletKeys.indexOf(key) === 0}
                      className="w-6 h-6 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-full flex items-center justify-center shadow-md transition-all cursor-pointer disabled:cursor-not-allowed"
                      title="Move left"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveWallet(key, 1)}
                      disabled={activeWalletKeys.indexOf(key) === activeWalletKeys.length - 1}
                      className="w-6 h-6 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-full flex items-center justify-center shadow-md transition-all cursor-pointer disabled:cursor-not-allowed"
                      title="Move right"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`${isEasy ? 'text-2xl' : 'text-base'}`}>{colors.icon || '💰'}</span>
                    <span className={`${isEasy ? 'text-base' : 'text-xs'} font-bold text-slate-800 dark:text-slate-200 truncate`}>{label}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isHandCash && (
                      <span className="text-xs bg-emerald-600 text-white font-bold px-1.5 py-0.5 rounded tracking-wider">
                        DRAWER
                      </span>
                    )}
                    {/* Edit Wallet Info — ONLY in edit mode! */}
                    {isEditingOpening && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingWallet({ key, ...wallets[key], label });
                        }}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-colors cursor-pointer"
                        title={lang === 'en' ? 'Edit Wallet Info' : 'ওয়ালেটের নাম বা ধরন এডিট করুন'}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isEditingOpening ? (
                  <div className="mt-2 space-y-1.5">
                    <div className={`flex items-center gap-1 border border-slate-300 dark:border-slate-600 ${isEasy ? 'rounded-xl px-3 py-2' : 'rounded-lg px-2.5 py-1.5'} bg-white dark:bg-slate-800 shadow-inner focus-within:ring-2 focus-within:ring-emerald-500`}>
                      <span className="text-slate-400 font-bold text-xs">{lang === 'en' ? 'Tk' : '৳'}</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={walletInputs[key] ?? '0'}
                        onChange={(e) => handleWalletInput(key, e.target.value)}
                        className={`w-full ${isEasy ? 'text-xl' : 'text-base'} font-black text-slate-900 dark:text-slate-100 focus:outline-none bg-transparent`}
                      />
                    </div>
                    {/* Category selector */}
                    {isAdvanced && (
                      <select
                        value={wallets[key]?.category || detectWalletCategory(key)}
                        onChange={(e) => dispatch({ type: 'UPDATE_WALLET_CATEGORY', payload: { walletKey: key, category: e.target.value } })}
                        className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-lg text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                      >
                        {WALLET_CATEGORIES.map(cat => (
                          <option key={cat.id} value={cat.id}>
                            {cat.icon} {lang === 'en' ? cat.name_en : cat.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <div className="mt-1">
                    <div className={`${isEasy ? 'text-3xl' : 'text-xl'} font-black text-slate-900 dark:text-slate-100`}>
                      {formatBDT(wallets[key]?.opening || 0, lang)}
                    </div>
                    <p className={`${isEasy ? 'text-sm mt-1' : 'text-[11px] mt-0.5'} text-slate-500 dark:text-slate-400 font-medium`}>
                      {t('current_balance', lang)}: <strong className="text-slate-700 dark:text-slate-300">{formatBDT(wallets[key]?.current || 0, lang)}</strong>
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Account Card — ONLY shown in edit mode */}
          {isEditingOpening && (
            <button
              type="button"
              onClick={() => setIsAddAccountOpen(true)}
              className="p-4 rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-700/60 hover:border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-100/50 dark:hover:bg-indigo-950/40 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer group min-h-[110px] shadow-xs"
            >
              <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/60 group-hover:bg-indigo-200 dark:group-hover:bg-indigo-800 flex items-center justify-center transition-colors">
                <Plus className="w-5 h-5 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-center">
                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 block">
                  {lang === 'en' ? '+ Add Wallet' : '+ নতুন ওয়ালেট যোগ করুন'}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  {lang === 'en' ? 'Rocket, Bank, Cash, etc.' : 'রকেট, ব্যাংক, ক্যাশ ইত্যাদি'}
                </span>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Opening Loans & Debt Section */}
      <div className={`bg-white dark:bg-slate-900 p-5 ${isEasy ? 'rounded-2xl shadow-md border-0' : 'rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm'}`}>
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-600" />
              {t('opening_loans', lang)}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('loans_desc', lang)}
            </p>
          </div>
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 ${isEasy ? 'gap-6' : 'gap-4'}`}>
          <div className={`p-4 ${isEasy ? 'bg-purple-50/70 dark:bg-purple-900/20 border-0 rounded-2xl' : 'bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 rounded-xl'}`}>
            <span className={`${isEasy ? 'text-sm mb-2' : 'text-xs mb-1.5'} font-bold text-purple-900 dark:text-purple-300 block`}>
              {t('others_owe_you', lang)}
            </span>
            {isEditingOpening ? (
              <div className={`flex items-center gap-1 border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 ${isEasy ? 'rounded-xl px-3 py-2' : 'rounded-lg px-2.5 py-1.5'}`}>
                <span className="text-purple-400 font-bold text-xs">{lang === 'en' ? 'Tk' : '৳'}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={loanInputs.openingGiven}
                  onChange={(e) => setLoanInputs(prev => ({ ...prev, openingGiven: e.target.value }))}
                  className={`w-full ${isEasy ? 'text-xl' : 'text-base'} font-black text-purple-950 dark:text-purple-200 focus:outline-none bg-transparent`}
                />
              </div>
            ) : (
              <div className={`${isEasy ? 'text-3xl' : 'text-2xl'} font-black text-purple-950 dark:text-purple-200`}>
                {formatBDT(dayData.loans?.openingGiven || 0, lang)}
              </div>
            )}
          </div>

          <div className={`p-4 ${isEasy ? 'bg-amber-50/70 dark:bg-amber-900/20 border-0 rounded-2xl' : 'bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl'}`}>
            <span className={`${isEasy ? 'text-sm mb-2' : 'text-xs mb-1.5'} font-bold text-amber-900 dark:text-amber-300 block`}>
              {t('you_owe_others', lang)}
            </span>
            {isEditingOpening ? (
              <div className={`flex items-center gap-1 border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 ${isEasy ? 'rounded-xl px-3 py-2' : 'rounded-lg px-2.5 py-1.5'}`}>
                <span className="text-amber-400 font-bold text-xs">{lang === 'en' ? 'Tk' : '৳'}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={loanInputs.openingTaken}
                  onChange={(e) => setLoanInputs(prev => ({ ...prev, openingTaken: e.target.value }))}
                  className={`w-full ${isEasy ? 'text-xl' : 'text-base'} font-black text-amber-950 dark:text-amber-200 focus:outline-none bg-transparent`}
                />
              </div>
            ) : (
              <div className={`${isEasy ? 'text-3xl' : 'text-2xl'} font-black text-amber-950 dark:text-amber-200`}>
                {formatBDT(dayData.loans?.openingTaken || 0, lang)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inventory Table Section */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              {t('inventory_title', lang)}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('inventory_desc', lang)}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => setIsDamageModalOpen(true)}
              className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800/50 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              title={lang === 'en' ? 'Write-off Damaged/Lost Products' : 'নষ্ট বা ক্ষয়ক্ষতি পণ্য বাদ দিন'}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {lang === 'en' ? 'Damage Write-off' : 'নষ্ট পণ্য বাদ দিন'}
            </button>

            <button
              onClick={() => setIsStockAuditOpen(true)}
              className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:hover:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              title={lang === 'en' ? 'Physical Stock Audit & Count (IAS 2)' : 'শারীরিক স্টক অডিট ও গণনা'}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              {lang === 'en' ? 'Stock Audit' : 'স্টক অডিট'}
            </button>

            {isEditingOpening && (
              <button
                onClick={() => setIsAddProductOpen(true)}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> {t('add_product', lang)}
              </button>
            )}
          </div>
        </div>

        {/* Quick summary chips */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs">
          <div>
            <span className="text-slate-600 dark:text-slate-400 font-medium">{t('total_items', lang)}:</span>
            <span className="ml-1.5 font-bold text-slate-900 dark:text-slate-100">{totalItemsCount}</span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400 font-medium">{t('total_stock', lang)}:</span>
            <span className="ml-1.5 font-bold text-slate-900 dark:text-slate-100">{totalStockUnits}</span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400 font-medium">{t('total_investment', lang)}:</span>
            <span className="ml-1.5 font-bold text-emerald-700 dark:text-emerald-400">{formatBDT(totalStockInvestment, lang)}</span>
          </div>
        </div>

        {/* Bulk Selection Action Ribbon — ONLY in edit mode */}
        {isEditingOpening && selectedProductIds.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 rounded-xl shadow-xs">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-black text-xs flex items-center justify-center">
                {selectedProductIds.length}
              </span>
              <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                {lang === 'en' 
                  ? `${selectedProductIds.length} item(s) selected` 
                  : `${selectedProductIds.length}টি পণ্য নির্বাচিত`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedProductIds([])}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Deselect All' : 'সব বাতিল'}
              </button>
              <button
                type="button"
                onClick={handleBulkDeleteProducts}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {lang === 'en'
                    ? `Delete Selected (${selectedProductIds.length})`
                    : `🗑️ নির্বাচিতগুলো মুছুন (${selectedProductIds.length})`}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Product Table (Always accessible) */}
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold border-b border-slate-200 dark:border-slate-700">
              <tr>
                {isEditingOpening && (
                  <th className="p-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={inventory.length > 0 && selectedProductIds.length === inventory.length}
                      onChange={handleToggleSelectAllProducts}
                      disabled={inventory.length === 0}
                      className="w-4 h-4 rounded text-indigo-600 border-slate-300 dark:border-slate-600 focus:ring-indigo-500 cursor-pointer"
                      title={lang === 'en' ? 'Select all items' : 'সবগুলো নির্বাচন করুন'}
                    />
                  </th>
                )}
                <th className="p-3.5">{t('col_product_name', lang)}</th>
                <th className="p-3.5">{t('col_unit', lang)}</th>
                <th className="p-3.5">{t('col_opening_stock', lang)}</th>
                <th className="p-3.5">{t('col_added_stock', lang)}</th>
                <th className="p-3.5">{t('col_available_stock', lang)}</th>
                <th className="p-3.5 text-right">{t('col_buy_price', lang)}</th>
                <th className="p-3.5 text-right">{t('col_sell_price', lang)}</th>
                {isEditingOpening && (
                  <th className="p-3.5 text-center">{lang === 'en' ? 'Actions' : 'অ্যাকশন'}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {inventory.length === 0 ? (
                <tr>
                  <td colSpan={isEditingOpening ? 9 : 7} className="p-8 text-center text-slate-400 dark:text-slate-500 font-medium">
                    {t('no_product', lang)}
                  </td>
                </tr>
              ) : (
                inventory.map((item) => {
                  const available = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
                  const unitLabel = translateUnit(item.unit || 'পিস', lang);
                  const isSelected = selectedProductIds.includes(item.id);

                  return (
                    <tr 
                      key={item.id} 
                      className={`transition-colors ${
                        isEditingOpening && isSelected 
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/30' 
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {isEditingOpening && (
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectProduct(item.id)}
                            className="w-4 h-4 rounded text-indigo-600 border-slate-300 dark:border-slate-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="p-3.5 font-bold text-slate-900 dark:text-slate-100">
                        {item.name}
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-semibold">
                          {unitLabel}
                        </span>
                      </td>
                      <td className="p-3.5">
                        {isEditingOpening ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.openingStock ?? ''}
                            onChange={(e) => handleOpeningStockChange(item.id, e.target.value)}
                            placeholder="0"
                            className="w-16 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-center font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                          />
                        ) : (
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {item.openingStock} {unitLabel}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        {isEditingOpening ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.addedStock || ''}
                            onChange={(e) => handleAddedStockChange(item.id, e.target.value)}
                            placeholder="0"
                            className="w-16 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-center font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                          />
                        ) : (
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {item.addedStock ? `${item.addedStock} ${unitLabel}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-black text-emerald-700 dark:text-emerald-400">
                        {available} {unitLabel}
                      </td>
                      <td className="p-3.5 text-right font-semibold text-slate-700 dark:text-slate-300">
                        {formatBDT(item.buyPrice, lang)}
                      </td>
                      <td className="p-3.5 text-right font-black text-slate-900 dark:text-slate-100">
                        {formatBDT(item.sellPrice, lang)}
                      </td>
                      {isEditingOpening && (
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setEditingProduct(item)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors cursor-pointer"
                              title={lang === 'en' ? 'Edit details & restock (WAC)' : 'এডিট ও রিস্টক/গড় ক্রয়মূল্য (WAC)'}
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                              title={t('col_action_delete', lang)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm Opening Button */}
      <div className={`pt-2 flex ${isEasy ? 'justify-stretch w-full' : 'justify-end'}`}>
        {isNotStarted ? (
          <button
            onClick={handleConfirmOpening}
            className={isEasy 
              ? "w-full py-5 text-xl rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-3 cursor-pointer" 
              : "w-full sm:w-auto px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"}
          >
            {isEasy ? <span className="text-2xl">📖</span> : <Check className="w-5 h-5" />}
            {t('open_day_btn', lang)}
          </button>
        ) : (
          <button
            onClick={() => dispatch({ type: 'SET_SCREEN', payload: SCREENS.DASHBOARD })}
            className="w-full sm:w-auto px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm transition-all cursor-pointer"
          >
            {t('go_dashboard', lang)}
          </button>
        )}
      </div>

      {/* Add Product Modal */}
      <AddProductModal
        isOpen={isAddProductOpen}
        onClose={() => setIsAddProductOpen(false)}
        onAddProduct={handleAddProduct}
      />

      {/* Damage / Loss Write-off Modal */}
      <DamageWriteOffModal
        isOpen={isDamageModalOpen}
        onClose={() => setIsDamageModalOpen(false)}
      />

      {/* Stock Audit Modal (IAS 2) */}
      <Suspense fallback={null}>
        <StockAuditModal
          isOpen={isStockAuditOpen}
          onClose={() => setIsStockAuditOpen(false)}
        />
      </Suspense>

      {/* PIN Lock Modal for edit protection */}
      <PinLockModal
        isOpen={showPinModal}
        lang={lang}
        onCancel={() => setShowPinModal(false)}
        onSuccess={async (enteredPin) => {
          const enteredHash = await hashPin(enteredPin);
          if (enteredHash === editLockPinHash) {
            setShowPinModal(false);
            setIsEditingOpening(true);
            return true;
          }
          return false; // Wrong PIN
        }}
      />

      {/* Add Wallet Modal */}
      <AddWalletModal
        isOpen={isAddAccountOpen}
        onClose={() => setIsAddAccountOpen(false)}
        onAdded={(key, bal) => {
          setWalletInputs(prev => ({ ...prev, [key]: String(bal || 0) }));
        }}
      />

      {/* Edit Product & Restock / WAC Modal */}
      <EditProductModal
        isOpen={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        item={editingProduct}
      />

      {/* Edit Wallet Info Modal */}
      <EditWalletModal
        isOpen={Boolean(editingWallet)}
        onClose={() => setEditingWallet(null)}
        wallet={editingWallet}
      />

      {/* Pre-Opening Adjustment Modal */}
      <OpeningAdjustmentModal
        isOpen={isAdjustmentModalOpen}
        onClose={() => setIsAdjustmentModalOpen(false)}
        onAdjusted={(adjWalletKey, amt, adjType) => {
          const isOutflow = adjType === 'expense';
          setWalletInputs(prev => {
            const currentVal = parseFloat(prev[adjWalletKey] || 0);
            const nextVal = isOutflow ? Math.max(0, currentVal - amt) : currentVal + amt;
            return { ...prev, [adjWalletKey]: String(nextVal) };
          });
        }}
      />
    </div>
  );
}

