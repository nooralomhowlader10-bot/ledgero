import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { formatBDT, roundBDT } from '../../data/calculations';
import { Landmark, CheckCircle2, AlertCircle, X, CheckSquare, Square, RefreshCw } from 'lucide-react';
import dayjs from 'dayjs';

export default function BankReconciliationModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;

  const wallets = state.dayData?.wallets || {};
  const walletKeys = Object.keys(wallets);
  const [selectedWallet, setSelectedWallet] = useState(walletKeys[0] || 'hand_cash');
  const [statementBalance, setStatementBalance] = useState('');
  const [statementDate, setStatementDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [clearedIds, setClearedIds] = useState(new Set(state.reconciledTxIds || []));
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const activeWallet = wallets[selectedWallet] || { opening: 0, current: 0 };
  const ledgerBalance = activeWallet.current ?? activeWallet.opening ?? 0;

  // Filter transactions for this wallet
  const walletTransactions = (state.dayData?.transactions || []).filter(tx => {
    if (selectedWallet === 'hand_cash') {
      return (
        tx.type === 'stock_sale' ||
        tx.type === 'expense' ||
        tx.type === 'personal_draw' ||
        tx.type === 'owner_gave' ||
        tx.type === 'owner_took' ||
        tx.type === 'loan_given' ||
        tx.type === 'loan_collected' ||
        tx.type === 'loan_taken' ||
        tx.type === 'loan_repaid' ||
        tx.fromWallet === 'hand_cash' ||
        tx.toWallet === 'hand_cash' ||
        tx.wallet === 'hand_cash'
      );
    }
    return tx.fromWallet === selectedWallet || tx.toWallet === selectedWallet || tx.wallet === selectedWallet;
  });

  const parsedStatementBal = statementBalance === '' ? ledgerBalance : Number(statementBalance) || 0;
  const difference = roundBDT(parsedStatementBal - ledgerBalance);
  const isBalanced = Math.abs(difference) < 0.01;

  const toggleCleared = (id) => {
    setClearedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setClearedIds(new Set(walletTransactions.map(t => t.id)));
  };

  const deselectAll = () => {
    setClearedIds(new Set());
  };

  const handleSave = () => {
    dispatch({
      type: 'RECONCILE_TRANSACTIONS',
      payload: {
        txIds: Array.from(clearedIds),
        isReconciled: true,
      }
    });
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl transition-all border ${
        isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">
                {lang === 'en' ? 'Bank & Wallet Reconciliation' : 'ব্যাংক ও ওয়ালেট রিকনসিলিয়েশন'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'en' ? 'Match app transactions with statement balance' : 'স্টেটমেন্টের সাথে লেজারোর লেনদেন মিলিয়ে দেখুন'}
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

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Controls: Account & Statement balance */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Account / Wallet' : 'অ্যাকাউন্ট / ওয়ালেট'}
              </label>
              <select
                value={selectedWallet}
                onChange={(e) => setSelectedWallet(e.target.value)}
                className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none"
              >
                {walletKeys.map(k => (
                  <option key={k} value={k}>
                    {wallets[k]?.label || k} ({formatBDT(wallets[k]?.current ?? wallets[k]?.opening ?? 0, lang)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Statement Ending Date' : 'স্টেটমেন্ট তারিখ'}
              </label>
              <input
                type="date"
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Statement Ending Balance' : 'স্টেটমেন্টের সমাপনী ব্যালেন্স'}
              </label>
              <input
                type="number"
                placeholder={ledgerBalance.toString()}
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
                className="w-full px-3 py-2 text-xs font-bold font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none"
              />
            </div>
          </div>

          {/* Reconciliation Status Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-500 block">{lang === 'en' ? 'Ledger Book Balance' : 'লেজারো বইয়ের ব্যালেন্স'}</span>
              <span className="text-sm font-black font-mono">{formatBDT(ledgerBalance, lang)}</span>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
              <span className="text-xs text-blue-600 dark:text-blue-400 block">{lang === 'en' ? 'Bank Statement' : 'ব্যাংক স্টেটমেন্ট'}</span>
              <span className="text-sm font-black text-blue-700 dark:text-blue-300 font-mono">{formatBDT(parsedStatementBal, lang)}</span>
            </div>
            <div className={`p-3 rounded-xl border ${
              isBalanced 
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' 
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
            }`}>
              <span className="text-xs block opacity-80">{lang === 'en' ? 'Discrepancy' : 'পার্থক্য (অমিল)'}</span>
              <span className="text-sm font-black font-mono">{formatBDT(difference, lang)}</span>
            </div>
          </div>

          {/* Balanced / Unbalanced Banner */}
          <div className={`p-3 rounded-xl flex items-center justify-between text-xs font-bold ${
            isBalanced ? 'bg-emerald-500 text-white' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200'
          }`}>
            <div className="flex items-center gap-2">
              {isBalanced ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <span>
                {isBalanced 
                  ? (lang === 'en' ? 'Reconciled! Statement matches Ledgero perfectly.' : 'রিকনসাইল্ড সম্পন্ন! স্টেটমেন্ট ও লেজারো নিখুঁতভাবে মিলেছে।')
                  : (lang === 'en' ? `Variance of ৳ ${formatBDT(Math.abs(difference), lang)} detected. Check cleared items below.` : `৳ ${formatBDT(Math.abs(difference), lang)} অমিল আছে। নিচের টিকচিহ্নগুলো যাচাই করুন।`)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={selectAll}
                className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 text-xs cursor-pointer"
              >
                {lang === 'en' ? 'Check All' : 'সব টিক দিন'}
              </button>
              <button 
                onClick={deselectAll}
                className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 text-xs cursor-pointer"
              >
                {lang === 'en' ? 'Clear All' : 'সব তুলুন'}
              </button>
            </div>
          </div>

          {/* Transactions Checklist */}
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              {lang === 'en' ? 'Transactions for Verification' : 'যাচাইযোগ্য লেনদেনের তালিকা'} ({walletTransactions.length})
            </h4>

            {walletTransactions.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">
                {lang === 'en' ? 'No transactions found for this account today' : 'আজ এই অ্যাকাউন্টে কোনো লেনদেন নেই'}
              </p>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                {walletTransactions.map(tx => {
                  const isCleared = clearedIds.has(tx.id);
                  return (
                    <div 
                      key={tx.id}
                      onClick={() => toggleCleared(tx.id)}
                      className={`p-3 flex items-center justify-between text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                        isCleared ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {isCleared ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">
                            {tx.note || tx.description || tx.type}
                          </p>
                          <p className="text-xs text-slate-400">
                            {dayjs(tx.timestamp).format('HH:mm A')} • {tx.type}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-bold font-mono text-slate-900 dark:text-white">
                          {formatBDT(tx.amount || 0, lang)}
                        </span>
                        {isCleared && (
                          <span className="block text-[9px] text-emerald-600 font-bold">
                            ✓ {lang === 'en' ? 'Cleared' : 'ক্লিয়ার্ড'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {clearedIds.size} / {walletTransactions.length} {lang === 'en' ? 'cleared' : 'যাচাইকৃত'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {lang === 'en' ? 'Close' : 'বন্ধ করুন'}
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md cursor-pointer transition-all"
            >
              {isSaved ? '✓ Saved!' : (lang === 'en' ? 'Save Reconciliation' : 'রিকনসিলিয়েশন সংরক্ষণ করুন')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
