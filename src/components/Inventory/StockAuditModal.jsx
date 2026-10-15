import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatBDT, roundBDT } from '../../data/calculations';
import { consumeFIFOBatches } from '../../data/fifoEngine';
import { ClipboardCheck, AlertTriangle, CheckCircle, X, Check, ArrowRight } from 'lucide-react';
import dayjs from 'dayjs';

export default function StockAuditModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;

  const inventory = state.dayData?.inventory || [];
  const [counts, setCounts] = useState(() => {
    const initial = {};
    inventory.forEach(item => {
      const currentExpected = item.closingStock ?? Math.max(0, (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0));
      initial[item.id] = currentExpected;
    });
    return initial;
  });

  const [auditDate, setAuditDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const handleCountChange = (itemId, val) => {
    setCounts(prev => ({
      ...prev,
      [itemId]: val === '' ? '' : Math.max(0, Number(val))
    }));
  };

  // Calculate audit results using IAS 2 FIFO batch cost for shortages
  let totalDiscrepancyCount = 0;
  let totalMatchingCount = 0;
  let netLossValue = 0;
  let netSurplusValue = 0;
  const adjustments = [];

  inventory.forEach(item => {
    const systemStock = item.closingStock ?? Math.max(0, (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0));
    const physical = counts[item.id] === '' ? systemStock : Math.max(0, Number(counts[item.id]) || 0);
    const diff = physical - systemStock;
    const buyPrice = Number(item.buyPrice) || 0;
    let value = 0;

    if (diff < 0) {
      const shortageUnits = Math.abs(diff);
      const { totalCost } = consumeFIFOBatches(item.batches || [], shortageUnits, buyPrice);
      value = -roundBDT(totalCost > 0 ? totalCost : shortageUnits * buyPrice);
      totalDiscrepancyCount++;
      netLossValue = roundBDT(netLossValue + Math.abs(value));
    } else if (diff > 0) {
      value = roundBDT(diff * buyPrice);
      totalDiscrepancyCount++;
      netSurplusValue = roundBDT(netSurplusValue + value);
    } else {
      totalMatchingCount++;
    }

    adjustments.push({
      itemId: item.id,
      systemStock,
      physicalCount: physical,
      diff,
      value,
    });
  });

  const handleApplyAudit = () => {
    dispatch({
      type: 'APPLY_STOCK_AUDIT',
      payload: {
        adjustments,
        auditDate,
      }
    });

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl transition-all border ${
        isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">
                {lang === 'en' ? 'Physical Stock Verification & Audit (IAS 2)' : 'শারীরিক স্টক গণনা ও অডিট (IAS 2)'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'en' ? 'Count physical shelf items and reconcile system variance' : 'দোকানের তাকের মালামাল গুনে সিস্টেমের হিসাবের সাথে মেলান'}
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
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-100 dark:border-teal-800 text-center">
              <span className="text-xs text-teal-600 dark:text-teal-400 block">{lang === 'en' ? 'Total Items' : 'মোট পণ্য'}</span>
              <span className="text-base font-black font-mono text-teal-700 dark:text-teal-300">{inventory.length}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-800 text-center">
              <span className="text-xs text-emerald-600 dark:text-emerald-400 block">{lang === 'en' ? 'Matched Items' : 'মিলে যাওয়া পণ্য'}</span>
              <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-300">{totalMatchingCount}</span>
            </div>
            <div className={`p-3.5 rounded-xl border text-center ${
              totalDiscrepancyCount === 0 
                ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600'
                : 'bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-800 text-rose-700 dark:text-rose-300'
            }`}>
              <span className="text-xs block opacity-80">{lang === 'en' ? 'Discrepancy / Loss' : 'ঘাটতি / অমিল ক্ষতি'}</span>
              <span className="text-base font-black font-mono">
                {totalDiscrepancyCount > 0 ? `${formatBDT(netLossValue, lang)} (${totalDiscrepancyCount})` : (lang === 'en' ? 'Tk 0 (0 items)' : '৳ 0 (০ টি)')}
              </span>
            </div>
          </div>

          {/* Audit Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                  <th className="p-3">{lang === 'en' ? 'Product' : 'পণ্য'}</th>
                  <th className="p-3 text-right">{lang === 'en' ? 'System Stock' : 'সিস্টেম স্টক'}</th>
                  <th className="p-3 text-center w-28">{lang === 'en' ? 'Physical Count' : 'গণনাকৃত স্টক'}</th>
                  <th className="p-3 text-right">{lang === 'en' ? 'Variance' : 'পার্থক্য'}</th>
                  <th className="p-3 text-right">{lang === 'en' ? 'Financial Impact' : 'আর্থিক প্রভাব'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {adjustments.map(adj => {
                  const item = inventory.find(i => i.id === adj.itemId);
                  const isShortage = adj.diff < 0;
                  const isSurplus = adj.diff > 0;
                  const isMatch = adj.diff === 0;

                  return (
                    <tr key={adj.itemId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                        {item ? (lang === 'en' ? item.name : item.name_bn || item.name) : adj.itemId}
                        <span className="block text-xs text-slate-400 font-normal">
                          {lang === 'en' ? `Buy: ৳${item?.buyPrice} | Sell: ৳${item?.sellPrice}` : `ক্রয়: ৳${item?.buyPrice} | বিক্রয়: ৳${item?.sellPrice}`}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-slate-700 dark:text-slate-300">
                        {adj.systemStock}
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="number"
                          min="0"
                          value={counts[adj.itemId] ?? ''}
                          onChange={(e) => handleCountChange(adj.itemId, e.target.value)}
                          className="w-20 px-2 py-1 text-xs font-bold font-mono text-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        {isMatch && <span className="text-emerald-600">0 ✓</span>}
                        {isShortage && <span className="text-rose-600">{adj.diff}</span>}
                        {isSurplus && <span className="text-blue-600">+{adj.diff}</span>}
                      </td>
                      <td className="p-3 text-right font-mono font-semibold">
                        {isMatch && <span className="text-slate-400">-</span>}
                        {isShortage && <span className="text-rose-600">−{formatBDT(Math.abs(adj.value), lang)}</span>}
                        {isSurplus && <span className="text-blue-600">+{formatBDT(adj.value, lang)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {totalDiscrepancyCount > 0 
              ? (lang === 'en' ? `${totalDiscrepancyCount} items need adjustment` : `${totalDiscrepancyCount} টি পণ্যে অমিল আছে`)
              : (lang === 'en' ? 'All stock counts match' : 'সব পণ্যের স্টক মিলেছে')}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {lang === 'en' ? 'Cancel' : 'বাতিল'}
            </button>
            <button
              onClick={handleApplyAudit}
              className="px-5 py-2 text-xs font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-md cursor-pointer transition-all flex items-center gap-1.5"
            >
              {isSaved ? '✓ Applied!' : (lang === 'en' ? 'Apply Stock Adjustments' : 'অডিট সমন্বয় অনুমোদন করুন')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
