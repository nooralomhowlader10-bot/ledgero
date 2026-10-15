import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  FileText,
  CreditCard,
  ArrowRightLeft,
  Briefcase,
  Wallet,
  Users,
  BookOpen,
  FileEdit,
  CheckCircle,
  ClipboardList,
  Monitor,
  FileSpreadsheet,
  Lock,
  LineChart,
  Activity,
  GraduationCap,
  Bot
} from 'lucide-react';

export default function GlobalQuickActionModal({ isOpen, onClose, onAction, lang = 'bn' }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const isEn = lang === 'en';

  const actions = [
    {
      group: isEn ? 'Daily Operations' : 'দৈনন্দিন কাজ (Daily Operations)',
      items: [
        { id: 'ai_agent', icon: Bot, title: isEn ? 'NAM AI Financial Assistant' : 'NAM (নাম) এআই সহকারী', subtitle: isEn ? 'Voice & conversational AI business partner' : 'ভয়েস ও এআই হিসাব সহকারী', shortcut: 'Alt + A', keys: ['nam', 'ai', 'নাম', 'এআই', 'agent', 'munshi', 'assistant', 'voice', 'ভয়েস', 'হিসাব'] },
        { id: 'new_invoice', icon: FileText, title: isEn ? 'New Invoice / Cash Sale' : 'নতুন ইনভয়েস / ক্যাশ সেল', subtitle: isEn ? 'Create sales invoice or rapid cash sale' : 'নতুন ইনভয়েস বা দ্রুত ক্যাশ সেল', shortcut: 'Alt + I', keys: ['invoice', 'ইনভয়েস', 'sale', 'cash'] },
        { id: 'new_expense', icon: CreditCard, title: isEn ? 'New Expense / Supplier Bill' : 'নতুন খরচ / সাপ্লায়ার বিল', subtitle: isEn ? 'Record operating expense or vendor payment' : 'দোকান খরচ বা মহাজন দেনা পরিশোধ', shortcut: 'Alt + B', keys: ['expense', 'খরচ', 'bill', 'supplier'] },
        { id: 'transfer', icon: ArrowRightLeft, title: isEn ? 'Transfer Between Wallets' : 'ওয়ালেট ফান্ড ট্রান্সফার', subtitle: isEn ? 'Move cash between drawer, banks, and bKash' : 'ড্রয়ার, ব্যাংক ও বিকাশ-এ ব্যালেন্স স্থানান্তর', shortcut: 'Alt + T', keys: ['transfer', 'ট্রান্সফার', 'wallet'] },
        { id: 'service_income', icon: Briefcase, title: isEn ? 'Service / Other Income' : 'সার্ভিস / অন্যান্য আয়', subtitle: isEn ? 'Record freelance or non-trading revenue' : 'সার্ভিস চার্জ বা অন্যান্য বাণিজ্যিক আয়', keys: ['service', 'income', 'আয়'] },
        { id: 'capital_drawings', icon: Wallet, title: isEn ? 'Owner Capital / Drawings' : 'মালিকের মূলধন / উত্তোলন', subtitle: isEn ? 'Owner cash injection or personal withdrawals' : 'মালিকের ব্যক্তিগত উত্তোলন বা দোকানে টাকা জমা', keys: ['capital', 'drawings', 'মূলধন', 'উত্তোলন'] }
      ]
    },
    {
      group: isEn ? 'Accounts & Contacts' : 'খতিয়ান ও কন্টাক্ট (Accounts & Contacts)',
      items: [
        { id: 'add_contact', icon: Users, title: isEn ? 'Add Customer / Supplier' : 'নতুন কাস্টমার / মহাজন যোগ', subtitle: isEn ? 'Register new customer or supplier account' : 'নতুন কাস্টমার বা সরবরাহকারী অ্যাকাউন্ট খুলুন', shortcut: 'Alt + K', keys: ['customer', 'supplier', 'কাস্টমার', 'সাপ্লায়ার', 'মহাজন'] },
        { id: 'open_ledger', icon: BookOpen, title: isEn ? 'Open Customer Ledger (Khata)' : 'গ্রাহক খতিয়ান (বাকির খাতা)', subtitle: isEn ? 'View outstanding dues and transaction history' : 'গ্রাহকদের মোট বাকি ও লেনদেনের ইতিহাস দেখুন', keys: ['khata', 'ledger', 'খাতা', 'লেজার', 'বাকি'] }
      ]
    },
    {
      group: isEn ? 'Compliance & Audit (IFRS / IAS)' : 'কমপ্লায়েন্স ও অডিট (IFRS / IAS)',
      items: [
        { id: 'journal_voucher', icon: FileEdit, title: isEn ? 'Manual Journal Voucher' : 'ম্যানুয়াল সমন্বয় জার্নাল', subtitle: isEn ? 'Post balanced multi-line debit/credit voucher' : 'কাস্টম ডেবিট ও ক্রেডিট সমন্বয় ভাউচার', shortcut: 'Alt + J', keys: ['journal', 'জার্নাল', 'voucher', 'ifrs'] },
        { id: 'bank_recon', icon: CheckCircle, title: isEn ? 'Bank Reconciliation' : 'ব্যাংক সমন্বয় (Reconciliation)', subtitle: isEn ? 'Match bank statements with software cash flow' : 'ব্যাংক স্টেটমেন্ট ও সফটওয়্যারের হিসাব মেলান', shortcut: 'Alt + R', keys: ['bank', 'reconciliation', 'সমন্বয়', 'ব্যাংক'] },
        { id: 'stock_audit', icon: ClipboardList, title: isEn ? 'Physical Stock Audit' : 'ফিজিক্যাল স্টক অডিট', subtitle: isEn ? 'Verify physical shelves against inventory records' : 'দোকানের তাকের পণ্যের সাথে সফটওয়্যার মেলান', shortcut: 'Alt + S', keys: ['stock', 'audit', 'অডিট', 'inventory', 'স্টক'] },
        { id: 'fixed_asset', icon: Monitor, title: isEn ? 'Add Fixed Asset (IAS 16)' : 'স্থায়ী সম্পদ নিবন্ধন (IAS 16)', subtitle: isEn ? 'Register equipment and setup depreciation schedule' : 'আসবাবপত্র/যন্ত্রপাতি ও মাসিক অবচয় শিডিউল', shortcut: 'Alt + F', keys: ['asset', 'fixed', 'সম্পদ', 'ias16'] },
        { id: 'payroll_slips', icon: FileSpreadsheet, title: isEn ? 'Staff Payroll Slips' : 'স্টাফ বেতন ও পে-রোল', subtitle: isEn ? 'Generate employee salary slips and ledger vouchers' : 'কর্মচারীদের স্যালারি স্লিপ ও বেতন প্রদান', shortcut: 'Alt + P', keys: ['payroll', 'staff', 'salary', 'বেতন'] },
        { id: 'period_lock', icon: Lock, title: isEn ? 'Fiscal Year Close & Period Lock' : 'বছর শেষ ও পিরিয়ড লক', subtitle: isEn ? 'Lock audit periods and close fiscal balances' : 'বার্ষিক হিসাব বন্ধ ও পূর্বের তারিখের লক', keys: ['close', 'lock', 'fiscal', 'বছর', 'লক'] }
      ]
    },
    {
      group: isEn ? 'Learning & Analytics' : 'বিশ্লেষণ ও একাডেমি (Analytics & Academy)',
      items: [
        { id: 'cashflow_forecast', icon: LineChart, title: isEn ? 'Cash Flow Forecast Manager' : 'ক্যাশ ফ্লো পূর্বাভাস ও প্রবাহ', subtitle: isEn ? 'Predictive multi-day cash inflow and outflow' : 'ভবিষ্যতের নগদ টাকার আগমন ও খরচের হিসাব', keys: ['cash', 'flow', 'forecast', 'ক্যাশ', 'পূর্বাভাস'] },
        { id: 'health_scorecard', icon: Activity, title: isEn ? 'Business Health Scorecard' : 'বিজনেস হেলথ স্কোরকার্ড', subtitle: isEn ? 'Audit 14 IFRS financial performance ratios' : '১৪টি আন্তর্জাতিক আর্থিক স্বাস্থ্য সূচক', keys: ['health', 'score', 'business', 'বিজনেস', 'স্কোর'] },
        { id: 'academy', icon: GraduationCap, title: isEn ? 'Ledgero Academy & Guide' : 'লেজারো একাডেমি টিউটোরিয়াল', subtitle: isEn ? 'Interactive feature manual and walkthrough' : 'সকল ফিচারের বিস্তারিত গাইড ও নিয়মাবলী', shortcut: 'F4', keys: ['academy', 'tutorial', 'একাডেমি', 'শিখুন', 'গাইড'] }
      ]
    }
  ];

  // Flatten items for easy navigation and filtering
  const filteredActions = actions.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (!searchQuery) return true;
      const lowerQuery = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(lowerQuery) ||
        item.subtitle.toLowerCase().includes(lowerQuery) ||
        item.keys.some(key => key.toLowerCase().includes(lowerQuery))
      );
    })
  })).filter(group => group.items.length > 0);

  const flatItems = filteredActions.flatMap(group => group.items);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (isOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % (flatItems.length || 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + (flatItems.length || 1)) % (flatItems.length || 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (flatItems[selectedIndex]) {
            handleAction(flatItems[selectedIndex].id);
          }
        }
        else if (e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); onAction('ai_agent'); }
        else if (e.altKey && e.key.toLowerCase() === 'i') { e.preventDefault(); onAction('new_invoice'); }
        else if (e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); onAction('new_expense'); }
        else if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); onAction('transfer'); }
        else if (e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); onAction('add_contact'); }
        else if (e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); onAction('journal_voucher'); }
        else if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); onAction('bank_recon'); }
        else if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); onAction('stock_audit'); }
        else if (e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); onAction('fixed_asset'); }
        else if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); onAction('payroll_slips'); }
        else if (e.key === 'F4') { e.preventDefault(); onAction('academy'); }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, flatItems, selectedIndex, onClose, onAction]);

  useEffect(() => {
    // Scroll selected item into view
    if (isOpen && scrollRef.current) {
      const selectedEl = scrollRef.current.querySelector('[data-selected="true"]');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, isOpen]);

  const handleAction = (id) => {
    onAction(id);
    onClose();
  };

  if (!isOpen) return null;

  let globalIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-2xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-xl rounded-xl overflow-hidden flex flex-col max-h-[70vh]">
        
        {/* Search Header */}
        <div className="flex items-center px-4 py-3 border-b border-slate-700/80 bg-slate-800/50">
          <Search className="w-5 h-5 text-slate-400 mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-slate-200 text-lg placeholder-slate-500 font-sans"
            placeholder={isEn ? "Search commands... (e.g., 'invoice' or 'sale')" : "কমান্ড খুঁজুন... (যেমন: 'invoice' বা 'ইনভয়েস')"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="text-xs text-slate-500 font-mono ml-2 border border-slate-700 bg-slate-800/80 px-2 py-1 rounded">
            {isEn ? 'ESC to close' : 'ESC চেপে বন্ধ করুন'}
          </div>
        </div>

        {/* Results Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {filteredActions.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p>
                {isEn ? `No actions found for "${searchQuery}"` : `"${searchQuery}" এর জন্য কোনো ফলাফল পাওয়া যায়নি`}
              </p>
            </div>
          ) : (
            filteredActions.map((group, groupIndex) => (
              <div key={groupIndex} className="mb-4 last:mb-0">
                <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {group.group}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const currentIndex = globalIndex++;
                    const isSelected = currentIndex === selectedIndex;

                    return (
                      <button
                        key={item.id}
                        data-selected={isSelected}
                        onClick={() => handleAction(item.id)}
                        className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors duration-150 cursor-pointer ${
                          isSelected 
                            ? 'bg-blue-600/20 text-white' 
                            : 'text-slate-300 hover:bg-slate-800/60'
                        }`}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                      >
                        <div className="flex items-center space-x-3 overflow-hidden">
                          <div className={`p-1.5 rounded-md ${
                            isSelected ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-400'
                          }`}>
                            <item.icon className="w-4 h-4" />
                          </div>
                          <div className="truncate">
                            <div className={`font-medium text-sm ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                              {item.title}
                            </div>
                            <div className={`text-xs ${isSelected ? 'text-blue-200/70' : 'text-slate-500'}`}>
                              {item.subtitle}
                            </div>
                          </div>
                        </div>
                        
                        {item.shortcut && (
                          <div className={`ml-3 shrink-0 flex items-center font-mono text-[11px] px-2 py-0.5 rounded-md border ${
                            isSelected 
                              ? 'bg-blue-900/40 text-blue-300 border-blue-700/50' 
                              : 'bg-slate-800 text-slate-400 border-slate-600/60'
                          }`}>
                            {item.shortcut}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}