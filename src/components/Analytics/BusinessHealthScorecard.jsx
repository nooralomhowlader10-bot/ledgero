import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { calculateBusinessHealthScorecard } from '../../data/analyticsEngine';
import { formatBDT } from '../../data/calculations';
import { 
  Activity, 
  HelpCircle, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  TrendingUp, 
  TrendingDown, 
  Sparkles, 
  Layers, 
  X,
  ChevronRight,
  ShieldCheck,
  Scale,
  DollarSign,
  BarChart3
} from 'lucide-react';

export default function BusinessHealthScorecard({ state, isDemoMode = false, lang = 'bn' }) {
  const isEn = lang === 'en';
  const scorecard = calculateBusinessHealthScorecard(state, isDemoMode);
  
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [activeFormula, setActiveFormula] = useState(null);
  const [activeInsight, setActiveInsight] = useState(null);

  const healthScore = scorecard.score || 78;
  const circumference = 2 * Math.PI * 44;
  const strokeDashoffset = circumference - (healthScore / 100) * circumference;

  const categories = [
    { id: 'ALL', label: 'All 14 KPIs', label_bn: '১৪টি সূচক (সব)' },
    { id: 'Core Profitability', label: 'Core Profitability', label_bn: 'মৌলিক মুনাফা' },
    { id: 'Working Capital & Liquidity', label: 'Liquidity & Working Capital', label_bn: 'চলতি মূলধন ও তারল্য' },
    { id: 'Profitability Margins', label: 'Profitability Margins', label_bn: 'মুনাফার মার্জিন' },
    { id: 'Solvency & Risk', label: 'Solvency & Risk', label_bn: 'ঋণ ও ঝুঁকি ব্যবস্থাপনা' },
  ];

  const filteredKpis = selectedCategory === 'ALL' 
    ? scorecard.kpis 
    : scorecard.kpis.filter(k => k.cat === selectedCategory);

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Achieved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 size={12} />
            {isEn ? 'Healthy' : 'সন্তোষজনক'}
          </span>
        );
      case 'Watchlist':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle size={12} />
            {isEn ? 'Watchlist' : 'নজরদারি'}
          </span>
        );
      case 'Critical':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertCircle size={12} />
            {isEn ? 'Critical' : 'ঝুঁকিপূর্ণ'}
          </span>
        );
    }
  };

  const getInsightContent = (type) => {
    const s = scorecard.summary;
    if (type === 'score') {
      return {
        title: isEn ? 'Overall Health Score Analysis' : 'সামগ্রিক হেলথ স্কোর বিশ্লেষণ',
        summary: isEn
          ? `Your business scored ${healthScore}/100, ranking it '${scorecard.rating}'. This score is computed using 8 weighted IFRS solvency and liquidity drivers.`
          : `আপনার ব্যবসা ১০০ এর মধ্যে ${healthScore} স্কোর করেছে, যার রেটিং '${scorecard.rating_bn}'। আন্তর্জাতিক ৮টি তারল্য ও ঝুঁকি ফ্যাক্টরের ভিত্তিতে এটি নির্ধারিত হয়েছে।`,
        points: [
          isEn 
            ? `Working Capital is ৳ ${formatBDT(s.workingCapital)} with a Current Ratio of ${s.currentRatio}x.`
            : `চলতি মূলধন ৳ ${formatBDT(s.workingCapital)} এবং চলতি অনুপাত ${s.currentRatio}x (নিরাপদ সীমার মধ্যে)।`,
          isEn
            ? `Cash Runway covers approximately ${s.cashRunway} days of operating overheads.`
            : `ক্যাশ রিজার্ভ দিয়ে আনুমানিক ${s.cashRunway} দিন দোকান চালানো সম্ভব।`,
          isEn
            ? `Customer collection turnaround (DSO) is currently ${s.dso} days.`
            : `কাস্টমারদের কাছে থেকে বাকি তোলার গড় সময় ${s.dso} দিন।`
        ]
      };
    } else if (type === 'profit') {
      return {
        title: isEn ? 'How to Improve Profitability' : 'কীভাবে মুনাফা বৃদ্ধি করবেন',
        summary: isEn
          ? `Gross Margin is at ${s.grossMargin}%, while Net Margin is ${s.netMargin}%. Here is how you can expand margins:`
          : `আপনার গ্রস মার্জিন ${s.grossMargin}% এবং নিট মার্জিন ${s.netMargin}%। মুনাফা বাড়ানোর কৌশল:`,
        points: [
          isEn
            ? `Optimize product mix: Focus promotions on items with >25% gross margins.`
            : `উচ্চ মার্জিনের পণ্যে জোর দিন: ২৫% এর বেশি লাভের পণ্যগুলোকে দোকানের সামনে রাখুন।`,
          isEn
            ? `Review OpEx overheads: Operating expenses are ৳ ${formatBDT(s.opex)}, which is ${(s.revenue > 0 ? (s.opex/s.revenue*100).toFixed(1) : 0)}% of revenue.`
            : `দোকানের খরচ নিয়ন্ত্রণ: পরিচালন ব্যয় ৳ ${formatBDT(s.opex)}, যা মোট বিক্রির ${(s.revenue > 0 ? (s.opex/s.revenue*100).toFixed(1) : 0)}%। এটি ৫% কমালে নিট লাভ তাৎক্ষণিক বাড়বে।`,
          isEn
            ? `Supplier discounts: Negotiate 1.5% bulk advance payment discounts from top distributors.`
            : `পাইকারি ছাড় গ্রহণ: বড় ডিলারদের দ্রুত ক্যাশ পরিশোধ করে বাড়তি ১.৫% ছাড় আদায় করুন।`
        ]
      };
    } else {
      return {
        title: isEn ? 'Financial Risk Diagnostic' : 'আর্থিক ঝুঁকি ও নিরাপত্তা বিশ্লেষণ',
        summary: isEn
          ? `Key risk scan based on liquidity, debtor aging, and supplier debt leverage:`
          : `তারল্য, বকেয়া বাকি এবং মহাজন দেনার সার্বিক ঝুঁকি স্ক্যান:`,
        points: [
          s.dso > 35 
            ? (isEn ? `High Debtor Days: Outstanding receivables (${s.dso} days) are locking up ৳ ${formatBDT(s.ar)} in trade credit.` : `বাকি আদায়ের চাপ: কাস্টমারদের বকেয়া তোলার সময় ${s.dso} দিন, যা দ্রুত আদায়ের তাগাদা দেওয়া উচিত।`)
            : (isEn ? `Debtor Days are controlled at ${s.dso} days (standard retail threshold).` : `বাকি তোলার সময় ${s.dso} দিন, যা সন্তোষজনক।`),
          s.cashRunway < 25
            ? (isEn ? `Short Runway Alert: Cash reserve covers only ${s.cashRunway} days. Delay non-critical capital expenses.` : `ক্যাশ রানওয়ে সতর্কতা: বর্তমান ক্যাশে মাত্র ${s.cashRunway} দিন চলবে। জরুরি ব্যতিত অপ্রয়োজনীয় খরচ বন্ধ রাখুন।`)
            : (isEn ? `Healthy Cash Buffer: Runway is ${s.cashRunway} days, giving safe operational independence.` : `পর্যাপ্ত ক্যাশ রিজার্ভ: ${s.cashRunway} দিনের নিরাপত্তা রিজার্ভ রয়েছে।`),
          (isEn ? `Debt-to-Equity is balanced: Current liabilities are supported by inventory and cash assets.` : `দেনার অনুপাত স্বাভাবিক: মজুদ পণ্য ও ক্যাশ দিয়ে বর্তমান দেনা অনায়াসে পরিশোধযোগ্য।`)
        ]
      };
    }
  };

  return (
    <div className="bg-slate-900/90 backdrop-blur-md text-slate-100 p-5 sm:p-7 rounded-2xl border border-slate-800 shadow-2xl space-y-7 font-sans">
      
      {/* ── Top Hero: Health Score Gauge & Interactive Insights ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 p-6 rounded-2xl border border-slate-800/80 shadow-inner">
        
        {/* Score Gauge */}
        <div className="lg:col-span-5 flex items-center gap-6">
          <div className="relative w-28 h-28 flex-shrink-0">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" fill="transparent" stroke="#1e293b" strokeWidth="9" />
              <circle 
                cx="50" 
                cy="50" 
                r="44" 
                fill="transparent" 
                stroke={healthScore >= 80 ? '#10b981' : healthScore >= 60 ? '#3b82f6' : healthScore >= 40 ? '#f59e0b' : '#f43f5e'} 
                strokeWidth="9" 
                strokeDasharray={circumference} 
                strokeDashoffset={strokeDashoffset} 
                strokeLinecap="round" 
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl sm:text-3xl font-black tracking-tight text-white">{healthScore}%</span>
              <span className="text-xs uppercase font-bold text-slate-300">Score</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-bold tracking-wider text-emerald-400">
                {isEn ? 'Financial Health Rating' : 'আর্থিক স্বাস্থ্য রেটিং'}
              </span>
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2">
              {isEn ? scorecard.rating : scorecard.rating_bn}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed max-w-xs">
              {isEn 
                ? 'Scored across cash health, working capital, profitability, and collections.'
                : 'আইএফআরএস আন্তর্জাতিক মানদণ্ডে তারল্য, মার্জিন ও ঋণ সক্ষমতা অনুযায়ী স্বয়ংক্রিয়ভাবে মূল্যায়িত।'}
            </p>
          </div>
        </div>

        {/* Quick Diagnostic Insights Buttons */}
        <div className="lg:col-span-7 flex flex-col justify-center gap-3 border-t lg:border-t-0 lg:border-l border-slate-800 pt-5 lg:pt-0 lg:pl-6">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Sparkles size={14} className="text-emerald-400" />
            {isEn ? 'Interactive AI Diagnostics' : 'ইন্টারেক্টিভ এআই ডায়াগনস্টিকস'}
          </p>

          <div className="flex flex-wrap gap-2.5">
            <button 
              onClick={() => setActiveInsight(activeInsight === 'score' ? null : 'score')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border cursor-pointer ${
                activeInsight === 'score'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-950/40'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700 hover:border-slate-600'
              }`}
            >
              <span>📊</span>
              <span>{isEn ? 'Explain My Health Score' : 'হেলথ স্কোর বিশ্লেষণ'}</span>
            </button>

            <button 
              onClick={() => setActiveInsight(activeInsight === 'profit' ? null : 'profit')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border cursor-pointer ${
                activeInsight === 'profit'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-950/40'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700 hover:border-slate-600'
              }`}
            >
              <span>📈</span>
              <span>{isEn ? 'How to Improve Profit' : 'কীভাবে মুনাফা বাড়াবেন'}</span>
            </button>

            <button 
              onClick={() => setActiveInsight(activeInsight === 'risk' ? null : 'risk')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border cursor-pointer ${
                activeInsight === 'risk'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-950/40'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700 hover:border-slate-600'
              }`}
            >
              <span>🛡️</span>
              <span>{isEn ? 'Identify Financial Risks' : 'আর্থিক ঝুঁকি শনাক্ত করুন'}</span>
            </button>
          </div>

          {/* Render Active Diagnostic Drawer */}
          {activeInsight && (
            <div className="mt-2 p-4 rounded-xl bg-slate-950/80 border border-emerald-500/30 text-xs space-y-2.5 animate-in fade-in duration-200">
              {(() => {
                const diag = getInsightContent(activeInsight);
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 text-sm">{diag.title}</span>
                      <button onClick={() => setActiveInsight(null)} className="text-slate-300 hover:text-white">
                        <X size={14} />
                      </button>
                    </div>
                    <p className="text-slate-300 leading-relaxed">{diag.summary}</p>
                    <ul className="space-y-1.5 pt-1">
                      {diag.points.map((pt, i) => (
                        <li key={i} className="flex items-start gap-2 text-slate-200">
                          <span className="text-emerald-400 font-bold">•</span>
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ── Category Filter Pills ───────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-950'
                  : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-slate-200 border border-slate-700/60'
              }`}
            >
              {isEn ? cat.label : cat.label_bn}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-300">
          {isEn ? `Showing ${filteredKpis.length} of 14 KPIs` : `১৪টির মধ্যে ${filteredKpis.length}টি সূচক প্রদর্শিত`}
        </span>
      </div>

      {/* ── 14 KPIs Master Table ────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="bg-slate-850 text-slate-300 uppercase tracking-wider text-[11px] font-bold border-b border-slate-800">
            <tr>
              <th className="py-3.5 px-4">{isEn ? 'Metric Name' : 'সূচকের নাম'}</th>
              <th className="py-3.5 px-3 text-center">{isEn ? 'Formula' : 'ফর্মুলা'}</th>
              <th className="py-3.5 px-4 text-right">{isEn ? 'Current Value' : 'বর্তমান মান'}</th>
              <th className="py-3.5 px-4 text-center">{isEn ? 'Target' : 'লক্ষ্য'}</th>
              <th className="py-3.5 px-4 text-center">{isEn ? 'Health Status' : 'অবস্থা'}</th>
              <th className="py-3.5 px-4 text-center">{isEn ? 'Impact' : 'গুরুত্ব'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {filteredKpis.map((kpi) => (
              <tr key={kpi.key} className="hover:bg-slate-800/40 transition-colors group">
                {/* Metric Name */}
                <td className="py-3.5 px-4">
                  <div className="font-semibold text-slate-100 flex items-center gap-2">
                    <span>{isEn ? kpi.name : kpi.name_bn}</span>
                  </div>
                  <div className="text-[11px] text-slate-300 group-hover:text-slate-300 transition-colors">
                    {isEn ? kpi.cat : kpi.cat_bn}
                  </div>
                </td>

                {/* Formula Trigger */}
                <td className="py-3.5 px-3 text-center">
                  <button
                    onClick={() => setActiveFormula(kpi)}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-[11px] font-mono font-bold transition-colors cursor-pointer"
                    title={isEn ? 'Inspect Calculation Formula' : 'হিসাবের ফর্মুলা দেখুন'}
                  >
                    fx
                  </button>
                </td>

                {/* Current Value */}
                <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-100 text-sm">
                  {isEn ? (kpi.formattedVal_en || kpi.formattedVal) : kpi.formattedVal}
                </td>

                {/* Target Direction */}
                <td className="py-3.5 px-4 text-center">
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    kpi.dir === 'Increase' ? 'text-emerald-400' : 'text-sky-400'
                  }`}>
                    {kpi.dir === 'Increase' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    <span>{kpi.dir === 'Increase' ? (isEn ? 'Higher' : 'উচ্চতর') : (isEn ? 'Lower' : 'নিম্নতর')}</span>
                  </span>
                </td>

                {/* Health Status */}
                <td className="py-3.5 px-4 text-center">
                  {getStatusBadge(kpi.status)}
                </td>

                {/* Importance */}
                <td className="py-3.5 px-4 text-center">
                  <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                    kpi.imp === 'High' 
                      ? 'bg-purple-950/60 text-purple-300 border border-purple-800/40' 
                      : 'bg-slate-800 text-slate-300 border border-slate-700/60'
                  }`}>
                    {kpi.imp}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Interactive Formula (fx) Inspector Modal ──────────────────────── */}
      {activeFormula && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 max-w-lg w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs uppercase font-bold tracking-wider text-emerald-400">
                  {isEn ? activeFormula.cat : activeFormula.cat_bn}
                </span>
                <h3 className="text-lg font-bold text-white">
                  {isEn ? activeFormula.name : activeFormula.name_bn}
                </h3>
              </div>
              <button 
                onClick={() => setActiveFormula(null)}
                className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Formula Math Box */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-emerald-300 space-y-1">
              <span className="text-xs text-slate-300 uppercase font-sans tracking-wider block">
                {isEn ? 'Mathematical Formula' : 'গাণিতিক সূত্র'}
              </span>
              <p className="text-sm font-bold text-emerald-400">
                {isEn ? activeFormula.formula : activeFormula.formula_bn}
              </p>
            </div>

            {/* Accounting Definition */}
            <div className="space-y-1.5">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-300">
                {isEn ? 'Financial Definition & Standard' : 'আন্তর্জাতিক সংজ্ঞা ও তাৎপর্য'}
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                {isEn ? activeFormula.desc : activeFormula.desc_bn}
              </p>
            </div>

            {/* Current Business Context */}
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60 flex items-center justify-between text-xs">
              <span className="text-slate-300">{isEn ? 'Your Current Value:' : 'আপনার ব্যবসার বর্তমান মান:'}</span>
              <span className="font-mono font-bold text-emerald-400 text-sm">{isEn ? (activeFormula.formattedVal_en || activeFormula.formattedVal) : activeFormula.formattedVal}</span>
            </div>

            <button
              onClick={() => setActiveFormula(null)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              {isEn ? 'Close Inspector' : 'বন্ধ করুন'}
            </button>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
