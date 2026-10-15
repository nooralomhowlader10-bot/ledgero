// ── Audit Trail Service ─────────────────────────────────────────────
// Immutable audit log for all financial transactions.
// Firestore collection: users/{userId}/businesses/{bizId}/auditLog/{logId}
//
// Actions: CREATE, REVERSE, MODIFY, BALANCE_EDIT
// Each entry is append-only — entries are never deleted or modified.

import { 
  doc, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  orderBy, 
  where,
  limit,
  Timestamp 
} from 'firebase/firestore';
import { db } from './firebaseConfig.js';

export const ALLOWED_AUDIT_LOG_KEYS = [
  'action',
  'txId',
  'txType',
  'amount',
  'txData',
  'reversalTxData',
  'previousData',
  'newData',
  'reason',
  'userId',
  'userName',
  'timestamp',
  'dateKey',
  'createdAt'
];

// ── Audit Log Entry Schema ──────────────────────────────────────────
// {
//   id: auto-generated
//   timestamp: Firestore Timestamp
//   createdAt: ISO-8601 string
//   action: 'CREATE' | 'REVERSE' | 'MODIFY' | 'BALANCE_EDIT'
//   txId: string (original transaction ID)
//   txType: string
//   amount: number
//   txData: object (snapshot of original transaction)
//   reversalTxData: object | null (snapshot of reversal transaction, if action=REVERSE)
//   userId: string
//   reason: string (optional user-provided reason)
//   dateKey: string (YYYY-MM-DD)
// }

function auditLogCol(userId, bizId) {
  return collection(db, 'users', userId, 'businesses', bizId, 'auditLog');
}

/**
 * Log an audit entry. Entries are immutable (append-only during active business operation;
 * only deletable during verified business/account teardown after meta/info is removed).
 * @param {string} userId
 * @param {string} bizId
 * @param {Object} entry - { action, txId, txType, amount, txData, reversalTxData, reason, dateKey }
 */
export async function logAuditEntry(userId, bizId, entry) {
  if (!userId || !bizId || !entry) return null;

  const rawPayload = {
    action: String(entry.action || 'REVERSE'),
    ...(entry.txId !== undefined && { txId: String(entry.txId) }),
    ...(entry.txType !== undefined
      ? { txType: String(entry.txType) }
      : (entry.txData?.type ? { txType: String(entry.txData.type) } : {})),
    ...(entry.amount !== undefined
      ? { amount: Number(entry.amount) || 0 }
      : (entry.txData?.amount !== undefined ? { amount: Number(entry.txData.amount) || 0 } : {})),
    ...(entry.txData !== undefined && { txData: entry.txData }),
    ...(entry.reversalTxData !== undefined && { reversalTxData: entry.reversalTxData }),
    ...(entry.previousData !== undefined && { previousData: entry.previousData }),
    ...(entry.newData !== undefined && { newData: entry.newData }),
    ...(entry.reason !== undefined && { reason: String(entry.reason) }),
    ...(entry.userName !== undefined && { userName: String(entry.userName) }),
    ...(entry.dateKey !== undefined && { dateKey: String(entry.dateKey) }),
    userId: String(userId),
    timestamp: Timestamp.now(),
    createdAt: new Date().toISOString(),
  };

  // Strip any unexpected fields so payload strictly adheres to ALLOWED_AUDIT_LOG_KEYS
  const sanitizedPayload = {};
  for (const key of ALLOWED_AUDIT_LOG_KEYS) {
    if (rawPayload[key] !== undefined) {
      sanitizedPayload[key] = rawPayload[key];
    }
  }

  return await addDoc(auditLogCol(userId, bizId), sanitizedPayload);
}

/**
 * Load audit log entries for a specific date.
 * @param {string} userId
 * @param {string} bizId
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<Array>} Array of audit entries sorted by timestamp desc
 */
export async function loadAuditLogByDate(userId, bizId, dateKey) {
  const q = query(
    auditLogCol(userId, bizId),
    where('dateKey', '==', dateKey),
    orderBy('timestamp', 'desc'),
    limit(200)
  );
  const snap = await getDocs(q);
  const entries = [];
  snap.forEach(doc => entries.push({ id: doc.id, ...doc.data() }));
  return entries;
}

/**
 * Load recent audit log entries across all dates.
 * @param {string} userId
 * @param {string} bizId
 * @param {number} maxEntries - Maximum entries to return (default 100)
 * @returns {Promise<Array>}
 */
export async function loadRecentAuditLog(userId, bizId, maxEntries = 100) {
  const q = query(
    auditLogCol(userId, bizId),
    orderBy('timestamp', 'desc'),
    limit(maxEntries)
  );
  const snap = await getDocs(q);
  const entries = [];
  snap.forEach(doc => entries.push({ id: doc.id, ...doc.data() }));
  return entries;
}
