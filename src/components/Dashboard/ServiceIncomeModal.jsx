import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import Modal from '../Shared/Modal';
import { TX_TYPES, SERVICE_TYPES, SERVICE_LABELS } from '../../data/constants';

export default function ServiceIncomeModal({ isOpen, onClose }) {
  const { dispatch } = useApp();
  
  const [serviceType, setServiceType] = useState(SERVICE_TYPES.PHOTOCOPY);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const resetForm = () => {
    setServiceType(SERVICE_TYPES.PHOTOCOPY);
    setAmount('');
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

    const incomeAmount = Number(amount);

    if (!incomeAmount || incomeAmount <= 0) {
      setError('Amount must be greater than 0.');
      return;
    }

    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        type: TX_TYPES.SERVICE_INCOME,
        serviceType,
        amount: incomeAmount,
        note
      }
    });

    handleClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Service Income">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-rose-50 text-rose-500 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Service Type</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="serviceType"
                value={SERVICE_TYPES.PHOTOCOPY}
                checked={serviceType === SERVICE_TYPES.PHOTOCOPY}
                onChange={(e) => setServiceType(e.target.value)}
                className="text-teal-500 focus:ring-teal-500"
              />
              <span className="text-gray-700">{SERVICE_LABELS[SERVICE_TYPES.PHOTOCOPY]}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="serviceType"
                value={SERVICE_TYPES.STUDIO}
                checked={serviceType === SERVICE_TYPES.STUDIO}
                onChange={(e) => setServiceType(e.target.value)}
                className="text-teal-500 focus:ring-teal-500"
              />
              <span className="text-gray-700">{SERVICE_LABELS[SERVICE_TYPES.STUDIO]}</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="0"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Note (Optional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="Details"
          />
        </div>

        <div className="pt-4">
          <button
            type="submit"
            className="w-full bg-teal-500 hover:bg-teal-600 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            Add Income
          </button>
        </div>
      </form>
    </Modal>
  );
}
