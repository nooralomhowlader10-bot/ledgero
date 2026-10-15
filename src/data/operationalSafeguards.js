/**
 * Operational Safeguards, Monitoring, Restore Drills & Rollback Engine (Items 5, 6, 11, 13)
 * Provides:
 *  - Error monitoring ring buffer with structured context & severity alerting
 *  - Database read/write rate & billing quota threshold alerts
 *  - Documented backup & audit-log retention policy manifest
 *  - Automated backup-restore drill verifier & pre-operation rollback snapshots
 */

import { validateBackupPayload, importAllData } from './storage.js';

const MAX_ERROR_LOG_ENTRIES = 200;
const errorLogRingBuffer = [];

const dbUsageCounters = {
  reads: 0,
  writes: 0,
  deletes: 0,
  transactions: 0,
  conflicts: 0,
  windowStartedAt: Date.now(),
  dailyWriteWarningThreshold: 15000, // 75% of Firebase Spark Free Tier 20k/day writes
  dailyReadWarningThreshold: 37500,  // 75% of Firebase Spark Free Tier 50k/day reads
};

/**
 * Explicit Backup & Audit-Log Retention Policy (Item 6).
 */
export const BACKUP_AND_RETENTION_POLICY = Object.freeze({
  schemaVersion: 3,
  includedInBackup: [
    'settings',
    'sheetsConfig',
    'businesses',
    'days',
    'contacts',
    'contactTxs',
    'onlineOrders',
    'auditLog',
    'stores',
  ],
  backupIncludedCollections: [
    'settings',
    'sheetsConfig',
    'businesses',
    'days',
    'contacts',
    'contactTxs',
    'onlineOrders',
    'auditLog',
    'stores',
  ],
  auditLogPolicy: {
    clientWriteAccess: 'append-only (create allowed for owner; update and delete strictly forbidden in firestore.rules)',
    includedInCloudExport: true,
    businessDeletionBehavior: 'Mutable operational subcollections (days, contacts, onlineOrders, meta) are purged immediately from client; append-only auditLog entries remain tamper-proof against client-side deletion and are purged via privileged administrative teardown.',
    accountDeletionSlaDays: 7,
  },
});

/**
 * Record an operational error into the monitoring ring buffer (Item 13).
 */
export function recordOperationalError(category, error, context = {}) {
  const entry = {
    id: `op_err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    category: String(category || 'general'),
    context: String(category || 'general'),
    code: error?.code || context?.code || 'unknown_error',
    message: error?.message || String(error || 'Unknown operational error'),
    severity: context.severity || 'error',
    bizId: context.bizId || null,
    dateKey: context.dateKey || null,
    metadata: context,
  };
  errorLogRingBuffer.unshift(entry);
  if (errorLogRingBuffer.length > MAX_ERROR_LOG_ENTRIES) {
    errorLogRingBuffer.length = MAX_ERROR_LOG_ENTRIES;
  }
  return entry;
}

export function getOperationalErrorLog(limit = 50) {
  return errorLogRingBuffer.slice(0, Math.max(1, limit));
}

export function clearOperationalErrorLog() {
  errorLogRingBuffer.length = 0;
}

/**
 * Track database operations and evaluate billing/quota alert thresholds (Item 13).
 */
export function recordDatabaseOperation(type = 'write', count = 1, customThresholds = {}) {
  const step = Math.max(1, Number(count) || 1);
  if (type === 'read') dbUsageCounters.reads += step;
  else if (type === 'write') dbUsageCounters.writes += step;
  else if (type === 'delete') dbUsageCounters.deletes += step;
  else if (type === 'transaction') {
    dbUsageCounters.transactions += step;
    dbUsageCounters.reads += step;
    dbUsageCounters.writes += step;
  } else if (type === 'conflict') {
    dbUsageCounters.conflicts += step;
  }
  return checkDatabaseQuotaAlerts(customThresholds);
}

export function checkDatabaseQuotaAlerts(customThresholds = {}) {
  const writeLimit = customThresholds.warnWrites || customThresholds.dailyWriteWarningThreshold || dbUsageCounters.dailyWriteWarningThreshold;
  const readLimit = customThresholds.warnReads || customThresholds.dailyReadWarningThreshold || dbUsageCounters.dailyReadWarningThreshold;
  const criticalWriteLimit = customThresholds.criticalWrites || (writeLimit * 1.33);
  const criticalReadLimit = customThresholds.criticalReads || (readLimit * 1.33);
  const alerts = [];
  let alertLevel = 'normal';

  if (dbUsageCounters.writes >= criticalWriteLimit || dbUsageCounters.reads >= criticalReadLimit) {
    alertLevel = 'critical';
  } else if (dbUsageCounters.writes >= writeLimit || dbUsageCounters.reads >= readLimit) {
    alertLevel = 'warning';
  }

  if (dbUsageCounters.writes >= writeLimit) {
    alerts.push({
      type: 'quota_write_warning',
      severity: dbUsageCounters.writes >= criticalWriteLimit ? 'critical' : 'warning',
      current: dbUsageCounters.writes,
      threshold: writeLimit,
      message: `Firestore write count (${dbUsageCounters.writes}) exceeded threshold (${writeLimit})`,
    });
  }
  if (dbUsageCounters.reads >= readLimit) {
    alerts.push({
      type: 'quota_read_warning',
      severity: dbUsageCounters.reads >= criticalReadLimit ? 'critical' : 'warning',
      current: dbUsageCounters.reads,
      threshold: readLimit,
      message: `Firestore read count (${dbUsageCounters.reads}) exceeded threshold (${readLimit})`,
    });
  }
  return {
    metrics: { ...dbUsageCounters },
    hasAlerts: alerts.length > 0,
    alertLevel,
    alerts,
  };
}

export function getDatabaseUsageSnapshot(customThresholds = {}) {
  return checkDatabaseQuotaAlerts(customThresholds);
}

export function resetDatabaseUsageMetrics() {
  dbUsageCounters.reads = 0;
  dbUsageCounters.writes = 0;
  dbUsageCounters.deletes = 0;
  dbUsageCounters.transactions = 0;
  dbUsageCounters.conflicts = 0;
  dbUsageCounters.windowStartedAt = Date.now();
}

export const resetDatabaseUsageCounters = resetDatabaseUsageMetrics;

/**
 * Strict service-boundary validator for backup payloads before ANY cloud or local write (Item 5).
 */
export function verifyBackupCompletenessForRestore(backupPayload, options = {}) {
  let parsed = backupPayload;
  if (typeof backupPayload === 'string') {
    try {
      parsed = JSON.parse(backupPayload);
    } catch (err) {
      return {
        allowed: false,
        code: 'corrupt-backup-json',
        reason: `Backup JSON is malformed: ${err.message}`,
      };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      allowed: false,
      code: 'invalid-backup-payload',
      reason: 'Backup payload must be a valid JSON object',
    };
  }

  const validation = validateBackupPayload(parsed);
  if (!validation.valid) {
    return {
      allowed: false,
      code: 'invalid-backup-schema',
      reason: validation.error || 'Backup failed schema validation',
    };
  }

  const isPartial = Boolean(
    validation.isPartial ||
    parsed.isPartial === true ||
    parsed.manifest?.isPartial === true ||
    parsed.manifest?.status === 'partial' ||
    (Array.isArray(parsed.manifest?.failedPaths) && parsed.manifest.failedPaths.length > 0) ||
    (Array.isArray(parsed.manifest?.errors) && parsed.manifest.errors.length > 0)
  );

  if (isPartial && !options.allowPartialRecovery) {
    const failedInfo = Array.isArray(parsed.manifest?.failedPaths) && parsed.manifest.failedPaths.length > 0
      ? parsed.manifest.failedPaths.join(', ')
      : (Array.isArray(parsed.manifest?.errors) && parsed.manifest.errors.length > 0
          ? parsed.manifest.errors.join('; ')
          : 'Manifest marked as partial');
    return {
      allowed: false,
      code: 'partial-backup-rejected',
      reason: `Cannot restore partial or incomplete backup to cloud (${failedInfo})`,
    };
  }

  return {
    allowed: true,
    code: 'ok',
    reason: null,
    preview: validation.preview,
    parsed,
  };
}

/**
 * Create a local rollback snapshot before risky operations or staged updates (Item 13).
 */
export function createPreDeploymentRollbackSnapshot(labelOrStorage = globalThis.localStorage, maybeStorage = null) {
  const storageObj = (labelOrStorage && typeof labelOrStorage.getItem === 'function')
    ? labelOrStorage
    : (maybeStorage || globalThis.localStorage);
  const label = typeof labelOrStorage === 'string' ? labelOrStorage : 'default';
  const entries = {};
  if (storageObj && typeof storageObj.length === 'number') {
    for (let i = 0; i < storageObj.length; i++) {
      const k = storageObj.key(i);
      if (k) entries[k] = storageObj.getItem(k);
    }
  }
  return {
    snapshotId: `rb_${Date.now()}`,
    label,
    createdAt: new Date().toISOString(),
    keyCount: Object.keys(entries).length,
    entries,
  };
}

export const captureRollbackSnapshot = createPreDeploymentRollbackSnapshot;

/**
 * Roll back local storage to a previously captured rollback snapshot (Item 13).
 */
export function executeRollbackFromSnapshot(snapshot, storageObj = globalThis.localStorage) {
  if (!snapshot || !snapshot.entries || typeof snapshot.entries !== 'object') {
    throw new Error('Invalid rollback snapshot');
  }
  storageObj.clear();
  for (const [k, v] of Object.entries(snapshot.entries)) {
    storageObj.setItem(k, v);
  }
  return {
    restoredKeys: Object.keys(snapshot.entries).length,
    snapshotId: snapshot.snapshotId,
  };
}

export const restoreRollbackSnapshot = executeRollbackFromSnapshot;

/**
 * Execute an automated, non-destructive backup & restore verification drill (Item 13).
 * Can be called synchronously with a backup payload (or default drill fixture), or asynchronously with `{ exportFn, restoreFn }`.
 */
export function runBackupRestoreDrill(input = null, storageObj = globalThis.localStorage) {
  if (input && typeof input === 'object' && typeof input.exportFn === 'function') {
    const { exportFn, restoreFn } = input;
    const targetStorage = input.storageObj || storageObj;
    const rollbackSnap = createPreDeploymentRollbackSnapshot(targetStorage);
    return (async () => {
      try {
        const exportedJson = await exportFn();
        const check = verifyBackupCompletenessForRestore(exportedJson);
        if (!check.allowed) {
          return { passed: false, stage: 'verify', error: check.reason };
        }
        if (typeof restoreFn === 'function') {
          const restoreRes = await restoreFn(check.parsed);
          if (!restoreRes || restoreRes.success === false || restoreRes.isPartialRestore) {
            return {
              passed: false,
              stage: 'cloud_restore',
              error: (restoreRes?.errors || []).join('; ') || 'Cloud restore reported failure',
            };
          }
        }
        importAllData(check.parsed);
        return {
          passed: true,
          stage: 'complete',
          preview: check.preview,
          verifiedAt: new Date().toISOString(),
        };
      } catch (err) {
        recordOperationalError('restore_drill', err);
        return {
          passed: false,
          stage: 'exception',
          error: err.message,
        };
      } finally {
        executeRollbackFromSnapshot(rollbackSnap, targetStorage);
      }
    })();
  }

  // Synchronous drill against provided backup object or default drill fixture
  const rollbackSnap = createPreDeploymentRollbackSnapshot(storageObj);
  try {
    const payload = input || {
      version: 3,
      exportedAt: new Date().toISOString(),
      isPartial: false,
      manifest: { isPartial: false, failedCount: 0, failedPaths: [] },
      businesses: [{ id: 'drill_biz', name: 'Drill Shop' }],
      settings: { language: 'bn', isDarkMode: false },
      drill_biz: {
        days: { '2026-10-10': { dateKey: '2026-10-10', status: 'open', savedAt: 1000, _revision: 1 } },
        contacts: [{ id: 'c_drill', name: 'Drill Customer', phone: '01700000000', currentBalance: 100 }],
        onlineOrders: [],
      },
    };
    const check = verifyBackupCompletenessForRestore(payload);
    if (!check.allowed) {
      return { passed: false, stage: 'verify', error: check.reason };
    }
    importAllData(check.parsed);
    return {
      passed: true,
      stage: 'complete',
      preview: check.preview,
      verifiedAt: new Date().toISOString(),
    };
  } catch (err) {
    recordOperationalError('restore_drill', err);
    return {
      passed: false,
      stage: 'exception',
      error: err.message,
    };
  } finally {
    executeRollbackFromSnapshot(rollbackSnap, storageObj);
  }
}

