import { 
  createDefaultWallets, 
  createGeneralWallets, 
  DEFAULT_INVENTORY, 
  DAY_STATUS, 
  isTelecomBiz,
  detectWalletCategory
} from './constants.js';
import { aggregateTransactions } from './calculations.js';

const META_KEY = 'shop_meta';

// ── User Scoped Storage Management (Gate A4) ────────────────────────
let _activeStorageUserId = null;

export function setActiveStorageUserId(uid) {
  _activeStorageUserId = uid || null;
}

export function getActiveStorageUserId() {
  return _activeStorageUserId;
}

export function getUserStorageKey(key, userId = _activeStorageUserId) {
  if (!userId) return key;
  if (key.startsWith(`shop_u_${userId}_`)) return key;
  if (key.startsWith('shop_')) {
    return `shop_u_${userId}_${key.slice(5)}`;
  }
  return `shop_u_${userId}_${key}`;
}

export function remapStorageKeyForUser(key, targetUserId) {
  if (!targetUserId) return key;
  if (key.startsWith(`shop_u_${targetUserId}_`)) {
    return key;
  }
  if (key.startsWith('shop_u_')) {
    return key.replace(/^shop_u_[^_]+_/, `shop_u_${targetUserId}_`);
  }
  if (key.startsWith('shop_day_')) {
    return key.replace(/^shop_day_/, `shop_u_${targetUserId}_biz_1_day_`);
  }
  if (key.startsWith('shop_')) {
    return `shop_u_${targetUserId}_${key.slice(5)}`;
  }
  return `shop_u_${targetUserId}_${key}`;
}

// ── Prefix Helper for Business Isolation ─────────────────────────────
export function getStoragePrefix(bizId, userId = _activeStorageUserId) {
  if (userId) {
    return `shop_u_${userId}_${bizId || 'biz_1'}_day_`;
  }
  if (!bizId || bizId === 'biz_1') {
    return 'shop_day_';
  }
  return `shop_${bizId}_day_`;
}

// ── Business Product Catalog Storage ────────────────────────────────
export function saveCatalog(catalog, bizId = 'biz_1', userId = _activeStorageUserId) {
  if (!catalog || !Array.isArray(catalog)) return;
  try {
    const key = userId ? `shop_u_${userId}_catalog_${bizId}` : `shop_catalog_${bizId}`;
    localStorage.setItem(key, JSON.stringify(catalog));
  } catch (e) {
    console.warn('Failed to save catalog:', e);
  }
}

export function loadCatalog(bizId = 'biz_1', userId = _activeStorageUserId) {
  try {
    const key = userId ? `shop_u_${userId}_catalog_${bizId}` : `shop_catalog_${bizId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function hasBusinessHistory(bizId = 'biz_1', userId = _activeStorageUserId) {
  const prefix = getStoragePrefix(bizId, userId);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) return true;
  }
  return false;
}

// ── Date Helpers ────────────────────────────────────────────────────

/**
 * Get today's date as YYYY-MM-DD string.
 */
export function getTodayKey() {
  const now = new Date();
  return formatDateKey(now);
}

/**
 * Format a Date object as YYYY-MM-DD.
 */
export function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get yesterday's date key.
 */
export function getYesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDateKey(d);
}

/**
 * Get next date key from a given date key.
 */
export function getNextDayKey(dateKey) {
  if (!dateKey) return formatDateKey(new Date());
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 1);
  return formatDateKey(date);
}

/**
 * Get previous date key from a given date key.
 */
export function getPrevDayKey(dateKey) {
  if (!dateKey) return formatDateKey(new Date());
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return formatDateKey(date);
}

// ── Day Data Structure ──────────────────────────────────────────────

export function createNewDayData(dateKey, previousDay = null, bizType = null, bizName = null, bizId = 'biz_1', userId = _activeStorageUserId) {
  const isTelecom = isTelecomBiz(bizType, bizName);
  let wallets = {};
  
  if (previousDay?.wallets && Object.keys(previousDay.wallets).length > 0) {
    // Carry forward user's active wallets from previous day
    Object.keys(previousDay.wallets).forEach((key) => {
      const prevWallet = previousDay.wallets[key];
      const openingBal = (key === 'hand_cash' && previousDay.actualCash != null)
        ? previousDay.actualCash
        : (prevWallet.closing ?? prevWallet.current ?? prevWallet.opening ?? 0);
      wallets[key] = {
        opening: openingBal,
        current: openingBal,
        category: prevWallet.category || detectWalletCategory(key),
        ...(prevWallet.label ? { label: prevWallet.label } : {})
      };
    });
    // Ensure hand_cash always exists
    if (!wallets.hand_cash) {
      wallets.hand_cash = { opening: 0, current: 0, category: 'cash' };
    }
  } else {
    wallets = isTelecom ? createDefaultWallets() : createGeneralWallets();
  }
  
  // Inventory initialization:
  // 1. If previousDay has inventory, carry forward ONLY previous day's products and closing stock.
  // 2. If a permanent catalog exists, carry forward those products.
  // 3. If business has existing history, do NOT re-inject defaults.
  // 4. Only if brand new business day 1 with zero history and zero catalog, seed DEFAULT_INVENTORY for telecom.
  let inventory = [];
  if (previousDay && Array.isArray(previousDay.inventory) && previousDay.inventory.length > 0) {
    inventory = previousDay.inventory.map((prevItem) => {
      const carriedStock = prevItem.closingStock !== undefined && prevItem.closingStock !== null
        ? Math.max(0, Number(prevItem.closingStock) || 0)
        : Math.max(0, (Number(prevItem.openingStock) || 0) + (Number(prevItem.addedStock) || 0));
      return {
        ...prevItem,
        openingStock: carriedStock,
        addedStock: 0,
        closingStock: carriedStock,
        damagedStock: 0,
        fifoSoldUnits: 0,
        fifoCogs: 0,
        fifoRevenue: 0,
        batches: Array.isArray(prevItem.batches)
          ? prevItem.batches
              .filter(b => (Number(b.remainingQty) || 0) > 0)
              .map(b => ({ ...b }))
          : [],
      };
    });
    saveCatalog(inventory, bizId, userId);
  } else {
    const catalog = loadCatalog(bizId, userId);
    if (catalog !== null && Array.isArray(catalog) && catalog.length > 0) {
      inventory = catalog.map((item) => {
        const carried = Math.max(0, Number(item.closingStock !== undefined ? item.closingStock : item.openingStock) || 0);
        return {
          ...item,
          openingStock: carried,
          addedStock: 0,
          closingStock: carried,
          damagedStock: 0,
          fifoSoldUnits: 0,
          fifoCogs: 0,
          fifoRevenue: 0,
        };
      });
    } else if (hasBusinessHistory(bizId, userId) || (catalog !== null && Array.isArray(catalog) && catalog.length === 0)) {
      // Business exists or user intentionally emptied catalog: NO defaults!
      inventory = [];
    } else if (isTelecom) {
      inventory = DEFAULT_INVENTORY.map((item) => ({
        ...item,
        openingStock: 0,
        addedStock: 0,
        closingStock: 0,
      }));
      saveCatalog(inventory, bizId, userId);
    } else {
      inventory = [];
    }
  }

  // Carry forward loans
  const prevTx = previousDay?.transactions ? aggregateTransactions(previousDay.transactions) : { loanGiven: 0, loanCollected: 0, loanTaken: 0, loanRepaid: 0 };
  const loans = {
    openingGiven: previousDay?.loans?.closingGiven != null
      ? previousDay.loans.closingGiven
      : Math.max(0, (previousDay?.loans?.openingGiven || 0) + (prevTx.loanGiven || 0) - (prevTx.loanCollected || 0)),
    openingTaken: previousDay?.loans?.closingTaken != null
      ? previousDay.loans.closingTaken
      : Math.max(0, (previousDay?.loans?.openingTaken || 0) + (prevTx.loanTaken || 0) - (prevTx.loanRepaid || 0)),
  };

  return {
    dateKey,
    status: DAY_STATUS.NOT_STARTED,
    wallets,
    loans,
    inventory,
    transactions: [],
    services: {
      photocopy: 0,
      studio: 0,
    },
    actualCash: null,        // Set during closing
    cashMismatch: null,      // Calculated during closing
    dailyProfit: null,       // Calculated during closing
    createdAt: new Date().toISOString(),
    finalizedAt: null,
  };
}

// ── Load / Save ─────────────────────────────────────────────────────

/**
 * Load day data from localStorage for a specific business.
 * If no data exists for the given date, creates new data from previous day's closing.
 */
export function loadDay(dateKey = null, bizId = 'biz_1', bizType = null, bizName = null, userId = _activeStorageUserId) {
  const prefix = getStoragePrefix(bizId, userId);
  const key = dateKey || getTodayKey();
  const raw = localStorage.getItem(prefix + key);

  if (raw) {
    try {
      const data = JSON.parse(raw);
      const isTelecom = isTelecomBiz(bizType, bizName);
      const defaultWallets = isTelecom ? createDefaultWallets() : createGeneralWallets();
      
      if (!data.wallets || Object.keys(data.wallets).length === 0) {
        data.wallets = defaultWallets;
      }
      if (!data.wallets.hand_cash) {
        data.wallets.hand_cash = { opening: 0, current: 0, category: 'cash' };
      }
      if (!data.loans) {
        data.loans = { openingGiven: 0, openingTaken: 0 };
      }
      if (!data.inventory) {
        data.inventory = [];
      }
      return data;
    } catch {
      console.error(`Corrupt data for ${key}, creating fresh day.`);
    }
  }

  // No data for today — try to carry forward from yesterday
  const previousDay = findMostRecentDay(key, bizId, userId);
  return createNewDayData(key, previousDay, bizType, bizName, bizId, userId);
}

/**
 * Find the most recent active or finalized day before the given date key.
 * Prefers finalized, but falls back to any previous day so opening balances are never lost.
 */
export function findMostRecentDay(beforeDateKey, bizId = 'biz_1', userId = _activeStorageUserId) {
  const prefix = getStoragePrefix(bizId, userId);
  const targetDateStr = beforeDateKey;
  let mostRecent = null;
  let mostRecentKey = '';

  // 1. Scan all localStorage keys for this business
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      const datePart = k.slice(prefix.length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < targetDateStr) {
        if (!mostRecentKey || datePart > mostRecentKey) {
          try {
            const data = JSON.parse(localStorage.getItem(k));
            if (data && (data.wallets || (Array.isArray(data.inventory) && data.inventory.length > 0))) {
              mostRecent = data;
              mostRecentKey = datePart;
            }
          } catch {}
        }
      }
    }
  }

  if (mostRecent) return mostRecent;

  // 2. Fallback: 30-day lookback
  const date = new Date(beforeDateKey + 'T00:00:00');
  let fallbackDay = null;

  for (let i = 1; i <= 30; i++) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d);
    const raw = localStorage.getItem(prefix + key);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data.status === DAY_STATUS.FINALIZED) {
          return data;
        }
        if (!fallbackDay && data.wallets) {
          fallbackDay = data;
        }
      } catch {
        continue;
      }
    }
  }
  return fallbackDay;
}

/**
 * Save day data to localStorage.
 */
export function saveDay(dayData, bizId = 'biz_1', userId = _activeStorageUserId) {
  if (!dayData || !dayData.dateKey) return;
  const prefix = getStoragePrefix(bizId, userId);
  const key = prefix + dayData.dateKey;
  try {
    localStorage.setItem(key, JSON.stringify(dayData));
  } catch (err) {
    console.warn(`Failed to save day ${key} to localStorage (quota or access error):`, err);
  }
}

/**
 * Finalize the day: lock it and prepare for next day.
 */
export function finalizeDay(dayData, bizId = 'biz_1', userId = _activeStorageUserId) {
  // Set closing balances for wallets
  Object.keys(dayData.wallets).forEach((key) => {
    dayData.wallets[key].closing = dayData.wallets[key].current;
  });

  if (!dayData.loans) {
    dayData.loans = { openingGiven: 0, openingTaken: 0 };
  }

  // Calculate closing loans
  const txTotals = aggregateTransactions(dayData.transactions);
  dayData.loans.closingGiven = Math.max(
    0,
    (dayData.loans.openingGiven || 0) + (txTotals.loanGiven || 0) - (txTotals.loanCollected || 0)
  );
  dayData.loans.closingTaken = Math.max(
    0,
    (dayData.loans.openingTaken || 0) + (txTotals.loanTaken || 0) - (txTotals.loanRepaid || 0)
  );

  dayData.status = DAY_STATUS.FINALIZED;
  dayData.finalizedAt = new Date().toISOString();

  saveDay(dayData, bizId, userId);

  // Update meta with last finalized date
  saveMeta({ lastFinalizedDate: dayData.dateKey }, bizId, userId);

  return dayData;
}

// ── Meta ────────────────────────────────────────────────────────────

export function loadMeta(bizId = 'biz_1', userId = _activeStorageUserId) {
  const metaKey = userId
    ? `shop_u_${userId}_${bizId || 'biz_1'}_meta`
    : ((!bizId || bizId === 'biz_1') ? META_KEY : `shop_${bizId}_meta`);
  const raw = localStorage.getItem(metaKey);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function saveMeta(updates, bizId = 'biz_1', userId = _activeStorageUserId) {
  const metaKey = userId
    ? `shop_u_${userId}_${bizId || 'biz_1'}_meta`
    : ((!bizId || bizId === 'biz_1') ? META_KEY : `shop_${bizId}_meta`);
  const current = loadMeta(bizId, userId);
  const merged = { ...current, ...updates };
  try {
    localStorage.setItem(metaKey, JSON.stringify(merged));
  } catch (err) {
    console.warn(`Failed to save meta ${metaKey} to localStorage:`, err);
  }
}

// ── Export / Import ─────────────────────────────────────────────────

/**
 * Export all shop data as a JSON string for backup.
 * Supports exporting extra state (activeBiz, businesses, settings) if provided.
 */
export function exportAllData(extraState = null) {
  const data = {
    version: 2,
    app: 'Ledgero',
    exportedAt: new Date().toISOString(),
    storage: {},
  };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('shop_') || key.startsWith('ledgero_'))) {
      try {
        data.storage[key] = JSON.parse(localStorage.getItem(key));
      } catch {
        data.storage[key] = localStorage.getItem(key);
      }
    }
  }
  if (extraState && typeof extraState === 'object') {
    if (extraState.activeBiz) data.activeBiz = extraState.activeBiz;
    if (extraState.businesses) data.businesses = extraState.businesses;
    if (extraState.settings) data.settings = extraState.settings;
  }
  return JSON.stringify(data, null, 2);
}

/**
 * Validate backup JSON structure and return a preview.
 */
export function validateBackupPayload(backupStringOrObj) {
  try {
    let data = backupStringOrObj;
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Backup is not a valid object' };
    }

    let daysCount = 0;
    let contactsCount = 0;
    let businessesCount = Array.isArray(data.businesses) ? data.businesses.length : 1;
    let onlineOrdersCount = 0;

    const isPartial = Boolean(
      data.isPartial === true ||
      data.manifest?.status === 'partial' ||
      data.manifest?.isPartial === true ||
      (Array.isArray(data.manifest?.failedPaths) && data.manifest.failedPaths.length > 0) ||
      (Array.isArray(data.manifest?.errors) && data.manifest.errors.length > 0)
    );
    const manifestWarning = isPartial
      ? `Warning: Backup marked as partial with errors: ${(data.manifest?.errors || data.manifest?.failedPaths || ['partial manifest']).join('; ')}`
      : null;
    const storesCount = Object.keys(data.stores || {}).length || data.manifest?.counts?.stores || 0;
    if (data.manifest?.counts?.onlineOrders) {
      onlineOrdersCount = data.manifest.counts.onlineOrders;
    }

    // Format v2 with storage object
    if (data.storage && typeof data.storage === 'object') {
      Object.keys(data.storage).forEach(k => {
        if (k.includes('_day_')) daysCount++;
        if (k.includes('_contacts') && Array.isArray(data.storage[k])) {
          contactsCount += data.storage[k].length;
        }
        if ((k.includes('_orders') || k.includes('_online_orders')) && Array.isArray(data.storage[k])) {
          onlineOrdersCount += data.storage[k].length;
        }
      });
      return {
        valid: true,
        isPartial,
        warning: manifestWarning,
        preview: { daysCount, contactsCount, businessesCount, storesCount, onlineOrdersCount },
        error: null,
      };
    }

    // Direct cloud export or v1/v3 format
    if (data.businesses || data.days || data.biz_1 || data.stores || data.settings) {
      const bList = Array.isArray(data.businesses) ? data.businesses : [{ id: 'biz_1' }];
      businessesCount = bList.length;
      let calculatedOrders = 0;
      bList.forEach(b => {
        const bData = data[b.id] || (b.id === 'biz_1' ? data : null) || {};
        if (bData.days) daysCount += Object.keys(bData.days).length;
        if (Array.isArray(bData.contacts)) contactsCount += bData.contacts.length;
        if (Array.isArray(bData.onlineOrders)) calculatedOrders += bData.onlineOrders.length;
      });
      if (calculatedOrders > 0 || onlineOrdersCount === 0) {
        onlineOrdersCount = calculatedOrders || onlineOrdersCount;
      }
      return {
        valid: true,
        isPartial,
        warning: manifestWarning,
        preview: { daysCount, contactsCount, businessesCount, storesCount, onlineOrdersCount },
        error: null,
      };
    }

    // Direct flat localStorage dump
    const flatKeys = Object.keys(data);
    if (flatKeys.some(k => k.startsWith('shop_'))) {
      flatKeys.forEach(k => {
        if (k.includes('_day_')) daysCount++;
        if (k.includes('_contacts') && Array.isArray(data[k])) {
          contactsCount += data[k].length;
        }
        if ((k.includes('_orders') || k.includes('_online_orders')) && Array.isArray(data[k])) {
          onlineOrdersCount += data[k].length;
        }
      });
      return {
        valid: true,
        isPartial: false,
        warning: null,
        preview: { daysCount, contactsCount, businessesCount: 1, storesCount: 0, onlineOrdersCount },
        error: null,
      };
    }

    return { valid: false, error: 'Unrecognized backup structure' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}


/**
 * Import shop data from a JSON string backup.
 * Safely handles format v1, format v2, and cloud exports.
 * WARNING: Overwrites existing data for matching keys.
 */
export function importAllData(jsonString, options = {}) {
  let data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid backup data format');
  }

  const schemaValidation = validateBackupPayload(data);
  if (!schemaValidation.valid) {
    throw new Error(`Invalid backup payload: ${schemaValidation.error || 'Unrecognized backup structure'}`);
  }

  // Durability safeguard: Strictly prevent hydrating local storage from partial or corrupted backups
  const isPartial = Boolean(
    schemaValidation.isPartial ||
    data.manifest?.status === 'partial' ||
    data.manifest?.isPartial === true ||
    (Array.isArray(data.manifest?.errors) && data.manifest.errors.length > 0)
  );
  if (isPartial && !options.allowPartial) {
    const errorDetails = Array.isArray(data.manifest?.errors) && data.manifest.errors.length > 0
      ? data.manifest.errors.join('; ')
      : 'Manifest marked as partial';
    throw new Error(`Cannot hydrate local storage from partial or corrupted backup (${errorDetails})`);
  }

  const targetUserId = options.userId || _activeStorageUserId || null;

  const previousValues = new Map();
  const newlyAddedKeys = new Set();

  const rollbackWrites = () => {
    try {
      for (const key of newlyAddedKeys) {
        localStorage.removeItem(key);
      }
      for (const [key, prevVal] of previousValues.entries()) {
        localStorage.setItem(key, prevVal);
      }
    } catch (rollbackErr) {
      console.error('Rollback warning during importAllData:', rollbackErr);
    }
  };

  const safeWrite = (key, val) => {
    try {
      if (!previousValues.has(key) && !newlyAddedKeys.has(key)) {
        const existing = localStorage.getItem(key);
        if (existing === null || existing === undefined) {
          newlyAddedKeys.add(key);
        } else {
          previousValues.set(key, existing);
        }
      }
      localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    } catch (err) {
      console.warn(`Failed to write key ${key} to localStorage during import; rolling back partial writes:`, err);
      rollbackWrites();
      throw new Error(`Local storage quota exceeded while writing ${key} (rolled back partial writes): ${err.message}`);
    }
  };

  // Format v2: data inside data.storage
  if (data.storage && typeof data.storage === 'object') {
    Object.entries(data.storage).forEach(([key, value]) => {
      const finalKey = targetUserId ? remapStorageKeyForUser(key, targetUserId) : key;
      safeWrite(finalKey, value);
    });
    return true;
  }

  // Cloud export format
  if (data.businesses || data.biz_1) {
    const bList = Array.isArray(data.businesses) ? data.businesses : [{ id: 'biz_1', name: 'My Business' }];
    if (Array.isArray(data.businesses)) {
      if (targetUserId) {
        safeWrite(getUserStorageKey('shop_businesses_list', targetUserId), data.businesses);
      } else {
        safeWrite('shop_businesses_list', data.businesses);
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      if (targetUserId) {
        safeWrite(getUserStorageKey(META_KEY, targetUserId), data.settings);
      } else {
        safeWrite(META_KEY, data.settings);
      }
    }
    bList.forEach(biz => {
      const bizId = biz.id || 'biz_1';
      const bizData = data[bizId] || (bizId === 'biz_1' ? data : null) || {};

      // Restore days
      if (bizData.days) {
        if (targetUserId) {
          const userPrefix = getStoragePrefix(bizId, targetUserId);
          Object.entries(bizData.days).forEach(([dateKey, dayData]) => {
            safeWrite(`${userPrefix}${dateKey}`, dayData);
          });
        } else {
          const legacyPrefix = getStoragePrefix(bizId, null);
          Object.entries(bizData.days).forEach(([dateKey, dayData]) => {
            safeWrite(`${legacyPrefix}${dateKey}`, dayData);
          });
        }
      }

      // Restore contacts
      if (Array.isArray(bizData.contacts)) {
        if (targetUserId) {
          safeWrite(`shop_u_${targetUserId}_${bizId}_contacts`, bizData.contacts);
        } else {
          safeWrite(`shop_${bizId}_contacts`, bizData.contacts);
        }
      }

      // Restore contactTxs (write both canonical and legacy key formats for 100% compatibility)
      if (bizData.contactTxs) {
        Object.entries(bizData.contactTxs).forEach(([cid, txs]) => {
          if (targetUserId) {
            safeWrite(`shop_u_${targetUserId}_${bizId}_contact_txs_${cid}`, txs);
            safeWrite(`shop_u_${targetUserId}_${bizId}_contact_${cid}_txs`, txs);
          } else {
            safeWrite(`shop_${bizId}_contact_txs_${cid}`, txs);
            safeWrite(`shop_${bizId}_contact_${cid}_txs`, txs);
          }
        });
      }

      // Restore onlineOrders
      if (bizData.onlineOrders) {
        if (targetUserId) {
          safeWrite(`shop_u_${targetUserId}_${bizId}_online_orders`, bizData.onlineOrders);
          safeWrite(`shop_u_${targetUserId}_${bizId}_online_orders_v1`, bizData.onlineOrders);
        } else {
          safeWrite(`shop_${bizId}_online_orders`, bizData.onlineOrders);
          safeWrite(`shop_${bizId}_online_orders_v1`, bizData.onlineOrders);
        }
      }

      // Restore auditLog (if present in cloud backup)
      if (Array.isArray(bizData.auditLog)) {
        if (targetUserId) {
          safeWrite(`shop_u_${targetUserId}_${bizId}_audit_log`, bizData.auditLog);
        } else {
          safeWrite(`shop_${bizId}_audit_log`, bizData.auditLog);
        }
      }
    });
    return true;
  }

  // Format v1: flat keys in root
  Object.entries(data).forEach(([key, value]) => {
    if (key.startsWith('shop_') || key.startsWith('ledgero_')) {
      const finalKey = targetUserId ? remapStorageKeyForUser(key, targetUserId) : key;
      safeWrite(finalKey, value);
    }
  });
  return true;
}

/**
 * Get list of all saved day keys for a business, sorted descending.
 */
export function getAllDayKeys(bizId = 'biz_1', userId = _activeStorageUserId) {
  const prefix = getStoragePrefix(bizId, userId);
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(prefix)) {
      keys.push(key.replace(prefix, ''));
    }
  }
  return keys.sort().reverse();
}

// ── Customer & Supplier Ledger (বাকি খাতা) ──────────────────────────

/**
 * Load all contacts for a specific business.
 * @param {string} bizId
 * @param {string} [userId]
 * @returns {Array} list of contacts
 */
export function loadContacts(bizId = 'biz_1', userId = _activeStorageUserId) {
  try {
    const key = userId ? `shop_u_${userId}_${bizId}_contacts` : `shop_${bizId}_contacts`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Error loading contacts:', err);
    return [];
  }
}

/**
 * Save contacts for a specific business.
 * @param {Array} contacts
 * @param {string} bizId
 * @param {string} [userId]
 */
export function saveContacts(contacts, bizId = 'biz_1', userId = _activeStorageUserId) {
  try {
    const key = userId ? `shop_u_${userId}_${bizId}_contacts` : `shop_${bizId}_contacts`;
    localStorage.setItem(key, JSON.stringify(contacts || []));
  } catch (err) {
    console.error('Error saving contacts:', err);
  }
}

/**
 * Load transaction statement history for a contact.
 * @param {string} bizId
 * @param {string} contactId
 * @param {string} [userId]
 * @returns {Array} transactions
 */
export function loadContactTxs(bizId = 'biz_1', contactId, userId = _activeStorageUserId) {
  if (!contactId) return [];
  try {
    const key = userId ? `shop_u_${userId}_${bizId}_contact_txs_${contactId}` : `shop_${bizId}_contact_txs_${contactId}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error(`Error loading contact txs:`, err);
    return [];
  }
}

/**
 * Save transaction statement history for a contact.
 * @param {string} bizId
 * @param {string} contactId
 * @param {Array} txs
 * @param {string} [userId]
 */
export function saveContactTxs(bizId = 'biz_1', contactId, txs = [], userId = _activeStorageUserId) {
  if (!contactId) return;
  try {
    const key = userId ? `shop_u_${userId}_${bizId}_contact_txs_${contactId}` : `shop_${bizId}_contact_txs_${contactId}`;
    localStorage.setItem(key, JSON.stringify(txs));
  } catch (err) {
    console.error(`Error saving contact txs:`, err);
  }
}

/**
 * Delete all localStorage data associated with a business.
 * Removes contacts, contact transactions, and day data keys.
 * @param {string} bizId
 * @param {string} [userId]
 */
export function deleteBusinessData(bizId, userId = _activeStorageUserId) {
  if (!bizId) return;
  try {
    // First, load contacts to find all contact tx keys
    const contacts = loadContacts(bizId, userId);
    contacts.forEach(c => {
      const txKey = userId ? `shop_u_${userId}_${bizId}_contact_txs_${c.id}` : `shop_${bizId}_contact_txs_${c.id}`;
      localStorage.removeItem(txKey);
    });
    // Remove contacts list
    const contactsKey = userId ? `shop_u_${userId}_${bizId}_contacts` : `shop_${bizId}_contacts`;
    localStorage.removeItem(contactsKey);
    
    // Remove all day data keys for this business
    const prefix = getStoragePrefix(bizId, userId);
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(prefix) || (!userId && key.includes(`_${bizId}`)))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    
    // Business data cleanup complete
  } catch (err) {
    console.error('Error deleting business data:', err);
  }
}

/**
 * Clean up user-scoped localStorage items on sign-out to prevent data leakage.
 * @param {string} userId
 */
export function clearUserLocalStorage(userId = _activeStorageUserId) {
  if (!userId) return;
  try {
    const userPrefix = `shop_u_${userId}_`;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(userPrefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('Error clearing user local storage:', err);
  }
}
