// ── Audit Log Modal ─────────────────────────────────────────────────
// Displays immutable audit trail for the current day.
// Only visible to Owner role.

import { useState, useEffect } from 'react';
import { X, Shield, RotateCcw, Plus, Edit3, Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAppMode } from './ModeGuard';
import { useAuth } from '../../firebase/useAuth';
import { loadAuditLogByDate } from '../../firebase/auditService';
import { formatBDT } from '../../data/calculations';
import { getTxLabel } from '../../data/constants';
import Modal from './Modal';

const ACTION_CONFIG = {
  CREATE: { icon: Plus, label: 'তৈরি', label_en: 'Created', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  REVERSE: { icon: RotateCcw, label: 'রিভার্সাল', label_en: 'Reversed', color: 'text-red-600', bg: 'bg-red-50' },
  MODIFY: { icon: Edit3, label: 'সম্পাদনা', label_en: 'Modified', color: 'text-blue-600', bg: 'bg-blue-50' },
  BALANCE_EDIT: { icon: Edit3, label: 'ব্যালেন্স এডিট', label_en: 'Balance Edit', color: 'text-amber-600', bg: 'bg-amber-50' },
};

export default function AuditLogModal({ isOpen, onClose }) {
  const { state } = useApp();
  const { isEasy, isAdvanced } = useAppMode();
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const lang = state.language || 'bn';

  useEffect(() => {
    if (!isOpen || !isAdvanced || !user?.uid || !state.activeBizId || !state.dayData?.dateKey) return;
    
    setLoading(true);
    loadAuditLogByDate(user.uid, state.activeBizId, state.dayData.dateKey)
      .then(setEntries)
      .catch(err => console.error('Audit log load error:', err))
      .finally(() => setLoading(false));
  }, [isOpen, isAdvanced, user?.uid, state.activeBizId, state.dayData?.dateKey]);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">
              {lang === 'en' ? 'Audit Trail' : 'অডিট ট্রেইল'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {isAdvanced && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {lang === 'en' 
                ? 'Immutable record of all financial actions today' 
                : 'আজকের সকল আর্থিক কার্যক্রমের অপরিবর্তনীয় রেকর্ড'}
            </p>

            {/* Entries */}
            {loading ? (
              <div className="text-center py-8 text-gray-400">
                <Clock className="w-6 h-6 mx-auto animate-spin mb-2" />
                <p className="text-sm">{lang === 'en' ? 'Loading...' : 'লোড হচ্ছে...'}</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {lang === 'en' ? 'No audit entries for today' : 'আজকের জন্য কোনো অডিট এন্ট্রি নেই'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {entries.map((entry) => {
                  const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.CREATE;
                  const IconComp = config.icon;
                  const time = entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                  
                  return (
                    <div key={entry.id} className={`p-3 rounded-xl border ${config.bg} border-gray-200 dark:border-gray-700`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-1 rounded-lg ${config.bg}`}>
                            <IconComp className={`w-4 h-4 ${config.color}`} />
                          </div>
                          <div>
                            <span className={`text-xs font-semibold ${config.color}`}>
                              {lang === 'en' ? config.label_en : config.label}
                            </span>
                            {entry.txData?.type && (
                              <span className="text-xs text-gray-500 ml-1">
                                — {getTxLabel(entry.txData.type, lang)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-gray-400">{time}</span>
                      </div>
                      
                      {/* Amount */}
                      {entry.txData?.amount && (
                        <div className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                          {formatBDT(entry.txData.amount, lang)}
                          {entry.txData?.note && (
                            <span className="text-xs text-gray-500 ml-2">— {entry.txData.note}</span>
                          )}
                        </div>
                      )}

                      {/* Reason for reversal */}
                      {entry.reason && (
                        <div className="mt-1 text-xs text-gray-500 italic">
                          {lang === 'en' ? 'Reason' : 'কারণ'}: {entry.reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer */}
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-400 text-center">
                {lang === 'en' 
                  ? `${entries.length} entries — Records are permanent and cannot be deleted` 
                  : `${entries.length}টি এন্ট্রি — রেকর্ডগুলো স্থায়ী এবং মুছে ফেলা যাবে না`}
              </p>
            </div>
          </>
        )}

        {!isAdvanced && (
          <p className="text-sm text-gray-500 text-center py-8">{lang === 'en' ? 'Switch to Advanced Mode to see audit logs' : 'অডিট লগ দেখতে অ্যাডভান্সড মোডে যান'}</p>
        )}
      </div>
    </Modal>
  );
}
