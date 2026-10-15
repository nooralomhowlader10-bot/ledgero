import React, { useState, useEffect } from 'react';
import Modal from '../Shared/Modal';
import InvoiceModal from './InvoiceModal';
import { useAppMode } from '../Shared/ModeGuard';
import { useApp } from '../../context/AppContext';
import { t } from '../../data/translations';
import { formatBDT, formatBDTWithPrivacy } from '../../data/calculations';
import { 
  Phone, MessageSquare, ArrowDownLeft, ArrowUpRight, 
  Trash2, Printer, CheckCircle2, History, AlertCircle, User,
  Edit3, Save, X, FileText
} from 'lucide-react';

export default function ContactLedgerModal({ isOpen, onClose, contact }) {
  const { state, dispatch, loadContactTxsAsync } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const { activeBiz, activeBizId, isPrivacyMode, language } = state;
  const lang = language || 'bn';

  const activeContact = (state.contacts || []).find(c => c.id === contact?.id) || contact;

  const [txType, setTxType] = useState('customer_paid');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [historyTxs, setHistoryTxs] = useState([]);

  // Profile Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editType, setEditType] = useState('customer');
  const [editNote, setEditNote] = useState('');
  const [editInterestRate, setEditInterestRate] = useState('');
  const [editError, setEditError] = useState('');
  const [showInvoice, setShowInvoice] = useState(false);

  const isCustomer = activeContact?.type === 'customer';

  useEffect(() => {
    if (activeContact && isOpen) {
      setTxType(activeContact.type === 'customer' ? 'customer_paid' : 'supplier_paid');
      setAmount('');
      setNote('');
      setError('');
      setIsEditing(false);
      loadContactTxsAsync(activeContact.id).then(txs => setHistoryTxs(txs));
    }
  }, [activeContact?.id, isOpen, activeBizId]);

  if (!activeContact) return null;

  const startEditing = (initialPhone = null) => {
    setEditName(activeContact.name || '');
    setEditPhone(initialPhone !== null ? initialPhone : (activeContact.phone || ''));
    setEditType(activeContact.type || 'customer');
    setEditNote(activeContact.note || '');
    setEditInterestRate(String(activeContact.interestRate || ''));
    setEditError('');
    setIsEditing(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    setEditError('');
    if (!editName.trim()) {
      setEditError(lang === 'en' ? 'Customer or supplier name is required' : 'কাস্টমার বা সাপ্লায়ারের নাম অবশ্যই দিতে হবে');
      return;
    }

    dispatch({
      type: 'UPDATE_CONTACT',
      payload: {
        id: activeContact.id,
        name: editName.trim(),
        phone: editPhone.trim(),
        type: editType,
        note: editNote.trim(),
        interestRate: parseFloat(editInterestRate) || 0
      }
    });
    setIsEditing(false);
  };

  const handleTxSubmit = (e) => {
    e.preventDefault();
    setError('');

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError(lang === 'en' ? 'Please enter a valid amount (1 or more)' : 'সঠিক টাকার পরিমাণ দিন (১ বা তার বেশি)');
      return;
    }

    dispatch({
      type: 'RECORD_CONTACT_TX',
      payload: {
        contactId: activeContact.id,
        txType,
        amount: numAmount,
        note: note.trim()
      }
    });

    // Refresh history
    setTimeout(() => {
      loadContactTxsAsync(activeContact.id).then(updated => setHistoryTxs(updated));
    }, 200);

    setAmount('');
    setNote('');
  };

  const handleDelete = () => {
    if (window.confirm(lang === 'en' ? `Are you sure you want to delete contact and ledger for "${activeContact.name}"?` : `আপনি কি নিশ্চিত "${activeContact.name}" এর কন্টাক্ট এবং খতিয়ান ডিলিট করতে চান?`)) {
      dispatch({ type: 'DELETE_CONTACT', payload: activeContact.id });
      onClose();
    }
  };

  // WhatsApp Reminder message
  const getWhatsAppLink = () => {
    const cleanPhone = (activeContact.phone || '').replace(/\D/g, '');
    const intlPhone = cleanPhone.startsWith('0') ? `88${cleanPhone}` : cleanPhone;
    const msg = lang === 'en' 
      ? `Hello ${activeContact.name}, you are requested to pay your current due of ${formatBDT(activeContact.currentBalance, lang)} from ${activeBiz?.name || 'our shop'}. Thank you.` 
      : `আসসালামু আলাইকুম ${activeContact.name}, ${activeBiz?.name || 'আমাদের দোকান'} থেকে আপনার বর্তমান বকেয়া ${formatBDT(activeContact.currentBalance, lang)} টাকা পরিশোধ করার জন্য অনুরোধ করা হচ্ছে। ধন্যবাদ।`;
    return `https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`;
  };

  const initials = activeContact.name
    ? activeContact.name.trim().split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase()
    : '??';

  const currencySymbol = lang === 'en' ? 'Tk' : '৳';

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title={lang === 'en' ? 'Ledger & Transaction Entry' : 'খতিয়ান ও লেনদেন এন্ট্রি'}>
      <div className="space-y-4 max-h-[82vh] overflow-y-auto pr-1">
        
        {/* Contact Header Card */}
        <div className="p-4 bg-slate-900 text-white rounded-2xl flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-base font-black shadow-sm ${
              isCustomer ? 'bg-sky-500 text-white' : 'bg-emerald-500 text-white'
            }`}>
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">{activeContact.name}</h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  isCustomer ? 'bg-sky-500/20 text-sky-400 border border-sky-400/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                }`}>
                  {isCustomer ? (lang === 'en' ? 'Customer' : 'কাস্টমার') : (lang === 'en' ? 'Supplier' : 'মহাজন / সাপ্লায়ার')}
                </span>
                {isAdvanced && (activeContact.interestRate || 0) > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-400/30">
                    💰 {activeContact.interestRate}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {activeContact.phone ? (
                  <p className="text-xs text-slate-300 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" /> {activeContact.phone}
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-sky-400 font-medium">{lang === 'en' ? 'No phone number' : 'ফোন নম্বর নেই'}</span>
                    <button
                      type="button"
                      onClick={() => startEditing('')}
                      className="text-[11px] bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-300 px-2 py-0.5 rounded-md font-bold transition-colors inline-flex items-center gap-1 border border-emerald-400/40 cursor-pointer"
                      title={lang === 'en' ? 'Add phone number' : 'ফোন নম্বর যুক্ত করুন'}
                    >
                      {lang === 'en' ? '+ Add number' : '+ নম্বর যোগ করুন'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[11px] text-slate-400 font-medium">
              {isCustomer ? (lang === 'en' ? 'Total Due (Receive)' : 'মোট বাকি (পাবো)') : (lang === 'en' ? 'Total Debt (Pay)' : 'মোট দেনা (দেবো)')}
            </p>
            <p className={`text-2xl font-black ${
              activeContact.currentBalance > 0 
                ? (isCustomer ? 'text-sky-400' : 'text-sky-400') 
                : 'text-emerald-400'
            }`}>
              {formatBDTWithPrivacy(activeContact.currentBalance, isPrivacyMode, lang)}
            </p>
          </div>
        </div>

        {/* Quick Communication Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeContact.phone ? (
            <>
              <a
                href={`tel:${activeContact.phone}`}
                className="flex-1 py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Phone className="w-3.5 h-3.5" /> {lang === 'en' ? 'Call' : 'কল দিন'}
              </a>
              <a
                href={getWhatsAppLink()}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" /> {lang === 'en' ? 'WhatsApp Reminder' : 'WhatsApp তাগাদা'}
              </a>
            </>
          ) : (
            <button
              type="button"
              onClick={() => startEditing('')}
              className="flex-1 py-2 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Phone className="w-3.5 h-3.5" /> {lang === 'en' ? '+ Add phone number' : '+ ফোন নম্বর যুক্ত করুন'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (isEditing) setIsEditing(false);
              else startEditing();
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
              isEditing ? 'bg-slate-800 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
            title={lang === 'en' ? 'Edit contact profile' : 'কন্টাক্ট প্রোফাইল এডিট করুন'}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isEditing ? (lang === 'en' ? 'Close' : 'বন্ধ') : (lang === 'en' ? 'Edit' : 'এডিট')}</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            title={lang === 'en' ? 'Print ledger' : 'খতিয়ান প্রিন্ট করুন'}
          >
            <Printer className="w-4 h-4" />
          </button>
          {isAdvanced && (
            <button
              type="button"
              onClick={() => setShowInvoice(true)}
              className="p-2 bg-violet-50 hover:bg-violet-100 text-violet-600 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              title={lang === 'en' ? 'Generate Invoice' : 'ইনভয়েস তৈরি'}
            >
              <FileText className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            title={lang === 'en' ? 'Delete contact' : 'কন্টাক্ট মুছুন'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Edit Profile Panel */}
        {isEditing && (
          <form onSubmit={handleSaveEdit} className="p-4 bg-sky-50/80 dark:bg-slate-800/80 border-2 border-sky-300 dark:border-sky-700 rounded-2xl space-y-3 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-sky-900 dark:text-slate-100 flex items-center gap-1.5">
                <Edit3 className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" />
                {lang === 'en' ? 'Edit Customer / Supplier Profile' : 'কাস্টমার / সাপ্লায়ার প্রোফাইল পরিবর্তন করুন'}
              </h4>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 dark:text-slate-200 mb-1">{t('customer_name_label', lang)} *</label>
              <input
                id="contact-edit-name-input"
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={lang === 'en' ? 'Customer or supplier name' : 'কাস্টমার বা মহাজনের নাম'}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 dark:text-slate-200 mb-1">
                  {t('mobile_label', lang)} {editPhone ? '' : (lang === 'en' ? '(Add)' : '(যুক্ত করুন)')}
                </label>
                <input
                  id="contact-edit-phone-input"
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder={lang === 'en' ? 'e.g. 017XXXXXXXX' : 'যেমন: 017XXXXXXXX'}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{lang === 'en' ? 'Adding number enables WhatsApp & SMS reminders.' : 'নম্বর থাকলে WhatsApp ও SMS তাগাদা পাঠানো যাবে।'}</p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 dark:text-slate-200 mb-1">{lang === 'en' ? 'Type' : 'ধরণ'}</label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-white border border-gray-200 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setEditType('customer')}
                    className={`py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      editType === 'customer'
                        ? 'bg-sky-500 text-white shadow-xs'
                        : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:text-slate-100 dark:hover:text-slate-200'
                    }`}
                  >
                    {t('customer_tab', lang) || (lang === 'en' ? 'Customer' : 'কাস্টমার')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditType('supplier')}
                    className={`py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      editType === 'supplier'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900 dark:text-slate-100'
                    }`}
                  >
                    {t('supplier_tab', lang) || (lang === 'en' ? 'Supplier' : 'সাপ্লায়ার')}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 dark:text-slate-200 mb-1">{t('due_description_label', lang) || (lang === 'en' ? 'Address / Note (Optional)' : 'ঠিকানা / নোট (ঐচ্ছিক)')}</label>
              <input
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder={lang === 'en' ? 'Address or details' : 'ঠিকানা বা পরিচয়'}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {isAdvanced && (
              <div>
                <label className="block text-[11px] font-bold text-gray-700 dark:text-slate-200 mb-1">
                  {lang === 'en' ? 'Monthly Interest Rate (%)' : 'মাসিক সুদের হার (%)'}
                  <span className="text-gray-400 font-normal ml-1">— {lang === 'en' ? 'Optional' : 'ঐচ্ছিক'}</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={editInterestRate}
                    onChange={(e) => setEditInterestRate(e.target.value)}
                    placeholder="0"
                    className="w-24 px-3 py-2 bg-white border border-gray-300 rounded-xl text-sm font-bold text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="text-sm font-bold text-gray-500">%</span>
                  {[2, 3, 5, 10].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setEditInterestRate(String(rate))}
                      className={`px-2 py-1 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                        editInterestRate === String(rate)
                          ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-400'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                      }`}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {editError && (
              <p className="text-xs text-rose-500 font-bold">{editError}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                className="flex-1 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" /> {t('confirm_add', lang) || (lang === 'en' ? 'Save Info' : 'তথ্য সংরক্ষণ করুন')}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                {t('cancel_btn', lang)}
              </button>
            </div>
          </form>
        )}

        {/* High Due Risk Alert Banner */}
        {isCustomer && (contact.currentBalance >= 3000 || (txType === 'customer_due_given' && (contact.currentBalance + (parseFloat(amount) || 0)) >= 3000)) && (
          <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-xl flex items-start gap-2.5 text-xs text-rose-900 shadow-2xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-black text-rose-900">{lang === 'en' ? '⚠️ High Credit Risk Alert:' : '⚠️ উচ্চ বাকি ঝুঁকি সতর্কতা (High Credit Risk):'}</span> {lang === 'en' ? `This customer's total due is ${formatBDT(contact.currentBalance, lang)} (exceeded safe limit ৳3,000). Please remind them to pay to avoid shop cash shortage.` : `এই কাস্টমারের মোট বাকি ${formatBDT(contact.currentBalance, lang)} (নিরাপদ সীমা ৳৩,০০০ অতিক্রম করেছে)। দোকানে ক্যাশ ঘাটতি ঠেকাতে নতুন বাকি দেওয়ার পূর্বে বকেয়া আদায়ের তাগাদা দিন।`}
            </div>
          </div>
        )}

        {/* Interest Accrued Card */}
        {isAdvanced && (activeContact.interestRate || 0) > 0 && activeContact.currentBalance > 0 && (
          <div className="p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                  💰 {lang === 'en' ? 'Interest Calculation' : 'সুদ হিসাব'}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  {lang === 'en' 
                    ? `Rate: ${activeContact.interestRate}% / month on ${formatBDT(activeContact.currentBalance, lang)}`
                    : `হার: ${activeContact.interestRate}% / মাস, ${formatBDT(activeContact.currentBalance, lang)} এর উপর`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-amber-700 dark:text-amber-300">
                  {formatBDT(Math.round(activeContact.currentBalance * activeContact.interestRate / 100), lang)}
                </p>
                <p className="text-xs text-amber-500">{lang === 'en' ? '/month' : '/মাস'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const interestAmount = Math.round(activeContact.currentBalance * activeContact.interestRate / 100);
                if (interestAmount > 0) {
                  dispatch({
                    type: 'RECORD_CONTACT_TX',
                    payload: {
                      contactId: activeContact.id,
                      txType: 'interest_charged',
                      amount: interestAmount,
                      note: lang === 'en' ? `Interest charged — ${activeContact.interestRate}% × ${formatBDT(activeContact.currentBalance, lang)}` : `সুদ ধার্য — ${activeContact.interestRate}% × ${formatBDT(activeContact.currentBalance, lang)}`
                    }
                  });
                  setTimeout(() => {
                    loadContactTxsAsync(activeContact.id).then(updated => setHistoryTxs(updated));
                  }, 200);
                }
              }}
              className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              💰 {lang === 'en' 
                ? `Charge Interest ${formatBDT(Math.round(activeContact.currentBalance * activeContact.interestRate / 100), lang)}` 
                : `সুদ ধার্য করুন ${formatBDT(Math.round(activeContact.currentBalance * activeContact.interestRate / 100), lang)}`}
            </button>
            <p className="text-[9px] text-amber-500/80 dark:text-amber-400/60 text-center">
              {isCustomer
                ? (lang === 'en' ? 'Interest will be added to their due balance' : 'সুদ তাদের বাকি ব্যালেন্সে যোগ হবে')
                : (lang === 'en' ? 'Interest will be added to your payable balance' : 'সুদ আপনার দেনায় যোগ হবে')}
            </p>
          </div>
        )}

        {/* Transaction Entry Form */}
        <form onSubmit={handleTxSubmit} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3.5">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-200">{lang === 'en' ? 'Record new transaction:' : 'নতুন লেনদেন রেকর্ড করুন:'}</p>

          {/* Action Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-white border border-gray-200 rounded-xl">
            {isCustomer ? (
              <>
                <button
                  type="button"
                  onClick={() => setTxType('customer_paid')}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    txType === 'customer_paid'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 dark:text-slate-100'
                  }`}
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" /> {lang === 'en' ? 'Received (Cash In)' : 'টাকা পেলাম (জমা)'}
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('customer_due_given')}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    txType === 'customer_due_given'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 dark:text-slate-100'
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5" /> {lang === 'en' ? 'Gave Due' : 'বাকি দিলাম'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setTxType('supplier_paid')}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    txType === 'supplier_paid'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 dark:text-slate-100'
                  }`}
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" /> {lang === 'en' ? 'Paid Debt (Cash Out)' : 'দেনা শোধ (টাকা দিলাম)'}
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('supplier_due_taken')}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    txType === 'supplier_due_taken'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 dark:text-slate-100'
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5" /> {lang === 'en' ? 'Bought on Due' : 'বাকিতে মাল ক্রয়'}
                </button>
              </>
            )}
          </div>

          {/* Amount Input */}
          <div>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 font-bold">{currencySymbol}</span>
              <input
                type="number"
                step="any"
                min="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={lang === 'en' ? 'Enter amount' : 'টাকার পরিমাণ লিখুন'}
                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-xl text-sm font-bold text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>

            {/* Quick Chips */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-xs text-gray-400 font-medium">{lang === 'en' ? 'Quick:' : 'কুইক:'}</span>
              {[100, 200, 500, 1000, 2000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmount(String(amt))}
                  className="px-2 py-0.5 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 dark:text-slate-200 text-xs font-semibold rounded-md transition-colors"
                >
                  {currencySymbol}{amt}
                </button>
              ))}
            </div>
          </div>

          {/* Note Input */}
          <div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={lang === 'en' ? 'Details / Product description (Optional)' : 'বিবরণ / পণ্যের বিবরণ (ঐচ্ছিক)'}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs text-gray-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
          </div>

          {/* Info note */}
          <div className="p-2 bg-blue-50/80 border border-blue-200/80 rounded-lg text-[11px] text-blue-800">
            {txType === 'customer_paid' && (lang === 'en' ? '💡 Customer payment will automatically add to today\'s Cash Drawer.' : '💡 কাস্টমার টাকা পরিশোধ করলে তা স্বয়ংক্রিয়ভাবে আজকের ক্যাশ ড্রয়ারে (Hand Cash) যোগ হবে।')}
            {txType === 'customer_due_given' && (lang === 'en' ? '💡 New due will increase customer balance and add to today\'s Due Ledger.' : '💡 নতুন বাকি দিলে কাস্টমারের বকেয়া বাড়বে এবং আজকের বাকি খতিয়ানে যুক্ত হবে।')}
            {txType === 'supplier_paid' && (lang === 'en' ? '💡 Supplier payment will deduct cash from Drawer and reduce your debt.' : '💡 সাপ্লায়ারকে টাকা পরিশোধ করলে ক্যাশ ড্রয়ার থেকে টাকা কমবে এবং দেনা পরিশোধ হবে।')}
            {txType === 'supplier_due_taken' && (lang === 'en' ? '💡 Buying on due will add to your debt ledger.' : '💡 বাকিতে মাল কিনলে দেনার খাতায় যোগ হবে।')}
          </div>

          {error && (
            <p className="text-xs text-rose-500 font-bold">{error}</p>
          )}

          <button
            type="submit"
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" /> {lang === 'en' ? 'Complete Entry' : 'এন্ট্রি সম্পন্ন করুন'}
          </button>
        </form>

        {/* Transaction History Statement */}
        <div>
          <h4 className="text-xs font-bold text-gray-700 dark:text-slate-200 mb-2 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />
            {lang === 'en' ? 'Statement History:' : 'পূর্বের লেনদেন বিবরণী (Statement History):'}
          </h4>

          {historyTxs.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              {lang === 'en' ? 'No transactions recorded yet.' : 'এখনো কোনো লেনদেন রেকর্ড করা হয়নি।'}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {historyTxs.map((tx) => (
                <div key={tx.id} className="p-3 bg-white flex items-center justify-between text-xs hover:bg-slate-50 transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        ['customer_paid', 'supplier_paid'].includes(tx.type)
                          ? 'bg-emerald-100 text-emerald-800'
                          : tx.type === 'opening_balance'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {tx.type === 'customer_paid' ? (lang === 'en' ? 'Collected' : 'টাকা আদায়') :
                         tx.type === 'customer_due_given' ? (lang === 'en' ? 'Due Given' : 'বাকি দেওয়া') :
                         tx.type === 'supplier_paid' ? (lang === 'en' ? 'Debt Paid' : 'দেনা পরিশোধ') :
                         tx.type === 'supplier_due_taken' ? (lang === 'en' ? 'Bought Due' : 'বাকিতে ক্রয়') : (lang === 'en' ? 'Previous Bal' : 'পূর্বের জের')}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {tx.date || new Date(tx.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 mt-1 font-medium">{tx.note || '-'}</p>
                  </div>

                  <div className="text-right">
                    <p className={`font-black text-sm ${
                      ['customer_paid', 'supplier_paid'].includes(tx.type) ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {['customer_paid', 'supplier_paid'].includes(tx.type) ? '-' : '+'}
                      {formatBDTWithPrivacy(tx.amount, isPrivacyMode, lang)}
                    </p>
                    {tx.balanceAfter !== undefined && (
                      <p className="text-xs text-gray-400">
                        {lang === 'en' ? 'Balance:' : 'জের:'} {formatBDTWithPrivacy(tx.balanceAfter, isPrivacyMode, lang)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </Modal>

    {isAdvanced && (
      <InvoiceModal 
        isOpen={showInvoice} 
        onClose={() => setShowInvoice(false)} 
        contact={activeContact} 
      />
    )}
    </>
  );
}
