import React, { useState, useMemo, useEffect } from 'react';
import { calculateProjectedCashFlow } from '../../data/analyticsEngine';
import { formatBDT } from '../../data/calculations';
import { Calendar, TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight, Layers } from 'lucide-react';
import { loadDaysInRange } from '../../firebase/firestoreService';
import { useAuth } from '../../firebase/useAuth.jsx';

export default function CashFlowManager({ state, isDemoMode, lang = 'bn' }) {
  const [horizon, setHorizon] = useState(30);
  const [view, setView] = useState('chart'); // 'chart' or 'table'
  const [hoveredDay, setHoveredDay] = useState(null);
  const [pastDays, setPastDays] = useState([]);
  const { user } = useAuth();

  // Load past 7 days from Firestore for real historical data
  useEffect(() => {
    if (!user?.uid || !state?.activeBizId || isDemoMode) return;
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const startDate = weekAgo.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    
    loadDaysInRange(user.uid, state.activeBizId, startDate, endDate)
      .then(days => setPastDays(days || []))
      .catch(() => setPastDays([]));
  }, [user?.uid, state?.activeBizId, isDemoMode]);

  const { forecast = [], summary = {} } = useMemo(
    () => calculateProjectedCashFlow(state, horizon, isDemoMode, pastDays),
    [state, horizon, isDemoMode, pastDays]
  );

  const isBn = lang === 'bn';

  // Calculate scaling for SVG
  const chartHeight = 260;
  const chartWidth = 900;
  const zeroY = 130;

  const maxVal = useMemo(() => {
    if (!forecast.length) return 10000;
    const peak = Math.max(...forecast.map(d => Math.max(d.cashIn || 0, d.cashOut || 0, (d.closingBalance || 0) * 0.4)));
    return peak > 0 ? peak : 10000;
  }, [forecast]);

  const getYIn = (val) => {
    const clamped = Math.min(val, maxVal);
    const barH = (clamped / maxVal) * 105;
    return zeroY - barH;
  };

  const getYOut = (val) => {
    const clamped = Math.min(val, maxVal);
    const barH = (clamped / maxVal) * 105;
    return zeroY + barH;
  };

  const todayIndex = forecast.findIndex(d => d.isToday);

  return (
    <div className="bg-slate-900/95 dark:bg-slate-950/95 text-slate-100 p-5 sm:p-7 rounded-2xl border border-slate-800 shadow-2xl font-sans relative overflow-hidden backdrop-blur-md">
      {/* Decorative gradient orb */}
      <div className="absolute top-0 right-1/4 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
              <TrendingUp className="w-5 h-5" />
            </span>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {isBn ? 'ক্যাশ ফ্লো ম্যানেজার ও পূর্বাভাস' : 'Predictive Cash Flow Manager'}
            </h2>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            {isBn 
              ? 'অতীত লেনদেন ও ভবিষ্যৎ দেনা-পাওনা থেকে লাইভ ক্যাশ প্রজেকশন' 
              : 'Dynamic cash projection timeline based on maturities & historical velocity'}
          </p>
        </div>

        {/* Horizon Tabs & View Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700/70">
            {[7, 30, 60, 90].map(days => (
              <button
                key={days}
                onClick={() => setHorizon(days)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  horizon === days 
                    ? 'bg-emerald-600 text-white shadow-sm' 
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {days} {isBn ? 'দিন' : 'Days'}
              </button>
            ))}
          </div>

          <div className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700/70">
            <button
              onClick={() => setView('chart')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                view === 'chart' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              {isBn ? 'চার্ট' : 'Chart'}
            </button>
            <button
              onClick={() => setView('table')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                view === 'table' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              {isBn ? 'টেবিল' : 'Table'}
            </button>
          </div>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
        {/* Card 1: Today Liquid Cash */}
        <div className="bg-slate-800/60 hover:bg-slate-800/90 transition-all p-4 rounded-xl border border-slate-700/60 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
            <span>{isBn ? 'আজকের লিকুইড ব্যালেন্স' : "Today's Liquid Cash"}</span>
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-lg sm:text-xl font-black text-white tabular-nums">
            {formatBDT(summary.todayBalance || 0, lang)}
          </p>
          <span className="text-xs text-emerald-400/80 font-medium">
            {isBn ? 'ক্যাশ ও ব্যাংক রিজার্ভ' : 'Drawer & Bank Vault'}
          </span>
        </div>

        {/* Card 2: Today Net Movement */}
        <div className="bg-slate-800/60 hover:bg-slate-800/90 transition-all p-4 rounded-xl border border-slate-700/60 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
            <span>{isBn ? 'আজকের নেট পরিবর্তন' : "Today's Net Change"}</span>
            {summary.todayMovement >= 0 ? (
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
            )}
          </div>
          <p className={`text-lg sm:text-xl font-black tabular-nums ${
            summary.todayMovement >= 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {summary.todayMovement > 0 ? '+' : ''}{formatBDT(summary.todayMovement || 0, lang)}
          </p>
          <span className="text-xs text-slate-300 font-medium">
            {isBn ? 'আজকের নিট ক্যাশ ফ্লো' : 'Net inflow vs outflow'}
          </span>
        </div>

        {/* Card 3: Next 1-7 Days Movement */}
        <div className="bg-slate-800/60 hover:bg-slate-800/90 transition-all p-4 rounded-xl border border-slate-700/60 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
            <span>{isBn ? 'আগামী ১-৭ দিনের নেট' : 'Next 1-7 Days Net'}</span>
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className={`text-lg sm:text-xl font-black tabular-nums ${
            summary.next7DaysMovement >= 0 ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {summary.next7DaysMovement > 0 ? '+' : ''}{formatBDT(summary.next7DaysMovement || 0, lang)}
          </p>
          <span className="text-xs text-slate-300 font-medium">
            {isBn ? 'আসন্ন সপ্তাহের পূর্বাভাষ' : 'Weekly runway balance'}
          </span>
        </div>

        {/* Card 4: Horizon Projected Ending Cash */}
        <div className="bg-slate-800/60 hover:bg-slate-800/90 transition-all p-4 rounded-xl border border-slate-700/60 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
            <span>{isBn ? `${horizon} দিন পরের প্রত্যাশিত ক্যাশ` : `Projected Day ${horizon} Cash`}</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <p className="text-lg sm:text-xl font-black text-cyan-300 tabular-nums">
            {formatBDT(summary.projectedEndBalance || 0, lang)}
          </p>
          <span className="text-xs text-cyan-400/80 font-medium">
            {isBn ? 'প্রজেক্টেড ক্লোজিং ব্যালেন্স' : 'Forecasted terminal cash'}
          </span>
        </div>
      </div>

      {/* Main View: Chart or Table */}
      {view === 'chart' ? (
        <div className="relative w-full bg-slate-950/60 rounded-xl p-4 border border-slate-800/90">
          {/* Legend */}
          <div className="flex items-center justify-between text-xs text-slate-300 mb-3 px-1">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                <span>{isBn ? 'প্রত্যাশিত ক্যাশ ইন (আয়)' : 'Cash In'}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                <span>{isBn ? 'প্রত্যাশিত ক্যাশ আউট (ব্যয়)' : 'Cash Out'}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
                <span>{isBn ? 'চলতি ক্যাশ কার্ভ' : 'Cash Curve'}</span>
              </span>
            </div>
            <div className="text-[11px] text-slate-500 hidden sm:block">
              {isBn ? 'ডটেড লাইন = আজকের তারিখ (অতীত vs ভবিষ্যৎ)' : 'Dashed Divider = Today'}
            </div>
          </div>

          {/* SVG Canvas */}
          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full min-w-[700px] h-64 overflow-visible">
              {/* Zero Baseline */}
              <line x1="0" y1={zeroY} x2={chartWidth} y2={zeroY} stroke="#334155" strokeWidth="1.5" />

              {/* Day Bars */}
              {forecast.map((d, i) => {
                const totalDays = forecast.length || 1;
                const slotWidth = chartWidth / totalDays;
                const barWidth = Math.max(3, slotWidth * 0.55);
                const x = i * slotWidth + (slotWidth - barWidth) / 2;

                const inY = getYIn(d.cashIn || 0);
                const outY = getYOut(d.cashOut || 0);
                const inHeight = Math.max(1, zeroY - inY);
                const outHeight = Math.max(1, outY - zeroY);

                return (
                  <g
                    key={d.date || i}
                    onMouseEnter={() => setHoveredDay(d)}
                    onMouseLeave={() => setHoveredDay(null)}
                    className="cursor-pointer group"
                  >
                    {/* Hover hotspot background */}
                    <rect
                      x={i * slotWidth}
                      y={0}
                      width={slotWidth}
                      height={chartHeight}
                      fill="transparent"
                      className="hover:fill-slate-700/20 transition-colors"
                    />

                    {/* Cash In Bar (Positive) */}
                    <rect
                      x={x}
                      y={inY}
                      width={barWidth}
                      height={inHeight}
                      fill="#10b981"
                      rx="2"
                      className="transition-all group-hover:brightness-125"
                    />

                    {/* Cash Out Bar (Negative) */}
                    <rect
                      x={x}
                      y={zeroY}
                      width={barWidth}
                      height={outHeight}
                      fill="#f43f5e"
                      rx="2"
                      className="transition-all group-hover:brightness-125"
                    />
                  </g>
                );
              })}

              {/* Running Balance Line */}
              {forecast.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={forecast.map((d, i) => {
                    const totalDays = forecast.length || 1;
                    const slotWidth = chartWidth / totalDays;
                    const x = i * slotWidth + slotWidth / 2;
                    // Scale balance to chart height
                    const normBal = Math.max(0, Math.min(maxVal * 2, d.closingBalance || 0));
                    const y = Math.max(15, Math.min(chartHeight - 15, chartHeight - (normBal / (maxVal * 2 || 1)) * (chartHeight - 30)));
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}

              {/* Dotted Vertical Today Line */}
              {todayIndex >= 0 && (
                <g>
                  <line
                    x1={(todayIndex / forecast.length) * chartWidth + (chartWidth / forecast.length) / 2}
                    y1={10}
                    x2={(todayIndex / forecast.length) * chartWidth + (chartWidth / forecast.length) / 2}
                    y2={chartHeight - 10}
                    stroke="#fbbf24"
                    strokeWidth="2"
                    strokeDasharray="4,4"
                  />
                  <text
                    x={(todayIndex / forecast.length) * chartWidth + (chartWidth / forecast.length) / 2 + 4}
                    y={22}
                    fill="#fbbf24"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    {isBn ? 'আজ' : 'Today'}
                  </text>
                </g>
              )}
            </svg>
          </div>

          {/* Interactive Floating Hover Tooltip */}
          {hoveredDay && (
            <div className="absolute top-4 right-4 bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl text-xs z-20 pointer-events-none backdrop-blur-md min-w-[200px] animate-fadeIn">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2 font-bold text-slate-200">
                <span>{hoveredDay.label}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  hoveredDay.isToday ? 'bg-amber-500/20 text-amber-300' :
                  hoveredDay.isProjected ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-700 text-slate-300'
                }`}>
                  {hoveredDay.isToday ? 'Today' : hoveredDay.isProjected ? 'Projected' : 'Actual'}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>{isBn ? 'শুরুর ক্যাশ:' : 'Opening:'}</span>
                  <span className="font-mono text-slate-200">{formatBDT(hoveredDay.openingBalance || 0, lang)}</span>
                </div>
                <div className="flex justify-between text-emerald-400 font-semibold">
                  <span>{isBn ? 'ক্যাশ ইন (+):' : 'Cash In (+):'}</span>
                  <span className="font-mono">+{formatBDT(hoveredDay.cashIn || 0, lang)}</span>
                </div>
                <div className="flex justify-between text-rose-400 font-semibold">
                  <span>{isBn ? 'ক্যাশ আউট (-):' : 'Cash Out (-):'}</span>
                  <span className="font-mono">-{formatBDT(hoveredDay.cashOut || 0, lang)}</span>
                </div>
                <div className="flex justify-between text-cyan-300 font-bold border-t border-slate-800 pt-1 mt-1">
                  <span>{isBn ? 'সমাপ্তি ক্যাশ:' : 'Closing:'}</span>
                  <span className="font-mono">{formatBDT(hoveredDay.closingBalance || 0, lang)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Table View */
        <div className="overflow-x-auto bg-slate-950/60 rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/80 text-slate-300 uppercase text-xs tracking-wider">
              <tr>
                <th className="p-3">{isBn ? 'তারিখ' : 'Date'}</th>
                <th className="p-3">{isBn ? 'স্ট্যাটাস' : 'Type'}</th>
                <th className="p-3 text-right">{isBn ? 'শুরুর ক্যাশ' : 'Opening'}</th>
                <th className="p-3 text-right text-emerald-400">{isBn ? 'ক্যাশ ইন' : 'Cash In'}</th>
                <th className="p-3 text-right text-rose-400">{isBn ? 'ক্যাশ আউট' : 'Cash Out'}</th>
                <th className="p-3 text-right text-cyan-300">{isBn ? 'সমাপ্তি ক্যাশ' : 'Closing'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {forecast.map((d, idx) => (
                <tr key={idx} className={`hover:bg-slate-800/40 transition-colors ${d.isToday ? 'bg-amber-500/10' : ''}`}>
                  <td className="p-3 font-sans font-medium text-white">{d.label}</td>
                  <td className="p-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-sans font-semibold ${
                      d.isToday ? 'bg-amber-500/20 text-amber-300' :
                      d.isProjected ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {d.isToday ? 'Today' : d.isProjected ? 'Projected' : 'Actual'}
                    </span>
                  </td>
                  <td className="p-3 text-right">{formatBDT(d.openingBalance || 0, lang)}</td>
                  <td className="p-3 text-right text-emerald-400">+{formatBDT(d.cashIn || 0, lang)}</td>
                  <td className="p-3 text-right text-rose-400">-{formatBDT(d.cashOut || 0, lang)}</td>
                  <td className="p-3 text-right font-bold text-cyan-300">{formatBDT(d.closingBalance || 0, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
