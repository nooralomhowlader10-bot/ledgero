import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import Modal from './Modal';
import { formatBDT, roundBDT } from '../../data/calculations';
import { getWalletLabel } from '../../data/constants';
import { Edit3, Calculator, Check, AlertCircle, Sparkles } from 'lucide-react';

export default function EditProductModal({ isOpen, onClose, item }) {
  const { state, dispatch } = useApp();
  const { language, dayData } = state;
  const lang = language || 'bn';
  const isEn = lang === 'en';

  const [activeTab, setActiveTab] = useState('info'); // 'info' or 'restock'

  // Tab 1: Edit Info state
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('পিস');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [openingStock, setOpeningStock] = useState('');

  // Tab 2: Restock & WAC state
  const [addedQty, setAddedQty] = useState('');
  const [newBuyPrice, setNewBuyPrice] = useState('');
  const [newSellPrice, setNewSellPrice] = useState('');
  const [deductFromWallet, setDeductFromWallet] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('hand_cash');

  const [error, setError] = useState('');

  const wallets = dayData?.wallets || {};
  const walletKeys = (dayData?.walletOrder && dayData.walletOrder.length > 0)
    ? [
        ...dayData.walletOrder.filter(k => Object.keys(wallets).includes(k)),
        ...Object.keys(wallets).filter(k => !dayData.walletOrder.includes(k))
      ]
    : Object.keys(wallets);

  useEffect(() => {
    if (item) {
      setName(item.name || '');
      setUnit(item.unit || 'পিস');
      setBuyPrice(String(item.buyPrice ?? 0));
      setSellPrice(String(item.sellPrice ?? 0));
      setOpeningStock(String(item.openingStock ?? 0));

      setAddedQty('');
      setNewBuyPrice(String(item.buyPrice ?? ''));
      setNewSellPrice('');
      setDeductFromWallet(false);
      setSelectedWallet('hand_cash');
      setError('');
      setActiveTab('info');
    }
  }, [item, isOpen]);

  // Existing numbers
  const existingStock = (Number(item?.openingStock) || 0) + (Number(item?.addedStock) || 0);
  const existingBuyPrice = Number(item?.buyPrice) || 0;
  const existingSellPrice = Number(item?.sellPrice) || 0;

  // WAC calculation for Tab 2
  const wacCalculation = useMemo(() => {
    const qtyToAdd = parseFloat(addedQty) || 0;
    const unitCost = parseFloat(newBuyPrice) || 0;

    if (qtyToAdd <= 0) {
      return {
        totalStock: existingStock,
        wacBuyPrice: existingBuyPrice,
        effectiveSellPrice: parseFloat(newSellPrice) || existingSellPrice,
        totalCost: 0,
        margin: (parseFloat(newSellPrice) || existingSellPrice) - existingBuyPrice,
        isValid: false,
      };
    }

    const existingTotalValue = existingStock * existingBuyPrice;
    const newTotalValue = qtyToAdd * unitCost;
    const totalStock = existingStock + qtyToAdd;
    const wacBuyPrice = totalStock > 0 ? roundBDT((existingTotalValue + newTotalValue) / totalStock) : unitCost;
    const effectiveSellPrice = parseFloat(newSellPrice) || existingSellPrice;
    const margin = effectiveSellPrice - wacBuyPrice;

    return {
      totalStock,
      wacBuyPrice,
      effectiveSellPrice,
      totalCost: roundBDT(qtyToAdd * unitCost),
      margin: roundBDT(margin),
      marginPercent: effectiveSellPrice > 0 ? roundBDT((margin / effectiveSellPrice) * 100) : 0,
      isValid: true,
    };
  }, [addedQty, newBuyPrice, newSellPrice, existingStock, existingBuyPrice, existingSellPrice]);

  if (!item) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (activeTab === 'info') {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError(isEn ? 'Please enter product name.' : 'অনুগ্রহ করে পণ্যের নাম লিখুন।');
        return;
      }

      const numBuyPrice = parseFloat(buyPrice);
      const numSellPrice = parseFloat(sellPrice);
      const numOpeningStock = parseFloat(openingStock);

      if (isNaN(numBuyPrice) || numBuyPrice < 0) {
        setError(isEn ? 'Invalid buy price.' : 'সঠিক ক্রয়মূল্য লিখুন।');
        return;
      }

      if (isNaN(numSellPrice) || numSellPrice < 0) {
        setError(isEn ? 'Invalid sell price.' : 'সঠিক বিক্রয়মূল্য লিখুন।');
        return;
      }

      dispatch({
        type: 'UPDATE_INVENTORY_ITEM',
        payload: {
          id: item.id,
          name: trimmedName,
          unit: unit.trim() || 'পিস',
          buyPrice: numBuyPrice,
          sellPrice: numSellPrice,
          openingStock: isNaN(numOpeningStock) ? item.openingStock : numOpeningStock,
        }
      });

      onClose();
    } else {
      // Restock & WAC Tab
      const qtyToAdd = parseFloat(addedQty) || 0;
      const unitCost = parseFloat(newBuyPrice) || 0;

      if (qtyToAdd <= 0) {
        setError(isEn ? 'Please enter quantity to restock.' : 'যোগ করার পরিমাণ লিখুন (০ এর বেশি)।');
        return;
      }

      if (unitCost <= 0) {
        setError(isEn ? 'Please enter new purchase unit price.' : 'নতুন প্রতি পিসের ক্রয়মূল্য লিখুন।');
        return;
      }

      // Update product with WAC
      dispatch({
        type: 'UPDATE_INVENTORY_ITEM',
        payload: {
          id: item.id,
          addedStock: (Number(item.addedStock) || 0) + qtyToAdd,
          buyPrice: wacCalculation.wacBuyPrice,
          ...(newSellPrice && { sellPrice: parseFloat(newSellPrice) || item.sellPrice })
        }
      });

      // If user checked pre-opening purchase deduction
      if (deductFromWallet && wacCalculation.totalCost > 0) {
        dispatch({
          type: 'RECORD_OPENING_ADJUSTMENT',
          payload: {
            walletKey: selectedWallet,
            amount: wacCalculation.totalCost,
            type: 'stock_purchase',
            isPreOpeningPurchase: true,
            itemId: item.id,
            itemName: item.name,
            quantity: qtyToAdd,
            note: lang === 'en' ? `${item.name} stock restock (${qtyToAdd} ${item.unit || 'pcs'} @ ৳${unitCost})` : `${item.name} নতুন স্টক ক্রয় (${qtyToAdd} ${item.unit || 'পিস'} @ ৳${unitCost})`
          }
        });
      }

      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEn ? `Edit Product: ${item.name}` : `পণ্য এডিট ও রিস্টক: ${item.name}`}
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setActiveTab('info')}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'info'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            <Edit3 className="w-4 h-4" />
            <span>{isEn ? 'Edit Info' : 'মৌলিক তথ্য পরিবর্তন'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('restock')}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'restock'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            <Calculator className="w-4 h-4" />
            <span>{isEn ? 'Restock & Average Cost' : 'নতুন স্টক ও গড় ক্রয়মূল্য (WAC)'}</span>
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* TAB 1: Edit Info */}
          {activeTab === 'info' && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isEn ? 'Product Name *' : 'পণ্যের নাম *'}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isEn ? 'Unit *' : 'পরিমাপের একক *'}
                  </label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer"
                  >
                    <option value="পিস">{isEn ? 'Piece (pcs)' : 'পিস (pcs)'}</option>
                    <option value="কেজি">{isEn ? 'Kilogram (kg)' : 'কেজি (kg)'}</option>
                    <option value="গ্রাম">{isEn ? 'Gram (gm)' : 'গ্রাম (gm)'}</option>
                    <option value="লিটার">{isEn ? 'Liter (ltr)' : 'লিটার (ltr)'}</option>
                    <option value="প্যাকেট">{isEn ? 'Packet (pkt)' : 'প্যাকেট (pkt)'}</option>
                    <option value="ডজন">{isEn ? 'Dozen (doz)' : 'ডজন (doz)'}</option>
                    <option value="বক্স">{isEn ? 'Box (box)' : 'বক্স (box)'}</option>
                    <option value="কার্টন">{isEn ? 'Carton (ctn)' : 'কার্টন (ctn)'}</option>
                    <option value="মিটার">{isEn ? 'Meter (m)' : 'মিটার (m)'}</option>
                    <option value="বস্তা">{isEn ? 'Sack (sack)' : 'বস্তা (sack)'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isEn ? 'Opening Stock' : 'প্রারম্ভিক স্টক'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={openingStock}
                    onChange={(e) => setOpeningStock(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isEn ? 'Cost / Buy Price (Tk) *' : 'ক্রয়মূল্য (টাকা) *'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={buyPrice}
                    onChange={(e) => setBuyPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isEn ? 'Selling Price (Tk) *' : 'বিক্রয়মূল্য (টাকা) *'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Restock & WAC */}
          {activeTab === 'restock' && (
            <div className="space-y-3.5">
              {/* Current Stock Banner */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">{isEn ? 'Current In Stock' : 'বর্তমানে স্টকে আছে'}</span>
                  <strong className="text-sm text-gray-800 dark:text-gray-200">{existingStock} {isEn ? (item.unit === 'পিস' ? 'pcs' : item.unit) : (item.unit || 'পিস')}</strong>
                </div>
                <div className="text-right">
                  <span className="text-gray-500 dark:text-gray-400 block">{isEn ? 'Current Buy Price' : 'বর্তমান কেনা দাম'}</span>
                  <strong className="text-sm text-indigo-600 dark:text-indigo-400">{formatBDT(existingBuyPrice, lang)}</strong>
                </div>
              </div>

              {/* Added Stock and New Buy Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isEn ? 'New Added Qty *' : 'নতুন যোগ করা পরিমাণ *'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={addedQty}
                    onChange={(e) => setAddedQty(e.target.value)}
                    placeholder={isEn ? "e.g., 10" : "যেমন: 10"}
                    className="w-full px-3 py-2 border border-emerald-300 dark:border-emerald-600 rounded-xl text-sm font-black bg-emerald-50/40 dark:bg-emerald-950/20 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isEn ? 'New Buy Price per unit *' : 'নতুন প্রতি পিসের ক্রয়মূল্য *'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={newBuyPrice}
                    onChange={(e) => setNewBuyPrice(e.target.value)}
                    placeholder={isEn ? "e.g., 15" : "যেমন: 15"}
                    className="w-full px-3 py-2 border border-emerald-300 dark:border-emerald-600 rounded-xl text-sm font-black bg-emerald-50/40 dark:bg-emerald-950/20 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    required
                  />
                </div>
              </div>

              {/* Optional New Selling Price */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center justify-between">
                  <span>{isEn ? 'New Selling Price (Optional)' : 'নতুন বিক্রয়মূল্য (ঐচ্ছিক)'}</span>
                  <span className="text-xs text-gray-400">
                    {isEn ? `Current: ${formatBDT(existingSellPrice, 'en')}` : `বর্তমান: ${formatBDT(existingSellPrice, 'bn')}`}
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={newSellPrice}
                  onChange={(e) => setNewSellPrice(e.target.value)}
                  placeholder={isEn ? `Leave blank to keep ৳${existingSellPrice}` : `ফাঁকা রাখলে বর্তমান ৳${existingSellPrice}-ই থাকবে`}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Live WAC Result Card */}
              {wacCalculation.isValid && (
                <div className="p-3.5 bg-gradient-to-br from-indigo-50 to-emerald-50 dark:from-indigo-950/40 dark:to-emerald-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900 dark:text-indigo-300">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>{isEn ? 'IAS 2 Weighted Average Calculation' : 'গড় ক্রয়মূল্য হিসাব (Weighted Average Cost)'}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center pt-1">
                    <div className="p-2 bg-white/70 dark:bg-slate-800/80 rounded-lg">
                      <span className="text-xs text-gray-500 dark:text-gray-400 block">{isEn ? 'Total Stock' : 'মোট নতুন স্টক'}</span>
                      <strong className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {wacCalculation.totalStock} {isEn ? (item.unit === 'পিস' ? 'pcs' : item.unit) : (item.unit || 'পিস')}
                      </strong>
                    </div>

                    <div className="p-2 bg-white/70 dark:bg-slate-800/80 rounded-lg ring-1 ring-indigo-400">
                      <span className="text-xs text-indigo-600 dark:text-indigo-400 block font-bold">{isEn ? 'New Avg Cost' : 'নতুন গড় ক্রয়মূল্য'}</span>
                      <strong className="text-sm font-black text-indigo-700 dark:text-indigo-300">
                        {formatBDT(wacCalculation.wacBuyPrice, lang)}
                      </strong>
                    </div>

                    <div className="p-2 bg-white/70 dark:bg-slate-800/80 rounded-lg">
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 block font-bold">{isEn ? 'Unit Profit' : 'সম্ভাব্য লাভ'}</span>
                      <strong className="text-sm font-black text-emerald-700 dark:text-emerald-400">
                        {formatBDT(wacCalculation.margin, lang)}
                      </strong>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {isEn
                      ? `Calculation: (${existingStock} × Tk ${existingBuyPrice} + ${addedQty} × Tk ${newBuyPrice}) ÷ ${wacCalculation.totalStock} = Tk ${wacCalculation.wacBuyPrice}/unit`
                      : `হিসাব সূত্র: (${existingStock} × ৳${existingBuyPrice} + ${addedQty} × ৳${newBuyPrice}) ÷ ${wacCalculation.totalStock} = ৳${wacCalculation.wacBuyPrice} প্রতি ইউনিট`}
                  </p>
                </div>
              )}

              {/* Pre-opening purchase wallet deduction checkbox */}
              <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl space-y-2.5">
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deductFromWallet}
                    onChange={(e) => setDeductFromWallet(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-gray-900 dark:text-gray-100 block">
                      {isEn ? 'Deduct stock purchase from morning cash/wallet?' : 'দোকান খোলার পূর্বে ক্যাশ/ওয়ালেট থেকে এই স্টকের টাকা পরিশোধ হয়েছে?'}
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 block">
                      {isEn
                        ? 'Will adjust opening balance & record pre-opening purchase transaction for zero audit discrepancy.'
                        : 'এটি ওপেনিং ব্যালেন্স থেকে মোট ক্রয়মূল্য সমন্বয় করবে এবং ট্রানজেকশনে সকালের এন্ট্রি রাখবে।'}
                    </span>
                  </div>
                </label>

                {deductFromWallet && (
                  <div className="pt-2 border-t border-amber-200 dark:border-amber-800/40 flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 mb-1">
                        {isEn ? 'Payment Wallet:' : 'যে ওয়ালেট থেকে টাকা গেছে:'}
                      </label>
                      <select
                        value={selectedWallet}
                        onChange={(e) => setSelectedWallet(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-amber-300 dark:border-amber-700 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                      >
                        {walletKeys.map(k => (
                          <option key={k} value={k}>
                            {wallets[k]?.label || getWalletLabel(k, lang, wallets[k])} ({formatBDT(wallets[k]?.current || 0, lang)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs text-gray-500 block">{isEn ? 'Deduction Amount' : 'কাটা হবে'}</span>
                      <strong className="text-sm font-black text-rose-600">
                        -{formatBDT(wacCalculation.totalCost, lang)}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Check className="w-4 h-4" />
              <span>
                {activeTab === 'info'
                  ? (isEn ? 'Save Product Info' : 'তথ্য সংরক্ষণ করুন')
                  : (isEn ? 'Apply Restock & WAC' : 'রিস্টক ও গড় দাম আপডেট')}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              {isEn ? 'Cancel' : 'বাতিল'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
