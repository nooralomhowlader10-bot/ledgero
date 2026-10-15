import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatBDT, roundBDT } from '../../data/calculations';
import { AlertTriangle, X, Check, Package } from 'lucide-react';

export default function DamageWriteOffModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;

  const inventory = state.dayData?.inventory || [];

  const [selectedItemId, setSelectedItemId] = useState(inventory[0]?.id || '');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('damage');
  const [note, setNote] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const selectedItem = inventory.find(i => i.id === selectedItemId);
  const currentAvailable = selectedItem 
    ? (selectedItem.closingStock ?? ((Number(selectedItem.openingStock) || 0) + (Number(selectedItem.addedStock) || 0)))
    : 0;

  const numQty = Number(quantity) || 0;
  const buyPrice = selectedItem?.buyPrice || 0;
  const estimatedLoss = roundBDT(numQty * buyPrice);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedItem || numQty <= 0) return;
    if (numQty > currentAvailable) {
      alert(lang === 'en' 
        ? `Cannot write-off more than available stock (${currentAvailable})` 
        : `মজুদ স্টকের (${currentAvailable} টি) চেয়ে বেশি রাইট-অফ করা যাবে না`);
      return;
    }

    dispatch({
      type: 'WRITE_OFF_DAMAGE',
      payload: {
        itemId: selectedItem.id,
        quantity: numQty,
        reason,
        note,
      }
    });

    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setQuantity('');
      setNote('');
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-md rounded-2xl shadow-2xl p-6 transition-all border ${
        isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">
                {lang === 'en' ? 'Write-off Damaged / Lost Stock' : 'নষ্ট বা ক্ষয়ক্ষতি পণ্য বাদ দিন'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'en' ? 'IAS 2 Inventory Loss Recognition' : 'স্টক কমবে এবং ক্ষতি হিসেবে হিসাবে জমা হবে'}
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

        {isSuccess ? (
          <div className="py-10 text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
              <Check className="w-8 h-8" />
            </div>
            <p className="font-bold text-lg text-emerald-600">
              {lang === 'en' ? 'Stock Written Off Successfully!' : 'পণ্যটি সফলভাবে বাদ দেওয়া হয়েছে!'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Product Select */}
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Select Product' : 'পণ্য নির্বাচন করুন'}
              </label>
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 focus:ring-2 focus:ring-rose-500 outline-none cursor-pointer"
                required
              >
                {inventory.map(item => {
                  const avail = item.closingStock ?? ((Number(item.openingStock) || 0) + (Number(item.addedStock) || 0));
                  return (
                    <option key={item.id} value={item.id}>
                      {item.name} ({lang === 'en' ? `Stock: ${avail} ${item.unit || 'pcs'} • Buy: ৳${item.buyPrice}` : `মজুদ: ${avail} ${item.unit || 'পিস'} • ক্রয়: ৳${item.buyPrice}`})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Quantity */}
            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-slate-600 dark:text-slate-300">
                  {lang === 'en' ? 'Damaged / Lost Quantity' : 'নষ্ট বা ঘাটতি পণ্যের সংখ্যা'}
                </span>
                <span className="text-emerald-600 font-semibold">
                  {lang === 'en' ? 'Available:' : 'বর্তমান মজুদ:'} {currentAvailable} {selectedItem?.unit || 'পিস'}
                </span>
              </div>
              <input
                type="number"
                min="1"
                max={currentAvailable}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-base font-bold bg-white dark:bg-slate-800 focus:ring-2 focus:ring-rose-500 outline-none"
                required
              />
            </div>

            {/* Reason Select */}
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Reason for Write-off' : 'বাদ দেওয়ার কারণ'}
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 focus:ring-2 focus:ring-rose-500 outline-none cursor-pointer"
              >
                <option value="damage">{lang === 'en' ? 'Broken / Damaged' : 'ভাঙা বা নষ্ট পণ্য'}</option>
                <option value="expired">{lang === 'en' ? 'Expired' : 'মেয়াদোত্তীর্ণ (ডেট ওভার)'}</option>
                <option value="theft_loss">{lang === 'en' ? 'Theft or Lost' : 'চুরি বা হারিয়ে গেছে'}</option>
                <option value="other">{lang === 'en' ? 'Other Reason' : 'অন্যান্য কারণ'}</option>
              </select>
            </div>

            {/* Note */}
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                {lang === 'en' ? 'Remarks / Note (Optional)' : 'মন্তব্য / বিস্তারিত বিবরণ (ঐচ্ছিক)'}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={lang === 'en' ? 'e.g. Broken in transport' : 'যেমন: পরিবহনে ভেঙে গেছে'}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 focus:ring-2 focus:ring-rose-500 outline-none"
              />
            </div>

            {/* Calculated Loss Summary Box */}
            <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-xl flex items-center justify-between text-xs">
              <span className="font-semibold text-rose-800 dark:text-rose-300">
                {lang === 'en' ? 'Total Financial Loss:' : 'মোট আর্থিক ক্ষতির পরিমাণ:'}
              </span>
              <span className="text-base font-black text-rose-700 dark:text-rose-400">
                {formatBDT(estimatedLoss, lang)}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : 'বাতিল'}
              </button>
              <button
                type="submit"
                disabled={numQty <= 0 || numQty > currentAvailable}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <AlertTriangle className="w-4 h-4" />
                {lang === 'en' ? 'Confirm Write-off' : 'পণ্যটি বাদ দিন'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
