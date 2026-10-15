import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import Modal from '../Shared/Modal';
import { 
  WALLET_KEYS, WALLET_LABELS, 
  GENERAL_WALLET_KEYS, GENERAL_WALLET_LABELS,
  TX_TYPES, isTelecomBiz, getWalletLabel, getCustomWalletColor
} from '../../data/constants';
import { formatBDT } from '../../data/calculations';

export default function TransferModal({ isOpen, onClose }) {
  const { state, dispatch } = useApp();
  const { dayData, activeBiz, language } = state;
  const lang = language || 'bn';
  const wallets = dayData?.wallets || {};

  const isTelecom = isTelecomBiz(activeBiz?.type, activeBiz?.name);
  const allWalletKeys = Object.keys(wallets);
  const walletKeys = (dayData?.walletOrder && dayData.walletOrder.length > 0)
    ? [
        ...dayData.walletOrder.filter(k => allWalletKeys.includes(k)),
        ...allWalletKeys.filter(k => !dayData.walletOrder.includes(k))
      ]
    : allWalletKeys;

  const getLabel = (key) => wallets[key]?.label || getWalletLabel(key, lang, wallets[key]);

  const [fromWallet, setFromWallet] = useState('');
  const [toWallet, setToWallet] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const resetForm = () => {
    setFromWallet('');
    setToWallet('');
    setAmount('');
    setFee('');
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

    const transferAmount = Number(amount);
    
    if (!fromWallet || !toWallet) {
      setError(lang === 'en' 
        ? 'Please select both source and destination wallets.' 
        : 'যে ওয়ালেট থেকে যাবে এবং যেখানে জমা হবে দুটোই নির্বাচন করুন।');
      return;
    }
    
    if (fromWallet === toWallet) {
      setError(lang === 'en' 
        ? 'Source and destination wallets cannot be the same.' 
        : 'একই ওয়ালেটে ট্রান্সফার করা যাবে না।');
      return;
    }

    if (!transferAmount || transferAmount <= 0) {
      setError(lang === 'en' 
        ? 'Amount must be greater than 0.' 
        : 'টাকার পরিমাণ ০ এর বেশি হতে হবে।');
      return;
    }

    const available = wallets[fromWallet]?.current || 0;
    if (transferAmount > available) {
      setError(lang === 'en' 
        ? `Insufficient balance in ${getLabel(fromWallet)}.` 
        : `${getLabel(fromWallet)}-এ পর্যাপ্ত টাকা নেই।`);
      return;
    }

    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        type: TX_TYPES.FUND_TRANSFER,
        amount: transferAmount,
        fromWallet,
        toWallet,
        note: note.trim()
      }
    });

    // Auto-create transfer fee expense if fee > 0
    const feeAmount = Number(fee) || 0;
    if (feeAmount > 0) {
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          type: 'transfer_fee',
          amount: feeAmount,
          category: 'transfer_fee',
          note: `Transfer fee: ${getLabel(fromWallet)} → ${getLabel(toWallet)}`
        }
      });
    }

    handleClose();
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title={lang === 'en' ? 'Fund Transfer' : 'টাকা ট্রান্সফার (Fund Transfer)'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-rose-50 text-rose-600 p-3 rounded-xl text-xs font-semibold border border-rose-200">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {lang === 'en' ? 'From Wallet *' : 'যে ওয়ালেট থেকে যাবে (From Wallet) *'}
          </label>
          <select
            value={fromWallet}
            onChange={(e) => setFromWallet(e.target.value)}
            className="w-full border border-gray-300 rounded-xl p-2.5 outline-none focus:ring-2 focus:ring-blue-500 bg-white text-xs font-semibold"
            required
          >
            <option value="">{lang === 'en' ? '-- Select source wallet --' : '-- ওয়ালেট নির্বাচন করুন --'}</option>
            {walletKeys.map((key) => {
              const icon = getCustomWalletColor(key, walletKeys, wallets[key])?.icon || '💰';
              return (
                <option key={key} value={key}>
                  {icon} {getLabel(key)} ({formatBDT(wallets[key]?.current || 0, lang)})
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {lang === 'en' ? 'To Wallet *' : 'যে ওয়ালেটে জমা হবে (To Wallet) *'}
          </label>
          <select
            value={toWallet}
            onChange={(e) => setToWallet(e.target.value)}
            className="w-full border border-gray-300 rounded-xl p-2.5 outline-none focus:ring-2 focus:ring-blue-500 bg-white text-xs font-semibold"
            required
          >
            <option value="">{lang === 'en' ? '-- Select destination wallet --' : '-- ওয়ালেট নির্বাচন করুন --'}</option>
            {walletKeys.filter(k => k !== fromWallet).map((key) => {
              const icon = getCustomWalletColor(key, walletKeys, wallets[key])?.icon || '💰';
              return (
                <option key={key} value={key}>
                  {icon} {getLabel(key)} ({formatBDT(wallets[key]?.current || 0, lang)})
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {lang === 'en' ? 'Amount (Tk) *' : 'টাকার পরিমাণ (Amount ৳) *'}
          </label>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-xl p-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm bg-white"
            placeholder="0"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {lang === 'en' ? 'Transfer Fee / Charge (Tk)' : 'ট্রান্সফার ফি / চার্জ (৳)'}
            <span className="text-gray-400 font-normal ml-1">— {lang === 'en' ? 'Optional' : 'ঐচ্ছিক'}</span>
          </label>
          <input
            type="number"
            min="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full border border-gray-300 rounded-xl p-2.5 outline-none focus:ring-2 focus:ring-orange-400 font-bold text-sm bg-white"
            placeholder="0"
          />
          {Number(fee) > 0 && (
            <p className="text-xs text-orange-600 mt-1 font-medium">
              💡 {lang === 'en' 
                ? `Fee ৳${fee} will be auto-recorded as expense from hand cash.` 
                : `ফি ৳${fee} স্বয়ংক্রিয়ভাবে হাতের ক্যাশ থেকে খরচ হিসেবে রেকর্ড হবে।`}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {lang === 'en' ? 'Note (Optional)' : 'বিবরণ / নোট (ঐচ্ছিক)'}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-300 rounded-xl p-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-xs font-medium bg-white"
            placeholder={lang === 'en' ? 'e.g. Bank deposit or cash withdrawal' : 'যেমন: ব্যাংকে জমা বা ক্যাশ উত্তোলন'}
          />
        </div>

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition-colors shadow-sm text-sm cursor-pointer"
        >
          {lang === 'en' ? 'Confirm Transfer' : 'ট্রান্সফার নিশ্চিত করুন'}
        </button>
      </form>
    </Modal>
  );
}
