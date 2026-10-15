import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import Modal from './Modal';
import { formatBDT, roundBDT } from '../../data/calculations';
import { getWalletLabel, getCustomWalletColor } from '../../data/constants';
import { Zap, ArrowDownRight, ArrowUpRight, Check, AlertCircle, Sparkles } from 'lucide-react';

const EXPENSE_PRESETS_BN = [
  'সকালের পাইকারি বাজার/মাল ক্রয়',
  'দোকানের চা-নাস্তা ও যাতায়াত',
  'দোকান পরিচ্ছন্নতা ও মজুরি',
  'বিদ্যুৎ বিল / ইউটিলিটি',
];

const EXPENSE_PRESETS_EN = [
  'Morning wholesale market purchase',
  'Tea/snacks & transit expense',
  'Shop cleaning & daily wages',
  'Electricity / Utility bill',
];

const ADDITION_PRESETS_BN = [
  'বাসা থেকে আনা অতিরিক্ত ক্যাশ',
  'মালিকের নতুন মূলধন বিনিয়োগ',
  'জরুরি ব্যাকআপ ক্যাশ জমা',
];

const ADDITION_PRESETS_EN = [
  'Extra cash brought from home',
  'New owner capital investment',
  'Emergency backup cash deposit',
];

export default function OpeningAdjustmentModal({ isOpen, onClose, onAdjusted }) {
  const { state, dispatch } = useApp();
  const { language, dayData } = state;
  const lang = language || 'bn';
  const isEn = lang === 'en';

  const [type, setType] = useState('expense'); // 'expense' or 'owner_gave'
  const [walletKey, setWalletKey] = useState('hand_cash');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const wallets = dayData?.wallets || {};
  const walletKeys = (dayData?.walletOrder && dayData.walletOrder.length > 0)
    ? [
        ...dayData.walletOrder.filter(k => Object.keys(wallets).includes(k)),
        ...Object.keys(wallets).filter(k => !dayData.walletOrder.includes(k))
      ]
    : Object.keys(wallets);

  const selectedWalletData = wallets[walletKey] || {};
  const selectedBalance = selectedWalletData.current ?? selectedWalletData.opening ?? 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    const numAmount = roundBDT(parseFloat(amount) || 0);
    if (numAmount <= 0) {
      setError(isEn ? 'Please enter a valid amount greater than 0.' : 'অনুগ্রহ করে ০ এর বেশি সঠিক টাকার পরিমাণ লিখুন।');
      return;
    }

    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setError(isEn ? 'Please provide a reason or description.' : 'অনুগ্রহ করে সমন্বয়ের সুনির্দিষ্ট কারণ বা বিবরণ লিখুন।');
      return;
    }

    dispatch({
      type: 'RECORD_OPENING_ADJUSTMENT',
      payload: {
        walletKey,
        amount: numAmount,
        type: type === 'expense' ? 'expense' : 'owner_gave',
        note: trimmedNote
      }
    });

    if (onAdjusted) {
      onAdjusted(walletKey, numAmount, type);
    }

    // Reset and close
    setAmount('');
    setNote('');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEn ? '⚡ Pre-Opening Cash & Expense Adjustment' : '⚡ সকালের প্রারম্ভিক খরচ ও ক্যাশ সমন্বয়'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Informative Audit Notice */}
        <div className="p-3 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs text-amber-900 dark:text-amber-300">
          <p className="font-bold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{isEn ? 'Audit & Accounting Integrity' : 'অডিট ও হিসাবের সঠিকতা'}</span>
          </p>
          <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-400">
            {isEn
              ? 'Morning market purchases or expenses made before opening the shop will be documented as an audit entry and adjusted from the opening balance without manual discrepancy.'
              : 'দোকান খোলার পূর্বে সকালের কাঁচাবাজার বা খরচ এখান থেকে সমন্বয় করলে প্রারম্ভিক ক্যাশ স্বয়ংক্রিয়ভাবে মিলবে এবং অডিট ট্রেইলে কারণ সংরক্ষিত থাকবে।'}
          </p>
        </div>

        {/* Type Toggle: Expense vs Cash Addition */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            {isEn ? 'Adjustment Type' : 'সমন্বয়ের ধরন'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setType('expense');
                setError('');
              }}
              className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                type === 'expense'
                  ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-2 ring-rose-400 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
              }`}
            >
              <ArrowDownRight className="w-4 h-4 text-rose-600" />
              <span>{isEn ? '🔴 Morning Expense / Outflow' : '🔴 সকালের খরচ / বাজার'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setType('owner_gave');
                setError('');
              }}
              className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                type === 'owner_gave'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-400 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
              }`}
            >
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
              <span>{isEn ? '🟢 Cash Addition / Inflow' : '🟢 প্রারম্ভিক ক্যাশ যোগ'}</span>
            </button>
          </div>
        </div>

        {/* Source Wallet Selector */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              {type === 'expense' 
                ? (isEn ? 'Deduct From Wallet' : 'যে ওয়ালেট/ক্যাশ থেকে টাকা গেছে') 
                : (isEn ? 'Add To Wallet' : 'যে ওয়ালেট/ক্যাশে টাকা এসেছে')}
            </label>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              {isEn ? 'Available:' : 'বর্তমান ব্যালেন্স:'} <strong>{formatBDT(selectedBalance, lang)}</strong>
            </span>
          </div>
          <select
            value={walletKey}
            onChange={(e) => setWalletKey(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            {walletKeys.map((k) => {
              const icon = getCustomWalletColor(k, walletKeys, wallets[k])?.icon || '💰';
              return (
                <option key={k} value={k}>
                  {icon} {wallets[k]?.label || getWalletLabel(k, lang, wallets[k])} ({formatBDT(wallets[k]?.opening || 0, lang)})
                </option>
              );
            })}
          </select>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            {isEn ? 'Adjustment Amount (৳) *' : 'সমন্বয়ের পরিমাণ (৳) *'}
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-400 font-black text-sm">{lang === 'en' ? 'Tk' : '৳'}</span>
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
              placeholder="0.00"
              className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-lg font-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>
        </div>

        {/* Reason / Note & Presets */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            {isEn ? 'Reason / Audit Note *' : 'সমন্বয়ের বিবরণ / কারণ *'}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError('');
            }}
            placeholder={type === 'expense' ? (isEn ? 'e.g. Morning wholesale vegetable purchase' : 'যেমন: সকালের কাঁচাবাজার বা পরিবহন খরচ') : (isEn ? 'e.g. Brought extra cash from home' : 'যেমন: বাসা থেকে আনা অতিরিক্ত ক্যাশ')}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          {/* Quick Presets */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(type === 'expense' ? (isEn ? EXPENSE_PRESETS_EN : EXPENSE_PRESETS_BN) : (isEn ? ADDITION_PRESETS_EN : ADDITION_PRESETS_BN)).map((preset) => (
              <button
                type="button"
                key={preset}
                onClick={() => {
                  setNote(preset);
                  setError('');
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                  note === preset
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-400 text-indigo-700 dark:text-indigo-300 font-bold'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            {isEn ? 'Cancel' : 'বাতিল'}
          </button>
          <button
            type="submit"
            className={`px-5 py-2.5 text-xs font-bold text-white rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer ${
              type === 'expense' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            <Check className="w-4 h-4" />
            {isEn ? 'Record Adjustment' : 'সমন্বয় নিশ্চিত করুন'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
