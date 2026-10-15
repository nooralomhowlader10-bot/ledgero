import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { SCREENS } from '../../data/constants';
import { 
  GraduationCap, Sparkles, Zap, CheckCircle2, ArrowRight, X,
  BookOpen, Landmark, Building2, ClipboardCheck, Users, FileText,
  Lock, ArrowDownUp, Scale, Receipt, Keyboard, ExternalLink
} from 'lucide-react';

export default function TutorialModal({ 
  isOpen, 
  onClose,
  onOpenBankReconcile,
  onOpenFixedAssets,
  onOpenStockAudit,
  onOpenPayroll,
  onOpenManualJournal,
  onOpenFiscalClose,
  onOpenShortcuts
}) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const [activeGuideTab, setActiveGuideTab] = useState('advanced'); // 'easy' or 'advanced'

  if (!isOpen) return null;

  const navigateTo = (screen) => {
    dispatch({ type: 'SET_SCREEN', payload: screen });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-auto animate-scaleUp flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-indigo-500/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shadow-inner">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-black flex items-center gap-2">
                {lang === 'en' ? 'Ledgero Academy & User Guide' : 'লেজারো একাডেমি ও টিউটোরিয়াল গাইড'}
                <span className="text-xs bg-amber-400/20 text-amber-300 px-2.5 py-0.5 rounded-full font-bold border border-amber-400/30">
                  {lang === 'en' ? 'Interactive' : 'ইন্টারেক্টিভ'}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {lang === 'en' ? 'Learn every feature, why it exists, and jump directly to use it' : 'প্রতিটি ফিচারের কাজ ও উদ্দেশ্য জানুন এবং সরাসরি ফিচারটিতে যান'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="p-3 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex gap-2 shrink-0">
          <button
            onClick={() => setActiveGuideTab('easy')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeGuideTab === 'easy' 
                ? 'bg-emerald-600 text-white shadow-md' 
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>{lang === 'en' ? 'Easy Mode Guide (For Shopkeepers)' : 'ইজি মোড গাইড (সাধারণ ব্যবসায়ীদের জন্য)'}</span>
          </button>
          <button
            onClick={() => setActiveGuideTab('advanced')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeGuideTab === 'advanced' 
                ? 'bg-purple-600 text-white shadow-md' 
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>{lang === 'en' ? 'Advanced Mode (IFRS International)' : 'অ্যাডভান্সড মোড (আন্তর্জাতিক অ্যাকাউন্টিং)'}</span>
          </button>
        </div>

        {/* Content Body (Scrollable) */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {activeGuideTab === 'easy' ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-2xl p-4">
                <h4 className="font-bold text-emerald-900 dark:text-emerald-200 text-sm flex items-center gap-2">
                  <span>💡</span> {lang === 'en' ? 'What is Easy Mode and who is it for?' : 'ইজি মোড কী এবং কার জন্য?'}
                </h4>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1 leading-relaxed">
                  {lang === 'en'
                    ? 'Easy Mode is designed for village grocery shops, pharmacy stores, and small retailers. It hides all complex accounting jargon (debit, credit, journal, balance sheet) and keeps only 4 big buttons, a single cash count, customer dues, and a 1-page daily close.'
                    : 'ইজি মোড তৈরি করা হয়েছে যারা অ্যাকাউন্টিং বোঝেন না বা কম শিক্ষিত সাধারণ দোকানিদের জন্য। এখানে কোনো কঠিন অ্যাকাউন্টিং ভাষা (ডেবিট, ক্রেডিট, রেওয়ামিল, জার্নাল) নেই। এটি কেবল ক্যাশবক্সের নগদ টাকা, ৪টি বড় বাটন ও ১-পাতার সহজ দিন শেষ করার সুবিধা দেয়।'}
                </p>
              </div>

              {/* Easy Mode Feature Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                      <span>💰</span> {lang === 'en' ? 'Cash in Hand Hero Card' : 'ক্যাশ ড্রয়ার কার্ড'}
                    </span>
                    <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      {lang === 'en' ? 'Dashboard' : 'ড্যাশবোর্ড'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400">
                    {lang === 'en'
                      ? 'Prominently shows Total Cash In, Total Cash Out, and Cash in Drawer in big friendly fonts.'
                      : 'আজ কত টাকা পেলেন, কত টাকা খরচ করলেন এবং ক্যাশবক্সে কত টাকা আছে তা এক নজরে বড় হরফে দেখা যায়।'}
                  </p>
                  <button 
                    onClick={() => navigateTo(SCREENS.DASHBOARD)}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer pt-1"
                  >
                    <span>{lang === 'en' ? 'Go to Dashboard' : 'ড্যাশবোর্ডে দেখুন'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                      <span>⚡</span> {lang === 'en' ? '4 Big Quick Actions' : '৪টি বড় বোতাম'}
                    </span>
                    <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      {lang === 'en' ? 'Quick Entry' : 'সহজ এন্ট্রি'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400">
                    {lang === 'en'
                      ? 'Large tap targets for Cash Sale, Expense, Due Given, and Due Collected—designed for rush-hour counter sales.'
                      : 'নগদ বিক্রি, দোকান খরচ, বাকি দেওয়া ও বাকি আদায় — ভিড়ের সময় দ্রুত এন্ট্রি করার জন্য বড় বোতাম।'}
                  </p>
                  <button 
                    onClick={() => navigateTo(SCREENS.DASHBOARD)}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer pt-1"
                  >
                    <span>{lang === 'en' ? 'Go to Dashboard' : 'ড্যাশবোর্ডে দেখুন'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                      <span>🌙</span> {lang === 'en' ? '1-Page Quick Day Close' : '১-পাতায় দিন শেষ'}
                    </span>
                    <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-bold">
                      {lang === 'en' ? 'Closing' : 'ক্লোজিং'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400">
                    {lang === 'en'
                      ? 'No 4-step wizard. Just enter physical cash counted, see if it matches system expected cash, and click Close.'
                      : 'কোনো জটিল ৪ ধাপের উইজার্ড নেই। শুধু ড্রয়ারে থাকা ক্যাশ গুনে লিখুন, ক্যাশ মিলেছে কি না দেখুন এবং দিন শেষ করুন।'}
                  </p>
                  <button 
                    onClick={() => navigateTo(SCREENS.CLOSING)}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer pt-1"
                  >
                    <span>{lang === 'en' ? 'Go to Closing' : 'ক্লোজিং স্ক্রিনে যান'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                      <span>📖</span> {lang === 'en' ? 'Bakir Khata & WhatsApp Tagada' : 'বাকির খাতা ও তাগাদা'}
                    </span>
                    <span className="text-xs bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full font-bold">
                      {lang === 'en' ? 'Khata' : 'খাতা'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400">
                    {lang === 'en'
                      ? 'Big due balances in green & red, simple customer search, and 1-click WhatsApp payment reminders.'
                      : 'বড় হরফে মোট পাবো ও দেবো, সহজ গ্রাহক সার্চ এবং এক ক্লিকে ফোনে WhatsApp তাগাদা পাঠানো।'}
                  </p>
                  <button 
                    onClick={() => navigateTo(SCREENS.KHATA)}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer pt-1"
                  >
                    <span>{lang === 'en' ? 'Go to Khata' : 'খাতায় যান'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 rounded-2xl p-4">
                <h4 className="font-bold text-purple-900 dark:text-purple-200 text-sm flex items-center gap-2">
                  <span>🏛️</span> {lang === 'en' ? 'International Accounting & IFRS / GAAP Standards in Ledgero' : 'লেজারো-র আন্তর্জাতিক অ্যাকাউন্টিং মানদণ্ড (IFRS / IAS)'}
                </h4>
                <p className="text-xs text-purple-800 dark:text-purple-300 mt-1 leading-relaxed">
                  {lang === 'en'
                    ? 'Advanced Mode turns Ledgero into an enterprise-grade ERP compliant with international auditing standards. Every feature below has a specific role in statutory audit and financial reporting.'
                    : 'অ্যাডভান্সড মোড লেজারো-কে বিশ্বমানের একটি পূর্ণাঙ্গ ERP অ্যাকাউন্টিং সফটওয়্যারে রূপান্তরিত করে। যেকোনো সনদপ্রাপ্ত অডিটর বা চার্টার্ড একাউন্টেন্ট এটি যাচাই করতে পারবেন। প্রতিটি ফিচারের কাজ ও সরাসরি ব্যবহারের বাটন নিচে দেওয়া হলো:'}
                </p>
              </div>

              {/* 8 International Features Interactive List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* 1. Double-Entry & GL */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-purple-600" />
                      <span>{lang === 'en' ? 'Double-Entry & General Ledger' : 'ডাবল-এন্ট্রি ও সাধারণ খতিয়ান (General Ledger)'}</span>
                    </span>
                    <span className="text-xs bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 px-2 py-0.5 rounded-full font-bold">IFRS / GL</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'Every transaction automatically creates balanced debit/credit journal vouchers. Inspect running balances and comprehensive audit histories for every account in the General Ledger.'
                      : 'প্রতিটি লেনদেনের সাথে ব্যাকগ্রাউন্ডে ব্যালেন্সড ডেবিট/ক্রেডিট তৈরি হয়। সাধারণ খতিয়ানে গিয়ে যে কোনো অ্যাকাউন্টের বিস্তারিত রানিং ব্যালেন্স ও হিস্ট্রি দেখা যায়।'}
                  </p>
                  <button
                    onClick={() => navigateTo(SCREENS.REPORTS)}
                    className="w-full py-1.5 px-3 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'View Ledger & Trial Balance' : 'খতিয়ান ও রেওয়ামিল দেখুন'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 2. Manual Journal Entry Voucher */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      <span>{lang === 'en' ? 'Manual Journal Voucher' : 'ম্যানুয়াল জার্নাল ভাউচার (Manual Journal)'}</span>
                    </span>
                    <span className="text-xs bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 px-2 py-0.5 rounded-full font-bold">Voucher</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'Custom adjustment vouchers for professional accountants. Post multi-line debit/credit entries with strict balanced validation to handle non-routine accounting events.'
                      : 'অ্যাকাউন্টেন্টদের জন্য কাস্টম সমন্বয় ভাউচার তৈরির সুবিধা। বহু-লাইন ডেবিট এবং ক্রেডিট বসিয়ে হিসাব মিললে তবেই পোস্ট করা যায়।'}
                  </p>
                  <button
                    onClick={() => { onClose(); onOpenManualJournal?.(); }}
                    className="w-full py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'Open Journal Voucher' : 'জার্নাল ভাউচার খুলুন'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 3. Fiscal Year Close & Period Lock */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <Lock className="w-4 h-4 text-amber-600" />
                      <span>{lang === 'en' ? 'Fiscal Year Close & Period Lock' : 'অর্থবছরের সমাপনী ও পিরিয়ড লক (Period Lock)'}</span>
                    </span>
                    <span className="text-xs bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold">Audit Lock</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'Closes nominal income & expense accounts at year-end, transferring net profit into Retained Earnings. Post-audit date locking prevents unauthorized tampering.'
                      : 'বছর শেষে আয় ও ব্যয়ের হিসাব বন্ধ করে নিট লাভ Retained Earnings-এ স্থানান্তর করে। অডিট শেষে পেছনের তারিখের হিসাব সম্পূর্ণ লক করে জালিয়াতি রোধ করে।'}
                  </p>
                  <button
                    onClick={() => { onClose(); onOpenFiscalClose?.(); }}
                    className="w-full py-1.5 px-3 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'Fiscal Close & Period Lock' : 'অর্থবছর ক্লোজিং ও লক'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 4. FIFO Inventory Batch Engine */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                      <span>{lang === 'en' ? 'FIFO Inventory Tracking (IAS 2)' : 'ফিফো ইনভেন্টরি ট্র্যাকিং (FIFO - IAS 2)'}</span>
                    </span>
                    <span className="text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">IAS 2</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'First-In, First-Out valuation pursuant to IAS 2. Tracks separate purchase cost batches to ensure 100% compliant COGS and closing inventory asset valuation.'
                      : 'আগের কেনা মাল আগের কেনা দরে বিক্রিত হিসেবে ধরে (First-In, First-Out)। প্রতি ব্যাচের কেনাদর আলাদা ট্র্যাক করে আন্তর্জাতিক নিয়মে সঠিক COGS ও স্টক মূল্য বের করে।'}
                  </p>
                  <button
                    onClick={() => { onClose(); onOpenStockAudit?.(); }}
                    className="w-full py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'Stock Audit & FIFO Batches' : 'স্টক অডিট ও ফিফো দেখুন'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 5. Bank Reconciliation */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-teal-600" />
                      <span>{lang === 'en' ? 'Bank Reconciliation' : 'ব্যাংক রিকনসিলিয়েশন (Bank Reconciliation)'}</span>
                    </span>
                    <span className="text-xs bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 px-2 py-0.5 rounded-full font-bold">Banking</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'Match software cash records with official bank account statements. Tick cleared entries and verify zero unallocated variance for statutory bank audits.'
                      : 'ব্যাংকের আসল স্টেটমেন্টের ব্যালেন্স বসিয়ে সফটওয়্যারের লেনদেনগুলো টিক দিয়ে ক্লিয়ার করে ব্যাংকের হিসাব ও সফটওয়্যারের হিসাবের গরমিল শূন্যতে মেলানো যায়।'}
                  </p>
                  <button
                    onClick={() => { onClose(); onOpenBankReconcile?.(); }}
                    className="w-full py-1.5 px-3 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 dark:hover:bg-teal-900/50 text-teal-700 dark:text-teal-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'Open Bank Reconciliation' : 'ব্যাংক রিকনসিলিয়েশনে যান'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 6. Fixed Assets (IAS 16) */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-600" />
                      <span>{lang === 'en' ? 'Fixed Assets & Depreciation (IAS 16)' : 'স্থায়ী সম্পদ ও অবচয় (Fixed Assets - IAS 16)'}</span>
                    </span>
                    <span className="text-xs bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded-full font-bold">IAS 16</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'Asset registers for machinery, furniture, electronics, and vehicles. Automatically schedules and posts straight-line monthly depreciation expense vouchers.'
                      : 'দোকানের ফ্রিজ, শো-কেস, কম্পিউটার বা আসবাবপত্রের তালিকা রাখা এবং সরলরৈখিক পদ্ধতিতে প্রতি মাসে স্বয়ংক্রিয় অবচয় (Depreciation) জার্নাল পোস্ট করা।'}
                  </p>
                  <button
                    onClick={() => { onClose(); onOpenFixedAssets?.(); }}
                    className="w-full py-1.5 px-3 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'Open Fixed Asset Register' : 'স্থায়ী সম্পদ রেজিস্টার খুলুন'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 7. Payroll & Salary Slips (IAS 19) */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-violet-600" />
                      <span>{lang === 'en' ? 'Staff Payroll & Salary Slips (IAS 19)' : 'পে-রোল ও স্টাফ বেতন ভাউচার (IAS 19)'}</span>
                    </span>
                    <span className="text-xs bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-300 px-2 py-0.5 rounded-full font-bold">IAS 19</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'Process employee base wages, performance bonuses, and advances. Automatically generate official printable salary slips and post payroll expense entries.'
                      : 'কর্মচারীদের মাসিক মূল বেতন, বোনাস ও কর্তন হিসাব করা, প্রিন্টযোগ্য অফিশিয়াল স্যালারি স্লিপ তৈরি এবং এক ক্লিকে ব্যয়ের খাতায় পোস্টিং।'}
                  </p>
                  <button
                    onClick={() => { onClose(); onOpenPayroll?.(); }}
                    className="w-full py-1.5 px-3 bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/40 dark:hover:bg-violet-900/50 text-violet-700 dark:text-violet-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'Open Payroll & Salary Slips' : 'বেতন ও পে-রোল খুলুন'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 8. Statement of Cash Flows (IAS 7) */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/70 space-y-2 hover:border-purple-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                      <ArrowDownUp className="w-4 h-4 text-sky-600" />
                      <span>{lang === 'en' ? 'Statement of Cash Flows (IAS 7)' : '৩-স্তর ক্যাশ ফ্লো বিবরণী (Cash Flow - IAS 7)'}</span>
                    </span>
                    <span className="text-xs bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 px-2 py-0.5 rounded-full font-bold">IAS 7</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">
                    {lang === 'en'
                      ? 'Classifies all store cash movements into 3 mandatory tiers: Operating (trading & collections), Investing (capex & fixtures), and Financing (owner drawings & injections).'
                      : 'আন্তর্জাতিক ৩টি ভাগে নগদ টাকার আগমন ও বহির্গমন প্রদর্শন: অপারেটিং (ব্যবসার দৈনন্দিন নগদ), ইনভেস্টিং (যন্ত্রপাতি কেনাবেচা) ও ফাইন্যান্সিং (মূলধন যোগ/উত্তোলন)।'}
                  </p>
                  <button
                    onClick={() => navigateTo(SCREENS.REPORTS)}
                    className="w-full py-1.5 px-3 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/50 text-sky-700 dark:text-sky-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'View Cash Flow Report' : 'ক্যাশ ফ্লো রিপোর্টে যান'}</span> <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500 font-medium">
            {lang === 'en' ? 'Shortcut: Press ? or F4 anywhere to open this guide' : 'শর্টকাট: কিবোর্ডে ? বা F4 চাপলে সরাসরি গাইড ওপেন হবে'}
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            {lang === 'en' ? 'Got It' : 'বুঝেছি'}
          </button>
        </div>
      </div>
    </div>
  );
}