import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { BIZ_CATEGORIES } from '../../data/constants';
import { Check, X, Store, Sparkles } from 'lucide-react';

export default function BusinessCategoryModal({
  isOpen,
  onClose,
  selectedCategory,
  onSelectCategory,
  initialCustomType = ''
}) {
  const { state } = useApp();
  const lang = state?.language || 'bn';

  const [currentSelected, setCurrentSelected] = useState(selectedCategory || BIZ_CATEGORIES[0].name);
  const [customType, setCustomType] = useState(initialCustomType);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCurrentSelected(selectedCategory || BIZ_CATEGORIES[0].name);
      setCustomType(initialCustomType);
      setError('');
    }
  }, [isOpen, selectedCategory, initialCustomType]);

  if (!isOpen) return null;

  const isOthers = currentSelected === 'অন্যান্য' || currentSelected === 'others';
  const isPersonal = currentSelected === 'ব্যক্তিগত হিসাব রাখি' || currentSelected === 'personal';

  // Categories excluding 'personal' (which is pinned at top) and 'others' (which is pinned at bottom)
  const gridCategories = BIZ_CATEGORIES.filter(
    c => c.id !== 'personal' && c.id !== 'others'
  );

  const handleConfirm = () => {
    if (isOthers && !customType.trim()) {
      setError(lang === 'en' 
        ? 'Please enter your business type (e.g. Hotel, Laundry)' 
        : 'অনুগ্রহ করে আপনার ব্যবসার ধরণ লিখে দিন (যেমন: হোটেল, লন্ড্রি)');
      return;
    }

    const finalCategory = isOthers ? 'অন্যান্য' : currentSelected;
    onSelectCategory(finalCategory, isOthers ? customType.trim() : '');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-gray-100">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-500/20 text-indigo-400 border border-indigo-400/30 rounded-lg">
              <Store className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-base font-bold tracking-tight">
                {lang === 'en' ? 'What is your business type?' : 'আপনার ব্যবসার ধরণ কি?'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {lang === 'en' 
                  ? 'Selecting the right category configures your accounting tools' 
                  : 'সঠিক ধরণ নির্বাচন করলে ব্যবসার যাবতীয় হিসাব সাজানো সহজ হবে'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          
          {/* Top Option: ব্যক্তিগত হিসাব রাখি (Personal Accounts) */}
          <div
            onClick={() => {
              setCurrentSelected('ব্যক্তিগত হিসাব রাখি');
              setError('');
            }}
            className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-between ${
              isPersonal
                ? 'border-indigo-500 bg-indigo-50/50 shadow-sm ring-1 ring-indigo-400'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-lg">
                👤
              </div>
              <div>
                <p className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                  {lang === 'en' ? 'Personal Accounts' : 'ব্যক্তিগত হিসাব রাখি'}
                  <span className="text-xs bg-purple-100 text-purple-800 font-bold px-1.5 py-0.5 rounded">
                    Personal
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  {lang === 'en' 
                    ? 'Track personal daily income, expense, and debts without a shop' 
                    : 'দোকান ছাড়া নিজের দৈনন্দিন আয়-ব্যয় ও দেনা-পাওনার হিসাব'}
                </p>
              </div>
            </div>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              isPersonal ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'
            }`}>
              {isPersonal && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-gray-200"></span>
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              {lang === 'en' ? 'BUSINESS CATEGORIES' : 'ব্যবসা প্রতিষ্ঠান সমূহ'}
            </span>
            <span className="h-px flex-1 bg-gray-200"></span>
          </div>

          {/* 2-Column Category Grid matching Photo 5 */}
          <div className="grid grid-cols-2 gap-2.5">
            {gridCategories.map((cat) => {
              const isSelected = currentSelected === cat.name;
              return (
                <div
                  key={cat.id}
                  onClick={() => {
                    setCurrentSelected(cat.name);
                    setError('');
                  }}
                  className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-between gap-2 select-none ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/60 shadow-xs ring-1 ring-indigo-400'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/80 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl shrink-0 p-1 bg-slate-100 rounded-lg">{cat.icon}</span>
                    <span className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-700' : 'text-gray-800'}`}>
                      {lang === 'en' ? (cat.name_en || cat.name) : cat.name}
                    </span>
                  </div>
                  <div className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                    isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'
                  }`}>
                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                </div>
              );
            })}

            {/* অন্যান্য Tile */}
            <div
              onClick={() => {
                setCurrentSelected('অন্যান্য');
                setError('');
              }}
              className={`col-span-2 p-3 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-between gap-2 select-none ${
                isOthers
                  ? 'border-indigo-500 bg-indigo-50/60 shadow-xs ring-1 ring-indigo-400'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/80 bg-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-xl p-1 bg-slate-100 rounded-lg">🏪</span>
                <div>
                  <span className={`text-xs font-bold ${isOthers ? 'text-indigo-700' : 'text-gray-800'}`}>
                    {lang === 'en' ? 'Others (Custom Business Type)' : 'অন্যান্য (Custom Business Type)'}
                  </span>
                  <p className="text-[11px] text-gray-500">
                    {lang === 'en' ? 'If not listed, enter your custom business type' : 'তালিকায় না থাকলে নিজের মতো ব্যবসার নাম লিখুন'}
                  </p>
                </div>
              </div>
              <div className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                isOthers ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'
              }`}>
                {isOthers && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
            </div>
          </div>

          {/* Custom Text Field for 'অন্যান্য' */}
          {isOthers && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-1.5 animate-in fade-in duration-200">
              <label className="block text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                {lang === 'en' ? 'Enter your custom business type in detail: *' : 'আপনার ব্যবসার ধরণ বিস্তারিত লিখুন: *'}
              </label>
              <input
                type="text"
                value={customType}
                onChange={(e) => {
                  setCustomType(e.target.value);
                  if (error) setError('');
                }}
                placeholder={lang === 'en' ? 'e.g. Hotel & Restaurant, Laundry, Cafe, Clinic' : 'যেমন: হোটেল ও রেস্টুরেন্ট, লন্ড্রি, ক্যাফে, ক্লিনিক'}
                className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                autoFocus
              />
              <p className="text-xs text-amber-800">
                {lang === 'en'
                  ? '💡 Examples: "Hotel & Restaurant", "Laundry Service", "Photocopy & Cyber Cafe", etc.'
                  : '💡 উদাহরণ: "হোটেল ও রেস্টুরেন্ট", "লন্ড্রি সার্ভিস", "ফটোকপি ও সাইবার ক্যাফে" ইত্যাদি।'}
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-500 font-bold px-1">{error}</p>
          )}

        </div>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
          >
            {lang === 'en' ? 'Cancel' : 'বাতিল'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" /> {lang === 'en' ? 'Confirm' : 'নিশ্চিত করুন'}
          </button>
        </div>

      </div>
    </div>
  );
}
