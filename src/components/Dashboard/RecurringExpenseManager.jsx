import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { getWalletLabel } from '../../data/constants';
import { formatBDT } from '../../data/calculations';

export default function RecurringExpenseManager({ state, dispatch, isOpen, onClose, lang = 'bn' }) {
  const { dayData } = state;
  const recurringExpenses = dayData?.recurringExpenses || [];
  const activeDashWalletKeys = Object.keys(dayData?.wallets || {});
  const isEn = lang === 'en';
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    amount: '',
    dayOfMonth: 1,
    category: 'rent',
    wallet: 'hand_cash'
  });

  const categories = [
    { id: 'rent', label: isEn ? 'Rent' : 'ভাড়া (Rent)' },
    { id: 'salary', label: isEn ? 'Salary' : 'বেতন (Salary)' },
    { id: 'electricity', label: isEn ? 'Electricity' : 'বিদ্যুৎ (Electricity)' },
    { id: 'water', label: isEn ? 'Water' : 'পানি (Water)' },
    { id: 'internet', label: isEn ? 'Internet' : 'ইন্টারনেট (Internet)' },
    { id: 'other', label: isEn ? 'Other' : 'অন্যান্য (Other)' }
  ];

  const days = Array.from({ length: 28 }, (_, i) => i + 1);

  const today = new Date();
  const currentDay = today.getDate();
  const currentMonthStr = today.toISOString().slice(0, 7); // YYYY-MM

  const pendingExpenses = useMemo(() => {
    return recurringExpenses.filter(r => 
      r.isActive && 
      r.dayOfMonth === currentDay && 
      r.lastAppliedMonth !== currentMonthStr
    );
  }, [recurringExpenses, currentDay, currentMonthStr]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!formData.name || !formData.amount) return;

    dispatch({
      type: 'ADD_RECURRING_EXPENSE',
      payload: {
        id: 'rec_' + Date.now(),
        name: formData.name,
        amount: Number(formData.amount),
        category: formData.category,
        dayOfMonth: Number(formData.dayOfMonth),
        wallet: formData.wallet,
        isActive: true,
        lastAppliedMonth: null,
        createdAt: new Date().toISOString()
      }
    });

    setFormData({
      name: '',
      amount: '',
      dayOfMonth: 1,
      category: 'rent',
      wallet: 'hand_cash'
    });
    setShowAddForm(false);
  };

  const handleApply = (recurring) => {
    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        type: 'expense',
        amount: recurring.amount,
        fromWallet: recurring.wallet || 'cash',
        category: recurring.category,
        note: recurring.name + (isEn ? ' (Monthly)' : ' (মাসিক)')
      }
    });
    
    dispatch({
      type: 'UPDATE_RECURRING_EXPENSE',
      payload: { id: recurring.id, lastAppliedMonth: currentMonthStr }
    });
  };

  const toggleActive = (recurring) => {
    dispatch({
      type: 'UPDATE_RECURRING_EXPENSE',
      payload: { id: recurring.id, isActive: !recurring.isActive }
    });
  };

  const handleDelete = (id) => {
    if (window.confirm(isEn ? 'Are you sure you want to delete this recurring expense?' : 'আপনি কি নিশ্চিত এটি মুছে ফেলতে চান?')) {
      dispatch({
        type: 'DELETE_RECURRING_EXPENSE',
        payload: id
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-white">
            <RefreshCw className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold">
              {isEn ? 'Monthly Recurring Expenses' : 'মাসিক নির্ধারিত খরচ'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {/* Pending Reminders */}
          {pendingExpenses.length > 0 && (
            <div className="space-y-2 mb-4">
              {pendingExpenses.map(p => (
                <div key={p.id} className="bg-amber-500/20 border border-amber-500/50 p-3 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-amber-300 font-bold text-sm flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> 
                      {isEn ? `Today is ${p.name} due day!` : `আজ ${p.name} দেওয়ার দিন!`}
                    </p>
                    <p className="text-amber-100 text-xs mt-0.5">
                      {formatBDT(p.amount, lang)} {isEn ? '— Apply now' : '— এখনই যোগ করুন'}
                    </p>
                  </div>
                  <button 
                    onClick={() => handleApply(p)}
                    className="bg-amber-500 hover:bg-amber-600 text-white p-2 rounded-lg font-bold flex items-center gap-1 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" /> ✅
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* List */}
          <div className="space-y-3">
            {recurringExpenses.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-sm">
                {isEn ? 'No monthly expenses configured yet.' : 'কোনো মাসিক খরচ সেট করা নেই।'}
              </div>
            ) : (
              recurringExpenses.map(r => (
                <div key={r.id} className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${r.isActive ? 'bg-slate-800 border-slate-700' : 'bg-slate-800/50 border-slate-800 opacity-75'}`}>
                  <div>
                    <h3 className={`font-bold ${r.isActive ? 'text-white' : 'text-slate-400'}`}>{r.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatBDT(r.amount, lang)} • {isEn ? `Day ${r.dayOfMonth} of month` : `মাসের ${r.dayOfMonth} তারিখ`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={r.isActive} 
                        onChange={() => toggleActive(r)} 
                      />
                      <div className="w-9 h-5 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                    <button onClick={() => handleDelete(r.id)} className="text-rose-400 hover:text-rose-300 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add New Form */}
          {showAddForm ? (
            <div className="bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700 mt-4">
              <h3 className="text-white font-bold text-sm mb-2">
                {isEn ? 'Add New Monthly Expense' : 'নতুন খরচ যোগ করুন'}
              </h3>
              
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {isEn ? 'Expense Name' : 'খরচের নাম (Name)'}
                </label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  placeholder={isEn ? "e.g., Shop Rent" : "যেমন: দোকান ভাড়া"}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {isEn ? 'Amount (৳)' : 'পরিমাণ (Amount)'}
                  </label>
                  <input 
                    type="number" 
                    value={formData.amount}
                    onChange={e => setFormData({...formData, amount: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                    placeholder={lang === 'en' ? 'Tk 0' : '৳ 0'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {isEn ? 'Day of Month' : 'মাসের তারিখ (Day)'}
                  </label>
                  <select 
                    value={formData.dayOfMonth}
                    onChange={e => setFormData({...formData, dayOfMonth: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {days.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {isEn ? 'Category' : 'ক্যাটাগরি (Category)'}
                  </label>
                  <select 
                    value={formData.category}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {isEn ? 'Deduct from Wallet' : 'কোন একাউন্ট থেকে (Wallet)'}
                  </label>
                  <select 
                    value={formData.wallet}
                    onChange={e => setFormData({...formData, wallet: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {activeDashWalletKeys.map(key => (
                      <option key={key} value={key}>
                        {dayData?.wallets?.[key]?.label || getWalletLabel(key, lang)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 py-2 rounded-lg text-sm font-bold text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
                <button 
                  onClick={handleSave}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold transition-colors"
                >
                  {isEn ? 'Save Expense' : 'সেভ করুন'}
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={() => setShowAddForm(true)}
              className="w-full py-3 border border-dashed border-slate-700 rounded-xl text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-800 transition-all flex items-center justify-center gap-2 mt-4 text-sm font-bold"
            >
              <Plus className="w-4 h-4" /> 
              {isEn ? 'Add New Monthly Expense' : 'নতুন মাসিক খরচ যোগ করুন'}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}