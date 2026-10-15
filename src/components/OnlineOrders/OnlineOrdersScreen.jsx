import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAppMode } from '../Shared/ModeGuard';
import { formatBDT } from '../../data/calculations';
import { t } from '../../data/translations';
import { getWalletLabel } from '../../data/constants';
import { 
  COURIERS, ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS,
  VALID_TRANSITIONS, calculateCourierCharges, generateWhatsAppMessage,
  getCourierTrackingLink, getCourierOptions, getRecommendedWalletForPayment,
  isWalletCompatibleWithPayment, getSettleErrorMessage
} from '../../data/courierRates';
import { parseStrictMoney } from '../../data/ledgerStateEngine';
import {
  Package, Plus, Search, Filter, Truck, CheckCircle2, XCircle,
  Phone, MapPin, User, Send, Copy, ExternalLink, ChevronDown,
  ChevronUp, Settings, X, AlertTriangle, RotateCcw, Wallet,
  ShoppingBag, TrendingUp, Clock, ArrowRight, Edit3, Trash2,
  Share2, MessageCircle, DollarSign, BarChart3, RefreshCw, Sparkles, Globe,
  ShieldAlert, ShieldCheck, UserX, UserCheck
} from 'lucide-react';
import { useAuth } from '../../firebase/useAuth';
import {
  loadIncomingStoreOrders,
  getShopSlugForUser,
  transferIncomingOrderToBusiness,
  migrateLegacyPublicStoreProducts,
  commitOnlineOrderSettlementToCloud,
  commitPaymentVerificationToCloud,
  commitOrderCancellationToCloud,
  commitOrderReturnToCloud,
  deleteOnlineOrderFromCloud,
} from '../../firebase/firestoreService';
import { evaluateCustomerRisk, normalizePhoneNumber, FRAUD_RISK_LEVELS } from '../../data/customerRiskEngine';

export { commitOnlineOrderSettlementToCloud };
export {
  commitPaymentVerificationToCloud,
  commitOrderCancellationToCloud,
  commitOrderReturnToCloud,
  deleteOnlineOrderFromCloud,
};

export default function OnlineOrdersScreen() {
  const { state, dispatch, applyCloudSettlement } = useApp();
  const { user, isAuthenticated } = useAuth();
  const userId = user?.uid;
  const { dayData, language, onlineOrders = [], courierSettings = {}, customerBlacklist = {} } = state;
  const lang = language || 'bn';
  const isEn = lang === 'en';
  const currSymbol = isEn ? 'Tk' : '৳';
  
  const activeBizId = state.activeBizId || state.activeBiz?.id || 'biz_1';
  const inventory = dayData?.inventory || [];
  const wallets = dayData?.wallets || {};
  const dayStatus = dayData?.status;
  const isDayOpen = dayStatus === 'open';

  // Local UI State
  const [activeTab, setActiveTab] = useState('all');
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showBlacklistModal, setShowBlacklistModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncingStore, setIsSyncingStore] = useState(false);
  const [storeSlug, setStoreSlug] = useState(() => 
    localStorage.getItem(`ledgero_store_slug_${activeBizId}`) || ''
  );
  const [syncToast, setSyncToast] = useState('');

  // Reactively synchronize storeSlug whenever the active business switches
  useEffect(() => {
    const slug = localStorage.getItem(`ledgero_store_slug_${activeBizId}`) || '';
    setStoreSlug(slug);
  }, [activeBizId]);

  const syncWebStoreOrders = async (silent = false, targetBizId = activeBizId) => {
    if (!userId || !targetBizId) return;
    // Fail closed: Never fall back to previous render's storeSlug state; always resolve strictly for targetBizId
    let slug = localStorage.getItem(`ledgero_store_slug_${targetBizId}`) || '';
    const verifiedCloudSlug = await getShopSlugForUser(userId, targetBizId);
    if (verifiedCloudSlug) {
      slug = verifiedCloudSlug;
      setStoreSlug(verifiedCloudSlug);
      localStorage.setItem(`ledgero_store_slug_${targetBizId}`, verifiedCloudSlug);
    } else if (slug) {
      // Verify that any cached localStorage slug actually belongs to this user and targetBizId
      slug = '';
      setStoreSlug('');
      localStorage.removeItem(`ledgero_store_slug_${targetBizId}`);
    }

    if (!slug) {
      if (!silent) {
        setSyncToast(isEn ? 'No published storefront found for this business.' : 'এই ব্যবসার জন্য কোনো ডিজিটাল স্টোরফ্রন্ট পাওয়া যায়নি।');
        setTimeout(() => setSyncToast(''), 4000);
      }
      return;
    }

    if (!silent) setIsSyncingStore(true);
    try {
      // Item 6: Opportunistically sanitize any legacy public product docs in this storefront
      migrateLegacyPublicStoreProducts(slug).catch(() => {});

      const incoming = await loadIncomingStoreOrders(slug);
      if (incoming.length > 0) {
        const persistedOrders = [];
        for (const order of incoming) {
          try {
            // Item 4: Verified business-isolated, idempotent Copy-Before-Delete transfer with Item 3 catalog check
            const transferRes = await transferIncomingOrderToBusiness(
              userId,
              targetBizId,
              slug,
              order,
              null,
              inventory
            );
            if (transferRes?.transferred && transferRes?.order) {
              persistedOrders.push(transferRes.order);
            }
          } catch (writeErr) {
            console.error(`[Ledgero] Failed to durably transfer storefront order ${order.id}. Retaining in queue:`, writeErr);
          }
        }

        if (persistedOrders.length > 0) {
          dispatch({ type: 'INGEST_STORE_ORDERS', payload: persistedOrders });
          setSyncToast(
            isEn 
              ? `Durable sync: ${persistedOrders.length} web order${persistedOrders.length > 1 ? 's' : ''} saved safely!` 
              : `🎉 ${persistedOrders.length}টি নতুন ওয়েব অর্ডার নিরাপদে সংরক্ষণ করা হয়েছে!`
          );
          setTimeout(() => setSyncToast(''), 4000);
        } else if (!silent) {
          setSyncToast(isEn ? 'Failed to persist web orders to cloud.' : 'ওয়েব অর্ডার ক্লাউডে সেভ করতে সমস্যা হয়েছে।');
          setTimeout(() => setSyncToast(''), 4000);
        }
      } else if (!silent) {
        setSyncToast(isEn ? 'All web orders up to date.' : 'নতুন কোনো ওয়েব অর্ডার নেই।');
        setTimeout(() => setSyncToast(''), 3000);
      }
    } catch (err) {
      console.warn('Sync web orders error:', err);
      if (!silent) {
        setSyncToast(isEn ? 'Failed to sync web orders' : 'ওয়েব অর্ডার সিঙ্ক করতে সমস্যা হয়েছে');
        setTimeout(() => setSyncToast(''), 4000);
      }
    } finally {
      if (!silent) setIsSyncingStore(false);
    }
  };

  useEffect(() => {
    if (userId && activeBizId) {
      syncWebStoreOrders(true, activeBizId);
    }
  }, [userId, activeBizId]);

  // Stats Calculations
  const stats = useMemo(() => {
    let pending = 0;
    let delivered = 0;
    let returned = 0;
    let courierAR = 0;

    onlineOrders.forEach(order => {
      const s = order.status;
      if (['draft', 'confirmed', 'packed', 'shipped'].includes(s)) pending++;
      if (s === 'delivered') delivered++;
      if (s === 'returned') returned++;
      if (s === 'delivered') courierAR += (order.netFromCourier || 0);
    });

    return { total: onlineOrders.length, pending, delivered, returned, courierAR };
  }, [onlineOrders]);

  // Tab Filtering
  const filteredOrders = useMemo(() => {
    let filtered = onlineOrders;
    
    if (activeTab !== 'all') {
      filtered = filtered.filter(o => o.status === activeTab);
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(o => 
        o.customerName?.toLowerCase().includes(q) ||
        o.customerPhone?.includes(q) ||
        o.id?.toLowerCase().includes(q) ||
        o.trackingNumber?.toLowerCase().includes(q)
      );
    }
    
    return filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [onlineOrders, activeTab, searchQuery]);

  const tabs = [
    { id: 'all', label: isEn ? 'All' : 'সব' },
    { id: 'draft', label: isEn ? 'Draft' : 'খসড়া' },
    { id: 'confirmed', label: isEn ? 'Confirmed' : 'কনফার্মড' },
    { id: 'packed', label: isEn ? 'Packed' : 'প্যাকড' },
    { id: 'shipped', label: isEn ? 'Shipped' : 'শিপড' },
    { id: 'delivered', label: isEn ? 'Delivered' : 'ডেলিভারড' },
    { id: 'settled', label: isEn ? 'Settled' : 'সেটেলড' },
    { id: 'returned', label: isEn ? 'Returned' : 'রিটার্নড' },
    { id: 'cancelled', label: isEn ? 'Cancelled' : 'বাতিল' }
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 w-full overflow-hidden relative pb-20 md:pb-0">
      {/* HEADER */}
      <div className="bg-white dark:bg-slate-800 shadow-sm z-10 shrink-0 border-b border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Truck className="w-6 h-6 text-emerald-600 dark:text-emerald-500" />
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              {isEn ? 'Online Orders' : 'অনলাইন অর্ডার'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => syncWebStoreOrders(false)}
              disabled={isSyncingStore}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-sky-600 dark:text-sky-400 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer flex items-center gap-1.5 text-xs sm:text-sm font-semibold"
              title={isEn ? 'Sync Web Store Orders' : 'ওয়েব অর্ডার সিঙ্ক করুন'}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingStore ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isEn ? 'Sync Web' : 'ওয়েব সিঙ্ক'}</span>
            </button>
            <button
              onClick={() => setShowBlacklistModal(true)}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-rose-600 dark:text-rose-400 transition-colors border border-rose-200 dark:border-rose-900/50 cursor-pointer flex items-center gap-1.5 text-xs sm:text-sm font-semibold"
              title={isEn ? 'Fraud & Blacklist' : 'গ্রাহক ফ্রড ও ব্ল্যাকলিস্ট'}
            >
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              <span className="hidden sm:inline">{isEn ? 'Blacklist' : 'ব্ল্যাকলিস্ট'}</span>
              {Object.keys(customerBlacklist).length > 0 && (
                <span className="bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 px-1.5 py-0.2 rounded-full text-xs font-bold">
                  {Object.keys(customerBlacklist).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>{isEn ? 'New Order' : 'নতুন অর্ডার'}</span>
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
              title={isEn ? 'Courier Settings' : 'কুরিয়ার সেটিংস'}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {syncToast && (
          <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 border-t border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{syncToast}</span>
            </div>
            <button onClick={() => setSyncToast('')} className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-800/40 rounded-full cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!isDayOpen && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/30 border-t border-amber-200 dark:border-amber-800 flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p>{isEn ? 'Day is not started yet. New orders will be saved as drafts.' : 'দিন এখনও শুরু হয়নি। নতুন অর্ডারগুলো খসড়া (Draft) হিসেবে সেভ হবে।'}</p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto w-full">
        {/* SETTINGS SECTION */}
        {showSettings && (
          <SettingsSection 
            settings={courierSettings} 
            dispatch={dispatch} 
            isEn={isEn} 
            onClose={() => setShowSettings(false)} 
          />
        )}

        {/* CREATE ORDER SECTION */}
        {showCreateForm && (
          <CreateOrderForm 
            isEn={isEn} 
            settings={courierSettings}
            inventory={inventory}
            wallets={wallets}
            customerBlacklist={customerBlacklist}
            onlineOrders={onlineOrders}
            dispatch={dispatch}
            onClose={() => setShowCreateForm(false)}
          />
        )}

        {/* STATS BAR */}
        <div className="p-4 grid grid-cols-2 gap-3 shrink-0">
          <StatCard title={isEn ? 'Total Orders' : 'মোট অর্ডার'} value={stats.total} icon={ShoppingBag} color="blue" />
          <StatCard title={isEn ? 'Pending' : 'পেন্ডিং'} value={stats.pending} icon={Clock} color="amber" />
          <StatCard title={isEn ? 'Delivered' : 'ডেলিভারি'} value={stats.delivered} icon={CheckCircle2} color="emerald" />
          <StatCard title={isEn ? 'Returned/RTO' : 'রিটার্ন (RTO)'} value={stats.returned} icon={RotateCcw} color="rose" />
        </div>

        {/* AR STAT */}
        <div className="px-4 mb-4">
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex justify-between items-center">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
              <Wallet className="w-5 h-5" />
              <span className="font-medium">{isEn ? 'Courier Receivable (AR)' : 'কুরিয়ারে পাওনা'}</span>
            </div>
            <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {formatBDT(stats.courierAR, isEn ? 'en' : 'bn')}
            </span>
          </div>
        </div>

        {/* FILTER TABS & SEARCH */}
        <div className="px-4 mb-4 sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 pt-2 pb-2">
          <div className="relative mb-3">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={isEn ? 'Search orders...' : 'অর্ডার খুঁজুন...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
          <div className="flex overflow-x-auto hide-scrollbar gap-2 pb-1">
            {tabs.map(tab => {
              const count = tab.id === 'all' 
                ? onlineOrders.length 
                : onlineOrders.filter(o => o.status === tab.id).length;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors
                    ${isActive 
                      ? 'bg-emerald-600 text-white shadow-sm' 
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }
                  `}
                >
                  {tab.label}
                  <span className={`px-1.5 py-0.5 rounded-full text-xs ${isActive ? 'bg-emerald-700 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ORDER LIST */}
        <div className="px-4 pb-10 flex flex-col gap-4">
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4">
                <Package className="w-8 h-8 text-slate-400 dark:text-slate-500" />
              </div>
              <h3 className="text-lg font-medium text-slate-800 dark:text-slate-200 mb-1">
                {isEn ? 'No online orders yet' : 'এখনও কোনো অনলাইন অর্ডার নেই'}
              </h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                {isEn ? 'Create your first online order to track shipping & COD.' : 'কুরিয়ার ডেলিভারি ও COD ট্র্যাক করতে প্রথম অর্ডার তৈরি করুন।'}
              </p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                <Plus className="w-5 h-5 stroke-[2.5]" />
                <span>{isEn ? 'Create First Order' : 'প্রথম অর্ডার তৈরি করুন'}</span>
              </button>
            </div>
          ) : (
            filteredOrders.map(order => (
              <OrderCard 
                key={order.id} 
                order={order} 
                isEn={isEn} 
                currSymbol={currSymbol}
                wallets={wallets}
                customerBlacklist={customerBlacklist}
                onlineOrders={onlineOrders}
                dispatch={dispatch} 
                orderSettleError={state._orderSettleError}
                isAuthenticated={Boolean(isAuthenticated)}
                userId={userId}
                user={user}
                applyCloudSettlement={applyCloudSettlement}
                activeBizId={activeBizId}
                dateKey={dayData?.dateKey}
                state={state}
              />
            ))
          )}
        </div>
      </div>

      {/* FLOATING ACTION BUTTON */}
      {!showCreateForm && (
        <button
          onClick={() => setShowCreateForm(true)}
          className="fixed bottom-20 md:bottom-8 right-6 md:right-8 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3.5 rounded-full shadow-2xl hover:shadow-emerald-950/60 transition-all flex items-center gap-2 group z-30 focus:outline-none focus:ring-4 focus:ring-emerald-500/30 cursor-pointer"
        >
          <Plus className="w-6 h-6 stroke-[3]" />
          <span className="font-bold text-sm">{isEn ? 'New Order' : 'নতুন অর্ডার'}</span>
        </button>
      )}

      {/* BLACKLIST & FRAUD REGISTRY MODAL */}
      {showBlacklistModal && (
        <BlacklistModal 
          isOpen={showBlacklistModal}
          onClose={() => setShowBlacklistModal(false)}
          customerBlacklist={customerBlacklist}
          dispatch={dispatch}
          isEn={isEn}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// SETTINGS SECTION COMPONENT
// ----------------------------------------------------------------------------
function SettingsSection({ settings, dispatch, isEn, onClose }) {
  const [formData, setFormData] = useState({
    bkashNumber: settings.bkashNumber || '',
    nagadNumber: settings.nagadNumber || '',
    rocketNumber: settings.rocketNumber || '',
    insideDhakaCharge: settings.insideDhakaCharge || 60,
    outsideDhakaCharge: settings.outsideDhakaCharge || 120
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: (name.includes('Charge')) ? Number(value) : value
    }));
  };

  const handleSave = () => {
    dispatch({ type: 'SET_COURIER_SETTINGS', payload: formData });
    onClose();
  };

  return (
    <div className="bg-white dark:bg-slate-800 m-4 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm animate-in fade-in slide-in-from-top-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
          <Settings className="w-5 h-5 text-emerald-600" />
          {isEn ? 'Courier & Payment Settings' : 'কুরিয়ার ও পেমেন্ট সেটিংস'}
        </h2>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{isEn ? 'Inside Dhaka Charge' : 'ঢাকার ভিতর চার্জ'}</label>
            <input type="number" name="insideDhakaCharge" value={formData.insideDhakaCharge} onChange={handleChange} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{isEn ? 'Outside Dhaka Charge' : 'ঢাকার বাইরে চার্জ'}</label>
            <input type="number" name="outsideDhakaCharge" value={formData.outsideDhakaCharge} onChange={handleChange} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100" />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 pt-2">{isEn ? 'Payment Receiving Numbers' : 'পেমেন্ট রিসিভিং নাম্বার'}</h3>
          <div>
            <input type="text" name="bkashNumber" placeholder="bKash Number" value={formData.bkashNumber} onChange={handleChange} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <input type="text" name="nagadNumber" placeholder="Nagad Number" value={formData.nagadNumber} onChange={handleChange} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <input type="text" name="rocketNumber" placeholder="Rocket Number" value={formData.rocketNumber} onChange={handleChange} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100" />
          </div>
        </div>

        <button onClick={handleSave} className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 rounded-xl transition-colors min-h-[44px]">
          {isEn ? 'Save Settings' : 'সেটিংস সেভ করুন'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// CREATE ORDER FORM COMPONENT
// ----------------------------------------------------------------------------
function CreateOrderForm({ isEn, settings, inventory, wallets, customerBlacklist, onlineOrders, dispatch, onClose }) {
  const currSymbol = isEn ? 'Tk' : '৳';
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [isInsideDhaka, setIsInsideDhaka] = useState(false);
  const [courierName, setCourierName] = useState('steadfast');
  
  // Start with 1 item (custom product by default so user can type ANY product name directly)
  const [cart, setCart] = useState([
    { isCustom: true, productId: '', productName: '', unitPrice: '', buyPrice: '', quantity: 1 }
  ]);
  
  const defaultDeliveryCharge = isInsideDhaka 
    ? (settings.insideDhakaCharge || 100) 
    : (settings.outsideDhakaCharge || 150);
  
  const [deliveryChargeInput, setDeliveryChargeInput] = useState('');
  const deliveryCharge = deliveryChargeInput !== '' ? Math.max(0, Number(deliveryChargeInput)) : defaultDeliveryCharge;

  const [advancePaid, setAdvancePaid] = useState('');
  const [advanceWallet, setAdvanceWallet] = useState(Object.keys(wallets)[0] || 'bkash');

  // Real-time automated customer risk & fraud evaluation
  const customerRisk = useMemo(() => {
    return evaluateCustomerRisk({
      phone: customerPhone,
      onlineOrders: onlineOrders || [],
      customerBlacklist: customerBlacklist || {},
      deliveryCharge,
      language: isEn ? 'en' : 'bn'
    });
  }, [customerPhone, onlineOrders, customerBlacklist, deliveryCharge, isEn]);

  const isBlacklisted = customerRisk.hasWarning;

  // Calculate totals
  const { totalAmount, items } = useMemo(() => {
    let total = 0;
    const resolvedItems = [];
    cart.forEach(c => {
      if (c.isCustom) {
        const name = (c.productName || '').trim();
        const uPrice = Number(c.unitPrice) || 0;
        const bPrice = Number(c.buyPrice) || 0;
        const qty = Math.max(1, Number(c.quantity) || 1);
        if (name && uPrice > 0) {
          const subtotal = uPrice * qty;
          total += subtotal;
          resolvedItems.push({
            productId: null,
            productName: name,
            quantity: qty,
            unitPrice: uPrice,
            buyPrice: bPrice,
            subtotal
          });
        }
      } else if (c.productId) {
        const prod = inventory.find(i => i.id === c.productId);
        if (prod) {
          const qty = Math.max(1, Number(c.quantity) || 1);
          const uPrice = Number(prod.sellPrice) || 0;
          const bPrice = Number(prod.buyPrice) || 0;
          const subtotal = uPrice * qty;
          total += subtotal;
          resolvedItems.push({
            productId: prod.id,
            productName: prod.name,
            quantity: qty,
            unitPrice: uPrice,
            buyPrice: bPrice,
            subtotal
          });
        }
      }
    });
    return { totalAmount: total, items: resolvedItems };
  }, [cart, inventory]);

  const totalValue = totalAmount + deliveryCharge;
  const adv = advancePaid === '' ? deliveryCharge : Math.max(0, Number(advancePaid));
  const codAmount = Math.max(0, totalValue - adv);

  // Courier charges
  const cCharges = useMemo(() => {
    return calculateCourierCharges(courierName, codAmount, isInsideDhaka, 1); // defaulting to 1kg
  }, [courierName, codAmount, isInsideDhaka]);

  const handleAddCustomItem = () => {
    setCart(prev => [...prev, { isCustom: true, productId: '', productName: '', unitPrice: '', buyPrice: '', quantity: 1 }]);
  };

  const handleAddInventoryItem = () => {
    setCart(prev => [...prev, { isCustom: false, productId: '', productName: '', unitPrice: '', buyPrice: '', quantity: 1 }]);
  };

  const handleRemoveItem = (index) => {
    if (cart.length > 1) {
      setCart(prev => prev.filter((_, i) => i !== index));
    } else {
      setCart([{ isCustom: true, productId: '', productName: '', unitPrice: '', buyPrice: '', quantity: 1 }]);
    }
  };

  const handleSwitchMode = (index, isCustom) => {
    setCart(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return isCustom 
        ? { isCustom: true, productId: '', productName: '', unitPrice: '', buyPrice: '', quantity: item.quantity || 1 }
        : { isCustom: false, productId: '', productName: '', unitPrice: '', buyPrice: '', quantity: item.quantity || 1 };
    }));
  };

  const handleItemChange = (index, field, value) => {
    setCart(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item };
      if (field === 'quantity') {
        updated.quantity = Math.max(1, Number(value) || 1);
      } else if (field === 'productId') {
        const prod = inventory.find(p => p.id === value);
        updated.productId = value;
        if (prod) {
          updated.productName = prod.name;
          updated.unitPrice = prod.sellPrice;
          updated.buyPrice = prod.buyPrice;
        }
      } else {
        updated[field] = value;
      }
      return updated;
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!customerName || !customerPhone || !customerAddress) {
      return alert(isEn ? 'Please fill customer details (Name, Phone, Address)' : 'কাস্টমারের নাম, ফোন নম্বর ও সম্পূর্ণ ঠিকানা দিন');
    }
    if (items.length === 0) {
      return alert(isEn ? 'Add at least one product with name and price' : 'কমপক্ষে একটি প্রোডাক্টের নাম ও বিক্রয় মূল্য দিন');
    }
    if (adv > 0 && !advanceWallet) {
      return alert(isEn ? 'Select wallet for advance payment' : 'অগ্রিম টাকার জন্য ওয়ালেট সিলেক্ট করুন (যেমন: bKash/Nagad)');
    }

    const payload = {
      customerName,
      customerPhone,
      customerAddress,
      isInsideDhaka,
      items,
      totalAmount,
      deliveryCharge,
      advancePaid: adv,
      advanceWallet: adv > 0 ? advanceWallet : null,
      codAmount,
      courierName,
      courierCharge: cCharges.deliveryCharge,
      codFee: cCharges.codFee,
      totalCourierCost: cCharges.totalCourierCost,
      netFromCourier: cCharges.netFromCourier,
      returnCharge: cCharges.returnCharge
    };

    dispatch({ type: 'ONLINE_ORDER_CREATE', payload });
    onClose();
  };

  return (
    <div className="bg-white dark:bg-slate-800 m-4 rounded-2xl p-5 border border-emerald-200 dark:border-emerald-800/50 shadow-md">
      <div className="flex justify-between items-center mb-5 border-b border-slate-100 dark:border-slate-700 pb-3">
        <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
          <Plus className="w-5 h-5 text-emerald-600 bg-emerald-100 dark:bg-emerald-900/50 rounded-full p-0.5" />
          {isEn ? 'New Online Order' : 'নতুন অনলাইন অর্ডার'}
        </h2>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Customer Details */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
            <User className="w-4 h-4" /> {isEn ? 'Customer Info' : 'কাস্টমারের তথ্য'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input 
              required 
              type="text" 
              placeholder={isEn ? 'Customer Name *' : 'কাস্টমারের নাম * (যেমন: আরিফ হাসান)'} 
              value={customerName} 
              onChange={e => setCustomerName(e.target.value)} 
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100 min-h-[44px]" 
            />
            <div className="relative">
              <input 
                required 
                type="tel" 
                placeholder={isEn ? 'Phone Number *' : 'মোবাইল নম্বর * (যেমন: 01712345678)'} 
                value={customerPhone} 
                onChange={e => setCustomerPhone(e.target.value)} 
                className={`w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border rounded-xl focus:ring-2 outline-none text-slate-800 dark:text-slate-100 min-h-[44px] ${customerRisk.riskLevel === 'high' ? 'border-rose-500 focus:ring-rose-500' : customerRisk.riskLevel === 'moderate' ? 'border-amber-500 focus:ring-amber-500' : customerRisk.riskLevel === 'low' ? 'border-emerald-500 focus:ring-emerald-500' : 'border-slate-200 dark:border-slate-700 focus:ring-emerald-500'}`} 
              />
              {customerRisk.riskLevel === 'high' && <ShieldAlert className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-rose-500" title={customerRisk.warningTitle} />}
              {customerRisk.riskLevel === 'moderate' && <AlertTriangle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-amber-500" title={customerRisk.warningTitle} />}
              {customerRisk.riskLevel === 'low' && <ShieldCheck className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-500" title="Trusted Customer" />}
            </div>
          </div>

          {/* Real-time Customer Risk / RTO Warning Alert */}
          {customerRisk.hasWarning && (
            <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${customerRisk.riskLevel === 'high' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'} animate-in fade-in duration-200`}>
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <div className="flex-1 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm leading-tight">{customerRisk.warningTitle}</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                      {customerRisk.badgeLabel}
                    </span>
                  </div>
                  <p className="mt-1 opacity-90">{customerRisk.warningMessage}</p>
                  <p className="mt-1.5 font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1">
                    <span>💡 {customerRisk.actionAdvice}</span>
                  </p>
                </div>
              </div>
              {adv < deliveryCharge && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setAdvancePaid(String(deliveryCharge))}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{isEn ? `Auto-Set Advance = ৳${deliveryCharge}` : `🛡️ অগ্রিম ৳${deliveryCharge} ডেলিভারি চার্জ নির্ধারণ করুন`}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {customerRisk.riskLevel === 'low' && (
            <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{customerRisk.badgeLabel} — {isEn ? 'Good completion record!' : 'অতীতে সব পার্সেল সফলভাবে ডেলিভারি হয়েছে!'}</span>
            </div>
          )}
          <textarea 
            required 
            placeholder={isEn ? 'Full Address (House, Road, Area, District) *' : 'সম্পূর্ণ ডেলিভারি ঠিকানা (বাসা/রোড/থানা/জেলা) *'} 
            value={customerAddress} 
            onChange={e => setCustomerAddress(e.target.value)} 
            rows="2" 
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100 resize-none"
          ></textarea>
          
          <label className="flex items-center gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isInsideDhaka} 
              onChange={e => setIsInsideDhaka(e.target.checked)} 
              className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 dark:bg-slate-800 dark:border-slate-600 accent-emerald-600" 
            />
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {isEn ? 'Inside Dhaka Delivery' : 'ঢাকার ভিতর ডেলিভারি'} <span className="text-xs text-slate-400">({isInsideDhaka ? `ডিফল্ট ৳${settings.insideDhakaCharge || 100}` : `ঢাকার বাইরে ৳${settings.outsideDhakaCharge || 150}`})</span>
            </span>
          </label>
        </div>

        {/* Products */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <Package className="w-4 h-4" /> {isEn ? 'Products to Order' : 'প্রোডাক্টসমূহ (যেকোনো প্রোডাক্ট)'}
            </h3>
            <span className="text-xs text-slate-400">
              {isEn ? 'Type any custom product or choose from stock' : 'যেকোনো নাম ও দাম লিখে সরাসরি অর্ডার করুন'}
            </span>
          </div>
          
          {cart.map((item, index) => (
            <div key={index} className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  {item.isCustom ? (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{isEn ? `Item #${index + 1} (Custom Product)` : `আইটেম #${index + 1} (যেকোনো প্রোডাক্ট)`}</span>
                    </>
                  ) : (
                    <>
                      <Package className="w-3.5 h-3.5" />
                      <span>{isEn ? `Item #${index + 1} (From Inventory)` : `আইটেম #${index + 1} (ইনভেন্টরি থেকে)`}</span>
                    </>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {inventory.length > 0 && (
                    <button 
                      type="button" 
                      onClick={() => handleSwitchMode(index, !item.isCustom)} 
                      className="text-sky-600 dark:text-sky-400 hover:underline text-xs"
                    >
                      {item.isCustom 
                        ? (isEn ? '📦 Pick from Inventory' : '📦 ইনভেন্টরি থেকে বাছুন') 
                        : (isEn ? '✍️ Type custom product' : '✍️ কাস্টম নাম লিখুন')}
                    </button>
                  )}
                  {cart.length > 1 && (
                    <button 
                      type="button" 
                      onClick={() => handleRemoveItem(index)} 
                      className="text-rose-500 hover:text-rose-700 p-1"
                      title={isEn ? 'Remove item' : 'মুছুন'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {item.isCustom ? (
                /* CUSTOM PRODUCT INPUT ROW */
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-6">
                      <input 
                        type="text" 
                        required 
                        placeholder={isEn ? "Product name (e.g. Cotton Shirt, Watch...)" : "প্রোডাক্টের নাম (যেমন: থ্রি-পিস, টি-শার্ট, ঘড়ি...)"}
                        value={item.productName || ''} 
                        onChange={e => handleItemChange(index, 'productName', e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500 min-h-[40px]"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{currSymbol}</span>
                        <input 
                          type="number" 
                          required 
                          min="0"
                          placeholder={isEn ? "Sell Price" : "বিক্রয় মূল্য ৳"}
                          value={item.unitPrice || ''} 
                          onChange={e => handleItemChange(index, 'unitPrice', e.target.value)}
                          className="w-full pl-6 pr-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500 min-h-[40px]"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <input 
                        type="number" 
                        min="1" 
                        value={item.quantity || 1} 
                        onChange={e => handleItemChange(index, 'quantity', e.target.value)}
                        className="w-full px-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-center text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500 min-h-[40px]"
                        placeholder="Qty"
                        title={isEn ? "Quantity" : "পরিমাণ"}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
                    <div className="flex items-center gap-1.5">
                      <span>{isEn ? 'Cost / Buy Price (optional for profit):' : 'কেনা দাম (ঐচ্ছিক, লাভ জানার জন্য):'}</span>
                      <div className="relative w-24">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{currSymbol}</span>
                        <input 
                          type="number" 
                          min="0"
                          placeholder="কেনা ৳"
                          value={item.buyPrice || ''} 
                          onChange={e => handleItemChange(index, 'buyPrice', e.target.value)}
                          className="w-full pl-5 pr-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {isEn ? 'Item Subtotal:' : 'মোট:'} {formatBDT((Number(item.unitPrice) || 0) * (Number(item.quantity) || 1), isEn ? 'en' : 'bn')}
                    </span>
                  </div>
                </div>
              ) : (
                /* INVENTORY ITEM DROPDOWN ROW */
                <div className="flex gap-2 items-center">
                  <select 
                    value={item.productId} 
                    onChange={e => handleItemChange(index, 'productId', e.target.value)}
                    className="flex-1 bg-white dark:bg-slate-800 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg outline-none text-slate-800 dark:text-slate-100 truncate text-sm min-h-[40px]"
                    required
                  >
                    <option value="">{isEn ? 'Select product...' : 'প্রোডাক্ট নির্বাচন করুন...'}</option>
                    {inventory.map(prod => (
                      <option key={prod.id} value={prod.id}>
                        {prod.name} (স্টক: {prod.closingStock || 0}) - {currSymbol}{prod.sellPrice || 0}
                      </option>
                    ))}
                  </select>
                  <input 
                    type="number" 
                    min="1" 
                    value={item.quantity || ''} 
                    onChange={e => handleItemChange(index, 'quantity', e.target.value)}
                    className="w-16 px-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-center outline-none text-slate-800 dark:text-slate-100 min-h-[40px] text-sm"
                    placeholder="Qty"
                    required
                  />
                  <div className="text-right text-xs font-semibold text-slate-700 dark:text-slate-300 min-w-[70px]">
                    {formatBDT((Number(item.unitPrice) || 0) * (Number(item.quantity) || 1), isEn ? 'en' : 'bn')}
                  </div>
                </div>
              )}
            </div>
          ))}
          
          <div className="flex flex-wrap gap-2 pt-1">
            <button 
              type="button" 
              onClick={handleAddCustomItem} 
              className="text-xs sm:text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 border border-emerald-300 dark:border-emerald-800 font-semibold flex items-center gap-1.5 px-3 py-2 rounded-xl transition-colors cursor-pointer min-h-[40px]"
            >
              <Plus className="w-4 h-4 stroke-[3]" /> {isEn ? '+ Add Custom Product' : '+ ✍️ যেকোনো নতুন প্রোডাক্ট যোগ করুন'}
            </button>
            {inventory.length > 0 && (
              <button 
                type="button" 
                onClick={handleAddInventoryItem} 
                className="text-xs sm:text-sm text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 border border-sky-300 dark:border-sky-800 font-semibold flex items-center gap-1.5 px-3 py-2 rounded-xl transition-colors cursor-pointer min-h-[40px]"
              >
                <Package className="w-4 h-4" /> {isEn ? '+ Add From Inventory' : '+ 📦 ইনভেন্টরি থেকে যোগ করুন'}
              </button>
            )}
          </div>
        </div>

        {/* Courier & Delivery Charges */}
        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{isEn ? 'Courier Service' : 'কুরিয়ার সার্ভিস'}</label>
              <select value={courierName} onChange={e => setCourierName(e.target.value)} className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-slate-800 dark:text-slate-100 min-h-[44px]">
                {Object.entries(COURIERS).map(([key, c]) => <option key={key} value={key}>{c.icon} {isEn ? c.name : c.name_bn}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                {isEn ? 'Delivery Charge Paid by Customer' : 'কাস্টমারকে ধার্যকৃত ডেলিভারি চার্জ'}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{currSymbol}</span>
                <input 
                  type="number" 
                  min="0"
                  placeholder={String(defaultDeliveryCharge)} 
                  value={deliveryChargeInput} 
                  onChange={e => setDeliveryChargeInput(e.target.value)} 
                  className="w-full pl-7 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100 min-h-[44px]" 
                />
              </div>
            </div>
          </div>

          {/* Advance Payment Section */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {isEn ? 'Advance Payment Taken' : 'কাস্টমারের থেকে নেওয়া অগ্রিম টাকা'}
                </label>
                <p className="text-[11px] text-slate-400">
                  {isEn ? 'Usually delivery charge (৳100/150) taken in advance' : 'সাধারণত ডেলিভারি চার্জ অগ্রিম নেওয়া হয় যাতে পার্সেল রিটার্ন না আসে'}
                </p>
              </div>
              <div className="relative w-full sm:w-44">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{currSymbol}</span>
                <input 
                  type="number" 
                  min="0"
                  placeholder={String(deliveryCharge)} 
                  value={advancePaid} 
                  onChange={e => setAdvancePaid(e.target.value)} 
                  className="w-full pl-7 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100 font-bold min-h-[40px]" 
                />
              </div>
            </div>

            {/* Quick Presets for Advance */}
            <div className="flex flex-wrap gap-2 text-xs">
              <button 
                type="button" 
                onClick={() => setAdvancePaid(String(deliveryCharge))}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${adv === deliveryCharge ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'}`}
              >
                {isEn ? `Delivery Charge (৳${deliveryCharge})` : `শুধু ডেলিভারি চার্জ (৳${deliveryCharge})`}
              </button>
              <button 
                type="button" 
                onClick={() => setAdvancePaid('0')}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${adv === 0 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'}`}
              >
                {isEn ? 'Full COD (৳0 Advance)' : 'ফুল ক্যাশ অন ডেলিভারি (৳০)'}
              </button>
              <button 
                type="button" 
                onClick={() => setAdvancePaid(String(totalValue))}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${adv === totalValue ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'}`}
              >
                {isEn ? `Full Paid (৳${totalValue})` : `পুরো টাকা পেইড (৳${totalValue})`}
              </button>
            </div>

            {adv > 0 && (
              <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800">
                <label className="block text-xs font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                  {isEn ? 'Advance Received In Wallet *' : 'অগ্রিম টাকা কোন ওয়ালেটে রিসিভ করেছেন? *'}
                </label>
                <select 
                  value={advanceWallet} 
                  onChange={e => setAdvanceWallet(e.target.value)} 
                  required 
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100 min-h-[40px]"
                >
                  {Object.entries(wallets).map(([id, w]) => (
                    <option key={id} value={id}>{getWalletLabel(id, isEn ? 'en' : 'bn', w)}</option>
                  ))}
                </select>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                  {isEn 
                    ? `✓ ৳${adv} will be added to this wallet upon order creation.` 
                    : `✓ অর্ডার সাবমিট করলেই ৳${adv} এই ওয়ালেটে জমা হয়ে যাবে।`}
                </p>
              </div>
            )}
          </div>

          {/* Financial Breakdown */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>{isEn ? 'Products Subtotal' : 'প্রোডাক্টের মোট মূল্য'}:</span>
              <span>{formatBDT(totalAmount, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>{isEn ? 'Delivery Charge' : 'ডেলিভারি চার্জ'}:</span>
              <span>+{formatBDT(deliveryCharge, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between font-medium text-slate-800 dark:text-slate-200">
              <span>{isEn ? 'Total Customer Bill' : 'কাস্টমারের মোট বিল'}:</span>
              <span>{formatBDT(totalValue, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between text-emerald-600 dark:text-emerald-500">
              <span>{isEn ? 'Advance Paid' : 'অ্যাডভান্স জমা'}:</span>
              <span>-{formatBDT(adv, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between font-bold text-lg text-slate-800 dark:text-slate-100 pt-1 border-t border-slate-200 dark:border-slate-700">
              <span>{isEn ? 'Cash on Delivery (COD Due)' : 'কুরিয়ারে বাকি (COD)'}:</span>
              <span className="text-emerald-600 dark:text-emerald-400">{formatBDT(codAmount, isEn ? 'en' : 'bn')}</span>
            </div>
          </div>
          
          {/* Courier Settlement Math */}
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 text-xs space-y-1 border border-emerald-100 dark:border-emerald-800/50">
            <p className="font-semibold text-emerald-800 dark:text-emerald-400 mb-2">
              {isEn ? 'Estimated Courier Settlement' : 'কুরিয়ার থেকে আপনার একাউন্টে কী আসবে (হিসাব)'}:
            </p>
            <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
              <span>{isEn ? 'Courier Delivery Fee' : 'কুরিয়ারের ডেলিভারি ফি'}:</span>
              <span>{formatBDT(cCharges.deliveryCharge, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
              <span>{isEn ? 'Courier COD Fee (1%)' : 'কুরিয়ার COD ফি'}:</span>
              <span>{formatBDT(cCharges.codFee, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between font-bold text-emerald-800 dark:text-emerald-400 pt-1 border-t border-emerald-200 dark:border-emerald-800">
              <span>{isEn ? 'Net Receivable (Payout from Courier)' : 'কুরিয়ার থেকে আপনি পাবেন'}:</span>
              <span className="text-sm">{formatBDT(cCharges.netFromCourier, isEn ? 'en' : 'bn')}</span>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button 
            type="submit" 
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 min-h-[48px] cursor-pointer"
          >
            <CheckCircle2 className="w-5 h-5" />
            {isEn ? 'Create Order Now' : 'অর্ডার তৈরি করুন'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ----------------------------------------------------------------------------
// INDIVIDUAL ORDER CARD COMPONENT
// ----------------------------------------------------------------------------
function OrderCard({ 
  order, 
  isEn, 
  currSymbol, 
  wallets, 
  customerBlacklist, 
  onlineOrders, 
  dispatch, 
  orderSettleError,
  isAuthenticated = false,
  userId = null,
  user: propUser = null,
  applyCloudSettlement: propApplyCloudSettlement = null,
  activeBizId = null,
  dateKey = null,
  state = null,
}) {
  const { applyCloudSettlement: contextApplyCloudSettlement } = useApp();
  const { user: authUser } = useAuth();
  const user = propUser || authUser;
  const applyCloudSettlement = propApplyCloudSettlement || contextApplyCloudSettlement;

  const [expanded, setExpanded] = useState(false);
  const [shippingMode, setShippingMode] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  
  const [settlingMode, setSettlingMode] = useState(false);
  const [settlementWallet, setSettlementWallet] = useState('');
  const [showAdjustmentInput, setShowAdjustmentInput] = useState(false);
  const [actualNetInput, setActualNetInput] = useState('');
  const [allowAdjustmentChecked, setAllowAdjustmentChecked] = useState(false);
  const [adjustmentReasonText, setAdjustmentReasonText] = useState('');
  const [settleLocalError, setSettleLocalError] = useState('');
  const [isSettling, setIsSettling] = useState(false);

  // Auto-close settlingMode only when order successfully reaches settled status
  useEffect(() => {
    if (order.status === 'settled') {
      setSettlingMode(false);
      setSettleLocalError('');
      setShowAdjustmentInput(false);
      setIsSettling(false);
    }
  }, [order.status]);

  // When orderSettleError occurs for this order, reveal adjustment panel if net mismatch
  useEffect(() => {
    if (orderSettleError && orderSettleError.orderId === order.id) {
      if (orderSettleError.code === 'net_fee_mismatch') {
        setShowAdjustmentInput(true);
        if (orderSettleError.netAmount !== undefined) {
          setActualNetInput(String(orderSettleError.netAmount));
        }
      }
    }
  }, [orderSettleError, order.id]);

  const s = order.status;
  const statusColorClass = ORDER_STATUS_COLORS[s] || 'bg-slate-100 text-slate-800 border-slate-200';
  const statusLabel = ORDER_STATUS_LABELS[s]?.[isEn ? 'en' : 'bn'] || s;
  
  // Real-time automated customer risk & fraud evaluation
  const customerRisk = useMemo(() => {
    return evaluateCustomerRisk({
      phone: order.customerPhone,
      onlineOrders: onlineOrders || [],
      customerBlacklist: customerBlacklist || {},
      deliveryCharge: order.deliveryCharge || 100,
      language: isEn ? 'en' : 'bn'
    });
  }, [order.customerPhone, onlineOrders, customerBlacklist, order.deliveryCharge, isEn]);

  const isBlacklisted = customerRisk.hasWarning;
  const isCancellable = ['draft', 'confirmed', 'packed'].includes(s);
  const isPrepaid = Boolean(order.paymentMethod && order.paymentMethod !== 'cod');
  const isPaymentVerified = order.paymentStatus === 'verified';
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const isCloudUser = isAuthenticated && userId && !user?.isAnonymous;
  const targetBizId = activeBizId || state?.activeBizId;
  const targetDateKey = dateKey || state?.dayData?.dateKey;

  const recommendedWallet = useMemo(() => {
    if (order.advanceWallet && wallets[order.advanceWallet] && isWalletCompatibleWithPayment(order.paymentMethod, order.advanceWallet)) {
      return order.advanceWallet;
    }
    return getRecommendedWalletForPayment(order.paymentMethod, wallets);
  }, [order.paymentMethod, order.advanceWallet, wallets]);

  const compatibleWalletEntries = useMemo(() => {
    const matched = Object.entries(wallets).filter(([id]) => isWalletCompatibleWithPayment(order.paymentMethod, id));
    return matched.length > 0 ? matched : Object.entries(wallets);
  }, [wallets, order.paymentMethod]);

  const isMfsOrder = ['bkash_manual', 'nagad_manual', 'rocket_manual'].includes(order.paymentMethod);
  const [verifyWallet, setVerifyWallet] = useState(recommendedWallet);
  const [verifyTrxId, setVerifyTrxId] = useState(order.paymentTrxId || '');
  const [verifyAmount, setVerifyAmount] = useState('');
  const [verifyAmountError, setVerifyAmountError] = useState('');
  const [verifyWalletError, setVerifyWalletError] = useState('');
  const [verifyTrxIdError, setVerifyTrxIdError] = useState('');
  const [allowWithoutTrxId, setAllowWithoutTrxId] = useState(false);
  const [withoutTrxIdReason, setWithoutTrxIdReason] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Formatting date
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString(isEn ? 'en-US' : 'bn-BD', {
    day: 'numeric', month: 'short', year: 'numeric'
  }) : '';

  const handleStatusChange = (type, payload) => {
    dispatch({ type, payload });
  };

  const handleConfirmSettlement = (settlementPayload) => {
    if (isCloudUser) {
      setIsSettling(true);
      setSettleLocalError('');
      commitOnlineOrderSettlementToCloud(userId, targetBizId, targetDateKey, settlementPayload)
        .then(result => {
          setIsSettling(false);
          if (result?.order) {
            // Authoritative cloud commit succeeded!
            // Use applyCloudSettlement from context if available, or dispatch APPLY_CLOUD_SETTLEMENT
            if (typeof applyCloudSettlement === 'function') {
              applyCloudSettlement(result.order, result.dayData);
            } else {
              dispatch({
                type: 'APPLY_CLOUD_SETTLEMENT',
                payload: { order: result.order, dayData: result.dayData }
              });
            }
            // Close settlement panel
            setSettlingMode(false);
            setShowAdjustmentInput(false);
            setSettleLocalError('');
          }
        })
        .catch(err => {
          setIsSettling(false);
          console.error('[Ledgero] Cloud settlement failed:', err);
          // Keep panel open so merchant can see the error and retry!
          setSettleLocalError(getSettleErrorMessage(err.settleError || err.message, isEn));
          dispatch({
            type: 'SET_SYNC_ERROR',
            payload: { status: 'error', error: err.message || 'Settlement failed' }
          });
        });
    } else {
      handleStatusChange('ONLINE_ORDER_SETTLE', settlementPayload);
    }
  };

  const shareWhatsApp = () => {
    // Generate text message (simplified for this context)
    const msg = `Hello ${order.customerName},\nYour order is ${statusLabel}.\nTotal: ${formatBDT(order.totalAmount + order.deliveryCharge, isEn ? 'en' : 'bn')}\nAdvance: ${formatBDT(order.advancePaid, isEn ? 'en' : 'bn')}\nDue (COD): ${formatBDT(order.codAmount, isEn ? 'en' : 'bn')}\nThank you!`;
    const url = `https://wa.me/88${order.customerPhone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const copyTracking = () => {
    if (order.trackingNumber) {
      navigator.clipboard.writeText(order.trackingNumber);
      alert(isEn ? 'Tracking number copied!' : 'ট্র্যাকিং নাম্বার কপি হয়েছে!');
    }
  };

  const openTracking = () => {
    const link = getCourierTrackingLink(order.courierName, order.trackingNumber);
    if (link) window.open(link, '_blank');
  };

  const confirmDelete = () => {
    if (window.confirm(isEn ? 'Delete this order permanently?' : 'এই অর্ডারটি স্থায়ীভাবে মুছে ফেলতে চান?')) {
      if (isCloudUser) {
        deleteOnlineOrderFromCloud(userId, targetBizId, order.id)
          .then(() => {
            dispatch({ type: 'ONLINE_ORDER_DELETE', payload: order.id });
          })
          .catch(err => {
            console.error('[Ledgero] Cloud delete failed:', err);
            alert(err.message || (isEn ? 'Failed to delete order from cloud' : 'ক্লাউড থেকে অর্ডার মুছতে ব্যর্থ হয়েছে'));
            dispatch({
              type: 'SET_SYNC_ERROR',
              payload: { status: 'error', error: err.message || 'Failed to delete order' }
            });
          });
      } else {
        dispatch({ type: 'ONLINE_ORDER_DELETE', payload: order.id });
      }
    }
  };

  const confirmCancel = () => {
    if (window.confirm(isEn ? 'Cancel this order?' : 'এই অর্ডারটি বাতিল করতে চান?')) {
      if (isCloudUser) {
        commitOrderCancellationToCloud(userId, targetBizId, targetDateKey, { orderId: order.id })
          .then(result => {
            if (result?.order) {
              if (typeof applyCloudSettlement === 'function') {
                applyCloudSettlement(result.order, result.dayData);
              } else {
                dispatch({
                  type: 'APPLY_CLOUD_SETTLEMENT',
                  payload: { order: result.order, dayData: result.dayData }
                });
              }
            }
          })
          .catch(err => {
            console.error('[Ledgero] Cloud cancellation failed:', err);
            alert(err.message || (isEn ? 'Failed to cancel order in cloud' : 'ক্লাউডে অর্ডার বাতিল ব্যর্থ হয়েছে'));
            dispatch({
              type: 'SET_SYNC_ERROR',
              payload: { status: 'error', error: err.message || 'Cancellation failed' }
            });
          });
      } else {
        handleStatusChange('ONLINE_ORDER_CANCEL', order.id);
      }
    }
  };

  const handleReturnOrder = () => {
    if (isCloudUser) {
      commitOrderReturnToCloud(userId, targetBizId, targetDateKey, { orderId: order.id })
        .then(result => {
          if (result?.order) {
            if (typeof applyCloudSettlement === 'function') {
              applyCloudSettlement(result.order, result.dayData);
            } else {
              dispatch({
                type: 'APPLY_CLOUD_SETTLEMENT',
                payload: { order: result.order, dayData: result.dayData }
              });
            }
          }
        })
        .catch(err => {
          console.error('[Ledgero] Cloud order return failed:', err);
          alert(err.message || (isEn ? 'Failed to return order in cloud' : 'ক্লাউডে রিটার্ন ব্যর্থ হয়েছে'));
          dispatch({
            type: 'SET_SYNC_ERROR',
            payload: { status: 'error', error: err.message || 'Return failed' }
          });
        });
    } else {
      handleStatusChange('ONLINE_ORDER_RETURN', order.id);
    }
  };

  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border ${expanded ? 'border-emerald-300 dark:border-emerald-700 shadow-md' : 'border-slate-200 dark:border-slate-700 shadow-sm'} overflow-hidden transition-all`}>
      {/* CARD HEADER */}
      <div 
        className="p-4 cursor-pointer flex flex-col gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${statusColorClass}`}>
                {statusLabel}
              </span>
              {customerRisk.riskLevel === 'high' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-300 dark:border-rose-700 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {customerRisk.badgeLabel}
                </span>
              )}
              {customerRisk.riskLevel === 'moderate' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {customerRisk.badgeLabel}
                </span>
              )}
              {customerRisk.riskLevel === 'low' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {customerRisk.badgeLabel}
                </span>
              )}
              {(order.source === 'web_storefront' || order.isFromWebStore) && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" />
                  {isEn ? 'Web Store' : 'ওয়েব স্টোর'}
                </span>
              )}
              {order.verificationStatus && order.verificationStatus !== 'verified' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {isEn ? 'Price/Stock Unverified' : 'দাম/স্টক যাচাই প্রয়োজন'}
                </span>
              )}
              {order.priceVerified && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {isEn ? 'Catalog Verified' : 'ক্যাটালগ যাচাইকৃত'}
                </span>
              )}
              {isPrepaid ? (
                <>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300 border border-pink-300 dark:border-pink-700 flex items-center gap-1">
                    💳 {order.paymentMethod === 'nagad_manual' ? 'Nagad' : order.paymentMethod === 'rocket_manual' ? 'Rocket' : 'bKash'}
                    {order.paymentTrxId ? ` • TrxID: ${order.paymentTrxId}` : ''}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1 ${
                    order.paymentStatus === 'verified'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                      : order.paymentStatus === 'submitted_for_verification'
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 border-sky-300 dark:border-sky-800 animate-pulse'
                        : order.paymentStatus === 'rejected'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                  }`}>
                    {order.paymentStatus === 'verified'
                      ? (isEn ? '✅ Verified' : '✅ পেমেন্ট নিশ্চিত')
                      : order.paymentStatus === 'submitted_for_verification'
                        ? (isEn ? '⏳ TrxID Verification' : '⏳ TrxID যাচাই বাকি')
                        : order.paymentStatus === 'rejected'
                          ? (isEn ? '❌ Rejected' : '❌ পেমেন্ট মেলেনি')
                          : (isEn ? '⚠️ Awaiting Payment' : '⚠️ পেমেন্ট বাকি')}
                  </span>
                </>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                  🚚 {isEn ? 'COD' : 'ক্যাশ অন ডেলিভারি'}
                </span>
              )}
              <span className="text-xs text-slate-400 dark:text-slate-500">{dateStr}</span>
            </div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 text-lg">
              {order.customerName}
              {customerRisk.riskLevel === 'high' && <ShieldAlert className="w-4 h-4 text-rose-500" title={customerRisk.warningTitle} />}
              {customerRisk.riskLevel === 'moderate' && <AlertTriangle className="w-4 h-4 text-amber-500" title={customerRisk.warningTitle} />}
              {customerRisk.riskLevel === 'low' && <ShieldCheck className="w-4 h-4 text-emerald-500" title="Trusted Customer" />}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-mono mt-0.5 flex items-center gap-1">
              <Phone className="w-3.5 h-3.5" /> {order.customerPhone}
            </p>
          </div>
          
          <div className="text-right flex flex-col items-end">
            <span className="font-bold text-slate-800 dark:text-slate-100 text-lg">{formatBDT(order.codAmount ?? order.totalAmount, isEn ? 'en' : 'bn')}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded mt-1 ${
              order.paymentMethod && order.paymentMethod !== 'cod'
                ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300'
                : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700'
            }`}>
              {order.paymentMethod === 'bkash_manual' ? 'bKash' : order.paymentMethod === 'nagad_manual' ? 'Nagad' : order.paymentMethod === 'rocket_manual' ? 'Rocket' : 'COD'}
            </span>
          </div>
        </div>
        
        {/* Quick info row shown even when collapsed */}
        <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-3">
          <span className="flex items-center gap-1 truncate">
            <Package className="w-4 h-4 shrink-0" /> {order.items?.length || 0} items
          </span>
          <span className="flex items-center gap-1 truncate font-medium">
            <Truck className="w-4 h-4 shrink-0" /> {order.courierName}
          </span>
          <div className="ml-auto">
            {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </div>
        </div>
      </div>

      {/* EXPANDED DETAILS */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 animate-in slide-in-from-top-2 pt-4">
          {/* Item 3: Catalog Price / Stock Verification Alert */}
          {order.verificationStatus && order.verificationStatus !== 'verified' && (
            <div className="p-3 rounded-xl mb-3 border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-bold text-sm">
                    {isEn ? 'Order Price/Availability Requires Owner Review' : 'অর্ডারের মূল্য ও স্টক মালিকের যাচাই প্রয়োজন'}
                  </p>
                  {Array.isArray(order.verificationIssues) && order.verificationIssues.length > 0 ? (
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">
                      {order.verificationIssues.map((iss, idx) => (
                        <li key={idx}>{iss.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-0.5">
                      {isEn
                        ? 'Verify product prices and stock against your catalog before confirming this order.'
                        : 'এই অর্ডারটি কনফার্ম করার আগে আপনার ক্যাটালগের বর্তমান দাম ও স্টকের সাথে মিলিয়ে নিন।'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => handleStatusChange('VERIFY_AND_REPRICE_ONLINE_ORDER', order.id)}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  {isEn ? 'Apply Catalog Prices & Verify' : 'ক্যাটালগের সঠিক দাম প্রয়োগ ও যাচাই করুন'}
                </button>
              </div>
            </div>
          )}

          {/* Customer Risk & RTO Warning Alert */}
          {customerRisk.hasWarning && (
            <div className={`p-3 rounded-xl mb-3 border text-xs flex items-start gap-2.5 ${customerRisk.riskLevel === 'high' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'}`}>
              <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-sm leading-tight">{customerRisk.warningTitle}</p>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                    {customerRisk.badgeLabel}
                  </span>
                </div>
                <p className="mt-1 opacity-90">{customerRisk.warningMessage}</p>
                <p className="mt-1 font-semibold text-rose-700 dark:text-rose-300">
                  💡 {customerRisk.actionAdvice}
                </p>
              </div>
            </div>
          )}

          {/* Address & Tracking */}
          <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 mb-4 space-y-2 text-sm border border-slate-100 dark:border-slate-700">
            <p className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
              <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-500 mt-0.5 shrink-0" />
              <span className="leading-tight">{order.customerAddress} <br/><span className="text-xs text-slate-500 dark:text-slate-400">({order.isInsideDhaka ? 'Inside Dhaka' : 'Outside Dhaka'})</span></span>
            </p>
            
            {order.trackingNumber && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 mt-2">
                <span className="text-slate-500 dark:text-slate-400 text-xs">{isEn ? 'Tracking:' : 'ট্র্যাকিং:'}</span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">{order.trackingNumber}</span>
                <button onClick={copyTracking} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500"><Copy className="w-3.5 h-3.5" /></button>
                {getCourierTrackingLink(order.courierName, order.trackingNumber) && (
                  <button onClick={openTracking} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-sky-500"><ExternalLink className="w-3.5 h-3.5" /></button>
                )}
              </div>
            )}
            {order.notes && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-300">📝 {isEn ? 'Note:' : 'নোট:'}</span> {order.notes}
              </div>
            )}
            {order.paymentMethod && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">💳 {isEn ? 'Payment Method:' : 'পেমেন্ট মাধ্যম:'}</span>{' '}
                  {order.paymentMethod === 'cod'
                    ? (isEn ? 'Cash on Delivery (COD)' : 'ক্যাশ অন ডেলিভারি (COD)')
                    : order.paymentMethod === 'bkash_manual'
                      ? 'bKash (বিকাশ)'
                      : order.paymentMethod === 'nagad_manual'
                        ? 'Nagad (নগদ)'
                        : order.paymentMethod === 'rocket_manual'
                          ? 'Rocket (রকেট)'
                          : (isEn ? 'Mobile Banking' : 'মোবাইল ব্যাংকিং')}
                </div>
                {order.paymentTrxId && (
                  <div className="flex items-center gap-2 bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800/50 rounded-lg px-2.5 py-1.5 mt-1">
                    <span className="font-bold text-pink-700 dark:text-pink-300">
                      🔑 {isEn ? 'TrxID:' : 'Transaction ID (TrxID):'}
                    </span>
                    <span className="font-mono font-extrabold text-slate-900 dark:text-white bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-pink-200 dark:border-pink-700">
                      {order.paymentTrxId}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(order.paymentTrxId)}
                      className="p-1 hover:bg-pink-100 dark:hover:bg-pink-900/50 rounded text-pink-600 dark:text-pink-300 cursor-pointer"
                      title={isEn ? 'Copy TrxID' : 'TrxID কপি করুন'}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {order.paymentSenderPhone && (
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">📲 {isEn ? 'Sender Phone:' : 'প্রেরকের নম্বর:'}</span>{' '}
                    <span className="font-mono">{order.paymentSenderPhone}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Owner Payment Verification Box for Prepaid Orders */}
          {isPrepaid && (
            <div className={`p-3.5 rounded-xl mb-4 border text-xs flex flex-col gap-2.5 ${
              order.paymentStatus === 'verified'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : order.paymentStatus === 'rejected'
                  ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                  : 'bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-800 text-purple-900 dark:text-purple-200'
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-sm flex items-center gap-1.5">
                    {order.paymentStatus === 'verified' ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>{isEn ? 'Payment Verified by Owner' : 'দোকানদার কর্তৃক পেমেন্ট যাচাই সম্পন্ন'}</span>
                      </>
                    ) : order.paymentStatus === 'rejected' ? (
                      <>
                        <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                        <span>{isEn ? 'Payment Claim Rejected' : 'পেমেন্ট বাতিল / মেলেনি'}</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        <span>{isEn ? 'Owner Payment Verification Required' : 'দোকানদারের পেমেন্ট যাচাইকরণ প্রয়োজন'}</span>
                      </>
                    )}
                  </p>
                  {order.paymentStatus === 'verified' ? (
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      {isEn ? 'Amount:' : 'প্রাপ্ত টাকা:'} <strong>{formatBDT(order.advancePaid || order.totalAmount, isEn ? 'en' : 'bn')}</strong> • {isEn ? 'Wallet:' : 'ওয়ালেট:'} <strong>{getWalletLabel(order.advanceWallet || order.paymentWallet, isEn ? 'en' : 'bn')}</strong>
                      {order.verifiedTrxId ? ` • TrxID: ${order.verifiedTrxId}` : ''}
                    </p>
                  ) : order.paymentStatus === 'rejected' ? (
                    <p className="mt-1 text-rose-700 dark:text-rose-300">
                      {isEn ? 'Reason:' : 'কারণ:'} {order.paymentRejectionReason || (isEn ? 'Invalid TrxID / Payment not received' : 'ভুল TrxID / টাকা পাওয়া যায়নি')}
                    </p>
                  ) : (
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      {order.paymentTrxId
                        ? (isEn ? `Customer submitted TrxID: ${order.paymentTrxId}. Check your SMS/App before confirming.` : `গ্রাহক TrxID দিয়েছেন: ${order.paymentTrxId}। নিজের SMS বা অ্যাপে টাকা দেখে কনফার্ম করুন।`)
                        : (isEn ? 'No TrxID provided at checkout. Ask customer via WhatsApp or verify SMS.' : 'চেকআউটে TrxID দেওয়া হয়নি। গ্রাহকের সাথে WhatsApp-এ কথা বলে নিশ্চিত হন।')}
                    </p>
                  )}
                </div>
              </div>

              {/* Inline Payment Verification Form */}
              {showVerifyModal && (
                <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-purple-200 dark:border-purple-700 space-y-2 mt-1 shadow-sm">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-xs">
                    {isEn ? 'Confirm Money Received in Wallet:' : 'কোন ওয়ালেটে টাকা পেয়েছেন নির্বাচন করুন:'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 font-semibold mb-0.5">
                        {isEn ? 'Receiving Wallet' : 'টাকা প্রাপ্তির ওয়ালেট'} *
                      </label>
                      <select
                        value={verifyWallet}
                        onChange={e => {
                          setVerifyWallet(e.target.value);
                          setVerifyWalletError('');
                        }}
                        className={`w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border rounded-md outline-none ${
                          verifyWalletError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {!verifyWallet && (
                          <option value="">{isEn ? 'Select Wallet...' : 'ওয়ালেট নির্বাচন করুন...'}</option>
                        )}
                        {compatibleWalletEntries.map(([id, w]) => (
                          <option key={id} value={id}>{getWalletLabel(id, isEn ? 'en' : 'bn', w)}</option>
                        ))}
                      </select>
                      {verifyWalletError && (
                        <p className="text-[10px] text-rose-500 font-semibold mt-0.5">{verifyWalletError}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-semibold mb-0.5">
                        {isEn ? 'Received Amount' : 'প্রাপ্ত টাকার পরিমাণ'} (সর্বোচ্চ ৳{order.totalAmount}) *
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={verifyAmount}
                        placeholder={formatBDT(order.totalAmount, isEn ? 'en' : 'bn')}
                        onChange={e => {
                          setVerifyAmount(e.target.value);
                          setVerifyAmountError('');
                        }}
                        className={`w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border rounded-md outline-none font-bold ${
                          verifyAmountError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-300 dark:border-slate-600'
                        }`}
                      />
                      {verifyAmountError && (
                        <p className="text-[10px] text-rose-500 font-semibold mt-0.5">{verifyAmountError}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-semibold mb-0.5">
                      {isEn ? 'Transaction ID (TrxID)' : 'Transaction ID (যাচাইকৃত TrxID)'}
                      {isMfsOrder && !allowWithoutTrxId && <span className="text-rose-500 font-bold ml-0.5">*</span>}
                    </label>
                    <input
                      type="text"
                      value={verifyTrxId}
                      disabled={allowWithoutTrxId}
                      onChange={e => {
                        setVerifyTrxId(e.target.value);
                        setVerifyTrxIdError('');
                      }}
                      placeholder="যেমন: BKS982374X"
                      className={`w-full px-2 py-1.5 text-xs font-mono uppercase bg-slate-50 dark:bg-slate-700 border rounded-md outline-none ${
                        verifyTrxIdError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-300 dark:border-slate-600'
                      } ${allowWithoutTrxId ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                    {verifyTrxIdError && (
                      <p className="text-[10px] text-rose-500 font-semibold mt-0.5">{verifyTrxIdError}</p>
                    )}
                  </div>
                  {isMfsOrder && (
                    <div className="pt-0.5 space-y-1.5">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allowWithoutTrxId}
                          onChange={e => {
                            setAllowWithoutTrxId(e.target.checked);
                            setVerifyTrxIdError('');
                          }}
                          className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span>
                          {isEn
                            ? 'Manual verification without TrxID (Exception)'
                            : 'TrxID ছাড়া ম্যানুয়াল যাচাই (ব্যতিক্রম)'}
                        </span>
                      </label>
                      {allowWithoutTrxId && (
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold mb-0.5">
                            {isEn ? 'Reason for exception (min 5 characters)' : 'ব্যতিক্রমের কারণ (কমপক্ষে ৫ অক্ষর)'} <span className="text-rose-500 font-bold">*</span>
                          </label>
                          <input
                            type="text"
                            value={withoutTrxIdReason}
                            onChange={e => {
                              setWithoutTrxIdReason(e.target.value);
                              setVerifyTrxIdError('');
                            }}
                            placeholder={isEn ? 'e.g. Bank statement SMS verified directly' : 'যেমন: ব্যাংকের স্টেটমেন্ট বা এসএমএস দেখে নিশ্চিত হয়েছি'}
                            className={`w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border rounded-md outline-none ${
                              verifyTrxIdError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-300 dark:border-slate-600'
                            }`}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setVerifyAmountError('');
                        setVerifyWalletError('');
                        setVerifyTrxIdError('');

                        if (!verifyAmount.trim()) {
                          setVerifyAmountError(isEn ? 'Please enter the received payment amount' : 'প্রাপ্ত পেমেন্টের পরিমাণ লিখুন');
                          return;
                        }

                        const parsed = parseStrictMoney(verifyAmount, null, true);
                        if (parsed === null || parsed <= 0) {
                          setVerifyAmountError(isEn ? 'Invalid payment amount. Please enter a valid positive number' : 'পেমেন্টের পরিমাণ সঠিক নয়। সঠিক ধনাত্মক সংখ্যা লিখুন');
                          return;
                        }

                        const maxPayable = Number(order.totalAmount) || 0;
                        if (parsed > maxPayable) {
                          setVerifyAmountError(isEn ? `Payment amount (৳${parsed}) cannot exceed order total (৳${order.totalAmount})` : `পেমেন্টের পরিমাণ (৳${parsed}) অর্ডারের মোট টাকার (৳${order.totalAmount}) চেয়ে বেশি হতে পারে না`);
                          return;
                        }

                        if (!verifyWallet || !wallets[verifyWallet]) {
                          setVerifyWalletError(isEn ? 'Please select a receiving wallet' : 'দয়া করে টাকা গ্রহণের ওয়ালেট নির্বাচন করুন');
                          return;
                        }
                        if (!isWalletCompatibleWithPayment(order.paymentMethod, verifyWallet)) {
                          setVerifyWalletError(isEn ? 'Selected wallet is incompatible with this payment method' : 'নির্বাচিত ওয়ালেটটি এই পেমেন্ট মেথডের সাথে সঙ্গতিপূর্ণ নয়');
                          return;
                        }

                        if (isMfsOrder) {
                          if (allowWithoutTrxId) {
                            if (!withoutTrxIdReason.trim() || withoutTrxIdReason.trim().length < 5) {
                              setVerifyTrxIdError(
                                isEn
                                  ? 'At least 5 characters reason is required for verification without TrxID'
                                  : 'TrxID ছাড়া যাচাইয়ের জন্য কমপক্ষে ৫ অক্ষরের কারণ উল্লেখ করা আবশ্যক'
                              );
                              return;
                            }
                          } else if (!verifyTrxId.trim()) {
                            setVerifyTrxIdError(
                              isEn
                                ? 'Transaction ID (TrxID) is required for mobile banking verification'
                                : 'মোবাইল ব্যাংকিং যাচাইয়ের জন্য ট্রানজ্যাকশন আইডি (TrxID) দেওয়া আবশ্যক'
                            );
                            return;
                          }
                        }

                        const verifyPayload = {
                          orderId: order.id,
                          verifyPayment: true,
                          paymentWallet: verifyWallet,
                          amount: verifyAmount.trim(),
                          advancePaid: parsed,
                          verifiedAmount: parsed,
                          ...(allowWithoutTrxId
                            ? {
                                allowWithoutTrxId: true,
                                withoutTrxIdReason: withoutTrxIdReason.trim(),
                                verifiedTrxId: '',
                                trxId: '',
                              }
                            : {
                                verifiedTrxId: verifyTrxId.trim().toUpperCase(),
                                trxId: verifyTrxId.trim().toUpperCase(),
                              }),
                        };

                        if (isCloudUser) {
                          setIsVerifying(true);
                          commitPaymentVerificationToCloud(userId, targetBizId, targetDateKey, verifyPayload)
                            .then(result => {
                              setIsVerifying(false);
                              if (result?.order) {
                                if (typeof applyCloudSettlement === 'function') {
                                  applyCloudSettlement(result.order, result.dayData);
                                } else {
                                  dispatch({
                                    type: 'APPLY_CLOUD_SETTLEMENT',
                                    payload: { order: result.order, dayData: result.dayData }
                                  });
                                }
                                setShowVerifyModal(false);
                              }
                            })
                            .catch(err => {
                              setIsVerifying(false);
                              console.error('[Ledgero] Cloud payment verification failed:', err);
                              setVerifyWalletError(err.verifyError?.message || err.message || (isEn ? 'Payment verification failed' : 'পেমেন্ট যাচাই ব্যর্থ হয়েছে'));
                              dispatch({
                                type: 'SET_SYNC_ERROR',
                                payload: { status: 'error', error: err.message || 'Payment verification failed' }
                              });
                            });
                        } else {
                          handleStatusChange('ONLINE_ORDER_CONFIRM', verifyPayload);
                          setShowVerifyModal(false);
                        }
                      }}
                      className={`flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-md text-xs transition-colors flex items-center justify-center gap-1.5 ${isVerifying ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {isVerifying ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>{isEn ? 'Verifying...' : 'যাচাই হচ্ছে...'}</span>
                        </>
                      ) : (
                        isEn ? 'Confirm Received & Confirm Order' : 'টাকা পেয়েছি — যাচাই ও কনফার্ম'
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isVerifying}
                      onClick={() => setShowVerifyModal(false)}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md text-xs cursor-pointer"
                    >
                      {isEn ? 'Cancel' : 'বাতিল'}
                    </button>
                  </div>
                </div>
              )}

              {/* Inline Payment Rejection Form */}
              {showRejectModal && (
                <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-rose-200 dark:border-rose-700 space-y-2 mt-1 shadow-sm">
                  <p className="font-bold text-rose-800 dark:text-rose-200 text-xs">
                    {isEn ? 'Reject Payment Claim:' : 'পেমেন্ট প্রত্যাখানের কারণ:'}
                  </p>
                  <input
                    type="text"
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder={isEn ? 'e.g. SMS not received / fake TrxID' : 'যেমন: SMS আসেনি / ভুয়া TrxID'}
                    className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md outline-none"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        handleStatusChange('ONLINE_ORDER_REJECT_PAYMENT', {
                          orderId: order.id,
                          reason: rejectionReason.trim(),
                        });
                        setShowRejectModal(false);
                      }}
                      className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-1.5 px-3 rounded-md text-xs transition-colors cursor-pointer"
                    >
                      {isEn ? 'Reject Payment' : 'পেমেন্ট বাতিল নিশ্চিত করুন'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRejectModal(false)}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md text-xs cursor-pointer"
                    >
                      {isEn ? 'Back' : 'ফিরে যান'}
                    </button>
                  </div>
                </div>
              )}

              {/* Verification Trigger Buttons */}
              {order.paymentStatus !== 'verified' && !showVerifyModal && !showRejectModal && (
                <div className="flex gap-2 flex-wrap pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setVerifyWallet(recommendedWallet);
                      setVerifyWalletError('');
                      setVerifyAmountError('');
                      setVerifyTrxIdError('');
                      setVerifyAmount('');
                      setVerifyTrxId(order.paymentTrxId || '');
                      setAllowWithoutTrxId(false);
                      setWithoutTrxIdReason('');
                      setShowVerifyModal(true);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Payment Received — Verify & Confirm' : 'টাকা পেয়েছি — যাচাই ও কনফার্ম'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRejectModal(true)}
                    className="bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-semibold py-1.5 px-2.5 rounded-lg text-xs flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Payment Not Received' : 'পেমেন্ট মেলেনি / বাতিল'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Items List */}
          <div className="mb-4">
            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{isEn ? 'Order Items' : 'অর্ডার আইটেম'}</h4>
            <div className="space-y-2">
              {order.items?.map((item, i) => (
                <div key={i} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center text-xs font-medium">{item.quantity}</span>
                    <span className="line-clamp-1">{item.productName}</span>
                  </div>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{formatBDT(item.subtotal, isEn ? 'en' : 'bn')}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="bg-emerald-50/50 dark:bg-emerald-900/10 rounded-xl p-3 mb-4 border border-emerald-100 dark:border-emerald-800/30 text-sm space-y-1.5">
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>{isEn ? 'Items Total' : 'মোট মূল্য'}:</span>
              <span>{formatBDT(order.totalAmount, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>{isEn ? 'Delivery Charge' : 'ডেলিভারি চার্জ'}:</span>
              <span>+{formatBDT(order.deliveryCharge, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between text-emerald-600 dark:text-emerald-500">
              <span>{isEn ? 'Advance Paid' : 'অ্যাডভান্স জমা'}:</span>
              <span>-{formatBDT(order.advancePaid, isEn ? 'en' : 'bn')}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-800 dark:text-slate-100 pt-1.5 border-t border-emerald-200/50 dark:border-emerald-800/50">
              <span>{isEn ? 'COD Amount' : 'কন্ডিশন (COD)'}:</span>
              <span>{formatBDT(order.codAmount, isEn ? 'en' : 'bn')}</span>
            </div>
            
            <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-400 pt-1.5 mt-1.5 border-t border-dashed border-emerald-200 dark:border-emerald-800/50">
              <span>{isEn ? 'Est. Net Receivable' : 'কুরিয়ার থেকে পাওনা (আনুমানিক)'}:</span>
              <span className="font-semibold">{formatBDT(order.netFromCourier, isEn ? 'en' : 'bn')}</span>
            </div>
          </div>

          {/* ACTIONS MODES INLINE */}
          {shippingMode && (
            <div className="bg-sky-50 dark:bg-sky-900/20 p-3 rounded-xl mb-4 border border-sky-200 dark:border-sky-800">
              <label className="block text-xs font-bold text-sky-800 dark:text-sky-300 mb-1">{isEn ? 'Enter Tracking Number' : 'ট্র্যাকিং নাম্বার লিখুন'}</label>
              <input 
                type="text" 
                value={trackingNumber} 
                onChange={e => setTrackingNumber(e.target.value)}
                placeholder="e.g. STEAD123456"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-700 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-slate-800 dark:text-slate-100 mb-2 min-h-[44px]"
              />
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    handleStatusChange('ONLINE_ORDER_SHIP', { orderId: order.id, courierName: order.courierName, trackingNumber });
                    setShippingMode(false);
                  }}
                  className="flex-1 bg-sky-600 hover:bg-sky-700 text-white py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px]"
                >
                  {isEn ? 'Confirm Shipment' : 'শিপমেন্ট কনফার্ম করুন'}
                </button>
                <button onClick={() => setShippingMode(false)} className="px-4 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors min-h-[44px]">{isEn ? 'Cancel' : 'বাতিল'}</button>
              </div>
            </div>
          )}

          {settlingMode && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3.5 rounded-xl mb-4 border border-emerald-300 dark:border-emerald-700 space-y-3">
              <div className="flex justify-between items-center border-b border-emerald-200 dark:border-emerald-800 pb-2">
                <span className="font-bold text-xs text-emerald-900 dark:text-emerald-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  {isEn ? 'Courier Settlement' : 'কুরিয়ার থেকে টাকা গ্রহণ (সেটেলমেন্ট)'}
                </span>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {isEn ? 'Est. Net:' : 'প্রত্যাশিত নেট:'} <strong>{formatBDT(order.netFromCourier, isEn ? 'en' : 'bn')}</strong>
                </span>
              </div>

              {/* Error Banner if settlement failed */}
              {(settleLocalError || (orderSettleError && orderSettleError.orderId === order.id)) && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs space-y-1 animate-in fade-in">
                  <div className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{isEn ? 'Settlement Issue' : 'সেটেলমেন্ট সমস্যা'}</span>
                  </div>
                  <p className="leading-snug">
                    {settleLocalError || getSettleErrorMessage(orderSettleError, isEn)}
                  </p>
                </div>
              )}

              {/* Wallet Selection */}
              <div>
                <label className="block text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-1">
                  {isEn ? 'Select Wallet to Receive' : 'টাকা গ্রহণের ওয়ালেট নির্বাচন করুন'}
                </label>
                <select 
                  value={settlementWallet} 
                  onChange={e => {
                    setSettlementWallet(e.target.value);
                    setSettleLocalError('');
                  }}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100 text-xs min-h-[42px]"
                >
                  <option value="">{isEn ? 'Select Wallet...' : 'ওয়ালেট নির্বাচন...'}</option>
                  {Object.entries(wallets).map(([id, w]) => (
                    <option key={id} value={id}>{getWalletLabel(id, isEn ? 'en' : 'bn', w)}</option>
                  ))}
                </select>
              </div>

              {/* Net Payout: Expected vs Actual Received */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {isEn ? 'Actual Net Received (Tk)' : 'প্রকৃত প্রাপ্ত নেট টাকা (৳)'}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={actualNetInput}
                    onChange={e => {
                      setActualNetInput(e.target.value);
                      setSettleLocalError('');
                    }}
                    placeholder={formatBDT(order.netFromCourier, isEn ? 'en' : 'bn')}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md outline-none text-slate-800 dark:text-slate-100 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {isEn ? 'Expected Net (Estimated)' : 'প্রত্যাশিত নেট (আনুমানিক)'}
                  </label>
                  <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-md font-mono text-slate-700 dark:text-slate-300 font-semibold">
                    {formatBDT(order.netFromCourier, isEn ? 'en' : 'bn')}
                  </div>
                </div>
              </div>

              {/* Toggle for Discrepancy / Adjustment Section */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowAdjustmentInput(!showAdjustmentInput)}
                  className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>{showAdjustmentInput ? '▼' : '►'}</span>
                  <span>{isEn ? 'Courier deduction / net payout discrepancy?' : 'কুরিয়ারের চার্জ বা প্রাপ্ত টাকায় গরমিল আছে? সমন্বয় করুন'}</span>
                </button>
              </div>

              {/* Controlled Adjustment Panel */}
              {showAdjustmentInput && (
                <div className="p-3 bg-white dark:bg-slate-800/90 rounded-lg border border-emerald-200 dark:border-emerald-700 space-y-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {isEn ? 'Adjustment Reason (Required, min 3 chars)' : 'সমন্বয়ের কারণ (বাধ্যতামূলক, যেমন: অতিরিক্ত ওজন চার্জ)'}
                    </label>
                    <input
                      type="text"
                      value={adjustmentReasonText}
                      onChange={e => {
                        setAdjustmentReasonText(e.target.value);
                        setSettleLocalError('');
                      }}
                      placeholder={isEn ? 'e.g. Extra weight penalty / return fee deduction' : 'যেমন: অতিরিক্ত ওজন চার্জ / কুরিয়ার বিল সমন্বয়'}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md outline-none text-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={allowAdjustmentChecked}
                      onChange={e => {
                        setAllowAdjustmentChecked(e.target.checked);
                        setSettleLocalError('');
                      }}
                      className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-tight">
                      {isEn
                        ? 'I verify and approve this courier adjustment / deduction'
                        : 'আমি কুরিয়ারের এই সমন্বয় / কর্তন যাচাইপূর্বক অনুমোদন করছি'}
                    </span>
                  </label>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <button 
                  type="button"
                  disabled={isSettling}
                  onClick={() => {
                    if (isSettling) return;
                    if (!settlementWallet) {
                      setSettleLocalError(isEn ? 'Please select a wallet to receive payment' : 'দয়া করে টাকা গ্রহণের ওয়ালেট নির্বাচন করুন');
                      return;
                    }
                    if (!actualNetInput.trim()) {
                      setSettleLocalError(isEn ? 'Please enter the actual net amount received from courier' : 'কুরিয়ার থেকে প্রকৃতপক্ষে প্রাপ্ত নেট টাকার পরিমাণ লিখুন');
                      return;
                    }
                    if (parseStrictMoney(actualNetInput, null, true) === null) {
                      setSettleLocalError(isEn ? 'Invalid amount format. Please enter a valid number (e.g. 850 or 850.50)' : 'টাকার পরিমাণ সঠিক নয়। সঠিক সংখ্যা লিখুন (যেমন: ৮৫০ বা ৮৫০.৫০)');
                      return;
                    }
                    if (showAdjustmentInput && allowAdjustmentChecked) {
                      if (!adjustmentReasonText.trim() || adjustmentReasonText.trim().length < 3) {
                        setSettleLocalError(isEn ? 'Please enter an adjustment reason (at least 3 characters)' : 'দয়া করে সমন্বয়ের কারণ লিখুন (কমপক্ষে ৩ অক্ষর)');
                        return;
                      }
                      handleConfirmSettlement({
                        orderId: order.id,
                        settlementWallet,
                        netAmount: actualNetInput.trim(),
                        allowAdjustment: true,
                        adjustmentReason: adjustmentReasonText.trim(),
                      });
                    } else {
                      handleConfirmSettlement({
                        orderId: order.id,
                        settlementWallet,
                        netAmount: actualNetInput.trim(),
                      });
                    }
                  }}
                  className={`flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-3 rounded-lg text-xs font-bold transition-colors min-h-[42px] shadow-sm flex items-center justify-center gap-1.5 ${isSettling ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {isSettling ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{isEn ? 'Settling in Cloud...' : 'ক্লাউডে সেটেল হচ্ছে...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isEn ? 'Confirm Settlement' : 'টাকা রিসিভ কনফার্ম করুন'}</span>
                    </>
                  )}
                </button>
                <button 
                  type="button"
                  disabled={isSettling}
                  onClick={() => {
                    if (isSettling) return;
                    setSettlingMode(false);
                    setSettleLocalError('');
                    setShowAdjustmentInput(false);
                    dispatch({ type: 'CLEAR_ORDER_SETTLE_ERROR' });
                  }} 
                  className="px-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium transition-colors min-h-[42px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </div>
          )}

          {/* ACTION BUTTONS STRIP */}
          {!shippingMode && !settlingMode && (
            <div className="flex flex-wrap gap-2 pt-2">
              
              {s === 'draft' && (
                <>
                  {isPrepaid && order.paymentStatus !== 'verified' ? (
                    <button
                      onClick={() => {
                        setExpanded(true);
                        setVerifyWallet(recommendedWallet);
                        setVerifyWalletError('');
                        setVerifyAmountError('');
                        setVerifyTrxIdError('');
                        setVerifyAmount('');
                        setVerifyTrxId(order.paymentTrxId || '');
                        setAllowWithoutTrxId(false);
                        setWithoutTrxIdReason('');
                        setShowVerifyModal(true);
                      }}
                      className="flex-1 min-w-[170px] bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[40px] shadow-sm"
                    >
                      <CheckCircle2 className="w-4 h-4" /> {isEn ? 'Verify Payment & Confirm' : 'টাকা পেয়েছি — যাচাই ও কনফার্ম'}
                    </button>
                  ) : (
                    <button onClick={() => handleStatusChange('ONLINE_ORDER_CONFIRM', { orderId: order.id, advanceWallet: order.advanceWallet, advancePaid: order.advancePaid })} className="flex-1 min-w-[120px] bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors min-h-[40px]">
                      <CheckCircle2 className="w-4 h-4" /> {isEn ? 'Confirm' : 'কনফার্ম'}
                    </button>
                  )}
                  <button onClick={confirmDelete} className="bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 dark:text-rose-400 py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center transition-colors min-h-[40px]">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}

              {s === 'confirmed' && (
                isPrepaid && order.paymentStatus !== 'verified' ? (
                  <button
                    onClick={() => {
                      setExpanded(true);
                      setVerifyWallet(recommendedWallet);
                      setVerifyWalletError('');
                      setVerifyAmountError('');
                      setVerifyTrxIdError('');
                      setVerifyAmount('');
                      setVerifyTrxId(order.paymentTrxId || '');
                      setAllowWithoutTrxId(false);
                      setWithoutTrxIdReason('');
                      setShowVerifyModal(true);
                    }}
                    className="flex-1 min-w-[170px] bg-amber-600 hover:bg-amber-700 text-white py-2 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[40px]"
                  >
                    <ShieldCheck className="w-4 h-4" /> {isEn ? 'Verify Payment to Pack' : 'প্যাকিংয়ের আগে পেমেন্ট যাচাই করুন'}
                  </button>
                ) : (
                  <button onClick={() => handleStatusChange('ONLINE_ORDER_PACK', order.id)} className="flex-1 min-w-[120px] bg-amber-500 hover:bg-amber-600 text-white py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors min-h-[40px]">
                    <Package className="w-4 h-4" /> {isEn ? 'Pack Order' : 'প্যাক করুন'}
                  </button>
                )
              )}

              {s === 'packed' && (
                <button onClick={() => setShippingMode(true)} className="flex-1 min-w-[120px] bg-sky-500 hover:bg-sky-600 text-white py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors min-h-[40px]">
                  <Truck className="w-4 h-4" /> {isEn ? 'Ship to Courier' : 'কুরিয়ারে দিন'}
                </button>
              )}

              {s === 'shipped' && (
                <>
                  <button onClick={() => handleStatusChange('ONLINE_ORDER_DELIVER', order.id)} className="flex-1 min-w-[120px] bg-emerald-500 hover:bg-emerald-600 text-white py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors min-h-[40px]">
                    <CheckCircle2 className="w-4 h-4" /> {isEn ? 'Delivered' : 'ডেলিভারড'}
                  </button>
                  <button onClick={handleReturnOrder} className="flex-1 min-w-[120px] bg-rose-500 hover:bg-rose-600 text-white py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors min-h-[40px]">
                    <RotateCcw className="w-4 h-4" /> {isEn ? 'Returned (RTO)' : 'রিটার্ন (RTO)'}
                  </button>
                </>
              )}

              {s === 'delivered' && (
                <button onClick={() => {
                  setSettlingMode(true);
                  setSettleLocalError('');
                  dispatch({ type: 'CLEAR_ORDER_SETTLE_ERROR' });
                }} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm min-h-[44px]">
                  <DollarSign className="w-5 h-5" /> {isEn ? 'Settle Payment' : 'টাকা রিসিভ করুন'}
                </button>
              )}

              {isCancellable && (
                <button onClick={confirmCancel} className="bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center transition-colors min-h-[40px] border border-slate-200 dark:border-slate-600" title={isEn ? 'Cancel order' : 'অর্ডার বাতিল'}>
                  <XCircle className="w-4 h-4" />
                </button>
              )}

              {/* Blacklist / Unblacklist quick action */}
              {customerRisk.isManuallyBlacklisted ? (
                <button 
                  onClick={() => dispatch({ type: 'UNBLACKLIST_CUSTOMER', payload: order.customerPhone })}
                  className="bg-slate-100 hover:bg-slate-200 text-emerald-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-emerald-400 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-colors min-h-[40px] border border-slate-200 dark:border-slate-700 cursor-pointer"
                  title={isEn ? 'Remove from Blacklist' : 'ব্ল্যাকলিস্ট থেকে সরান'}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Unblacklist' : 'ব্ল্যাকলিস্ট বাতিল'}</span>
                </button>
              ) : (
                <button 
                  onClick={() => {
                    const reason = window.prompt(
                      isEn ? 'Enter blacklist reason (optional):' : 'ব্ল্যাকলিস্ট করার কারণ লিখুন (ঐচ্ছিক):',
                      isEn ? 'High return risk' : 'উচ্চ পার্সেল রিটার্ন ঝুঁকি'
                    );
                    if (reason !== null) {
                      dispatch({
                        type: 'BLACKLIST_CUSTOMER',
                        payload: { phone: order.customerPhone, reason: reason || (isEn ? 'Manually blacklisted' : 'ম্যানুয়ালি ব্ল্যাকলিস্টেড') }
                      });
                    }
                  }}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-colors min-h-[40px] border border-rose-200 dark:border-rose-900/50 cursor-pointer"
                  title={isEn ? 'Blacklist customer' : 'গ্রাহক ব্ল্যাকলিস্ট করুন'}
                >
                  <UserX className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Blacklist' : 'ব্ল্যাকলিস্ট'}</span>
                </button>
              )}

              <button onClick={shareWhatsApp} className="ml-auto bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] dark:bg-[#25D366]/20 dark:hover:bg-[#25D366]/30 py-2 px-4 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors min-h-[40px]">
                <Share2 className="w-4 h-4" /> WhatsApp
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// STAT CARD HELPER COMPONENT
// ----------------------------------------------------------------------------
const STAT_COLORS = {
  blue: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', icon: 'text-blue-500 dark:text-blue-400' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-300', icon: 'text-amber-500 dark:text-amber-400' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-500 dark:text-emerald-400' },
  rose: { bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800', text: 'text-rose-700 dark:text-rose-300', icon: 'text-rose-500 dark:text-rose-400' },
};

function StatCard({ title, value, icon: Icon, color = 'blue' }) {
  const c = STAT_COLORS[color] || STAT_COLORS.blue;
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-3 flex items-center gap-3`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.bg}`}>
        <Icon className={`w-5 h-5 ${c.icon}`} />
      </div>
      <div>
        <p className={`text-2xl font-bold ${c.text}`}>{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{title}</p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// BLACKLIST & FRAUD PREVENTION REGISTRY MODAL
// ----------------------------------------------------------------------------
function BlacklistModal({ isOpen, onClose, customerBlacklist = {}, dispatch, isEn }) {
  const [phoneInput, setPhoneInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  if (!isOpen) return null;

  const entries = Object.entries(customerBlacklist).map(([phone, data]) => ({
    phone,
    ...data,
  }));

  const filteredEntries = entries.filter(e => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return e.phone?.includes(q) || e.reason?.toLowerCase().includes(q);
  });

  const handleAdd = (e) => {
    e.preventDefault();
    const norm = normalizePhoneNumber(phoneInput);
    if (!norm || norm.length < 6) {
      alert(isEn ? 'Please enter a valid phone number' : 'সঠিক মোবাইল নম্বর দিন');
      return;
    }
    dispatch({
      type: 'BLACKLIST_CUSTOMER',
      payload: {
        phone: norm,
        reason: reasonInput.trim() || (isEn ? 'Manually blacklisted' : 'ম্যানুয়ালি ব্ল্যাকলিস্টেড'),
        rtoCount: 1,
      }
    });
    setPhoneInput('');
    setReasonInput('');
  };

  const handleRemove = (phone) => {
    if (window.confirm(isEn ? `Remove ${phone} from blacklist?` : `${phone} নম্বরটি ব্ল্যাকলিস্ট থেকে সরাতে চান?`)) {
      dispatch({ type: 'UNBLACKLIST_CUSTOMER', payload: phone });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">
                {isEn ? 'Customer Fraud & Blacklist Registry' : 'গ্রাহক ফ্রড ও ব্ল্যাকলিস্ট তালিকা'}
              </h3>
              <p className="text-xs text-slate-400">
                {isEn ? `${entries.length} restricted numbers recorded` : `মোট ${entries.length}টি ঝুঁকিপূর্ণ নম্বর রেকর্ড করা আছে`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form to add */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800">
          <form onSubmit={handleAdd} className="space-y-2.5">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isEn ? 'Add Number to Blacklist' : '+ নতুন নম্বর ব্ল্যাকলিস্টে যোগ করুন'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="tel"
                placeholder={isEn ? 'Mobile number (017...)' : 'মোবাইল নম্বর (017...)'}
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                required
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-500"
              />
              <input
                type="text"
                placeholder={isEn ? 'Reason (e.g. Returned 2 parcels)' : 'কারণ (যেমন: পার্সেল রিসিভ করে না)'}
                value={reasonInput}
                onChange={e => setReasonInput(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <UserX className="w-3.5 h-3.5" />
                <span>{isEn ? 'Add to Blacklist' : 'ব্ল্যাকলিস্ট করুন'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={isEn ? 'Search blacklisted number or reason...' : 'নম্বর বা কারণ দিয়ে খুঁজুন...'}
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              <UserCheck className="w-8 h-8 mx-auto mb-2 opacity-40 text-emerald-500" />
              <p>{isEn ? 'No blacklisted customers found.' : 'কোনো ব্ল্যাকলিস্টেড গ্রাহক নেই।'}</p>
            </div>
          ) : (
            filteredEntries.map(e => (
              <div
                key={e.phone}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-sm">{e.phone}</span>
                    {e.rtoCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-[10px]">
                        {e.rtoCount} RTO
                      </span>
                    )}
                  </div>
                  {e.reason && (
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {e.reason}
                    </p>
                  )}
                  {e.updatedAt && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(e.updatedAt).toLocaleDateString(isEn ? 'en-US' : 'bn-BD')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(e.phone)}
                  className="px-2.5 py-1.5 bg-white dark:bg-slate-700 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-600 transition-colors font-medium flex items-center gap-1 cursor-pointer"
                  title={isEn ? 'Remove from Blacklist' : 'ব্ল্যাকলিস্ট থেকে মুছুন'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Remove' : 'মুছুন'}</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex justify-between items-center text-xs text-slate-500">
          <span>{isEn ? 'Auto-synced with online orders RTO' : 'পার্সেল রিটার্ন হলে স্বয়ংক্রিয়ভাবে আপডেট হয়'}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-xl text-slate-800 dark:text-slate-200 font-semibold cursor-pointer"
          >
            {isEn ? 'Close' : 'বন্ধ করুন'}
          </button>
        </div>
      </div>
    </div>
  );
}
