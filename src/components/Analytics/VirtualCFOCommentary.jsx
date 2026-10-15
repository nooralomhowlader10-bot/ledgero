import React, { useState } from 'react';
import { 
  calculateBusinessHealthScorecard, 
  calculateProjectedCashFlow, 
  generateVirtualCFOCommentary 
} from '../../data/analyticsEngine';
import { 
  Bot, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Share2, 
  ArrowRight, 
  ShieldAlert, 
  TrendingUp, 
  DollarSign, 
  MessageSquare,
  Check
} from 'lucide-react';

export default function VirtualCFOCommentary({ state, isDemoMode = false, lang = 'bn' }) {
  const isEn = lang === 'en';
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Dynamically compute scorecard and cashflow
  const scorecard = calculateBusinessHealthScorecard(state, isDemoMode);
  const cashflow = calculateProjectedCashFlow(state, 30, isDemoMode);
  const cfoData = generateVirtualCFOCommentary(scorecard, cashflow, lang);

  const handleCopyWhatsApp = () => {
    const text = `📊 *Ledgero Virtual CFO Report*\n` +
      `------------------------\n` +
      `💼 *Health Score:* ${cfoData.score}/100 (${isEn ? cfoData.rating : cfoData.rating_bn})\n\n` +
      `📝 *Executive Summary:*\n${cfoData.execSummary}\n\n` +
      `🎯 *Top Action Directives:*\n` +
      cfoData.actions.map((act, i) => `${i + 1}. ${act}`).join('\n') +
      `\n------------------------\nGenerated via Ledgero AI Controller`;

    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="bg-slate-900/90 backdrop-blur-md text-slate-100 p-6 sm:p-8 rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden font-sans space-y-7">
      
      {/* Background ambient gradient glow */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20"></div>

      {/* ── Header: AI Virtual CFO Avatar & Quick Actions ───────────────── */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-lg shadow-emerald-900/30">
              <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                <Bot className="w-7 h-7 text-emerald-400" />
              </div>
            </div>
            {/* Live pulsing indicator */}
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-slate-900"></span>
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {isEn ? 'Virtual Financial Controller' : 'ভার্চুয়াল চিফ ফাইন্যান্সিয়াল অফিসার'}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs uppercase font-bold tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {isEn ? 'AI Health Agent' : 'এআই সিএফও'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              {isEn 
                ? 'Automated algorithmic audit, liquidity inspection & operational steering' 
                : 'স্বয়ংক্রিয় আর্থিক অডিট, তারল্য বিশ্লেষণ ও দিকনির্দেশনা'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
            title={isEn ? 'Recalculate Analysis' : 'পুনরায় বিশ্লেষণ করুন'}
          >
            <RefreshCw size={14} className="text-emerald-400" />
            <span className="hidden sm:inline">{isEn ? 'Re-Audit' : 'রি-অডিট'}</span>
          </button>

          <button
            onClick={handleCopyWhatsApp}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-md shadow-emerald-950 cursor-pointer"
          >
            {copied ? <Check size={14} /> : <Share2 size={14} />}
            <span>{copied ? (isEn ? 'Copied!' : 'কপি হয়েছে!') : (isEn ? 'Share WhatsApp' : 'হোয়াটসঅ্যাপে পাঠান')}</span>
          </button>
        </div>
      </div>

      {/* ── Executive Summary Narrative ─────────────────────────────────── */}
      <div className="relative z-10 bg-slate-950/60 p-5 rounded-xl border border-slate-800 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
          <Sparkles size={14} className="text-amber-400" />
          <span>{isEn ? 'Executive Diagnostic Brief' : 'নির্বাহী সারসংক্ষেপ ও স্বাস্থ্য রিপোর্ট'}</span>
        </div>
        <p className="text-slate-200 text-sm sm:text-base leading-relaxed font-normal">
          {cfoData.execSummary}
        </p>
      </div>

      {/* ── Strengths & Risk Warnings Grid ──────────────────────────────── */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* Strengths */}
        <div className="bg-emerald-950/15 border border-emerald-900/40 p-5 rounded-xl space-y-3.5">
          <div className="flex items-center gap-2 text-emerald-400 text-xs uppercase font-bold tracking-wider">
            <CheckCircle2 size={16} />
            <span>{isEn ? 'Demonstrated Strengths' : 'ব্যবসায়ের মূল আর্থিক সক্ষমতা'}</span>
          </div>
          <ul className="space-y-2.5">
            {cfoData.strengths.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200">
                <span className="text-emerald-400 font-bold mt-0.5">✓</span>
                <span className="leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Risk Warnings */}
        <div className="bg-rose-950/15 border border-rose-900/40 p-5 rounded-xl space-y-3.5">
          <div className="flex items-center gap-2 text-rose-400 text-xs uppercase font-bold tracking-wider">
            <AlertTriangle size={16} />
            <span>{isEn ? 'Critical Risk Warnings' : 'সতর্কতা ও আর্থিক ঝুঁকি'}</span>
          </div>
          <ul className="space-y-2.5">
            {cfoData.warnings.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200">
                <span className="text-rose-400 font-bold mt-0.5">!</span>
                <span className="leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </div>

      </div>

      {/* ── Tactical Action Directives ─────────────────────────────────── */}
      <div className="relative z-10 space-y-3.5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase font-bold tracking-wider text-slate-300 flex items-center gap-1.5">
            <TrendingUp size={14} className="text-emerald-400" />
            {isEn ? 'Tactical Directives for This Month' : 'এই মাসের অগ্রাধিকারমূলক কর্মপরিকল্পনা'}
          </span>
          <span className="text-[11px] text-slate-300">
            {isEn ? '3 High-ROI Actions' : '৩টি কার্যকর পদক্ষেপ'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {cfoData.actions.map((actionText, index) => (
            <div 
              key={index} 
              className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors flex flex-col justify-between gap-3 group"
            >
              <div className="space-y-2">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-xs">
                  {index + 1}
                </div>
                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
                  {actionText}
                </p>
              </div>

              <div className="flex items-center text-[11px] font-semibold text-emerald-400 group-hover:text-emerald-300 transition-colors gap-1 mt-1">
                <span>{isEn ? 'Execute Action' : 'পদক্ষেপ নিন'}</span>
                <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
