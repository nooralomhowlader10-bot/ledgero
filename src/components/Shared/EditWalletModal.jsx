import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import Modal from './Modal';
import { WALLET_CATEGORIES, detectWalletCategory } from '../../data/constants';
import { Edit3, Check, AlertCircle } from 'lucide-react';

export default function EditWalletModal({ isOpen, onClose, wallet, onSaved }) {
  const { state, dispatch } = useApp();
  const { language } = state;
  const lang = language || 'bn';
  const isEn = lang === 'en';

  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('bank');
  const [error, setError] = useState('');

  useEffect(() => {
    if (wallet) {
      setLabel(wallet.label || wallet.name || '');
      setCategory(wallet.category || detectWalletCategory(wallet.key || wallet.walletKey));
      setError('');
    }
  }, [wallet]);

  if (!wallet) return null;

  const walletKey = wallet.key || wallet.walletKey;
  const isHandCash = walletKey === 'hand_cash';

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError(isEn ? 'Account name cannot be empty.' : 'অ্যাকাউন্টের নাম খালি রাখা যাবে না।');
      return;
    }

    dispatch({
      type: 'UPDATE_WALLET_INFO',
      payload: {
        walletKey,
        label: trimmedLabel,
        category: isHandCash ? 'cash' : category
      }
    });

    if (onSaved) {
      onSaved(walletKey, trimmedLabel, isHandCash ? 'cash' : category);
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEn ? 'Edit Wallet / Account' : 'ওয়ালেট বা অ্যাকাউন্ট এডিট করুন'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Account Identifier Badge */}
        <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
          <span className="text-slate-500 dark:text-slate-400 font-medium">
            {isEn ? 'System ID / Key:' : 'সিস্টেম আইডি:'}
          </span>
          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
            {walletKey}
          </span>
        </div>

        {/* Wallet Name / Label Input */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            {isEn ? 'Account Name / Label *' : 'অ্যাকাউন্ট বা ওয়ালেটের নাম *'}
          </label>
          <div className="relative">
            <input
              type="text"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setError('');
              }}
              placeholder={isEn ? 'e.g. City Bank Retail, bKash Merchant' : 'যেমন: সিটি ব্যাংক, বিকাশ পার্সোনাল'}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
            <Edit3 className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>

        {/* Category Selection */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            {isEn ? 'Account Type / Category' : 'অ্যাকাউন্টের ধরন / ক্যাটাগরি'}
          </label>
          {isHandCash ? (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 font-semibold flex items-center gap-2">
              <span className="text-lg">💵</span>
              <span>{isEn ? 'Hand Cash drawer category cannot be changed.' : 'প্রধান ক্যাশ ড্রয়ারের ধরন পরিবর্তনযোগ্য নয়।'}</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {WALLET_CATEGORIES.map((cat) => {
                const isSelected = category === cat.id;
                return (
                  <button
                    type="button"
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-500 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800'
                    }`}
                  >
                    <span className="text-lg shrink-0">{cat.icon}</span>
                    <div className="min-w-0 flex-1">
                      <span className={`block text-xs font-bold truncate ${isSelected ? 'text-indigo-900 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-200'}`}>
                        {isEn ? cat.name_en : cat.name}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            {isEn ? 'Cancel' : 'বাতিল'}
          </button>
          <button
            type="submit"
            className="px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            {isEn ? 'Save Changes' : 'পরিবর্তন সংরক্ষণ করুন'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
