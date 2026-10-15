import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import Modal from './Modal';
import { WALLET_CATEGORIES, detectWalletCategory } from '../../data/constants';
import { Plus, Check, Sparkles } from 'lucide-react';

const WALLET_PRESETS = [
  { name: 'Rocket (রকেট)', name_en: 'Rocket', key: 'rocket', category: 'mobile_banking', icon: '🚀' },
  { name: 'Upay (উপায়)', name_en: 'Upay', key: 'upay', category: 'mobile_banking', icon: '📱' },
  { name: 'GP Load / Flexiload', name_en: 'GP Load / Flexiload', key: 'gp_load', category: 'telecom_recharge', icon: '📲' },
  { name: 'Robi / Airtel Load', name_en: 'Robi / Airtel Load', key: 'robi_load', category: 'telecom_recharge', icon: '📲' },
  { name: 'Banglalink Load', name_en: 'Banglalink Load', key: 'bl_load', category: 'telecom_recharge', icon: '📲' },
  { name: 'City Bank', name_en: 'City Bank', key: 'city_bank', category: 'bank', icon: '🏦' },
  { name: 'BRAC Bank', name_en: 'BRAC Bank', key: 'brac_bank', category: 'bank', icon: '🏦' },
  { name: 'Islami Bank', name_en: 'Islami Bank', key: 'islami_bank', category: 'bank', icon: '🏦' },
  { name: 'Sonali Bank', name_en: 'Sonali Bank', key: 'sonali_bank', category: 'bank', icon: '🏛️' },
  { name: 'Eastern Bank (EBL)', name_en: 'Eastern Bank (EBL)', key: 'eastern_bank', category: 'bank', icon: '🏦' },
  { name: 'Cash 2 (ড্রয়ার ২)', name_en: 'Cash 2 (Drawer 2)', key: 'cash_drawer_2', category: 'cash', icon: '💵' },
];

export default function AddWalletModal({ isOpen, onClose, onAdded }) {
  const { state, dispatch } = useApp();
  const { language, dayData } = state;
  const lang = language || 'bn';
  const isEn = lang === 'en';

  const [name, setName] = useState('');
  const [category, setCategory] = useState('bank');
  const [openingBalance, setOpeningBalance] = useState('');
  const [error, setError] = useState('');

  const currentWallets = dayData?.wallets || {};

  const handleSelectPreset = (preset) => {
    setName(isEn ? (preset.name_en || preset.name) : preset.name);
    setCategory(preset.category);
    setError('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(isEn ? 'Please enter an account name.' : 'অনুগ্রহ করে অ্যাকাউন্টের নাম লিখুন।');
      return;
    }

    // Generate safe key
    const rawKey = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09FF]+/g, '_')
      .replace(/^_|_$/g, '');
    
    let walletKey = rawKey || `wallet_${Date.now()}`;
    
    // If key already exists in current wallets, generate a unique suffix
    if (currentWallets[walletKey]) {
      walletKey = `${walletKey}_${Date.now().toString().slice(-4)}`;
    }

    const opening = parseFloat(openingBalance) || 0;

    dispatch({
      type: 'ADD_WALLET',
      payload: {
        walletKey,
        label: trimmedName,
        category: category || detectWalletCategory(walletKey),
        opening,
        current: opening
      }
    });

    if (onAdded) {
      onAdded(walletKey, opening);
    }

    // Reset and close
    setName('');
    setCategory('bank');
    setOpeningBalance('');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEn ? 'Add New Wallet / Account' : 'নতুন ওয়ালেট বা অ্যাকাউন্ট যোগ করুন'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
            {error}
          </div>
        )}

        {/* Quick Presets */}
        <div>
          <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>{isEn ? 'Popular Bangladeshi Accounts (Click to pick)' : 'জনপ্রিয় অ্যাকাউন্টসমূহ (ক্লিক করুন)'}</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {WALLET_PRESETS.map((preset) => {
              const alreadyExists = Boolean(currentWallets[preset.key]);
              const isSelected = name === (isEn ? (preset.name_en || preset.name) : preset.name);
              return (
                <button
                  type="button"
                  key={preset.key}
                  onClick={() => handleSelectPreset(preset)}
                  disabled={alreadyExists}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                    alreadyExists
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                      : isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-gray-100 hover:bg-indigo-50 text-gray-700 hover:text-indigo-600 border border-gray-200'
                  }`}
                  title={alreadyExists ? (isEn ? 'Already added' : 'ইতিমধ্যে যোগ করা আছে') : ''}
                >
                  <span>{preset.icon}</span>
                  <span>{isEn ? (preset.name_en || preset.name) : preset.name}</span>
                  {alreadyExists && <span className="text-xs text-gray-400">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Account Name */}
        <div>
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
            {isEn ? 'Account / Wallet Name *' : 'অ্যাকাউন্ট বা ওয়ালেটের নাম *'}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder={isEn ? 'e.g. Rocket, City Bank, Upay' : 'যেমন: রকেট, সিটি ব্যাংক, উপায়, ক্যাশ ২'}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            autoFocus
          />
        </div>

        {/* Category Picker */}
        <div>
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
            {isEn ? 'Category / Type' : 'ওয়ালেটের ধরন বা ক্যাটাগরি'}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {WALLET_CATEGORIES.map((cat) => {
              const isSelected = category === cat.id;
              return (
                <button
                  type="button"
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 font-bold ring-1 ring-indigo-500'
                      : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium'
                  }`}
                >
                  <span className="text-xl">{cat.icon}</span>
                  <div className="truncate text-xs leading-tight">
                    {isEn ? cat.name_en : cat.name}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Initial Opening Balance */}
        <div>
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
            {isEn ? 'Opening Balance (৳ Optional)' : 'শুরুর ব্যালেন্স (ঐচ্ছিক)'}
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-2.5 text-gray-400 font-bold text-sm">{isEn ? 'Tk' : '৳'}</span>
            <input
              type="number"
              min="0"
              step="any"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0"
              className="w-full pl-8 pr-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            {isEn ? 'You can also edit this anytime on the Opening screen.' : 'এটি পরেও যেকোনো সময় পরিবর্তন করা যাবে।'}
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{isEn ? 'Add Wallet' : 'ওয়ালেট যোগ করুন'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-bold transition-all cursor-pointer"
          >
            {isEn ? 'Cancel' : 'বাতিল'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
