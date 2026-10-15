// ── Firebase Auth Hook ──────────────────────────────────────────────
// Manages Google sign-in, sign-out, auth state, and OAuth token for Sheets API

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { 
  signInWithPopup, 
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  deleteUser
} from 'firebase/auth';
import { auth, googleProvider, sheetsProvider } from './firebaseConfig';
import { setActiveStorageUserId } from '../data/storage.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sheetsAccessToken, setSheetsAccessToken] = useState(null);

  // Listen for auth state changes
  useEffect(() => {
    const savedGuest = localStorage.getItem('ledgero_guest_user');
    if (savedGuest) {
      try {
        const parsedGuest = JSON.parse(savedGuest);
        setActiveStorageUserId(parsedGuest?.uid || null);
        setUser(parsedGuest);
        setLoading(false);
      } catch {}
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setActiveStorageUserId(firebaseUser.uid);
        setUser(firebaseUser);
        localStorage.removeItem('ledgero_guest_user');
      } else {
        setActiveStorageUserId(null);
        const guest = localStorage.getItem('ledgero_guest_user');
        if (guest) {
          try {
            const parsedGuest = JSON.parse(guest);
            setActiveStorageUserId(parsedGuest?.uid || null);
            setUser(parsedGuest);
          } catch {
            setActiveStorageUserId(null);
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      setLoading(false);
      if (!firebaseUser) {
        setSheetsAccessToken(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Sign in as Guest / Demo user
  const loginAsGuest = useCallback(() => {
    const guestUser = {
      uid: 'guest_user_demo',
      displayName: 'Demo Shopkeeper',
      email: 'demo@ledgero.app',
      photoURL: null,
      isAnonymous: true
    };
    setActiveStorageUserId(guestUser.uid);
    setUser(guestUser);
    localStorage.setItem('ledgero_guest_user', JSON.stringify(guestUser));
    return guestUser;
  }, []);

  // Sign in with Google (clean login — basic profile & email, NO scary unverified warnings!)
  const signInWithGoogle = useCallback(async () => {
    try {
      setError(null);
      const result = await signInWithPopup(auth, googleProvider);
      if (result?.user) {
        setActiveStorageUserId(result.user.uid);
      }
      return result.user;
    } catch (err) {
      console.error('Google Sign-In Error:', err);
      setError(err.message);
      throw err;
    }
  }, []);

  // Sign out
  const signOutUser = useCallback(async () => {
    try {
      setActiveStorageUserId(null);
      localStorage.removeItem('ledgero_guest_user');
      sessionStorage.removeItem('sheets_access_token');
      sessionStorage.clear();
      setUser(null);
      await firebaseSignOut(auth);
      setSheetsAccessToken(null);
    } catch (err) {
      console.error('Sign-Out Error:', err);
      throw err;
    } finally {
      setActiveStorageUserId(null);
    }
  }, []);

  // Request Google Sheets permission on-demand (when user clicks Export or Connect Sheets)
  const connectGoogleSheets = useCallback(async () => {
    try {
      setError(null);
      const result = await signInWithPopup(auth, sheetsProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setSheetsAccessToken(credential.accessToken);
        sessionStorage.setItem('sheets_access_token', credential.accessToken);
        return credential.accessToken;
      }
      return null;
    } catch (err) {
      console.error('Google Sheets connect error:', err);
      throw err;
    }
  }, []);

  // On mount, try to recover token from sessionStorage
  useEffect(() => {
    if (!sheetsAccessToken) {
      const stored = sessionStorage.getItem('sheets_access_token');
      if (stored) setSheetsAccessToken(stored);
    }
  }, [sheetsAccessToken]);

  // Re-authenticate with Google (for PIN recovery — prove account ownership)
  const reauthWithGoogle = useCallback(async () => {
    try {
      setError(null);
      const result = await signInWithPopup(auth, googleProvider);
      // Verify it's the same user
      if (result.user?.uid === user?.uid) {
        return true;
      }
      // Different user tried to auth
      return false;
    } catch (err) {
      console.error('Re-auth Error:', err);
      setError(err.message);
      return false;
    }
  }, [user]);

  // Delete account (after re-authentication and verified Firestore deletion)
  const deleteAccount = useCallback(async (options = {}) => {
    try {
      setError(null);
      let targetUser = auth.currentUser || user;

      if (!options.skipReauth && !targetUser?.isAnonymous) {
        const result = await signInWithPopup(auth, googleProvider);
        if (result.user?.uid !== user?.uid) {
          throw new Error('Wrong account. Please sign in with the same Google account.');
        }
        targetUser = result.user;
      }

      try {
        await deleteUser(targetUser);
      } catch (delErr) {
        if (delErr?.code === 'auth/requires-recent-login' && !targetUser?.isAnonymous) {
          const result = await signInWithPopup(auth, googleProvider);
          if (result.user?.uid !== user?.uid) {
            throw new Error('Wrong account. Please sign in with the same Google account.');
          }
          await deleteUser(result.user);
        } else {
          throw delErr;
        }
      }

      // Clear local state
      setActiveStorageUserId(null);
      setSheetsAccessToken(null);
      sessionStorage.clear();
      localStorage.clear();

      return true;
    } catch (err) {
      console.error('Delete Account Error:', err);
      setError(err.message);
      throw err;
    }
  }, [user]);

  const value = {
    user,
    loading,
    error,
    sheetsAccessToken,
    hasSheetsPermission: !!sheetsAccessToken,
    signInWithGoogle,
    loginAsGuest,
    signOut: signOutUser,
    connectGoogleSheets,
    refreshSheetsToken: connectGoogleSheets,
    reauthWithGoogle,
    deleteAccount,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
