import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { formatBDT, roundBDT } from '../../data/calculations';
import { getWalletLabel } from '../../data/constants';
import { Package, Plus, X, ShoppingCart, Wallet, CheckCircle2, AlertCircle } from 'lucide-react';

export default function PurchaseStockModal({
  isOpen,
  onClose,
  onOpenAddNewProduct
}) {
  const { state, dispatch } = useApp();
  const { language, dayData } = state;
  const lang = language || 'bn';
  const isEn = lang === 'en';

  const inventory = dayData?.inventory || [];
  const wallets = dayData?.wallets || {};
  const walletKeys = (dayData?.walletOrder && dayData.walletOrder.length > 0)
    ? [
        ...dayData.walletOrder.filter(k => Object.keys(wallets).includes(k)),
        ...Object.keys(wallets).filter(k => !dayData.walletOrder.includes(k))
      ]
    : Object.keys(wallets);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [unitCost, setUnitCost] = useState('');
  const [selectedWallet, setSelectedWallet] = useState('hand_cash');
  const [supplierNote, setSupplierNote] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // When opening or when inventory loads, pick first product
  useEffect(() => {
    if (isOpen) {
      if (inventory.length > 0 && !selectedItemId) {
        setSelectedItemId(inventory[0].id);
        setUnitCost(String(inventory[0].buyPrice || ''));
      }
      setQuantity('10');
      setSelectedWallet('hand_cash');
      setSupplierNote('');
      setError('');
      setSuccessMsg('');
    }
  }, [isOpen, inventory.length]);

  // When selected product changes, update unitCost
  const selectedItem = useMemo(() => {
    return inventory.find(i => i.id === selectedItemId);
  }, [inventory, selectedItemId]);

  const handleProductChange = (e) => {
    const newId = e.target.value;
    setSelectedItemId(newId);
    const item = inventory.find(i => i.id === newId);
    if (item) {
      setUnitCost(String(item.buyPrice || ''));
    }
  };

  const qtyNum = parseFloat(quantity) || 0;
  const unitCostNum = parseFloat(unitCost) || 0;
  const totalCost = roundBDT(qtyNum * unitCostNum);

  const currentWalletBalance = Number(wallets[selectedWallet]?.current) || 0;
  const walletLabel = getWalletLabel(selectedWallet, lang, wallets[selectedWallet]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!selectedItemId) {
      setError(isEn ? 'Please select a product.' : 'দয়া করে একটি প্রোডাক্ট নির্বাচন করুন।');
      return;
    }

    if (qtyNum <= 0) {
      setError(isEn ? 'Please enter a valid quantity.' : 'দয়া করে সঠিক ক্রয়ের পরিমাণ লিখুন।');
      return;
    }

    if (unitCostNum < 0) {
      setError(isEn ? 'Please enter a valid buying price.' : 'দয়া করে সঠিক কেনা দাম লিখুন।');
      return;
    }

    if (totalCost > currentWalletBalance) {
      setError(
        isEn
          ? `Insufficient balance in ${walletLabel}. Available: ${formatBDT(currentWalletBalance, 'en')}`
          : `${walletLabel} অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই। বর্তমান ব্যালেন্স: ${formatBDT(currentWalletBalance, 'bn')}`
      );
      return;
    }

    // Dispatch QUICK_RESTOCK
    dispatch({
      type: 'QUICK_RESTOCK',
      payload: {
        itemId: selectedItemId,
        quantity: qtyNum,
        sourceWallet: selectedWallet,
        unitCost: unitCostNum,
        note: supplierNote.trim() 
          ? (isEn ? `${selectedItem?.name} restock purchase (${qtyNum} ${selectedItem?.unit || 'pcs'} @ ৳${unitCostNum}) - ${supplierNote.trim()}` : `${selectedItem?.name} নতুন স্টক ক্রয় (${qtyNum} ${selectedItem?.unit || 'পিস'} @ ৳${unitCostNum}) - ${supplierNote.trim()}`)
          : undefined
      }
    });

    setSuccessMsg(
      isEn
        ? `✅ Purchased ${qtyNum} ${selectedItem?.unit || 'pcs'} of ${selectedItem?.name} for ${formatBDT(totalCost, 'en')} from ${walletLabel}!`
        : `✅ ${selectedItem?.name}-এর ${qtyNum} ${selectedItem?.unit || 'পিস'} নতুন স্টক কেনা হয়েছে (${formatBDT(totalCost, 'bn')} ${walletLabel} থেকে পরিশোধিত)!`
    );

    setTimeout(() => {
      onClose();
    }, 900);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div 
        className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                {isEn ? 'Purchase New Stock' : 'নতুন মাল ক্রয় (নগদ টাকায় স্টক কেনা)'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEn ? 'Replenish shop inventory & pay from drawer cash' : 'মালামাল কিনে মজুদ বাড়ান এবং ক্যাশবক্স থেকে পরিশোধ করুন'}
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

        {/* Feedback Alerts */}
        {error && (
          <div className="mx-5 mt-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-2xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mx-5 mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-2xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* 1. Select Existing Product or Add New */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-purple-600" />
                <span>{isEn ? 'Select Product *' : 'কোন প্রোডাক্ট কিনবেন *'}</span>
              </label>
              {onOpenAddNewProduct && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAddNewProduct();
                  }}
                  className="text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>{isEn ? '+ New Product' : '+ নতুন প্রোডাক্ট তৈরি'}</span>
                </button>
              )}
            </div>

            {inventory.length === 0 ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                {isEn ? 'No products registered yet. Click above to add a product first.' : 'দোকানে কোনো প্রোডাক্ট যোগ করা নেই। উপরের বাটনে চাপ দিয়ে প্রথমে প্রোডাক্ট যোগ করুন।'}
              </div>
            ) : (
              <select
                value={selectedItemId}
                onChange={handleProductChange}
                required
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
              >
                {inventory.map(item => {
                  const avail = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
                  const curStock = item.closingStock !== undefined && item.closingStock !== null ? item.closingStock : avail;
                  return (
                    <option key={item.id} value={item.id}>
                      {item.name} — {isEn ? `Stock: ${curStock} ${item.unit || 'pcs'} (Prev buy: ৳${item.buyPrice})` : `মজুদ: ${curStock} ${item.unit || 'পিস'} (আগের কেনা: ৳${item.buyPrice})`}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* 2. Quantity & Buying Cost */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {isEn ? 'Quantity to Buy *' : 'ক্রয়ের পরিমাণ (পিস/কেজি) *'}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="10"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-hidden font-mono"
                />
                <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-semibold">
                  {selectedItem?.unit || (isEn ? 'unit' : 'পিস')}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {isEn ? 'Unit Cost (৳) *' : 'প্রতিটির কেনা দাম (৳) *'}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-bold">{isEn ? 'Tk' : '৳'}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-hidden font-mono"
                />
              </div>
            </div>
          </div>

          {/* 3. Payment Source Wallet */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {isEn ? 'Pay From Account / Wallet *' : 'টাকা কোথা থেকে কাটবে (পরিশোধ মাধ্যম) *'}
            </label>
            <select
              value={selectedWallet}
              onChange={(e) => setSelectedWallet(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
            >
              {walletKeys.map(wKey => {
                const w = wallets[wKey];
                const lbl = getWalletLabel(wKey, lang, w);
                const bal = Number(w?.current) || 0;
                return (
                  <option key={wKey} value={wKey}>
                    {lbl} — ({isEn ? 'Balance' : 'ব্যালেন্স'}: ৳{bal})
                  </option>
                );
              })}
            </select>
          </div>

          {/* 4. Total Cost Calculation Strip */}
          <div className="p-3.5 bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-purple-900 dark:text-purple-300">
                {isEn ? 'Total Purchase Cost (Deducted from Cash):' : 'মোট ক্রয়ের খরচ (ক্যাশ থেকে বাদ যাবে):'}
              </p>
              <p className="text-xs text-purple-700 dark:text-purple-400 mt-0.5">
                {qtyNum} {translateUnit(selectedItem?.unit || (isEn ? 'pcs' : 'পিস'), lang)} × {isEn ? 'Tk ' : '৳'}{unitCostNum} = {formatBDT(totalCost, lang)}
              </p>
            </div>
            <div className="text-right">
              <span className="font-mono text-xl font-black text-purple-700 dark:text-purple-300">
                {formatBDT(totalCost, lang)}
              </span>
            </div>
          </div>

          {/* 5. Supplier Note (Optional) */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              {isEn ? 'Note / Supplier (Optional)' : 'মহাজন / সরবরাহকারীর নাম বা নোট (ঐচ্ছিক)'}
            </label>
            <input
              type="text"
              value={supplierNote}
              onChange={(e) => setSupplierNote(e.target.value)}
              placeholder={isEn ? "e.g. Distributor order, Cash buy" : "যেমন: ডিলার থেকে কেনা, ক্যাশ ক্রয়"}
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
            />
          </div>

          {/* Submit Buttons */}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isEn ? 'Cancel' : 'বাতিল'}
            </button>
            <button
              type="submit"
              disabled={inventory.length === 0 || totalCost <= 0}
              className="flex-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-xs transition-all shadow-md shadow-purple-900/20 cursor-pointer flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>{isEn ? 'Confirm Stock Purchase' : 'স্টক ক্রয় নিশ্চিত করুন'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
