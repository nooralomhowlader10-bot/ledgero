/**
 * Zero-dependency ESM loader for running Ledgero's automated verification suite
 * (`npm test`) in both full-install and dependency-free sandbox environments.
 *
 * Redirects `firebase/app`, `firebase/auth`, `firebase/firestore`, and `dompurify`
 * to deterministic test harnesses backed by `globalThis.__LEDGERO_TEST_FIRESTORE__`.
 */

import { register } from 'node:module';

process.env.LEDGERO_TEST_MODE = '1';

const hooksSource = `
const STUB_MODULES = {
  'firebase/app': \`
    export const initializeApp = (config) => ({ name: '[DEFAULT]', options: config || {} });
  \`,
  'firebase/auth': \`
    export const getAuth = () => ({ currentUser: null });
    export const GoogleAuthProvider = class { addScope() {} setCustomParameters() {} };
    export const signInWithPopup = async () => ({});
    export const signInWithRedirect = async () => ({});
    export const getRedirectResult = async () => null;
    export const signOut = async () => {};
    export const onAuthStateChanged = () => () => {};
    export const reauthenticateWithPopup = async () => ({});
    export const deleteUser = async () => {};
  \`,
  'firebase/firestore': \`
    const getDriver = () => {
      if (!globalThis.__LEDGERO_TEST_FIRESTORE__) {
        throw new Error('Test Firestore driver is not initialized on globalThis.__LEDGERO_TEST_FIRESTORE__');
      }
      return globalThis.__LEDGERO_TEST_FIRESTORE__;
    };
    export const initializeFirestore = () => ({ type: 'firestore-mock' });
    export const getFirestore = () => ({ type: 'firestore-mock' });
    export const enableIndexedDbPersistence = async () => ({});
    export const persistentLocalCache = () => ({});
    export const persistentMultipleTabManager = () => ({});
    export const doc = (...args) => getDriver().doc(...args);
    export const collection = (...args) => getDriver().collection(...args);
    export const getDoc = (...args) => getDriver().getDoc(...args);
    export const getDocs = (...args) => getDriver().getDocs(...args);
    export const setDoc = (...args) => getDriver().setDoc(...args);
    export const addDoc = (...args) => getDriver().addDoc(...args);
    export const deleteDoc = (...args) => getDriver().deleteDoc(...args);
    export const writeBatch = (...args) => getDriver().writeBatch(...args);
    export const runTransaction = (...args) => getDriver().runTransaction(...args);
    export const query = (...args) => getDriver().query(...args);
    export const where = (...args) => getDriver().where(...args);
    export const orderBy = (...args) => getDriver().orderBy ? getDriver().orderBy(...args) : { type: 'orderBy', args };
    export const limit = (...args) => getDriver().limit ? getDriver().limit(...args) : { type: 'limit', args };
    export const onSnapshot = () => () => {};
    export const serverTimestamp = () => new Date().toISOString();
    export const Timestamp = { now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }) };
  \`,
  'dompurify': \`
    export default {
      sanitize: (val) => String(val ?? '').replace(/<script\\\\b[^<]*(?:(?!<\\\\/script>)<[^<]*)*<\\\\/script>/gi, ''),
    };
  \`,
};

export async function resolve(specifier, context, nextResolve) {
  if (Object.prototype.hasOwnProperty.call(STUB_MODULES, specifier)) {
    return {
      shortCircuit: true,
      url: 'data:text/javascript;charset=utf-8,' + encodeURIComponent(STUB_MODULES[specifier]),
    };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript;charset=utf-8,${encodeURIComponent(hooksSource)}`);
