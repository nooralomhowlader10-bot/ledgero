import React, { useState } from 'react';
import Modal from '../Shared/Modal';
import { formatBDT } from '../../data/calculations';
import { 
  ArrowDownLeft, 
  ArrowUpRight, 
  CheckCircle2, 
  AlertTriangle, 
  HelpCircle, 
  Wallet, 
  Receipt, 
  ShoppingBag, 
  Zap, 
  Clock, 
  Calculator
} from 'lucide-react';

export default function CashDifferenceModal({
  isOpen,
  onClose,
  lang = 'bn',
  openingCash = 0,
  expectedCash = 0,
  actualCash = 0,
  transactions = [],
  inventoryTotals = {},
  txTotals = {}
}) {
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'in', 'out'

  // Filter transactions into Cash-In and Cash-Out
  // Note: Only transactions that impact HAND CASH
  const cashInTx = transactions.filter(tx => {
    if (tx.reversed) return false;
    const type = tx.type;
    return (
      type === 'cash_sale' ||
      type === 'stock_sale' ||
      type === 'service_sale' ||
      type === 'loan_collected' ||
      type === 'loan_taken' ||
      type === 'owner_gave' ||
      type === 'recharge' ||
      (type === 'transfer' && tx.toWallet === 'hand_cash')
    );
  });

  const cashOutTx = transactions.filter(tx => {
    if (tx.reversed) return false;
    const type = tx.type;
    return (
      type === 'expense' ||
      type === 'personal_draw' ||
      type === 'owner_took' ||
      type === 'loan_given' ||
      type === 'loan_repaid' ||
      type === 'stock_purchase' ||
      (type === 'transfer' && tx.fromWallet === 'hand_cash')
    );
  });

  const totalCashInSum = cashInTx.reduce((sum, tx) => {
    if (tx.type === 'recharge') {
      return sum + ((Number(tx.amount) || 0) + (Number(tx.profit) || 0));
    }
    return sum + (Number(tx.amount) || 0);
  }, 0);

  const totalCashOutSum = cashOutTx.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

  const stockPurchasesSum = transactions
    .filter(tx => !tx.reversed && tx.type === 'stock_purchase')
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

  const calculatedExpected = openingCash + totalCashInSum - totalCashOutSum;
  const effectiveExpected = (expectedCash !== undefined && expectedCash !== null && !isNaN(expectedCash))
    ? expectedCash
    : calculatedExpected;

  const counted = Number(actualCash) || 0;
  const diff = counted - effectiveExpected;
  const isPerfect = Math.abs(diff) <= 5;
  const isSurplus = diff > 5;
  const isShortage = diff < -5;

  const getTxTypeLabel = (type) => {
    switch (type) {
      case 'cash_sale':
      case 'stock_sale': return lang === 'en' ? 'Stock Sale' : 'পণ্য বিক্রি';
      case 'service_sale': return lang === 'en' ? 'Service Income' : 'সার্ভিস আয়';
      case 'recharge': return lang === 'en' ? 'Recharge Cash In' : 'রিচার্জে ক্যাশ জমা';
      case 'loan_collected': return lang === 'en' ? 'Due Collected' : 'বাকি আদায়';
      case 'loan_given': return lang === 'en' ? 'Due Given' : 'বাকি দেওয়া';
      case 'loan_taken': return lang === 'en' ? 'Loan Taken' : 'ঋণ গ্রহণ';
      case 'loan_repaid': return lang === 'en' ? 'Loan Repaid' : 'ঋণ পরিশোধ';
      case 'owner_gave': return lang === 'en' ? 'Owner Capital' : 'মালিক দিল';
      case 'owner_took': return lang === 'en' ? 'Owner Took' : 'মালিক নিল';
      case 'personal_draw': return lang === 'en' ? 'Personal Draw' : 'মালিকের ড্র / খরচ';
      case 'expense': return lang === 'en' ? 'Shop Expense' : 'দোকানের খরচ';
      case 'transfer': return lang === 'en' ? 'Fund Transfer' : 'টাকা স্থানান্তর';
      default: return type;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={lang === 'en' ? '📊 Cash Difference & Drawer Audit Report' : '📊 ক্যাশ ড্রয়ার ও পার্থক্যের পুঙ্খানুপুঙ্খ অডিট রিপোর্ট'}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        {/* Status Header Banner */}
        <div className={`p-4 rounded-2xl border ${
          isPerfect 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
            : isSurplus 
              ? 'bg-blue-50 border-blue-200 text-blue-900' 
              : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <div className="flex items-start gap-3">
            {isPerfect ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className={`w-7 h-7 shrink-0 mt-0.5 ${isSurplus ? 'text-blue-600' : 'text-rose-600'}`} />
            )}
            <div className="flex-1">
              <h3 className="font-black text-base">
                {isPerfect
                  ? (lang === 'en' ? 'Cash is 100% Balanced!' : 'ক্যাশ ১০০% মিলেছে!')
                  : isSurplus
                    ? (lang === 'en' ? `Cash Surplus: ${formatBDT(diff, lang)} Extra in Drawer` : `ক্যাশ বেশি: ড্রয়ারে ${formatBDT(diff, lang)} টাকা বেশি আছে`)
                    : (lang === 'en' ? `Cash Shortage: ${formatBDT(Math.abs(diff), lang)} Missing from Drawer` : `ক্যাশ কম: ড্রয়ারে ${formatBDT(Math.abs(diff), lang)} টাকা ঘাটতি আছে`)}
              </h3>
              <p className="text-xs mt-1 opacity-90 leading-relaxed">
                {isPerfect
                  ? (lang === 'en'
                      ? 'The physical cash you counted matches the system records exactly.'
                      : 'আপনার ড্রয়ারের গোনা নগদ টাকা এবং অ্যাপের রেকর্ড সম্পূর্ণ নিখুঁত।')
                  : isSurplus
                    ? (lang === 'en'
                        ? `System calculates there should be ${formatBDT(expectedCash, lang)}, but you counted ${formatBDT(counted, lang)}. There is an extra ${formatBDT(diff, lang)} in the drawer.`
                        : `সিস্টেমের হিসাব মতে ক্যাশবক্সে থাকার কথা ${formatBDT(expectedCash, lang)}, কিন্তু আপনি গুনে পেয়েছেন ${formatBDT(counted, lang)}। ড্রয়ারে ${formatBDT(diff, lang)} টাকা বেশি রয়েছে।`)
                    : (lang === 'en'
                        ? `System calculates there should be ${formatBDT(expectedCash, lang)}, but you counted only ${formatBDT(counted, lang)}. Drawer is short by ${formatBDT(Math.abs(diff), lang)}.`
                        : `সিস্টেমের হিসাব মতে ক্যাশবক্সে থাকার কথা ${formatBDT(expectedCash, lang)}, কিন্তু আপনি গুনে পেয়েছেন ${formatBDT(counted, lang)}। ড্রয়ারে ${formatBDT(Math.abs(diff), lang)} টাকা কম রয়েছে।`)}
              </p>
            </div>
          </div>
        </div>

        {/* Step-by-step Math Explanation */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
          <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Calculator className="w-4 h-4 text-indigo-600" />
            <span>{lang === 'en' ? 'Cash Equation Breakdown (How Expected Cash is Calculated)' : 'ক্যাশ সমীকরণের বিশ্লেষণ (কীভাবে প্রত্যাশিত ক্যাশ হিসাব হলো)'}</span>
          </h4>

          <div className="space-y-2 text-xs">
            {/* Step 1: Opening Hand Cash */}
            <div className="flex justify-between items-center p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                ১. {lang === 'en' ? 'Opening Hand Cash (Morning)' : 'সকালের শুরুর নগদ ক্যাশ (Opening)'}
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                {formatBDT(openingCash, lang)}
              </span>
            </div>

            {/* Step 2: Cash In */}
            <div className="flex justify-between items-center p-2 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <span className="font-semibold text-emerald-900 flex items-center gap-1">
                <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                ২. {lang === 'en' ? '(+) Total Cash Received (Cash In)' : '(+) সারাদিনে মোট ক্যাশ জমা (Cash In)'}
              </span>
              <span className="font-mono font-bold text-emerald-700">
                +{formatBDT(totalCashInSum, lang)}
              </span>
            </div>

            {/* Step 3: Cash Out */}
            <div className="flex justify-between items-center p-2 rounded-xl bg-rose-50/70 border border-rose-200">
              <span className="font-semibold text-rose-900 flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                ৩. {lang === 'en' ? '(-) Total Cash Spent / Given (Cash Out)' : '(-) সারাদিনে মোট ক্যাশ খরচ / প্রদান (Cash Out)'}
              </span>
              <span className="font-mono font-bold text-rose-700">
                -{formatBDT(totalCashOutSum, lang)}
              </span>
            </div>

            {/* Step 4: Expected Result */}
            <div className="flex justify-between items-center p-2.5 rounded-xl bg-indigo-50 border-2 border-indigo-200 text-indigo-950">
              <div>
                <span className="font-bold text-xs">
                  {lang === 'en' ? '(=) Expected Cash in Drawer (1 + 2 - 3)' : '(=) সিস্টেম মতে ড্রয়ারে ক্যাশ থাকার কথা (১ + ২ - ৩)'}
                </span>
              </div>
              <span className="font-mono font-black text-sm text-indigo-700">
                {formatBDT(effectiveExpected, lang)}
              </span>
            </div>

            {/* Step 5: Counted Cash */}
            <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700/60 border border-slate-300 dark:border-slate-600">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {lang === 'en' ? 'You physically counted in drawer:' : 'আপনি ড্রয়ার গুনে হাতে পেয়েছেন:'}
              </span>
              <span className="font-mono font-black text-sm text-slate-900 dark:text-slate-100">
                {formatBDT(counted, lang)}
              </span>
            </div>

            {/* Step 6: Net Difference */}
            <div className={`flex justify-between items-center p-3 rounded-xl border-2 font-black text-sm ${
              isPerfect 
                ? 'bg-emerald-100 border-emerald-300 text-emerald-900' 
                : isSurplus 
                  ? 'bg-blue-100 border-blue-300 text-blue-900' 
                  : 'bg-rose-100 border-rose-300 text-rose-900'
            }`}>
              <span>{lang === 'en' ? 'Net Difference (Counted - Expected):' : 'পার্থক্য (গণনাকৃত - প্রত্যাশিত):'}</span>
              <span className="font-mono text-base">
                {isPerfect 
                  ? (lang === 'en' ? 'Tk 0 (✅ Perfect Match)' : '৳০ (✅ সম্পূর্ণ মিলেছে)') 
                  : (diff > 0 ? `+${formatBDT(diff, lang)}` : formatBDT(diff, lang))}
              </span>
            </div>
          </div>
        </div>

        {/* Asset Conversion Callout if stock was purchased */}
        {stockPurchasesSum > 0 && (
          <div className="p-3.5 bg-purple-50/90 border border-purple-200 rounded-2xl flex items-start gap-3 text-xs text-purple-950">
            <span className="text-xl shrink-0">📦</span>
            <div>
              <span className="font-bold text-purple-900 text-sm">
                {lang === 'en' ? 'Stock Purchased & Converted to Shop Asset:' : 'নতুন স্টক কেনা ও সম্পদে রূপান্তর:'} {formatBDT(stockPurchasesSum, lang)}
              </span>
              <p className="text-xs text-purple-800 mt-1 leading-relaxed">
                {lang === 'en'
                  ? 'This cash was paid out from the drawer to buy products. It is stored directly as shop stock inventory — no money was lost or missing!'
                  : 'এই টাকা ড্রয়ারের ক্যাশ থেকে নতুন মালামাল ক্রয়ে পরিশোধ হয়েছে। এটি নগদ টাকা থেকে কমে সরাসরি দোকানের মালামালে (স্টক সম্পদে) যুক্ত হয়েছে — কোনো টাকা ক্ষতি বা মিসিং নয়!'}
              </p>
            </div>
          </div>
        )}

        {/* Audit Status or Diagnostic Explanations */}
        {isPerfect ? (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1">
            <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{lang === 'en' ? 'Audit Status: 100% Balanced' : 'অডিট স্ট্যাটাস: নিখুঁত হিসাব'}</span>
            </h4>
            <p className="text-xs text-emerald-800 leading-relaxed">
              {lang === 'en'
                ? 'Your counted cash in drawer matches the system calculation down to the exact paisa. All sales, expenses, and stock purchases are fully accounted for.'
                : 'আপনার ড্রয়ারের গোনা নগদ টাকা এবং সিস্টেমের হিসাব সম্পূর্ণ মিলে গেছে। সারাদিনের বিক্রি, খরচ এবং নতুন মালামাল ক্রয়ের সব হিসাব নিখুঁতভাবে সমন্বিত রয়েছে।'}
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 text-amber-950 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-900">
              <HelpCircle className="w-4 h-4 text-amber-600" />
              <span>{lang === 'en' ? 'Why might this difference happen?' : 'কেন এই পার্থক্য হতে পারে? সম্ভাব্য কারণ:'}</span>
            </h4>
            {isSurplus ? (
              <ul className="text-xs space-y-1.5 list-disc pl-4 leading-relaxed">
                <li>
                  {lang === 'en' ? (
                    <><strong>Expense recorded without cash deduction:</strong> You may have recorded an expense in the app but paid from personal pocket rather than drawer cash.</>
                  ) : (
                    <><strong>খরচ লেখা হয়েছে কিন্তু ড্রয়ার থেকে টাকা নেওয়া হয়নি:</strong> আপনি হয়তো অ্যাপে খরচ (যেমন বিদ্যুৎ বিল বা নাস্তা) এন্ট্রি করেছেন, কিন্তু ড্রয়ার থেকে নগদ টাকাটি বাস্তবে বের করেননি বা মালিক নিজের পকেট থেকে দিয়েছেন।</>
                  )}
                </li>
                <li>
                  {lang === 'en' ? (
                    <><strong>Credit extended without drawer movement:</strong> Customer credit was recorded, but physical cash remained untouched in the drawer.</>
                  ) : (
                    <><strong>বাকি দেওয়া হয়েছে কিন্তু ক্যাশ কমেনি:</strong> কোনো কাস্টমারকে বাকি দেওয়া হয়েছে (Due Given) যা অ্যাপে ক্যাশ আউট হিসেবে দেখানো হয়েছে, কিন্তু ড্রয়ার থেকে কোনো নগদ টাকা বের হয়নি।</>
                  )}
                </li>
                <li>
                  {lang === 'en' ? (
                    <><strong>Cash receipt not entered:</strong> Cash from a sale or due collection was deposited in drawer but not entered in the app.</>
                  ) : (
                    <><strong>ক্যাশ জমা এন্ট্রি করা হয়নি:</strong> কোনো বিক্রির টাকা বা বাকি আদায়ের টাকা ড্রয়ারে রেখেছেন কিন্তু অ্যাপে তা এন্ট্রি করতে ভুলে গেছেন।</>
                  )}
                </li>
              </ul>
            ) : (
              <ul className="text-xs space-y-1.5 list-disc pl-4 leading-relaxed">
                <li>
                  {lang === 'en' ? (
                    <><strong>Expense paid from drawer but unrecorded:</strong> Cash was paid from the drawer for transit, snacks, or supplies without logging an entry.</>
                  ) : (
                    <><strong>ড্রয়ার থেকে খরচ হয়েছে কিন্তু লেখা হয়নি:</strong> ড্রয়ার থেকে কাউকে টাকা দিয়েছেন বা চা/নাস্তা/বাজার খরচ করেছেন কিন্তু অ্যাপে তা এন্ট্রি করেননি।</>
                  )}
                </li>
                <li>
                  {lang === 'en' ? (
                    <><strong>Loose change or customer discount:</strong> Minor change rounding or customer discounts can cause small cash differences.</>
                  ) : (
                    <><strong>খুচরা ভাংতি বা কাস্টমারকে ছাড়:</strong> কাস্টমারকে খুচরা ভাংতি কম দেওয়া বা ছাড় দেওয়ার কারণে সাময়িক ক্যাশ কম হতে পারে।</>
                  )}
                </li>
                <li>
                  {lang === 'en' ? (
                    <><strong>Owner took personal cash draw:</strong> The business owner withdrew cash without logging an "Owner Took" entry.</>
                  ) : (
                    <><strong>মালিক ব্যক্তিগত প্রয়োজনে টাকা নিয়েছেন:</strong> ড্রয়ার থেকে টাকা নেওয়া হয়েছে কিন্তু "মালিক নিল" (Personal Draw) এন্ট্রি করা হয়নি।</>
                  )}
                </li>
              </ul>
            )}
          </div>
        )}

        {/* Itemized Transactions Breakdown */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
          <div className="p-3 bg-slate-100 dark:bg-slate-800 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-indigo-600" />
              <span>{lang === 'en' ? 'Today’s Cash Transactions List' : 'আজকের সকল ক্যাশ লেনদেনের পুঙ্খানুপুঙ্খ তালিকা'}</span>
            </h4>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-2 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                {lang === 'en' ? 'All' : 'সব'} ({cashInTx.length + cashOutTx.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('in')}
                className={`px-2 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'in' ? 'bg-emerald-600 text-white' : 'text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {lang === 'en' ? 'In' : 'জমা'} ({cashInTx.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('out')}
                className={`px-2 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'out' ? 'bg-rose-600 text-white' : 'text-rose-700 hover:bg-rose-100'
                }`}
              >
                {lang === 'en' ? 'Out' : 'খরচ'} ({cashOutTx.length})
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
            {(activeTab === 'out' ? cashOutTx : activeTab === 'in' ? cashInTx : [...cashInTx, ...cashOutTx]).length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                {lang === 'en' ? 'No transactions recorded today' : 'আজ কোনো ক্যাশ লেনদেন হয়নি'}
              </div>
            ) : (
              (activeTab === 'out' ? cashOutTx : activeTab === 'in' ? cashInTx : [...cashInTx, ...cashOutTx])
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .map((tx, idx) => {
                  const isTxIn = cashInTx.includes(tx);
                  const displayAmount = tx.type === 'recharge' 
                    ? ((Number(tx.amount) || 0) + (Number(tx.profit) || 0))
                    : Number(tx.amount) || 0;

                  return (
                    <div key={tx.id || idx} className="p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                          isTxIn ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                        }`}>
                          {isTxIn ? '↓' : '↑'}
                        </span>
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {tx.note || getTxTypeLabel(tx.type)}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-1">
                            <span>{getTxTypeLabel(tx.type)}</span>
                            <span>•</span>
                            <span>{new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>
                      <span className={`font-mono font-bold text-xs ${
                        isTxIn ? 'text-emerald-700' : 'text-rose-700'
                      }`}>
                        {isTxIn ? '+' : '-'}{formatBDT(displayAmount, lang)}
                      </span>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* Close Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
          >
            {lang === 'en' ? 'Close Report' : 'রিপোর্ট বন্ধ করুন'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
