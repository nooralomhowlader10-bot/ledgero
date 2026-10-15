import React, { useState } from 'react';
import CashFlowManager from './CashFlowManager';
import BusinessHealthScorecard from './BusinessHealthScorecard';
import VirtualCFOCommentary from './VirtualCFOCommentary';
import OperationsPipeline from './OperationsPipeline';
import { 
  BarChart3, 
  LineChart, 
  Activity, 
  Layers, 
  Bot, 
  Printer, 
  ToggleLeft, 
  ToggleRight, 
  Sparkles,
  ArrowRight,
  TrendingUp,
  CreditCard
} from 'lucide-react';

export default function AnalyticsHub({ 
  state, 
  isDemoMode = false, 
  onToggleDemoMode = () => {}, 
  lang = 'bn',
  initialTab = 'cfo'
}) {
  const isEn = lang === 'en';
  const [activeTab, setActiveTab] = useState(initialTab);

  const tabs = [
    { 
      id: 'cfo', 
      label: 'Virtual CFO Brief', 
      label_bn: 'ভার্চুয়াল সিএফও সারসংক্ষেপ',
      icon: <Bot size={16} />,
      desc: isEn ? 'AI diagnostic narrative & tactical action directives' : 'এআই আর্থিক মূল্যায়ন ও কৌশলগত দিকনির্দেশনা'
    },
    { 
      id: 'cashflow', 
      label: 'Cash Flow Timeline', 
      label_bn: 'ক্যাশ ফ্লো ওয়াটারফল ও ফোরকাস্ট',
      icon: <LineChart size={16} />,
      desc: isEn ? '7 to 90-day dual-direction cash movement & projected balance' : '৭ থেকে ৯০ দিনের ক্যাশ ইনফ্লো, আউটফ্লো ও পূর্বাভাস'
    },
    { 
      id: 'scorecard', 
      label: '14-KPI Health Scorecard', 
      label_bn: '১৪টি IFRS হেলথ সূচক',
      icon: <Activity size={16} />,
      desc: isEn ? 'Solvency, liquidity, margin & collection efficiency audit' : 'তারল্য, মুনাফার মার্জিন ও মূলধন সক্ষমতা অডিট'
    },
    { 
      id: 'pipeline', 
      label: 'Operations & Aging', 
      label_bn: 'বকেয়া খাতা ও পাইপলাইন',
      icon: <Layers size={16} />,
      desc: isEn ? 'Invoices, bills, overdue debtor aging & supplier terms' : 'কাস্টমার বাকি, মহাজন দেনা ও আদায়ের অগ্রাধিকার'
    }
  ];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12 font-sans">
      
      {/* ── Top Header Toolbar ────────────────────────────────────────── */}
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <BarChart3 size={20} />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <span>{isEn ? 'Financial Analytics & Intelligence' : 'ফাইন্যান্সিয়াল অ্যানালিটিক্স ও বিজনেস ইন্টেলিজেন্স'}</span>
              </h1>
              <p className="text-xs text-slate-300 mt-0.5">
                {isEn 
                  ? 'Enterprise IFRS/GAAP analytics, predictive cash modeling & AI Virtual CFO' 
                  : 'আন্তর্জাতিক মানদণ্ডে ব্যবসায়িক বিশ্লেষণ, পূর্বাভাস ও ভার্চুয়াল এআই সিএফও'}
              </p>
            </div>
          </div>
        </div>

        {/* Right Actions: Demo Switch & Print */}
        <div className="flex items-center gap-3 self-end md:self-auto">
          
          {/* Demo Toggle Pill */}
          <button
            onClick={onToggleDemoMode}
            className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border transition-all cursor-pointer ${
              isDemoMode 
                ? 'bg-amber-950/40 border-amber-600/60 text-amber-300 shadow-sm shadow-amber-950' 
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <div className="flex flex-col items-start">
              <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">
                {isEn ? 'Data Source' : 'ডেটা সোর্স'}
              </span>
              <span className="text-xs font-bold">
                {isDemoMode ? (isEn ? 'Demo Simulation' : 'ডেমো প্রিভিউ') : (isEn ? 'Live Ledgero Data' : 'লাইভ ডেটা')}
              </span>
            </div>
            {isDemoMode ? (
              <ToggleRight size={24} className="text-amber-400" />
            ) : (
              <ToggleLeft size={24} className="text-emerald-400" />
            )}
          </button>

          {/* Print / PDF Trigger */}
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
            title={isEn ? 'Print Full Financial Report' : 'রিপোর্ট প্রিন্ট বা পিডিএফ করুন'}
          >
            <Printer size={15} className="text-slate-400" />
            <span className="hidden sm:inline">{isEn ? 'Print Report' : 'প্রিন্ট রিপোর্ট'}</span>
          </button>

        </div>
      </div>

      {/* ── Tab Navigation Pills ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                isActive
                  ? 'bg-slate-800 border-emerald-500 shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500/50'
                  : 'bg-slate-900/90 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className={`p-2 rounded-xl border ${
                  isActive 
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950' 
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {tab.icon}
                </div>
                <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                  isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
                }`}>
                  {isActive ? (isEn ? 'Active' : 'সক্রিয়') : ''}
                </span>
              </div>

              <div>
                <h3 className={`text-sm font-bold leading-tight ${isActive ? 'text-white' : 'text-slate-200'}`}>
                  {isEn ? tab.label : tab.label_bn}
                </h3>
                <p className={`text-[11px] mt-1 line-clamp-1 ${isActive ? 'text-slate-200' : 'text-slate-400'}`}>
                  {tab.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Active Tab Display ─────────────────────────────────────────── */}
      <div className="transition-all duration-200">
        {activeTab === 'cfo' && (
          <div className="space-y-6">
            <VirtualCFOCommentary state={state} isDemoMode={isDemoMode} lang={lang} />
            <BusinessHealthScorecard state={state} isDemoMode={isDemoMode} lang={lang} />
          </div>
        )}

        {activeTab === 'cashflow' && (
          <CashFlowManager state={state} isDemoMode={isDemoMode} lang={lang} />
        )}

        {activeTab === 'scorecard' && (
          <BusinessHealthScorecard state={state} isDemoMode={isDemoMode} lang={lang} />
        )}

        {activeTab === 'pipeline' && (
          <OperationsPipeline state={state} isDemoMode={isDemoMode} lang={lang} />
        )}
      </div>

    </div>
  );
}
