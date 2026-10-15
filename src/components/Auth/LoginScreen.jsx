// ── Login Screen ────────────────────────────────────────────────────
// Beautiful Google Sign-In page with Ledgero branding
// Shows when user is not authenticated

import React, { useState } from 'react';
import { useAuth } from '../../firebase/useAuth';
import { Shield, Smartphone, BarChart3, Cloud, FileSpreadsheet, Globe } from 'lucide-react';
import LedgeroLogo from '../Shared/LedgeroLogo';

export default function LoginScreen() {
  const { signInWithGoogle, loginAsGuest, error } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(null);
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem('app_lang');
      return saved === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  });

  const isEn = lang === 'en';

  const toggleLang = () => {
    const next = isEn ? 'bn' : 'en';
    setLang(next);
    try { localStorage.setItem('app_lang', next); } catch {}
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setSignInError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setSignInError(err.message || (isEn ? 'Sign in failed. Please try again.' : 'লগইন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।'));
    } finally {
      setIsSigningIn(false);
    }
  };

  const features = isEn ? [
    { icon: Cloud, title: 'Cloud Sync', desc: 'Access your accounts anytime from any device', color: 'text-blue-500' },
    { icon: FileSpreadsheet, title: 'Google Sheets', desc: 'Auto-save daily financial reports directly to Sheets', color: 'text-green-500' },
    { icon: Smartphone, title: 'Mobile Ready', desc: 'Works seamlessly on both mobile phones & computers', color: 'text-purple-500' },
    { icon: Shield, title: 'Secure & Free', desc: 'Google-grade enterprise security, 100% free forever', color: 'text-amber-500' },
  ] : [
    { icon: Cloud, title: 'ক্লাউড সিংক', desc: 'যেকোনো ডিভাইস থেকে আপনার হিসাব দেখুন', color: 'text-blue-500' },
    { icon: FileSpreadsheet, title: 'Google Sheets', desc: 'দৈনিক রিপোর্ট অটো Google Sheets-এ সেভ', color: 'text-green-500' },
    { icon: Smartphone, title: 'মোবাইল রেডি', desc: 'ফোন ও কম্পিউটার দুটোতেই চলবে', color: 'text-purple-500' },
    { icon: Shield, title: 'নিরাপদ ও ফ্রি', desc: 'Google-এর সিকিউরিটি, সম্পূর্ণ বিনামূল্যে', color: 'text-amber-500' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 flex flex-col items-center justify-center p-4 relative">
      
      {/* Top Language Toggle Pill */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 dark:bg-slate-800/90 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-xs transition-all cursor-pointer backdrop-blur-sm"
          title={isEn ? 'Switch to বাংলা' : 'Switch to English'}
        >
          <Globe className="w-3.5 h-3.5 text-indigo-500" />
          <span>{isEn ? 'বাংলা' : 'English'}</span>
        </button>
      </div>

      {/* Logo & Branding */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center mb-4 filter drop-shadow-xl">
          <LedgeroLogo size={80} rounded={true} />
        </div>
        <h1 className="text-4xl font-extrabold text-slate-800 dark:text-white tracking-tight">
          Ledgero
        </h1>
        <p className="text-lg text-slate-500 dark:text-slate-400 mt-1">
          {isEn ? 'Smart Digital Accounting for Business ☁️' : 'দোকানের হিসাব, এখন ক্লাউডে ☁️'}
        </p>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 space-y-6 border border-slate-200 dark:border-slate-700">
        
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">
            {isEn ? 'Welcome! 🎉' : 'স্বাগতম! 🎉'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {isEn ? 'Get started with Google or explore instant demo' : 'আপনার Google অ্যাকাউন্ট দিয়ে শুরু করুন বা ডেমো দেখুন'}
          </p>
        </div>

        {/* Google Sign-In Button */}
        <button
          onClick={handleSignIn}
          disabled={isSigningIn}
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-700 border-2 border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-lg text-slate-700 dark:text-white font-semibold py-3.5 px-6 rounded-xl transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSigningIn ? (
            <>
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span>{isEn ? 'Signing in...' : 'লগইন হচ্ছে...'}</span>
            </>
          ) : (
            <>
              {/* Google G Logo */}
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>{isEn ? 'Sign in with Google' : 'Sign in with Google'}</span>
            </>
          )}
        </button>

        {/* Guest / Demo Instant Login */}
        <button
          onClick={loginAsGuest}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200 cursor-pointer shadow-md shadow-emerald-950/20"
        >
          <span>{isEn ? '⚡ Enter Demo Mode (Instant Preview)' : '⚡ ডেমো মোডে প্রবেশ করুন (Instant Preview)'}</span>
        </button>

        {/* Error Message */}
        {(signInError || error) && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 text-center">
            ⚠️ {signInError || error}
          </div>
        )}

        {/* Features Grid */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          {features.map((f, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50">
              <f.icon className={`w-5 h-5 mt-0.5 ${f.color} shrink-0`} />
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{f.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {isEn ? 'Powered by Google Cloud ☁️ | 100% Free Forever' : 'Powered by Google Cloud ☁️ | সম্পূর্ণ বিনামূল্যে'}
        </p>
        <div className="flex items-center justify-center gap-1 mt-1">
          <BarChart3 className="w-3 h-3 text-slate-400" />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {isEn ? 'Ledgero v2.0 — Smart Digital Bookkeeping for Business' : 'Ledgero v2.0 — দোকানের ডিজিটাল হিসাবরক্ষক'}
          </p>
        </div>
      </div>
    </div>
  );
}
