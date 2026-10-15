// ── Firebase Configuration ─────────────────────────────────────────
// Replace these values with your Firebase project config from:
// Firebase Console → Project Settings → General → Your apps → Firebase SDK snippet
//
// SETUP GUIDE:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (e.g., "shopbook-bd")
// 3. Add a Web App (click </> icon)
// 4. Copy the firebaseConfig object and paste below
// 5. Enable Authentication → Sign-in method → Google
// 6. Create Firestore Database → Start in production mode
// 7. Enable Google Sheets API at https://console.cloud.google.com/apis/library/sheets.googleapis.com

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

const envSource = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env
  : (typeof process !== 'undefined' && process.env ? process.env : {});

const isTestMode = typeof process !== 'undefined' && process.env?.LEDGERO_TEST_MODE === '1';

// Validate critical environment variables
const requiredFirebaseEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID'
];

const missingEnv = requiredFirebaseEnv.filter(name => !envSource[name]);
if (missingEnv.length > 0 && !isTestMode) {
  throw new Error(
    `[Ledgero Security Config Error] Missing critical environment variables: ${missingEnv.join(', ')}. ` +
    `The application will not start without these configured in your environment/.env file.`
  );
}

const firebaseConfig = {
  apiKey: envSource.VITE_FIREBASE_API_KEY || 'test-api-key',
  authDomain: envSource.VITE_FIREBASE_AUTH_DOMAIN || 'test.firebaseapp.com',
  projectId: envSource.VITE_FIREBASE_PROJECT_ID || 'test-project',
  storageBucket: envSource.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: envSource.VITE_FIREBASE_MESSAGING_SENDER_ID || envSource.VITE_FIREBASE_MESSAGING_ID || '',
  appId: envSource.VITE_FIREBASE_APP_ID || '1:000:web:000',
  measurementId: envSource.VITE_FIREBASE_MEASUREMENT_ID || ''
};

// Initialize Firebase (skipped in pure unit test mode where customOps mock is used)
const app = isTestMode ? null : initializeApp(firebaseConfig);

// Auth
export const auth = isTestMode ? null : getAuth(app);

// Standard Google Auth Provider (clean 1-click login, NO unverified app warnings!)
export const googleProvider = isTestMode ? null : new GoogleAuthProvider();

// Google Sheets Provider (used ONLY when user clicks export to sheets)
// Using drive.file scope: non-sensitive, no verification needed, unlimited users, no scary warning!
// drive.file = only accesses files THIS APP created (Ledgero monthly spreadsheets)
export const sheetsProvider = isTestMode ? null : new GoogleAuthProvider();
if (sheetsProvider) {
  sheetsProvider.addScope('https://www.googleapis.com/auth/drive.file');
}

// Firestore
export const db = isTestMode ? {} : getFirestore(app);

// Enable offline persistence — data cached in IndexedDB
// This makes the app work offline and reduces Firestore reads by ~90%
if (!isTestMode && typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      // Multiple tabs open — persistence can only be enabled in one tab at a time
      console.warn('⚠️ Firestore persistence: Multiple tabs open, only one tab can use offline cache');
    } else if (err.code === 'unimplemented') {
      // Browser doesn't support IndexedDB persistence
      console.warn('⚠️ Firestore persistence: Browser does not support offline persistence');
    }
  });
}

export default app;
