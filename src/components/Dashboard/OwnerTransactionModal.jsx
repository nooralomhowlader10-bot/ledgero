import React, { useState } from 'react';
import Modal from '../Shared/Modal';
import { useApp } from '../../context/AppContext';
import { formatBDT } from '../../data/calculations';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, UserCheck } from 'lucide-react';
import { t } from '../../data/translations';

const OWNER_GAVE_SUGGESTIONS_BN = [
  'ব্যবসায়ের চলতি মূলধন',
  'ভাংতি টাকা দিল',
  'ব্যক্তিগত তহবিল থেকে ইনভেস্ট',
  'ব্যাংক থেকে তুলে ড্রয়ারে দিল'
];

const OWNER_GAVE_SUGGESTIONS_EN = [
  'Working Capital',
  'Cash Change / Petty Cash',
  'Personal Investment',
  'Withdrawn from Bank to Drawer'
];

const OWNER_TOOK_SUGGESTIONS_BN = [
  'বাসার খরচের জন্য নিল',
  'ব্যক্তিগত প্রয়োজনে',
  'বাজার খরচের জন্য',
  'ব্যাংকে জমার জন্য ড্রয়ার থেকে নিল'
];

const OWNER_TOOK_SUGGESTIONS_EN = [
  'Home / Family Expense',
  'Personal Use',
  'Market / Grocery Expense',
  'Took for Bank Deposit'
];

export default function OwnerTransactionModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const { dayData } = state;

  const [type, setType] = useState('owner_gave'); // 'owner_gave' or 'owner_took'
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const currentCash = dayData?.wallets?.hand_cash?.current || 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError(lang === 'en' ? 'Please enter a valid amount (1 or more)' : 'সঠিক টাকার পরিমাণ দিন (১ বা তার বেশি)');
      return;
    }

    if (type === 'owner_took' && parsedAmount > currentCash) {
      setError(lang === 'en' ? `Not enough cash in drawer! Current cash: ${formatBDT(currentCash, lang)}` : `ক্যাশ ড্রয়ারে পর্যাপ্ত টাকা নেই! বর্তমান ক্যাশ: ${formatBDT(currentCash, lang)}`);
      return;
    }

    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        type,
        amount: parsedAmount,
        note: note.trim() || (type === 'owner_gave' ? (lang === 'en' ? 'Owner gave cash to drawer' : 'মালিক দোকানে টাকা দিয়েছেন') : (lang === 'en' ? 'Owner took cash from drawer' : 'মালিক দোকান থেকে নিয়েছেন'))
      }
    });

    // Reset and close
    setAmount('');
    setNote('');
    setError('');
    onClose();
  };

  const handleTypeChange = (newType) => {
    setType(newType);
    setError('');
    setNote('');
  };

  const currencySymbol = lang === 'en' ? 'Tk' : '৳';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('owner_modal_title', lang)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type Selection: মালিক দিল vs মালিক নিল */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
          <button
            type="button"
            onClick={() => handleTypeChange('owner_gave')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${
              type === 'owner_gave'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <ArrowDownLeft className="w-4 h-4" />
            {t('owner_gave_tab', lang)}
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('owner_took')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${
              type === 'owner_took'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            {t('owner_took_tab', lang)}
          </button>
        </div>

        {/* Current Drawer Cash Indicator */}
        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs">
          <span className="text-gray-600 font-medium">{t('drawer_cash_label', lang)}</span>
          <span className="font-bold text-gray-900">{formatBDT(currentCash, lang)}</span>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {t('amount_label', lang)}
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-400 font-bold">{currencySymbol}</span>
            <input
              type="number"
              step="any"
              min="1"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (error) setError('');
              }}
              placeholder="0"
              className="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-xl text-base font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              autoFocus
              required
            />
          </div>

          {/* Quick Amount Chips */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[11px] text-gray-400 font-medium">{t('quick_label', lang)}</span>
            {[200, 500, 1000, 2000, 5000].map((quickVal) => (
              <button
                key={quickVal}
                type="button"
                onClick={() => setAmount(String(quickVal))}
                className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
              >
                {currencySymbol}{quickVal}
              </button>
            ))}
          </div>
        </div>

        {/* Note / Reason Input */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {t('note_label', lang)}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={type === 'owner_gave' ? (lang === 'en' ? 'e.g. business capital' : 'যেমন: ব্যবসার চলতি মূলধন') : (lang === 'en' ? 'e.g. personal expense' : 'যেমন: বাসার বাজার খরচের জন্য')}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs sm:text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />

          {/* Quick Suggestions Chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(type === 'owner_gave' 
              ? (lang === 'en' ? OWNER_GAVE_SUGGESTIONS_EN : OWNER_GAVE_SUGGESTIONS_BN)
              : (lang === 'en' ? OWNER_TOOK_SUGGESTIONS_EN : OWNER_TOOK_SUGGESTIONS_BN)
            ).map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setNote(sug)}
                className="text-[11px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md transition-colors cursor-pointer"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>

        {/* Accounting Rule Info Banner */}
        <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl text-[11px] text-amber-800 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <UserCheck className="w-3.5 h-3.5 text-amber-600" />
            <span>{lang === 'en' ? 'Accounting Info:' : 'অ্যাকাউন্টিং তথ্য:'}</span>
          </div>
          <p>
            {type === 'owner_gave'
              ? (lang === 'en' ? 'Owner cash-in increases drawer balance. It is not counted as shop revenue or profit.' : 'মালিক দিলে ড্রয়ারের নগদ ক্যাশ বৃদ্ধি পাবে। এটি দোকানের পণ্যের বিক্রি বা অতিরিক্ত লাভ হিসেবে গণনা হবে না।')
              : (lang === 'en' ? 'Owner cash-out reduces drawer balance. It does not reduce operational profit like a regular expense.' : 'মালিক নিলে ড্রয়ার থেকে নগদ ক্যাশ কমবে। এটি দোকানের নিয়মিত ব্যবসায়িক খরচ (Expense) হিসেবে মুনাফা কমাবে না।')}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-500 text-xs font-semibold rounded-xl">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            {t('cancel_btn', lang)}
          </button>
          <button
            type="submit"
            className={`flex-1 py-2.5 text-white rounded-xl text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 ${
              type === 'owner_gave'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {type === 'owner_gave' ? t('confirm_owner_gave', lang) : t('confirm_owner_took', lang)}
          </button>
        </div>
      </form>
    </Modal>
  );
}

