import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useAppMode } from '../Shared/ModeGuard';
import { formatBDT } from '../../data/calculations';
import {
  Coffee, Plus, Minus, Trash2, Home, Store,
  RotateCcw, Edit3, Check, X, ChevronDown, ChevronUp
} from 'lucide-react';

// ── Bilingual labels ──────────────────────────────────────────────────
const labels = {
  bn: {
    title: 'টি-হাউস',
    subtitle: 'পাশের চায়ের দোকানের হিসাব',
    monthlyTab: 'মাসিক বাকি',
    personal: 'নিজের',
    shop: 'দোকানের',
    settleBtn: 'হিসাব মিলাও',
    settleConfirm: 'মাসিক বাকি পরিশোধ করবেন? এটি হ্যান্ড ক্যাশ থেকে কেটে নেওয়া হবে।',
    settleSuccess: '✅ বাকি পরিশোধ হয়েছে!',
    todayExpense: 'আজকের খরচ',
    addPersonal: 'নিজের',
    addShop: 'দোকান',
    addNewItem: 'নতুন আইটেম যোগ করুন',
    itemName: 'আইটেমের নাম',
    itemUnit: 'ইউনিট',
    itemPrice: 'দাম (৳)',
    save: 'সেভ করুন',
    cancel: 'বাতিল',
    todayLog: 'আজকের এন্ট্রি',
    noEntries: 'আজ কোনো এন্ট্রি নেই',
    noProducts: 'কোনো আইটেম নেই। নতুন আইটেম যোগ করুন।',
    dayNotOpen: 'দিন শুরু করুন। টি-হাউস শুধু দিন চালু থাকলে ব্যবহার করা যায়।',
    editProduct: 'আইটেম সম্পাদনা',
    deleteConfirm: 'এই আইটেমটি মুছে ফেলবেন?',
    deleteEntryConfirm: 'এই এন্ট্রি মুছে ফেলবেন?',
    qty: 'পরিমাণ',
    noTab: 'কোনো বাকি নেই',
  },
  en: {
    title: 'Tea House',
    subtitle: 'Nearby tea stall accounting',
    monthlyTab: 'Monthly Tab',
    personal: 'Personal',
    shop: 'Shop',
    settleBtn: 'Settle Tab',
    settleConfirm: 'Settle the monthly tab? This will be deducted from Hand Cash.',
    settleSuccess: '✅ Tab settled!',
    todayExpense: "Today's Expense",
    addPersonal: 'Personal',
    addShop: 'Shop',
    addNewItem: 'Add New Item',
    itemName: 'Item Name',
    itemUnit: 'Unit',
    itemPrice: 'Price (৳)',
    save: 'Save',
    cancel: 'Cancel',
    todayLog: "Today's Entries",
    noEntries: 'No entries today',
    noProducts: 'No items yet. Add a new item.',
    dayNotOpen: 'Start the day first. Tea House can only be used when the day is running.',
    editProduct: 'Edit Item',
    deleteConfirm: 'Delete this item?',
    deleteEntryConfirm: 'Delete this entry?',
    qty: 'Qty',
    noTab: 'No tab',
  },
};

export default function TeaHouseScreen() {
  const { state, dispatch } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const lang = state.language || 'bn';
  const L = labels[lang] || labels.bn;

  // ── State from context ────────────────────────────────────────────
  const products = state.teaHouseProducts || [];
  const entries = state.dayData?.teaHouseEntries || [];
  const dayPersonal = state.dayData?.teaHouseDayPersonal || 0;
  const dayShop = state.dayData?.teaHouseDayShop || 0;
  const monthlyTab = state.teaHouseMonthlyTab || 0;
  const monthlyPersonal = state.teaHouseMonthlyPersonal || 0;
  const monthlyShop = state.teaHouseMonthlyShop || 0;
  const dayStatus = state.dayData?.status;
  const isDayOpen = dayStatus === 'open';

  // ── Local UI state ────────────────────────────────────────────────
  const [quantities, setQuantities] = useState({});        // { productId: number }
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', unit: '', price: '' });
  const [editingProductId, setEditingProductId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', unit: '', price: '' });
  const [toast, setToast] = useState(null);
  const [longPressProduct, setLongPressProduct] = useState(null); // for context menu

  // ── Sorted entries (reverse chronological) ────────────────────────
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.timestamp - a.timestamp),
    [entries]
  );

  // ── Helpers ───────────────────────────────────────────────────────
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  const getQty = (productId) => quantities[productId] || 0;

  const setQty = (productId, value) => {
    setQuantities(prev => ({
      ...prev,
      [productId]: Math.max(0, value),
    }));
  };

  const formatTime = (timestamp) => {
    const d = new Date(timestamp);
    const h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, '0');
    const period = h >= 12 ? (lang === 'bn' ? 'PM' : 'PM') : (lang === 'bn' ? 'AM' : 'AM');
    const hour12 = h % 12 || 12;
    return `${hour12}:${m} ${period}`;
  };

  // ── Handlers ──────────────────────────────────────────────────────
  const handleAddEntry = (product, type) => {
    const qty = getQty(product.id);
    if (qty <= 0) return;

    dispatch({
      type: 'TEAHOUSE_ADD_ENTRY',
      payload: {
        itemId: product.id,
        itemName: product.name,
        price: product.price,
        qty,
        type,
      },
    });

    // Reset qty for this product
    setQty(product.id, 0);
  };

  const handleDeleteEntry = (entryId) => {
    if (window.confirm(L.deleteEntryConfirm)) {
      dispatch({ type: 'TEAHOUSE_DELETE_ENTRY', payload: entryId });
    }
  };

  const handleSettle = () => {
    if (monthlyTab <= 0) return;
    if (window.confirm(L.settleConfirm)) {
      dispatch({ type: 'TEAHOUSE_SETTLE' });
      showToast(L.settleSuccess);
    }
  };

  const handleAddProduct = () => {
    if (!newItem.name.trim()) return;
    dispatch({
      type: 'TEAHOUSE_ADD_PRODUCT',
      payload: {
        name: newItem.name.trim(),
        unit: newItem.unit.trim() || (lang === 'bn' ? 'পিস' : 'pc'),
        price: Number(newItem.price) || 0,
      },
    });
    setNewItem({ name: '', unit: '', price: '' });
    setShowAddForm(false);
  };

  const handleStartEdit = (product) => {
    setEditingProductId(product.id);
    setEditForm({ name: product.name, unit: product.unit, price: String(product.price) });
    setLongPressProduct(null);
  };

  const handleSaveEdit = () => {
    if (!editForm.name.trim()) return;
    dispatch({
      type: 'TEAHOUSE_EDIT_PRODUCT',
      payload: {
        id: editingProductId,
        name: editForm.name.trim(),
        unit: editForm.unit.trim(),
        price: Number(editForm.price) || 0,
      },
    });
    setEditingProductId(null);
  };

  const handleDeleteProduct = (productId) => {
    if (window.confirm(L.deleteConfirm)) {
      dispatch({ type: 'TEAHOUSE_DELETE_PRODUCT', payload: productId });
      setLongPressProduct(null);
      setEditingProductId(null);
    }
  };

  // ── Long press handler ────────────────────────────────────────────
  let longPressTimer = null;
  const handlePointerDown = (productId) => {
    longPressTimer = setTimeout(() => {
      setLongPressProduct(productId);
    }, 500);
  };
  const handlePointerUp = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
  };

  // ══════════════════════════════════════════════════════════════════
  // ── RENDER ────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  // ── Day not open guard ────────────────────────────────────────────
  if (!isDayOpen) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <Coffee size={48} className="text-amber-400 mb-4" />
        <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-2">
          ☕ {L.title}
        </h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-xs">
          {L.dayNotOpen}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-3 pb-24 space-y-4">
      {/* ── Toast ──────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white
                        px-5 py-2.5 rounded-xl shadow-lg text-sm font-medium
                        animate-bounce">
          {toast}
        </div>
      )}

      {/* ══ 1. HEADER ═══════════════════════════════════════════════ */}
      <div className="text-center pt-4 pb-1">
        <h1 className="text-2xl font-bold text-amber-700 dark:text-amber-400 flex items-center justify-center gap-2">
          <Coffee size={28} />
          {L.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {L.subtitle}
        </p>
      </div>

      {/* ══ 2. MONTHLY TAB CARD ═════════════════════════════════════ */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30
                      border border-amber-200 dark:border-amber-800 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
            {L.monthlyTab}
          </h2>
          <span className="text-2xl font-bold text-amber-700 dark:text-amber-300">
            {formatBDT(monthlyTab, lang)}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400 mb-3">
          <span className="flex items-center gap-1">
            <Home size={13} className="text-indigo-500" />
            {L.personal}: <strong>{formatBDT(monthlyPersonal, lang)}</strong>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span className="flex items-center gap-1">
            <Store size={13} className="text-amber-500" />
            {L.shop}: <strong>{formatBDT(monthlyShop, lang)}</strong>
          </span>
        </div>

        {monthlyTab > 0 ? (
          <button
            onClick={handleSettle}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                       bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800
                       text-white font-semibold text-sm transition-colors"
          >
            <RotateCcw size={16} />
            🔄 {L.settleBtn}
          </button>
        ) : (
          <p className="text-center text-xs text-emerald-600 dark:text-emerald-400 font-medium py-1">
            ✅ {L.noTab}
          </p>
        )}
      </div>

      {/* ══ 3. TODAY'S SUMMARY ══════════════════════════════════════ */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                      rounded-xl p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {L.todayExpense}
          </h3>
          <span className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {formatBDT(dayPersonal + dayShop, lang)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
          <span className="flex items-center gap-1">
            <Home size={12} className="text-indigo-500" />
            {L.personal}: {formatBDT(dayPersonal, lang)}
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span className="flex items-center gap-1">
            <Store size={12} className="text-amber-500" />
            {L.shop}: {formatBDT(dayShop, lang)}
          </span>
        </div>
      </div>

      {/* ══ 4. PRODUCT GRID ════════════════════════════════════════ */}
      {products.length === 0 ? (
        <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-6">
          {L.noProducts}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {products.map((product) => {
            const qty = getQty(product.id);
            const isEditing = editingProductId === product.id;
            const isContextOpen = longPressProduct === product.id;

            // ── Inline Edit Mode ──
            if (isEditing) {
              return (
                <div
                  key={product.id}
                  className="col-span-2 bg-white dark:bg-slate-800 border-2 border-indigo-300
                             dark:border-indigo-600 rounded-xl p-3 space-y-2"
                >
                  <h4 className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    {L.editProduct}
                  </h4>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={L.itemName}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                               bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm
                               text-slate-800 dark:text-slate-100"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editForm.unit}
                      onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                      placeholder={L.itemUnit}
                      className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-600
                                 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm
                                 text-slate-800 dark:text-slate-100"
                    />
                    <input
                      type="number"
                      value={editForm.price}
                      onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                      placeholder={L.itemPrice}
                      className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-600
                                 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm
                                 text-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg
                                 bg-indigo-600 text-white text-sm font-medium
                                 hover:bg-indigo-700 active:bg-indigo-800 transition-colors cursor-pointer"
                    >
                      <Check size={15} /> {L.save}
                    </button>
                    <button
                      onClick={() => setEditingProductId(null)}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg
                                 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200
                                 text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600
                                 transition-colors cursor-pointer"
                    >
                      <X size={15} /> {L.cancel}
                    </button>
                    <button
                      onClick={() => handleDeleteProduct(editingProductId)}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg
                                 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400
                                 text-sm font-medium hover:bg-red-200 dark:hover:bg-red-800
                                 transition-colors cursor-pointer"
                      title={lang === 'bn' ? 'মুছুন' : 'Delete'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            }

            // ── Normal Product Card ──
            return (
              <div
                key={product.id}
                className="relative bg-white dark:bg-slate-800 border border-slate-200
                           dark:border-slate-700 rounded-xl p-3 shadow-sm
                           transition-shadow hover:shadow-md"
              >
                {/* Product info + Edit button */}
                <div className="text-center mb-2 relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStartEdit(product); }}
                    className="absolute -top-1 -right-1 p-1.5 rounded-full bg-slate-100 dark:bg-slate-700
                               text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400
                               hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors cursor-pointer"
                    title={lang === 'bn' ? 'সম্পাদনা' : 'Edit'}
                  >
                    <Edit3 size={13} />
                  </button>
                  <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                    {product.name}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {formatBDT(product.price, lang)}/{product.unit}
                  </p>
                </div>

                {/* Quantity controls */}
                <div className="flex items-center justify-center gap-2 mb-2">
                  <button
                    onClick={() => setQty(product.id, qty - 1)}
                    disabled={qty <= 0}
                    className="w-11 h-11 flex items-center justify-center rounded-full
                               bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300
                               hover:bg-slate-200 dark:hover:bg-slate-600 active:bg-slate-300
                               disabled:opacity-30 disabled:cursor-not-allowed
                               transition-colors text-lg font-bold"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={18} />
                  </button>
                  <span className="w-10 text-center text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                    {qty}
                  </span>
                  <button
                    onClick={() => setQty(product.id, qty + 1)}
                    className="w-11 h-11 flex items-center justify-center rounded-full
                               bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300
                               hover:bg-slate-200 dark:hover:bg-slate-600 active:bg-slate-300
                               transition-colors text-lg font-bold"
                    aria-label="Increase quantity"
                  >
                    <Plus size={18} />
                  </button>
                </div>

                {/* Action buttons — show only when qty > 0 */}
                {qty > 0 && (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleAddEntry(product, 'personal')}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg
                                 bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700
                                 text-white text-xs font-semibold transition-colors"
                    >
                      <Home size={13} />
                      {L.addPersonal}
                    </button>
                    <button
                      onClick={() => handleAddEntry(product, 'shop')}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg
                                 bg-amber-500 hover:bg-amber-600 active:bg-amber-700
                                 text-white text-xs font-semibold transition-colors"
                    >
                      <Store size={13} />
                      {L.addShop}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ 5. ADD NEW ITEM ════════════════════════════════════════ */}
      <div className="bg-white dark:bg-slate-800 border border-dashed border-slate-300
                      dark:border-slate-600 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAddForm(prev => !prev)}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold
                     text-emerald-600 dark:text-emerald-400 hover:bg-slate-50
                     dark:hover:bg-slate-750 transition-colors"
        >
          {showAddForm ? <ChevronUp size={16} /> : <Plus size={16} />}
          ➕ {L.addNewItem}
        </button>

        {showAddForm && (
          <div className="px-4 pb-4 space-y-2 border-t border-slate-200 dark:border-slate-700 pt-3">
            <input
              type="text"
              value={newItem.name}
              onChange={e => setNewItem(prev => ({ ...prev, name: e.target.value }))}
              placeholder={L.itemName}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-slate-50 dark:bg-slate-700 px-3 py-2.5 text-sm
                         text-slate-800 dark:text-slate-100
                         placeholder:text-slate-400 dark:placeholder:text-slate-500"
              autoFocus
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={newItem.unit}
                onChange={e => setNewItem(prev => ({ ...prev, unit: e.target.value }))}
                placeholder={L.itemUnit}
                className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-600
                           bg-slate-50 dark:bg-slate-700 px-3 py-2.5 text-sm
                           text-slate-800 dark:text-slate-100
                           placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
              <input
                type="number"
                inputMode="numeric"
                value={newItem.price}
                onChange={e => setNewItem(prev => ({ ...prev, price: e.target.value }))}
                placeholder={L.itemPrice}
                className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-600
                           bg-slate-50 dark:bg-slate-700 px-3 py-2.5 text-sm
                           text-slate-800 dark:text-slate-100
                           placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAddProduct}
                disabled={!newItem.name.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                           bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800
                           text-white text-sm font-semibold transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check size={15} /> {L.save}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewItem({ name: '', unit: '', price: '' }); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                           bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200
                           text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600
                           transition-colors"
              >
                <X size={15} /> {L.cancel}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══ 6. TODAY'S ENTRY LOG ════════════════════════════════════ */}
      <div>
        <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2 px-1">
          📋 {L.todayLog} ({entries.length})
        </h3>

        {sortedEntries.length === 0 ? (
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-4">
            {L.noEntries}
          </p>
        ) : (
          <div className="space-y-1.5">
            {sortedEntries.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-2 bg-white dark:bg-slate-800
                           border border-slate-200 dark:border-slate-700
                           rounded-lg px-3 py-2 text-sm"
              >
                {/* Time */}
                <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums whitespace-nowrap">
                  {formatTime(entry.timestamp)}
                </span>

                {/* Item details */}
                <span className="flex-1 text-slate-700 dark:text-slate-200 truncate">
                  <span className="font-medium">{entry.itemName}</span>
                  <span className="text-slate-400 dark:text-slate-500 mx-1">×</span>
                  <span>{entry.qty}</span>
                  <span className="text-slate-400 dark:text-slate-500 mx-1">=</span>
                  <span className="font-semibold">{formatBDT(entry.total, lang)}</span>
                </span>

                {/* Type badge */}
                <span
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold uppercase whitespace-nowrap ${
                    entry.type === 'personal'
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {entry.type === 'personal' ? <Home size={10} /> : <Store size={10} />}
                  {entry.type === 'personal' ? (lang === 'bn' ? 'নিজের' : 'P') : (lang === 'bn' ? 'দোকান' : 'S')}
                </span>

                {/* Delete button */}
                <button
                  onClick={() => handleDeleteEntry(entry.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-full
                             text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30
                             hover:text-red-600 transition-colors flex-shrink-0"
                  aria-label="Delete entry"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
