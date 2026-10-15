import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAppMode } from '../Shared/ModeGuard';
import Modal from '../Shared/Modal';
import { TX_TYPES, EXPENSE_CATEGORIES } from '../../data/constants';
import { formatBDTWithPrivacy } from '../../data/calculations';

export default function ExpenseModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const { isPrivacyMode, language } = state;
  const lang = language || 'bn';
  const handCash = state.dayData?.wallets?.hand_cash?.current || 0;

  const [expenseType, setExpenseType] = useState(TX_TYPES.EXPENSE);
  const [expenseCategory, setExpenseCategory] = useState('other');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const resetForm = () => {
    setExpenseType(TX_TYPES.EXPENSE);
    setExpenseCategory('other');
    setAmount('');
    setNote('');
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const expenseAmount = Number(amount);

    if (!expenseAmount || expenseAmount <= 0) {
      setError(lang === 'en' ? 'Please enter a valid amount.' : 'টাকার সঠিক পরিমাণ লিখুন।');
      return;
    }

    if (expenseAmount > handCash) {
      setError(lang === 'en' 
        ? 'Insufficient money in cash drawer (Hand Cash exceeded).' 
        : 'ক্যাশ ড্রয়ারে পর্যাপ্ত টাকা নেই (Available Hand Cash exceeded)।');
      return;
    }

    const effectiveType = isEasy ? TX_TYPES.EXPENSE : expenseType;

    if (effectiveType === TX_TYPES.EXPENSE && !note.trim()) {
      setError(lang === 'en' ? 'Expense note/details are required.' : 'খরচের বিবরণ (Note) দেওয়া আবশ্যক।');
      return;
    }

    const defaultNote = effectiveType === TX_TYPES.PERSONAL_DRAW 
      ? (lang === 'en' ? 'Personal Draw (Owner Took)' : 'ব্যক্তিগত উত্তোলন (মালিক নিল)') 
      : (lang === 'en' ? 'Shop Expense' : 'দোকানের খরচ');

    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        type: effectiveType,
        amount: expenseAmount,
        expenseCategory: expenseCategory,
        note: note.trim() || defaultNote
      }
    });

    handleClose();
  };

  const currSymbol = lang === 'en' ? 'Tk ' : '৳';

  const handleCategorySelect = (cat) => {
    setExpenseCategory(cat.id);
    setNote(lang === 'en' ? cat.label_en : cat.label);
    setError('');
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title={lang === 'en' ? 'Expense / Personal Draw' : 'খরচ ও ড্র (Expense / Draw)'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-xl text-xs font-semibold">
            {error}
          </div>
        )}

        {/* Expense Type Selection */}
        {isAdvanced && (
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-2">
              {lang === 'en' ? 'Select Type:' : 'ধরন নির্বাচন করুন (Type):'}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={`p-3 rounded-xl border-2 flex items-center gap-2 cursor-pointer transition-all ${
                expenseType === TX_TYPES.EXPENSE
                  ? 'border-rose-500 bg-rose-50/60 text-rose-900 shadow-xs'
                  : 'border-gray-200 hover:bg-gray-50 text-gray-700'
              }`}>
                <input
                  type="radio"
                  name="expenseType"
                  value={TX_TYPES.EXPENSE}
                  checked={expenseType === TX_TYPES.EXPENSE}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setExpenseType(newType);
                    if (note === 'ব্যক্তিগত উত্তোলন (মালিক নিল)' || note === 'Personal Draw (Owner Took)') {
                      setNote('');
                    }
                  }}
                  className="text-rose-600 focus:ring-rose-500"
                />
                <span className="text-xs font-bold">
                  {lang === 'en' ? 'Business Expense' : 'দোকানের খরচ (Expense)'}
                </span>
              </label>

              <label className={`p-3 rounded-xl border-2 flex items-center gap-2 cursor-pointer transition-all ${
                expenseType === TX_TYPES.PERSONAL_DRAW
                  ? 'border-amber-500 bg-amber-50/60 text-amber-900 shadow-xs'
                  : 'border-gray-200 hover:bg-gray-50 text-gray-700'
              }`}>
                <input
                  type="radio"
                  name="expenseType"
                  value={TX_TYPES.PERSONAL_DRAW}
                  checked={expenseType === TX_TYPES.PERSONAL_DRAW}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setExpenseType(newType);
                    if (!note) {
                      setNote(lang === 'en' ? 'Personal Draw (Owner Took)' : 'ব্যক্তিগত উত্তোলন (মালিক নিল)');
                    }
                  }}
                  className="text-amber-600 focus:ring-amber-500"
                />
                <span className="text-xs font-bold">
                  {lang === 'en' ? 'Personal Draw' : 'মালিক নিল (Personal Draw)'}
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Expense Category */}
        {expenseType === TX_TYPES.EXPENSE && (
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                {lang === 'en' ? 'Category (Click to auto-fill note)' : 'ক্যাটাগরি (ক্লিক করলে নোট অটো-পূরণ হবে)'}
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 border border-gray-100 dark:border-gray-700 rounded-xl bg-gray-50/50">
              {EXPENSE_CATEGORIES.map(cat => {
                const isSelected = expenseCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleCategorySelect(cat)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border cursor-pointer flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-rose-100 border-rose-400 text-rose-800 ring-2 ring-rose-200 font-bold shadow-xs'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <span>{cat.icon}</span>
                    <span>{lang === 'en' ? cat.label_en : cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Amount Input */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {lang === 'en' ? 'Amount (Tk) *' : 'টাকার পরিমাণ (Amount ৳) *'}
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-2.5 text-gray-400 font-bold text-sm">{currSymbol}</span>
            <input
              type="number"
              min="1"
              max={handCash}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-base font-bold focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
              placeholder="0"
              required
              autoFocus
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            {lang === 'en' 
              ? `* Deducted from Cash Drawer (Hand Cash: ${currSymbol}${formatBDTWithPrivacy(handCash, isPrivacyMode, lang)})` 
              : `* এই টাকা ড্রয়ারের ক্যাশ (Hand Cash: ${formatBDTWithPrivacy(handCash, isPrivacyMode, lang)}) থেকে কাটা হবে।`}
          </p>
        </div>

        {/* Note Input */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-xs font-bold text-gray-700">
              {lang === 'en' ? 'Note / Reason' : 'বিবরণ (Note)'} {expenseType === TX_TYPES.EXPENSE && <span className="text-rose-500">*</span>}
            </label>
            <span className="text-[11px] text-gray-400 font-medium">
              {lang === 'en' ? 'Auto-filled or type details' : 'ক্যাটাগরি থেকে স্বয়ংক্রিয় বা নিজের মতো লিখুন'}
            </span>
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
            placeholder={lang === 'en' ? 'e.g. Electricity bill, tea/snacks' : 'যেমন: বিদ্যুৎ বিল, চা-নাস্তা, মেরামত খরচ'}
            required={expenseType === TX_TYPES.EXPENSE}
          />
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            className={`w-full py-3 text-white font-bold rounded-xl text-sm shadow-md transition-all cursor-pointer ${
              expenseType === TX_TYPES.EXPENSE 
                ? 'bg-rose-600 hover:bg-rose-700' 
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {lang === 'en' 
              ? (expenseType === TX_TYPES.EXPENSE ? 'Record Expense' : 'Record Personal Draw') 
              : (expenseType === TX_TYPES.EXPENSE ? 'খরচ এন্ট্রি করুন' : 'উত্তোলন এন্ট্রি করুন')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
