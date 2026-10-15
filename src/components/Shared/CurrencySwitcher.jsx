import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CURRENCIES } from '../../data/calculations';
import { Coins, Check } from 'lucide-react';

export default function CurrencySwitcher() {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;
  const currentCurrency = state.currency || 'BDT';
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (code) => {
    dispatch({ type: 'SET_CURRENCY', payload: code });
    setIsOpen(false);
  };

  const active = CURRENCIES[currentCurrency] || CURRENCIES.BDT;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all cursor-pointer shadow-2xs"
        title={lang === 'en' ? 'Change Display Currency' : 'মুদ্রা পরিবর্তন করুন'}
      >
        <span className="font-mono font-black text-indigo-600 dark:text-indigo-400">{active.symbol}</span>
        <span className="text-[11px]">{active.code}</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className={`absolute right-0 mt-2 w-52 rounded-xl shadow-xl border z-50 p-2 space-y-1 ${
            isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
              {lang === 'en' ? 'Select Currency' : 'মুদ্রা নির্বাচন করুন'}
            </p>
            {Object.values(CURRENCIES).map(c => {
              const isSelected = c.code === currentCurrency;
              return (
                <button
                  key={c.code}
                  onClick={() => handleSelect(c.code)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                    isSelected 
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold w-4 text-center">{c.symbol}</span>
                    <span>{c.code}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
