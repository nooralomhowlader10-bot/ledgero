import React, { createContext, useContext, useReducer, useEffect, useCallback, useState, useRef } from 'react';
import { 
  loadDay, 
  saveDay, 
  finalizeDay, 
  getTodayKey, 
  getNextDayKey, 
  getPrevDayKey,
  findMostRecentDay,
  loadContacts,
  saveContacts,
  loadContactTxs,
  saveContactTxs,
  deleteBusinessData,
  saveCatalog,
  loadCatalog,
  hasBusinessHistory,
  setActiveStorageUserId
} from '../data/storage';
import { DAY_STATUS, SCREENS, DEFAULT_INVENTORY, isTelecomBiz, ADVANCED_FEATURES } from '../data/constants';
import { aggregateTransactions, roundBDT } from '../data/calculations';
import { generateJournalEntry, generateCOGSEntry, generateReversalJournalEntry, reconcileJournalsForTransactions, mapWalletToAccount } from '../data/journalEngine';
import { consumeFIFOBatches, createBatch, restoreFIFOBatches } from '../data/fifoEngine';
import {
  quickSellStockInState,
  quickRestockInState,
  writeOffDamageInState,
  reverseSingleTransactionInState,
  applyStockAuditInState,
  bulkDeleteTransactionsInState,
  deleteBusinessInState,
  confirmOnlineOrderInState,
  verifyOnlineOrderPaymentInState,
  rejectOnlineOrderPaymentInState,
  packOnlineOrderInState,
  shipOnlineOrderInState,
  deliverOnlineOrderInState,
  settleOnlineOrderInState,
  cancelOnlineOrderInState,
  returnOnlineOrderInState,
  verifyAndRepriceOnlineOrderInState,
} from '../data/ledgerStateEngine';
import { createRevisionTracker } from '../data/syncRevisionTracker';
import { mergeIncomingOrdersIdempotently, verifyOrderAgainstCatalog } from '../data/orderIntegrityEngine';
import { applyModeTheme } from '../data/themeTokens';
import { normalizePhoneNumber } from '../data/customerRiskEngine';
import {
  saveDayToCloud,
  loadDayFromCloud,
  findMostRecentDayFromCloud,
  saveAllContactsToCloud,
  loadContactsFromCloud,
  saveContactToCloud,
  deleteContactFromCloud,
  saveContactTxsToCloud,
  loadContactTxsFromCloud,
  saveBusinesses as saveBusinessesToCloud,
  loadBusinesses as loadBusinessesFromCloud,
  saveSettings as saveSettingsToCloud,
  loadSettings as loadSettingsFromCloud,
  saveMetaToCloud,
  loadMetaFromCloud,
  deleteBusinessFromCloud,
  saveProfile,
  exportAllCloudData,
  saveAllOnlineOrdersToCloud,
  loadOnlineOrdersFromCloud,
  checkDayDataFreshness
} from '../firebase/firestoreService';
import { exportToGoogleSheets } from '../firebase/sheetsService';
import { logAuditEntry } from '../firebase/auditService';
import { useAuth } from '../firebase/useAuth';
import { 
  createDefaultWallets, 
  createGeneralWallets,
  detectWalletCategory,
  DEFAULT_EXPENSE_CATEGORIES
} from '../data/constants';

const AppContext = createContext();

const DEFAULT_BUSINESSES = [
  { id: 'biz_1', name: 'Noor Alom Studio & Telecom', type: 'Mobile Banking & Recharge Point' }
];

export const DEFAULT_TEA_HOUSE_PRODUCTS = [
  { id: 'th_1', name: 'চা', unit: 'কাপ', price: 15 },
  { id: 'th_2', name: 'বিস্কুট', unit: 'পিস', price: 10 },
  { id: 'th_3', name: 'কেক', unit: 'পিস', price: 15 },
  { id: 'th_4', name: 'রুটি', unit: 'পিস', price: 10 },
  { id: 'th_5', name: 'কলা', unit: 'পিস', price: 15 },
  { id: 'th_6', name: 'কোক', unit: 'বোতল', price: 35 },
  { id: 'th_7', name: 'সেভেনআপ', unit: 'বোতল', price: 30 },
  { id: 'th_8', name: 'দই', unit: 'কাপ', price: 20 },
];

export const DEFAULT_COURIER_SETTINGS = {
  bkashNumber: '',
  nagadNumber: '',
  rocketNumber: '',
  insideDhakaCharge: 100,   // Default delivery charge customer pays
  outsideDhakaCharge: 150,
};

// ── Initial State (minimal, will be populated after auth) ──────────────
const initialState = {
  businesses: [],
  activeBizId: 'biz_1',
  activeBiz: null,
  contacts: [],
  dayData: null,
  currentScreen: SCREENS.OPENING,
  isLoading: true,
  isPrivacyMode: false,
  isDarkMode: false,
  language: 'bn',
  autoCloseTime: '01:00',   // Auto finalize at 1:00 AM
  autoOpenTime: '08:00',    // Auto start next day at 8:00 AM
  autoCloseEnabled: false,  // Disabled by default until user enables
  editLockEnabled: false,   // PIN lock for editing opening balances
  editLockPinHash: null,    // SHA-256 hash of the 4-digit PIN
  userRole: 'owner',        // RBAC: 'owner' or 'staff'
  staffPinHash: null,       // Separate PIN hash for staff mode
  appMode: 'easy',          // 'easy' or 'advanced'
  featureFlags: { ...ADVANCED_FEATURES },
  taxRegion: 'BD',          // Default: Bangladesh
  invoices: [],             // Persistent invoice database
  lastInvoiceSeq: 0,        // Sequential invoice counter (e.g. INV-2026-0001)
  sheetsWebAppUrl: '',       // Google Apps Script Web App URL for Sheets export
  fixedAssets: [],          // IAS 16 Fixed Asset Register
  employees: [],            // Staff / Payroll list
  currency: 'BDT',          // Active currency code (BDT, USD, EUR, INR, SAR, AED, GBP)
  exchangeRates: {
    BDT: 1,
    USD: 0.0083,
    EUR: 0.0076,
    INR: 0.73,
    SAR: 0.031,
    AED: 0.031,
    GBP: 0.0065
  },
  reconciledTxIds: [],      // IDs of bank-reconciled transactions
  lockedPeriodEndDate: null, // Date on or before which all records are audit locked
  cloudReady: false, // true when Firestore data is loaded
  cloudInitFailed: false,
  cloudSyncStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict'
  lastSyncError: null,
  stateLoadedForUserId: null,
  resourceSyncStatus: { day: 'idle', contacts: 'idle', orders: 'idle', settings: 'idle', businesses: 'idle' },
  // ── Tea House (পাশের চায়ের দোকানের হিসাব) ──
  teaHouseProducts: [ ...DEFAULT_TEA_HOUSE_PRODUCTS ],
  teaHouseMonthlyTab: 0,       // মাসিক বাকি জমা (carry forward across days)
  teaHouseMonthlyPersonal: 0,  // মাসিক নিজের মোট
  teaHouseMonthlyShop: 0,      // মাসিক দোকানের মোট
  teaHouseTabMonth: null,      // কোন মাসের ট্যাব (e.g. '2026-09') — মাস পরিবর্তনে reset
  // ── Online Orders & Courier Tracking ──
  onlineOrders: [],           // All online orders (persisted across days)
  courierSettings: { ...DEFAULT_COURIER_SETTINGS },
  customerBlacklist: {},      // { phone: { rtoCount, lastRtoDate } }
};

// â”€â”€ Helper: Create new day data (same as storage.js but async-aware) â”€
function createNewDayData(dateKey, previousDay = null, bizType = null, bizName = null, bizId = 'biz_1') {
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
        fifoCogs: 0,
        fifoSoldUnits: 0,
      };
    });
    saveCatalog(inventory, bizId);
  } else {
    const catalog = loadCatalog(bizId);
    if (catalog !== null && Array.isArray(catalog) && catalog.length > 0) {
      inventory = catalog.map((item) => {
        const carried = Math.max(0, Number(item.closingStock !== undefined ? item.closingStock : item.openingStock) || 0);
        return {
          ...item,
          openingStock: carried,
          addedStock: 0,
          closingStock: carried,
          damagedStock: 0,
          fifoCogs: 0,
          fifoSoldUnits: 0,
        };
      });
    } else if (hasBusinessHistory(bizId) || (catalog !== null && Array.isArray(catalog) && catalog.length === 0)) {
      inventory = [];
    } else if (isTelecom) {
      inventory = DEFAULT_INVENTORY.map((item) => ({
        ...item,
        openingStock: 0,
        addedStock: 0,
        closingStock: 0,
      }));
      saveCatalog(inventory, bizId);
    } else {
      inventory = [];
    }
  }

  const prevTx = previousDay?.transactions ? aggregateTransactions(previousDay.transactions) : { loanGiven: 0, loanCollected: 0, loanTaken: 0, loanRepaid: 0 };
  const loans = {
    openingGiven: previousDay?.loans?.closingGiven != null
      ? previousDay.loans.closingGiven
      : Math.max(0, (previousDay?.loans?.openingGiven || 0) + (prevTx.loanGiven || 0) - (prevTx.loanCollected || 0)),
    openingTaken: previousDay?.loans?.closingTaken != null
      ? previousDay.loans.closingTaken
      : Math.max(0, (previousDay?.loans?.openingTaken || 0) + (prevTx.loanTaken || 0) - (prevTx.loanRepaid || 0)),
  };

  // Auto-create suspense entry if previous day had cash mismatch
  const autoTransactions = [];
  if (previousDay?.cashMismatch && Math.abs(previousDay.cashMismatch) >= 0.01) {
    autoTransactions.push({
      id: `adj_${Date.now()}`,
      timestamp: Date.now(),
      type: 'cash_adjustment',
      amount: previousDay.cashMismatch, // positive = surplus, negative = shortage
      note: previousDay.cashMismatch > 0
        ? `à¦—à¦¤à¦•à¦¾à¦²à§‡à¦° à¦•à§à¦¯à¦¾à¦¶ à¦‰à¦¦à§à¦¬à§ƒà¦¤à§à¦¤ (Surplus) à§³${Math.abs(previousDay.cashMismatch)}`
        : `à¦—à¦¤à¦•à¦¾à¦²à§‡à¦° à¦•à§à¦¯à¦¾à¦¶ à¦˜à¦¾à¦Ÿà¦¤à¦¿ (Shortage) à§³${Math.abs(previousDay.cashMismatch)}`,
      isAutoGenerated: true,
    });
  }

  return {
    dateKey,
    status: DAY_STATUS.NOT_STARTED,
    wallets,
    loans,
    inventory,
    transactions: autoTransactions,
    services: { photocopy: 0, studio: 0 },
    journalEntries: [],
    actualCash: null,
    cashMismatch: null,
    dailyProfit: null,
    createdAt: new Date().toISOString(),
    finalizedAt: null,
    sheetsExported: false,
    // Tea House daily entries (reset each day)
    teaHouseEntries: [],
    teaHouseDayPersonal: 0,
    teaHouseDayShop: 0,
    // Online Orders daily tracking
    onlineOrdersDayStats: {
      created: 0,
      shipped: 0,
      delivered: 0,
      settled: 0,
      returned: 0,
      revenue: 0,
      courierExpense: 0,
    },
  };
}

// â”€â”€ Reducer (same business logic, storage calls are side-effects in Provider) â”€
export function appReducer(state, action) {
  switch (action.type) {
    case 'TOGGLE_PRIVACY_MODE': {
      const nextPrivacy = !state.isPrivacyMode;
      return { ...state, isPrivacyMode: nextPrivacy };
    }

    case 'ADD_RECURRING_EXPENSE': {
      const recurring = state.dayData?.recurringExpenses || [];
      return {
        ...state,
        dayData: {
          ...state.dayData,
          recurringExpenses: [...recurring, action.payload]
        }
      };
    }
    case 'UPDATE_RECURRING_EXPENSE': {
      const recurring = state.dayData?.recurringExpenses || [];
      return {
        ...state,
        dayData: {
          ...state.dayData,
          recurringExpenses: recurring.map(r => r.id === action.payload.id ? { ...r, ...action.payload } : r)
        }
      };
    }
    case 'DELETE_RECURRING_EXPENSE': {
      const recurring = state.dayData?.recurringExpenses || [];
      return {
        ...state,
        dayData: {
          ...state.dayData,
          recurringExpenses: recurring.filter(r => r.id !== action.payload)
        }
      };
    }

    case 'TOGGLE_DARK_MODE': {
      const nextDark = !state.isDarkMode;
      if (nextDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { ...state, isDarkMode: nextDark };
    }

    case 'SET_LANGUAGE': {
      const lang = action.payload;
      return { ...state, language: lang };
    }

    case 'UPDATE_SETTINGS': {
      // Update auto-close/open settings
      const { autoCloseTime, autoOpenTime, autoCloseEnabled, sheetsWebAppUrl } = action.payload;
      return {
        ...state,
        ...(autoCloseTime !== undefined && { autoCloseTime }),
        ...(autoOpenTime !== undefined && { autoOpenTime }),
        ...(autoCloseEnabled !== undefined && { autoCloseEnabled }),
        ...(sheetsWebAppUrl !== undefined && { sheetsWebAppUrl }),
      };
    }

    case 'SET_APP_MODE': {
      const mode = action.payload; // 'easy' or 'advanced'
      const flags = mode === 'advanced'
        ? Object.fromEntries(Object.keys(ADVANCED_FEATURES).map(k => [k, true]))
        : { ...ADVANCED_FEATURES }; // All false
      applyModeTheme(mode);

      // Background Shadow Accounting Reconciler:
      // When switching to Advanced Mode, guarantee that all Easy Mode transactions
      // have balanced double-entry journals & COGS ready instantly!
      let updatedDayData = state.dayData;
      if (mode === 'advanced' && state.dayData) {
        const { reconciledJournals } = reconcileJournalsForTransactions(
          state.dayData.transactions || [],
          state.dayData.journalEntries || [],
          state.dayData.inventory || []
        );
        updatedDayData = {
          ...state.dayData,
          journalEntries: reconciledJournals,
        };
      }

      return { 
        ...state, 
        appMode: mode, 
        featureFlags: flags,
        dayData: updatedDayData,
        currentScreen: mode === 'advanced' ? SCREENS.ANALYTICS : SCREENS.DASHBOARD
      };
    }

    case 'TOGGLE_FEATURE': {
      const key = action.payload;
      return {
        ...state,
        featureFlags: { ...state.featureFlags, [key]: !state.featureFlags[key] },
      };
    }

    case 'SET_TAX_REGION': {
      return { ...state, taxRegion: action.payload };
    }

    case 'SET_EDIT_LOCK': {
      const { enabled, pinHash } = action.payload;
      return {
        ...state,
        editLockEnabled: enabled,
        editLockPinHash: pinHash !== undefined ? pinHash : state.editLockPinHash,
      };
    }

    case 'SET_USER_ROLE': {
      return { ...state, userRole: action.payload };
    }

    case 'SET_STAFF_PIN': {
      return { ...state, staffPinHash: action.payload };
    }

    case 'UPDATE_BUSINESS': {
      // Update business name/type
      const updatedBiz = action.payload;
      const updatedBusinesses = state.businesses.map(b =>
        b.id === updatedBiz.id ? { ...b, ...updatedBiz } : b
      );
      const newActiveBiz = updatedBiz.id === state.activeBizId
        ? { ...state.activeBiz, ...updatedBiz }
        : state.activeBiz;
      return {
        ...state,
        businesses: updatedBusinesses,
        activeBiz: newActiveBiz,
        _bizUpdated: true,
      };
    }

    case 'LOAD_DAY':
      return {
        ...state,
        dayData: action.payload,
        isLoading: false,
        currentScreen: action.payload.status === DAY_STATUS.NOT_STARTED ? SCREENS.OPENING : state.currentScreen
      };

    case 'ACCOUNT_SWITCH_RESET': {
      document.documentElement.classList.remove('dark');
      applyModeTheme('easy');
      return {
        ...state,
        dayData: null,
        contacts: [],
        onlineOrders: [],
        businesses: DEFAULT_BUSINESSES,
        activeBizId: 'biz_1',
        activeBiz: DEFAULT_BUSINESSES[0],
        courierSettings: DEFAULT_COURIER_SETTINGS,
        customerBlacklist: {},
        isPrivacyMode: false,
        appMode: 'easy',
        featureFlags: { ...ADVANCED_FEATURES },
        autoCloseEnabled: false,
        editLockEnabled: false,
        editLockPinHash: null,
        language: 'bn',
        isDarkMode: false,
        staffPinHash: null,
        userRole: 'owner',
        sheetsWebAppUrl: '',
        lockedPeriodEndDate: null,
        teaHouseMonthlyTab: 0,
        teaHouseMonthlyPersonal: 0,
        teaHouseMonthlyShop: 0,
        teaHouseTabMonth: null,
        categories: DEFAULT_EXPENSE_CATEGORIES,
        wallets: createDefaultWallets(),
        fixedAssets: [],
        employees: [],
        invoices: [],
        reconciledTxIds: [],
        teaHouseEntries: [],
        teaHouseProducts: [ ...DEFAULT_TEA_HOUSE_PRODUCTS ],
        cloudInitFailed: false,
        cloudReady: false,
        stateLoadedForUserId: null,
        isLoading: true,
        cloudSyncStatus: 'idle',
        lastSyncError: null,
        resourceSyncStatus: { day: 'idle', contacts: 'idle', orders: 'idle', settings: 'idle', businesses: 'idle' },
      };
    }

    case 'CLOUD_INIT': {
      // Called once after Firestore data is loaded
      let initialContacts = action.payload.contacts ? [...action.payload.contacts] : [];
      const txs = action.payload.dayData?.transactions || [];
      if (txs.length > 0) {
        txs.forEach(tx => {
          const cName = (tx.customerName || '').trim();
          if (!cName || cName === 'à¦•à¦¾à¦¸à§à¦Ÿà¦®à¦¾à¦°' || cName.toLowerCase() === 'customer') return;
          const existingIdx = initialContacts.findIndex(c => c.name.toLowerCase().trim() === cName.toLowerCase());
          if (existingIdx === -1 && (tx.type === 'loan_given' || tx.type === 'loan_collected' || tx.type === 'credit_sale')) {
            const netDue = txs
              .filter(t => (t.customerName || '').trim().toLowerCase() === cName.toLowerCase())
              .reduce((sum, t) => {
                if (t.type === 'loan_given' || t.type === 'credit_sale') return sum + (Number(t.amount) || 0);
                if (t.type === 'loan_collected') return sum - (Number(t.amount) || 0);
                return sum;
              }, 0);

            initialContacts.push({
              id: tx.contactId || `contact_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
              name: cName,
              phone: tx.phone || '',
              type: 'customer',
              openingBalance: 0,
              currentBalance: Math.max(0, netDue),
              interestRate: 0,
              note: 'à¦ªà§‚à¦°à§à¦¬à§‡à¦° à¦²à§‡à¦¨à¦¦à§‡à¦¨ à¦¥à§‡à¦•à§‡ à¦¸à§à¦¬à¦¯à¦¼à¦‚à¦•à§à¦°à¦¿à¦¯à¦¼ à¦ªà§à¦¨à¦°à§à¦¦à§à¦§à¦¾à¦°',
              createdAt: new Date(tx.timestamp || Date.now()).toISOString(),
              updatedAt: new Date().toISOString()
            });
          } else if (existingIdx !== -1 && (tx.type === 'loan_given' || tx.type === 'loan_collected' || tx.type === 'credit_sale')) {
            if ((Number(initialContacts[existingIdx].currentBalance) || 0) === 0) {
              const netDue = txs
                .filter(t => (t.customerName || '').trim().toLowerCase() === cName.toLowerCase())
                .reduce((sum, t) => {
                  if (t.type === 'loan_given' || t.type === 'credit_sale') return sum + (Number(t.amount) || 0);
                  if (t.type === 'loan_collected') return sum - (Number(t.amount) || 0);
                  return sum;
                }, 0);
              if (netDue > 0) {
                initialContacts[existingIdx] = {
                  ...initialContacts[existingIdx],
                  currentBalance: netDue
                };
              }
            }
          }
        });
      }

      const userId = action.payload.userId;

      return {
        ...state,
        ...action.payload,
        contacts: initialContacts,
        stateLoadedForUserId: action.payload.userId || userId,
        resourceSyncStatus: { day: 'saved', contacts: 'saved', orders: 'saved', settings: 'saved', businesses: 'saved' },
        isLoading: false,
        cloudReady: true,
        cloudInitFailed: false,
        cloudSyncStatus: 'saved',
        lastSyncError: null,
      };
    }

    case 'CLOUD_INIT_ERROR': {
      document.documentElement.classList.remove('dark');
      applyModeTheme('easy');
      return {
        ...state,
        ...action.payload,
        onlineOrders: [],
        courierSettings: DEFAULT_COURIER_SETTINGS,
        customerBlacklist: {},
        isPrivacyMode: false,
        appMode: 'easy',
        featureFlags: { ...ADVANCED_FEATURES },
        autoCloseEnabled: false,
        editLockEnabled: false,
        editLockPinHash: null,
        language: 'bn',
        isDarkMode: false,
        staffPinHash: null,
        userRole: 'owner',
        sheetsWebAppUrl: '',
        lockedPeriodEndDate: null,
        teaHouseMonthlyTab: 0,
        teaHouseMonthlyPersonal: 0,
        teaHouseMonthlyShop: 0,
        teaHouseTabMonth: null,
        categories: DEFAULT_EXPENSE_CATEGORIES,
        wallets: createDefaultWallets(),
        teaHouseProducts: [ ...DEFAULT_TEA_HOUSE_PRODUCTS ],
        fixedAssets: [],
        employees: [],
        invoices: [],
        reconciledTxIds: [],
        teaHouseEntries: [],
        stateLoadedForUserId: action.payload?.userId || null,
        isLoading: false,
        cloudReady: false,
        cloudInitFailed: true,
        cloudSyncStatus: 'error',
        lastSyncError: action.payload?.error || 'Cloud initialization failed',
      };
    }

    case 'APPLY_CLOUD_SETTLEMENT': {
      const { order, dayData } = action.payload || {};
      if (!order) return state;
      const updatedOrders = (state.onlineOrders || []).map(o => o.id === order.id ? { ...o, ...order } : o);
      return {
        ...state,
        onlineOrders: updatedOrders,
        ...(dayData ? { dayData } : {}),
        _orderSettleError: null,
      };
    }

    case 'SET_CLOUD_INIT_RECOVERED':
    case 'SET_CLOUD_INIT_FAILED': {
      const isFailed = action.type === 'SET_CLOUD_INIT_FAILED' ? Boolean(action.payload) : false;
      return {
        ...state,
        cloudInitFailed: isFailed,
        ...(isFailed ? { cloudReady: false } : { cloudReady: true, stateLoadedForUserId: action.payload?.userId || state.stateLoadedForUserId }),
      };
    }

    case 'SET_RESOURCE_SYNC': {
      const { resource, status, error } = action.payload || {};
      if (!resource) return state;

      const normResource = (resource === 'onlineOrders' || resource === 'orders') ? 'orders' : resource;

      const nextResourceSyncStatus = {
        ...(state.resourceSyncStatus || { day: 'idle', contacts: 'idle', orders: 'idle', settings: 'idle', businesses: 'idle' }),
        [normResource]: status,
      };

      const statuses = Object.values(nextResourceSyncStatus);
      let derivedStatus = 'idle';
      if (statuses.some(s => s === 'conflict')) {
        derivedStatus = 'conflict';
      } else if (statuses.some(s => s === 'error')) {
        derivedStatus = 'error';
      } else if (statuses.some(s => s === 'saving')) {
        derivedStatus = 'saving';
      } else if (statuses.length > 0 && statuses.every(s => s === 'saved')) {
        derivedStatus = 'saved';
      } else {
        derivedStatus = 'idle';
      }

      let derivedError = state.lastSyncError;
      if (derivedStatus === 'saved' || derivedStatus === 'idle') {
        derivedError = null;
      } else if (status === 'error' && error) {
        derivedError = error;
      } else if (status === 'conflict') {
        derivedError = error || 'Sync conflict detected';
      } else if (derivedStatus === 'error' && !derivedError) {
        derivedError = 'Sync failed';
      }

      return {
        ...state,
        resourceSyncStatus: nextResourceSyncStatus,
        cloudSyncStatus: derivedStatus,
        lastSyncError: derivedError,
      };
    }

    case 'SET_SYNC_STATUS': {
      const status = typeof action.payload === 'string' ? action.payload : action.payload?.status;
      return {
        ...state,
        cloudSyncStatus: status,
        ...(status === 'saved' || status === 'idle' ? { lastSyncError: null } : {}),
      };
    }

    case 'SET_SYNC_ERROR': {
      const errorMsg = action.payload?.error || (typeof action.payload === 'string' ? action.payload : 'Sync failed');
      const status = action.payload?.status || 'error';
      return {
        ...state,
        cloudSyncStatus: status,
        lastSyncError: errorMsg,
      };
    }

    case 'SWITCH_BUSINESS': {
      const targetBizId = action.payload;
      const targetBiz = state.businesses.find(b => b.id === targetBizId) || state.businesses[0];
      return {
        ...state,
        activeBizId: targetBizId,
        activeBiz: targetBiz,
        contacts: [],
        dayData: null,
        isLoading: true,
        currentScreen: SCREENS.OPENING
      };
    }

    case 'ADD_BUSINESS': {
      const newBiz = action.payload;
      const updatedBusinesses = [...state.businesses, newBiz];
      return {
        ...state,
        businesses: updatedBusinesses,
        activeBizId: newBiz.id,
        activeBiz: newBiz,
        contacts: [],
        dayData: null,
        isLoading: true,
        currentScreen: SCREENS.OPENING
      };
    }

    case 'DELETE_BUSINESS': {
      const bizIdToDelete = action.payload;
      if ((state.businesses || []).length <= 1) return state;
      try {
        deleteBusinessData(bizIdToDelete);
      } catch (e) {
        console.warn('Local business cleanup warning:', e);
      }
      const nextState = deleteBusinessInState(state, bizIdToDelete);
      return state.activeBizId === bizIdToDelete
        ? { ...nextState, currentScreen: SCREENS.OPENING }
        : nextState;
    }

    case 'ADD_CONTACT': {
      const newContact = {
        id: action.payload.id || `contact_${Date.now()}`,
        name: action.payload.name.trim(),
        phone: action.payload.phone?.trim() || '',
        type: action.payload.type || 'customer',
        openingBalance: Number(action.payload.openingBalance) || 0,
        currentBalance: Number(action.payload.openingBalance) || 0,
        interestRate: Number(action.payload.interestRate) || 0,
        note: action.payload.note || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const updatedContacts = [newContact, ...(state.contacts || [])];
      return { ...state, contacts: updatedContacts, _newContact: newContact };
    }

    case 'DELETE_CONTACT': {
      const updatedContacts = (state.contacts || []).filter(c => c.id !== action.payload);
      return { ...state, contacts: updatedContacts, _deletedContactId: action.payload };
    }

    case 'UPDATE_CONTACT': {
      const { id, name, phone, type, note, interestRate } = action.payload;
      const updatedContacts = (state.contacts || []).map(c => {
        if (c.id === id) {
          return {
            ...c,
            name: name !== undefined ? name.trim() : c.name,
            phone: phone !== undefined ? phone.trim() : c.phone,
            type: type !== undefined ? type : c.type,
            note: note !== undefined ? note.trim() : c.note,
            interestRate: interestRate !== undefined ? Number(interestRate) || 0 : (c.interestRate || 0),
            updatedAt: new Date().toISOString()
          };
        }
        return c;
      });
      return { ...state, contacts: updatedContacts };
    }

    case 'RECORD_CONTACT_TX': {
      const { contactId, contactName, txType, amount, note, date, walletKey } = action.payload;
      const targetWallet = walletKey || 'hand_cash';
      const numAmount = Number(amount) || 0;
      if (numAmount <= 0) return state;

      let targetContact = (state.contacts || []).find(c => c.id === contactId);
      let contactsList = [...(state.contacts || [])];
      let effectiveContactId = contactId;
      let newlyCreated = null;

      // If contact not found by ID, search by contactName
      const candidateName = (contactName || '').trim();
      if (!targetContact && candidateName) {
        targetContact = contactsList.find(c => c.name.toLowerCase().trim() === candidateName.toLowerCase());
        if (targetContact) {
          effectiveContactId = targetContact.id;
        }
      }

      // If still not found and a valid name is provided, auto-create the contact in Khata!
      if (!targetContact && candidateName && candidateName !== 'à¦•à¦¾à¦¸à§à¦Ÿà¦®à¦¾à¦°') {
        effectiveContactId = contactId || `contact_${Date.now()}`;
        targetContact = {
          id: effectiveContactId,
          name: candidateName,
          phone: '',
          type: 'customer',
          openingBalance: 0,
          currentBalance: 0,
          interestRate: 0,
          note: 'à¦¸à§à¦¬à¦¯à¦¼à¦‚à¦•à§à¦°à¦¿à¦¯à¦¼ à¦¤à§ˆà¦°à¦¿ (NAM AI)',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        newlyCreated = targetContact;
        contactsList = [targetContact, ...contactsList];
      }

      if (!targetContact) {
        // Fallback: If no contact could be found or created, still record day transaction so cash/dashboard isn't lost
        if (state.dayData && (txType === 'customer_due_given' || txType === 'customer_paid')) {
          const fallbackTxType = txType === 'customer_due_given' ? 'credit_sale' : 'loan_collected';
          const fallbackDayTx = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            type: fallbackTxType,
            amount: numAmount,
            customerName: candidateName || 'à¦•à¦¾à¦¸à§à¦Ÿà¦®à¦¾à¦°',
            note: note || 'à¦¬à¦¾à¦•à¦¿ à¦à¦¨à§à¦Ÿà§à¦°à¦¿'
          };
          return {
            ...state,
            dayData: {
              ...state.dayData,
              transactions: [...(state.dayData.transactions || []), fallbackDayTx]
            }
          };
        }
        return state;
      }

      const isCustomer = targetContact.type === 'customer';
      let balanceDelta = 0;
      let dayTxType = null;
      let dayTxNote = note || '';

      if (isCustomer) {
        if (txType === 'customer_paid') {
          balanceDelta = -numAmount;
          dayTxType = 'loan_collected';
          dayTxNote = dayTxNote || `${targetContact.name} à¦¬à¦¾à¦•à¦¿ à¦ªà¦°à¦¿à¦¶à§‹à¦§ (à¦†à¦¦à¦¾à¦¯à¦¼)`;
        } else if (txType === 'customer_due_given') {
          balanceDelta = numAmount;
          dayTxType = 'credit_sale';
          dayTxNote = dayTxNote || `${targetContact.name} à¦•à§‡ à¦¬à¦¾à¦•à¦¿à¦¤à§‡ à¦¬à¦¿à¦•à§à¦°à¦¯à¦¼`;
        } else if (txType === 'interest_charged') {
          balanceDelta = numAmount;
          dayTxType = 'service_income';
          dayTxNote = dayTxNote || `${targetContact.name} â€” à¦¸à§à¦¦ à¦§à¦¾à¦°à§à¦¯ (${targetContact.interestRate || 0}%)`;
        }
      } else {
        if (txType === 'supplier_paid') {
          balanceDelta = -numAmount;
          dayTxType = 'loan_repaid';
          dayTxNote = dayTxNote || `${targetContact.name} (à¦®à¦¹à¦¾à¦œà¦¨) à¦¦à§‡à¦¨à¦¾ à¦¶à§‹à¦§`;
        } else if (txType === 'supplier_due_taken') {
          balanceDelta = numAmount;
          dayTxType = 'loan_taken';
          dayTxNote = dayTxNote || `${targetContact.name} à¦¥à§‡à¦•à§‡ à¦¬à¦¾à¦•à¦¿à¦¤à§‡ à¦®à¦¾à¦² à¦•à§à¦°à¦¯à¦¼`;
        } else if (txType === 'interest_charged') {
          balanceDelta = numAmount;
          dayTxType = 'expense';
          dayTxNote = dayTxNote || `${targetContact.name} â€” à¦¸à§à¦¦ à¦¬à§à¦¯à¦¯à¦¼ (${targetContact.interestRate || 0}%)`;
        }
      }

      const newBalance = Math.max(0, targetContact.currentBalance + balanceDelta);

      const updatedContacts = contactsList.map(c => 
        c.id === effectiveContactId 
          ? { ...c, currentBalance: newBalance, updatedAt: new Date().toISOString() } 
          : c
      );

      let newDayData = state.dayData;
      if (state.dayData && dayTxType) {
        const isDueOut = dayTxType === 'credit_sale' || txType === 'customer_due_given';
        const newDayTx = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          type: isDueOut ? 'loan_given' : (txType === 'customer_paid' ? 'loan_collected' : dayTxType),
          amount: numAmount,
          fromWallet: (isDueOut || dayTxType === 'loan_repaid') ? targetWallet : undefined,
          toWallet: (dayTxType === 'loan_collected' || txType === 'customer_paid' || dayTxType === 'loan_taken') ? targetWallet : undefined,
          customerName: targetContact.name,
          contactId: targetContact.id,
          note: dayTxNote
        };

        const newWallets = { ...state.dayData.wallets };
        if (dayTxType === 'loan_collected' || txType === 'customer_paid') {
          if (newWallets[targetWallet]) {
            newWallets[targetWallet] = {
              ...newWallets[targetWallet],
              current: roundBDT((newWallets[targetWallet]?.current || 0) + numAmount)
            };
          }
        } else if (dayTxType === 'loan_repaid' || txType === 'supplier_paid') {
          if (newWallets[targetWallet]) {
            newWallets[targetWallet] = {
              ...newWallets[targetWallet],
              current: roundBDT(Math.max(0, (newWallets[targetWallet]?.current || 0) - numAmount))
            };
          }
        } else if (isDueOut) {
          if (newWallets[targetWallet]) {
            newWallets[targetWallet] = {
              ...newWallets[targetWallet],
              current: roundBDT(Math.max(0, (newWallets[targetWallet]?.current || 0) - numAmount))
            };
          }
        }

        const existingJournals = state.dayData.journalEntries || [];
        const je = generateJournalEntry(newDayTx);
        const newJournals = je ? [...existingJournals, je] : existingJournals;

        newDayData = {
          ...state.dayData,
          wallets: newWallets,
          transactions: [...state.dayData.transactions, newDayTx],
          journalEntries: newJournals,
        };
      }

      return {
        ...state,
        contacts: updatedContacts,
        dayData: newDayData,
        _newContact: newlyCreated || state._newContact,
        _contactTxPayload: { contactId: effectiveContactId, txType, dayTxNote, numAmount, newBalance, date }
      };
    }

    case 'SET_SCREEN':
      return { ...state, currentScreen: action.payload };

    case 'OPEN_DAY': {
      // Ensure all inventory items have closingStock properly initialized to available stock
      const syncedInventory = (state.dayData.inventory || []).map(item => {
        const available = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
        const closing = (item.closingStock !== undefined && item.closingStock !== null && item.closingStock > 0)
          ? item.closingStock
          : available;
        return {
          ...item,
          closingStock: closing
        };
      });

      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: syncedInventory,
          status: DAY_STATUS.OPEN,
          createdAt: Date.now()
        },
        currentScreen: SCREENS.DASHBOARD
      };
    }

    case 'ADD_STOCK': {
      const { itemId, quantity } = action.payload;
      const newAdded = Math.max(0, Number(quantity) || 0);
      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: (state.dayData.inventory || []).map(item => {
            if (item.id !== itemId) return item;
            const oldAdded = Number(item.addedStock) || 0;
            const diff = newAdded - oldAdded;
            const currentClosing = item.closingStock !== undefined && item.closingStock !== null
              ? item.closingStock
              : ((Number(item.openingStock) || 0) + oldAdded);
            return {
              ...item,
              addedStock: newAdded,
              closingStock: Math.max(0, currentClosing + diff)
            };
          })
        }
      };
    }

    case 'SET_OPENING_STOCK': {
      const { itemId, quantity } = action.payload;
      const newOpening = Math.max(0, Number(quantity) || 0);
      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: (state.dayData.inventory || []).map(item => {
            if (item.id !== itemId) return item;
            const oldOpening = Number(item.openingStock) || 0;
            const diff = newOpening - oldOpening;
            const currentClosing = item.closingStock !== undefined && item.closingStock !== null
              ? item.closingStock
              : (oldOpening + (Number(item.addedStock) || 0));
            return {
              ...item,
              openingStock: newOpening,
              closingStock: Math.max(0, currentClosing + diff)
            };
          })
        }
      };
    }

    case 'ADD_TRANSACTION': {
      const newTx = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        ...action.payload
      };

      const newWallets = { ...state.dayData.wallets };
      const newServices = { ...(state.dayData.services || {}) };

      if (['expense', 'personal_draw', 'owner_took', 'loan_given', 'loan_repaid', 'stock_purchase', 'transfer_fee', 'asset_purchase', 'tax_payment'].includes(newTx.type)) {
        const walletKey = newTx.fromWallet || 'hand_cash';
        if (newWallets[walletKey]) {
          newWallets[walletKey] = {
            ...newWallets[walletKey],
            current: roundBDT(Math.max(0, (newWallets[walletKey]?.current || 0) - newTx.amount))
          };
        }
      } else if (['loan_collected', 'loan_taken', 'owner_gave', 'stock_sale', 'asset_sale'].includes(newTx.type)) {
        const walletKey = newTx.toWallet || 'hand_cash';
        if (newWallets[walletKey]) {
          newWallets[walletKey] = {
            ...newWallets[walletKey],
            current: roundBDT((newWallets[walletKey]?.current || 0) + newTx.amount)
          };
        }
      } else if (newTx.type === 'fund_transfer') {
        if (newTx.fromWallet && newTx.toWallet && newWallets[newTx.fromWallet] && newWallets[newTx.toWallet]) {
          newWallets[newTx.fromWallet] = {
            ...newWallets[newTx.fromWallet],
            current: roundBDT((newWallets[newTx.fromWallet]?.current || 0) - newTx.amount)
          };
          newWallets[newTx.toWallet] = {
            ...newWallets[newTx.toWallet],
            current: roundBDT((newWallets[newTx.toWallet]?.current || 0) + newTx.amount)
          };
        }
      } else if (newTx.type === 'service_income') {
        newWallets.hand_cash = {
          ...newWallets.hand_cash,
          current: roundBDT((newWallets.hand_cash?.current || 0) + newTx.amount)
        };
        if (newTx.serviceType) {
          newServices[newTx.serviceType] = roundBDT((newServices[newTx.serviceType] || 0) + newTx.amount);
        }
      } else if (newTx.type === 'recharge') {
        const cashInAmt = roundBDT((newTx.amount || 0) + (newTx.profit || 0));
        newWallets.hand_cash = {
          ...newWallets.hand_cash,
          current: roundBDT((newWallets.hand_cash?.current || 0) + cashInAmt)
        };
        if (newTx.fromWallet && newWallets[newTx.fromWallet]) {
          newWallets[newTx.fromWallet] = {
            ...newWallets[newTx.fromWallet],
            current: roundBDT(Math.max(0, (newWallets[newTx.fromWallet]?.current || 0) - newTx.amount))
          };
        }
      }

      // Universal Double-Entry Journal Engine (Always maintains true GL in background)
      const existingJournals = state.dayData.journalEntries || [];
      let newJournals = existingJournals;
      const je = generateJournalEntry(newTx, {
        fromWallet: newTx.fromWallet,
        toWallet: newTx.toWallet,
        category: newTx.category,
        note: newTx.note,
      });
      if (je) newJournals = [...existingJournals, je];

      // Auto COGS for sales if profit or cost is recorded
      const costAmount = (newTx.costAmount && newTx.costAmount > 0)
        ? newTx.costAmount
        : (newTx.profit !== undefined && newTx.amount > newTx.profit ? roundBDT(newTx.amount - newTx.profit) : 0);
      if (costAmount > 0 && ['stock_sale', 'sale', 'cash_sale'].includes(newTx.type)) {
        const cogsJE = generateCOGSEntry(costAmount, newTx.id);
        if (cogsJE) newJournals = [...newJournals, cogsJE];
      }

      // â”€â”€ Synchronize Contact & Khata Ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let updatedContacts = state.contacts ? [...state.contacts] : [];
      const rawCustName = (newTx.customerName || '').trim();
      const rawPhone = (newTx.phone || newTx.customerPhone || '').trim();
      const numAmount = Number(newTx.amount) || 0;

      if (rawCustName && rawCustName !== 'à¦•à¦¾à¦¸à§à¦Ÿà¦®à¦¾à¦°' && rawCustName.toLowerCase() !== 'customer') {
        let targetContact = updatedContacts.find(c => 
          (newTx.contactId && c.id === newTx.contactId) ||
          (c.name.toLowerCase().trim() === rawCustName.toLowerCase()) ||
          (rawPhone && c.phone && c.phone.trim() === rawPhone)
        );

        if (!targetContact) {
          // Auto-create customer in Khata / Contacts if not already exists!
          const newId = newTx.contactId || `contact_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
          targetContact = {
            id: newId,
            name: rawCustName,
            phone: rawPhone,
            type: 'customer',
            openingBalance: 0,
            currentBalance: 0,
            interestRate: 0,
            note: newTx.note || 'à¦•à§à¦‡à¦• à¦à¦¨à§à¦Ÿà§à¦°à¦¿ à¦¥à§‡à¦•à§‡ à¦¯à§à¦•à§à¦¤',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedContacts = [targetContact, ...updatedContacts];
        } else if (rawPhone && !targetContact.phone) {
          // If existing customer didn't have phone, update it!
          targetContact = {
            ...targetContact,
            phone: rawPhone,
            updatedAt: new Date().toISOString()
          };
          updatedContacts = updatedContacts.map(c => c.id === targetContact.id ? targetContact : c);
        }

        if (targetContact) {
          newTx.contactId = targetContact.id;
          newTx.customerName = targetContact.name;
          if (targetContact.phone && !newTx.phone) newTx.phone = targetContact.phone;

          // If this is a due loan / credit transaction, update customer balance
          if (numAmount > 0 && (newTx.type === 'loan_given' || newTx.type === 'loan_collected' || newTx.type === 'credit_sale')) {
            const isDueGiven = newTx.type === 'loan_given' || newTx.type === 'credit_sale';
            const newBalance = isDueGiven
              ? roundBDT((targetContact.currentBalance || 0) + numAmount)
              : roundBDT(Math.max(0, (targetContact.currentBalance || 0) - numAmount));

            updatedContacts = updatedContacts.map(c => 
              c.id === targetContact.id
                ? { 
                    ...c, 
                    phone: (rawPhone || c.phone || '').trim(),
                    currentBalance: newBalance, 
                    updatedAt: new Date().toISOString() 
                  }
                : c
            );
          }
        }
      }

      return {
        ...state,
        contacts: updatedContacts,
        dayData: {
          ...state.dayData,
          wallets: newWallets,
          services: newServices,
          transactions: [...state.dayData.transactions, newTx],
          journalEntries: newJournals,
        }
      };
    }

    case 'QUICK_SELL_STOCK': {
      return quickSellStockInState(state, action.payload);
    }

    case 'QUICK_RESTOCK': {
      return quickRestockInState(state, action.payload);
    }

    case 'SET_OPENING_LOANS': {
      return {
        ...state,
        dayData: {
          ...state.dayData,
          loans: {
            ...state.dayData.loans,
            openingGiven: action.payload.openingGiven !== undefined ? action.payload.openingGiven : (state.dayData.loans?.openingGiven || 0),
            openingTaken: action.payload.openingTaken !== undefined ? action.payload.openingTaken : (state.dayData.loans?.openingTaken || 0),
          }
        }
      };
    }

    case 'UPDATE_WALLET_BALANCE':
      return {
        ...state,
        dayData: {
          ...state.dayData,
          wallets: {
            ...state.dayData.wallets,
            [action.payload.walletKey]: {
              ...state.dayData.wallets[action.payload.walletKey],
              current: action.payload.balance,
              closing: action.payload.balance
            }
          }
        }
      };

    case 'SET_ACTUAL_CASH':
      return {
        ...state,
        dayData: {
          ...state.dayData,
          actualCash: action.payload.amount,
          wallets: {
            ...state.dayData.wallets,
            hand_cash: {
              ...state.dayData.wallets.hand_cash,
              closing: action.payload.amount
            }
          }
        }
      };

    case 'SET_CLOSING_STOCK': {
      const { itemId, quantity } = action.payload;
      if (!itemId || !state.dayData?.inventory) return state;
      const updatedInventory = state.dayData.inventory.map(item =>
        item.id === itemId ? { ...item, closingStock: Math.max(0, Number(quantity) || 0) } : item
      );
      saveCatalog(updatedInventory, state.activeBizId);
      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: updatedInventory
        }
      };
    }

    case 'ADD_INVENTORY_ITEM': {
      const newItem = {
        id: action.payload.id || `item_${Date.now()}`,
        name: action.payload.name,
        unit: action.payload.unit || 'pcs',
        buyPrice: parseFloat(action.payload.buyPrice) || 0,
        sellPrice: parseFloat(action.payload.sellPrice) || 0,
        openingStock: Number(action.payload.openingStock) || 0,
        addedStock: 0,
        closingStock: Number(action.payload.openingStock) || 0,
        batches: (Number(action.payload.openingStock) || 0) > 0 
          ? [createBatch(Number(action.payload.openingStock), parseFloat(action.payload.buyPrice) || 0, state.dayData?.dateKey || Date.now())] 
          : [],
      };
      const updatedInventory = [...(state.dayData.inventory || []), newItem];
      saveCatalog(updatedInventory, state.activeBizId);

      // Deduct purchase cost from selected wallet
      const purchaseWalletKey = action.payload.paymentWallet;
      const purchaseTotalCost = Number(action.payload.totalCost) || 0;
      let purchaseWallets = { ...state.dayData.wallets };
      let purchaseTxs = [...(state.dayData.transactions || [])];

      if (purchaseTotalCost > 0 && purchaseWalletKey && purchaseWallets[purchaseWalletKey]) {
        // Deduct from wallet
        purchaseWallets[purchaseWalletKey] = {
          ...purchaseWallets[purchaseWalletKey],
          current: (purchaseWallets[purchaseWalletKey].current || 0) - purchaseTotalCost,
        };
        // Record purchase transaction
        purchaseTxs.push({
          id: `pur_${Date.now()}`,
          timestamp: Date.now(),
          type: 'stock_purchase',
          amount: purchaseTotalCost,
          fromWallet: purchaseWalletKey,
          note: `${newItem.name} - initial stock purchase (${newItem.openingStock} ${newItem.unit} @ Tk ${newItem.buyPrice})`,
          isAutoGenerated: true,
        });
      }

      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: updatedInventory,
          wallets: purchaseWallets,
          transactions: purchaseTxs,
        }
      };
    }

        case 'REMOVE_INVENTORY_ITEM': {
      const updatedInventory = (state.dayData?.inventory || []).filter(item => item.id !== action.payload);
      saveCatalog(updatedInventory, state.activeBizId);
      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: updatedInventory
        }
      };
    }

    case 'BULK_REMOVE_INVENTORY_ITEMS': {
      const idsToRemove = action.payload || [];
      if (!state.dayData?.inventory || idsToRemove.length === 0) return state;
      const updatedInventory = state.dayData.inventory.filter(item => !idsToRemove.includes(item.id));
      saveCatalog(updatedInventory, state.activeBizId);
      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: updatedInventory
        }
      };
    }

    case 'UPDATE_INVENTORY_ITEM': {
      const { id, name, unit, buyPrice, sellPrice, openingStock, addedStock } = action.payload;
      if (!id || !state.dayData?.inventory) return state;
      const updatedInventory = state.dayData.inventory.map(item => {
        if (item.id !== id) return item;
        const updatedOpening = openingStock !== undefined ? Number(openingStock) : item.openingStock;
        const updatedAdded = addedStock !== undefined ? Number(addedStock) : item.addedStock;
        const currentClosing = item.closingStock !== undefined && item.closingStock !== null 
          ? item.closingStock 
          : (item.openingStock + item.addedStock);
        const stockDelta = (updatedOpening + updatedAdded) - (item.openingStock + item.addedStock);

        return {
          ...item,
          ...(name !== undefined && { name: name.trim() }),
          ...(unit !== undefined && { unit: unit.trim() }),
          ...(buyPrice !== undefined && { buyPrice: parseFloat(buyPrice) || 0 }),
          ...(sellPrice !== undefined && { sellPrice: parseFloat(sellPrice) || 0 }),
          ...(openingStock !== undefined && { openingStock: updatedOpening }),
          ...(addedStock !== undefined && { addedStock: updatedAdded }),
          closingStock: Math.max(0, currentClosing + stockDelta)
        };
      });
      saveCatalog(updatedInventory, state.activeBizId);
      return {
        ...state,
        dayData: {
          ...state.dayData,
          inventory: updatedInventory
        }
      };
    }

    case 'REVERSE_TRANSACTION':
    case 'DELETE_TRANSACTION': {
      // Period Lock Audit Protection
      if (state.lockedPeriodEndDate && state.dayData?.dateKey && state.dayData.dateKey <= state.lockedPeriodEndDate) {
        if (typeof alert === 'function') {
          alert(state.language === 'en' 
            ? `This transaction is within a locked fiscal period (locked through ${state.lockedPeriodEndDate}). Reversal/deletion is prohibited.` 
            : `এই লেনদেনটি অডিট লক করা অর্থবছরের (${state.lockedPeriodEndDate} পর্যন্ত) হিসাবের অংশ। রিভার্সাল বা ডিলিট করা নিষিদ্ধ।`);
        }
        return state;
      }
      return reverseSingleTransactionInState(state, action.payload);
    }

    case 'WRITE_OFF_DAMAGE': {
      return writeOffDamageInState(state, action.payload);
    }

    case 'SAVE_INVOICE': {
      const invoice = action.payload;
      const nextSeq = (state.lastInvoiceSeq || 0) + 1;
      const formattedSeq = `INV-${new Date().getFullYear()}-${String(nextSeq).padStart(4, '0')}`;
      const savedInvoice = {
        ...invoice,
        id: invoice.id || `inv_${Date.now()}`,
        invoiceNumber: invoice.invoiceNumber || formattedSeq,
        createdAt: invoice.createdAt || new Date().toISOString(),
        status: invoice.status || (invoice.dueAmount <= 0 ? 'paid' : 'due'),
      };
      return {
        ...state,
        invoices: [savedInvoice, ...(state.invoices || [])],
        lastInvoiceSeq: nextSeq,
      };
    }

    case 'RECORD_INVOICE_PAYMENT': {
      const { invoiceId, paymentAmount } = action.payload;
      const updatedInvoices = (state.invoices || []).map(inv => {
        if (inv.id === invoiceId) {
          const newPaid = roundBDT((inv.paidAmount || 0) + Number(paymentAmount));
          const newDue = roundBDT(Math.max(0, (inv.total || 0) - newPaid));
          return {
            ...inv,
            paidAmount: newPaid,
            dueAmount: newDue,
            status: newDue <= 0 ? 'paid' : 'partial',
            updatedAt: new Date().toISOString(),
          };
        }
        return inv;
      });
      return {
        ...state,
        invoices: updatedInvoices,
      };
    }

    // â”€â”€ FIXED ASSETS (IAS 16) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'ADD_FIXED_ASSET': {
      const newAsset = {
        id: `fa_${Date.now()}`,
        name: action.payload.name,
        purchaseDate: action.payload.purchaseDate || new Date().toISOString().split('T')[0],
        cost: roundBDT(Number(action.payload.cost) || 0),
        salvageValue: roundBDT(Number(action.payload.salvageValue) || 0),
        usefulLifeYears: Number(action.payload.usefulLifeYears) || 3,
        accumulatedDepreciation: 0,
        currentValue: roundBDT(Number(action.payload.cost) || 0),
        wallet: action.payload.wallet || 'hand_cash',
        note: action.payload.note || '',
        createdAt: new Date().toISOString(),
      };
      // Also post asset_purchase transaction
      const assetTx = {
        id: `tx_fa_${Date.now()}`,
        timestamp: Date.now(),
        type: 'asset_purchase',
        amount: newAsset.cost,
        wallet: newAsset.wallet,
        note: `Fixed Asset Purchase: ${newAsset.name}`,
      };
      const je = generateJournalEntry(assetTx, { wallet: newAsset.wallet });

      // Deduct from wallet
      const walletObj = state.dayData?.wallets?.[newAsset.wallet] || { opening: 0, current: 0 };
      const updatedWallet = {
        ...walletObj,
        current: Math.max(0, (walletObj.current ?? walletObj.opening ?? 0) - newAsset.cost),
      };

      return {
        ...state,
        fixedAssets: [...(state.fixedAssets || []), newAsset],
        dayData: state.dayData ? {
          ...state.dayData,
          wallets: {
            ...state.dayData.wallets,
            [newAsset.wallet]: updatedWallet,
          },
          transactions: [assetTx, ...(state.dayData.transactions || [])],
          journalEntries: je ? [...(state.dayData.journalEntries || []), je] : state.dayData.journalEntries,
        } : state.dayData,
      };
    }

    case 'RUN_DEPRECIATION': {
      let totalDep = 0;
      const updatedAssets = (state.fixedAssets || []).map(asset => {
        const monthlyDep = roundBDT((asset.cost - asset.salvageValue) / (asset.usefulLifeYears * 12));
        const newAccum = roundBDT(Math.min(asset.cost - asset.salvageValue, (asset.accumulatedDepreciation || 0) + monthlyDep));
        const newCurrent = roundBDT(Math.max(asset.salvageValue, asset.cost - newAccum));
        const diff = newAccum - (asset.accumulatedDepreciation || 0);
        totalDep += diff;
        return {
          ...asset,
          accumulatedDepreciation: newAccum,
          currentValue: newCurrent,
          lastDepreciationDate: new Date().toISOString().split('T')[0],
        };
      });

      if (totalDep <= 0) return { ...state, fixedAssets: updatedAssets };

      const depTx = {
        id: `tx_dep_${Date.now()}`,
        timestamp: Date.now(),
        type: 'expense',
        category: 'depreciation',
        amount: totalDep,
        note: 'Monthly Straight-Line Depreciation (IAS 16)',
      };
      const depJE = {
        id: `je_dep_${Date.now()}`,
        timestamp: Date.now(),
        txId: depTx.id,
        txType: 'depreciation_expense',
        description: 'Auto Depreciation (IAS 16)',
        lines: [
          { accountId: 'operating_expenses', debit: totalDep, credit: 0 },
          { accountId: 'fixed_assets', debit: 0, credit: totalDep },
        ],
      };

      return {
        ...state,
        fixedAssets: updatedAssets,
        dayData: state.dayData ? {
          ...state.dayData,
          transactions: [depTx, ...(state.dayData.transactions || [])],
          journalEntries: [...(state.dayData.journalEntries || []), depJE],
        } : state.dayData,
      };
    }

    case 'DELETE_FIXED_ASSET': {
      const assetId = action.payload;
      return {
        ...state,
        fixedAssets: (state.fixedAssets || []).filter(a => a.id !== assetId),
      };
    }

    // â”€â”€ EMPLOYEES & PAYROLL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'ADD_EMPLOYEE': {
      const newEmp = {
        id: `emp_${Date.now()}`,
        name: action.payload.name,
        role: action.payload.role || 'Staff',
        phone: action.payload.phone || '',
        baseSalary: Number(action.payload.baseSalary) || 0,
        joinDate: action.payload.joinDate || new Date().toISOString().split('T')[0],
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        employees: [...(state.employees || []), newEmp],
      };
    }

    case 'UPDATE_EMPLOYEE': {
      const updated = action.payload;
      return {
        ...state,
        employees: (state.employees || []).map(e => e.id === updated.id ? { ...e, ...updated } : e),
      };
    }

    case 'DELETE_EMPLOYEE': {
      return {
        ...state,
        employees: (state.employees || []).filter(e => e.id !== action.payload),
      };
    }

    case 'RECORD_SALARY_PAYMENT': {
      const { employeeName, month, netPaid, wallet = 'hand_cash' } = action.payload;
      const salaryTx = {
        id: `tx_sal_${Date.now()}`,
        timestamp: Date.now(),
        type: 'expense',
        category: 'salary',
        amount: netPaid,
        wallet,
        note: `Salary Payment (${month}): ${employeeName}`,
      };
      const salaryJE = {
        id: `je_sal_${Date.now()}`,
        timestamp: Date.now(),
        txId: salaryTx.id,
        txType: 'salary_expense',
        description: `Salary: ${employeeName} (${month})`,
        lines: [
          { accountId: 'operating_expenses', debit: netPaid, credit: 0 },
          { accountId: wallet === 'hand_cash' ? 'cash_in_hand' : wallet, debit: 0, credit: netPaid },
        ],
      };

      const walletObj = state.dayData?.wallets?.[wallet] || { opening: 0, current: 0 };
      const updatedWallet = {
        ...walletObj,
        current: Math.max(0, (walletObj.current ?? walletObj.opening ?? 0) - netPaid),
      };

      return {
        ...state,
        dayData: state.dayData ? {
          ...state.dayData,
          wallets: {
            ...state.dayData.wallets,
            [wallet]: updatedWallet,
          },
          transactions: [salaryTx, ...(state.dayData.transactions || [])],
          journalEntries: [...(state.dayData.journalEntries || []), salaryJE],
        } : state.dayData,
      };
    }

    // â”€â”€ CURRENCY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'SET_CURRENCY': {
      return {
        ...state,
        currency: action.payload,
      };
    }

    // â”€â”€ BANK RECONCILIATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'RECONCILE_TRANSACTIONS': {
      const { txIds, isReconciled = true } = action.payload;
      const updatedReconciled = isReconciled
        ? Array.from(new Set([...(state.reconciledTxIds || []), ...txIds]))
        : (state.reconciledTxIds || []).filter(id => !txIds.includes(id));

      const updatedTxs = (state.dayData?.transactions || []).map(tx => {
        if (txIds.includes(tx.id)) {
          return { ...tx, reconciled: isReconciled, reconciledAt: new Date().toISOString() };
        }
        return tx;
      });

      return {
        ...state,
        reconciledTxIds: updatedReconciled,
        dayData: state.dayData ? {
          ...state.dayData,
          transactions: updatedTxs,
        } : state.dayData,
      };
    }

    // â”€â”€ PHYSICAL STOCK AUDIT (IAS 2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'APPLY_STOCK_AUDIT': {
      const nextState = applyStockAuditInState(state, action.payload);
      if (nextState.dayData?.inventory && Array.isArray(nextState.dayData.inventory)) {
        try {
          saveCatalog(nextState.dayData.inventory, state.activeBizId);
        } catch (e) {
          console.warn('Catalog save warning:', e);
        }
      }
      return nextState;
    }

    // â”€â”€ BULK DELETE TRANSACTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'BULK_DELETE_TRANSACTIONS': {
      // Period Lock Audit Protection
      if (state.lockedPeriodEndDate && state.dayData?.dateKey && state.dayData.dateKey <= state.lockedPeriodEndDate) {
        alert(state.language === 'en' 
          ? `Selected transactions contain records within a locked fiscal period (locked through ${state.lockedPeriodEndDate}). Deletion is prohibited.` 
          : `à¦¨à¦¿à¦°à§à¦¬à¦¾à¦šà¦¿à¦¤ à¦²à§‡à¦¨à¦¦à§‡à¦¨à§‡à¦° à¦®à¦§à§à¦¯à§‡ à¦…à¦¡à¦¿à¦Ÿ à¦²à¦• à¦•à¦°à¦¾ à¦…à¦°à§à¦¥à¦¬à¦›à¦°à§‡à¦° (${state.lockedPeriodEndDate} à¦ªà¦°à§à¦¯à¦¨à§à¦¤) à¦¹à¦¿à¦¸à¦¾à¦¬ à¦°à§Ÿà§‡à¦›à§‡à¥¤ à¦¡à¦¿à¦²à¦¿à¦Ÿ à¦•à¦°à¦¾ à¦¨à¦¿à¦·à¦¿à¦¦à§à¦§à¥¤`);
        return state;
      }

      return bulkDeleteTransactionsInState(state, action.payload);
    }

    // â”€â”€ MANUAL JOURNAL ENTRY VOUCHER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'POST_MANUAL_JOURNAL': {
      const journalEntry = action.payload;
      if (!journalEntry || !state.dayData) return state;

      return {
        ...state,
        dayData: {
          ...state.dayData,
          journalEntries: [...(state.dayData.journalEntries || []), journalEntry]
        }
      };
    }

    // â”€â”€ FISCAL YEAR CLOSING & PERIOD LOCK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'CLOSE_FISCAL_YEAR': {
      const { fyStart, fyEnd, netProfit, lockDate } = action.payload;
      const closingJE = {
        id: `close_fy_${Date.now()}`,
        timestamp: Date.now(),
        date: fyEnd,
        txType: 'fiscal_year_closing',
        description: `Fiscal Year Closing (${fyStart} to ${fyEnd}) â€” Transferred to Retained Earnings`,
        lines: [
          { 
            accountId: 'retained_earnings', 
            debit: netProfit < 0 ? Math.abs(netProfit) : 0, 
            credit: netProfit > 0 ? netProfit : 0, 
            note: 'Year-End Profit/Loss Transfer' 
          }
        ],
        isFiscalClose: true,
      };

      return {
        ...state,
        lockedPeriodEndDate: lockDate || fyEnd,
        dayData: state.dayData ? {
          ...state.dayData,
          journalEntries: [...(state.dayData.journalEntries || []), closingJE]
        } : state.dayData
      };
    }

    case 'LOCK_PERIOD': {
      return {
        ...state,
        lockedPeriodEndDate: action.payload.lockDate
      };
    }

    case 'UNLOCK_PERIOD': {
      return {
        ...state,
        lockedPeriodEndDate: null
      };
    }

    case 'FINALIZE_DAY': {
      const finalized = finalizeDay({
        ...state.dayData,
        ...action.payload,
        status: DAY_STATUS.FINALIZED,
        finalizedAt: new Date().toISOString()
      }, state.activeBizId);
      if (finalized?.inventory && Array.isArray(finalized.inventory)) {
        saveCatalog(finalized.inventory, state.activeBizId);
      }
      return { ...state, dayData: finalized };
    }

    case 'SET_WALLET_OPENING': {
      const currentWallet = state.dayData.wallets[action.payload.walletKey] || { opening: 0, current: 0 };
      const diff = action.payload.amount - currentWallet.opening;
      return {
        ...state,
        dayData: {
          ...state.dayData,
          wallets: {
            ...state.dayData.wallets,
            [action.payload.walletKey]: {
              ...currentWallet,
              opening: action.payload.amount,
              current: Math.max(0, currentWallet.current + diff)
            }
          }
        }
      };
    }

    case 'ADD_WALLET': {
      const { walletKey, label, category, opening, current } = action.payload;
      if (!walletKey) return state;
      const initialBal = Number(opening) || 0;
      const currentBal = current !== undefined ? Number(current) : initialBal;
      const currentWallets = state.dayData?.wallets || {};
      if (currentWallets[walletKey]) return state; // already exists
      const updatedOrder = state.dayData?.walletOrder 
        ? [...state.dayData.walletOrder, walletKey]
        : [...Object.keys(currentWallets), walletKey];

      return {
        ...state,
        dayData: {
          ...state.dayData,
          wallets: {
            ...currentWallets,
            [walletKey]: {
              opening: initialBal,
              current: currentBal,
              category: category || 'other',
              label: label || walletKey
            }
          },
          walletOrder: updatedOrder
        }
      };
    }

    case 'UPDATE_WALLET_CATEGORY': {
      const { walletKey: wKey, category: newCat } = action.payload;
      const wallet = state.dayData.wallets[wKey];
      if (!wallet) return state;
      return {
        ...state,
        dayData: {
          ...state.dayData,
          wallets: {
            ...state.dayData.wallets,
            [wKey]: { ...wallet, category: newCat }
          }
        }
      };
    }

    case 'UPDATE_WALLET_INFO': {
      const { walletKey: wKey, label: newLabel, category: newCat } = action.payload;
      const wallet = state.dayData?.wallets?.[wKey];
      if (!wallet) return state;
      return {
        ...state,
        dayData: {
          ...state.dayData,
          wallets: {
            ...state.dayData.wallets,
            [wKey]: {
              ...wallet,
              ...(newLabel && { label: newLabel.trim() }),
              ...(newCat && { category: newCat })
            }
          }
        }
      };
    }

    case 'RECORD_OPENING_ADJUSTMENT': {
      const { walletKey = 'hand_cash', amount, type = 'expense', note, isPreOpeningPurchase = false, itemId, itemName, quantity } = action.payload;
      const numAmount = roundBDT(parseFloat(amount) || 0);
      if (numAmount <= 0 || !state.dayData) return state;

      const isOutflow = type === 'expense' || type === 'stock_purchase';
      const adjTx = {
        id: `adj_${Date.now()}`,
        timestamp: Date.now(),
        type: isPreOpeningPurchase ? 'stock_purchase' : type,
        amount: numAmount,
        fromWallet: isOutflow ? walletKey : undefined,
        toWallet: !isOutflow ? walletKey : undefined,
        category: isPreOpeningPurchase ? 'stock_purchase' : (isOutflow ? 'opening_expense' : 'opening_addition'),
        note: note ? `${note} (à¦¦à§‹à¦•à¦¾à¦¨ à¦–à§‹à¦²à¦¾à¦° à¦ªà§‚à¦°à§à¦¬à§‡)` : (isOutflow ? 'à¦¦à§‹à¦•à¦¾à¦¨ à¦–à§‹à¦²à¦¾à¦° à¦ªà§‚à¦°à§à¦¬à§‡à¦° à¦–à¦°à¦š (à¦¸à¦•à¦¾à¦²à§‡à¦° à¦¸à¦®à¦¨à§à¦¬à§Ÿ)' : 'à¦ªà§à¦°à¦¾à¦°à¦®à§à¦­à¦¿à¦• à¦•à§à¦¯à¦¾à¦¶ à¦¯à§‹à¦— (à¦¸à¦•à¦¾à¦²à§‡à¦° à¦¸à¦®à¦¨à§à¦¬à§Ÿ)'),
        isPreOpening: true,
        ...(itemId && { itemId, itemName, quantity })
      };

      const newWallets = { ...state.dayData.wallets };
      if (newWallets[walletKey]) {
        const cur = newWallets[walletKey].current ?? newWallets[walletKey].opening ?? 0;
        const op = newWallets[walletKey].opening ?? 0;
        newWallets[walletKey] = {
          ...newWallets[walletKey],
          opening: isOutflow ? roundBDT(Math.max(0, op - numAmount)) : roundBDT(op + numAmount),
          current: isOutflow ? roundBDT(Math.max(0, cur - numAmount)) : roundBDT(cur + numAmount)
        };
      }

      // Also generate double-entry journal if applicable
      const existingJournals = state.dayData.journalEntries || [];
      const je = generateJournalEntry(adjTx, { fromWallet: adjTx.fromWallet, toWallet: adjTx.toWallet });

      return {
        ...state,
        dayData: {
          ...state.dayData,
          wallets: newWallets,
          transactions: [adjTx, ...(state.dayData.transactions || [])],
          journalEntries: je ? [je, ...existingJournals] : existingJournals
        }
      };
    }

    case 'REMOVE_WALLET': {
      const keyToRemove = action.payload;
      if (keyToRemove === 'hand_cash') return state; // can't delete hand cash
      const currentWallets = { ...(state.dayData?.wallets || {}) };
      delete currentWallets[keyToRemove];
      const updatedOrder = (state.dayData?.walletOrder || []).filter(k => k !== keyToRemove);
      return {
        ...state,
        dayData: {
          ...state.dayData,
          wallets: currentWallets,
          walletOrder: updatedOrder.length > 0 ? updatedOrder : undefined
        }
      };
    }

    case 'REORDER_WALLETS': {
      return {
        ...state,
        dayData: {
          ...state.dayData,
          walletOrder: action.payload
        }
      };
    }

    case 'REOPEN_DAY':
      return {
        ...state,
        dayData: {
          ...state.dayData,
          status: DAY_STATUS.OPEN,
          finalizedAt: null
        },
        currentScreen: SCREENS.DASHBOARD
      };

    case 'SWITCH_DATE': {
      // Day data will be loaded by the effect in Provider
      return {
        ...state,
        dayData: null,
        isLoading: true,
        _switchDateKey: action.payload,
      };
    }

    case 'START_NEXT_DAY': {
      const nextKey = getNextDayKey(state.dayData.dateKey);
      if (state.dayData?.inventory && Array.isArray(state.dayData.inventory)) {
        saveCatalog(state.dayData.inventory, state.activeBizId);
      }
      // Directly create next day from current finalized dayData (carry-forward).
      // This avoids race condition where async cloud load misses the finalized data
      // because the debounced cloud save was cancelled by dayData becoming null.
      const nextDayData = createNewDayData(
        nextKey,
        state.dayData, // Use current finalized day as previousDay
        state.activeBiz?.type,
        state.activeBiz?.name,
        state.activeBizId
      );
      // Also persist the new day to localStorage immediately
      saveDay(nextDayData, state.activeBizId);
      return {
        ...state,
        dayData: nextDayData,
        isLoading: false,
        _switchDateKey: null,
        currentScreen: SCREENS.OPENING,
      };
    }

    // â”€â”€ Tea House Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'TEAHOUSE_ADD_PRODUCT': {
      const { name, unit, price } = action.payload;
      const newProduct = { id: `th_${Date.now()}`, name, unit, price: Number(price) || 0 };
      return { ...state, teaHouseProducts: [...state.teaHouseProducts, newProduct] };
    }
    case 'TEAHOUSE_EDIT_PRODUCT': {
      const { id, ...updates } = action.payload;
      if (updates.price !== undefined) updates.price = Number(updates.price) || 0;
      return {
        ...state,
        teaHouseProducts: state.teaHouseProducts.map(p => p.id === id ? { ...p, ...updates } : p)
      };
    }
    case 'TEAHOUSE_DELETE_PRODUCT': {
      return {
        ...state,
        teaHouseProducts: state.teaHouseProducts.filter(p => p.id !== action.payload)
      };
    }
    case 'TEAHOUSE_ADD_ENTRY': {
      const { itemId, itemName, price, qty, type } = action.payload; // type: 'personal' | 'shop'
      const total = (Number(price) || 0) * (Number(qty) || 1);
      const entry = {
        id: `the_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        itemId, itemName,
        price: Number(price) || 0,
        qty: Number(qty) || 1,
        total,
        type,
        timestamp: Date.now(),
      };
      const updatedEntries = [...(state.dayData?.teaHouseEntries || []), entry];
      const dayPersonal = (state.dayData?.teaHouseDayPersonal || 0) + (type === 'personal' ? total : 0);
      const dayShop = (state.dayData?.teaHouseDayShop || 0) + (type === 'shop' ? total : 0);
      // Also accumulate monthly
      const currentMonth = state.dayData?.dateKey?.slice(0, 7) || null;
      let monthlyTab = state.teaHouseMonthlyTab || 0;
      let monthlyPersonal = state.teaHouseMonthlyPersonal || 0;
      let monthlyShop = state.teaHouseMonthlyShop || 0;
      let tabMonth = state.teaHouseTabMonth;
      // If month changed, reset monthly tracking
      if (tabMonth && tabMonth !== currentMonth) {
        monthlyTab = 0;
        monthlyPersonal = 0;
        monthlyShop = 0;
      }
      tabMonth = currentMonth;
      monthlyTab += total;
      if (type === 'personal') monthlyPersonal += total;
      if (type === 'shop') monthlyShop += total;

      return {
        ...state,
        dayData: { ...state.dayData, teaHouseEntries: updatedEntries, teaHouseDayPersonal: dayPersonal, teaHouseDayShop: dayShop },
        teaHouseMonthlyTab: monthlyTab,
        teaHouseMonthlyPersonal: monthlyPersonal,
        teaHouseMonthlyShop: monthlyShop,
        teaHouseTabMonth: tabMonth,
      };
    }
    case 'TEAHOUSE_DELETE_ENTRY': {
      const entryId = action.payload;
      const entryToRemove = (state.dayData?.teaHouseEntries || []).find(e => e.id === entryId);
      if (!entryToRemove) return state;
      const filteredEntries = state.dayData.teaHouseEntries.filter(e => e.id !== entryId);
      const newDayPersonal = (state.dayData?.teaHouseDayPersonal || 0) - (entryToRemove.type === 'personal' ? entryToRemove.total : 0);
      const newDayShop = (state.dayData?.teaHouseDayShop || 0) - (entryToRemove.type === 'shop' ? entryToRemove.total : 0);
      return {
        ...state,
        dayData: { ...state.dayData, teaHouseEntries: filteredEntries, teaHouseDayPersonal: Math.max(0, newDayPersonal), teaHouseDayShop: Math.max(0, newDayShop) },
        teaHouseMonthlyTab: Math.max(0, (state.teaHouseMonthlyTab || 0) - entryToRemove.total),
        teaHouseMonthlyPersonal: Math.max(0, (state.teaHouseMonthlyPersonal || 0) - (entryToRemove.type === 'personal' ? entryToRemove.total : 0)),
        teaHouseMonthlyShop: Math.max(0, (state.teaHouseMonthlyShop || 0) - (entryToRemove.type === 'shop' ? entryToRemove.total : 0)),
      };
    }
    case 'TEAHOUSE_SETTLE': {
      // à¦¹à¦¿à¦¸à¦¾à¦¬ à¦®à¦¿à¦²à¦¾à¦“: Deduct monthly tab from Hand Cash, record as transaction, reset tab
      const settleAmount = state.teaHouseMonthlyTab || 0;
      if (settleAmount <= 0) return state;
      const settleTx = {
        id: `th_settle_${Date.now()}`,
        timestamp: Date.now(),
        type: 'expense',
        subType: 'teahouse_settle',
        amount: settleAmount,
        note: state.language === 'en' ? `â˜• Tea House tab settled (Personal: Tk ${state.teaHouseMonthlyPersonal || 0}, Shop: Tk ${state.teaHouseMonthlyShop || 0})` : `â˜• à¦Ÿà¦¿-à¦¹à¦¾à¦‰à¦¸ à¦¬à¦¾à¦•à¦¿ à¦ªà¦°à¦¿à¦¶à§‹à¦§ (à¦¨à¦¿à¦œà§‡à¦°: à§³${state.teaHouseMonthlyPersonal || 0}, à¦¦à§‹à¦•à¦¾à¦¨: à§³${state.teaHouseMonthlyShop || 0})`,
        wallet: 'hand_cash',
      };
      const updatedTxs = [...(state.dayData?.transactions || []), settleTx];
      // Deduct from hand_cash
      const updatedWallets = { ...state.dayData?.wallets };
      if (updatedWallets.hand_cash) {
        updatedWallets.hand_cash = {
          ...updatedWallets.hand_cash,
          current: (updatedWallets.hand_cash.current || 0) - settleAmount,
        };
      }
      return {
        ...state,
        dayData: { ...state.dayData, transactions: updatedTxs, wallets: updatedWallets },
        teaHouseMonthlyTab: 0,
        teaHouseMonthlyPersonal: 0,
        teaHouseMonthlyShop: 0,
      };
    }

﻿    // ══════════════════════════════════════════════════════════════════
    // ── ONLINE ORDERS & COURIER TRACKING (Path B) ────────────────────
    // ══════════════════════════════════════════════════════════════════

    case 'SET_ONLINE_ORDERS': {
      return {
        ...state,
        onlineOrders: Array.isArray(action.payload) ? action.payload : []
      };
    }

    case 'INGEST_STORE_ORDERS': {
      const incoming = Array.isArray(action.payload) ? action.payload : [];
      if (incoming.length === 0) return state;
      const catalog = state.dayData?.inventory || [];
      const annotatedIncoming = incoming.map(inc => {
        if (inc.verificationStatus && inc.priceVerified !== undefined) {
          return {
            ...inc,
            status: inc.status || 'draft',
            source: inc.source || 'web_storefront',
            isFromWebStore: true,
            createdAt: inc.createdAtMs || (inc.createdAt ? new Date(inc.createdAt).getTime() : Date.now()),
          };
        }
        const check = catalog.length > 0
          ? verifyOrderAgainstCatalog(inc, catalog, { requireCatalogMatch: true, checkStockLevel: false })
          : { valid: false, verificationStatus: 'unverified_no_catalog', issues: [], authoritativeSubtotal: inc.subtotal || 0, authoritativeTotal: inc.totalAmount || 0 };
        return {
          ...inc,
          status: inc.status || 'draft',
          source: inc.source || 'web_storefront',
          isFromWebStore: true,
          priceVerified: Boolean(catalog.length > 0 && check.valid),
          verificationStatus: check.verificationStatus,
          verificationIssues: check.issues || [],
          authoritativeSubtotal: check.authoritativeSubtotal,
          authoritativeTotal: check.authoritativeTotal,
          createdAt: inc.createdAtMs || (inc.createdAt ? new Date(inc.createdAt).getTime() : Date.now()),
        };
      });
      const { merged, addedCount } = mergeIncomingOrdersIdempotently(state.onlineOrders || [], annotatedIncoming);
      if (addedCount === 0) return state;
      return {
        ...state,
        onlineOrders: merged,
      };
    }

    case 'SET_COURIER_SETTINGS': {
      return {
        ...state,
        courierSettings: { ...(state.courierSettings || {}), ...action.payload }
      };
    }

    case 'ONLINE_ORDER_CREATE': {
      const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const hasAdvance = (action.payload.advancePaid > 0) && !!action.payload.advanceWallet;
      const initialStatus = action.payload.status || (hasAdvance ? 'confirmed' : 'draft');

      const newOrder = {
        ...action.payload,
        id: orderId,
        status: initialStatus,
        statusHistory: [
          { status: 'draft', timestamp: Date.now(), note: '' },
          ...(hasAdvance ? [{ status: 'confirmed', timestamp: Date.now(), note: `Advance ৳${action.payload.advancePaid} received via ${action.payload.advanceWallet}` }] : [])
        ],
        createdAt: Date.now(),
        confirmedAt: hasAdvance ? Date.now() : null,
        shippedAt: null,
        deliveredAt: null,
        settledAt: null,
        returnedAt: null,
      };

      // Record advance payment in wallet if provided
      let updatedWallets = state.dayData?.wallets ? { ...state.dayData.wallets } : {};
      let advanceTx = null;
      if (hasAdvance && updatedWallets[action.payload.advanceWallet]) {
        updatedWallets[action.payload.advanceWallet] = {
          ...updatedWallets[action.payload.advanceWallet],
          current: (updatedWallets[action.payload.advanceWallet].current || 0) + action.payload.advancePaid,
        };
        advanceTx = {
          id: `oo_adv_${Date.now()}`,
          timestamp: Date.now(),
          type: 'service_income',
          subType: 'online_order_advance',
          amount: action.payload.advancePaid,
          wallet: action.payload.advanceWallet,
          note: state.language === 'en' ? `📦 Online order advance (Order #${orderId.slice(-6)})` : `📦 অনলাইন অর্ডার অগ্রিম (অর্ডার #${orderId.slice(-6)})`,
          linkedOrderId: orderId,
          isAutoGenerated: true,
        };
        advanceJE = {
          id: `je_adv_${advanceTx.id}`,
          timestamp: advanceTx.timestamp,
          txId: advanceTx.id,
          txType: 'online_order_advance',
          description: `Online Order Advance: #${orderId.slice(-6)}`,
          lines: [
            { accountId: mapWalletToAccount(advanceTx.wallet), debit: advanceTx.amount, credit: 0 },
            { accountId: 'customer_advance', debit: 0, credit: advanceTx.amount },
          ],
        };
      }

      const stats = { ...(state.dayData?.onlineOrdersDayStats || {}) };
      stats.created = (stats.created || 0) + 1;
      return {
        ...state,
        onlineOrders: [...(state.onlineOrders || []), newOrder],
        dayData: state.dayData ? {
          ...state.dayData,
          wallets: hasAdvance && advanceTx ? updatedWallets : state.dayData.wallets,
          transactions: advanceTx ? [...(state.dayData.transactions || []), advanceTx] : (state.dayData.transactions || []),
          journalEntries: advanceJE ? [...(state.dayData.journalEntries || []), advanceJE] : (state.dayData.journalEntries || []),
          onlineOrdersDayStats: stats,
        } : state.dayData,
      };
    }

    case 'ONLINE_ORDER_CONFIRM':
      return confirmOnlineOrderInState(state, action.payload);

    case 'ONLINE_ORDER_VERIFY_PAYMENT':
      return verifyOnlineOrderPaymentInState(state, action.payload);

    case 'ONLINE_ORDER_REJECT_PAYMENT':
      return rejectOnlineOrderPaymentInState(state, action.payload);

    case 'ONLINE_ORDER_PACK':
      return packOnlineOrderInState(state, action.payload);

    case 'ONLINE_ORDER_SHIP':
      return shipOnlineOrderInState(state, action.payload);

    case 'ONLINE_ORDER_DELIVER':
      return deliverOnlineOrderInState(state, action.payload);

    case 'VERIFY_AND_REPRICE_ONLINE_ORDER':
      return verifyAndRepriceOnlineOrderInState(state, action.payload);

    case 'ONLINE_ORDER_SETTLE':
      return settleOnlineOrderInState(state, action.payload);

    case 'ONLINE_ORDER_RETURN':
      return returnOnlineOrderInState(state, action.payload);

    case 'ONLINE_ORDER_CANCEL':
      return cancelOnlineOrderInState(state, action.payload);

    case 'ONLINE_ORDER_DELETE': {
      // Can only delete drafts
      return {
        ...state,
        onlineOrders: (state.onlineOrders || []).filter(o => o.id !== action.payload),
      };
    }

    case 'ONLINE_ORDER_UPDATE': {
      // Generic update for editing draft orders
      const { orderId: updateId, ...updateData } = action.payload;
      return {
        ...state,
        onlineOrders: (state.onlineOrders || []).map(o =>
          o.id === updateId ? { ...o, ...updateData } : o
        ),
      };
    }

    case 'BLACKLIST_CUSTOMER': {
      const rawPhone = typeof action.payload === 'string' ? action.payload : (action.payload?.phone || '');
      const phone = normalizePhoneNumber(rawPhone);
      if (!phone) return state;
      const current = { ...(state.customerBlacklist || {}) };
      current[phone] = {
        rtoCount: Number(action.payload?.rtoCount) >= 0 ? Number(action.payload.rtoCount) : (current[phone]?.rtoCount || 1),
        isManuallyBlacklisted: true,
        reason: (typeof action.payload === 'object' && action.payload?.reason) ? action.payload.reason : (state.language === 'en' ? 'Manually blacklisted' : 'ম্যানুয়ালি ব্ল্যাকলিস্টেড'),
        updatedAt: new Date().toISOString(),
        lastRtoDate: current[phone]?.lastRtoDate || new Date().toISOString(),
      };
      return {
        ...state,
        customerBlacklist: current,
      };
    }

    case 'UNBLACKLIST_CUSTOMER': {
      const rawPhone = typeof action.payload === 'string' ? action.payload : (action.payload?.phone || '');
      const phone = normalizePhoneNumber(rawPhone);
      if (!phone) return state;
      const current = { ...(state.customerBlacklist || {}) };
      delete current[phone];
      return {
        ...state,
        customerBlacklist: current,
      };
    }

    case 'SET_SHEETS_EXPORTED': {
      return {
        ...state,
        dayData: state.dayData ? { ...state.dayData, sheetsExported: action.payload } : state.dayData
      };
    }

    case 'CLEAR_AUDIT_LOG_ENTRIES': {
      const nextState = { ...state };
      delete nextState._auditEntry;
      delete nextState._auditEntries;
      return nextState;
    }

    case 'CLEAR_BULK_REVERSAL_REPORT': {
      const nextState = { ...state };
      delete nextState._bulkReversalReport;
      if (nextState.dayData && nextState.dayData._bulkReversalReport) {
        nextState.dayData = { ...nextState.dayData };
        delete nextState.dayData._bulkReversalReport;
      }
      return nextState;
    }

    case 'CLEAR_ORDER_SETTLE_ERROR': {
      const nextState = { ...state };
      delete nextState._orderSettleError;
      return nextState;
    }

    default:
      return state;
  }
}

// â”€â”€ Provider Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { user, isAuthenticated } = useAuth();
  const [cloudInitialized, setCloudInitialized] = useState(false);

  const userId = user?.uid;
  const previousUserIdRef = useRef(userId);
  const loadGenerationRef = useRef(0);
  const lastCloudSavedAtRef = useRef(Date.now());
  const lastCloudRevisionRef = useRef(createRevisionTracker());
  const lastSavedContactsJsonRef = useRef(null);
  const lastSavedOrdersJsonRef = useRef(null);
  const lastSavedSettingsJsonRef = useRef(null);
  const lastSavedBusinessesJsonRef = useRef(null);
  const lastSavedDayJsonRef = useRef(null);

  // ── Initial cloud data load (on login) ────────────────────────
  const loadCloudData = useCallback(async (targetBizIdOverride = null) => {
    if (!isAuthenticated || !userId) {
      setCloudInitialized(false);
      return;
    }

    loadGenerationRef.current += 1;
    const currentGen = loadGenerationRef.current;
    const targetUid = userId;

    try {
      setCloudInitialized(false);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'saving' });
      // Save user profile (non-blocking — don't let this crash init)
      saveProfile(userId, {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL
      }).catch(err => console.warn('Profile save skipped:', err.message));

      // Load settings
      const settings = await loadSettingsFromCloud(userId);
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }
      
      // Load businesses
      let businesses = await loadBusinessesFromCloud(userId);
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }
      if (!businesses || businesses.length === 0) {
        businesses = DEFAULT_BUSINESSES;
        await saveBusinessesToCloud(userId, businesses);
        if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
          console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
          return;
        }
      }
      
      const activeBizId = (targetBizIdOverride && businesses.some(b => b.id === targetBizIdOverride))
        ? targetBizIdOverride
        : businesses[0].id;
      const activeBiz = businesses.find(b => b.id === activeBizId) || businesses[0];
      
      // Load contacts for active business
      const contacts = await loadContactsFromCloud(userId, activeBizId);
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }

      // Load online orders for active business
      const onlineOrders = await loadOnlineOrdersFromCloud(userId, activeBizId);
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }

      // Load today's day data
      const today = getTodayKey();
      let dayData = await loadDayFromCloud(userId, activeBizId, today);
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }
      
      if (!dayData) {
        // No data for today — try carry-forward
        const previousDay = await findMostRecentDayFromCloud(userId, activeBizId, today);
        if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
          console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
          return;
        }
        dayData = createNewDayData(today, previousDay, activeBiz.type, activeBiz.name, activeBizId, userId);
      } else {
        // Ensure wallets/loans/inventory exist
        const isTelecom = isTelecomBiz(activeBiz.type, activeBiz.name);
        if (!dayData.wallets || Object.keys(dayData.wallets).length === 0) {
          dayData.wallets = isTelecom ? createDefaultWallets() : createGeneralWallets();
        }
        if (!dayData.wallets.hand_cash) {
          dayData.wallets.hand_cash = { opening: 0, current: 0, category: 'cash' };
        }
        if (!dayData.loans) dayData.loans = { openingGiven: 0, openingTaken: 0 };
        if (!dayData.inventory) dayData.inventory = [];
      }
      
      // Apply dark mode
      const isDark = settings.isDarkMode || false;
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }

      dispatch({
        type: 'CLOUD_INIT',
        payload: {
          userId,
          businesses,
          activeBizId,
          activeBiz,
          contacts,
          onlineOrders,
          dayData,
          language: settings.language || 'bn',
          isDarkMode: isDark,
          isPrivacyMode: settings.isPrivacyMode || false,
          autoCloseTime: settings.autoCloseTime || '01:00',
          autoOpenTime: settings.autoOpenTime || '08:00',
          autoCloseEnabled: settings.autoCloseEnabled || false,
          editLockEnabled: settings.editLockEnabled || false,
          editLockPinHash: settings.editLockPinHash || null,
          userRole: settings.userRole || 'owner',
          staffPinHash: settings.staffPinHash || null,
          appMode: settings.appMode || 'easy',
          featureFlags: settings.featureFlags || { ...ADVANCED_FEATURES },
          taxRegion: settings.taxRegion || 'BD',
          sheetsWebAppUrl: settings.sheetsWebAppUrl || '',
          ...(Array.isArray(settings.teaHouseProducts) && settings.teaHouseProducts.length > 0 && { teaHouseProducts: settings.teaHouseProducts }),
          ...(settings.teaHouseMonthlyTab !== undefined && { teaHouseMonthlyTab: settings.teaHouseMonthlyTab }),
          ...(settings.teaHouseMonthlyPersonal !== undefined && { teaHouseMonthlyPersonal: settings.teaHouseMonthlyPersonal }),
          ...(settings.teaHouseMonthlyShop !== undefined && { teaHouseMonthlyShop: settings.teaHouseMonthlyShop }),
          ...(settings.teaHouseTabMonth !== undefined && { teaHouseTabMonth: settings.teaHouseTabMonth }),
          ...(settings.courierSettings && { courierSettings: settings.courierSettings }),
          ...(settings.customerBlacklist && { customerBlacklist: settings.customerBlacklist }),
          currentScreen: dayData.status === DAY_STATUS.NOT_STARTED ? SCREENS.OPENING : SCREENS.DASHBOARD
        }
      });
      applyModeTheme(settings.appMode || 'easy');
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }
      lastCloudRevisionRef.current.recordLoaded(activeBizId, dayData?.dateKey || today, dayData);
      if (dayData?._lastCloudSavedAt) {
        lastCloudSavedAtRef.current = Number(dayData._lastCloudSavedAt);
      }
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) {
        console.warn('[Ledgero] Stale cloud fetch aborted at await boundary');
        return;
      }
      lastSavedContactsJsonRef.current = JSON.stringify(contacts || []);
      lastSavedOrdersJsonRef.current = JSON.stringify(onlineOrders || []);
      lastSavedBusinessesJsonRef.current = JSON.stringify(businesses || []);
      lastSavedDayJsonRef.current = JSON.stringify(dayData || null);
      lastSavedSettingsJsonRef.current = JSON.stringify({
        language: settings?.language || 'bn',
        isDarkMode: isDark,
        isPrivacyMode: settings?.isPrivacyMode || false,
        autoCloseTime: settings?.autoCloseTime || '01:00',
        autoOpenTime: settings?.autoOpenTime || '08:00',
        autoCloseEnabled: settings?.autoCloseEnabled || false,
        editLockEnabled: settings?.editLockEnabled || false,
        editLockPinHash: settings?.editLockPinHash || null,
        userRole: settings?.userRole || 'owner',
        staffPinHash: settings?.staffPinHash || null,
        appMode: settings?.appMode || 'easy',
        featureFlags: settings?.featureFlags || { ...ADVANCED_FEATURES },
        taxRegion: settings?.taxRegion || 'BD',
        sheetsWebAppUrl: settings?.sheetsWebAppUrl || '',
        teaHouseProducts: settings?.teaHouseProducts || [...DEFAULT_TEA_HOUSE_PRODUCTS],
        teaHouseMonthlyTab: settings?.teaHouseMonthlyTab || 0,
        teaHouseMonthlyPersonal: settings?.teaHouseMonthlyPersonal || 0,
        teaHouseMonthlyShop: settings?.teaHouseMonthlyShop || 0,
        teaHouseTabMonth: settings?.teaHouseTabMonth || null,
        courierSettings: settings?.courierSettings || DEFAULT_COURIER_SETTINGS,
        customerBlacklist: settings?.customerBlacklist || {},
      });
      setCloudInitialized(true);
    } catch (err) {
      if (loadGenerationRef.current !== currentGen || previousUserIdRef.current !== targetUid) return;
      console.error('Cloud init error:', err);
      // Fallback to local data with strict safety:
      // DO NOT call setCloudInitialized(true) here!
      // This prevents User A's local data from ever being written into User B's Firestore!
      setCloudInitialized(false);
      const localDay = loadDay(getTodayKey(), 'biz_1', DEFAULT_BUSINESSES[0].type, DEFAULT_BUSINESSES[0].name, userId);
      const localContacts = loadContacts('biz_1', userId) || [];
      lastCloudRevisionRef.current.recordLoaded('biz_1', localDay?.dateKey || getTodayKey(), localDay);
      dispatch({
        type: 'CLOUD_INIT_ERROR',
        payload: {
          userId,
          error: err.message || 'Failed to initialize cloud data',
          businesses: DEFAULT_BUSINESSES,
          activeBizId: 'biz_1',
          activeBiz: DEFAULT_BUSINESSES[0],
          contacts: localContacts,
          dayData: localDay,
          currentScreen: localDay?.status === DAY_STATUS.NOT_STARTED ? SCREENS.OPENING : SCREENS.DASHBOARD
        }
      });
    }
  }, [isAuthenticated, userId, user]);

  useEffect(() => {
    let cancelled = false;

    if (userId !== previousUserIdRef.current) {
      previousUserIdRef.current = userId;
      setCloudInitialized(false);
      lastSavedContactsJsonRef.current = null;
      lastSavedOrdersJsonRef.current = null;
      lastSavedSettingsJsonRef.current = null;
      lastSavedBusinessesJsonRef.current = null;
      lastSavedDayJsonRef.current = null;
      dispatch({ type: 'ACCOUNT_SWITCH_RESET' });
    }

    if (!isAuthenticated || !userId) {
      setCloudInitialized(false);
      return;
    }

    loadCloudData();
    return () => { cancelled = true; };
  }, [loadCloudData, isAuthenticated, userId]);

  // ── Auto-save dayData (Local Storage + Cloud) ────────────────
  useEffect(() => {
    if (!state.dayData || !state.activeBizId) return;

    // 1. Immediately persist to localStorage for offline / guest resilience
    // Strict isolation guard: An authenticated state (loaded for a userId) must NEVER be saved
    // if userId is null (logout) or if stateLoadedForUserId !== userId!
    if (userId) {
      if (state.stateLoadedForUserId !== userId) return;
      try {
        saveDay(state.dayData, state.activeBizId, userId);
      } catch (e) {
        console.warn('Local save warning:', e);
      }
    } else {
      // For unauthenticated guest mode: define explicit handling so that only if !userId && state.stateLoadedForUserId === 'guest' does it write to guest storage
      if (state.stateLoadedForUserId === 'guest') {
        try {
          saveDay(state.dayData, state.activeBizId, null);
        } catch (e) {
          console.warn('Local save warning:', e);
        }
      } else {
        return;
      }
    }

    // 2. Debounced save to Firestore for authenticated users with optimistic concurrency check
    // CRITICAL: Guard prevents local data from ever being written into Firestore if cloudInit has not succeeded or failed!
    if (!userId || !cloudInitialized || user?.isAnonymous || state.cloudInitFailed || state.stateLoadedForUserId !== userId) return;

    const currentDayJson = JSON.stringify(state.dayData);
    if (lastSavedDayJsonRef.current === currentDayJson) return;

    const timer = setTimeout(() => {
      const targetBizId = state.activeBizId;
      const targetDateKey = state.dayData?.dateKey;
      const { baseRevision, baseSavedAt } = lastCloudRevisionRef.current.getBaseMeta(
        targetBizId,
        targetDateKey,
        state.dayData
      );
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saving' } });
      saveDayToCloud(userId, targetBizId, state.dayData, null, {
        checkConflict: true,
        baseRevision,
        baseSavedAt: baseSavedAt || lastCloudSavedAtRef.current || 0,
      })
        .then(saveRes => {
          if (saveRes) {
            const entry = lastCloudRevisionRef.current.recordSaved(
              targetBizId,
              targetDateKey,
              saveRes,
              state.dayData
            );
            if (entry?.savedAt) lastCloudSavedAtRef.current = entry.savedAt;
          }
          lastSavedDayJsonRef.current = currentDayJson;
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saved' } });
        })
        .catch(err => {
          if (err.code === 'concurrent-modification-conflict') {
            console.warn('[Ledgero] Concurrent modification conflict during autosave:', err);
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'conflict' } });
            // Protect data integrity: Prompt user to reload or overwrite instead of silent data loss
            if (err.cloudData && typeof window !== 'undefined' && window.confirm) {
              const confirmReload = window.confirm(
                state.language === 'en'
                  ? '⚠️ Cloud Conflict: Today’s shop records were updated from another device. Reload the latest cloud data now?'
                  : '⚠️ ক্লাউড কনফ্লিক্ট: অন্য ডিভাইস থেকে আজকের দোকানের হিসাব ক্লাউডে আপডেট করা হয়েছে। ক্লাউডের সর্বশেষ তথ্য রিলোড করতে চান?'
              );
              if (confirmReload) {
                lastCloudRevisionRef.current.recordLoaded(targetBizId, targetDateKey, err.cloudData);
                lastCloudSavedAtRef.current = Number(err.cloudData._lastCloudSavedAt) || Date.now();
                lastSavedDayJsonRef.current = JSON.stringify(err.cloudData);
                dispatch({ type: 'LOAD_DAY', payload: err.cloudData });
                dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saved' } });
              } else {
                // Protect remote changes: Never blind-overwrite cloud changes from another device!
                // Maintain conflict status so merchant can inspect or resolve via conflict UI
                dispatch({
                  type: 'SET_RESOURCE_SYNC',
                  payload: {
                    resource: 'day',
                    status: 'conflict',
                    error: state.language === 'en'
                      ? 'Cloud conflict: reload declined; automatic overwrite prevented to protect remote data'
                      : 'ক্লাউড কনফ্লিক্ট: রিলোড বাতিল করা হয়েছে; রিমোট ডাটা সুরক্ষায় স্বয়ংক্রিয় ওভাররাইট বন্ধ রাখা হয়েছে'
                  }
                });
              }
            }
          } else {
            console.error('Cloud save error:', err);
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'error', error: err.message } });
          }
        });
    }, 500); // 500ms debounce to avoid excessive writes
    
    return () => clearTimeout(timer);
  }, [state.dayData, state.activeBizId, userId, cloudInitialized, user?.isAnonymous, state.cloudInitFailed, state.stateLoadedForUserId]);

  // ── Multi-Device Concurrency Guard (P1-7) ─────────────────────
  // When tab/app becomes visible, check if another device updated dayData
  useEffect(() => {
    if (!userId || !cloudInitialized || !state.activeBizId || !state.dayData?.dateKey || user?.isAnonymous || state.cloudInitFailed || state.stateLoadedForUserId !== userId) return;

    let active = true;
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const { baseSavedAt } = lastCloudRevisionRef.current.getBaseMeta(
            state.activeBizId,
            state.dayData.dateKey,
            state.dayData
          );
          const freshness = await checkDayDataFreshness(
            userId,
            state.activeBizId,
            state.dayData.dateKey,
            baseSavedAt || lastCloudSavedAtRef.current
          );
          if (active && freshness.isOutdated && freshness.cloudData) {
            console.info('[Ledgero] Newer dayData detected from another device. Syncing state...');
            lastCloudRevisionRef.current.recordLoaded(
              state.activeBizId,
              state.dayData.dateKey,
              freshness.cloudData
            );
            lastCloudSavedAtRef.current = freshness.cloudSavedAt;
            dispatch({ type: 'LOAD_DAY', payload: freshness.cloudData });
          }
        } catch (e) {
          console.warn('Concurrency check failed:', e);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId, cloudInitialized, state.activeBizId, state.dayData?.dateKey, user?.isAnonymous, state.cloudInitFailed, state.stateLoadedForUserId]);

  // ── Auto-save contacts to Firestore ───────────────────────────
  useEffect(() => {
    if (!userId || !cloudInitialized || user?.isAnonymous || state.cloudInitFailed || state.stateLoadedForUserId !== userId || !state.activeBizId) return;
    
    const currentJson = JSON.stringify(state.contacts || []);
    if (lastSavedContactsJsonRef.current === currentJson) return;

    const timer = setTimeout(() => {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'contacts', status: 'saving' } });
      saveAllContactsToCloud(userId, state.activeBizId, state.contacts || [])
        .then(() => {
          lastSavedContactsJsonRef.current = currentJson;
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'contacts', status: 'saved' } });
        })
        .catch(err => {
          console.error('Contacts save error:', err);
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'contacts', status: 'error', error: err.message } });
        });
    }, 500);
    
    return () => clearTimeout(timer);
  }, [state.contacts, state.activeBizId, userId, cloudInitialized, user?.isAnonymous, state.cloudInitFailed, state.stateLoadedForUserId]);

  // ── Auto-save onlineOrders to Firestore ────────────────────────
  useEffect(() => {
    if (!userId || !cloudInitialized || user?.isAnonymous || state.cloudInitFailed || state.stateLoadedForUserId !== userId || !state.activeBizId) return;

    const currentJson = JSON.stringify(state.onlineOrders || []);
    if (lastSavedOrdersJsonRef.current === currentJson) return;

    const timer = setTimeout(() => {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'orders', status: 'saving' } });
      saveAllOnlineOrdersToCloud(userId, state.activeBizId, state.onlineOrders || [])
        .then(() => {
          lastSavedOrdersJsonRef.current = currentJson;
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'orders', status: 'saved' } });
        })
        .catch(err => {
          console.error('Online orders save error:', err);
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'orders', status: 'error', error: err.message } });
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [state.onlineOrders, state.activeBizId, userId, cloudInitialized, user?.isAnonymous, state.cloudInitFailed, state.stateLoadedForUserId]);

  // ── Auto-save settings to Firestore ───────────────────────────
  useEffect(() => {
    if (!userId || !cloudInitialized || user?.isAnonymous || state.cloudInitFailed || state.stateLoadedForUserId !== userId) return;
    
    const settingsPayload = {
      language: state.language,
      isDarkMode: state.isDarkMode,
      isPrivacyMode: state.isPrivacyMode,
      autoCloseTime: state.autoCloseTime,
      autoOpenTime: state.autoOpenTime,
      autoCloseEnabled: state.autoCloseEnabled,
      editLockEnabled: state.editLockEnabled,
      editLockPinHash: state.editLockPinHash,
      userRole: state.userRole,
      staffPinHash: state.staffPinHash,
      appMode: state.appMode,
      featureFlags: state.featureFlags,
      taxRegion: state.taxRegion,
      sheetsWebAppUrl: state.sheetsWebAppUrl,
      teaHouseProducts: state.teaHouseProducts,
      teaHouseMonthlyTab: state.teaHouseMonthlyTab,
      teaHouseMonthlyPersonal: state.teaHouseMonthlyPersonal,
      teaHouseMonthlyShop: state.teaHouseMonthlyShop,
      teaHouseTabMonth: state.teaHouseTabMonth,
      courierSettings: state.courierSettings,
      customerBlacklist: state.customerBlacklist,
    };
    const currentJson = JSON.stringify(settingsPayload);
    if (lastSavedSettingsJsonRef.current === currentJson) return;

    const timer = setTimeout(() => {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'settings', status: 'saving' } });
      saveSettingsToCloud(userId, settingsPayload)
        .then(() => {
          lastSavedSettingsJsonRef.current = currentJson;
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'settings', status: 'saved' } });
        })
        .catch(err => {
          console.error('Settings save error:', err);
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'settings', status: 'error', error: err.message } });
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [state.language, state.isDarkMode, state.isPrivacyMode, state.autoCloseTime, state.autoOpenTime, state.autoCloseEnabled, state.editLockEnabled, state.editLockPinHash, state.userRole, state.staffPinHash, state.appMode, state.featureFlags, state.taxRegion, state.sheetsWebAppUrl, state.teaHouseProducts, state.teaHouseMonthlyTab, state.teaHouseMonthlyPersonal, state.teaHouseMonthlyShop, state.teaHouseTabMonth, state.courierSettings, state.customerBlacklist, userId, cloudInitialized, user?.isAnonymous, state.cloudInitFailed, state.stateLoadedForUserId]);

  // ── Auto-save businesses to Firestore ─────────────────────────
  useEffect(() => {
    if (!userId || !cloudInitialized || user?.isAnonymous || state.cloudInitFailed || state.stateLoadedForUserId !== userId || !state.businesses.length) return;
    
    const currentJson = JSON.stringify(state.businesses || []);
    if (lastSavedBusinessesJsonRef.current === currentJson) return;

    const timer = setTimeout(() => {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'businesses', status: 'saving' } });
      saveBusinessesToCloud(userId, state.businesses)
        .then(() => {
          lastSavedBusinessesJsonRef.current = currentJson;
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'businesses', status: 'saved' } });
        })
        .catch(err => {
          console.error('Business save error:', err);
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'businesses', status: 'error', error: err.message } });
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [state.businesses, userId, cloudInitialized, user?.isAnonymous, state.cloudInitFailed, state.stateLoadedForUserId]);

  // â”€â”€ Auto-Close Timer â€” checks every minute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!state.autoCloseEnabled || !cloudInitialized || !state.dayData) return;
    
    const checkAutoClose = () => {
      const now = new Date();
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      // Check if it's auto-close time and day is still OPEN
      if (currentHHMM === state.autoCloseTime && state.dayData.status === DAY_STATUS.OPEN) {
        // Jitter (0-5 min) to spread load
        // Jitter (0-5 min) to spread load across shops, prevents thundering herd
        const jitterMs = Math.floor(Math.random() * 300000);
        // Auto-close triggered with jitter
        setTimeout(() => {
          dispatch({ type: 'FINALIZE_DAY' });
          
          const sheetsToken = sessionStorage.getItem('sheets_access_token');
          if (sheetsToken && state.dayData) {
            exportToGoogleSheets(sheetsToken, userId, state.dayData, state.activeBiz, state.language)
              // .then(r => console.log('📊 Auto-close sheets export:', r.tabTitle))
              .catch(err => console.warn('📊 Auto-close export skipped:', err.message));
          }
          
          setTimeout(() => {
            dispatch({ type: 'START_NEXT_DAY' });
          }, 2000);
        }, jitterMs);
      }
      
      // Check if it's auto-open time and day is NOT_STARTED
      if (currentHHMM === state.autoOpenTime && state.dayData.status === DAY_STATUS.NOT_STARTED) {
// console.log('â° Auto-open triggered at', currentHHMM);
        dispatch({ type: 'OPEN_DAY' });
      }
    };

    // Also do a catch-up check on mount: if auto-close time has passed and day is still open
    const now = new Date();
    const [closeHour, closeMin] = (state.autoCloseTime || '01:00').split(':').map(Number);
    const closeMinutes = closeHour * 60 + closeMin;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    
    // If close time is in the "night" range (after midnight, e.g. 01:00) and current time is past it
    // but before auto-open time, and day is still OPEN â†’ missed auto-close
    if (state.dayData.status === DAY_STATUS.OPEN) {
      const [openHour, openMin] = (state.autoOpenTime || '08:00').split(':').map(Number);
      const openMinutes = openHour * 60 + openMin;
      
      if (closeMinutes < openMinutes) {
        // Close time is before open time (e.g., 01:00 close, 08:00 open)
        if (nowMinutes >= closeMinutes && nowMinutes < openMinutes) {
// console.log('â° Catch-up auto-close: missed auto-close at', state.autoCloseTime);
          dispatch({ type: 'FINALIZE_DAY' });
          
          // Export to Google Sheets if token is available
          const catchupToken = sessionStorage.getItem('sheets_access_token');
          if (catchupToken && state.dayData) {
            exportToGoogleSheets(catchupToken, userId, state.dayData, state.activeBiz, state.language)
              .then(() => {
                // console.log('📊 Catch-up sheets export success:', r.tabTitle);
                dispatch({ type: 'SET_SHEETS_EXPORTED', payload: true });
              })
              .catch(err => console.warn('📊 Catch-up sheets export skipped:', err.message));
          }
          
          setTimeout(() => dispatch({ type: 'START_NEXT_DAY' }), 2000);
        }
      }
    }

    const timer = setInterval(checkAutoClose, 60000); // Check every minute
    return () => clearInterval(timer);
  }, [state.autoCloseEnabled, state.autoCloseTime, state.autoOpenTime, state.dayData?.status, cloudInitialized]);

  // â”€â”€ Handle business switch / date switch (async load) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!userId || !cloudInitialized) return;
    if (!state.isLoading) return;
    
    // Determine what needs loading
    const dateKey = state._switchDateKey || getTodayKey();
    const bizId = state.activeBizId;
    const bizType = state.activeBiz?.type;
    const bizName = state.activeBiz?.name;
    
    async function loadBusinessData() {
      try {
        let contacts = [];
        let dayData = null;

        if (userId && cloudInitialized && !user?.isAnonymous) {
          try {
            contacts = await loadContactsFromCloud(userId, bizId);
            const orders = await loadOnlineOrdersFromCloud(userId, bizId);
            dispatch({ type: 'SET_ONLINE_ORDERS', payload: orders });
            dayData = await loadDayFromCloud(userId, bizId, dateKey);
            if (!dayData) {
              const previousDay = await findMostRecentDayFromCloud(userId, bizId, dateKey);
              if (previousDay) {
                dayData = createNewDayData(dateKey, previousDay, bizType, bizName, bizId);
              }
            }
          } catch (cloudErr) {
            console.warn('Cloud load error, falling back to local storage:', cloudErr);
          }
        }
        
        // Fallback / guest / offline: load from local storage
        if (!dayData) {
          dayData = loadDay(dateKey, bizId, bizType, bizName);
        }

        // Safety check: if dayData has no inventory or wasn't seeded with previous day
        if (dayData && (!dayData.inventory || dayData.inventory.length === 0)) {
          const previousDay = findMostRecentDay(dateKey, bizId);
          if (previousDay && previousDay.inventory && previousDay.inventory.length > 0) {
            const carriedDay = createNewDayData(dateKey, previousDay, bizType, bizName, bizId);
            dayData.inventory = carriedDay.inventory;
          } else {
            const catalog = loadCatalog(bizId);
            if (catalog && catalog.length > 0) {
              dayData.inventory = catalog.map(item => ({
                ...item,
                openingStock: Math.max(0, Number(item.closingStock || item.openingStock) || 0),
                addedStock: 0,
                closingStock: Math.max(0, Number(item.closingStock || item.openingStock) || 0),
              }));
            }
          }
        }

        const isTelecom = isTelecomBiz(bizType, bizName);
        if (!dayData.wallets || Object.keys(dayData.wallets).length === 0) {
          dayData.wallets = isTelecom ? createDefaultWallets() : createGeneralWallets();
        }
        if (!dayData.wallets.hand_cash) {
          dayData.wallets.hand_cash = { opening: 0, current: 0, category: 'cash' };
        }
        if (!dayData.loans) dayData.loans = { openingGiven: 0, openingTaken: 0 };
        if (!dayData.inventory) dayData.inventory = [];

        lastCloudRevisionRef.current.recordLoaded(bizId, dayData?.dateKey || dateKey, dayData);
        if (dayData?._lastCloudSavedAt) {
          lastCloudSavedAtRef.current = Number(dayData._lastCloudSavedAt);
        }

        dispatch({
          type: 'LOAD_DAY',
          payload: dayData
        });
      } catch (err) {
        console.error('Business load error:', err);
        const fallback = loadDay(dateKey, bizId, bizType, bizName) || createNewDayData(dateKey, null, bizType, bizName, bizId);
        lastCloudRevisionRef.current.recordLoaded(bizId, fallback?.dateKey || dateKey, fallback);
        dispatch({ type: 'LOAD_DAY', payload: fallback });
      }
    }

    loadBusinessData();
  }, [state.isLoading, state.activeBizId, state._switchDateKey, userId, cloudInitialized]);

  // â”€â”€ Handle contact transaction side-effects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!userId || !cloudInitialized || !state._contactTxPayload) return;
    
    const { contactId, txType, dayTxNote, numAmount, newBalance, date } = state._contactTxPayload;
    
    async function saveContactTx() {
      try {
        const existingTxs = await loadContactTxsFromCloud(userId, state.activeBizId, contactId);
        const newContactTxRecord = {
          id: `tx_${Date.now()}`,
          date: date || state.dayData?.dateKey || getTodayKey(),
          timestamp: Date.now(),
          type: txType,
          note: dayTxNote,
          amount: numAmount,
          balanceAfter: newBalance
        };
        await saveContactTxsToCloud(userId, state.activeBizId, contactId, [newContactTxRecord, ...existingTxs]);
      } catch (err) {
        console.error('Contact TX save error:', err);
      }
    }
    
    saveContactTx();
  }, [state._contactTxPayload]);

  // â”€â”€ Handle new contact initial tx â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!userId || !cloudInitialized || !state._newContact) return;
    
    const contact = state._newContact;
    if (contact.openingBalance > 0) {
      saveContactTxsToCloud(userId, state.activeBizId, contact.id, [{
        id: `tx_${Date.now()}`,
        date: state.dayData?.dateKey || getTodayKey(),
        timestamp: Date.now(),
        type: 'opening_balance',
        note: 'à¦ªà§‚à¦°à§à¦¬à§‡à¦° à¦œà§‡à¦° / à¦ªà§à¦°à¦¾à¦°à¦®à§à¦­à¦¿à¦• à¦¬à¦¾à¦•à¦¿',
        amount: contact.openingBalance,
        balanceAfter: contact.openingBalance
      }]).catch(err => console.error('Initial contact TX error:', err));
    }
  }, [state._newContact]);

  // â”€â”€ Handle business deletion cloud cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!userId || !cloudInitialized) return;
    // We track deleted businesses via comparing current list with what we had
    // For now, deletion is handled by the DELETE_BUSINESS action and the business list auto-save
  }, [state.businesses]);

  const [auditSyncError, setAuditSyncError] = useState(null);

  // ── Handle audit log side-effects (single & bulk reversal entries) ──
  useEffect(() => {
    if (!userId || !cloudInitialized) return;
    const entries = Array.isArray(state._auditEntries) && state._auditEntries.length > 0
      ? state._auditEntries
      : (state._auditEntry ? [state._auditEntry] : []);
    if (entries.length === 0) return;

    let active = true;
    Promise.all(entries.map(entry => logAuditEntry(userId, state.activeBizId, entry)))
      .then(() => {
        if (active) {
          setAuditSyncError(null);
          dispatch({ type: 'CLEAR_AUDIT_LOG_ENTRIES' });
        }
      })
      .catch(err => {
        console.error('Audit log error:', err);
        if (active) setAuditSyncError(err.message || 'Audit log sync failed');
      });

    return () => { active = false; };
  }, [state._auditEntry, state._auditEntries, userId, cloudInitialized, state.activeBizId]);

  // ── Export helper function ────────────────────────────────────
  const exportAllData = useCallback(async (options = {}) => {
    if (!userId) return '{}';
    return exportAllCloudData(userId, null, options);
  }, [userId]);

  // ── Contact TX loader for modals ──────────────────────────────
  const loadContactTxsAsync = useCallback(async (contactId) => {
    if (!userId || !state.activeBizId) return [];
    return loadContactTxsFromCloud(userId, state.activeBizId, contactId);
  }, [userId, state.activeBizId]);

  // ── Manual / Retry Cloud Sync (Gate A5) ────────────────────────
  const retryCloudSync = useCallback(async () => {
    if (!userId) return;

    if (state.cloudInitFailed) {
      try {
        // 1. First attempt to load remote settings and businesses:
        const remoteSettings = await loadSettingsFromCloud(userId);
        const remoteBusinesses = await loadBusinessesFromCloud(userId);

        // 2. If remote businesses exist, verify that state.activeBizId exists in remoteBusinesses. If not, reconcile to remoteBusinesses[0].id.
        let businesses = remoteBusinesses;
        let targetBizId = state.activeBizId;
        if (Array.isArray(remoteBusinesses) && remoteBusinesses.length > 0) {
          if (!remoteBusinesses.some(b => b.id === targetBizId)) {
            targetBizId = remoteBusinesses[0].id;
          }
        } else {
          businesses = DEFAULT_BUSINESSES;
          targetBizId = (DEFAULT_BUSINESSES.some(b => b.id === targetBizId)) ? targetBizId : DEFAULT_BUSINESSES[0].id;
        }
        const activeBiz = businesses.find(b => b.id === targetBizId) || businesses[0];

        // 3. If local offline day transactions exist (hasOfflineTxs), save the local dayData to cloud via saveDayToCloud(state.dayData, targetBizId, userId, { checkConflict: true, forceOverwrite: false }).
        const hasOfflineTxs = Boolean(
          state.dayData &&
          state.dayData.bizId === targetBizId &&
          Array.isArray(state.dayData.transactions) &&
          state.dayData.transactions.length > 0
        );

        let syncedDayData = state.dayData;
        if (hasOfflineTxs) {
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saving' } });
          const { baseRevision, baseSavedAt } = lastCloudRevisionRef.current.getBaseMeta(
            targetBizId,
            state.dayData.dateKey,
            state.dayData
          );
          const saveRes = await saveDayToCloud(state.dayData, targetBizId, userId, {
            checkConflict: true,
            forceOverwrite: false,
            baseRevision,
            baseSavedAt: baseSavedAt || lastCloudSavedAtRef.current || 0,
          });

          if (saveRes?.conflict) {
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'conflict', error: 'Sync conflict detected' } });
            return;
          }

          if (saveRes) {
            const entry = lastCloudRevisionRef.current.recordSaved(
              targetBizId,
              state.dayData.dateKey,
              saveRes,
              state.dayData
            );
            if (entry?.savedAt) lastCloudSavedAtRef.current = entry.savedAt;
            syncedDayData = {
              ...state.dayData,
              _cloudRevision: saveRes.revision,
              _lastCloudSavedAt: saveRes.savedAt,
            };
          }
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saved' } });
        } else {
          const today = state.dayData?.dateKey || getTodayKey();
          let loadedDay = await loadDayFromCloud(userId, targetBizId, today);
          if (!loadedDay) {
            const previousDay = await findMostRecentDayFromCloud(userId, targetBizId, today);
            loadedDay = createNewDayData(today, previousDay, activeBiz.type, activeBiz.name, targetBizId, userId);
          } else {
            const isTelecom = isTelecomBiz(activeBiz.type, activeBiz.name);
            if (!loadedDay.wallets || Object.keys(loadedDay.wallets).length === 0) {
              loadedDay.wallets = isTelecom ? createDefaultWallets() : createGeneralWallets();
            }
            if (!loadedDay.wallets.hand_cash) {
              loadedDay.wallets.hand_cash = { opening: 0, current: 0, category: 'cash' };
            }
            if (!loadedDay.loans) loadedDay.loans = { openingGiven: 0, openingTaken: 0 };
            if (!loadedDay.inventory) loadedDay.inventory = [];
          }
          syncedDayData = loadedDay;
          lastCloudRevisionRef.current.recordLoaded(targetBizId, syncedDayData?.dateKey || today, syncedDayData);
          if (syncedDayData?._lastCloudSavedAt) {
            lastCloudSavedAtRef.current = Number(syncedDayData._lastCloudSavedAt);
          }
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saved' } });
        }

        // 4. Fetch remote contacts and onlineOrders for targetBizId.
        const remoteContacts = (await loadContactsFromCloud(userId, targetBizId)) || [];
        const remoteOrders = (await loadOnlineOrdersFromCloud(userId, targetBizId)) || [];

        // 5. Dispatch CLOUD_INIT with the authoritative remote metadata, businesses, settings, contacts, onlineOrders, and the synced dayData.
        const isDark = remoteSettings?.isDarkMode || false;
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }

        dispatch({
          type: 'CLOUD_INIT',
          payload: {
            userId,
            businesses,
            activeBizId: targetBizId,
            activeBiz,
            contacts: remoteContacts,
            onlineOrders: remoteOrders,
            dayData: syncedDayData,
            language: remoteSettings?.language || 'bn',
            isDarkMode: isDark,
            isPrivacyMode: remoteSettings?.isPrivacyMode || false,
            autoCloseTime: remoteSettings?.autoCloseTime || '01:00',
            autoOpenTime: remoteSettings?.autoOpenTime || '08:00',
            autoCloseEnabled: remoteSettings?.autoCloseEnabled || false,
            editLockEnabled: remoteSettings?.editLockEnabled || false,
            editLockPinHash: remoteSettings?.editLockPinHash || null,
            userRole: remoteSettings?.userRole || 'owner',
            staffPinHash: remoteSettings?.staffPinHash || null,
            appMode: remoteSettings?.appMode || 'easy',
            featureFlags: remoteSettings?.featureFlags || { ...ADVANCED_FEATURES },
            taxRegion: remoteSettings?.taxRegion || 'BD',
            sheetsWebAppUrl: remoteSettings?.sheetsWebAppUrl || '',
            ...(Array.isArray(remoteSettings?.teaHouseProducts) && remoteSettings.teaHouseProducts.length > 0 && { teaHouseProducts: remoteSettings.teaHouseProducts }),
            ...(remoteSettings?.teaHouseMonthlyTab !== undefined && { teaHouseMonthlyTab: remoteSettings.teaHouseMonthlyTab }),
            ...(remoteSettings?.teaHouseMonthlyPersonal !== undefined && { teaHouseMonthlyPersonal: remoteSettings.teaHouseMonthlyPersonal }),
            ...(remoteSettings?.teaHouseMonthlyShop !== undefined && { teaHouseMonthlyShop: remoteSettings.teaHouseMonthlyShop }),
            ...(remoteSettings?.teaHouseTabMonth !== undefined && { teaHouseTabMonth: remoteSettings.teaHouseTabMonth }),
            ...(remoteSettings?.courierSettings && { courierSettings: remoteSettings.courierSettings }),
            ...(remoteSettings?.customerBlacklist && { customerBlacklist: remoteSettings.customerBlacklist }),
            currentScreen: syncedDayData?.status === DAY_STATUS.NOT_STARTED ? SCREENS.OPENING : SCREENS.DASHBOARD
          }
        });
        applyModeTheme(remoteSettings?.appMode || 'easy');

        // 6. Only then set setCloudInitialized(true) and clear cloudInitFailed: false
        dispatch({ type: 'SET_CLOUD_INIT_RECOVERED', payload: { userId } });
        setCloudInitialized(true);
        return;
      } catch (err) {
        // 7. If loading remote businesses/settings fails, abort with error without overwriting cloud!
        console.error('[Ledgero] Cloud initialization recovery failed:', err);
        const isConflict = err.code === 'concurrent-modification-conflict' || err.message?.includes('conflict') || err.message?.includes('CONFLICT');
        dispatch({
          type: 'SET_RESOURCE_SYNC',
          payload: {
            resource: 'settings',
            status: isConflict ? 'conflict' : 'error',
            error: err.message || 'Safe cloud initialization recovery failed'
          }
        });
        return;
      }
    } else if (!cloudInitialized) {
      await loadCloudData(state.activeBizId);
      return;
    }

    if (!state.activeBizId) return;

    // In the retry pass:
    // Retry all failed resources (day, contacts, onlineOrders, settings, businesses),
    // and derive cloudSyncStatus strictly from the unified status of all resources.
    const currentResStatus = state.resourceSyncStatus || {};
    const shouldRetryResource = (key) => {
      const s = currentResStatus[key];
      return s === 'error' || s === 'conflict' || s !== 'saved' || state.cloudSyncStatus === 'error' || state.cloudSyncStatus === 'conflict';
    };

    const shouldRetryDay = Boolean(state.dayData && state.activeBizId && shouldRetryResource('day'));
    const shouldRetryContacts = Boolean(state.activeBizId && Array.isArray(state.contacts) && shouldRetryResource('contacts'));
    const shouldRetryOrders = Boolean(state.activeBizId && Array.isArray(state.onlineOrders) && (shouldRetryResource('orders') || shouldRetryResource('onlineOrders')));
    const shouldRetrySettings = Boolean(shouldRetryResource('settings'));
    const shouldRetryBusinesses = Boolean(Array.isArray(state.businesses) && state.businesses.length > 0 && shouldRetryResource('businesses'));

    const promises = [];

    if (shouldRetryDay) {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saving' } });
      const { baseRevision, baseSavedAt } = lastCloudRevisionRef.current.getBaseMeta(
        state.activeBizId,
        state.dayData.dateKey,
        state.dayData
      );
      promises.push(
        saveDayToCloud(state.dayData, state.activeBizId, userId, {
          checkConflict: true,
          forceOverwrite: false,
          baseRevision,
          baseSavedAt: baseSavedAt || lastCloudSavedAtRef.current || 0,
        }).then(saveRes => {
          if (saveRes?.conflict) {
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'conflict', error: 'Sync conflict detected' } });
            return saveRes;
          }
          if (saveRes) {
            const entry = lastCloudRevisionRef.current.recordSaved(
              state.activeBizId,
              state.dayData.dateKey,
              saveRes,
              state.dayData
            );
            if (entry?.savedAt) lastCloudSavedAtRef.current = entry.savedAt;
          }
          dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'day', status: 'saved' } });
          return saveRes;
        }).catch(err => {
          console.error('[Ledgero] Day retry error:', err);
          const isConflict = err.code === 'concurrent-modification-conflict' || err.message?.includes('conflict') || err.message?.includes('CONFLICT');
          dispatch({
            type: 'SET_RESOURCE_SYNC',
            payload: { resource: 'day', status: isConflict ? 'conflict' : 'error', error: err.message }
          });
          return { error: err };
        })
      );
    }

    if (shouldRetryContacts) {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'contacts', status: 'saving' } });
      promises.push(
        saveAllContactsToCloud(userId, state.activeBizId, state.contacts || [])
          .then(res => {
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'contacts', status: 'saved' } });
            return res;
          })
          .catch(err => {
            console.error('[Ledgero] Contacts retry error:', err);
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'contacts', status: 'error', error: err.message } });
            return { error: err };
          })
      );
    }

    if (shouldRetryOrders) {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'orders', status: 'saving' } });
      promises.push(
        saveAllOnlineOrdersToCloud(userId, state.activeBizId, state.onlineOrders || [])
          .then(res => {
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'orders', status: 'saved' } });
            return res;
          })
          .catch(err => {
            console.error('[Ledgero] Online orders retry error:', err);
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'orders', status: 'error', error: err.message } });
            return { error: err };
          })
      );
    }

    if (shouldRetrySettings) {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'settings', status: 'saving' } });
      promises.push(
        saveSettingsToCloud(userId, {
          language: state.language,
          isDarkMode: state.isDarkMode,
          isPrivacyMode: state.isPrivacyMode,
          autoCloseTime: state.autoCloseTime,
          autoOpenTime: state.autoOpenTime,
          autoCloseEnabled: state.autoCloseEnabled,
          editLockEnabled: state.editLockEnabled,
          editLockPinHash: state.editLockPinHash,
          userRole: state.userRole,
          staffPinHash: state.staffPinHash,
          appMode: state.appMode,
          featureFlags: state.featureFlags,
          taxRegion: state.taxRegion,
          sheetsWebAppUrl: state.sheetsWebAppUrl,
          teaHouseProducts: state.teaHouseProducts,
          teaHouseMonthlyTab: state.teaHouseMonthlyTab,
          teaHouseMonthlyPersonal: state.teaHouseMonthlyPersonal,
          teaHouseMonthlyShop: state.teaHouseMonthlyShop,
          teaHouseTabMonth: state.teaHouseTabMonth,
          courierSettings: state.courierSettings,
          customerBlacklist: state.customerBlacklist,
        })
          .then(res => {
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'settings', status: 'saved' } });
            return res;
          })
          .catch(err => {
            console.error('[Ledgero] Settings retry error:', err);
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'settings', status: 'error', error: err.message } });
            return { error: err };
          })
      );
    }

    if (shouldRetryBusinesses) {
      dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'businesses', status: 'saving' } });
      promises.push(
        saveBusinessesToCloud(userId, state.businesses || [])
          .then(res => {
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'businesses', status: 'saved' } });
            return res;
          })
          .catch(err => {
            console.error('[Ledgero] Businesses retry error:', err);
            dispatch({ type: 'SET_RESOURCE_SYNC', payload: { resource: 'businesses', status: 'error', error: err.message } });
            return { error: err };
          })
      );
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }, [
    userId,
    state.cloudInitFailed,
    cloudInitialized,
    state.activeBizId,
    state.dayData,
    state.contacts,
    state.onlineOrders,
    state.businesses,
    state.language,
    state.isDarkMode,
    state.isPrivacyMode,
    state.autoCloseTime,
    state.autoOpenTime,
    state.autoCloseEnabled,
    state.editLockEnabled,
    state.editLockPinHash,
    state.userRole,
    state.staffPinHash,
    state.appMode,
    state.featureFlags,
    state.taxRegion,
    state.sheetsWebAppUrl,
    state.teaHouseProducts,
    state.teaHouseMonthlyTab,
    state.teaHouseMonthlyPersonal,
    state.teaHouseMonthlyShop,
    state.teaHouseTabMonth,
    state.courierSettings,
    state.customerBlacklist,
    state.resourceSyncStatus,
    state.cloudSyncStatus,
    loadCloudData
  ]);

  const applyCloudSettlement = useCallback((order, dayData) => {
    dispatch({
      type: 'APPLY_CLOUD_SETTLEMENT',
      payload: { order, dayData }
    });
    if (dayData) {
      const bizId = dayData.bizId || state.activeBizId;
      const dateKey = dayData.dateKey || state.dayData?.dateKey;
      if (bizId && dateKey) {
        lastCloudRevisionRef.current.recordLoaded(bizId, dateKey, dayData);
      }
      if (dayData._lastCloudSavedAt) {
        lastCloudSavedAtRef.current = Number(dayData._lastCloudSavedAt);
      }
      lastSavedDayJsonRef.current = JSON.stringify(dayData);
    }
    // Invalidate orders JSON ref so updated order is recognized
    lastSavedOrdersJsonRef.current = null;
  }, [state.activeBizId, state.dayData?.dateKey]);

  return (
    <AppContext.Provider value={{ 
      state, 
      dispatch, 
      exportAllData, 
      loadContactTxsAsync,
      userId,
      auditSyncError,
      cloudSyncStatus: state.cloudSyncStatus,
      lastSyncError: state.lastSyncError,
      retryCloudSync,
      applyCloudSettlement
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export function useIsAdvanced() {
  const { state } = useApp();
  return state.appMode === 'advanced';
}

export function useFeature(featureName) {
  const { state } = useApp();
  return state.featureFlags?.[featureName] || false;
}






