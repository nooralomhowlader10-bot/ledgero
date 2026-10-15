import React, { useState, useRef } from 'react';
import Modal from '../Shared/Modal';
import { useApp } from '../../context/AppContext';
import { formatBDT } from '../../data/calculations';
import { VAT_RATES, calcVAT } from '../../data/constants';
import { FileText, Plus, Trash2, Printer, Download } from 'lucide-react';

export default function InvoiceModal({ isOpen, onClose, contact }) {
  const { state, dispatch } = useApp();
  const lang = state.language || 'bn';
  const activeBiz = state.activeBiz;
  const invoiceRef = useRef(null);

  const [items, setItems] = useState([
    { id: 1, name: '', qty: 1, price: 0, vatRate: 0 }
  ]);
  const [invoiceNote, setInvoiceNote] = useState('');
  const [globalVatRate, setGlobalVatRate] = useState(0);
  const [paymentTerms, setPaymentTerms] = useState('due_on_receipt');
  const [templateType, setTemplateType] = useState('standard'); // 'standard' | 'mushak_6_3'
  const [customerBIN, setCustomerBIN] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  const nextSeq = (state.lastInvoiceSeq || 0) + 1;
  const invoiceNumber = `INV-${new Date().getFullYear()}-${String(nextSeq).padStart(4, '0')}`;

  const todayStr = new Date().toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const getDueDate = () => {
    const d = new Date();
    if (paymentTerms === 'net_7') d.setDate(d.getDate() + 7);
    else if (paymentTerms === 'net_15') d.setDate(d.getDate() + 15);
    else if (paymentTerms === 'net_30') d.setDate(d.getDate() + 30);
    return d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  const addItem = () => {
    setItems([...items, { id: Date.now(), name: '', qty: 1, price: 0, vatRate: globalVatRate }]);
  };

  const removeItem = (id) => {
    if (items.length <= 1) return;
    setItems(items.filter(i => i.id !== id));
  };

  const updateItem = (id, field, value) => {
    setItems(items.map(i => i.id === id ? { ...i, [field]: value } : i));
  };

  const subtotal = items.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const totalVat = items.reduce((sum, i) => {
    const lineTotal = (Number(i.qty) || 0) * (Number(i.price) || 0);
    const rate = Number(i.vatRate) || globalVatRate;
    return sum + Math.round((lineTotal * rate) / 100);
  }, 0);
  const grandTotal = subtotal + totalVat;

  const handleSaveAndPrint = () => {
    const invoiceRecord = {
      id: `inv_${Date.now()}`,
      invoiceNumber,
      contactId: contact?.id || null,
      customerName: contact?.name || 'Walk-in Customer',
      customerPhone: contact?.phone || '',
      customerBIN: customerBIN || '',
      date: new Date().toISOString(),
      dueDate: getDueDate(),
      paymentTerms,
      templateType,
      items: items.filter(i => i.name.trim()),
      subtotal,
      vatAmount: totalVat,
      total: grandTotal,
      paidAmount: 0,
      dueAmount: grandTotal,
      status: 'due',
      note: invoiceNote,
    };

    dispatch({ type: 'SAVE_INVOICE', payload: invoiceRecord });
    setIsSaved(true);

    const content = invoiceRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>${invoiceNumber} - ${activeBiz?.name || 'Invoice'}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; max-width: 800px; margin: 0 auto; color: #111827; }
            .header-box { border-bottom: 2px solid #047857; padding-bottom: 16px; margin-bottom: 20px; }
            .mushak-header { text-align: center; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 14px; }
            .mushak-title { font-size: 16px; font-weight: 800; }
            .mushak-sub { font-size: 11px; color: #444; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; }
            th { background: #f3f4f6; text-align: left; padding: 8px; font-size: 11px; font-weight: bold; border: 1px solid #d1d5db; }
            td { padding: 8px; font-size: 12px; border: 1px solid #e5e7eb; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .footer { margin-top: 30px; font-size: 11px; color: #6b7280; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 10px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          ${content.innerHTML}
          <div class="footer">${lang === 'en' ? "Powered by Ledgero — Digital Accounting for Business" : "Powered by Ledgero — দোকানের ডিজিটাল হিসাবরক্ষক"}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={lang === 'en' ? 'Invoice & Billing' : 'চালান ও ইনভয়েস'}>
      <div className="space-y-4 max-h-[82vh] overflow-y-auto pr-1">

        {/* Template Selector & Controls */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {lang === 'en' ? 'Invoice Format:' : 'চালানের ধরন:'}
            </span>
            <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 p-0.5 bg-white dark:bg-slate-900 text-xs font-bold">
              <button
                type="button"
                onClick={() => setTemplateType('standard')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  templateType === 'standard' 
                    ? 'bg-emerald-600 text-white shadow-xs' 
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {lang === 'en' ? '📄 Standard' : '📄 সাধারণ'}
              </button>
              <button
                type="button"
                onClick={() => setTemplateType('mushak_6_3')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  templateType === 'mushak_6_3' 
                    ? 'bg-purple-600 text-white shadow-xs' 
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {lang === 'en' ? '🏛️ NBR Mushak-6.3' : '🏛️ সরকারি মূসক-৬.৩'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {lang === 'en' ? 'Terms:' : 'পরিশোধের মেয়াদ:'}
            </span>
            <select
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              className="px-2.5 py-1 text-xs font-bold border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 cursor-pointer"
            >
              <option value="due_on_receipt">{lang === 'en' ? 'Due on Receipt' : 'তাৎক্ষণিক প্রদেয়'}</option>
              <option value="net_7">{lang === 'en' ? 'Net 7 Days' : '৭ দিনের মধ্যে'}</option>
              <option value="net_15">{lang === 'en' ? 'Net 15 Days' : '১৫ দিনের মধ্যে'}</option>
              <option value="net_30">{lang === 'en' ? 'Net 30 Days' : '৩০ দিনের মধ্যে'}</option>
            </select>
          </div>
        </div>

        {/* Invoice Preview */}
        <div ref={invoiceRef} className="p-5 bg-white border border-gray-200 rounded-xl text-gray-900">
          {templateType === 'mushak_6_3' ? (
            /* Official Bangladesh NBR Mushak-6.3 Layout */
            <div>
              <div className="mushak-header text-center border-b pb-2 mb-3">
                <p className="text-xs font-bold text-gray-700">
                  {lang === 'en' ? "Government of the People's Republic of Bangladesh, National Board of Revenue" : 'গণপ্রজাতন্ত্রী বাংলাদেশ সরকার, জাতীয় রাজস্ব বোর্ড'}
                </p>
                <h2 className="text-base font-black text-gray-950 mt-0.5">
                  {lang === 'en' ? 'Tax Invoice (Mushak-6.3)' : 'কর চালানপত্র (মূসক-৬.৩)'}
                </h2>
                <p className="text-xs text-gray-500">
                  {lang === 'en' ? '[See clause (c) of sub-rule (1) of rule 40]' : '[বিধি ৪০ এর উপবিধি (১) এর দফা (গ) দ্রষ্টব্য]'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                <div className="p-2 border border-gray-200 rounded-lg bg-gray-50/60">
                  <p className="text-xs font-bold text-gray-400 uppercase">
                    {lang === 'en' ? 'Seller Details' : 'নিবন্ধিত ব্যক্তির বিবরণ (Seller)'}
                  </p>
                  <p className="font-bold text-sm text-gray-900">{activeBiz?.name || (lang === 'en' ? 'My Shop' : 'ব্যবসায় প্রতিষ্ঠানের নাম')}</p>
                  <p className="text-[11px] text-gray-600">{activeBiz?.address || (lang === 'en' ? 'Address: Bangladesh' : 'ঠিকানা: বাংলাদেশ')}</p>
                  <p className="text-[11px] text-gray-700 font-semibold">BIN: {activeBiz?.bin || '123456789-0101'}</p>
                </div>
                <div className="p-2 border border-gray-200 rounded-lg bg-gray-50/60">
                  <p className="text-xs font-bold text-gray-400 uppercase">
                    {lang === 'en' ? 'Buyer Details' : 'ক্রেতার বিবরণ (Buyer)'}
                  </p>
                  <p className="font-bold text-sm text-gray-900">{contact?.name || (lang === 'en' ? 'Retail Customer' : 'খুচরা গ্রাহক')}</p>
                  <p className="text-[11px] text-gray-600">{contact?.phone || (lang === 'en' ? 'Phone: N/A' : 'মোবাইল: প্রযোজ্য নয়')}</p>
                  <p className="text-[11px] text-gray-700 font-semibold">
                    {lang === 'en' ? `Buyer BIN/NID: ${customerBIN || 'N/A'}` : `ক্রেতার BIN/NID: ${customerBIN || 'প্রযোজ্য নয়'}`}
                  </p>
                </div>
              </div>

              <div className="flex justify-between items-center text-xs pb-2 mb-2 border-b border-gray-200">
                <span>{lang === 'en' ? 'Challan No: ' : 'চালান নম্বর: '}<strong className="font-black text-gray-900">{invoiceNumber}</strong></span>
                <span>{lang === 'en' ? 'Issue Date: ' : 'ইস্যুর তারিখ: '}<strong>{todayStr}</strong> ({lang === 'en' ? 'Due: ' : 'মেয়াদ: '}<strong>{getDueDate()}</strong>)</span>
              </div>
            </div>
          ) : (
            /* Modern Standard Invoice Layout */
            <div>
              <div className="header-box flex justify-between items-start pb-3 border-b-2 border-emerald-600 mb-3">
                <div>
                  <h1 className="text-xl font-black text-gray-900 tracking-tight">{activeBiz?.name || 'My Shop'}</h1>
                  <p className="text-xs text-emerald-700 font-bold uppercase tracking-wider">{lang === 'en' ? 'Sales Invoice' : 'বিক্রয় চালান'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-gray-800">{invoiceNumber}</p>
                  <p className="text-xs text-gray-500">{todayStr}</p>
                  <p className="text-[11px] text-amber-700 font-semibold mt-0.5">
                    {lang === 'en' ? 'Due Date:' : 'পরিশোধের শেষ তারিখ:'} {getDueDate()}
                  </p>
                </div>
              </div>

              {contact && (
                <div className="mb-3 p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                  <p className="text-xs text-gray-400 font-bold uppercase">{lang === 'en' ? 'Bill To' : 'প্রাপক'}</p>
                  <p className="text-sm font-bold text-gray-900">{contact.name}</p>
                  {contact.phone && <p className="text-xs text-gray-600">{contact.phone}</p>}
                </div>
              )}
            </div>
          )}

          {/* Line Items Table */}
          <table className="w-full text-xs border border-gray-200">
            <thead>
              <tr className="bg-gray-100 text-gray-800">
                <th className="text-left p-2 border">{lang === 'en' ? 'SL' : 'ক্র:'}</th>
                <th className="text-left p-2 border">{lang === 'en' ? 'Item Description' : 'পণ্য বা সেবার বিবরণ'}</th>
                <th className="text-center p-2 border w-16">{lang === 'en' ? 'Qty' : 'পরিমাণ'}</th>
                <th className="text-right p-2 border w-24">{lang === 'en' ? 'Unit Price' : 'একক মূল্য'}</th>
                {totalVat > 0 && <th className="text-right p-2 border w-20">{lang === 'en' ? 'VAT (%)' : 'মূসক'}</th>}
                <th className="text-right p-2 border w-24">{lang === 'en' ? 'Total (Tk)' : 'মোট মূল্য'}</th>
              </tr>
            </thead>
            <tbody>
              {items.filter(i => i.name.trim()).map((item, idx) => {
                const lineTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);
                const rate = Number(item.vatRate) || globalVatRate;
                const { vatAmount } = calcVAT(lineTotal, rate);
                return (
                  <tr key={item.id} className="border-b border-gray-200">
                    <td className="p-2 border text-center text-gray-500">{idx + 1}</td>
                    <td className="p-2 border font-bold text-gray-900">{item.name}</td>
                    <td className="p-2 border text-center font-semibold">{item.qty}</td>
                    <td className="p-2 border text-right">{formatBDT(item.price, lang)}</td>
                    {totalVat > 0 && (
                      <td className="p-2 border text-right font-medium text-amber-700">
                        {rate}% ({formatBDT(vatAmount, lang)})
                      </td>
                    )}
                    <td className="p-2 border text-right font-black text-gray-900">{formatBDT(lineTotal + vatAmount, lang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totals Summary */}
          <div className="mt-3 flex justify-end">
            <div className="w-64 space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>{lang === 'en' ? 'Subtotal' : 'উপমোট মূল্য'}:</span>
                <span className="font-bold">{formatBDT(subtotal, lang)}</span>
              </div>
              {totalVat > 0 && (
                <div className="flex justify-between text-amber-700 font-semibold">
                  <span>{lang === 'en' ? 'VAT / Tax' : 'মোট মূসক (ভ্যাট)'}:</span>
                  <span>{formatBDT(totalVat, lang)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-gray-950 pt-2 border-t-2 border-gray-900">
                <span>{lang === 'en' ? 'Grand Total' : 'সর্বমোট প্রদেয়'}:</span>
                <span className="text-emerald-700">{formatBDT(grandTotal, lang)}</span>
              </div>
            </div>
          </div>

          {invoiceNote && (
            <div className="mt-4 p-2 bg-amber-50 rounded-lg text-xs text-amber-800 border border-amber-200">
              <strong>{lang === 'en' ? 'Note:' : 'শর্তাবলী / নোট:'}</strong> {invoiceNote}
            </div>
          )}
        </div>

        {/* Customer BIN input for Mushak 6.3 */}
        {templateType === 'mushak_6_3' && (
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {lang === 'en' ? "Buyer's BIN / NID Number" : 'ক্রেতার বিআইএন (BIN) বা জাতীয় পরিচয়পত্র নম্বর'}
            </label>
            <input
              type="text"
              value={customerBIN}
              onChange={(e) => setCustomerBIN(e.target.value)}
              placeholder="e.g. 001234567-0202"
              className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg text-xs bg-white dark:bg-slate-800"
            />
          </div>
        )}

        {/* Line Item Editor */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{lang === 'en' ? 'Invoice Items:' : 'পণ্যের তালিকা:'}</p>
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-12 gap-1.5 items-center">
              <input
                type="text"
                placeholder={lang === 'en' ? 'Item name' : 'পণ্যের নাম'}
                value={item.name}
                onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                className="col-span-5 px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800"
              />
              <input
                type="number"
                min="1"
                value={item.qty}
                onChange={(e) => updateItem(item.id, 'qty', e.target.value)}
                className="col-span-2 px-2 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-center bg-white dark:bg-slate-800"
              />
              <input
                type="number"
                min="0"
                placeholder="0"
                value={item.price || ''}
                onChange={(e) => updateItem(item.id, 'price', e.target.value)}
                className="col-span-3 px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold bg-white dark:bg-slate-800"
              />
              <div className="col-span-2 flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500">{formatBDT((Number(item.qty) || 0) * (Number(item.price) || 0), lang)}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(item.id)} className="text-rose-400 hover:text-rose-600 cursor-pointer p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer pt-1"
          >
            <Plus className="w-3.5 h-3.5" /> {lang === 'en' ? '+ Add Another Item' : '+ আরও পণ্য যোগ করুন'}
          </button>
        </div>

        {/* VAT Selector */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            {lang === 'en' ? 'VAT Rate (%):' : 'ভ্যাট / মূসক হার (%):'}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {VAT_RATES.filter(v => v.id !== 'custom').map((vat) => (
              <button
                key={vat.id}
                type="button"
                onClick={() => setGlobalVatRate(vat.rate)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  globalVatRate === vat.rate
                    ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-400'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300'
                }`}
              >
                {lang === 'en' ? vat.label : vat.label_bn}
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <div>
          <input
            type="text"
            value={invoiceNote}
            onChange={(e) => setInvoiceNote(e.target.value)}
            placeholder={lang === 'en' ? 'Invoice remarks / terms (optional)' : 'নোট বা শর্তাবলী (ঐচ্ছিক)'}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-xs bg-white dark:bg-slate-800"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleSaveAndPrint}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            {lang === 'en' ? 'Save & Print Invoice' : 'সংরক্ষণ ও প্রিন্ট করুন'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {lang === 'en' ? 'Close' : 'বন্ধ'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
