import React from 'react';
import Modal from '../Shared/Modal';
import { useApp } from '../../context/AppContext';
import { t } from '../../data/translations';
import { formatBDT, formatBDTWithPrivacy, aggregateTransactions } from '../../data/calculations';
import { 
  ArrowDownLeft, ArrowUpRight, Wallet, Printer, 
  CheckCircle2, Sparkles, AlertCircle 
} from 'lucide-react';

export default function CashBoxReportModal({ isOpen, onClose }) {
  const { state } = useApp();
  const { language } = state;
  const lang = language || 'bn';
  const { dayData, activeBiz, isPrivacyMode } = state;

  if (!dayData) return null;

  const transactions = dayData.transactions || [];
  const aggregated = aggregateTransactions(transactions);

  const openingCash = dayData.wallets?.hand_cash?.opening || 0;
  const currentCash = dayData.wallets?.hand_cash?.current || 0;

  // Inflows (পেলাম 🟢)
  const inflowItems = [
    { label: t('cb_opening_cash', lang), amount: openingCash, tag: t('cb_start_badge', lang) },
    { label: t('cb_cash_sale', lang), amount: aggregated.stockSalesRevenue, tag: t('cb_sale_badge', lang) },
    ...(aggregated.rechargeTotal > 0 ? [{ label: t('cb_mobile_recharge_cash', lang), amount: aggregated.rechargeTotal, tag: t('cb_recharge_badge', lang) }] : []),
    ...(aggregated.servicesTotal > 0 ? [{ label: t('cb_service_income', lang), amount: aggregated.servicesTotal, tag: t('cb_service_badge', lang) }] : []),
    { label: t('cb_due_collection', lang), amount: aggregated.loanCollected, tag: t('cb_due_collect_badge', lang) },
    { label: t('cb_owner_gave', lang), amount: aggregated.ownerGave, tag: t('cb_owner_gave_badge', lang) },
    ...(aggregated.fundTransferCashIn > 0 ? [{ label: t('cb_wallet_withdraw', lang), amount: aggregated.fundTransferCashIn, tag: t('cb_withdraw_badge', lang) }] : []),
  ];

  const totalInflow = inflowItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  // Outflows (দিলাম 🔴)
  const ownerOutflow = (aggregated.ownerTook || 0) + (aggregated.personalDraw || 0);
  const outflowItems = [
    { label: t('cb_cash_purchase', lang), amount: aggregated.stockPurchasesCost, tag: t('cb_purchase_badge', lang) },
    { label: t('cb_shop_expense', lang), amount: aggregated.expenses, tag: t('cb_expense_badge', lang) },
    { label: t('cb_due_payment', lang), amount: aggregated.loanRepaid, tag: t('cb_debt_pay_badge', lang) },
    { label: t('cb_due_given', lang), amount: aggregated.loanGiven, tag: t('cb_due_badge', lang) },
    { label: t('cb_owner_took', lang), amount: ownerOutflow, tag: t('cb_owner_took_badge', lang) },
    ...(aggregated.fundTransferCashOut > 0 ? [{ label: t('cb_wallet_deposit', lang), amount: aggregated.fundTransferCashOut, tag: t('cb_deposit_badge', lang) }] : []),
  ];

  const totalOutflow = outflowItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  const calculatedRemainingCash = totalInflow - totalOutflow;
  const netCashChange = calculatedRemainingCash - openingCash;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("cb_title", lang)}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1 print:max-h-none print:overflow-visible">
        
        {/* Business and Date Header */}
        <div className="p-3 bg-slate-900 text-white rounded-xl flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-white">{activeBiz?.name}</h3>
            <p className="text-[11px] text-slate-300">{t("cb_date", lang)} {dayData.dateKey}</p>
          </div>
          <div className="text-right">
            <span className="text-xs bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-full">
              {t("cb_daily_ledger", lang)}
            </span>
          </div>
        </div>

        {/* Two-Column Ledger: পেলাম (Inflow) vs দিলাম (Outflow) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          
          {/* LEFT: পেলাম (Inflow 🟢) */}
          <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-emerald-200/80 mb-2.5">
                <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-xs sm:text-sm">
                  <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                  <span>{t("cb_inflow", lang)}</span>
                </div>
                <span className="text-xs bg-emerald-200 text-emerald-900 font-bold px-2 py-0.5 rounded-full">
                  {t("cb_deposit_plus", lang)}
                </span>
              </div>

              <div className="space-y-2">
                {inflowItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-emerald-100/60 last:border-0">
                    <span className="text-gray-700 leading-tight pr-2">{item.label}</span>
                    <span className="font-bold text-emerald-700 whitespace-nowrap">
                      +{formatBDTWithPrivacy(item.amount, isPrivacyMode, lang)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Inflow Total */}
            <div className="mt-3 pt-2.5 border-t-2 border-emerald-300 flex items-center justify-between">
              <span className="text-xs font-black text-emerald-900">{t("cb_total_inflow", lang)}</span>
              <span className="text-base font-black text-emerald-800">
                +{formatBDTWithPrivacy(totalInflow, isPrivacyMode, lang)}
              </span>
            </div>
          </div>

          {/* RIGHT: দিলাম (Outflow 🔴) */}
          <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-rose-200/80 mb-2.5">
                <div className="flex items-center gap-1.5 text-rose-800 font-bold text-xs sm:text-sm">
                  <ArrowUpRight className="w-4 h-4 text-rose-600" />
                  <span>{t("cb_outflow", lang)}</span>
                </div>
                <span className="text-xs bg-rose-200 text-rose-900 font-bold px-2 py-0.5 rounded-full">
                  {t("cb_expense_minus", lang)}
                </span>
              </div>

              <div className="space-y-2">
                {outflowItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-rose-100/60 last:border-0">
                    <span className="text-gray-700 leading-tight pr-2">{item.label}</span>
                    <span className="font-bold text-rose-700 whitespace-nowrap">
                      -{formatBDTWithPrivacy(item.amount, isPrivacyMode, lang)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Outflow Total */}
            <div className="mt-3 pt-2.5 border-t-2 border-rose-300 flex items-center justify-between">
              <span className="text-xs font-black text-rose-900">{t("cb_total_outflow", lang)}</span>
              <span className="text-base font-black text-rose-800">
                -{formatBDTWithPrivacy(totalOutflow, isPrivacyMode, lang)}
              </span>
            </div>
          </div>

        </div>

        {/* Final Cash Box Balance Summary Card */}
        <div className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-xs text-slate-300">{t("cb_current_balance", lang)}</p>
                <p className="text-xs text-slate-400">{t("cb_formula", lang)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl sm:text-3xl font-black text-emerald-400">
                {formatBDTWithPrivacy(calculatedRemainingCash, isPrivacyMode, lang)}
              </p>
              <p className="text-[11px] text-slate-300">
                {t("cb_net_change", lang)} {netCashChange >= 0 ? '+' : ''}{formatBDTWithPrivacy(netCashChange, isPrivacyMode, lang)}
              </p>
            </div>
          </div>

          <div className="border-t border-slate-700/80 pt-2 flex items-center justify-between text-xs text-slate-300">
            <span>{t("cb_opening_cash_prefix", lang)} {formatBDTWithPrivacy(openingCash, isPrivacyMode, lang)}</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              {t("cb_cash_match", lang)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-1 print:hidden">
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            {t("cb_print", lang)}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs sm:text-sm font-bold transition-all"
          >
            {t("cb_close", lang)}
          </button>
        </div>

      </div>
    </Modal>
  );
}
