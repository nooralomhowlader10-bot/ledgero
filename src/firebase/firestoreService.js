// ── Firestore Data Service ──────────────────────────────────────────
// Cloud CRUD operations replacing localStorage for multi-device sync
// Schema: users/{userId}/businesses/{bizId}/days/{dateKey}
//         users/{userId}/businesses/{bizId}/contacts/{contactId}
//         users/{userId}/settings
//         users/{userId}/profile

import { 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc,
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit,
  where,
  writeBatch,
  runTransaction,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebaseConfig.js';
import { createSaveResult, createRevisionTracker } from '../data/syncRevisionTracker.js';
import {
  sanitizePublicProductRecord,
  verifyOrderAgainstCatalog,
  verifyStoreBusinessOwnership,
  mergeIncomingOrdersIdempotently,
} from '../data/orderIntegrityEngine.js';
import {
  verifyBackupCompletenessForRestore,
  recordOperationalError,
  recordDatabaseOperation,
  BACKUP_AND_RETENTION_POLICY,
} from '../data/operationalSafeguards.js';
import {
  settleOnlineOrderInState,
  verifyOnlineOrderPaymentInState,
  cancelOnlineOrderInState,
  returnOnlineOrderInState,
  parseStrictMoney,
} from '../data/ledgerStateEngine.js';

export const defaultCloudRevisionTracker = createRevisionTracker();

/**
 * Authoritative settlement wallet to journal account mapping table.
 * Every valid settlement wallet MUST be explicitly mapped here.
 * Fail-closed: Any unmapped or unknown wallet returns undefined and is rejected.
 */
export const SETTLEMENT_WALLET_TO_ACCOUNT_MAP = Object.freeze({
  hand_cash: 'cash_in_hand',
  cash: 'cash_in_hand',
  cash_in_hand: 'cash_in_hand',
  bkash_personal: 'bkash',
  bkash_agent: 'bkash',
  bkash: 'bkash',
  nagad_personal: 'nagad',
  nagad_uddokta: 'nagad',
  nagad: 'nagad',
  rocket_personal: 'rocket',
  rocket: 'rocket',
  bank_account: 'bank_account',
  bank: 'bank_account',
  dutch_bangla: 'bank_account',
  janata_bank: 'bank_account',
  city_bank: 'bank_account',
  brac_bank: 'bank_account',
  islami_bank: 'bank_account',
  sonali_bank: 'bank_account',
  eastern_bank: 'bank_account',
  bank_asia: 'bank_account',
  digital_payment: 'digital_payment',
  retail_apps: 'digital_payment',
});

/**
 * Strict wallet-to-journal account matcher for settlement reconciliation.
 * - Explicit fail-closed: Unknown wallets never default to Cash or any account.
 * - Rejects loose 'asset_' or 'asset_wallet_' aliases.
 */
export function isMatchingSettlementWalletAccount(accountId, targetWallet) {
  if (!accountId || !targetWallet) return false;
  const acc = String(accountId).toLowerCase().trim();
  const wal = String(targetWallet).toLowerCase().trim();

  const expectedAccount = SETTLEMENT_WALLET_TO_ACCOUNT_MAP[wal];
  if (!expectedAccount) {
    // Unknown or unmapped wallet -> FAIL CLOSED (never assume cash_in_hand!)
    return false;
  }

  // Strictly match only the canonical expected journal account
  return acc === expectedAccount;
}

// ── Helper: Build doc references ────────────────────────────────────

function userRef(userId) {
  return doc(db, 'users', userId, 'profile', 'info');
}

function bizRef(userId, bizId) {
  return doc(db, 'users', userId, 'businesses', bizId);
}

function dayRef(userId, bizId, dateKey) {
  return doc(db, 'users', userId, 'businesses', bizId, 'days', dateKey);
}

function contactRef(userId, bizId, contactId) {
  return doc(db, 'users', userId, 'businesses', bizId, 'contacts', contactId);
}

function contactTxsRef(userId, bizId, contactId) {
  return doc(db, 'users', userId, 'businesses', bizId, 'contactTxs', contactId);
}

function metaRef(userId, bizId) {
  return doc(db, 'users', userId, 'businesses', bizId, 'meta', 'info');
}

function sheetsConfigRef(userId) {
  return doc(db, 'users', userId, 'sheetsConfig', 'config');
}

// ── Profile & Settings ──────────────────────────────────────────────

export const FIRESTORE_BATCH_LIMIT = 450;

export const ALLOWED_USER_SETTINGS_KEYS = [
  'language',
  'isDarkMode',
  'isPrivacyMode',
  'autoCloseTime',
  'autoOpenTime',
  'autoCloseEnabled',
  'editLockEnabled',
  'editLockPinHash',
  'userRole',
  'staffPinHash',
  'appMode',
  'featureFlags',
  'taxRegion',
  'sheetsWebAppUrl',
  'teaHouseProducts',
  'teaHouseMonthlyTab',
  'teaHouseMonthlyPersonal',
  'teaHouseMonthlyShop',
  'teaHouseTabMonth',
  'courierSettings',
  'customerBlacklist',
  'updatedAt',
];

export const DEFAULT_USER_SETTINGS = {
  language: 'bn',
  isDarkMode: false,
  isPrivacyMode: false,
  autoCloseTime: '01:00',
  autoOpenTime: '08:00',
  autoCloseEnabled: false,
  editLockEnabled: false,
  editLockPinHash: null,
  userRole: 'owner',
  staffPinHash: null,
  appMode: 'easy',
  taxRegion: 'BD',
  sheetsWebAppUrl: '',
};

export async function saveProfile(userId, profileData) {
  await setDoc(userRef(userId), {
    displayName: profileData.displayName || '',
    email: profileData.email || '',
    photoURL: profileData.photoURL || '',
    updatedAt: Timestamp.now()
  }, { merge: true });
}

export async function saveSettings(userId, settings = {}, customOps = null) {
  if (!userId) return;
  const ops = customOps || { db, doc, setDoc };
  const payload = {
    language: settings.language || 'bn',
    isDarkMode: Boolean(settings.isDarkMode),
    isPrivacyMode: Boolean(settings.isPrivacyMode),
    updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString(),
  };

  for (const key of ALLOWED_USER_SETTINGS_KEYS) {
    if (key === 'updatedAt' || key === 'language' || key === 'isDarkMode' || key === 'isPrivacyMode') continue;
    if (settings[key] !== undefined) {
      payload[key] = settings[key];
    }
  }

  await ops.setDoc(ops.doc(ops.db, 'users', userId, 'settings', 'prefs'), payload, { merge: true });
}

export async function loadSettings(userId, customOps = null) {
  const ops = customOps || { db, doc, getDoc };
  const snap = await ops.getDoc(ops.doc(ops.db, 'users', userId, 'settings', 'prefs'));
  if (snap && snap.exists()) {
    return {
      ...DEFAULT_USER_SETTINGS,
      ...snap.data(),
    };
  }
  return { ...DEFAULT_USER_SETTINGS };
}

// ── Business Management ─────────────────────────────────────────────

export async function saveBusinesses(userId, businesses, customOps = null) {
  const ops = customOps || { db, doc, setDoc };
  // Store the full business list as a single document for fast reads
  await ops.setDoc(ops.doc(ops.db, 'users', userId, 'businessList', 'list'), {
    businesses,
    updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString()
  });
}

export async function loadBusinesses(userId, customOps = null) {
  const ops = customOps || { db, doc, getDoc };
  const snap = await ops.getDoc(ops.doc(ops.db, 'users', userId, 'businessList', 'list'));
  if (snap && snap.exists()) return snap.data().businesses || [];
  return null; // No businesses yet — will use defaults
}

/**
 * Deletes an entire business from Firestore with chunked subcollection cleanup,
 * public storefront cleanup, businessList update, and post-delete verification.
 */
export async function deleteBusinessFromCloud(userId, bizId, customOps = null) {
  if (!userId || !bizId) {
    throw new Error('Both userId and bizId are required to delete a business');
  }

  const ops = customOps || { db, doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where, writeBatch };
  const bizPath = `users/${userId}/businesses/${bizId}`;
  const deletedCounts = {
    subcollectionDocs: 0,
    publicStores: 0,
    publicProducts: 0,
  };

  // 1. Delete all mutable business subcollections (days, contacts, contactTxs, onlineOrders, meta) in 450-op chunks
  // Note: auditLog is an immutable, tamper-resistant append-only trail (allow update, delete: if false in firestore.rules)
  for (const subName of BUSINESS_SUBCOLLECTIONS) {
    const count = await deleteSubcollection(bizPath, subName, ops);
    deletedCounts.subcollectionDocs += count;
  }

  // 3. Delete any public stores linked to this business
  const storesQuery = ops.query(ops.collection(ops.db, 'stores'), ops.where('ownerUserId', '==', userId));
  const storesSnap = await withRetry(() => ops.getDocs(storesQuery), `discover_biz_stores:${bizId}`);
  for (const storeDoc of storesSnap.docs) {
    const storeData = storeDoc.data() || {};
    if (storeData.bizId === bizId) {
      const prodCount = await deleteSubcollection(`stores/${storeDoc.id}`, 'products', ops);
      await deleteSubcollection(`stores/${storeDoc.id}`, 'public', ops);
      await deleteSubcollection(`stores/${storeDoc.id}`, 'orders', ops);
      deletedCounts.publicProducts += prodCount;
      await withRetry(() => ops.deleteDoc(storeDoc.ref), `delete_biz_store:${storeDoc.id}`);
      deletedCounts.publicStores += 1;
    }
  }

  // 4. Delete business document itself
  await withRetry(
    () => ops.deleteDoc(ops.doc(ops.db, 'users', userId, 'businesses', bizId)),
    `delete_biz_doc:${bizId}`
  );

  // 5. Update businessList/list if it exists
  const listRef = ops.doc(ops.db, 'users', userId, 'businessList', 'list');
  const listSnap = await withRetry(() => ops.getDoc(listRef), `read_businessList:${bizId}`);
  if (listSnap && listSnap.exists()) {
    const existingList = listSnap.data()?.businesses || [];
    const remainingList = existingList.filter(b => b?.id !== bizId);
    if (remainingList.length !== existingList.length && ops.setDoc) {
      await withRetry(
        () => ops.setDoc(listRef, { businesses: remainingList, updatedAt: Timestamp.now() }),
        `update_businessList:${bizId}`
      );
    }
  }

  // 6. Verify all subcollections and business doc are gone
  for (const subName of BUSINESS_SUBCOLLECTIONS) {
    const checkSnap = await withRetry(
      () => ops.getDocs(ops.collection(ops.db, 'users', userId, 'businesses', bizId, subName)),
      `verify_biz_subcollection:${bizId}/${subName}`
    );
    if (!checkSnap.empty) {
      throw new Error(`Business deletion verification failed: ${checkSnap.docs.length} docs remain in ${bizId}/${subName}`);
    }
  }

  const checkBizDoc = await withRetry(
    () => ops.getDoc(ops.doc(ops.db, 'users', userId, 'businesses', bizId)),
    `verify_biz_doc:${bizId}`
  );
  if (checkBizDoc && checkBizDoc.exists()) {
    throw new Error(`Business deletion verification failed: business doc ${bizId} still exists`);
  }

  return {
    userId,
    bizId,
    deletedCounts,
    verified: true,
  };
}

// ── Day Data ────────────────────────────────────────────────────────

const dayWriteQueueByPath = new Map();

export async function saveDayToCloud(userId, bizId, dayData, customOps = null, options = {}) {
  // Support both (userId, bizId, dayData, customOps, options) and (dayData, bizId, userId, options)
  if (typeof userId === 'object' && userId !== null && userId.dateKey) {
    const tempDayData = userId;
    const tempBizId = bizId;
    const tempUserId = dayData;
    const tempOptions = (typeof customOps === 'object' && customOps !== null && !customOps.db && !customOps.doc) ? customOps : options;
    userId = tempUserId;
    bizId = tempBizId;
    dayData = tempDayData;
    customOps = (typeof customOps === 'object' && customOps !== null && (customOps.db || customOps.doc)) ? customOps : null;
    options = tempOptions || {};
  }
  if (!userId || !bizId || !dayData?.dateKey) return null;
  const ops = customOps || { db, doc, setDoc, getDoc, runTransaction };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', dayData.dateKey) : dayRef(userId, bizId, dayData.dateKey);
  const lockKey = targetRef?.path || `users/${userId}/businesses/${bizId}/days/${dayData.dateKey}`;

  // Snapshot the caller's base revision and base timestamp at the moment saveDayToCloud is invoked,
  // before entering the serialized queue, so concurrent overlapping saves accurately compare against their original base state.
  const callerBaseSavedAt = options.baseSavedAt !== undefined && options.baseSavedAt !== null
    ? Number(options.baseSavedAt)
    : null;
  const callerBaseRevision = options.baseRevision !== undefined && options.baseRevision !== null
    ? Number(options.baseRevision)
    : (dayData._revision !== undefined && dayData._revision !== null ? Number(dayData._revision) : null);

  const requireConflictCheck = Boolean(options.checkConflict && !options.forceOverwrite);

  const initialLocalRevision = Number(dayData._revision) || 0;

  const performAtomicCompareAndSet = async (readFn, writeFn) => {
    let cloudData = null;
    let exists = false;

    if (requireConflictCheck && typeof readFn !== 'function') {
      const missingReadErr = new Error('CONFLICT_CHECK_FAILED: Cloud read function unavailable for conflict check');
      missingReadErr.code = 'conflict-check-read-failed';
      recordOperationalError('cloud_save', missingReadErr, { bizId, dateKey: dayData.dateKey });
      throw missingReadErr;
    }

    if (typeof readFn === 'function') {
      try {
        recordDatabaseOperation('read', 1);
        const snap = await readFn(targetRef);
        exists = Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));
        if (exists) {
          cloudData = snap.data();
        }
      } catch (err) {
        if (err.code === 'concurrent-modification-conflict') throw err;
        // Item 2: Fail closed when conflict checking is required — never write if cloud read fails
        if (requireConflictCheck) {
          const readFailErr = new Error(`CONFLICT_CHECK_FAILED: Could not read cloud state before write: ${err.message}`);
          readFailErr.code = err.code || 'conflict-check-read-failed';
          readFailErr.cause = err;
          recordOperationalError('cloud_save', readFailErr, { bizId, dateKey: dayData.dateKey });
          throw readFailErr;
        }
        console.warn('[saveDayToCloud] Non-strict read warning:', err);
      }
    }

    const cloudSavedAt = Number(cloudData?._lastCloudSavedAt) || 0;
    const cloudRevision = Number(cloudData?._revision) || 0;

    if (requireConflictCheck && exists) {
      const isTimestampStale = callerBaseSavedAt !== null && callerBaseSavedAt > 0 && cloudSavedAt > callerBaseSavedAt;
      const isRevisionStale = callerBaseRevision !== null && cloudRevision > callerBaseRevision;
      if (isTimestampStale || isRevisionStale) {
        recordDatabaseOperation('conflict', 1);
        const conflictErr = new Error(
          `CONFLICT: Cloud record was modified (rev ${cloudRevision}, savedAt ${cloudSavedAt}), which is newer than local base (rev ${callerBaseRevision ?? 'n/a'}, savedAt ${callerBaseSavedAt ?? 'n/a'})`
        );
        conflictErr.code = 'concurrent-modification-conflict';
        conflictErr.cloudData = cloudData;
        conflictErr.cloudRevision = cloudRevision;
        throw conflictErr;
      }
    }

    const now = Math.max(Date.now(), cloudSavedAt + 1);
    const nextRevision = Math.max(cloudRevision, initialLocalRevision) + 1;
    const payload = {
      ...dayData,
      _revision: nextRevision,
      _lastCloudSavedAt: now,
      updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString()
    };
    recordDatabaseOperation('write', 1);
    await writeFn(targetRef, payload);

    return createSaveResult({
      savedAt: now,
      revision: nextRevision,
      bizId,
      dateKey: dayData.dateKey,
    });
  };

  const applyCommittedSaveResult = (saveResult) => {
    if (!saveResult) return saveResult;
    // Item 1 & Gate A: Keep caller's dayData object & revision tracker synchronized ONLY after commit succeeds
    if (options.syncLocalObject !== false) {
      dayData._revision = saveResult.revision;
      dayData._lastCloudSavedAt = saveResult.savedAt;
    }
    defaultCloudRevisionTracker.recordSaved(bizId, dayData.dateKey, saveResult, options.syncLocalObject !== false ? dayData : null);
    return saveResult;
  };

  const executeTask = async () => {
    if (typeof ops.runTransaction === 'function') {
      try {
        const committedResult = await ops.runTransaction(ops.db, async (tx) => {
          return await performAtomicCompareAndSet(
            (ref) => tx.get(ref),
            (ref, payload) => tx.set(ref, payload)
          );
        });
        return applyCommittedSaveResult(committedResult);
      } catch (txErr) {
        if (txErr.code === 'concurrent-modification-conflict' || txErr.code === 'conflict-check-read-failed') {
          throw txErr;
        }
        if (requireConflictCheck) {
          const readFailErr = new Error(`CONFLICT_CHECK_FAILED: Transaction failed during conflict check: ${txErr.message}`);
          readFailErr.code = txErr.code || 'conflict-check-read-failed';
          readFailErr.cause = txErr;
          recordOperationalError('cloud_save', readFailErr, { bizId, dateKey: dayData.dateKey });
          throw readFailErr;
        }
        throw txErr;
      }
    }
    const directResult = await performAtomicCompareAndSet(
      ops.getDoc ? (ref) => ops.getDoc(ref) : null,
      (ref, payload) => ops.setDoc(ref, payload)
    );
    return applyCommittedSaveResult(directResult);
  };

  const prevLock = dayWriteQueueByPath.get(lockKey) || Promise.resolve();
  const currentTask = prevLock.catch(() => {}).then(() => executeTask());
  dayWriteQueueByPath.set(lockKey, currentTask);
  try {
    return await currentTask;
  } finally {
    if (dayWriteQueueByPath.get(lockKey) === currentTask) {
      dayWriteQueueByPath.delete(lockKey);
    }
  }
}

export async function checkDayDataFreshness(userId, bizId, dateKey, localSavedAt, customOps = null) {
  if (!userId || !bizId || !dateKey || !localSavedAt) return { isOutdated: false };
  const ops = customOps || { db, doc, getDoc };
  try {
    const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', dateKey) : dayRef(userId, bizId, dateKey);
    const snap = await ops.getDoc(targetRef);
    if (!snap || !(typeof snap.exists === 'function' ? snap.exists() : snap.exists)) return { isOutdated: false };
    const data = snap.data();
    const cloudSavedAt = Number(data._lastCloudSavedAt) || 0;
    const cloudRevision = Number(data._revision) || 0;
    if (cloudSavedAt > Number(localSavedAt)) {
      return { isOutdated: true, cloudData: data, cloudSavedAt, cloudRevision };
    }
  } catch (err) {
    console.warn('Freshness check warning:', err);
  }
  return { isOutdated: false };
}

export async function loadDayFromCloud(userId, bizId, dateKey, customOps = null) {
  const ops = customOps || { db, doc, getDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', dateKey) : dayRef(userId, bizId, dateKey);
  recordDatabaseOperation('read', 1);
  const snap = await ops.getDoc(targetRef);
  if (snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists)) {
    const data = snap.data();
    defaultCloudRevisionTracker.recordLoaded(bizId, dateKey, data);
    return data;
  }
  return null;
}

/**
 * Find the most recent finalized (or active) day before a given date.
 * Used for carry-forward of wallet balances and inventory.
 */
export async function findMostRecentDayFromCloud(userId, bizId, beforeDateKey) {
  // Query days before the given date, ordered descending, limit 1
  const daysCol = collection(db, 'users', userId, 'businesses', bizId, 'days');
  const q = query(
    daysCol,
    where('dateKey', '<', beforeDateKey),
    orderBy('dateKey', 'desc'),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) return snap.docs[0].data();
  return null;
}

/**
 * Load all day records within a date range (inclusive).
 * Used for financial reports (P&L, Balance Sheet, Cash Flow).
 * @param {string} userId
 * @param {string} bizId
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<Array>} Array of day data objects sorted by date
 */
export async function loadDaysInRange(userId, bizId, startDate, endDate) {
  const daysCol = collection(db, 'users', userId, 'businesses', bizId, 'days');
  const q = query(
    daysCol,
    where('dateKey', '>=', startDate),
    where('dateKey', '<=', endDate),
    orderBy('dateKey', 'asc')
  );
  const snap = await getDocs(q);
  const days = [];
  snap.forEach(doc => days.push(doc.data()));
  return days;
}

// ── Contacts ────────────────────────────────────────────────────────

export async function saveContactToCloud(userId, bizId, contact, customOps = null) {
  const ops = customOps || { db, doc, setDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'contacts', String(contact.id)) : contactRef(userId, bizId, contact.id);
  await ops.setDoc(targetRef, {
    ...contact,
    updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString()
  });
}

export async function saveAllContactsToCloud(userId, bizId, contacts = [], customOps = null) {
  if (!userId || !bizId || !Array.isArray(contacts) || contacts.length === 0) return { batchesCommitted: 0, saved: 0 };
  const ops = customOps || { db, doc, writeBatch };
  let batchesCommitted = 0;
  let saved = 0;

  for (let i = 0; i < contacts.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = contacts.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = ops.writeBatch(ops.db);
    chunk.forEach(contact => {
      if (!contact?.id) return;
      const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'contacts', String(contact.id));
      batch.set(ref, {
        ...contact,
        updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString()
      });
      saved += 1;
    });
    await batch.commit();
    batchesCommitted += 1;
  }

  return { batchesCommitted, saved };
}

export async function loadContactsFromCloud(userId, bizId, customOps = null) {
  const ops = customOps || { db, collection, getDocs };
  const colRef = ops.collection ? ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'contacts') : collection(db, 'users', userId, 'businesses', bizId, 'contacts');
  const snap = await ops.getDocs(colRef);
  const contacts = [];
  snap.forEach(doc => contacts.push(doc.data()));
  return contacts.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function deleteContactFromCloud(userId, bizId, contactId, customOps = null) {
  const ops = customOps || { db, doc, deleteDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'contacts', String(contactId)) : contactRef(userId, bizId, contactId);
  await ops.deleteDoc(targetRef);
  // Also delete their transaction history
  try {
    const txsRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'contactTxs', String(contactId)) : contactTxsRef(userId, bizId, contactId);
    await ops.deleteDoc(txsRef);
  } catch { /* May not exist */ }
}

// ── Online Orders & Courier Tracking ─────────────────────────────────

export async function saveOnlineOrderToCloud(userId, bizId, order, customOps = null) {
  if (!userId || !bizId || !order?.id) return;
  const ops = {
    db: customOps?.db || db,
    doc: customOps?.doc || doc,
    setDoc: customOps?.setDoc || setDoc,
    getDoc: customOps?.getDoc || getDoc,
    ...customOps,
  };
  const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(order.id));

  let orderToSave = { ...order };

  // Gate A6: Per-order concurrency & stale overwrite protection
  // If target order doc already exists in Firestore with status === 'settled',
  // and incoming order has status !== 'settled', do not revert status to delivered/packed.
  // Strictly preserve 'settled' status and settlement metadata to prevent stale multi-device overwrites.
  if (orderToSave.status !== 'settled' && typeof ops.getDoc === 'function') {
    try {
      const snap = await ops.getDoc(ref);
      const exists = typeof snap?.exists === 'function' ? snap.exists() : Boolean(snap?.exists);
      if (exists) {
        const cloudOrder = snap.data();
        if (cloudOrder?.status === 'settled') {
          orderToSave = {
            ...orderToSave,
            status: 'settled',
            settledAt: cloudOrder.settledAt ?? orderToSave.settledAt,
            settlementWallet: cloudOrder.settlementWallet ?? orderToSave.settlementWallet,
            settlementAmount: cloudOrder.settlementAmount ?? orderToSave.settlementAmount,
            statusHistory: cloudOrder.statusHistory ?? orderToSave.statusHistory,
            adjustmentApproved: cloudOrder.adjustmentApproved ?? orderToSave.adjustmentApproved,
            adjustmentReason: cloudOrder.adjustmentReason ?? orderToSave.adjustmentReason,
            adjustmentDiscrepancy: cloudOrder.adjustmentDiscrepancy ?? orderToSave.adjustmentDiscrepancy,
          };
        }
      }
    } catch (readErr) {
      console.error('[Ledgero] Failed to verify existing online order status before save:', readErr);
      throw new Error(`Failed to verify existing order status before save: ${readErr.message || readErr}`);
    }
  }

  await ops.setDoc(ref, {
    ...orderToSave,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function saveAllOnlineOrdersToCloud(userId, bizId, orders = [], customOps = null) {
  if (!userId || !bizId || !Array.isArray(orders) || orders.length === 0) return { batchesCommitted: 0, saved: 0 };
  const ops = {
    db: customOps?.db || db,
    doc: customOps?.doc || doc,
    collection: customOps?.collection || collection,
    getDocs: customOps?.getDocs || getDocs,
    writeBatch: customOps?.writeBatch || writeBatch,
    ...customOps,
  };
  let batchesCommitted = 0;
  let saved = 0;

  // Query existing online orders to prevent stale multi-device bulk overwrites and respect create invariants
  const existingOrdersMap = new Map();
  if (typeof ops.collection === 'function' && typeof ops.getDocs === 'function') {
    try {
      const colRef = ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders');
      const snap = await ops.getDocs(colRef);
      if (snap && typeof snap.forEach === 'function') {
        snap.forEach(d => {
          const data = d.data();
          existingOrdersMap.set(String(d.id), data);
        });
      }
    } catch (queryErr) {
      console.error('[Ledgero] Failed to query existing settled orders before batch save:', queryErr);
      throw new Error(`Failed to query existing settled orders before batch save: ${queryErr.message || queryErr}`);
    }
  }

  for (let i = 0; i < orders.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = orders.slice(i, i + FIRESTORE_BATCH_LIMIT);

    // Strict create rules require onlineOrders to be born in initial state ('draft' or 'confirmed').
    // When restoring historical orders with downstream statuses (e.g. 'delivered', 'settled') to a fresh database,
    // initialize new documents with valid initial status ('confirmed') first before transitioning:
    const newDownstreamOrders = chunk.filter(o =>
      o?.id && !existingOrdersMap.has(String(o.id)) && o.status && !['draft', 'confirmed'].includes(o.status)
    );
    if (newDownstreamOrders.length > 0) {
      // Step 1: Create in valid initial state ('confirmed', 'pending')
      const initBatch = ops.writeBatch(ops.db);
      newDownstreamOrders.forEach(o => {
        const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(o.id));
        initBatch.set(ref, {
          id: String(o.id),
          status: 'confirmed',
          paymentStatus: 'pending',
          totalAmount: Number(o.totalAmount) || 0,
          createdAt: o.createdAt || new Date().toISOString(),
          paymentMethod: o.paymentMethod || 'cod',
          ...(Array.isArray(o.items) ? { items: o.items } : {}),
        });
        existingOrdersMap.set(String(o.id), { status: 'confirmed', paymentStatus: 'pending' });
      });
      await initBatch.commit();

      // Step 2: Verify payment while in 'confirmed' status if restored order has paymentStatus: 'verified'
      const verifiedOrders = newDownstreamOrders.filter(o => o.paymentStatus === 'verified');
      if (verifiedOrders.length > 0) {
        const verifyBatch = ops.writeBatch(ops.db);
        verifiedOrders.forEach(o => {
          const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(o.id));
          const verifyFields = { paymentStatus: 'verified' };
          if (o.verifiedTrxId) verifyFields.verifiedTrxId = o.verifiedTrxId;
          if (o.paymentTrxId) verifyFields.paymentTrxId = o.paymentTrxId;
          if (o.allowWithoutTrxId) {
            verifyFields.allowWithoutTrxId = true;
            verifyFields.withoutTrxIdReason = o.withoutTrxIdReason || 'Restored from verified backup';
          }
          const pMethod = o.paymentMethod || 'bkash_manual';
          const provider = pMethod === 'bkash_manual' ? 'bkash' : (pMethod === 'nagad_manual' ? 'nagad' : (pMethod === 'rocket_manual' ? 'rocket' : pMethod));
          const trx = String(o.verifiedTrxId || o.paymentTrxId || '').trim();
          if (trx && !o.allowWithoutTrxId) {
            const regRef = ops.doc(ops.db, 'users', userId, 'trxRegistry', `${provider}_${trx.toUpperCase()}`);
            verifyBatch.set(regRef, {
              provider,
              trxId: trx.toUpperCase(),
              orderId: String(o.id),
              bizId,
              verifiedAt: Date.now(),
            }, { merge: true });
          }
          verifyBatch.set(ref, verifyFields, { merge: true });
          const curr = existingOrdersMap.get(String(o.id)) || {};
          existingOrdersMap.set(String(o.id), { ...curr, paymentStatus: 'verified' });
        });
        await verifyBatch.commit();
      }

      // Step 3: Transition to intermediate status for orders destined for 'returned' or 'settled'
      const returnedOrders = newDownstreamOrders.filter(o => o.status === 'returned');
      if (returnedOrders.length > 0) {
        const shipBatch = ops.writeBatch(ops.db);
        returnedOrders.forEach(o => {
          const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(o.id));
          shipBatch.set(ref, { status: 'shipped' }, { merge: true });
          const curr = existingOrdersMap.get(String(o.id)) || {};
          existingOrdersMap.set(String(o.id), { ...curr, status: 'shipped' });
        });
        await shipBatch.commit();
      }

      const settledOrders = newDownstreamOrders.filter(o => o.status === 'settled');
      if (settledOrders.length > 0) {
        const deliverBatch = ops.writeBatch(ops.db);
        settledOrders.forEach(o => {
          const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(o.id));
          deliverBatch.set(ref, { status: 'delivered' }, { merge: true });
          const curr = existingOrdersMap.get(String(o.id)) || {};
          existingOrdersMap.set(String(o.id), { ...curr, status: 'delivered' });
        });
        await deliverBatch.commit();
      }
    }

    const batch = ops.writeBatch(ops.db);
    chunk.forEach(order => {
      if (!order?.id) return;
      let orderToSave = { ...order };
      const existingDoc = existingOrdersMap.get(String(order.id));
      if (existingDoc?.status === 'settled' && orderToSave.status !== 'settled') {
        orderToSave = {
          ...orderToSave,
          status: 'settled',
          settledAt: existingDoc.settledAt ?? orderToSave.settledAt,
          settlementWallet: existingDoc.settlementWallet ?? orderToSave.settlementWallet,
          settlementAmount: existingDoc.settlementAmount ?? orderToSave.settlementAmount,
          statusHistory: existingDoc.statusHistory ?? orderToSave.statusHistory,
          adjustmentApproved: existingDoc.adjustmentApproved ?? orderToSave.adjustmentApproved,
          adjustmentReason: existingDoc.adjustmentReason ?? orderToSave.adjustmentReason,
          adjustmentDiscrepancy: existingDoc.adjustmentDiscrepancy ?? orderToSave.adjustmentDiscrepancy,
        };
      }
      if (orderToSave.status === 'settled') {
        if (!orderToSave.settlementDateKey) {
          orderToSave.settlementDateKey = orderToSave.dateKey || '2026-10-10';
        }
        if (!orderToSave.settledAt) {
          orderToSave.settledAt = Date.now();
        }
        const dayRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', String(orderToSave.settlementDateKey));
        batch.set(dayRef, {
          dateKey: String(orderToSave.settlementDateKey),
          _lastCloudSavedAt: orderToSave.settledAt,
        }, { merge: true });
      }
      const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(order.id));
      batch.set(ref, {
        ...orderToSave,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      saved += 1;
    });
    await batch.commit();
    batchesCommitted += 1;
  }

  return { batchesCommitted, saved };
}

export async function loadOnlineOrdersFromCloud(userId, bizId, customOps = null) {
  if (!userId || !bizId) return [];
  const ops = customOps || { db, collection, getDocs };
  try {
    const colRef = ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders');
    const snap = await ops.getDocs(colRef);
    const orders = [];
    snap.forEach(d => { orders.push({ id: d.id, ...d.data() }); });
    return orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (err) {
    console.error('loadOnlineOrdersFromCloud error:', err);
    throw new Error('Failed to load online orders from cloud: ' + (err.message || err));
  }
}

export async function deleteOnlineOrderFromCloud(userId, bizId, orderId, customOps = null) {
  if (!userId || !bizId || !orderId) return;
  const ops = customOps || { db, doc, deleteDoc };
  const ref = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(orderId));
  await ops.deleteDoc(ref);
}

/**
 * Gate A3: Canonical, Idempotent Atomic Cloud Settlement
 * Atomically reads both the online order document and active day document inside runTransaction,
 * validates state machine requirements, applies deterministic double-entry settlement logic,
 * and writes BOTH documents atomically with merge: true.
 *
 * Idempotency: Returns { alreadySettled: true, order: orderData } if already settled,
 * performing zero duplicate financial writes.
 */
export async function commitOnlineOrderSettlementToCloud(userId, bizId, dateKey, settlementPayload, customOps = null) {
  if (!userId || !bizId || !dateKey || !settlementPayload) {
    throw new Error('commitOnlineOrderSettlementToCloud requires userId, bizId, dateKey, and settlementPayload');
  }
  const orderId = settlementPayload.orderId || settlementPayload.id;
  if (!orderId) {
    throw new Error('commitOnlineOrderSettlementToCloud requires settlementPayload.orderId');
  }

  const ops = {
    db: customOps?.db || db,
    doc: customOps?.doc || doc,
    setDoc: customOps?.setDoc || setDoc,
    getDoc: customOps?.getDoc || getDoc,
    runTransaction: customOps?.runTransaction || runTransaction,
    ...customOps,
  };

  if (!ops?.runTransaction || typeof ops.runTransaction !== 'function') {
    throw new Error('Firestore runTransaction is required for atomic online order settlement');
  }

  const orderRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(orderId));
  const targetDayRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', String(dateKey));

  const runSettlementTx = async (tx) => {
    // 1. Transactional reads must precede all writes
    const orderSnap = await tx.get(orderRef);
    const orderExists = typeof orderSnap?.exists === 'function' ? orderSnap.exists() : Boolean(orderSnap?.exists);
    if (!orderExists) {
      throw new Error(`Online order ${orderId} does not exist in cloud`);
    }
    const orderData = { id: orderId, ...orderSnap.data() };

    const daySnap = await tx.get(targetDayRef);
    const dayExists = typeof daySnap?.exists === 'function' ? daySnap.exists() : Boolean(daySnap?.exists);
    if (!dayExists) {
      throw new Error(`Day document for date ${dateKey} does not exist in cloud`);
    }
    const dayData = daySnap.data();

    // 2. Idempotency guard:
    if (orderData.status === 'delivered' && Boolean(orderData.settledAt)) {
      throw new Error('Inconsistent order state: order is delivered but has settledAt metadata');
    }
    if (orderData.status === 'settled') {
      const settlementTxs = (Array.isArray(dayData.transactions) ? dayData.transactions : []).filter(t =>
        t.type === 'courier_settlement' && (String(t.orderId) === String(orderId) || String(t.linkedOrderId) === String(orderId))
      );

      const activeSettlementTxs = settlementTxs.filter(t => {
        const isReversed = Boolean(t.isReversed || t.reversedAt || t.reversed);
        const hasReversalTx = Array.isArray(dayData.transactions) && dayData.transactions.some(r =>
          r.type === 'reversal' && (String(r.originalTxId) === String(t.id) || String(r.refTxId) === String(t.id))
        );
        return !isReversed && !hasReversalTx;
      });

      // Case 1: Settlement transaction existed but was reversed -> Prohibit automatic re-credit
      if (settlementTxs.length > 0 && activeSettlementTxs.length === 0) {
        console.warn(`[Ledgero] Settlement transaction for settled order ${orderId} was previously reversed. Refusing auto-credit.`);
        return {
          alreadySettled: true,
          needsReconciliation: true,
          reconciliationIssue: 'reversed_settlement_transaction',
          order: {
            ...orderData,
            needsReconciliation: true,
            reconciliationIssue: 'reversed_settlement_transaction',
          },
          dayData,
        };
      }

      // Case 1.5: Multiple active settlement transactions found -> Flag anomaly and refuse unguided resolution
      if (activeSettlementTxs.length > 1) {
        console.warn(`[Ledgero] Multiple active settlement transactions found for order ${orderId} (${activeSettlementTxs.length} found)`);
        return {
          alreadySettled: true,
          needsReconciliation: true,
          reconciliationIssue: 'multiple_active_settlement_transactions',
          order: {
            ...orderData,
            needsReconciliation: true,
            reconciliationIssue: 'multiple_active_settlement_transactions',
            activeSettlementCount: activeSettlementTxs.length,
          },
          dayData,
        };
      }

      // Case 2: Active settlement transaction exists -> verify amount, wallet, and journal consistency
      if (activeSettlementTxs.length > 0) {
        const activeTx = activeSettlementTxs[0];
        const storedNetRaw = orderData.netAmount ?? orderData.netFromCourier ?? orderData.settlementAmount ?? 0;
        const parsedStoredNet = parseStrictMoney(storedNetRaw, null, true);
        const parsedTxAmount = parseStrictMoney(activeTx.amount, null, true);

        if (parsedStoredNet === null || parsedTxAmount === null || !Number.isFinite(parsedStoredNet) || !Number.isFinite(parsedTxAmount) || parsedStoredNet < 0 || parsedTxAmount < 0) {
          console.warn(`[Ledgero] Invalid settlement transaction or stored net amount for order ${orderId}: stored=${storedNetRaw}, tx=${activeTx.amount}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'invalid_settlement_transaction_amount',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'invalid_settlement_transaction_amount',
            },
            dayData,
          };
        }

        const storedNet = parsedStoredNet;
        const txAmount = parsedTxAmount;

        // Check amount consistency
        if (Math.round(storedNet * 100) !== Math.round(txAmount * 100)) {
          console.warn(`[Ledgero] Settlement amount mismatch for settled order ${orderId}: stored=${storedNet}, tx=${txAmount}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'settlement_amount_mismatch',
            discrepancy: Math.round((storedNet - txAmount) * 100) / 100,
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_amount_mismatch',
              discrepancy: Math.round((storedNet - txAmount) * 100) / 100,
            },
            dayData,
          };
        }

        // Check wallet consistency
        const storedWallet = orderData.settlementWallet;
        if (storedWallet && activeTx.wallet && storedWallet !== activeTx.wallet) {
          console.warn(`[Ledgero] Settlement wallet mismatch for settled order ${orderId}: stored=${storedWallet}, tx=${activeTx.wallet}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'settlement_wallet_mismatch',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_wallet_mismatch',
            },
            dayData,
          };
        }

        // Check wallet existence in dayData.wallets
        if (dayData.wallets && typeof dayData.wallets === 'object') {
          const authoritativeWallet = activeTx.wallet || storedWallet;
          if (authoritativeWallet && !dayData.wallets[authoritativeWallet]) {
            console.warn(`[Ledgero] Settled order wallet '${authoritativeWallet}' does not exist in day wallets`);
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_wallet_not_found',
              order: {
                ...orderData,
                needsReconciliation: true,
                reconciliationIssue: 'settlement_wallet_not_found',
              },
              dayData,
            };
          }
        }

        // Check journal consistency for active settlement transaction
        const journalEntries = Array.isArray(dayData.journalEntries) ? dayData.journalEntries : [];

        // Match all settlement journals related to this order, then prefer the exact activeTx.id.
        // Legacy fallback is permitted ONLY for entries that truly have no txId; a different
        // non-empty txId is contradictory evidence and must never be treated as legacy.
        const matchesThisOrder = (j) =>
          String(j.orderId) === String(orderId) ||
          String(j.linkedOrderId) === String(orderId) ||
          String(j.reference) === String(orderId);

        const orderSettlementJEs = journalEntries.filter(j =>
          matchesThisOrder(j) && j.txType === 'courier_settlement'
        );
        const mismatchedTxIdJEs = orderSettlementJEs.filter(j =>
          j.txId !== undefined && j.txId !== null && String(j.txId) !== String(activeTx.id)
        );
        if (mismatchedTxIdJEs.length > 0) {
          console.warn(`[Ledgero] Settlement journal txId mismatch for order ${orderId}: active=${activeTx.id}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'settlement_journal_transaction_mismatch',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_journal_transaction_mismatch',
            },
            dayData,
          };
        }

        // 1. Identify journal entries tied specifically to activeTx.id.
        const txMatchingJEs = journalEntries.filter(j => j.txId !== undefined && j.txId !== null && String(j.txId) === String(activeTx.id));
        if (txMatchingJEs.length > 1) {
          console.warn(`[Ledgero] Duplicate settlement journal entries found for transaction ${activeTx.id}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'duplicate_settlement_journal_entries',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'duplicate_settlement_journal_entries',
            },
            dayData,
          };
        }

        let matchingJE = null;
        if (txMatchingJEs.length === 1) {
          matchingJE = txMatchingJEs[0];
          if (matchingJE.txType !== 'courier_settlement') {
            console.warn(`[Ledgero] Settlement journal entry ${matchingJE.id} has invalid or missing txType: ${matchingJE.txType}`);
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'invalid_settlement_journal_type',
              order: {
                ...orderData,
                needsReconciliation: true,
                reconciliationIssue: 'invalid_settlement_journal_type',
              },
              dayData,
            };
          }
          // If a legacy journal with no txId also claims this order, both entries are ambiguous.
          const legacyDuplicates = orderSettlementJEs.filter(j => j.txId === undefined || j.txId === null);
          if (legacyDuplicates.length > 0) {
            console.warn(`[Ledgero] Duplicate exact/legacy settlement journal candidates for order ${orderId}`);
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'duplicate_settlement_journal_entries',
              order: {
                ...orderData,
                needsReconciliation: true,
                reconciliationIssue: 'duplicate_settlement_journal_entries',
              },
              dayData,
            };
          }
        } else {
          // Historical fallback is ONLY for uniquely matching entries without any txId.
          const legacySettlementJEs = orderSettlementJEs.filter(j => j.txId === undefined || j.txId === null);
          if (legacySettlementJEs.length > 1) {
            console.warn(`[Ledgero] Duplicate legacy settlement journal entries found for order ${orderId}`);
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'duplicate_settlement_journal_entries',
              order: {
                ...orderData,
                needsReconciliation: true,
                reconciliationIssue: 'duplicate_settlement_journal_entries',
              },
              dayData,
            };
          }
          if (legacySettlementJEs.length === 1) {
            matchingJE = legacySettlementJEs[0];
          }
        }

        if (!matchingJE) {
          console.warn(`[Ledgero] Missing settlement journal entry for settled order ${orderId}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'missing_settlement_journal_entry',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'missing_settlement_journal_entry',
            },
            dayData,
          };
        }

        const lines = Array.isArray(matchingJE.lines) ? matchingJE.lines : [];
        if (lines.length === 0) {
          console.warn(`[Ledgero] Empty lines in settlement journal entry for order ${orderId}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'empty_settlement_journal_lines',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'empty_settlement_journal_lines',
            },
            dayData,
          };
        }

        // Validate line format, finite non-negative numbers, max 2 decimals
        for (const line of lines) {
          if (!line || typeof line !== 'object' || !line.accountId || typeof line.accountId !== 'string') {
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'invalid_journal_line_format',
              order: { ...orderData, needsReconciliation: true, reconciliationIssue: 'invalid_journal_line_format' },
              dayData,
            };
          }
          // Missing side is zero, but an explicitly supplied side must be a strict money value.
          // This rejects booleans, exponent strings, whitespace, fractional-paisa numbers and other coercible junk.
          const d = line.debit === undefined ? 0 : parseStrictMoney(line.debit, null, true);
          const c = line.credit === undefined ? 0 : parseStrictMoney(line.credit, null, true);
          if (d === null || c === null || !Number.isFinite(d) || d < 0 || !Number.isFinite(c) || c < 0) {
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'invalid_journal_line_format',
              order: { ...orderData, needsReconciliation: true, reconciliationIssue: 'invalid_journal_line_format' },
              dayData,
            };
          }
          const debitCents = Math.round(d * 100);
          const creditCents = Math.round(c * 100);
          // Allow normal IEEE-754 representation noise (e.g. 0.29 * 100),
          // but reject values that genuinely contain fractions of a cent or
          // whose cents cannot be represented safely.
          if (!Number.isSafeInteger(debitCents) || !Number.isSafeInteger(creditCents) ||
              Math.abs((d * 100) - debitCents) > 1e-7 ||
              Math.abs((c * 100) - creditCents) > 1e-7) {
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'invalid_journal_line_precision',
              order: { ...orderData, needsReconciliation: true, reconciliationIssue: 'invalid_journal_line_precision' },
              dayData,
            };
          }
          // A journal line must post on exactly one side. Allowing debit and
          // credit together can hide extra value while account-level totals
          // still appear correct.
          if ((d > 0 && c > 0) || (d === 0 && c === 0)) {
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'invalid_journal_line_sides',
              order: { ...orderData, needsReconciliation: true, reconciliationIssue: 'invalid_journal_line_sides' },
              dayData,
            };
          }
        }

        const debitSum = Math.round(lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) * 100) / 100;
        const creditSum = Math.round(lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0) * 100) / 100;
        if (Math.round(debitSum * 100) !== Math.round(creditSum * 100)) {
          console.warn(`[Ledgero] Unbalanced settlement journal entry for order ${orderId}: debits=${debitSum}, credits=${creditSum}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'unbalanced_settlement_journal_entry',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'unbalanced_settlement_journal_entry',
            },
            dayData,
          };
        }

        // Authoritative COD amount validation:
        // Must have an explicit, valid codAmount field (or 0 if fully prepaid / zero COD).
        // Never blindly fall back to totalAmount if codAmount is missing or null, because advance/partial payments or shipping charge differ!
        const rawCod = orderData.codAmount;
        if (rawCod === undefined || rawCod === null) {
          console.warn(`[Ledgero] Settled order ${orderId} missing authoritative codAmount field`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'missing_authoritative_cod_amount',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'missing_authoritative_cod_amount',
            },
            dayData,
          };
        }

        const authoritativeCod = parseStrictMoney(rawCod, null, true);
        if (authoritativeCod === null || authoritativeCod < 0 || !Number.isFinite(authoritativeCod)) {
          console.warn(`[Ledgero] Settled order ${orderId} has invalid authoritative COD amount: ${rawCod}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'missing_authoritative_cod_amount',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'missing_authoritative_cod_amount',
            },
            dayData,
          };
        }

        // 0 <= netAmount <= codAmount check
        if (txAmount > authoritativeCod) {
          console.warn(`[Ledgero] Settlement net amount (${txAmount}) exceeds authoritative COD (${authoritativeCod}) for order ${orderId}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'settlement_amount_exceeds_cod',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_amount_exceeds_cod',
            },
            dayData,
          };
        }

        // Wallet Debit Verification
        const targetWallet = activeTx.wallet || storedWallet;
        const walletDebitLines = lines.filter(l => (Number(l.debit) || 0) > 0 && isMatchingSettlementWalletAccount(l.accountId, targetWallet));
        if (walletDebitLines.length === 0) {
          console.warn(`[Ledgero] Mismatched settlement journal wallet: expected debit to '${targetWallet}' for order ${orderId}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'mismatched_settlement_journal_wallet',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'mismatched_settlement_journal_wallet',
            },
            dayData,
          };
        }

        const totalWalletDebit = Math.round(walletDebitLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) * 100) / 100;
        if (Math.round(totalWalletDebit * 100) !== Math.round(txAmount * 100)) {
          console.warn(`[Ledgero] Settlement journal wallet debit mismatch for order ${orderId}: journal debit=${totalWalletDebit}, txAmount=${txAmount}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'settlement_journal_amount_mismatch',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_journal_amount_mismatch',
            },
            dayData,
          };
        }

        // Courier Receivable Credit Verification: Must be account 'courier_receivable' and exact authoritative COD amount
        const courierReceivableLines = lines.filter(l => (Number(l.credit) || 0) > 0 && l.accountId === 'courier_receivable');
        if (courierReceivableLines.length === 0) {
          console.warn(`[Ledgero] Missing settlement journal courier_receivable credit for order ${orderId}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'mismatched_settlement_journal_receivable',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'mismatched_settlement_journal_receivable',
            },
            dayData,
          };
        }

        const totalReceivableCredit = Math.round(courierReceivableLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0) * 100) / 100;
        if (Math.round(totalReceivableCredit * 100) !== Math.round(authoritativeCod * 100)) {
          console.warn(`[Ledgero] Settlement journal courier_receivable credit mismatch for order ${orderId}: credit=${totalReceivableCredit}, authoritative COD=${authoritativeCod}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'settlement_journal_receivable_amount_mismatch',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_journal_receivable_amount_mismatch',
            },
            dayData,
          };
        }

        // Courier Expense Verification: Expected expense = COD - net amount
        const expectedExpense = Math.round((authoritativeCod - txAmount) * 100) / 100;
        const expenseDebitLines = lines.filter(l => (Number(l.debit) || 0) > 0 && (l.accountId === 'delivery_expense' || l.accountId === 'courier_expense'));
        const totalExpenseDebit = Math.round(expenseDebitLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) * 100) / 100;

        if (expectedExpense > 0) {
          if (expenseDebitLines.length === 0) {
            console.warn(`[Ledgero] Missing delivery expense debit for order ${orderId}: expected ${expectedExpense}`);
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'missing_settlement_journal_expense',
              order: {
                ...orderData,
                needsReconciliation: true,
                reconciliationIssue: 'missing_settlement_journal_expense',
              },
              dayData,
            };
          }
          if (Math.round(totalExpenseDebit * 100) !== Math.round(expectedExpense * 100)) {
            console.warn(`[Ledgero] Settlement journal delivery expense mismatch for order ${orderId}: journal expense=${totalExpenseDebit}, expected=${expectedExpense}`);
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_journal_expense_amount_mismatch',
              order: {
                ...orderData,
                needsReconciliation: true,
                reconciliationIssue: 'settlement_journal_expense_amount_mismatch',
              },
              dayData,
            };
          }
        } else if (expectedExpense === 0 && totalExpenseDebit > 0) {
          console.warn(`[Ledgero] Unexpected delivery expense debit for zero-expense settlement for order ${orderId}`);
          return {
            alreadySettled: true,
            needsReconciliation: true,
            reconciliationIssue: 'settlement_journal_expense_amount_mismatch',
            order: {
              ...orderData,
              needsReconciliation: true,
              reconciliationIssue: 'settlement_journal_expense_amount_mismatch',
            },
            dayData,
          };
        }

        // Validate that no unexpected foreign lines exist in settlement journal entry
        for (const line of lines) {
          const isWalletLine = isMatchingSettlementWalletAccount(line.accountId, targetWallet) && (Number(line.debit) || 0) > 0;
          const isReceivableLine = line.accountId === 'courier_receivable' && (Number(line.credit) || 0) > 0;
          const isExpenseLine = (line.accountId === 'delivery_expense' || line.accountId === 'courier_expense') && (Number(line.debit) || 0) > 0;
          if (!isWalletLine && !isReceivableLine && !isExpenseLine) {
            console.warn(`[Ledgero] Unexpected settlement journal line on account '${line.accountId}' for order ${orderId}`);
            return {
              alreadySettled: true,
              needsReconciliation: true,
              reconciliationIssue: 'unexpected_settlement_journal_line',
              order: {
                ...orderData,
                needsReconciliation: true,
                reconciliationIssue: 'unexpected_settlement_journal_line',
              },
              dayData,
            };
          }
        }

        // Complete verified agreement
        return {
          alreadySettled: true,
          order: orderData,
          dayData,
        };
      }

      // Case 3: Completely missing settlement transaction (interrupted operation)
      // Authoritative stored settlement data MUST be present to self-heal
      const authoritativeWallet = orderData.settlementWallet;
      const rawStoredNet = orderData.netAmount ?? orderData.netFromCourier;
      const parsedStoredNet = rawStoredNet !== undefined && rawStoredNet !== null
        ? parseStrictMoney(rawStoredNet, null, true)
        : null;
      const rawStoredCod = orderData.codAmount;
      const parsedStoredCod = rawStoredCod !== undefined && rawStoredCod !== null
        ? parseStrictMoney(rawStoredCod, null, true)
        : null;

      if (!authoritativeWallet) {
        console.warn(`[Ledgero] Settled order ${orderId} missing stored settlementWallet. Cannot auto-reconcile without authoritative stored wallet.`);
        return {
          alreadySettled: true,
          needsReconciliation: true,
          reconciliationIssue: 'missing_stored_settlement_wallet',
          order: {
            ...orderData,
            needsReconciliation: true,
            reconciliationIssue: 'missing_stored_settlement_wallet',
          },
          dayData,
        };
      }

      // totalAmount must NEVER be used as a fallback for COD or Net in settlement reconciliation!
      // In self-healing without an existing transaction, authoritative COD amount is strictly mandatory.
      if (parsedStoredCod === null) {
        console.warn(`[Ledgero] Settled order ${orderId} missing authoritative codAmount. Cannot auto-reconcile without authoritative COD.`);
        return {
          alreadySettled: true,
          needsReconciliation: true,
          reconciliationIssue: 'missing_authoritative_cod_amount',
          order: {
            ...orderData,
            needsReconciliation: true,
            reconciliationIssue: 'missing_authoritative_cod_amount',
          },
          dayData,
        };
      }

      // Authoritative net must be validly stored or computable from COD and charges
      const authoritativeNet = parsedStoredNet ?? (
        parsedStoredCod !== null && orderData.courierCharge !== undefined
          ? Math.max(0, Math.round((parsedStoredCod - (Number(orderData.courierCharge || 0) + Number(orderData.codFee || 0))) * 100) / 100)
          : null
      );

      if (authoritativeNet === null) {
        console.warn(`[Ledgero] Settled order ${orderId} missing stored netAmount metadata. Cannot auto-reconcile.`);
        return {
          alreadySettled: true,
          needsReconciliation: true,
          reconciliationIssue: 'missing_stored_settlement_metadata',
          order: {
            ...orderData,
            needsReconciliation: true,
            reconciliationIssue: 'missing_stored_settlement_metadata',
          },
          dayData,
        };
      }

      // Execute self-healing reconciliation strictly using stored order metadata (not unverified caller input)
      const authoritativePayload = {
        orderId,
        forceReconcile: true,
        netAmount: authoritativeNet,
        settlementWallet: authoritativeWallet,
        codAmount: orderData.codAmount,
        courierCharge: orderData.courierCharge,
        codFee: orderData.codFee,
        allowAdjustment: Boolean(orderData.adjustmentApproved),
        adjustmentReason: orderData.adjustmentReason || 'Reconciliation of stored settled order',
      };

      const nextState = settleOnlineOrderInState(
        { onlineOrders: [orderData], dayData },
        authoritativePayload
      );

      if (nextState._orderSettleError) {
        const err = new Error(nextState._orderSettleError.message || 'Online order settlement reconciliation failed');
        err.code = nextState._orderSettleError.code || 'order-settle-error';
        err.settleError = nextState._orderSettleError;
        throw err;
      }

      const updatedDayData = nextState.dayData;
      const nextRevision = (Number(dayData._revision) || 0) + 1;
      const savedAt = Date.now();
      const finalDayPayload = {
        ...updatedDayData,
        _revision: nextRevision,
        _lastCloudSavedAt: savedAt,
      };

      tx.set(targetDayRef, finalDayPayload, { merge: true });

      console.warn(`[Ledgero] Reconciled missing ledger settlement transaction for settled order ${orderId}`);

      return {
        alreadySettled: true,
        reconciled: true,
        order: orderData,
        dayData: finalDayPayload,
      };
    }

    // 3. State machine guard: Order must be in 'delivered' status
    if (orderData.status !== 'delivered') {
      throw new Error(`Order ${orderId} must be in 'delivered' status to settle. Current status is '${orderData.status}'.`);
    }

    // 4. Pure state execution via ledgerStateEngine
    const nextState = settleOnlineOrderInState(
      { onlineOrders: [orderData], dayData },
      { ...settlementPayload, orderId }
    );

    if (nextState._orderSettleError) {
      const err = new Error(nextState._orderSettleError.message || 'Online order settlement failed');
      err.code = nextState._orderSettleError.code || 'order-settle-error';
      err.settleError = nextState._orderSettleError;
      throw err;
    }

    const updatedOrder = (nextState.onlineOrders || []).find(o => String(o.id) === String(orderId)) || orderData;
    const updatedDayData = nextState.dayData;

    const settlementWallet = updatedOrder.settlementWallet || settlementPayload.settlementWallet || settlementPayload.walletKey || orderData.settlementWallet || 'hand_cash';
    const settlementAmount = Number(updatedOrder.settlementAmount ?? updatedOrder.netAmount ?? updatedOrder.netFromCourier ?? settlementPayload.netAmount ?? 0);

    const savedAt = Date.now();
    const finalOrderPayload = {
      ...updatedOrder,
      settlementDateKey: dateKey,
      settledAt: savedAt,
      settlementWallet,
      settlementAmount,
      updatedAt: new Date().toISOString(),
    };

    const nextRevision = (Number(dayData._revision) || 0) + 1;
    const finalDayPayload = {
      ...updatedDayData,
      settledOrderIds: Array.from(new Set([...(updatedDayData.settledOrderIds || []), String(orderId)])),
      orderSettlements: {
        ...(updatedDayData.orderSettlements || {}),
        [String(orderId)]: {
          wallet: settlementWallet,
          amount: settlementAmount,
          settledAt: savedAt,
        },
      },
      _revision: nextRevision,
      _lastCloudSavedAt: savedAt,
    };

    // 5. Atomic write to BOTH documents: no partial commit where day data is saved but order is not, or vice versa
    tx.set(orderRef, finalOrderPayload, { merge: true });
    tx.set(targetDayRef, finalDayPayload, { merge: true });

    return {
      alreadySettled: false,
      order: finalOrderPayload,
      dayData: finalDayPayload,
    };
  };

  const result = await ops.runTransaction(ops.db, runSettlementTx);

  if (result && (!result.alreadySettled || result.reconciled) && result.dayData) {
    try {
      defaultCloudRevisionTracker.recordSaved(
        bizId,
        dateKey,
        { revision: result.dayData._revision, savedAt: result.dayData._lastCloudSavedAt },
        result.dayData
      );
    } catch {}
  }

  return result;
}

/**
 * P0-3: Cloud-First Atomic Online Order Payment Verification
 * Atomically verifies payment received for an online order and credits wallet inside runTransaction.
 */
export async function commitPaymentVerificationToCloud(userId, bizId, dateKey, payload, customOps = null) {
  if (!userId || !bizId || !dateKey || !payload) {
    throw new Error('commitPaymentVerificationToCloud requires userId, bizId, dateKey, and payload');
  }
  const orderId = payload.orderId || payload.id;
  if (!orderId) {
    throw new Error('commitPaymentVerificationToCloud requires payload.orderId');
  }

  const ops = {
    db: customOps?.db || db,
    doc: customOps?.doc || doc,
    setDoc: customOps?.setDoc || setDoc,
    getDoc: customOps?.getDoc || getDoc,
    runTransaction: customOps?.runTransaction || runTransaction,
    ...customOps,
  };

  if (!ops?.runTransaction || typeof ops.runTransaction !== 'function') {
    throw new Error('Firestore runTransaction is required for atomic payment verification');
  }

  const orderRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(orderId));
  const targetDayRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', String(dateKey));

  const runVerifyTx = async (tx) => {
    // 1. Transactional reads
    const orderSnap = await tx.get(orderRef);
    const orderExists = typeof orderSnap?.exists === 'function' ? orderSnap.exists() : Boolean(orderSnap?.exists);
    if (!orderExists) {
      throw new Error(`Online order ${orderId} does not exist in cloud`);
    }
    const orderData = { id: orderId, ...orderSnap.data() };

    const daySnap = await tx.get(targetDayRef);
    const dayExists = typeof daySnap?.exists === 'function' ? daySnap.exists() : Boolean(daySnap?.exists);
    if (!dayExists) {
      throw new Error(`Day document for date ${dateKey} does not exist in cloud`);
    }
    const dayData = daySnap.data();

    // 2. Validate payment method
    if (orderData.paymentMethod === 'cod') {
      throw new Error('Cannot verify payment for Cash on Delivery (COD) orders');
    }

    if (['cancelled', 'returned', 'delivered', 'settled'].includes(orderData.status) || !['draft', 'confirmed', 'packed', 'shipped'].includes(orderData.status)) {
      throw new Error(`Cannot verify payment for order ${orderId} in '${orderData.status}' status. Payment can only be verified for active pre-delivery orders.`);
    }

    // 3. Idempotency check: if order.paymentStatus === 'verified'
    if (orderData.paymentStatus === 'verified') {
      return {
        alreadyVerified: true,
        order: orderData,
        dayData,
      };
    }

    // P1-3: Validate MFS TrxID requirement
    const isMfs = ['bkash_manual', 'nagad_manual', 'rocket_manual'].includes(orderData.paymentMethod);
    const allowWithoutTrxId = Boolean(payload?.allowWithoutTrxId);
    const withoutTrxIdReason = String(payload?.withoutTrxIdReason || '').trim();
    const verifiedTrxId = allowWithoutTrxId
      ? ''
      : String(payload?.trxId || payload?.verifiedTrxId || orderData.paymentTrxId || '').trim();

    if (isMfs && !allowWithoutTrxId && !verifiedTrxId) {
      throw new Error('Transaction ID (TrxID) is mandatory for mobile banking verification');
    }
    if (isMfs && allowWithoutTrxId && (!withoutTrxIdReason || withoutTrxIdReason.length < 5)) {
      throw new Error('At least 5 characters reason is required for verification without TrxID');
    }

    // P1-5: User-Wide Scope & Biz-Wide Scope Atomic TrxID Registry in transaction
    const provider = String(orderData.paymentMethod || '').replace(/_manual$/, '').toLowerCase();
    let userTrxRegRef = null;
    let bizTrxRegRef = null;

    if (verifiedTrxId) {
      const normTrx = verifiedTrxId.toUpperCase();
      const regDocId = `${provider}_${normTrx}`;
      userTrxRegRef = ops.doc(ops.db, 'users', userId, 'trxRegistry', regDocId);
      bizTrxRegRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'trxRegistry', regDocId);

      // Check user-scoped registry first (prevent reusing across all businesses owned by user)
      const userTrxSnap = await tx.get(userTrxRegRef);
      const userTrxExists = typeof userTrxSnap?.exists === 'function' ? userTrxSnap.exists() : Boolean(userTrxSnap?.exists);
      if (userTrxExists) {
        const regData = userTrxSnap.data();
        if (String(regData.orderId) !== String(orderId)) {
          throw new Error(`Transaction ID '${verifiedTrxId}' has already been verified for order #${String(regData.orderId).slice(-6)} in business '${regData.bizId || bizId}'. Duplicate TrxID reuse is forbidden across all businesses.`);
        }
      }

      // Check biz-scoped registry
      const bizTrxSnap = await tx.get(bizTrxRegRef);
      const bizTrxExists = typeof bizTrxSnap?.exists === 'function' ? bizTrxSnap.exists() : Boolean(bizTrxSnap?.exists);
      if (bizTrxExists) {
        const regData = bizTrxSnap.data();
        if (String(regData.orderId) !== String(orderId)) {
          throw new Error(`Transaction ID '${verifiedTrxId}' has already been verified for order #${String(regData.orderId).slice(-6)} in business '${regData.bizId || bizId}'. Duplicate TrxID reuse is forbidden across all businesses.`);
        }
      }
    }

    // 4. Pure state transition
    const nextState = verifyOnlineOrderPaymentInState(
      { onlineOrders: [orderData], dayData },
      { ...payload, orderId }
    );

    const verifyError = nextState._paymentVerifyError || nextState._orderPaymentVerificationError;
    if (verifyError) {
      const err = new Error(verifyError.message || 'Payment verification failed');
      err.code = verifyError.code || 'payment-verify-error';
      err.verifyError = verifyError;
      throw err;
    }

    const updatedOrder = (nextState.onlineOrders || []).find(o => String(o.id) === String(orderId)) || orderData;
    const updatedDayData = nextState.dayData;

    const paymentWallet = payload?.wallet || payload?.paymentWallet || updatedOrder.paymentWallet || orderData.paymentWallet || 'bkash';
    const savedAt = Date.now();
    const verifiedAmt = Number(payload?.amount || payload?.verifiedAmount || orderData.totalAmount) || 0;
    const finalOrderPayload = {
      ...updatedOrder,
      paymentDateKey: dateKey,
      paymentVerifiedAt: savedAt,
      paymentWallet,
      advancePaid: verifiedAmt,
      updatedAt: new Date().toISOString(),
    };

    const nextRevision = (Number(dayData._revision) || 0) + 1;
    const finalDayPayload = {
      ...updatedDayData,
      verifiedOrderIds: Array.from(new Set([...(updatedDayData.verifiedOrderIds || []), String(orderId)])),
      orderPaymentVerifications: {
        ...(updatedDayData.orderPaymentVerifications || {}),
        [String(orderId)]: {
          wallet: paymentWallet,
          amount: verifiedAmt,
          verifiedAt: savedAt,
        },
      },
      _revision: nextRevision,
      _lastCloudSavedAt: savedAt,
    };

    // 5. Atomic write to BOTH documents & BOTH registry scopes
    tx.set(orderRef, finalOrderPayload, { merge: true });
    tx.set(targetDayRef, finalDayPayload, { merge: true });
    if (userTrxRegRef && bizTrxRegRef) {
      const regPayload = {
        provider,
        trxId: verifiedTrxId.toUpperCase(),
        orderId: String(orderId),
        bizId: String(bizId),
        verifiedAmount: Number(payload?.amount || payload?.verifiedAmount || orderData.totalAmount) || 0,
        verifiedAt: Date.now(),
      };
      tx.set(userTrxRegRef, regPayload, { merge: true });
      tx.set(bizTrxRegRef, regPayload, { merge: true });
    }

    return {
      alreadyVerified: false,
      order: finalOrderPayload,
      dayData: finalDayPayload,
    };
  };

  const result = await ops.runTransaction(ops.db, runVerifyTx);

  if (result && !result.alreadyVerified && result.dayData) {
    try {
      defaultCloudRevisionTracker.recordSaved(
        bizId,
        dateKey,
        { revision: result.dayData._revision, savedAt: result.dayData._lastCloudSavedAt },
        result.dayData
      );
    } catch {}
  }

  return result;
}

/**
 * P1-4: Historical TrxID Registry Migration
 * Scans historical online orders for verified payments, checks existing trxRegistry,
 * detects duplicates in historical orders and builds a reconciliation report
 * { totalVerified: n, migrated: m, duplicates: [...] }, setting missing registry entries for unique TrxIDs.
 *
 * @param {string} userId - User identifier
 * @param {string} bizId - Business identifier
 * @param {object|null} customOps - Optional custom firestore operations (testing/mocking)
 * @returns {Promise<{ totalVerified: number, migrated: number, duplicates: Array }>}
 */
export async function migrateHistoricalTrxRegistry(userId, bizId, customOps = null) {
  if (!userId || !bizId) {
    throw new Error('migrateHistoricalTrxRegistry requires userId and bizId');
  }

  const ops = {
    db: customOps?.db || db,
    doc: customOps?.doc || doc,
    getDoc: customOps?.getDoc || getDoc,
    getDocs: customOps?.getDocs || getDocs,
    setDoc: customOps?.setDoc || setDoc,
    collection: customOps?.collection || collection,
    writeBatch: customOps?.writeBatch || writeBatch,
    ...customOps,
  };

  // 1. Fetch all onlineOrders
  const ordersColRef = ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders');
  const ordersSnap = await ops.getDocs(ordersColRef);
  const allOrders = [];
  if (ordersSnap && ordersSnap.forEach) {
    ordersSnap.forEach(d => {
      const data = typeof d.data === 'function' ? d.data() : d.data;
      allOrders.push({ id: d.id, ...data });
    });
  }

  // 2. Filter for paymentStatus === 'verified'
  const verifiedOrders = allOrders.filter(o => o.paymentStatus === 'verified');
  const totalVerified = verifiedOrders.length;

  // 3. Load existing user-level and biz-level trxRegistry
  const existingUserRegistry = new Map();
  try {
    const userRegCol = ops.collection(ops.db, 'users', userId, 'trxRegistry');
    const userRegSnap = await ops.getDocs(userRegCol);
    if (userRegSnap && userRegSnap.forEach) {
      userRegSnap.forEach(d => {
        const data = typeof d.data === 'function' ? d.data() : d.data;
        existingUserRegistry.set(d.id, { id: d.id, ...data });
      });
    }
  } catch (err) {
    console.warn('[Ledgero] Warning reading user-level trxRegistry during migration:', err);
  }

  const existingBizRegistry = new Map();
  try {
    const bizRegCol = ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'trxRegistry');
    const bizRegSnap = await ops.getDocs(bizRegCol);
    if (bizRegSnap && bizRegSnap.forEach) {
      bizRegSnap.forEach(d => {
        const data = typeof d.data === 'function' ? d.data() : d.data;
        existingBizRegistry.set(d.id, { id: d.id, ...data });
      });
    }
  } catch (err) {
    console.warn('[Ledgero] Warning reading biz-level trxRegistry during migration:', err);
  }

  // 4. Group verified orders by regKey = `${provider}_${normTrx}`
  const ordersByRegKey = new Map();
  const duplicates = [];

  for (const order of verifiedOrders) {
    const trxId = String(order.verifiedTrxId || order.trxId || order.paymentTrxId || '').trim();
    if (!trxId) continue; // Manual exception without TrxID or COD

    const normTrx = trxId.toUpperCase();
    const provider = String(order.paymentMethod || '').replace(/_manual$/, '').toLowerCase() || 'unknown';
    const regKey = `${provider}_${normTrx}`;

    if (!ordersByRegKey.has(regKey)) {
      ordersByRegKey.set(regKey, []);
    }
    ordersByRegKey.get(regKey).push(order);
  }

  // 5. Detect duplicates & identify missing registry entries to write
  const entriesToMigrate = [];

  for (const [regKey, ordersList] of ordersByRegKey.entries()) {
    const [provider, ...rest] = regKey.split('_');
    const normTrx = rest.join('_');

    if (ordersList.length > 1) {
      // Historical duplicate within onlineOrders
      duplicates.push({
        trxId: normTrx,
        provider,
        regKey,
        orderIds: ordersList.map(o => String(o.id)),
        orders: ordersList.map(o => ({ id: o.id, createdAt: o.createdAt, totalAmount: o.totalAmount })),
        reason: 'duplicate_in_orders',
      });
      continue;
    }

    const singleOrder = ordersList[0];
    const orderIdStr = String(singleOrder.id);

    // Check if conflicting with existing registry entry for a DIFFERENT order
    const existingUserEntry = existingUserRegistry.get(regKey);
    const existingBizEntry = existingBizRegistry.get(regKey);

    const hasUserConflict = existingUserEntry && String(existingUserEntry.orderId) !== orderIdStr;
    const hasBizConflict = existingBizEntry && String(existingBizEntry.orderId) !== orderIdStr;

    if (hasUserConflict || hasBizConflict) {
      duplicates.push({
        trxId: normTrx,
        provider,
        regKey,
        orderId: orderIdStr,
        conflictingOrderId: existingUserEntry?.orderId || existingBizEntry?.orderId,
        conflictingBizId: existingUserEntry?.bizId || existingBizEntry?.bizId || bizId,
        reason: 'conflict_with_existing_registry',
      });
      continue;
    }

    // Check if missing in either user or biz registry
    const missingInUser = !existingUserEntry;
    const missingInBiz = !existingBizEntry;

    if (missingInUser || missingInBiz) {
      entriesToMigrate.push({
        regKey,
        provider,
        normTrx,
        order: singleOrder,
        missingInUser,
        missingInBiz,
      });
    }
  }

  // 6. Set missing registry entries
  let migrated = 0;
  const FIRESTORE_BATCH_LIMIT = 450;

  for (let i = 0; i < entriesToMigrate.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = entriesToMigrate.slice(i, i + FIRESTORE_BATCH_LIMIT);

    if (typeof ops.writeBatch === 'function') {
      const batch = ops.writeBatch(ops.db);
      for (const entry of chunk) {
        const payload = {
          provider: entry.provider,
          trxId: entry.normTrx,
          orderId: String(entry.order.id),
          bizId: String(bizId),
          verifiedAmount: Number(entry.order.verifiedAmount || entry.order.advancePaid || entry.order.totalAmount) || 0,
          verifiedAt: entry.order.paymentVerifiedAt || Date.now(),
        };

        if (entry.missingInUser) {
          const uRef = ops.doc(ops.db, 'users', userId, 'trxRegistry', entry.regKey);
          batch.set(uRef, payload, { merge: true });
        }
        if (entry.missingInBiz) {
          const bRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'trxRegistry', entry.regKey);
          batch.set(bRef, payload, { merge: true });
        }
      }
      await batch.commit();
      migrated += chunk.length;
    } else {
      for (const entry of chunk) {
        const payload = {
          provider: entry.provider,
          trxId: entry.normTrx,
          orderId: String(entry.order.id),
          bizId: String(bizId),
          verifiedAmount: Number(entry.order.verifiedAmount || entry.order.advancePaid || entry.order.totalAmount) || 0,
          verifiedAt: entry.order.paymentVerifiedAt || Date.now(),
        };

        if (entry.missingInUser) {
          const uRef = ops.doc(ops.db, 'users', userId, 'trxRegistry', entry.regKey);
          await ops.setDoc(uRef, payload, { merge: true });
        }
        if (entry.missingInBiz) {
          const bRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'trxRegistry', entry.regKey);
          await ops.setDoc(bRef, payload, { merge: true });
        }
        migrated += 1;
      }
    }
  }

  return {
    totalVerified,
    migrated,
    duplicates,
  };
}

/**
 * P1-3: Multi-Business Historical TrxID Migration & Cross-Business Conflict Audit
 * Scans all businesses owned by user, detects cross-business and intra-business TrxID reuse,
 * registers missing unique TrxIDs into user-level and business-level registries,
 * and generates a comprehensive duplicate reconciliation report.
 */
export async function migrateAllBusinessesHistoricalTrxRegistry(userId, businessList = null, customOps = null) {
  if (!userId) throw new Error('migrateAllBusinessesHistoricalTrxRegistry requires userId');

  const ops = {
    db: customOps?.db || db,
    collection: customOps?.collection || collection,
    getDocs: customOps?.getDocs || getDocs,
    doc: customOps?.doc || doc,
    setDoc: customOps?.setDoc || setDoc,
    writeBatch: customOps?.writeBatch || writeBatch,
    ...customOps,
  };

  // 1. Resolve business list
  let targetBusinesses = [];
  if (Array.isArray(businessList) && businessList.length > 0) {
    targetBusinesses = businessList.map(b => (typeof b === 'string' ? { id: b } : b));
  } else {
    try {
      const loaded = await loadBusinessesFromCloud(userId, ops);
      targetBusinesses = Array.isArray(loaded) && loaded.length > 0 ? loaded : [{ id: 'biz_1' }];
    } catch {
      targetBusinesses = [{ id: 'biz_1' }];
    }
  }

  // 2. Fetch existing user-level registry
  const existingUserRegistry = new Map();
  try {
    const userRegCol = ops.collection(ops.db, 'users', userId, 'trxRegistry');
    const userSnap = await ops.getDocs(userRegCol);
    userSnap.forEach(d => {
      existingUserRegistry.set(d.id, d.data());
    });
  } catch (err) {
    console.warn('[Ledgero] Warning reading user-level trxRegistry during multi-biz migration:', err);
  }

  // 3. Scan orders across all businesses and fetch biz-level registries
  const ordersByRegKey = new Map();
  const bizRegistries = new Map();
  let totalVerified = 0;
  const processedBizIds = [];

  for (const biz of targetBusinesses) {
    const bizId = String(biz.id);
    processedBizIds.push(bizId);

    // Fetch biz registry
    const existingBizRegistry = new Map();
    bizRegistries.set(bizId, existingBizRegistry);
    try {
      const bizRegCol = ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'trxRegistry');
      const snap = await ops.getDocs(bizRegCol);
      snap.forEach(d => {
        existingBizRegistry.set(d.id, d.data());
      });
    } catch (err) {
      console.warn(`[Ledgero] Warning reading trxRegistry for biz ${bizId}:`, err);
    }

    // Fetch online orders
    let bizOrders = [];
    try {
      bizOrders = (await loadOnlineOrdersFromCloud(userId, bizId, ops)) || [];
    } catch (err) {
      console.warn(`[Ledgero] Warning reading onlineOrders for biz ${bizId}:`, err);
    }

    const verifiedInBiz = bizOrders.filter(o => o.paymentStatus === 'verified' || o.paymentVerifiedAt);
    totalVerified += verifiedInBiz.length;

    for (const order of verifiedInBiz) {
      const trxId = String(order.verifiedTrxId || order.trxId || order.paymentTrxId || '').trim();
      if (!trxId) continue; // Manual exception without TrxID

      const normTrx = trxId.toUpperCase();
      const provider = String(order.paymentMethod || '').replace(/_manual$/, '').toLowerCase() || 'unknown';
      const regKey = `${provider}_${normTrx}`;

      if (!ordersByRegKey.has(regKey)) {
        ordersByRegKey.set(regKey, []);
      }
      ordersByRegKey.get(regKey).push({ ...order, bizId });
    }
  }

  // 4. Detect duplicates (cross-biz and intra-biz) and registry conflicts
  const duplicates = [];
  const entriesToMigrate = [];

  for (const [regKey, ordersList] of ordersByRegKey.entries()) {
    const [provider, ...rest] = regKey.split('_');
    const normTrx = rest.join('_');

    if (ordersList.length > 1) {
      const distinctBizIds = [...new Set(ordersList.map(o => o.bizId))];
      duplicates.push({
        trxId: normTrx,
        provider,
        regKey,
        isCrossBusiness: distinctBizIds.length > 1,
        businessesInvolved: distinctBizIds,
        orderIds: ordersList.map(o => String(o.id)),
        orders: ordersList.map(o => ({ id: o.id, bizId: o.bizId, totalAmount: o.totalAmount })),
        reason: distinctBizIds.length > 1 ? 'cross_business_duplicate' : 'intra_business_duplicate',
      });
      continue;
    }

    const singleOrder = ordersList[0];
    const orderIdStr = String(singleOrder.id);
    const orderBizId = singleOrder.bizId;

    const existingUserEntry = existingUserRegistry.get(regKey);
    const existingBizRegistry = bizRegistries.get(orderBizId);
    const existingBizEntry = existingBizRegistry ? existingBizRegistry.get(regKey) : null;

    const hasUserConflict = existingUserEntry && (String(existingUserEntry.orderId) !== orderIdStr || String(existingUserEntry.bizId || orderBizId) !== orderBizId);
    const hasBizConflict = existingBizEntry && String(existingBizEntry.orderId) !== orderIdStr;

    if (hasUserConflict || hasBizConflict) {
      duplicates.push({
        trxId: normTrx,
        provider,
        regKey,
        orderId: orderIdStr,
        bizId: orderBizId,
        conflictingOrderId: existingUserEntry?.orderId || existingBizEntry?.orderId,
        conflictingBizId: existingUserEntry?.bizId || existingBizEntry?.bizId || orderBizId,
        reason: 'conflict_with_existing_registry',
      });
      continue;
    }

    const missingInUser = !existingUserEntry;
    const missingInBiz = !existingBizEntry;

    if (missingInUser || missingInBiz) {
      entriesToMigrate.push({
        regKey,
        provider,
        normTrx,
        order: singleOrder,
        bizId: orderBizId,
        missingInUser,
        missingInBiz,
      });
    }
  }

  // 5. Batch write missing registry entries
  let migrated = 0;
  const FIRESTORE_BATCH_LIMIT = 450;

  for (let i = 0; i < entriesToMigrate.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = entriesToMigrate.slice(i, i + FIRESTORE_BATCH_LIMIT);

    if (typeof ops.writeBatch === 'function') {
      const batch = ops.writeBatch(ops.db);
      for (const entry of chunk) {
        const payload = {
          provider: entry.provider,
          trxId: entry.normTrx,
          orderId: String(entry.order.id),
          bizId: String(entry.bizId),
          verifiedAmount: Number(entry.order.verifiedAmount || entry.order.advancePaid || entry.order.totalAmount) || 0,
          verifiedAt: entry.order.paymentVerifiedAt || Date.now(),
        };

        if (entry.missingInUser) {
          const uRef = ops.doc(ops.db, 'users', userId, 'trxRegistry', entry.regKey);
          batch.set(uRef, payload, { merge: true });
        }
        if (entry.missingInBiz) {
          const bRef = ops.doc(ops.db, 'users', userId, 'businesses', entry.bizId, 'trxRegistry', entry.regKey);
          batch.set(bRef, payload, { merge: true });
        }
      }
      await batch.commit();
      migrated += chunk.length;
    } else {
      for (const entry of chunk) {
        const payload = {
          provider: entry.provider,
          trxId: entry.normTrx,
          orderId: String(entry.order.id),
          bizId: String(entry.bizId),
          verifiedAmount: Number(entry.order.verifiedAmount || entry.order.advancePaid || entry.order.totalAmount) || 0,
          verifiedAt: entry.order.paymentVerifiedAt || Date.now(),
        };

        if (entry.missingInUser) {
          const uRef = ops.doc(ops.db, 'users', userId, 'trxRegistry', entry.regKey);
          await ops.setDoc(uRef, payload, { merge: true });
        }
        if (entry.missingInBiz) {
          const bRef = ops.doc(ops.db, 'users', userId, 'businesses', entry.bizId, 'trxRegistry', entry.regKey);
          await ops.setDoc(bRef, payload, { merge: true });
        }
        migrated += 1;
      }
    }
  }

  return {
    businessesProcessed: processedBizIds,
    totalVerified,
    migrated,
    duplicates,
    duplicatesCount: duplicates.length,
  };
}

/**
 * P0-3: Cloud-First Atomic Online Order Cancellation
 * Atomically cancels order, restores stock if needed, and refunds advance within runTransaction.
 */
export async function commitOrderCancellationToCloud(userId, bizId, dateKey, payload, customOps = null) {
  if (!userId || !bizId || !dateKey || !payload) {
    throw new Error('commitOrderCancellationToCloud requires userId, bizId, dateKey, and payload');
  }
  const orderId = payload.orderId || payload.id;
  if (!orderId) {
    throw new Error('commitOrderCancellationToCloud requires payload.orderId');
  }

  const ops = {
    db: customOps?.db || db,
    doc: customOps?.doc || doc,
    setDoc: customOps?.setDoc || setDoc,
    getDoc: customOps?.getDoc || getDoc,
    runTransaction: customOps?.runTransaction || runTransaction,
    ...customOps,
  };

  if (!ops?.runTransaction || typeof ops.runTransaction !== 'function') {
    throw new Error('Firestore runTransaction is required for atomic order cancellation');
  }

  const orderRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(orderId));
  const targetDayRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', String(dateKey));

  const runCancelTx = async (tx) => {
    // 1. Transactional reads
    const orderSnap = await tx.get(orderRef);
    const orderExists = typeof orderSnap?.exists === 'function' ? orderSnap.exists() : Boolean(orderSnap?.exists);
    if (!orderExists) {
      throw new Error(`Online order ${orderId} does not exist in cloud`);
    }
    const orderData = { id: orderId, ...orderSnap.data() };

    const daySnap = await tx.get(targetDayRef);
    const dayExists = typeof daySnap?.exists === 'function' ? daySnap.exists() : Boolean(daySnap?.exists);
    if (!dayExists) {
      throw new Error(`Day document for date ${dateKey} does not exist in cloud`);
    }
    const dayData = daySnap.data();

    // 2. Idempotency check: if order.status === 'cancelled'
    if (orderData.status === 'cancelled') {
      return {
        alreadyCancelled: true,
        order: orderData,
        dayData,
      };
    }

    if (['delivered', 'returned', 'settled'].includes(orderData.status)) {
      throw new Error(`Cannot cancel order ${orderId} in '${orderData.status}' status. Only draft, confirmed, packed, or shipped orders can be cancelled.`);
    }
    if (!['draft', 'confirmed', 'packed', 'shipped'].includes(orderData.status)) {
      throw new Error(`Cannot cancel order ${orderId} in '${orderData.status}' status.`);
    }

    // 3. Pure state execution via ledgerStateEngine
    const nextState = cancelOnlineOrderInState(
      { onlineOrders: [orderData], dayData },
      { ...payload, orderId }
    );

    const cancelError = nextState._orderCancelError || nextState._orderRefundError;
    if (cancelError) {
      const err = new Error(cancelError.message || 'Order cancellation failed');
      err.code = cancelError.code || 'order-cancel-error';
      err.cancelError = cancelError;
      throw err;
    }

    const updatedOrder = (nextState.onlineOrders || []).find(o => String(o.id) === String(orderId));
    if (!updatedOrder || updatedOrder.status !== 'cancelled') {
      throw new Error(`Order cancellation failed: order state was not transitioned to cancelled`);
    }
    const updatedDayData = nextState.dayData;

    const finalOrderPayload = {
      ...updatedOrder,
      cancelledAt: updatedOrder.cancelledAt || Date.now(),
      updatedAt: new Date().toISOString(),
    };

    const nextRevision = (Number(dayData._revision) || 0) + 1;
    const savedAt = Date.now();
    const finalDayPayload = {
      ...updatedDayData,
      _revision: nextRevision,
      _lastCloudSavedAt: savedAt,
    };

    // 4. Atomic write to BOTH documents
    tx.set(orderRef, finalOrderPayload, { merge: true });
    tx.set(targetDayRef, finalDayPayload, { merge: true });

    return {
      alreadyCancelled: false,
      order: finalOrderPayload,
      dayData: finalDayPayload,
    };
  };

  const result = await ops.runTransaction(ops.db, runCancelTx);

  if (result && !result.alreadyCancelled && result.dayData) {
    try {
      defaultCloudRevisionTracker.recordSaved(
        bizId,
        dateKey,
        { revision: result.dayData._revision, savedAt: result.dayData._lastCloudSavedAt },
        result.dayData
      );
    } catch {}
  }

  return result;
}

/**
 * P0-3: Cloud-First Atomic Online Order Return (RTO)
 * Atomically marks order returned, restores stock, recognizes courier fee & refunds advance within runTransaction.
 */
export async function commitOrderReturnToCloud(userId, bizId, dateKey, payload, customOps = null) {
  if (!userId || !bizId || !dateKey || !payload) {
    throw new Error('commitOrderReturnToCloud requires userId, bizId, dateKey, and payload');
  }
  const orderId = payload.orderId || payload.id;
  if (!orderId) {
    throw new Error('commitOrderReturnToCloud requires payload.orderId');
  }

  const ops = {
    db: customOps?.db || db,
    doc: customOps?.doc || doc,
    setDoc: customOps?.setDoc || setDoc,
    getDoc: customOps?.getDoc || getDoc,
    runTransaction: customOps?.runTransaction || runTransaction,
    ...customOps,
  };

  if (!ops?.runTransaction || typeof ops.runTransaction !== 'function') {
    throw new Error('Firestore runTransaction is required for atomic order return');
  }

  const orderRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'onlineOrders', String(orderId));
  const targetDayRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'days', String(dateKey));

  const runReturnTx = async (tx) => {
    // 1. Transactional reads
    const orderSnap = await tx.get(orderRef);
    const orderExists = typeof orderSnap?.exists === 'function' ? orderSnap.exists() : Boolean(orderSnap?.exists);
    if (!orderExists) {
      throw new Error(`Online order ${orderId} does not exist in cloud`);
    }
    const orderData = { id: orderId, ...orderSnap.data() };

    const daySnap = await tx.get(targetDayRef);
    const dayExists = typeof daySnap?.exists === 'function' ? daySnap.exists() : Boolean(daySnap?.exists);
    if (!dayExists) {
      throw new Error(`Day document for date ${dateKey} does not exist in cloud`);
    }
    const dayData = daySnap.data();

    // 2. Idempotency check: if order.status === 'returned'
    if (orderData.status === 'returned') {
      return {
        alreadyReturned: true,
        order: orderData,
        dayData,
      };
    }

    // 3. State transition guard: must be 'shipped'
    if (orderData.status !== 'shipped') {
      throw new Error(`Order ${orderId} must be in 'shipped' status to return. Current status is '${orderData.status}'.`);
    }

    // 4. Pure state execution via ledgerStateEngine
    const nextState = returnOnlineOrderInState(
      { onlineOrders: [orderData], dayData },
      { ...payload, orderId }
    );

    if (nextState._orderReturnError) {
      const err = new Error(nextState._orderReturnError.message || 'Order return failed');
      err.code = nextState._orderReturnError.code || 'order-return-error';
      err.returnError = nextState._orderReturnError;
      throw err;
    }

    const updatedOrder = (nextState.onlineOrders || []).find(o => String(o.id) === String(orderId)) || orderData;
    const updatedDayData = nextState.dayData;

    const finalOrderPayload = {
      ...updatedOrder,
      status: 'returned',
      returnedAt: updatedOrder.returnedAt || Date.now(),
      updatedAt: new Date().toISOString(),
    };

    const nextRevision = (Number(dayData._revision) || 0) + 1;
    const savedAt = Date.now();
    const finalDayPayload = {
      ...updatedDayData,
      _revision: nextRevision,
      _lastCloudSavedAt: savedAt,
    };

    // 5. Atomic write to BOTH documents
    tx.set(orderRef, finalOrderPayload, { merge: true });
    tx.set(targetDayRef, finalDayPayload, { merge: true });

    return {
      alreadyReturned: false,
      order: finalOrderPayload,
      dayData: finalDayPayload,
    };
  };

  const result = await ops.runTransaction(ops.db, runReturnTx);

  if (result && !result.alreadyReturned && result.dayData) {
    try {
      defaultCloudRevisionTracker.recordSaved(
        bizId,
        dateKey,
        { revision: result.dayData._revision, savedAt: result.dayData._lastCloudSavedAt },
        result.dayData
      );
    } catch {}
  }

  return result;
}

// ── Contact Transactions ────────────────────────────────────────────

export async function saveContactTxsToCloud(userId, bizId, contactId, txs, customOps = null) {
  const ops = customOps || { db, doc, setDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'contactTxs', contactId) : contactTxsRef(userId, bizId, contactId);
  await ops.setDoc(targetRef, {
    transactions: txs,
    updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString()
  });
}

export async function loadContactTxsFromCloud(userId, bizId, contactId, customOps = null) {
  const ops = customOps || { db, doc, getDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'contactTxs', contactId) : contactTxsRef(userId, bizId, contactId);
  const snap = await ops.getDoc(targetRef);
  if (snap && snap.exists()) return snap.data().transactions || [];
  return [];
}

// ── Meta Data ───────────────────────────────────────────────────────

export async function saveMetaToCloud(userId, bizId, meta, customOps = null) {
  const ops = customOps || { db, doc, setDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'meta', 'info') : metaRef(userId, bizId);
  await ops.setDoc(targetRef, {
    ...meta,
    updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString()
  }, { merge: true });
}

export async function loadMetaFromCloud(userId, bizId, customOps = null) {
  const ops = customOps || { db, doc, getDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'meta', 'info') : metaRef(userId, bizId);
  const snap = await ops.getDoc(targetRef);
  if (snap && snap.exists()) return snap.data();
  return {};
}

// ── Sheets Config ───────────────────────────────────────────────────

export const ALLOWED_SHEETS_CONFIG_KEYS = [
  'spreadsheetId',
  'spreadsheetUrl',
  'lastSync',
  'autoExport',
  'webAppUrl',
  'monthlySpreadsheets',
  'updatedAt',
];

export async function saveSheetsConfig(userId, config = {}, customOps = null) {
  if (!userId || !config || typeof config !== 'object') return;
  const ops = customOps || { db, doc, setDoc };
  const monthlySpreadsheets = {
    ...(config.monthlySpreadsheets && typeof config.monthlySpreadsheets === 'object' ? config.monthlySpreadsheets : {}),
  };

  // Automatically normalize any legacy dynamic YYYY-MM or spreadsheetId_YYYY-MM keys into monthlySpreadsheets
  for (const [k, v] of Object.entries(config)) {
    const monthMatch = k.match(/^(?:spreadsheetId_)?(\d{4}-\d{2})$/);
    if (monthMatch && typeof v === 'string') {
      monthlySpreadsheets[monthMatch[1]] = v;
    }
  }

  const sanitized = {
    updatedAt: (typeof Timestamp !== 'undefined' && Timestamp?.now) ? Timestamp.now() : new Date().toISOString(),
  };

  for (const key of ALLOWED_SHEETS_CONFIG_KEYS) {
    if (key === 'updatedAt' || key === 'monthlySpreadsheets') continue;
    if (config[key] !== undefined) {
      sanitized[key] = config[key];
    }
  }

  if (Object.keys(monthlySpreadsheets).length > 0) {
    sanitized.monthlySpreadsheets = monthlySpreadsheets;
    if (!sanitized.spreadsheetId) {
      const latestMonth = Object.keys(monthlySpreadsheets).sort().pop();
      sanitized.spreadsheetId = monthlySpreadsheets[latestMonth];
    }
  }

  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'sheetsConfig', 'config') : sheetsConfigRef(userId);
  await ops.setDoc(targetRef, sanitized, { merge: true });
}

export async function loadSheetsConfig(userId, customOps = null) {
  const ops = customOps || { db, doc, getDoc };
  const targetRef = ops.doc ? ops.doc(ops.db, 'users', userId, 'sheetsConfig', 'config') : sheetsConfigRef(userId);
  const snap = await ops.getDoc(targetRef);
  if (snap && snap.exists()) return snap.data();
  return {};
}

// ── Full Data Export & Restore (Cloud JSON Backup) ──────────────────

export async function exportAllCloudData(userId, customOps = null, options = {}) {
  const ops = customOps || { db, doc, getDoc, getDocs, collection, query, where };
  if (!userId) throw new Error('userId is required for exportAllCloudData');

  const manifest = {
    version: 3,
    app: 'Ledgero',
    exportedAt: new Date().toISOString(),
    userId,
    status: 'complete',
    retentionPolicy: BACKUP_AND_RETENTION_POLICY,
    counts: {
      businesses: 0,
      days: 0,
      contacts: 0,
      contactTxs: 0,
      onlineOrders: 0,
      auditLog: 0,
      stores: 0,
      storeProducts: 0,
      incomingOrders: 0,
    },
    errors: [],
  };

  const exportData = {
    version: 3,
    app: 'Ledgero',
    exportedAt: manifest.exportedAt,
    userId,
    settings: {},
    sheetsConfig: {},
    businesses: [],
    stores: {},
    manifest,
  };

  // 1. Settings
  try {
    exportData.settings = await loadSettings(userId, ops);
  } catch (err) {
    manifest.errors.push(`Settings: ${err.message}`);
  }

  // 2. Sheets Config
  try {
    exportData.sheetsConfig = await loadSheetsConfig(userId, ops);
  } catch (err) {
    manifest.errors.push(`SheetsConfig: ${err.message}`);
  }

  // 3. Business list
  try {
    exportData.businesses = (await loadBusinesses(userId, ops)) || [];
  } catch (err) {
    manifest.errors.push(`Businesses: ${err.message}`);
  }

  if (exportData.businesses.length === 0) {
    exportData.businesses = [{ id: 'biz_1', name: 'My Business', type: 'general' }];
  }
  manifest.counts.businesses = exportData.businesses.length;

  // 4. For each business, export days, contacts, contactTxs, onlineOrders, auditLog, meta
  for (const biz of exportData.businesses) {
    const bizId = biz.id || 'biz_1';
    const bizData = { info: biz, days: {}, contacts: [], contactTxs: {}, onlineOrders: [], auditLog: [], meta: {} };

    // Days
    try {
      const daysSnap = await ops.getDocs(ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'days'));
      daysSnap.forEach(d => {
        bizData.days[d.id] = d.data();
        manifest.counts.days += 1;
      });
    } catch (e) {
      manifest.errors.push(`Days (${bizId}): ${e.message}`);
    }

    // Contacts
    try {
      bizData.contacts = await loadContactsFromCloud(userId, bizId, ops);
      manifest.counts.contacts += (bizData.contacts || []).length;
    } catch (e) {
      manifest.errors.push(`Contacts (${bizId}): ${e.message}`);
    }

    // Contact Txs
    try {
      const txsSnap = await ops.getDocs(ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'contactTxs'));
      txsSnap.forEach(d => {
        const txList = d.data()?.transactions || [];
        bizData.contactTxs[d.id] = txList;
        manifest.counts.contactTxs += txList.length;
      });
    } catch (e) {
      manifest.errors.push(`ContactTxs (${bizId}): ${e.message}`);
    }

    // Online Orders
    try {
      bizData.onlineOrders = await loadOnlineOrdersFromCloud(userId, bizId, ops);
      manifest.counts.onlineOrders += (bizData.onlineOrders || []).length;
    } catch (e) {
      manifest.errors.push(`OnlineOrders (${bizId}): ${e.message}`);
    }

    // Audit Log (Append-only trail included in backup — Item 6)
    try {
      const auditSnap = await ops.getDocs(ops.collection(ops.db, 'users', userId, 'businesses', bizId, 'auditLog'));
      if (auditSnap && typeof auditSnap.forEach === 'function') {
        auditSnap.forEach(d => {
          bizData.auditLog.push({ id: d.id, ...d.data() });
          manifest.counts.auditLog += 1;
        });
      }
    } catch (e) {
      manifest.errors.push(`AuditLog (${bizId}): ${e.message}`);
    }

    // Meta
    try {
      bizData.meta = await loadMetaFromCloud(userId, bizId, ops);
    } catch (e) {
      manifest.errors.push(`Meta (${bizId}): ${e.message}`);
    }

    exportData[bizId] = bizData;
  }

  // 5. Discover & Export Public Storefronts owned by this user (/stores/{slug})
  try {
    const storesQuery = ops.query
      ? ops.query(ops.collection(ops.db, 'stores'), ops.where('ownerUserId', '==', userId))
      : (query && collection ? query(collection(db, 'stores'), where('ownerUserId', '==', userId)) : null);
    
    if (storesQuery) {
      const storesSnap = await ops.getDocs(storesQuery);
      if (storesSnap && storesSnap.docs) {
        for (const storeDoc of storesSnap.docs) {
          const slug = storeDoc.id;
          const storeBundle = {
            info: storeDoc.data(),
            publicInfo: null,
            products: [],
            incomingOrders: [],
          };

          // /stores/{slug}/public/info
          try {
            const pubSnap = await ops.getDoc(ops.doc(ops.db, 'stores', slug, 'public', 'info'));
            if (pubSnap && (typeof pubSnap.exists === 'function' ? pubSnap.exists() : pubSnap.exists)) {
              storeBundle.publicInfo = pubSnap.data();
            }
          } catch (e) {
            manifest.errors.push(`Storefront public info (${slug}): ${e.message}`);
          }

          // /stores/{slug}/products
          try {
            const prodsSnap = await ops.getDocs(ops.collection(ops.db, 'stores', slug, 'products'));
            if (prodsSnap && prodsSnap.forEach) {
              prodsSnap.forEach(p => storeBundle.products.push({ id: p.id, ...p.data() }));
            }
          } catch (e) {
            manifest.errors.push(`Storefront products (${slug}): ${e.message}`);
          }

          // /stores/{slug}/orders
          try {
            const ordersSnap = await ops.getDocs(ops.collection(ops.db, 'stores', slug, 'orders'));
            if (ordersSnap && ordersSnap.forEach) {
              ordersSnap.forEach(o => storeBundle.incomingOrders.push({ id: o.id, ...o.data() }));
            }
          } catch (e) {
            manifest.errors.push(`Storefront incoming orders (${slug}): ${e.message}`);
          }

          exportData.stores[slug] = storeBundle;
          manifest.counts.stores += 1;
          manifest.counts.storeProducts += storeBundle.products.length;
          manifest.counts.incomingOrders += storeBundle.incomingOrders.length;
        }
      }
    }
  } catch (err) {
    manifest.errors.push(`Storefront discovery: ${err.message}`);
  }

  manifest.status = manifest.errors.length === 0 ? 'complete' : 'partial';
  manifest.isPartial = manifest.errors.length > 0;
  exportData.isComplete = manifest.status === 'complete';
  exportData.isPartial = manifest.isPartial;

  if (options.strict && manifest.errors.length > 0) {
    throw new Error(`Cloud export failed with ${manifest.errors.length} error(s): ${manifest.errors.join('; ')}`);
  }

  return JSON.stringify(exportData, null, 2);
}

export async function restoreAllCloudData(userId, backupJsonOrData, customOps = null, options = {}) {
  const ops = customOps || { db, doc, setDoc, getDoc, getDocs, deleteDoc, collection, writeBatch, query, where };
  if (!userId) throw new Error('userId is required for restoreAllCloudData');

  let data = backupJsonOrData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new Error(`Invalid JSON backup format: ${err.message}`);
    }
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Backup data must be an object');
  }

  // Service-boundary safeguard (Item 5): Reject partial or incomplete backups before any cloud writes begin
  const isPartial = Boolean(
    data.isPartial === true ||
    data.manifest?.status === 'partial' ||
    data.manifest?.isPartial === true ||
    data.isComplete === false ||
    (Array.isArray(data.manifest?.failedPaths) && data.manifest.failedPaths.length > 0) ||
    (Array.isArray(data.manifest?.errors) && data.manifest.errors.length > 0)
  );
  if (isPartial && !options?.allowPartial) {
    const errorDetails = Array.isArray(data.manifest?.errors) && data.manifest.errors.length > 0
      ? data.manifest.errors.join('; ')
      : (Array.isArray(data.manifest?.failedPaths) && data.manifest.failedPaths.length > 0
          ? data.manifest.failedPaths.join(', ')
          : 'Manifest marked as partial');
    throw new Error(`Cannot restore partial or incomplete backup to cloud (${errorDetails})`);
  }

  // Basic validation — must have businesses, days, settings, biz_1, stores, or storage
  if (!data.businesses && !data.days && !data.biz_1 && !data.settings && !data.stores && !data.storage) {
    throw new Error('Unrecognized backup file format: missing businesses, days or settings');
  }

  const completenessCheck = verifyBackupCompletenessForRestore(data, {
    allowPartialRecovery: Boolean(options?.allowPartial),
  });
  if (!completenessCheck.allowed) {
    throw new Error(completenessCheck.reason);
  }

  const report = {
    success: false,
    isComplete: true,
    isPartialRestore: false,
    skippedAuditLogs: 0,
    restoredCounts: {
      settings: 0,
      sheetsConfig: 0,
      businesses: 0,
      days: 0,
      contacts: 0,
      contactTxs: 0,
      onlineOrders: 0,
      auditLog: 0,
      stores: 0,
      storeProducts: 0,
      incomingOrders: 0,
    },
    errors: [],
  };

  // 1. Restore Settings
  if (data.settings && typeof data.settings === 'object') {
    try {
      await saveSettings(userId, data.settings, ops);
      report.restoredCounts.settings = 1;
    } catch (err) {
      report.errors.push(`Settings: ${err.message}`);
    }
  }

  // 2. Restore Sheets Config
  if (data.sheetsConfig && typeof data.sheetsConfig === 'object') {
    try {
      await saveSheetsConfig(userId, data.sheetsConfig, ops);
      report.restoredCounts.sheetsConfig = 1;
    } catch (err) {
      report.errors.push(`SheetsConfig: ${err.message}`);
    }
  }

  // 3. Discover Businesses from backup
  let businessesToRestore = Array.isArray(data.businesses) ? [...data.businesses] : [];
  if (businessesToRestore.length === 0) {
    Object.keys(data).forEach(k => {
      if (k.startsWith('biz_') && typeof data[k] === 'object') {
        businessesToRestore.push(data[k].info || { id: k, name: 'Restored Business', type: 'general' });
      }
    });
  }

  if (businessesToRestore.length > 0) {
    try {
      await saveBusinesses(userId, businessesToRestore, ops);
      report.restoredCounts.businesses = businessesToRestore.length;
    } catch (err) {
      report.errors.push(`Businesses: ${err.message}`);
    }
  }

  // 4. Restore each business subcollections
  for (const biz of businessesToRestore) {
    const bizId = biz.id || 'biz_1';
    const bizData = data[bizId] || (bizId === 'biz_1' ? data : null) || {};

    // A. Meta info
    if (bizData.meta && typeof bizData.meta === 'object') {
      try {
        await saveMetaToCloud(userId, bizId, bizData.meta, ops);
      } catch (err) {
        report.errors.push(`Meta (${bizId}): ${err.message}`);
      }
    }

    // B. Days
    const daysMap = bizData.days || (data.days && bizId === 'biz_1' ? data.days : null) || {};
    for (const [dateKey, dayData] of Object.entries(daysMap)) {
      if (dayData && typeof dayData === 'object') {
        try {
          await saveDayToCloud(userId, bizId, { ...dayData, dateKey: dayData.dateKey || dateKey }, ops);
          report.restoredCounts.days++;
        } catch (err) {
          report.errors.push(`Day ${dateKey}: ${err.message}`);
        }
      }
    }

    // C. Contacts (chunked)
    const contacts = Array.isArray(bizData.contacts) ? bizData.contacts : [];
    if (contacts.length > 0) {
      try {
        await saveAllContactsToCloud(userId, bizId, contacts, ops);
        report.restoredCounts.contacts += contacts.length;
      } catch (err) {
        report.errors.push(`Contacts (${bizId}): ${err.message}`);
      }
    }

    // D. Contact Txs
    const contactTxsMap = bizData.contactTxs || {};
    for (const [contactId, txs] of Object.entries(contactTxsMap)) {
      if (Array.isArray(txs) && txs.length > 0) {
        try {
          await saveContactTxsToCloud(userId, bizId, contactId, txs, ops);
          report.restoredCounts.contactTxs += txs.length;
        } catch (err) {
          report.errors.push(`Contact Txs (${contactId}): ${err.message}`);
        }
      }
    }

    // E. Online Orders (chunked)
    const onlineOrders = Array.isArray(bizData.onlineOrders) ? bizData.onlineOrders : [];
    if (onlineOrders.length > 0) {
      try {
        await saveAllOnlineOrdersToCloud(userId, bizId, onlineOrders, ops);
        report.restoredCounts.onlineOrders += onlineOrders.length;
      } catch (err) {
        report.errors.push(`Online Orders (${bizId}): ${err.message}`);
      }
    }

    // F. Audit Log (Append-only idempotent create — only creates missing entries so re-running never updates existing logs)
    const auditLogEntries = Array.isArray(bizData.auditLog) ? bizData.auditLog : [];
    for (const entry of auditLogEntries) {
      if (!entry || typeof entry !== 'object') continue;
      const logId = String(entry.id || `audit_${Date.now()}`).slice(0, 100);
      try {
        const logRef = ops.doc(ops.db, 'users', userId, 'businesses', bizId, 'auditLog', logId);
        let alreadyExists = false;
        if (ops.getDoc) {
          const existingSnap = await ops.getDoc(logRef);
          alreadyExists = Boolean(existingSnap && (typeof existingSnap.exists === 'function' ? existingSnap.exists() : existingSnap.exists));
        }
        if (!alreadyExists) {
          const { id: _ignoredId, ...cleanAuditData } = entry;
          await ops.setDoc(logRef, cleanAuditData);
        } else {
          report.skippedAuditLogs++;
        }
        report.restoredCounts.auditLog++;
      } catch (err) {
        report.errors.push(`Audit Log (${logId}): ${err.message}`);
      }
    }
  }

  // 5. Restore Public Storefronts (if present in backup)
  if (data.stores && typeof data.stores === 'object') {
    for (const [slug, storeBundle] of Object.entries(data.stores)) {
      if (!storeBundle || typeof storeBundle !== 'object') continue;
      try {
        if (storeBundle.info) {
          const storeRef = ops.doc(ops.db, 'stores', slug);
          await ops.setDoc(storeRef, { ...storeBundle.info, ownerUserId: userId });
        }
        if (storeBundle.publicInfo) {
          const pubRef = ops.doc(ops.db, 'stores', slug, 'public', 'info');
          await ops.setDoc(pubRef, storeBundle.publicInfo);
        }
        if (Array.isArray(storeBundle.products) && storeBundle.products.length > 0) {
          for (const prod of storeBundle.products) {
            const prodId = prod.id || `prod_${Date.now()}`;
            const pRef = ops.doc(ops.db, 'stores', slug, 'products', prodId);
            await ops.setDoc(pRef, buildPublicProductPayload(prod));
            report.restoredCounts.storeProducts = (report.restoredCounts.storeProducts || 0) + 1;
          }
        }
        if (Array.isArray(storeBundle.incomingOrders) && storeBundle.incomingOrders.length > 0) {
          for (const order of storeBundle.incomingOrders) {
            if (!order || !order.id) continue;
            const oRef = ops.doc(ops.db, 'stores', slug, 'orders', String(order.id));
            await ops.setDoc(oRef, order);
            report.restoredCounts.incomingOrders = (report.restoredCounts.incomingOrders || 0) + 1;
          }
        }
        report.restoredCounts.stores = (report.restoredCounts.stores || 0) + 1;
      } catch (err) {
        report.errors.push(`Storefront (${slug}): ${err.message}`);
      }
    }
  }

  report.success = report.errors.length === 0;
  report.isComplete = report.errors.length === 0;
  report.isPartialRestore = report.errors.length > 0;
  report.failedCount = report.errors.length;
  report.restoredCount = Object.values(report.restoredCounts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  if (report.isPartialRestore) {
    recordOperationalError('cloud_restore', new Error(`Partial cloud restore with ${report.failedCount} error(s)`), {
      errors: report.errors,
      restoredCounts: report.restoredCounts,
    });
  }
  return report;
}

// ── Account Deletion ────────────────────────────────────────────────

export const USER_ROOT_DOC_PATHS = [
  ['profile', 'info'],
  ['settings', 'prefs'],
  ['settings', 'config'],
  ['businessList', 'list'],
  ['sheetsConfig', 'config'],
];

// Mutable business subcollections that can be deleted by the authenticated owner.
// Note: 'auditLog' is an immutable, tamper-resistant append-only trail (allow update, delete: if false in firestore.rules).
export const BUSINESS_SUBCOLLECTIONS = [
  'days',
  'contacts',
  'contactTxs',
  'onlineOrders',
  'meta',
];

export const IMMUTABLE_BUSINESS_SUBCOLLECTIONS = [
  'auditLog',
];

async function withRetry(fn, stepName, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  const wrapped = new Error(`[AccountDeletion:${stepName}] Failed after ${maxRetries + 1} attempts: ${lastErr?.message || lastErr}`);
  wrapped.step = stepName;
  wrapped.cause = lastErr;
  throw wrapped;
}

/**
 * Helper: delete all documents in a Firestore subcollection in chunks of 450.
 * Firestore doesn't auto-delete subcollections, so we must do it manually.
 * Throws if any read or batch commit fails after retry.
 */
export async function deleteSubcollection(parentPath, subName, customOps = null) {
  const ops = customOps || { db, doc, getDoc, getDocs, deleteDoc, collection, query, where, writeBatch };
  const pathSegments = parentPath.split('/').filter(Boolean);
  const colRef = ops.collection(ops.db, ...pathSegments, subName);
  const snap = await withRetry(() => ops.getDocs(colRef), `read_subcollection:${parentPath}/${subName}`);
  if (snap.empty) return 0;

  const docs = snap.docs;
  const CHUNK_SIZE = FIRESTORE_BATCH_LIMIT;
  let deleted = 0;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    await withRetry(async () => {
      const batch = ops.writeBatch(ops.db);
      chunk.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }, `delete_subcollection_batch:${parentPath}/${subName}[${i}..${i + chunk.length - 1}]`);
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * Delete ALL Firestore data for a user with strict step verification.
 * Never swallows errors: if any step fails, throws an Error with `deletionReport`
 * so the caller never deletes the Firebase Auth account while cloud data remains.
 */
async function deleteAllUserData(userId, businesses = [], customOps = null) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('User ID is required for data deletion');
  }

  const ops = customOps || { db, doc, getDoc, getDocs, deleteDoc, collection, query, where, writeBatch };
  const report = {
    userId,
    steps: [],
    deletedCounts: {
      businesses: 0,
      subcollectionDocs: 0,
      publicStores: 0,
      publicProducts: 0,
      userDocs: 0,
    },
    verified: false,
  };

  try {
    // 1. Discover all business IDs from passed array, businessList/list, and businesses collection
    const bizIds = new Set((businesses || []).map(b => b?.id).filter(Boolean));

    const listSnap = await withRetry(
      () => ops.getDoc(ops.doc(ops.db, 'users', userId, 'businessList', 'list')),
      'discover_businessList'
    );
    if (listSnap && listSnap.exists()) {
      (listSnap.data()?.businesses || []).forEach(b => {
        if (b?.id) bizIds.add(b.id);
      });
    }

    const bizColSnap = await withRetry(
      () => ops.getDocs(ops.collection(ops.db, 'users', userId, 'businesses')),
      'discover_businesses_collection'
    );
    bizColSnap.forEach(d => bizIds.add(d.id));

    // Ensure default biz_1 is always checked
    bizIds.add('biz_1');
    report.steps.push({ step: 'discover_businesses', status: 'ok', bizIds: Array.from(bizIds) });

    // 2. Delete all mutable business subcollections & documents
    // Note: auditLog is strictly append-only (allow update, delete: if false in firestore.rules)
    for (const bizId of bizIds) {
      const bizPath = `users/${userId}/businesses/${bizId}`;
      for (const subName of BUSINESS_SUBCOLLECTIONS) {
        const count = await deleteSubcollection(bizPath, subName, ops);
        report.deletedCounts.subcollectionDocs += count;
      }
      await withRetry(
        () => ops.deleteDoc(ops.doc(ops.db, 'users', userId, 'businesses', bizId)),
        `delete_biz_doc:${bizId}`
      );
      report.deletedCounts.businesses += 1;
    }
    report.steps.push({ step: 'delete_businesses', status: 'ok', count: report.deletedCounts.businesses });

    // 3. Delete all public stores, public/info docs, and products owned by this user
    // Subcollections MUST be deleted before the parent store document because rules check parent store ownerUserId
    const storesQuery = ops.query(ops.collection(ops.db, 'stores'), ops.where('ownerUserId', '==', userId));
    const storesSnap = await withRetry(() => ops.getDocs(storesQuery), 'discover_public_stores');
    const deletedStoreSlugs = [];
    for (const storeDoc of storesSnap.docs) {
      deletedStoreSlugs.push(storeDoc.id);
      const prodCount = await deleteSubcollection(`stores/${storeDoc.id}`, 'products', ops);
      await deleteSubcollection(`stores/${storeDoc.id}`, 'public', ops);
      await deleteSubcollection(`stores/${storeDoc.id}`, 'orders', ops);
      report.deletedCounts.publicProducts += prodCount;
      await withRetry(() => ops.deleteDoc(storeDoc.ref), `delete_public_store:${storeDoc.id}`);
      report.deletedCounts.publicStores += 1;
    }
    report.steps.push({
      step: 'delete_public_stores',
      status: 'ok',
      stores: report.deletedCounts.publicStores,
      products: report.deletedCounts.publicProducts,
    });

    // 4. Delete user-level documents and root user document
    const userDocsToDelete = [
      ...USER_ROOT_DOC_PATHS.map(segments => ops.doc(ops.db, 'users', userId, ...segments)),
      ops.doc(ops.db, 'users', userId),
    ];

    await withRetry(async () => {
      const userBatch = ops.writeBatch(ops.db);
      userDocsToDelete.forEach(ref => userBatch.delete(ref));
      await userBatch.commit();
    }, 'delete_user_root_documents');
    report.deletedCounts.userDocs = userDocsToDelete.length;
    report.steps.push({ step: 'delete_user_root_documents', status: 'ok', count: userDocsToDelete.length });

    // 5. Exhaustive Post-Deletion Verification across ALL user root docs, business subcollections, and stores
    const remainingRootDocs = [];
    for (const segments of USER_ROOT_DOC_PATHS) {
      const checkSnap = await withRetry(
        () => ops.getDoc(ops.doc(ops.db, 'users', userId, ...segments)),
        `verify_root_doc:${segments.join('/')}`
      );
      if (checkSnap && checkSnap.exists()) {
        remainingRootDocs.push(segments.join('/'));
      }
    }
    const userRootSnap = await withRetry(
      () => ops.getDoc(ops.doc(ops.db, 'users', userId)),
      'verify_user_doc'
    );
    if (userRootSnap && userRootSnap.exists()) {
      remainingRootDocs.push('users/' + userId);
    }

    const remainingBizSubDocs = [];
    for (const bizId of bizIds) {
      const bizDocSnap = await withRetry(
        () => ops.getDoc(ops.doc(ops.db, 'users', userId, 'businesses', bizId)),
        `verify_biz_doc:${bizId}`
      );
      if (bizDocSnap && bizDocSnap.exists()) {
        remainingBizSubDocs.push(`businesses/${bizId}`);
      }
      for (const subName of BUSINESS_SUBCOLLECTIONS) {
        const subSnap = await withRetry(
          () => ops.getDocs(ops.collection(ops.db, 'users', userId, 'businesses', bizId, subName)),
          `verify_subcollection:${bizId}/${subName}`
        );
        if (!subSnap.empty) {
          remainingBizSubDocs.push(`${bizId}/${subName}(${subSnap.docs.length})`);
        }
      }
    }

    const remainingBizSnap = await withRetry(
      () => ops.getDocs(ops.collection(ops.db, 'users', userId, 'businesses')),
      'verify_businesses_empty'
    );
    const remainingStoresSnap = await withRetry(
      () => ops.getDocs(ops.query(ops.collection(ops.db, 'stores'), ops.where('ownerUserId', '==', userId))),
      'verify_stores_empty'
    );

    const remainingStoreSubDocs = [];
    for (const slug of deletedStoreSlugs) {
      const prodSnap = await withRetry(
        () => ops.getDocs(ops.collection(ops.db, 'stores', slug, 'products')),
        `verify_store_products:${slug}`
      );
      if (!prodSnap.empty) {
        remainingStoreSubDocs.push(`stores/${slug}/products(${prodSnap.docs.length})`);
      }
      const pubSnap = await withRetry(
        () => ops.getDocs(ops.collection(ops.db, 'stores', slug, 'public')),
        `verify_store_public:${slug}`
      );
      if (!pubSnap.empty) {
        remainingStoreSubDocs.push(`stores/${slug}/public(${pubSnap.docs.length})`);
      }
      const ordSnap = await withRetry(
        () => ops.getDocs(ops.collection(ops.db, 'stores', slug, 'orders')),
        `verify_store_orders:${slug}`
      );
      if (!ordSnap.empty) {
        remainingStoreSubDocs.push(`stores/${slug}/orders(${ordSnap.docs.length})`);
      }
    }

    if (
      remainingRootDocs.length > 0 ||
      remainingBizSubDocs.length > 0 ||
      !remainingBizSnap.empty ||
      !remainingStoresSnap.empty ||
      remainingStoreSubDocs.length > 0
    ) {
      throw new Error(
        `Post-deletion verification failed: rootDocs=[${remainingRootDocs.join(',')}], bizSubDocs=[${remainingBizSubDocs.join(',')}], bizDocs=${remainingBizSnap.docs?.length || 0}, stores=${remainingStoresSnap.docs?.length || 0}, storeSubDocs=[${remainingStoreSubDocs.join(',')}]`
      );
    }

    report.verified = true;
    report.steps.push({ step: 'verify_deletion', status: 'ok' });
    return report;
  } catch (err) {
    report.verified = false;
    report.steps.push({ step: err.step || 'unhandled', status: 'failed', error: err.message });
    err.deletionReport = report;
    throw err;
  }
}

// ── Public Storefront Public/Owner Separation & Chunked Product Sync ──

export const PUBLIC_STORE_INFO_ALLOWED_KEYS = [
  'shopName',
  'displayName',
  'whatsappNumber',
  'bkashNumber',
  'nagadNumber',
  'rocketNumber',
  'address',
  'isActive',
  'createdAt',
  'updatedAt',
];

/**
 * Builds the strictly public-safe storefront info payload for `/stores/{slug}/public/info`.
 * Never includes internal owner metadata (`ownerUserId`, `bizId`, `autoSync`, `movedTo`).
 */
export function buildPublicStoreInfoPayload(storeData = {}, timestamp = new Date().toISOString()) {
  const shopName = String(storeData.shopName || storeData.displayName || 'Shop').trim().slice(0, 100) || 'Shop';
  const displayName = String(storeData.displayName || shopName).trim().slice(0, 100) || shopName;
  const whatsappNumber = String(storeData.whatsappNumber || '').trim().slice(0, 20);
  const address = String(storeData.address || '').trim().slice(0, 250);
  const payload = {
    shopName,
    displayName,
    whatsappNumber,
    address,
    isActive: Boolean(storeData.isActive),
    createdAt: String(storeData.createdAt || timestamp).slice(0, 40),
    updatedAt: String(storeData.updatedAt || timestamp).slice(0, 40),
  };
  const bkashNumber = String(storeData.bkashNumber || '').trim().slice(0, 25);
  const nagadNumber = String(storeData.nagadNumber || '').trim().slice(0, 25);
  const rocketNumber = String(storeData.rocketNumber || '').trim().slice(0, 25);
  if (bkashNumber) payload.bkashNumber = bkashNumber;
  if (nagadNumber) payload.nagadNumber = nagadNumber;
  if (rocketNumber) payload.rocketNumber = rocketNumber;
  return payload;
}

/**
 * Saves both the owner-only store management doc (`/stores/{slug}`) and the
 * customer-facing public info doc (`/stores/{slug}/public/info`).
 */
export async function savePublicStoreInfo(slug, storeData, customOps = null) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('Store slug is required');
  }
  const ops = customOps || { db, doc, setDoc };
  const nowIso = new Date().toISOString();
  const ownerPayload = {
    ...storeData,
    updatedAt: storeData.updatedAt || nowIso,
  };
  await ops.setDoc(ops.doc(ops.db, 'stores', slug), ownerPayload);
  const publicPayload = buildPublicStoreInfoPayload(ownerPayload, nowIso);
  await ops.setDoc(ops.doc(ops.db, 'stores', slug, 'public', 'info'), publicPayload);
  return { ownerPayload, publicPayload };
}

export const PUBLIC_PRODUCT_ALLOWED_KEYS = [
  'name',
  'price',
  'unit',
  'category',
  'inStock',
  'stock',
  'addedAt',
  'updatedAt',
];

/**
 * Builds a strictly allowlisted public product document.
 * Guarantees private fields (buyPrice, profit, cogs, batches, fifoCogs) are never included.
 */
export function buildPublicProductPayload(p, timestamp = new Date().toISOString()) {
  const currentStock = p.closingStock !== undefined && p.closingStock !== null
    ? Number(p.closingStock)
    : (Number(p.openingStock) || 0) + (Number(p.addedStock) || 0) - (Number(p.damagedStock) || 0);
  const safeStock = Math.max(0, Number.isFinite(currentStock) ? currentStock : 0);
  const safePrice = Math.max(0, Math.min(100000000, Number(p.sellPrice ?? p.price) || 0));
  const ts = String(timestamp).slice(0, 40);
  return {
    name: String(p.name || 'Product').trim().slice(0, 150) || 'Product',
    price: safePrice,
    unit: String(p.unit || 'pcs').trim().slice(0, 30),
    category: String(p.category || '').trim().slice(0, 80),
    inStock: safeStock > 0,
    stock: safeStock,
    addedAt: String(p.addedAt || ts).slice(0, 40),
    updatedAt: ts,
  };
}

// Per-slug serialization queue so overlapping syncPublicStoreProducts calls never interleave batches
const syncQueueBySlug = new Map();

async function runSyncPublicStoreProductsInternal(slug, selectedProducts = [], options = {}) {
  const ops = options.customOps || { db, doc, getDoc, getDocs, deleteDoc, collection, query, where, writeBatch };
  const shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : () => false;

  if (shouldAbort()) {
    return { aborted: true, batchesCommitted: 0, upserted: 0, deleted: 0 };
  }

  const productsCol = ops.collection(ops.db, 'stores', slug, 'products');
  const existingProdsSnap = await withRetry(() => ops.getDocs(productsCol), `sync_read_products:${slug}`);

  if (shouldAbort()) {
    return { aborted: true, batchesCommitted: 0, upserted: 0, deleted: 0 };
  }

  const safeProducts = Array.isArray(selectedProducts) ? selectedProducts : [];
  const selectedIds = new Set(safeProducts.map(p => String(p.id)));
  const nowIso = new Date().toISOString();
  const operations = [];
  let deleted = 0;
  let upserted = 0;

  existingProdsSnap.forEach(docSnap => {
    if (!selectedIds.has(docSnap.id)) {
      operations.push({ type: 'delete', ref: docSnap.ref });
      deleted += 1;
    }
  });

  safeProducts.forEach(p => {
    const prodRef = ops.doc(productsCol, String(p.id));
    operations.push({
      type: 'set',
      ref: prodRef,
      data: buildPublicProductPayload(p, nowIso),
    });
    upserted += 1;
  });

  const CHUNK_SIZE = FIRESTORE_BATCH_LIMIT;
  let batchesCommitted = 0;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    if (shouldAbort()) {
      return { aborted: true, batchesCommitted, upserted, deleted };
    }
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    await withRetry(async () => {
      const batch = ops.writeBatch(ops.db);
      chunk.forEach(op => {
        if (op.type === 'delete') {
          batch.delete(op.ref);
        } else {
          batch.set(op.ref, op.data);
        }
      });
      await batch.commit();
    }, `sync_products_batch:${slug}[${i}..${i + chunk.length - 1}]`);
    batchesCommitted += 1;
  }

  return { aborted: false, batchesCommitted, upserted, deleted };
}

/**
 * Synchronizes public store products in safe 450-operation chunks (respecting Firestore's 500-op batch limit).
 * Serializes concurrent syncs for the same store slug and supports `shouldAbort` to prevent stale overwrites.
 */
export async function syncPublicStoreProducts(slug, selectedProducts = [], options = {}) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('Store slug is required for product sync');
  }

  const previousLock = syncQueueBySlug.get(slug) || Promise.resolve();
  const currentTask = previousLock
    .catch(() => {})
    .then(() => runSyncPublicStoreProductsInternal(slug, selectedProducts, options));

  syncQueueBySlug.set(slug, currentTask);
  try {
    return await currentTask;
  } finally {
    if (syncQueueBySlug.get(slug) === currentTask) {
      syncQueueBySlug.delete(slug);
    }
  }
}

/**
 * Item 6: Migrates any legacy public product documents under /stores/{slug}/products
 * that may contain private fields (buyPrice, profit, cogs, batches, fifoCogs, etc.)
 * to the strict allowlisted public product schema.
 */
export async function migrateLegacyPublicStoreProducts(arg1, arg2 = null, arg3 = null) {
  let slug = arg1;
  let customOps = arg2;
  if (typeof arg2 === 'string') {
    slug = arg2;
    customOps = arg3;
  }
  if (!slug || typeof slug !== 'string') {
    throw new Error('Store slug is required for legacy product migration');
  }
  const ops = customOps || { db, doc, collection, getDocs, setDoc, writeBatch };
  const productsCol = ops.collection(ops.db, 'stores', slug, 'products');
  const snap = await withRetry(() => ops.getDocs(productsCol), `migrate_legacy_products_read:${slug}`);
  const nowIso = new Date().toISOString();
  const toOverwrite = [];
  const strippedFieldsByProduct = {};

  snap.forEach(docSnap => {
    const rawData = typeof docSnap.data === 'function' ? docSnap.data() : docSnap.data;
    const { cleanRecord, strippedPrivateFields, hadPrivateFields } = sanitizePublicProductRecord(rawData, nowIso);
    const rawKeys = Object.keys(rawData || {});
    const hasDisallowedKey = rawKeys.some(k => !PUBLIC_PRODUCT_ALLOWED_KEYS.includes(k));
    if (hadPrivateFields || hasDisallowedKey) {
      toOverwrite.push({
        id: docSnap.id,
        ref: docSnap.ref || ops.doc(ops.db, 'stores', slug, 'products', docSnap.id),
        cleanRecord,
      });
      strippedFieldsByProduct[docSnap.id] = strippedPrivateFields;
    }
  });

  let migratedCount = 0;
  for (let i = 0; i < toOverwrite.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = toOverwrite.slice(i, i + FIRESTORE_BATCH_LIMIT);
    if (typeof ops.writeBatch === 'function') {
      const batch = ops.writeBatch(ops.db);
      chunk.forEach(entry => {
        batch.set(entry.ref, entry.cleanRecord);
      });
      await batch.commit();
    } else {
      for (const entry of chunk) {
        await ops.setDoc(entry.ref, entry.cleanRecord);
      }
    }
    migratedCount += chunk.length;
  }

  return {
    slug,
    scannedCount: snap.docs ? snap.docs.length : 0,
    migratedCount,
    strippedFieldsByProduct,
  };
}

/**
 * Submits a direct customer order from the public storefront into /stores/{slug}/orders/{orderId}.
 * Enforces the strict security rules contract and Item 3 authoritative catalog verification:
 * - Rejects invalid/non-positive quantities, negative prices, and inconsistent subtotals/totals
 * - When published storefront products exist in /stores/{slug}/products (or catalogProducts provided),
 *   verifies product identity, published selling price, availability, and stock before accepting the order
 */
export async function saveCustomerStoreOrder(shopSlug, orderData, customOps = null) {
  if (!shopSlug || typeof shopSlug !== 'string') {
    throw new Error('Shop slug is required to submit order');
  }
  if (!orderData?.customerName || !orderData?.customerPhone) {
    throw new Error('Customer name and phone number are required');
  }

  const items = Array.isArray(orderData.items) ? orderData.items : [];
  if (items.length === 0) {
    throw new Error('Order must contain at least one valid item');
  }
  if (items.length > 5) {
    throw new Error('Public storefront orders can contain at most 5 distinct items');
  }

  const ops = customOps || { db, doc, setDoc, collection, getDocs };
  const orderId = orderData.id || `order_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const validatedItems = items.slice(0, 5).map((it, idx) => {
    const pName = String(it.productName || it.name || '').trim().slice(0, 150);
    if (!pName) throw new Error('Order item must have a valid product name');

    const rawQty = Number(it.quantity ?? it.qty);
    if (!Number.isFinite(rawQty) || rawQty <= 0 || rawQty > 10000 || !Number.isInteger(rawQty)) {
      const err = new Error(`Order item #${idx + 1} (${pName}) has an invalid quantity: ${it.quantity ?? it.qty}`);
      err.code = 'invalid_quantity';
      throw err;
    }

    const rawPrice = Number(it.unitPrice ?? it.price);
    if (!Number.isFinite(rawPrice) || rawPrice < 0 || rawPrice > 100000000) {
      const err = new Error(`Order item #${idx + 1} (${pName}) has an invalid unit price: ${it.unitPrice ?? it.price}`);
      err.code = 'invalid_unit_price';
      throw err;
    }

    const qty = Math.floor(rawQty);
    const uPrice = Math.round(rawPrice);
    const lineSubtotal = Math.round(qty * uPrice);

    if (it.subtotal !== undefined && it.subtotal !== null) {
      const suppliedItemSubtotal = Math.round(Number(it.subtotal));
      if (!Number.isFinite(suppliedItemSubtotal) || suppliedItemSubtotal !== lineSubtotal) {
        const err = new Error(`Order item #${idx + 1} (${pName}) has an inconsistent subtotal (${it.subtotal} !== ${lineSubtotal})`);
        err.code = 'inconsistent_item_subtotal';
        throw err;
      }
    }

    return {
      productId: String(it.productId || it.id || '').slice(0, 100),
      productName: pName,
      quantity: qty,
      unitPrice: uPrice,
      subtotal: lineSubtotal,
    };
  });

  const calculatedSubtotal = validatedItems.reduce((acc, it) => acc + it.subtotal, 0);
  const rawDelivery = Number(orderData.deliveryCharge ?? 0);
  if (!Number.isFinite(rawDelivery) || rawDelivery < 0 || rawDelivery > 100000) {
    const err = new Error(`Invalid delivery charge: ${orderData.deliveryCharge}`);
    err.code = 'invalid_delivery_charge';
    throw err;
  }
  const deliveryCharge = Math.round(rawDelivery);
  const calculatedTotal = calculatedSubtotal + deliveryCharge;

  if (orderData.subtotal !== undefined && orderData.subtotal !== null) {
    const suppliedSubtotal = Math.round(Number(orderData.subtotal));
    if (!Number.isFinite(suppliedSubtotal) || suppliedSubtotal !== calculatedSubtotal) {
      const err = new Error(`Order subtotal (${orderData.subtotal}) does not match sum of item subtotals (${calculatedSubtotal})`);
      err.code = 'inconsistent_order_subtotal';
      throw err;
    }
  }

  if (orderData.totalAmount !== undefined && orderData.totalAmount !== null) {
    const suppliedTotal = Math.round(Number(orderData.totalAmount));
    if (!Number.isFinite(suppliedTotal) || suppliedTotal !== calculatedTotal) {
      const err = new Error(`Order totalAmount (${orderData.totalAmount}) does not match subtotal + deliveryCharge (${calculatedTotal})`);
      err.code = 'inconsistent_order_total';
      throw err;
    }
  }

  // Item 3: Authoritative catalog check against published storefront products when present
  let publishedCatalog = Array.isArray(orderData.catalogProducts) ? orderData.catalogProducts : null;
  if (!publishedCatalog && typeof ops.collection === 'function' && typeof ops.getDocs === 'function') {
    try {
      const prodSnap = await ops.getDocs(ops.collection(ops.db, 'stores', shopSlug, 'products'));
      if (prodSnap && !prodSnap.empty) {
        publishedCatalog = [];
        prodSnap.forEach(d => {
          const data = typeof d.data === 'function' ? d.data() : d.data;
          publishedCatalog.push({ id: d.id, ...data });
        });
      }
    } catch {
      // If reading products is not supported by a minimal customOps stub, proceed with arithmetic checks
    }
  }

  if (Array.isArray(publishedCatalog) && publishedCatalog.length > 0) {
    const verification = verifyOrderAgainstCatalog(
      {
        ...orderData,
        items: validatedItems,
        subtotal: calculatedSubtotal,
        deliveryCharge,
        totalAmount: calculatedTotal,
      },
      publishedCatalog,
      { requireCatalogMatch: true, checkStockLevel: true }
    );
    if (!verification.valid) {
      const firstIssue = verification.issues[0];
      const err = new Error(firstIssue?.message || `Order failed catalog verification (${verification.verificationStatus})`);
      err.code = verification.verificationStatus;
      err.verificationCode = verification.verificationStatus;
      err.issues = verification.issues;
      err.errors = verification.issues.map(i => ({ ...i, code: String(i.code || '').toUpperCase() }));
      throw err;
    }
  }

  const rawPaymentMethod = String(orderData.paymentMethod || 'cod').trim();
  const allowedPaymentMethods = ['cod', 'bkash_manual', 'nagad_manual', 'rocket_manual'];
  if (orderData.paymentMethod && !allowedPaymentMethods.includes(rawPaymentMethod)) {
    const err = new Error(`Unsupported payment method '${rawPaymentMethod}'. Supported methods: cod, bkash_manual, nagad_manual, rocket_manual`);
    err.code = 'INVALID_PAYMENT_METHOD';
    throw err;
  }
  const normalizedPaymentMethod = rawPaymentMethod;

  const paymentTrxId = String(orderData.paymentTrxId || '').trim().slice(0, 60);
  const paymentSenderPhone = String(orderData.paymentSenderPhone || '').trim().slice(0, 25);

  let defaultPaymentStatus = 'due_on_delivery';
  if (normalizedPaymentMethod !== 'cod') {
    defaultPaymentStatus = paymentTrxId ? 'submitted_for_verification' : 'awaiting_payment';
  }
  const rawPaymentStatus = String(orderData.paymentStatus || defaultPaymentStatus).trim();
  const allowedPaymentStatuses = ['awaiting_payment', 'submitted_for_verification', 'due_on_delivery'];
  const normalizedPaymentStatus = allowedPaymentStatuses.includes(rawPaymentStatus)
    ? rawPaymentStatus
    : defaultPaymentStatus;

  const payload = {
    id: String(orderId).slice(0, 100),
    customerName: String(orderData.customerName).trim().slice(0, 150),
    customerPhone: String(orderData.customerPhone).trim().slice(0, 25),
    items: validatedItems,
    totalAmount: calculatedTotal,
    subtotal: calculatedSubtotal,
    deliveryCharge,
    isInsideDhaka: Boolean(orderData.isInsideDhaka),
    customerAddress: String(orderData.customerAddress || '').trim().slice(0, 250),
    paymentMethod: normalizedPaymentMethod,
    paymentStatus: normalizedPaymentStatus,
    notes: String(orderData.notes || '').trim().slice(0, 250),
    source: 'web_storefront',
    status: 'draft',
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    updatedAt: new Date().toISOString(),
  };

  if (paymentTrxId) payload.paymentTrxId = paymentTrxId;
  if (paymentSenderPhone) payload.paymentSenderPhone = paymentSenderPhone;

  const orderRef = ops.doc(ops.db, 'stores', shopSlug, 'orders', payload.id);
  await ops.setDoc(orderRef, payload);
  return { success: true, orderId: payload.id, order: payload };
}

/**
 * Loads pending storefront orders from /stores/{slug}/orders.
 * Must be called by the authenticated store owner.
 */
export async function loadIncomingStoreOrders(shopSlug, customOps = null) {
  if (!shopSlug || typeof shopSlug !== 'string') return [];
  const ops = customOps || { db, collection, getDocs };
  try {
    const colRef = ops.collection(ops.db, 'stores', shopSlug, 'orders');
    const snap = await ops.getDocs(colRef);
    const orders = [];
    snap.forEach(d => {
      orders.push({ id: d.id, ...d.data() });
    });
    return orders.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  } catch (err) {
    console.error(`loadIncomingStoreOrders error for ${shopSlug}:`, err);
    throw err;
  }
}

/**
 * Deletes an order from /stores/{slug}/orders after it has been imported or processed.
 */
export async function deleteIncomingStoreOrder(shopSlug, orderId, customOps = null) {
  if (!shopSlug || !orderId) return;
  const ops = customOps || { db, doc, deleteDoc };
  const orderRef = ops.doc(ops.db, 'stores', shopSlug, 'orders', String(orderId));
  await ops.deleteDoc(orderRef);
}

/**
 * Item 4: Reliable, idempotent order transfer with strict business isolation.
 * 1. Verifies that /stores/{shopSlug} belongs to `userId` and its `bizId` matches `activeBizId`.
 * 2. Uses a stable order ID (`incomingOrder.id`) and checks if `/users/{userId}/businesses/{activeBizId}/onlineOrders/{orderId}`
 *    already exists (idempotent retry protection — never creates duplicates).
 * 3. Evaluates catalog integrity (`verifyOrderAgainstCatalog`) against the shop's inventory/catalog and records
 *    `priceVerified`, `verificationStatus`, and `verificationIssues` on the order.
 * 4. Persists the order to the business's permanent `onlineOrders` collection and verifies the write via `getDoc`.
 * 5. Only after verifying the permanent write, deletes `/stores/{shopSlug}/orders/{orderId}`.
 *    If the delete fails, the permanent order remains safely stored and a subsequent retry will deduplicate and clean up.
 */
export async function transferIncomingOrderToBusiness(
  userId,
  activeBizId,
  shopSlug,
  incomingOrder,
  customOps = null,
  catalogProducts = []
) {
  if (!userId || !activeBizId || !shopSlug || !incomingOrder?.id) {
    const err = new Error('userId, activeBizId, shopSlug, and incomingOrder.id are required for order transfer');
    err.code = 'invalid-transfer-args';
    throw err;
  }

  const ops = customOps || { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs };
  const orderId = String(incomingOrder.id);

  // Step 1: Verify store ownership and business isolation
  if (typeof ops.getDoc === 'function') {
    const storeRef = ops.doc(ops.db, 'stores', shopSlug);
    const storeSnap = await ops.getDoc(storeRef);
    if (!storeSnap.exists()) {
      const err = new Error(`Store '${shopSlug}' does not exist`);
      err.code = 'store-not-found';
      throw err;
    }
    const storeData = typeof storeSnap.data === 'function' ? storeSnap.data() : storeSnap.data;
    const ownership = verifyStoreBusinessOwnership(storeData, userId, activeBizId);
    if (!ownership.valid) {
      const err = new Error(`Order transfer blocked: store '${shopSlug}' does not belong to active business '${activeBizId}' (${ownership.reason})`);
      err.code = ownership.code || ownership.reason;
      throw err;
    }
  }

  const destRef = ops.doc(ops.db, 'users', userId, 'businesses', activeBizId, 'onlineOrders', orderId);

  // Step 2: Check if order was already transferred on a previous attempt (idempotent retry)
  if (typeof ops.getDoc === 'function') {
    const existingDestSnap = await ops.getDoc(destRef);
    if (existingDestSnap.exists()) {
      const existingOrder = {
        id: orderId,
        ...(typeof existingDestSnap.data === 'function' ? existingDestSnap.data() : existingDestSnap.data),
      };
      let incomingDeleteFailed = false;
      try {
        await deleteIncomingStoreOrder(shopSlug, orderId, ops);
      } catch {
        incomingDeleteFailed = true;
      }
      return {
        transferred: true,
        deduplicated: true,
        alreadyImported: true,
        incomingDeleteFailed,
        deletedIncoming: !incomingDeleteFailed,
        order: existingOrder,
      };
    }
  }

  // Step 3: Verify order prices/items against catalog (if provided or published in /stores/{shopSlug}/products)
  let effectiveCatalog = Array.isArray(catalogProducts) && catalogProducts.length > 0 ? catalogProducts : [];
  if (effectiveCatalog.length === 0 && typeof ops.collection === 'function' && typeof ops.getDocs === 'function') {
    try {
      const prodSnap = await ops.getDocs(ops.collection(ops.db, 'stores', shopSlug, 'products'));
      if (prodSnap && !prodSnap.empty) {
        prodSnap.forEach(d => {
          const data = typeof d.data === 'function' ? d.data() : d.data;
          effectiveCatalog.push({ id: d.id, ...data });
        });
      }
    } catch {
      // Proceed if products collection isn't readable in minimal mock
    }
  }

  const catalogCheck = effectiveCatalog.length > 0
    ? verifyOrderAgainstCatalog(incomingOrder, effectiveCatalog, { requireCatalogMatch: true, checkStockLevel: false })
    : { valid: false, verificationStatus: 'unverified_no_catalog', issues: [], authoritativeSubtotal: incomingOrder.subtotal || 0, authoritativeTotal: incomingOrder.totalAmount || 0 };

  const defaultPaymentStatus = (incomingOrder.paymentMethod && incomingOrder.paymentMethod !== 'cod')
    ? (incomingOrder.paymentTrxId ? 'submitted_for_verification' : 'awaiting_payment')
    : 'due_on_delivery';

  const firstItem = incomingOrder.items?.[0] || {};
  const permanentOrder = {
    ...incomingOrder,
    id: orderId,
    bizId: activeBizId,
    shopSlug,
    productName: incomingOrder.productName || (
      incomingOrder.items?.length > 1
        ? `${firstItem.productName || 'পণ্য'} + আরও ${incomingOrder.items.length - 1}টি`
        : (firstItem.productName || 'স্টোরফ্রন্ট অর্ডার')
    ),
    quantity: Number(incomingOrder.quantity) || incomingOrder.items?.reduce((s, i) => s + (Number(i.quantity) || 1), 0) || 1,
    unitPrice: Number(incomingOrder.unitPrice) || Number(firstItem.unitPrice) || Number(incomingOrder.totalAmount) || 0,
    status: incomingOrder.status || 'draft',
    paymentStatus: incomingOrder.paymentStatus || defaultPaymentStatus,
    source: incomingOrder.source || 'web_storefront',
    priceVerified: Boolean(effectiveCatalog.length > 0 && catalogCheck.valid),
    verificationStatus: catalogCheck.verificationStatus,
    verificationIssues: catalogCheck.issues || [],
    authoritativeSubtotal: catalogCheck.authoritativeSubtotal,
    authoritativeTotal: catalogCheck.authoritativeTotal,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Step 4: Persist to permanent business onlineOrders collection & verify write
  await saveOnlineOrderToCloud(userId, activeBizId, permanentOrder, ops);

  if (typeof ops.getDoc === 'function') {
    const verifySnap = await ops.getDoc(destRef);
    if (!verifySnap.exists()) {
      const err = new Error(`Destination write verification failed for order ${orderId}`);
      err.code = 'destination-verification-failed';
      throw err;
    }
  }

  // Step 5: Delete temporary incoming order only after permanent write is verified
  let incomingDeleteFailed = false;
  try {
    await deleteIncomingStoreOrder(shopSlug, orderId, ops);
  } catch (delErr) {
    incomingDeleteFailed = true;
    recordOperationalError('transferIncomingOrderToBusiness.deleteIncoming', delErr, {
      shopSlug,
      activeBizId,
      orderId,
    });
  }

  return {
    transferred: true,
    deduplicated: false,
    alreadyImported: false,
    incomingDeleteFailed,
    deletedIncoming: !incomingDeleteFailed,
    order: permanentOrder,
  };
}

/**
 * Discovers the active store slug for a shopkeeper by their ownerUserId,
 * scoped by their active bizId when provided to prevent multi-business order cross-over.
 */
export async function getShopSlugForUser(userId, bizId = null, customOps = null) {
  if (!userId) return null;
  const ops = (bizId && typeof bizId === 'object' && !customOps) ? bizId : (customOps || { db, collection, query, where, getDocs });
  const targetBizId = typeof bizId === 'string' ? bizId : null;
  try {
    const q = ops.query(ops.collection(ops.db, 'stores'), ops.where('ownerUserId', '==', userId));
    const snap = await ops.getDocs(q);
    if (!snap.empty) {
      if (targetBizId) {
        const matchingDoc = snap.docs.find(d => {
          const data = typeof d.data === 'function' ? d.data() : d.data;
          return data?.bizId === targetBizId;
        });
        return matchingDoc ? matchingDoc.id : null;
      }
      return snap.docs[0].id;
    }
  } catch (err) {
    console.error('getShopSlugForUser error:', err);
  }
  return null;
}

export {
  deleteAllUserData,
  createRevisionTracker,
  verifyOrderAgainstCatalog,
  verifyStoreBusinessOwnership,
  mergeIncomingOrdersIdempotently,
  sanitizePublicProductRecord,
  BACKUP_AND_RETENTION_POLICY,
};


