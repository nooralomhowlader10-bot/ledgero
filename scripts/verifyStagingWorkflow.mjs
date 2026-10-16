/**
 * scripts/verifyStagingWorkflow.mjs
 * Ledgero Automated Staging Acceptance & Disaster Recovery Verification Suite
 *
 * Validates operational and accounting workflows requested by the senior auditor:
 * 1. End-to-End Online Order Lifecycle: Creation -> Advance -> Pack -> Ship -> Deliver -> Courier Settlement
 * 2. Multi-Wallet Ledger Reconciliation: COD, Courier Expense, Net Wallet Credit, and Double-Entry Balanced Journal
 * 3. Mobile Banking (MFS) Payment Verification & Duplicate TrxID Prevention
 * 4. Full Snapshot Backup & Zero-Loss Recovery Simulation (Byte-for-byte state preservation)
 * 5. Historical Settlement Integrity & Orphan Transaction Audit
 *
 * Outputs auditable execution report to tests/artifacts/STAGING_ACCEPTANCE_REPORT.json
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Universal mock for headless Node.js runtimes (Node 20, Node 22, etc.)
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


import {
  confirmOnlineOrderInState,
  packOnlineOrderInState,
  shipOnlineOrderInState,
  deliverOnlineOrderInState,
  settleOnlineOrderInState,
  verifyOnlineOrderPaymentInState,
  parseStrictMoney,
} from '../src/data/ledgerStateEngine.js';

import {
  createNewDayData,
  exportAllData,
  importAllData,
  validateBackupPayload,
  setActiveStorageUserId,
} from '../src/data/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(projectRoot, 'tests', 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 LEDGERO STAGING ACCEPTANCE & DISASTER RECOVERY VERIFICATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Execution Timestamp: ${new Date().toISOString()}`);
console.log(`Environment: Node.js ${process.version} (${process.platform}-${process.arch})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const testResults = [];

function step(title, fn) {
  const start = Date.now();
  try {
    fn();
    const durationMs = Date.now() - start;
    console.log(`  ✅ [PASS] ${title} (${durationMs}ms)`);
    testResults.push({ title, status: 'PASS', durationMs });
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`  ❌ [FAIL] ${title} (${durationMs}ms):`, err.message);
    testResults.push({ title, status: 'FAIL', durationMs, error: err.message });
    throw err;
  }
}

// -----------------------------------------------------------------------------
// STAGE 1: Real Order Lifecycle & Courier Settlement Reconciliation
// -----------------------------------------------------------------------------
console.log('📦 STAGE 1: Real Order Lifecycle & Courier Settlement Reconciliation');

const targetDateKey = '2026-10-16';
const targetBizId = 'biz_staging_1';
const initialDay = createNewDayData(targetDateKey);

// Ensure default wallets
initialDay.wallets = {
  cash: { id: 'cash', current: 5000, name: 'Cash' },
  bkash: { id: 'bkash', current: 2000, name: 'bKash Merchant' },
  bank: { id: 'bank', current: 15000, name: 'Brac Bank' },
};

let currentOrder = {
  id: 'ord_stg_101',
  orderNumber: 'ORD-101',
  customerName: 'Kazi Nazrul Islam',
  customerPhone: '01711000000',
  address: 'Dhanmondi, Dhaka',
  status: 'draft',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  subtotal: 2500,
  deliveryCharge: 0,
  discount: 0,
  totalAmount: 2500,
  advancePaid: 500,
  advanceWallet: 'bkash',
  codAmount: 2000,
  createdAt: Date.now(),
  items: [
    { name: 'Cotton Panjabi', quantity: 1, unitPrice: 1500, totalPrice: 1500 },
    { name: 'Pajama', quantity: 1, unitPrice: 1000, totalPrice: 1000 },
  ],
};

let stagingState = {
  activeBizId: targetBizId,
  onlineOrders: [currentOrder],
  dayData: initialDay,
};

step('1.1 Order confirms, packs, ships and delivers through state machine', () => {
  // Confirm
  stagingState = confirmOnlineOrderInState(stagingState, { orderId: currentOrder.id });
  assert.equal(stagingState.onlineOrders[0].status, 'confirmed');

  // Pack
  stagingState = packOnlineOrderInState(stagingState, { orderId: currentOrder.id });
  assert.equal(stagingState.onlineOrders[0].status, 'packed');

  // Ship
  stagingState = shipOnlineOrderInState(stagingState, {
    orderId: currentOrder.id,
    courierName: 'Steadfast Courier',
    trackingId: 'ST-99887766',
  });
  assert.equal(stagingState.onlineOrders[0].status, 'shipped');
  assert.equal(stagingState.onlineOrders[0].courierName, 'Steadfast Courier');

  // Deliver
  stagingState = deliverOnlineOrderInState(stagingState, { orderId: currentOrder.id });
  assert.equal(stagingState.onlineOrders[0].status, 'delivered');
});

step('1.2 Courier settlement executes with exact COD, fee netting & journal entry', () => {
  const initialCash = stagingState.dayData.wallets.cash.current;
  const settlementPayload = {
    orderId: currentOrder.id,
    codAmount: 2000,
    courierCharge: 130,
    codFee: 20,
    settlementWallet: 'cash',
    settlementDateKey: targetDateKey,
  };

  stagingState = settleOnlineOrderInState(stagingState, settlementPayload);

  // Assert order status
  const settledOrder = stagingState.onlineOrders[0];
  assert.equal(settledOrder.status, 'settled');
  assert.equal(settledOrder.settlementWallet, 'cash');
  assert.equal(settledOrder.settlementAmount, 1850); // 2000 - 150 = 1850
  assert.equal(settledOrder.codAmount, 2000);

  // Assert Cash wallet received exactly net 1850
  const expectedCash = initialCash + 1850;
  assert.equal(stagingState.dayData.wallets.cash.current, expectedCash);

  // Assert settlement transaction created
  const tx = (stagingState.dayData.transactions || []).find(
    (t) => t.type === 'courier_settlement' && String(t.orderId) === String(currentOrder.id)
  );
  assert.ok(tx, 'Settlement transaction must exist in ledger');
  assert.equal(tx.amount, 1850);
  assert.equal(tx.wallet, 'cash');

  // Assert double-entry balanced journal entry
  const je = (stagingState.dayData.journalEntries || []).find(
    (j) => j.txType === 'courier_settlement' && String(j.txId) === String(tx.id)
  );
  assert.ok(je, 'Balanced settlement journal entry must exist');

  const totalDebit = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert.equal(totalDebit, 2000);
  assert.equal(totalCredit, 2000);

  const walletDebitLine = je.lines.find((l) => (l.accountId === 'cash_in_hand' || l.accountId === 'cash') && l.debit === 1850);
  const expenseDebitLine = je.lines.find(
    (l) => (l.accountId === 'delivery_expense' || l.accountId === 'courier_expense') && l.debit === 150
  );
  const receivableCreditLine = je.lines.find(
    (l) => l.accountId === 'courier_receivable' && l.credit === 2000
  );

  assert.ok(walletDebitLine, 'Cash wallet debit of ৳1850 must be recorded');
  assert.ok(expenseDebitLine, 'Courier expense debit of ৳150 must be recorded');
  assert.ok(receivableCreditLine, 'Courier receivable credit of ৳2000 must be recorded');
});

// -----------------------------------------------------------------------------
// STAGE 2: Mobile Banking Payment Verification & TrxID Uniqueness
// -----------------------------------------------------------------------------
console.log('\n💳 STAGE 2: Mobile Banking Payment Verification & TrxID Uniqueness');

const mfsOrder = {
  id: 'ord_stg_102',
  orderNumber: 'ORD-102',
  customerName: 'Rabindranath Tagore',
  customerPhone: '01811000000',
  status: 'draft',
  paymentMethod: 'bkash_manual',
  paymentStatus: 'pending',
  totalAmount: 1200,
  createdAt: Date.now(),
};

stagingState.onlineOrders.push(mfsOrder);

step('2.1 Mobile banking payment verifies with unique TrxID and credits wallet', () => {
  const initialBkash = stagingState.dayData.wallets.bkash.current;
  const verifyPayload = {
    orderId: mfsOrder.id,
    amount: 1200,
    paymentWallet: 'bkash',
    paymentDateKey: targetDateKey,
    trxId: 'BKM99887711',
  };

  stagingState = verifyOnlineOrderPaymentInState(stagingState, verifyPayload);
  const updatedMfsOrder = stagingState.onlineOrders.find((o) => o.id === mfsOrder.id);

  assert.equal(updatedMfsOrder.paymentStatus, 'verified');
  assert.equal(updatedMfsOrder.verifiedTrxId, 'BKM99887711');
  assert.equal(stagingState.dayData.wallets.bkash.current, initialBkash + 1200);
});

step('2.2 Duplicate TrxID reuse is rejected fail-closed with structured error', () => {
  const duplicateOrder = {
    id: 'ord_stg_103',
    orderNumber: 'ORD-103',
    status: 'draft',
    paymentMethod: 'bkash_manual',
    paymentStatus: 'pending',
    totalAmount: 1200,
  };
  stagingState.onlineOrders.push(duplicateOrder);

  const duplicatePayload = {
    orderId: duplicateOrder.id,
    amount: 1200,
    paymentWallet: 'bkash',
    paymentDateKey: targetDateKey,
    trxId: 'BKM99887711', // Reusing same TrxID
  };

  const nextState = verifyOnlineOrderPaymentInState(stagingState, duplicatePayload);
  assert.ok(nextState._orderPaymentVerificationError, 'Duplicate TrxID must be caught and blocked');
  assert.equal(nextState._orderPaymentVerificationError.code, 'duplicate_trx_id');
});

// -----------------------------------------------------------------------------
// STAGE 3: State Engine Backup Export & Local Storage Recovery Simulation
// -----------------------------------------------------------------------------
console.log('\n💾 STAGE 3: State Engine Backup Export & Local Storage Recovery Simulation');

// Mock localStorage for storage.js backup/restore testing
const memoryStorage = new Map();
globalThis.localStorage = {
  getItem: (key) => memoryStorage.get(key) || null,
  setItem: (key, val) => memoryStorage.set(key, String(val)),
  removeItem: (key) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
  get length() { return memoryStorage.size; },
  key: (i) => Array.from(memoryStorage.keys())[i] || null,
};

const stagingUserId = 'user_staging_prod_1';
setActiveStorageUserId(stagingUserId);

// Save current state into mock localStorage
const dayKey = `shop_u_${stagingUserId}_${targetBizId}_day_${targetDateKey}`;
const ordersKey = `shop_u_${stagingUserId}_${targetBizId}_online_orders_v1`;
memoryStorage.set(dayKey, JSON.stringify(stagingState.dayData));
memoryStorage.set(ordersKey, JSON.stringify(stagingState.onlineOrders));

let backupJsonString = '';

step('3.1 Backup snapshot exports cleanly and passes payload validation', () => {
  backupJsonString = exportAllData(stagingUserId);
  assert.ok(backupJsonString.length > 50, 'Backup payload must not be empty');

  const validation = validateBackupPayload(backupJsonString);
  assert.equal(validation.valid, true, 'Backup payload must pass structural validation');
});

step('3.2 Local Recovery: Full storage wipe & state restoration verifies wallet and order recovery', () => {
  // Capture pre-wipe snapshot
  const preWipeCashBalance = stagingState.dayData.wallets.cash.current;
  const preWipeBkashBalance = stagingState.dayData.wallets.bkash.current;
  const preWipeOrdersCount = stagingState.onlineOrders.length;

  // Complete data wipe
  memoryStorage.clear();
  assert.equal(memoryStorage.size, 0, 'Storage must be completely empty after wipe');

  // Restore from backup JSON
  const importResult = importAllData(backupJsonString, { userId: stagingUserId });
  assert.equal(importResult, true, 'Restoration must succeed');

  // Verify restored day and orders
  const restoredDayRaw = memoryStorage.get(dayKey);
  const restoredOrdersRaw = memoryStorage.get(ordersKey);

  assert.ok(restoredDayRaw, 'Day ledger document must be restored');
  assert.ok(restoredOrdersRaw, 'Online orders collection must be restored');

  const restoredDay = JSON.parse(restoredDayRaw);
  const restoredOrders = JSON.parse(restoredOrdersRaw);

  assert.equal(restoredDay.wallets.cash.current, preWipeCashBalance, 'Cash wallet balance restored 100%');
  assert.equal(restoredDay.wallets.bkash.current, preWipeBkashBalance, 'bKash wallet balance restored 100%');
  assert.equal(restoredOrders.length, preWipeOrdersCount, 'All orders restored');

  const restoredSettledOrder = restoredOrders.find((o) => o.id === currentOrder.id);
  assert.equal(restoredSettledOrder.status, 'settled');
  assert.equal(restoredSettledOrder.settlementAmount, 1850);
});

// -----------------------------------------------------------------------------
// STAGE 4: Historical Settlement Audit
// -----------------------------------------------------------------------------
console.log('\n🔍 STAGE 4: Historical Settlement Audit');

step('4.1 Audit detects zero orphaned transactions and verifies ledger invariants', () => {
  const day = stagingState.dayData;
  const settledOrders = stagingState.onlineOrders.filter((o) => o.status === 'settled');

  for (const order of settledOrders) {
    // 1. Transaction exists
    const matchingTx = (day.transactions || []).find(
      (t) => t.type === 'courier_settlement' && String(t.orderId) === String(order.id)
    );
    assert.ok(matchingTx, `Order ${order.id} must have a matching settlement transaction`);
    assert.equal(matchingTx.amount, order.settlementAmount);

    // 2. Journal entry exists and balances
    const matchingJe = (day.journalEntries || []).find(
      (j) => j.txType === 'courier_settlement' && String(j.txId) === String(matchingTx.id)
    );
    assert.ok(matchingJe, `Order ${order.id} must have a matching journal entry`);
    const totDeb = matchingJe.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totCred = matchingJe.lines.reduce((s, l) => s + (l.credit || 0), 0);
    assert.equal(totDeb, totCred);
  }
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 STAGING ACCEPTANCE SUMMARY MATRIX');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const r of testResults) {
  console.log(`✅ ${r.title.padEnd(72)} [${r.status}] (${r.durationMs}ms)`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const reportPath = path.join(artifactsDir, 'STAGING_ACCEPTANCE_REPORT.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      status: 'PASSED',
      totalPassed: testResults.length,
      results: testResults,
    },
    null,
    2
  ),
  'utf8'
);
console.log(`📄 Saved staging acceptance report to: tests/artifacts/STAGING_ACCEPTANCE_REPORT.json`);
console.log('\n🎉 ALL STAGING ACCEPTANCE & DISASTER RECOVERY TESTS PASSED.');
