/**
 * Sync Revision & Timestamp Tracker (Item 1, Item 2, Item 11)
 * Pure, deterministic revision synchronization tracker scoped by (bizId, dateKey).
 * Ensures sequential autosaves increment revisions cleanly (e.g., rev 4 -> 5 -> 6)
 * without false conflicts, across page refreshes and business/date switches.
 */

export function makeSyncScopeKey(bizId, dateKey) {
  if (!bizId || !dateKey) return null;
  return `${String(bizId).trim()}::${String(dateKey).trim()}`;
}

export function createSaveResult({ savedAt, revision, bizId, dateKey }) {
  const numericSavedAt = Number(savedAt) || Date.now();
  const numericRevision = Number(revision) || 1;
  return {
    savedAt: numericSavedAt,
    revision: numericRevision,
    _lastCloudSavedAt: numericSavedAt,
    _revision: numericRevision,
    bizId: bizId || null,
    dateKey: dateKey || null,
    valueOf() {
      return numericSavedAt;
    },
    [Symbol.toPrimitive](hint) {
      return hint === 'string' ? String(numericSavedAt) : numericSavedAt;
    },
  };
}

/**
 * Creates a scoped tracker that associates cloud revisions and save timestamps
 * with a specific (bizId, dateKey) pair.
 */
export function createRevisionTracker() {
  const byScope = new Map();

  return {
    /**
     * Initialize or update tracked revision/timestamp when loading dayData from cloud or local cache.
     */
    recordLoaded(bizId, dateKey, dayData) {
      const key = makeSyncScopeKey(bizId, dateKey || dayData?.dateKey);
      if (!key) return null;
      const revision = dayData?._revision !== undefined && dayData?._revision !== null
        ? Number(dayData._revision)
        : 0;
      const rawSavedAt = dayData?._lastCloudSavedAt ?? dayData?.savedAt ?? 0;
      const savedAt = Number(rawSavedAt) || 0;
      const entry = {
        bizId,
        dateKey: dateKey || dayData?.dateKey,
        revision: Number.isFinite(revision) ? revision : 0,
        savedAt: Number.isFinite(savedAt) ? savedAt : 0,
        updatedAt: Date.now(),
      };
      byScope.set(key, entry);
      return entry;
    },

    /**
     * Update tracked revision/timestamp after a successful saveDayToCloud call.
     * Verifies that the save result belongs to the specified (bizId, dateKey).
     */
    recordSaved(bizId, dateKey, saveResult, dayDataRef = null) {
      const targetBizId = saveResult?.bizId || bizId;
      const targetDateKey = saveResult?.dateKey || dateKey || dayDataRef?.dateKey;
      const key = makeSyncScopeKey(targetBizId, targetDateKey);
      if (!key) return null;

      const existing = byScope.get(key);
      const savedAt = typeof saveResult === 'object' && saveResult !== null
        ? Number(saveResult.savedAt ?? saveResult._lastCloudSavedAt ?? Number(saveResult))
        : Number(saveResult);
      const revision = typeof saveResult === 'object' && saveResult !== null && saveResult.revision !== undefined
        ? Number(saveResult.revision)
        : ((existing?.revision || Number(dayDataRef?._revision) || 0) + 1);

      const entry = {
        bizId: targetBizId,
        dateKey: targetDateKey,
        revision: Number.isFinite(revision) ? revision : 1,
        savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
        updatedAt: Date.now(),
      };
      byScope.set(key, entry);

      // Keep in-memory dayData object metadata aligned so sequential saves without re-dispatching
      // always carry the latest revision and timestamp
      if (dayDataRef && typeof dayDataRef === 'object' && (!dayDataRef.dateKey || dayDataRef.dateKey === targetDateKey)) {
        dayDataRef._revision = entry.revision;
        dayDataRef._lastCloudSavedAt = entry.savedAt;
      }

      return entry;
    },

    recordCloudSaveSuccess(bizId, dateKey, saveResult, dayDataRef = null) {
      return this.recordSaved(bizId, dateKey, saveResult, dayDataRef);
    },

    /**
     * Resolve the authoritative baseRevision and baseSavedAt for an upcoming save of (bizId, dateKey).
     */
    getBaseMeta(bizId, dateKey, dayData = null) {
      const resolvedDateKey = dateKey || dayData?.dateKey;
      const key = makeSyncScopeKey(bizId, resolvedDateKey);
      const tracked = key ? byScope.get(key) : null;

      const dayRev = dayData?._revision !== undefined && dayData?._revision !== null
        ? Number(dayData._revision)
        : null;
      const daySavedAt = dayData?._lastCloudSavedAt !== undefined && dayData?._lastCloudSavedAt !== null
        ? Number(dayData._lastCloudSavedAt)
        : 0;

      // Prefer tracked revision for the exact (bizId, dateKey) when available and >= dayData's revision
      const baseRevision = tracked
        ? (dayRev !== null ? Math.max(tracked.revision, dayRev) : tracked.revision)
        : dayRev;
      const baseSavedAt = tracked
        ? Math.max(tracked.savedAt, daySavedAt)
        : daySavedAt;

      return {
        bizId,
        dateKey: resolvedDateKey,
        baseRevision,
        baseSavedAt,
      };
    },

    getBaseRevision(bizId, dateKey, dayData = null) {
      return this.getBaseMeta(bizId, dateKey, dayData).baseRevision;
    },

    getBaseSavedAt(bizId, dateKey, dayData = null) {
      return this.getBaseMeta(bizId, dateKey, dayData).baseSavedAt;
    },

    getEntry(bizId, dateKey) {
      const key = makeSyncScopeKey(bizId, dateKey);
      return key ? (byScope.get(key) || null) : null;
    },

    clear(bizId = null, dateKey = null) {
      if (!bizId && !dateKey) {
        byScope.clear();
        return;
      }
      const key = makeSyncScopeKey(bizId, dateKey);
      if (key) byScope.delete(key);
    },
  };
}

export function reinitializeTrackerFromCloudSnapshot(tracker, bizId, dayData) {
  if (!tracker || typeof tracker.recordLoaded !== 'function' || !dayData) return null;
  return tracker.recordLoaded(bizId, dayData.dateKey, dayData);
}

