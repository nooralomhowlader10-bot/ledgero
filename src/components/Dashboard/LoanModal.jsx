import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import Modal from '../Shared/Modal';
import { TX_TYPES } from '../../data/constants';
import { t } from '../../data/translations';
import { formatBDT } from '../../data/calculations';

export default function LoanModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const handCash = state.dayData?.wallets?.hand_cash?.current || 0;

  const [loanType, setLoanType] = useState(TX_TYPES.LOAN_GIVEN);
  const [amount, setAmount] = useState('');
  const [personName, setPersonName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const resetForm = () => {
    setLoanType(TX_TYPES.LOAN_GIVEN);
    setAmount('');
    setPersonName('');
    setNote('');
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const loanAmount = Number(amount);

    if (!loanAmount || loanAmount <= 0) {
      setError(lang === 'en' ? 'Amount must be greater than 0.' : 'Amount must be greater than 0.'); // it was english already
      return;
    }

    if (!personName.trim()) {
      setError(lang === 'en' ? 'Name is required.' : 'ব্যক্তি বা কাস্টমারের নাম লিখুন (Name is required).');
      return;
    }

    // Validation for outgoing cash
    if ((loanType === TX_TYPES.LOAN_GIVEN || loanType === TX_TYPES.LOAN_REPAID) && loanAmount > handCash) {
      setError(lang === 'en' ? `Not enough cash in drawer. Current cash: ${formatBDT(handCash, lang)}` : `ড্রয়ারে পর্যাপ্ত ক্যাশ নেই। বর্তমান ক্যাশ: ${formatBDT(handCash, lang)}`);
      return;
    }

    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        type: loanType,
        amount: loanAmount,
        customerName: personName.trim(),
        note: note.trim()
      }
    });

    handleClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('loan_modal_title', lang)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-rose-50 text-rose-500 p-3 rounded-lg text-sm border border-rose-200">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">{t('loan_type_label', lang)}</label>
          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
              loanType === TX_TYPES.LOAN_GIVEN ? 'border-purple-500 bg-purple-50 text-purple-800 font-semibold' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
            }`}>
              <input
                type="radio"
                name="loanType"
                value={TX_TYPES.LOAN_GIVEN}
                checked={loanType === TX_TYPES.LOAN_GIVEN}
                onChange={(e) => setLoanType(e.target.value)}
                className="text-purple-600"
              />
              <span className="text-xs">{t('loan_give', lang)}</span>
            </label>

            <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
              loanType === TX_TYPES.LOAN_COLLECTED ? 'border-green-500 bg-green-50 text-green-800 font-semibold' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
            }`}>
              <input
                type="radio"
                name="loanType"
                value={TX_TYPES.LOAN_COLLECTED}
                checked={loanType === TX_TYPES.LOAN_COLLECTED}
                onChange={(e) => setLoanType(e.target.value)}
                className="text-green-600"
              />
              <span className="text-xs">{t('loan_collect', lang)}</span>
            </label>

            <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
              loanType === TX_TYPES.LOAN_TAKEN ? 'border-amber-500 bg-amber-50 text-amber-800 font-semibold' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
            }`}>
              <input
                type="radio"
                name="loanType"
                value={TX_TYPES.LOAN_TAKEN}
                checked={loanType === TX_TYPES.LOAN_TAKEN}
                onChange={(e) => setLoanType(e.target.value)}
                className="text-amber-600"
              />
              <span className="text-xs">{t('loan_borrow', lang)}</span>
            </label>

            <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
              loanType === TX_TYPES.LOAN_REPAID ? 'border-indigo-500 bg-indigo-50 text-indigo-800 font-semibold' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
            }`}>
              <input
                type="radio"
                name="loanType"
                value={TX_TYPES.LOAN_REPAID}
                checked={loanType === TX_TYPES.LOAN_REPAID}
                onChange={(e) => setLoanType(e.target.value)}
                className="text-indigo-600"
              />
              <span className="text-xs">{t('loan_repay', lang)}</span>
            </label>
          </div>

          <p className="text-xs text-gray-500 mt-2">
            {loanType === TX_TYPES.LOAN_GIVEN && (lang === 'en' ? '📉 Reduces drawer cash, increases your receivables' : '📉 ড্রয়ার থেকে ক্যাশ কমবে, আপনার পাওনা টাকা বাড়বে')}
            {loanType === TX_TYPES.LOAN_COLLECTED && (lang === 'en' ? '📈 Increases drawer cash, reduces your receivables' : '📈 ড্রয়ারে ক্যাশ বাড়বে, আপনার পাওনা টাকা কমবে')}
            {loanType === TX_TYPES.LOAN_TAKEN && (lang === 'en' ? '📈 Increases drawer cash, increases your debt' : '📈 ড্রয়ারে ক্যাশ বাড়বে, আপনার দেনা টাকা বাড়বে')}
            {loanType === TX_TYPES.LOAN_REPAID && (lang === 'en' ? '📉 Reduces drawer cash, reduces your debt' : '📉 ড্রয়ার থেকে ক্যাশ কমবে, আপনার দেনা টাকা কমবে')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('amount_label', lang)}</label>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="0"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('party_name_label', lang)}</label>
          <input
            type="text"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={lang === 'en' ? 'Name of person/party' : 'যার সাথে লেনদেন (নাম)'}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('description_label', lang)}</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={lang === 'en' ? 'e.g. Will pay in 1 week' : 'যেমন: ১ সপ্তাহের মধ্যে দেবে'}
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition-colors shadow-sm"
          >
            {t('confirm_record', lang)}
          </button>
        </div>
      </form>
    </Modal>
  );
}
