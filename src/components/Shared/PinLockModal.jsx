import React, { useState, useRef, useEffect } from 'react';
import { t } from '../../data/translations';

const MAX_ATTEMPTS = 5;
const LOCK_KEY = 'ledgero_pin_lock';

function getLockState() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCK_KEY) || '{}');
    return {
      attempts: data.attempts || 0,
      locked: data.locked || false,
    };
  } catch { return { attempts: 0, locked: false }; }
}

function setLockState(attempts, locked) {
  localStorage.setItem(LOCK_KEY, JSON.stringify({ attempts, locked }));
}

export function resetLockState() {
  localStorage.removeItem(LOCK_KEY);
}

export default function PinLockModal({ isOpen, onSuccess, onCancel, lang = 'bn' }) {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [lockState, setLockStateLocal] = useState(getLockState());
  const inputRefs = [useRef(), useRef(), useRef(), useRef()];

  useEffect(() => {
    if (isOpen) {
      setPin(['', '', '', '']);
      setError('');
      setShake(false);
      setLockStateLocal(getLockState());
      setTimeout(() => inputRefs[0].current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // If locked out
  if (lockState.locked) {
    return (
      <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center">
          <div className="text-5xl mb-4">🚫</div>
          <h3 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">
            {lang === 'bn' ? 'অ্যাকাউন্ট লক হয়েছে!' : 'Account Locked!'}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            {lang === 'bn' 
              ? '৫ বার ভুল PIN দেওয়া হয়েছে। রিকভারির জন্য প্রোফাইলে গিয়ে "PIN ভুলে গেছি" অপশন ব্যবহার করুন।'
              : '5 wrong PIN attempts. Go to Profile and use "Forgot PIN" to recover.'}
          </p>
          <button
            onClick={onCancel}
            className="w-full py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-sm transition-colors cursor-pointer"
          >
            {t('edit_lock_cancel', lang)}
          </button>
        </div>
      </div>
    );
  }

  const handleChange = (index, value) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    setError('');

    // Auto-focus next input
    if (digit && index < 3) {
      inputRefs[index + 1].current?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs[index - 1].current?.focus();
    }
    if (e.key === 'Enter') {
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length === 4) {
      const newPin = pasted.split('');
      setPin(newPin);
      inputRefs[3].current?.focus();
    }
  };

  const handleSubmit = async () => {
    const fullPin = pin.join('');
    if (fullPin.length < 4) {
      setError(t('edit_lock_pin_short', lang));
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    const result = await onSuccess(fullPin);
    if (result === false) {
      // Wrong PIN — increment attempts
      const newAttempts = lockState.attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        setLockState(newAttempts, true);
        setLockStateLocal({ attempts: newAttempts, locked: true });
      } else {
        setLockState(newAttempts, false);
        setLockStateLocal({ attempts: newAttempts, locked: false });
        const remaining = MAX_ATTEMPTS - newAttempts;
        setError(lang === 'bn' 
          ? `❌ ভুল PIN! আর ${remaining} বার চেষ্টা করা যাবে` 
          : `❌ Wrong PIN! ${remaining} attempt${remaining > 1 ? 's' : ''} left`);
      }
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPin(['', '', '', '']);
      setTimeout(() => inputRefs[0].current?.focus(), 100);
    } else {
      // Correct PIN — reset attempts
      setLockState(0, false);
      setLockStateLocal({ attempts: 0, locked: false });
    }
  };

  const handleWrongPin = () => {
    setError(t('edit_lock_wrong_pin', lang));
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setPin(['', '', '', '']);
    setTimeout(() => inputRefs[0].current?.focus(), 100);
  };

  // Expose handleWrongPin via ref-like pattern
  // Actually, we handle verification in the parent - parent calls onSuccess with the PIN
  // and if it's wrong, parent can call a ref method. Let's make it simpler:
  // The parent handles verification. If wrong, parent sets error via props.
  // For now, let's just pass the PIN to parent and let parent decide.

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center ${shake ? 'animate-shake' : ''}`}>
        {/* Lock Icon */}
        <div className="text-4xl mb-3">🔒</div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">
          {t('edit_lock_enter_pin', lang)}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          {t('edit_lock_protected', lang)}
        </p>

        {/* PIN Input */}
        <div className="flex justify-center gap-3 mb-4" onPaste={handlePaste}>
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={inputRefs[i]}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className={`w-12 h-14 text-center text-2xl font-black rounded-xl border-2 outline-none transition-all
                ${error 
                  ? 'border-red-400 bg-red-50 dark:bg-red-950/20 text-red-600' 
                  : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800'
                }`}
            />
          ))}
        </div>

        {/* Error message */}
        {error && (
          <p className="text-sm text-red-500 font-semibold mb-4 animate-pulse">{error}</p>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-sm transition-colors cursor-pointer"
          >
            {t('edit_lock_cancel', lang)}
          </button>
          <button
            onClick={handleSubmit}
            disabled={pin.some(d => !d)}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 dark:disabled:bg-indigo-800 text-white rounded-xl font-semibold text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {t('edit_lock_unlock', lang)}
          </button>
        </div>
      </div>

      {/* Shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
    </div>
  );
}

// Helper: SHA-256 hash for PIN
export async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + '_ledgero_salt_2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
