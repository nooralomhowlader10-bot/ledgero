import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { t } from '../../data/translations';
import { formatBDT, formatBDTWithPrivacy, calcAgingBucket } from '../../data/calculations';
import { getTodayKey } from '../../data/storage';
import { useAppMode } from '../Shared/ModeGuard';
import { 
  Users, UserPlus, Search, Phone, MessageSquare, 
  ChevronRight, ArrowDownLeft, ArrowUpRight, Eye, EyeOff,
  Building2, UserCheck, CheckCircle2, AlertCircle,
  ChevronDown, ChevronUp, CheckSquare, Square, Download
} from 'lucide-react';

import AddContactModal from './AddContactModal';
import ContactLedgerModal from './ContactLedgerModal';
import GroupTagadaModal from './GroupTagadaModal';

export default function KhataScreen() {
  const { state, dispatch } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const { contacts = [], activeBiz, isPrivacyMode, language } = state;
  const lang = language || 'bn';

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'customer', 'supplier'
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isTagadaModalOpen, setIsTagadaModalOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showAging, setShowAging] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState([]);

  // Totals & High Due Risk Threshold
  const HIGH_DUE_THRESHOLD = 3000;

  const totalReceivable = contacts
    .filter(c => c.type === 'customer')
    .reduce((sum, c) => sum + (c.currentBalance || 0), 0);

  const totalPayable = contacts
    .filter(c => c.type === 'supplier')
    .reduce((sum, c) => sum + (c.currentBalance || 0), 0);

  const customerCount = contacts.filter(c => c.type === 'customer').length;
  const supplierCount = contacts.filter(c => c.type === 'supplier').length;
  const dueCustomerCount = contacts.filter(c => c.type === 'customer' && (Number(c.currentBalance) || 0) > 0).length;

  const highDueCustomers = contacts.filter(
    c => c.type === 'customer' && (c.currentBalance || 0) >= HIGH_DUE_THRESHOLD
  );
  const totalHighDueAmount = highDueCustomers.reduce(
    (sum, c) => sum + (c.currentBalance || 0), 0
  );

  // ── Aging Schedule Calculations ───────────────────────────────
  const todayKey = state.dayData?.dateKey || new Date().toISOString().slice(0, 10);
  const agingData = {
    '0-30': { count: 0, amount: 0, contacts: [] },
    '31-60': { count: 0, amount: 0, contacts: [] },
    '61-90': { count: 0, amount: 0, contacts: [] },
    '90+': { count: 0, amount: 0, contacts: [] },
  };

  (state.contacts || []).forEach(c => {
    if (c.type === 'customer' && c.currentBalance > 0) {
      const aging = calcAgingBucket(c.updatedAt || c.createdAt, todayKey);
      const bucket = agingData[aging.bucket];
      if (bucket) {
        bucket.count++;
        bucket.amount += c.currentBalance;
        bucket.contacts.push({ ...c, agingDays: aging.days });
      }
    }
  });

  // Filter contacts by search & type
  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = 
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (contact.phone && contact.phone.includes(searchQuery));

    if (!matchesSearch) return false;
    if (filterType === 'due_only') return contact.type === 'customer' && (Number(contact.currentBalance) || 0) > 0;
    if (filterType === 'customer') return contact.type === 'customer';
    if (filterType === 'supplier') return contact.type === 'supplier';
    return true;
  });

  const handleExportContactsCSV = () => {
    const targetIds = selectedContactIds.length > 0 ? selectedContactIds : filteredContacts.map(c => c.id);
    const targets = contacts.filter(c => targetIds.includes(c.id));
    if (targets.length === 0) return;

    const headers = ['ID', 'Name', 'Type', 'Phone', 'Current Balance (BDT)', 'Note'];
    const rows = targets.map(c => [
      c.id,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      c.type,
      `"${c.phone || ''}"`,
      c.currentBalance || 0,
      `"${(c.note || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ledgero_contacts_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 relative">
      
      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 1. TOP HIGHLIGHT ROW: মোট পাবো | মোট দেবো (Photo 1 & 5 Inspired)   */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <section className={`bg-white overflow-hidden ${isEasy ? 'rounded-2xl shadow-md' : 'rounded-lg border border-gray-200 shadow-sm'}`}>
        {/* Title Bar */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center font-bold">
              📖
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {isEasy ? (lang === 'en' ? 'Due Book' : 'বাকির খাতা') : t('khata_title', lang)}
              </h2>
              <p className="text-[11px] text-slate-300">{activeBiz?.name} — {t('khata_subtitle', lang)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTagadaModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border border-amber-500"
              title={t('khata_group_reminder_title', lang)}
            >
              <Users className="w-3.5 h-3.5" />
              <span>{t('khata_group_reminder', lang)}</span>
            </button>

            <button
              onClick={() => dispatch({ type: 'TOGGLE_PRIVACY_MODE' })}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                isPrivacyMode
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm ring-1 ring-amber-300'
                  : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700'
              }`}
              title={t('khata_privacy_title', lang)}
            >
              {isPrivacyMode ? <EyeOff className="w-3.5 h-3.5 text-slate-950" /> : <Eye className="w-3.5 h-3.5 text-slate-300" />}
              <span className="hidden sm:inline">{isPrivacyMode ? t('privacy_on', lang) : t('privacy_off', lang)}</span>
            </button>
          </div>
        </div>

        {/* 2-Column Highlight Row (Photo 1 & 5) */}
        <div className={`grid grid-cols-2 p-5 ${
          isEasy 
            ? 'gap-2 bg-white' 
            : 'divide-x divide-slate-100 bg-gradient-to-b from-white to-slate-50/50'
        }`}>
          
          {/* LEFT: মোট পাবো (Receivable) */}
          <div className={`text-center sm:text-left flex flex-col justify-center ${
            isEasy ? 'bg-green-50 rounded-xl p-4 border border-green-100' : 'pr-4'
          }`}>
            <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${isEasy ? 'bg-green-500' : 'bg-sky-500 animate-pulse'}`}></span>
              <span className="text-xs sm:text-sm font-bold text-gray-600 dark:text-slate-300">{t('khata_total_due', lang)}</span>
            </div>
            <div className={`${isEasy ? 'text-3xl sm:text-4xl text-green-600' : 'text-2xl sm:text-3xl text-sky-500 dark:text-sky-400'} font-black tracking-tight`}>
              {formatBDTWithPrivacy(totalReceivable, isPrivacyMode, lang)}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-slate-400 mt-1">
              {customerCount} {t('khata_customer_count_due', lang)}
            </p>
          </div>

          {/* RIGHT: মোট দেবো (Payable) */}
          <div className={`text-center sm:text-left flex flex-col justify-center ${
            isEasy ? 'bg-red-50 rounded-xl p-4 border border-red-100' : 'pl-4'
          }`}>
            <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${isEasy ? 'bg-red-500' : 'bg-emerald-600'}`}></span>
              <span className="text-xs sm:text-sm font-bold text-gray-600 dark:text-slate-300">{t('khata_total_payable', lang)}</span>
            </div>
            <div className={`${isEasy ? 'text-3xl sm:text-4xl text-red-600' : 'text-2xl sm:text-3xl text-emerald-700'} font-black tracking-tight`}>
              {formatBDTWithPrivacy(totalPayable, isPrivacyMode, lang)}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-slate-400 mt-1">
              {supplierCount} {t('khata_supplier_count_due', lang)}
            </p>
          </div>

        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 1.2 HIGH DUE RISK ALERT (উচ্চ বাকি ঝুঁকি সতর্কতা)                 */}
      {/* ───────────────────────────────────────────────────────────────── */}
      {isAdvanced && highDueCustomers.length > 0 && (
        <section className="p-4 bg-amber-50/80 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-600/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center font-bold text-base shadow-xs shrink-0">
              ⚠️
            </div>
            <div>
              <p className="text-xs sm:text-sm font-black text-amber-900 dark:text-amber-300">
                {t('khata_high_risk_alert', lang)}: {highDueCustomers.length} {t('khata_high_risk_desc', lang)} {HIGH_DUE_THRESHOLD.toLocaleString()} {t('khata_high_risk_more', lang)}
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                {t('khata_high_risk_total', lang)}: <span className="font-black text-amber-900 dark:text-amber-200">{formatBDTWithPrivacy(totalHighDueAmount, isPrivacyMode, lang)}</span> — {t('khata_high_risk_advice', lang)}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsTagadaModalOpen(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer self-start sm:self-auto"
          >
            {t('khata_send_reminder', lang)} →
          </button>
        </section>
      )}

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 2. SEARCH & FILTER SECTION (Photo 1 & 5)                         */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('khata_search_placeholder', lang)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-2xl text-xs sm:text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-3 text-xs text-gray-400 hover:text-gray-600 font-bold"
            >
              {t('khata_clear', lang)}
            </button>
          )}
        </div>

        {/* Filter Pills and Add Button */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterType === 'all' 
                  ? 'bg-white text-gray-900 shadow-xs' 
                  : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t('khata_filter_all', lang)} ({contacts.length})
            </button>

            <button
              onClick={() => setFilterType('customer')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterType === 'customer' 
                  ? 'bg-sky-600 text-white shadow-xs' 
                  : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t('khata_filter_customer', lang)} ({customerCount})
            </button>

            <button
              onClick={() => setFilterType('due_only')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterType === 'due_only' 
                  ? 'bg-rose-600 text-white shadow-xs' 
                  : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {lang === 'en' ? 'Due Only' : '🔴 বাকি আছে'} ({dueCustomerCount})
            </button>

            <button
              onClick={() => setFilterType('supplier')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterType === 'supplier' 
                  ? 'bg-emerald-600 text-white shadow-xs' 
                  : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t('khata_filter_supplier', lang)} ({supplierCount})
            </button>
          </div>

          <div className="flex items-center gap-2">
            {contacts.length > 0 && (
              <button
                onClick={() => {
                  setIsBulkMode(!isBulkMode);
                  setSelectedContactIds([]);
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isBulkMode ? 'bg-indigo-600 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>{isBulkMode ? (lang === 'en' ? 'Done' : 'সম্পন্ন') : (lang === 'en' ? 'Bulk Actions' : 'একসাথে কাজ')}</span>
              </button>
            )}

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
            >
              <UserPlus className="w-4 h-4" /> {t('khata_add_person', lang)}
            </button>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {isBulkMode && (
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/50 rounded-2xl flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => {
                  if (selectedContactIds.length === filteredContacts.length) {
                    setSelectedContactIds([]);
                  } else {
                    setSelectedContactIds(filteredContacts.map(c => c.id));
                  }
                }}
                className="font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 hover:underline cursor-pointer"
              >
                {selectedContactIds.length > 0 && selectedContactIds.length === filteredContacts.length ? (
                  <CheckSquare className="w-4 h-4 text-indigo-600" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400" />
                )}
                <span>{lang === 'en' ? 'Select All' : 'সব নির্বাচন'}</span>
              </button>
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                ({selectedContactIds.length} / {filteredContacts.length} {lang === 'en' ? 'selected' : 'নির্বাচিত'})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={selectedContactIds.length === 0}
                onClick={() => setIsTagadaModalOpen(true)}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'WhatsApp Reminders' : 'WhatsApp তাগাদা'}</span>
              </button>

              <button
                disabled={selectedContactIds.length === 0}
                onClick={handleExportContactsCSV}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Export CSV' : 'CSV এক্সপোর্ট'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 3. CONTACT LIST (Photo 1 & 5 Inspired)                           */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <section className={`bg-white overflow-hidden divide-y divide-slate-100 ${
        isEasy ? 'rounded-2xl shadow-md' : 'rounded-lg border border-gray-200 shadow-sm'
      }`}>
        {filteredContacts.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
              👥
            </div>
            <p className="text-sm font-bold text-gray-700 dark:text-slate-200">
              {searchQuery ? t('khata_no_search_result', lang) : t('khata_no_contacts_yet', lang)}
            </p>
            <p className="text-xs text-gray-400 dark:text-slate-400 max-w-sm mx-auto">
              {t('khata_no_contacts_desc', lang)}
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-sm inline-flex items-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" /> {t('khata_add_first_person', lang)}
            </button>
          </div>
        ) : (
          filteredContacts.map((contact) => {
            const isCustomer = contact.type === 'customer';
            const isHighRisk = isCustomer && (contact.currentBalance || 0) >= HIGH_DUE_THRESHOLD;
            const initials = contact.name
              ? contact.name.trim().split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase()
              : '??';

            return (
              <div 
                key={contact.id}
                onClick={() => {
                  if (isBulkMode) {
                    setSelectedContactIds(prev => 
                      prev.includes(contact.id) ? prev.filter(id => id !== contact.id) : [...prev, contact.id]
                    );
                  } else {
                    setSelectedContact(contact);
                  }
                }}
                className={`p-4 flex items-center justify-between hover:bg-slate-50/80 transition-colors cursor-pointer group ${
                  selectedContactIds.includes(contact.id) ? 'bg-sky-50/80 dark:bg-sky-950/40' : ''
                } ${
                  isAdvanced && isHighRisk ? 'bg-sky-50/20 dark:bg-sky-900/10' : ''
                }`}
              >
                {/* Left side: Avatar, Name, Phone */}
                <div className="flex items-center gap-3">
                  {isBulkMode && (
                    <div className="text-sky-600 shrink-0">
                      {selectedContactIds.includes(contact.id) ? (
                        <CheckSquare className="w-5 h-5 text-sky-600" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-300" />
                      )}
                    </div>
                  )}
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xs font-black shadow-xs ${
                    isCustomer 
                      ? (isAdvanced && isHighRisk ? 'bg-sky-200 text-sky-800 ring-2 ring-sky-400 dark:bg-sky-500/20 dark:text-sky-300 dark:ring-sky-400/40' : 'bg-sky-100 text-sky-700 group-hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-300')
                      : 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200'
                  } transition-colors`}>
                    {initials}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-gray-900 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                        {contact.name}
                      </h3>
                      <span className={`text-xs font-semibold px-2 py-0.2 rounded-full ${
                        isCustomer 
                          ? 'bg-sky-50 text-sky-700 border border-sky-200/60 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/30' 
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                      }`}>
                        {isCustomer ? t('khata_customer', lang) : t('khata_supplier', lang)}
                      </span>
                      {isAdvanced && isHighRisk && (
                        <span className="text-xs font-bold px-2 py-0.2 rounded-full bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-500/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                          {t('khata_high_risk_tag', lang)}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                      <span>{contact.phone || t('khata_no_phone', lang)}</span>
                      {contact.note && <span className="text-gray-400">• {contact.note}</span>}
                      {isAdvanced && (contact.interestRate || 0) > 0 && (
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">💰 {contact.interestRate}%</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Right side: Amount & Chevron */}
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className={`font-black ${
                      isEasy 
                        ? (contact.currentBalance > 0 
                            ? (isCustomer ? 'text-xl text-green-600' : 'text-xl text-red-600') 
                            : 'text-xl text-gray-400')
                        : (contact.currentBalance > 0 
                            ? (isCustomer ? 'text-base text-sky-500 dark:text-sky-400' : 'text-base text-emerald-700') 
                            : 'text-base text-gray-400')
                    }`}>
                      {formatBDTWithPrivacy(contact.currentBalance, isPrivacyMode, lang)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-slate-400 font-medium">
                      {isCustomer ? t('khata_due', lang) : t('khata_payable', lang)}
                    </p>
                    {isAdvanced && contact.type === 'customer' && contact.currentBalance > 0 && (() => {
                      const aging = calcAgingBucket(contact.updatedAt || contact.createdAt, todayKey);
                      if (aging.days > 15) {
                        return (
                          <span className={`mt-1 inline-block text-xs px-1.5 py-0.5 rounded-full ${
                            aging.severity === 'critical' ? 'bg-red-100 text-red-700' :
                            aging.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {aging.days}{lang === 'en' ? 'd' : 'দিন'}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-sky-500 transition-colors" />
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 4. FLOATING ACTION BUTTON (Photo 1 & 5 Red Pill FAB)              */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-30">
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-full shadow-xl hover:shadow-2xl flex items-center gap-2 text-xs sm:text-sm transition-all transform active:scale-95 cursor-pointer border-2 border-white/20"
        >
          <UserPlus className="w-5 h-5" />
          <span>{t('khata_add_person', lang)}</span>
        </button>
      </div>

      {/* Modals */}
      <AddContactModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />

      <ContactLedgerModal
        isOpen={Boolean(selectedContact)}
        contact={selectedContact}
        onClose={() => setSelectedContact(null)}
      />

      <GroupTagadaModal
        isOpen={isTagadaModalOpen}
        onClose={() => setIsTagadaModalOpen(false)}
      />

    </div>
  );
}
