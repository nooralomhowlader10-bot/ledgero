import React, { useState, useEffect } from 'react';
import Modal from '../Shared/Modal';
import { useAppMode } from '../Shared/ModeGuard';
import { useApp } from '../../context/AppContext';
import { t } from '../../data/translations';
import { UserPlus, AlertTriangle, CheckCircle2, User, Phone, Banknote, FileText } from 'lucide-react';

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export default function AddContactModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const { contacts = [], language } = state;
  const lang = language || 'bn';

  const [type, setType] = useState('customer'); // 'customer' or 'supplier'
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // Check for duplicate phone number in current business contacts (as seen in Photo 4)
  const isDuplicate = phone.trim() !== '' && contacts.some(
    c => c.phone && c.phone.trim().replace(/\D/g, '') === phone.trim().replace(/\D/g, '')
  );

  const existingContact = isDuplicate ? contacts.find(
    c => c.phone && c.phone.trim().replace(/\D/g, '') === phone.trim().replace(/\D/g, '')
  ) : null;

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setPhone('');
      setOpeningBalance('');
      setInterestRate('');
      setNote('');
      setError('');
      setType('customer');
    }
  }, [isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(lang === 'en' ? 'Please enter customer or supplier name.' : 'দয়া করে কাস্টমার বা সাপ্লায়ারের নাম লিখুন।');
      return;
    }

    if (isDuplicate) {
      setError(
        lang === 'en'
          ? `This mobile number is already registered under "${existingContact?.name}"!`
          : `এই মোবাইল নম্বরটি ইতিমধ্যে "${existingContact?.name}"-এর নামে নিবন্ধিত আছে!`
      );
      return;
    }

    const parsedBalance = parseFloat(openingBalance) || 0;

    dispatch({
      type: 'ADD_CONTACT',
      payload: {
        name: name.trim(),
        phone: phone.trim(),
        type,
        openingBalance: parsedBalance,
        interestRate: parseFloat(interestRate) || 0,
        note: note.trim()
      }
    });

    onClose();
  };

  const currencySymbol = lang === 'en' ? 'Tk ' : '৳';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('add_customer_title', lang)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        
        {/* Photo 4 Alert Banner: Duplicate Phone Detection */}
        {isDuplicate && (
          <div className="p-3 bg-rose-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm animate-pulse">
            <AlertTriangle className="w-4 h-4 shrink-0 text-white" />
            <span>
              {lang === 'en'
                ? `Customer/Supplier already exists with this phone (${existingContact?.name})`
                : `এই মোবাইল নম্বরের কাস্টমার/সাপ্লায়ার অ্যাপে রেকর্ড আছে (${existingContact?.name})`}
            </span>
          </div>
        )}

        {/* Segmented Type Toggle (Photo 2 & 3) */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 dark:bg-slate-800 rounded-xl">
          <label className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-bold cursor-pointer transition-all ${
            type === 'customer' 
              ? 'bg-sky-600 text-white shadow-sm' 
              : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'
          }`}>
            <input
              type="radio"
              name="contactType"
              value="customer"
              checked={type === 'customer'}
              onChange={() => setType('customer')}
              className="hidden"
            />
            <span>🔘 {t('customer_tab', lang)}</span>
          </label>

          <label className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-bold cursor-pointer transition-all ${
            type === 'supplier' 
              ? 'bg-emerald-600 text-white shadow-sm' 
              : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'
          }`}>
            <input
              type="radio"
              name="contactType"
              value="supplier"
              checked={type === 'supplier'}
              onChange={() => setType('supplier')}
              className="hidden"
            />
            <span>⚪ {t('supplier_tab', lang)}</span>
          </label>
        </div>

        {/* Name Field */}
        <div>
          <label className="block text-xs font-bold text-gray-700 dark:text-slate-200 mb-1">
            {type === 'customer' 
              ? (lang === 'en' ? 'Customer Name *' : 'কাস্টমারের নাম *')
              : (lang === 'en' ? 'Supplier / Dealer Name *' : 'সাপ্লায়ার / মহাজনের নাম *')}
          </label>
          <div className="relative">
            <User className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'customer' 
                ? (lang === 'en' ? 'e.g. Sakil, John Doe' : 'যেমন: Sakil, রফিক ভাই') 
                : (lang === 'en' ? 'e.g. Acme Traders, Supplier X' : 'যেমন: রতন ডিলার, মেসার্স ট্রেডার্স')}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-slate-900"
              autoFocus
            />
          </div>
        </div>

        {/* Mobile Number Field */}
        <div>
          <label className="block text-xs font-bold text-gray-700 dark:text-slate-200 mb-1">
            {t('mobile_label', lang)}
          </label>
          <div className="relative">
            <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={lang === 'en' ? '017XXXXXXXX or 019XXXXXXXX' : '017XXXXXXXX বা 019XXXXXXXX'}
              className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 bg-white dark:bg-slate-900 ${
                isDuplicate ? 'border-rose-500 focus:ring-rose-500 ring-1 ring-rose-500' : 'border-gray-300 dark:border-slate-700 focus:ring-indigo-400'
              }`}
            />
          </div>
        </div>

        {/* Opening Due (জের / পূর্বের বাকি) (Photo 3) */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs font-bold text-gray-700 dark:text-slate-200">
              {type === 'customer' 
                ? (lang === 'en' ? 'Previous Due / Receivable Amount' : 'পূর্বের বাকি (জের / পাওনা ৳)') 
                : (lang === 'en' ? 'Previous Debt / Payable Amount' : 'পূর্বের দেনা (জের ৳)')}
            </label>
            <span className="text-xs text-gray-400">{lang === 'en' ? 'Optional' : 'ঐচ্ছিক'}</span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-400 font-bold text-xs">{currencySymbol}</span>
            <input
              type="number"
              min="0"
              step="any"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0"
              className="w-full pl-8 pr-4 py-2.5 border border-gray-300 dark:border-slate-700 rounded-xl text-base font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-slate-900"
            />
          </div>

          {/* Quick Amount Chips */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[11px] text-gray-400 font-medium">{lang === 'en' ? 'Quick:' : 'কুইক:'}</span>
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setOpeningBalance(String(amt))}
                className="px-2.5 py-1 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {currencySymbol}{amt}
              </button>
            ))}
          </div>
        </div>

        {/* Monthly Interest Rate Field */}
        {isAdvanced && (
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-slate-200 mb-1">
              {lang === 'en' ? 'Monthly Interest Rate (%)' : 'মাসিক সুদের হার (%)'}
              <span className="text-gray-400 font-normal ml-1">— {lang === 'en' ? 'Optional' : 'ঐচ্ছিক'}</span>
            </label>
            <div className="relative">
              <span className="absolute right-3 top-2.5 text-gray-400 font-bold text-sm">%</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder="0"
                className="w-full pl-4 pr-8 py-2.5 border border-gray-300 dark:border-slate-700 rounded-xl text-base font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-slate-900"
              />
            </div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[11px] text-gray-400 font-medium">{lang === 'en' ? 'Common:' : 'সাধারণ:'}</span>
              {[2, 3, 5, 10].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setInterestRate(String(rate))}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    interestRate === String(rate) 
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 ring-1 ring-indigo-400'
                      : 'bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200'
                  }`}
                >
                  {rate}%
                </button>
              ))}
            </div>
            {interestRate && Number(interestRate) > 0 && openingBalance && Number(openingBalance) > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 font-medium">
                💡 {lang === 'en' 
                  ? `Monthly interest on ${currencySymbol}${openingBalance}: ${currencySymbol}${(Number(openingBalance) * Number(interestRate) / 100).toFixed(0)}`
                  : `মাসিক সুদ ${currencySymbol}${openingBalance} এর উপর: ${currencySymbol}${(Number(openingBalance) * Number(interestRate) / 100).toFixed(0)}`}
              </p>
            )}
          </div>
        )}

        {/* Address / Note */}
        <div>
          <label className="block text-xs font-bold text-gray-700 dark:text-slate-200 mb-1">
            {lang === 'en' ? 'Address or Note' : 'ঠিকানা বা মন্তব্য (Note)'}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={lang === 'en' ? 'e.g. Market road, regular customer' : 'যেমন: বাজার রোড, পুরাতন কাস্টমার'}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl text-xs text-gray-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-slate-900"
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 text-xs font-semibold rounded-xl">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {t('cancel_btn', lang)}
          </button>
          <button
            type="submit"
            disabled={isDuplicate}
            className={`flex-1 py-2.5 text-white rounded-xl text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 ${
              isDuplicate 
                ? 'bg-gray-400 cursor-not-allowed opacity-70' 
                : 'bg-indigo-600 hover:bg-indigo-700 active:scale-98 cursor-pointer'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {t('confirm_add', lang)}
          </button>
        </div>

      </form>
    </Modal>
  );
}
