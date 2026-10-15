import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatBDT, roundBDT } from '../../data/calculations';
import { Users, UserPlus, FileText, Printer, Trash2, X, Check, DollarSign } from 'lucide-react';
import dayjs from 'dayjs';

export default function PayrollModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const isDarkMode = state.isDarkMode;

  const employees = state.employees || [];
  const wallets = state.dayData?.wallets || {};
  const walletKeys = Object.keys(wallets);

  const [activeTab, setActiveTab] = useState('slip'); // 'slip' | 'staff'
  const [selectedEmpId, setSelectedEmpId] = useState(employees[0]?.id || '');
  const [month, setMonth] = useState(dayjs().format('MMMM YYYY'));
  const [bonus, setBonus] = useState('0');
  const [deduction, setDeduction] = useState('0');
  const [wallet, setWallet] = useState('hand_cash');
  const [isPaid, setIsPaid] = useState(false);

  // New staff form
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('Salesman');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [newStaffSalary, setNewStaffSalary] = useState('');

  if (!isOpen) return null;

  const selectedEmp = employees.find(e => e.id === selectedEmpId) || employees[0];
  const baseSalary = selectedEmp ? Number(selectedEmp.baseSalary) || 0 : 0;
  const numBonus = Number(bonus) || 0;
  const numDeduction = Number(deduction) || 0;
  const netPaid = Math.max(0, roundBDT(baseSalary + numBonus - numDeduction));

  const handleAddEmployee = (e) => {
    e.preventDefault();
    if (!newStaffName || Number(newStaffSalary) <= 0) return;

    dispatch({
      type: 'ADD_EMPLOYEE',
      payload: {
        name: newStaffName,
        role: newStaffRole,
        phone: newStaffPhone,
        baseSalary: Number(newStaffSalary),
      }
    });

    setNewStaffName('');
    setNewStaffPhone('');
    setNewStaffSalary('');
    setActiveTab('slip');
  };

  const handleDeleteEmployee = (id) => {
    if (window.confirm(lang === 'en' ? 'Remove this employee?' : 'এই কর্মচারীকে তালিকা থেকে বাদ দিতে চান?')) {
      dispatch({ type: 'DELETE_EMPLOYEE', payload: id });
    }
  };

  const handlePaySalary = () => {
    if (!selectedEmp || netPaid <= 0) return;

    dispatch({
      type: 'RECORD_SALARY_PAYMENT',
      payload: {
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.name,
        month,
        baseSalary,
        bonus: numBonus,
        deduction: numDeduction,
        netPaid,
        wallet,
      }
    });

    setIsPaid(true);
    setTimeout(() => {
      setIsPaid(false);
    }, 2500);
  };

  const handlePrintSlip = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl transition-all border ${
        isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">
                {lang === 'en' ? 'Staff Payroll & Salary Slips' : 'কর্মচারী বেতন ও পে-স্লিপ (Payroll)'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'en' ? 'Manage employees and issue monthly pay slips' : 'কর্মচারীদের মাসিক বেতন প্রদান ও রসিদ তৈরি'}
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

        {/* Tab switch */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-5 pt-2 gap-4">
          <button
            onClick={() => setActiveTab('slip')}
            className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'slip'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            {lang === 'en' ? 'Salary Slip Generator' : 'বেতন রসিদ তৈরি'}
          </button>
          <button
            onClick={() => setActiveTab('staff')}
            className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'staff'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-4 h-4" />
            {lang === 'en' ? 'Staff List' : 'কর্মচারী তালিকা'} ({employees.length})
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'slip' ? (
            employees.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <Users className="w-12 h-12 mx-auto text-slate-300" />
                <p className="text-xs text-slate-500">
                  {lang === 'en' ? 'No employees registered yet. Add your staff first.' : 'কোনো কর্মচারী যুক্ত নেই। প্রথমে কর্মচারী যুক্ত করুন।'}
                </p>
                <button
                  onClick={() => setActiveTab('staff')}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  + {lang === 'en' ? 'Add Employee' : 'কর্মচারী যুক্ত করুন'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Form Controls */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                      {lang === 'en' ? 'Select Employee' : 'কর্মচারী নির্বাচন করুন'}
                    </label>
                    <select
                      value={selectedEmp?.id || ''}
                      onChange={(e) => setSelectedEmpId(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                    >
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.role}) — {lang === 'en' ? 'Base: ৳' : 'মূল: ৳'}{emp.baseSalary}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                      {lang === 'en' ? 'Salary Month' : 'বেতনের মাস'}
                    </label>
                    <input
                      type="text"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        {lang === 'en' ? 'Bonus / Overtime (+)' : 'বোনাস / ওভারটাইম (+)'}
                      </label>
                      <input
                        type="number"
                        value={bonus}
                        onChange={(e) => setBonus(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        {lang === 'en' ? 'Advance / Deduction (−)' : 'অগ্রিম / কর্তন (−)'}
                      </label>
                      <input
                        type="number"
                        value={deduction}
                        onChange={(e) => setDeduction(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {lang === 'en' ? 'Payment Wallet' : 'পরিশোধের ওয়ালেট'}
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

                  <div className="pt-2 flex items-center gap-2">
                    <button
                      onClick={handlePaySalary}
                      className="flex-1 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md cursor-pointer transition-all flex items-center justify-center gap-1.5"
                    >
                      <DollarSign className="w-4 h-4" />
                      {lang === 'en' ? 'Record Salary Payment' : 'বেতন পরিশোধ এন্ট্রি দিন'}
                    </button>
                    <button
                      onClick={handlePrintSlip}
                      className="px-3.5 py-2.5 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                      title={lang === 'en' ? 'Print Pay Slip' : 'রসিদ প্রিন্ট করুন'}
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>

                  {isPaid && (
                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      {lang === 'en' ? 'Salary recorded as business expense!' : 'বেতন পরিচালন ব্যয় হিসেবে হিসাবভুক্ত হয়েছে!'}
                    </div>
                  )}
                </div>

                {/* Printable Salary Slip Preview */}
                <div id="salary-slip-printable" className="p-5 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 space-y-3 font-sans">
                  <div className="text-center border-b border-slate-200 dark:border-slate-800 pb-3">
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                      {state.activeBiz?.name || 'Ledgero Shop'}
                    </h4>
                    <p className="text-xs text-slate-500 font-semibold">
                      {lang === 'en' ? 'EMPLOYEE PAY SLIP / SALARY VOUCHER' : 'কর্মচারী বেতন রসিদ ও ভাউচার'}
                    </p>
                    <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                      {month}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 text-xs py-1">
                    <div>
                      <span className="text-xs text-slate-400 block">{lang === 'en' ? 'Employee' : 'কর্মচারী'}:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{selectedEmp?.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-400 block">{lang === 'en' ? 'Role' : 'পদবী'}:</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedEmp?.role}</span>
                    </div>
                  </div>

                  <div className="border-t border-b border-slate-200 dark:border-slate-800 py-2 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-400">{lang === 'en' ? 'Basic Salary' : 'মূল বেতন'}</span>
                      <span className="font-mono font-semibold">{formatBDT(baseSalary, lang)}</span>
                    </div>
                    {numBonus > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>{lang === 'en' ? 'Bonus / Allowance (+)' : 'বোনাস / ভাতা (+)'}</span>
                        <span className="font-mono font-semibold">+{formatBDT(numBonus, lang)}</span>
                      </div>
                    )}
                    {numDeduction > 0 && (
                      <div className="flex justify-between text-rose-600">
                        <span>{lang === 'en' ? 'Deductions / Advance (−)' : 'কর্তন / অগ্রিম (−)'}</span>
                        <span className="font-mono font-semibold">−{formatBDT(numDeduction, lang)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-sm font-bold pt-1">
                    <span className="text-slate-900 dark:text-white">{lang === 'en' ? 'NET PAYABLE' : 'পরিশোধযোগ্য নেট বেতন'}</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono text-base">
                      {formatBDT(netPaid, lang)}
                    </span>
                  </div>

                  <div className="pt-6 grid grid-cols-2 text-center text-xs text-slate-400">
                    <div className="border-t border-slate-300 dark:border-slate-700 pt-1 mx-2">
                      {lang === 'en' ? 'Employee Signature' : 'কর্মচারীর স্বাক্ষর'}
                    </div>
                    <div className="border-t border-slate-300 dark:border-slate-700 pt-1 mx-2">
                      {lang === 'en' ? 'Authorized Signature' : 'কর্তৃপক্ষের স্বাক্ষর'}
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : (
            /* Staff Management Tab */
            <div className="space-y-4">
              {/* Add Staff Form */}
              <form onSubmit={handleAddEmployee} className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
                <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4" />
                  {lang === 'en' ? 'Add New Employee' : 'নতুন কর্মচারী যুক্ত করুন'}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <input
                    type="text"
                    required
                    placeholder={lang === 'en' ? 'Full Name' : 'কর্মচারীর নাম *'}
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    className="px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                  <input
                    type="text"
                    placeholder={lang === 'en' ? 'Role (e.g. Salesman)' : 'পদবী (যেমন: বিক্রয়কর্মী)'}
                    value={newStaffRole}
                    onChange={(e) => setNewStaffRole(e.target.value)}
                    className="px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                  <input
                    type="tel"
                    placeholder={lang === 'en' ? 'Phone Number' : 'মোবাইল নম্বর'}
                    value={newStaffPhone}
                    onChange={(e) => setNewStaffPhone(e.target.value)}
                    className="px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                  <input
                    type="number"
                    required
                    placeholder={lang === 'en' ? 'Base Salary (৳)' : 'মাসিক মূল বেতন (৳) *'}
                    value={newStaffSalary}
                    onChange={(e) => setNewStaffSalary(e.target.value)}
                    className="px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs cursor-pointer"
                >
                  + {lang === 'en' ? 'Save Employee' : 'কর্মচারী সংরক্ষণ করুন'}
                </button>
              </form>

              {/* Staff List */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                {employees.map(emp => (
                  <div key={emp.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{emp.name}</span>
                      <span className="ml-2 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
                        {emp.role}
                      </span>
                      {emp.phone && (
                        <span className="block text-xs text-slate-400 mt-0.5">📞 {emp.phone}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                        {formatBDT(emp.baseSalary, lang)}
                      </span>
                      <button
                        onClick={() => handleDeleteEmployee(emp.id)}
                        className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer"
          >
            {lang === 'en' ? 'Close' : 'বন্ধ করুন'}
          </button>
        </div>
      </div>
    </div>
  );
}
