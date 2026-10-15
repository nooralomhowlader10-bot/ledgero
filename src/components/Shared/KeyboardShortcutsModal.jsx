import React from 'react';
import { useApp } from '../../context/AppContext';
import { Keyboard, X } from 'lucide-react';

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  const { state } = useApp();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;

  if (!isOpen) return null;

  const shortcuts = [
    { key: 'F1', desc: lang === 'en' ? 'Open Dashboard' : 'ড্যাশবোর্ডে যান', category: 'Navigation' },
    { key: 'F2', desc: lang === 'en' ? 'Quick Cash Sale' : 'দ্রুত নগদ বিক্রি', category: 'Action' },
    { key: 'F3', desc: lang === 'en' ? 'Open Khata (Due Book)' : 'বাকির খাতায় যান', category: 'Navigation' },
    { key: 'F4', desc: lang === 'en' ? 'Add Expense' : 'নতুন খরচ এন্ট্রি', category: 'Action' },
    { key: 'F6', desc: lang === 'en' ? 'Financial Reports' : 'আর্থিক রিপোর্টে যান', category: 'Navigation' },
    { key: 'F8', desc: lang === 'en' ? 'Physical Stock Audit' : 'শারীরিক স্টক অডিট', category: 'Action' },
    { key: 'Esc', desc: lang === 'en' ? 'Close Modal / Cancel' : 'মডাল বন্ধ / বাতিল করুন', category: 'General' },
    { key: '?', desc: lang === 'en' ? 'Keyboard Shortcuts Help' : 'শর্টকাট তালিকা দেখুন', category: 'General' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-md rounded-2xl shadow-2xl p-6 transition-all border ${
        isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">
                {lang === 'en' ? 'Keyboard Shortcuts' : 'কীবোর্ড শর্টকাট'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'en' ? 'Speed up daily accounting operations' : 'কীবোর্ড চেপে দ্রুত কাজ সম্পন্ন করুন'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {shortcuts.map(s => (
            <div 
              key={s.key}
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800"
            >
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {s.desc}
              </span>
              <kbd className="px-2.5 py-1 text-xs font-bold font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg shadow-xs">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-5 text-center">
          <button
            onClick={onClose}
            className="w-full py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all cursor-pointer shadow-sm"
          >
            {lang === 'en' ? 'Got It' : 'বুঝেছি'}
          </button>
        </div>
      </div>
    </div>
  );
}
