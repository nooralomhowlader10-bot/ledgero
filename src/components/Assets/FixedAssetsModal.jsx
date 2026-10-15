import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatBDT, roundBDT } from '../../data/calculations';
import { Building2, Plus, Trash2, Calculator, X, Check, ArrowDown, Sparkles } from 'lucide-react';
import dayjs from 'dayjs';

export default function FixedAssetsModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;

  const fixedAssets = state.fixedAssets || [];
  const wallets = state.dayData?.wallets || {};
  const walletKeys = Object.keys(wallets);

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [salvageValue, setSalvageValue] = useState('0');
  const [usefulLifeYears, setUsefulLifeYears] = useState('3');
  const [purchaseDate, setPurchaseDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [wallet, setWallet] = useState('hand_cash');
  const [note, setNote] = useState('');
  const [depSuccessMsg, setDepSuccessMsg] = useState('');

  if (!isOpen) return null;

  // Totals
  const totalCost = roundBDT(fixedAssets.reduce((sum, a) => sum + (Number(a.cost) || 0), 0));
  const totalAccumDep = roundBDT(fixedAssets.reduce((sum, a) => sum + (Number(a.accumulatedDepreciation) || 0), 0));
  const totalNetBookValue = roundBDT(fixedAssets.reduce((sum, a) => sum + (Number(a.currentValue ?? a.cost) || 0), 0));

  const handleAddAsset = (e) => {
    e.preventDefault();
    if (!name || Number(cost) <= 0) return;

    dispatch({
      type: 'ADD_FIXED_ASSET',
      payload: {
        name,
        cost: Number(cost),
        salvageValue: Number(salvageValue) || 0,
        usefulLifeYears: Number(usefulLifeYears) || 3,
        purchaseDate,
        wallet,
        note,
      }
    });

    setName('');
    setCost('');
    setSalvageValue('0');
    setUsefulLifeYears('3');
    setNote('');
    setShowAddForm(false);
  };

  const handleRunDepreciation = () => {
    dispatch({ type: 'RUN_DEPRECIATION' });
    setDepSuccessMsg(lang === 'en' ? 'Monthly depreciation applied successfully!' : 'মাসিক অবচয় সফলভাবে হিসাবভুক্ত হয়েছে!');
    setTimeout(() => setDepSuccessMsg(''), 3000);
  };

  const handleDeleteAsset = (id) => {
    if (window.confirm(lang === 'en' ? 'Delete this fixed asset?' : 'এই স্থায়ী সম্পদটি মুছে ফেলতে চান?')) {
      dispatch({ type: 'DELETE_FIXED_ASSET', payload: id });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl transition-all border ${
        isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">
                {lang === 'en' ? 'Fixed Assets & Depreciation Register (IAS 16)' : 'স্থায়ী সম্পদ ও অবচয় রেজিস্টার (IAS 16)'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'en' ? 'Equipment, furniture, and straight-line depreciation' : 'যন্ত্রপাতি, আসবাবপত্র ও সরলরৈখিক অবচয় হিসাব'}
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
            <div className="p-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-800">
              <span className="text-xs text-purple-600 dark:text-purple-400 block">{lang === 'en' ? 'Original Cost' : 'মূল ক্রয়মূল্য'}</span>
              <span className="text-base font-black font-mono text-purple-700 dark:text-purple-300">{formatBDT(totalCost, lang)}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-800">
              <span className="text-xs text-amber-600 dark:text-amber-400 block">{lang === 'en' ? 'Accumulated Dep.' : 'পুঞ্জীভূত অবচয়'}</span>
              <span className="text-base font-black font-mono text-amber-700 dark:text-amber-300">{formatBDT(totalAccumDep, lang)}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-800">
              <span className="text-xs text-emerald-600 dark:text-emerald-400 block">{lang === 'en' ? 'Net Book Value' : 'বর্তমান মূল্য (NBV)'}</span>
              <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-300">{formatBDT(totalNetBookValue, lang)}</span>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {showAddForm ? (lang === 'en' ? 'Cancel' : 'বাতিল') : (lang === 'en' ? '+ Add Asset' : '+ নতুন সম্পদ যোগ')}
            </button>

            <button
              onClick={handleRunDepreciation}
              disabled={fixedAssets.length === 0}
              className="px-3.5 py-2 text-xs font-bold rounded-xl bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              <Calculator className="w-4 h-4" />
              {lang === 'en' ? 'Calculate Monthly Depreciation' : 'মাসিক অবচয় হিসাব করুন'}
            </button>
          </div>

          {depSuccessMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 animate-fadeIn">
              <Check className="w-4 h-4" />
              {depSuccessMsg}
            </div>
          )}

          {/* Add Asset Form */}
          {showAddForm && (
            <form onSubmit={handleAddAsset} className="p-4 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 space-y-3">
              <h4 className="text-xs font-bold text-purple-700 dark:text-purple-300">
                {lang === 'en' ? 'Register New Fixed Asset' : 'নতুন স্থায়ী সম্পদ অন্তর্ভুক্তি'}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {lang === 'en' ? 'Asset Name / Equipment' : 'সম্পদ বা যন্ত্রপাতির নাম'} *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={lang === 'en' ? "e.g. Photocopy Machine / Computer" : "যেমন: ফটোকপি মেশিন / কম্পিউটার"}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {lang === 'en' ? 'Purchase Cost (৳) *' : 'ক্রয়মূল্য (৳) *'}
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="50000"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-bold font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {lang === 'en' ? 'Salvage Value (৳)' : 'ভগ্নাবশেষ মূল্য (৳)'}
                  </label>
                  <input
                    type="number"
                    value={salvageValue}
                    onChange={(e) => setSalvageValue(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {lang === 'en' ? 'Useful Life (Years)' : 'ব্যবহারকাল (বছর)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={usefulLifeYears}
                    onChange={(e) => setUsefulLifeYears(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {lang === 'en' ? 'Purchase Date' : 'ক্রয়ের তারিখ'}
                  </label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {lang === 'en' ? 'Payment Source' : 'টাকা প্রদানের মাধ্যম'}
                  </label>
                  <select
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  >
                    {walletKeys.map(k => (
                      <option key={k} value={k}>{wallets[k]?.label || k}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {lang === 'en' ? 'Confirm Asset Registration' : 'সম্পদ নিবন্ধন নিশ্চিত করুন'}
              </button>
            </form>
          )}

          {/* Assets Table */}
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              {lang === 'en' ? 'Registered Assets' : 'নিবন্ধিত স্থায়ী সম্পদসমূহ'} ({fixedAssets.length})
            </h4>

            {fixedAssets.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">
                {lang === 'en' ? 'No fixed assets registered yet. Click "+ Add Asset" above.' : 'কোনো স্থায়ী সম্পদ নেই। উপরে "+ নতুন সম্পদ যোগ" ক্লিক করুন।'}
              </p>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                      <th className="p-3">{lang === 'en' ? 'Asset Name' : 'নাম'}</th>
                      <th className="p-3 text-right">{lang === 'en' ? 'Cost' : 'ক্রয়মূল্য'}</th>
                      <th className="p-3 text-right">{lang === 'en' ? 'Life' : 'মেয়াদ'}</th>
                      <th className="p-3 text-right">{lang === 'en' ? 'Monthly Dep.' : 'মাসিক অবচয়'}</th>
                      <th className="p-3 text-right">{lang === 'en' ? 'Accum. Dep.' : 'পুঞ্জীভূত'}</th>
                      <th className="p-3 text-right">{lang === 'en' ? 'Net Value' : 'বর্তমান মূল্য'}</th>
                      <th className="p-3 text-center">{lang === 'en' ? 'Action' : ''}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {fixedAssets.map(asset => {
                      const monthlyDep = roundBDT((asset.cost - (asset.salvageValue || 0)) / (asset.usefulLifeYears * 12));
                      return (
                        <tr key={asset.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                            {asset.name}
                            <span className="block text-xs text-slate-400 font-normal">
                              {asset.purchaseDate}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono text-slate-900 dark:text-white">
                            {formatBDT(asset.cost, lang)}
                          </td>
                          <td className="p-3 text-right text-slate-600 dark:text-slate-400">
                            {asset.usefulLifeYears} {lang === 'en' ? 'yrs' : 'বছর'}
                          </td>
                          <td className="p-3 text-right font-mono text-amber-600 dark:text-amber-400">
                            {formatBDT(monthlyDep, lang)}
                          </td>
                          <td className="p-3 text-right font-mono text-slate-500">
                            {formatBDT(asset.accumulatedDepreciation || 0, lang)}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatBDT(asset.currentValue ?? asset.cost, lang)}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleDeleteAsset(asset.id)}
                              className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                              title={lang === 'en' ? 'Delete Asset' : 'মুছে ফেলুন'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer"
          >
            {lang === 'en' ? 'Done' : 'সম্পন্ন'}
          </button>
        </div>
      </div>
    </div>
  );
}
