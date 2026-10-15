import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../firebase/useAuth';
import { deleteAllUserData, exportAllCloudData, restoreAllCloudData, migrateAllBusinessesHistoricalTrxRegistry } from '../../firebase/firestoreService';
import { exportAllData, importAllData, validateBackupPayload } from '../../data/storage';
import { t } from '../../data/translations';
import { FEATURE_META } from '../../data/constants';
import { Users, UserCheck, Shield, Trash2, AlertTriangle, Loader2, Sparkles, Zap, GraduationCap, Database, Download, Upload, CheckCircle2, RefreshCw, Cloud, CloudDownload, FileSpreadsheet, HardDrive, Copy, Check } from 'lucide-react';

export default function ProfileModal({ isOpen, onClose, onOpenTutorial, isDemoMode = false, onToggleDemoMode = () => {} }) {
  const { state, dispatch } = useApp();
  const { user, signOut, reauthWithGoogle, deleteAccount } = useAuth();
  
  const { activeBiz, language, isDarkMode, autoCloseTime: stateAutoClose, autoOpenTime: stateAutoOpen, autoCloseEnabled: stateAutoEnabled, editLockEnabled, editLockPinHash, sheetsWebAppUrl: stateSheetsUrl } = state;
  const lang = language || 'bn';

  const [shopName, setShopName] = useState('');
  const [shopType, setShopType] = useState('');
  const [autoClose, setAutoClose] = useState(stateAutoClose || '01:00');
  const [autoOpen, setAutoOpen] = useState(stateAutoOpen || '08:00');
  const [autoEnabled, setAutoEnabled] = useState(stateAutoEnabled || false);
  const [sheetsUrl, setSheetsUrl] = useState(stateSheetsUrl || '');

  // Edit Lock state
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');
  const [showDisablePin, setShowDisablePin] = useState(false);
  const [forgotPinMode, setForgotPinMode] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  // Backup & Restore state
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupStatus, setBackupStatus] = useState(null); // { type: 'success' | 'error', message: string }
  const [pendingRestore, setPendingRestore] = useState(null); // { rawJson, parsed, preview }
  const [isCheckingCloudSnapshot, setIsCheckingCloudSnapshot] = useState(false);
  const [cloudSnapshot, setCloudSnapshot] = useState(null); // { preview, warning, exportedAt, rawJson, parsed }
  const [restoreStep, setRestoreStep] = useState(null); // 'downloading' | 'verifying' | 'hydrating' | 'done'
  const [copiedUid, setCopiedUid] = useState(false);
  const [isMigratingTrx, setIsMigratingTrx] = useState(false);
  const [trxMigrationReport, setTrxMigrationReport] = useState(null);

  // Delete Account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (activeBiz) {
      setShopName(activeBiz.name || '');
      setShopType(activeBiz.type || '');
    }
    setAutoClose(stateAutoClose || '01:00');
    setAutoOpen(stateAutoOpen || '08:00');
    setAutoEnabled(stateAutoEnabled || false);
  }, [activeBiz, stateAutoClose, stateAutoOpen, stateAutoEnabled, isOpen]);

  if (!isOpen) return null;

  const handleSaveShop = () => {
    if (activeBiz && activeBiz.id) {
      dispatch({
        type: 'UPDATE_BUSINESS',
        payload: { id: activeBiz.id, name: shopName, type: shopType }
      });
    }
  };

  const handleTypeChange = () => {
    // In a real scenario, this might open a business type selector modal
    // For now we just focus the user to change it, or they can edit directly?
    // The requirement says: click to change — dispatch 'UPDATE_BUSINESS' action.
    // I'll leave it as a text input or a trigger. Let's make it a button that maybe user can edit.
    // Wait, the requirement says "(display current activeBiz.type, click to change — dispatch 'UPDATE_BUSINESS' action)"
    // It's probably better to just update it on save along with the name.
  };

  const handleToggleLang = () => {
    dispatch({ type: 'SET_LANGUAGE', payload: lang === 'bn' ? 'en' : 'bn' });
  };

  const handleToggleTheme = () => {
    dispatch({ type: 'TOGGLE_DARK_MODE' });
  };

  const handleSaveSettings = () => {
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: { autoCloseTime: autoClose, autoOpenTime: autoOpen, autoCloseEnabled: autoEnabled, sheetsWebAppUrl: sheetsUrl }
    });
  };

  // ── Backup & Restore Handlers ──
  const handleDownloadBackup = async () => {
    setIsExporting(true);
    setBackupStatus(null);
    try {
      let jsonStr;
      let parsed = null;
      if (user?.uid) {
        jsonStr = await exportAllCloudData(user.uid);
        try { parsed = JSON.parse(jsonStr); } catch {}
      } else {
        jsonStr = exportAllData(state);
      }
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ledgero_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const isPartial = Boolean(parsed?.manifest?.isPartial || (parsed?.manifest?.errors && parsed.manifest.errors.length > 0));
      if (isPartial) {
        setBackupStatus({
          type: 'warning',
          message: lang === 'en'
            ? `⚠️ Partial backup downloaded: Some cloud collections could not be read (${parsed.manifest.errors.join(', ')}).`
            : `⚠️ আংশিক ব্যাকআপ ডাউনলোড হয়েছে: ক্লাউডের কিছু তথ্য এক্সপোর্টে ত্রুটি হয়েছিল (${parsed.manifest.errors.join(', ')})।`,
        });
      } else {
        setBackupStatus({
          type: 'success',
          message: lang === 'en' ? 'Backup file downloaded successfully!' : 'সম্পূর্ণ ব্যাকআপ ফাইল সফলভাবে ডাউনলোড হয়েছে!',
        });
      }
    } catch (err) {
      console.error('Backup download error:', err);
      setBackupStatus({
        type: 'error',
        message: lang === 'en' ? `Export failed: ${err.message}` : `ব্যাকআপ ব্যর্থ: ${err.message}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleInspectCloudSnapshot = async () => {
    if (!user?.uid) {
      setBackupStatus({
        type: 'error',
        message: lang === 'en' ? 'Please sign in to inspect cloud backup' : 'ক্লাউড ব্যাকআপ দেখতে প্রথমে লগইন করুন',
      });
      return;
    }
    setIsCheckingCloudSnapshot(true);
    setBackupStatus(null);
    try {
      const jsonStr = await exportAllCloudData(user.uid);
      const validation = validateBackupPayload(jsonStr);
      const parsed = JSON.parse(jsonStr);
      const isPartial = Boolean(
        parsed.manifest?.isPartial ||
        parsed.manifest?.status === 'partial' ||
        (parsed.manifest?.errors && parsed.manifest.errors.length > 0)
      );

      const manifest = {
        ...(parsed.manifest || {}),
        isPartial,
        errors: parsed.manifest?.errors || [],
      };
      parsed.manifest = manifest;

      setCloudSnapshot({
        valid: validation.valid && !isPartial,
        isPartial,
        manifest,
        errors: manifest.errors,
        preview: validation.preview,
        warning: validation.warning,
        exportedAt: parsed.exportedAt || new Date().toISOString(),
        rawJson: jsonStr,
        parsed,
      });

      if (isPartial) {
        setBackupStatus({
          type: 'warning',
          message: lang === 'en'
            ? `⚠️ Incomplete cloud snapshot detected (${manifest.errors.join(', ')}). Auto-restore is blocked to prevent data loss.`
            : `⚠️ অসম্পূর্ণ ক্লাউড স্ন্যাপশট পাওয়া গেছে (${manifest.errors.join(', ')})। ডেটা সুরক্ষায় অটো-রিস্টোর সাময়িক স্থগিত রাখা হয়েছে।`,
        });
      } else {
        setBackupStatus({
          type: 'success',
          message: lang === 'en'
            ? `Cloud snapshot verified: ${validation.preview.daysCount} days, ${validation.preview.contactsCount} contacts found.`
            : `ক্লাউড স্ন্যাপশট যাচাই সম্পন্ন: ${validation.preview.daysCount}টি দিন ও ${validation.preview.contactsCount}টি কন্টাক্ট পাওয়া গেছে।`,
        });
      }
    } catch (err) {
      console.error('Cloud snapshot check error:', err);
      setBackupStatus({
        type: 'error',
        message: lang === 'en' ? `Cloud check failed: ${err.message}` : `ক্লাউড ব্যাকআপ যাচাই ব্যর্থ: ${err.message}`,
      });
    } finally {
      setIsCheckingCloudSnapshot(false);
    }
  };

  const handleExecuteCloudAutoRestore = async () => {
    if (!user?.uid) {
      setBackupStatus({
        type: 'error',
        message: lang === 'en' ? 'Please sign in to restore from cloud' : 'ক্লাউড থেকে রিস্টোর করতে প্রথমে লগইন করুন',
      });
      return;
    }
    setIsRestoring(true);
    setBackupStatus(null);
    setRestoreStep('downloading');
    try {
      let targetParsed = cloudSnapshot?.parsed;
      let targetRaw = cloudSnapshot?.rawJson;
      if (!targetParsed) {
        targetRaw = await exportAllCloudData(user.uid);
        targetParsed = JSON.parse(targetRaw);
      }

      setRestoreStep('verifying');
      await new Promise(r => setTimeout(r, 200));
      const validation = validateBackupPayload(targetParsed);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid cloud backup');
      }

      const isPartial = Boolean(
        targetParsed.manifest?.isPartial ||
        targetParsed.manifest?.status === 'partial' ||
        (targetParsed.manifest?.errors && targetParsed.manifest.errors.length > 0)
      );

      if (isPartial) {
        const errorList = targetParsed.manifest?.errors?.join(', ') || 'Partial manifest detected';
        throw new Error(
          lang === 'en'
            ? `Cannot auto-restore from an incomplete/partial cloud snapshot (${errorList}). Please verify internet connection and retry inspection.`
            : `অসম্পূর্ণ ক্লাউড স্ন্যাপশট থেকে রিস্টোর করা যাবে না (${errorList})। ইন্টারনেট সংযোগ নিশ্চিত করে পুনরায় স্ন্যাপশট যাচাই করুন।`
        );
      }

      setRestoreStep('hydrating');
      await new Promise(r => setTimeout(r, 250));
      importAllData(targetRaw || targetParsed);

      setRestoreStep('done');
      setBackupStatus({
        type: 'success',
        message: lang === 'en'
          ? `Cloud Auto-Restore complete! (${validation.preview?.daysCount || 0} days, ${validation.preview?.contactsCount || 0} contacts restored). Refreshing app...`
          : `ক্লাউড অটো-রিস্টোর সম্পন্ন! (${validation.preview?.daysCount || 0}টি দিন, ${validation.preview?.contactsCount || 0}টি কন্টাক্ট রিস্টোর হয়েছে)। অ্যাপ রিলোড হচ্ছে...`,
      });
      setCloudSnapshot(null);
      setPendingRestore(null);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error('Cloud auto-restore error:', err);
      setIsRestoring(false);
      setRestoreStep(null);
      setBackupStatus({
        type: 'error',
        message: lang === 'en' ? `Cloud restore failed: ${err.message}` : `ক্লাউড রিস্টোর ব্যর্থ: ${err.message}`,
      });
    }
  };

  const handleRunTrxMigration = async () => {
    if (!user?.uid) return;
    setIsMigratingTrx(true);
    try {
      const report = await migrateAllBusinessesHistoricalTrxRegistry(user.uid, state.businesses || []);
      setTrxMigrationReport(report);
      setBackupStatus({
        type: 'success',
        message: lang === 'en'
          ? `MFS TrxID Audit Complete! Scanned ${report.businessesProcessed?.length || 1} shops, verified ${report.totalVerified} orders, registered ${report.migrated} unique TrxIDs.`
          : `ঐতিহাসিক TrxID অডিট সম্পন্ন! ${report.businessesProcessed?.length || 1}টি দোকান স্ক্যান করে ${report.totalVerified}টি অর্ডারের ${report.migrated}টি অনন্য TrxID রেজিস্ট্রি করা হয়েছে।`,
      });
    } catch (err) {
      console.error('Trx migration error:', err);
      setTrxMigrationReport({ error: err.message || 'Migration failed' });
      setBackupStatus({
        type: 'error',
        message: lang === 'en' ? `TrxID audit failed: ${err.message}` : `TrxID অডিট ব্যর্থ: ${err.message}`,
      });
    } finally {
      setIsMigratingTrx(false);
    }
  };

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const content = evt.target.result;
        const validation = validateBackupPayload(content);
        if (!validation.valid) {
          setBackupStatus({
            type: 'error',
            message: lang === 'en' ? `Invalid backup: ${validation.error}` : `অবৈধ ব্যাকআপ ফাইল: ${validation.error}`,
          });
          return;
        }

        const parsed = JSON.parse(content);
        setPendingRestore({
          rawJson: content,
          parsed,
          preview: validation.preview,
          warning: validation.warning,
          isPartial: Boolean(validation.isPartial),
        });
        if (validation.isPartial || validation.warning) {
          setBackupStatus({
            type: 'error',
            message: lang === 'en'
              ? `⚠️ Incomplete Backup (Restore Blocked): ${validation.warning || 'Partial backup manifest'}`
              : `⚠️ অসম্পূর্ণ ব্যাকআপ (রিস্টোর স্থগিত): ${validation.warning || 'আংশিক ব্যাকআপ ফাইল'}`,
          });
        } else {
          setBackupStatus(null);
        }
      } catch (err) {
        setBackupStatus({
          type: 'error',
          message: lang === 'en' ? 'Failed to read file' : 'ফাইলটি পড়া সম্ভব হয়নি',
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExecuteRestore = async () => {
    if (!pendingRestore) return;
    const recheck = validateBackupPayload(pendingRestore.rawJson || pendingRestore.parsed);
    if (!recheck.valid || recheck.isPartial || pendingRestore.isPartial || pendingRestore.warning) {
      setBackupStatus({
        type: 'error',
        message: lang === 'en'
          ? `Restore blocked: Backup file is incomplete or partial (${recheck.warning || pendingRestore.warning || recheck.error || 'Partial manifest'})`
          : `রিস্টোর ব্লক করা হয়েছে: ব্যাকআপ ফাইলটি অসম্পূর্ণ (${recheck.warning || pendingRestore.warning || recheck.error || 'অসম্পূর্ণ ডেটা'})`,
      });
      return;
    }
    setIsRestoring(true);
    setBackupStatus(null);
    setRestoreStep('verifying');
    try {
      if (user?.uid) {
        setRestoreStep('downloading');
        const report = await restoreAllCloudData(user.uid, pendingRestore.parsed);
        if (!report.success || report.isPartialRestore || (report.errors && report.errors.length > 0)) {
          setBackupStatus({
            type: 'error',
            message: lang === 'en'
              ? `Partial restore halted (${report.restoredCount || 0} records restored, ${report.failedCount || report.errors?.length || 0} failed): ${(report.errors || []).slice(0, 3).join('; ')}. You can safely retry without duplicating records.`
              : `আংশিক রিস্টোর স্থগিত (${report.restoredCount || 0}টি রেকর্ড রিস্টোর হয়েছে, ${report.failedCount || report.errors?.length || 0}টি ব্যর্থ): ${(report.errors || []).slice(0, 3).join('; ')}। ডুপ্লিকেট ছাড়াই পুনরায় চেষ্টা করতে পারেন।`,
          });
          setIsRestoring(false);
          setRestoreStep(null);
          return;
        }
      }
      setRestoreStep('hydrating');
      importAllData(pendingRestore.rawJson || pendingRestore.parsed);
      setRestoreStep('done');
      setBackupStatus({
        type: 'success',
        message: lang === 'en' ? 'Data restored successfully! Refreshing app...' : 'ডেটা সফলভাবে রিস্টোর হয়েছে! অ্যাপ রিলোড হচ্ছে...',
      });
      setPendingRestore(null);
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err) {
      console.error('Restore error:', err);
      setBackupStatus({
        type: 'error',
        message: lang === 'en' ? `Restore failed: ${err.message}` : `রিস্টোর ব্যর্থ: ${err.message}`,
      });
    } finally {
      setIsRestoring(false);
      setRestoreStep(null);
    }
  };

  // ── Edit Lock Handlers ──
  const handleToggleEditLock = () => {
    if (editLockEnabled) {
      // Already ON → need PIN to disable
      setShowDisablePin(true);
    } else {
      // OFF → show PIN setup form
      setShowPinSetup(true);
      setNewPin('');
      setConfirmPin('');
      setPinError('');
      setPinSuccess('');
    }
  };

  const handleEnableLock = async () => {
    setPinError('');
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setPinError(t('edit_lock_pin_short', lang));
      return;
    }
    if (newPin !== confirmPin) {
      setPinError(t('edit_lock_pin_mismatch', lang));
      return;
    }
    const pinHash = await hashPin(newPin);
    dispatch({ type: 'SET_EDIT_LOCK', payload: { enabled: true, pinHash } });
    setPinSuccess(t('edit_lock_saved', lang));
    setShowPinSetup(false);
    setNewPin('');
    setConfirmPin('');
    setTimeout(() => setPinSuccess(''), 3000);
  };

  const handleDisablePinVerify = async (enteredPin) => {
    const enteredHash = await hashPin(enteredPin);
    if (enteredHash === editLockPinHash) {
      dispatch({ type: 'SET_EDIT_LOCK', payload: { enabled: false, pinHash: null } });
      setShowDisablePin(false);
      setPinSuccess(t('edit_lock_disabled', lang));
      setTimeout(() => setPinSuccess(''), 3000);
    } else {
      // Wrong PIN — return false so modal can show error
      return false;
    }
    return true;
  };

  const handleForgotPin = async () => {
    setIsRecovering(true);
    setPinError('');
    try {
      const success = await reauthWithGoogle();
      if (success) {
        // Identity verified — reset PIN and unlock
        dispatch({ type: 'SET_EDIT_LOCK', payload: { enabled: false, pinHash: null } });
        resetLockState();
        setForgotPinMode(false);
        setPinSuccess(lang === 'bn' 
          ? '✅ পরিচয় যাচাই সফল! PIN রিসেট হয়েছে। নতুন PIN সেট করতে পারেন।'
          : '✅ Identity verified! PIN has been reset. You can set a new PIN.');
        setTimeout(() => setPinSuccess(''), 5000);
      } else {
        setPinError(lang === 'bn' 
          ? '❌ ভেরিফিকেশন ব্যর্থ! এই অ্যাকাউন্টের Google দিয়ে লগইন করুন।'
          : '❌ Verification failed! Sign in with this account\'s Google.');
      }
    } catch (err) {
      setPinError(lang === 'bn' 
        ? '❌ ত্রুটি হয়েছে। আবার চেষ্টা করুন।'
        : '❌ An error occurred. Please try again.');
    }
    setIsRecovering(false);
  };

  const handleLogout = async () => {
    if (window.confirm(t('profile_logout_confirm', lang))) {
      await signOut();
      onClose();
    }
  };

  // Safe user access
  const displayName = user?.displayName || 'User';
  const email = user?.email || '';
  const photoURL = user?.photoURL || 'https://ui-avatars.com/api/?name=User&background=random';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className={`rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${isDarkMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}>
        {/* Dark header */}
        <div className="bg-slate-800 px-5 py-4 flex items-center justify-between shrink-0">
          <h2 className="text-white font-semibold text-lg">{t('profile_title', lang)}</h2>
          <button
            onClick={() => { if (!isRestoring && !isDeleting) onClose(); }}
            disabled={isRestoring || isDeleting}
            className="text-slate-300 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto no-scrollbar">
          {/* User Profile */}
          <div className="flex flex-col items-center">
            <img src={photoURL} alt={displayName} className="w-20 h-20 rounded-full shadow-md object-cover border-2 border-slate-200 dark:border-slate-700" />
            <h3 className="mt-3 font-semibold text-lg">{displayName}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{email}</p>
            {user?.uid && (
              <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-[11px] font-mono text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] uppercase font-bold text-slate-400">UID:</span>
                <span className="truncate max-w-[150px]">{user.uid}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(user.uid);
                    setCopiedUid(true);
                    setTimeout(() => setCopiedUid(false), 2000);
                  }}
                  title={copiedUid ? (lang === 'en' ? 'Copied!' : 'কপি হয়েছে!') : (lang === 'en' ? 'Copy User ID' : 'ইউজার আইডি কপি করুন')}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                >
                  {copiedUid ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
          </div>

          {/* Shop Settings Section */}
          <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-600 dark:text-slate-300">{t('profile_shop_name', lang)}</label>
                <input 
                  type="text" 
                  value={shopName} 
                  onChange={(e) => setShopName(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'}`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-600 dark:text-slate-300">{t('profile_shop_type', lang)}</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={shopType} 
                    onChange={(e) => setShopType(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'}`}
                  />
                </div>
              </div>
              <button 
                onClick={handleSaveShop}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm"
              >
                {t('profile_save', lang)}
              </button>
            </div>
          </div>

          {/* Preferences Section */}
          <div className={`p-4 rounded-xl border flex gap-3 ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-slate-200 bg-slate-50'}`}>
            <button 
              onClick={handleToggleLang}
              className={`flex-1 py-2 rounded-lg border flex items-center justify-center font-medium transition-colors ${isDarkMode ? 'border-slate-600 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-200 bg-white'}`}
            >
              {lang === 'bn' ? 'English 🇬🇧' : 'বাংলা 🇧🇩'}
            </button>
            <button 
              onClick={handleToggleTheme}
              className={`flex-1 py-2 rounded-lg border flex items-center justify-center font-medium transition-colors ${isDarkMode ? 'border-slate-600 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-200 bg-white'}`}
            >
              {isDarkMode ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>

          {/* Auto Schedule Section */}
          {state.userRole === 'owner' && (
            <div className={`p-4 rounded-xl border space-y-4 ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-slate-200 bg-slate-50'}`}>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">{t('profile_schedule_title', lang)}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('profile_schedule_desc', lang)}</p>
              </div>
              
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('profile_auto_enabled', lang)}</label>
                <button 
                  onClick={() => setAutoEnabled(!autoEnabled)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${autoEnabled ? 'bg-blue-600' : 'bg-slate-400 dark:bg-slate-600'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${autoEnabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {autoEnabled && (
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('profile_auto_close', lang)}</label>
                    <input 
                      type="time" 
                      value={autoClose} 
                      onChange={(e) => setAutoClose(e.target.value)}
                      className={`px-2 py-1 rounded-md border text-sm focus:ring-1 focus:ring-blue-500 outline-none ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('profile_auto_open', lang)}</label>
                    <input 
                      type="time" 
                      value={autoOpen} 
                      onChange={(e) => setAutoOpen(e.target.value)}
                      className={`px-2 py-1 rounded-md border text-sm focus:ring-1 focus:ring-blue-500 outline-none ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                  <button 
                    onClick={handleSaveSettings}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm mt-2"
                  >
                    {t('profile_save', lang)}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Ledgero Academy & Tutorial Mode ─────────────────────────── */}
          <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-indigo-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
                <GraduationCap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                  {lang === 'en' ? 'Ledgero Academy & Tutorial' : 'লেজারো একাডেমি ও টিউটোরিয়াল'}
                  <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">Guide</span>
                </h4>
                <p className="text-[11px] text-gray-500 dark:text-slate-400">
                  {lang === 'en' ? 'Learn every feature with interactive walkthroughs' : 'প্রতিটি ফিচারের কাজ ও ব্যবহার সহজে শিখুন'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onOpenTutorial) onOpenTutorial();
              }}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shrink-0 transition-all shadow-sm cursor-pointer flex items-center gap-1"
            >
              <span>{lang === 'en' ? 'Start Guide' : 'গাইড দেখুন'}</span>
              <span>❯</span>
            </button>
          </div>

          {/* ── App Mode Switch ─────────────────────────── */}
          <div className="p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-gray-800 dark:text-white">
                {lang === 'en' ? 'App Mode' : 'অ্যাপ মোড'}
              </h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                state.appMode === 'advanced'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              }`}>
                {state.appMode === 'advanced' ? (lang === 'en' ? 'Advanced' : 'অ্যাডভান্স') : (lang === 'en' ? 'Easy' : 'ইজি')}
              </span>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {lang === 'en'
                ? 'Easy Mode: Simple interface for small shops. Advanced Mode: Full international accounting features.'
                : 'ইজি মোড: ছোট দোকানের জন্য সহজ ইন্টারফেস। অ্যাডভান্স মোড: সম্পূর্ণ আন্তর্জাতিক মানের অ্যাকাউন্টিং।'}
            </p>

            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => dispatch({ type: 'SET_APP_MODE', payload: 'easy' })}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  state.appMode === 'easy'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                {lang === 'en' ? 'Easy Mode' : '😊 ইজি মোড'}
              </button>
              <button
                onClick={() => dispatch({ type: 'SET_APP_MODE', payload: 'advanced' })}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  state.appMode === 'advanced'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {lang === 'en' ? 'Advanced Mode' : '⚡ অ্যাডভান্স মোড'}
              </button>
            </div>

            {/* Feature Toggles (visible in Advanced Mode) */}
            {state.appMode === 'advanced' && (
              <div className="space-y-1.5 pt-2 border-t border-gray-200 dark:border-gray-600">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  {lang === 'en' ? 'Feature Modules' : 'ফিচার মডিউল'}
                </p>
                {Object.entries(FEATURE_META).map(([key, meta]) => (
                  <label key={key} className="flex items-center justify-between py-1 cursor-pointer group">
                    <span className="text-xs text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white flex items-center gap-1.5">
                      <span>{meta.icon}</span>
                      {lang === 'en' ? meta.en : meta.bn}
                    </span>
                    <div
                      onClick={() => dispatch({ type: 'TOGGLE_FEATURE', payload: key })}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                        state.featureFlags[key] ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                        state.featureFlags[key] ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── Data Source: Live vs Demo ──────────────────── */}
          <div className="p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                <h3 className="font-semibold text-gray-800 dark:text-white">
                  {lang === 'en' ? 'Data Source' : 'ডেটা সোর্স'}
                </h3>
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                isDemoMode
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              }`}>
                {isDemoMode ? (lang === 'en' ? 'Demo Mode' : 'ডেমো ডেটা') : (lang === 'en' ? 'Live Data' : 'লাইভ ডেটা')}
              </span>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {lang === 'en'
                ? 'Toggle between your store\'s live business records and simulated demo analytics.'
                : 'আপনার দোকানের আসল লাইভ হিসাব এবং ডেমো অ্যানালিটিক্সের মধ্যে পরিবর্তন করুন।'}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => isDemoMode && onToggleDemoMode()}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  !isDemoMode
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                <div className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
                {lang === 'en' ? 'Live Data' : 'লাইভ ডেটা (Active)'}
              </button>
              <button
                onClick={() => !isDemoMode && onToggleDemoMode()}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  isDemoMode
                    ? 'bg-amber-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                <span>🧪</span>
                {lang === 'en' ? 'Demo Preview' : 'ডেমো ডেটা'}
              </button>
            </div>
          </div>

          {/* ── Staff Mode / RBAC ────────────────────────── */}
          <div className="p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5 text-indigo-600" />
              <h3 className="font-semibold text-gray-800 dark:text-white">
                {lang === 'en' ? 'Staff Mode' : 'কর্মচারী মোড'}
              </h3>
              <span className="text-xs text-gray-500">
                {lang === 'en' ? 'Role-Based Access' : 'ভূমিকা ভিত্তিক অ্যাক্সেস'}
              </span>
            </div>
            
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {lang === 'en' 
                ? 'Switch to Staff Mode to hide profit data and restrict access. Staff cannot see daily profit, close the day, or change settings.'
                : 'কর্মচারী মোডে স্যুইচ করলে প্রফিট ডেটা লুকানো হবে এবং অ্যাক্সেস সীমাবদ্ধ হবে। কর্মচারী দৈনিক প্রফিট দেখতে, দিন বন্ধ করতে বা সেটিংস পরিবর্তন করতে পারবে না।'}
            </p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {state.userRole === 'owner' ? (
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Shield className="w-4 h-4 text-amber-600" />
                )}
                <span className={`text-sm font-medium ${
                  state.userRole === 'owner' 
                    ? 'text-emerald-700 dark:text-emerald-400' 
                    : 'text-amber-700 dark:text-amber-400'
                }`}>
                  {state.userRole === 'owner' 
                    ? (lang === 'en' ? 'Owner Mode' : 'মালিক মোড') 
                    : (lang === 'en' ? 'Staff Mode' : 'কর্মচারী মোড')}
                </span>
              </div>
              
              <button
                onClick={() => {
                  const newRole = state.userRole === 'owner' ? 'staff' : 'owner';
                  dispatch({ type: 'SET_USER_ROLE', payload: newRole });
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  state.userRole === 'owner'
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                }`}
              >
                {state.userRole === 'owner' 
                  ? (lang === 'en' ? 'Switch to Staff' : 'কর্মচারী মোডে যান')
                  : (lang === 'en' ? 'Switch to Owner' : 'মালিক মোডে ফিরুন')}
              </button>
            </div>

            {state.userRole === 'staff' && (
              <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {lang === 'en'
                    ? '⚠️ Staff mode active — Profit data hidden, Settings restricted'
                    : '⚠️ কর্মচারী মোড চালু — প্রফিট ডেটা লুকানো, সেটিংস সীমাবদ্ধ'}
                </p>
              </div>
            )}
          </div>

          {/* 💾 Backup & Disaster Recovery Center */}
          <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-slate-200 bg-slate-50'} space-y-3.5`}>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    {lang === 'en' ? 'Backup & Disaster Recovery Center' : 'ডেটা ব্যাকআপ ও দুর্যোগ পুনরুদ্ধার কেন্দ্র'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'en'
                      ? '3-Tier Protection: Cloud Auto-Restore, Google Sheets & Local JSON'
                      : '৩-স্তর সুরক্ষা: ক্লাউড অটো-রিস্টোর, গুগল শিটস ও অফলাইন JSON ব্যাকআপ'}
                  </p>
                </div>
              </div>
            </div>

            {/* 3-Tier Disaster Recovery Status Pills */}
            <div className="grid grid-cols-3 gap-2 pt-0.5 text-center">
              <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                <div className="flex items-center justify-center gap-1 text-emerald-600 dark:text-emerald-400 mb-0.5">
                  <Cloud className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{lang === 'en' ? 'Cloud' : 'ক্লাউড'}</span>
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {user?.uid ? (lang === 'en' ? 'Connected' : 'সংযুক্ত') : (lang === 'en' ? 'Offline' : 'লগইন নেই')}
                </p>
              </div>

              <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                <div className="flex items-center justify-center gap-1 text-blue-600 dark:text-blue-400 mb-0.5">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{lang === 'en' ? 'Sheets' : 'শিটস'}</span>
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {sheetsUrl || state.sheetsConfig?.spreadsheetId ? (lang === 'en' ? 'Configured' : 'সংযুক্ত') : (lang === 'en' ? 'Ready' : 'প্রস্তুত')}
                </p>
              </div>

              <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-2xs">
                <div className="flex items-center justify-center gap-1 text-purple-600 dark:text-purple-400 mb-0.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{lang === 'en' ? 'Cache' : 'লোকাল'}</span>
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {lang === 'en' ? 'Secured' : 'সুরক্ষিত'}
                </p>
              </div>
            </div>

            {/* Live Multi-Step Restoration Progress Bar */}
            {isRestoring && restoreStep && (
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-blue-800 dark:text-blue-200">
                  <span className="flex items-center gap-1.5">
                    {restoreStep === 'done' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                    )}
                    <span>
                      {restoreStep === 'downloading' && (lang === 'en' ? 'Fetching cloud backup...' : 'ক্লাউড থেকে ব্যাকআপ আনা হচ্ছে...')}
                      {restoreStep === 'verifying' && (lang === 'en' ? 'Verifying backup data & schema...' : 'ব্যাকআপ ডেটা ও স্কিমা যাচাই করা হচ্ছে...')}
                      {restoreStep === 'hydrating' && (lang === 'en' ? 'Hydrating local storage...' : 'লোকাল স্টোরেজে রিস্টোর করা হচ্ছে...')}
                      {restoreStep === 'done' && (lang === 'en' ? 'Restore complete! Reloading...' : 'রিস্টোর সফল! অ্যাপ রিলোড হচ্ছে...')}
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                    {restoreStep === 'downloading' && (lang === 'en' ? 'Step 1/4 (25%)' : 'ধাপ ১/৪ (২৫%)')}
                    {restoreStep === 'verifying' && (lang === 'en' ? 'Step 2/4 (50%)' : 'ধাপ ২/৪ (৫০%)')}
                    {restoreStep === 'hydrating' && (lang === 'en' ? 'Step 3/4 (75%)' : 'ধাপ ৩/৪ (৭৫%)')}
                    {restoreStep === 'done' && (lang === 'en' ? 'Step 4/4 (100%)' : 'ধাপ ৪/৪ (১০০%)')}
                  </span>
                </div>
                <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${restoreStep === 'done' ? 'bg-emerald-600' : 'bg-blue-600'}`}
                    style={{
                      width: restoreStep === 'downloading' ? '25%' : restoreStep === 'verifying' ? '50%' : restoreStep === 'hydrating' ? '75%' : '100%'
                    }}
                  />
                </div>
                {/* 4-Step Progress Indicator: Inspection -> Verification -> Hydration -> Completed */}
                <div className="grid grid-cols-4 gap-1 text-[10px] text-center pt-0.5 font-medium">
                  <div className={`py-0.5 px-1 rounded transition-colors ${restoreStep === 'downloading' ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 font-bold' : 'text-slate-500'}`}>
                    {lang === 'en' ? 'Inspection' : 'ক্লাউড ফেচ'}
                  </div>
                  <div className={`py-0.5 px-1 rounded transition-colors ${restoreStep === 'verifying' ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 font-bold' : 'text-slate-500'}`}>
                    {lang === 'en' ? 'Verification' : 'যাচাইকরণ'}
                  </div>
                  <div className={`py-0.5 px-1 rounded transition-colors ${restoreStep === 'hydrating' ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 font-bold' : 'text-slate-500'}`}>
                    {lang === 'en' ? 'Hydration' : 'হাইড্রেশন'}
                  </div>
                  <div className={`py-0.5 px-1 rounded transition-colors ${restoreStep === 'done' ? 'bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100 font-bold' : 'text-slate-500'}`}>
                    {lang === 'en' ? 'Completed' : 'সম্পন্ন'}
                  </div>
                </div>
              </div>
            )}

            {/* Card 1: Cloud Auto-Restore (Authenticated) */}
            {user?.uid ? (
              <div className="p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      {lang === 'en' ? 'Cloud Auto-Restore Engine' : 'ক্লাউড অটো-রিস্টোর ইঞ্জিন'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleInspectCloudSnapshot}
                    disabled={isCheckingCloudSnapshot || isRestoring}
                    className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                  >
                    {isCheckingCloudSnapshot ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {lang === 'en' ? 'Inspect Cloud Snapshot' : 'ক্লাউড স্ন্যাপশট দেখুন'}
                  </button>
                </div>

                {cloudSnapshot ? (
                  <div className="p-2.5 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-emerald-200 dark:border-emerald-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {lang === 'en' ? 'Cloud Records Found:' : 'ক্লাউডে প্রাপ্ত হিসাব তালিকা:'}
                      </span>
                      <span className="text-slate-500 text-[10px]">
                        {new Date(cloudSnapshot.exportedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* 5 Summary Chips: Days, Contacts, Businesses, Online Orders, Stores */}
                    <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
                      <div className="p-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50">
                        <span className="block font-bold text-emerald-600 text-xs sm:text-sm">{cloudSnapshot.preview?.daysCount || 0}</span>
                        <span className="text-[9px] sm:text-[10px] text-slate-500 truncate block">{lang === 'en' ? 'Days' : 'দিন'}</span>
                      </div>
                      <div className="p-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50">
                        <span className="block font-bold text-blue-600 text-xs sm:text-sm">{cloudSnapshot.preview?.contactsCount || 0}</span>
                        <span className="text-[9px] sm:text-[10px] text-slate-500 truncate block">{lang === 'en' ? 'Contacts' : 'খাতা'}</span>
                      </div>
                      <div className="p-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50">
                        <span className="block font-bold text-purple-600 text-xs sm:text-sm">{cloudSnapshot.preview?.businessesCount || 1}</span>
                        <span className="text-[9px] sm:text-[10px] text-slate-500 truncate block">{lang === 'en' ? 'Shops' : 'ব্যবসা'}</span>
                      </div>
                      <div className="p-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50">
                        <span className="block font-bold text-rose-600 text-xs sm:text-sm">{cloudSnapshot.preview?.onlineOrdersCount || cloudSnapshot.parsed?.manifest?.counts?.onlineOrders || 0}</span>
                        <span className="text-[9px] sm:text-[10px] text-slate-500 truncate block">{lang === 'en' ? 'Orders' : 'অর্ডার'}</span>
                      </div>
                      <div className="p-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50">
                        <span className="block font-bold text-amber-600 text-xs sm:text-sm">{cloudSnapshot.preview?.storesCount || 0}</span>
                        <span className="text-[9px] sm:text-[10px] text-slate-500 truncate block">{lang === 'en' ? 'Stores' : 'দোকান'}</span>
                      </div>
                    </div>

                    {(cloudSnapshot?.manifest?.isPartial || cloudSnapshot?.isPartial) ? (
                      <div className="space-y-2">
                        {/* Clear blocker notice */}
                        <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-left space-y-1">
                          <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            {lang === 'en' ? 'Partial Snapshot: Restore Blocked' : 'অসম্পূর্ণ স্ন্যাপশট: রিস্টোর সাময়িক স্থগিত'}
                          </span>
                          <p className="text-[10px] text-amber-700 dark:text-amber-200/90 leading-relaxed">
                            {lang === 'en'
                              ? `Some cloud collections could not be verified (${(cloudSnapshot.manifest?.errors || cloudSnapshot.errors || []).join(', ') || 'Partial manifest'}). Automatic restore is strictly blocked to protect your local records from data loss.`
                              : `ক্লাউডের কিছু তথ্য এক্সপোর্টে ত্রুটি থাকায় (${(cloudSnapshot.manifest?.errors || cloudSnapshot.errors || []).join(', ') || 'অসম্পূর্ণ ডেটা'}) তথ্য হারানোর ঝুঁকি এড়াতে রিস্টোর সাময়িক স্থগিত রাখা হয়েছে।`}
                          </p>
                        </div>

                        {/* Disabled button with explanatory tooltip */}
                        <button
                          type="button"
                          disabled={true}
                          title={lang === 'en'
                            ? 'Auto-restore is disabled because the cloud snapshot is partial or incomplete. Please check connection and retry inspection.'
                            : 'ক্লাউড ব্যাকআপ অসম্পূর্ণ থাকায় ডেটা সুরক্ষায় রিস্টোর শুরু করা যাবে না। ইন্টারনেট সংযোগ চেক করে পুনরায় স্ন্যাপশট যাচাই করুন।'}
                          className="w-full py-2 px-3 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 font-bold text-xs flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          <span>{lang === 'en' ? 'Start Restore (Disabled - Partial Data)' : 'রিস্টোর শুরু করুন (স্থগিত - অসম্পূর্ণ ডেটা)'}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleExecuteCloudAutoRestore}
                        disabled={isRestoring}
                        title={lang === 'en' ? 'Start 1-click cloud restoration' : 'ক্লাউড ব্যাকআপ থেকে সম্পূর্ণ হিসাব রিস্টোর শুরু করুন'}
                        className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                      >
                        {isRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
                        <span>{lang === 'en' ? 'Start Restore' : 'রিস্টোর শুরু করুন'}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleExecuteCloudAutoRestore}
                    disabled={isRestoring || isCheckingCloudSnapshot}
                    title={lang === 'en' ? 'Start 1-click cloud auto-restore' : '১-ক্লিকে ক্লাউড অটো-রিস্টোর শুরু করুন'}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {isRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
                    <span>{lang === 'en' ? '1-Click Cloud Auto-Restore' : '১-ক্লিকে ক্লাউড অটো-রিস্টোর করুন'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between text-xs">
                <span className="text-amber-800 dark:text-amber-300">
                  {lang === 'en' ? 'Sign in with Google to enable 1-Click Cloud Auto-Restore.' : '১-ক্লিকে ক্লাউড অটো-রিস্টোর ব্যবহার করতে গুগল দিয়ে সাইন-ইন করুন।'}
                </span>
              </div>
            )}

            {/* Card 2: Offline File Backup & Restore (JSON) */}
            <div className="space-y-1.5 pt-0.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span>{lang === 'en' ? 'Offline File Backup & Restore (JSON)' : 'অফলাইন ফাইল ব্যাকআপ ও রিস্টোর (JSON)'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  disabled={isExporting}
                  className="py-2.5 px-3 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-medium text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                  {lang === 'en' ? 'Download JSON Backup' : 'সম্পূর্ণ ব্যাকআপ ডাউনলোড'}
                </button>

                <label className="py-2.5 px-3 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all">
                  <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>{lang === 'en' ? 'Restore from File' : 'ফাইল থেকে রিস্টোর'}</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleFileSelected}
                    disabled={isRestoring}
                  />
                </label>
              </div>
            </div>

            {/* Card 3: MFS TrxID Registry Audit & Multi-Business Migration */}
            {user?.uid && (
              <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                      {lang === 'en' ? 'MFS TrxID Registry Audit' : 'ঐতিহাসিক TrxID রেজিস্ট্রি অডিট'}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {lang === 'en'
                    ? 'Scan verified bKash/Nagad/Rocket orders across all shops to register unique TrxIDs and audit duplicate payments.'
                    : 'আপনার সকল দোকানের পূর্বের বিকাশ/নগদ/রকেট ভেরিফায়েড অর্ডার স্ক্যান করে অনন্য TrxID রেজিস্ট্রি করুন এবং ডুপ্লিকেট পেমেন্ট অডিট করুন।'}
                </p>

                {trxMigrationReport && !trxMigrationReport.error && (
                  <div className="p-2 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-indigo-200 dark:border-indigo-800 text-[11px] space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">{lang === 'en' ? 'Shops Scanned:' : 'স্ক্যানকৃত দোকান:'}</span>
                      <span className="font-semibold">{trxMigrationReport.businessesProcessed?.length || 1}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{lang === 'en' ? 'Verified Orders:' : 'ভেরিফায়েড অর্ডার:'}</span>
                      <span className="font-semibold">{trxMigrationReport.totalVerified}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{lang === 'en' ? 'Unique TrxIDs Registered:' : 'রেজিস্ট্রিকৃত অনন্য TrxID:'}</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{trxMigrationReport.migrated}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{lang === 'en' ? 'Duplicates Detected:' : 'শনাক্তকৃত ডুপ্লিকেট:'}</span>
                      <span className={`font-semibold ${trxMigrationReport.duplicatesCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400'}`}>
                        {trxMigrationReport.duplicatesCount}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleRunTrxMigration}
                  disabled={isMigratingTrx || isRestoring}
                  className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isMigratingTrx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>{isMigratingTrx ? (lang === 'en' ? 'Auditing & Registering...' : 'অডিট ও মাইগ্রেশন চলছে...') : (lang === 'en' ? 'Audit & Register Historical TrxIDs' : 'ঐতিহাসিক TrxID অডিট ও রেজিস্ট্রি শুরু করুন')}</span>
                </button>
              </div>
            )}

            {/* Feedback message (Success / Error) */}
            {backupStatus && (
              <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                backupStatus.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
              }`}>
                {backupStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                <span className="flex-1">{backupStatus.message}</span>
                <button type="button" onClick={() => setBackupStatus(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold px-1">
                  ✕
                </button>
              </div>
            )}

            {/* Restore Confirmation Dialog with Metadata Preview */}
            {pendingRestore && (
              <div className={`p-3.5 rounded-xl border-2 ${isDarkMode ? 'border-amber-700 bg-amber-950/40' : 'border-amber-300 bg-amber-50'} space-y-2.5`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-amber-800 dark:text-amber-300">
                      {lang === 'en' ? 'Confirm File Data Restore' : 'ফাইল থেকে হিসাব রিস্টোর নিশ্চিতকরণ'}
                    </p>
                    <p className="text-amber-700/90 dark:text-amber-400">
                      {lang === 'en'
                        ? `Found: ${pendingRestore.preview.daysCount} days, ${pendingRestore.preview.contactsCount} contacts, ${pendingRestore.preview.businessesCount} businesses, ${pendingRestore.preview.storesCount || 0} stores. Restoring will synchronize matching shop records.`
                        : `ফাইলে পাওয়া গেছে: ${pendingRestore.preview.daysCount}টি দিন, ${pendingRestore.preview.contactsCount}টি কন্টাক্ট, ${pendingRestore.preview.businessesCount}টি ব্যবসা ও ${pendingRestore.preview.storesCount || 0}টি অনলাইন স্টোর। রিস্টোর সম্পন্ন করতে নিশ্চিত করুন।`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPendingRestore(null)}
                    disabled={isRestoring}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300"
                  >
                    {lang === 'en' ? 'Cancel' : 'বাতিল'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteRestore}
                    disabled={isRestoring || pendingRestore.isPartial || Boolean(pendingRestore.warning)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {isRestoring ? (lang === 'en' ? 'Restoring...' : 'রিস্টোর হচ্ছে...') : (pendingRestore.isPartial || pendingRestore.warning) ? (lang === 'en' ? 'Blocked (Partial)' : 'স্থগিত (অসম্পূর্ণ)') : (lang === 'en' ? 'Proceed Restore' : 'রিস্টোর সম্পন্ন করুন')}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
        <div className={`p-4 border-t ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'} space-y-3`}>
          <button 
            onClick={handleLogout}
            className="w-full py-2.5 bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            {t('profile_logout', lang)}
          </button>

          {/* Delete Account */}
          {!showDeleteConfirm ? (
            <button 
              onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText(''); setDeleteError(''); }}
              className="w-full py-2 text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {lang === 'en' ? 'Delete Account' : 'অ্যাকাউন্ট ডিলিট করুন'}
            </button>
          ) : (
            <div className={`p-4 rounded-xl border-2 ${isDarkMode ? 'border-red-800 bg-red-950/50' : 'border-red-300 bg-red-50'}`}>
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-red-600 dark:text-red-400">
                    {lang === 'en' ? 'Permanently Delete Account?' : 'স্থায়ীভাবে অ্যাকাউন্ট মুছে ফেলবেন?'}
                  </h4>
                  <p className="text-xs text-red-500/80 dark:text-red-400/70 mt-1">
                    {lang === 'en' 
                      ? 'This will permanently delete ALL your data: businesses, transactions, contacts, reports. This action CANNOT be undone.'
                      : 'এটি আপনার সমস্ত ডেটা স্থায়ীভাবে মুছে ফেলবে: ব্যবসা, লেনদেন, যোগাযোগ, রিপোর্ট। এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।'}
                  </p>
                </div>
              </div>

              <label className="block text-xs font-medium text-red-600 dark:text-red-400 mb-1.5">
                {lang === 'en' 
                  ? 'Type DELETE to confirm:' 
                  : 'নিশ্চিত করতে DELETE লিখুন:'}
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value.toUpperCase())}
                placeholder="DELETE"
                className={`w-full px-3 py-2 rounded-lg border text-sm font-mono tracking-wider text-center ${
                  isDarkMode 
                    ? 'bg-gray-800 border-red-700 text-white placeholder-gray-500' 
                    : 'bg-white border-red-300 text-gray-900 placeholder-gray-400'
                } focus:outline-none focus:ring-2 focus:ring-red-500`}
                disabled={isDeleting}
              />

              {deleteError && (
                <p className="text-xs text-red-500 mt-2 text-center">{deleteError}</p>
              )}

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError(''); }}
                  disabled={isDeleting}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isDarkMode 
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                      : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  } disabled:opacity-50`}
                >
                  {lang === 'en' ? 'Cancel' : 'বাতিল'}
                </button>
                <button
                  onClick={async () => {
                    if (deleteConfirmText !== 'DELETE') {
                      setDeleteError(lang === 'en' ? 'Please type DELETE exactly' : 'অনুগ্রহ করে DELETE লিখুন');
                      return;
                    }
                    setIsDeleting(true);
                    setDeleteError('');
                    try {
                      // Step 1: Re-authenticate FIRST so cancelling Google popup never deletes data prematurely
                      if (!user?.isAnonymous) {
                        const verified = await reauthWithGoogle();
                        if (!verified) {
                          throw new Error(
                            lang === 'en'
                              ? 'Identity verification failed. Please sign in with the same Google account.'
                              : 'পরিচয় যাচাই ব্যর্থ হয়েছে। একই গুগল অ্যাকাউন্ট দিয়ে সাইন ইন করুন।'
                          );
                        }
                      }
                      // Step 2: Delete all Firestore & Public Store data and verify completion
                      const deletionReport = await deleteAllUserData(user.uid, state.businesses || []);
                      if (!deletionReport || !deletionReport.verified) {
                        throw new Error(
                          lang === 'en'
                            ? 'Cloud data deletion could not be fully verified. Your account was kept so you can retry.'
                            : 'ক্লাউড ডেটা সম্পূর্ণ মুছে ফেলা নিশ্চিত করা যায়নি। পুনরায় চেষ্টা করার জন্য অ্যাকাউন্টটি রাখা হয়েছে।'
                        );
                      }
                      // Step 3: Only after 100% cloud data deletion is verified, delete Firebase Auth account
                      await deleteAccount({ skipReauth: true });
                      // Done — auth state listener will redirect to login
                    } catch (err) {
                      console.error('Account deletion error:', err);
                      setDeleteError(
                        err.code === 'auth/popup-closed-by-user' 
                          ? (lang === 'en' ? 'Google verification was cancelled' : 'গুগল ভেরিফিকেশন বাতিল হয়েছে')
                          : (lang === 'en' ? `Error: ${err.message}` : `ত্রুটি: ${err.message}`)
                      );
                      setIsDeleting(false);
                    }
                  }}
                  disabled={isDeleting || deleteConfirmText !== 'DELETE'}
                  className="flex-1 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {lang === 'en' ? 'Deleting...' : 'মুছে ফেলা হচ্ছে...'}
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      {lang === 'en' ? 'Delete Forever' : 'চিরতরে মুছে ফেলুন'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
