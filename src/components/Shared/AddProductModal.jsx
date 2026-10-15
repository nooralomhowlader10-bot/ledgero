import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAppMode } from './ModeGuard';
import { PRODUCT_UNITS } from '../../data/constants';
import { t, translateUnit } from '../../data/translations';
import { Package, X, ChevronRight, Check, Wallet } from 'lucide-react';
import { formatBDT } from '../../data/calculations';

export default function AddProductModal({ isOpen, onClose, onAddProduct }) {
  const { state } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const lang = state.language || 'bn';
  const dayData = state.dayData;

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('পিস');
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [paymentWallet, setPaymentWallet] = useState('hand_cash');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const currSymbol = lang === 'en' ? 'Tk' : '৳';
  const displayUnit = translateUnit(unit, lang);

  const buy = parseFloat(buyPrice) || 0;
  const stock = parseFloat(openingStock) || 0;
  const totalCost = Math.round(buy * stock * 100) / 100;
  const needsPayment = stock > 0 && buy > 0;

  // Get available wallets
  const wallets = dayData?.wallets || {};
  const walletEntries = Object.entries(wallets).filter(([k]) => k !== '_order');

  const getWalletLabel = (key) => {
    const labels = {
      hand_cash: lang === 'en' ? 'Hand Cash' : 'হাতের ক্যাশ',
      bkash_personal: 'bKash Personal',
      nagad_personal: 'Nagad Personal',
      bank_account: lang === 'en' ? 'Bank Account' : 'ব্যাংক একাউন্ট',
    };
    const w = wallets[key];
    return w?.label || labels[key] || key;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(lang === 'en' ? 'Enter product name.' : 'প্রোডাক্ট এর নাম লিখুন।');
      return;
    }

    if (!sellPrice || parseFloat(sellPrice) <= 0) {
      setError(lang === 'en' ? 'Enter selling price.' : 'বেচার দাম লিখুন।');
      return;
    }

    const sell = parseFloat(sellPrice) || 0;

    if (sell < buy && sell > 0) {
      const msg = lang === 'en' 
        ? 'Selling price is less than buying price! Are you sure?' 
        : 'বেচার দাম কেনার দামের চেয়ে কম! আপনি কি নিশ্চিত?';
      if (!window.confirm(msg)) {
        return;
      }
    }

    // Validate payment source when stock has cost
    if (needsPayment) {
      if (!paymentWallet) {
        setError(lang === 'en' ? 'Select payment source.' : 'টাকা কোথা থেকে কাটবে সিলেক্ট করুন।');
        return;
      }
      const walletBalance = wallets[paymentWallet]?.current || 0;
      if (totalCost > walletBalance) {
        setError(lang === 'en' 
          ? `Insufficient balance! ${getWalletLabel(paymentWallet)} has ${currSymbol}${walletBalance.toLocaleString()}` 
          : `⚠️ পর্যাপ্ত ব্যালেন্স নেই! ${getWalletLabel(paymentWallet)}-এ আছে ${currSymbol}${walletBalance.toLocaleString()}`);
        return;
      }
    }

    onAddProduct({
      id: `prod_${Date.now()}`,
      name: name.trim(),
      unit,
      buyPrice: buy,
      sellPrice: sell,
      openingStock: stock,
      addedStock: 0,
      closingStock: stock,
      // Payment info (handled by parent's handleAddProduct)
      ...(needsPayment ? { paymentWallet, totalCost } : {}),
    });

    // Reset & close
    setName('');
    setUnit('পিস');
    setBuyPrice('');
    setSellPrice('');
    setOpeningStock('0');
    setPaymentWallet('hand_cash');
    setShowUnitPicker(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl relative animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b dark:border-slate-700 pb-3 mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-rose-500" />
            {lang === 'en' ? 'Add New Product' : 'নতুন প্রোডাক্ট যোগ করুন'}
          </h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-3 p-2.5 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-700 text-rose-600 dark:text-rose-400 text-xs font-semibold rounded-lg">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Product Name */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">
              {lang === 'en' ? 'Product Name *' : 'প্রোডাক্ট এর নাম *'}
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={lang === 'en' ? 'e.g. BL Minute Card 40' : 'যেমন: BL Minute Card 40 বা সিমেন্ট'}
                className="w-full px-3.5 py-2.5 border-2 border-indigo-500/80 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-slate-800 dark:text-white"
                autoFocus
              />
            </div>
          </div>

          {/* Product Unit Selector */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">
              {lang === 'en' ? 'Product Unit *' : 'প্রোডাক্ট এর ইউনিট *'}
            </label>
            <button
              type="button"
              onClick={() => setShowUnitPicker(!showUnitPicker)}
              className="w-full px-3.5 py-2.5 border-2 border-gray-300 dark:border-slate-600 hover:border-gray-400 rounded-xl text-sm font-medium flex items-center justify-between bg-white dark:bg-slate-800 text-gray-800 dark:text-white transition-colors text-left"
            >
              <span>{displayUnit}</span>
              <span className="text-xs text-rose-500 font-bold flex items-center gap-0.5">
                {lang === 'en' ? 'Change' : 'পরিবর্তন'} <ChevronRight className="w-4 h-4" />
              </span>
            </button>

            {/* Unit Picker Drawer / Grid */}
            {showUnitPicker && (
              <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl max-h-48 overflow-y-auto space-y-1">
                <p className="text-[11px] text-gray-500 dark:text-slate-400 font-semibold mb-2">
                  {lang === 'en' ? 'Select product unit:' : 'প্রোডাক্ট এর ইউনিট সিলেক্ট করি:'}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRODUCT_UNITS.map(u => (
                    <button
                      key={u.key}
                      type="button"
                      onClick={() => { setUnit(u.label); setShowUnitPicker(false); }}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
                        unit === u.label
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-600 border border-gray-200 dark:border-slate-600'
                      }`}
                    >
                      <span>{translateUnit(u.label, lang)}</span>
                      {unit === u.label && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Prices */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">
                {lang === 'en' ? `Buy Price (per ${displayUnit})` : `কেনা দাম (প্রতি ${displayUnit})`}
                {isEasy && (
                  <span className="text-gray-400 dark:text-slate-400 font-normal ml-1 text-xs">
                    ({lang === 'en' ? 'Optional' : 'ঐচ্ছিক / Optional'})
                  </span>
                )}
              </label>
              <div className="flex items-center gap-1 border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800">
                <span className="text-gray-400 font-bold text-xs">{currSymbol}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-sm font-bold focus:outline-none bg-transparent dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">
                {lang === 'en' ? `Sell Price (per ${displayUnit}) *` : `বেচার দাম (প্রতি ${displayUnit}) *`}
              </label>
              <div className="flex items-center gap-1 border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800">
                <span className="text-gray-400 font-bold text-xs">{currSymbol}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-sm font-bold focus:outline-none bg-transparent dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Opening Stock */}
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">
              {lang === 'en' ? `Current / Opening Stock (${displayUnit})` : `বর্তমান / শুরুর স্টক (${displayUnit})`}
              {isEasy && (
                <span className="text-gray-400 dark:text-slate-400 font-normal ml-1 text-xs">
                  ({lang === 'en' ? 'Optional' : 'ঐচ্ছিক / Optional'})
                </span>
              )}
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={openingStock}
              onChange={(e) => setOpeningStock(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Payment Source — only shown when stock > 0 and buyPrice > 0 */}
          {needsPayment && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 space-y-2">
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-amber-600" />
                {lang === 'en' ? 'Payment Source (where to deduct cost) *' : 'টাকা কোথা থেকে কাটবে (পরিশোধের মাধ্যম) *'}
              </label>
              <select
                value={paymentWallet}
                onChange={(e) => setPaymentWallet(e.target.value)}
                className="w-full px-3 py-2 border border-amber-300 dark:border-amber-600 rounded-lg text-sm font-bold bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {walletEntries.map(([key, w]) => (
                  <option key={key} value={key}>
                    {getWalletLabel(key)} — ({lang === 'en' ? 'Balance' : 'ব্যালেন্স'}: {currSymbol}{(w.current || 0).toLocaleString()})
                  </option>
                ))}
              </select>
              <div className="text-center py-1.5 bg-amber-100 dark:bg-amber-800/30 rounded-lg">
                <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                  {lang === 'en' ? 'Total purchase cost:' : 'মোট ক্রয়ের মূল্য (কেনা দাম × স্টক):'}
                </p>
                <p className="text-xl font-black text-amber-800 dark:text-amber-200">
                  {currSymbol}{totalCost.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              {lang === 'en' ? 'Confirm' : 'নিশ্চিত (Confirm)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
