import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { formatBDT } from '../../data/calculations';
import { Lock, Unlock, ShieldAlert, CheckCircle2, X, Calendar, AlertTriangle, ArrowRight } from 'lucide-react';

export default function FiscalYearCloseModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';

  const [fyStart, setFyStart] = useState('2025-07-01');
  const [fyEnd, setFyEnd] = useState('2026-06-30');
  const [lockEndDate, setLockEndDate] = useState(state.lockedPeriodEndDate || '2026-06-30');
  const [isConfirmed, setIsConfirmed] = useState(false);

  if (!isOpen) return null;

  // Approximate fiscal profit based on current journal entries and daysData
  const journalEntries = state.dayData?.journalEntries || [];
  
  // Calculate total revenue and expenses in this fiscal year
  const fySummary = (() => {
    let revenue = 0;
    let expense = 0;

    journalEntries.forEach(entry => {
      (entry.lines || []).forEach(line => {
        if (['sales_revenue', 'credit_sales_revenue', 'service_revenue', 'interest_income'].includes(line.accountId)) {
          revenue += (line.credit || 0) - (line.debit || 0);
        }
        if (['cogs', 'operating_expenses', 'salary_expense', 'rent_expense', 'transfer_fee_expense', 'inventory_loss'].includes(line.accountId)) {
          expense += (line.debit || 0) - (line.credit || 0);
        }
      });
    });

    const netProfit = revenue - expense;
    return { revenue, expense, netProfit };
  })();

  const isLocked = Boolean(state.lockedPeriodEndDate);

  const handleCloseFiscalYear = (e) => {
    e.preventDefault();
    if (!isConfirmed) return;

    dispatch({
      type: 'CLOSE_FISCAL_YEAR',
      payload: {
        fyStart,
        fyEnd,
        netProfit: fySummary.netProfit,
        lockDate: lockEndDate
      }
    });

    onClose();
  };

  const handleUnlock = () => {
    if (window.confirm(lang === 'en' 
      ? 'WARNING: Unlocking a closed accounting period permits edits to historical records. Do you wish to proceed?' 
      : 'সতর্কতা: হিসাবের পিরিয়ড আনলক করলে অতীতের রেকর্ডে পরিবর্তন করা সম্ভব হবে। আপনি কি নিশ্চিত?')) {
      dispatch({ type: 'UNLOCK_PERIOD' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-auto animate-scaleUp">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 text-white flex items-center justify-between border-b border-purple-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                {lang === 'en' ? 'Fiscal Year-End Closing & Period Lock' : 'অর্থবছরের সমাপনী ও পিরিয়ড লক'}
              </h3>
              <p className="text-xs text-purple-300">
                {lang === 'en' ? 'IFRS Statutory Audit & Tamper-Proof Period Locking' : 'বিধিবদ্ধ নিরীক্ষা ও পেছনের তারিখের হিসাব লককরণ'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCloseFiscalYear} className="p-4 sm:p-6 space-y-4">
          {/* Current Status Banner */}
          <div className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
            isLocked 
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800/60 text-amber-800 dark:text-amber-300' 
              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
          }`}>
            <div className="flex items-center gap-2">
              {isLocked ? <Lock className="w-4 h-4 text-amber-600 shrink-0" /> : <Unlock className="w-4 h-4 text-slate-500 shrink-0" />}
              <div>
                <span className="font-bold">
                  {isLocked 
                    ? (lang === 'en' ? `Period is LOCKED up to: ${state.lockedPeriodEndDate}` : `হিসাব লক রয়েছে: ${state.lockedPeriodEndDate} তারিখ পর্যন্ত`) 
                    : (lang === 'en' ? 'All periods are currently unlocked' : 'বর্তমান হিসাবের পিরিয়ড উন্মুক্ত আছে')}
                </span>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {isLocked 
                    ? (lang === 'en' ? 'Historical transactions cannot be edited or deleted.' : 'লক করা তারিখের আগের কোনো লেনদেন মোছা বা এডিট করা নিষিদ্ধ।')
                    : (lang === 'en' ? 'Locking prevents accidental tampering after audit completion.' : 'অডিট সমাপ্তির পর ভুল বা জালিয়াতি রোধে হিসাব লক করা হয়।')}
                </p>
              </div>
            </div>

            {isLocked && (
              <button
                type="button"
                onClick={handleUnlock}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
              >
                {lang === 'en' ? 'Unlock' : 'আনলক'}
              </button>
            )}
          </div>

          {/* Fiscal Year Dates */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-700 dark:text-slate-200">
              {lang === 'en' ? 'Fiscal Year Range' : 'অর্থবছরের সময়কাল'}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-gray-500 block mb-1">{lang === 'en' ? 'Start Date' : 'শুরুর তারিখ'}</span>
                <input
                  type="date"
                  value={fyStart}
                  onChange={e => setFyStart(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-800 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <span className="text-[11px] text-gray-500 block mb-1">{lang === 'en' ? 'End Date' : 'শেষের তারিখ'}</span>
                <input
                  type="date"
                  value={fyEnd}
                  onChange={e => {
                    setFyEnd(e.target.value);
                    setLockEndDate(e.target.value);
                  }}
                  className="w-full px-3 py-2 text-xs border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-800 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>

          {/* Closing Mechanics Preview */}
          <div className="bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 rounded-xl p-3.5 space-y-2 text-xs">
            <h4 className="font-bold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
              <span>📊</span> {lang === 'en' ? 'Retained Earnings Transfer Preview' : 'সঞ্চিত মুনাফা (Retained Earnings) স্থানান্তর'}
            </h4>
            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-purple-100 dark:border-purple-900">
                <p className="text-xs text-gray-500">{lang === 'en' ? 'Total Revenue' : 'মোট আয়'}</p>
                <p className="font-bold text-emerald-600">{formatBDT(fySummary.revenue)}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-purple-100 dark:border-purple-900">
                <p className="text-xs text-gray-500">{lang === 'en' ? 'Total Expenses' : 'মোট ব্যয়'}</p>
                <p className="font-bold text-rose-600">{formatBDT(fySummary.expense)}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-purple-100 dark:border-purple-900">
                <p className="text-xs text-gray-500">{lang === 'en' ? 'Net Income' : 'নিট মুনাফা'}</p>
                <p className={`font-black ${fySummary.netProfit >= 0 ? 'text-purple-700 dark:text-purple-300' : 'text-rose-600'}`}>
                  {formatBDT(fySummary.netProfit)}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-purple-800 dark:text-purple-300/80 pt-1 leading-relaxed">
              💡 {lang === 'en' 
                ? 'Under IFRS, year-end closing zeroes out temporary revenue and expense accounts and transfers the final Net Income into Equity (Account 3100: Retained Earnings).'
                : 'আন্তর্জাতিক নিয়ম অনুযায়ী বছর শেষে আয় ও ব্যয়ের হিসাব শূন্য হয়ে নিট মুনাফা স্থায়ীভাবে ইকুইটি (হিসাব ৩১০০: সঞ্চিত মুনাফা)-তে জমা হয়।'}
            </p>
          </div>

          {/* Period Lock Checkbox */}
          <div className="p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700 space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="confirmPeriodLock"
                checked={isConfirmed}
                onChange={e => setIsConfirmed(e.target.checked)}
                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
              />
              <label htmlFor="confirmPeriodLock" className="font-bold text-gray-800 dark:text-slate-200 cursor-pointer select-none">
                {lang === 'en' ? 'I confirm year-end closing and audit period lock' : 'আমি অর্থবছর সমাপ্তি ও হিসাব লক করার বিষয়ে নিশ্চিত'}
              </label>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 pl-6">
              {lang === 'en' 
                ? `Transactions on or before ${lockEndDate} will be locked against deletion or modifications.`
                : `${lockEndDate} তারিখের আগের সমস্ত ট্রানজ্যাকশন সুরক্ষিত ও লক থাকবে।`}
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-slate-400 dark:hover:text-white rounded-xl border border-gray-300 dark:border-slate-700 cursor-pointer"
            >
              {lang === 'en' ? 'Cancel' : 'বাতিল'}
            </button>
            <button
              type="submit"
              disabled={!isConfirmed}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{lang === 'en' ? 'Close Fiscal Year & Lock' : 'অর্থবছর বন্ধ ও লক করুন'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
