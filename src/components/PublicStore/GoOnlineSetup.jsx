import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/firebaseConfig';
import { doc, setDoc, getDoc, collection, writeBatch, deleteDoc, query, where, getDocs } from 'firebase/firestore';
import { syncPublicStoreProducts, savePublicStoreInfo } from '../../firebase/firestoreService';
import { useAuth } from '../../firebase/useAuth';
import { X, Globe, Save, Loader2, Store, Check, AlertCircle, Copy, ExternalLink, RefreshCw, Truck } from 'lucide-react';
import { formatBDT } from '../../data/calculations';

const GoOnlineSetup = ({ state, dispatch, isOpen, onClose }) => {
  const { user } = useAuth();
  const userId = user?.uid;
  const [slug, setSlug] = useState('');
  const [savedSlug, setSavedSlug] = useState(''); // The confirmed slug saved in Firestore
  const [whatsapp, setWhatsapp] = useState('');
  const [bkashNumber, setBkashNumber] = useState('');
  const [nagadNumber, setNagadNumber] = useState('');
  const [rocketNumber, setRocketNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [existingStore, setExistingStore] = useState(false);
  const activeBizId = state.activeBizId || state.activeBiz?.id || 'biz_1';
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [autoSync, setAutoSync] = useState(() => 
    localStorage.getItem(`ledgero_auto_sync_${activeBizId}`) === 'true' || localStorage.getItem('ledgero_auto_sync') === 'true'
  );
  
  // Available products from current inventory
  const availableProducts = state.dayData?.inventory || [];

  // Load existing store from Firestore when modal opens
  useEffect(() => {
    if (!isOpen || !userId) return;
    
    const loadExistingStore = async () => {
      setIsLoading(true);
      setError('');
      try {
        // Query stores collection where ownerUserId == current user
        const storesRef = collection(db, 'stores');
        const q = query(storesRef, where('ownerUserId', '==', userId));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          // Find store matching current business, or fallback to first
          const storeDoc = snapshot.docs.find(d => d.data().bizId === activeBizId) || snapshot.docs[0];
          const storeData = storeDoc.data();
          const existingSlug = storeDoc.id;
          
          setSlug(existingSlug);
          setSavedSlug(existingSlug);
          setWhatsapp(storeData.whatsappNumber || '');
          setBkashNumber(storeData.bkashNumber || '');
          setNagadNumber(storeData.nagadNumber || '');
          setRocketNumber(storeData.rocketNumber || '');
          setDisplayName(storeData.displayName || storeData.shopName || '');
          setExistingStore(storeData.isActive !== false);
          setAutoSync(storeData.autoSync === true);
          
          // Save to localStorage scoped per business
          localStorage.setItem(`ledgero_store_slug_${activeBizId}`, existingSlug);
          localStorage.setItem(`ledgero_auto_sync_${activeBizId}`, storeData.autoSync === true ? 'true' : 'false');
          
          // Load existing published product IDs
          const productsSnap = await getDocs(collection(db, 'stores', existingSlug, 'products'));
          const publishedIds = productsSnap.docs.map(d => d.id);
          
          // Pre-select inventory items that are already published
          const preSelected = availableProducts.filter(p => publishedIds.includes(p.id));
          if (preSelected.length > 0) {
            setSelectedProducts(preSelected);
          } else {
            // Products might have changed — select all by default
            setSelectedProducts([...availableProducts]);
          }
        } else {
          // No existing store — generate slug for the first time
          const bizName = state.activeBiz?.name || '';
          const englishSlug = bizName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          
          if (englishSlug.length >= 3) {
            setSlug(englishSlug);
          } else {
            const randomPart = Math.random().toString(36).slice(2, 8);
            setSlug(`shop-${randomPart}`);
          }
          setSavedSlug('');
          setDisplayName(state.activeBiz?.name || '');
          setExistingStore(false);
          // Select all products by default for new store
          setSelectedProducts([...availableProducts]);
        }
      } catch (err) {
        console.error('Error loading store:', err);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadExistingStore();
  }, [isOpen, userId]);

  const toggleProduct = (product) => {
    setSelectedProducts(prev => {
      const isSelected = prev.some(p => p.id === product.id);
      if (isSelected) {
        return prev.filter(p => p.id !== product.id);
      } else {
        return [...prev, product];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedProducts.length === availableProducts.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts([...availableProducts]);
    }
  };

  const handleGoOnline = async () => {
    if (!slug.trim() || !whatsapp.trim()) {
      setError('দোকানের লিংক (Slug) এবং হোয়াটসঅ্যাপ নম্বর দিতে হবে।');
      return;
    }

    const cleanWhatsapp = whatsapp.trim().replace(/\D/g, '');
    if (cleanWhatsapp.length < 10 || cleanWhatsapp.length > 15) {
      setError('সঠিক হোয়াটসঅ্যাপ মোবাইল নম্বর দিন (যেমন: 01712345678)।');
      return;
    }
    
    const formattedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (formattedSlug.length < 3) {
      setError('দোকানের লিংক কমপক্ষে ৩ অক্ষরের হতে হবে।');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      // Check conflict by reading public info (/stores/{slug}/public/info)
      // Since top-level /stores/{slug} is strictly owner-only, public/info is the canonical check
      const publicInfoRef = doc(db, 'stores', formattedSlug, 'public', 'info');
      let isSlugTaken = false;
      try {
        const pubSnap = await getDoc(publicInfoRef);
        if (pubSnap.exists() && savedSlug !== formattedSlug) {
          isSlugTaken = true;
        }
      } catch (checkErr) {
        // Fallback check
      }
      
      if (isSlugTaken) {
        setError('এই লিংকটি ইতিমধ্যে অন্য একজন ব্যবহার করছেন। অন্য একটি লিংক চেষ্টা করুন।');
        setIsSubmitting(false);
        return;
      }

      // If slug changed and old store exists, mark old store and its public info inactive
      if (savedSlug && savedSlug !== formattedSlug) {
        try {
          const nowIso = new Date().toISOString();
          const oldRef = doc(db, 'stores', savedSlug);
          const oldPublicRef = doc(db, 'stores', savedSlug, 'public', 'info');
          await setDoc(oldRef, { isActive: false, movedTo: formattedSlug, updatedAt: nowIso }, { merge: true });
          await setDoc(oldPublicRef, { isActive: false, updatedAt: nowIso }, { merge: true });
        } catch (e) {
          // Ignore errors on old doc cleanup
        }
      }

      // Save both owner-scoped store doc and sanitized public storefront info doc
      const shopName = state.activeBiz?.name || state.businesses?.[activeBizId]?.name || 'My Shop';
      const nowIso = new Date().toISOString();
      const storePayload = {
        shopName: shopName,
        displayName: displayName.trim() || shopName,
        ownerUserId: userId,
        bizId: activeBizId,
        whatsappNumber: whatsapp.trim(),
        address: state.activeBiz?.address || '',
        isActive: true,
        autoSync: autoSync,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      if (bkashNumber.trim()) storePayload.bkashNumber = bkashNumber.trim().slice(0, 25);
      if (nagadNumber.trim()) storePayload.nagadNumber = nagadNumber.trim().slice(0, 25);
      if (rocketNumber.trim()) storePayload.rocketNumber = rocketNumber.trim().slice(0, 25);
      await savePublicStoreInfo(formattedSlug, storePayload);

      // Save to localStorage scoped per business
      localStorage.setItem(`ledgero_store_slug_${activeBizId}`, formattedSlug);
      localStorage.setItem(`ledgero_auto_sync_${activeBizId}`, autoSync ? 'true' : 'false');
      localStorage.setItem('ledgero_store_slug', formattedSlug);
      localStorage.setItem('ledgero_auto_sync', autoSync ? 'true' : 'false');

      // Sync products in 450-operation chunked batches (deletes unselected & upserts selected with strict field allowlist)
      await syncPublicStoreProducts(formattedSlug, selectedProducts);

      const storeLink = `${window.location.origin}/s/${formattedSlug}`;
      setSavedSlug(formattedSlug);
      setExistingStore(true);
      setSuccess(existingStore 
        ? `✅ অনলাইন দোকান আপডেট হয়েছে! লিংক: ${storeLink}` 
        : `✅ অনলাইন দোকান চালু! লিংক: ${storeLink}`
      );

    } catch (err) {
      console.error('GoOnline error:', err);
      const errMsg = err?.code === 'permission-denied' 
        ? 'Firestore permission denied — Rules deploy করা হয়নি।'
        : err?.message || 'দুঃখিত, কোনো একটি সমস্যা হয়েছে।';
      setError(`❌ ${errMsg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoOffline = async () => {
    setIsSubmitting(true);
    try {
      const formattedSlug = (savedSlug || slug).toLowerCase().replace(/[^a-z0-9-]/g, '');
      const nowIso = new Date().toISOString();
      const shopRef = doc(db, 'stores', formattedSlug);
      const publicInfoRef = doc(db, 'stores', formattedSlug, 'public', 'info');
      await setDoc(shopRef, { isActive: false, updatedAt: nowIso }, { merge: true });
      await setDoc(publicInfoRef, { isActive: false, updatedAt: nowIso }, { merge: true });
      setSuccess('আপনার অনলাইন দোকানটি এখন বন্ধ করা হয়েছে।');
      setExistingStore(false);
    } catch (err) {
      setError('অফলাইন করতে সমস্যা হয়েছে।');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyLink = () => {
    const link = `${window.location.origin}/s/${savedSlug || slug}`;
    navigator.clipboard.writeText(link).then(() => {
      setSuccess('✅ লিংক কপি হয়েছে!');
      setTimeout(() => setSuccess(''), 2000);
    });
  };

  const openStore = () => {
    const link = `${window.location.origin}/s/${savedSlug || slug}`;
    window.open(link, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">অনলাইন দোকান (Public Store)</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">গ্রাহকদের জন্য আপনার ডিজিটাল দোকান</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {/* Loading State */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <span className="ml-3 text-slate-500">দোকানের তথ্য লোড হচ্ছে...</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 p-3 rounded-xl text-sm flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}
              
              {success && (
                <div className="mb-4 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-xl text-sm flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p>{success}</p>
                </div>
              )}

              {/* Existing Store Info Banner */}
              {existingStore && savedSlug && (
                <div className="mb-5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-2">🟢 আপনার দোকান অনলাইনে আছে!</p>
                  <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-lg p-2 border">
                    <span className="text-xs text-slate-500 flex-1 truncate">{window.location.origin}/s/{savedSlug}</span>
                    <button onClick={copyLink} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="লিংক কপি">
                      <Copy className="w-4 h-4" />
                    </button>
                    <button onClick={openStore} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="দোকান দেখুন">
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">এই লিংকটি গ্রাহকদের শেয়ার করুন। লিংকটি সবসময় একই থাকবে।</p>
                </div>
              )}

              <div className="space-y-5">
                {/* Store Display Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    🏪 অনলাইন দোকানের নাম
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="যেমন: নূর আলম স্টুডিও & টেলিকম"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-2.5 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">গ্রাহকরা এই নামটি দেখবে। বাংলা বা যেকোনো ভাষায় লিখতে পারবেন।</p>
                </div>

                {/* Link Setup */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    দোকানের লিংক (URL)
                  </label>
                  <div className="flex items-center mt-1">
                    <span className="px-3 py-2.5 bg-slate-100 dark:bg-slate-700 border border-r-0 border-slate-300 dark:border-slate-600 rounded-l-xl text-slate-500 dark:text-slate-400 text-sm">
                      {window.location.origin}/s/
                    </span>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      className={`flex-1 min-w-0 block w-full px-3 py-2.5 rounded-none rounded-r-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm ${savedSlug ? 'bg-slate-50' : ''}`}
                      placeholder="rahim-telecom"
                      disabled={!!savedSlug}
                    />
                  </div>
                  {savedSlug ? (
                    <p className="mt-1 text-xs text-emerald-600">✅ এই লিংকটি সংরক্ষিত। গ্রাহকরা সবসময় এই লিংক দিয়ে আপনার দোকান পাবে।</p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">আপনার দোকানের নাম ইংরেজিতে লিখুন (যেমন: rahim-telecom, nur-store, karim-fashion)। শুধু ছোট হাতের ইংরেজি, সংখ্যা ও হাইফেন (-)।</p>
                  )}
                </div>

                {/* WhatsApp Number */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    হোয়াটসঅ্যাপ নম্বর (অর্ডার গ্রহণের জন্য)
                  </label>
                  <input
                    type="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-2.5 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Cash on Delivery & Payment Info */}
                <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-3.5 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0 text-emerald-700 dark:text-emerald-300 mt-0.5">
                    <Truck className="w-4 h-4" />
                  </div>
                  <div className="text-xs">
                    <p className="font-bold text-emerald-900 dark:text-emerald-200">
                      🚚 ক্যাশ অন ডেলিভারি (Cash on Delivery) সক্রিয়
                    </p>
                    <p className="text-emerald-700 dark:text-emerald-300/80 text-[11px] mt-0.5 leading-relaxed">
                      গ্রাহকরা চেকআউটে সরাসরি পণ্য হাতে পেয়ে ক্যাশ টাকায় মূল্য পরিশোধের সুযোগ পাবেন। এছাড়া নিচে বিকাশ, নগদ ও রকেট নম্বর যুক্ত করলে তারা মোবাইল ব্যাংকিংয়ের মাধ্যমেও অগ্রিম টাকা পাঠাতে পারবে।
                    </p>
                  </div>
                </div>

                {/* Mobile Banking Numbers (bKash / Nagad / Rocket) */}
                <div className="bg-pink-50/60 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800/40 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-bold text-slate-800 dark:text-white">
                      💳 মোবাইল ব্যাংকিং নম্বর (বিকাশ / নগদ / রকেট)
                    </label>
                    {whatsapp.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          setBkashNumber(whatsapp.trim());
                          setNagadNumber(whatsapp.trim());
                        }}
                        className="text-xs font-semibold text-pink-600 dark:text-pink-400 hover:underline cursor-pointer"
                      >
                        হোয়াটসঅ্যাপ নম্বরই ব্যবহার করুন
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    গ্রাহক চেকআউটে মোবাইল ব্যাংকিং সিলেক্ট করলে এই নম্বরে টাকা পাঠিয়ে Transaction ID (TrxID) সাবমিট করতে পারবে। খালি রাখলে হোয়াটসঅ্যাপ নম্বরটি পেমেন্ট নম্বর হিসেবে দেখানো হবে।
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <span className="block text-[11px] font-bold text-pink-600 dark:text-pink-400 mb-1">bKash (বিকাশ)</span>
                      <input
                        type="tel"
                        value={bkashNumber}
                        onChange={(e) => setBkashNumber(e.target.value)}
                        placeholder={whatsapp || '01XXXXXXXXX'}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold text-orange-600 dark:text-orange-400 mb-1">Nagad (নগদ)</span>
                      <input
                        type="tel"
                        value={nagadNumber}
                        onChange={(e) => setNagadNumber(e.target.value)}
                        placeholder={whatsapp || '01XXXXXXXXX'}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold text-purple-600 dark:text-purple-400 mb-1">Rocket (রকেট)</span>
                      <input
                        type="tel"
                        value={rocketNumber}
                        onChange={(e) => setRocketNumber(e.target.value)}
                        placeholder="ঐচ্ছিক (Optional)"
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Auto Sync Toggle */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                        🔄 অটো সিঙ্ক (Auto Sync)
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {autoSync 
                          ? '✅ ON — নতুন পণ্য যোগ করলে অনলাইন দোকানে স্বয়ংক্রিয় আপডেট হবে' 
                          : '❌ OFF — ম্যানুয়ালি "পণ্য আপডেট করুন" ক্লিক করে আপডেট করতে হবে'
                        }
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const newVal = !autoSync;
                        setAutoSync(newVal);
                        localStorage.setItem('ledgero_auto_sync', newVal ? 'true' : 'false');
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none cursor-pointer ${
                        autoSync ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${
                        autoSync ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                </div>

                {/* Product Selection */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      পণ্য নির্বাচন করুন ({selectedProducts.length}/{availableProducts.length})
                    </label>
                    <button 
                      onClick={handleSelectAll}
                      className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
                    >
                      {selectedProducts.length === availableProducts.length ? 'সব বাতিল করুন' : 'সব নির্বাচন করুন'}
                    </button>
                  </div>
                  
                  <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 p-2 max-h-60 overflow-y-auto">
                    {availableProducts.length === 0 ? (
                      <p className="text-center text-slate-500 text-sm py-4">আপনার স্টকে কোনো পণ্য নেই</p>
                    ) : (
                      <div className="space-y-1">
                        {availableProducts.map(product => {
                          const isSelected = selectedProducts.some(p => p.id === product.id);
                          return (
                            <div 
                              key={product.id}
                              onClick={() => toggleProduct(product)}
                              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                                isSelected 
                                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800' 
                                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                                  isSelected 
                                    ? 'bg-indigo-500 border-indigo-500' 
                                    : 'border-slate-300 dark:border-slate-600'
                                }`}>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                                </div>
                                <div>
                                  <p className="font-medium text-slate-800 dark:text-white text-sm">{product.name}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatBDT(product.sellPrice)}</p>
                                <p className="text-xs text-slate-400">স্টক: {product.closingStock || product.openingStock || 0} {product.unit}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    গ্রাহকরা শুধুমাত্র বিক্রয় মূল্য (Selling Price) দেখতে পারবেন।
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isLoading && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row gap-3">
            {existingStore ? (
              <>
                <button
                  onClick={handleGoOffline}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl border-2 border-rose-500 text-rose-500 hover:bg-rose-50 font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  অফলাইন করুন
                </button>
                <button
                  onClick={handleGoOnline}
                  disabled={isSubmitting}
                  className="w-full sm:flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md shadow-indigo-200 dark:shadow-none cursor-pointer"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                  <span>পণ্য আপডেট করুন</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleGoOnline}
                disabled={isSubmitting || !slug || !whatsapp || selectedProducts.length === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md shadow-indigo-200 dark:shadow-none cursor-pointer"
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
                <span>অনলাইন দোকান চালু করুন</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GoOnlineSetup;
