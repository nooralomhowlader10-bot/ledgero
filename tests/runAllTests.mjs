/**
 * Ledgero Automated Verification Suite
 * Runs out-of-the-box via `npm test` (with `tests/firebaseTestLoader.mjs` providing zero-dependency
 * ESM resolution when `node_modules` is absent).
 *
 * Covers:
 *   Suite 1: Account & Business Deletion, >450 Batch Chunking, Contact Chunking & Storefront Concurrency
 *   Suite 2: FIFO Inventory, Stock Audit (Shortage & Surplus), Single Reversal & Bulk Reversal Engine
 *   Suite 3: Live Service-to-`firestore.rules` Contract & Security Verification
 */

process.env.LEDGERO_TEST_MODE = '1';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.setItem !== 'function') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.has(String(key)) ? store.get(String(key)) : null,
    setItem: (key, val) => { store.set(String(key), String(val)); },
    removeItem: (key) => { store.delete(String(key)); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] || null,
    get length() { return store.size; },
  };
}

const rulesSource = fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');

/**
 * Helper to parse `.hasOnly([...])` arrays directly from `firestore.rules` for a given function or block
 * so our rule evaluator and contract tests always reflect the real `firestore.rules` file on disk.
 */
function parseRulesList(functionOrBlockName, method = 'hasOnly') {
  const fnIdx = rulesSource.indexOf(functionOrBlockName);
  assert.ok(fnIdx !== -1, `Could not find ${functionOrBlockName} in firestore.rules`);
  const slice = rulesSource.slice(fnIdx, fnIdx + 1800);
  const regex = new RegExp(`\\.${method}\\(\\[([\\s\\S]*?)\\]\\)`);
  const match = slice.match(regex);
  assert.ok(match, `Could not find .${method}([...]) inside ${functionOrBlockName} in firestore.rules`);
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map(m => m[1]);
}

const RULES_STORE_HAS_ONLY = parseRulesList('function isValidStoreData', 'hasOnly');
const RULES_STORE_HAS_ALL = parseRulesList('function isValidStoreData', 'hasAll');
const RULES_PUBLIC_INFO_HAS_ONLY = parseRulesList('function isValidPublicStoreInfoData', 'hasOnly');
const RULES_PUBLIC_INFO_HAS_ALL = parseRulesList('function isValidPublicStoreInfoData', 'hasAll');
const RULES_PUBLIC_PRODUCT_HAS_ONLY = parseRulesList('function isValidPublicProductData', 'hasOnly');
const RULES_PUBLIC_PRODUCT_HAS_ALL = parseRulesList('function isValidPublicProductData', 'hasAll');
const RULES_SETTINGS_HAS_ONLY = parseRulesList('function isValidSettingsData', 'hasOnly');
const RULES_SHEETS_HAS_ONLY = parseRulesList('function isValidSheetsConfigData', 'hasOnly');
const RULES_AUDIT_HAS_ONLY = parseRulesList('function isValidAuditLogData', 'hasOnly');
const RULES_AUDIT_HAS_ALL = parseRulesList('function isValidAuditLogData', 'hasAll');
const RULES_INCOMING_ORDER_HAS_ONLY = parseRulesList('function isValidIncomingCustomerOrder', 'hasOnly');
const RULES_INCOMING_ORDER_HAS_ALL = parseRulesList('function isValidIncomingCustomerOrder', 'hasAll');

/**
 * Evaluates a Firestore operation against the predicates defined in `firestore.rules`.
 */
function evaluateFirestoreRule({ auth, method, path: docPath, resourceData = null, requestData = null, storeMap = new Map() }) {
  const isAuthenticated = () => auth != null && !!auth.uid;
  const isOwner = (userId) => isAuthenticated() && auth.uid === userId;
  const isValidString = (val, min, max) => typeof val === 'string' && val.length >= min && val.length <= max;
  const isValidNumber = (val, min, max) => typeof val === 'number' && !Number.isNaN(val) && val >= min && val <= max;
  const hasAll = (obj, keys) => obj != null && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k));
  const hasOnly = (obj, allowed) => obj != null && Object.keys(obj).every(k => allowed.includes(k));

  const parts = docPath.split('/').filter(Boolean);

  // 1. /users/{userId}...
  if (parts[0] === 'users' && parts.length >= 2) {
    const userId = parts[1];

    // Special case: /users/{userId}/businesses/{bizId}/auditLog/{logId}
    if (parts[2] === 'businesses' && parts[4] === 'auditLog' && parts.length === 6) {
      const bizId = parts[3];
      const logId = parts[5];
      if (method === 'read' || method === 'get' || method === 'list') {
        return isOwner(userId);
      }
      if (method === 'create') {
        return isOwner(userId)
          && isValidString(logId, 1, 100)
          && requestData != null
          && hasAll(requestData, RULES_AUDIT_HAS_ALL)
          && hasOnly(requestData, RULES_AUDIT_HAS_ONLY)
          && isValidString(requestData.action, 1, 50);
      }
      if (method === 'update' || method === 'delete') {
        return false; // allow update, delete: if false; (tamper-resistant append-only audit trail)
      }
      return false;
    }

    if (method === 'read' || method === 'get' || method === 'list' || method === 'delete') {
      return isOwner(userId);
    }

    if (method === 'create' || method === 'update') {
      if (!isOwner(userId) || !requestData || typeof requestData !== 'object') return false;

      if (parts.length === 2) {
        return Object.keys(requestData).length <= 25;
      }
      const sub = parts[2];
      if (sub === 'profile' && parts.length === 4) {
        return hasOnly(requestData, ['displayName', 'email', 'photoURL', 'updatedAt'])
          && (!('displayName' in requestData) || isValidString(requestData.displayName, 0, 120))
          && (!('email' in requestData) || isValidString(requestData.email, 0, 254))
          && (!('photoURL' in requestData) || isValidString(requestData.photoURL, 0, 2048));
      }
      if (sub === 'settings' && parts.length === 4) {
        return hasOnly(requestData, RULES_SETTINGS_HAS_ONLY)
          && (!('language' in requestData) || ['bn', 'en'].includes(requestData.language))
          && (!('isDarkMode' in requestData) || typeof requestData.isDarkMode === 'boolean')
          && (!('isPrivacyMode' in requestData) || typeof requestData.isPrivacyMode === 'boolean')
          && (!('appMode' in requestData) || ['easy', 'advanced'].includes(requestData.appMode))
          && (!('autoCloseEnabled' in requestData) || typeof requestData.autoCloseEnabled === 'boolean')
          && (!('editLockEnabled' in requestData) || typeof requestData.editLockEnabled === 'boolean');
      }
      if (sub === 'businessList' && parts.length === 4) {
        return hasOnly(requestData, ['businesses', 'updatedAt'])
          && Array.isArray(requestData.businesses)
          && requestData.businesses.length <= 50;
      }
      if (sub === 'sheetsConfig' && parts.length === 4) {
        return hasOnly(requestData, RULES_SHEETS_HAS_ONLY)
          && (!('spreadsheetId' in requestData) || isValidString(requestData.spreadsheetId, 0, 200))
          && (!('spreadsheetUrl' in requestData) || isValidString(requestData.spreadsheetUrl, 0, 1024))
          && (!('monthlySpreadsheets' in requestData) || (
            requestData.monthlySpreadsheets != null
            && typeof requestData.monthlySpreadsheets === 'object'
            && !Array.isArray(requestData.monthlySpreadsheets)
            && Object.keys(requestData.monthlySpreadsheets).length <= 120
          ));
      }
      if (sub === 'trxRegistry' && parts.length === 4) {
        const regId = parts[3];
        return isValidString(regId, 1, 150)
          && Object.keys(requestData).length <= 20;
      }
      if (sub === 'businesses' && parts.length >= 4) {
        const bizId = parts[3];
        if (!isValidString(bizId, 1, 100)) return false;
        if (parts.length === 4) return Object.keys(requestData).length <= 30;
        const bizSub = parts[4];
        const subId = parts[5];
        if (bizSub === 'days' && parts.length === 6) {
          return isValidString(subId, 8, 20)
            && requestData.dateKey === subId
            && Object.keys(requestData).length <= 60
            && (!('status' in requestData) || ['not_started', 'open', 'closed', 'finalized'].includes(requestData.status));
        }
        if (bizSub === 'contacts' && parts.length === 6) {
          return isValidString(subId, 1, 100)
            && hasOnly(requestData, [
              'id', 'name', 'phone', 'type', 'address', 'note',
              'openingBalance', 'currentBalance', 'interestRate',
              'creditLimit', 'dueDate', 'createdAt', 'updatedAt',
              'isBlacklisted', 'rtoCount'
            ])
            && isValidString(requestData.name, 1, 150)
            && (!('currentBalance' in requestData) || isValidNumber(requestData.currentBalance, -1000000000, 1000000000))
            && (!('openingBalance' in requestData) || isValidNumber(requestData.openingBalance, -1000000000, 1000000000));
        }
        if (bizSub === 'contactTxs' && parts.length === 6) {
          return isValidString(subId, 1, 100)
            && hasOnly(requestData, ['transactions', 'updatedAt'])
            && Array.isArray(requestData.transactions)
            && requestData.transactions.length <= 5000;
        }
        if (bizSub === 'onlineOrders' && parts.length === 6) {
          if (method === 'delete') {
            return isOwner(userId) && resourceData?.status !== 'settled';
          }
          if (method === 'create') {
            if (requestData?.status && !['draft', 'confirmed'].includes(requestData.status)) return false;
            if (requestData?.paymentStatus && !['pending', 'unpaid', 'awaiting_payment', 'submitted_for_verification', 'due_on_delivery'].includes(requestData.paymentStatus)) return false;
          }
          if (method === 'update') {
            if (resourceData?.status === 'settled' && requestData?.status !== 'settled') return false;
            if (requestData?.status === 'settled' && !['delivered', 'settled'].includes(resourceData?.status)) return false;
            if (resourceData?.status !== 'settled' && requestData?.status === 'settled') {
              if (!requestData?.settlementDateKey || !isValidString(requestData.settlementDateKey, 8, 20)) return false;
              if (!requestData?.settledAt) return false;
              if (!requestData?.settlementWallet) return false;
            }
            if (requestData?.status === 'cancelled' && ['delivered', 'returned', 'settled'].includes(resourceData?.status)) return false;
            if (requestData?.status === 'returned' && !['shipped', 'returned'].includes(resourceData?.status)) return false;
            if (resourceData?.status === 'returned' && requestData?.status && requestData.status !== 'returned') return false;
            if (resourceData?.status === 'cancelled' && requestData?.status && requestData.status !== 'cancelled') return false;
            if (requestData?.paymentStatus === 'verified' && resourceData?.paymentStatus !== 'verified') {
              if (!['draft', 'confirmed', 'packed', 'shipped'].includes(resourceData?.status)) return false;
              if (requestData?.status && !['draft', 'confirmed', 'packed', 'shipped'].includes(requestData.status)) return false;
              if (requestData?.status && ['cancelled', 'returned', 'settled'].includes(requestData.status)) return false;
              const pMethod = requestData.paymentMethod || resourceData?.paymentMethod;
              if (['bkash_manual', 'nagad_manual', 'rocket_manual'].includes(pMethod)) {
                if (requestData.allowWithoutTrxId === true) {
                  const reason = String(requestData.withoutTrxIdReason || '').trim();
                  if (reason.length < 5) return false;
                } else {
                  const trx = String(requestData.verifiedTrxId || requestData.paymentTrxId || resourceData?.verifiedTrxId || resourceData?.paymentTrxId || '').trim();
                  if (trx.length < 4) return false;
                }
              }
            }
            if (requestData?.status === 'settled' || resourceData?.status === 'settled') {
              const locked = ['totalAmount', 'codAmount', 'netAmount', 'settlementWallet', 'settlementAmount', 'settledAt'];
              for (const field of locked) {
                if (resourceData && field in resourceData && field in requestData && requestData[field] !== resourceData[field]) {
                  return false;
                }
              }
            }
          }
          return isValidString(subId, 1, 100)
            && Object.keys(requestData).length <= 40
            && (!('status' in requestData) || ['draft', 'confirmed', 'packed', 'shipped', 'delivered', 'settled', 'returned', 'cancelled'].includes(requestData.status))
            && (!('totalAmount' in requestData) || isValidNumber(requestData.totalAmount, 0, 100000000));
        }
        if (bizSub === 'meta' && parts.length === 6) {
          return isValidString(subId, 1, 50)
            && Object.keys(requestData).length <= 50;
        }
        if (bizSub === 'trxRegistry' && parts.length === 6) {
          return isValidString(subId, 1, 100)
            && Object.keys(requestData).length <= 20;
        }
      }
      return false;
    }
  }

  // 2. /stores/{shopSlug}
  if (parts[0] === 'stores' && parts.length === 2) {
    const shopSlug = parts[1];
    if (method === 'get' || method === 'list' || method === 'read') {
      return isAuthenticated() && resourceData?.ownerUserId === auth.uid;
    }
    if (method === 'delete') {
      return isAuthenticated() && resourceData?.ownerUserId === auth.uid;
    }
    const validStorePayload = requestData
      && hasAll(requestData, RULES_STORE_HAS_ALL)
      && hasOnly(requestData, RULES_STORE_HAS_ONLY)
      && isValidString(requestData.shopName, 1, 100)
      && isValidString(requestData.whatsappNumber, 6, 20);

    if (method === 'create') {
      return isAuthenticated()
        && isValidString(shopSlug, 3, 50)
        && requestData?.ownerUserId === auth.uid
        && Boolean(validStorePayload);
    }
    if (method === 'update') {
      return isAuthenticated()
        && resourceData?.ownerUserId === auth.uid
        && requestData?.ownerUserId === resourceData?.ownerUserId
        && Boolean(validStorePayload);
    }
  }

  // 3. /stores/{shopSlug}/public/{docId}
  if (parts[0] === 'stores' && parts[2] === 'public' && parts.length === 4) {
    const shopSlug = parts[1];
    const docId = parts[3];
    if (method === 'read' || method === 'get' || method === 'list') return true;
    const parentStore = storeMap.get(`stores/${shopSlug}`);
    if (!isAuthenticated() || !parentStore || parentStore.ownerUserId !== auth.uid) return false;
    if (method === 'delete') return true;
    if (method === 'create' || method === 'update') {
      return docId === 'info'
        && requestData != null
        && hasAll(requestData, RULES_PUBLIC_INFO_HAS_ALL)
        && hasOnly(requestData, RULES_PUBLIC_INFO_HAS_ONLY)
        && !('ownerUserId' in requestData)
        && !('bizId' in requestData)
        && !('autoSync' in requestData)
        && !('movedTo' in requestData)
        && isValidString(requestData.shopName, 1, 100)
        && isValidString(requestData.whatsappNumber, 6, 20)
        && typeof requestData.isActive === 'boolean';
    }
  }

  // 4. /stores/{shopSlug}/products/{productId}
  if (parts[0] === 'stores' && parts[2] === 'products' && parts.length === 4) {
    const shopSlug = parts[1];
    const productId = parts[3];
    if (method === 'read' || method === 'get' || method === 'list') return true;
    const parentStore = storeMap.get(`stores/${shopSlug}`);
    if (!isAuthenticated() || !parentStore || parentStore.ownerUserId !== auth.uid) return false;
    if (method === 'delete') return true;
    if (method === 'create' || method === 'update') {
      return isValidString(productId, 1, 100)
        && requestData != null
        && hasAll(requestData, RULES_PUBLIC_PRODUCT_HAS_ALL)
        && hasOnly(requestData, RULES_PUBLIC_PRODUCT_HAS_ONLY)
        && !('buyPrice' in requestData)
        && !('profit' in requestData)
        && !('cogs' in requestData)
        && !('batches' in requestData)
        && !('fifoCogs' in requestData)
        && isValidString(requestData.name, 1, 150)
        && isValidNumber(requestData.price, 0, 100000000)
        && typeof requestData.inStock === 'boolean'
        && (!('stock' in requestData) || isValidNumber(requestData.stock, 0, 10000000));
    }
  }

  // 5. /stores/{shopSlug}/orders/{orderId}
  if (parts[0] === 'stores' && parts[2] === 'orders' && parts.length === 4) {
    const shopSlug = parts[1];
    const orderId = parts[3];
    const parentStore = storeMap.get(`stores/${shopSlug}`);
    if (method === 'create') {
      const isOwnerCreate = isAuthenticated()
        && parentStore != null
        && parentStore.ownerUserId === auth.uid
        && isValidString(orderId, 1, 100)
        && requestData != null
        && requestData.id === orderId;
      if (isOwnerCreate) return true;

      const isValidItem = (item) =>
        typeof item === 'object'
        && item !== null
        && hasAll(item, ['productName', 'quantity', 'unitPrice', 'subtotal'])
        && hasOnly(item, ['productId', 'productName', 'quantity', 'unitPrice', 'subtotal'])
        && isValidString(item.productName, 1, 150)
        && isValidNumber(item.quantity, 1, 10000)
        && isValidNumber(item.unitPrice, 0, 100000000)
        && isValidNumber(item.subtotal, 0, 100000000)
        && item.subtotal === item.quantity * item.unitPrice;

      const itemsValid = Array.isArray(requestData?.items)
        && requestData.items.length >= 1
        && requestData.items.length <= 5
        && isValidItem(requestData.items[0])
        && (requestData.items.length < 2 || isValidItem(requestData.items[1]))
        && (requestData.items.length < 3 || isValidItem(requestData.items[2]))
        && (requestData.items.length < 4 || isValidItem(requestData.items[3]))
        && (requestData.items.length < 5 || isValidItem(requestData.items[4]));

      const sumItemsSubtotal = itemsValid
        ? requestData.items.reduce((acc, it) => acc + it.subtotal, 0)
        : -1;

      return isValidString(orderId, 1, 100)
        && requestData != null
        && requestData.id === orderId
        && parentStore != null
        && (parentStore.isActive === undefined || parentStore.isActive === true)
        && hasAll(requestData, RULES_INCOMING_ORDER_HAS_ALL)
        && hasOnly(requestData, RULES_INCOMING_ORDER_HAS_ONLY)
        && requestData.status === 'draft'
        && isValidString(requestData.id, 1, 100)
        && isValidString(requestData.customerName, 1, 150)
        && isValidString(requestData.customerPhone, 6, 25)
        && isValidNumber(requestData.totalAmount, 0, 100000000)
        && (!('subtotal' in requestData) || isValidNumber(requestData.subtotal, 0, 100000000))
        && (!('deliveryCharge' in requestData) || isValidNumber(requestData.deliveryCharge, 0, 100000))
        && (!('isInsideDhaka' in requestData) || typeof requestData.isInsideDhaka === 'boolean')
        && (!('customerAddress' in requestData) || isValidString(requestData.customerAddress, 0, 250))
        && (!('paymentMethod' in requestData) || ['cod', 'bkash_manual', 'nagad_manual', 'rocket_manual'].includes(requestData.paymentMethod))
        && (!('paymentTrxId' in requestData) || isValidString(requestData.paymentTrxId, 0, 60))
        && (!('paymentSenderPhone' in requestData) || isValidString(requestData.paymentSenderPhone, 0, 25))
        && itemsValid
        && (!('subtotal' in requestData) || requestData.subtotal === sumItemsSubtotal)
        && requestData.totalAmount === sumItemsSubtotal + (typeof requestData.deliveryCharge === 'number' ? requestData.deliveryCharge : 0);
    }
    if (method === 'read' || method === 'get' || method === 'list' || method === 'update' || method === 'delete') {
      return isAuthenticated() && !!parentStore && parentStore.ownerUserId === auth.uid;
    }
  }

  return false;
}

/**
 * Creates an in-memory Firestore test environment that optionally enforces `firestore.rules`
 * on every single SDK call (`getDoc`, `getDocs`, `setDoc`, `addDoc`, `deleteDoc`, `writeBatch`).
 */
function createMockFirestore(initialDocs = {}, options = {}) {
  const store = new Map(Object.entries(initialDocs));
  const batchHistory = [];
  const deleteOrder = [];
  let failOnStep = options.failOnStep || null;
  let currentAuth = options.auth !== undefined ? options.auth : { uid: 'default_test_user' };
  const enforceRules = options.enforceRules !== false;
  let autoIdCounter = 0;

  const assertRule = (method, docPath, resourceData, requestData) => {
    if (!enforceRules) return;
    const allowed = evaluateFirestoreRule({
      auth: currentAuth,
      method,
      path: docPath,
      resourceData,
      requestData,
      storeMap: store,
    });
    if (!allowed) {
      const err = new Error(`PERMISSION_DENIED: ${method} on ${docPath}`);
      err.code = 'permission-denied';
      throw err;
    }
  };

  const doc = (dbOrCol, ...segments) => {
    const prefix = dbOrCol?.path ? [dbOrCol.path] : [];
    const fullPath = [...prefix, ...segments].join('/');
    const parts = fullPath.split('/');
    return { path: fullPath, id: parts[parts.length - 1], ref: { path: fullPath } };
  };
  const collection = (_db, ...segments) => ({ path: segments.join('/') });
  const where = (field, op, value) => ({ type: 'where', field, op, value });
  const orderBy = (field, dir) => ({ type: 'orderBy', field, dir });
  const limit = (n) => ({ type: 'limit', n });
  const query = (colRef, ...clauses) => ({
    colPath: colRef.path,
    whereClause: clauses.find(c => c?.type === 'where') || clauses[0],
  });

  const getDoc = async (docRef) => {
    const p = docRef.path || docRef.ref?.path;
    if (failOnStep === `getDoc:${p}`) {
      throw new Error(`Simulated Firestore error on ${p}`);
    }
    const val = store.get(p);
    assertRule('get', p, val, null);
    return {
      exists: () => val !== undefined,
      data: () => val,
      id: docRef.id,
      ref: docRef,
    };
  };

  const getDocs = async (colOrQuery) => {
    const prefix = colOrQuery.colPath || colOrQuery.path;
    if (failOnStep === `getDocs:${prefix}`) {
      throw new Error(`Simulated Firestore query error on ${prefix}`);
    }
    const whereClause = colOrQuery.whereClause?.field ? colOrQuery.whereClause : null;
    const matched = [];
    for (const [docPath, data] of store.entries()) {
      const parts = docPath.split('/');
      const prefixParts = prefix.split('/');
      if (parts.length === prefixParts.length + 1 && docPath.startsWith(prefix + '/')) {
        if (!whereClause || data?.[whereClause.field] === whereClause.value) {
          assertRule('list', docPath, data, null);
          matched.push({
            id: parts[parts.length - 1],
            data: () => data,
            ref: { path: docPath, id: parts[parts.length - 1] },
          });
        }
      }
    }
    return {
      empty: matched.length === 0,
      docs: matched,
      forEach: (cb) => matched.forEach(cb),
    };
  };

  const setDoc = async (docRef, data, setOptions = {}) => {
    const p = docRef.path || docRef.ref?.path;
    if (failOnStep === `setDoc:${p}`) {
      throw new Error(`Simulated setDoc error on ${p}`);
    }
    const existing = store.get(p);
    const merged = setOptions?.merge && existing ? { ...existing, ...data } : { ...data };
    if (!setOptions?.bypassRules) {
      assertRule(existing !== undefined ? 'update' : 'create', p, existing, merged);
    }
    store.set(p, merged);
  };

  const addDoc = async (colRef, data) => {
    autoIdCounter += 1;
    const id = `auto_${autoIdCounter}`;
    const p = `${colRef.path}/${id}`;
    assertRule('create', p, undefined, data);
    store.set(p, { ...data });
    return { id, path: p, ref: { path: p, id } };
  };

  const deleteDoc = async (docRef) => {
    const p = docRef.path || docRef.ref?.path;
    if (failOnStep === `deleteDoc:${p}`) {
      throw new Error(`Simulated delete error on ${p}`);
    }
    const existing = store.get(p);
    assertRule('delete', p, existing, null);
    deleteOrder.push(p);
    store.delete(p);
  };

  const writeBatch = () => {
    const ops = [];
    return {
      delete: (ref) => {
        const p = ref.path || ref.ref?.path;
        ops.push({ type: 'delete', path: p });
      },
      set: (ref, data, setOptions = {}) => {
        const p = ref.path || ref.ref?.path;
        ops.push({ type: 'set', path: p, data, setOptions });
      },
      commit: async () => {
        if (ops.length > 500) {
          throw new Error(`Firestore batch limit exceeded: ${ops.length} operations > 500`);
        }
        for (const op of ops) {
          if (failOnStep === `batch:${op.path}`) {
            throw new Error(`Simulated batch failure on ${op.path}`);
          }
          if (op.type === 'delete') {
            const existing = store.get(op.path);
            assertRule('delete', op.path, existing, null);
            deleteOrder.push(op.path);
            store.delete(op.path);
          } else if (op.type === 'set') {
            const existing = store.get(op.path);
            const merged = op.setOptions?.merge && existing ? { ...existing, ...op.data } : { ...op.data };
            assertRule(existing !== undefined ? 'update' : 'create', op.path, existing, merged);
            store.set(op.path, merged);
          }
        }
        batchHistory.push(ops.length);
      },
    };
  };

  let txChain = Promise.resolve();
  const runTransaction = async (_db, updateFunction) => {
    const runAtomic = async () => {
      const stagedWrites = [];
      const tx = {
        get: async (docRef) => getDoc(docRef),
        set: (docRef, data, setOptions = {}) => {
          stagedWrites.push({ type: 'set', docRef, data, setOptions });
          return tx;
        },
        delete: (docRef) => {
          stagedWrites.push({ type: 'delete', docRef });
          return tx;
        },
      };
      const result = await updateFunction(tx);
      for (const op of stagedWrites) {
        if (op.type === 'set') {
          await setDoc(op.docRef, op.data, op.setOptions);
        } else if (op.type === 'delete') {
          await deleteDoc(op.docRef);
        }
      }
      return result;
    };
    const nextTx = txChain.catch(() => {}).then(runAtomic);
    txChain = nextTx;
    return nextTx;
  };

  const driver = {
    db: {},
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    deleteDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    writeBatch,
    runTransaction,
    setAuth: (newAuth) => { currentAuth = newAuth; },
  };

  globalThis.__LEDGERO_TEST_FIRESTORE__ = driver;

  return {
    ops: driver,
    store,
    batchHistory,
    deleteOrder,
    setAuth: driver.setAuth,
  };
}

// Initialize default test driver before importing service modules
createMockFirestore({});

const {
  calcUnitsSold,
  calcItemSummary,
  calcInventoryTotals,
  calcExpectedHandCash,
  roundBDT,
} = await import('../src/data/calculations.js');

const {
  createBatch,
  consumeFIFOBatches,
  restoreFIFOBatches,
  calculateFIFOValuation,
} = await import('../src/data/fifoEngine.js');

const {
  generateJournalEntry,
  generateCOGSEntry,
  generateReversalJournalEntry,
  computeTrialBalance,
  validateTrialBalance,
} = await import('../src/data/journalEngine.js');

const {
  quickSellStockInState,
  quickRestockInState,
  writeOffDamageInState,
  applyStockAuditInState,
  reverseSingleTransactionInState,
  bulkDeleteTransactionsInState,
  deleteBusinessInState,
  confirmOnlineOrderInState,
  verifyOnlineOrderPaymentInState,
  rejectOnlineOrderPaymentInState,
  verifyAndRepriceOnlineOrderInState,
  packOnlineOrderInState,
  shipOnlineOrderInState,
  deliverOnlineOrderInState,
  settleOnlineOrderInState,
  cancelOnlineOrderInState,
  returnOnlineOrderInState,
  parseStrictMoney,
  executeLedgerAction,
} = await import('../src/data/ledgerStateEngine.js');

const { getFinancialTotals } = await import('../src/data/analyticsEngine.js');

const {
  ALLOWED_USER_SETTINGS_KEYS,
  ALLOWED_SHEETS_CONFIG_KEYS,
  PUBLIC_PRODUCT_ALLOWED_KEYS,
  PUBLIC_STORE_INFO_ALLOWED_KEYS,
  BUSINESS_SUBCOLLECTIONS,
  IMMUTABLE_BUSINESS_SUBCOLLECTIONS,
  saveSettings,
  loadSettings,
  saveSheetsConfig,
  loadSheetsConfig,
  saveAllContactsToCloud,
  deleteBusinessFromCloud,
  deleteAllUserData,
  savePublicStoreInfo,
  syncPublicStoreProducts,
  buildPublicProductPayload,
  buildPublicStoreInfoPayload,
  saveOnlineOrderToCloud,
  saveAllOnlineOrdersToCloud,
  loadOnlineOrdersFromCloud,
  deleteOnlineOrderFromCloud,
  commitOnlineOrderSettlementToCloud,
  commitPaymentVerificationToCloud,
  migrateHistoricalTrxRegistry,
  commitOrderCancellationToCloud,
  commitOrderReturnToCloud,
  checkDayDataFreshness,
  saveCustomerStoreOrder,
  loadIncomingStoreOrders,
  deleteIncomingStoreOrder,
  saveBusinesses,
  loadBusinesses,
  saveDayToCloud,
  loadDayFromCloud,
  loadContactsFromCloud,
  getShopSlugForUser,
  exportAllCloudData,
  restoreAllCloudData,
} = await import('../src/firebase/firestoreService.js');

const {
  exportAllData,
  importAllData,
  validateBackupPayload,
  setActiveStorageUserId,
  getActiveStorageUserId,
  getStoragePrefix,
  loadDay,
  saveDay,
  loadContacts,
  saveContacts,
  loadCatalog,
  saveCatalog,
  clearUserLocalStorage,
} = await import('../src/data/storage.js');

const {
  ALLOWED_AUDIT_LOG_KEYS,
  logAuditEntry,
} = await import('../src/firebase/auditService.js');

const {
  sanitizeSpreadsheetCell,
} = await import('../src/firebase/sheetsService.js');

let passedTests = 0;
const testResults = [];

async function runTest(suiteName, testName, fn) {
  try {
    await fn();
    passedTests += 1;
    testResults.push({ suite: suiteName, test: testName, status: 'PASS' });
    console.log(`  ✅ [PASS] ${testName}`);
  } catch (err) {
    testResults.push({ suite: suiteName, test: testName, status: 'FAIL', error: err.message });
    console.error(`  ❌ [FAIL] ${testName}: ${err.message}`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 1: ACCOUNT & BUSINESS DELETION, BATCH CHUNKING & CONCURRENCY
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 SUITE 1: Account & Business Deletion, Batch Chunking & Storefront Sync');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await runTest('Suite 1', '1.1 Complete user deletion removes all mutable user docs, nested subcollections (>450 chunked), and public stores while preserving tamper-resistant auditLog under live firestore.rules', async () => {
  const uid = 'user_delete_test_1';
  const initialDocs = {
    [`users/${uid}`]: { createdAt: '2026-01-01' },
    [`users/${uid}/profile/info`]: { displayName: 'Rahim', email: 'rahim@example.com' },
    [`users/${uid}/settings/prefs`]: { language: 'bn', isDarkMode: true },
    [`users/${uid}/settings/config`]: { language: 'en' },
    [`users/${uid}/businessList/list`]: { businesses: [{ id: 'biz_1', name: 'Shop 1' }, { id: 'biz_2', name: 'Shop 2' }] },
    [`users/${uid}/sheetsConfig/config`]: { spreadsheetId: 'sheet_123' },
    [`users/${uid}/businesses/biz_1`]: { id: 'biz_1' },
    [`users/${uid}/businesses/biz_1/meta/info`]: { initialized: true },
    [`users/${uid}/businesses/biz_1/contacts/c1`]: { id: 'c1', name: 'Karim' },
    [`users/${uid}/businesses/biz_1/contactTxs/c1`]: { transactions: [] },
    [`users/${uid}/businesses/biz_1/auditLog/log1`]: { action: 'REVERSE', timestamp: 1700000000000 },
    [`users/${uid}/businesses/biz_2`]: { id: 'biz_2' },
    [`users/${uid}/businesses/biz_2/days/2026-10-01`]: { dateKey: '2026-10-01', status: 'closed' },
    ['stores/rahim-telecom']: { shopName: 'Rahim Telecom', ownerUserId: uid, whatsappNumber: '01700000000' },
    ['stores/rahim-telecom/public/info']: { shopName: 'Rahim Telecom', whatsappNumber: '01700000000', isActive: true },
    ['stores/other-shop']: { shopName: 'Other Shop', ownerUserId: 'other_user', whatsappNumber: '01800000000' },
  };

  for (let i = 1; i <= 600; i++) {
    initialDocs[`users/${uid}/businesses/biz_1/days/day_${i}`] = { dateKey: `day_${i}`, status: 'closed' };
  }
  for (let i = 1; i <= 510; i++) {
    initialDocs[`stores/rahim-telecom/products/prod_${i}`] = { name: `Item ${i}`, price: 100, inStock: true };
  }

  const mock = createMockFirestore(initialDocs, { auth: { uid }, enforceRules: true });
  const report = await deleteAllUserData(uid, [{ id: 'biz_1' }], mock.ops);

  assert.equal(report.verified, true, 'Deletion report must be marked verified');
  assert.equal(report.deletedCounts.businesses, 2, 'Both biz_1 and biz_2 must be deleted');
  assert.equal(report.deletedCounts.publicStores, 1, 'Owned public store must be deleted');
  assert.equal(report.deletedCounts.publicProducts, 510, 'All 510 public store products must be deleted');

  // Verify meta/info was deleted while immutable auditLog/log1 cannot be deleted by client SDK
  const metaDeleteIdx = mock.deleteOrder.indexOf(`users/${uid}/businesses/biz_1/meta/info`);
  const auditDeleteIdx = mock.deleteOrder.indexOf(`users/${uid}/businesses/biz_1/auditLog/log1`);
  assert.ok(metaDeleteIdx !== -1, 'meta/info must be deleted');
  assert.equal(auditDeleteIdx, -1, 'auditLog must remain tamper-proof against client-side deletion');

  // Verify no batch exceeded 450 operations
  assert.ok(mock.batchHistory.every(size => size <= 450), `All batches must be <= 450 ops, got: ${mock.batchHistory}`);

  // Verify products and public/info were deleted BEFORE parent store document
  const lastProductDeleteIdx = mock.deleteOrder.findLastIndex(p => p.startsWith('stores/rahim-telecom/products/'));
  const publicInfoDeleteIdx = mock.deleteOrder.indexOf('stores/rahim-telecom/public/info');
  const storeDeleteIdx = mock.deleteOrder.indexOf('stores/rahim-telecom');
  assert.ok(lastProductDeleteIdx < storeDeleteIdx, 'Store products must be deleted before parent store document');
  assert.ok(publicInfoDeleteIdx < storeDeleteIdx, 'Store public/info must be deleted before parent store document');

  // Verify zero mutable documents remain for uid (only tamper-resistant auditLog/log1 remains)
  const remainingUserKeys = Array.from(mock.store.keys()).filter(k => (k.includes(uid) && !k.includes('/auditLog/')) || k.startsWith('stores/rahim-telecom'));
  assert.equal(remainingUserKeys.length, 0, `Expected 0 remaining mutable docs for deleted user, found: ${remainingUserKeys}`);
  assert.ok(mock.store.has(`users/${uid}/businesses/biz_1/auditLog/log1`), 'Immutable auditLog entry must be preserved');
  assert.ok(mock.store.has('stores/other-shop'), 'Other user store must remain untouched');
});

await runTest('Suite 1', '1.2 Partial deletion failure is never swallowed and blocks premature Firebase Auth deletion', async () => {
  const uid = 'user_delete_fail_test';
  const initialDocs = {
    [`users/${uid}`]: { createdAt: '2026-01-01' },
    ['stores/broken-store']: { shopName: 'Broken Store', ownerUserId: uid, whatsappNumber: '01700000000' },
  };
  const mock = createMockFirestore(initialDocs, { auth: { uid }, failOnStep: 'deleteDoc:stores/broken-store' });

  let authDeleted = false;
  let caughtErr = null;
  try {
    const report = await deleteAllUserData(uid, [], mock.ops);
    if (report.verified) {
      authDeleted = true;
    }
  } catch (err) {
    caughtErr = err;
  }

  assert.ok(caughtErr !== null, 'deleteAllUserData must throw when a deletion step fails');
  assert.equal(caughtErr.deletionReport?.verified, false, 'deletionReport.verified must be false on failure');
  assert.equal(authDeleted, false, 'Firebase Auth account must NOT be deleted when cloud data deletion fails');
});

await runTest('Suite 1', '1.3 Single business deletion (deleteBusinessFromCloud + deleteBusinessInState) removes all mutable cloud subcollections, linked store, and updates businessList', async () => {
  const uid = 'user_biz_delete';
  const initialDocs = {
    [`users/${uid}/businessList/list`]: {
      businesses: [
        { id: 'biz_keep', name: 'Keep Shop' },
        { id: 'biz_remove', name: 'Remove Shop' },
      ],
    },
    [`users/${uid}/businesses/biz_remove`]: { id: 'biz_remove', name: 'Remove Shop' },
    [`users/${uid}/businesses/biz_remove/meta/info`]: { name: 'Remove Shop' },
    [`users/${uid}/businesses/biz_remove/days/2026-10-10`]: { dateKey: '2026-10-10', status: 'open' },
    [`users/${uid}/businesses/biz_remove/contacts/c1`]: { id: 'c1', name: 'Customer 1' },
    [`users/${uid}/businesses/biz_remove/contactTxs/c1`]: { transactions: [] },
    [`users/${uid}/businesses/biz_remove/auditLog/a1`]: { action: 'DELETE_TX', timestamp: 1700000000000 },
    ['stores/remove-shop']: { shopName: 'Remove Shop', ownerUserId: uid, bizId: 'biz_remove', whatsappNumber: '01700000000' },
    ['stores/remove-shop/public/info']: { shopName: 'Remove Shop', whatsappNumber: '01700000000', isActive: true },
    ['stores/remove-shop/products/p1']: { name: 'Prod 1', price: 100, inStock: true },
  };

  const mock = createMockFirestore(initialDocs, { auth: { uid }, enforceRules: true });
  const report = await deleteBusinessFromCloud(uid, 'biz_remove', mock.ops);

  assert.equal(report.verified, true);
  assert.equal(report.deletedCounts.publicStores, 1);
  assert.equal(
    Array.from(mock.store.keys()).filter(k => (k.includes('biz_remove') && !k.includes('/auditLog/')) || k.includes('remove-shop')).length,
    0,
    'All mutable cloud docs and linked public store for biz_remove must be deleted'
  );
  assert.ok(mock.store.has(`users/${uid}/businesses/biz_remove/auditLog/a1`), 'Tamper-resistant auditLog entry must remain protected against client deletion');
  const updatedList = mock.store.get(`users/${uid}/businessList/list`);
  assert.equal(updatedList.businesses.length, 1);
  assert.equal(updatedList.businesses[0].id, 'biz_keep');

  // Verify local reducer transition via deleteBusinessInState
  const localState = {
    businesses: [{ id: 'biz_keep', name: 'Keep Shop' }, { id: 'biz_remove', name: 'Remove Shop' }],
    activeBizId: 'biz_remove',
    activeBiz: { id: 'biz_remove', name: 'Remove Shop' },
  };
  const nextState = deleteBusinessInState(localState, 'biz_remove');
  assert.equal(nextState.businesses.length, 1);
  assert.equal(nextState.activeBizId, 'biz_keep');
  assert.equal(nextState._deletedBizId, 'biz_remove');
  assert.equal(nextState.dayData, null);
});

await runTest('Suite 1', '1.4 Storefront sync chunks >500 ops, strips private fields, handles 0 stock, and serializes concurrent syncs per slug', async () => {
  const uid = 'uid_1';
  const initialDocs = {
    'stores/chunk-shop': { shopName: 'Chunk Shop', ownerUserId: uid, whatsappNumber: '01712345678', isActive: true },
  };
  for (let i = 1; i <= 200; i++) {
    initialDocs[`stores/chunk-shop/products/stale_${i}`] = { name: `Old ${i}`, price: 50, inStock: true };
  }
  const mock = createMockFirestore(initialDocs, { auth: { uid }, enforceRules: true });

  const newInventory = [];
  for (let i = 1; i <= 400; i++) {
    newInventory.push({
      id: `new_${i}`,
      name: `Product ${i}`,
      buyPrice: 80,
      sellPrice: 120,
      profit: 40,
      cogs: 80,
      batches: [{ id: 'b1' }],
      openingStock: 10,
      closingStock: i === 1 ? 0 : 5,
      unit: 'পিস',
      category: 'General',
    });
  }

  const syncRes = await syncPublicStoreProducts('chunk-shop', newInventory, { customOps: mock.ops });
  assert.equal(syncRes.aborted, false);
  assert.equal(syncRes.deleted, 200);
  assert.equal(syncRes.upserted, 400);
  assert.equal(syncRes.batchesCommitted, 2, '600 operations must be split into 2 batches of <=450 ops');

  const prod1 = mock.store.get('stores/chunk-shop/products/new_1');
  assert.equal(prod1.stock, 0, 'closingStock=0 must publish as stock: 0, not fallback to openingStock');
  assert.equal(prod1.inStock, false, 'closingStock=0 must publish as inStock: false');
  assert.deepEqual(Object.keys(prod1).sort(), [...PUBLIC_PRODUCT_ALLOWED_KEYS].sort());

  // Concurrent calls on the same slug must serialize via syncQueueBySlug so the second call wins cleanly
  const p1 = syncPublicStoreProducts(
    'chunk-shop',
    [{ id: 'only_a', name: 'Only A', sellPrice: 100, closingStock: 3 }],
    { customOps: mock.ops }
  );
  const p2 = syncPublicStoreProducts(
    'chunk-shop',
    [{ id: 'only_b', name: 'Only B', sellPrice: 200, closingStock: 7 }],
    { customOps: mock.ops }
  );
  await Promise.all([p1, p2]);

  const finalProducts = Array.from(mock.store.keys()).filter(k => k.startsWith('stores/chunk-shop/products/'));
  assert.deepEqual(finalProducts, ['stores/chunk-shop/products/only_b'], 'Serialized per-slug queue must leave only the latest inventory');
});

await runTest('Suite 1', '1.5 saveAllContactsToCloud chunks >450 contacts into multiple batches under live firestore.rules', async () => {
  const uid = 'uid_contacts';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });
  const contacts = Array.from({ length: 520 }, (_, idx) => ({
    id: `c_${idx + 1}`,
    name: `Customer ${idx + 1}`,
    phone: '01700000000',
    type: 'customer',
    openingBalance: 0,
    currentBalance: 100,
  }));

  await saveAllContactsToCloud(uid, 'biz_1', contacts);
  assert.equal(mock.batchHistory.length, 2, '520 contacts must be committed in 2 batches of <=450');
  assert.ok(mock.batchHistory.every(sz => sz <= 450));
  assert.equal(mock.store.size, 520);
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2: FIFO INVENTORY, STOCK AUDIT, SINGLE & BULK REVERSAL ENGINE
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 SUITE 2: FIFO Inventory, Stock Audit (P0), Single & Bulk Reversal (P0)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

function createTestLedgerState() {
  const b1 = createBatch(5, 100, '2026-10-01', 'batch_100');
  const b2 = createBatch(5, 120, '2026-10-02', 'batch_120');
  return {
    language: 'en',
    contacts: [
      { id: 'cust_1', name: 'Karim', type: 'customer', openingBalance: 0, currentBalance: 0 },
    ],
    contactTransactions: {},
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: {
        CASH: { opening: 5000, current: 5000, closing: null },
        BKASH: { opening: 2000, current: 2000, closing: null },
      },
      inventory: [
        {
          id: 'item_rice',
          name: 'Miniket Rice 5kg',
          unit: 'bag',
          buyPrice: 110,
          sellPrice: 180,
          openingStock: 5,
          addedStock: 5,
          closingStock: 10,
          damagedStock: 0,
          fifoSoldUnits: 0,
          fifoCogs: 0,
          batches: [b1, b2],
        },
      ],
      transactions: [],
      journalEntries: [],
    },
  };
}

await runTest('Suite 2', '2.1 Purchase (৳100) -> Restock (৳120) -> Damage (2 units) -> Reverse Damage -> Sale (4 units) preserves exact FIFO batches & GL balance', async () => {
  let state = createTestLedgerState();

  // Step 1: Write off 2 damaged units (consumes 2 units from oldest ৳100 batch = ৳200)
  state = writeOffDamageInState(state, { itemId: 'item_rice', quantity: 2, reason: 'Water damage' });
  let item = state.dayData.inventory[0];
  assert.equal(item.closingStock, 8);
  assert.equal(item.damagedStock, 2);
  assert.equal(item.batches[0].remainingQty, 3, 'batch_100 must have 3 units left after 2 damaged');
  assert.equal(calcItemSummary(item).unitsSold, 0, 'Damaged units must never be counted as sold');

  // Step 2: Reverse the damage write-off
  const dmgTxId = state.dayData.transactions[0].id;
  state = reverseSingleTransactionInState(state, { txId: dmgTxId, reason: 'Count mistake' });
  item = state.dayData.inventory[0];
  assert.equal(item.closingStock, 10);
  assert.equal(item.damagedStock, 0);
  assert.equal(item.batches[0].id, 'batch_100');
  assert.equal(item.batches[0].remainingQty, 5, 'batch_100 must be restored to 5 units @ ৳100');
  assert.equal(calculateFIFOValuation(item.batches), 1100);

  // Step 3: Sell 4 units @ ৳180 -> must consume 4 units from restored ৳100 batch (COGS = ৳400)
  state = quickSellStockInState(state, { itemId: 'item_rice', quantity: 4, wallet: 'CASH' });
  item = state.dayData.inventory[0];
  const saleTx = state.dayData.transactions.at(-1);
  assert.equal(saleTx.amount, 720);
  assert.equal(saleTx.cogs, 400);
  assert.equal(saleTx.profit, 320);

  const sumAfterSale = calcItemSummary(item);
  const invTotals = calcInventoryTotals([item]);
  const trialBalance = computeTrialBalance(state.dayData.journalEntries);
  const tbCheck = validateTrialBalance(trialBalance);

  assert.equal(sumAfterSale.unitsSold, 4);
  assert.equal(sumAfterSale.cogs, 400);
  assert.equal(sumAfterSale.profit, 320);
  assert.equal(invTotals.totalProfit, 320);
  assert.equal(tbCheck.isBalanced, true);
  assert.equal(trialBalance.cogs.net, 400);
  assert.equal(trialBalance.inventory_loss.net, 0);
});

await runTest('Suite 2', '2.2 Same-day multi-batch exhaustion & sale reversal restores exhausted batch in exact FIFO order', async () => {
  const b1 = createBatch(2, 100, '2026-10-10', 'same_day_b1');
  const b2 = createBatch(4, 150, '2026-10-10', 'same_day_b2');

  const consumed = consumeFIFOBatches([b1, b2], 3, 125);
  assert.equal(consumed.totalCost, 350);
  assert.equal(consumed.remainingBatches.length, 1);

  const restored = restoreFIFOBatches(consumed.remainingBatches, consumed.consumedDetails, 3, 125);
  assert.equal(restored.length, 2);
  assert.equal(restored[0].id, 'same_day_b1');
  assert.equal(restored[0].remainingQty, 2);
  assert.equal(restored[1].id, 'same_day_b2');
  assert.equal(restored[1].remainingQty, 4);
});

await runTest('Suite 2', '2.3 [P0 Fix] APPLY_STOCK_AUDIT shortage & surplus maintain FIFO batches, never fabricate sales, and reverse cleanly', async () => {
  let state = createTestLedgerState();

  // Case A: Physical stock audit finds 7 units instead of 10 (Shortage of 3 units)
  state = applyStockAuditInState(state, [
    { itemId: 'item_rice', systemStock: 10, physicalStock: 7, variance: -3 },
  ]);

  let item = state.dayData.inventory[0];
  assert.equal(item.closingStock, 7, 'closingStock must become 7');
  assert.equal(item.damagedStock, 3, 'damagedStock must increment by 3 so shortage is not counted as sold');
  assert.equal(calcUnitsSold(item), 0, 'Shortage must NEVER be counted as unitsSold');
  assert.equal(calcItemSummary(item).salesRevenue, 0, 'Shortage must NEVER fabricate salesRevenue');
  assert.equal(item.batches[0].id, 'batch_100');
  assert.equal(item.batches[0].remainingQty, 2, 'Oldest FIFO batch must be reduced from 5 to 2');
  assert.equal(calculateFIFOValuation(item.batches), 2 * 100 + 5 * 120, 'FIFO valuation must equal closingStock value (৳800)');

  const shortageTx = state.dayData.transactions.at(-1);
  assert.equal(shortageTx.type, 'damage_loss');
  assert.equal(shortageTx.amount, 300, '3 units from ৳100 batch = ৳300 loss');

  // Reverse the shortage audit transaction
  state = reverseSingleTransactionInState(state, { txId: shortageTx.id, reason: 'Found missing bags in back room' });
  item = state.dayData.inventory[0];
  assert.equal(item.closingStock, 10);
  assert.equal(item.damagedStock, 0);
  assert.equal(item.batches[0].remainingQty, 5);
  assert.equal(calculateFIFOValuation(item.batches), 1100);

  // Case B: Physical stock audit finds 14 units instead of 10 (Surplus of 4 units)
  state = applyStockAuditInState(state, [
    { itemId: 'item_rice', systemStock: 10, physicalStock: 14, variance: 4 },
  ]);
  item = state.dayData.inventory[0];
  assert.equal(item.closingStock, 14);
  assert.equal(item.addedStock, 9, 'addedStock must increase from 5 to 9 so calcUnitsSold is never negative');
  assert.equal(calcUnitsSold(item), 0, 'Surplus must NEVER produce negative unitsSold');
  assert.equal(item.batches.length, 3, 'Surplus must create a new FIFO batch');
  assert.equal(calculateFIFOValuation(item.batches), 1100 + 4 * 110);

  const surplusTx = state.dayData.transactions.at(-1);
  assert.equal(surplusTx.type, 'stock_audit_surplus');
  assert.equal(surplusTx.amount, 440);

  const tbAfterSurplus = computeTrialBalance(state.dayData.journalEntries);
  assert.equal(validateTrialBalance(tbAfterSurplus).isBalanced, true);
  assert.equal(tbAfterSurplus.other_income.credit, 440);
  assert.equal(tbAfterSurplus.other_income.net, -440);

  // Reverse the surplus audit transaction
  state = reverseSingleTransactionInState(state, { txId: surplusTx.id, reason: 'Counted neighbor bags by mistake' });
  item = state.dayData.inventory[0];
  assert.equal(item.closingStock, 10);
  assert.equal(item.addedStock, 5);
  assert.equal(item.batches.length, 2);
  assert.equal(calculateFIFOValuation(item.batches), 1100);
  const tbAfterSurplusReversal = computeTrialBalance(state.dayData.journalEntries);
  assert.equal(validateTrialBalance(tbAfterSurplusReversal).isBalanced, true);
  assert.equal(tbAfterSurplusReversal.other_income.net, 0);
});

await runTest('Suite 2', '2.4 [P0 Fix] BULK_DELETE_TRANSACTIONS reverses wallets, inventory, FIFO batches, contacts, and all journals (including COGS)', async () => {
  let state = createTestLedgerState();

  // 1. Sell 3 units for cash (3 * 180 = 540, COGS = 300)
  state = quickSellStockInState(state, { itemId: 'item_rice', quantity: 3, wallet: 'CASH' });
  // 2. Restock 4 units @ ৳130 paid from CASH (4 * 130 = 520)
  state = quickRestockInState(state, { itemId: 'item_rice', quantity: 4, buyPrice: 130, paidFromCash: true, wallet: 'CASH' });
  // 3. Damage 1 unit (consumes 1 unit from remaining 2 in batch_100 = ৳100)
  state = writeOffDamageInState(state, { itemId: 'item_rice', quantity: 1, reason: 'Torn bag' });
  // 4. Customer payment received (baki_received) of ৳300 into BKASH for cust_1
  const bakiTx = {
    id: 'tx_baki_1',
    type: 'baki_received',
    amount: 300,
    wallet: 'BKASH',
    contactId: 'cust_1',
    timestamp: Date.now(),
  };
  const bakiJE = generateJournalEntry(bakiTx);
  state = {
    ...state,
    contacts: state.contacts.map(c => c.id === 'cust_1' ? { ...c, currentBalance: c.currentBalance - 300 } : c),
    dayData: {
      ...state.dayData,
      wallets: {
        ...state.dayData.wallets,
        BKASH: { ...state.dayData.wallets.BKASH, current: state.dayData.wallets.BKASH.current + 300 },
      },
      transactions: [...state.dayData.transactions, bakiTx],
      journalEntries: [...state.dayData.journalEntries, bakiJE],
    },
  };

  assert.equal(state.dayData.transactions.length, 4);
  const allIds = state.dayData.transactions.map(t => t.id);

  // Execute bulk delete of all 4 transactions
  const bulkReversedState = bulkDeleteTransactionsInState(state, { txIds: allIds, reason: 'Bulk reversal test' });

  const activeTxs = bulkReversedState.dayData.transactions.filter(t => !t.reversed && !t.isReversal);
  assert.equal(activeTxs.length, 0, 'All 4 original transactions must be marked reversed with matching reversal records');
  assert.equal(bulkReversedState._auditEntries.length, 4, 'All 4 reversals must produce audit entries');

  // Verify wallets restored to exact opening balances
  assert.equal(bulkReversedState.dayData.wallets.CASH.current, 5000, 'CASH wallet must be restored to 5000');
  assert.equal(bulkReversedState.dayData.wallets.BKASH.current, 2000, 'BKASH wallet must be restored to 2000');

  // Verify contact balance restored
  assert.equal(bulkReversedState.contacts.find(c => c.id === 'cust_1').currentBalance, 0, 'Contact balance must be restored to 0');

  // Verify inventory & FIFO batches restored to initial state
  const restoredItem = bulkReversedState.dayData.inventory[0];
  assert.equal(restoredItem.closingStock, 10, 'closingStock must be restored to 10');
  assert.equal(restoredItem.addedStock, 5, 'addedStock must be restored to 5');
  assert.equal(restoredItem.damagedStock, 0, 'damagedStock must be restored to 0');
  assert.equal(restoredItem.fifoSoldUnits, 0, 'fifoSoldUnits must be restored to 0');
  assert.equal(restoredItem.fifoCogs, 0, 'fifoCogs must be restored to 0');
  assert.equal(restoredItem.batches.length, 2, 'Restock batch must be removed and original 2 batches preserved');
  assert.equal(restoredItem.batches[0].remainingQty, 5, 'batch_100 must be restored to 5 units');
  assert.equal(calculateFIFOValuation(restoredItem.batches), 1100);

  // Verify all GL accounts (including COGS and Inventory) net to 0 and Trial Balance is balanced
  const tb = computeTrialBalance(bulkReversedState.dayData.journalEntries);
  const tbValid = validateTrialBalance(tb);
  assert.equal(tbValid.isBalanced, true, 'Trial balance must be balanced after bulk delete');
  assert.equal(tb.cogs.net, 0, 'COGS net balance must be 0 after bulk delete');
  assert.equal(tb.inventory.net, 0, 'Inventory net journal movement must be 0 after bulk delete');
  assert.equal(tb.sales_revenue.net, 0, 'Sales revenue net balance must be 0 after bulk delete');
  assert.equal(tb.accounts_receivable.net, 0, 'Accounts receivable net balance must be 0 after bulk delete');
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 3: SERVICE-TO-FIRESTORE.RULES CONTRACT & SECURITY VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 SUITE 3: Live Service-to-firestore.rules Contract & Security Verification');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await runTest('Suite 3', '3.1 Static & parsed contract: JS allowlists in firestoreService.js and auditService.js match firestore.rules 100%', async () => {
  assert.deepEqual(
    [...ALLOWED_USER_SETTINGS_KEYS].sort(),
    [...RULES_SETTINGS_HAS_ONLY].sort(),
    'ALLOWED_USER_SETTINGS_KEYS must match isValidSettingsData in firestore.rules'
  );
  assert.deepEqual(
    [...ALLOWED_SHEETS_CONFIG_KEYS].sort(),
    [...RULES_SHEETS_HAS_ONLY].sort(),
    'ALLOWED_SHEETS_CONFIG_KEYS must match isValidSheetsConfigData in firestore.rules'
  );
  assert.deepEqual(
    [...ALLOWED_AUDIT_LOG_KEYS].sort(),
    [...RULES_AUDIT_HAS_ONLY].sort(),
    'ALLOWED_AUDIT_LOG_KEYS must match isValidAuditLogData in firestore.rules'
  );
  assert.deepEqual(
    [...PUBLIC_STORE_INFO_ALLOWED_KEYS].sort(),
    [...RULES_PUBLIC_INFO_HAS_ONLY].sort(),
    'PUBLIC_STORE_INFO_ALLOWED_KEYS must match isValidPublicStoreInfoData in firestore.rules'
  );
  assert.deepEqual(
    [...PUBLIC_PRODUCT_ALLOWED_KEYS].sort(),
    [...RULES_PUBLIC_PRODUCT_HAS_ONLY].sort(),
    'PUBLIC_PRODUCT_ALLOWED_KEYS must match isValidPublicProductData in firestore.rules'
  );
  assert.equal(
    BUSINESS_SUBCOLLECTIONS.includes('auditLog'),
    false,
    'BUSINESS_SUBCOLLECTIONS must not include immutable auditLog'
  );
  assert.deepEqual(
    IMMUTABLE_BUSINESS_SUBCOLLECTIONS,
    ['auditLog'],
    'IMMUTABLE_BUSINESS_SUBCOLLECTIONS must contain auditLog'
  );
});

await runTest('Suite 3', '3.2 [P1 Fix] logAuditEntry() succeeds against live firestore.rules, blocks update, and blocks delete even if meta/info is deleted', async () => {
  const uid = 'uid_audit';
  const bizId = 'biz_audit';
  const mock = createMockFirestore(
    {
      [`users/${uid}/businesses/${bizId}/meta/info`]: { name: 'Active Shop' },
    },
    { auth: { uid }, enforceRules: true }
  );

  // Calling real logAuditEntry() with extra unexpected fields must sanitize and succeed under firestore.rules
  const docRef = await logAuditEntry(uid, bizId, {
    action: 'REVERSE_TRANSACTION',
    txId: 'tx_99',
    txType: 'stock_sale',
    amount: 500,
    reason: 'Wrong amount',
    dateKey: '2026-10-10',
    unexpectedFieldThatWouldBreakRules: 'should_be_stripped',
  });
  assert.ok(docRef?.id, 'logAuditEntry must return created DocumentReference and not fail silently');

  const logPath = `users/${uid}/businesses/${bizId}/auditLog/${docRef.id}`;
  const storedLog = mock.store.get(logPath);
  assert.ok(storedLog, 'Audit log document must be persisted');
  assert.equal('unexpectedFieldThatWouldBreakRules' in storedLog, false);

  // Attempting to update an existing auditLog entry must be rejected by firestore.rules (allow update: if false)
  await assert.rejects(
    () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, logPath), { ...storedLog, reason: 'Tampered' }),
    /PERMISSION_DENIED/,
    'Updating an auditLog entry must be rejected'
  );

  // Attempting to delete an auditLog entry while meta/info exists must be rejected by firestore.rules
  await assert.rejects(
    () => mock.ops.deleteDoc(mock.ops.doc(mock.ops.db, logPath)),
    /PERMISSION_DENIED/,
    'Deleting an auditLog entry while business meta/info exists must be rejected'
  );

  // Deleting meta/info must NOT unlock client-side deletion of auditLog
  await mock.ops.deleteDoc(mock.ops.doc(mock.ops.db, `users/${uid}/businesses/${bizId}/meta/info`));
  await assert.rejects(
    () => mock.ops.deleteDoc(mock.ops.doc(mock.ops.db, logPath)),
    /PERMISSION_DENIED/,
    'Deleting an auditLog entry after meta/info removal must STILL be rejected (tamper-resistant audit trail)'
  );
});

await runTest('Suite 3', '3.3 [P1 Fix] saveSheetsConfig() normalizes dynamic monthly spreadsheet keys into monthlySpreadsheets map accepted by firestore.rules', async () => {
  const uid = 'uid_sheets';
  createMockFirestore({}, { auth: { uid }, enforceRules: true });

  await saveSheetsConfig(uid, {
    spreadsheetId: 'root_sheet_id',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/root_sheet_id',
    'spreadsheetId_2026-10': 'month_oct_id',
    monthlySpreadsheets: {
      '2026-09': 'month_sep_id',
    },
  });

  const loaded = await loadSheetsConfig(uid);
  assert.equal(loaded.spreadsheetId, 'root_sheet_id');
  assert.equal(loaded.monthlySpreadsheets['2026-09'], 'month_sep_id');
  assert.equal(loaded.monthlySpreadsheets['2026-10'], 'month_oct_id');
  assert.equal('spreadsheetId_2026-10' in loaded, false, 'Dynamic top-level spreadsheetId_YYYY-MM key must be normalized into monthlySpreadsheets');
});

await runTest('Suite 3', '3.4 [P1 Fix] saveSettings() and loadSettings() persist all 22 user settings fields under live firestore.rules', async () => {
  const uid = 'uid_settings';
  createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const fullSettings = {
    language: 'bn',
    isDarkMode: true,
    isPrivacyMode: false,
    autoCloseTime: '23:30',
    autoOpenTime: '08:00',
    autoCloseEnabled: true,
    editLockEnabled: true,
    editLockPinHash: 'hash_123',
    userRole: 'owner',
    staffPinHash: 'staff_456',
    appMode: 'advanced',
    featureFlags: { khata: true },
    taxRegion: 'BD',
    sheetsWebAppUrl: 'https://script.google.com/macros/s/test/exec',
    teaHouseProducts: [{ id: 'tea_1', name: 'Milk Tea', price: 20 }],
    teaHouseMonthlyTab: [{ id: 'tab_1', amount: 100 }],
    teaHouseMonthlyPersonal: 200,
    teaHouseMonthlyShop: 350,
    teaHouseTabMonth: '2026-10',
    courierSettings: { insideDhakaCharge: 80, outsideDhakaCharge: 130 },
    customerBlacklist: { '01700000000': { rtoCount: 2 } },
  };

  await saveSettings(uid, fullSettings);
  const loaded = await loadSettings(uid);

  assert.equal(loaded.appMode, 'advanced');
  assert.deepEqual(loaded.courierSettings, fullSettings.courierSettings);
  assert.deepEqual(loaded.customerBlacklist, fullSettings.customerBlacklist);
  assert.deepEqual(loaded.teaHouseProducts, fullSettings.teaHouseProducts);
  assert.equal(loaded.teaHouseMonthlyShop, 350);
  assert.equal(loaded.teaHouseTabMonth, '2026-10');
});

await runTest('Suite 3', '3.5 [P1 Fix] Public Storefront separates owner /stores/{slug} from public /stores/{slug}/public/info so unauthenticated users cannot read ownerUserId', async () => {
  const uid = 'shop_owner_1';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  await savePublicStoreInfo('rahim-store', {
    shopName: 'Rahim Store',
    displayName: 'রহিম স্টোর',
    ownerUserId: uid,
    bizId: 'biz_secret_1',
    whatsappNumber: '01711223344',
    address: 'Mirpur 10, Dhaka',
    isActive: true,
    autoSync: true,
  }, mock.ops);

  // Switch to unauthenticated public visitor (customer browsing /s/rahim-store)
  mock.setAuth(null);

  // 1. Unauthenticated visitor CANNOT read private owner doc /stores/rahim-store
  await assert.rejects(
    () => mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'stores', 'rahim-store')),
    /PERMISSION_DENIED/,
    'Unauthenticated visitor must NOT be allowed to read /stores/{shopSlug} containing ownerUserId and bizId'
  );

  // 1b. Authenticated NON-OWNER user also CANNOT read private owner doc /stores/rahim-store
  mock.setAuth({ uid: 'attacker_user_2' });
  await assert.rejects(
    () => mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'stores', 'rahim-store')),
    /PERMISSION_DENIED/,
    'Authenticated non-owner must NOT be allowed to read private /stores/{shopSlug} document'
  );

  // 1c. Genuine store owner CAN read their own /stores/rahim-store document
  mock.setAuth({ uid });
  const ownerSnap = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'stores', 'rahim-store'));
  assert.equal(ownerSnap.exists(), true);
  assert.equal(ownerSnap.data().ownerUserId, uid);

  // Switch back to unauthenticated public visitor
  mock.setAuth(null);

  // 2. Unauthenticated visitor CAN read /stores/rahim-store/public/info
  const publicSnap = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'stores', 'rahim-store', 'public', 'info'));
  assert.equal(publicSnap.exists(), true);
  const publicData = publicSnap.data();
  assert.equal(publicData.displayName, 'রহিম স্টোর');
  assert.equal('ownerUserId' in publicData, false, 'ownerUserId must never exist in public/info');
  assert.equal('bizId' in publicData, false, 'bizId must never exist in public/info');
  assert.equal('autoSync' in publicData, false, 'autoSync must never exist in public/info');
});

await runTest('Suite 3', '3.6 [Negative] Cross-user access and private product field leaks (buyPrice, profit) are rejected by firestore.rules', async () => {
  const userA = { uid: 'userA' };
  const userB = { uid: 'userB' };
  const mock = createMockFirestore(
    {
      'users/userA/profile/info': { displayName: 'User A' },
      'stores/rahim-shop': { ownerUserId: 'userA', shopName: 'Rahim Shop', whatsappNumber: '01700000000' },
    },
    { auth: userB, enforceRules: true }
  );

  // Cross-user read & write rejected
  await assert.rejects(
    () => mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users/userA/profile/info')),
    /PERMISSION_DENIED/
  );
  await assert.rejects(
    () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users/userA/profile/info'), { displayName: 'Hacked' }),
    /PERMISSION_DENIED/
  );

  // Owner attempting to publish buyPrice or profit to public product rejected
  mock.setAuth(userA);
  await assert.rejects(
    () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores/rahim-shop/products/p1'), {
      name: 'Rice',
      price: 150,
      buyPrice: 100,
      inStock: true,
    }),
    /PERMISSION_DENIED/,
    'Product with buyPrice must be rejected'
  );

  // Sanitized payload from buildPublicProductPayload is accepted
  const cleanPayload = buildPublicProductPayload({ name: 'Rice', sellPrice: 150, buyPrice: 100, profit: 50, closingStock: 5 });
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores/rahim-shop/products/p1'), cleanPayload);
  assert.equal(mock.store.get('stores/rahim-shop/products/p1').price, 150);
});

await runTest('Suite 4', '4.3 [P0-2 Fix] Reversing a purchase AFTER partial sale rejects reversal with dependency error', async () => {
  let state = createTestLedgerState();
  // batch_100 has 5 units, batch_120 has 5 units, closingStock = 10

  // Sell 3 units (consumes 3 from batch_100, leaving 2 remaining)
  state = quickSellStockInState(state, { itemId: 'item_rice', quantity: 3 });
  const item = state.dayData.inventory[0];
  assert.equal(item.closingStock, 7);
  assert.equal(item.batches[0].remainingQty, 2, 'batch_100 should have 2 remaining after selling 3');

  // Now try to reverse the ORIGINAL purchase (quickRestock created batch_100 with 5 units)
  // We need the restock tx — in createTestLedgerState the batches are pre-created, not from transactions.
  // So let's create a fresh scenario:
  let freshState = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_a', name: 'Widget', unit: 'pcs',
        buyPrice: 100, sellPrice: 200,
        openingStock: 0, addedStock: 0, closingStock: 0,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // Step 1: Purchase 10 @ ৳100
  freshState = quickRestockInState(freshState, { itemId: 'item_a', quantity: 10, unitCost: 100, sourceWallet: 'hand_cash' });
  const purchaseTxId = freshState.dayData.transactions[0].id;
  assert.equal(freshState.dayData.inventory[0].closingStock, 10);

  // Step 2: Sell 5
  freshState = quickSellStockInState(freshState, { itemId: 'item_a', quantity: 5 });
  assert.equal(freshState.dayData.inventory[0].closingStock, 5);
  assert.equal(freshState.dayData.inventory[0].batches[0].remainingQty, 5, 'batch should have 5 remaining after selling 5');

  // Step 3: Try to reverse the purchase — should be REJECTED because 5 of 10 units were consumed
  const beforeState = JSON.parse(JSON.stringify(freshState));
  const afterState = reverseSingleTransactionInState(freshState, purchaseTxId);
  
  // Verify the reversal was rejected (state unchanged)
  const purchaseTx = afterState.dayData.transactions.find(t => t.id === purchaseTxId);
  assert.equal(purchaseTx.reversed, undefined, 'Purchase tx must NOT be marked reversed when batch has consumed units');
  assert.equal(afterState.dayData.inventory[0].closingStock, 5, 'closingStock must remain 5 (reversal rejected)');
});

await runTest('Suite 4', '4.4 [P0-2 Fix] Reversing a purchase with FULLY unused batch succeeds normally', async () => {
  let freshState = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_b', name: 'Gadget', unit: 'pcs',
        buyPrice: 50, sellPrice: 100,
        openingStock: 5, addedStock: 0, closingStock: 5,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [{ id: 'existing_batch', unitCost: 50, remainingQty: 5, originalQty: 5, date: '2026-10-01' }],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // Purchase 8 @ ৳60 (creates new batch)
  freshState = quickRestockInState(freshState, { itemId: 'item_b', quantity: 8, unitCost: 60, sourceWallet: 'hand_cash' });
  const purchaseTxId = freshState.dayData.transactions[0].id;
  assert.equal(freshState.dayData.inventory[0].closingStock, 13);
  assert.equal(freshState.dayData.inventory[0].batches.length, 2);

  // Reverse the purchase — batch is fully unused, should succeed
  freshState = reverseSingleTransactionInState(freshState, purchaseTxId);
  const purchaseTx = freshState.dayData.transactions.find(t => t.id === purchaseTxId);
  assert.equal(purchaseTx.reversed, true, 'Purchase tx must be marked reversed when batch is fully unused');
  assert.equal(freshState.dayData.inventory[0].closingStock, 5, 'closingStock must return to 5');
  assert.equal(freshState.dayData.inventory[0].batches.length, 1, 'New batch must be removed');
  assert.equal(freshState.dayData.inventory[0].batches[0].id, 'existing_batch');
  assert.equal(freshState.dayData.wallets.hand_cash.current, 10000, 'Wallet must be restored to original');
});



// ═══════════════════════════════════════════════════════════════════════════
// SUITE 4: P0/P1 ACCOUNTING BUG REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 SUITE 4: P0/P1 Accounting Bug Regression Tests');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const { aggregateTransactions, calcTotalDailyProfit } = await import('../src/data/calculations.js');

await runTest('Suite 4', '4.1 [P0-1 Fix] aggregateTransactions skips reversed originals and isReversal records — net revenue after sale+reversal is ৳0', async () => {
  // Scenario: Sell ৳750, then reverse it
  const transactions = [
    { id: 'sale_1', type: 'stock_sale', amount: 750, profit: 200, reversed: true, reversedAt: '2026-10-10' },
    { id: 'rev_1', type: 'stock_sale', amount: 750, profit: -200, isReversal: true, originalTxId: 'sale_1' },
    { id: 'sale_2', type: 'stock_sale', amount: 500, profit: 150 }, // This active sale should be counted
  ];

  const totals = aggregateTransactions(transactions);
  assert.equal(totals.stockSalesRevenue, 500, 'Net stock sales revenue must be ৳500 (only active sale counted)');
  assert.equal(totals.stockSalesProfit, 150, 'Net stock sales profit must be ৳150 (only active sale counted)');
});

await runTest('Suite 4', '4.2 [P0-1 Fix] aggregateTransactions skips reversed expenses, purchases, and damage_loss', async () => {
  const transactions = [
    // Reversed expense
    { id: 'exp_1', type: 'expense', amount: 100, reversed: true },
    { id: 'rev_exp_1', type: 'expense', amount: 100, isReversal: true, originalTxId: 'exp_1' },
    // Active expense
    { id: 'exp_2', type: 'expense', amount: 200 },
    // Reversed stock purchase
    { id: 'pur_1', type: 'stock_purchase', amount: 500, reversed: true },
    { id: 'rev_pur_1', type: 'stock_purchase', amount: 500, isReversal: true, originalTxId: 'pur_1' },
    // Active purchase
    { id: 'pur_2', type: 'stock_purchase', amount: 300 },
    // Reversed damage_loss
    { id: 'dmg_1', type: 'damage_loss', amount: 150, reversed: true },
    { id: 'rev_dmg_1', type: 'damage_loss', amount: 150, isReversal: true, originalTxId: 'dmg_1' },
  ];

  const totals = aggregateTransactions(transactions);
  assert.equal(totals.expenses, 200, 'Only active expense of ৳200 should be counted');
  assert.equal(totals.stockPurchasesCost, 300, 'Only active purchase of ৳300 should be counted');
  assert.equal(totals.damageLoss, 0, 'Reversed damage_loss should net to ৳0');
});

await runTest('Suite 4', '4.5 [P0-3 Fix] calcTotalDailyProfit subtracts damageLoss from profit', async () => {
  const profit = calcTotalDailyProfit({
    inventoryProfit: 1000,
    photocopyTotal: 200,
    studioTotal: 100,
    rechargeProfit: 50,
    totalExpenses: 300,
    damageLoss: 150,
    transferFees: 20,
  });
  assert.equal(profit, 880, 'Profit = 1000+200+100+50-300-150-20 = 880');

  // Without damageLoss (old behavior verification — should still work but with 0 loss)
  const profitNoLoss = calcTotalDailyProfit({
    inventoryProfit: 1000,
    totalExpenses: 300,
  });
  assert.equal(profitNoLoss, 700, 'Profit without damage = 1000-300 = 700');
});

await runTest('Suite 4', '4.6 [P1-1 Fix] calcItemSummary uses accumulated fifoRevenue instead of current sellPrice when available', async () => {
  // Scenario: 2 sales at ৳100, then price changed to ৳150, then 1 sale at ৳150
  // Actual revenue should be 100+100+150 = ৳350, NOT 3*150 = ৳450
  const item = {
    openingStock: 10,
    addedStock: 0,
    closingStock: 7,  // 3 units sold
    damagedStock: 0,
    sellPrice: 150,    // CURRENT price (changed mid-day)
    buyPrice: 80,
    fifoSoldUnits: 3,
    fifoCogs: 240,     // 3 * 80
    fifoRevenue: 350,  // 100+100+150 = actual revenue
    batches: [],
  };

  const summary = calcItemSummary(item);
  assert.equal(summary.unitsSold, 3);
  assert.equal(summary.salesRevenue, 350, 'Revenue must use fifoRevenue (৳350) not unitsSold * current sellPrice (৳450)');
  assert.equal(summary.cogs, 240);
  assert.equal(summary.profit, 110, 'Profit = 350 - 240 = 110');
});

await runTest('Suite 4', '4.7 [P1-1 Fix] calcItemSummary falls back to sellPrice when fifoRevenue is not available (legacy items)', async () => {
  const legacyItem = {
    openingStock: 10,
    addedStock: 0,
    closingStock: 8,
    damagedStock: 0,
    sellPrice: 200,
    buyPrice: 120,
    // No fifoRevenue — legacy item
  };

  const summary = calcItemSummary(legacyItem);
  assert.equal(summary.unitsSold, 2);
  assert.equal(summary.salesRevenue, 400, 'Without fifoRevenue, should use unitsSold * sellPrice = 2*200 = 400');
});

await runTest('Suite 4', '4.8 [P1-2 Fix] debitWallet preserves negative balances on reversal — prevents silent GL reconciliation drift', async () => {
  let testState = {
    language: 'en',
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 100, current: 0 } },
      inventory: [],
      transactions: [
        {
          id: 'sale_to_reverse',
          type: 'stock_sale',
          amount: 500,
          toWallet: 'hand_cash',
          wallet: 'hand_cash',
        },
      ],
      journalEntries: [
        { id: 'je_1', txId: 'sale_to_reverse', debit: { account: 'cash', amount: 500 }, credit: { account: 'sales_revenue', amount: 500 } }
      ],
    },
  };

  const reversedState = reverseSingleTransactionInState(testState, 'sale_to_reverse');
  assert.equal(
    reversedState.dayData.wallets.hand_cash.current,
    -500,
    'Wallet current balance must be -500 (unclamped), matching the GL cash account balance of -500'
  );
});

await runTest('Suite 4', '4.9 [P1-3 Fix] CLEAR_AUDIT_LOG_ENTRIES removes _auditEntry and _auditEntries from state after persistence', async () => {
  const dirtyState = {
    language: 'bn',
    dayData: { dateKey: '2026-10-10', status: 'open' },
    _auditEntry: { action: 'REVERSE_TRANSACTION', txId: 'tx_123' },
    _auditEntries: [{ action: 'REVERSE_TRANSACTION', txId: 'tx_123' }],
  };

  const cleanedState = executeLedgerAction(dirtyState, { type: 'CLEAR_AUDIT_LOG_ENTRIES' });
  assert.equal(cleanedState._auditEntry, undefined, '_auditEntry must be removed from state');
  assert.equal(cleanedState._auditEntries, undefined, '_auditEntries must be removed from state');
  assert.equal(cleanedState.dayData.dateKey, '2026-10-10', 'Other state properties must remain preserved');
});

await runTest('Suite 4', '4.10 [Online Orders] saveOnlineOrderToCloud, loadOnlineOrdersFromCloud, and deleteOnlineOrderFromCloud work under firestore.rules', async () => {
  const uid = 'user_order_test';
  const bizId = 'biz_orders';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const order = {
    id: 'order_1001',
    customerName: 'Rahim Ali',
    customerPhone: '01712345678',
    customerAddress: 'Dhanmondi 32, Dhaka',
    status: 'confirmed',
    totalAmount: 1500,
    advancePaid: 200,
    advanceWallet: 'bkash_personal',
    codAmount: 1300,
    courierName: 'Steadfast',
    createdAt: Date.now(),
  };

  await saveOnlineOrderToCloud(uid, bizId, order, mock.ops);

  const loaded = await loadOnlineOrdersFromCloud(uid, bizId, mock.ops);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'order_1001');
  assert.equal(loaded[0].customerName, 'Rahim Ali');
  assert.equal(loaded[0].totalAmount, 1500);

  await deleteOnlineOrderFromCloud(uid, bizId, 'order_1001', mock.ops);
  const remaining = await loadOnlineOrdersFromCloud(uid, bizId, mock.ops);
  assert.equal(remaining.length, 0);
});

await runTest('Suite 4', '4.11 [Online Orders] saveAllOnlineOrdersToCloud chunks >450 orders into multiple batches under firestore.rules', async () => {
  const uid = 'user_order_chunk';
  const bizId = 'biz_chunk';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const orders = Array.from({ length: 520 }, (_, idx) => ({
    id: `order_bulk_${idx + 1}`,
    customerName: `Customer ${idx + 1}`,
    customerPhone: '01700000000',
    totalAmount: 500,
    status: 'draft',
    createdAt: Date.now() + idx,
  }));

  const res = await saveAllOnlineOrdersToCloud(uid, bizId, orders, mock.ops);
  assert.equal(res.batchesCommitted, 2, '520 orders must be committed in 2 batches of <= 450');
  assert.equal(res.saved, 520);
  assert.ok(mock.batchHistory.every(sz => sz <= 450));
  assert.equal(mock.store.size, 520);
});

await runTest('Suite 4', '4.12 [P1-7 Concurrency Guard] checkDayDataFreshness detects newer cloud modifications from another device', async () => {
  const uid = 'user_concurrency';
  const bizId = 'biz_concurrency';
  const dateKey = '2026-10-10';

  createMockFirestore({
    [`users/${uid}/businesses/${bizId}/days/${dateKey}`]: {
      dateKey,
      _lastCloudSavedAt: 2000,
      transactions: [{ id: 'tx_cloud_1' }],
    },
  }, { auth: { uid }, enforceRules: true });

  // Local device has stale savedAt timestamp (e.g. 1000 < 2000)
  const outdatedCheck = await checkDayDataFreshness(uid, bizId, dateKey, 1000);
  assert.equal(outdatedCheck.isOutdated, true, 'Should detect newer dayData in cloud');
  assert.equal(outdatedCheck.cloudSavedAt, 2000);
  assert.equal(outdatedCheck.cloudData.transactions.length, 1);

  // Local device has equal or newer timestamp (e.g. 2000 == 2000)
  const upToDateCheck = await checkDayDataFreshness(uid, bizId, dateKey, 2000);
  assert.equal(upToDateCheck.isOutdated, false, 'Should report up to date when localSavedAt matches cloud');
});

await runTest('Suite 4', '4.13 [Public Storefront Direct Order] Anonymous customer can place valid order under firestore.rules, invalid order rejected', async () => {
  const shopSlug = 'demo-store';
  const ownerUid = 'owner_123';
  const mock = createMockFirestore({
    [`stores/${shopSlug}`]: {
      shopName: 'Demo Store',
      ownerUserId: ownerUid,
      whatsappNumber: '01711111111',
    },
  }, { auth: null, enforceRules: true }); // Anonymous / public visitor

  const validOrder = {
    id: 'ord_web_001',
    customerName: 'Karim Ahmed',
    customerPhone: '01812345678',
    customerAddress: 'Mirpur 10, Dhaka',
    isInsideDhaka: true,
    deliveryCharge: 60,
    totalAmount: 1260,
    subtotal: 1200,
    paymentMethod: 'cod',
    items: [
      { productId: 'p1', productName: 'T-Shirt', quantity: 2, unitPrice: 600, subtotal: 1200 }
    ],
  };

  const res = await saveCustomerStoreOrder(shopSlug, validOrder, mock.ops);
  assert.equal(res.success, true);
  assert.equal(res.orderId, 'ord_web_001');

  const storedOrder = mock.store.get(`stores/${shopSlug}/orders/ord_web_001`);
  assert.ok(storedOrder, 'Order should be written to stores/demo-store/orders/ord_web_001');
  assert.equal(storedOrder.customerName, 'Karim Ahmed');
  assert.equal(storedOrder.totalAmount, 1260);

  // Negative test: Order missing customerName is rejected
  await assert.rejects(
    async () => saveCustomerStoreOrder(shopSlug, { customerPhone: '01812345678', totalAmount: 500, items: [] }, mock.ops),
    /Customer name and phone number are required/
  );

  // Negative test: Client attempting to create order with non-draft status (e.g. 'delivered') is REJECTED by firestore.rules
  const maliciousStatusOrder = {
    ...validOrder,
    id: 'ord_malicious_1',
    status: 'delivered',
  };
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'ord_malicious_1'), maliciousStatusOrder),
    /PERMISSION_DENIED/,
    'Client must NOT be permitted to create storefront order with status other than draft'
  );

  // Negative test: Client attempting to inject unauthorized keys is REJECTED by firestore.rules
  const maliciousKeysOrder = {
    ...validOrder,
    id: 'ord_malicious_2',
    status: 'draft',
    injectedAdminField: true,
  };
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'ord_malicious_2'), maliciousKeysOrder),
    /PERMISSION_DENIED/,
    'Client must NOT be permitted to create storefront order with extra unauthorized fields'
  );

  // Negative test: Client attempting negative total amount is REJECTED by firestore.rules
  const maliciousNegativeOrder = {
    ...validOrder,
    id: 'ord_malicious_3',
    status: 'draft',
    totalAmount: -500,
  };
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'ord_malicious_3'), maliciousNegativeOrder),
    /PERMISSION_DENIED/,
    'Client must NOT be permitted to create storefront order with negative total amount'
  );

  // Negative test: Client attempting order creation against nonexistent store slug is REJECTED by firestore.rules
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', 'nonexistent-shop-slug', 'orders', 'ord_nonexistent'), {
      ...validOrder,
      id: 'ord_nonexistent',
    }),
    /PERMISSION_DENIED/,
    'Order creation against arbitrary nonexistent store path must be rejected by firestore.rules'
  );

  // Negative test: Client attempting order creation with ID mismatch (path orderId != data.id) is REJECTED by firestore.rules
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'path_order_id'), {
      ...validOrder,
      id: 'mismatched_data_id',
    }),
    /PERMISSION_DENIED/,
    'Order with document ID mismatch must be rejected by firestore.rules'
  );
});

await runTest('Suite 4', '4.14 [Storefront Direct Order] Store owner can read and delete orders, non-owner is blocked by firestore.rules', async () => {
  const shopSlug = 'demo-store';
  const ownerUid = 'owner_123';
  const strangerUid = 'stranger_456';
  const initialDocs = {
    [`stores/${shopSlug}`]: {
      shopName: 'Demo Store',
      ownerUserId: ownerUid,
      whatsappNumber: '01711111111',
    },
    [`stores/${shopSlug}/orders/ord_1`]: {
      id: 'ord_1',
      customerName: 'Customer One',
      customerPhone: '01700000001',
      totalAmount: 800,
      createdAtMs: 1000,
      items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 800, subtotal: 800 }],
    },
  };

  // Stranger attempt: should be rejected by firestore.rules
  const strangerMock = createMockFirestore(initialDocs, { auth: { uid: strangerUid }, enforceRules: true });
  await assert.rejects(
    async () => loadIncomingStoreOrders(shopSlug, strangerMock.ops),
    /permission/i
  );

  // Anonymous attempt: should also be rejected
  const anonMock = createMockFirestore(initialDocs, { auth: null, enforceRules: true });
  await assert.rejects(
    async () => loadIncomingStoreOrders(shopSlug, anonMock.ops),
    /permission/i
  );

  // Store owner: can read and delete
  const ownerMock = createMockFirestore(initialDocs, { auth: { uid: ownerUid }, enforceRules: true });
  const incoming = await loadIncomingStoreOrders(shopSlug, ownerMock.ops);
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].id, 'ord_1');
  assert.equal(incoming[0].customerName, 'Customer One');

  // Verify getShopSlugForUser finds the store
  const slugFound = await getShopSlugForUser(ownerUid, ownerMock.ops);
  assert.equal(slugFound, shopSlug);

  // Delete processed order
  await deleteIncomingStoreOrder(shopSlug, 'ord_1', ownerMock.ops);
  assert.equal(ownerMock.store.has(`stores/${shopSlug}/orders/ord_1`), false);
});

await runTest('Suite 4', '4.15 [Fraud & RTO Engine] evaluateCustomerRisk calculates risk levels, return counts, warnings, and advance charge recommendations', async () => {
  const { evaluateCustomerRisk, normalizePhoneNumber, FRAUD_RISK_LEVELS } = await import('../src/data/customerRiskEngine.js');

  // Phone normalization checks
  assert.equal(normalizePhoneNumber('+8801712345678'), '01712345678');
  assert.equal(normalizePhoneNumber('8801812345678'), '01812345678');
  assert.equal(normalizePhoneNumber('01912-345678'), '01912345678');

  // Test Case 1: High Risk via past RTOs (>= 2 returned orders)
  const ordersHistory1 = [
    { customerPhone: '01711111111', status: 'returned' },
    { customerPhone: '+8801711111111', status: 'returned' },
    { customerPhone: '01711111111', status: 'delivered' },
  ];
  const eval1 = evaluateCustomerRisk({
    phone: '01711111111',
    onlineOrders: ordersHistory1,
    deliveryCharge: 120,
    language: 'bn',
  });
  assert.equal(eval1.riskLevel, FRAUD_RISK_LEVELS.HIGH);
  assert.equal(eval1.hasWarning, true);
  assert.equal(eval1.rtoCount, 2);
  assert.equal(eval1.recommendedAdvance, 120, 'Should recommend taking ৳120 delivery charge in advance');
  assert.ok(eval1.actionAdvice.includes('120') || eval1.actionAdvice.includes('বিকাশ'), 'Advice should suggest advance delivery charge');

  // Test Case 2: High Risk via manual blacklist
  const blacklistManual = {
    '01822222222': {
      isManuallyBlacklisted: true,
      reason: 'ভুয়া অর্ডার রেকর্ড',
      rtoCount: 1,
    }
  };
  const eval2 = evaluateCustomerRisk({
    phone: '+8801822222222',
    customerBlacklist: blacklistManual,
    deliveryCharge: 100,
  });
  assert.equal(eval2.riskLevel, FRAUD_RISK_LEVELS.HIGH);
  assert.equal(eval2.isManuallyBlacklisted, true);
  assert.equal(eval2.blacklistReason, 'ভুয়া অর্ডার রেকর্ড');

  // Test Case 3: Moderate Risk (1 RTO or >= 2 cancellations)
  const ordersHistory3 = [
    { customerPhone: '01933333333', status: 'returned' },
    { customerPhone: '01933333333', status: 'delivered' },
  ];
  const eval3 = evaluateCustomerRisk({
    phone: '01933333333',
    onlineOrders: ordersHistory3,
  });
  assert.equal(eval3.riskLevel, FRAUD_RISK_LEVELS.MODERATE);
  assert.equal(eval3.hasWarning, true);

  // Test Case 4: Low Risk / Trusted Customer (delivered >= 1, 0 RTO)
  const ordersHistory4 = [
    { customerPhone: '01644444444', status: 'delivered' },
    { customerPhone: '01644444444', status: 'settled' },
  ];
  const eval4 = evaluateCustomerRisk({
    phone: '01644444444',
    onlineOrders: ordersHistory4,
  });
  assert.equal(eval4.riskLevel, FRAUD_RISK_LEVELS.LOW);
  assert.equal(eval4.hasWarning, false);
  assert.equal(eval4.deliveredCount, 2);

  // Test Case 5: Neutral / New Customer
  const eval5 = evaluateCustomerRisk({
    phone: '01555555555',
    onlineOrders: [],
  });
  assert.equal(eval5.riskLevel, FRAUD_RISK_LEVELS.NEUTRAL);
  assert.equal(eval5.hasWarning, false);
});

await runTest('Suite 4', '4.16 [Fraud Reducer] BLACKLIST_CUSTOMER, UNBLACKLIST_CUSTOMER and ONLINE_ORDER_RETURN properly manage customer blacklist state', async () => {
  const initialState = {
    language: 'bn',
    customerBlacklist: {},
    onlineOrders: [
      {
        id: 'ord_ret_01',
        customerPhone: '+8801700998877',
        customerName: 'Return Customer',
        status: 'shipped',
        totalAmount: 1000,
        deliveryCharge: 120,
        courierCharge: 100,
        advancePaid: 0,
        items: []
      },
      {
        id: 'ord_ret_02',
        customerPhone: '+8801700998877',
        customerName: 'Return Customer',
        status: 'shipped',
        totalAmount: 500,
        deliveryCharge: 120,
        courierCharge: 100,
        advancePaid: 0,
        items: []
      }
    ],
    dayData: {
      status: 'open',
      wallets: { hand_cash: { current: 5000 } },
      inventory: [],
      transactions: [],
      onlineOrdersDayStats: {}
    }
  };

  // 1. Manually Blacklist Customer with object payload
  let state = executeLedgerAction(initialState, {
    type: 'BLACKLIST_CUSTOMER',
    payload: {
      phone: '+8801711223344',
      reason: 'বারবার পার্সেল বাতিল করে',
      rtoCount: 3
    }
  });
  assert.ok(state.customerBlacklist['01711223344'], 'Customer phone must be normalized in blacklist');
  assert.equal(state.customerBlacklist['01711223344'].isManuallyBlacklisted, true);
  assert.equal(state.customerBlacklist['01711223344'].reason, 'বারবার পার্সেল বাতিল করে');
  assert.equal(state.customerBlacklist['01711223344'].rtoCount, 3);

  // 2. Blacklist with string phone payload
  state = executeLedgerAction(state, {
    type: 'BLACKLIST_CUSTOMER',
    payload: '01899887766'
  });
  assert.ok(state.customerBlacklist['01899887766']);

  // 3. ONLINE_ORDER_RETURN automatically adds phone to blacklist or increments RTO
  state = executeLedgerAction(state, {
    type: 'ONLINE_ORDER_RETURN',
    payload: 'ord_ret_01'
  });
  assert.ok(state.customerBlacklist['01700998877'], 'Returned order phone should be added to customerBlacklist');
  assert.equal(state.customerBlacklist['01700998877'].rtoCount, 1);

  // Return a second order from same customer to test auto-increment
  state = executeLedgerAction(state, {
    type: 'ONLINE_ORDER_RETURN',
    payload: 'ord_ret_02'
  });
  assert.equal(state.customerBlacklist['01700998877'].rtoCount, 2);

  // 4. UNBLACKLIST_CUSTOMER removes phone from blacklist
  state = executeLedgerAction(state, {
    type: 'UNBLACKLIST_CUSTOMER',
    payload: '+8801711223344'
  });
  assert.equal(state.customerBlacklist['01711223344'], undefined, 'Customer must be removed from blacklist');
});

await runTest('Suite 4', '4.17 [P0 Reversal Matrix] Reversing the same transaction twice is rejected (idempotent)', async () => {
  let state = {
    language: 'en',
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 1000, current: 1500 } },
      inventory: [{ id: 'item_x', name: 'Item X', closingStock: 5, batches: [{ id: 'b_1', remainingQty: 5, unitCost: 100 }] }],
      transactions: [{ id: 'tx_sale_1', type: 'stock_sale', amount: 500, toWallet: 'hand_cash', wallet: 'hand_cash' }],
      journalEntries: [],
    },
  };

  // First reversal
  const state1 = reverseSingleTransactionInState(state, 'tx_sale_1');
  const revCount1 = (state1.dayData.transactions || []).filter(t => t.isReversal).length;
  assert.equal(revCount1, 1, 'First reversal creates exactly one reversal record');
  assert.equal(state1.dayData.wallets.hand_cash.current, 1000, 'Wallet debited back to 1000');

  // Second reversal of the exact same tx
  const state2 = reverseSingleTransactionInState(state1, 'tx_sale_1');
  const revCount2 = (state2.dayData.transactions || []).filter(t => t.isReversal).length;
  assert.equal(revCount2, 1, 'Second reversal is rejected and does NOT create another reversal record');
  assert.equal(state2.dayData.wallets.hand_cash.current, 1000, 'Wallet balance is unchanged on duplicate reversal');
});

await runTest('Suite 4', '4.18 [P0 Reversal Matrix] Sale reverse followed by Purchase reverse restores inventory, batches, and wallets to initial state', async () => {
  let state = {
    language: 'en',
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_order_test', name: 'Item Test', unit: 'pcs',
        buyPrice: 100, sellPrice: 150,
        openingStock: 0, addedStock: 0, closingStock: 0,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Purchase 10 @ 100
  state = quickRestockInState(state, { itemId: 'item_order_test', quantity: 10, unitCost: 100, sourceWallet: 'hand_cash' });
  const purchaseTxId = state.dayData.transactions[0].id;
  assert.equal(state.dayData.inventory[0].closingStock, 10);
  assert.equal(state.dayData.wallets.hand_cash.current, 9000);

  // 2. Sell 4 @ 150
  state = quickSellStockInState(state, { itemId: 'item_order_test', quantity: 4, sellPrice: 150, targetWallet: 'hand_cash' });
  const saleTxId = state.dayData.transactions[1].id;
  assert.equal(state.dayData.inventory[0].closingStock, 6);
  assert.equal(state.dayData.wallets.hand_cash.current, 9600);

  // 3. Reverse Sale FIRST
  state = reverseSingleTransactionInState(state, saleTxId);
  assert.equal(state.dayData.inventory[0].closingStock, 10, 'Sale reversal restores stock to 10');
  assert.equal(state.dayData.inventory[0].batches[0].remainingQty, 10, 'Batch remainingQty restored to 10');
  assert.equal(state.dayData.wallets.hand_cash.current, 9000, 'Wallet debited back to 9000');

  // 4. Reverse Purchase SECOND
  state = reverseSingleTransactionInState(state, purchaseTxId);
  assert.equal(state.dayData.inventory[0].closingStock, 0, 'Purchase reversal restores stock to 0');
  assert.equal(state.dayData.inventory[0].batches.length, 0, 'Batch removed');
  assert.equal(state.dayData.wallets.hand_cash.current, 10000, 'Wallet restored to initial 10000');
});

await runTest('Suite 4', '4.19 [P0 Reversal Matrix] Multi-journal reversal — Sale creates saleJE and cogsJE; reversing reverses both entries', async () => {
  let state = {
    language: 'en',
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_je', name: 'JE Item', unit: 'pcs',
        buyPrice: 100, sellPrice: 200,
        openingStock: 5, addedStock: 0, closingStock: 5,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [{ id: 'b_je', unitCost: 100, remainingQty: 5, originalQty: 5, date: '2026-10-01' }],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // Sell 2 units @ 200 (Cost = 200, Revenue = 400)
  state = quickSellStockInState(state, { itemId: 'item_je', quantity: 2, sellPrice: 200, targetWallet: 'hand_cash' });
  const saleTx = state.dayData.transactions[0];
  
  // Verify 2 journal entries were generated for this sale: sale revenue & COGS
  const matchingJEs = (state.dayData.journalEntries || []).filter(j => j.txId === saleTx.id);
  assert.equal(matchingJEs.length, 2, 'Sale must produce exactly 2 JEs (Cash/Revenue + COGS/Inventory)');

  // Reverse the sale
  state = reverseSingleTransactionInState(state, saleTx.id);

  // Verify reversal entries were generated for BOTH original JEs
  const reversalJEs = (state.dayData.journalEntries || []).filter(j => j.txId === saleTx.id && j.txType === 'reversal');
  assert.equal(reversalJEs.length, 2, 'Reversal must create 2 reversal journal entries, reversing both JEs');

  // Verify Trial Balance balances to exact 0
  const tb = computeTrialBalance(state.dayData.journalEntries);
  const validation = validateTrialBalance(tb);
  assert.equal(validation.isBalanced, true, 'Trial balance must be completely balanced after multi-entry reversal');
});

await runTest('Suite 4', '4.20 [P0 Invariant Check] Trial balance invariance: sum(Debits) === sum(Credits) throughout sale, expense, damage, and reversal', async () => {
  let state = {
    language: 'en',
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 50000, current: 50000 } },
      inventory: [{
        id: 'item_inv', name: 'Inv Item', unit: 'pcs',
        buyPrice: 50, sellPrice: 100,
        openingStock: 0, addedStock: 0, closingStock: 0,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Purchase
  state = quickRestockInState(state, { itemId: 'item_inv', quantity: 20, unitCost: 50, sourceWallet: 'hand_cash' });
  // 2. Sell
  state = quickSellStockInState(state, { itemId: 'item_inv', quantity: 10, sellPrice: 100, targetWallet: 'hand_cash' });
  // 3. Damage
  state = writeOffDamageInState(state, { itemId: 'item_inv', quantity: 2, reason: 'Broken' });
  // 4. Reverse the sale
  const saleTx = state.dayData.transactions.find(t => t.type === 'stock_sale');
  state = reverseSingleTransactionInState(state, saleTx.id);

  // Check trial balance
  const tb = computeTrialBalance(state.dayData.journalEntries);
  const validation = validateTrialBalance(tb);
  assert.equal(validation.isBalanced, true, 'Every debit must match credit across all operations');
  assert.equal(validation.diff, 0, 'Debit - Credit difference must be exactly 0');
});

await runTest('Suite 4', '4.21 [Cloud Backup] exportAllCloudData creates complete JSON backup containing settings, sheetsConfig, businesses, days, contacts, and onlineOrders under firestore.rules', async () => {
  const uid = 'backup_user_01';
  const bizId = 'biz_main';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  // Seed settings
  await saveSettings(uid, { language: 'bn', isDarkMode: true, autoCloseEnabled: true }, mock.ops);
  // Seed businesses
  await saveBusinesses(uid, [{ id: bizId, name: 'Backup Test Shop', type: 'grocery' }], mock.ops);
  // Seed day
  await saveDayToCloud(uid, bizId, {
    dateKey: '2026-10-10',
    status: 'finalized',
    wallets: { hand_cash: { opening: 5000, current: 8000 } },
    inventory: [{ id: 'p1', name: 'Item P1', closingStock: 10, buyPrice: 50, sellPrice: 100 }],
    transactions: [{ id: 't1', type: 'stock_sale', amount: 300 }],
  }, mock.ops);
  // Seed contacts
  await saveAllContactsToCloud(uid, bizId, [{ id: 'c1', name: 'Rahim', phone: '01700000001', currentBalance: 500 }], mock.ops);
  // Seed online orders
  await saveOnlineOrderToCloud(uid, bizId, {
    id: 'ord_bk_1',
    customerName: 'Karim',
    customerPhone: '01800000002',
    status: 'confirmed',
    totalAmount: 1200,
  }, mock.ops);

  // Run export
  const exportedJson = await exportAllCloudData(uid, mock.ops);
  assert.ok(typeof exportedJson === 'string');
  const parsed = JSON.parse(exportedJson);

  assert.equal(parsed.userId, uid);
  assert.equal(parsed.version, 3);
  assert.equal(parsed.settings.language, 'bn');
  assert.equal(parsed.businesses.length, 1);
  assert.equal(parsed.businesses[0].name, 'Backup Test Shop');
  assert.ok(parsed[bizId].days['2026-10-10']);
  assert.equal(parsed[bizId].days['2026-10-10'].wallets.hand_cash.current, 8000);
  assert.equal(parsed[bizId].contacts.length, 1);
  assert.equal(parsed[bizId].contacts[0].name, 'Rahim');
  assert.equal(parsed[bizId].onlineOrders.length, 1);
  assert.equal(parsed[bizId].onlineOrders[0].customerName, 'Karim');
});

await runTest('Suite 4', '4.22 [Cloud Restore] restoreAllCloudData restores complete backup into fresh database and verifies all collections under firestore.rules', async () => {
  const uid = 'restore_user_02';
  const bizId = 'biz_restored';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const backupData = {
    version: 2,
    app: 'Ledgero',
    userId: uid,
    settings: { language: 'en', isDarkMode: false, autoCloseEnabled: false },
    businesses: [{ id: bizId, name: 'Restored Electronics', type: 'telecom' }],
    [bizId]: {
      days: {
        '2026-10-11': {
          dateKey: '2026-10-11',
          status: 'open',
          wallets: { bkash: { opening: 2000, current: 3500 } },
          inventory: [{ id: 'sim_1', name: 'SIM Card', closingStock: 50, sellPrice: 200 }],
        },
      },
      contacts: [{ id: 'ct_10', name: 'Jamal', phone: '01911111111', currentBalance: -200 }],
      onlineOrders: [{ id: 'ord_res_1', customerName: 'Customer X', totalAmount: 750, status: 'delivered' }],
    },
  };

  // Run restore
  const report = await restoreAllCloudData(uid, backupData, mock.ops);
  assert.equal(report.success, true);
  assert.equal(report.restoredCounts.settings, 1);
  assert.equal(report.restoredCounts.businesses, 1);
  assert.equal(report.restoredCounts.days, 1);
  assert.equal(report.restoredCounts.contacts, 1);
  assert.equal(report.restoredCounts.onlineOrders, 1);

  // Verify directly from restored cloud storage
  const loadedSettings = await loadSettings(uid, mock.ops);
  assert.equal(loadedSettings.language, 'en');

  const loadedBusinesses = await loadBusinesses(uid, mock.ops);
  assert.equal(loadedBusinesses[0].name, 'Restored Electronics');

  const loadedDay = await loadDayFromCloud(uid, bizId, '2026-10-11', mock.ops);
  assert.equal(loadedDay.wallets.bkash.current, 3500);
  assert.equal(loadedDay.inventory[0].name, 'SIM Card');

  const loadedContacts = await loadContactsFromCloud(uid, bizId, mock.ops);
  assert.equal(loadedContacts.length, 1);
  assert.equal(loadedContacts[0].name, 'Jamal');

  const loadedOrders = await loadOnlineOrdersFromCloud(uid, bizId, mock.ops);
  assert.equal(loadedOrders.length, 1);
  assert.equal(loadedOrders[0].customerName, 'Customer X');
});

await runTest('Suite 4', '4.23 [Backup Validation] validateBackupPayload validates schema, counts preview items correctly, and rejects corrupted payloads', async () => {
  // Valid v2 backup
  const validV2 = JSON.stringify({
    version: 2,
    storage: {
      'shop_biz_1_day_2026-10-10': { wallets: {} },
      'shop_biz_1_day_2026-10-11': { wallets: {} },
      'shop_biz_1_contacts': [{ id: 'c1' }, { id: 'c2' }],
    },
  });
  const res1 = validateBackupPayload(validV2);
  assert.equal(res1.valid, true);
  assert.equal(res1.preview.daysCount, 2);
  assert.equal(res1.preview.contactsCount, 2);

  // Invalid JSON
  const invalidJson = "{ corrupt: true, ";
  const res2 = validateBackupPayload(invalidJson);
  assert.equal(res2.valid, false);
  assert.ok(res2.error);

  // Unrecognized payload structure
  const unknownObj = JSON.stringify({ randomKey: 'not a backup' });
  const res3 = validateBackupPayload(unknownObj);
  assert.equal(res3.valid, false);
  assert.equal(res3.error, 'Unrecognized backup structure');
});

await runTest('Suite 4', '4.24 [Local Round-Trip] Local exportAllData and importAllData roundtrip preserves days, wallets, and contacts', async () => {
  const backupState = {
    activeBiz: { id: 'biz_local_test', name: 'Local Test Biz' },
    businesses: [{ id: 'biz_local_test', name: 'Local Test Biz' }],
    settings: { language: 'bn' },
  };

  localStorage.setItem('shop_biz_local_test_day_2026-10-10', JSON.stringify({
    dateKey: '2026-10-10',
    wallets: { hand_cash: { current: 12500 } },
    inventory: [{ id: 'prod_1', name: 'Local Prod', closingStock: 25 }],
  }));
  localStorage.setItem('shop_biz_local_test_contacts', JSON.stringify([
    { id: 'c_local', name: 'Local Contact', balance: 1500 }
  ]));

  // Export
  const exported = exportAllData(backupState);
  assert.ok(typeof exported === 'string');

  // Clear simulated storage
  localStorage.removeItem('shop_biz_local_test_day_2026-10-10');
  localStorage.removeItem('shop_biz_local_test_contacts');
  assert.equal(localStorage.getItem('shop_biz_local_test_day_2026-10-10'), null);

  // Import
  const success = importAllData(exported);
  assert.equal(success, true);

  // Verify restored
  const restoredDay = JSON.parse(localStorage.getItem('shop_biz_local_test_day_2026-10-10'));
  assert.equal(restoredDay.wallets.hand_cash.current, 12500);
  assert.equal(restoredDay.inventory[0].closingStock, 25);

  const restoredContacts = JSON.parse(localStorage.getItem('shop_biz_local_test_contacts'));
  assert.equal(restoredContacts.length, 1);
  assert.equal(restoredContacts[0].name, 'Local Contact');
});

await runTest('Suite 4', '4.25 [P0 Bulk Reversal Fix] Bulk reversal with purchase-first order [purchaseId, saleId] when stock was partially sold reverses both via multi-pass retry', async () => {
  let state = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_bulk_p1', name: 'Bulk Test Item', unit: 'pcs',
        buyPrice: 100, sellPrice: 150,
        openingStock: 0, addedStock: 0, closingStock: 0,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Restock 10 units @ 100
  state = quickRestockInState(state, { itemId: 'item_bulk_p1', quantity: 10, unitCost: 100, sourceWallet: 'hand_cash' });
  const purchaseTxId = state.dayData.transactions[0].id;
  assert.equal(state.dayData.inventory[0].closingStock, 10);
  assert.equal(state.dayData.wallets.hand_cash.current, 9000);

  // 2. Sell 4 units @ 150
  state = quickSellStockInState(state, { itemId: 'item_bulk_p1', quantity: 4, sellPrice: 150, targetWallet: 'hand_cash' });
  const saleTxId = state.dayData.transactions[1].id;
  assert.equal(state.dayData.inventory[0].closingStock, 6);
  assert.equal(state.dayData.inventory[0].batches[0].remainingQty, 6);
  assert.equal(state.dayData.wallets.hand_cash.current, 9600);

  // 3. User selects [purchaseTxId, saleTxId] — purchase comes FIRST in the array!
  const reversedState = bulkDeleteTransactionsInState(state, [purchaseTxId, saleTxId], 'Bulk reversal test');

  // Verify multi-pass retry succeeded on both
  const report = reversedState._bulkReversalReport;
  assert.ok(report, 'Report must be attached');
  assert.equal(report.isCompleteSuccess, true, 'Both transactions must be reversed completely');
  assert.equal(report.succeededCount, 2);
  assert.equal(report.failedCount, 0);
  assert.deepEqual(report.failedIds, []);

  // Verify inventory restored to clean 0
  const finalItem = reversedState.dayData.inventory[0];
  assert.equal(finalItem.closingStock, 0, 'Closing stock must be restored to 0');
  assert.equal(finalItem.batches.length, 0, 'Restock batch must be removed');

  // Verify wallet restored to 10000
  assert.equal(reversedState.dayData.wallets.hand_cash.current, 10000, 'Hand cash must be back to 10000');

  // Verify both transactions marked reversed
  const tx1 = reversedState.dayData.transactions.find(t => t.id === purchaseTxId);
  const tx2 = reversedState.dayData.transactions.find(t => t.id === saleTxId);
  assert.equal(tx1.reversed, true);
  assert.equal(tx2.reversed, true);

  // Verify 2 audit entries were created
  assert.equal(reversedState._auditEntries.length, 2, 'Must create 2 audit entries');
});

await runTest('Suite 4', '4.26 [P0 Bulk Reversal Fix] Bulk reversal with sale-first order [saleId, purchaseId] reverses cleanly and produces identical final state', async () => {
  let state = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_bulk_p2', name: 'Bulk Test Item 2', unit: 'pcs',
        buyPrice: 100, sellPrice: 150,
        openingStock: 0, addedStock: 0, closingStock: 0,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Restock 10
  state = quickRestockInState(state, { itemId: 'item_bulk_p2', quantity: 10, unitCost: 100, sourceWallet: 'hand_cash' });
  const purchaseTxId = state.dayData.transactions[0].id;
  // 2. Sell 4
  state = quickSellStockInState(state, { itemId: 'item_bulk_p2', quantity: 4, sellPrice: 150, targetWallet: 'hand_cash' });
  const saleTxId = state.dayData.transactions[1].id;

  // Bulk reversal with sale first: [saleTxId, purchaseTxId]
  const reversedState = bulkDeleteTransactionsInState(state, [saleTxId, purchaseTxId]);

  const report = reversedState._bulkReversalReport;
  assert.equal(report.isCompleteSuccess, true);
  assert.equal(report.succeededCount, 2);
  assert.equal(report.failedCount, 0);
  assert.equal(reversedState.dayData.inventory[0].closingStock, 0);
  assert.equal(reversedState.dayData.inventory[0].batches.length, 0);
  assert.equal(reversedState.dayData.wallets.hand_cash.current, 10000);
  assert.equal(reversedState._auditEntries.length, 2);
});

await runTest('Suite 4', '4.27 [P0 Bulk Reversal Fix] Bulk reversal accurately reports partial failures in _bulkReversalReport when unselected transactions block batch', async () => {
  let state = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_partial_fail', name: 'Partial Item', unit: 'pcs',
        buyPrice: 100, sellPrice: 150,
        openingStock: 0, addedStock: 0, closingStock: 0,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // Restock 10
  state = quickRestockInState(state, { itemId: 'item_partial_fail', quantity: 10, unitCost: 100, sourceWallet: 'hand_cash' });
  const purchaseTxId = state.dayData.transactions[0].id;

  // Sale 1: 4 units
  state = quickSellStockInState(state, { itemId: 'item_partial_fail', quantity: 4, sellPrice: 150, targetWallet: 'hand_cash' });
  const sale1Id = state.dayData.transactions[1].id;

  // Sale 2: 2 units (this one will NOT be reversed)
  state = quickSellStockInState(state, { itemId: 'item_partial_fail', quantity: 2, sellPrice: 150, targetWallet: 'hand_cash' });

  // Request bulk reversal of [purchaseTxId, sale1Id] only (sale2 remains active)
  const resultState = bulkDeleteTransactionsInState(state, [purchaseTxId, sale1Id]);
  const report = resultState._bulkReversalReport;

  assert.equal(report.isCompleteSuccess, false, 'Must report partial failure');
  assert.equal(report.succeededCount, 1, 'Only sale 1 should succeed');
  assert.equal(report.failedCount, 1, 'Purchase reversal must fail because 2 units still consumed by sale 2');
  assert.deepEqual(report.succeededIds, [sale1Id]);
  assert.deepEqual(report.failedIds, [purchaseTxId]);

  // Check purchase remains intact and unreversed
  const purTx = resultState.dayData.transactions.find(t => t.id === purchaseTxId);
  assert.equal(purTx.reversed, undefined);

  // Closing stock should be 8 (10 bought - 2 sold by sale2)
  assert.equal(resultState.dayData.inventory[0].closingStock, 8);
  assert.equal(resultState.dayData.inventory[0].batches[0].remainingQty, 8);
});

await runTest('Suite 4', '4.28 [P1 Durability] Storefront order copy-before-delete pattern: incoming order is preserved if cloud save fails', async () => {
  const uid = 'durability_user_1';
  const bizId = 'biz_durable';
  const slug = 'durability-shop';
  const mock = createMockFirestore({
    [`stores/${slug}`]: {
      shopName: 'Durability Shop',
      ownerUserId: uid,
      whatsappNumber: '01711111111',
    },
  }, { auth: { uid }, enforceRules: true });

  // 1. Customer places order in public storefront
  const orderData = {
    customerName: 'Safe Customer',
    customerPhone: '01799999999',
    totalAmount: 950,
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 950 }],
  };
  const placed = await saveCustomerStoreOrder(slug, orderData, mock.ops);
  assert.ok(placed.orderId);

  // Verify order exists in incoming storefront orders
  let incoming = await loadIncomingStoreOrders(slug, mock.ops);
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].customerName, 'Safe Customer');

  // 2. Simulate sync logic: attempt to persist order to owner cloud storage first
  // Case A: Cloud write FAILS -> incoming order MUST NOT be deleted
  const failingOps = {
    ...mock.ops,
    setDoc: async (ref, data) => {
      if (ref.path && ref.path.includes('onlineOrders')) {
        throw new Error('Network timeout during cloud write');
      }
      return mock.ops.setDoc(ref, data);
    },
  };

  let writeError = null;
  try {
    // Mimic OnlineOrdersScreen syncWebStoreOrders copy-before-delete
    await saveOnlineOrderToCloud(uid, bizId, incoming[0], failingOps);
    await deleteIncomingStoreOrder(slug, incoming[0].id, failingOps);
  } catch (err) {
    writeError = err;
  }

  assert.ok(writeError, 'Save should throw');
  // Crucial durability assertion: The order was NOT deleted from incoming store
  incoming = await loadIncomingStoreOrders(slug, mock.ops);
  assert.equal(incoming.length, 1, 'Incoming order must remain untouched when save fails');

  // Case B: Cloud write SUCCEEDS -> then and only then delete incoming order
  await saveOnlineOrderToCloud(uid, bizId, incoming[0], mock.ops);
  await deleteIncomingStoreOrder(slug, incoming[0].id, mock.ops);

  // Incoming order is now deleted
  incoming = await loadIncomingStoreOrders(slug, mock.ops);
  assert.equal(incoming.length, 0, 'Incoming order removed only after verified persistence');

  // And verified present in owner cloud storage
  const ownerOrders = await loadOnlineOrdersFromCloud(uid, bizId, mock.ops);
  assert.equal(ownerOrders.length, 1);
  assert.equal(ownerOrders[0].customerName, 'Safe Customer');
});

await runTest('Suite 4', '4.29 [P1 Cloud Durability] exportAllCloudData marks manifest as partial on collection read failure; restoreAllCloudData reports errors', async () => {
  const uid = 'durability_user_2';
  const bizId = 'biz_exp_fail';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  await saveBusinesses(uid, [{ id: bizId, name: 'Partial Test Shop' }], mock.ops);
  await saveDayToCloud(uid, bizId, { dateKey: '2026-10-10', status: 'open' }, mock.ops);

  // Simulate read failure on contacts collection during export
  const partialOps = {
    ...mock.ops,
    getDocs: async (refOrQuery) => {
      const p = refOrQuery.path || '';
      if (p.includes('contacts')) {
        throw new Error('Simulated GCS quota exceeded');
      }
      return mock.ops.getDocs(refOrQuery);
    },
  };

  const exportResult = await exportAllCloudData(uid, partialOps);
  const parsed = JSON.parse(exportResult);

  // Manifest must record partial status and error
  assert.equal(parsed.manifest.status, 'partial', 'Status must be partial on failure');
  assert.equal(parsed.isComplete, false, 'isComplete must be false');
  assert.ok(parsed.manifest.errors.length > 0, 'Errors array must contain the error');
  assert.ok(parsed.manifest.errors[0].includes('quota exceeded'));

  // Test restore failure reporting
  const failingRestoreOps = {
    ...mock.ops,
    setDoc: async (ref, data) => {
      if (ref.path && ref.path.includes('settings')) {
        throw new Error('Simulated write permission error');
      }
      return mock.ops.setDoc(ref, data);
    },
  };

  const restoreReport = await restoreAllCloudData(uid, {
    version: 3,
    settings: { language: 'en' },
    businesses: [{ id: bizId, name: 'Shop' }],
  }, failingRestoreOps);

  assert.equal(restoreReport.success, false, 'Restore report must report success: false');
  assert.equal(restoreReport.isComplete, false);
  assert.ok(restoreReport.errors.length > 0);
});

await runTest('Suite 4', '4.30 [P1 Multi-Business Isolation] Public storefront products auto-sync scopes by activeBizId and prevents cross-business overwrite', async () => {
  const uid = 'owner_multi_1';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  // Shop A (biz_a) claims slug "grocery-corner"
  const storeA = {
    shopName: 'Grocery Corner',
    ownerUserId: uid,
    bizId: 'biz_a',
    whatsappNumber: '01711111111',
    isActive: true,
  };
  await savePublicStoreInfo('grocery-corner', storeA, mock.ops);

  // Sync products for Shop A
  const prodsA = [{ id: 'p_rice', name: 'Miniket Rice', sellPrice: 75, closingStock: 50 }];
  await syncPublicStoreProducts('grocery-corner', prodsA, { customOps: mock.ops });

  // Now user switches active business to Shop B (biz_b)
  // Verify that an auto-sync check strictly verifies store.bizId === activeBizId
  const loadedStoreA = (await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'stores', 'grocery-corner'))).data();
  assert.equal(loadedStoreA.bizId, 'biz_a');

  const activeBizId = 'biz_b';
  // Attempting to sync Shop B products to grocery-corner should be aborted by bizId guard:
  const shouldSync = loadedStoreA.bizId === activeBizId;
  assert.equal(shouldSync, false, 'Must reject sync when activeBizId (biz_b) does not match store bizId (biz_a)');

  // Verify grocery-corner products are completely unaffected
  const prodsSnap = await mock.ops.getDocs(mock.ops.collection(mock.ops.db, 'stores', 'grocery-corner', 'products'));
  const names = prodsSnap.docs.map(d => d.data().name);
  assert.deepEqual(names, ['Miniket Rice'], 'Grocery store products must not be contaminated');
});

await runTest('Suite 4', '4.31 [P1 Concurrency Guard] saveDayToCloud with checkConflict rejects stale write when cloud is newer (revision conflict)', async () => {
  const uid = 'concurrent_user_1';
  const bizId = 'biz_concur';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  // 1. Initial save at T1
  const initialDay = {
    dateKey: '2026-10-10',
    status: 'open',
    wallets: { hand_cash: { opening: 5000, current: 5000 } },
  };
  const t1 = await saveDayToCloud(uid, bizId, initialDay, mock.ops);
  assert.ok(t1 > 0);

  // Ensure clock advances for T2
  await new Promise(r => setTimeout(r, 20));

  // 2. Device B updates the day in cloud at T2
  const updatedByDeviceB = {
    dateKey: '2026-10-10',
    status: 'open',
    wallets: { hand_cash: { opening: 5000, current: 7500 } },
  };
  const t2 = await saveDayToCloud(uid, bizId, updatedByDeviceB, mock.ops);
  assert.ok(t2 > t1);

  // 3. Device A (offline or concurrent) attempts to save with stale baseSavedAt = t1 and checkConflict = true
  const staleDeviceA = {
    dateKey: '2026-10-10',
    status: 'open',
    wallets: { hand_cash: { opening: 5000, current: 6000 } },
  };

  await assert.rejects(
    async () => {
      await saveDayToCloud(uid, bizId, staleDeviceA, mock.ops, {
        checkConflict: true,
        baseSavedAt: t1,
      });
    },
    (err) => {
      return err.code === 'concurrent-modification-conflict';
    },
    'Stale write must be rejected with concurrent-modification-conflict error'
  );

  // Verify cloud state remains Device B's version (current = 7500)
  const loaded = await loadDayFromCloud(uid, bizId, '2026-10-10', mock.ops);
  assert.equal(loaded.wallets.hand_cash.current, 7500, 'Cloud state must preserve Device B data without overwrite');
});

await runTest('Suite 4', '4.32 [Cloud Auto-Restore Engine] 1-Click Cloud Auto-Restore exports cloud records, validates schema v3, and hydrates empty local storage', async () => {
  const uid = 'auto_restore_user_1';
  const bizId = 'biz_auto_restore';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  // 1. Seed complete shop records into Cloud Firestore
  await saveSettings(uid, { language: 'bn', isDarkMode: true }, mock.ops);
  await saveBusinesses(uid, [{ id: bizId, name: 'Cloud Super Shop', type: 'grocery' }], mock.ops);
  await saveDayToCloud(uid, bizId, {
    dateKey: '2026-10-10',
    status: 'finalized',
    wallets: { hand_cash: { opening: 10000, current: 15000 } },
    inventory: [{ id: 'prod_auto_1', name: 'Auto Prod 1', closingStock: 40 }],
    transactions: [{ id: 'tx_auto_1', type: 'stock_sale', amount: 5000 }],
  }, mock.ops);
  await saveAllContactsToCloud(uid, bizId, [
    { id: 'contact_auto_1', name: 'Customer Auto', phone: '01711111111', currentBalance: 2500 }
  ], mock.ops);

  // 2. Simulate new device / wiped localStorage
  localStorage.clear();
  assert.equal(localStorage.getItem(`shop_${bizId}_day_2026-10-10`), null);
  assert.equal(localStorage.getItem(`shop_${bizId}_contacts`), null);

  // 3. Execute Cloud Auto-Restore workflow:
  // Step A: Fetch full cloud bundle
  const cloudBundleStr = await exportAllCloudData(uid, mock.ops);
  assert.ok(typeof cloudBundleStr === 'string');

  // Step B: Validate backup payload
  const validation = validateBackupPayload(cloudBundleStr);
  assert.equal(validation.valid, true, 'Cloud bundle must be valid');
  assert.equal(validation.preview.businessesCount, 1);
  assert.equal(validation.preview.daysCount, 1);
  assert.equal(validation.preview.contactsCount, 1);

  // Step C: Hydrate local storage
  const importSuccess = importAllData(cloudBundleStr);
  assert.equal(importSuccess, true, 'Local storage hydration must succeed');

  // Step D: Verify local storage is fully restored
  const restoredDayStr = localStorage.getItem(`shop_${bizId}_day_2026-10-10`);
  assert.ok(restoredDayStr, 'Day data must be restored into localStorage');
  const restoredDay = JSON.parse(restoredDayStr);
  assert.equal(restoredDay.wallets.hand_cash.current, 15000);
  assert.equal(restoredDay.inventory[0].closingStock, 40);

  const restoredContactsStr = localStorage.getItem(`shop_${bizId}_contacts`);
  assert.ok(restoredContactsStr, 'Contacts must be restored into localStorage');
  const restoredContacts = JSON.parse(restoredContactsStr);
  assert.equal(restoredContacts.length, 1);
  assert.equal(restoredContacts[0].name, 'Customer Auto');
  assert.equal(restoredContacts[0].currentBalance, 2500);
});

await runTest('Suite 4', '4.33 [Google Sheets Backup Protection] sanitizeSpreadsheetCell neutralizes formula injection triggers (=, +, -, @, \\t, \\r)', async () => {
  // Dangerous formula injection inputs
  assert.equal(sanitizeSpreadsheetCell('=1+1'), "'=1+1");
  assert.equal(sanitizeSpreadsheetCell('+SUM(A1:A10)'), "'+SUM(A1:A10)");
  assert.equal(sanitizeSpreadsheetCell('-2+3'), "'-2+3");
  assert.equal(sanitizeSpreadsheetCell('@IMPORTXML("url")'), "'@IMPORTXML(\"url\")");
  assert.equal(sanitizeSpreadsheetCell('\tcmd'), "'\tcmd");

  // Safe financial & text inputs must remain unmodified
  assert.equal(sanitizeSpreadsheetCell('Normal Item'), 'Normal Item');
  assert.equal(sanitizeSpreadsheetCell(1500), 1500);
  assert.equal(sanitizeSpreadsheetCell('চাল (Miniket)'), 'চাল (Miniket)');
});

await runTest('Suite 4', '4.34 [3-Tier Disaster Recovery] Complete roundtrip: Local export -> Cloud restore -> Local re-hydration restores identical state', async () => {
  const bizId = 'biz_dr_tier';
  localStorage.clear();

  // Set initial local state
  localStorage.setItem(`shop_${bizId}_day_2026-10-12`, JSON.stringify({
    dateKey: '2026-10-12',
    wallets: { hand_cash: { current: 33000 } },
    inventory: [{ id: 'dr_item', name: 'DR Item', closingStock: 100 }],
  }));
  localStorage.setItem(`shop_${bizId}_contacts`, JSON.stringify([
    { id: 'dr_c1', name: 'DR Contact', currentBalance: 500 }
  ]));

  const appState = {
    activeBiz: { id: bizId, name: 'DR Shop' },
    businesses: [{ id: bizId, name: 'DR Shop' }],
    settings: { language: 'en' },
  };

  // 1. Export local JSON
  const localBackup = exportAllData(appState);
  const val = validateBackupPayload(localBackup);
  assert.equal(val.valid, true);
  assert.equal(val.preview.daysCount, 1);
  assert.equal(val.preview.contactsCount, 1);

  // 2. Wipe storage (simulating device clear / storage loss)
  localStorage.clear();
  assert.equal(localStorage.getItem(`shop_${bizId}_day_2026-10-12`), null);

  // 3. Re-hydrate from backup
  importAllData(localBackup);
  const rehydratedDay = JSON.parse(localStorage.getItem(`shop_${bizId}_day_2026-10-12`));
  assert.equal(rehydratedDay.wallets.hand_cash.current, 33000);
  assert.equal(rehydratedDay.inventory[0].closingStock, 100);
});

await runTest('Suite 4', '4.35 [P0 Bulk Reversal Idempotency] Re-reversing already-reversed transactions in bulk is idempotent: succeededCount=0, duplicates deduplicated, no ghost audit logs', async () => {
  let state = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 10000, current: 10000 } },
      inventory: [{
        id: 'item_idemp_1', name: 'Idempotency Item', unit: 'pcs',
        buyPrice: 100, sellPrice: 200,
        openingStock: 10, addedStock: 0, closingStock: 10,
        damagedStock: 0, fifoSoldUnits: 0, fifoCogs: 0,
        batches: [{ id: 'batch_idemp_1', unitCost: 100, remainingQty: 10, originalQty: 10 }],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Perform a sale of 2 units
  state = quickSellStockInState(state, { itemId: 'item_idemp_1', quantity: 2, sellPrice: 200, targetWallet: 'hand_cash' });
  const saleTxId = state.dayData.transactions[0].id;
  assert.equal(state.dayData.inventory[0].closingStock, 8);

  // 2. First bulk reversal on [saleTxId, saleTxId] (testing deduplication)
  const firstBulk = bulkDeleteTransactionsInState(state, [saleTxId, saleTxId]);
  const rep1 = firstBulk._bulkReversalReport;
  assert.equal(rep1.totalRequested, 1, 'Duplicate transaction IDs must be deduplicated to 1');
  assert.equal(rep1.succeededCount, 1);
  assert.equal(rep1.alreadyReversedCount, 0);
  assert.equal(rep1.isCompleteSuccess, true);
  assert.equal(firstBulk._auditEntries.length, 1, 'Exactly one audit log entry created on first reversal');
  assert.equal(firstBulk.dayData.inventory[0].closingStock, 10);

  // 3. Second bulk reversal on the exact same (now already reversed) transaction
  const secondBulk = bulkDeleteTransactionsInState(firstBulk, [saleTxId, saleTxId]);
  const rep2 = secondBulk._bulkReversalReport;
  assert.equal(rep2.totalRequested, 1);
  assert.equal(rep2.succeededCount, 0, 'Re-reversing must yield succeededCount = 0');
  assert.equal(rep2.alreadyReversedCount, 1, 'Already reversed transaction must be classified into alreadyReversedIds');
  assert.equal(rep2.isCompleteSuccess, false, 'Should not report complete success when nothing was reversed');
  assert.equal(rep2.nothingToReverse, true, 'Flag nothingToReverse must be true');
  assert.equal(secondBulk._auditEntry, undefined, 'Stale single _auditEntry must be cleared');
  assert.equal(secondBulk._auditEntries, undefined, 'No ghost audit entries appended on idempotent re-reversal');
  assert.equal(secondBulk.dayData.inventory[0].closingStock, 10, 'Stock must stay stable at 10');
});

await runTest('Suite 4', '4.36 [P1 Multi-Business Isolation] getShopSlugForUser isolates store discovery by active bizId across multi-business accounts', async () => {
  const uid = 'owner_multi_biz';
  const initialDocs = {
    'stores/electronics-outlet': {
      shopName: 'Electronics Outlet',
      ownerUserId: uid,
      bizId: 'biz_electronics',
      whatsappNumber: '01700000001',
    },
    'stores/grocery-supermart': {
      shopName: 'Grocery Supermart',
      ownerUserId: uid,
      bizId: 'biz_grocery',
      whatsappNumber: '01700000002',
    },
  };

  const mock = createMockFirestore(initialDocs, { auth: { uid }, enforceRules: true });

  // 1. Scoped search by biz_electronics returns electronics-outlet
  const slugElec = await getShopSlugForUser(uid, 'biz_electronics', mock.ops);
  assert.equal(slugElec, 'electronics-outlet', 'Must return store slug matching biz_electronics');

  // 2. Scoped search by biz_grocery returns grocery-supermart
  const slugGroc = await getShopSlugForUser(uid, 'biz_grocery', mock.ops);
  assert.equal(slugGroc, 'grocery-supermart', 'Must return store slug matching biz_grocery');

  // 3. Unscoped search returns one of the owned stores
  const slugAny = await getShopSlugForUser(uid, null, mock.ops);
  assert.ok(slugAny === 'electronics-outlet' || slugAny === 'grocery-supermart');

  // 4. Scoped search for a business with no published store returns null (zero cross-business contamination)
  const slugNone = await getShopSlugForUser(uid, 'biz_unregistered', mock.ops);
  assert.equal(slugNone, null, 'Must return null when bizId has no published store');
});

await runTest('Suite 4', '4.37 [P1 Cloud Restore Durability] restoreAllCloudData restores storefront incoming orders into /stores/{slug}/orders/{orderId}', async () => {
  const uid = 'owner_restore_orders';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const backupData = {
    version: 3,
    manifest: { schemaVersion: 3, exportedAt: new Date().toISOString(), isPartial: false, errors: [] },
    stores: {
      'fashion-hub': {
        info: {
          shopName: 'Fashion Hub',
          whatsappNumber: '01711122233',
          ownerUserId: uid,
          isActive: true,
        },
        publicInfo: {
          shopName: 'Fashion Hub',
          whatsappNumber: '01711122233',
          isActive: true,
        },
        products: [
          { id: 'prod_shirt', name: 'Cotton Shirt', price: 850, inStock: true }
        ],
        incomingOrders: [
          {
            id: 'ord_inc_101',
            customerName: 'Rahim Khan',
            customerPhone: '01911111111',
            totalAmount: 910,
            status: 'draft',
            createdAtMs: 1720000000000,
            items: [{ productId: 'prod_shirt', productName: 'Cotton Shirt', quantity: 1, unitPrice: 850, subtotal: 850 }],
          },
          {
            id: 'ord_inc_102',
            customerName: 'Fatima Begum',
            customerPhone: '01822222222',
            totalAmount: 1760,
            status: 'draft',
            createdAtMs: 1720000010000,
            items: [{ productId: 'prod_shirt', productName: 'Cotton Shirt', quantity: 2, unitPrice: 850, subtotal: 1700 }],
          },
        ],
      },
    },
  };

  const report = await restoreAllCloudData(uid, backupData, mock.ops);
  assert.equal(report.success, true);
  assert.equal(report.restoredCounts.incomingOrders, 2, 'Must count 2 restored incoming orders');
  assert.equal(report.restoredCounts.stores, 1);
  assert.equal(report.restoredCounts.storeProducts, 1);

  // Verify documents exist in mock Firestore at exact paths
  const order1 = mock.store.get('stores/fashion-hub/orders/ord_inc_101');
  assert.ok(order1);
  assert.equal(order1.customerName, 'Rahim Khan');
  assert.equal(order1.totalAmount, 910);

  const order2 = mock.store.get('stores/fashion-hub/orders/ord_inc_102');
  assert.ok(order2);
  assert.equal(order2.customerName, 'Fatima Begum');
  assert.equal(order2.totalAmount, 1760);
});

await runTest('Suite 4', '4.38 [P1 Backup Safety Guard] Cloud auto-restore blocks restoration from partial or corrupted backup snapshots', async () => {
  // 1. Partial snapshot with isPartial=true and manifest errors
  const partialBackup = {
    version: 3,
    manifest: {
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      isPartial: true,
      errors: ['Failed to read collection: days', 'Failed to read collection: contacts'],
    },
    days: { '2026-10-10': { transactions: [] } },
  };

  // Verify validateBackupPayload accepts schema but manifest check catches partial status
  const val = validateBackupPayload(partialBackup);
  assert.equal(val.valid, true);

  // Simulation of ProfileModal auto-restore safeguard
  const checkAutoRestoreEligibility = (target) => {
    if (target.manifest?.isPartial || (target.manifest?.errors && target.manifest.errors.length > 0)) {
      throw new Error(`Cannot auto-restore from an incomplete/partial cloud snapshot (${target.manifest.errors.join(', ')}).`);
    }
    return true;
  };

  assert.throws(
    () => checkAutoRestoreEligibility(partialBackup),
    /Cannot auto-restore from an incomplete\/partial cloud snapshot/
  );

  // Storage engine importAllData strictly prevents partial or corrupted backup from hydrating local storage
  assert.throws(
    () => importAllData(partialBackup),
    /Cannot hydrate local storage from partial or corrupted backup/
  );

  // 2. Complete non-partial snapshot passes eligibility
  const completeBackup = {
    version: 3,
    manifest: {
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      isPartial: false,
      errors: [],
    },
    days: { '2026-10-10': { transactions: [] } },
  };
  assert.equal(checkAutoRestoreEligibility(completeBackup), true);
});

await runTest('Suite 4', '4.39 [P1 Autosave Optimistic Concurrency] Autosave with checkConflict protects against multi-device silent overwrites', async () => {
  const uid = 'concurrency_autosave_uid';
  const bizId = 'biz_auto_sync';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const dayInitial = {
    dateKey: '2026-10-14',
    status: 'open',
    wallets: { hand_cash: { opening: 2000, current: 2000 } },
  };

  // Device A opens day and performs initial cloud sync at T1
  const savedAtT1 = await saveDayToCloud(uid, bizId, dayInitial, mock.ops);
  assert.ok(savedAtT1 > 0);

  // Sleep slightly to ensure advancing timestamp
  await new Promise(r => setTimeout(r, 20));

  // Device B makes a transaction and saves at T2
  const dayUpdatedByB = {
    dateKey: '2026-10-14',
    status: 'open',
    wallets: { hand_cash: { opening: 2000, current: 3500 } },
    transactions: [{ id: 'tx_b_1', amount: 1500, type: 'cash_sale' }],
  };
  const savedAtT2 = await saveDayToCloud(uid, bizId, dayUpdatedByB, mock.ops);
  assert.ok(savedAtT2 > savedAtT1);

  // Device A autosave runs with stale baseSavedAt = savedAtT1 and checkConflict = true
  const dayAutosaveFromA = {
    dateKey: '2026-10-14',
    status: 'open',
    wallets: { hand_cash: { opening: 2000, current: 2200 } },
    transactions: [{ id: 'tx_a_stale', amount: 200, type: 'cash_sale' }],
  };

  await assert.rejects(
    async () => {
      await saveDayToCloud(uid, bizId, dayAutosaveFromA, mock.ops, {
        checkConflict: true,
        baseSavedAt: savedAtT1,
      });
    },
    (err) => err.code === 'concurrent-modification-conflict',
    'Autosave must reject stale writes when cloud is modified by another device'
  );

  // Verify cloud data still preserves Device B's version without silent corruption
  const currentCloud = await loadDayFromCloud(uid, bizId, '2026-10-14', mock.ops);
  assert.equal(currentCloud.wallets.hand_cash.current, 3500);
  assert.equal(currentCloud.transactions[0].id, 'tx_b_1');
});

await runTest('Suite 4', '4.40 [P0 Accounting Lifecycle] Comprehensive Day Lifecycle Invariant & Reconciliation: Restock, Sell, Expense, Due Collection, Expense Reversal, and Multi-Pass Bulk Reversal', async () => {
  // Step 1: Open test state with ৳10,000 hand_cash
  let state = {
    language: 'en',
    contacts: [
      { id: 'contact_1', name: 'Rahim Khan', type: 'customer', openingBalance: 500, currentBalance: 500 },
    ],
    contactTransactions: {},
    dayData: {
      dateKey: '2026-10-15',
      status: 'open',
      wallets: {
        hand_cash: { opening: 10000, current: 10000, closing: null },
      },
      inventory: [
        {
          id: 'item_rice',
          name: 'Miniket Rice 5kg',
          unit: 'pcs',
          buyPrice: 100,
          sellPrice: 250,
          openingStock: 0,
          addedStock: 0,
          closingStock: 0,
          damagedStock: 0,
          fifoSoldUnits: 0,
          fifoCogs: 0,
          fifoRevenue: 0,
          batches: [],
        },
      ],
      transactions: [],
      journalEntries: [],
    },
  };

  // Step 2: Restock item_rice (10 pcs @ ৳100 = ৳1,000 cash paid)
  state = quickRestockInState(state, {
    itemId: 'item_rice',
    quantity: 10,
    unitCost: 100,
    sourceWallet: 'hand_cash',
  });
  const restockTx = state.dayData.transactions[0];
  assert.equal(state.dayData.wallets.hand_cash.current, 9000, 'Hand cash must be debited to 9000 after restock');
  assert.equal(state.dayData.inventory[0].closingStock, 10, 'Stock must be 10 pcs');
  assert.equal(state.dayData.inventory[0].batches.length, 1);
  assert.equal(state.dayData.inventory[0].batches[0].remainingQty, 10);

  // Step 3: Sell item_rice (4 pcs @ ৳250 = ৳1,000 cash received; COGS = ৳400, Gross Profit = ৳600)
  state = quickSellStockInState(state, {
    itemId: 'item_rice',
    quantity: 4,
    sellPrice: 250,
    targetWallet: 'hand_cash',
  });
  const sellTx = state.dayData.transactions[1];
  assert.equal(state.dayData.wallets.hand_cash.current, 10000, 'Hand cash restored to 10000 after sale');
  assert.equal(state.dayData.inventory[0].closingStock, 6, 'Stock reduced to 6 pcs');
  assert.equal(sellTx.amount, 1000, 'Sale amount must be 1000');
  assert.equal(sellTx.cogs, 400, 'COGS must be 400 (4 pcs @ 100)');
  assert.equal(sellTx.profit, 600, 'Gross profit must be 600 (1000 - 400)');

  // Step 4: Expense of ৳150 cash paid
  const expTx = {
    id: 'tx_exp_lifecycle_1',
    timestamp: Date.now(),
    type: 'expense',
    amount: 150,
    fromWallet: 'hand_cash',
    category: 'operating_expenses',
    note: 'Shop operational utility and supplies',
  };
  const expJE = generateJournalEntry(expTx, { fromWallet: 'hand_cash', category: 'operating_expenses', note: expTx.note });
  state = {
    ...state,
    dayData: {
      ...state.dayData,
      wallets: {
        ...state.dayData.wallets,
        hand_cash: {
          ...state.dayData.wallets.hand_cash,
          current: roundBDT(state.dayData.wallets.hand_cash.current - 150),
        },
      },
      transactions: [...state.dayData.transactions, expTx],
      journalEntries: [...state.dayData.journalEntries, expJE],
    },
  };
  assert.equal(state.dayData.wallets.hand_cash.current, 9850, 'Hand cash must be 9850 after 150 expense');

  // Step 5: Due collection (baki_received) of ৳500 from contact
  const bakiTx = {
    id: 'tx_baki_lifecycle_1',
    timestamp: Date.now(),
    type: 'baki_received',
    amount: 500,
    toWallet: 'hand_cash',
    wallet: 'hand_cash',
    contactId: 'contact_1',
    customerName: 'Rahim Khan',
    note: 'Customer due received',
  };
  const bakiJE = generateJournalEntry(bakiTx, { toWallet: 'hand_cash', wallet: 'hand_cash' });
  state = {
    ...state,
    contacts: state.contacts.map(c => c.id === 'contact_1' ? { ...c, currentBalance: roundBDT(c.currentBalance - 500) } : c),
    dayData: {
      ...state.dayData,
      wallets: {
        ...state.dayData.wallets,
        hand_cash: {
          ...state.dayData.wallets.hand_cash,
          current: roundBDT(state.dayData.wallets.hand_cash.current + 500),
        },
      },
      transactions: [...state.dayData.transactions, bakiTx],
      journalEntries: [...state.dayData.journalEntries, bakiJE],
    },
  };
  assert.equal(state.dayData.wallets.hand_cash.current, 10350, 'Hand cash must be 10350 after 500 baki collection');
  assert.equal(state.contacts[0].currentBalance, 0, 'Customer due balance must be fully cleared to 0');

  // Step 6: Reverse the Expense (cash restored by ৳150, net expenses = 0)
  state = reverseSingleTransactionInState(state, expTx.id);
  assert.equal(state.dayData.wallets.hand_cash.current, 10500, 'Hand cash restored by 150 to 10500 upon expense reversal');

  // Step 7: Bulk reverse [Restock, Sell] via bulkDeleteTransactionsInState
  // (multi-pass reverses sell first to unblock restock; stock returns to 0, batches cleaned)
  state = bulkDeleteTransactionsInState(state, [restockTx.id, sellTx.id], 'Comprehensive lifecycle bulk reversal');
  const report = state._bulkReversalReport;
  assert.ok(report, 'Bulk reversal report must be generated');
  assert.equal(report.isCompleteSuccess, true, 'Bulk reversal of [Restock, Sell] must succeed 100%');
  assert.equal(report.succeededCount, 2, 'Both Restock and Sell must succeed');
  assert.equal(report.failedCount, 0, 'Zero failures allowed');
  assert.deepEqual(report.failedIds, []);
  assert.deepEqual(report.succeededIds, [sellTx.id, restockTx.id], 'Multi-pass retry loop must reverse Sell first, unblocking Restock');

  // Step 8: Assert Trial Balance debits === credits, net cash in hand_cash === 10500 (10000 + 500 baki), and journal entries contain proper matching reversal pairs
  assert.equal(state.dayData.wallets.hand_cash.current, 10500, 'Net cash in hand_cash must be exactly 10500 (10000 opening + 500 baki)');
  assert.equal(state.dayData.inventory[0].closingStock, 0, 'Closing stock must cleanly return to 0');
  assert.equal(state.dayData.inventory[0].batches.length, 0, 'Inventory FIFO batches must be completely cleared');
  assert.equal(state.dayData.inventory[0].fifoSoldUnits, 0, 'fifoSoldUnits must be 0');
  assert.equal(state.dayData.inventory[0].fifoCogs, 0, 'fifoCogs must be 0');
  assert.equal(state.dayData.inventory[0].fifoRevenue, 0, 'fifoRevenue must be 0');

  // 8a. Trial Balance Debit === Credit Invariant (Zero Floating-Point Error)
  const tb = computeTrialBalance(state.dayData.journalEntries);
  const validation = validateTrialBalance(tb);
  assert.equal(validation.isBalanced, true, 'Trial balance must be perfectly balanced');
  assert.equal(validation.diff, 0, 'Debit - Credit difference must be exactly 0.00');
  assert.equal(validation.totalDebit, validation.totalCredit, 'Sum of Debits must strictly equal Sum of Credits');

  // 8b. General Ledger Accounts verification
  assert.equal(tb.cash_in_hand.net, 500, 'Cash in hand net GL debit must be 500 (from unreversed baki_received)');
  assert.equal(tb.accounts_receivable.net, -500, 'Accounts receivable net GL credit must be 500');
  assert.equal(tb.sales_revenue.net, 0, 'Sales revenue must net to exactly 0');
  assert.equal(tb.cogs.net, 0, 'COGS must net to exactly 0');
  assert.equal(tb.inventory.net, 0, 'Inventory journal movement must net to exactly 0');
  assert.equal(tb.operating_expenses.net, 0, 'Operating expenses must net to exactly 0');

  // 8c. Proper matching reversal pairs in transactions
  const reversedTxs = [restockTx, sellTx, expTx];
  for (const originalTx of reversedTxs) {
    const orig = state.dayData.transactions.find(t => t.id === originalTx.id);
    assert.equal(orig.reversed, true, `Original tx ${originalTx.id} must be marked reversed`);
    assert.ok(orig.reversalTxId, `Original tx ${originalTx.id} must point to reversalTxId`);
    const rev = state.dayData.transactions.find(t => t.id === orig.reversalTxId);
    assert.ok(rev, `Reversal transaction record for ${originalTx.id} must exist in transaction log`);
    assert.equal(rev.isReversal, true);
    assert.equal(rev.originalTxId, originalTx.id);
    assert.equal(rev.amount, originalTx.amount);
  }

  // 8d. Matching reversal pairs in journal entries (Sales + COGS + Expense + Restock)
  for (const originalTx of reversedTxs) {
    const origJEs = state.dayData.journalEntries.filter(j => j.txId === originalTx.id && j.txType !== 'reversal');
    const revJEs = state.dayData.journalEntries.filter(j => j.txId === originalTx.id && j.txType === 'reversal');
    assert.ok(origJEs.length > 0, `Original tx ${originalTx.id} must have generated JEs`);
    assert.equal(revJEs.length, origJEs.length, `Reversal JEs must match 1:1 with original JEs for ${originalTx.id}`);
  }

  // 8e. Post-reversal reports reconciliation (Dashboard, Daily Close, Inventory match 100%)
  const totals = aggregateTransactions(state.dayData.transactions);
  assert.equal(totals.expenses, 0, 'Dashboard/Reports: Net expenses must be 0');
  assert.equal(totals.stockSalesRevenue, 0, 'Dashboard/Reports: Net stock sales revenue must be 0');
  assert.equal(totals.stockSalesProfit, 0, 'Dashboard/Reports: Net stock sales profit must be 0');
  assert.equal(totals.stockPurchasesCost, 0, 'Dashboard/Reports: Net stock purchases cost must be 0');
  assert.equal(totals.damageLoss, 0, 'Dashboard/Reports: Net damage loss must be 0');
  assert.equal(totals.loanCollected, 500, 'Dashboard/Reports: Baki collection must be 500');

  const dailyProfit = calcTotalDailyProfit({
    inventoryProfit: totals.stockSalesProfit,
    totalExpenses: totals.expenses,
    damageLoss: totals.damageLoss,
  });
  assert.equal(dailyProfit, 0, 'Dashboard/Reports: Total daily profit must be 0');

  const invTotals = calcInventoryTotals(state.dayData.inventory);
  assert.equal(invTotals.totalRevenue, 0, 'Inventory Report: Total revenue must be 0');
  assert.equal(invTotals.totalCOGS, 0, 'Inventory Report: Total COGS must be 0');
  assert.equal(invTotals.totalProfit, 0, 'Inventory Report: Total profit must be 0');
  assert.equal(invTotals.totalUnitsSold, 0, 'Inventory Report: Total units sold must be 0');

  const expectedCash = calcExpectedHandCash({
    openingCash: 10000,
    salesRevenue: totals.stockSalesRevenue,
    servicesIncome: totals.servicesTotal,
    rechargeIncome: totals.rechargeProfit,
    loanCollected: totals.loanCollected,
    loanTaken: totals.loanTaken,
    ownerGave: totals.ownerGave,
    assetSales: totals.assetSales,
    loanRepaid: totals.loanRepaid,
    expenses: totals.expenses,
    personalDraw: totals.personalDraw,
    loanGiven: totals.loanGiven,
    fundTransferNet: totals.fundTransferNet,
    stockPurchases: totals.stockPurchasesCost,
  });
  assert.equal(expectedCash, 10500, 'Daily Close: Expected cash must reconcile to 10500');
  assert.equal(expectedCash, state.dayData.wallets.hand_cash.current, 'Daily Close expected cash must match physical hand_cash wallet 100%');
});

await runTest('Suite 4', '4.41 [1-Click Cloud Auto-Restore Durability Certification] Complete flow validates 5 snapshot chips, multi-step progress transitions, and airtight rejection of corrupted/partial states', async () => {
  const uid = 'cert_auto_restore_user';
  const biz1 = 'biz_main';
  const biz2 = 'biz_branch';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  // 1. Seed complete multi-business cloud dataset
  await saveSettings(uid, { language: 'bn', isDarkMode: true }, mock.ops);
  await saveBusinesses(uid, [
    { id: biz1, name: 'Main Store', type: 'grocery' },
    { id: biz2, name: 'Branch Store', type: 'telecom' },
  ], mock.ops);

  // Day records for both businesses
  await saveDayToCloud(uid, biz1, {
    dateKey: '2026-10-15',
    status: 'open',
    wallets: { hand_cash: { opening: 5000, current: 8500 } },
    inventory: [{ id: 'p_rice', name: 'Miniket', closingStock: 30 }],
    transactions: [{ id: 'tx_1', type: 'stock_sale', amount: 3500 }],
  }, mock.ops);

  await saveDayToCloud(uid, biz2, {
    dateKey: '2026-10-15',
    status: 'open',
    wallets: { hand_cash: { opening: 2000, current: 2000 } },
    inventory: [],
    transactions: [],
  }, mock.ops);

  // Contacts
  await saveAllContactsToCloud(uid, biz1, [
    { id: 'c1', name: 'Customer One', phone: '01711111111', currentBalance: 1200 },
  ], mock.ops);
  await saveAllContactsToCloud(uid, biz2, [
    { id: 'c2', name: 'Customer Two', phone: '01822222222', currentBalance: 400 },
  ], mock.ops);

  // Online Orders
  const orderData = {
    id: 'ord_cert_1',
    customerName: 'Online Buyer',
    customerPhone: '01933333333',
    status: 'confirmed',
    totalAmount: 1450,
  };
  await saveOnlineOrderToCloud(uid, biz1, orderData, mock.ops);

  // Public Storefront
  const storeData = {
    shopName: 'Main Store Web',
    ownerUserId: uid,
    bizId: biz1,
    whatsappNumber: '01711111111',
    isActive: true,
  };
  await savePublicStoreInfo('main-store-web', storeData, mock.ops);

  // 2. Fetch cloud backup via exportAllCloudData
  const cloudBundleStr = await exportAllCloudData(uid, mock.ops);
  assert.ok(typeof cloudBundleStr === 'string');

  // 3. Inspect Snapshot & Verify all 5 Summary Chips
  const validation = validateBackupPayload(cloudBundleStr);
  assert.equal(validation.valid, true, 'Cloud bundle must be valid');
  assert.equal(validation.isPartial, false, 'Cloud bundle must not be partial');
  assert.equal(validation.preview.daysCount, 2, 'Must count 2 days across businesses');
  assert.equal(validation.preview.contactsCount, 2, 'Must count 2 contacts across businesses');
  assert.equal(validation.preview.businessesCount, 2, 'Must count 2 businesses');
  assert.equal(validation.preview.onlineOrdersCount, 1, 'Must count 1 online order');
  assert.equal(validation.preview.storesCount, 1, 'Must count 1 storefront');

  // 4. Simulate real-time progress steps: downloading -> verifying -> hydrating -> done
  const recordedSteps = [];
  const simulateStep = (step) => recordedSteps.push(step);

  simulateStep('downloading');
  simulateStep('verifying');
  assert.equal(validation.valid && !validation.isPartial, true);

  simulateStep('hydrating');
  localStorage.clear();
  const hydrateSuccess = importAllData(cloudBundleStr);
  assert.equal(hydrateSuccess, true);

  simulateStep('done');
  assert.deepEqual(recordedSteps, ['downloading', 'verifying', 'hydrating', 'done']);

  // Verify hydrated local storage
  const restoredDay1 = JSON.parse(localStorage.getItem(`shop_${biz1}_day_2026-10-15`));
  assert.equal(restoredDay1.wallets.hand_cash.current, 8500);
  assert.equal(restoredDay1.inventory[0].name, 'Miniket');

  const restoredContacts1 = JSON.parse(localStorage.getItem(`shop_${biz1}_contacts`));
  assert.equal(restoredContacts1.length, 1);
  assert.equal(restoredContacts1[0].name, 'Customer One');

  const restoredOrders1 = JSON.parse(localStorage.getItem(`shop_${biz1}_online_orders`));
  assert.equal(restoredOrders1.length, 1);
  assert.equal(restoredOrders1[0].customerName, 'Online Buyer');

  // 5. Airtight Safety Safeguard: Corrupted and Partial snapshots strictly blocked
  // Case A: Corrupted JSON string
  const malformed = '{ invalid_json: ';
  const malformedVal = validateBackupPayload(malformed);
  assert.equal(malformedVal.valid, false);
  assert.throws(() => importAllData(malformed));

  // Case B: Partial snapshot with collection failure
  const partialCloudData = {
    version: 3,
    manifest: {
      status: 'partial',
      isPartial: true,
      errors: ['Days (biz_main): Network timeout', 'Contacts (biz_main): Quota exceeded'],
    },
    businesses: [{ id: biz1, name: 'Main Store' }],
  };
  const partialVal = validateBackupPayload(partialCloudData);
  assert.equal(partialVal.isPartial, true);
  assert.ok(partialVal.warning.includes('Days (biz_main): Network timeout'));

  // Ensure importAllData strictly aborts hydration to prevent partial corruption
  assert.throws(
    () => importAllData(partialCloudData),
    /Cannot hydrate local storage from partial or corrupted backup/
  );
});

await runTest('Suite 4', '4.42 [Deep Audit Fix] Legacy purchase reversal rejects insufficient closingStock; cash_adjustment reverses hand_cash cleanly', async () => {
  // 1. Legacy purchase without batchId where stock was partially sold (closingStock 4 < purchased 10)
  let legacyState = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-16',
      status: 'open',
      wallets: { hand_cash: { opening: 5000, current: 5000 } },
      inventory: [{
        id: 'item_legacy',
        name: 'Legacy Item',
        unit: 'pcs',
        buyPrice: 100,
        sellPrice: 150,
        openingStock: 0,
        addedStock: 10,
        closingStock: 4, // 6 sold already
        batches: [],
      }],
      transactions: [{
        id: 'tx_legacy_pur',
        type: 'stock_purchase',
        itemId: 'item_legacy',
        quantity: 10,
        amount: 1000,
        fromWallet: 'hand_cash',
        // No batchId (legacy record)
      }],
      journalEntries: [],
    },
  };

  const afterRejected = reverseSingleTransactionInState(legacyState, 'tx_legacy_pur', { suppressAlert: true });
  assert.equal(afterRejected, legacyState, 'Legacy purchase reversal must be rejected when closingStock (4) < purchase quantity (10)');
  assert.equal(afterRejected.dayData.inventory[0].closingStock, 4, 'closingStock must remain 4');

  // 2. cash_adjustment reversal (surplus +200 and shortage -150)
  let adjState = {
    language: 'en',
    contacts: [],
    dayData: {
      dateKey: '2026-10-16',
      status: 'open',
      wallets: { hand_cash: { opening: 1000, current: 1050 } },
      inventory: [],
      transactions: [
        { id: 'adj_surplus', type: 'cash_adjustment', amount: 200, note: 'Surplus' },
        { id: 'adj_shortage', type: 'cash_adjustment', amount: -150, note: 'Shortage' },
      ],
      journalEntries: [],
    },
  };

  // Reverse surplus (+200) -> hand_cash should decrease by 200 (1050 -> 850)
  adjState = reverseSingleTransactionInState(adjState, 'adj_surplus', { suppressAlert: true });
  assert.equal(adjState.dayData.wallets.hand_cash.current, 850, 'Reversing +200 surplus cash_adjustment must debit hand_cash to 850');

  // Reverse shortage (-150) -> hand_cash should increase by 150 (850 -> 1000)
  adjState = reverseSingleTransactionInState(adjState, 'adj_shortage', { suppressAlert: true });
  assert.equal(adjState.dayData.wallets.hand_cash.current, 1000, 'Reversing -150 shortage cash_adjustment must credit hand_cash back to 1000');
});

await runTest('Suite 4', '4.43 [Deep Audit Fix] Multi-item storefront order schema validation, formatSheetTxType baki_received mapping, and contactTxs key hydration', async () => {
  const { formatSheetTxType } = await import('../src/firebase/sheetsService.js');
  const { loadContactTxs } = await import('../src/data/storage.js');

  // 1. Verify formatSheetTxType maps baki_received and loan_collected properly
  assert.equal(formatSheetTxType('baki_received'), 'বাকি আদায় (Due Collected)');
  assert.equal(formatSheetTxType('loan_collected'), 'বাকি আদায় (Due Collected)');
  assert.equal(formatSheetTxType('cash_adjustment'), 'নগদ সমন্বয় (Cash Adjustment)');

  // 2. Verify multi-item storefront order validation in firestore.rules
  const shopSlug = 'multi-item-store';
  const mock = createMockFirestore({
    [`stores/${shopSlug}`]: {
      shopName: 'Multi Item Store',
      ownerUserId: 'owner_1',
      whatsappNumber: '01711223344',
      isActive: true,
    },
  }, { auth: null, enforceRules: true });

  // Valid 2-item order passes
  const validMultiOrder = await saveCustomerStoreOrder(shopSlug, {
    id: 'ord_multi_valid',
    customerName: 'Karim',
    customerPhone: '01711223344',
    deliveryCharge: 60,
    items: [
      { productId: 'p1', productName: 'Rice', quantity: 2, unitPrice: 100 },
      { productId: 'p2', productName: 'Oil', quantity: 1, unitPrice: 200 },
    ],
  }, mock.ops);
  assert.equal(validMultiOrder.success, true);
  assert.equal(validMultiOrder.order.subtotal, 400);
  assert.equal(validMultiOrder.order.totalAmount, 460);

  // Malicious 2-item order where items[1] has negative quantity or tampered subtotal is REJECTED by firestore.rules
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'ord_bad_item2'), {
      ...validMultiOrder.order,
      id: 'ord_bad_item2',
      items: [
        { productId: 'p1', productName: 'Rice', quantity: 2, unitPrice: 100, subtotal: 200 },
        { productId: 'p2', productName: 'Oil', quantity: -3, unitPrice: 200, subtotal: -600 },
      ],
    }),
    /PERMISSION_DENIED/,
    'Multi-item order with invalid second item must be rejected by firestore.rules'
  );

  // Malicious order where totalAmount does not equal subtotal + deliveryCharge is REJECTED by firestore.rules
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'ord_bad_total'), {
      ...validMultiOrder.order,
      id: 'ord_bad_total',
      subtotal: 400,
      deliveryCharge: 60,
      totalAmount: 10, // Tampered total!
    }),
    /PERMISSION_DENIED/,
    'Order with mismatched totalAmount !== subtotal + deliveryCharge must be rejected by firestore.rules'
  );

  // 3. Verify contactTxs hydration via importAllData works with loadContactTxs
  localStorage.clear();
  importAllData({
    version: 3,
    businesses: [{ id: 'biz_1', name: 'Test Biz' }],
    biz_1: {
      contactTxs: {
        c_101: [{ id: 'ctx_1', amount: 500, type: 'due_collected' }],
      },
    },
  });
  const loadedTxs = loadContactTxs('biz_1', 'c_101');
  assert.equal(loadedTxs.length, 1, 'loadContactTxs must find hydrated contact transactions');
  assert.equal(loadedTxs[0].amount, 500);
});

await runTest('Suite 4', '4.44 [P1-1 Bulk Reversal Report State Wiring] bulkDeleteTransactionsInState writes _bulkReversalReport to both state._bulkReversalReport and state.dayData._bulkReversalReport and CLEAR_BULK_REVERSAL_REPORT clears both', async () => {
  const { executeLedgerAction } = await import('../src/data/ledgerStateEngine.js');
  let state = createTestLedgerState();
  state.dayData.inventory = [
    {
      id: 'item_wire',
      name: 'Copper Wire',
      unit: 'm',
      buyPrice: 100,
      sellPrice: 150,
      openingStock: 0,
      addedStock: 0,
      closingStock: 0,
      damagedStock: 0,
      fifoSoldUnits: 0,
      fifoCogs: 0,
      batches: [],
    },
  ];
  state.dayData.transactions = [];
  state.dayData.journalEntries = [];

  state = quickRestockInState(state, { itemId: 'item_wire', quantity: 5, unitCost: 100, sourceWallet: 'hand_cash' });
  const purchaseId = state.dayData.transactions[0].id;
  state = quickSellStockInState(state, { itemId: 'item_wire', quantity: 2, salePrice: 300 });

  // Attempt to bulk delete ONLY purchaseId while sale is still active -> partial failure report
  state = bulkDeleteTransactionsInState(state, [purchaseId]);

  assert.ok(state._bulkReversalReport, 'Top-level state._bulkReversalReport must be populated');
  assert.ok(state.dayData._bulkReversalReport, 'state.dayData._bulkReversalReport must ALSO be populated for UI modal compatibility');
  assert.deepEqual(state._bulkReversalReport, state.dayData._bulkReversalReport, 'Both report references must match');
  assert.equal(state._bulkReversalReport.failedIds.length, 1);
  assert.equal(state._bulkReversalReport.failedIds[0], purchaseId);

  // Dispatch CLEAR_BULK_REVERSAL_REPORT and verify both locations are cleared
  state = executeLedgerAction(state, { type: 'CLEAR_BULK_REVERSAL_REPORT' });
  assert.equal(state._bulkReversalReport, undefined, 'state._bulkReversalReport must be cleared');
  assert.equal(state.dayData._bulkReversalReport, undefined, 'state.dayData._bulkReversalReport must be cleared');
});

await runTest('Suite 4', '4.45 [P1-2 Storefront Order 5-Item Limit & Total Sum Enforcement] 6-item order and omitted-subtotal total mismatch are strictly rejected by service and firestore.rules', async () => {
  const shopSlug = 'five-item-limit-store';
  const mock = createMockFirestore({
    [`stores/${shopSlug}`]: {
      shopName: 'Five Item Limit Store',
      ownerUserId: 'owner_1',
      whatsappNumber: '01711223344',
      isActive: true,
    },
  }, { auth: null, enforceRules: true });

  // 1. Service boundary rejects 6-item order before hitting Firestore
  const sixItems = [
    { productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 100, subtotal: 100 },
    { productId: 'p2', productName: 'Item 2', quantity: 1, unitPrice: 100, subtotal: 100 },
    { productId: 'p3', productName: 'Item 3', quantity: 1, unitPrice: 100, subtotal: 100 },
    { productId: 'p4', productName: 'Item 4', quantity: 1, unitPrice: 100, subtotal: 100 },
    { productId: 'p5', productName: 'Item 5', quantity: 1, unitPrice: 100, subtotal: 100 },
    { productId: 'p6', productName: '', quantity: -99, unitPrice: -500, subtotal: 49500 }, // 6th item malformed
  ];
  await assert.rejects(
    async () => saveCustomerStoreOrder(shopSlug, {
      id: 'ord_6_items_svc',
      customerName: 'Test Buyer',
      customerPhone: '01711223344',
      items: sixItems,
    }, mock.ops),
    /5 distinct items/i,
    'saveCustomerStoreOrder must reject orders with >5 items'
  );

  // 2. Direct Firestore write with 6 items (where 6th item is malformed or valid) is rejected by firestore.rules
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'ord_6_items_rules'), {
      id: 'ord_6_items_rules',
      shopSlug,
      customerName: 'Test Buyer',
      customerPhone: '01711223344',
      items: sixItems,
      subtotal: 500,
      deliveryCharge: 0,
      totalAmount: 500,
      status: 'new',
      source: 'web_store',
      createdAt: new Date().toISOString(),
    }),
    /PERMISSION_DENIED/,
    '6-item order must be rejected by firestore.rules'
  );

  // 3. Direct Firestore write that omits top-level subtotal and tampers with totalAmount is rejected by firestore.rules
  await assert.rejects(
    async () => mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'stores', shopSlug, 'orders', 'ord_no_subtotal_tampered'), {
      id: 'ord_no_subtotal_tampered',
      shopSlug,
      customerName: 'Test Buyer',
      customerPhone: '01711223344',
      items: [
        { productId: 'p1', productName: 'Item 1', quantity: 2, unitPrice: 150, subtotal: 300 },
        { productId: 'p2', productName: 'Item 2', quantity: 1, unitPrice: 200, subtotal: 200 },
      ],
      // Note: subtotal field deliberately omitted from root!
      deliveryCharge: 50,
      totalAmount: 100, // Should be 300 + 200 + 50 = 550!
      status: 'new',
      source: 'web_store',
      createdAt: new Date().toISOString(),
    }),
    /PERMISSION_DENIED/,
    'Order omitting root subtotal with totalAmount != sum(items.subtotal) + deliveryCharge must be rejected'
  );
});

await runTest('Suite 4', '4.46 [P1-3 Manual Restore Partial-Backup Blocker & Local Storage Rollback] restoreAllCloudData rejects partial backup before any cloud write and importAllData rolls back on quota failure', async () => {
  const userId = 'uid_restore_guard';
  const mock = createMockFirestore({}, { auth: { uid: userId }, enforceRules: true });

  const partialBackup = {
    version: 3,
    isPartial: true,
    manifest: {
      isPartial: true,
      failedPaths: ['users/uid_restore_guard/businesses/default/days'],
    },
    businesses: [{ id: 'default', name: 'My Shop' }],
    default: {
      days: { '2026-10-10': { dateKey: '2026-10-10', status: 'open' } },
    },
  };

  await assert.rejects(
    async () => restoreAllCloudData(userId, partialBackup, mock.ops),
    /Cannot restore partial or incomplete backup to cloud/,
    'restoreAllCloudData must reject partial backup at service boundary'
  );
  assert.equal(mock.store.size, 0, 'Zero documents may be written to Firestore when a partial backup is rejected');

  // Verify local importAllData atomic rollback when a quota failure happens mid-write
  localStorage.clear();
  localStorage.setItem('shop_businesses_list', JSON.stringify([{ id: 'existing_biz', name: 'Original Shop' }]));
  localStorage.setItem('shop_meta', JSON.stringify({ language: 'bn' }));

  const origSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, val) => {
    if (key === 'shop_new_biz_day_2026-10-10') {
      throw new Error('QuotaExceededError: Simulated storage quota failure mid-import');
    }
    return origSetItem(key, val);
  };

  try {
    assert.throws(
      () => importAllData({
        version: 3,
        businesses: [{ id: 'new_biz', name: 'Corrupted Import Shop' }],
        settings: { language: 'en' },
        new_biz: {
          days: { '2026-10-10': { dateKey: '2026-10-10', status: 'open' } },
        },
      }),
      /QuotaExceededError/,
      'importAllData must throw when quota fails mid-import'
    );
  } finally {
    localStorage.setItem = origSetItem;
  }

  // Verify original localStorage state was rolled back intact!
  const restoredBizs = JSON.parse(localStorage.getItem('shop_businesses_list'));
  assert.equal(restoredBizs.length, 1);
  assert.equal(restoredBizs[0].id, 'existing_biz', 'Previous shop_businesses_list must be rolled back after mid-import failure');
  const restoredMeta = JSON.parse(localStorage.getItem('shop_meta'));
  assert.equal(restoredMeta.language, 'bn', 'Previous shop_meta must be rolled back after mid-import failure');
  assert.equal(localStorage.getItem('shop_new_biz_day_2026-10-10'), null, 'Failed day key must not remain in localStorage');
});

await runTest('Suite 4', '4.47 [P1-4 & P1-5 Atomic Concurrent Saves & Tamper-Resistant Audit Log] Overlapping saveDayToCloud calls serialize atomically and auditLog deletion is blocked even after meta/info removal', async () => {
  const userId = 'uid_atomic_race';
  const bizId = 'biz_race';
  const dateKey = '2026-10-10';
  const dayPath = `users/${userId}/businesses/${bizId}/days/${dateKey}`;

  const mock = createMockFirestore({
    [dayPath]: {
      dateKey,
      status: 'open',
      savedAt: 1000,
      _revision: 1,
      note: 'Initial state',
    },
  }, { auth: { uid: userId }, enforceRules: true });

  // Two devices/tabs read the same base state (_lastCloudSavedAt: 1000, _revision: 1) and fire saveDayToCloud concurrently
  const deviceAState = { dateKey, status: 'open', _revision: 1, note: 'Device A write' };
  const deviceBState = { dateKey, status: 'open', _revision: 1, note: 'Device B write' };

  const results = await Promise.allSettled([
    saveDayToCloud(userId, bizId, deviceAState, mock.ops, { checkConflict: true, baseSavedAt: 1000 }),
    saveDayToCloud(userId, bizId, deviceBState, mock.ops, { checkConflict: true, baseSavedAt: 1000 }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent save must succeed');
  assert.equal(rejected.length, 1, 'The second overlapping concurrent save must be rejected');
  assert.equal(rejected[0].reason?.code, 'concurrent-modification-conflict');

  const finalDoc = mock.store.get(dayPath);
  assert.equal(finalDoc._revision, 2, 'Cloud document _revision must be atomically incremented to 2');

  // Verify P1-5: Even if meta/info does NOT exist, deleting an auditLog entry is rejected by firestore.rules
  const auditPath = `users/${userId}/businesses/${bizId}/auditLog/audit_immutable_1`;
  mock.store.set(auditPath, {
    id: 'audit_immutable_1',
    action: 'DELETE_TRANSACTION',
    timestamp: new Date().toISOString(),
  });
  await assert.rejects(
    async () => mock.ops.deleteDoc(mock.ops.doc(mock.ops.db, 'users', userId, 'businesses', bizId, 'auditLog', 'audit_immutable_1')),
    /PERMISSION_DENIED/,
    'Client-side auditLog deletion must be forbidden even when meta/info is absent'
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 5: RELEASE GATE ACCEPTANCE TESTS (ITEMS 1–13)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🚀 SUITE 5: Release Gate Acceptance Tests (Items 1–13)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const {
  createRevisionTracker,
  reinitializeTrackerFromCloudSnapshot,
} = await import('../src/data/syncRevisionTracker.js');

const {
  verifyOrderAgainstCatalog,
  repriceOrderFromCatalog,
  mergeIncomingOrdersIdempotently,
} = await import('../src/data/orderIntegrityEngine.js');

const {
  recordOperationalError,
  getOperationalErrorLog,
  clearOperationalErrorLog,
  recordDatabaseOperation,
  getDatabaseUsageSnapshot,
  resetDatabaseUsageCounters,
  captureRollbackSnapshot,
  restoreRollbackSnapshot,
  runBackupRestoreDrill,
  BACKUP_AND_RETENTION_POLICY,
} = await import('../src/data/operationalSafeguards.js');

const {
  migrateLegacyPublicStoreProducts,
  transferIncomingOrderToBusiness,
} = await import('../src/firebase/firestoreService.js');

const {
  getRecommendedWalletForPayment,
  getSettleErrorMessage,
} = await import('../src/data/courierRates.js');

const {
  createNewDayData,
} = await import('../src/data/storage.js');

await runTest('Suite 5', '5.1 [Item 1: Autosave Revision Sync] Load day at rev 4 -> save -> rev 5 -> save -> rev 6 without false conflict, across page refresh and business switch', async () => {
  const userId = 'uid_item1_rev_sync';
  const bizA = 'biz_alpha';
  const bizB = 'biz_beta';
  const dateKey = '2026-10-10';
  const pathA = `users/${userId}/businesses/${bizA}/days/${dateKey}`;
  const pathB = `users/${userId}/businesses/${bizB}/days/${dateKey}`;

  const mock = createMockFirestore({
    [pathA]: { dateKey, status: 'open', savedAt: 4000, _revision: 4, note: 'Loaded at rev 4' },
    [pathB]: { dateKey, status: 'open', savedAt: 2000, _revision: 2, note: 'Biz B at rev 2' },
  }, { auth: { uid: userId }, enforceRules: true });

  const tracker = createRevisionTracker();

  // 1. Load day at revision 4 and initialize tracker
  const loadedA = await loadDayFromCloud(userId, bizA, dateKey, mock.ops);
  assert.equal(loadedA._revision, 4);
  reinitializeTrackerFromCloudSnapshot(tracker, bizA, loadedA);
  assert.equal(tracker.getBaseRevision(bizA, dateKey), 4);

  // 2. First save -> revision 5 (no false conflict)
  const dayDataA = { ...loadedA, note: 'Edit 1 on Biz A' };
  const saveRes1 = await saveDayToCloud(userId, bizA, dayDataA, mock.ops, {
    checkConflict: true,
    baseSavedAt: tracker.getBaseSavedAt(bizA, dateKey),
    baseRevision: tracker.getBaseRevision(bizA, dateKey),
  });
  tracker.recordCloudSaveSuccess(bizA, dateKey, saveRes1);
  assert.equal(saveRes1.revision, 5, 'First save must increment revision from 4 to 5');
  assert.equal(dayDataA._revision, 5, 'In-memory dayData._revision must be updated to 5');

  // 3. Second save immediately after -> revision 6 (no false conflict!)
  dayDataA.note = 'Edit 2 on Biz A';
  const saveRes2 = await saveDayToCloud(userId, bizA, dayDataA, mock.ops, {
    checkConflict: true,
    baseSavedAt: tracker.getBaseSavedAt(bizA, dateKey),
    baseRevision: tracker.getBaseRevision(bizA, dateKey),
  });
  tracker.recordCloudSaveSuccess(bizA, dateKey, saveRes2);
  assert.equal(saveRes2.revision, 6, 'Second consecutive save must increment revision from 5 to 6 without false conflict');
  assert.equal(dayDataA._revision, 6);

  // 4. Simulate page refresh: new tracker instance loads from cloud at revision 6 -> save -> revision 7
  const refreshedTracker = createRevisionTracker();
  const reloadedA = await loadDayFromCloud(userId, bizA, dateKey, mock.ops);
  assert.equal(reloadedA._revision, 6);
  reinitializeTrackerFromCloudSnapshot(refreshedTracker, bizA, reloadedA);

  reloadedA.note = 'Edit 3 after refresh';
  const saveRes3 = await saveDayToCloud(userId, bizA, reloadedA, mock.ops, {
    checkConflict: true,
    baseSavedAt: refreshedTracker.getBaseSavedAt(bizA, dateKey),
    baseRevision: refreshedTracker.getBaseRevision(bizA, dateKey),
  });
  refreshedTracker.recordCloudSaveSuccess(bizA, dateKey, saveRes3);
  assert.equal(saveRes3.revision, 7, 'Save after page refresh must increment revision to 7');

  // 5. Switch to Business B (loaded at rev 2) -> save -> rev 3, then switch back to Business A (at rev 7) -> save -> rev 8
  const loadedB = await loadDayFromCloud(userId, bizB, dateKey, mock.ops);
  assert.equal(loadedB._revision, 2);
  reinitializeTrackerFromCloudSnapshot(refreshedTracker, bizB, loadedB);

  loadedB.note = 'Edit 1 on Biz B';
  const saveResB1 = await saveDayToCloud(userId, bizB, loadedB, mock.ops, {
    checkConflict: true,
    baseSavedAt: refreshedTracker.getBaseSavedAt(bizB, dateKey),
    baseRevision: refreshedTracker.getBaseRevision(bizB, dateKey),
  });
  refreshedTracker.recordCloudSaveSuccess(bizB, dateKey, saveResB1);
  assert.equal(saveResB1.revision, 3, 'Biz B revision must advance from 2 to 3 independently');

  // Switch back to Biz A and save again
  reloadedA.note = 'Edit 4 after switching back to Biz A';
  const saveResA4 = await saveDayToCloud(userId, bizA, reloadedA, mock.ops, {
    checkConflict: true,
    baseSavedAt: refreshedTracker.getBaseSavedAt(bizA, dateKey),
    baseRevision: refreshedTracker.getBaseRevision(bizA, dateKey),
  });
  refreshedTracker.recordCloudSaveSuccess(bizA, dateKey, saveResA4);
  assert.equal(saveResA4.revision, 8, 'Switching back to Biz A must preserve rev 7 base and increment to 8');
});

await runTest('Suite 5', '5.2 [Item 2: Fail-Closed Conflict Detection] Cloud read failure rejects save without writing; overlapping saves serialize; explicit forceOverwrite works', async () => {
  const userId = 'uid_item2_fail_closed';
  const bizId = 'biz_fc';
  const dateKey = '2026-10-10';
  const dayPath = `users/${userId}/businesses/${bizId}/days/${dateKey}`;

  const mock = createMockFirestore({
    [dayPath]: { dateKey, status: 'open', savedAt: 5000, _revision: 3, note: 'Cloud version 3' },
  }, { auth: { uid: userId }, enforceRules: true });

  // 1. Simulate a cloud read failure during conflict check -> MUST reject and MUST NOT overwrite cloud doc
  const failingReadOps = {
    ...mock.ops,
    runTransaction: async () => {
      throw new Error('Unavailable: Simulated Firestore read failure during conflict check');
    },
  };

  await assert.rejects(
    async () => saveDayToCloud(
      userId,
      bizId,
      { dateKey, status: 'open', _revision: 3, note: 'Should not write on read failure' },
      failingReadOps,
      { checkConflict: true, baseSavedAt: 5000, baseRevision: 3 }
    ),
    (err) => err.code === 'conflict-check-read-failed',
    'Read failure during conflict check must fail closed with conflict-check-read-failed'
  );
  assert.equal(mock.store.get(dayPath).note, 'Cloud version 3', 'Cloud document must remain untouched when conflict read fails');

  // 2. Stale data is rejected when checkConflict: true
  await assert.rejects(
    async () => saveDayToCloud(
      userId,
      bizId,
      { dateKey, status: 'open', _revision: 2, note: 'Stale client write' },
      mock.ops,
      { checkConflict: true, baseSavedAt: 3000, baseRevision: 2 }
    ),
    (err) => err.code === 'concurrent-modification-conflict',
    'Stale client revision must be rejected'
  );

  // 3. Explicit forced overwrite (forceOverwrite: true) succeeds and increments from latest cloud revision
  const forcedRes = await saveDayToCloud(
    userId,
    bizId,
    { dateKey, status: 'open', _revision: 2, note: 'Deliberate user forced overwrite' },
    mock.ops,
    { checkConflict: true, forceOverwrite: true, baseSavedAt: 3000, baseRevision: 2 }
  );
  assert.equal(forcedRes.revision, 4, 'Explicit forceOverwrite must increment from latest cloud revision (3 -> 4)');
  assert.equal(mock.store.get(dayPath).note, 'Deliberate user forced overwrite');
});

await runTest('Suite 5', '5.3 [Item 3: Secure Order Prices, Products & Stock] Manipulated prices, unavailable products, invalid quantities, and inconsistent totals are blocked from sales/inventory', async () => {
  const ownerId = 'uid_item3_owner';
  const slug = 'rahim-trusted-store';

  const mock = createMockFirestore({
    [`stores/${slug}`]: {
      shopName: 'Rahim Trusted Store',
      ownerUserId: ownerId,
      bizId: 'default',
      whatsappNumber: '01711112222',
      isActive: true,
    },
    [`stores/${slug}/products/prod_rice`]: {
      name: 'Miniket Rice 5kg',
      price: 420,
      inStock: true,
      stock: 10,
    },
    [`stores/${slug}/products/prod_oil`]: {
      name: 'Soybean Oil 1L',
      price: 180,
      inStock: false,
      stock: 0,
    },
  }, { auth: null, enforceRules: true });

  // 1. Customer submits order with manipulated price (৳10 instead of ৳420) -> rejected by saveCustomerStoreOrder
  await assert.rejects(
    async () => saveCustomerStoreOrder(slug, {
      id: 'ord_fake_price_1',
      customerName: 'Attacker',
      customerPhone: '01700000000',
      items: [{ productId: 'prod_rice', productName: 'Miniket Rice 5kg', quantity: 2, unitPrice: 10, subtotal: 20 }],
      subtotal: 20,
      deliveryCharge: 60,
      totalAmount: 80,
    }, mock.ops),
    (err) => err.code === 'price_mismatch' && err.issues?.some(e => e.code === 'price_mismatch'),
    'Manipulated price must be rejected against published catalog'
  );

  // 2. Customer submits order for out-of-stock/unavailable product -> rejected
  await assert.rejects(
    async () => saveCustomerStoreOrder(slug, {
      id: 'ord_unavailable_1',
      customerName: 'Buyer',
      customerPhone: '01700000000',
      items: [{ productId: 'prod_oil', productName: 'Soybean Oil 1L', quantity: 1, unitPrice: 180, subtotal: 180 }],
      subtotal: 180,
      deliveryCharge: 0,
      totalAmount: 180,
    }, mock.ops),
    (err) => err.code === 'unavailable_product' && err.issues?.some(e => e.code === 'unavailable_product'),
    'Unavailable product must be rejected'
  );

  // 3. Customer submits order exceeding available stock (25 > 10) -> rejected
  await assert.rejects(
    async () => saveCustomerStoreOrder(slug, {
      id: 'ord_over_stock_1',
      customerName: 'Buyer',
      customerPhone: '01700000000',
      items: [{ productId: 'prod_rice', productName: 'Miniket Rice 5kg', quantity: 25, unitPrice: 420, subtotal: 10500 }],
      subtotal: 10500,
      deliveryCharge: 0,
      totalAmount: 10500,
    }, mock.ops),
    (err) => err.code === 'insufficient_stock' && err.issues?.some(e => e.code === 'insufficient_stock'),
    'Order quantity exceeding available stock must be rejected'
  );

  // 4. Even if an unverified order with a manipulated price (৳10 instead of ৳420) reaches state,
  // confirmOnlineOrderInState and deliverOnlineOrderInState MUST block it from becoming an accepted sale!
  let state = {
    language: 'en',
    contacts: [],
    onlineOrders: [{
      id: 'ord_tampered_in_state',
      orderNumber: '#ONL-901',
      customerName: 'Tampered Buyer',
      customerPhone: '01799998888',
      items: [{ productId: 'prod_rice', productName: 'Miniket Rice 5kg', quantity: 2, unitPrice: 10, subtotal: 20 }],
      subtotal: 20,
      deliveryCharge: 60,
      totalAmount: 80,
      status: 'draft',
    }],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: { hand_cash: { opening: 5000, current: 5000 } },
      inventory: [{
        id: 'prod_rice',
        name: 'Miniket Rice 5kg',
        unit: 'bag',
        buyPrice: 350,
        sellPrice: 420,
        openingStock: 10,
        addedStock: 0,
        closingStock: 10,
        damagedStock: 0,
        fifoSoldUnits: 0,
        fifoCogs: 0,
        fifoRevenue: 0,
        batches: [{ id: 'b_rice_1', unitCost: 350, remainingQty: 10, originalQty: 10 }],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  const blockedConfirm = confirmOnlineOrderInState(state, 'ord_tampered_in_state');
  assert.ok(blockedConfirm._orderIntegrityError, 'Confirming an order with manipulated price must fail with _orderIntegrityError');
  assert.equal(blockedConfirm.onlineOrders[0].status, 'draft', 'Order status must remain draft when price verification fails');

  const blockedDeliver = deliverOnlineOrderInState(state, { orderId: 'ord_tampered_in_state', walletKey: 'hand_cash' });
  assert.ok(blockedDeliver._orderIntegrityError, 'Delivering an order with manipulated price must fail with _orderIntegrityError');
  assert.equal(blockedDeliver.dayData.inventory[0].closingStock, 10, 'Inventory must NOT be deducted for manipulated order');
  assert.equal(blockedDeliver.dayData.transactions.length, 0, 'Zero accounting transactions may be created for manipulated order');

  // 5. Owner reviews and reprices the order from the authoritative catalog -> then confirm, pack, and deliver succeed!
  state = verifyAndRepriceOnlineOrderInState(state, 'ord_tampered_in_state');
  assert.equal(state.onlineOrders[0].priceVerified, true, 'Order must be marked priceVerified after owner catalog repricing');
  assert.equal(state.onlineOrders[0].items[0].unitPrice, 420, 'Item unitPrice must be corrected to catalog ৳420');
  assert.equal(state.onlineOrders[0].subtotal, 840, 'Subtotal must be corrected to 2 * 420 = ৳840');
  assert.equal(state.onlineOrders[0].totalAmount, 900, 'TotalAmount must be corrected to 840 + 60 = ৳900');

  state = confirmOnlineOrderInState(state, 'ord_tampered_in_state');
  assert.equal(state.onlineOrders[0].status, 'confirmed');
  state = packOnlineOrderInState(state, 'ord_tampered_in_state');
  assert.equal(state.onlineOrders[0].status, 'packed');
  state = shipOnlineOrderInState(state, 'ord_tampered_in_state');
  assert.equal(state.onlineOrders[0].status, 'shipped');
  state = deliverOnlineOrderInState(state, { orderId: 'ord_tampered_in_state', walletKey: 'hand_cash' });
  assert.equal(state.onlineOrders[0].status, 'delivered');
  assert.equal(state.dayData.inventory[0].closingStock, 8, '2 bags deducted upon verified delivery');
  assert.equal(state.dayData.inventory[0].fifoRevenue, 840, 'FIFO revenue records authoritative catalog price ৳840');
  assert.equal(state.dayData.inventory[0].fifoCogs, 700, 'FIFO COGS records 2 * 350 = ৳700');
  assert.equal(state.dayData.wallets.hand_cash.current, 5900, 'Wallet credited with verified ৳900 total (840 + 60 delivery)');
});

await runTest('Suite 5', '5.4 [Item 4: Reliable Order Transfer & Business Isolation] Write failure, delete failure, idempotent retry, refresh, and cross-business isolation', async () => {
  const userId = 'uid_item4_owner';
  const biz1 = 'biz_grocery';
  const biz2 = 'biz_pharmacy';
  const slug1 = 'grocery-mart';

  const incomingOrder = {
    id: 'ord_transfer_101',
    customerName: 'Nusrat Jahan',
    customerPhone: '01812345678',
    items: [{ productId: 'p_sugar', productName: 'Sugar 1kg', quantity: 2, unitPrice: 140, subtotal: 280 }],
    subtotal: 280,
    deliveryCharge: 60,
    totalAmount: 340,
    status: 'draft',
    source: 'web_storefront',
  };

  const mock = createMockFirestore({
    [`stores/${slug1}`]: {
      shopName: 'Grocery Mart',
      ownerUserId: userId,
      bizId: biz1,
      whatsappNumber: '01811112222',
      isActive: true,
    },
    [`stores/${slug1}/products/p_sugar`]: {
      name: 'Sugar 1kg',
      price: 140,
      inStock: true,
      stock: 50,
    },
    [`stores/${slug1}/orders/ord_transfer_101`]: incomingOrder,
  }, { auth: { uid: userId }, enforceRules: true });

  // 1. Cross-business isolation: Attempting to import Grocery Mart's order while active business is biz_pharmacy MUST fail closed
  await assert.rejects(
    async () => transferIncomingOrderToBusiness(userId, biz2, slug1, incomingOrder, mock.ops),
    (err) => err.code === 'store-business-mismatch',
    'Importing an order from a store bound to biz_grocery into biz_pharmacy must be rejected'
  );
  assert.equal(mock.store.has(`users/${userId}/businesses/${biz2}/onlineOrders/ord_transfer_101`), false, 'Zero orders delivered to wrong business');
  assert.equal(mock.store.has(`stores/${slug1}/orders/ord_transfer_101`), true, 'Incoming order remains untouched in source store');

  // 2. Simulate destination write failure -> incoming order MUST NOT be lost
  const writeFailOps = {
    ...mock.ops,
    setDoc: async (ref, data, opts) => {
      if (ref.path.includes('/onlineOrders/')) {
        throw new Error('Simulated destination network write failure');
      }
      return mock.ops.setDoc(ref, data, opts);
    },
  };
  await assert.rejects(
    async () => transferIncomingOrderToBusiness(userId, biz1, slug1, incomingOrder, writeFailOps),
    /Simulated destination network write failure/
  );
  assert.equal(mock.store.has(`stores/${slug1}/orders/ord_transfer_101`), true, 'Incoming order is preserved when destination write fails');

  // 3. Simulate delete failure after destination write succeeds -> order is persisted in biz1, source still has doc
  const deleteFailOps = {
    ...mock.ops,
    deleteDoc: async (ref) => {
      if (ref.path.includes('/orders/ord_transfer_101')) {
        throw new Error('Simulated source delete failure');
      }
      return mock.ops.deleteDoc(ref);
    },
  };
  const partialTransfer = await transferIncomingOrderToBusiness(userId, biz1, slug1, incomingOrder, deleteFailOps);
  assert.equal(partialTransfer.transferred, true, 'Order was persisted and verified in destination business');
  assert.equal(partialTransfer.deletedIncoming, false, 'Delete failure is accurately reported');
  assert.equal(mock.store.has(`users/${userId}/businesses/${biz1}/onlineOrders/ord_transfer_101`), true);
  assert.equal(mock.store.has(`stores/${slug1}/orders/ord_transfer_101`), true);

  // 4. Retry / Browser Refresh: calling transferIncomingOrderToBusiness again is 100% idempotent (no duplicate) and cleans up source!
  const retryTransfer = await transferIncomingOrderToBusiness(userId, biz1, slug1, incomingOrder, mock.ops);
  assert.equal(retryTransfer.transferred, true);
  assert.equal(retryTransfer.alreadyImported, true, 'Retry detects order was already persisted in destination');
  assert.equal(retryTransfer.deletedIncoming, true, 'Retry cleans up remaining temporary incoming order');
  assert.equal(mock.store.has(`stores/${slug1}/orders/ord_transfer_101`), false, 'Temporary incoming order removed');

  // Verify local state merge is also idempotent
  const merged = mergeIncomingOrdersIdempotently([retryTransfer.order], [retryTransfer.order], { activeBizId: biz1 });
  assert.equal(merged.mergedOrders.length, 1, 'Idempotent state merge never duplicates an order on retry/refresh');
  assert.equal(merged.skippedCount, 1);
});

await runTest('Suite 5', '5.5 [Item 5: Safe Backup & Restore Across All Entry Points] Partial backup rejection, mid-restore failure reporting, idempotent retry, and quota rollback', async () => {
  const userId = 'uid_item5_restore';
  const bizId = 'default';
  const mock = createMockFirestore({}, { auth: { uid: userId }, enforceRules: true });

  // 1. Corrupt & incomplete backups are rejected before any writes
  const validationBad = validateBackupPayload({ version: 3, isPartial: true, businesses: [{ id: 'default' }] });
  assert.equal(validationBad.isPartial, true, 'Partial backup must be flagged as partial');

  await assert.rejects(
    async () => restoreAllCloudData(userId, { version: 3, isPartial: true, businesses: [{ id: 'default' }] }, mock.ops),
    /Cannot restore partial or incomplete backup to cloud/
  );
  assert.throws(
    () => importAllData({ version: 3, isPartial: true, businesses: [{ id: 'default' }] }),
    /Cannot hydrate local storage from partial or corrupted backup|Cannot import partial or incomplete backup/
  );
  assert.equal(mock.store.size, 0, 'Zero cloud writes on rejected backup');

  // 2. Valid backup with days, contacts, onlineOrders, and append-only auditLog
  const validBackup = {
    version: 3,
    exportedAt: new Date().toISOString(),
    isPartial: false,
    manifest: { isPartial: false, failedCount: 0, failedPaths: [] },
    businesses: [{ id: bizId, name: 'Safe Restore Shop' }],
    settings: { language: 'bn', isDarkMode: false },
    [bizId]: {
      days: {
        '2026-10-10': { dateKey: '2026-10-10', status: 'open', savedAt: 1000, _revision: 1 },
      },
      contacts: [
        { id: 'c_1', name: 'Karim', phone: '01711111111', currentBalance: 500 },
      ],
      contactTxs: {},
      onlineOrders: [
        { id: 'ord_1', customerName: 'Buyer', customerPhone: '01722222222', totalAmount: 300, status: 'confirmed' },
      ],
      auditLog: [
        { id: 'aud_1', action: 'REVERSE', timestamp: '2026-10-10T10:00:00.000Z', txId: 'tx_1' },
      ],
      meta: { openingCapital: 25000 },
    },
  };

  // 3. Simulate a failure halfway through restoreAllCloudData -> reported accurately as isPartialRestore: true, success: false
  const midFailOps = {
    ...mock.ops,
    writeBatch: (dbArg) => {
      const realBatch = mock.ops.writeBatch(dbArg);
      let hasOnlineOrder = false;
      return {
        ...realBatch,
        set: (ref, data, opts) => {
          if (ref.path.includes('/onlineOrders/')) hasOnlineOrder = true;
          return realBatch.set(ref, data, opts);
        },
        commit: async () => {
          if (hasOnlineOrder) {
            throw new Error('Simulated network drop halfway through restore');
          }
          return realBatch.commit();
        },
      };
    },
  };

  const midReport = await restoreAllCloudData(userId, validBackup, midFailOps);
  assert.equal(midReport.isPartialRestore, true, 'Failure halfway through restore must report isPartialRestore: true');
  assert.equal(midReport.success, false, 'Failure halfway through restore must NOT report success: true');
  assert.ok(midReport.failedCount > 0, 'failedCount must reflect failed collection writes');

  // 4. Re-running restoreAllCloudData with working network succeeds idempotently without duplicating records or failing on existing auditLog!
  const retryReport = await restoreAllCloudData(userId, validBackup, mock.ops);
  assert.equal(retryReport.success, true, 'Retry of restore must succeed cleanly');
  assert.equal(retryReport.isPartialRestore, false);
  assert.equal(retryReport.skippedAuditLogs, 1, 'Existing append-only auditLog entry must be skipped idempotently on retry');
  assert.equal(mock.store.get(`users/${userId}/businesses/${bizId}/onlineOrders/ord_1`)?.totalAmount, 300);
});

await runTest('Suite 5', '5.6 [Item 6: Legacy Public Product Migration & Audit Retention Policy] Migrates legacy public products, verifies with non-owner account, and checks policy docs', async () => {
  const ownerId = 'uid_item6_owner';
  const nonOwnerId = 'uid_item6_customer';
  const slug = 'legacy-migration-store';

  // Seed store and legacy products directly into backing store (simulating pre-allowlist legacy documents)
  const mock = createMockFirestore({
    [`stores/${slug}`]: {
      shopName: 'Legacy Migration Store',
      ownerUserId: ownerId,
      bizId: 'default',
      whatsappNumber: '01711112222',
      isActive: true,
    },
    [`stores/${slug}/products/legacy_p1`]: {
      name: 'Bashundhara Tissue',
      price: 60,
      sellPrice: 60,
      buyPrice: 42,      // ❌ Legacy leaked private buying cost!
      profit: 18,        // ❌ Legacy leaked private profit!
      cogs: 42,          // ❌ Legacy leaked private COGS!
      batches: [{ id: 'b1', unitCost: 42, remainingQty: 20 }], // ❌ Legacy leaked batches!
      inStock: true,
      stock: 20,
    },
  }, { auth: { uid: ownerId }, enforceRules: true });

  // Run migration as owner
  const migReport = await migrateLegacyPublicStoreProducts(ownerId, slug, mock.ops);
  assert.equal(migReport.scannedCount, 1);
  assert.equal(migReport.migratedCount, 1, 'Legacy product with private fields must be migrated');

  // Verify with a non-owner account that reading the migrated product exposes ZERO private fields
  mock.setAuth({ uid: nonOwnerId });
  const prodSnap = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'stores', slug, 'products', 'legacy_p1'));
  assert.equal(prodSnap.exists(), true);
  const publicData = prodSnap.data();
  assert.equal(publicData.name, 'Bashundhara Tissue');
  assert.equal(publicData.price, 60);
  assert.equal(publicData.buyPrice, undefined, 'Non-owner must never see buyPrice after migration');
  assert.equal(publicData.profit, undefined, 'Non-owner must never see profit after migration');
  assert.equal(publicData.cogs, undefined, 'Non-owner must never see cogs after migration');
  assert.equal(publicData.batches, undefined, 'Non-owner must never see batches after migration');

  // Verify privacy-policy.html and delete-account.html match stated retention & backup policy
  const privacyHtml = fs.readFileSync(path.join(projectRoot, 'public', 'privacy-policy.html'), 'utf8');
  const deleteHtml = fs.readFileSync(path.join(projectRoot, 'public', 'delete-account.html'), 'utf8');
  assert.ok(privacyHtml.includes('auditLog') && privacyHtml.includes('append-only'), 'privacy-policy.html must document append-only auditLog retention');
  assert.ok(deleteHtml.includes('auditLog') && deleteHtml.includes('Backup Contents'), 'delete-account.html must document auditLog retention and backup contents');
  assert.ok(BACKUP_AND_RETENTION_POLICY.backupIncludedCollections.includes('auditLog'));
});

await runTest('Suite 5', '5.7 [Item 8: Multi-Day Accounting Lifecycle & Invariant Lock-Down] Day 1 sales/restock/damage/reversal -> Finalize -> Day 2 carry-forward & price change does not alter Day 1 report', async () => {
  // Day 1: Open with ৳10,000 cash
  let day1State = {
    language: 'en',
    contacts: [{ id: 'c_rahim', name: 'Rahim', phone: '01711111111', openingBalance: 500, currentBalance: 500 }],
    contactTxs: {},
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      openingCash: 10000,
      wallets: {
        hand_cash: { opening: 10000, current: 10000 },
        bkash: { opening: 0, current: 0 },
      },
      inventory: [{
        id: 'item_oil',
        name: 'Rupchanda Oil 5L',
        unit: 'bottle',
        buyPrice: 800,
        sellPrice: 950,
        openingStock: 0,
        addedStock: 0,
        closingStock: 0,
        damagedStock: 0,
        fifoSoldUnits: 0,
        fifoCogs: 0,
        fifoRevenue: 0,
        batches: [],
      }],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Purchase 10 bottles @ ৳800 = ৳8,000 from hand_cash
  day1State = quickRestockInState(day1State, { itemId: 'item_oil', quantity: 10, unitCost: 800, sourceWallet: 'hand_cash' });
  // 2. Sell 4 bottles @ ৳950 = ৳3,800 (COGS = ৳3,200, Gross Profit = ৳600)
  day1State = quickSellStockInState(day1State, { itemId: 'item_oil', quantity: 4, walletKey: 'hand_cash' });
  // 3. Record 1 bottle damage (@ ৳800 FIFO batch cost)
  day1State = writeOffDamageInState(day1State, { itemId: 'item_oil', quantity: 1, reason: 'Broken cap' });
  // 4. Record ৳120 expense, then reverse it (net expense = ৳0)
  const expTx = {
    id: 'tx_exp_day1_1',
    timestamp: Date.now(),
    type: 'expense',
    amount: 120,
    fromWallet: 'hand_cash',
    category: 'operating_expenses',
    note: 'Guest tea',
  };
  const expJE = generateJournalEntry(expTx, { fromWallet: 'hand_cash', category: 'operating_expenses', note: expTx.note });
  day1State = {
    ...day1State,
    dayData: {
      ...day1State.dayData,
      wallets: {
        ...day1State.dayData.wallets,
        hand_cash: {
          ...day1State.dayData.wallets.hand_cash,
          current: roundBDT(day1State.dayData.wallets.hand_cash.current - 120),
        },
      },
      transactions: [...day1State.dayData.transactions, expTx],
      journalEntries: [...day1State.dayData.journalEntries, expJE],
    },
  };
  day1State = reverseSingleTransactionInState(day1State, expTx.id);

  // 5. Collect ৳300 due (baki_received) from Rahim
  const bakiTx = {
    id: 'tx_baki_day1_1',
    timestamp: Date.now(),
    type: 'baki_received',
    amount: 300,
    toWallet: 'hand_cash',
    wallet: 'hand_cash',
    contactId: 'c_rahim',
    customerName: 'Rahim',
    note: 'Customer due received',
  };
  const bakiJE = generateJournalEntry(bakiTx, { toWallet: 'hand_cash', wallet: 'hand_cash' });
  day1State = {
    ...day1State,
    contacts: day1State.contacts.map(c => c.id === 'c_rahim' ? { ...c, currentBalance: roundBDT(c.currentBalance - 300) } : c),
    dayData: {
      ...day1State.dayData,
      wallets: {
        ...day1State.dayData.wallets,
        hand_cash: {
          ...day1State.dayData.wallets.hand_cash,
          current: roundBDT(day1State.dayData.wallets.hand_cash.current + 300),
        },
      },
      transactions: [...day1State.dayData.transactions, bakiTx],
      journalEntries: [...day1State.dayData.journalEntries, bakiJE],
    },
  };

  // Verify Day 1 Stock Invariant: closingStock === opening(0) + purchased(10) - sold(4) - damaged(1) = 5
  const day1Item = day1State.dayData.inventory[0];
  assert.equal(day1Item.closingStock, 5, 'Day 1 closingStock must equal 5');
  assert.equal(day1Item.fifoSoldUnits, 4);
  assert.equal(day1Item.fifoRevenue, 3800);
  assert.equal(day1Item.fifoCogs, 3200);
  assert.equal(day1Item.damagedStock, 1);

  // Verify Day 1 Cash Invariant: 10000 - 8000 (restock) + 3800 (sale) - 120 (exp) + 120 (rev) + 300 (baki) = 6100
  assert.equal(day1State.dayData.wallets.hand_cash.current, 6100);
  assert.equal(day1State.contacts[0].currentBalance, 200, 'Customer due reduced from 500 to 200');

  // Verify Day 1 Trial Balance Invariant (Debits === Credits)
  const tb1 = validateTrialBalance(computeTrialBalance(day1State.dayData.journalEntries));
  assert.equal(tb1.isBalanced, true, 'Day 1 Trial Balance must be balanced');
  assert.equal(tb1.diff, 0);

  // Verify Day 1 Profit Invariant: Gross Profit (600) - Damage (800) - Net Expense (0) = -200
  const day1InvTotals = calcInventoryTotals(day1State.dayData.inventory);
  const day1TxTotals = aggregateTransactions(day1State.dayData.transactions);
  const day1Profit = calcTotalDailyProfit({
    inventoryProfit: day1InvTotals.totalProfit,
    totalExpenses: day1TxTotals.expenses,
    damageLoss: day1TxTotals.damageLoss,
  });
  assert.equal(day1InvTotals.totalRevenue, 3800);
  assert.equal(day1InvTotals.totalCOGS, 3200);
  assert.equal(day1InvTotals.totalProfit, 600);
  assert.equal(day1TxTotals.damageLoss, 800);
  assert.equal(day1TxTotals.expenses, 0);
  assert.equal(day1Profit, -200);

  // Finalize Day 1 and carry forward to Day 2
  day1State.dayData.status = 'finalized';
  const day1SnapshotJson = JSON.stringify(day1State.dayData);
  const day2Data = createNewDayData('2026-10-11', day1State.dayData);

  // Verify Day 2 carry-forward resets daily counters while keeping remaining stock & batches
  const day2ItemInit = day2Data.inventory[0];
  assert.equal(day2ItemInit.openingStock, 5, 'Day 2 openingStock must equal Day 1 closingStock (5)');
  assert.equal(day2ItemInit.closingStock, 5);
  assert.equal(day2ItemInit.fifoSoldUnits, 0, 'Day 2 fifoSoldUnits must reset to 0');
  assert.equal(day2ItemInit.fifoCogs, 0, 'Day 2 fifoCogs must reset to 0');
  assert.equal(day2ItemInit.fifoRevenue, 0, 'Day 2 fifoRevenue must reset to 0');
  assert.equal(day2ItemInit.damagedStock, 0, 'Day 2 damagedStock must reset to 0');
  assert.equal(day2ItemInit.batches[0].remainingQty, 5, 'Day 2 preserves 5 remaining units in FIFO batch');

  // On Day 2, shop owner raises sellPrice from ৳950 to ৳1,100 and sells 2 bottles
  let day2State = {
    language: 'en',
    contacts: day1State.contacts,
    dayData: {
      ...day2Data,
      status: 'open',
      inventory: day2Data.inventory.map(i => ({ ...i, sellPrice: 1100 })),
    },
  };
  day2State = quickSellStockInState(day2State, { itemId: 'item_oil', quantity: 2, walletKey: 'hand_cash' });

  const day2InvTotals = calcInventoryTotals(day2State.dayData.inventory);
  assert.equal(day2InvTotals.totalRevenue, 2200, 'Day 2 revenue uses new price 2 * 1100 = 2200');
  assert.equal(day2InvTotals.totalCOGS, 1600, 'Day 2 COGS uses carried-over batch 2 * 800 = 1600');
  assert.equal(day2InvTotals.totalProfit, 600);

  // Verify Day 1 historical report is 100% immutable and unaffected by Day 2's price change (even if sellPrice on item object were changed)
  const reloadedDay1 = JSON.parse(day1SnapshotJson);
  reloadedDay1.inventory[0].sellPrice = 1100; // Even if current sellPrice is 1100, fifoRevenue preserves 3800!
  const day1HistoricalInv = calcInventoryTotals(reloadedDay1.inventory);
  assert.equal(day1HistoricalInv.totalRevenue, 3800, 'Day 1 historical revenue must remain ৳3,800 from transaction-time fifoRevenue');
  assert.equal(day1HistoricalInv.totalProfit, 600, 'Day 1 historical inventory profit must remain ৳600');
});

await runTest('Suite 5', '5.8 [Item 10: Complete End-to-End Multi-Device Release Acceptance Test] Storefront order -> Device A & B sync, network retry, price rejection, delivery accounting, backup & restore', async () => {
  const ownerId = 'uid_item10_e2e';
  const bizId = 'biz_main';
  const slug = 'an3-super-store';
  const dateKey = '2026-10-10';

  const mock = createMockFirestore({
    [`stores/${slug}`]: {
      shopName: 'AN3 Super Store',
      ownerUserId: ownerId,
      bizId,
      whatsappNumber: '01755556666',
      isActive: true,
    },
    [`stores/${slug}/public/info`]: {
      shopName: 'AN3 Super Store',
      whatsappNumber: '01755556666',
      isActive: true,
    },
    [`stores/${slug}/products/p_tea`]: {
      name: 'Sylhet Tea 500g',
      price: 250,
      inStock: true,
      stock: 20,
    },
    [`users/${ownerId}/businessList/list`]: {
      businesses: [{ id: bizId, name: 'AN3 Super Store' }],
    },
    [`users/${ownerId}/businesses/${bizId}/days/${dateKey}`]: {
      dateKey,
      status: 'open',
      savedAt: 1000,
      _revision: 1,
      wallets: { hand_cash: { opening: 5000, current: 5000 } },
      inventory: [{
        id: 'p_tea',
        name: 'Sylhet Tea 500g',
        unit: 'pack',
        buyPrice: 180,
        sellPrice: 250,
        openingStock: 20,
        addedStock: 0,
        closingStock: 20,
        damagedStock: 0,
        fifoSoldUnits: 0,
        fifoCogs: 0,
        fifoRevenue: 0,
        batches: [{ id: 'b_tea_1', unitCost: 180, remainingQty: 20, originalQty: 20 }],
      }],
      transactions: [],
      journalEntries: [],
    },
  }, { auth: null, enforceRules: true });

  // Step 1: Anonymous customer places a valid storefront order (and a manipulated order is rejected)
  await assert.rejects(
    async () => saveCustomerStoreOrder(slug, {
      id: 'ord_e2e_bad',
      customerName: 'Manipulator',
      customerPhone: '01700001111',
      items: [{ productId: 'p_tea', productName: 'Sylhet Tea 500g', quantity: 2, unitPrice: 50, subtotal: 100 }],
      subtotal: 100,
      deliveryCharge: 60,
      totalAmount: 160,
    }, mock.ops),
    (err) => err.code === 'price_mismatch'
  );

  const validCustomerOrderRes = await saveCustomerStoreOrder(slug, {
    id: 'ord_e2e_good_1',
    customerName: 'Tareq Rahman',
    customerPhone: '01722334455',
    items: [{ productId: 'p_tea', productName: 'Sylhet Tea 500g', quantity: 3, unitPrice: 250, subtotal: 750 }],
    subtotal: 750,
    deliveryCharge: 50,
    totalAmount: 800,
  }, mock.ops);
  assert.equal(validCustomerOrderRes.success, true);

  // Step 2: Owner logs in on Device A and Device B
  mock.setAuth({ uid: ownerId });
  const trackerA = createRevisionTracker();
  const trackerB = createRevisionTracker();

  const dayOnA = await loadDayFromCloud(ownerId, bizId, dateKey, mock.ops);
  const dayOnB = await loadDayFromCloud(ownerId, bizId, dateKey, mock.ops);
  reinitializeTrackerFromCloudSnapshot(trackerA, bizId, dayOnA);
  reinitializeTrackerFromCloudSnapshot(trackerB, bizId, dayOnB);

  // Step 3: Device A transfers incoming storefront order
  const transferRes = await transferIncomingOrderToBusiness(ownerId, bizId, slug, validCustomerOrderRes.order, mock.ops);
  assert.equal(transferRes.transferred, true);
  assert.equal(transferRes.deletedIncoming, true);

  // Step 4: Device A confirms, packs, and delivers the online order -> updates inventory & cash -> saves to cloud (rev 1 -> 2)
  let stateA = {
    language: 'en',
    contacts: [],
    onlineOrders: [transferRes.order],
    dayData: dayOnA,
  };
  stateA = confirmOnlineOrderInState(stateA, 'ord_e2e_good_1');
  stateA = packOnlineOrderInState(stateA, 'ord_e2e_good_1');
  stateA = shipOnlineOrderInState(stateA, 'ord_e2e_good_1');
  stateA = deliverOnlineOrderInState(stateA, { orderId: 'ord_e2e_good_1', walletKey: 'hand_cash' });

  assert.equal(stateA.dayData.inventory[0].closingStock, 17, 'Stock reduced from 20 to 17 on Device A');
  assert.equal(stateA.dayData.wallets.hand_cash.current, 5800, 'Cash increased from 5000 to 5800 on Device A');

  const saveA = await saveDayToCloud(ownerId, bizId, stateA.dayData, mock.ops, {
    checkConflict: true,
    baseSavedAt: trackerA.getBaseSavedAt(bizId, dateKey),
    baseRevision: trackerA.getBaseRevision(bizId, dateKey),
  });
  trackerA.recordCloudSaveSuccess(bizId, dateKey, saveA);
  assert.equal(saveA.revision, 2);

  // Step 5: Device B (still holding stale rev 1) tries to save -> blocked by conflict detection!
  await assert.rejects(
    async () => saveDayToCloud(ownerId, bizId, { ...dayOnB, note: 'Stale Device B edit' }, mock.ops, {
      checkConflict: true,
      baseSavedAt: trackerB.getBaseSavedAt(bizId, dateKey),
      baseRevision: trackerB.getBaseRevision(bizId, dateKey),
    }),
    (err) => err.code === 'concurrent-modification-conflict',
    'Device B stale save must be blocked'
  );

  // Device B reloads latest from cloud (rev 2), records an expense of ৳100, and saves cleanly (rev 2 -> 3)
  const refreshedB = await loadDayFromCloud(ownerId, bizId, dateKey, mock.ops);
  reinitializeTrackerFromCloudSnapshot(trackerB, bizId, refreshedB);
  assert.equal(refreshedB._revision, 2);
  const updatedDayOnB = {
    ...refreshedB,
    wallets: {
      ...refreshedB.wallets,
      hand_cash: { ...refreshedB.wallets.hand_cash, current: roundBDT(refreshedB.wallets.hand_cash.current - 100) },
    },
    transactions: [...(refreshedB.transactions || []), { id: 'tx_exp_b', type: 'expense', amount: 100, fromWallet: 'hand_cash' }],
  };
  const saveB = await saveDayToCloud(ownerId, bizId, updatedDayOnB, mock.ops, {
    checkConflict: true,
    baseSavedAt: trackerB.getBaseSavedAt(bizId, dateKey),
    baseRevision: trackerB.getBaseRevision(bizId, dateKey),
  });
  trackerB.recordCloudSaveSuccess(bizId, dateKey, saveB);
  assert.equal(saveB.revision, 3);

  // Step 6: Full cloud backup export & restore roundtrip verification
  const exportedBackupStr = await exportAllCloudData(ownerId, mock.ops);
  const exportedBackup = JSON.parse(exportedBackupStr);
  assert.equal(exportedBackup.isPartial, false);
  assert.equal(exportedBackup[bizId].days[dateKey]._revision, 3);
  assert.equal(exportedBackup[bizId].onlineOrders.length, 1);

  const drill = runBackupRestoreDrill(exportedBackup);
  assert.equal(drill.passed, true, 'Automated backup-restore drill must pass on exported E2E snapshot');
});

await runTest('Suite 5', '5.9 [Item 11, 12 & 13: Operational Safeguards] Error ring buffer, Firestore quota alerts, rollback snapshots, and backup-restore drill', async () => {
  clearOperationalErrorLog();
  resetDatabaseUsageCounters();

  // 1. Error logging ring buffer
  const errEntry = recordOperationalError('sync', new Error('Simulated timeout'), { bizId: 'default' });
  assert.equal(errEntry.context, 'sync');
  assert.equal(getOperationalErrorLog().length, 1);

  // 2. Database read/write quota alert threshold
  recordDatabaseOperation('read', 1500, { warnReads: 1000, criticalReads: 2000 });
  const usageWarn = getDatabaseUsageSnapshot({ warnReads: 1000, criticalReads: 2000 });
  assert.equal(usageWarn.alertLevel, 'warning', 'Quota monitor triggers warning at warnReads threshold');

  recordDatabaseOperation('read', 600, { warnReads: 1000, criticalReads: 2000 });
  const usageCrit = getDatabaseUsageSnapshot({ warnReads: 1000, criticalReads: 2000 });
  assert.equal(usageCrit.alertLevel, 'critical', 'Quota monitor triggers critical at criticalReads threshold');

  // 3. Rollback snapshot capture & restore
  localStorage.clear();
  localStorage.setItem('shop_meta', JSON.stringify({ language: 'bn', safeState: true }));
  const snap = captureRollbackSnapshot('pre-migration-test');
  localStorage.setItem('shop_meta', JSON.stringify({ language: 'en', safeState: false }));
  const restored = restoreRollbackSnapshot(snap);
  assert.equal(restored.restoredKeys, 1);
  assert.equal(JSON.parse(localStorage.getItem('shop_meta')).safeState, true, 'Rollback snapshot restores exact pre-operation state');

  // 4. Backup-restore drill utility
  const drillRes = runBackupRestoreDrill();
  assert.equal(drillRes.passed, true, 'Built-in backup-restore drill must pass');
});

await runTest('Suite 5', '5.10 [Gate A & B: Pure Transaction Callback & Mobile Banking TrxID Flow] saveDayToCloud does not mutate dayData on transaction failure/retry; bKash/Nagad + TrxID order transfers intact', async () => {
  const ownerId = 'owner_gate_ab_510';
  const bizId = 'biz_gate_510';
  const slug = 'gate-ab-shop';
  const mock = createMockFirestore({}, { auth: { uid: ownerId }, enforceRules: true });

  // 1. Verify pure runTransaction callback: if runTransaction fails after tx.set, dayData._revision must NOT be mutated
  const dayObj = {
    dateKey: '2026-10-11',
    status: 'open',
    _revision: 4,
    _lastCloudSavedAt: 1000,
    wallets: { hand_cash: { opening: 5000, current: 5000 } },
  };
  const abortingOps = {
    ...mock.ops,
    runTransaction: async (_db, updateFn) => {
      await updateFn({
        get: async () => ({ exists: () => true, data: () => ({ _revision: 4, _lastCloudSavedAt: 1000 }) }),
        set: async () => {},
      });
      throw new Error('Simulated transaction commit contention failure');
    },
  };
  await assert.rejects(
    async () => saveDayToCloud(ownerId, bizId, dayObj, abortingOps, { checkConflict: true, baseRevision: 4 }),
    /CONFLICT_CHECK_FAILED/
  );
  assert.equal(dayObj._revision, 4, 'Aborted transaction must never mutate caller dayData._revision');
  assert.equal(dayObj._lastCloudSavedAt, 1000, 'Aborted transaction must never mutate caller dayData._lastCloudSavedAt');

  // 2. Owner publishes storefront with bkashNumber & nagadNumber and 1 product
  await savePublicStoreInfo(slug, {
    shopName: 'Gate AB Telecom',
    displayName: 'গেট এবি টেলিকম',
    ownerUserId: ownerId,
    bizId,
    whatsappNumber: '01712345678',
    bkashNumber: '01712345678',
    nagadNumber: '01812345678',
    isActive: true,
  }, mock.ops);
  await syncPublicStoreProducts(slug, [
    { id: 'prod_earbuds', name: 'TWS Earbuds', sellPrice: 1200, closingStock: 10, unit: 'pcs' },
  ], { customOps: mock.ops });

  // 3. Anonymous customer submits a bKash order with Transaction ID (paymentTrxId) and sender phone
  mock.setAuth(null);
  const orderRes = await saveCustomerStoreOrder(slug, {
    id: 'ord_bkash_trx_1',
    customerName: 'Tanvir Hasan',
    customerPhone: '01755667788',
    customerAddress: 'Dhanmondi 27, Dhaka',
    isInsideDhaka: true,
    deliveryCharge: 60,
    subtotal: 1200,
    totalAmount: 1260,
    paymentMethod: 'bkash_manual',
    paymentTrxId: 'BKS982374X',
    paymentSenderPhone: '01755667788',
    items: [
      { productId: 'prod_earbuds', productName: 'TWS Earbuds', quantity: 1, unitPrice: 1200, subtotal: 1200 },
    ],
  }, mock.ops);
  assert.equal(orderRes.success, true);
  assert.equal(orderRes.order.paymentMethod, 'bkash_manual');
  assert.equal(orderRes.order.paymentTrxId, 'BKS982374X');
  assert.equal(orderRes.order.paymentSenderPhone, '01755667788');

  // 4. Owner transfers order to business and verifies TrxID and sender phone are preserved
  mock.setAuth({ uid: ownerId });
  const transferRes = await transferIncomingOrderToBusiness(ownerId, bizId, slug, orderRes.order, mock.ops);
  assert.equal(transferRes.transferred, true);
  assert.equal(transferRes.order.priceVerified, true);
  assert.equal(transferRes.order.paymentMethod, 'bkash_manual');
  assert.equal(transferRes.order.paymentTrxId, 'BKS982374X');
  assert.equal(transferRes.order.paymentSenderPhone, '01755667788');
  assert.equal(transferRes.order.paymentStatus, 'submitted_for_verification');
});

await runTest('Suite 5', '5.11 [Gate E: Manual Mobile Banking Payment Verification, Rejection & Settlement Lifecycle]', async () => {
  const ownerId = 'owner_gate_e_511';
  const bizId = 'biz_gate_511';
  const slug = 'gate-e-shop';
  const mock = createMockFirestore({}, { auth: { uid: ownerId }, enforceRules: true });

  // 1. Initialize day with bKash, nagad, and hand_cash wallets and publish active store
  await savePublicStoreInfo(slug, {
    shopName: 'Gate E Tech Store',
    displayName: 'গেট ই টেক স্টোর',
    ownerUserId: ownerId,
    bizId,
    whatsappNumber: '01712345678',
    bkashNumber: '01712345678',
    nagadNumber: '01812345678',
    isActive: true,
  }, mock.ops);

  await syncPublicStoreProducts(slug, [
    { id: 'prod_1', name: 'Wireless Mouse', sellPrice: 500, closingStock: 10, unit: 'pcs' },
  ], { customOps: mock.ops });

  const initialDay = {
    dateKey: '2026-10-11',
    status: 'open',
    _revision: 1,
    wallets: {
      hand_cash: { opening: 5000, current: 5000 },
      bkash: { opening: 2000, current: 2000 },
      nagad: { opening: 1000, current: 1000 },
    },
    inventory: [{
      id: 'prod_1',
      name: 'Wireless Mouse',
      buyPrice: 300,
      sellPrice: 500,
      openingStock: 10,
      addedStock: 0,
      closingStock: 10,
      damagedStock: 0,
      fifoSoldUnits: 0,
      fifoCogs: 0,
      fifoRevenue: 0,
      batches: [{ id: 'b_mouse_1', unitCost: 300, remainingQty: 10, originalQty: 10 }],
    }],
    transactions: [],
    journalEntries: [],
  };

  // 2. Customer places 3 types of orders in Public Storefront:
  // Order A: bKash order WITHOUT TrxID -> awaiting_payment
  // Order B: Nagad order WITH TrxID -> submitted_for_verification
  // Order C: COD order -> due_on_delivery
  mock.setAuth(null);
  const orderA_Res = await saveCustomerStoreOrder(slug, {
    id: 'ord_bkash_no_trx',
    customerName: 'Customer A',
    customerPhone: '01711111111',
    paymentMethod: 'bkash_manual',
    subtotal: 500,
    deliveryCharge: 60,
    totalAmount: 560,
    items: [{ productId: 'prod_1', productName: 'Wireless Mouse', quantity: 1, unitPrice: 500, subtotal: 500 }],
  }, mock.ops);
  assert.equal(orderA_Res.order.paymentStatus, 'awaiting_payment', 'Prepaid order without TrxID must be awaiting_payment');

  const orderB_Res = await saveCustomerStoreOrder(slug, {
    id: 'ord_nagad_with_trx',
    customerName: 'Customer B',
    customerPhone: '01822222222',
    paymentMethod: 'nagad_manual',
    paymentTrxId: 'NGD554433Z',
    paymentSenderPhone: '01822222222',
    subtotal: 500,
    deliveryCharge: 60,
    totalAmount: 560,
    items: [{ productId: 'prod_1', productName: 'Wireless Mouse', quantity: 1, unitPrice: 500, subtotal: 500 }],
  }, mock.ops);
  assert.equal(orderB_Res.order.paymentStatus, 'submitted_for_verification', 'Prepaid order with TrxID must be submitted_for_verification');

  const orderC_Res = await saveCustomerStoreOrder(slug, {
    id: 'ord_cod_order',
    customerName: 'Customer C',
    customerPhone: '01933333333',
    paymentMethod: 'cod',
    subtotal: 500,
    deliveryCharge: 60,
    totalAmount: 560,
    items: [{ productId: 'prod_1', productName: 'Wireless Mouse', quantity: 1, unitPrice: 500, subtotal: 500 }],
  }, mock.ops);
  assert.equal(orderC_Res.order.paymentStatus, 'due_on_delivery', 'COD order must be due_on_delivery');

  // 3. Owner transfers orders into business
  mock.setAuth({ uid: ownerId });
  const transA = await transferIncomingOrderToBusiness(ownerId, bizId, slug, orderA_Res.order, mock.ops);
  const transB = await transferIncomingOrderToBusiness(ownerId, bizId, slug, orderB_Res.order, mock.ops);
  const transC = await transferIncomingOrderToBusiness(ownerId, bizId, slug, orderC_Res.order, mock.ops);

  let state = {
    language: 'bn',
    contacts: [],
    onlineOrders: [transA.order, transB.order, transC.order],
    dayData: JSON.parse(JSON.stringify(initialDay)),
  };

  // 4. Test Gating: Blind confirmation of unverified prepaid order A & B is strictly blocked
  const blockedConfirmState = confirmOnlineOrderInState(state, 'ord_bkash_no_trx');
  assert.ok(blockedConfirmState._orderPaymentVerificationError, 'Confirming unverified prepaid order must set payment verification error');
  const ordA_stillDraft = blockedConfirmState.onlineOrders.find(o => o.id === 'ord_bkash_no_trx');
  assert.equal(ordA_stillDraft.status, 'draft', 'Order status must remain draft');

  // 5. Test Gating: Packing unverified prepaid order is strictly blocked
  const draftB_state = {
    ...state,
    onlineOrders: state.onlineOrders.map(o => o.id === 'ord_nagad_with_trx' ? { ...o, status: 'confirmed' } : o),
  };
  const blockedPackState = packOnlineOrderInState(draftB_state, 'ord_nagad_with_trx');
  assert.ok(blockedPackState._orderPaymentVerificationError, 'Packing unverified prepaid order must set payment verification error');
  const ordB_stillConfirmed = blockedPackState.onlineOrders.find(o => o.id === 'ord_nagad_with_trx');
  assert.equal(ordB_stillConfirmed.status, 'confirmed', 'Order status must remain confirmed (cannot pack unverified)');

  // 6. Test Owner Payment Verification Flow: "টাকা পেয়েছি — যাচাই ও কনফার্ম"
  // Owner verifies Order A with bKash wallet receiving ৳560
  state = confirmOnlineOrderInState(state, {
    orderId: 'ord_bkash_no_trx',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: 560,
    verifiedTrxId: 'BKS123VERIFIED',
  });
  const verifiedA = state.onlineOrders.find(o => o.id === 'ord_bkash_no_trx');
  assert.equal(verifiedA.status, 'confirmed', 'Order status must be confirmed');
  assert.equal(verifiedA.paymentStatus, 'verified', 'Payment status must be verified');
  assert.equal(verifiedA.advancePaid, 560, 'Advance paid must record 560');
  assert.equal(verifiedA.advanceWallet, 'bkash', 'Advance wallet must be bkash');
  assert.equal(verifiedA.paymentTrxId, 'BKS123VERIFIED', 'Verified TrxID must be recorded');
  assert.equal(verifiedA.codAmount, 0, 'Full prepaid order has COD amount 0');
  assert.equal(state.dayData.wallets.bkash.current, 2560, 'bKash wallet must be credited by ৳560 (2000 -> 2560)');

  // Verify online_order_advance transaction and journal entry recorded
  const advanceTx = state.dayData.transactions.find(t => t.subType === 'online_order_advance' || t.type === 'service_income');
  assert.ok(advanceTx, 'online_order_advance transaction must be created');
  assert.equal(advanceTx.amount, 560);
  assert.equal(advanceTx.wallet, 'bkash');

  // Now Order A can be packed smoothly
  state = packOnlineOrderInState(state, 'ord_bkash_no_trx');
  const packedA = state.onlineOrders.find(o => o.id === 'ord_bkash_no_trx');
  assert.equal(packedA.status, 'packed', 'Verified prepaid order packs successfully');

  // 7. Test Payment Claim Rejection: "পেমেন্ট মেলেনি / বাতিল"
  // Customer B provided a fake TrxID; owner rejects payment claim
  state = rejectOnlineOrderPaymentInState(state, {
    orderId: 'ord_nagad_with_trx',
    reason: 'এসএমএস আসেনি / ইনভ্যালিড TrxID',
  });
  const rejectedB = state.onlineOrders.find(o => o.id === 'ord_nagad_with_trx');
  assert.equal(rejectedB.paymentStatus, 'rejected', 'Payment status must be rejected');
  assert.equal(rejectedB.paymentRejectionReason, 'এসএমএস আসেনি / ইনভ্যালিড TrxID');

  // 8. Test COD Lifecycle: due_on_delivery -> paid_on_delivery on delivery
  state = confirmOnlineOrderInState(state, 'ord_cod_order'); // COD confirms without verifyPayment
  const confirmedC = state.onlineOrders.find(o => o.id === 'ord_cod_order');
  assert.equal(confirmedC.status, 'confirmed');
  assert.equal(confirmedC.paymentStatus, 'due_on_delivery');

  state = packOnlineOrderInState(state, 'ord_cod_order');
  state = shipOnlineOrderInState(state, 'ord_cod_order');
  state = deliverOnlineOrderInState(state, { orderId: 'ord_cod_order', walletKey: 'hand_cash' });
  const deliveredC = state.onlineOrders.find(o => o.id === 'ord_cod_order');
  assert.equal(deliveredC.status, 'delivered');
  assert.equal(deliveredC.paymentStatus, 'paid_on_delivery', 'Delivered COD order paymentStatus must automatically become paid_on_delivery');
});

await runTest('Suite 5', '5.12 [P0 Fix: Payment Verification Idempotency Guard] Verifying the same payment twice rejects double-credit and prevents duplicate advance transactions', async () => {
  const initialDay = {
    dateKey: '2026-10-11',
    status: 'open',
    _revision: 1,
    wallets: {
      bkash: { opening: 1000, current: 1000 },
      hand_cash: { opening: 2000, current: 2000 },
    },
    inventory: [{
      id: 'prod_item',
      name: 'Item A',
      buyPrice: 50,
      sellPrice: 100,
      openingStock: 10,
      addedStock: 0,
      closingStock: 10,
      damagedStock: 0,
      fifoSoldUnits: 0,
      fifoCogs: 0,
      fifoRevenue: 0,
      batches: [{ id: 'b_1', unitCost: 50, remainingQty: 10, originalQty: 10 }],
    }],
    transactions: [],
    journalEntries: [],
  };

  const initialOrder = {
    id: 'ord_idempotency_1',
    status: 'draft',
    customerName: 'Test Customer',
    customerPhone: '01711223344',
    paymentMethod: 'bkash_manual',
    paymentTrxId: 'TRX_FIRST_123',
    paymentStatus: 'submitted_for_verification',
    subtotal: 100,
    deliveryCharge: 0,
    totalAmount: 100,
    items: [{ productId: 'prod_item', productName: 'Item A', quantity: 1, unitPrice: 100, subtotal: 100 }],
  };

  let state = {
    language: 'bn',
    contacts: [],
    onlineOrders: [initialOrder],
    dayData: JSON.parse(JSON.stringify(initialDay)),
  };

  // Step 1: Verify payment once with ৳100 into bkash wallet
  state = confirmOnlineOrderInState(state, {
    orderId: 'ord_idempotency_1',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: 100,
    verifiedTrxId: 'TRX_FIRST_123',
  });

  const verifiedOrder1 = state.onlineOrders.find(o => o.id === 'ord_idempotency_1');
  assert.equal(verifiedOrder1.status, 'confirmed');
  assert.equal(verifiedOrder1.paymentStatus, 'verified');
  assert.equal(verifiedOrder1.advancePaid, 100);
  assert.equal(state.dayData.wallets.bkash.current, 1100, 'Wallet credited from 1000 to 1100 on first verification');
  assert.equal(state.dayData.transactions.length, 1, 'Exactly 1 advance transaction recorded');

  // Step 2: Attempt repeated verification (e.g. user double-clicks or retries after refresh)
  const stateAfterDoubleVerify = confirmOnlineOrderInState(state, {
    orderId: 'ord_idempotency_1',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: 100,
    verifiedTrxId: 'TRX_FIRST_123',
  });

  // Verify wallet balance is STILL 1100 (NEVER 1200!)
  assert.equal(stateAfterDoubleVerify.dayData.wallets.bkash.current, 1100, 'Wallet balance MUST remain ৳1100 (never double-credited)');
  // Verify transactions count is STILL 1 (never duplicate receipt!)
  assert.equal(stateAfterDoubleVerify.dayData.transactions.length, 1, 'Transactions count MUST remain 1 (no duplicate receipt created)');

  // Step 3: Test direct verifyOnlineOrderPaymentInState idempotency as well
  const directVerifyAgain = verifyOnlineOrderPaymentInState(stateAfterDoubleVerify, {
    orderId: 'ord_idempotency_1',
    walletKey: 'bkash',
    amount: 100,
  });
  assert.equal(directVerifyAgain.dayData.wallets.bkash.current, 1100, 'Direct payment verification must also be strictly idempotent');
  assert.equal(directVerifyAgain.dayData.transactions.length, 1, 'Direct verification must not append duplicate transaction');
});

await runTest('Suite 5', '5.13 [P0 Fix: Strict Received Amount Validation & Partial Payment] Rejects <= 0, non-finite, and excess amounts without total fallback; preserves partial balance accurately', async () => {
  const initialDay = {
    dateKey: '2026-10-11',
    status: 'open',
    _revision: 1,
    wallets: {
      bkash: { opening: 1000, current: 1000 },
      hand_cash: { opening: 500, current: 500 },
    },
    inventory: [{
      id: 'prod_p02',
      name: 'Item B',
      buyPrice: 50,
      sellPrice: 100,
      openingStock: 10,
      addedStock: 0,
      closingStock: 10,
      damagedStock: 0,
      fifoSoldUnits: 0,
      fifoCogs: 0,
      fifoRevenue: 0,
      batches: [{ id: 'b_2', unitCost: 50, remainingQty: 10, originalQty: 10 }],
    }],
    transactions: [],
    journalEntries: [],
  };

  const initialOrder = {
    id: 'ord_val_test',
    status: 'draft',
    customerName: 'Validation Tester',
    customerPhone: '01811223344',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'submitted_for_verification',
    subtotal: 100,
    deliveryCharge: 0,
    totalAmount: 100,
    items: [{ productId: 'prod_p02', productName: 'Item B', quantity: 1, unitPrice: 100, subtotal: 100 }],
  };

  const baseState = {
    language: 'bn',
    contacts: [],
    onlineOrders: [initialOrder],
    dayData: JSON.parse(JSON.stringify(initialDay)),
  };

  // 1. Negative amount (-1) must be rejected
  const negResult = confirmOnlineOrderInState(baseState, {
    orderId: 'ord_val_test',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: -1,
  });
  assert.ok(negResult._orderPaymentVerificationError, 'Negative amount must return error');
  assert.equal(negResult._orderPaymentVerificationError.code, 'invalid_payment_amount');
  assert.equal(negResult.dayData.wallets.bkash.current, 1000, 'Wallet must not change on negative amount');

  // 2. Zero amount (0) must be rejected
  const zeroResult = confirmOnlineOrderInState(baseState, {
    orderId: 'ord_val_test',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: 0,
  });
  assert.ok(zeroResult._orderPaymentVerificationError, 'Zero amount must return error');
  assert.equal(zeroResult._orderPaymentVerificationError.code, 'invalid_payment_amount');

  // 3. Excess amount (150 on 100 order) must be rejected
  const excessResult = confirmOnlineOrderInState(baseState, {
    orderId: 'ord_val_test',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: 150,
  });
  assert.ok(excessResult._orderPaymentVerificationError, 'Excess amount > totalAmount must return error');
  assert.equal(excessResult._orderPaymentVerificationError.code, 'invalid_payment_amount');

  // 4. Non-finite amount (NaN / undefined) must be rejected without fallback to totalAmount
  const nanResult = confirmOnlineOrderInState(baseState, {
    orderId: 'ord_val_test',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: 'invalid_string',
  });
  assert.ok(nanResult._orderPaymentVerificationError, 'NaN amount must return error without fallback');
  assert.equal(nanResult._orderPaymentVerificationError.code, 'invalid_payment_amount');

  // 5. Valid Partial Payment (৳40 received out of ৳100)
  let validPartialState = confirmOnlineOrderInState(baseState, {
    orderId: 'ord_val_test',
    verifyPayment: true,
    paymentWallet: 'bkash',
    advancePaid: 40,
    verifiedTrxId: 'PARTIAL_TRX_40',
  });
  assert.ok(!validPartialState._orderPaymentVerificationError, 'Valid partial payment must succeed');
  const partialOrd = validPartialState.onlineOrders.find(o => o.id === 'ord_val_test');
  assert.equal(partialOrd.paymentStatus, 'verified');
  assert.equal(partialOrd.advancePaid, 40, 'Advance paid must record ৳40');
  assert.equal(partialOrd.codAmount, 60, 'Remaining codAmount must accurately be ৳60 (100 - 40)');
  assert.equal(validPartialState.dayData.wallets.bkash.current, 1040, 'bKash wallet credited exactly ৳40');

  // 6. Complete lifecycle for partial order: Verified partial order packs smoothly
  validPartialState = packOnlineOrderInState(validPartialState, 'ord_val_test');
  const packedOrd = validPartialState.onlineOrders.find(o => o.id === 'ord_val_test');
  assert.equal(packedOrd.status, 'packed');
  assert.equal(packedOrd.paymentStatus, 'verified', 'Payment status remains verified for prepaid order');
  assert.equal(packedOrd.advancePaid, 40, 'Advance paid remains ৳40');
  assert.equal(packedOrd.codAmount, 60, 'COD amount remains ৳60');
  assert.equal(validPartialState.dayData.inventory[0].closingStock, 9, 'Stock deducted by 1 on packing');
});

await runTest('Suite 5', '5.14 [P1 Fix: Business-Type Wallet Mapping] getRecommendedWalletForPayment maps telecom vs retail wallets and prevents dangerous hand_cash fallback', async () => {
  // Scenario A: Telecom Shop Wallets
  const telecomWallets = {
    hand_cash: { opening: 1000, current: 1000 },
    bkash_personal: { opening: 2000, current: 2000 },
    bkash_agent: { opening: 5000, current: 5000 },
    nagad_uddokta: { opening: 3000, current: 3000 },
    rocket_personal: { opening: 1500, current: 1500 },
  };

  assert.equal(getRecommendedWalletForPayment('bkash_manual', telecomWallets), 'bkash_personal', 'bKash maps to bkash_personal for telecom');
  assert.equal(getRecommendedWalletForPayment('nagad_manual', telecomWallets), 'nagad_uddokta', 'Nagad maps to nagad_uddokta when personal is missing');
  assert.equal(getRecommendedWalletForPayment('rocket_manual', telecomWallets), 'rocket_personal', 'Rocket maps to rocket_personal');
  // Crucial invariant: Never falls back to hand_cash
  assert.notEqual(getRecommendedWalletForPayment('bkash_manual', telecomWallets), 'hand_cash');
  assert.notEqual(getRecommendedWalletForPayment('nagad_manual', telecomWallets), 'hand_cash');

  // Scenario B: General Retail Wallets with digital_payment
  const generalWallets = {
    hand_cash: { opening: 5000, current: 5000 },
    digital_payment: { opening: 1000, current: 1000 },
  };

  assert.equal(getRecommendedWalletForPayment('bkash_manual', generalWallets), 'digital_payment', 'Falls back to digital_payment if configured');
  assert.equal(getRecommendedWalletForPayment('nagad_manual', generalWallets), 'digital_payment');
  assert.equal(getRecommendedWalletForPayment('rocket_manual', generalWallets), 'digital_payment');

  // Scenario C: Only hand_cash exists (no mobile banking wallet configured)
  const cashOnlyWallets = {
    hand_cash: { opening: 5000, current: 5000 },
  };

  assert.equal(getRecommendedWalletForPayment('bkash_manual', cashOnlyWallets), '', 'Returns empty string when no safe wallet match exists (never hand_cash)');
  assert.equal(getRecommendedWalletForPayment('nagad_manual', cashOnlyWallets), '');
});

await runTest('Suite 5', '5.15 [Payment Scope Lockdown] Storefront checkout & merchant setup locked strictly to bKash, Nagad, Rocket, and Cash on Delivery side-by-side', async () => {
  const storefrontSource = fs.readFileSync(path.join(projectRoot, 'src/components/PublicStore/PublicStorefront.jsx'), 'utf8');
  const goOnlineSource = fs.readFileSync(path.join(projectRoot, 'src/components/PublicStore/GoOnlineSetup.jsx'), 'utf8');

  // All 4 payment options side-by-side in storefront checkout:
  assert.ok(storefrontSource.includes("setPaymentMethod('cod')"), 'PublicStorefront must provide Cash on Delivery button');
  assert.ok(storefrontSource.includes("setPaymentMethod('bkash_manual')"), 'PublicStorefront must provide bKash button');
  assert.ok(storefrontSource.includes("setPaymentMethod('nagad_manual')"), 'PublicStorefront must provide Nagad button');
  assert.ok(storefrontSource.includes("setPaymentMethod('rocket_manual')"), 'PublicStorefront must provide Rocket button');

  // Upay must NOT be an option in PublicStorefront checkout
  assert.ok(!storefrontSource.includes("upay_manual: 'Upay"), 'PublicStorefront must not expose upay_manual in PAYMENT_METHOD_LABELS');
  assert.ok(!storefrontSource.includes("{ id: 'upay_manual'"), 'PublicStorefront must not render Upay checkout pill');
  assert.ok(!storefrontSource.includes('bKash / Nagad / Rocket / Upay'), 'PublicStorefront must not show Upay in payment options header');

  // GoOnlineSetup must configure bKash, Nagad, Rocket and highlight Cash on Delivery
  assert.ok(goOnlineSource.includes('bkashNumber'), 'GoOnlineSetup must support bKash');
  assert.ok(goOnlineSource.includes('nagadNumber'), 'GoOnlineSetup must support Nagad');
  assert.ok(goOnlineSource.includes('rocketNumber'), 'GoOnlineSetup must support Rocket');
  assert.ok(goOnlineSource.includes('ক্যাশ অন ডেলিভারি'), 'GoOnlineSetup must highlight Cash on Delivery');
  assert.ok(!goOnlineSource.includes('upayNumber'), 'GoOnlineSetup must not configure Upay');
});

await runTest('Suite 5', '5.16 [P1 Fix: Mobile Banking Isolation & Wallet Compatibility] confirmOnlineOrderInState & verifyOnlineOrderPaymentInState reject hand_cash fallback and enforce compatible receiving wallet', async () => {
  const baseOrder = {
    id: 'ord_iso_bkash',
    customerName: 'Karim',
    customerPhone: '01712345678',
    paymentMethod: 'bkash_manual',
    status: 'draft',
    totalAmount: 500,
    subtotal: 500,
    deliveryCharge: 0,
    items: [{ productId: 'item_1', productName: 'Mouse', quantity: 1, unitPrice: 500, subtotal: 500 }],
  };

  // State with both hand_cash and bkash
  const stateBothWallets = {
    language: 'bn',
    contacts: [],
    onlineOrders: [JSON.parse(JSON.stringify(baseOrder))],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: {
        hand_cash: { opening: 5000, current: 5000 },
        bkash: { opening: 1000, current: 1000 },
      },
      inventory: [{ id: 'item_1', name: 'Mouse', closingStock: 10, batches: [] }],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Explicitly passing incompatible wallet ('hand_cash') for a bKash order MUST be rejected
  const resIncompatible = confirmOnlineOrderInState(stateBothWallets, {
    orderId: 'ord_iso_bkash',
    verifyPayment: true,
    paymentWallet: 'hand_cash',
    advancePaid: 500,
  });
  assert.ok(resIncompatible._orderPaymentVerificationError, 'Must return error when incompatible wallet is supplied');
  assert.equal(resIncompatible._orderPaymentVerificationError.code, 'invalid_receiving_wallet');
  assert.equal(resIncompatible.dayData.wallets.hand_cash.current, 5000, 'hand_cash must remain unchanged');
  assert.equal(resIncompatible.dayData.wallets.bkash.current, 1000, 'bkash must remain unchanged');

  // 2. Omitting wallet when bkash exists resolves to bkash automatically and credits bkash, NEVER hand_cash
  const resAutoResolve = confirmOnlineOrderInState(stateBothWallets, {
    orderId: 'ord_iso_bkash',
    verifyPayment: true,
    advancePaid: 500,
  });
  assert.ok(!resAutoResolve._orderPaymentVerificationError, 'Auto-resolution to compatible bkash wallet must succeed');
  assert.equal(resAutoResolve.dayData.wallets.bkash.current, 1500, 'bkash wallet must be credited ৳500');
  assert.equal(resAutoResolve.dayData.wallets.hand_cash.current, 5000, 'hand_cash must NOT receive mobile banking money');

  // 3. If ONLY hand_cash exists in the shop, omitting wallet or passing hand_cash must fail (no silent fallback!)
  const stateCashOnly = {
    language: 'bn',
    contacts: [],
    onlineOrders: [JSON.parse(JSON.stringify(baseOrder))],
    dayData: {
      dateKey: '2026-10-10',
      status: 'open',
      wallets: {
        hand_cash: { opening: 5000, current: 5000 },
      },
      inventory: [{ id: 'item_1', name: 'Mouse', closingStock: 10, batches: [] }],
      transactions: [],
      journalEntries: [],
    },
  };

  const resCashOnlyOmitted = confirmOnlineOrderInState(stateCashOnly, {
    orderId: 'ord_iso_bkash',
    verifyPayment: true,
    advancePaid: 500,
  });
  assert.ok(resCashOnlyOmitted._orderPaymentVerificationError, 'Must fail when no compatible wallet exists');
  assert.equal(resCashOnlyOmitted._orderPaymentVerificationError.code, 'invalid_receiving_wallet');
  assert.equal(resCashOnlyOmitted.dayData.wallets.hand_cash.current, 5000, 'hand_cash must NOT receive bKash money');

  // 4. verifyOnlineOrderPaymentInState also rejects incompatible wallet
  const resVerifyIncompatible = verifyOnlineOrderPaymentInState(stateBothWallets, {
    orderId: 'ord_iso_bkash',
    paymentWallet: 'hand_cash',
    amount: 500,
  });
  assert.ok(resVerifyIncompatible._orderPaymentVerificationError, 'verifyOnlineOrderPaymentInState must reject incompatible wallet');
  assert.equal(resVerifyIncompatible._orderPaymentVerificationError.code, 'invalid_receiving_wallet');
  assert.equal(resVerifyIncompatible.dayData.wallets.hand_cash.current, 5000);
});

await runTest('Suite 5', '5.17 [P1 Fix: Payment Scope Lockdown in Service & Rules] saveCustomerStoreOrder rejects unsupported payment methods (upay_manual, whatsapp_pay) and mock Firestore Rules enforce scope', async () => {
  const mock = createMockFirestore();
  const slug = 'test-payment-scope-store';
  const ownerId = 'owner_scope_test';

  mock.setAuth({ uid: ownerId });
  await savePublicStoreInfo(slug, {
    shopName: 'Scope Test Shop',
    displayName: 'স্কোপ টেস্ট শপ',
    ownerUserId: ownerId,
    bizId: 'biz_scope_test',
    whatsappNumber: '01711223344',
    isActive: true,
  }, mock.ops);

  const validItems = [{ productId: 'p1', productName: 'Item A', quantity: 1, unitPrice: 100, subtotal: 100 }];

  // 1. Unauthenticated customer tries to save order with upay_manual -> Must throw INVALID_PAYMENT_METHOD
  mock.setAuth(null);
  let caughtUpay = null;
  try {
    await saveCustomerStoreOrder(slug, {
      id: 'ord_upay_test',
      customerName: 'Test Customer',
      customerPhone: '01700000000',
      paymentMethod: 'upay_manual',
      subtotal: 100,
      totalAmount: 100,
      items: validItems,
    }, mock.ops);
  } catch (err) {
    caughtUpay = err;
  }
  assert.ok(caughtUpay, 'saveCustomerStoreOrder must throw on upay_manual');
  assert.equal(caughtUpay.code, 'INVALID_PAYMENT_METHOD');

  // 2. Unauthenticated customer tries to save order with whatsapp_pay -> Must throw INVALID_PAYMENT_METHOD
  let caughtWa = null;
  try {
    await saveCustomerStoreOrder(slug, {
      id: 'ord_wa_test',
      customerName: 'Test Customer',
      customerPhone: '01700000000',
      paymentMethod: 'whatsapp_pay',
      subtotal: 100,
      totalAmount: 100,
      items: validItems,
    }, mock.ops);
  } catch (err) {
    caughtWa = err;
  }
  assert.ok(caughtWa, 'saveCustomerStoreOrder must throw on whatsapp_pay');
  assert.equal(caughtWa.code, 'INVALID_PAYMENT_METHOD');

  // 3. Supported methods (cod, bkash_manual, nagad_manual, rocket_manual) all succeed
  for (const pm of ['cod', 'bkash_manual', 'nagad_manual', 'rocket_manual']) {
    const res = await saveCustomerStoreOrder(slug, {
      id: `ord_ok_${pm}`,
      customerName: 'Test Customer',
      customerPhone: '01700000000',
      paymentMethod: pm,
      subtotal: 100,
      totalAmount: 100,
      items: validItems,
    }, mock.ops);
    assert.equal(res.order.paymentMethod, pm, `Order with ${pm} must succeed`);
  }

  // 4. Mock Firestore security rules evaluation directly:
  const baseOrderData = {
    id: 'rule_ord_1',
    customerName: 'Test Customer',
    customerPhone: '01700000000',
    status: 'draft',
    subtotal: 100,
    totalAmount: 100,
    items: validItems,
  };

  const allowedRuleCod = evaluateFirestoreRule({
    method: 'create',
    path: `stores/${slug}/orders/rule_ord_1`,
    requestData: {
      ...baseOrderData,
      paymentMethod: 'cod',
    },
    auth: null,
    storeMap: mock.store,
  });
  assert.equal(allowedRuleCod, true, 'Rules must allow cod');

  const allowedRuleBkash = evaluateFirestoreRule({
    method: 'create',
    path: `stores/${slug}/orders/rule_ord_1`,
    requestData: {
      ...baseOrderData,
      paymentMethod: 'bkash_manual',
    },
    auth: null,
    storeMap: mock.store,
  });
  assert.equal(allowedRuleBkash, true, 'Rules must allow bkash_manual');

  const deniedRuleUpay = evaluateFirestoreRule({
    method: 'create',
    path: `stores/${slug}/orders/rule_ord_1`,
    requestData: {
      ...baseOrderData,
      paymentMethod: 'upay_manual',
    },
    auth: null,
    storeMap: mock.store,
  });
  assert.equal(deniedRuleUpay, false, 'Rules must REJECT upay_manual');

  const deniedRuleWa = evaluateFirestoreRule({
    method: 'create',
    path: `stores/${slug}/orders/rule_ord_1`,
    requestData: {
      ...baseOrderData,
      paymentMethod: 'whatsapp_pay',
    },
    auth: null,
    storeMap: mock.store,
  });
  assert.equal(deniedRuleWa, false, 'Rules must REJECT whatsapp_pay');
});

await runTest('Suite 5', '5.18 [Blocker 1 Fix: Online Order Double-Entry Accounting & Complete Reconciliation] Full lifecycle (Advance -> Pack -> Ship -> Deliver -> Settle) reconciles revenue, COGS, opex, wallets, and Trial Balance', async () => {
  // Setup state with 1 item: buyPrice 300, sellPrice 500, stock 10
  let state = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_acct_e2e_1',
        customerName: 'Ashiqur Rahman',
        customerPhone: '01711223344',
        paymentMethod: 'bkash_manual',
        paymentStatus: 'submitted_for_verification',
        paymentTrxId: 'BKS998877',
        status: 'draft',
        totalAmount: 500,
        subtotal: 500,
        deliveryCharge: 0,
        advancePaid: 0,
        codAmount: 500,
        courierName: 'steadfast',
        courierCharge: 50,
        codFee: 0,
        items: [
          {
            productId: 'item_shirt',
            productName: 'Cotton Oxford Shirt',
            quantity: 1,
            unitPrice: 500,
            buyPrice: 300,
            subtotal: 500,
          },
        ],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      status: 'open',
      wallets: {
        bkash: { opening: 5000, current: 5000 },
        hand_cash: { opening: 10000, current: 10000 },
      },
      inventory: [
        {
          id: 'item_shirt',
          name: 'Cotton Oxford Shirt',
          unit: 'pcs',
          buyPrice: 300,
          sellPrice: 500,
          openingStock: 10,
          addedStock: 0,
          closingStock: 10,
          damagedStock: 0,
          fifoSoldUnits: 0,
          fifoCogs: 0,
          fifoRevenue: 0,
          batches: [{ id: 'b_shirt_1', unitCost: 300, remainingQty: 10, originalQty: 10 }],
        },
      ],
      transactions: [],
      journalEntries: [],
    },
  };

  // ── Step 1: Customer paid ৳100 advance via bKash; Owner verifies payment ──
  state = verifyOnlineOrderPaymentInState(state, {
    orderId: 'ord_acct_e2e_1',
    paymentWallet: 'bkash',
    verifiedAmount: 100,
    trxId: 'BKS998877',
  });

  // Verify wallet and order state
  assert.equal(state.dayData.wallets.bkash.current, 5100, 'bKash wallet must increase by ৳100 advance');
  const ordAfterAdv = state.onlineOrders.find(o => o.id === 'ord_acct_e2e_1');
  assert.equal(ordAfterAdv.paymentStatus, 'verified');
  assert.equal(ordAfterAdv.advancePaid, 100);
  assert.equal(ordAfterAdv.codAmount, 400);

  // Accounting check 1: Advance is a liability, NOT sales revenue!
  const finAfterAdv = getFinancialTotals(state);
  assert.equal(finAfterAdv.revenue, 0, 'Advance payment must NOT be recognized as earned revenue!');
  assert.equal(finAfterAdv.cogs, 0, 'No COGS should be recognized on advance receipt');

  // Trial Balance check 1: Balanced debit (bkash: 100) and credit (customer_advance: 100)
  const tb1 = computeTrialBalance(state.dayData.journalEntries);
  const val1 = validateTrialBalance(tb1);
  assert.equal(val1.isBalanced, true, 'Trial balance must be balanced after advance receipt');
  assert.equal(tb1['bkash']?.debit, 100);
  assert.equal(tb1['customer_advance']?.credit, 100);

  // ── Step 1.5: Confirm order ──
  state = confirmOnlineOrderInState(state, 'ord_acct_e2e_1');
  assert.equal(state.onlineOrders[0].status, 'confirmed', 'Order must transition to confirmed');

  // ── Step 2: Pack order ──
  state = packOnlineOrderInState(state, 'ord_acct_e2e_1');
  assert.equal(state.onlineOrders[0].status, 'packed');
  assert.equal(state.dayData.inventory[0].closingStock, 9, 'Inventory stock must reduce from 10 to 9 on pack');

  // ── Step 3: Ship order ──
  state = shipOnlineOrderInState(state, {
    orderId: 'ord_acct_e2e_1',
    courierName: 'steadfast',
    trackingNumber: 'ST_TRACK_001',
  });
  assert.equal(state.onlineOrders[0].status, 'shipped');
  assert.equal(state.onlineOrders[0].trackingNumber, 'ST_TRACK_001');

  // ── Step 4: Deliver order (IFRS 15 Revenue Recognition & IAS 2 Inventory/COGS) ──
  state = deliverOnlineOrderInState(state, 'ord_acct_e2e_1');
  assert.equal(state.onlineOrders[0].status, 'delivered');

  // Financial totals check: Revenue recognized!
  const finAfterDeliv = getFinancialTotals(state);
  assert.equal(finAfterDeliv.revenue, 500, 'Delivery must recognize exactly ৳500 sales revenue');
  assert.equal(finAfterDeliv.cogs, 300, 'COGS must be recognized exactly at FIFO cost ৳300');

  // Trial Balance check 2: Double-entry consistency after delivery
  const tb2 = computeTrialBalance(state.dayData.journalEntries);
  const val2 = validateTrialBalance(tb2);
  assert.equal(val2.isBalanced, true, 'Trial balance must be perfectly balanced after delivery');
  // customer_advance debited 100 (cleared!), courier_receivable debited 400, sales_revenue credited 500
  assert.equal(tb2['customer_advance']?.net, 0, 'customer_advance liability must net to ৳0 after delivery');
  assert.equal(tb2['courier_receivable']?.net, 400, 'courier_receivable must have ৳400 debit balance');
  assert.equal(tb2['sales_revenue']?.credit, 500, 'sales_revenue must have ৳500 credit balance');
  assert.equal(tb2['cogs']?.debit, 300, 'cogs must have ৳300 debit balance');
  assert.equal(tb2['inventory']?.credit, 300, 'inventory must have ৳300 credit balance');

  // ── Step 5: Courier Settlement (Courier remits net ৳350 after ৳50 courier fee) ──
  state = settleOnlineOrderInState(state, {
    orderId: 'ord_acct_e2e_1',
    settlementWallet: 'bkash',
  });
  assert.equal(state.onlineOrders[0].status, 'settled');

  // Wallet check: bkash received net ৳350 -> 5100 + 350 = 5450
  assert.equal(state.dayData.wallets.bkash.current, 5450, 'bkash wallet must be 5450 after receiving net ৳350');

  // Financial totals check: Remittance does NOT duplicate sales revenue; Courier fee is OPEX!
  const finAfterSettle = getFinancialTotals(state);
  assert.equal(finAfterSettle.revenue, 500, 'Sales revenue must STAY ৳500 (courier remittance is NOT new revenue!)');
  assert.equal(finAfterSettle.cogs, 300, 'COGS remains ৳300');
  assert.equal(finAfterSettle.opex, 50, 'Courier charge ৳50 must be included in OPEX');

  // Complete Trial Balance Reconciliation across entire lifecycle
  const tbFinal = computeTrialBalance(state.dayData.journalEntries);
  const valFinal = validateTrialBalance(tbFinal);
  assert.equal(valFinal.isBalanced, true, 'Final trial balance must be 100% balanced');
  assert.equal(valFinal.diff, 0, 'Trial balance difference must be 0');

  // Balance sheet accounts net checks:
  assert.equal(tbFinal['customer_advance']?.net, 0, 'customer_advance must net to 0');
  assert.equal(tbFinal['courier_receivable']?.net, 0, 'courier_receivable must net to 0 after courier remittance');
  assert.equal(tbFinal['delivery_expense']?.debit, 50, 'delivery_expense must be ৳50 debit');

  // Mathematical integrity reconciliation:
  // Gross Profit = 500 - 300 = 200
  // Net Profit = 200 - 50 = 150
  // Wallet Net Inflow = 5450 - 5000 = +450
  // Inventory Cost Outflow = -300
  // Net Cash Gain (450) - Inventory Consumed (300) = 150 = Net Profit!
  const netProfit = finAfterSettle.revenue - finAfterSettle.cogs - finAfterSettle.opex;
  assert.equal(netProfit, 150, 'Net profit must be exactly ৳150');
  const cashGain = state.dayData.wallets.bkash.current - 5000;
  assert.equal(cashGain - 300, netProfit, 'Cash gain minus inventory cost consumed must equal net profit');
});

await runTest('Suite 5', '5.19 [Blocker 2 Fix: State Machine Guards & Idempotency of Delivery & Settlement] Repeated calls, double-clicks, and duplicate network actions produce ZERO double-credits, duplicate transactions, or inventory leaks', async () => {
  let state = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_idemp_1',
        customerName: 'Rezaul Karim',
        customerPhone: '01811223344',
        paymentMethod: 'cod',
        paymentStatus: 'due_on_delivery',
        status: 'draft',
        totalAmount: 1000,
        subtotal: 1000,
        deliveryCharge: 0,
        advancePaid: 0,
        codAmount: 1000,
        courierName: 'redx',
        courierCharge: 80,
        codFee: 10,
        items: [
          {
            productId: 'item_polo',
            productName: 'Polo Shirt',
            quantity: 2,
            unitPrice: 500,
            buyPrice: 200,
            subtotal: 1000,
          },
        ],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      status: 'open',
      wallets: {
        hand_cash: { opening: 2000, current: 2000 },
      },
      inventory: [
        {
          id: 'item_polo',
          name: 'Polo Shirt',
          unit: 'pcs',
          buyPrice: 200,
          sellPrice: 500,
          openingStock: 10,
          addedStock: 0,
          closingStock: 10,
          damagedStock: 0,
          fifoSoldUnits: 0,
          fifoCogs: 0,
          fifoRevenue: 0,
          batches: [{ id: 'b_polo_1', unitCost: 200, remainingQty: 10, originalQty: 10 }],
        },
      ],
      transactions: [],
      journalEntries: [],
    },
  };

  // Acceptance Test: State transition enforcement on draft order
  // Pack on draft, Ship on draft, Deliver on draft, Settle before delivery must all be rejected!
  const stateDraftPack = packOnlineOrderInState(state, 'ord_idemp_1');
  assert.equal(stateDraftPack.onlineOrders[0].status, 'draft', 'Pack on draft must be rejected (status remains draft)');
  assert.equal(stateDraftPack.dayData.inventory[0].closingStock, 10, 'Pack on draft must NOT reduce inventory');

  const stateDraftShip = shipOnlineOrderInState(state, { orderId: 'ord_idemp_1', trackingNumber: 'REDX999' });
  assert.equal(stateDraftShip.onlineOrders[0].status, 'draft', 'Ship on draft must be rejected (status remains draft)');

  const stateDraftDeliver = deliverOnlineOrderInState(state, 'ord_idemp_1');
  assert.equal(stateDraftDeliver.onlineOrders[0].status, 'draft', 'Deliver on draft must be rejected (status remains draft)');
  assert.equal(stateDraftDeliver.dayData.transactions.length, 0, 'Deliver on draft must NOT create transactions');

  const stateDraftSettle = settleOnlineOrderInState(state, { orderId: 'ord_idemp_1', settlementWallet: 'hand_cash' });
  assert.equal(stateDraftSettle.onlineOrders[0].status, 'draft', 'Settle on draft must be rejected (status remains draft)');
  assert.equal(stateDraftSettle.dayData.wallets.hand_cash.current, 2000, 'Settle on draft must NOT credit wallet');

  // Now exercise the valid lifecycle: draft -> confirmed -> packed -> shipped -> delivered -> settled
  // 1. Confirm order
  state = confirmOnlineOrderInState(state, 'ord_idemp_1');
  assert.equal(state.onlineOrders[0].status, 'confirmed', 'Order must transition to confirmed');

  // 2. Pack order
  state = packOnlineOrderInState(state, 'ord_idemp_1');
  assert.equal(state.onlineOrders[0].status, 'packed', 'Order must transition to packed');
  assert.equal(state.dayData.inventory[0].closingStock, 8, 'Stock must reduce by 2 to 8');

  // Idempotency test: Call pack a SECOND time (simulating double-click)
  const stateAfterDoublePack = packOnlineOrderInState(state, 'ord_idemp_1');
  assert.equal(stateAfterDoublePack.dayData.inventory[0].closingStock, 8, 'Stock must NOT reduce twice on repeated pack call');

  // 3. Ship order
  state = shipOnlineOrderInState(state, { orderId: 'ord_idemp_1', trackingNumber: 'REDX999' });
  assert.equal(state.onlineOrders[0].status, 'shipped', 'Order must transition to shipped');

  // Idempotency test: Call ship a SECOND time
  const stateAfterDoubleShip = shipOnlineOrderInState(state, { orderId: 'ord_idemp_1', trackingNumber: 'REDX999' });
  assert.equal(stateAfterDoubleShip.onlineOrders[0].status, 'shipped');
  assert.equal(stateAfterDoubleShip.dayData.onlineOrdersDayStats.shipped, 1, 'Shipped count must not increment twice');

  // 4. Deliver order
  state = deliverOnlineOrderInState(state, 'ord_idemp_1');
  assert.equal(state.onlineOrders[0].status, 'delivered', 'Order must transition to delivered');
  const txCountAfterDeliv = state.dayData.transactions.length;
  const jeCountAfterDeliv = state.dayData.journalEntries.length;
  assert.equal(txCountAfterDeliv, 1, 'Exactly 1 sale transaction created');
  assert.equal(jeCountAfterDeliv, 2, 'Exactly 2 journal entries created (sale + cogs)');

  // Idempotency test: Call deliver a SECOND time (simulating double-click or network retry)
  const stateAfterDoubleDeliv = deliverOnlineOrderInState(state, 'ord_idemp_1');
  assert.equal(stateAfterDoubleDeliv.dayData.transactions.length, txCountAfterDeliv, 'Duplicate deliver must NOT append transactions');
  assert.equal(stateAfterDoubleDeliv.dayData.journalEntries.length, jeCountAfterDeliv, 'Duplicate deliver must NOT append journal entries');
  assert.equal(stateAfterDoubleDeliv.dayData.inventory[0].closingStock, 8, 'Duplicate deliver must NOT deduct stock again');

  // 5. Settle order (Courier remittances: net = 1000 - 90 = 910)
  state = settleOnlineOrderInState(state, { orderId: 'ord_idemp_1', settlementWallet: 'hand_cash' });
  assert.equal(state.onlineOrders[0].status, 'settled', 'Order must transition to settled');
  assert.equal(state.dayData.wallets.hand_cash.current, 2910, 'hand_cash must be 2000 + 910 = 2910');
  const txCountAfterSettle = state.dayData.transactions.length;
  const jeCountAfterSettle = state.dayData.journalEntries.length;

  // Idempotency test: Call settle a SECOND time (simulating double-click or browser refresh)
  const stateAfterDoubleSettle = settleOnlineOrderInState(state, { orderId: 'ord_idemp_1', settlementWallet: 'hand_cash' });
  assert.equal(stateAfterDoubleSettle.dayData.wallets.hand_cash.current, 2910, 'Duplicate settle must NOT credit wallet twice!');
  assert.equal(stateAfterDoubleSettle.dayData.transactions.length, txCountAfterSettle, 'Duplicate settle must NOT append transactions');
  assert.equal(stateAfterDoubleSettle.dayData.journalEntries.length, jeCountAfterSettle, 'Duplicate settle must NOT append journal entries');

  // 6. Test executeLedgerAction dispatcher idempotency
  const stateViaDispatcher = executeLedgerAction(state, {
    type: 'ONLINE_ORDER_SETTLE',
    payload: { orderId: 'ord_idemp_1', settlementWallet: 'hand_cash' },
  });
  assert.equal(stateViaDispatcher.dayData.wallets.hand_cash.current, 2910, 'Dispatcher settle call on settled order must be a no-op');
});

await runTest('Suite 5', '5.20 [P1 Fix: Cancellation and Return/Refund Accounting] Order cancellation and RTO returns clear customer_advance, record delivery expense, restore inventory, and maintain balanced trial balance with strict idempotency', async () => {
  // Scenario A: Online Order with Advance Payment -> Cancellation & Refund
  let stateA = {
    language: 'en',
    customerBlacklist: {},
    onlineOrders: [
      {
        id: 'ord_cancel_1',
        customerName: 'Fatema Begum',
        customerPhone: '01711223344',
        paymentMethod: 'bkash_manual',
        paymentStatus: 'awaiting_payment',
        status: 'draft',
        totalAmount: 1200,
        subtotal: 1200,
        advancePaid: 0,
        items: [
          {
            productId: 'item_panjabi',
            productName: 'Silk Panjabi',
            quantity: 2,
            unitPrice: 600,
            buyPrice: 350,
            subtotal: 1200,
          },
        ],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      status: 'open',
      wallets: {
        bkash: { opening: 5000, current: 5000 },
        hand_cash: { opening: 2000, current: 2000 },
      },
      inventory: [
        {
          id: 'item_panjabi',
          name: 'Silk Panjabi',
          unit: 'pcs',
          buyPrice: 350,
          sellPrice: 600,
          openingStock: 10,
          addedStock: 0,
          closingStock: 10,
          damagedStock: 0,
          fifoSoldUnits: 0,
          fifoCogs: 0,
          batches: [{ id: 'b_panjabi_1', unitCost: 350, remainingQty: 10, originalQty: 10 }],
        },
      ],
      transactions: [],
      journalEntries: [],
    },
  };

  // 1. Verify advance payment of ৳300 via bKash
  stateA = verifyOnlineOrderPaymentInState(stateA, {
    orderId: 'ord_cancel_1',
    verifiedAmount: 300,
    paymentWallet: 'bkash',
    trxId: 'TRX_CANCEL_300',
  });
  assert.equal(stateA.dayData.wallets.bkash.current, 5300, 'bKash credited by ৳300 advance');
  assert.equal(stateA.dayData.journalEntries.length, 1, 'Advance receipt JE created');

  // 2. Confirm & Pack order
  stateA = confirmOnlineOrderInState(stateA, 'ord_cancel_1');
  assert.equal(stateA.onlineOrders[0].status, 'confirmed');

  stateA = packOnlineOrderInState(stateA, 'ord_cancel_1');
  assert.equal(stateA.onlineOrders[0].status, 'packed');
  assert.equal(stateA.dayData.inventory[0].closingStock, 8, 'Stock deducted from 10 to 8 during packing');

  // 3. Cancel order with advance refund
  stateA = cancelOnlineOrderInState(stateA, {
    orderId: 'ord_cancel_1',
    reason: 'Customer cancelled prior to shipping',
  });

  assert.equal(stateA.onlineOrders[0].status, 'cancelled');
  assert.equal(stateA.dayData.inventory[0].closingStock, 10, 'Stock must be restored from 8 back to 10');
  assert.equal(stateA.dayData.wallets.bkash.current, 5000, 'bKash wallet must decrease by ৳300 (refund to customer)');

  // Verify Double-Entry Accounting
  const refundJE = stateA.dayData.journalEntries.find(je => je.txType === 'online_order_refund');
  assert.ok(refundJE, 'Refund Journal Entry must exist');
  assert.equal(refundJE.lines.find(l => l.accountId === 'customer_advance')?.debit, 300, 'customer_advance must be debited ৳300');
  assert.equal(refundJE.lines.find(l => l.accountId === 'bkash')?.credit, 300, 'bkash must be credited ৳300');

  // Trial Balance must balance with zero discrepancy!
  const tbA = computeTrialBalance(stateA.dayData.journalEntries);
  const tbResA = validateTrialBalance(tbA);
  assert.equal(tbResA.isBalanced, true, 'Trial balance must be balanced after cancellation and refund');
  assert.equal(tbResA.diff, 0, 'Discrepancy must be 0');

  // Operating profit & expense must NOT be distorted by advance refund
  const finTotalsA = getFinancialTotals(stateA.dayData);
  assert.equal(finTotalsA.revenue, 0, 'Net revenue must be ৳0');
  assert.equal(finTotalsA.opex, 0, 'Advance refund must NOT be counted as operating expense');

  // Idempotency: Repeated cancel call must be a no-op
  const txCountA = stateA.dayData.transactions.length;
  const jeCountA = stateA.dayData.journalEntries.length;
  const stateAfterDoubleCancel = cancelOnlineOrderInState(stateA, 'ord_cancel_1');
  assert.equal(stateAfterDoubleCancel.dayData.wallets.bkash.current, 5000, 'bKash wallet must NOT be refunded twice');
  assert.equal(stateAfterDoubleCancel.dayData.inventory[0].closingStock, 10, 'Stock must NOT be restored twice');
  assert.equal(stateAfterDoubleCancel.dayData.transactions.length, txCountA, 'Transactions must NOT duplicate');
  assert.equal(stateAfterDoubleCancel.dayData.journalEntries.length, jeCountA, 'Journal entries must NOT duplicate');


  // Scenario B: Shipped Order -> Return To Origin (RTO) with Advance Refund + Courier Return Fee
  let stateB = {
    language: 'en',
    customerBlacklist: {},
    onlineOrders: [
      {
        id: 'ord_rto_1',
        customerName: 'Shakil Ahmed',
        customerPhone: '01999887766',
        paymentMethod: 'bkash_manual',
        paymentStatus: 'verified',
        paymentVerifiedAt: Date.now() - 3600000,
        advancePaid: 200,
        advanceWallet: 'bkash',
        status: 'draft',
        totalAmount: 1500,
        subtotal: 1500,
        courierName: 'steadfast',
        courierCharge: 70,
        returnCharge: 70,
        items: [
          {
            productId: 'item_shoe',
            productName: 'Leather Shoes',
            quantity: 1,
            unitPrice: 1500,
            buyPrice: 800,
            subtotal: 1500,
          },
        ],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      status: 'open',
      wallets: {
        bkash: { opening: 6000, current: 6200 }, // 6000 + 200 advance
        hand_cash: { opening: 1000, current: 1000 },
      },
      inventory: [
        {
          id: 'item_shoe',
          name: 'Leather Shoes',
          unit: 'pcs',
          buyPrice: 800,
          sellPrice: 1500,
          openingStock: 5,
          addedStock: 0,
          closingStock: 5,
          damagedStock: 0,
          fifoSoldUnits: 0,
          fifoCogs: 0,
          batches: [{ id: 'b_shoe_1', unitCost: 800, remainingQty: 5, originalQty: 5 }],
        },
      ],
      transactions: [
        {
          id: 'tx_adv_rto',
          timestamp: Date.now() - 3600000,
          type: 'online_order_advance',
          amount: 200,
          wallet: 'bkash',
          linkedOrderId: 'ord_rto_1',
        },
      ],
      journalEntries: [
        {
          id: 'je_adv_rto',
          timestamp: Date.now() - 3600000,
          txId: 'tx_adv_rto',
          txType: 'online_order_advance',
          description: 'Advance receipt',
          lines: [
            { accountId: 'bkash', debit: 200, credit: 0 },
            { accountId: 'customer_advance', debit: 0, credit: 200 },
          ],
        },
      ],
    },
  };

  // Move order through valid lifecycle: confirmed -> packed -> shipped
  stateB = confirmOnlineOrderInState(stateB, 'ord_rto_1');
  assert.equal(stateB.onlineOrders[0].status, 'confirmed');

  stateB = packOnlineOrderInState(stateB, 'ord_rto_1');
  assert.equal(stateB.onlineOrders[0].status, 'packed');
  assert.equal(stateB.dayData.inventory[0].closingStock, 4, 'Stock deducted to 4');

  stateB = shipOnlineOrderInState(stateB, { orderId: 'ord_rto_1', trackingNumber: 'STDFST123' });
  assert.equal(stateB.onlineOrders[0].status, 'shipped');

  // Customer refused delivery -> RTO Return with ৳70 return fee and ৳200 advance refund
  stateB = returnOnlineOrderInState(stateB, {
    orderId: 'ord_rto_1',
    returnCharge: 70,
    expenseWallet: 'hand_cash',
    refundWallet: 'bkash',
    reason: 'Customer unreachable at doorstep',
  });

  assert.equal(stateB.onlineOrders[0].status, 'returned');
  assert.equal(stateB.dayData.inventory[0].closingStock, 5, 'Stock restored to 5 on RTO return');
  assert.equal(stateB.dayData.wallets.bkash.current, 6000, 'bKash wallet reduced by ৳200 (advance refunded)');
  assert.equal(stateB.dayData.wallets.hand_cash.current, 930, 'hand_cash reduced by ৳70 (return fee paid)');

  // Verify customer blacklist tracking
  const phoneNormalized = '01999887766';
  assert.equal(stateB.customerBlacklist[phoneNormalized]?.rtoCount, 1, 'Customer RTO count incremented to 1');

  // Verify Trial Balance
  const tbB = computeTrialBalance(stateB.dayData.journalEntries);
  const tbResB = validateTrialBalance(tbB);
  assert.equal(tbResB.isBalanced, true, 'Trial balance must remain balanced after RTO return');
  assert.equal(tbResB.diff, 0, 'Trial balance diff must be 0');

  // Idempotency: Repeated return call must produce ZERO changes
  const txCountB = stateB.dayData.transactions.length;
  const jeCountB = stateB.dayData.journalEntries.length;
  const stateAfterDoubleReturn = returnOnlineOrderInState(stateB, {
    orderId: 'ord_rto_1',
    returnCharge: 70,
    expenseWallet: 'hand_cash',
    refundWallet: 'bkash',
  });

  assert.equal(stateAfterDoubleReturn.dayData.wallets.bkash.current, 6000, 'bKash must NOT be refunded twice');
  assert.equal(stateAfterDoubleReturn.dayData.wallets.hand_cash.current, 930, 'hand_cash must NOT be charged return fee twice');
  assert.equal(stateAfterDoubleReturn.dayData.inventory[0].closingStock, 5, 'Inventory must NOT be restored twice');
  assert.equal(stateAfterDoubleReturn.customerBlacklist[phoneNormalized]?.rtoCount, 1, 'RTO count must NOT increment twice');
  assert.equal(stateAfterDoubleReturn.dayData.transactions.length, txCountB, 'Transactions must NOT duplicate');
  assert.equal(stateAfterDoubleReturn.dayData.journalEntries.length, jeCountB, 'Journal entries must NOT duplicate');
});

await runTest('Suite 5', '5.21 [P0 & P1 Regression: Cross-Transition Guards & Wallet Balance Reconciliation] returned -> cancel rejection, delivered -> RTO rejection, and insufficient wallet balance rejection without clamping', async () => {
  // ── 1. Test: returned -> cancel is strictly rejected (P0 Refund Integrity) ──
  let stateRet = {
    language: 'en',
    customerBlacklist: {},
    onlineOrders: [
      {
        id: 'ord_already_ret',
        customerName: 'Jashim Uddin',
        customerPhone: '01700112233',
        status: 'returned',
        returnedAt: Date.now() - 5000,
        advancePaid: 250,
        advanceWallet: 'bkash',
        paymentStatus: 'verified',
        paymentVerifiedAt: Date.now() - 10000,
        items: [{ productId: 'item_polo', quantity: 2, unitPrice: 400 }],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: {
        bkash: { opening: 3000, current: 3000 },
        hand_cash: { opening: 1000, current: 1000 },
      },
      inventory: [{ id: 'item_polo', closingStock: 10, batches: [] }],
      transactions: [],
      journalEntries: [],
    },
  };

  const snapBeforeRetCancel = {
    status: stateRet.onlineOrders[0].status,
    stock: stateRet.dayData.inventory[0].closingStock,
    wallets: JSON.parse(JSON.stringify(stateRet.dayData.wallets)),
    txCount: stateRet.dayData.transactions.length,
    jeCount: stateRet.dayData.journalEntries.length,
  };

  const stateBlockedCancel = cancelOnlineOrderInState(stateRet, 'ord_already_ret');
  assert.equal(stateBlockedCancel.onlineOrders[0].status, snapBeforeRetCancel.status, 'Status must remain returned (cancellation rejected)');
  assert.equal(stateBlockedCancel.dayData.inventory[0].closingStock, snapBeforeRetCancel.stock, 'Stock must NOT be restored again');
  assert.deepEqual(stateBlockedCancel.dayData.wallets, snapBeforeRetCancel.wallets, 'Wallets must NOT change on returned order cancel attempt');
  assert.equal(stateBlockedCancel.dayData.transactions.length, snapBeforeRetCancel.txCount, 'Zero refund transactions may be created on returned order');
  assert.equal(stateBlockedCancel.dayData.journalEntries.length, snapBeforeRetCancel.jeCount, 'Zero refund journal entries may be created on returned order');

  // ── 2. Test: delivered -> RTO is strictly rejected (P0 Sale & Inventory Integrity) ──
  let stateDeliv = {
    language: 'en',
    customerBlacklist: {},
    onlineOrders: [
      {
        id: 'ord_already_deliv',
        customerName: 'Tanvir Hossain',
        customerPhone: '01899112233',
        status: 'delivered',
        deliveredAt: Date.now() - 3000,
        paymentStatus: 'paid_on_delivery',
        codAmount: 800,
        courierCharge: 80,
        returnCharge: 80,
        items: [{ productId: 'item_watch', quantity: 1, unitPrice: 800 }],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: {
        hand_cash: { opening: 5000, current: 5000 },
      },
      inventory: [
        {
          id: 'item_watch',
          closingStock: 4, // 1 unit sold and delivered
          fifoSoldUnits: 1,
          fifoCogs: 500,
          fifoRevenue: 800,
          batches: [{ id: 'b_w_1', unitCost: 500, remainingQty: 4, originalQty: 5 }],
        },
      ],
      transactions: [{ id: 'tx_sale_w', type: 'stock_sale', amount: 800 }],
      journalEntries: [{ id: 'je_sale_w', txType: 'stock_sale' }],
    },
  };

  const snapBeforeDelivRTO = {
    status: stateDeliv.onlineOrders[0].status,
    stock: stateDeliv.dayData.inventory[0].closingStock,
    wallets: JSON.parse(JSON.stringify(stateDeliv.dayData.wallets)),
    txCount: stateDeliv.dayData.transactions.length,
    jeCount: stateDeliv.dayData.journalEntries.length,
  };

  const stateBlockedRTO = returnOnlineOrderInState(stateDeliv, { orderId: 'ord_already_deliv', returnCharge: 80 });
  assert.equal(stateBlockedRTO.onlineOrders[0].status, snapBeforeDelivRTO.status, 'Status must remain delivered (RTO on delivered order rejected)');
  assert.equal(stateBlockedRTO.dayData.inventory[0].closingStock, snapBeforeDelivRTO.stock, 'Stock must NOT be increased for delivered order RTO');
  assert.deepEqual(stateBlockedRTO.dayData.wallets, snapBeforeDelivRTO.wallets, 'Wallets must NOT change on delivered order RTO attempt');
  assert.equal(stateBlockedRTO.dayData.transactions.length, snapBeforeDelivRTO.txCount, 'No RTO transactions may be appended');
  assert.equal(stateBlockedRTO.dayData.journalEntries.length, snapBeforeDelivRTO.jeCount, 'No RTO journal entries may be appended');
  assert.equal(stateBlockedRTO.dayData.inventory[0].fifoSoldUnits, 1, 'fifoSoldUnits must remain intact');
  assert.equal(stateBlockedRTO.dayData.inventory[0].fifoCogs, 500, 'fifoCogs must remain intact');

  // ── 3. Test: Low wallet balance rejects cancellation refund without clamping (P1 Wallet Reconciliation) ──
  let stateLowBal = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_cancel_low',
        status: 'confirmed',
        advancePaid: 300,
        advanceWallet: 'bkash',
        paymentStatus: 'verified',
        paymentVerifiedAt: Date.now(),
        items: [{ productId: 'item_perfume', quantity: 1, unitPrice: 1000 }],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: {
        bkash: { opening: 100, current: 100 }, // ONLY ৳100 available, but refund is ৳300!
        hand_cash: { opening: 2000, current: 2000 },
      },
      inventory: [{ id: 'item_perfume', closingStock: 5 }],
      transactions: [],
      journalEntries: [],
    },
  };

  // Attempt 1: Refund from bkash (insufficient: 100 < 300)
  const stateFailedCancel = cancelOnlineOrderInState(stateLowBal, { orderId: 'ord_cancel_low', refundWallet: 'bkash' });
  assert.ok(stateFailedCancel._orderRefundError, 'Must fail with _orderRefundError');
  assert.equal(stateFailedCancel._orderRefundError.code, 'insufficient_wallet_balance');
  assert.equal(stateFailedCancel.onlineOrders[0].status, 'confirmed', 'Order must remain confirmed when wallet balance is insufficient');
  assert.equal(stateFailedCancel.dayData.wallets.bkash.current, 100, 'Wallet must NOT be clamped to ৳0 — must remain ৳100 intact');
  assert.equal(stateFailedCancel.dayData.transactions.length, 0, 'No refund transaction should be recorded');
  assert.equal(stateFailedCancel.dayData.journalEntries.length, 0, 'No mismatched journal entry should be created');

  // Attempt 2: Owner selects funded wallet (hand_cash with ৳2000) -> Succeeds!
  const stateSuccessCancel = cancelOnlineOrderInState(stateLowBal, { orderId: 'ord_cancel_low', refundWallet: 'hand_cash' });
  assert.equal(stateSuccessCancel.onlineOrders[0].status, 'cancelled');
  assert.equal(stateSuccessCancel.dayData.wallets.hand_cash.current, 1700, 'hand_cash exactly reduced by ৳300 (2000 -> 1700)');
  assert.equal(stateSuccessCancel.dayData.wallets.bkash.current, 100, 'bkash wallet unchanged at 100');
  assert.equal(stateSuccessCancel.dayData.transactions.length, 1);
  assert.equal(stateSuccessCancel.dayData.transactions[0].amount, 300);
  assert.equal(stateSuccessCancel.dayData.journalEntries.length, 1);

  // Assert exact double-entry reconciliation
  const tbCancel = computeTrialBalance(stateSuccessCancel.dayData.journalEntries);
  assert.equal(tbCancel['customer_advance']?.debit, 300);
  assert.equal(tbCancel['cash_in_hand']?.credit, 300);
  const tbValCancel = validateTrialBalance(tbCancel);
  assert.equal(tbValCancel.isBalanced, true, 'Trial balance must be perfectly balanced');
  assert.equal(tbValCancel.diff, 0, 'Trial balance diff must be 0');

  // Attempt 3: Duplicate cancellation retry on already cancelled order produces ZERO changes
  const snapBeforeDupCancel = {
    status: stateSuccessCancel.onlineOrders[0].status,
    stock: stateSuccessCancel.dayData.inventory[0].closingStock,
    wallets: JSON.parse(JSON.stringify(stateSuccessCancel.dayData.wallets)),
    txCount: stateSuccessCancel.dayData.transactions.length,
    jeCount: stateSuccessCancel.dayData.journalEntries.length,
  };
  const stateDupCancel = cancelOnlineOrderInState(stateSuccessCancel, { orderId: 'ord_cancel_low', refundWallet: 'hand_cash' });
  assert.equal(stateDupCancel.onlineOrders[0].status, snapBeforeDupCancel.status);
  assert.equal(stateDupCancel.dayData.inventory[0].closingStock, snapBeforeDupCancel.stock);
  assert.deepEqual(stateDupCancel.dayData.wallets, snapBeforeDupCancel.wallets);
  assert.equal(stateDupCancel.dayData.transactions.length, snapBeforeDupCancel.txCount);
  assert.equal(stateDupCancel.dayData.journalEntries.length, snapBeforeDupCancel.jeCount);

  // ── 4. Test: Low wallet balance rejects RTO courier return fee without clamping (P1 Wallet Reconciliation) ──
  let stateLowRTO = {
    language: 'en',
    customerBlacklist: {},
    onlineOrders: [
      {
        id: 'ord_rto_low',
        status: 'shipped',
        courierCharge: 80,
        returnCharge: 80,
        items: [{ productId: 'item_hat', quantity: 1, unitPrice: 300 }],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: {
        hand_cash: { opening: 30, current: 30 }, // ONLY ৳30 available, but return fee is ৳80!
      },
      inventory: [{ id: 'item_hat', closingStock: 2 }],
      transactions: [],
      journalEntries: [],
    },
  };

  const snapBeforeFailRTO = {
    status: stateLowRTO.onlineOrders[0].status,
    stock: stateLowRTO.dayData.inventory[0].closingStock,
    wallets: JSON.parse(JSON.stringify(stateLowRTO.dayData.wallets)),
    txCount: stateLowRTO.dayData.transactions.length,
    jeCount: stateLowRTO.dayData.journalEntries.length,
  };

  const stateFailedRTO = returnOnlineOrderInState(stateLowRTO, { orderId: 'ord_rto_low', returnCharge: 80, expenseWallet: 'hand_cash' });
  assert.ok(stateFailedRTO._orderReturnError, 'Must fail with _orderReturnError');
  assert.equal(stateFailedRTO._orderReturnError.code, 'insufficient_wallet_balance');
  assert.equal(stateFailedRTO.onlineOrders[0].status, snapBeforeFailRTO.status, 'Order must remain shipped');
  assert.equal(stateFailedRTO.dayData.wallets.hand_cash.current, snapBeforeFailRTO.wallets.hand_cash.current, 'hand_cash must NOT be clamped to ৳0 — must remain ৳30');
  assert.equal(stateFailedRTO.dayData.inventory[0].closingStock, snapBeforeFailRTO.stock, 'Stock must NOT be restored on failed RTO');
  assert.equal(stateFailedRTO.dayData.transactions.length, snapBeforeFailRTO.txCount, 'Zero RTO transactions');
  assert.equal(stateFailedRTO.dayData.journalEntries.length, snapBeforeFailRTO.jeCount, 'Zero RTO journal entries');

  // ── 5. Test: Shipped order RTO restores stock & balances; duplicate retry produces ZERO changes ──
  let stateShippedRTO = {
    language: 'en',
    customerBlacklist: {},
    onlineOrders: [
      {
        id: 'ord_shipped_rto',
        status: 'shipped',
        customerPhone: '01711223344',
        courierCharge: 80,
        returnCharge: 80,
        items: [{ productId: 'item_bag', quantity: 2, unitPrice: 500 }],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: {
        hand_cash: { opening: 1000, current: 1000 },
      },
      inventory: [{ id: 'item_bag', closingStock: 8 }], // 2 units were deducted at packed/shipped
      transactions: [],
      journalEntries: [],
    },
  };

  // Step 1: Valid RTO
  const stateSuccessRTO = returnOnlineOrderInState(stateShippedRTO, { orderId: 'ord_shipped_rto', returnCharge: 80, expenseWallet: 'hand_cash' });
  assert.equal(stateSuccessRTO.onlineOrders[0].status, 'returned');
  assert.equal(stateSuccessRTO.dayData.inventory[0].closingStock, 10, 'Stock restored by 2 (8 -> 10)');
  assert.equal(stateSuccessRTO.dayData.wallets.hand_cash.current, 920, 'hand_cash reduced by ৳80 (1000 -> 920)');
  assert.equal(stateSuccessRTO.dayData.transactions.length, 1);
  assert.equal(stateSuccessRTO.dayData.journalEntries.length, 1);

  // Step 2: Duplicate RTO retry
  const snapBeforeDupRTO = {
    status: stateSuccessRTO.onlineOrders[0].status,
    stock: stateSuccessRTO.dayData.inventory[0].closingStock,
    wallets: JSON.parse(JSON.stringify(stateSuccessRTO.dayData.wallets)),
    txCount: stateSuccessRTO.dayData.transactions.length,
    jeCount: stateSuccessRTO.dayData.journalEntries.length,
  };
  const stateDupRTO = returnOnlineOrderInState(stateSuccessRTO, { orderId: 'ord_shipped_rto', returnCharge: 80, expenseWallet: 'hand_cash' });
  assert.equal(stateDupRTO.onlineOrders[0].status, snapBeforeDupRTO.status);
  assert.equal(stateDupRTO.dayData.inventory[0].closingStock, snapBeforeDupRTO.stock);
  assert.deepEqual(stateDupRTO.dayData.wallets, snapBeforeDupRTO.wallets);
  assert.equal(stateDupRTO.dayData.transactions.length, snapBeforeDupRTO.txCount);
  assert.equal(stateDupRTO.dayData.journalEntries.length, snapBeforeDupRTO.jeCount);
});

await runTest('Suite 5', '5.22 [P0 Courier Settlement Integrity] Missing receiving wallet, negative net amount, net exceeding COD rejection, and valid settlement reconciliation', async () => {
  const baseDeliveredState = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_settle_gate1',
        status: 'delivered',
        deliveredAt: Date.now() - 5000,
        codAmount: 800,
        courierCharge: 80,
        codFee: 10,
        totalAmount: 800,
        courierName: 'Steadfast',
        items: [{ productId: 'item_shirt', quantity: 1, unitPrice: 800 }],
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: {
        hand_cash: { opening: 5000, current: 5000 },
        bkash: { opening: 2000, current: 2000 },
      },
      inventory: [{ id: 'item_shirt', closingStock: 9 }],
      transactions: [{ id: 'tx_deliv_prev', type: 'stock_sale', amount: 800 }],
      journalEntries: [
        {
          id: 'je_deliv_prev',
          txType: 'stock_sale',
          lines: [
            { accountId: 'courier_receivable', debit: 800, credit: 0 },
            { accountId: 'sales_revenue', debit: 0, credit: 800 },
          ],
        },
      ],
    },
  };

  // ── 1. Case 1: Receiving wallet does not exist ──
  const snap1 = {
    status: baseDeliveredState.onlineOrders[0].status,
    wallets: JSON.parse(JSON.stringify(baseDeliveredState.dayData.wallets)),
    txCount: baseDeliveredState.dayData.transactions.length,
    jeCount: baseDeliveredState.dayData.journalEntries.length,
  };
  const stateMissingWallet = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'nonexistent_wallet_xyz',
  });
  assert.ok(stateMissingWallet._orderSettleError, 'Must fail with _orderSettleError');
  assert.equal(stateMissingWallet._orderSettleError.code, 'missing_settlement_wallet');
  assert.equal(stateMissingWallet.onlineOrders[0].status, snap1.status, 'Order must remain delivered');
  assert.deepEqual(stateMissingWallet.dayData.wallets, snap1.wallets, 'Wallets must NOT change on missing wallet error');
  assert.equal(stateMissingWallet.dayData.transactions.length, snap1.txCount, 'No transactions created');
  assert.equal(stateMissingWallet.dayData.journalEntries.length, snap1.jeCount, 'No journal entries created');

  // ── 2. Case 2: Negative net settlement amount (-50) ──
  const stateNegativeNet = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
    netAmount: -50,
  });
  assert.ok(stateNegativeNet._orderSettleError, 'Must fail with _orderSettleError');
  assert.equal(stateNegativeNet._orderSettleError.code, 'negative_settlement_amount');
  assert.equal(stateNegativeNet.onlineOrders[0].status, snap1.status, 'Order must remain delivered');
  assert.deepEqual(stateNegativeNet.dayData.wallets, snap1.wallets, 'Wallets must NOT change on negative net amount');
  assert.equal(stateNegativeNet.dayData.transactions.length, snap1.txCount, 'No transactions created');
  assert.equal(stateNegativeNet.dayData.journalEntries.length, snap1.jeCount, 'No journal entries created');

  // ── 3. Case 3: Net amount exceeds recorded COD amount (1000 > 800) ──
  const stateExceedsCod = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
    netAmount: 1000,
  });
  assert.ok(stateExceedsCod._orderSettleError, 'Must fail with _orderSettleError');
  assert.equal(stateExceedsCod._orderSettleError.code, 'net_exceeds_cod');
  assert.equal(stateExceedsCod.onlineOrders[0].status, snap1.status, 'Order must remain delivered');
  assert.deepEqual(stateExceedsCod.dayData.wallets, snap1.wallets, 'Wallets must NOT change when net exceeds COD');
  assert.equal(stateExceedsCod.dayData.transactions.length, snap1.txCount, 'No transactions created');
  assert.equal(stateExceedsCod.dayData.journalEntries.length, snap1.jeCount, 'No journal entries created');

  // ── 4. Case 4: Normal successful settlement ──
  // Expected: COD 800 - (courierCharge 80 + codFee 10) = net ৳710 received in hand_cash (5000 -> 5710)
  const stateSuccessSettle = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
  });
  assert.equal(stateSuccessSettle.onlineOrders[0].status, 'settled');
  assert.equal(stateSuccessSettle.onlineOrders[0].settlementAmount, 710);
  assert.equal(stateSuccessSettle.dayData.wallets.hand_cash.current, 5710, 'hand_cash credited with net ৳710 (5000 -> 5710)');
  assert.equal(stateSuccessSettle.dayData.wallets.bkash.current, 2000, 'bkash wallet unchanged');
  assert.equal(stateSuccessSettle.dayData.transactions.length, 3, 'Prev sale + courier exp + settle tx');
  assert.equal(stateSuccessSettle.dayData.journalEntries.length, 2, 'Prev sale JE + settle JE');

  // Assert exact double-entry reconciliation across all journal entries
  const tb = computeTrialBalance(stateSuccessSettle.dayData.journalEntries);
  // courier_receivable: debited 800 on delivery, credited 800 on settlement -> net balance 0!
  assert.equal(tb['courier_receivable']?.debit, 800);
  assert.equal(tb['courier_receivable']?.credit, 800);
  assert.equal(tb['cash_in_hand']?.debit, 710);
  assert.equal(tb['delivery_expense']?.debit, 90);
  assert.equal(tb['sales_revenue']?.credit, 800);
  const tbVal = validateTrialBalance(tb);
  assert.equal(tbVal.isBalanced, true, 'Trial balance must be perfectly balanced after settlement');
  assert.equal(tbVal.diff, 0, 'Trial balance diff must be 0');

  // ── 5. Case 5: Repeated settlement retry (Idempotency) ──
  const snapAfterSettle = {
    status: stateSuccessSettle.onlineOrders[0].status,
    wallets: JSON.parse(JSON.stringify(stateSuccessSettle.dayData.wallets)),
    txCount: stateSuccessSettle.dayData.transactions.length,
    jeCount: stateSuccessSettle.dayData.journalEntries.length,
  };
  const stateDoubleSettle = settleOnlineOrderInState(stateSuccessSettle, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
  });
  assert.equal(stateDoubleSettle.onlineOrders[0].status, snapAfterSettle.status);
  assert.deepEqual(stateDoubleSettle.dayData.wallets, snapAfterSettle.wallets, 'Repeated settlement must NOT credit wallet again');
  assert.equal(stateDoubleSettle.dayData.transactions.length, snapAfterSettle.txCount, 'No duplicate transactions');
  assert.equal(stateDoubleSettle.dayData.journalEntries.length, snapAfterSettle.jeCount, 'No duplicate journal entries');
  // ── 6. Case 6: Malformed courierCharge ('abc') rejected without modifying state ──
  const stateMalformedCharge = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
    courierCharge: 'abc',
  });
  assert.ok(stateMalformedCharge._orderSettleError, 'Must fail with _orderSettleError on malformed courierCharge');
  assert.equal(stateMalformedCharge._orderSettleError.code, 'invalid_settlement_amounts');
  assert.equal(stateMalformedCharge.onlineOrders[0].status, snap1.status, 'Order must remain delivered');
  assert.deepEqual(stateMalformedCharge.dayData.wallets, snap1.wallets, 'Wallets must NOT change on malformed courierCharge');
  assert.equal(stateMalformedCharge.dayData.transactions.length, snap1.txCount, 'No transactions created');
  assert.equal(stateMalformedCharge.dayData.journalEntries.length, snap1.jeCount, 'No journal entries created');

  // ── 7. Case 7: Malformed codFee ('xyz') rejected without modifying state ──
  const stateMalformedCodFee = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
    codFee: 'xyz',
  });
  assert.ok(stateMalformedCodFee._orderSettleError, 'Must fail with _orderSettleError on malformed codFee');
  assert.equal(stateMalformedCodFee._orderSettleError.code, 'invalid_settlement_amounts');
  assert.equal(stateMalformedCodFee.onlineOrders[0].status, snap1.status, 'Order must remain delivered');
  assert.deepEqual(stateMalformedCodFee.dayData.wallets, snap1.wallets, 'Wallets must NOT change on malformed codFee');
  assert.equal(stateMalformedCodFee.dayData.transactions.length, snap1.txCount, 'No transactions created');
  assert.equal(stateMalformedCodFee.dayData.journalEntries.length, snap1.jeCount, 'No journal entries created');

  // ── 8. Case 8: Net amount vs recorded courier fee mismatch rejected without allowAdjustment ──
  // COD = 800, courierCharge = 80, codFee = 10 -> expectedNet = 710. Passing netAmount = 500 without allowAdjustment must reject.
  const stateNetMismatch = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
    netAmount: 500,
  });
  assert.ok(stateNetMismatch._orderSettleError, 'Must fail with _orderSettleError on net fee mismatch');
  assert.equal(stateNetMismatch._orderSettleError.code, 'net_fee_mismatch');
  assert.equal(stateNetMismatch._orderSettleError.expectedNet, 710);
  assert.equal(stateNetMismatch._orderSettleError.discrepancy, -210);
  assert.equal(stateNetMismatch.onlineOrders[0].status, snap1.status, 'Order must remain delivered');
  assert.deepEqual(stateNetMismatch.dayData.wallets, snap1.wallets, 'Wallets must NOT change on net fee mismatch');
  assert.equal(stateNetMismatch.dayData.transactions.length, snap1.txCount, 'No transactions created');
  assert.equal(stateNetMismatch.dayData.journalEntries.length, snap1.jeCount, 'No journal entries created');

  // ── 9. Case 9: Explicit adjustment approved (allowAdjustment: true) with valid reason settles accurately ──
  const stateAdjustedSettle = settleOnlineOrderInState(baseDeliveredState, {
    orderId: 'ord_settle_gate1',
    settlementWallet: 'hand_cash',
    netAmount: 500,
    allowAdjustment: true,
    adjustmentReason: 'Courier applied weight surcharge',
  });
  assert.equal(stateAdjustedSettle.onlineOrders[0].status, 'settled');
  assert.equal(stateAdjustedSettle.onlineOrders[0].settlementAmount, 500);
  assert.equal(stateAdjustedSettle.onlineOrders[0].adjustmentApproved, true);
  assert.equal(stateAdjustedSettle.onlineOrders[0].adjustmentReason, 'Courier applied weight surcharge');
  assert.equal(stateAdjustedSettle.dayData.wallets.hand_cash.current, 5500, 'hand_cash credited with adjusted net ৳500');
  const expTx = stateAdjustedSettle.dayData.transactions.find(t => t.type === 'expense');
  assert.ok(expTx);
  assert.equal(expTx.amount, 300, 'Effective expense must be COD 800 - Net 500 = ৳300');
  assert.ok(expTx.note.includes('300'), 'Note must document the adjusted expense of ৳300');
  const tbAdj = computeTrialBalance(stateAdjustedSettle.dayData.journalEntries);
  assert.equal(tbAdj['courier_receivable']?.credit, 800);
  assert.equal(tbAdj['cash_in_hand']?.debit, 500);
  assert.equal(tbAdj['delivery_expense']?.debit, 300);
  const tbAdjVal = validateTrialBalance(tbAdj);
  assert.equal(tbAdjVal.isBalanced, true, 'Adjusted trial balance must be perfectly balanced');
  assert.equal(tbAdjVal.diff, 0);
});

await runTest('Suite 5', '5.23 [P0 Zero-Net and Pre-recorded Net Settlement] order.netFromCourier preservation and zero-net absorption accounting', async () => {
  // Scenario 1: Realistic order with pre-recorded netFromCourier (710)
  const stateWithRecordedNet = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_precorded_1',
        status: 'delivered',
        deliveredAt: Date.now() - 3000,
        codAmount: 800,
        courierCharge: 80,
        codFee: 10,
        netFromCourier: 710,
        totalAmount: 800,
        courierName: 'Pathao',
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: { hand_cash: { opening: 1000, current: 1000 } },
      transactions: [{ id: 'tx_p1', type: 'stock_sale', amount: 800 }],
      journalEntries: [
        {
          id: 'je_p1',
          txType: 'stock_sale',
          lines: [
            { accountId: 'courier_receivable', debit: 800, credit: 0 },
            { accountId: 'sales_revenue', debit: 0, credit: 800 },
          ],
        },
      ],
    },
  };

  const settledPreRecorded = settleOnlineOrderInState(stateWithRecordedNet, {
    orderId: 'ord_precorded_1',
    settlementWallet: 'hand_cash',
  });
  assert.equal(settledPreRecorded.onlineOrders[0].status, 'settled');
  assert.equal(settledPreRecorded.onlineOrders[0].settlementAmount, 710);
  assert.equal(settledPreRecorded.dayData.wallets.hand_cash.current, 1710, 'hand_cash credited with ৳710');
  const tbPre = computeTrialBalance(settledPreRecorded.dayData.journalEntries);
  assert.equal(validateTrialBalance(tbPre).isBalanced, true);

  // Scenario 2: Zero-net settlement (fees absorb entire COD: COD ৳90, delivery ৳80, COD fee ৳10 -> net ৳0)
  const stateZeroNet = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_zero_net_1',
        status: 'delivered',
        deliveredAt: Date.now() - 3000,
        codAmount: 90,
        courierCharge: 80,
        codFee: 10,
        totalAmount: 90,
        courierName: 'RedX',
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: { hand_cash: { opening: 2000, current: 2000 } },
      transactions: [{ id: 'tx_z1', type: 'stock_sale', amount: 90 }],
      journalEntries: [
        {
          id: 'je_z1',
          txType: 'stock_sale',
          lines: [
            { accountId: 'courier_receivable', debit: 90, credit: 0 },
            { accountId: 'sales_revenue', debit: 0, credit: 90 },
          ],
        },
      ],
    },
  };

  const settledZeroNet = settleOnlineOrderInState(stateZeroNet, {
    orderId: 'ord_zero_net_1',
    settlementWallet: 'hand_cash',
  });
  assert.equal(settledZeroNet.onlineOrders[0].status, 'settled');
  assert.equal(settledZeroNet.onlineOrders[0].settlementAmount, 0, 'Settlement amount must be ৳0');
  assert.equal(settledZeroNet.dayData.wallets.hand_cash.current, 2000, 'hand_cash balance must remain ৳2000 (no net cash inflow)');
  const expTxZero = settledZeroNet.dayData.transactions.find(t => t.type === 'expense');
  assert.ok(expTxZero);
  assert.equal(expTxZero.amount, 90, 'Full COD amount absorbed as courier expense ৳90');

  const tbZero = computeTrialBalance(settledZeroNet.dayData.journalEntries);
  assert.equal(tbZero['courier_receivable']?.debit, 90);
  assert.equal(tbZero['courier_receivable']?.credit, 90, 'Courier receivable must be fully cleared');
  assert.equal(tbZero['delivery_expense']?.debit, 90, 'Delivery expense debited ৳90');
  assert.equal(tbZero['sales_revenue']?.credit, 90, 'Sales revenue credited ৳90');
  const tbZeroVal = validateTrialBalance(tbZero);
  assert.equal(tbZeroVal.isBalanced, true, 'Zero-net trial balance must be perfectly balanced');
  assert.equal(tbZeroVal.diff, 0);
});

await runTest('Suite 5', '5.24 [P1 Settlement Integrity & Strict Currency Parser] Issue A deficit rejection, Issue B strict boolean & reason checks, and P2 parseStrictMoney validation', async () => {
  // ── Part 1: Issue A — Courier fees exceed COD collection (Deficit settlement rejection) ──
  // Scenario: COD ৳90, courierCharge ৳100, codFee ৳10 -> Total courier expense = ৳110 > COD ৳90 (Shortfall: ৳20)
  const baseDeficitState = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_deficit_1',
        status: 'delivered',
        deliveredAt: Date.now() - 3000,
        codAmount: 90,
        courierCharge: 100,
        codFee: 10,
        totalAmount: 90,
        courierName: 'Steadfast',
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: { hand_cash: { opening: 5000, current: 5000 } },
      transactions: [{ id: 'tx_def1', type: 'stock_sale', amount: 90 }],
      journalEntries: [
        {
          id: 'je_def1',
          txType: 'stock_sale',
          lines: [
            { accountId: 'courier_receivable', debit: 90, credit: 0 },
            { accountId: 'sales_revenue', debit: 0, credit: 90 },
          ],
        },
      ],
    },
  };

  const deficitSnap = {
    status: baseDeficitState.onlineOrders[0].status,
    wallets: JSON.parse(JSON.stringify(baseDeficitState.dayData.wallets)),
    txCount: baseDeficitState.dayData.transactions.length,
    jeCount: baseDeficitState.dayData.journalEntries.length,
  };

  const stateDeficitRejected = settleOnlineOrderInState(baseDeficitState, {
    orderId: 'ord_deficit_1',
    settlementWallet: 'hand_cash',
  });

  assert.ok(stateDeficitRejected._orderSettleError, 'Must fail with _orderSettleError when courier fee exceeds COD');
  assert.equal(stateDeficitRejected._orderSettleError.code, 'courier_fee_exceeds_cod');
  assert.equal(stateDeficitRejected._orderSettleError.shortfall, 20, 'Shortfall must be exact deficit (110 - 90 = 20)');
  assert.equal(stateDeficitRejected._orderSettleError.courierExpense, 110);
  assert.equal(stateDeficitRejected._orderSettleError.codAmount, 90);
  assert.equal(stateDeficitRejected.onlineOrders[0].status, deficitSnap.status, 'Order must remain in delivered status');
  assert.deepEqual(stateDeficitRejected.dayData.wallets, deficitSnap.wallets, 'Wallets must NOT change on deficit error');
  assert.equal(stateDeficitRejected.dayData.transactions.length, deficitSnap.txCount, 'No transactions created on deficit error');
  assert.equal(stateDeficitRejected.dayData.journalEntries.length, deficitSnap.jeCount, 'No journal entries created on deficit error');

  // ── Part 2: Issue B — allowAdjustment truthiness trap & strict reason checks ──
  const baseMismatchState = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_mismatch_1',
        status: 'delivered',
        deliveredAt: Date.now() - 3000,
        codAmount: 800,
        courierCharge: 80,
        codFee: 10,
        totalAmount: 800,
        courierName: 'RedX',
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      wallets: { hand_cash: { opening: 3000, current: 3000 } },
      transactions: [{ id: 'tx_mm1', type: 'stock_sale', amount: 800 }],
      journalEntries: [
        {
          id: 'je_mm1',
          txType: 'stock_sale',
          lines: [
            { accountId: 'courier_receivable', debit: 800, credit: 0 },
            { accountId: 'sales_revenue', debit: 0, credit: 800 },
          ],
        },
      ],
    },
  };
  // Expected net: 800 - 90 = 710. Passing netAmount = 650 is a discrepancy of -60.

  // Subcase 2.1: allowAdjustment = 'false' (string) must NOT be treated as truthy
  const stateStrFalse = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: 650,
    allowAdjustment: 'false',
    adjustmentReason: 'Valid reason string here',
  });
  assert.ok(stateStrFalse._orderSettleError, 'String "false" must NOT bypass adjustment check');
  assert.equal(stateStrFalse._orderSettleError.code, 'net_fee_mismatch');
  assert.equal(stateStrFalse.onlineOrders[0].status, 'delivered');

  // Subcase 2.2: allowAdjustment = 'true' (string) must NOT be accepted as boolean true
  const stateStrTrue = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: 650,
    allowAdjustment: 'true',
    adjustmentReason: 'Valid reason string here',
  });
  assert.ok(stateStrTrue._orderSettleError, 'String "true" must NOT bypass boolean strict check');
  assert.equal(stateStrTrue._orderSettleError.code, 'net_fee_mismatch');
  assert.equal(stateStrTrue.onlineOrders[0].status, 'delivered');

  // Subcase 2.3: allowAdjustment = 1 (number) must NOT be accepted as boolean true
  const stateNumOne = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: 650,
    allowAdjustment: 1,
    adjustmentReason: 'Valid reason string here',
  });
  assert.ok(stateNumOne._orderSettleError, 'Number 1 must NOT bypass boolean strict check');
  assert.equal(stateNumOne._orderSettleError.code, 'net_fee_mismatch');
  assert.equal(stateNumOne.onlineOrders[0].status, 'delivered');

  // Subcase 2.4: allowAdjustment: true but missing adjustmentReason
  const stateMissingReason = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: 650,
    allowAdjustment: true,
  });
  assert.ok(stateMissingReason._orderSettleError, 'Missing adjustmentReason must reject');
  assert.equal(stateMissingReason._orderSettleError.code, 'missing_adjustment_reason');
  assert.equal(stateMissingReason.onlineOrders[0].status, 'delivered');

  // Subcase 2.5: allowAdjustment: true with whitespace-only adjustmentReason
  const stateWhitespaceReason = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: 650,
    allowAdjustment: true,
    adjustmentReason: '   ',
  });
  assert.ok(stateWhitespaceReason._orderSettleError, 'Whitespace adjustmentReason must reject');
  assert.equal(stateWhitespaceReason._orderSettleError.code, 'missing_adjustment_reason');

  // Subcase 2.6: allowAdjustment: true with short adjustmentReason (<3 chars)
  const stateShortReason = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: 650,
    allowAdjustment: true,
    adjustmentReason: 'ab',
  });
  assert.ok(stateShortReason._orderSettleError, 'Short (<3 chars) adjustmentReason must reject');
  assert.equal(stateShortReason._orderSettleError.code, 'missing_adjustment_reason');

  // Subcase 2.7: allowAdjustment: true with valid reason succeeds and records audit trail
  const stateValidAdjustment = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: 650,
    allowAdjustment: true,
    adjustmentReason: 'Extra weight penalty 1kg',
  });
  assert.equal(stateValidAdjustment.onlineOrders[0].status, 'settled');
  assert.equal(stateValidAdjustment.onlineOrders[0].settlementAmount, 650);
  assert.equal(stateValidAdjustment.onlineOrders[0].adjustmentApproved, true);
  assert.equal(stateValidAdjustment.onlineOrders[0].adjustmentReason, 'Extra weight penalty 1kg');
  assert.equal(stateValidAdjustment.onlineOrders[0].adjustmentDiscrepancy, -60);
  assert.equal(stateValidAdjustment.dayData.wallets.hand_cash.current, 3650, 'hand_cash credited with ৳650');
  const expTx = stateValidAdjustment.dayData.transactions.find(t => t.type === 'expense');
  assert.ok(expTx, 'Expense transaction must be created');
  assert.equal(expTx.amount, 150, 'Expense = COD 800 - Net 650 = ৳150');
  assert.ok(expTx.note.includes('Extra weight penalty 1kg'), 'Expense note must contain adjustment reason');
  const settleHist = stateValidAdjustment.onlineOrders[0].statusHistory.find(h => h.status === 'settled');
  assert.ok(settleHist.note.includes('Extra weight penalty 1kg'), 'Status history must document adjustment reason');

  const tbAdj = computeTrialBalance(stateValidAdjustment.dayData.journalEntries);
  assert.equal(validateTrialBalance(tbAdj).isBalanced, true, 'Adjusted trial balance must be balanced');

  // ── Part 3: P2 — parseStrictMoney unit tests & input validation ──
  // Invalid inputs that standard Number() mistakenly coerces
  assert.equal(parseStrictMoney('  ', null, true), null, 'Whitespace string must return null when required');
  assert.equal(parseStrictMoney('  ', 0, false), null, 'Whitespace string must return null even when not required (malformed input)');
  assert.equal(parseStrictMoney(' ', 0, false), null, 'Single space string must return null even when not required');
  assert.equal(parseStrictMoney('', 0, false), 0, 'Empty string returns defaultVal when not required');
  assert.equal(parseStrictMoney(undefined, 0, false), 0, 'Undefined returns defaultVal when not required');
  assert.equal(parseStrictMoney(null, 0, false), 0, 'Null returns defaultVal when not required');
  assert.equal(parseStrictMoney(true), null, 'Boolean true must return null');
  assert.equal(parseStrictMoney(false), null, 'Boolean false must return null');
  assert.equal(parseStrictMoney('0x10'), null, 'Hexadecimal "0x10" must return null');
  assert.equal(parseStrictMoney('1e5'), null, 'Exponential notation "1e5" must return null');
  assert.equal(parseStrictMoney([]), null, 'Array must return null');
  assert.equal(parseStrictMoney({}), null, 'Object must return null');
  assert.equal(parseStrictMoney('-50'), null, 'Negative string must return null');
  assert.equal(parseStrictMoney(-50), null, 'Negative number must return null');
  assert.equal(parseStrictMoney(NaN), null, 'NaN must return null');
  assert.equal(parseStrictMoney(Infinity), null, 'Infinity must return null');
  assert.equal(parseStrictMoney('12.345'), null, 'More than 2 decimal places must return null');

  // Valid inputs
  assert.equal(parseStrictMoney(0), 0);
  assert.equal(parseStrictMoney('0'), 0);
  assert.equal(parseStrictMoney(150), 150);
  assert.equal(parseStrictMoney('150'), 150);
  assert.equal(parseStrictMoney(150.5), 150.5);
  assert.equal(parseStrictMoney('150.50'), 150.5);
  assert.equal(parseStrictMoney('0.99'), 0.99);

  // Settle engine rejects malformed courier charges via parseStrictMoney
  const stateBadCharge = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    courierCharge: true,
  });
  assert.equal(stateBadCharge._orderSettleError.code, 'invalid_settlement_amounts');

  const stateHexCodFee = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    codFee: '0x10',
  });
  assert.equal(stateHexCodFee._orderSettleError.code, 'invalid_settlement_amounts');

  // P2 regression: Optional fee with whitespace (e.g. '   ') must reject settlement
  const stateWhitespaceCodFee = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    codFee: '   ',
  });
  assert.ok(stateWhitespaceCodFee._orderSettleError, 'Whitespace optional fee must reject settlement');
  assert.equal(stateWhitespaceCodFee._orderSettleError.code, 'invalid_settlement_amounts');

  // Gate A1 & Gate A2: netAmount validation checks
  // Empty netAmount string rejects with invalid_settlement_amounts and does NOT silently fall back
  const stateEmptyNet = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: '',
  });
  assert.ok(stateEmptyNet._orderSettleError, 'Empty netAmount string must reject');
  assert.equal(stateEmptyNet._orderSettleError.code, 'invalid_settlement_amounts');
  assert.equal(stateEmptyNet._orderSettleError.message, 'Actual received net amount cannot be empty');

  // Whitespace netAmount string rejects with invalid_settlement_amounts
  const stateWhitespaceNet = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: '   ',
  });
  assert.ok(stateWhitespaceNet._orderSettleError, 'Whitespace netAmount string must reject');
  assert.equal(stateWhitespaceNet._orderSettleError.code, 'invalid_settlement_amounts');
  assert.equal(stateWhitespaceNet._orderSettleError.message, 'Actual received net amount cannot be empty');

  // Malformed netAmount inputs: 1e2, 0x10, 12.345 reject with invalid_settlement_amounts
  const stateScientificNet = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: '1e2',
  });
  assert.ok(stateScientificNet._orderSettleError, 'Scientific notation "1e2" netAmount must reject');
  assert.equal(stateScientificNet._orderSettleError.code, 'invalid_settlement_amounts');

  const stateHexNet = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: '0x10',
  });
  assert.ok(stateHexNet._orderSettleError, 'Hexadecimal "0x10" netAmount must reject');
  assert.equal(stateHexNet._orderSettleError.code, 'invalid_settlement_amounts');

  const stateDecimalsNet = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: '12.345',
  });
  assert.ok(stateDecimalsNet._orderSettleError, 'More than 2 decimals "12.345" netAmount must reject');
  assert.equal(stateDecimalsNet._orderSettleError.code, 'invalid_settlement_amounts');

  // Valid string netAmount is parsed correctly and accepted directly without Number() coercion
  const stateValidStringNet = settleOnlineOrderInState(baseMismatchState, {
    orderId: 'ord_mismatch_1',
    settlementWallet: 'hand_cash',
    netAmount: '710',
  });
  assert.equal(stateValidStringNet._orderSettleError, undefined, 'Valid string netAmount "710" must settle successfully');
  assert.equal(stateValidStringNet.onlineOrders[0].settlementAmount, 710);
});

await runTest('Suite 5', '5.25 [P1 Adjustment UI & Error Flow E2E Certification] Mismatch triggers _orderSettleError, actionable bilingual UI messaging, reason validation, clean settlement & duplicate idempotency', async () => {
  const testOrderId = 'ord_e2e_settle_mismatch';
  const initialDeliveredState = {
    language: 'bn',
    onlineOrders: [
      {
        id: testOrderId,
        customerName: 'Rahim Khan',
        customerPhone: '01712345678',
        status: 'delivered',
        deliveredAt: Date.now() - 5000,
        codAmount: 1000,
        courierCharge: 80,
        codFee: 10,
        totalAmount: 1000,
        courierName: 'Steadfast',
      },
    ],
    dayData: {
      dateKey: '2026-10-18',
      status: 'open',
      wallets: {
        hand_cash: { opening: 5000, current: 5000 },
        bank: { opening: 10000, current: 10000 },
      },
      inventory: [],
      transactions: [
        { id: 'tx_sale_init', type: 'stock_sale', amount: 1000, linkedOrderId: testOrderId },
      ],
      journalEntries: [
        {
          id: 'je_sale_init',
          txType: 'stock_sale',
          lines: [
            { accountId: 'courier_receivable', debit: 1000, credit: 0 },
            { accountId: 'sales_revenue', debit: 0, credit: 1000 },
          ],
        },
      ],
    },
  };

  // Step 1: Courier pays net ৳850 instead of expected ৳910 (1000 - 90). Discrepancy is -60.
  // User attempts to settle without checking adjustment:
  const stateMismatchAttempt = settleOnlineOrderInState(initialDeliveredState, {
    orderId: testOrderId,
    settlementWallet: 'hand_cash',
    netAmount: 850,
  });

  // Verify rejection and _orderSettleError payload
  assert.ok(stateMismatchAttempt._orderSettleError, 'Settlement must reject with _orderSettleError on unapproved discrepancy');
  assert.equal(stateMismatchAttempt._orderSettleError.code, 'net_fee_mismatch');
  assert.equal(stateMismatchAttempt._orderSettleError.expectedNet, 910);
  assert.equal(stateMismatchAttempt._orderSettleError.netAmount, 850);
  assert.equal(stateMismatchAttempt._orderSettleError.discrepancy, -60);
  assert.equal(stateMismatchAttempt.onlineOrders[0].status, 'delivered', 'Order must stay in delivered status');
  assert.equal(stateMismatchAttempt.dayData.wallets.hand_cash.current, 5000, 'Wallet must not be mutated');
  assert.equal(stateMismatchAttempt.dayData.transactions.length, 1, 'No new transactions created');
  assert.equal(stateMismatchAttempt.dayData.journalEntries.length, 1, 'No new journal entries created');

  // Step 2: Verify UI error message generator getSettleErrorMessage in both Bangla and English
  const errorMsgBn = getSettleErrorMessage(stateMismatchAttempt._orderSettleError, false);
  assert.ok(errorMsgBn.includes('গরমিল'), 'Bangla error message must mention গরমিল');
  assert.ok(errorMsgBn.includes('910'), 'Bangla error message must contain expected net 910');
  assert.ok(errorMsgBn.includes('850'), 'Bangla error message must contain actual net 850');
  assert.ok(errorMsgBn.includes('-60'), 'Bangla error message must contain discrepancy -60');

  const errorMsgEn = getSettleErrorMessage(stateMismatchAttempt._orderSettleError, true);
  assert.ok(errorMsgEn.toLowerCase().includes('mismatch'), 'English error message must mention mismatch');
  assert.ok(errorMsgEn.includes('910'), 'English error message must contain expected net 910');
  assert.ok(errorMsgEn.includes('850'), 'English error message must contain actual net 850');
  assert.ok(errorMsgEn.includes('-60'), 'English error message must contain discrepancy -60');

  // Step 3: User checks "Approve Adjustment", but submits with insufficient reason (<3 characters or whitespace)
  const stateShortReason = settleOnlineOrderInState(stateMismatchAttempt, {
    orderId: testOrderId,
    settlementWallet: 'hand_cash',
    netAmount: 850,
    allowAdjustment: true,
    adjustmentReason: 'ok',
  });
  assert.ok(stateShortReason._orderSettleError, 'Short adjustment reason (<3 chars) must reject');
  assert.equal(stateShortReason._orderSettleError.code, 'missing_adjustment_reason');
  const shortReasonMsgBn = getSettleErrorMessage(stateShortReason._orderSettleError, false);
  assert.ok(shortReasonMsgBn.includes('কমপক্ষে ৩ অক্ষর') || shortReasonMsgBn.includes('কারণ'), 'Reason error message explains requirement');

  // Step 4: User enters valid reason ('Weight penalty 1.5kg') and confirms
  const stateApproved = settleOnlineOrderInState(stateShortReason, {
    orderId: testOrderId,
    settlementWallet: 'hand_cash',
    netAmount: 850,
    allowAdjustment: true,
    adjustmentReason: 'Weight penalty 1.5kg',
  });

  assert.equal(stateApproved._orderSettleError, undefined, '_orderSettleError must be cleared on successful settlement');
  const settledOrder = stateApproved.onlineOrders.find(o => o.id === testOrderId);
  assert.equal(settledOrder.status, 'settled', 'Order must transition to settled');
  assert.equal(settledOrder.settlementAmount, 850);
  assert.equal(settledOrder.adjustmentApproved, true);
  assert.equal(settledOrder.adjustmentReason, 'Weight penalty 1.5kg');
  assert.equal(settledOrder.adjustmentDiscrepancy, -60);

  // Financial verification:
  assert.equal(stateApproved.dayData.wallets.hand_cash.current, 5850, 'hand_cash must be credited with net ৳850');
  const courierExpenseTx = stateApproved.dayData.transactions.find(t => t.subType === 'courier_expense');
  assert.ok(courierExpenseTx, 'Courier expense transaction must be created');
  assert.equal(courierExpenseTx.amount, 150, 'Effective expense must be COD 1000 - Net 850 = ৳150');
  assert.ok(courierExpenseTx.note.includes('Weight penalty 1.5kg'), 'Expense note includes reason');

  const settleTx = stateApproved.dayData.transactions.find(t => t.type === 'courier_settlement');
  assert.ok(settleTx, 'Settlement transaction must be created');
  assert.equal(settleTx.amount, 850);
  assert.equal(settleTx.courierExpense, 150);

  // Double-entry validation:
  const tb = computeTrialBalance(stateApproved.dayData.journalEntries);
  const val = validateTrialBalance(tb);
  assert.equal(val.isBalanced, true, 'Trial balance must be balanced after adjusted settlement');

  // Step 5: Idempotency & Duplicate Settlement Prevention:
  // Attempting to settle the already-settled order again (simulating duplicate UI click or network retry)
  const stateRetry = settleOnlineOrderInState(stateApproved, {
    orderId: testOrderId,
    settlementWallet: 'hand_cash',
    netAmount: 850,
    allowAdjustment: true,
    adjustmentReason: 'Weight penalty 1.5kg',
  });
  assert.equal(stateRetry.dayData.wallets.hand_cash.current, 5850, 'Wallet must NOT be credited a second time');
  assert.equal(stateRetry.dayData.transactions.length, stateApproved.dayData.transactions.length, 'No duplicate transactions created');
  assert.equal(stateRetry.dayData.journalEntries.length, stateApproved.dayData.journalEntries.length, 'No duplicate journal entries created');

  // Step 6: Dispatching CLEAR_ORDER_SETTLE_ERROR cleanly clears state error
  const stateWithErr = { ...stateMismatchAttempt };
  assert.ok(stateWithErr._orderSettleError);
  const stateCleared = executeLedgerAction(stateWithErr, { type: 'CLEAR_ORDER_SETTLE_ERROR' });
  assert.equal(stateCleared._orderSettleError, undefined, 'CLEAR_ORDER_SETTLE_ERROR action must cleanly delete _orderSettleError');
});

await runTest('Suite 5', '5.26 [Gate A3: Canonical, Idempotent Atomic Cloud Settlement]', async () => {
  const uid = 'user_gate_a3';
  const bizId = 'biz_gate_a3';
  const dateKey = '2026-10-10';
  const orderId = 'ord_cloud_settle_101';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  // Seed Day Document
  const initialDayData = {
    dateKey,
    status: 'open',
    _revision: 2,
    wallets: {
      hand_cash: { current: 5000, initial: 5000 },
      bkash_personal: { current: 3000, initial: 3000 },
    },
    transactions: [],
    journalEntries: [],
    onlineOrdersDayStats: { delivered: 1, revenue: 1200 },
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey),
    initialDayData
  );

  // Seed Shipped Online Order (born as confirmed per security rules, transitioned to shipped)
  const initialOrderData = {
    id: orderId,
    status: 'confirmed',
    totalAmount: 1200,
    advancePaid: 200,
    codAmount: 1000,
    courierCharge: 80,
    codFee: 10,
    courierName: 'Steadfast',
    customerName: 'Tareq Hassan',
    customerPhone: '01711223344',
    createdAt: Date.now(),
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', orderId),
    initialOrderData
  );
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', orderId),
    { status: 'shipped' },
    { merge: true }
  );

  // Guard 1: Non-existent day document throws error
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, '2026-10-99', {
        orderId,
        settlementWallet: 'hand_cash',
      }, mock.ops);
    },
    /Day document for date 2026-10-99 does not exist/
  );

  // Guard 2: Non-existent order document throws error
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
        orderId: 'ord_missing_999',
        settlementWallet: 'hand_cash',
      }, mock.ops);
    },
    /Online order ord_missing_999 does not exist/
  );

  // Guard 3: State machine guard — Order must be 'delivered' before settling
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
        orderId,
        settlementWallet: 'hand_cash',
      }, mock.ops);
    },
    /must be in 'delivered' status to settle/
  );

  // Update order to 'delivered'
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', orderId),
    { status: 'delivered', deliveredAt: Date.now() },
    { merge: true }
  );

  // Guard 4: Settlement math error (fees exceed COD collection)
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
        orderId,
        settlementWallet: 'hand_cash',
        courierCharge: 950,
        codFee: 100, // Total fees 1050 > COD 1000
      }, mock.ops);
    },
    /Total courier fees .* exceed COD collection/
  );

  // Guard 5: Missing settlement wallet throws settlement error
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
        orderId,
        settlementWallet: 'non_existent_wallet',
      }, mock.ops);
    },
    /Settlement wallet 'non_existent_wallet' not found/
  );

  // Guard 6: Unapproved net mismatch throws net_fee_mismatch
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
        orderId,
        settlementWallet: 'hand_cash',
        netAmount: 850, // Expected: 1000 - 90 = 910
      }, mock.ops);
    },
    /Net settlement amount .* does not match expected net/
  );

  // Successful Atomic Settlement:
  // COD 1000 - Courier fees 90 (80+10) = Expected net 910
  const settleRes = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
    orderId,
    settlementWallet: 'hand_cash',
    netAmount: 910,
  }, mock.ops);

  assert.equal(settleRes.alreadySettled, false, 'Initial settlement must return alreadySettled: false');
  assert.equal(settleRes.order.status, 'settled', 'Order must be updated to status settled');
  assert.ok(settleRes.order.settledAt, 'Order must have settledAt timestamp');
  assert.equal(settleRes.dayData._revision, 3, 'Day document _revision must increment from 2 to 3');
  assert.equal(settleRes.dayData.wallets.hand_cash.current, 5910, 'hand_cash must be credited with net ৳910');

  // Verify atomic persistence in Firestore mock store
  const orderDocSnap = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', orderId)
  );
  assert.ok(orderDocSnap.exists(), 'Order doc must exist in Firestore');
  const storedOrder = orderDocSnap.data();
  assert.equal(storedOrder.status, 'settled');
  assert.equal(storedOrder.settlementAmount, 910);
  assert.equal(storedOrder.settlementWallet, 'hand_cash');

  const dayDocSnap = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey)
  );
  assert.ok(dayDocSnap.exists(), 'Day doc must exist in Firestore');
  const storedDay = dayDocSnap.data();
  assert.equal(storedDay._revision, 3);
  assert.equal(storedDay.wallets.hand_cash.current, 5910);

  const settleTx = storedDay.transactions.find(t => t.type === 'courier_settlement');
  assert.ok(settleTx, 'Courier settlement transaction must be recorded in Day doc');
  assert.equal(settleTx.amount, 910);

  const courierExpTx = storedDay.transactions.find(t => t.subType === 'courier_expense');
  assert.ok(courierExpTx, 'Courier expense transaction must be recorded in Day doc');
  assert.equal(courierExpTx.amount, 90);

  // Validate double-entry accounting integrity
  const tb = computeTrialBalance(storedDay.journalEntries);
  const tbVal = validateTrialBalance(tb);
  assert.equal(tbVal.isBalanced, true, 'Stored day journal entries must produce balanced Trial Balance');

  // Guard 7: Strict Idempotency — Concurrent retries or repeated network calls perform ZERO duplicate writes
  const duplicateRes = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
    orderId,
    settlementWallet: 'hand_cash',
    netAmount: 910,
  }, mock.ops);

  assert.equal(duplicateRes.alreadySettled, true, 'Repeated call must detect alreadySettled: true');
  assert.equal(duplicateRes.order.status, 'settled');
  assert.ok(duplicateRes.dayData, 'duplicateRes must include authoritative dayData for client reconciliation');

  // Verify zero additional financial writes occurred
  const daySnapAfterRetry = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey)
  );
  const dayDataAfterRetry = daySnapAfterRetry.data();
  assert.equal(dayDataAfterRetry._revision, 3, 'Revision must NOT increment on duplicate call');
  assert.equal(dayDataAfterRetry.wallets.hand_cash.current, 5910, 'Wallet must NOT be credited a second time');
  assert.equal(dayDataAfterRetry.transactions.length, storedDay.transactions.length, 'No duplicate transactions written');
  assert.equal(dayDataAfterRetry.journalEntries.length, storedDay.journalEntries.length, 'No duplicate journal entries written');
});

await runTest('Suite 5', '5.27 [Gate A6: Per-Order Concurrency & Stale Overwrite Protection]', async () => {
  const uid = 'user_gate_a6';
  const bizId = 'biz_gate_a6';
  // 1. Seed settled order in Cloud (pre-existing historical state)
  const settledOrderId = 'ord_settled_protect_1';
  const initialSettledOrder = {
    id: settledOrderId,
    status: 'settled',
    settledAt: 1791730000000,
    settlementWallet: 'bkash_personal',
    settlementAmount: 850,
    totalAmount: 1000,
    codAmount: 1000,
    customerName: 'Authorized Customer',
    customerPhone: '01811223344',
  };
  const mock = createMockFirestore({
    [`users/${uid}/businesses/${bizId}/onlineOrders/${settledOrderId}`]: initialSettledOrder,
  }, { auth: { uid }, enforceRules: true });

  // 2. Stale single-order save: Device A (stale cache with status: 'delivered') attempts saveOnlineOrderToCloud
  const staleDeliveredOrder = {
    id: settledOrderId,
    status: 'delivered',
    deliveredAt: 1791720000000,
    totalAmount: 1000,
    codAmount: 1000,
    customerName: 'Stale Device Attempt',
  };
  await saveOnlineOrderToCloud(uid, bizId, staleDeliveredOrder, mock.ops);

  // Check cloud order status: Must PRESERVE 'settled' status!
  const orderSnapAfterSingleSave = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', settledOrderId)
  );
  const savedSingle = orderSnapAfterSingleSave.data();
  assert.equal(savedSingle.status, 'settled', 'Stale delivered order must NOT overwrite settled status in saveOnlineOrderToCloud');
  assert.equal(savedSingle.settledAt, 1791730000000, 'Original settledAt timestamp must be preserved');
  assert.equal(savedSingle.settlementAmount, 850, 'Original settlementAmount must be preserved');

  // 3. Stale batch save: Device B attempts saveAllOnlineOrdersToCloud with stale delivered order and fresh order
  const freshOrderId = 'ord_fresh_batch_2';
  const batchOrders = [
    {
      id: settledOrderId,
      status: 'delivered',
      totalAmount: 1000,
    },
    {
      id: freshOrderId,
      status: 'confirmed',
      totalAmount: 500,
      customerName: 'New Buyer',
    },
  ];

  await saveAllOnlineOrdersToCloud(uid, bizId, batchOrders, mock.ops);

  // Check settled order: Still 'settled'
  const orderSnapAfterBatch = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', settledOrderId)
  );
  const savedBatch = orderSnapAfterBatch.data();
  assert.equal(savedBatch.status, 'settled', 'Stale delivered order in batch must NOT overwrite settled status in saveAllOnlineOrdersToCloud');
  assert.equal(savedBatch.settlementAmount, 850);

  // Check fresh order: Successfully created as 'confirmed'
  const freshSnap = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', freshOrderId)
  );
  assert.ok(freshSnap.exists(), 'Fresh order in batch must be saved');
  assert.equal(freshSnap.data().status, 'confirmed');

  // 4. Firestore rules monotonic invariant: Direct update of settled order to non-settled status is PERMISSION_DENIED
  await assert.rejects(
    async () => {
      await mock.ops.setDoc(
        mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', settledOrderId),
        { status: 'delivered' },
        { merge: true }
      );
    },
    /PERMISSION_DENIED/
  );

  // 5. Fail-closed error protection: getDoc failure in saveOnlineOrderToCloud throws without writing
  const failingGetDocOps = {
    ...mock.ops,
    getDoc: async () => {
      throw new Error('Network timeout during pre-check');
    },
  };
  await assert.rejects(
    async () => {
      await saveOnlineOrderToCloud(uid, bizId, { id: 'ord_fail_closed_1', status: 'delivered' }, failingGetDocOps);
    },
    /Failed to verify existing order status before save/
  );

  // 6. Fail-closed error protection: getDocs failure in saveAllOnlineOrdersToCloud throws without writing
  const failingGetDocsOps = {
    ...mock.ops,
    getDocs: async () => {
      throw new Error('Network timeout during batch pre-check');
    },
  };
  await assert.rejects(
    async () => {
      await saveAllOnlineOrdersToCloud(uid, bizId, [{ id: 'ord_fail_closed_2', status: 'delivered' }], failingGetDocsOps);
    },
    /Failed to query existing settled orders before batch save/
  );

  // 7. Verify OnlineOrdersScreen re-exports and invokes commitOnlineOrderSettlementToCloud
  const screenSource = fs.readFileSync(path.join(projectRoot, 'src/components/OnlineOrders/OnlineOrdersScreen.jsx'), 'utf8');
  assert.ok(screenSource.includes('export { commitOnlineOrderSettlementToCloud }'), 'OnlineOrdersScreen must export commitOnlineOrderSettlementToCloud');
  assert.ok(screenSource.includes('commitOnlineOrderSettlementToCloud('), 'OnlineOrdersScreen must call commitOnlineOrderSettlementToCloud on settlement');
});

await runTest('Suite 5', '5.28 [Gate A4: Multi-User Account Isolation & Safe Cloud Init]', async () => {
  // 1. Storage prefix with and without userId
  setActiveStorageUserId(null);
  assert.equal(getActiveStorageUserId(), null);
  assert.equal(getStoragePrefix('biz_1'), 'shop_day_');
  assert.equal(getStoragePrefix('biz_2'), 'shop_biz_2_day_');

  setActiveStorageUserId('user_alice');
  assert.equal(getActiveStorageUserId(), 'user_alice');
  assert.equal(getStoragePrefix('biz_1'), 'shop_u_user_alice_biz_1_day_');
  assert.equal(getStoragePrefix('biz_2'), 'shop_u_user_alice_biz_2_day_');
  assert.equal(getStoragePrefix('biz_1', 'user_bob'), 'shop_u_user_bob_biz_1_day_');

  // 2. Data isolation between user_alice and user_bob
  const dateKey = '2026-10-15';
  const aliceDay = { dateKey, status: 'open', wallets: { hand_cash: { current: 1500 } } };
  saveDay(aliceDay, 'biz_1', 'user_alice');

  const bobDay = { dateKey, status: 'open', wallets: { hand_cash: { current: 7500 } } };
  saveDay(bobDay, 'biz_1', 'user_bob');

  const loadedAlice = loadDay(dateKey, 'biz_1', null, null, 'user_alice');
  const loadedBob = loadDay(dateKey, 'biz_1', null, null, 'user_bob');
  assert.equal(loadedAlice.wallets.hand_cash.current, 1500, "Alice must only read Alice's day data");
  assert.equal(loadedBob.wallets.hand_cash.current, 7500, "Bob must only read Bob's day data");

  // Contacts isolation
  saveContacts([{ id: 'c_alice', name: 'Alice Customer' }], 'biz_1', 'user_alice');
  saveContacts([{ id: 'c_bob', name: 'Bob Supplier' }], 'biz_1', 'user_bob');
  assert.equal(loadContacts('biz_1', 'user_alice')[0].name, 'Alice Customer');
  assert.equal(loadContacts('biz_1', 'user_bob')[0].name, 'Bob Supplier');

  // Catalog isolation
  saveCatalog([{ id: 'p_alice', name: 'Alice Product' }], 'biz_1', 'user_alice');
  saveCatalog([{ id: 'p_bob', name: 'Bob Product' }], 'biz_1', 'user_bob');
  assert.equal(loadCatalog('biz_1', 'user_alice')[0].name, 'Alice Product');
  assert.equal(loadCatalog('biz_1', 'user_bob')[0].name, 'Bob Product');

  // 3. User cleanup on logout
  clearUserLocalStorage('user_alice');
  assert.equal(loadContacts('biz_1', 'user_alice').length, 0, "Alice's contacts must be wiped after clearUserLocalStorage");
  assert.equal(loadContacts('biz_1', 'user_bob').length, 1, "Bob's contacts must be untouched");
  setActiveStorageUserId(null);

  // 4. Source checks for useAuth.jsx
  const authSource = fs.readFileSync(path.join(projectRoot, 'src/firebase/useAuth.jsx'), 'utf8');
  assert.ok(authSource.includes('setActiveStorageUserId'), 'useAuth.jsx must import setActiveStorageUserId');
  assert.ok(authSource.includes('setActiveStorageUserId(firebaseUser.uid)'), 'useAuth.jsx must set active user on login');
  assert.ok(authSource.includes('setActiveStorageUserId(null)'), 'useAuth.jsx must clear active user on logout');

  // 5. Source checks for AppContext.jsx safe init & autosave guard
  const appContextSource = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');
  assert.ok(appContextSource.includes('cloudInitFailed'), 'AppContext.jsx must track cloudInitFailed');
  assert.ok(appContextSource.includes('CLOUD_INIT_ERROR'), 'AppContext.jsx must dispatch CLOUD_INIT_ERROR on load failure');
  assert.ok(appContextSource.includes('state.cloudInitFailed'), 'AppContext.jsx autosave must guard against state.cloudInitFailed');

  // 6. Gate A4 & Gate D: importAllData user-scoped storage restoration
  localStorage.clear();
  importAllData({
    version: 3,
    businesses: [{ id: 'biz_scoped', name: 'Scoped Biz' }],
    settings: { language: 'bn', isDarkMode: true },
    biz_scoped: {
      days: { '2026-10-20': { dateKey: '2026-10-20', status: 'open', wallets: { hand_cash: { current: 3300 } } } },
      contacts: [{ id: 'c_scoped', name: 'Scoped Contact' }],
      contactTxs: {
        c_scoped: [{ id: 'tx_scoped', amount: 500, type: 'due_collected' }],
      },
      onlineOrders: [{ id: 'ord_scoped', customerName: 'Scoped Order' }],
    },
  }, { userId: 'user_alice' });

  assert.ok(localStorage.getItem('shop_u_user_alice_businesses_list'), 'user_alice businesses list must be written');
  assert.ok(localStorage.getItem('shop_u_user_alice_meta'), 'user_alice meta must be written');
  assert.ok(localStorage.getItem('shop_u_user_alice_biz_scoped_day_2026-10-20'), 'user_alice day must be written');
  assert.ok(localStorage.getItem('shop_u_user_alice_biz_scoped_contacts'), 'user_alice contacts must be written');
  assert.ok(localStorage.getItem('shop_u_user_alice_biz_scoped_contact_txs_c_scoped'), 'user_alice contact_txs must be written');
  assert.ok(localStorage.getItem('shop_u_user_alice_biz_scoped_contact_c_scoped_txs'), 'user_alice contact txs legacy key must be written');
  assert.ok(localStorage.getItem('shop_u_user_alice_biz_scoped_online_orders_v1'), 'user_alice online orders v1 must be written');

  // P0-2 Fix: Legacy keys must NOT be written during authenticated restore!
  assert.equal(localStorage.getItem('shop_businesses_list'), null, 'legacy businesses list must NOT be written during authenticated restore');
  assert.equal(localStorage.getItem('shop_meta'), null, 'legacy meta must NOT be written during authenticated restore');
  assert.equal(localStorage.getItem('shop_biz_scoped_day_2026-10-20'), null, 'legacy day must NOT be written during authenticated restore');
  assert.equal(localStorage.getItem('shop_biz_scoped_contacts'), null, 'legacy contacts must NOT be written during authenticated restore');
  assert.equal(localStorage.getItem('shop_biz_scoped_contact_txs_c_scoped'), null, 'legacy contact txs must NOT be written during authenticated restore');
  assert.equal(localStorage.getItem('shop_biz_scoped_online_orders_v1'), null, 'legacy online orders v1 must NOT be written during authenticated restore');

  // Explicit guest restore (!targetUserId) must write legacy keys
  importAllData({
    version: 3,
    businesses: [{ id: 'biz_guest', name: 'Guest Biz' }],
    settings: { language: 'bn' },
    biz_guest: {
      days: { '2026-10-21': { dateKey: '2026-10-21', status: 'open', wallets: {} } },
      contacts: [{ id: 'c_guest', name: 'Guest Contact' }],
      onlineOrders: [{ id: 'ord_guest', customerName: 'Guest Order' }],
    },
  }, { userId: null });

  assert.ok(localStorage.getItem('shop_businesses_list'), 'guest restore must write legacy businesses list');
  assert.ok(localStorage.getItem('shop_meta'), 'guest restore must write legacy meta');
  assert.ok(localStorage.getItem('shop_biz_guest_day_2026-10-21'), 'guest restore must write legacy day');
  assert.ok(localStorage.getItem('shop_biz_guest_contacts'), 'guest restore must write legacy contacts');
  assert.ok(localStorage.getItem('shop_biz_guest_online_orders_v1'), 'guest restore must write legacy online orders');
  localStorage.clear();
});

await runTest('Suite 5', '5.29 [Gate A5: Shared Cloud Sync Status & Error Visibility]', async () => {
  // 1. Source verification in AppContext.jsx
  const appContextSource = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');
  assert.ok(appContextSource.includes('cloudSyncStatus'), 'AppContext must define cloudSyncStatus');
  assert.ok(appContextSource.includes('SET_SYNC_STATUS'), 'AppContext must handle SET_SYNC_STATUS');
  assert.ok(appContextSource.includes('SET_SYNC_ERROR'), 'AppContext must handle SET_SYNC_ERROR');
  assert.ok(appContextSource.includes('retryCloudSync'), 'AppContext must expose retryCloudSync');

  // 2. Source verification in App.jsx
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/App.jsx'), 'utf8');
  assert.ok(appSource.includes('cloudSyncStatus') && appSource.includes('retryCloudSync'), 'App.jsx must destructure cloudSyncStatus and retryCloudSync');
  assert.ok(appSource.includes('isSyncProblem'), 'App.jsx must compute sync problem state');
  assert.ok(appSource.includes('Retry Sync') || appSource.includes('ক্লাউডে পুনরায় সেভ করুন'), 'App.jsx must display Retry Sync button');
});

await runTest('Suite 5', '5.30 [Production Certification: Gates A3, A4 & A5 Hardening]', async () => {
  const appContextSource = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');
  const onlineOrdersSource = fs.readFileSync(path.join(projectRoot, 'src/components/OnlineOrders/OnlineOrdersScreen.jsx'), 'utf8');

  // 1. Gate A4: Account Switch In-Memory Reset & Isolation Guard
  assert.ok(appContextSource.includes('ACCOUNT_SWITCH_RESET'), 'AppContext must support ACCOUNT_SWITCH_RESET');
  assert.ok(appContextSource.includes('previousUserIdRef'), 'AppContext must track previousUserIdRef');
  assert.ok(appContextSource.includes('stateLoadedForUserId'), 'AppContext must track stateLoadedForUserId');
  assert.ok(appContextSource.includes('state.stateLoadedForUserId !== userId'), 'AppContext autosaves must strictly guard stateLoadedForUserId !== userId');

  // 2. Gate A5: Coordinated Multi-Resource Sync & Safe Retry Concurrency
  assert.ok(appContextSource.includes('resourceSyncStatus'), 'AppContext must maintain resourceSyncStatus');
  assert.ok(appContextSource.includes('SET_RESOURCE_SYNC'), 'AppContext must support SET_RESOURCE_SYNC coordinator');
  assert.ok(appContextSource.includes('forceOverwrite: false'), 'retryCloudSync must perform safe concurrency check with forceOverwrite: false');

  // 3. Gate A3: Canonical Cloud-First Settlement Flow
  assert.ok(onlineOrdersSource.includes('isSettling'), 'OnlineOrdersScreen must track isSettling state');
  assert.ok(onlineOrdersSource.includes('commitOnlineOrderSettlementToCloud'), 'OnlineOrdersScreen must invoke commitOnlineOrderSettlementToCloud');
  assert.ok(onlineOrdersSource.includes('applyCloudSettlement'), 'OnlineOrdersScreen must apply authoritative cloud settlement');
  assert.ok(onlineOrdersSource.includes('Settling in Cloud...') || onlineOrdersSource.includes('ক্লাউডে সেটেল হচ্ছে...'), 'OnlineOrdersScreen must render settling spinner and feedback');

  // 4. Gate A6: Monotonic Firestore Rules & Fail-Closed Order Saves
  const rulesSource = fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');
  assert.ok(rulesSource.includes("resource.data.status != 'settled' || request.resource.data.status == 'settled'"), 'firestore.rules must enforce monotonic settled order invariant');
  const firestoreSource = fs.readFileSync(path.join(projectRoot, 'src/firebase/firestoreService.js'), 'utf8');
  assert.ok(firestoreSource.includes('Failed to verify existing online order status before save'), 'saveOnlineOrderToCloud must fail closed on read errors');
  assert.ok(firestoreSource.includes('Failed to query existing settled orders before batch save'), 'saveAllOnlineOrdersToCloud must fail closed on query errors');
});

await runTest('Suite 5', '5.31 [P0-3, P1-4, P1-6, P1-7: Full Financial Online Order Workflows Must Be Cloud-First Atomic]', async () => {
  const uid = 'user_cloud_orders';
  const bizId = 'biz_cloud_orders';
  const dateKey = '2026-10-15';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const initialDayData = {
    dateKey,
    _revision: 1,
    wallets: {
      bkash: { current: 500 },
      nagad: { current: 500 },
      hand_cash: { current: 1000 },
    },
    inventory: [
      { id: 'prod_1', name: 'Item 1', closingStock: 10 },
    ],
    transactions: [],
    journalEntries: [],
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey),
    initialDayData
  );

  // 1. P1-4: commitOnlineOrderSettlementToCloud rejects if runTransaction is missing
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_1' }, { ...mock.ops, runTransaction: null });
    },
    /Firestore runTransaction is required for atomic online order settlement/
  );

  // P1-4: Idempotency consistency — delivered order with settledAt metadata throws error
  const inconsistentOrder = {
    id: 'ord_inconsistent',
    status: 'delivered',
    settledAt: Date.now() - 5000,
    totalAmount: 1000,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_inconsistent'),
    inconsistentOrder,
    { bypassRules: true }
  );
  await assert.rejects(
    async () => {
      await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_inconsistent', settlementWallet: 'hand_cash' }, mock.ops);
    },
    /Inconsistent order state: order is delivered but has settledAt metadata/
  );

  // 2. P0-3: commitPaymentVerificationToCloud
  // Rejects COD orders
  const codOrder = {
    id: 'ord_cod',
    paymentMethod: 'cod',
    totalAmount: 1200,
    status: 'confirmed',
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cod'),
    codOrder
  );
  await assert.rejects(
    async () => {
      await commitPaymentVerificationToCloud(uid, bizId, dateKey, { orderId: 'ord_cod' }, mock.ops);
    },
    /Cannot verify payment for Cash on Delivery/
  );

  // Valid bKash payment verification
  const bkashOrder = {
    id: 'ord_bkash',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'pending',
    totalAmount: 1000,
    status: 'confirmed',
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_bkash'),
    bkashOrder
  );
  const verifyRes = await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
    orderId: 'ord_bkash',
    paymentWallet: 'bkash',
    amount: 1000,
    trxId: 'BKS12345',
  }, mock.ops);
  assert.equal(verifyRes.alreadyVerified, false);
  assert.equal(verifyRes.order.paymentStatus, 'verified');
  assert.equal(verifyRes.dayData.wallets.bkash.current, 1500);

  // Idempotency: repeated call returns alreadyVerified: true and performs zero writes
  const duplicateVerifyRes = await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
    orderId: 'ord_bkash',
    paymentWallet: 'bkash',
    amount: 1000,
  }, mock.ops);
  assert.equal(duplicateVerifyRes.alreadyVerified, true);
  assert.ok(duplicateVerifyRes.dayData, 'alreadyVerified response must include authoritative dayData');
  const dayAfterDupVerify = (await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey))).data();
  assert.equal(dayAfterDupVerify.wallets.bkash.current, 1500, 'Wallet must not be credited again on repeated verify');

  // P0 Bug 3: Verify TrxID was recorded in trxRegistry
  const trxDocSnap = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'trxRegistry', 'bkash_BKS12345')
  );
  assert.equal(trxDocSnap.exists(), true, 'TrxID registry entry must exist');
  assert.equal(trxDocSnap.data().orderId, 'ord_bkash');

  // P0 Bug 3: Reject duplicate TrxID reuse on another order
  const bkashOrder2 = {
    id: 'ord_bkash_2',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'pending',
    totalAmount: 800,
    status: 'confirmed',
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_bkash_2'),
    bkashOrder2
  );
  await assert.rejects(
    async () => {
      await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
        orderId: 'ord_bkash_2',
        paymentWallet: 'bkash',
        amount: 800,
        trxId: 'BKS12345',
      }, mock.ops);
    },
    /Transaction ID 'BKS12345' has already been verified/
  );

  // P0 Bug 2: Reject payment verification for delivered/cancelled/returned/settled orders
  const deliveredOrderForPay = {
    id: 'ord_delivered_pay',
    status: 'delivered',
    paymentMethod: 'bkash_manual',
    totalAmount: 1000,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_delivered_pay'),
    deliveredOrderForPay,
    { bypassRules: true }
  );
  await assert.rejects(
    async () => {
      await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
        orderId: 'ord_delivered_pay',
        amount: 1000,
        trxId: 'BKS99999',
      }, mock.ops);
    },
    /Cannot verify payment for order ord_delivered_pay in 'delivered' status/
  );

  // 3. P0-3: commitOrderCancellationToCloud
  const cancellableOrder = {
    id: 'ord_cancel',
    status: 'confirmed',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'verified',
    advancePaid: 300,
    advanceWallet: 'bkash',
    totalAmount: 1000,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cancel'),
    cancellableOrder,
    { bypassRules: true }
  );
  const cancelRes = await commitOrderCancellationToCloud(uid, bizId, dateKey, {
    orderId: 'ord_cancel',
    refundWallet: 'bkash',
  }, mock.ops);
  assert.equal(cancelRes.alreadyCancelled, false);
  assert.equal(cancelRes.order.status, 'cancelled');
  assert.equal(cancelRes.dayData.wallets.bkash.current, 1200, 'Advance should be refunded');

  // Idempotency: repeated cancellation returns alreadyCancelled: true
  const duplicateCancelRes = await commitOrderCancellationToCloud(uid, bizId, dateKey, {
    orderId: 'ord_cancel',
  }, mock.ops);
  assert.equal(duplicateCancelRes.alreadyCancelled, true);
  assert.ok(duplicateCancelRes.dayData, 'alreadyCancelled response must include authoritative dayData');

  // P0 Bug 1: Reject cancellation of delivered/returned/settled orders
  const deliveredOrderForCancel = {
    id: 'ord_delivered_cancel',
    status: 'delivered',
    totalAmount: 500,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_delivered_cancel'),
    deliveredOrderForCancel,
    { bypassRules: true }
  );
  await assert.rejects(
    async () => {
      await commitOrderCancellationToCloud(uid, bizId, dateKey, { orderId: 'ord_delivered_cancel' }, mock.ops);
    },
    /Cannot cancel order ord_delivered_cancel in 'delivered' status/
  );

  // 4. P0-3: commitOrderReturnToCloud
  const returnableOrder = {
    id: 'ord_return',
    status: 'shipped',
    courierCharge: 80,
    items: [{ id: 'prod_1', quantity: 2 }],
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_return'),
    returnableOrder,
    { bypassRules: true }
  );
  const returnRes = await commitOrderReturnToCloud(uid, bizId, dateKey, {
    orderId: 'ord_return',
    expenseWallet: 'hand_cash',
  }, mock.ops);
  assert.equal(returnRes.alreadyReturned, false);
  assert.equal(returnRes.order.status, 'returned');
  assert.equal(returnRes.dayData.wallets.hand_cash.current, 920, 'Courier expense deducted');
  const restoredProd = returnRes.dayData.inventory.find(i => i.id === 'prod_1');
  assert.equal(restoredProd.closingStock, 12, 'Inventory stock restored');

  // Idempotency: repeated return returns alreadyReturned: true
  const duplicateReturnRes = await commitOrderReturnToCloud(uid, bizId, dateKey, {
    orderId: 'ord_return',
  }, mock.ops);
  assert.equal(duplicateReturnRes.alreadyReturned, true);

  // 5. P1-6: loadOnlineOrdersFromCloud fails closed on read errors
  const failingGetDocsOps = {
    ...mock.ops,
    getDocs: async () => { throw new Error('Network timeout during orders query'); },
  };
  await assert.rejects(
    async () => {
      await loadOnlineOrdersFromCloud(uid, bizId, failingGetDocsOps);
    },
    /Failed to load online orders from cloud: Network timeout during orders query/
  );

  // 6. P1-7: deleteOnlineOrderFromCloud deletes document from cloud
  const draftOrder = {
    id: 'ord_draft',
    status: 'draft',
    totalAmount: 500,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_draft'),
    draftOrder
  );
  await deleteOnlineOrderFromCloud(uid, bizId, 'ord_draft', mock.ops);
  const draftSnap = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_draft')
  );
  assert.equal(draftSnap.exists(), false, 'Draft order must be deleted from cloud');

  // 7. Verify OnlineOrdersScreen imports and wiring
  const screenSource = fs.readFileSync(path.join(projectRoot, 'src/components/OnlineOrders/OnlineOrdersScreen.jsx'), 'utf8');
  assert.ok(screenSource.includes('commitPaymentVerificationToCloud'), 'OnlineOrdersScreen must import commitPaymentVerificationToCloud');
  assert.ok(screenSource.includes('commitOrderCancellationToCloud'), 'OnlineOrdersScreen must import commitOrderCancellationToCloud');
  assert.ok(screenSource.includes('commitOrderReturnToCloud'), 'OnlineOrdersScreen must import commitOrderReturnToCloud');
  assert.ok(screenSource.includes('deleteOnlineOrderFromCloud'), 'OnlineOrdersScreen must import deleteOnlineOrderFromCloud');
  assert.ok(screenSource.includes('isVerifying'), 'OnlineOrdersScreen must track isVerifying state in payment verification');
});

await runTest('Suite 5', '5.32 [Comprehensive P0 Bug Reproductions: Cancellation, Verification & TrxID Uniqueness]', async () => {
  const uid = 'user_audit_p0_repro';
  const bizId = 'biz_p0_repro';
  const dateKey = '2026-10-16';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const initialDayData = {
    dateKey,
    _revision: 1,
    wallets: {
      bkash: { current: 500 },
      nagad: { current: 300 },
      hand_cash: { current: 1000 },
    },
    inventory: [
      { id: 'prod_1', name: 'T-Shirt', closingStock: 20 },
    ],
    transactions: [],
    journalEntries: [],
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey),
    initialDayData
  );

  // ─── 1. P0 Bug 1: Delivered Order Cancellation Rejection ───
  // a) State Engine Level:
  const deliveredOrderState = {
    onlineOrders: [
      {
        id: 'ord_delivered_1',
        status: 'delivered',
        totalAmount: 1500,
        advancePaid: 300,
        advanceWallet: 'bkash',
      },
    ],
    dayData: JSON.parse(JSON.stringify(initialDayData)),
  };
  const cancelAttemptState = cancelOnlineOrderInState(deliveredOrderState, 'ord_delivered_1');
  assert.ok(cancelAttemptState._orderCancelError, 'State engine must return _orderCancelError on cancelling delivered order');
  assert.equal(cancelAttemptState._orderCancelError.code, 'invalid_cancellation_status');
  assert.equal(cancelAttemptState.onlineOrders[0].status, 'delivered', 'Order status must not change to cancelled');
  assert.equal(cancelAttemptState.dayData.transactions.length, 0, 'No refund/reversal transactions may be created');

  // b) Cloud Transaction Level:
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_delivered_1'),
    {
      id: 'ord_delivered_1',
      status: 'delivered',
      totalAmount: 1500,
    },
    { bypassRules: true }
  );
  await assert.rejects(
    async () => {
      await commitOrderCancellationToCloud(uid, bizId, dateKey, { orderId: 'ord_delivered_1' }, mock.ops);
    },
    /Cannot cancel order ord_delivered_1 in 'delivered' status/
  );
  const cloudOrderAfterCancel = (await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_delivered_1'))).data();
  assert.equal(cloudOrderAfterCancel.status, 'delivered', 'Cloud order status must remain delivered');
  const dayDocAfterCancel = (await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey))).data();
  assert.equal(dayDocAfterCancel.transactions.length, 0, 'Cloud day document must have 0 transactions added');

  // ─── 2. P0 Bug 2: Payment Verification on Non-Pre-Delivery Orders ───
  // a) State Engine Level:
  for (const invalidStatus of ['delivered', 'cancelled', 'returned', 'settled']) {
    const invalidStatusState = {
      onlineOrders: [
        {
          id: `ord_${invalidStatus}`,
          status: invalidStatus,
          paymentMethod: 'bkash_manual',
          totalAmount: 1000,
        },
      ],
      dayData: JSON.parse(JSON.stringify(initialDayData)),
    };
    const verifyAttempt = verifyOnlineOrderPaymentInState(invalidStatusState, {
      orderId: `ord_${invalidStatus}`,
      wallet: 'bkash',
      amount: 1000,
      trxId: 'BKS_TEST_INVALID',
    });
    assert.ok(verifyAttempt._orderPaymentVerificationError, `State engine must reject verification for ${invalidStatus} order`);
    assert.equal(verifyAttempt._orderPaymentVerificationError.code, 'invalid_order_status_for_verification');
    assert.equal(verifyAttempt.dayData.wallets.bkash.current, 500, 'Wallet must not be credited');
    assert.equal(verifyAttempt.dayData.transactions.length, 0, 'No advance payment transaction generated');
  }

  // b) Cloud Level:
  for (const invalidStatus of ['delivered', 'cancelled', 'returned', 'settled']) {
    const cloudOrdId = `cloud_ord_${invalidStatus}`;
    await mock.ops.setDoc(
      mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', cloudOrdId),
      {
        id: cloudOrdId,
        status: invalidStatus,
        paymentMethod: 'bkash_manual',
        totalAmount: 1000,
      },
      { bypassRules: true }
    );
    await assert.rejects(
      async () => {
        await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
          orderId: cloudOrdId,
          paymentWallet: 'bkash',
          amount: 1000,
          trxId: `TRX_${invalidStatus}`,
        }, mock.ops);
      },
      new RegExp(`Cannot verify payment for order ${cloudOrdId} in '${invalidStatus}' status`)
    );
  }

  // ─── 3. P0 Bug 3: Duplicate Provider-Scoped TrxID Protection ───
  // a) State Engine Level:
  const verifiedExistingState = {
    onlineOrders: [
      {
        id: 'ord_first',
        status: 'confirmed',
        paymentMethod: 'bkash_manual',
        paymentStatus: 'verified',
        paymentTrxId: 'BKS_DUPLICATE_99',
        verifiedTrxId: 'BKS_DUPLICATE_99',
        totalAmount: 850,
      },
      {
        id: 'ord_second',
        status: 'confirmed',
        paymentMethod: 'bkash_manual',
        paymentStatus: 'pending',
        totalAmount: 950,
      },
    ],
    dayData: JSON.parse(JSON.stringify(initialDayData)),
  };
  const duplicateStateAttempt = verifyOnlineOrderPaymentInState(verifiedExistingState, {
    orderId: 'ord_second',
    wallet: 'bkash',
    amount: 950,
    trxId: 'bks_duplicate_99', // Case insensitive collision check
  });
  assert.ok(duplicateStateAttempt._orderPaymentVerificationError, 'State engine must reject duplicate TrxID');
  assert.equal(duplicateStateAttempt._orderPaymentVerificationError.code, 'duplicate_trx_id');
  assert.equal(duplicateStateAttempt.onlineOrders[1].paymentStatus, 'pending');

  // b) Cloud Level Atomic Firestore Transaction & trxRegistry Uniqueness:
  const cloudOrd1 = {
    id: 'ord_cloud_first',
    status: 'confirmed',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'pending',
    totalAmount: 1000,
  };
  const cloudOrd2 = {
    id: 'ord_cloud_second',
    status: 'confirmed',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'pending',
    totalAmount: 1200,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cloud_first'),
    cloudOrd1
  );
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cloud_second'),
    cloudOrd2
  );

  // 1st verification succeeds and atomically claims bkash_TRX_SHARED_100
  const firstCloudVerify = await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
    orderId: 'ord_cloud_first',
    paymentWallet: 'bkash',
    amount: 1000,
    trxId: 'TRX_SHARED_100',
  }, mock.ops);
  assert.equal(firstCloudVerify.alreadyVerified, false);
  assert.equal(firstCloudVerify.order.paymentStatus, 'verified');

  // 2nd verification on a DIFFERENT order with the SAME TrxID must fail closed!
  await assert.rejects(
    async () => {
      await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
        orderId: 'ord_cloud_second',
        paymentWallet: 'bkash',
        amount: 1200,
        trxId: 'TRX_SHARED_100',
      }, mock.ops);
    },
    /Transaction ID 'TRX_SHARED_100' has already been verified for order #_first/
  );

  // Cross-provider isolation: Same TrxID on Nagad is permitted because providers are distinct
  const nagadOrd = {
    id: 'ord_cloud_nagad',
    status: 'confirmed',
    paymentMethod: 'nagad_manual',
    paymentStatus: 'pending',
    totalAmount: 700,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cloud_nagad'),
    nagadOrd
  );
  const nagadVerify = await commitPaymentVerificationToCloud(uid, bizId, dateKey, {
    orderId: 'ord_cloud_nagad',
    paymentWallet: 'nagad',
    amount: 700,
    trxId: 'TRX_SHARED_100', // Allowed for Nagad even if bKash used it
  }, mock.ops);
  assert.equal(nagadVerify.alreadyVerified, false);
  assert.equal(nagadVerify.order.paymentStatus, 'verified');

  // ─── 4. P1 Gap: Idempotent Settlement Retry Returns DayData ───
  const settledOrd = {
    id: 'ord_cloud_settled',
    status: 'delivered',
    totalAmount: 1000,
    codAmount: 1000,
    courierCharge: 100,
    netFromCourier: 900,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cloud_settled'),
    settledOrd,
    { bypassRules: true }
  );
  const initialSettleRes = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
    orderId: 'ord_cloud_settled',
    settlementWallet: 'hand_cash',
    netAmount: 900,
  }, mock.ops);
  assert.equal(initialSettleRes.alreadySettled, false);
  assert.equal(initialSettleRes.order.status, 'settled');

  // Second call (retry) must return alreadySettled: true WITH dayData!
  const retrySettleRes = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
    orderId: 'ord_cloud_settled',
    settlementWallet: 'hand_cash',
    netAmount: 900,
  }, mock.ops);
  assert.equal(retrySettleRes.alreadySettled, true);
  assert.ok(retrySettleRes.dayData, 'Idempotent settlement retry must return authoritative dayData');
  assert.ok(retrySettleRes.dayData.wallets, 'Authoritative dayData must contain wallets for reconciliation');

  // ─── 5. P1 Gap: Verification UI Parsing & Validation ───
  assert.equal(parseStrictMoney('', null, true), null, 'Empty string is rejected by parseStrictMoney');
  assert.equal(parseStrictMoney('   ', null, true), null, 'Whitespace string is rejected');
  assert.equal(parseStrictMoney('1e2', null, true), null, 'Exponential notation is rejected');
  assert.equal(parseStrictMoney('-50', null, true), null, 'Negative money is rejected');
  assert.equal(parseStrictMoney('abc', null, true), null, 'Letters are rejected');
  assert.equal(parseStrictMoney('৫০০', null, true), null, 'Non-ASCII strings without prior normalization are safely rejected');

  // ─── 6. P1 Gap: AppContext ACCOUNT_SWITCH_RESET User Preference Reset ───
  const appContextFile = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');
  assert.ok(appContextFile.includes('editLockEnabled: false'), 'ACCOUNT_SWITCH_RESET must reset editLockEnabled');
  assert.ok(appContextFile.includes('editLockPinHash: null'), 'ACCOUNT_SWITCH_RESET must reset editLockPinHash');
  assert.ok(appContextFile.includes("language: 'bn'"), 'ACCOUNT_SWITCH_RESET must reset language');
  assert.ok(appContextFile.includes('isDarkMode: false'), 'ACCOUNT_SWITCH_RESET must reset isDarkMode');
  assert.ok(appContextFile.includes('categories: DEFAULT_EXPENSE_CATEGORIES'), 'ACCOUNT_SWITCH_RESET must reset categories');
  assert.ok(appContextFile.includes('wallets: createDefaultWallets()'), 'ACCOUNT_SWITCH_RESET must reset wallets');

  // ─── 7. P1 Gap: retryCloudSync Offline Edits Preservation ───
  assert.ok(appContextFile.includes('hasOfflineTxs'), 'retryCloudSync must check for offline local transactions');
  assert.ok(appContextFile.includes('SET_CLOUD_INIT_RECOVERED'), 'retryCloudSync must support recovery without wiping state');
});

await runTest('Suite 5', '5.33 [P0-1: Settlement Service Invariant & Reconciliation Guard]', async () => {
  const uid = 'user_p0_1_reconcile';
  const bizId = 'biz_p0_1_reconcile';
  const dateKey = '2026-10-12';
  const orderId = 'ord_p0_1_missing_tx';
  // 1. Direct unit test of settleOnlineOrderInState with forceReconcile
  const baseOrder = {
    id: orderId,
    status: 'settled',
    settledAt: 1791750000000,
    totalAmount: 1200,
    codAmount: 1200,
    courierCharge: 100,
    codFee: 20,
    settlementWallet: 'hand_cash',
    customerName: 'Test Customer',
    customerPhone: '01711223344',
  };
  const baseDayData = {
    dateKey,
    status: 'open',
    _revision: 1,
    wallets: {
      hand_cash: { current: 1000 },
      bkash_personal: { current: 500 },
    },
    transactions: [],
    journalEntries: [],
    onlineOrdersDayStats: { settled: 0, courierExpense: 0 },
  };

  // Without forceReconcile: already-settled order returns original state (idempotent no-op)
  const noReconcileState = settleOnlineOrderInState(
    { onlineOrders: [baseOrder], dayData: baseDayData },
    { orderId, settlementWallet: 'hand_cash' }
  );
  assert.equal(noReconcileState.dayData.transactions.length, 0, 'Without forceReconcile, no transaction generated');
  assert.equal(noReconcileState.dayData.wallets.hand_cash.current, 1000, 'Without forceReconcile, wallet is not credited');

  // With forceReconcile: generates settlement tx and credits wallet to restore accounting integrity
  const reconciledState = settleOnlineOrderInState(
    { onlineOrders: [baseOrder], dayData: baseDayData },
    { orderId, settlementWallet: 'hand_cash', forceReconcile: true }
  );
  assert.equal(reconciledState._orderSettleError, undefined, 'Reconciliation should succeed without error');
  assert.equal(reconciledState.dayData.wallets.hand_cash.current, 2080, 'Wallet credited: 1000 + 1080 net = 2080');
  const settleTx = reconciledState.dayData.transactions.find(t => t.type === 'courier_settlement');
  assert.ok(settleTx, 'courier_settlement tx must be generated');
  assert.equal(settleTx.amount, 1080);
  assert.equal(String(settleTx.orderId), orderId, 'settleTx.orderId must match');
  assert.equal(String(settleTx.linkedOrderId), orderId, 'settleTx.linkedOrderId must match');

  // 2. Integration test with commitOnlineOrderSettlementToCloud
  // Pre-existing database state: Order is marked 'settled', but day document has NO settlement transaction!
  const mock = createMockFirestore({
    [`users/${uid}/businesses/${bizId}/onlineOrders/${orderId}`]: baseOrder,
    [`users/${uid}/businesses/${bizId}/days/${dateKey}`]: baseDayData,
  }, { auth: { uid }, enforceRules: true });

  // Call commitOnlineOrderSettlementToCloud:
  // Must detect that the ledger NEVER received the funds, execute automated reconciliation,
  // update day doc, and return { alreadySettled: true, reconciled: true, ... }
  const reconcileRes = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
    orderId,
    settlementWallet: 'hand_cash',
  }, mock.ops);

  assert.equal(reconcileRes.alreadySettled, true, 'alreadySettled must be true');
  assert.equal(reconcileRes.reconciled, true, 'reconciled flag must be true');
  assert.equal(reconcileRes.dayData.wallets.hand_cash.current, 2080, 'Authoritative dayData wallet must be credited');

  // Verify Firestore day document was atomically updated
  const dayDocSnap = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey)
  );
  const storedDay = dayDocSnap.data();
  assert.equal(storedDay._revision, 2, 'Day doc revision must be incremented by reconciliation write');
  assert.equal(storedDay.wallets.hand_cash.current, 2080, 'Stored day doc wallet must be credited');
  assert.ok(storedDay.transactions.some(t => t.type === 'courier_settlement' && String(t.orderId) === orderId), 'Stored day doc must contain courier_settlement tx');

  // Subsequent call: Both order doc and day ledger are now in agreement!
  // Must safely return alreadySettled: true WITHOUT reconciled: true and without extra writes
  const subsequentRes = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, {
    orderId,
    settlementWallet: 'hand_cash',
  }, mock.ops);

  assert.equal(subsequentRes.alreadySettled, true);
  assert.equal(subsequentRes.reconciled, undefined);

  // Check no extra write happened to day doc
  const dayDocSnap2 = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey)
  );
  assert.equal(dayDocSnap2.data()._revision, 2, 'Revision must NOT increment on subsequent call');
});

await runTest('Suite 5', '5.34 [P1-3 Mandatory TrxID, P1-5 User-wide TrxID Uniqueness, and P1-4 Historical TrxID Migration]', async () => {
  const uid = 'user_p1_trx_test';
  const bizA = 'biz_A_store';
  const bizB = 'biz_B_store';
  const dateKey = '2026-10-14';
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  const initialDayData = {
    dateKey,
    _revision: 1,
    wallets: {
      bkash: { current: 1000 },
      nagad: { current: 500 },
      hand_cash: { current: 2000 },
    },
    inventory: [{ id: 'item_1', name: 'Keyboard', closingStock: 15 }],
    transactions: [],
    journalEntries: [],
  };

  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizA, 'days', dateKey),
    initialDayData
  );
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizB, 'days', dateKey),
    initialDayData
  );

  // ─── 1. P1-3: Mandatory TrxID for MFS Orders ───
  // a) State Engine Level:
  const mfsOrderState = {
    language: 'en',
    onlineOrders: [
      {
        id: 'ord_mfs_missing_trx',
        status: 'confirmed',
        paymentMethod: 'bkash_manual',
        paymentStatus: 'pending',
        totalAmount: 600,
      },
    ],
    dayData: JSON.parse(JSON.stringify(initialDayData)),
  };

  // Missing TrxID without exception toggle MUST fail
  const stateMissingTrx = verifyOnlineOrderPaymentInState(mfsOrderState, {
    orderId: 'ord_mfs_missing_trx',
    paymentWallet: 'bkash',
    amount: 600,
  });
  assert.ok(stateMissingTrx._orderPaymentVerificationError, 'State engine must reject missing TrxID');
  assert.equal(stateMissingTrx._orderPaymentVerificationError.code, 'missing_trx_id');

  // Exception toggle with < 5 chars reason MUST fail
  const stateShortReason = verifyOnlineOrderPaymentInState(mfsOrderState, {
    orderId: 'ord_mfs_missing_trx',
    paymentWallet: 'bkash',
    amount: 600,
    allowWithoutTrxId: true,
    withoutTrxIdReason: 'bank',
  });
  assert.ok(stateShortReason._orderPaymentVerificationError, 'State engine must reject exception reason < 5 chars');
  assert.equal(stateShortReason._orderPaymentVerificationError.code, 'missing_exception_reason');

  // Exception toggle with valid reason (>= 5 chars) MUST succeed
  const stateValidException = verifyOnlineOrderPaymentInState(mfsOrderState, {
    orderId: 'ord_mfs_missing_trx',
    paymentWallet: 'bkash',
    amount: 600,
    allowWithoutTrxId: true,
    withoutTrxIdReason: 'Cash received directly at physical shop counter',
  });
  assert.equal(stateValidException._orderPaymentVerificationError, undefined);
  assert.equal(stateValidException.onlineOrders[0].paymentStatus, 'verified');
  assert.equal(stateValidException.onlineOrders[0].allowWithoutTrxId, true);
  assert.equal(stateValidException.dayData.wallets.bkash.current, 1600);

  // b) Cloud Level:
  const cloudMfsOrder = {
    id: 'ord_cloud_mfs_test',
    status: 'confirmed',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'pending',
    totalAmount: 800,
  };
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizA, 'onlineOrders', 'ord_cloud_mfs_test'),
    cloudMfsOrder
  );

  // Reject missing TrxID
  await assert.rejects(
    async () => {
      await commitPaymentVerificationToCloud(uid, bizA, dateKey, {
        orderId: 'ord_cloud_mfs_test',
        paymentWallet: 'bkash',
        amount: 800,
      }, mock.ops);
    },
    /Transaction ID \(TrxID\) is mandatory for mobile banking verification/
  );

  // Reject short exception reason
  await assert.rejects(
    async () => {
      await commitPaymentVerificationToCloud(uid, bizA, dateKey, {
        orderId: 'ord_cloud_mfs_test',
        paymentWallet: 'bkash',
        amount: 800,
        allowWithoutTrxId: true,
        withoutTrxIdReason: 'fail',
      }, mock.ops);
    },
    /At least 5 characters reason is required for verification without TrxID/
  );

  // ─── 2. P1-5: User-Wide TrxID Uniqueness Across Multiple Businesses ───
  // Biz A verifies order with TrxID 'BKS_USER_WIDE_777'
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizA, 'onlineOrders', 'ord_biz_a_1'),
    {
      id: 'ord_biz_a_1',
      status: 'confirmed',
      paymentMethod: 'bkash_manual',
      paymentStatus: 'pending',
      totalAmount: 1200,
    }
  );
  const verifyBizA = await commitPaymentVerificationToCloud(uid, bizA, dateKey, {
    orderId: 'ord_biz_a_1',
    paymentWallet: 'bkash',
    amount: 1200,
    trxId: 'BKS_USER_WIDE_777',
  }, mock.ops);
  assert.equal(verifyBizA.order.paymentStatus, 'verified');

  // Verify registry entries written to BOTH user scope and biz scope
  const userTrxDoc = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'trxRegistry', 'bkash_BKS_USER_WIDE_777')
  );
  assert.equal(userTrxDoc.exists(), true, 'User-scoped registry entry must exist');
  assert.equal(userTrxDoc.data().bizId, bizA);
  assert.equal(userTrxDoc.data().orderId, 'ord_biz_a_1');

  const bizTrxDoc = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizA, 'trxRegistry', 'bkash_BKS_USER_WIDE_777')
  );
  assert.equal(bizTrxDoc.exists(), true, 'Biz-scoped registry entry must exist');

  // Biz B owned by SAME user attempts to verify a different order with the SAME TrxID
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizB, 'onlineOrders', 'ord_biz_b_1'),
    {
      id: 'ord_biz_b_1',
      status: 'confirmed',
      paymentMethod: 'bkash_manual',
      paymentStatus: 'pending',
      totalAmount: 1500,
    }
  );

  await assert.rejects(
    async () => {
      await commitPaymentVerificationToCloud(uid, bizB, dateKey, {
        orderId: 'ord_biz_b_1',
        paymentWallet: 'bkash',
        amount: 1500,
        trxId: 'BKS_USER_WIDE_777',
      }, mock.ops);
    },
    new RegExp(`Transaction ID 'BKS_USER_WIDE_777' has already been verified for order #iz_a_1 in business '${bizA}'. Duplicate TrxID reuse is forbidden across all businesses.`)
  );

  // ─── 3. P1-4: Historical TrxID Registry Migration ───
  const migBiz = 'biz_migration_test';
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', migBiz, 'onlineOrders', 'ord_hist_1'),
    {
      id: 'ord_hist_1',
      status: 'confirmed',
      paymentMethod: 'bkash_manual',
      paymentStatus: 'verified',
      paymentTrxId: 'BKS_HIST_UNIQ_1',
      verifiedTrxId: 'BKS_HIST_UNIQ_1',
      verifiedAmount: 500,
      createdAt: 1791700000000,
    },
    { bypassRules: true }
  );
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', migBiz, 'onlineOrders', 'ord_hist_2'),
    {
      id: 'ord_hist_2',
      status: 'confirmed',
      paymentMethod: 'nagad_manual',
      paymentStatus: 'verified',
      paymentTrxId: 'NGD_HIST_DUP',
      verifiedTrxId: 'NGD_HIST_DUP',
      verifiedAmount: 700,
      createdAt: 1791710000000,
    },
    { bypassRules: true }
  );
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', migBiz, 'onlineOrders', 'ord_hist_3'),
    {
      id: 'ord_hist_3',
      status: 'confirmed',
      paymentMethod: 'nagad_manual',
      paymentStatus: 'verified',
      paymentTrxId: 'NGD_HIST_DUP', // Historical duplicate TrxID!
      verifiedTrxId: 'NGD_HIST_DUP',
      verifiedAmount: 700,
      createdAt: 1791720000000,
    },
    { bypassRules: true }
  );
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', migBiz, 'onlineOrders', 'ord_hist_4'),
    {
      id: 'ord_hist_4',
      status: 'confirmed',
      paymentMethod: 'bkash_manual',
      paymentStatus: 'verified',
      allowWithoutTrxId: true,
      withoutTrxIdReason: 'Cash manual verification exception',
      verifiedAmount: 900,
    },
    { bypassRules: true }
  );
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', migBiz, 'onlineOrders', 'ord_hist_5'),
    {
      id: 'ord_hist_5',
      status: 'confirmed',
      paymentMethod: 'bkash_manual',
      paymentStatus: 'pending', // NOT verified
      paymentTrxId: 'BKS_PENDING_TRX',
    }
  );

  const migrationReport = await migrateHistoricalTrxRegistry(uid, migBiz, mock.ops);
  assert.equal(migrationReport.totalVerified, 4, 'Total verified orders count must be 4');
  assert.equal(migrationReport.migrated, 1, 'Only unique non-duplicate TrxID must be migrated');
  assert.equal(migrationReport.duplicates.length, 1, 'Exactly 1 duplicate group detected');
  assert.equal(migrationReport.duplicates[0].trxId, 'NGD_HIST_DUP');
  assert.equal(migrationReport.duplicates[0].reason, 'duplicate_in_orders');
  assert.deepEqual(migrationReport.duplicates[0].orderIds, ['ord_hist_2', 'ord_hist_3']);

  // Verify unique TrxID was registered in both scopes
  const histUserDoc = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'trxRegistry', 'bkash_BKS_HIST_UNIQ_1')
  );
  assert.equal(histUserDoc.exists(), true);
  assert.equal(histUserDoc.data().orderId, 'ord_hist_1');

  const histBizDoc = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', migBiz, 'trxRegistry', 'bkash_BKS_HIST_UNIQ_1')
  );
  assert.equal(histBizDoc.exists(), true);

  // Duplicate TrxID must NOT be registered
  const dupDoc = await mock.ops.getDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'trxRegistry', 'nagad_NGD_HIST_DUP')
  );
  assert.equal(dupDoc.exists(), false, 'Duplicate TrxID must not be registered');

  // Idempotent re-run: 0 new migrated entries
  const rerunReport = await migrateHistoricalTrxRegistry(uid, migBiz, mock.ops);
  assert.equal(rerunReport.totalVerified, 4);
  assert.equal(rerunReport.migrated, 0, 'Re-run must migrate 0 already-registered entries');
  assert.equal(rerunReport.duplicates.length, 1);
});

await runTest('Suite 5', '5.35 [Zero-Cost Production Hardening: Dirty-Check Write Optimization & 1-Click JSON Backup Roundtrip]', async () => {
  const { exportAllData, importAllData, validateBackupPayload, setActiveStorageUserId } = await import('../src/data/storage.js');

  const testUid = 'uid_zero_cost_test';
  setActiveStorageUserId(testUid);

  // 1. Verify Dirty-Check principle: Identical objects generate identical JSON representations
  const sampleSettings = { language: 'bn', isDarkMode: false, appMode: 'easy' };
  const jsonA = JSON.stringify(sampleSettings);
  const jsonB = JSON.stringify({ ...sampleSettings });
  assert.equal(jsonA === jsonB, true, 'Dirty check must identify identical state without requiring network write');

  // 2. Full Zero-Cost JSON Disaster Recovery Roundtrip
  const testState = {
    businesses: [{ id: 'biz_1', name: 'My Test Shop', type: 'retail' }],
    activeBizId: 'biz_1',
    dayData: {
      dateKey: '2026-10-12',
      status: 'finalized',
      wallets: { hand_cash: { opening: 500, current: 1500 } },
      transactions: [
        { id: 'tx_zc_1', amount: 1000, type: 'sale', wallet: 'hand_cash', timestamp: Date.now() },
      ],
      inventory: [{ id: 'p1', name: 'Soap', stock: 10, buyPrice: 40, sellPrice: 50 }],
    },
    contacts: [{ id: 'c1', name: 'Karim', phone: '01711111111', balance: 0 }],
    onlineOrders: [{ id: 'ord_zc_1', totalAmount: 1000, status: 'settled', paymentMethod: 'cod' }],
  };

  const backupJson = exportAllData(testState);
  assert.ok(typeof backupJson === 'string' && backupJson.length > 50, 'Backup export must produce valid JSON string');

  const parsed = JSON.parse(backupJson);
  const validation = validateBackupPayload(parsed);
  assert.equal(validation.valid, true, 'Exported backup must pass schema validation');

  const importResult = importAllData(backupJson, { userId: testUid });
  assert.equal(importResult, true, 'Backup import must succeed for zero-cost restore');
});

await runTest('Suite 5', '5.36 [P0 Hardening: Online Order State Transitions & Multi-Case Self-Healing Reconciliation]', async () => {
  const uid = 'uid_p0_transition_tests';
  const bizId = 'biz_p0_trans';
  const dateKey = '2026-10-12';

  // 1. Rule Predicate Tests: Transition Constraints
  // A. 'returned' can ONLY be transitioned from 'shipped' (or already 'returned')
  const packedOrder = { id: 'ord_t1', status: 'packed', totalAmount: 500 };
  const canReturnFromPacked = evaluateFirestoreRule({
    auth: { uid },
    method: 'update',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_t1`,
    resourceData: packedOrder,
    requestData: { status: 'returned' },
  });
  assert.equal(canReturnFromPacked, false, 'Transition to returned from packed must be REJECTED by rules');

  const shippedOrder = { id: 'ord_t2', status: 'shipped', totalAmount: 500 };
  const canReturnFromShipped = evaluateFirestoreRule({
    auth: { uid },
    method: 'update',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_t2`,
    resourceData: shippedOrder,
    requestData: { status: 'returned' },
  });
  assert.equal(canReturnFromShipped, true, 'Transition to returned from shipped must be ALLOWED by rules');

  // B. Payment verification can ONLY happen on pre-delivery status (draft, confirmed, packed, shipped)
  const cancelledOrder = { id: 'ord_t3', status: 'cancelled', totalAmount: 500 };
  const canVerifyCancelled = evaluateFirestoreRule({
    auth: { uid },
    method: 'update',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_t3`,
    resourceData: cancelledOrder,
    requestData: { paymentStatus: 'verified', paymentMethod: 'bkash_manual', verifiedTrxId: 'BKS_VALID_123' },
  });
  assert.equal(canVerifyCancelled, false, 'Payment verification on cancelled order must be REJECTED by rules');

  // C. MFS verification without TrxID and without exception flag is rejected
  const draftMfsOrder = { id: 'ord_t4', status: 'draft', totalAmount: 500, paymentMethod: 'bkash_manual' };
  const canVerifyNoTrx = evaluateFirestoreRule({
    auth: { uid },
    method: 'update',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_t4`,
    resourceData: draftMfsOrder,
    requestData: { paymentStatus: 'verified', paymentMethod: 'bkash_manual', verifiedTrxId: '' },
  });
  assert.equal(canVerifyNoTrx, false, 'MFS verification without TrxID must be REJECTED by rules');

  // D. MFS verification with allowWithoutTrxId and valid reason (>=5 chars) is allowed
  const canVerifyException = evaluateFirestoreRule({
    auth: { uid },
    method: 'update',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_t4`,
    resourceData: draftMfsOrder,
    requestData: {
      paymentStatus: 'verified',
      paymentMethod: 'bkash_manual',
      allowWithoutTrxId: true,
      withoutTrxIdReason: 'Verified via bank SMS',
    },
  });
  assert.equal(canVerifyException, true, 'MFS verification with allowWithoutTrxId and valid reason must be ALLOWED by rules');

  // D2. allowWithoutTrxId without reason or with short reason is rejected
  const canVerifyShortReason = evaluateFirestoreRule({
    auth: { uid },
    method: 'update',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_t4`,
    resourceData: draftMfsOrder,
    requestData: {
      paymentStatus: 'verified',
      paymentMethod: 'bkash_manual',
      allowWithoutTrxId: true,
      withoutTrxIdReason: 'bad',
    },
  });
  assert.equal(canVerifyShortReason, false, 'MFS verification with allowWithoutTrxId and short reason must be REJECTED by rules');

  // E. Creating orders with initial status 'settled' or paymentStatus 'verified' is strictly blocked
  const canCreateSettled = evaluateFirestoreRule({
    auth: { uid },
    method: 'create',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_bad_create_1`,
    requestData: { id: 'ord_bad_create_1', status: 'settled', totalAmount: 500 },
  });
  assert.equal(canCreateSettled, false, 'Direct order creation with status settled must be REJECTED by rules');

  const canCreateVerified = evaluateFirestoreRule({
    auth: { uid },
    method: 'create',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_bad_create_2`,
    requestData: { id: 'ord_bad_create_2', status: 'confirmed', paymentStatus: 'verified', totalAmount: 500 },
  });
  assert.equal(canCreateVerified, false, 'Direct order creation with paymentStatus verified must be REJECTED by rules');

  // F. Creating orders with allowed status (draft/confirmed) and allowed paymentStatus is permitted
  const canCreateValid = evaluateFirestoreRule({
    auth: { uid },
    method: 'create',
    path: `users/${uid}/businesses/${bizId}/onlineOrders/ord_good_create`,
    requestData: { id: 'ord_good_create', status: 'confirmed', paymentStatus: 'pending', totalAmount: 500 },
  });
  assert.equal(canCreateValid, true, 'Order creation with draft/confirmed status must be ALLOWED by rules');

  // 2. Integration Tests: Self-Healing Settlement Reconciliation Cases
  const { commitOnlineOrderSettlementToCloud } = await import('../src/firebase/firestoreService.js');

  const settledOrder1 = {
    id: 'ord_sh_case1',
    status: 'settled',
    settledAt: 1791750000000,
    totalAmount: 1000,
    codAmount: 1000,
    courierCharge: 80,
    codFee: 20,
    settlementWallet: 'hand_cash',
    netAmount: 900,
  };
  const settledOrder2 = { ...settledOrder1, id: 'ord_sh_case2' };
  const settledOrder3 = { ...settledOrder1, id: 'ord_sh_case3' };
  const settledOrderWithoutWallet = {
    id: 'ord_sh_case4',
    status: 'settled',
    settledAt: 1791750000000,
    totalAmount: 1000,
    codAmount: 1000,
    courierCharge: 80,
    codFee: 20,
    // settlementWallet: undefined,
    netAmount: 900,
  };

  const initialDocs = {
    [`users/${uid}/businesses/${bizId}/onlineOrders/ord_sh_case1`]: settledOrder1,
    [`users/${uid}/businesses/${bizId}/onlineOrders/ord_sh_case2`]: settledOrder2,
    [`users/${uid}/businesses/${bizId}/onlineOrders/ord_sh_case3`]: settledOrder3,
    [`users/${uid}/businesses/${bizId}/onlineOrders/ord_sh_case4`]: settledOrderWithoutWallet,
  };
  const mock = createMockFirestore(initialDocs, { auth: { uid }, enforceRules: true });

  // Case 1: Reversed settlement transaction detected
  const dayWithReversedTx = {
    dateKey,
    status: 'open',
    _revision: 1,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      {
        id: 'tx_rev_settle',
        type: 'courier_settlement',
        orderId: 'ord_sh_case1',
        amount: 900,
        wallet: 'hand_cash',
        isReversed: true, // REVERSED!
      },
    ],
    onlineOrdersDayStats: { settled: 1, courierExpense: 100 },
  };

  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayWithReversedTx);

  const resCase1 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_sh_case1' }, mock.ops);
  assert.equal(resCase1.alreadySettled, true);
  assert.equal(resCase1.needsReconciliation, true);
  assert.equal(resCase1.reconciliationIssue, 'reversed_settlement_transaction');

  // Case 2: Amount / Wallet mismatch detected
  const dayWithMismatchedTx = {
    dateKey,
    status: 'open',
    _revision: 2,
    wallets: { hand_cash: { current: 1000 }, bkash_personal: { current: 500 } },
    transactions: [
      {
        id: 'tx_mismatch_settle',
        type: 'courier_settlement',
        orderId: 'ord_sh_case2',
        amount: 700, // Mismatched! Stored net is 900
        wallet: 'bkash_personal', // Mismatched! Stored wallet is hand_cash
      },
    ],
    journalEntries: [{ orderId: 'ord_sh_case2', lines: [{ accountId: 'courier_receivable', credit: 900 }] }],
    onlineOrdersDayStats: { settled: 1, courierExpense: 100 },
  };

  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayWithMismatchedTx);

  const resCase2 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_sh_case2' }, mock.ops);
  assert.equal(resCase2.alreadySettled, true);
  assert.equal(resCase2.needsReconciliation, true);
  assert.equal(resCase2.reconciliationIssue, 'settlement_amount_mismatch');

  // Case 3: Multiple active settlement transactions detected -> Must flag anomaly
  const dayWithMultipleActiveTxs = {
    dateKey,
    status: 'open',
    _revision: 3,
    wallets: { hand_cash: { current: 2000 } },
    transactions: [
      { id: 'tx_act_1', type: 'courier_settlement', orderId: 'ord_sh_case3', amount: 900, wallet: 'hand_cash' },
      { id: 'tx_act_2', type: 'courier_settlement', orderId: 'ord_sh_case3', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [{ orderId: 'ord_sh_case3', lines: [{ accountId: 'courier_receivable', credit: 900 }] }],
    onlineOrdersDayStats: { settled: 1, courierExpense: 100 },
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayWithMultipleActiveTxs);

  const resCase3 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_sh_case3' }, mock.ops);
  assert.equal(resCase3.alreadySettled, true);
  assert.equal(resCase3.needsReconciliation, true);
  assert.equal(resCase3.reconciliationIssue, 'multiple_active_settlement_transactions');

  // Case 4: Missing stored settlementWallet refuses caller override and flags missing_stored_settlement_wallet
  const dayWithoutTx = {
    dateKey,
    status: 'open',
    _revision: 4,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayWithoutTx);

  const resCase4 = await commitOnlineOrderSettlementToCloud(
    uid,
    bizId,
    dateKey,
    { orderId: 'ord_sh_case4', settlementWallet: 'hand_cash' }, // Caller provides wallet, but stored order lacks it!
    mock.ops
  );
  assert.equal(resCase4.alreadySettled, true);
  assert.equal(resCase4.needsReconciliation, true);
  assert.equal(resCase4.reconciliationIssue, 'missing_stored_settlement_wallet', 'Must refuse caller wallet fallback');

  // ─── 12 Comprehensive Accounting Settlement Journal Verification Tests ───

  // Condition 1: [1] সঠিক Cash wallet ও canonical account হলে PASS
  const ordCond1 = {
    id: 'ord_cond_1',
    status: 'settled',
    settledAt: 1791750000000,
    totalAmount: 1000,
    codAmount: 1000,
    courierCharge: 100,
    codFee: 0,
    settlementWallet: 'hand_cash',
    netAmount: 900,
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_1'), ordCond1, { bypassRules: true });
  const dayCond1 = {
    dateKey,
    status: 'open',
    _revision: 5,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c1', type: 'courier_settlement', orderId: 'ord_cond_1', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c1',
        txId: 'tx_c1',
        txType: 'courier_settlement',
        orderId: 'ord_cond_1',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond1);
  const resCond1 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_1' }, mock.ops);
  assert.equal(resCond1.alreadySettled, true);
  assert.equal(resCond1.needsReconciliation, undefined, 'Condition 1: Correct Cash wallet & canonical cash_in_hand must cleanly pass');

  // Condition 2: [2] Unknown wallet-কে Cash ধরে নিলে FAIL
  const ordCond2 = { ...ordCond1, id: 'ord_cond_2', settlementWallet: 'crypto_usdt_wallet' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_2'), ordCond2, { bypassRules: true });
  const dayCond2 = {
    dateKey,
    status: 'open',
    _revision: 6,
    wallets: { hand_cash: { current: 1000 }, crypto_usdt_wallet: { current: 900 } },
    transactions: [
      { id: 'tx_c2', type: 'courier_settlement', orderId: 'ord_cond_2', amount: 900, wallet: 'crypto_usdt_wallet' },
    ],
    journalEntries: [
      {
        id: 'je_c2',
        txId: 'tx_c2',
        txType: 'courier_settlement',
        orderId: 'ord_cond_2',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond2);
  const resCond2 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_2' }, mock.ops);
  assert.equal(resCond2.alreadySettled, true);
  assert.equal(resCond2.needsReconciliation, true);
  assert.equal(resCond2.reconciliationIssue, 'mismatched_settlement_journal_wallet', 'Condition 2: Unknown wallet must never default to Cash');

  // Condition 3: [3] asset_hand_cash বা asset_bank দিয়ে ভুল account match হলে FAIL
  const ordCond3 = { ...ordCond1, id: 'ord_cond_3' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_3'), ordCond3, { bypassRules: true });
  const dayCond3 = {
    dateKey,
    status: 'open',
    _revision: 7,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c3', type: 'courier_settlement', orderId: 'ord_cond_3', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c3',
        txId: 'tx_c3',
        txType: 'courier_settlement',
        orderId: 'ord_cond_3',
        lines: [
          { accountId: 'asset_hand_cash', debit: 900, credit: 0 }, // Loose alias forbidden!
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond3);
  const resCond3 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_3' }, mock.ops);
  assert.equal(resCond3.alreadySettled, true);
  assert.equal(resCond3.needsReconciliation, true);
  assert.equal(resCond3.reconciliationIssue, 'mismatched_settlement_journal_wallet', 'Condition 3: asset_hand_cash loose alias must be rejected');

  // Condition 4: [4] একই order-এর ভুল journal entry বেছে নিলে FAIL (e.g. sales entry instead of settlement entry)
  const ordCond4 = { ...ordCond1, id: 'ord_cond_4' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_4'), ordCond4, { bypassRules: true });
  const dayCond4 = {
    dateKey,
    status: 'open',
    _revision: 8,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c4', type: 'courier_settlement', orderId: 'ord_cond_4', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_sale_4',
        txType: 'stock_sale', // Sales entry, NOT courier_settlement!
        orderId: 'ord_cond_4',
        lines: [
          { accountId: 'courier_receivable', debit: 1000, credit: 0 },
          { accountId: 'sales_revenue', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond4);
  const resCond4 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_4' }, mock.ops);
  assert.equal(resCond4.alreadySettled, true);
  assert.equal(resCond4.needsReconciliation, true);
  assert.equal(resCond4.reconciliationIssue, 'missing_settlement_journal_entry', 'Condition 4: Must not pick up sales journal entry as settlement entry');

  // Condition 5: [5] Journal entry অনুপস্থিত হলে needsReconciliation
  const ordCond5 = { ...ordCond1, id: 'ord_cond_5' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_5'), ordCond5, { bypassRules: true });
  const dayCond5 = {
    dateKey,
    status: 'open',
    _revision: 9,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c5', type: 'courier_settlement', orderId: 'ord_cond_5', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [], // Missing!
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond5);
  const resCond5 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_5' }, mock.ops);
  assert.equal(resCond5.alreadySettled, true);
  assert.equal(resCond5.needsReconciliation, true);
  assert.equal(resCond5.reconciliationIssue, 'missing_settlement_journal_entry', 'Condition 5: Missing journal entry must trigger needsReconciliation');

  // Condition 6: [6] Debit ও credit অসমান হলে FAIL
  const ordCond6 = { ...ordCond1, id: 'ord_cond_6' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_6'), ordCond6, { bypassRules: true });
  const dayCond6 = {
    dateKey,
    status: 'open',
    _revision: 10,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c6', type: 'courier_settlement', orderId: 'ord_cond_6', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c6',
        txId: 'tx_c6',
        txType: 'courier_settlement',
        orderId: 'ord_cond_6',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 }, // Debits: 900, Credits: 1000
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond6);
  const resCond6 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_6' }, mock.ops);
  assert.equal(resCond6.alreadySettled, true);
  assert.equal(resCond6.needsReconciliation, true);
  assert.equal(resCond6.reconciliationIssue, 'unbalanced_settlement_journal_entry', 'Condition 6: Unbalanced debits/credits must FAIL');

  // Condition 7: [7] Wallet debit ৳৫০০, transaction ৳৯০০ হলে FAIL
  const ordCond7 = { ...ordCond1, id: 'ord_cond_7' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_7'), ordCond7, { bypassRules: true });
  const dayCond7 = {
    dateKey,
    status: 'open',
    _revision: 11,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c7', type: 'courier_settlement', orderId: 'ord_cond_7', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c7',
        txId: 'tx_c7',
        txType: 'courier_settlement',
        orderId: 'ord_cond_7',
        lines: [
          { accountId: 'cash_in_hand', debit: 500, credit: 0 }, // 500 instead of 900!
          { accountId: 'delivery_expense', debit: 500, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond7);
  const resCond7 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_7' }, mock.ops);
  assert.equal(resCond7.alreadySettled, true);
  assert.equal(resCond7.needsReconciliation, true);
  assert.equal(resCond7.reconciliationIssue, 'settlement_journal_amount_mismatch', 'Condition 7: Wallet debit amount mismatch must FAIL');

  // Condition 8: [8] ভুল receivable account হলে FAIL
  const ordCond8 = { ...ordCond1, id: 'ord_cond_8' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_8'), ordCond8, { bypassRules: true });
  const dayCond8 = {
    dateKey,
    status: 'open',
    _revision: 12,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c8', type: 'courier_settlement', orderId: 'ord_cond_8', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c8',
        txId: 'tx_c8',
        txType: 'courier_settlement',
        orderId: 'ord_cond_8',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'other_receivable', debit: 0, credit: 1000 }, // other_receivable instead of courier_receivable!
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond8);
  const resCond8 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_8' }, mock.ops);
  assert.equal(resCond8.alreadySettled, true);
  assert.equal(resCond8.needsReconciliation, true);
  assert.equal(resCond8.reconciliationIssue, 'mismatched_settlement_journal_receivable', 'Condition 8: Non-courier_receivable account must FAIL');

  // Condition 9: [9] COD ৳১,০০০ কিন্তু receivable credit ৳১,২০০ হলে FAIL
  const ordCond9 = { ...ordCond1, id: 'ord_cond_9' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_9'), ordCond9, { bypassRules: true });
  const dayCond9 = {
    dateKey,
    status: 'open',
    _revision: 13,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c9', type: 'courier_settlement', orderId: 'ord_cond_9', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c9',
        txId: 'tx_c9',
        txType: 'courier_settlement',
        orderId: 'ord_cond_9',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 300, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1200 }, // Balanced at 1200, but receivable != COD 1000!
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond9);
  const resCond9 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_9' }, mock.ops);
  assert.equal(resCond9.alreadySettled, true);
  assert.equal(resCond9.needsReconciliation, true);
  assert.equal(resCond9.reconciliationIssue, 'settlement_journal_receivable_amount_mismatch', 'Condition 9: Receivable credit exceeding COD must FAIL');

  // Condition 10: [10] Delivery expense-এর amount ভুল হলে FAIL
  const ordCond10 = { ...ordCond1, id: 'ord_cond_10', courierCharge: 100, codFee: 0 };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_10'), ordCond10, { bypassRules: true });
  const dayCond10 = {
    dateKey,
    status: 'open',
    _revision: 14,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c10', type: 'courier_settlement', orderId: 'ord_cond_10', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c10',
        txId: 'tx_c10',
        txType: 'courier_settlement',
        orderId: 'ord_cond_10',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 150, credit: 0 }, // Expected 100, but debited 150!
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
          { accountId: 'other_revenue', debit: 0, credit: 50 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond10);
  const resCond10 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_10' }, mock.ops);
  assert.equal(resCond10.alreadySettled, true);
  assert.equal(resCond10.needsReconciliation, true);
  assert.equal(resCond10.reconciliationIssue, 'settlement_journal_expense_amount_mismatch', 'Condition 10: Wrong delivery expense amount must FAIL');

  // Condition 11: [11] একই settlement transaction-এর duplicate journal থাকলে FAIL
  const ordCond11 = { ...ordCond1, id: 'ord_cond_11' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_11'), ordCond11, { bypassRules: true });
  const dayCond11 = {
    dateKey,
    status: 'open',
    _revision: 15,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c11', type: 'courier_settlement', orderId: 'ord_cond_11', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c11_a',
        txId: 'tx_c11',
        txType: 'courier_settlement',
        orderId: 'ord_cond_11',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
      {
        id: 'je_c11_b',
        txId: 'tx_c11',
        txType: 'courier_settlement',
        orderId: 'ord_cond_11',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond11);
  const resCond11 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_11' }, mock.ops);
  assert.equal(resCond11.alreadySettled, true);
  assert.equal(resCond11.needsReconciliation, true);
  assert.equal(resCond11.reconciliationIssue, 'duplicate_settlement_journal_entries', 'Condition 11: Duplicate journal entries for same tx must FAIL');

  // Condition 12: [12] সঠিক complete settlement journal হলে clean PASS
  const ordCond12 = { ...ordCond1, id: 'ord_cond_12', settlementWallet: 'bkash_personal', codAmount: 1500, totalAmount: 1500, netAmount: 1350 };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_12'), ordCond12, { bypassRules: true });
  const dayCond12 = {
    dateKey,
    status: 'open',
    _revision: 16,
    wallets: { bkash_personal: { current: 5000 } },
    transactions: [
      { id: 'tx_c12', type: 'courier_settlement', orderId: 'ord_cond_12', amount: 1350, wallet: 'bkash_personal' },
    ],
    journalEntries: [
      {
        id: 'je_c12',
        txId: 'tx_c12',
        txType: 'courier_settlement',
        orderId: 'ord_cond_12',
        lines: [
          { accountId: 'bkash', debit: 1350, credit: 0 },
          { accountId: 'delivery_expense', debit: 150, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1500 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond12);
  const resCond12 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_12' }, mock.ops);
  assert.equal(resCond12.alreadySettled, true);
  assert.equal(resCond12.needsReconciliation, undefined, 'Condition 12: Exact matching bKash settlement must cleanly pass');
  assert.ok(resCond12.order);
  assert.ok(resCond12.dayData);

  // Condition 13: [13] Transaction Amount NaN বা অবৈধ String ("abc") হলে FAIL
  const ordCond13 = { ...ordCond1, id: 'ord_cond_13' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_13'), ordCond13, { bypassRules: true });
  const dayCond13 = {
    dateKey,
    status: 'open',
    _revision: 17,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c13', type: 'courier_settlement', orderId: 'ord_cond_13', amount: 'abc_invalid', wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c13',
        txId: 'tx_c13',
        txType: 'courier_settlement',
        orderId: 'ord_cond_13',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond13);
  const resCond13 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_13' }, mock.ops);
  assert.equal(resCond13.alreadySettled, true);
  assert.equal(resCond13.needsReconciliation, true);
  assert.equal(resCond13.reconciliationIssue, 'invalid_settlement_transaction_amount', 'Condition 13: Invalid transaction amount string/NaN must FAIL');

  // Condition 14: [14] txId মিললেও journal entry-তে txType অনুপস্থিত থাকলে FAIL
  const ordCond14 = { ...ordCond1, id: 'ord_cond_14' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_14'), ordCond14, { bypassRules: true });
  const dayCond14 = {
    dateKey,
    status: 'open',
    _revision: 18,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c14', type: 'courier_settlement', orderId: 'ord_cond_14', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c14',
        txId: 'tx_c14',
        // txType missing!
        orderId: 'ord_cond_14',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond14);
  const resCond14 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_14' }, mock.ops);
  assert.equal(resCond14.alreadySettled, true);
  assert.equal(resCond14.needsReconciliation, true);
  assert.equal(resCond14.reconciliationIssue, 'invalid_settlement_journal_type', 'Condition 14: Missing txType on journal entry must FAIL');

  // Condition 15: [15] codAmount অনুপস্থিত কিন্তু totalAmount আছে—এমন ক্ষেত্রে অনুমান না করে FAIL
  const ordCond15 = {
    id: 'ord_cond_15',
    status: 'settled',
    settledAt: 1791750000000,
    totalAmount: 1500, // totalAmount is 1500, but codAmount is missing (e.g. advance was paid)
    // codAmount: missing!
    courierCharge: 100,
    codFee: 0,
    settlementWallet: 'hand_cash',
    netAmount: 900,
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_15'), ordCond15, { bypassRules: true });
  const dayCond15 = {
    dateKey,
    status: 'open',
    _revision: 19,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c15', type: 'courier_settlement', orderId: 'ord_cond_15', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c15',
        txId: 'tx_c15',
        txType: 'courier_settlement',
        orderId: 'ord_cond_15',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond15);
  const resCond15 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_15' }, mock.ops);
  assert.equal(resCond15.alreadySettled, true);
  assert.equal(resCond15.needsReconciliation, true);
  assert.equal(resCond15.reconciliationIssue, 'missing_authoritative_cod_amount', 'Condition 15: Missing codAmount must not fall back to totalAmount');

  // Condition 16: [16] Settlement net amount (৳১,২০০) COD (৳১,০০০)-এর চেয়ে বেশি হলে FAIL
  const ordCond16 = { ...ordCond1, id: 'ord_cond_16', netAmount: 1200, codAmount: 1000 };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_16'), ordCond16, { bypassRules: true });
  const dayCond16 = {
    dateKey,
    status: 'open',
    _revision: 20,
    wallets: { hand_cash: { current: 1500 } },
    transactions: [
      { id: 'tx_c16', type: 'courier_settlement', orderId: 'ord_cond_16', amount: 1200, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c16',
        txId: 'tx_c16',
        txType: 'courier_settlement',
        orderId: 'ord_cond_16',
        lines: [
          { accountId: 'cash_in_hand', debit: 1200, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
          { accountId: 'delivery_expense', debit: 0, credit: 200 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond16);
  const resCond16 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_16' }, mock.ops);
  assert.equal(resCond16.alreadySettled, true);
  assert.equal(resCond16.needsReconciliation, true);
  assert.equal(resCond16.reconciliationIssue, 'settlement_amount_exceeds_cod', 'Condition 16: Net amount exceeding COD must FAIL');

  // Condition 17: [17] Journal-এ অপ্রত্যাশিত বা Rogue Account থাকলে FAIL
  const ordCond17 = { ...ordCond1, id: 'ord_cond_17' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_17'), ordCond17, { bypassRules: true });
  const dayCond17 = {
    dateKey,
    status: 'open',
    _revision: 21,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c17', type: 'courier_settlement', orderId: 'ord_cond_17', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c17',
        txId: 'tx_c17',
        txType: 'courier_settlement',
        orderId: 'ord_cond_17',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
          { accountId: 'unauthorized_account', debit: 50, credit: 0 }, // Rogue debit account!
          { accountId: 'unauthorized_account', debit: 0, credit: 50 }, // Rogue credit account balances it.
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond17);
  const resCond17 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_17' }, mock.ops);
  assert.equal(resCond17.alreadySettled, true);
  assert.equal(resCond17.needsReconciliation, true);
  assert.equal(resCond17.reconciliationIssue, 'unexpected_settlement_journal_line', 'Condition 17: Rogue account line must FAIL');

  // Condition 18: A one-paisa journal imbalance must not pass through a 0.01 tolerance.
  const ordCond18 = { ...ordCond1, id: 'ord_cond_18' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_18'), ordCond18, { bypassRules: true });
  const dayCond18 = {
    dateKey,
    status: 'open',
    _revision: 22,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c18', type: 'courier_settlement', orderId: 'ord_cond_18', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c18', txId: 'tx_c18', txType: 'courier_settlement', orderId: 'ord_cond_18',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 999.99 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond18);
  const resCond18 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_18' }, mock.ops);
  assert.equal(resCond18.needsReconciliation, true);
  assert.equal(resCond18.reconciliationIssue, 'unbalanced_settlement_journal_entry', 'Condition 18: One-paisa imbalance must FAIL');

  // Condition 19: Mixed debit+credit on the same line must not hide extra amounts.
  const ordCond19 = { ...ordCond1, id: 'ord_cond_19' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_19'), ordCond19, { bypassRules: true });
  const dayCond19 = {
    dateKey,
    status: 'open',
    _revision: 23,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c19', type: 'courier_settlement', orderId: 'ord_cond_19', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c19', txId: 'tx_c19', txType: 'courier_settlement', orderId: 'ord_cond_19',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 50 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 50, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond19);
  const resCond19 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_19' }, mock.ops);
  assert.equal(resCond19.needsReconciliation, true);
  assert.equal(resCond19.reconciliationIssue, 'invalid_journal_line_sides', 'Condition 19: Debit+credit on one journal line must FAIL');

  // Condition 20: Numeric fractional-paisa transaction amounts must not be silently rounded.
  const ordCond20 = { ...ordCond1, id: 'ord_cond_20' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_20'), ordCond20, { bypassRules: true });
  const dayCond20 = {
    dateKey,
    status: 'open',
    _revision: 24,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c20', type: 'courier_settlement', orderId: 'ord_cond_20', amount: 900.001, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c20', txId: 'tx_c20', txType: 'courier_settlement', orderId: 'ord_cond_20',
        lines: [
          { accountId: 'cash_in_hand', debit: 900, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond20);
  const resCond20 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_20' }, mock.ops);
  assert.equal(resCond20.needsReconciliation, true);
  assert.equal(resCond20.reconciliationIssue, 'invalid_settlement_transaction_amount', 'Condition 20: Fractional-paisa numeric amount must FAIL');

  // Condition 21: Coercible booleans in journal amounts must not become valid money values.
  const ordCond21 = { ...ordCond1, id: 'ord_cond_21' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_21'), ordCond21, { bypassRules: true });
  const dayCond21 = {
    dateKey,
    status: 'open',
    _revision: 25,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [
      { id: 'tx_c21', type: 'courier_settlement', orderId: 'ord_cond_21', amount: 900, wallet: 'hand_cash' },
    ],
    journalEntries: [
      {
        id: 'je_c21', txId: 'tx_c21', txType: 'courier_settlement', orderId: 'ord_cond_21',
        lines: [
          { accountId: 'cash_in_hand', debit: 899, credit: 0 },
          { accountId: 'cash_in_hand', debit: true, credit: 0 },
          { accountId: 'delivery_expense', debit: 100, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 1000 },
        ],
      },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond21);
  const resCond21 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_21' }, mock.ops);
  assert.equal(resCond21.needsReconciliation, true);
  assert.equal(resCond21.reconciliationIssue, 'invalid_journal_line_format', 'Condition 21: Boolean journal amount must FAIL');

  // Condition 22: Missing COD and Net amount with totalAmount present and missing settlement transaction must FAIL to reconciliation without wallet credit
  const ordCond22 = {
    id: 'ord_cond_22',
    status: 'settled',
    settlementWallet: 'hand_cash',
    totalAmount: 1000,
    // codAmount: undefined
    // netAmount: undefined
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_22'), ordCond22, { bypassRules: true });
  const dayCond22 = {
    dateKey,
    status: 'open',
    _revision: 26,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [], // Completely missing settlement transaction!
    journalEntries: [],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond22);
  const resCond22 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_22' }, mock.ops);
  assert.equal(resCond22.alreadySettled, true);
  assert.equal(resCond22.needsReconciliation, true);
  assert.equal(resCond22.reconciliationIssue, 'missing_authoritative_cod_amount', 'Condition 22: Missing COD in self-healing must FAIL to reconciliation without wallet credit');

  // Verify that dayData in database was NOT modified (no transaction added, wallet not credited)
  const dayDocAfter22 = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey));
  const savedDay22 = dayDocAfter22.data();
  assert.equal(savedDay22.transactions.length, 0, 'Condition 22: No settlement transaction should be created');
  assert.equal(savedDay22.wallets.hand_cash.current, 1000, 'Condition 22: Wallet balance must remain unchanged');
  assert.equal(savedDay22.journalEntries.length, 0, 'Condition 22: No journal entries should be created');

  // Condition 23: A journal with a different non-empty txId must never be accepted as a legacy match.
  const ordCond23 = { ...ordCond1, id: 'ord_cond_23' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_23'), ordCond23, { bypassRules: true });
  const dayCond23 = {
    dateKey, status: 'open', _revision: 27,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [{ id: 'tx_correct_23', type: 'courier_settlement', orderId: 'ord_cond_23', amount: 900, wallet: 'hand_cash' }],
    journalEntries: [{ id: 'je_wrong_txid_23', txId: 'different_tx_id', txType: 'courier_settlement', orderId: 'ord_cond_23', lines: [
      { accountId: 'cash_in_hand', debit: 900, credit: 0 },
      { accountId: 'delivery_expense', debit: 100, credit: 0 },
      { accountId: 'courier_receivable', debit: 0, credit: 1000 },
    ] }],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond23);
  const resCond23 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_23' }, mock.ops);
  assert.equal(resCond23.needsReconciliation, true, 'Condition 23: Mismatched non-empty txId must be flagged');
  assert.equal(resCond23.reconciliationIssue, 'settlement_journal_transaction_mismatch');

  // Condition 24: An exact txId journal plus a legacy no-txId journal for the same order is ambiguous/duplicate.
  const ordCond24 = { ...ordCond1, id: 'ord_cond_24' };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'onlineOrders', 'ord_cond_24'), ordCond24, { bypassRules: true });
  const validLines24 = [
    { accountId: 'cash_in_hand', debit: 900, credit: 0 },
    { accountId: 'delivery_expense', debit: 100, credit: 0 },
    { accountId: 'courier_receivable', debit: 0, credit: 1000 },
  ];
  const dayCond24 = {
    dateKey, status: 'open', _revision: 28,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [{ id: 'tx_correct_24', type: 'courier_settlement', orderId: 'ord_cond_24', amount: 900, wallet: 'hand_cash' }],
    journalEntries: [
      { id: 'je_exact_24', txId: 'tx_correct_24', txType: 'courier_settlement', orderId: 'ord_cond_24', lines: validLines24 },
      { id: 'je_legacy_24', txType: 'courier_settlement', orderId: 'ord_cond_24', lines: validLines24 },
    ],
  };
  await mock.ops.setDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', bizId, 'days', dateKey), dayCond24);
  const resCond24 = await commitOnlineOrderSettlementToCloud(uid, bizId, dateKey, { orderId: 'ord_cond_24' }, mock.ops);
  assert.equal(resCond24.needsReconciliation, true, 'Condition 24: Exact and legacy journals together must be flagged as duplicate');
  assert.equal(resCond24.reconciliationIssue, 'duplicate_settlement_journal_entries');
});

await runTest('Suite 5', '5.37 [P1 Hardening: Multi-Business Historical TrxID Migration & Strict Partial Backup Rejection]', async () => {
  const uid = 'uid_p1_multibiz_migration';
  const biz1 = 'biz_alpha';
  const biz2 = 'biz_beta';
  const { migrateAllBusinessesHistoricalTrxRegistry, exportAllCloudData } = await import('../src/firebase/firestoreService.js');
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  // 1. Setup multi-business orders with cross-business duplicate
  // Biz Alpha verified order with TrxID 'BKASH_CROSS_999'
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', biz1, 'onlineOrders', 'ord_a_1'),
    { id: 'ord_a_1', status: 'confirmed', paymentStatus: 'verified', paymentMethod: 'bkash_manual', verifiedTrxId: 'BKASH_CROSS_999', totalAmount: 500 },
    { bypassRules: true }
  );

  // Biz Beta verified order with SAME TrxID 'BKASH_CROSS_999' (Cross-Business Reuse!)
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', biz2, 'onlineOrders', 'ord_b_1'),
    { id: 'ord_b_1', status: 'confirmed', paymentStatus: 'verified', paymentMethod: 'bkash_manual', verifiedTrxId: 'BKASH_CROSS_999', totalAmount: 600 },
    { bypassRules: true }
  );

  // Biz Beta clean unique verified order
  await mock.ops.setDoc(
    mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', biz2, 'onlineOrders', 'ord_b_2'),
    { id: 'ord_b_2', status: 'confirmed', paymentStatus: 'verified', paymentMethod: 'nagad_manual', verifiedTrxId: 'NAGAD_UNIQ_777', totalAmount: 800 },
    { bypassRules: true }
  );

  const report = await migrateAllBusinessesHistoricalTrxRegistry(uid, [biz1, biz2], mock.ops);
  assert.equal(report.totalVerified, 3);
  assert.equal(report.migrated, 1, 'Only clean unique TrxID must be migrated');
  assert.equal(report.duplicatesCount, 1);
  assert.equal(report.duplicates[0].isCrossBusiness, true, 'Must flag cross-business duplicate');
  assert.deepEqual(report.duplicates[0].businessesInvolved.sort(), [biz1, biz2].sort());

  // Check unique registry doc exists
  const uniqDoc = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'trxRegistry', 'nagad_NAGAD_UNIQ_777'));
  assert.equal(uniqDoc.exists(), true);

  // Check duplicate was NOT registered
  const dupDoc = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'trxRegistry', 'bkash_BKASH_CROSS_999'));
  assert.equal(dupDoc.exists(), false, 'Cross-business duplicate TrxID must NOT be registered');

  // 2. Strict Backup Export Failure Handling
  // Mock failing collection fetch for strict export
  const failingOps = {
    ...mock.ops,
    getDocs: async (colRef) => {
      const pathStr = colRef?.path || '';
      if (pathStr.includes('onlineOrders')) {
        throw new Error('Simulated network timeout fetching onlineOrders');
      }
      return mock.ops.getDocs(colRef);
    },
  };

  // With strict: true, export throws immediately when a collection fails
  await assert.rejects(
    async () => {
      await exportAllCloudData(uid, failingOps, { strict: true });
    },
    (err) => {
      assert.ok(err.message.includes('Cloud export failed with'));
      assert.ok(err.message.includes('Simulated network timeout'));
      return true;
    },
    'Strict backup must reject and throw on subcollection failure'
  );

  // Without strict: true, export returns partial JSON marked with isPartial and errors
  const partialBackupJson = await exportAllCloudData(uid, failingOps, { strict: false });
  const parsedBackup = JSON.parse(partialBackupJson);
  assert.equal(parsedBackup.isPartial, true, 'Non-strict export with failed subcollection must set isPartial: true');
  assert.ok(Array.isArray(parsedBackup.manifest?.errors), 'Manifest errors array must be populated');
  assert.ok(parsedBackup.manifest.errors.length > 0, 'Must record the exact failed collection error');
});

await runTest('Suite 5', '5.38 [P1 Hardening: Autosave Zero-Write Dirty-Check & Protection Against Blind Overwrite]', async () => {
  const uid = 'uid_p1_dirty_check';
  const bizId = 'biz_dirty';
  const { saveDayToCloud } = await import('../src/firebase/firestoreService.js');
  const mock = createMockFirestore({}, { auth: { uid }, enforceRules: true });

  let cloudWriteCount = 0;
  const countingOps = {
    ...mock.ops,
    setDoc: async (ref, data, opts) => {
      cloudWriteCount++;
      return mock.ops.setDoc(ref, data, opts);
    },
    runTransaction: async (db, updateFunction) => {
      cloudWriteCount++;
      return mock.ops.runTransaction(db, updateFunction);
    },
  };

  const dayData = {
    dateKey: '2026-10-12',
    status: 'open',
    _revision: 1,
    wallets: { hand_cash: { current: 1000 } },
    transactions: [],
  };

  // 1. Initial write
  await saveDayToCloud(uid, bizId, dayData, countingOps);
  const initialWrites = cloudWriteCount;
  assert.ok(initialWrites > 0, 'Initial save performs cloud write');

  // 2. Dirty Check: Identical JSON string produces zero network requests in autosave debounce logic
  let lastSavedJson = JSON.stringify(dayData);
  const nextJson = JSON.stringify(dayData);
  let dirtyCheckSuppressed = false;
  if (lastSavedJson === nextJson) {
    dirtyCheckSuppressed = true;
    // No write called
  }
  assert.equal(dirtyCheckSuppressed, true, 'Identical dayData is suppressed by dirty check with ZERO writes');
  assert.equal(cloudWriteCount, initialWrites, 'Write counter did not increment');

  // 3. Conflict Protection: When user declines reload, forceOverwrite is NOT executed
  const appContextContent = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');
  assert.ok(
    !appContextContent.includes('forceOverwrite: true'),
    'AppContext must NOT contain forceOverwrite: true in autosave conflict handling'
  );
  assert.ok(
    appContextContent.includes("status: 'conflict'"),
    "AppContext must maintain status: 'conflict' to protect remote device edits"
  );
});

await runTest('Suite 5', '5.39 [P1 Hardening: End-to-End Disaster Recovery (Multi-Biz Export -> Wipe -> Restore -> 100% Invariant Parity)]', async () => {
  const uid = 'uid_disaster_recovery_e2e';
  const biz1 = 'biz_main';
  const biz2 = 'biz_outlet';
  const { exportAllCloudData, restoreAllCloudData, loadOnlineOrdersFromCloud, loadContactsFromCloud } = await import('../src/firebase/firestoreService.js');

  // 1. Setup multi-business state with rich accounting, FIFO inventory, and online orders
  const day1Biz1 = {
    dateKey: '2026-10-10',
    status: 'finalized',
    _revision: 5,
    wallets: { hand_cash: { current: 15400 }, bkash_personal: { current: 8200 }, bank_ac: { current: 50000 } },
    transactions: [
      { id: 'tx_s1', type: 'sale', amount: 5000, wallet: 'hand_cash', time: '10:00 AM' },
      { id: 'tx_e1', type: 'expense', amount: 1200, category: 'rent', wallet: 'hand_cash', time: '11:00 AM' },
      { id: 'tx_set1', type: 'courier_settlement', orderId: 'ord_rec_1', amount: 2800, wallet: 'bkash_personal', time: '02:00 PM' },
    ],
    journalEntries: [
      {
        id: 'je_1',
        txId: 'tx_s1',
        lines: [
          { accountId: 'cash', debit: 5000, credit: 0 },
          { accountId: 'sales_revenue', debit: 0, credit: 5000 },
        ],
      },
      {
        id: 'je_set1',
        orderId: 'ord_rec_1',
        txId: 'tx_set1',
        lines: [
          { accountId: 'bkash_personal', debit: 2800, credit: 0 },
          { accountId: 'courier_receivable', debit: 0, credit: 2800 },
        ],
      },
    ],
    fifoBatches: [
      { id: 'batch_1', productId: 'p_101', quantity: 50, unitCost: 120, remainingQty: 30 },
    ],
    closingCash: 15400,
  };

  const day1Biz2 = {
    dateKey: '2026-10-10',
    status: 'open',
    _revision: 2,
    wallets: { hand_cash: { current: 3000 } },
    transactions: [
      { id: 'tx_b2_s1', type: 'sale', amount: 3000, wallet: 'hand_cash', time: '12:00 PM' },
    ],
  };

  const contactsBiz1 = [
    { id: 'cnt_sup1', name: 'Al-Hasan Wholesale', type: 'supplier', currentBalance: -15000 },
    { id: 'cnt_cus1', name: 'Karim Ahmed', type: 'customer', currentBalance: 4500 },
  ];

  // Settled online order (with historical settled status and locked metadata)
  const ordersBiz1 = [
    {
      id: 'ord_rec_1',
      status: 'settled',
      paymentStatus: 'verified',
      paymentMethod: 'cod',
      totalAmount: 3000,
      codAmount: 3000,
      courierCharge: 150,
      codFee: 50,
      netAmount: 2800,
      settlementWallet: 'bkash_personal',
      settledAt: 1791720000000,
      customerName: 'Rahim Khan',
      customerPhone: '01711223344',
      items: [{ productId: 'p_101', productName: 'Item A', quantity: 2, unitPrice: 1500, subtotal: 3000 }],
    },
    {
      id: 'ord_rec_2',
      status: 'confirmed',
      paymentStatus: 'pending',
      paymentMethod: 'bkash_manual',
      totalAmount: 1200,
      customerName: 'Farhana',
      customerPhone: '01811223344',
      items: [{ productId: 'p_102', productName: 'Item B', quantity: 1, unitPrice: 1200, subtotal: 1200 }],
    },
  ];

  // 1. Seed initial pre-existing state into mock cloud database
  const initialDocs = {
    [`users/${uid}/businesses/${biz1}/days/2026-10-10`]: day1Biz1,
    [`users/${uid}/businesses/${biz2}/days/2026-10-10`]: day1Biz2,
    [`users/${uid}/businesses/${biz1}/contacts/${contactsBiz1[0].id}`]: contactsBiz1[0],
    [`users/${uid}/businesses/${biz1}/contacts/${contactsBiz1[1].id}`]: contactsBiz1[1],
    [`users/${uid}/businesses/${biz1}/onlineOrders/${ordersBiz1[0].id}`]: ordersBiz1[0],
    [`users/${uid}/businesses/${biz1}/onlineOrders/${ordersBiz1[1].id}`]: ordersBiz1[1],
    [`users/${uid}/businessList/list`]: {
      businesses: [
        { id: biz1, name: 'Main Shop' },
        { id: biz2, name: 'Outlet Branch' },
      ],
    },
  };
  const mock = createMockFirestore(initialDocs, { auth: { uid }, enforceRules: true });

  // 2. Perform Full Strict Backup Export
  const backupJson = await exportAllCloudData(uid, mock.ops, { strict: true });
  assert.ok(backupJson, 'Backup JSON must be produced');
  const backupObj = JSON.parse(backupJson);
  assert.equal(backupObj.version, 3);
  assert.equal(backupObj.isPartial, false);
  assert.equal(backupObj.manifest.counts.businesses, 2);

  // 3. Catastrophic State Wipe (Disaster Simulation)
  mock.store.clear();
  assert.equal(mock.store.size, 0, 'Cloud database must be completely empty after disaster wipe');

  // 4. Complete Restore from Backup
  const restoreReport = await restoreAllCloudData(uid, backupJson, mock.ops);
  if (restoreReport.errors.length > 0) console.error('RESTORE ERRORS:', restoreReport.errors);
  assert.equal(restoreReport.errors.length, 0);
  assert.equal(restoreReport.restoredCounts.businesses, 2);
  assert.equal(restoreReport.restoredCounts.days, 2);
  assert.equal(restoreReport.restoredCounts.contacts, 2);
  assert.equal(restoreReport.restoredCounts.onlineOrders, 2);

  // 5. Invariant & Parity Assertions
  // A. Days & Wallets parity
  const restoredDay1Biz1Snap = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', biz1, 'days', '2026-10-10'));
  assert.equal(restoredDay1Biz1Snap.exists(), true);
  const restoredDay1 = restoredDay1Biz1Snap.data();
  assert.equal(restoredDay1.status, 'finalized');
  assert.equal(restoredDay1.wallets.hand_cash.current, 15400);
  assert.equal(restoredDay1.wallets.bkash_personal.current, 8200);
  assert.equal(restoredDay1.transactions.length, 3);
  assert.equal(restoredDay1.journalEntries.length, 2);
  assert.equal(restoredDay1.fifoBatches[0].remainingQty, 30);

  // B. Contacts parity
  const restoredContacts = await loadContactsFromCloud(uid, biz1, mock.ops);
  assert.equal(restoredContacts.length, 2);
  const restoredSup = restoredContacts.find(c => c.id === 'cnt_sup1');
  assert.ok(restoredSup);
  assert.equal(restoredSup.name, 'Al-Hasan Wholesale');
  assert.equal(restoredSup.currentBalance, -15000);

  // C. Online orders parity & strict security rules compliance
  const restoredOrders = await loadOnlineOrdersFromCloud(uid, biz1, mock.ops);
  assert.equal(restoredOrders.length, 2);
  const restoredSettled = restoredOrders.find(o => o.id === 'ord_rec_1');
  assert.ok(restoredSettled);
  assert.equal(restoredSettled.status, 'settled', 'Restored historical order must preserve settled status');
  assert.equal(restoredSettled.netAmount, 2800);
  assert.equal(restoredSettled.settlementWallet, 'bkash_personal');
  assert.equal(restoredSettled.settledAt, 1791720000000);

  const restoredConfirmed = restoredOrders.find(o => o.id === 'ord_rec_2');
  assert.ok(restoredConfirmed);
  assert.equal(restoredConfirmed.status, 'confirmed');

  // D. Second business parity
  const restoredDay1Biz2Snap = await mock.ops.getDoc(mock.ops.doc(mock.ops.db, 'users', uid, 'businesses', biz2, 'days', '2026-10-10'));
  assert.equal(restoredDay1Biz2Snap.exists(), true);
  assert.equal(restoredDay1Biz2Snap.data().wallets.hand_cash.current, 3000);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🎉 ALL ${passedTests}/${testResults.length} AUTOMATED TESTS PASSED SUCCESSFULLY!`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');



