import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase/firebaseConfig';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { saveCustomerStoreOrder } from '../../firebase/firestoreService';
import { 
  Search, Plus, Minus, AlertCircle, ShoppingCart, Loader2, MapPin, 
  Phone, ChevronUp, ChevronDown, X, Send, CheckCircle2, ArrowRight, 
  Truck, CreditCard, MessageCircle, ShoppingBag, Check, Sparkles, Copy, Clock,
  AlertTriangle
} from 'lucide-react';

const formatBDT = (amount) => {
  return `৳ ${Math.round(amount || 0).toLocaleString('en-IN')}`;
};

const PAYMENT_METHOD_LABELS = {
  cod: 'ক্যাশ অন ডেলিভারি (COD)',
  bkash_manual: 'bKash (বিকাশ)',
  nagad_manual: 'Nagad (নগদ)',
  rocket_manual: 'Rocket (রকেট)',
  whatsapp_pay: 'WhatsApp এ কথা বলে পেমেন্ট',
};

const PublicStorefront = ({ shopSlug }) => {
  const [shopData, setShopData] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState({});
  const [isCartExpanded, setIsCartExpanded] = useState(false);

  // Direct Checkout & Order States
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(null);
  const [orderError, setOrderError] = useState('');
  const [copiedPaymentNum, setCopiedPaymentNum] = useState(false);
  const [isMyOrdersOpen, setIsMyOrdersOpen] = useState(false);
  const [myOrders, setMyOrders] = useState(() => {
    try {
      const saved = localStorage.getItem(`ledgero_customer_orders_${shopSlug}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Checkout Form Fields
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [isInsideDhaka, setIsInsideDhaka] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [paymentTrxId, setPaymentTrxId] = useState('');
  const [paymentSenderPhone, setPaymentSenderPhone] = useState('');
  const [autoOpenWhatsApp, setAutoOpenWhatsApp] = useState(true);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const fetchStoreData = async () => {
      try {
        const publicInfoRef = doc(db, 'stores', shopSlug, 'public', 'info');
        const shopSnap = await getDoc(publicInfoRef);

        if (!shopSnap.exists() || !shopSnap.data().isActive) {
          setError('notfound');
          setLoading(false);
          return;
        }
        
        setShopData(shopSnap.data());

        const productsRef = collection(db, 'stores', shopSlug, 'products');
        const productsSnap = await getDocs(productsRef);
        // Defense-in-depth: strictly project only public storefront product fields
        // so legacy un-migrated documents can never expose buyPrice, profit, cogs, or batches in memory.
        const productsList = productsSnap.docs.map(d => {
          const raw = d.data() || {};
          return {
            id: d.id,
            name: raw.name || 'Product',
            price: Number(raw.price ?? raw.sellPrice) || 0,
            unit: raw.unit || 'pcs',
            category: raw.category || '',
            inStock: raw.inStock !== false,
            stock: raw.stock !== undefined ? Number(raw.stock) : undefined,
          };
        });
        
        setProducts(productsList);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching store:", err);
        setError('servererror');
        setLoading(false);
      }
    };

    fetchStoreData();
  }, [shopSlug]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    return products.filter(p => p.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [products, searchQuery]);

  const updateCart = (productId, delta) => {
    setCart(prev => {
      const newCart = { ...prev };
      const product = products.find(p => p.id === productId);
      if (!product) return prev;
      if (product.inStock === false) return prev;

      if (!newCart[productId] && delta > 0 && Object.keys(newCart).length >= 5) {
        setOrderError('একটি অর্ডারে সর্বোচ্চ ৫ ধরনের পণ্য যোগ করা যাবে।');
        return prev;
      }

      const maxStock = Number.isFinite(Number(product.stock))
        ? Math.max(0, Number(product.stock))
        : Infinity;
      const currentQty = newCart[productId]?.qty || 0;
      const newQty = Math.min(maxStock, Math.max(0, currentQty + delta));
      
      if (newQty === 0) {
        delete newCart[productId];
      } else {
        newCart[productId] = { ...product, qty: newQty };
      }
      return newCart;
    });
  };

  const cartItems = Object.values(cart);
  const cartTotal = cartItems.reduce((sum, item) => sum + ((Number(item.price) || 0) * item.qty), 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.qty, 0);

  const activeMerchantPaymentNumber = useMemo(() => {
    if (!shopData) return '';
    if (paymentMethod === 'bkash_manual') return shopData.bkashNumber || '';
    if (paymentMethod === 'nagad_manual') return shopData.nagadNumber || '';
    if (paymentMethod === 'rocket_manual') return shopData.rocketNumber || '';
    return '';
  }, [shopData, paymentMethod]);

  const copyMerchantPaymentNumber = () => {
    if (!activeMerchantPaymentNumber) return;
    navigator.clipboard?.writeText(activeMerchantPaymentNumber);
    setCopiedPaymentNum(true);
    setTimeout(() => setCopiedPaymentNum(false), 2000);
  };

  const openOrderWhatsAppLink = (orderId, orderObj) => {
    if (!orderObj || !shopData?.whatsappNumber) return;
    const shopName = shopData?.displayName || shopData?.shopName || 'Shop';
    let phone = String(shopData.whatsappNumber || '').replace(/\D/g, '');
    if (!phone) return;
    if (!phone.startsWith('88')) {
      phone = phone.startsWith('0') ? '88' + phone : '880' + phone;
    }
    const payLabel = PAYMENT_METHOD_LABELS[orderObj.paymentMethod] || 'ক্যাশ অন ডেলিভারি (COD)';
    let msg = `🛍️ *${shopName}* — অনলাইন অর্ডার নিশ্চিতকরণ\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📋 *অর্ডার আইডি:* #${String(orderId || orderObj.id || '').slice(-6).toUpperCase()}\n`;
    msg += `👤 *নাম:* ${orderObj.customerName}\n`;
    msg += `📱 *ফোন:* ${orderObj.customerPhone}\n`;
    msg += `📍 *ঠিকানা:* ${orderObj.customerAddress}\n`;
    msg += `🚚 *ডেলিভারি এরিয়া:* ${orderObj.isInsideDhaka ? 'ঢাকার ভিতরে (৳60)' : 'ঢাকার বাইরে (৳120)'}\n`;
    msg += `💳 *পেমেন্ট মাধ্যম:* ${payLabel}\n`;
    if (orderObj.paymentTrxId) {
      msg += `🔑 *Transaction ID (TrxID):* ${orderObj.paymentTrxId}\n`;
    }
    if (orderObj.paymentSenderPhone) {
      msg += `📲 *প্রেরকের নম্বর:* ${orderObj.paymentSenderPhone}\n`;
    }
    if (orderObj.notes) msg += `📝 *নোট:* ${orderObj.notes}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📦 *পণ্য তালিকা:*\n`;
    (orderObj.items || []).forEach((it, idx) => {
      msg += `  ${idx + 1}. ${it.productName} × ${it.quantity} = ${formatBDT(it.subtotal)}\n`;
    });
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *সর্বমোট প্রদেয়: ${formatBDT(orderObj.totalAmount)}*\n\n`;
    if (orderObj.paymentTrxId) {
      msg += `✅ আমি মোবাইল ব্যাংকিংয়ে (${payLabel}) পেমেন্ট করে Transaction ID (${orderObj.paymentTrxId}) দিয়েছি। দয়া করে যাচাই করে অর্ডারটি কনফার্ম করুন!`;
    } else if (orderObj.paymentMethod !== 'cod') {
      msg += `💬 আমি মোবাইল ব্যাংকিং (${payLabel}) এর মাধ্যমে পেমেন্ট করতে চাই। দয়া করে আপনার সঠিক অ্যাকাউন্ট নম্বর ও পেমেন্ট নির্দেশ পাঠান!`;
    } else {
      msg += `✅ আমি ক্যাশ অন ডেলিভারিতে অর্ডারটি কনফার্ম করেছি। দ্রুত ডেলিভারির অনুরোধ রইল!`;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleWhatsAppOrder = () => {
    if (cartItems.length === 0 || !shopData?.whatsappNumber) return;

    const shopName = shopData?.displayName || shopData?.shopName || 'Shop';
    let message = `🛍️ *${shopName}* — নতুন অর্ডার\n━━━━━━━━━━━━━━━\n\n`;
    message += `📦 *পণ্য তালিকা:*\n`;
    
    cartItems.forEach((item, index) => {
      const unitPrice = Number(item.price) || 0;
      message += `  ${index + 1}. ${item.name} × ${item.qty} = ${formatBDT(unitPrice * item.qty)}\n`;
    });

    message += `\n━━━━━━━━━━━━━━━\n`;
    message += `💰 *মোট: ${formatBDT(cartTotal)}*\n\n`;
    message += `👤 নাম: \n📱 ফোন: \n📍 ঠিকানা: `;

    let phone = String(shopData.whatsappNumber || '').replace(/\D/g, '');
    if (!phone) return;
    if (!phone.startsWith('88')) {
      phone = phone.startsWith('0') ? '88' + phone : '880' + phone;
    }

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const deliveryCharge = isInsideDhaka ? 60 : 120;
  const grandTotal = cartTotal + (cartCount > 0 ? deliveryCharge : 0);

  const handleDirectOrderSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!customerName.trim()) {
      setOrderError('অনুগ্রহ করে আপনার নাম লিখুন');
      return;
    }
    const cleanPhone = customerPhone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setOrderError('সঠিক মোবাইল নম্বর প্রদান করুন (যেমন: ০১৭১২৩৪৫৬৭৮)');
      return;
    }
    if (!customerAddress.trim()) {
      setOrderError('অনুগ্রহ করে সম্পূর্ণ ডেলিভারির ঠিকানা লিখুন');
      return;
    }

    setIsSubmittingOrder(true);
    setOrderError('');

    try {
      const isMobileBanking = paymentMethod !== 'cod';
      const cleanTrxId = isMobileBanking ? paymentTrxId.trim().slice(0, 60) : '';
      const cleanSenderPhone = isMobileBanking ? (paymentSenderPhone.trim() || customerPhone.trim()).slice(0, 25) : '';
      const calculatedPaymentStatus = isMobileBanking
        ? (cleanTrxId ? 'submitted_for_verification' : 'awaiting_payment')
        : 'due_on_delivery';

      const orderPayload = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerAddress: customerAddress.trim(),
        isInsideDhaka,
        deliveryCharge,
        subtotal: cartTotal,
        totalAmount: grandTotal,
        paymentMethod,
        paymentStatus: calculatedPaymentStatus,
        paymentTrxId: cleanTrxId,
        paymentSenderPhone: cleanSenderPhone,
        notes: notes.trim(),
        items: cartItems.map(item => {
          const unitPrice = Number(item.price) || 0;
          return {
            productId: item.id,
            productName: item.name,
            quantity: item.qty,
            unitPrice,
            subtotal: unitPrice * item.qty
          };
        }),
      };

      const result = await saveCustomerStoreOrder(shopSlug, orderPayload);
      if (result.success) {
        const savedOrderEntry = { orderId: result.orderId, order: result.order };
        setOrderSuccess(savedOrderEntry);
        const updatedOrders = [result.order, ...myOrders.filter(o => o.id !== result.order.id)].slice(0, 20);
        setMyOrders(updatedOrders);
        try {
          localStorage.setItem(`ledgero_customer_orders_${shopSlug}`, JSON.stringify(updatedOrders));
        } catch { /* ignore storage quota */ }
        setCart({});
        setPaymentTrxId('');
        setIsCartExpanded(false);
        setIsCheckoutOpen(false);
        if (autoOpenWhatsApp && shopData?.whatsappNumber) {
          openOrderWhatsAppLink(result.orderId, result.order);
        }
      }
    } catch (err) {
      console.error('Order submission error:', err);
      setOrderError('অর্ডার গ্রহণ করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleSendOrderSuccessToWhatsApp = () => {
    if (!orderSuccess) return;
    openOrderWhatsAppLink(orderSuccess.orderId, orderSuccess.order);
  };

  // ─── Loading ───
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mb-6 animate-pulse">
          <ShoppingCart className="w-8 h-8 text-white" />
        </div>
        <div className="w-48 h-1 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full animate-[loading_1.5s_ease-in-out_infinite]" style={{width: '60%', animation: 'loading 1.5s ease-in-out infinite'}} />
        </div>
        <p className="text-slate-400 mt-4 text-sm font-medium tracking-wide">লোড হচ্ছে...</p>
        <style>{`@keyframes loading { 0%{transform:translateX(-100%)} 50%{transform:translateX(100%)} 100%{transform:translateX(-100%)} }`}</style>
      </div>
    );
  }

  // ─── Error ───
  if (error) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-6">
          <span className="text-4xl">🔍</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-3">
          {error === 'notfound' ? 'দোকান পাওয়া যায়নি' : 'কিছু একটা সমস্যা হয়েছে'}
        </h2>
        <p className="text-slate-500 max-w-sm leading-relaxed">
          {error === 'notfound' 
            ? 'এই লিংকটি ভুল হতে পারে অথবা দোকানটি বর্তমানে বন্ধ আছে।'
            : 'সার্ভার থেকে তথ্য লোড করতে সমস্যা হয়েছে। একটু পর আবার চেষ্টা করুন।'
          }
        </p>
        <button onClick={() => window.location.reload()} className="mt-6 px-6 py-2.5 bg-slate-900 text-white rounded-full text-sm font-medium hover:bg-slate-800 transition-colors">
          আবার চেষ্টা করুন
        </button>
      </div>
    );
  }

  const displayName = shopData?.displayName || shopData?.shopName || 'Shop';
  const initials = displayName.slice(0, 2);

  return (
    <div className="min-h-screen bg-[#fafafa]" style={{fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'}}>
      
      {/* ─── Hero Header ─── */}
      <header className="bg-white border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-4 pt-8 pb-6">
          {/* Store Identity */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-200/50 flex-shrink-0">
                <span className="text-2xl font-bold text-white">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">{displayName}</h1>
                {shopData?.address && (
                  <p className="text-slate-500 text-sm mt-1 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{shopData.address}</span>
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsMyOrdersOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors flex-shrink-0 cursor-pointer"
            >
              <Clock className="w-4 h-4 text-emerald-600" />
              <span>আমার অর্ডার</span>
              {myOrders.length > 0 && (
                <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.2 rounded-full">
                  {myOrders.length}
                </span>
              )}
            </button>
          </div>

          {/* Search Bar — Apple style */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="পণ্য খুঁজুন..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100/80 backdrop-blur text-slate-800 rounded-2xl pl-12 pr-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:bg-white border border-transparent focus:border-emerald-200 transition-all text-[15px] placeholder:text-slate-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ─── Product Count ─── */}
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-3">
        <p className="text-[13px] font-medium text-slate-500 uppercase tracking-wider">
          {searchQuery ? `"${searchQuery}" — ${filteredProducts.length}টি পাওয়া গেছে` : `${products.length}টি পণ্য`}
        </p>
      </div>

      {/* ─── Products Grid ─── */}
      <main className="max-w-3xl mx-auto px-4 pb-36">
        {products.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-6">
              <span className="text-5xl">📦</span>
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">পণ্য যোগ করা হয়নি</h3>
            <p className="text-slate-500 text-sm">দোকানদার শীঘ্রই পণ্য যোগ করবেন।</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-4xl mb-4 block">🔍</span>
            <p className="text-slate-500">কোনো পণ্য পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {filteredProducts.map(product => {
              const qty = cart[product.id]?.qty || 0;
              const hasFiniteStock = Number.isFinite(Number(product.stock));
              const maxStock = hasFiniteStock ? Math.max(0, Number(product.stock)) : Infinity;
              const isOutOfStock = product.inStock === false || maxStock === 0;
              const isAtMaxStock = hasFiniteStock && qty >= maxStock;
              return (
                <div 
                  key={product.id} 
                  className={`bg-white rounded-2xl border border-slate-100 overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-slate-200/50 hover:-translate-y-0.5 ${isOutOfStock ? 'opacity-60' : ''}`}
                >
                  {/* Product Image Placeholder */}
                  <div className="w-full aspect-square bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center relative">
                    <span className="text-5xl font-bold text-slate-200 select-none">
                      {product.name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                    {isOutOfStock && (
                      <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                        <span className="bg-slate-800 text-white text-xs font-medium px-3 py-1 rounded-full">স্টক নেই</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Product Info */}
                  <div className="p-3.5">
                    <h3 className="font-semibold text-slate-800 text-[14px] leading-snug line-clamp-2 mb-1 min-h-[40px]">
                      {product.name}
                    </h3>
                    {hasFiniteStock && !isOutOfStock && (
                      <p className="text-[11px] text-emerald-600 font-medium mb-1">
                        স্টকে আছে: {maxStock} {product.unit || 'পিস'}
                      </p>
                    )}
                    <p className="text-lg font-bold text-slate-900 mb-3">
                      {formatBDT(product.price)}
                    </p>
                    
                    {/* Add to Cart */}
                    {isOutOfStock ? (
                      <div className="text-center text-xs text-slate-400 py-2">স্টক শেষ</div>
                    ) : qty > 0 ? (
                      <div className="flex items-center justify-between bg-emerald-50 rounded-xl p-1.5">
                        <button 
                          onClick={() => updateCart(product.id, -1)} 
                          className="w-9 h-9 flex items-center justify-center text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors active:scale-90"
                        >
                          <Minus className="w-5 h-5" />
                        </button>
                        <span className="font-bold text-emerald-700 text-lg tabular-nums">{qty}</span>
                        <button 
                          onClick={() => updateCart(product.id, 1)} 
                          disabled={isAtMaxStock}
                          title={isAtMaxStock ? 'সর্বোচ্চ স্টক সীমা পূর্ণ' : 'আরও যোগ করুন'}
                          className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${isAtMaxStock ? 'text-slate-300 cursor-not-allowed' : 'text-emerald-600 hover:bg-emerald-100 active:scale-90'}`}
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => updateCart(product.id, 1)}
                        className="w-full bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-white font-medium py-2.5 rounded-xl text-sm transition-all active:scale-[0.98]"
                      >
                        কার্টে যোগ করুন
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Powered by */}
        <div className="text-center mt-12 pb-8">
          <p className="text-xs text-slate-300 font-medium tracking-wide">Powered by <span className="text-slate-400">Ledgero</span></p>
        </div>
      </main>

      {/* ─── Floating Cart Bar ─── */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50">
          {/* Cart Details Drawer */}
          {isCartExpanded && (
            <div className="bg-white border-t border-slate-100 shadow-2xl">
              <div className="max-w-3xl mx-auto">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-lg">আপনার কার্ট</h3>
                  <button onClick={() => setIsCartExpanded(false)} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto px-4">
                  {cartItems.map(item => {
                    const hasFiniteStock = Number.isFinite(Number(item.stock));
                    const isAtMaxStock = hasFiniteStock && item.qty >= Number(item.stock);
                    return (
                      <div key={item.id} className="flex items-center justify-between py-4 border-b border-slate-50 last:border-0">
                        <div className="flex-1 pr-4">
                          <p className="font-medium text-slate-800 text-sm">{item.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{formatBDT(item.price)} × {item.qty}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <p className="font-bold text-slate-800 text-sm tabular-nums">{formatBDT(item.price * item.qty)}</p>
                          <div className="flex items-center bg-slate-100 rounded-lg">
                            <button onClick={() => updateCart(item.id, -1)} className="p-1.5 hover:bg-slate-200 rounded-l-lg text-slate-600 transition-colors">
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-sm w-7 text-center font-bold text-slate-800 tabular-nums">{item.qty}</span>
                            <button
                              onClick={() => updateCart(item.id, 1)}
                              disabled={isAtMaxStock}
                              className={`p-1.5 rounded-r-lg transition-colors ${isAtMaxStock ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-slate-200 text-slate-600'}`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Cart Summary Bar */}
          <div className="bg-white/95 backdrop-blur-xl border-t border-slate-200 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.12)]">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
              <button 
                onClick={() => setIsCartExpanded(!isCartExpanded)}
                className="flex items-center gap-2.5 flex-shrink-0 cursor-pointer"
              >
                <div className="relative">
                  <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center">
                    <ShoppingCart className="w-5 h-5 text-slate-600" />
                  </div>
                  <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[11px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm">
                    {cartCount}
                  </span>
                </div>
                <div className="text-left hidden xs:block">
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">মোট</p>
                  <p className="text-base font-bold text-slate-900 leading-tight tabular-nums">{formatBDT(cartTotal)}</p>
                </div>
              </button>
              
              {/* Primary Direct Order Button */}
              <button
                onClick={() => { setIsCartExpanded(false); setIsCheckoutOpen(true); }}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-md shadow-emerald-500/20 text-sm sm:text-base cursor-pointer"
              >
                <Truck className="w-4 h-4" />
                <span>সরাসরি অর্ডার করুন</span>
                <span className="text-xs bg-emerald-700/80 px-2 py-0.5 rounded-lg font-mono">{formatBDT(cartTotal)}</span>
              </button>

              {/* Secondary WhatsApp Button */}
              <button
                onClick={handleWhatsAppOrder}
                title="WhatsApp-এ মেসেজ দিয়ে অর্ডার করুন"
                className="bg-[#25D366] hover:bg-[#22c55e] active:bg-[#16a34a] text-white p-3 rounded-xl flex items-center justify-center transition-all active:scale-[0.98] shadow-md shadow-emerald-200/50 cursor-pointer"
              >
                <MessageCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Direct Checkout Modal ─── */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
          <div 
            className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Checkout Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">চেকআউট ও অর্ডার কনফার্ম</h3>
                  <p className="text-xs text-slate-400">{cartCount}টি পণ্য নির্বাচিত হয়েছে</p>
                </div>
              </div>
              <button 
                onClick={() => setIsCheckoutOpen(false)} 
                className="p-1.5 hover:bg-slate-200/60 rounded-full text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Body */}
            <div className="overflow-y-auto p-4 sm:p-5 space-y-4">
              {orderError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{orderError}</span>
                </div>
              )}

              {/* Customer Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  আপনার নাম <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="যেমন: মোঃ সাকিব হোসেন"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition-all text-slate-800"
                />
              </div>

              {/* Customer Phone */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  মোবাইল নম্বর <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="০১৭xxxxxxxx"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition-all text-slate-800"
                />
              </div>

              {/* Customer Address */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  সম্পূর্ণ ডেলিভারি ঠিকানা <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="বাসা নং, রোড নং, এলাকা, থানা, জেলা"
                  value={customerAddress}
                  onChange={e => setCustomerAddress(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition-all text-slate-800"
                />
              </div>

              {/* Delivery Location Area */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  ডেলিভারি এরিয়া
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsInsideDhaka(true)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isInsideDhaka 
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 ring-2 ring-emerald-500/20' 
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold">ঢাকার ভিতরে</span>
                      {isInsideDhaka && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                    <p className="text-xs text-slate-500">চার্জ: ৳৬০</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsInsideDhaka(false)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      !isInsideDhaka 
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 ring-2 ring-emerald-500/20' 
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold">ঢাকার বাইরে</span>
                      {!isInsideDhaka && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                    <p className="text-xs text-slate-500">চার্জ: ৳১২০</p>
                  </button>
                </div>
              </div>

              {/* Payment Method: 4 Direct Options Side-by-Side (COD + bKash + Nagad + Rocket) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  পেমেন্ট পদ্ধতি বেছে নিন (Payment Method)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* 1. Cash on Delivery */}
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cod')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentMethod === 'cod' 
                        ? 'border-emerald-500 bg-emerald-50/70 text-emerald-950 ring-2 ring-emerald-500/20 shadow-xs' 
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                        🚚 ক্যাশ অন ডেলিভারি
                      </span>
                      {paymentMethod === 'cod' && <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">পণ্য হাতে পেয়ে টাকা</p>
                  </button>

                  {/* 2. bKash */}
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('bkash_manual')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentMethod === 'bkash_manual' 
                        ? 'border-pink-500 bg-pink-50/70 text-pink-950 ring-2 ring-pink-500/20 shadow-xs' 
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-pink-700 flex items-center gap-1">
                        💳 bKash (বিকাশ)
                      </span>
                      {paymentMethod === 'bkash_manual' && <Check className="w-3.5 h-3.5 text-pink-600 flex-shrink-0" />}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">বিকাশ সেন্ড মানি</p>
                  </button>

                  {/* 3. Nagad */}
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('nagad_manual')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentMethod === 'nagad_manual' 
                        ? 'border-orange-500 bg-orange-50/70 text-orange-950 ring-2 ring-orange-500/20 shadow-xs' 
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-orange-700 flex items-center gap-1">
                        💳 Nagad (নগদ)
                      </span>
                      {paymentMethod === 'nagad_manual' && <Check className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">নগদ সেন্ড মানি</p>
                  </button>

                  {/* 4. Rocket */}
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('rocket_manual')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentMethod === 'rocket_manual' 
                        ? 'border-purple-500 bg-purple-50/70 text-purple-950 ring-2 ring-purple-500/20 shadow-xs' 
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-purple-700 flex items-center gap-1">
                        💳 Rocket (রকেট)
                      </span>
                      {paymentMethod === 'rocket_manual' && <Check className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">রকেট সেন্ড মানি</p>
                  </button>
                </div>

                {/* Cash on Delivery Info Box */}
                {paymentMethod === 'cod' && (
                  <div className="mt-3 p-3.5 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50/80 via-white to-emerald-50/40 flex items-start gap-3 shadow-xs">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center flex-shrink-0 text-emerald-700 mt-0.5">
                      <Truck className="w-5 h-5" />
                    </div>
                    <div className="text-xs space-y-1">
                      <p className="font-bold text-emerald-950 flex items-center gap-1.5">
                        🚚 ক্যাশ অন ডেলিভারি (Cash on Delivery)
                      </p>
                      <p className="text-emerald-800/90 leading-relaxed text-[11px]">
                        পণ্য হাতে পাওয়ার সময় ডেলিভারি প্রতিনিধিকে সর্বমোট <strong className="font-mono font-bold text-emerald-950">{formatBDT(grandTotal)}</strong> নগদ টাকা পরিশোধ করবেন। কোনো অগ্রিম পেমেন্ট বা TrxID জমা দেওয়ার প্রয়োজন নেই।
                      </p>
                    </div>
                  </div>
                )}

                {/* Mobile Banking Details Card (bKash / Nagad / Rocket) */}
                {paymentMethod !== 'cod' && (
                  <div className="mt-3 p-3.5 rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50/70 via-white to-orange-50/40 space-y-3 shadow-xs">

                    {/* Merchant Payment Number Box or Missing Configuration Warning */}
                    {activeMerchantPaymentNumber ? (
                      <div className="bg-white rounded-xl p-3 border border-pink-100 flex items-center justify-between gap-2 shadow-xs">
                        <div>
                          <p className="text-[11px] text-slate-500 font-medium">
                            দোকানদারের {PAYMENT_METHOD_LABELS[paymentMethod] || 'মোবাইল ব্যাংকিং'} নম্বর (Send Money):
                          </p>
                          <p className="text-base font-extrabold font-mono text-slate-900 tracking-wide mt-0.5">
                            {activeMerchantPaymentNumber}
                          </p>
                          <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                            প্রদেয় পরিমাণ: {formatBDT(grandTotal)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={copyMerchantPaymentNumber}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer flex-shrink-0"
                        >
                          {copiedPaymentNum ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedPaymentNum ? 'কপি হয়েছে' : 'নম্বর কপি'}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 flex items-start gap-2.5 text-amber-900 text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="leading-relaxed">
                          <p className="font-bold text-amber-800">
                            ⚠️ এই দোকানে {PAYMENT_METHOD_LABELS[paymentMethod] || 'এই ওয়ালেট'} নম্বর সেট করা নেই।
                          </p>
                          <p className="mt-0.5 text-amber-700">
                            দয়া করে অন্য মেথড (যেমন bKash বা ক্যাশ অন ডেলিভারি) বেছে নিন, অথবা অর্ডার কনফার্ম করে সরাসরি WhatsApp-এ কথা বলে পেমেন্ট করুন।
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Transaction ID & Sender Phone Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Transaction ID (TrxID)
                        </label>
                        <input
                          type="text"
                          placeholder="যেমন: BKS982374X"
                          value={paymentTrxId}
                          onChange={e => setPaymentTrxId(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500 text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          যে নম্বর থেকে পাঠিয়েছেন
                        </label>
                        <input
                          type="tel"
                          placeholder={customerPhone || '01XXXXXXXXX'}
                          value={paymentSenderPhone}
                          onChange={e => setPaymentSenderPhone(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500 text-slate-800"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      💡 উপরের নম্বরে টাকা পাঠিয়ে <strong>Transaction ID (TrxID)</strong> দিন, অথবা খালি রেখে অর্ডার কনফার্ম করে সরাসরি <strong>WhatsApp-এ দোকানদারের সাথে কথা বলে</strong> পেমেন্ট সম্পন্ন করুন।
                    </p>
                  </div>
                )}
              </div>

              {/* Optional Note */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  বিশেষ নির্দেশনা (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  placeholder="যেমন: কোনো নির্দিষ্ট সময় বা ডেলিভারি নির্দেশ"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition-all text-slate-800"
                />
              </div>

              {/* Price Breakdown Summary */}
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 space-y-1.5">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>পণ্যের মূল্য</span>
                  <span className="font-medium tabular-nums">{formatBDT(cartTotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>ডেলিভারি চার্জ</span>
                  <span className="font-medium tabular-nums">{formatBDT(deliveryCharge)}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-bold text-slate-900">
                  <span>সর্বমোট প্রদেয়</span>
                  <span className="text-emerald-600 tabular-nums">{formatBDT(grandTotal)}</span>
                </div>
              </div>

              {/* Auto-WhatsApp Toggle */}
              {shopData?.whatsappNumber && (
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoOpenWhatsApp}
                    onChange={e => setAutoOpenWhatsApp(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-600"
                  />
                  <span className="text-xs font-medium text-emerald-900">
                    অর্ডার কনফার্মের সাথে সাথে <strong>WhatsApp-এ দোকানদারকে অর্ডার ও পেমেন্ট মেসেজ পাঠান</strong>
                  </span>
                </label>
              )}
            </div>

            {/* Submit Footer */}
            <div className="p-4 border-t border-slate-100 bg-white">
              <button
                type="button"
                disabled={isSubmittingOrder}
                onClick={handleDirectOrderSubmit}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 disabled:opacity-60 text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-emerald-600/30 text-base cursor-pointer"
              >
                {isSubmittingOrder ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>অর্ডার গ্রহণ করা হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span>অর্ডার নিশ্চিত করুন — {formatBDT(grandTotal)}</span>
                  </>
                )}
              </button>
              <p className="text-center text-[11px] text-slate-400 mt-2">
                অর্ডার কনফার্ম করার পর দোকানদার আপনার পেমেন্ট ও অর্ডার যাচাই করে ডেলিভারি করবেন।
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Order Success Modal ─── */}
      {orderSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div 
            className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl text-center"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4 shadow-inner">
              <CheckCircle2 className="w-9 h-9 stroke-[2.5]" />
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-1">
              অর্ডার সফলভাবে গ্রহণ করা হয়েছে! 🎉
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              দোকানদার শীঘ্রই আপনার অর্ডার ও পেমেন্ট যাচাই করে যোগাযোগ করবেন।
            </p>

            <div className="inline-block bg-slate-100 text-slate-800 font-mono text-xs px-3 py-1.5 rounded-full font-bold mb-5 border border-slate-200">
              অর্ডার আইডি: #{orderSuccess.orderId.slice(-6).toUpperCase()}
            </div>

            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 text-left text-xs space-y-1.5 mb-5">
              <div className="flex justify-between">
                <span className="text-slate-400">গ্রাহক:</span>
                <span className="font-semibold text-slate-700">{orderSuccess.order.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ফোন:</span>
                <span className="font-mono text-slate-700">{orderSuccess.order.customerPhone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">পেমেন্ট মাধ্যম:</span>
                <span className="font-semibold text-slate-700">
                  {PAYMENT_METHOD_LABELS[orderSuccess.order.paymentMethod] || 'ক্যাশ অন ডেলিভারি'}
                </span>
              </div>
              {orderSuccess.order.paymentTrxId && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Transaction ID:</span>
                  <span className="font-mono font-bold text-pink-600">{orderSuccess.order.paymentTrxId}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">ঠিকানা:</span>
                <span className="text-slate-700 text-right truncate max-w-[200px]">{orderSuccess.order.customerAddress}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200 font-bold text-slate-800">
                <span>সর্বমোট:</span>
                <span className="text-emerald-600 text-sm tabular-nums">{formatBDT(orderSuccess.order.totalAmount)}</span>
              </div>
            </div>

            {orderSuccess.order.paymentMethod !== 'cod' && !orderSuccess.order.paymentTrxId && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-left text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">টাকা পাঠিয়ে WhatsApp-এ জানান</p>
                  <p className="mt-0.5 text-amber-700">
                    আপনি TrxID দেননি। নিচের বাটনে ট্যাপ করে WhatsApp-এ দোকানদারকে টাকা পাঠিয়ে TrxID জানিয়ে অর্ডারটি নিশ্চিত করুন।
                  </p>
                </div>
              </div>
            )}

            {orderSuccess.order.paymentMethod !== 'cod' && orderSuccess.order.paymentTrxId && (
              <div className="mb-4 p-3 bg-sky-50 border border-sky-200 rounded-xl text-left text-xs text-sky-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">TrxID যাচাই প্রক্রিয়াধীন</p>
                  <p className="mt-0.5 text-sky-700">
                    দোকানদার SMS মিলিয়ে পেমেন্ট ভেরিফাই করার পরই অর্ডার প্রস্তুত করা হবে। WhatsApp-এ কথা বলতে নিচের বাটনে ট্যাপ করুন।
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={handleSendOrderSuccessToWhatsApp}
                className="w-full bg-[#25D366] hover:bg-[#22c55e] active:bg-[#16a34a] text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-md shadow-emerald-200/50 cursor-pointer"
              >
                <MessageCircle className="w-5 h-5" />
                <span>দোকানদারকে WhatsApp এ মেসেজ দিন</span>
              </button>
              <p className="text-[11px] text-slate-400">
                💡 WhatsApp সরাসরি ওপেন না হলে উপরের বাটনে ট্যাপ করুন
              </p>

              <button
                onClick={() => setOrderSuccess(null)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-4 rounded-xl transition-colors cursor-pointer text-sm"
              >
                দোকানে ফিরে যান
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── My Orders Status Modal (আমার অর্ডার স্ট্যাটাস) ─── */}
      {isMyOrdersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setIsMyOrdersOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">আমার অর্ডার স্ট্যাটাস</h3>
                  <p className="text-xs text-slate-400">এই ব্রাউজার থেকে করা সাম্প্রতিক অর্ডারসমূহ</p>
                </div>
              </div>
              <button
                onClick={() => setIsMyOrdersOpen(false)}
                className="p-1.5 hover:bg-slate-200/60 rounded-full text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-3 flex-1">
              <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">লাইভ স্ট্যাটাস WhatsApp-এ নিশ্চিত করা হয়</p>
                  <p className="text-amber-800/90 text-[11px] leading-relaxed">
                    দোকানদার আপনার পেমেন্ট যাচাই করে সরাসরি WhatsApp-এ আপডেট জানাবেন। ব্রাউজারের এই তালিকাটি আপনার নিজস্ব অর্ডারের রেফারেন্স রসিদ হিসেবে কাজ করে।
                  </p>
                </div>
              </div>

              {myOrders.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-500 text-sm font-medium">আপনি এখনো কোনো অর্ডার করেননি।</p>
                </div>
              ) : (
                myOrders.map((ord) => {
                  const pStatus = ord.paymentStatus || (ord.paymentMethod === 'cod' ? 'due_on_delivery' : (ord.paymentTrxId ? 'submitted_for_verification' : 'awaiting_payment'));
                  return (
                  <div key={ord.id} className="rounded-2xl border border-slate-200 p-3.5 bg-slate-50/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-slate-800">
                        #{String(ord.id || '').slice(-6).toUpperCase()}
                      </span>
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                        pStatus === 'verified'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : pStatus === 'submitted_for_verification'
                            ? 'bg-sky-100 text-sky-800 border border-sky-300'
                            : pStatus === 'rejected'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : pStatus === 'due_on_delivery'
                                ? 'bg-slate-100 text-slate-700 border border-slate-300'
                                : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}>
                        {pStatus === 'verified'
                          ? 'পেমেন্ট নিশ্চিত'
                          : pStatus === 'submitted_for_verification'
                            ? 'যাচাই প্রক্রিয়াধীন (TrxID জমা)'
                            : pStatus === 'rejected'
                              ? 'পেমেন্ট মেলেনি'
                              : pStatus === 'due_on_delivery'
                                ? 'ডেলিভারিতে প্রদেয় (COD)'
                                : 'পেমেন্ট বাকি (অপেক্ষমান)'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <p><strong>পেমেন্ট:</strong> {PAYMENT_METHOD_LABELS[ord.paymentMethod] || 'ক্যাশ অন ডেলিভারি'}</p>
                      {ord.paymentTrxId && (
                        <p><strong>TrxID:</strong> <span className="font-mono font-bold text-pink-600">{ord.paymentTrxId}</span></p>
                      )}
                      <p><strong>পণ্য:</strong> {(ord.items || []).map(i => `${i.productName} ×${i.quantity}`).join(', ')}</p>
                      <p className="text-sm font-bold text-emerald-700 pt-1">মোট: {formatBDT(ord.totalAmount)}</p>
                    </div>
                    {shopData?.whatsappNumber && (
                      <button
                        type="button"
                        onClick={() => openOrderWhatsAppLink(ord.id, ord)}
                        className="w-full mt-1 bg-[#25D366] hover:bg-[#22c55e] text-white font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>দোকানদারের সাথে WhatsApp-এ কথা বলুন</span>
                      </button>
                    )}
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicStorefront;
