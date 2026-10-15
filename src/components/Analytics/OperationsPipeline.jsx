import React from 'react';
import { getOperationsPipeline } from '../../data/analyticsEngine';
import { formatBDT } from '../../data/calculations';
import { 
  CreditCard, 
  FileText, 
  Users, 
  Clock, 
  AlertCircle, 
  ChevronRight, 
  PhoneCall, 
  Send,
  Building,
  ShieldAlert,
  ArrowUpRight,
  TrendingDown
} from 'lucide-react';

export default function OperationsPipeline({ state, isDemoMode = false, lang = 'bn' }) {
  const isEn = lang === 'en';
  const pipelineData = getOperationsPipeline(state, isDemoMode);
  const { pipeline, topDebtors, topCreditors } = pipelineData;

  const renderFunnelBar = (stages, totalAmount) => {
    return (
      <div className="space-y-3">
        {/* Segmented Bar */}
        <div className="flex h-10 w-full rounded-xl overflow-hidden shadow-inner bg-slate-950 p-1 gap-1 border border-slate-800">
          {stages.map((stage) => {
            const pct = totalAmount > 0 ? Math.max(8, (stage.amount / totalAmount) * 100) : 25;
            return (
              <div
                key={stage.key}
                style={{ width: `${pct}%` }}
                className={`${stage.color} rounded-lg flex items-center justify-center relative group cursor-pointer transition-all hover:opacity-90`}
                title={`${isEn ? (stage.label_en || stage.label) : stage.label}: ${formatBDT(stage.amount, lang)} (${stage.count})`}
              >
                <span className="text-[11px] font-black text-white px-1 truncate">
                  {stage.count}
                </span>
                
                {/* Floating hover badge */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-950 border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20 transition-opacity font-mono">
                  <div className="font-bold text-white font-sans">{isEn ? (stage.label_en || stage.label) : stage.label}</div>
                  <div className="text-emerald-400">{formatBDT(stage.amount, lang)} ({stage.count} {isEn ? "records" : "টি"})</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {stages.map((stage) => (
            <div key={stage.key} className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${stage.color}`}></span>
                <span className="text-[11px] font-medium text-slate-300 truncate">{isEn ? (stage.label_en || stage.label) : stage.label}</span>
              </div>
              <div className="text-sm font-bold font-mono text-slate-100">
                {formatBDT(stage.amount, lang)}
              </div>
              <div className="text-xs text-slate-300">
                {stage.count} {isEn ? 'records' : 'টি হিসাব'}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const invoiceTotal = pipeline.invoices.reduce((acc, s) => acc + s.amount, 0);
  const billTotal = pipeline.bills.reduce((acc, s) => acc + s.amount, 0);

  const getStatusBadge = (status, days) => {
    if (status === 'critical') {
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          {days} {isEn ? 'days late' : 'দিন বকেয়া'}
        </span>
      );
    } else if (status === 'warning') {
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
          {days} {isEn ? 'days late' : 'দিন বকেয়া'}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        {isEn ? 'On time' : 'সময়মতো'}
      </span>
    );
  };

  return (
    <div className="bg-slate-900/90 backdrop-blur-md text-slate-100 p-5 sm:p-7 rounded-2xl border border-slate-800 shadow-2xl space-y-8 font-sans">
      
      {/* ── Section Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {isEn ? 'Operations & Aging Pipeline' : 'অপারেশনস পাইপলাইন ও বকেয়া খাতা'}
          </h2>
          <p className="text-xs text-slate-300 mt-0.5">
            {isEn 
              ? 'Stage tracking for customer invoices, supplier payables, and debtor aging' 
              : 'কাস্টমার ইনভয়েস, সাপ্লায়ার বিল এবং বাকি আদায়ের পূর্ণাঙ্গ ট্র্যাকিং'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
            {isEn ? 'Total AR: ' : 'মোট কাস্টমার বাকি: '}
            <span className="text-emerald-400">{formatBDT(pipelineData.financials?.ar || invoiceTotal, lang)}</span>
          </span>
        </div>
      </div>

      {/* ── Pipeline Funnels: Invoices & Bills ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Invoices Funnel */}
        <div className="bg-slate-850 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                {isEn ? 'Customer Invoices Pipeline' : 'কাস্টমার সেলস ও ইনভয়েস পাইপলাইন'}
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-slate-300">
              {formatBDT(invoiceTotal, lang)}
            </span>
          </div>

          {renderFunnelBar(pipeline.invoices, invoiceTotal)}
        </div>

        {/* Bills Funnel */}
        <div className="bg-slate-850 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                {isEn ? 'Supplier Bills & Payables Pipeline' : 'মহাজন ও সাপ্লায়ার বিল পাইপলাইন'}
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-slate-300">
              {formatBDT(billTotal, lang)}
            </span>
          </div>

          {renderFunnelBar(pipeline.bills, billTotal)}
        </div>

      </div>

      {/* ── Debtors & Creditors Leaderboards ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Top 5 Debtors (পাওনা খাতা) */}
        <div className="bg-slate-850 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                {isEn ? 'Top Debtors (Highest Amounts Owed)' : 'শীর্ষ কাস্টমার বকেয়া (সর্বোচ্চ পাওনাদার)'}
              </h3>
            </div>
            <span className="text-[11px] text-slate-300">{isEn ? 'Aging Priority' : 'আদায় অগ্রাধিকার'}</span>
          </div>

          <div className="space-y-2.5">
            {topDebtors.map((d, index) => (
              <div 
                key={d.id || index}
                className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center">
                    {index + 1}
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{d.name}</h4>
                    <p className="text-[11px] text-slate-300 flex items-center gap-1.5 mt-0.5">
                      <span>{d.phone}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-mono font-bold text-emerald-400">
                      {formatBDT(d.amount, lang)}
                    </div>
                    <div>
                      {getStatusBadge(d.status, d.daysOverdue)}
                    </div>
                  </div>

                  <a 
                    href={`https://wa.me/${d.phone?.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`আসসালামু আলাইকুম ${d.name}, আপনার দোকানের বকেয়া বিল ${formatBDT(d.amount, lang)}। অনুগ্রহ করে পরিশোধ করুন।`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white transition-colors"
                    title={isEn ? 'Send WhatsApp Payment Reminder' : 'হোয়াটসঅ্যাপে বকেয়া তাগাদা দিন'}
                  >
                    <Send size={14} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top 5 Creditors (দেনা খাতা) */}
        <div className="bg-slate-850 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                {isEn ? 'Top Creditors (Upcoming Supplier Payments)' : 'মহাজন ও সাপ্লায়ারদের দেনা (প্রদেয় তালিকা)'}
              </h3>
            </div>
            <span className="text-[11px] text-slate-300">{isEn ? 'Due Timeline' : 'পরিশোধের সময়সূচি'}</span>
          </div>

          <div className="space-y-2.5">
            {topCreditors.map((c, index) => (
              <div 
                key={c.id || index}
                className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center">
                    {index + 1}
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{c.name}</h4>
                    <p className="text-[11px] text-slate-300 flex items-center gap-1 mt-0.5">
                      <Clock size={12} className="text-amber-400" />
                      <span>{isEn ? `Due: ${c.dueDate}` : `পরিশোধ: ${c.dueDate}`}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-mono font-bold text-purple-300">
                      {formatBDT(c.amount, lang)}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      c.status === 'due_soon' 
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' 
                        : 'bg-slate-800 text-slate-300'
                    }`}>
                      {c.status === 'due_soon' ? (isEn ? 'Due Soon' : 'শীঘ্রই প্রদেয়') : (isEn ? 'Normal' : 'স্বাভাবিক')}
                    </span>
                  </div>

                  <button
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title={isEn ? 'Record Bill Payment' : 'বিল পরিশোধ এন্ট্রি'}
                  >
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
