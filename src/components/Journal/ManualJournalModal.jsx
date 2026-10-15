import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_COA } from '../../data/constants';
import { formatBDT } from '../../data/calculations';
import { FileText, Plus, Trash2, CheckCircle2, AlertCircle, X, ArrowRight } from 'lucide-react';

export default function ManualJournalModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [voucherNo, setVoucherNo] = useState(`JV-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`);
  const [description, setDescription] = useState('');
  
  const [lines, setLines] = useState([
    { id: '1', accountId: 'operating_expenses', note: '', debit: '', credit: '' },
    { id: '2', accountId: 'cash_in_hand', note: '', debit: '', credit: '' },
  ]);

  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleAddLine = () => {
    setLines(prev => [
      ...prev,
      { id: Date.now().toString(), accountId: 'cash_in_hand', note: '', debit: '', credit: '' }
    ]);
  };

  const handleRemoveLine = (index) => {
    if (lines.length <= 2) {
      setErrorMsg(lang === 'en' ? 'A journal entry must have at least 2 lines.' : 'জার্নাল এন্ট্রিতে কমপক্ষে ২টি লাইন থাকতে হবে।');
      return;
    }
    setLines(prev => prev.filter((_, i) => i !== index));
    setErrorMsg('');
  };

  const handleLineChange = (index, field, value) => {
    setLines(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Mutual exclusion: if debit is entered, credit should clear unless explicitly typed
      if (field === 'debit' && value) updated[index].credit = '';
      if (field === 'credit' && value) updated[index].debit = '';

      return updated;
    });
    setErrorMsg('');
  };

  // Calculations
  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  const isBalanced = diff < 0.01 && totalDebit > 0;

  const handlePostJournal = (e) => {
    e.preventDefault();
    if (!isBalanced) {
      setErrorMsg(lang === 'en' 
        ? 'Total debits must equal total credits before posting.' 
        : 'পোস্ট করার পূর্বে মোট ডেবিট এবং মোট ক্রেডিট সমান হতে হবে।');
      return;
    }

    const validLines = lines.map(l => ({
      accountId: l.accountId,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      note: l.note || description
    }));

    const journalEntry = {
      id: `manual_je_${Date.now()}`,
      timestamp: new Date(date).getTime() || Date.now(),
      date,
      voucherNo,
      txType: 'manual_journal',
      description: description || `Manual Journal ${voucherNo}`,
      lines: validLines,
      isManual: true,
    };

    dispatch({
      type: 'POST_MANUAL_JOURNAL',
      payload: journalEntry
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-auto animate-scaleUp">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between border-b border-indigo-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                {lang === 'en' ? 'Manual Journal Entry Voucher' : 'ম্যানুয়াল জার্নাল এন্ট্রি ভাউচার'}
                <span className="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full font-semibold border border-indigo-400/30">
                  IFRS / GAAP
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {lang === 'en' ? 'Custom debit and credit adjustments for certified accountants' : 'অ্যাকাউন্টেন্টদের জন্য কাস্টম ডেবিট-ক্রেডিট সমন্বয় ভাউচার'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Voucher Meta Info */}
        <form onSubmit={handlePostJournal} className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Voucher Date' : 'ভাউচারের তারিখ'}
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white font-semibold focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Voucher Ref / No.' : 'ভাউচার নম্বর'}
              </label>
              <input
                type="text"
                required
                value={voucherNo}
                onChange={e => setVoucherNo(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'General Description' : 'সার্বিক বিবরণ / নোট'}
              </label>
              <input
                type="text"
                placeholder={lang === 'en' ? 'e.g. Year-end adjustment' : 'যেমন: অগ্রিম সমন্বয় বা অবচয়'}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Multi-Line Table */}
          <div className="border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="bg-slate-100 dark:bg-slate-800/80 px-3 py-2 grid grid-cols-12 gap-2 text-[11px] font-bold text-gray-700 dark:text-slate-300 border-b border-gray-200 dark:border-slate-800">
              <span className="col-span-4">{lang === 'en' ? 'Account (Chart of Accounts)' : 'হিসাব খাত (COA)'}</span>
              <span className="col-span-3">{lang === 'en' ? 'Narration / Memo' : 'নোট / বিবরণ'}</span>
              <span className="col-span-2 text-right">{lang === 'en' ? 'Debit (৳)' : 'ডেবিট (৳)'}</span>
              <span className="col-span-2 text-right">{lang === 'en' ? 'Credit (৳)' : 'ক্রেডিট (৳)'}</span>
              <span className="col-span-1 text-center">✕</span>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-slate-800 max-h-60 overflow-y-auto p-1">
              {lines.map((line, idx) => (
                <div key={line.id} className="grid grid-cols-12 gap-2 p-2 items-center text-xs">
                  {/* Account Selector */}
                  <div className="col-span-4">
                    <select
                      value={line.accountId}
                      onChange={e => handleLineChange(idx, 'accountId', e.target.value)}
                      className="w-full p-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {DEFAULT_COA.map(acct => (
                        <option key={acct.id} value={acct.id}>
                          {acct.id.slice(0, 4)} - {lang === 'en' ? acct.name : acct.name_bn} ({acct.type})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Line Memo */}
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder={lang === 'en' ? 'Note' : 'মন্তব্য'}
                      value={line.note}
                      onChange={e => handleLineChange(idx, 'note', e.target.value)}
                      className="w-full p-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-800 dark:text-white outline-none"
                    />
                  </div>

                  {/* Debit */}
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={line.debit}
                      onChange={e => handleLineChange(idx, 'debit', e.target.value)}
                      className="w-full p-1.5 text-xs font-bold text-right rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 outline-none"
                    />
                  </div>

                  {/* Credit */}
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={line.credit}
                      onChange={e => handleLineChange(idx, 'credit', e.target.value)}
                      className="w-full p-1.5 text-xs font-bold text-right rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 outline-none"
                    />
                  </div>

                  {/* Remove */}
                  <div className="col-span-1 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(idx)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-md cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 mx-auto" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Line Button */}
            <div className="p-2 bg-gray-50 dark:bg-slate-800/40 border-t border-gray-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleAddLine}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5 py-1 px-2.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Add Row / Line' : '+ আরও লাইন যোগ করুন'}</span>
              </button>
            </div>
          </div>

          {/* Balance Checker Banner */}
          <div className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
            isBalanced 
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300' 
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800/60 text-rose-800 dark:text-rose-300'
          }`}>
            <div className="flex items-center gap-2">
              {isBalanced ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
              <div>
                <span className="font-bold">
                  {isBalanced 
                    ? (lang === 'en' ? 'Balanced (Dr = Cr)' : 'রেওয়ামিল মিলেছে (Dr = Cr)') 
                    : (lang === 'en' ? `Out of Balance! Difference: ৳ ${formatBDT(diff)}` : `অমিল রয়েছে! পার্থক্য: ৳ ${formatBDT(diff)}`)}
                </span>
                {!isBalanced && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    {lang === 'en' ? 'Debit and Credit must be equal to maintain accounting integrity.' : 'হিসাব সঠিক রাখতে ডেবিট এবং ক্রেডিট সমান হতে হবে।'}
                  </p>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="font-medium text-[11px] text-gray-500 dark:text-slate-400 block">
                Dr: <strong className="text-emerald-700 dark:text-emerald-300">{formatBDT(totalDebit)}</strong> | Cr: <strong className="text-blue-700 dark:text-blue-300">{formatBDT(totalCredit)}</strong>
              </span>
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-rose-600 font-bold text-center bg-rose-50 dark:bg-rose-950/30 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900">
              {errorMsg}
            </p>
          )}

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
              disabled={!isBalanced}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{lang === 'en' ? 'Post Journal Voucher' : 'জার্নাল ভাউচার পোস্ট করুন'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
