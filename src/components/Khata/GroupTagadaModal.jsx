import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { t } from '../../data/translations';
import { formatBDTWithPrivacy } from '../../data/calculations';
import { Users, Send, CheckSquare, Square, MessageCircle, Phone, Share2, AlertCircle, Smartphone, Info, X } from 'lucide-react';

export default function GroupTagadaModal({ isOpen, onClose }) {
  const { state } = useApp();
  const { contacts = [], activeBiz, isPrivacyMode, language } = state;
  const lang = language || 'bn';

  // Filter customers who have due > 0
  const dueCustomers = useMemo(() => {
    return (contacts || []).filter(c => c.type === 'customer' && Number(c.currentBalance) > 0);
  }, [contacts]);

  const [selectedIds, setSelectedIds] = useState(() => dueCustomers.map(c => c.id));
  const [customNote, setCustomNote] = useState('');

  // Detect mobile
  const isMobile = useMemo(() => {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (typeof window !== 'undefined' && window.innerWidth < 768);
  }, []);

  if (!isOpen) return null;

  const selectedCustomers = dueCustomers.filter(c => selectedIds.includes(c.id));
  const totalSelectedDue = selectedCustomers.reduce((sum, c) => sum + (Number(c.currentBalance) || 0), 0);
  const isAllSelected = selectedCustomers.length === dueCustomers.length && dueCustomers.length > 0;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(dueCustomers.map(c => c.id));
    }
  };

  const handleToggleCustomer = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Construct standard general bulk SMS message (common for everyone)
  const shopName = activeBiz?.name || (lang === 'en' ? 'Our Shop' : 'আমাদের দোকান');
  const defaultGeneralMessage = lang === 'en'
    ? `Dear Customer, you have an outstanding due balance at ${shopName}. We kindly request you to clear the balance at your earliest convenience. Thank you!`
    : `সম্মানিত গ্রাহক, ${shopName}-এ আপনার কেনাকাটার পূর্বের কিছু বকেয়া রয়েছে। অনুগ্রহ করে সুবিধাজনক সময়ে পরিশোধ করার বিনীত অনুরোধ জানাচ্ছি। ধন্যবাদ!`;
  const generalMessage = customNote.trim() ? customNote.trim() : defaultGeneralMessage;

  // Bulk Mobile SMS trigger
  const handleSendBulkSMS = () => {
    if (!isMobile) {
      alert(lang === 'en' 
        ? 'Group SMS is only available on SIM-enabled mobile devices. Open the app on mobile or use the WhatsApp buttons.' 
        : 'গ্রুপ SMS শুধুমাত্র সিম-যুক্ত মোবাইল ফোনে কাজ করবে। আপনি মোবাইলে অ্যাপটি খুলুন অথবা পাশের WhatsApp বাটন ব্যবহার করুন।');
      return;
    }

    const phoneNumbers = selectedCustomers
      .map(c => (c.phone || '').replace(/[^0-9+]/g, ''))
      .filter(p => p.length >= 10);

    if (phoneNumbers.length === 0) {
      alert(lang === 'en' 
        ? 'Selected customers have no valid mobile numbers!' 
        : 'নির্বাচিত কাস্টমারদের কোনো ভ্যালিড মোবাইল নম্বর নেই!');
      return;
    }

    // Android/iOS SMS delimiter: Android uses comma ',', iOS often supports comma or semicolon
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const separator = isIOS ? ';' : ',';
    const numbersList = phoneNumbers.join(separator);

    const smsUrl = `sms:${numbersList}?body=${encodeURIComponent(generalMessage)}`;
    window.location.href = smsUrl;
  };

  // Personalized message generator for individual customer
  const getPersonalizedMsg = (customer) => {
    const currency = lang === 'en' ? 'Tk ' : '৳';
    return lang === 'en'
      ? `Dear ${customer.name}, you have an outstanding due balance of ${currency}${customer.currentBalance} at ${shopName}. We kindly request you to clear the due payment. Thank you!`
      : `আসসালামু আলাইকুম ${customer.name} ভাই/ম্যাম, ${shopName}-এ আপনার পূর্বের বাকি ৳${customer.currentBalance} টাকা পরিশোধ করার জন্য অনুরোধ করা হচ্ছে। ধন্যবাদ!`;
  };

  // 1-Click WhatsApp
  const handleOpenWhatsApp = (customer) => {
    let cleanPhone = (customer.phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('01')) cleanPhone = '88' + cleanPhone;
    const msg = getPersonalizedMsg(customer);
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // 1-Click Single SMS
  const handleOpenSingleSMS = (customer) => {
    const cleanPhone = (customer.phone || '').replace(/[^0-9+]/g, '');
    const msg = getPersonalizedMsg(customer);
    window.location.href = `sms:${cleanPhone}?body=${encodeURIComponent(msg)}`;
  };

  // Native Share Sheet (Photo 5)
  const handleNativeShare = async (customer) => {
    const msg = getPersonalizedMsg(customer);
    if (navigator.share) {
      try {
        await navigator.share({
          title: lang === 'en' ? `Due Reminder - ${customer.name}` : `বাকি তাগাদা - ${customer.name}`,
          text: msg,
        });
      } catch {
        // User dismissed share dialog
      }
    } else {
      // Fallback: Copy to clipboard
      navigator.clipboard.writeText(msg);
      alert(lang === 'en' 
        ? 'Reminder message copied to clipboard! You can paste it in any app.' 
        : 'তাগাদা মেসেজ ক্লিপবোর্ডে কপি হয়েছে! আপনি যেকোনো অ্যাপে পেস্ট করতে পারেন।');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-sky-600 to-slate-700 text-white p-4 sm:p-5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center border border-white/20 shadow-xs">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">
                {lang === 'en' ? 'Group Due Reminder' : 'গ্রুপ তাগাদা (Due Reminder)'}
              </h2>
              <p className="text-xs text-rose-100 mt-0.5">
                {lang === 'en' 
                  ? 'Send due reminder notices to customers via SMS or WhatsApp' 
                  : 'বাকি কাস্টমারদের মোবাইল SMS বা WhatsApp-এ নোটিশ পাঠান'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info & Stats Ribbon */}
        <div className="bg-rose-50/80 border-b border-rose-100 p-3 sm:px-5 flex items-center justify-between gap-2 shrink-0">
          <button
            onClick={handleToggleSelectAll}
            className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 hover:text-indigo-700 transition-colors cursor-pointer"
          >
            {isAllSelected ? (
              <CheckSquare className="w-4 h-4 text-rose-500" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            <span>
              {lang === 'en' 
                ? `Select All (${selectedCustomers.length}/${dueCustomers.length})` 
                : `সব সিলেক্ট (${selectedCustomers.length}/${dueCustomers.length} জন)`}
            </span>
          </button>

          <div className="text-right">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              {lang === 'en' ? 'Total Due:' : 'মোট বকেয়া:'}
            </span>
            <span className="text-sm font-black text-rose-500">
              {formatBDTWithPrivacy(totalSelectedDue, isPrivacyMode, lang)}
            </span>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
          
          {/* Sample Message Preview (Matching TallyKhata Photo 3) */}
          <div className="bg-sky-50/80 dark:bg-slate-800/80 rounded-xl p-3 border border-sky-200/70 dark:border-sky-700/70 text-xs text-sky-900 dark:text-slate-100 space-y-1.5 shadow-xs">
            <div className="flex items-center gap-1.5 font-bold text-sky-900 dark:text-slate-100">
              <Info className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <span>{lang === 'en' ? 'Sample Message Preview:' : 'স্যাম্পল মেসেজ প্রিভিউ (Sample Message):'}</span>
            </div>
            <p className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-sky-200 dark:border-sky-700 text-slate-700 dark:text-slate-200 text-xs italic leading-relaxed">
              "{generalMessage}"
            </p>
            <p className="text-[11px] text-sky-700 dark:text-sky-400">
              {lang === 'en'
                ? '* Bulk group SMS sends a general notice. To send with specific amounts, click the WhatsApp or SMS button next to the customer.'
                : '* বাল্ক গ্রুপ SMS-এ সবার কাছে সাধারণ নোটিশ যায়। নির্দিষ্ট টাকার অঙ্কসহ পাঠাতে কাস্টমারের নামের পাশে থাকা WhatsApp বা SMS বাটনে ক্লিক করুন।'}
            </p>
          </div>

          {/* Customer List */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-600 dark:text-slate-200 uppercase tracking-wider">
              {lang === 'en' ? `Due Customers List (${dueCustomers.length})` : `বকেয়া কাস্টমারদের তালিকা (${dueCustomers.length})`}
            </h4>

            {dueCustomers.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                {lang === 'en' ? '🎉 No customers have outstanding dues!' : '🎉 কোনো কাস্টমারের কাছে বাকি টাকা পাওনা নেই!'}
              </div>
            ) : (
              dueCustomers.map((customer) => {
                const isSelected = selectedIds.includes(customer.id);
                return (
                  <div
                    key={customer.id}
                    className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'border-indigo-300 bg-indigo-50/30 shadow-xs'
                        : 'border-slate-200 bg-white opacity-60'
                    }`}
                  >
                    {/* Checkbox & Name */}
                    <div 
                      onClick={() => handleToggleCustomer(customer.id)}
                      className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                    >
                      <button type="button" className="text-rose-500 shrink-0">
                        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100 truncate">{customer.name}</p>
                          <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded shrink-0">
                            {lang === 'en' ? 'Due ' : 'বাকি '}{formatBDTWithPrivacy(customer.currentBalance, isPrivacyMode, lang)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 truncate">
                          {customer.phone || (lang === 'en' ? 'No number' : 'নম্বর নেই')}
                        </p>
                      </div>
                    </div>

                    {/* Quick Single Actions (WhatsApp, SMS, Share) */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* WhatsApp Button */}
                      <button
                        onClick={() => handleOpenWhatsApp(customer)}
                        className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        title={lang === 'en' ? 'Send via WhatsApp with exact due amount' : 'নির্দিষ্ট টাকার অঙ্কসহ হোয়াটসঅ্যাপে পাঠান'}
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="hidden sm:inline font-bold">WhatsApp</span>
                      </button>

                      {/* Single Mobile SMS Button */}
                      <button
                        onClick={() => handleOpenSingleSMS(customer)}
                        className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        title={lang === 'en' ? 'Send via mobile SMS' : 'মোবাইলের মেসেজ দিয়ে পাঠান'}
                      >
                        <Send className="w-3.5 h-3.5 text-blue-600" />
                        <span className="hidden sm:inline font-bold">SMS</span>
                      </button>

                      {/* Web Share API Button (Photo 5) */}
                      <button
                        onClick={() => handleNativeShare(customer)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:text-slate-200 border border-slate-200 text-xs transition-colors cursor-pointer"
                        title={lang === 'en' ? 'Share via other apps' : 'অন্যান্য মাধ্যমে শেয়ার করুন'}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 shrink-0 space-y-2">
          
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Mobile Bulk SMS Button */}
            <button
              onClick={handleSendBulkSMS}
              disabled={selectedCustomers.length === 0}
              className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer ${
                selectedCustomers.length === 0
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : isMobile
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400/30'
                    : 'bg-slate-800 text-white hover:bg-slate-900'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>
                {isMobile 
                  ? (lang === 'en' 
                      ? `Group SMS via Messaging App (${selectedCustomers.length})` 
                      : `মোবাইলের SMS অ্যাপে গ্রুপ মেসেজ (${selectedCustomers.length} জন)`)
                  : (lang === 'en' 
                      ? `Send Group SMS (${selectedCustomers.length})` 
                      : `গ্রুপ SMS পাঠান (${selectedCustomers.length} জন)`)
                }
              </span>
            </button>

            <button
              onClick={onClose}
              className="py-3 px-4 border border-slate-300 hover:bg-slate-100 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs sm:text-sm transition-colors cursor-pointer"
            >
              {lang === 'en' ? 'Close' : 'বন্ধ করুন'}
            </button>
          </div>

          {/* Desktop friendly hint if not on mobile */}
          {!isMobile && (
            <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
              <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span>
                {lang === 'en'
                  ? 'Running on PC: For individual reminders, click the WhatsApp button next to each customer.'
                  : 'পিসিতে চালাচ্ছেন: সরাসরি একক তাগাদার জন্য তালিকার WhatsApp বাটনে ক্লিক করুন।'}
              </span>
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
