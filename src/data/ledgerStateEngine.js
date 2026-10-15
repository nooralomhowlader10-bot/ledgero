/**
 * ledgerStateEngine.js — Pure, deterministic state transition engine for Ledgero accounting actions.
 *
 * Extracted as a pure ES module so both React's AppContext reducer and Node.js automated
 * integration tests execute the exact same production code for:
 *   - QUICK_RESTOCK
 *   - QUICK_SELL_STOCK
 *   - WRITE_OFF_DAMAGE
 *   - APPLY_STOCK_AUDIT (FIFO-aware shortage & surplus adjustments)
 *   - DELETE_TRANSACTION / REVERSE_TRANSACTION (full wallet, inventory, FIFO, contact & GL reversal)
 *   - BULK_DELETE_TRANSACTIONS (reversal-safe bulk transaction cancellation)
 *   - DELETE_BUSINESS
 */

import { roundBDT } from './calculations.js';
import { createBatch, consumeFIFOBatches, restoreFIFOBatches } from './fifoEngine.js';
import { generateJournalEntry, generateCOGSEntry, generateReversalJournalEntry, mapWalletToAccount } from './journalEngine.js';
import { blacklistCustomerInState, unblacklistCustomerInState, recordRtoInBlacklist } from './customerRiskEngine.js';
import { verifyOrderAgainstCatalog, repriceOrderFromCatalog } from './orderIntegrityEngine.js';
import { getRecommendedWalletForPayment, isWalletCompatibleWithPayment } from './courierRates.js';

let _txSeq = 0;
function nextTxId(prefix = 'tx') {
  _txSeq += 1;
  return `${prefix}_${Date.now()}_${_txSeq}`;
}

export function isPeriodLocked(state) {
  return Boolean(
    state?.lockedPeriodEndDate &&
    state?.dayData?.dateKey &&
    state.dayData.dateKey <= state.lockedPeriodEndDate
  );
}

/**
 * Strict currency parser for accounting operations.
 * - Accepts non-negative numbers and finite numeric values.
 * - Accepts strings matching clean non-negative currency format: /^(0|[1-9]\d*)(\.\d{1,2})?$/
 * - Rejects booleans (true/false), objects, arrays, hex strings ('0x10'), exponents ('1e5'), whitespace (' '), etc.
 * - If raw is undefined, null, or empty string: returns defaultVal if not required, else null.
 */
export function parseStrictMoney(raw, defaultVal = 0, isRequired = false) {
  if (raw === undefined || raw === null) {
    return isRequired ? null : defaultVal;
  }
  if (typeof raw === 'boolean' || typeof raw === 'object') {
    return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || Number.isNaN(raw)) return null;
    // Numeric Firestore values must already be expressed at paisa precision.
    // Do not silently round a malformed value such as 1000.001 to 1000.00.
    const rawCents = raw * 100;
    const roundedCents = Math.round(rawCents);
    if (!Number.isSafeInteger(roundedCents) || Math.abs(rawCents - roundedCents) > 1e-7) return null;
    return roundedCents / 100;
  }
  if (typeof raw === 'string') {
    if (raw === '') {
      return isRequired ? null : defaultVal;
    }
    const trimmed = raw.trim();
    if (trimmed === '') {
      // P2 Fix: Explicit whitespace string (e.g. ' ', '   ') is malformed input and must be rejected as null
      return null;
    }
    if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(trimmed)) {
      return null;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || Number.isNaN(n)) return null;
    return roundBDT(n);
  }
  return null;
}

/**
 * QUICK_SELL_STOCK — Consumes oldest FIFO batches, records sale revenue + COGS + profit,
 * updates hand_cash wallet, and posts both Revenue and Perpetual Inventory COGS journal entries.
 */
export function quickSellStockInState(state, payload = {}) {
  const { itemId, quantity = 1 } = payload;
  if (!state?.dayData?.inventory) return state;
  const item = state.dayData.inventory.find(i => i.id === itemId);
  if (!item) return state;

  const currentAvailable = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
  const soldUnits = (state.dayData?.transactions || [])
    .filter(t => t.type === 'stock_sale' && t.itemId === itemId && !t.reversed && !t.isReversal)
    .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);
  const damagedUnits = (state.dayData?.transactions || [])
    .filter(t => (t.type === 'stock_damage' || t.type === 'damage_loss') && t.itemId === itemId && !t.reversed && !t.isReversal)
    .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

  let currentClosing = item.closingStock !== undefined && item.closingStock !== null
    ? Number(item.closingStock)
    : currentAvailable;
  if (currentClosing === 0 && currentAvailable > 0 && soldUnits === 0 && damagedUnits === 0) {
    currentClosing = currentAvailable;
  }

  const qtyNum = Number(quantity) || 1;
  const newClosing = Math.max(0, currentClosing - qtyNum);
  const actualSoldUnits = currentClosing - newClosing;
  if (actualSoldUnits <= 0) return state;

  const { totalCost: fifoCost, remainingBatches, consumedDetails } = consumeFIFOBatches(
    item.batches || [],
    actualSoldUnits,
    item.buyPrice
  );
  const costAmount = fifoCost > 0 ? roundBDT(fifoCost) : roundBDT(actualSoldUnits * (item.buyPrice || 0));
  const saleAmount = roundBDT(actualSoldUnits * (item.sellPrice || 0));
  const profit = roundBDT(saleAmount - costAmount);

  const newTx = {
    id: nextTxId('sale'),
    timestamp: Date.now(),
    type: 'stock_sale',
    amount: saleAmount,
    cogs: costAmount,
    profit,
    itemId: item.id,
    itemName: item.name,
    quantity: actualSoldUnits,
    unit: item.unit || 'পিস',
    toWallet: 'hand_cash',
    consumedBatches: consumedDetails,
    note: `${item.name} বিক্রি (${actualSoldUnits} ${item.unit || 'টি'})`,
  };

  const newWallets = { ...(state.dayData.wallets || {}) };
  newWallets.hand_cash = {
    ...(newWallets.hand_cash || { opening: 0, current: 0 }),
    current: roundBDT((newWallets.hand_cash?.current || 0) + saleAmount),
  };

  const newInventory = state.dayData.inventory.map(inv =>
    inv.id === itemId
      ? {
          ...inv,
          closingStock: newClosing,
          batches: remainingBatches,
          fifoSoldUnits: (Number(inv.fifoSoldUnits) || 0) + actualSoldUnits,
          fifoCogs: roundBDT((Number(inv.fifoCogs) || 0) + costAmount),
          fifoRevenue: roundBDT((Number(inv.fifoRevenue) || 0) + saleAmount),
        }
      : inv
  );

  const sellJournals = state.dayData.journalEntries || [];
  let updatedSellJournals = [...sellJournals];
  const saleJE = generateJournalEntry(newTx);
  if (saleJE) updatedSellJournals.push(saleJE);
  if (costAmount > 0) {
    const cogsJE = generateCOGSEntry(costAmount, newTx.id);
    if (cogsJE) updatedSellJournals.push(cogsJE);
  }

  return {
    ...state,
    dayData: {
      ...state.dayData,
      wallets: newWallets,
      inventory: newInventory,
      transactions: [...(state.dayData.transactions || []), newTx],
      journalEntries: updatedSellJournals,
    },
  };
}

/**
 * QUICK_RESTOCK — Appends a new FIFO batch, updates WAC buyPrice, deducts from sourceWallet,
 * and posts double-entry inventory purchase journal.
 */
export function quickRestockInState(state, payload = {}) {
  const { itemId, quantity = 1, sourceWallet = 'hand_cash', unitCost } = payload;
  if (!state?.dayData?.inventory) return state;
  const item = state.dayData.inventory.find(i => i.id === itemId);
  if (!item) return state;

  const qtyNum = Number(quantity) || 1;
  const purchaseUnitCost = unitCost !== undefined && unitCost !== null ? Number(unitCost) : (Number(item.buyPrice) || 0);
  const cost = roundBDT(qtyNum * purchaseUnitCost);
  const walletKey = (sourceWallet && state.dayData.wallets?.[sourceWallet]) ? sourceWallet : 'hand_cash';

  const currentClosingStock = item.closingStock !== undefined && item.closingStock !== null
    ? Number(item.closingStock)
    : ((Number(item.openingStock) || 0) + (Number(item.addedStock) || 0));
  const existingValue = currentClosingStock * (Number(item.buyPrice) || 0);
  const newValue = qtyNum * purchaseUnitCost;
  const totalStock = currentClosingStock + qtyNum;
  const wacBuyPrice = totalStock > 0 ? roundBDT((existingValue + newValue) / totalStock) : purchaseUnitCost;
  const newBatch = createBatch(qtyNum, purchaseUnitCost, state.dayData.dateKey || Date.now());

  const newTx = {
    id: nextTxId('restock'),
    timestamp: Date.now(),
    type: 'stock_purchase',
    amount: cost,
    itemId: item.id,
    itemName: item.name,
    quantity: qtyNum,
    unitCost: purchaseUnitCost,
    batchId: newBatch.id,
    previousBuyPrice: item.buyPrice,
    unit: item.unit || 'পিস',
    fromWallet: walletKey,
    note: state.language === 'en'
      ? `${item.name} new stock purchase (${qtyNum} ${item.unit || 'pcs'} @ Tk ${purchaseUnitCost})`
      : `${item.name} নতুন স্টক ক্রয় (${qtyNum} ${item.unit || 'টি'} @ ৳${purchaseUnitCost})`,
  };

  const newWallets = { ...(state.dayData.wallets || {}) };
  newWallets[walletKey] = {
    ...(newWallets[walletKey] || { opening: 0, current: 0 }),
    current: roundBDT((newWallets[walletKey]?.current || 0) - cost),
  };

  const newInventory = state.dayData.inventory.map(inv => {
    if (inv.id === itemId) {
      const added = (Number(inv.addedStock) || 0) + qtyNum;
      return {
        ...inv,
        addedStock: added,
        closingStock: currentClosingStock + qtyNum,
        buyPrice: wacBuyPrice,
        batches: [...(inv.batches || []), newBatch],
      };
    }
    return inv;
  });

  const restockJournals = state.dayData.journalEntries || [];
  const restockJE = generateJournalEntry(newTx, { fromWallet: walletKey });
  const updatedRestockJournals = restockJE ? [...restockJournals, restockJE] : restockJournals;

  return {
    ...state,
    dayData: {
      ...state.dayData,
      wallets: newWallets,
      inventory: newInventory,
      transactions: [...(state.dayData.transactions || []), newTx],
      journalEntries: updatedRestockJournals,
    },
  };
}

/**
 * WRITE_OFF_DAMAGE — Consumes FIFO batches for damaged units, increments damagedStock,
 * reduces closingStock, and posts IAS 2 inventory_loss journal entry.
 */
export function writeOffDamageInState(state, payload = {}) {
  const { itemId, quantity = 1, reason = 'damage', note = '' } = payload;
  if (!state?.dayData?.inventory) return state;
  const item = state.dayData.inventory.find(i => i.id === itemId);
  if (!item) return state;

  const qtyNum = Number(quantity) || 1;
  const buyPrice = Number(item.buyPrice) || 0;
  const currentAvailable = (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0);
  const currentClosing = item.closingStock !== undefined && item.closingStock !== null
    ? Number(item.closingStock)
    : currentAvailable;
  const newClosing = Math.max(0, currentClosing - qtyNum);
  const actualDamagedUnits = currentClosing - newClosing;
  if (actualDamagedUnits <= 0) return state;

  const { totalCost: fifoLoss, remainingBatches, consumedDetails } = consumeFIFOBatches(
    item.batches || [],
    actualDamagedUnits,
    buyPrice
  );
  const lossAmount = fifoLoss > 0 ? roundBDT(fifoLoss) : roundBDT(actualDamagedUnits * buyPrice);

  const damageTx = {
    id: nextTxId('dmg'),
    timestamp: Date.now(),
    type: 'damage_loss',
    amount: lossAmount,
    itemId: item.id,
    itemName: item.name,
    quantity: actualDamagedUnits,
    unit: item.unit || 'পিস',
    consumedBatches: consumedDetails,
    reason,
    note: note || `${item.name} নষ্ট/ক্ষতিগ্রস্ত (${actualDamagedUnits} ${item.unit || 'টি'}) — ${reason}`,
  };

  const newInventory = state.dayData.inventory.map(inv =>
    inv.id === itemId
      ? {
          ...inv,
          closingStock: newClosing,
          damagedStock: (Number(inv.damagedStock) || 0) + actualDamagedUnits,
          batches: remainingBatches,
        }
      : inv
  );

  const existingJournals = state.dayData.journalEntries || [];
  const dmgJE = generateJournalEntry(damageTx);
  const newJournals = dmgJE ? [...existingJournals, dmgJE] : existingJournals;

  return {
    ...state,
    dayData: {
      ...state.dayData,
      inventory: newInventory,
      transactions: [...(state.dayData.transactions || []), damageTx],
      journalEntries: newJournals,
    },
  };
}

/**
 * APPLY_STOCK_AUDIT — Reconciles physical shelf count with system stock while preserving
 * 100% FIFO batch integrity and sales reporting accuracy:
 *   - Shortage (diff < 0): consumes oldest FIFO batches via consumeFIFOBatches(), increments
 *     `damagedStock` so missing units are NEVER counted as sold in `calcUnitsSold()`,
 *     records an individual reversible `damage_loss` transaction with `consumedBatches`,
 *     and posts a balanced `inventory_loss` / `inventory` journal entry.
 *   - Surplus (diff > 0): creates a new FIFO batch at `buyPrice`, increments `addedStock`
 *     so surplus units do not reduce `calcUnitsSold()`, records a reversible
 *     `stock_audit_surplus` transaction with `batchId`, and posts an `inventory` / `other_income` journal entry.
 */
export function applyStockAuditInState(state, payload = {}) {
  const adjustments = Array.isArray(payload) ? payload : (payload?.adjustments || []);
  const auditDate = Array.isArray(payload) ? undefined : payload?.auditDate;
  if (!state?.dayData?.inventory || !Array.isArray(adjustments) || adjustments.length === 0) {
    return state;
  }

  const effectiveAuditDate = auditDate || state.dayData.dateKey || new Date().toISOString().split('T')[0];
  const newAuditTxs = [];
  const newAuditJEs = [];

  const updatedInventory = state.dayData.inventory.map(item => {
    const adj = adjustments.find(a => a.itemId === item.id);
    if (!adj) return item;

    const systemStock = item.closingStock !== undefined && item.closingStock !== null
      ? Number(item.closingStock)
      : Math.max(0, (Number(item.openingStock) || 0) + (Number(item.addedStock) || 0) - (Number(item.damagedStock) || 0));
    const rawPhysical = adj.physicalCount ?? adj.physicalStock;
    const rawDiff = adj.diff ?? adj.variance;
    const physicalCount = rawPhysical !== undefined && rawPhysical !== null
      ? Math.max(0, Number(rawPhysical))
      : Math.max(0, systemStock + (Number(rawDiff) || 0));
    const diff = physicalCount - systemStock;

    if (diff === 0) return item;

    const unitCost = Number(item.buyPrice) || 0;

    if (diff < 0) {
      // Physical shortage: consume FIFO batches and increment damagedStock so shortage is never counted as sold
      const shortageQty = Math.abs(diff);
      const { totalCost: fifoLoss, remainingBatches, consumedDetails } = consumeFIFOBatches(
        item.batches || [],
        shortageQty,
        unitCost
      );
      const lossAmount = fifoLoss > 0 ? roundBDT(fifoLoss) : roundBDT(shortageQty * unitCost);

      const shortageTx = {
        id: nextTxId(`tx_audit_loss_${item.id}`),
        timestamp: Date.now(),
        type: 'damage_loss',
        subType: 'stock_audit_shortage',
        amount: lossAmount,
        itemId: item.id,
        itemName: item.name,
        quantity: shortageQty,
        unit: item.unit || 'পিস',
        consumedBatches: consumedDetails,
        previousClosingStock: systemStock,
        auditDate: effectiveAuditDate,
        reason: 'stock_audit_shortage',
        note: state.language === 'en'
          ? `Physical Stock Audit Shortage: ${item.name} (-${shortageQty} ${item.unit || 'pcs'})`
          : `স্টক অডিট ঘাটতি: ${item.name} (-${shortageQty} ${item.unit || 'টি'})`,
      };
      newAuditTxs.push(shortageTx);
      const lossJE = generateJournalEntry(shortageTx);
      if (lossJE) newAuditJEs.push(lossJE);

      return {
        ...item,
        closingStock: physicalCount,
        damagedStock: (Number(item.damagedStock) || 0) + shortageQty,
        batches: remainingBatches,
        lastAuditedAt: effectiveAuditDate,
      };
    } else {
      // Physical surplus: add new FIFO batch and increment addedStock so surplus doesn't mask prior sales
      const surplusQty = diff;
      const surplusBatch = createBatch(surplusQty, unitCost, effectiveAuditDate);
      const surplusAmount = roundBDT(surplusQty * unitCost);

      const surplusTx = {
        id: nextTxId(`tx_audit_gain_${item.id}`),
        timestamp: Date.now(),
        type: 'stock_audit_surplus',
        subType: 'stock_audit_surplus',
        amount: surplusAmount,
        itemId: item.id,
        itemName: item.name,
        quantity: surplusQty,
        unitCost,
        batchId: surplusBatch.id,
        previousClosingStock: systemStock,
        auditDate: effectiveAuditDate,
        unit: item.unit || 'পিস',
        note: state.language === 'en'
          ? `Physical Stock Audit Surplus: ${item.name} (+${surplusQty} ${item.unit || 'pcs'})`
          : `স্টক অডিট উদ্বৃত্ত: ${item.name} (+${surplusQty} ${item.unit || 'টি'})`,
      };
      newAuditTxs.push(surplusTx);
      const surplusJE = generateJournalEntry(surplusTx);
      if (surplusJE) newAuditJEs.push(surplusJE);

      return {
        ...item,
        addedStock: (Number(item.addedStock) || 0) + surplusQty,
        closingStock: physicalCount,
        batches: [...(item.batches || []), surplusBatch],
        lastAuditedAt: effectiveAuditDate,
      };
    }
  });

  if (newAuditTxs.length === 0) return state;

  return {
    ...state,
    dayData: {
      ...state.dayData,
      inventory: updatedInventory,
      transactions: [...(state.dayData.transactions || []), ...newAuditTxs],
      journalEntries: [...(state.dayData.journalEntries || []), ...newAuditJEs],
    },
    _auditEntry: {
      action: 'STOCK_AUDIT',
      txId: newAuditTxs[0].id,
      txData: { adjustmentsCount: newAuditTxs.length, auditDate: effectiveAuditDate },
      reversalTxData: null,
      reason: 'Physical stock audit adjustment',
      dateKey: state.dayData.dateKey,
    },
  };
}

/**
 * Reverses a single transaction's full state impact:
 *   1. Wallet balances (exact wallet used: fromWallet, toWallet, wallet, or hand_cash)
 *   2. Services counter
 *   3. Inventory (closingStock, addedStock, damagedStock, fifoSoldUnits, fifoCogs, and FIFO batches)
 *   4. Contact balances (Khata)
 *   5. ALL matching double-entry journal entries (including COGS entries)
 *   6. Marks original transaction as reversed and appends immutable reversal transaction
 */
export function reverseSingleTransactionInState(state, txId, options = {}) {
  if (!state?.dayData) return state;
  if (isPeriodLocked(state)) {
    if (!options.suppressAlert && typeof alert === 'function') {
      alert(
        state.language === 'en'
          ? `This transaction is within a locked fiscal period (locked through ${state.lockedPeriodEndDate}). Reversal/deletion is prohibited.`
          : `এই লেনদেনটি অডিট লক করা অর্থবছরের (${state.lockedPeriodEndDate} পর্যন্ত) হিসাবের অংশ। রিভার্সাল বা ডিলিট করা নিষিদ্ধ।`
      );
    }
    return state;
  }

  const resolvedTxId = typeof txId === 'object' && txId !== null ? (txId.txId || txId.id) : txId;
  const tx = (state.dayData.transactions || []).find(t => t.id === resolvedTxId);
  if (!tx || tx.reversed || tx.isReversal) return state;

  const reversalTx = {
    id: nextTxId('rev'),
    timestamp: Date.now(),
    type: tx.type,
    amount: tx.amount || 0,
    isReversal: true,
    originalTxId: tx.id,
    note: `↩️ রিভার্সাল: ${tx.note || tx.type}`,
    ...(tx.fromWallet && { fromWallet: tx.fromWallet }),
    ...(tx.toWallet && { toWallet: tx.toWallet }),
    ...(tx.wallet && { wallet: tx.wallet }),
    ...(tx.itemId && { itemId: tx.itemId, itemName: tx.itemName }),
    ...(tx.quantity && { quantity: tx.quantity }),
    ...(tx.serviceType && { serviceType: tx.serviceType }),
    ...(tx.contactId && { contactId: tx.contactId, customerName: tx.customerName }),
    ...(tx.profit !== undefined && { profit: -(tx.profit || 0) }),
    ...(tx.cogs !== undefined && { cogs: -(tx.cogs || 0) }),
  };

  const newWallets = { ...(state.dayData.wallets || {}) };
  const newServices = { ...(state.dayData.services || {}) };
  let newInventory = [...(state.dayData.inventory || [])];
  let newContacts = [...(state.contacts || [])];

  const creditWallet = (walletKey, amount) => {
    if (!walletKey || walletKey === '_courier_ar' || !newWallets[walletKey]) return;
    newWallets[walletKey] = {
      ...newWallets[walletKey],
      current: roundBDT((newWallets[walletKey]?.current || 0) + (Number(amount) || 0)),
    };
  };

  const debitWallet = (walletKey, amount) => {
    if (!walletKey || walletKey === '_courier_ar' || !newWallets[walletKey]) return;
    newWallets[walletKey] = {
      ...newWallets[walletKey],
      current: roundBDT((newWallets[walletKey]?.current || 0) - (Number(amount) || 0)),
    };
  };

  const sourceWallet = tx.fromWallet || tx.wallet || 'hand_cash';
  const destWallet = tx.toWallet || tx.wallet || 'hand_cash';

  if (['expense', 'personal_draw', 'owner_took', 'transfer_fee', 'asset_purchase', 'tax_payment'].includes(tx.type)) {
    creditWallet(sourceWallet, tx.amount);
  } else if (['owner_gave', 'asset_sale', 'loan_taken'].includes(tx.type)) {
    debitWallet(destWallet, tx.amount);
  } else if (tx.type === 'service_income') {
    debitWallet(destWallet, tx.amount);
    if (tx.serviceType && newServices[tx.serviceType]) {
      newServices[tx.serviceType] = roundBDT(Math.max(0, (newServices[tx.serviceType] || 0) - (tx.amount || 0)));
    }
  } else if (tx.type === 'stock_sale') {
    debitWallet(destWallet, tx.amount);
    if (tx.itemId) {
      newInventory = newInventory.map(item => {
        if (item.id === tx.itemId) {
          const currentClosing = item.closingStock !== undefined && item.closingStock !== null
            ? Number(item.closingStock)
            : ((Number(item.openingStock) || 0) + (Number(item.addedStock) || 0));
          const qtyRestored = Number(tx.quantity) || 1;
          const cogsRestored = tx.cogs !== undefined ? Number(tx.cogs) : roundBDT(qtyRestored * (item.buyPrice || 0));
          return {
            ...item,
            closingStock: currentClosing + qtyRestored,
            fifoSoldUnits: Math.max(0, (Number(item.fifoSoldUnits) || 0) - qtyRestored),
            fifoCogs: roundBDT(Math.max(0, (Number(item.fifoCogs) || 0) - cogsRestored)),
            fifoRevenue: roundBDT(Math.max(0, (Number(item.fifoRevenue) || 0) - (tx.amount || 0))),
            batches: restoreFIFOBatches(item.batches || [], tx.consumedBatches, qtyRestored, item.buyPrice),
          };
        }
        return item;
      });
    }
  } else if (tx.type === 'damage_loss' || tx.type === 'stock_damage') {
    if (tx.itemId) {
      newInventory = newInventory.map(item => {
        if (item.id === tx.itemId) {
          const currentClosing = item.closingStock !== undefined && item.closingStock !== null
            ? Number(item.closingStock)
            : ((Number(item.openingStock) || 0) + (Number(item.addedStock) || 0));
          const qtyRestored = Number(tx.quantity) || 1;
          return {
            ...item,
            closingStock: currentClosing + qtyRestored,
            damagedStock: Math.max(0, (Number(item.damagedStock) || 0) - qtyRestored),
            batches: restoreFIFOBatches(item.batches || [], tx.consumedBatches, qtyRestored, item.buyPrice),
          };
        }
        return item;
      });
    }
  } else if (tx.type === 'stock_audit_surplus') {
    if (tx.itemId) {
      const currentItem = (state.dayData.inventory || []).find(i => i.id === tx.itemId);
      if (currentItem) {
        const originalQty = Number(tx.quantity) || 0;
        const currentClosing = currentItem.closingStock !== undefined && currentItem.closingStock !== null
          ? Number(currentItem.closingStock)
          : ((Number(currentItem.openingStock) || 0) + (Number(currentItem.addedStock) || 0));
        if (currentClosing < originalQty) {
          console.warn(`[Ledgero] Cannot reverse surplus ${tx.id}: insufficient closingStock (${currentClosing}/${originalQty})`);
          return state;
        }
        if (tx.batchId) {
          const batch = (currentItem.batches || []).find(b => b.id === tx.batchId);
          if (batch) {
            const remaining = Number(batch.remainingQty) || 0;
            if (remaining < originalQty) {
              console.warn(`[Ledgero] Cannot reverse surplus ${tx.id}: batch ${tx.batchId} has ${remaining}/${originalQty} units remaining (${originalQty - remaining} consumed)`);
              return state;
            }
          } else {
            console.warn(`[Ledgero] Cannot reverse surplus ${tx.id}: batch ${tx.batchId} not found (fully consumed)`);
            return state;
          }
        }
      }
    }
    if (tx.itemId) {
      newInventory = newInventory.map(item => {
        if (item.id === tx.itemId) {
          const qtyRemoved = Number(tx.quantity) || 1;
          const currentClosing = item.closingStock !== undefined && item.closingStock !== null
            ? Number(item.closingStock)
            : ((Number(item.openingStock) || 0) + (Number(item.addedStock) || 0));
          let updatedBatches = [...(item.batches || [])];
          if (tx.batchId) {
            updatedBatches = updatedBatches.filter(b => b.id !== tx.batchId);
          }
          return {
            ...item,
            addedStock: Math.max(0, (Number(item.addedStock) || 0) - qtyRemoved),
            closingStock: Math.max(0, currentClosing - qtyRemoved),
            batches: updatedBatches,
          };
        }
        return item;
      });
    }
  } else if (tx.type === 'stock_purchase') {
    if (tx.itemId) {
      const currentItem = (state.dayData.inventory || []).find(i => i.id === tx.itemId);
      if (currentItem) {
        const originalQty = Number(tx.quantity) || 0;
        const currentClosing = currentItem.closingStock !== undefined && currentItem.closingStock !== null
          ? Number(currentItem.closingStock)
          : Number(currentItem.openingStock) || 0;
        if (currentClosing < originalQty) {
          console.warn(`[Ledgero] Cannot reverse purchase ${tx.id}: insufficient closingStock (${currentClosing}/${originalQty})`);
          return state;
        }
        if (tx.batchId) {
          const batch = (currentItem.batches || []).find(b => b.id === tx.batchId);
          if (batch) {
            const remaining = Number(batch.remainingQty) || 0;
            if (remaining < originalQty) {
              console.warn(`[Ledgero] Cannot reverse purchase ${tx.id}: batch ${tx.batchId} has ${remaining}/${originalQty} units remaining (${originalQty - remaining} consumed by downstream transactions)`);
              return state;
            }
          } else {
            console.warn(`[Ledgero] Cannot reverse purchase ${tx.id}: batch ${tx.batchId} not found (fully consumed)`);
            return state;
          }
        }
      }
    }
    creditWallet(sourceWallet, tx.amount);
    if (tx.itemId) {
      newInventory = newInventory.map(item => {
        if (item.id === tx.itemId) {
          const qtyRemoved = Number(tx.quantity) || 1;
          let updatedBatches = [...(item.batches || [])];
          if (tx.batchId) {
            updatedBatches = updatedBatches.filter(b => b.id !== tx.batchId);
          }
          const currentClosing = item.closingStock !== undefined && item.closingStock !== null
            ? Number(item.closingStock)
            : Number(item.openingStock) || 0;
          return {
            ...item,
            addedStock: Math.max(0, (Number(item.addedStock) || 0) - qtyRemoved),
            closingStock: Math.max(0, currentClosing - qtyRemoved),
            ...(tx.previousBuyPrice !== undefined ? { buyPrice: tx.previousBuyPrice } : {}),
            batches: updatedBatches,
          };
        }
        return item;
      });
    }
  } else if (tx.type === 'fund_transfer') {
    if (tx.fromWallet && tx.toWallet) {
      creditWallet(tx.fromWallet, tx.amount);
      debitWallet(tx.toWallet, tx.amount);
    }
  } else if (tx.type === 'recharge') {
    const cashInAmt = roundBDT((tx.amount || 0) + (tx.profit || 0));
    debitWallet('hand_cash', cashInAmt);
    if (tx.fromWallet) {
      creditWallet(tx.fromWallet, tx.amount);
    }
  } else if (['loan_collected', 'baki_received', 'due_collected', 'due_received', 'debt_collection'].includes(tx.type)) {
    debitWallet(destWallet, tx.amount);
    if (tx.contactId) {
      newContacts = newContacts.map(c =>
        c.id === tx.contactId ? { ...c, currentBalance: roundBDT((c.currentBalance || 0) + (tx.amount || 0)) } : c
      );
    }
  } else if (['loan_given', 'credit_sale', 'baki_given'].includes(tx.type)) {
    if (tx.type === 'loan_given') {
      creditWallet(sourceWallet, tx.amount);
    }
    if (tx.contactId) {
      newContacts = newContacts.map(c =>
        c.id === tx.contactId
          ? { ...c, currentBalance: roundBDT((c.currentBalance || 0) - (tx.amount || 0)) }
          : c
      );
    }
  } else if (['loan_repaid', 'debt_repaid'].includes(tx.type)) {
    creditWallet(sourceWallet, tx.amount);
    if (tx.contactId) {
      newContacts = newContacts.map(c =>
        c.id === tx.contactId ? { ...c, currentBalance: roundBDT((c.currentBalance || 0) + (tx.amount || 0)) } : c
      );
    }
  } else if (tx.type === 'cash_adjustment') {
    const adjAmt = Number(tx.amount) || 0;
    if (adjAmt > 0) {
      debitWallet('hand_cash', adjAmt);
    } else if (adjAmt < 0) {
      creditWallet('hand_cash', Math.abs(adjAmt));
    }
  }

  // Reverse ALL matching double-entry journal entries (including COGS entries!)
  const currentJournals = (state.dayData.journalEntries || []).filter(Boolean);
  const matchingJournals = currentJournals.filter(j => j.txId === tx.id && j.txType !== 'reversal');
  const reversalJournals = matchingJournals
    .map(j => generateReversalJournalEntry(j))
    .filter(Boolean);
  const updatedJournals = [...currentJournals, ...reversalJournals];

  const updatedTransactions = (state.dayData.transactions || []).map(t =>
    t.id === resolvedTxId
      ? { ...t, reversed: true, reversedAt: new Date().toISOString(), reversalTxId: reversalTx.id }
      : t
  );
  updatedTransactions.push(reversalTx);

  return {
    ...state,
    contacts: newContacts,
    dayData: {
      ...state.dayData,
      wallets: newWallets,
      services: newServices,
      inventory: newInventory,
      transactions: updatedTransactions,
      journalEntries: updatedJournals,
    },
    _auditEntry: {
      action: 'REVERSE',
      txId: tx.id,
      txData: { ...tx },
      reversalTxData: { ...reversalTx },
      reason: options.reason || 'Transaction reversed',
      dateKey: state.dayData.dateKey,
    },
  };
}

/**
 * BULK_DELETE_TRANSACTIONS — Reversal-safe bulk operation.
 * Applies full state reversal (wallets, inventory, FIFO batches, contacts, and ALL journal entries)
 * for every selected transaction ID, resolving inter-transaction dependencies via a multi-pass
 * retry loop, preserving accounting integrity and complete audit trail.
 */
export function bulkDeleteTransactionsInState(state, payload = {}, reasonArg) {
  const rawTxIds = Array.isArray(payload) ? payload : (payload?.txIds || []);
  const reason = Array.isArray(payload) ? (reasonArg || 'Bulk reversal') : (payload?.reason || 'Bulk reversal');
  if (!rawTxIds || rawTxIds.length === 0 || !state?.dayData) return state;

  const uniqueTxIds = [...new Set(rawTxIds.filter(Boolean))];
  if (uniqueTxIds.length === 0) return state;

  if (isPeriodLocked(state)) {
    if (typeof alert === 'function') {
      alert(
        state.language === 'en'
          ? `Selected transactions contain records within a locked fiscal period (locked through ${state.lockedPeriodEndDate}). Deletion is prohibited.`
          : `নির্বাচিত লেনদেনের মধ্যে অডিট লক করা অর্থবছরের (${state.lockedPeriodEndDate} পর্যন্ত) হিসাব রয়েছে। ডিলিট করা নিষিদ্ধ।`
      );
    }
    return state;
  }

  const existingTxs = state.dayData.transactions || [];
  const txMap = new Map(existingTxs.map(t => [t.id, t]));
  const notFoundIds = [];
  const alreadyReversedIds = [];
  const toReverseIds = [];

  for (const id of uniqueTxIds) {
    const tx = txMap.get(id);
    if (!tx) {
      notFoundIds.push(id);
    } else if (tx.reversed || tx.isReversal) {
      alreadyReversedIds.push(id);
    } else {
      toReverseIds.push(id);
    }
  }

  // Pre-filter: If every selected transaction is already reversed or not found, return immediately without re-auditing
  if (toReverseIds.length === 0) {
    const noOpReport = {
      totalRequested: uniqueTxIds.length,
      succeededCount: 0,
      failedCount: 0,
      alreadyReversedCount: alreadyReversedIds.length,
      notFoundCount: notFoundIds.length,
      succeededIds: [],
      failedIds: [],
      alreadyReversedIds,
      notFoundIds,
      isCompleteSuccess: false,
      nothingToReverse: true,
      timestamp: Date.now(),
    };
    const cleanState = {
      ...state,
      _bulkReversalReport: noOpReport,
      dayData: { ...state.dayData, _bulkReversalReport: noOpReport },
    };
    delete cleanState._auditEntry;
    delete cleanState._auditEntries;
    return cleanState;
  }

  // Pre-sort heuristic: Transactions that release consumed stock (sales, damage write-offs)
  // should ideally run before transactions that remove stock batches (purchases, surplus audits).
  const getSortWeight = (id) => {
    const tx = txMap.get(id);
    if (!tx) return 5;
    if (tx.type === 'stock_sale' || tx.type === 'cash_sale') return 1;
    if (tx.type === 'damage_loss') return 2;
    if (tx.type === 'expense' || tx.type === 'service_income') return 3;
    if (tx.type === 'stock_purchase' || tx.type === 'quick_restock') return 8;
    if (tx.type === 'stock_audit_surplus') return 9;
    return 5;
  };

  let pendingIds = [...toReverseIds].sort((a, b) => getSortWeight(a) - getSortWeight(b));
  let nextState = state;
  const auditEntries = [];
  const succeededIds = [];

  // Multi-pass retry loop: Continues as long as at least one dependent transaction was resolved in the pass
  // Bounded by MAX_PASSES to guarantee termination in any edge case
  const MAX_PASSES = Math.max(10, pendingIds.length + 5);
  let passCount = 0;
  let progressMade = true;
  while (pendingIds.length > 0 && progressMade && passCount < MAX_PASSES) {
    passCount++;
    progressMade = false;
    const stillPending = [];

    for (const id of pendingIds) {
      const txBefore = (nextState.dayData?.transactions || []).find(t => t.id === id);
      if (!txBefore || txBefore.reversed || txBefore.isReversal) {
        continue;
      }

      const trialState = reverseSingleTransactionInState(nextState, id, { suppressAlert: true, reason });
      const txAfter = (trialState.dayData?.transactions || []).find(t => t.id === id);

      // Verify true state change and actual reversal of this specific unreversed transaction
      if (trialState !== nextState && txAfter?.reversed === true && !txBefore.reversed) {
        nextState = trialState;
        progressMade = true;
        succeededIds.push(id);
        if (trialState._auditEntry && trialState._auditEntry.txId === id) {
          auditEntries.push(trialState._auditEntry);
        }
      } else {
        stillPending.push(id);
      }
    }

    pendingIds = stillPending;
  }

  const failedIds = [...pendingIds];
  const isCompleteSuccess = failedIds.length === 0 && alreadyReversedIds.length === 0 && notFoundIds.length === 0 && succeededIds.length > 0;
  const report = {
    totalRequested: uniqueTxIds.length,
    succeededCount: succeededIds.length,
    failedCount: failedIds.length,
    alreadyReversedCount: alreadyReversedIds.length,
    notFoundCount: notFoundIds.length,
    succeededIds,
    failedIds,
    alreadyReversedIds,
    notFoundIds,
    isCompleteSuccess,
    timestamp: Date.now(),
  };

  if (failedIds.length > 0) {
    console.warn(`[Ledgero] Bulk reversal partially failed: ${failedIds.length} transaction(s) could not be reversed due to unreversed dependencies:`, failedIds);
  }

  const resultState = {
    ...nextState,
    _bulkReversalReport: report,
    dayData: {
      ...nextState.dayData,
      _bulkReversalReport: report,
    },
  };
  delete resultState._auditEntry;
  delete resultState._auditEntries;

  if (auditEntries.length > 0) {
    resultState._auditEntry = auditEntries[auditEntries.length - 1];
    resultState._auditEntries = auditEntries;
  }

  return resultState;
}

/**
 * DELETE_BUSINESS — Removes business from state and switches activeBiz if needed.
 */
export function deleteBusinessInState(state, bizIdToDelete) {
  if (!state?.businesses || state.businesses.length <= 1) return state;
  const remainingBizs = state.businesses.filter(b => b.id !== bizIdToDelete);
  if (remainingBizs.length === state.businesses.length) return state;

  if (state.activeBizId === bizIdToDelete) {
    const newActiveBiz = remainingBizs[0];
    return {
      ...state,
      businesses: remainingBizs,
      activeBizId: newActiveBiz.id,
      activeBiz: newActiveBiz,
      contacts: [],
      dayData: null,
      isLoading: true,
      _deletedBizId: bizIdToDelete,
    };
  }

  return {
    ...state,
    businesses: remainingBizs,
    _deletedBizId: bizIdToDelete,
  };
}

function shouldRequireCatalogMatch(order, catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) return false;
  if (order?.source === 'web_storefront' || order?.isFromWebStore) return true;
  if (Array.isArray(order?.items) && order.items.some(it => it.productId || it.id)) return true;
  return false;
}

/**
 * Item 3: ONLINE_ORDER_CONFIRM with authoritative catalog, price, quantity, and stock verification.
 */
export function confirmOnlineOrderInState(state, payload = {}) {
  const orderId = typeof payload === 'string' ? payload : payload?.orderId;
  const advanceWallet = typeof payload === 'object' ? (payload?.advanceWallet || payload?.paymentWallet) : undefined;
  const advancePaid = typeof payload === 'object' ? (Number(payload?.advancePaid ?? payload?.verifiedAmount) || 0) : 0;
  const verifyPayment = typeof payload === 'object' ? Boolean(payload?.verifyPayment) : false;
  const verifiedTrxId = typeof payload === 'object' ? (payload?.verifiedTrxId || payload?.trxId) : undefined;

  const orderToConfirm = (state?.onlineOrders || []).find(o => o.id === orderId);
  if (!orderToConfirm) return state;

  // State transition enforcement: Can only confirm from 'draft' (or idempotent no-op if already 'confirmed')
  if (orderToConfirm.status !== 'draft') {
    if (orderToConfirm.status === 'confirmed' && !verifyPayment) {
      return state;
    }
    if (['packed', 'shipped', 'delivered', 'settled', 'cancelled', 'returned'].includes(orderToConfirm.status)) {
      return state;
    }
  }

  const isPrepaid = Boolean(orderToConfirm.paymentMethod && orderToConfirm.paymentMethod !== 'cod');

  // Gating: If order is prepaid, payment MUST be verified before confirmation,
  // unless this action explicitly performs payment verification (verifyPayment: true).
  if (isPrepaid && orderToConfirm.paymentStatus !== 'verified' && !verifyPayment) {
    const errObj = {
      orderId,
      action: 'ONLINE_ORDER_CONFIRM',
      code: 'payment_not_verified',
      verificationStatus: 'unverified_payment',
      message: state.language === 'en'
        ? 'Prepaid mobile banking order cannot be confirmed until payment is verified by shop owner.'
        : 'অগ্রিম মোবাইল ব্যাংকিং পেমেন্ট যাচাই না করা পর্যন্ত অর্ডার কনফার্ম করা যাবে না।',
    };
    return {
      ...state,
      _orderVerificationError: errObj,
      _orderPaymentVerificationError: errObj,
    };
  }

  const catalog = state?.dayData?.inventory || [];
  const requireMatch = shouldRequireCatalogMatch(orderToConfirm, catalog);
  const check = verifyOrderAgainstCatalog(orderToConfirm, catalog, {
    requireCatalogMatch: requireMatch,
    checkStockLevel: requireMatch,
  });

  if (!check.valid) {
    const updatedOrders = (state.onlineOrders || []).map(o =>
      o.id === orderId
        ? {
            ...o,
            priceVerified: false,
            verificationStatus: check.verificationStatus,
            verificationIssues: check.issues,
          }
        : o
    );
    const errObj = {
      orderId,
      action: 'ONLINE_ORDER_CONFIRM',
      verificationStatus: check.verificationStatus,
      issues: check.issues,
    };
    return {
      ...state,
      onlineOrders: updatedOrders,
      _orderVerificationError: errObj,
      _orderIntegrityError: errObj,
    };
  }

  const isAlreadyVerified = orderToConfirm.paymentStatus === 'verified' || Boolean(orderToConfirm.paymentVerifiedAt);
  const willBeVerified = verifyPayment || isAlreadyVerified;
  const isDirectVerification = Boolean(verifyPayment);

  // Strict amount validation when verifying payment directly
  const maxPayable = Number(orderToConfirm.totalAmount) || 0;
  let effectiveAdvancePaid = Number(orderToConfirm.advancePaid) || 0;

  if (isDirectVerification && !isAlreadyVerified) {
    const rawAmt = payload?.advancePaid ?? payload?.verifiedAmount ?? payload?.amount;
    const parsedAmt = Number(rawAmt);

    // Reject non-finite, <=0, and amounts exceeding order total
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0 || parsedAmt > maxPayable) {
      const errObj = {
        orderId,
        code: 'invalid_payment_amount',
        action: 'ONLINE_ORDER_CONFIRM',
        message: !Number.isFinite(parsedAmt) || parsedAmt <= 0
          ? 'Payment amount must be greater than zero'
          : `Payment amount (৳${parsedAmt}) exceeds order payable total (৳${maxPayable})`,
      };
      return {
        ...state,
        _orderPaymentVerificationError: errObj,
      };
    }
    effectiveAdvancePaid = roundBDT(parsedAmt);
  } else if (!isAlreadyVerified && advancePaid > 0) {
    effectiveAdvancePaid = Math.min(maxPayable, roundBDT(advancePaid));
  }

  let updatedWallets = state.dayData?.wallets ? { ...state.dayData.wallets } : {};
  let effectiveAdvanceWallet = payload?.paymentWallet || payload?.walletKey || payload?.advanceWallet || orderToConfirm.advanceWallet;

  // If wallet was omitted for prepaid order, try to resolve to a recommended matching wallet
  if (!effectiveAdvanceWallet && isPrepaid) {
    const recommended = getRecommendedWalletForPayment(orderToConfirm.paymentMethod, updatedWallets);
    if (recommended) {
      effectiveAdvanceWallet = recommended;
    }
  }

  // Validate receiving wallet exists and is strictly compatible with payment method
  if (isDirectVerification && !isAlreadyVerified && effectiveAdvancePaid > 0) {
    const isCompatible = isWalletCompatibleWithPayment(orderToConfirm.paymentMethod, effectiveAdvanceWallet);
    if (!effectiveAdvanceWallet || !updatedWallets[effectiveAdvanceWallet] || !isCompatible) {
      const errObj = {
        orderId,
        code: 'invalid_receiving_wallet',
        action: 'ONLINE_ORDER_CONFIRM',
        message: !effectiveAdvanceWallet
          ? `A valid receiving wallet matching payment method '${orderToConfirm.paymentMethod}' is required for payment verification`
          : !updatedWallets[effectiveAdvanceWallet]
            ? `Receiving wallet '${effectiveAdvanceWallet}' does not exist in active ledger`
            : `Receiving wallet '${effectiveAdvanceWallet}' is incompatible with payment method '${orderToConfirm.paymentMethod}'`,
      };
      return {
        ...state,
        _orderPaymentVerificationError: errObj,
      };
    }
  }

  const allowWithoutTrxId = Boolean(payload?.allowWithoutTrxId);
  const withoutTrxIdReason = String(payload?.withoutTrxIdReason || '').trim();
  const effectiveTrxId = allowWithoutTrxId
    ? ''
    : (verifiedTrxId || orderToConfirm.verifiedTrxId || orderToConfirm.paymentTrxId || '');

  const effectivePaymentStatus = isPrepaid
    ? (willBeVerified ? 'verified' : (orderToConfirm.paymentStatus || 'awaiting_payment'))
    : (orderToConfirm.paymentStatus || 'due_on_delivery');

  const orders = (state.onlineOrders || []).map(o => {
    if (o.id !== orderId) return o;
    return {
      ...o,
      status: 'confirmed',
      confirmedAt: o.confirmedAt || Date.now(),
      priceVerified: true,
      verificationStatus: 'verified',
      verificationIssues: [],
      paymentStatus: effectivePaymentStatus,
      paymentVerifiedAt: willBeVerified ? (o.paymentVerifiedAt || Date.now()) : o.paymentVerifiedAt,
      verifiedTrxId: effectiveTrxId || o.verifiedTrxId,
      paymentTrxId: effectiveTrxId || o.paymentTrxId,
      advanceWallet: effectiveAdvanceWallet,
      paymentWallet: effectiveAdvanceWallet,
      advancePaid: effectiveAdvancePaid,
      codAmount: Math.max(0, roundBDT(maxPayable - effectiveAdvancePaid)),
      statusHistory: isAlreadyVerified ? o.statusHistory : [
        ...(o.statusHistory || []),
        {
          status: 'confirmed',
          timestamp: Date.now(),
          note: effectiveAdvancePaid > 0 
            ? `Advance ৳${effectiveAdvancePaid} received via ${effectiveAdvanceWallet}${effectiveTrxId ? ` (TrxID: ${effectiveTrxId})` : ''}` 
            : (isPrepaid ? 'Payment verified & order confirmed' : 'Order confirmed (COD)'),
        },
      ],
    };
  });

  // Idempotent wallet credit: Credit ONLY when newly verified on unverified order
  let advanceTx = null;
  const shouldCreditAdvance = (isDirectVerification && !isAlreadyVerified && effectiveAdvancePaid > 0);
  if (shouldCreditAdvance && effectiveAdvanceWallet && updatedWallets[effectiveAdvanceWallet]) {
    updatedWallets[effectiveAdvanceWallet] = {
      ...updatedWallets[effectiveAdvanceWallet],
      current: roundBDT((Number(updatedWallets[effectiveAdvanceWallet].current) || 0) + effectiveAdvancePaid),
    };
    advanceTx = {
      id: nextTxId('oo_adv'),
      timestamp: Date.now(),
      type: 'service_income',
      subType: 'online_order_advance',
      amount: effectiveAdvancePaid,
      wallet: effectiveAdvanceWallet,
      note:
        state.language === 'en'
          ? `📦 Online order advance (Order #${String(orderId).slice(-6)}${effectiveTrxId ? `, TrxID: ${effectiveTrxId}` : ''})`
          : `📦 অনলাইন অর্ডার অগ্রিম (অর্ডার #${String(orderId).slice(-6)}${effectiveTrxId ? `, TrxID: ${effectiveTrxId}` : ''})`,
      linkedOrderId: orderId,
      isAutoGenerated: true,
    };
  }

  let advanceJE = null;
  if (advanceTx) {
    advanceJE = {
      id: `je_adv_${advanceTx.id}`,
      timestamp: advanceTx.timestamp,
      txId: advanceTx.id,
      txType: 'online_order_advance',
      description: `Online Order Advance: #${String(orderId).slice(-6)}`,
      lines: [
        { accountId: mapWalletToAccount(advanceTx.wallet), debit: advanceTx.amount, credit: 0 },
        { accountId: 'customer_advance', debit: 0, credit: advanceTx.amount },
      ],
    };
  }

  const nextState = {
    ...state,
    onlineOrders: orders,
    dayData: state.dayData
      ? {
          ...state.dayData,
          wallets: updatedWallets,
          transactions: advanceTx
            ? [...(state.dayData.transactions || []), advanceTx]
            : state.dayData.transactions || [],
          journalEntries: advanceJE
            ? [...(state.dayData.journalEntries || []), advanceJE]
            : state.dayData.journalEntries || [],
        }
      : state.dayData,
  };
  delete nextState._orderVerificationError;
  delete nextState._orderPaymentVerificationError;
  delete nextState._orderIntegrityError;
  return nextState;
}

/**
 * Item 3: ONLINE_ORDER_PACK with authoritative catalog, price, quantity, and stock verification.
 */
export function packOnlineOrderInState(state, payload) {
  const packOrderId = typeof payload === 'string' ? payload : payload?.orderId;
  const orderToPack = (state?.onlineOrders || []).find(o => o.id === packOrderId);
  if (!orderToPack) return state;

  // Idempotency: If already packed, shipped, delivered, or settled, return state immediately without deducting stock again
  if (['packed', 'shipped', 'delivered', 'settled'].includes(orderToPack.status)) {
    return state;
  }

  // State transition enforcement: Can only pack from 'confirmed'
  if (orderToPack.status !== 'confirmed') {
    return state;
  }

  const isPrepaid = Boolean(orderToPack.paymentMethod && orderToPack.paymentMethod !== 'cod');
  if (isPrepaid && orderToPack.paymentStatus !== 'verified') {
    const errObj = {
      orderId: packOrderId,
      action: 'ONLINE_ORDER_PACK',
      code: 'payment_not_verified',
      verificationStatus: 'unverified_payment',
      message: state.language === 'en'
        ? 'Prepaid mobile banking order cannot be packed until payment is verified by shop owner.'
        : 'অগ্রিম পেমেন্ট যাচাই না করা পর্যন্ত অর্ডার প্যাক করা যাবে না।',
    };
    return {
      ...state,
      _orderVerificationError: errObj,
      _orderPaymentVerificationError: errObj,
    };
  }

  const catalog = state?.dayData?.inventory || [];
  const requireMatch = shouldRequireCatalogMatch(orderToPack, catalog);
  const check = verifyOrderAgainstCatalog(orderToPack, catalog, {
    requireCatalogMatch: requireMatch,
    checkStockLevel: true,
  });

  if (!check.valid) {
    const updatedOrders = (state.onlineOrders || []).map(o =>
      o.id === packOrderId
        ? {
            ...o,
            priceVerified: false,
            verificationStatus: check.verificationStatus,
            verificationIssues: check.issues,
          }
        : o
    );
    const errObj = {
      orderId: packOrderId,
      action: 'ONLINE_ORDER_PACK',
      verificationStatus: check.verificationStatus,
      issues: check.issues,
    };
    return {
      ...state,
      onlineOrders: updatedOrders,
      _orderVerificationError: errObj,
      _orderIntegrityError: errObj,
    };
  }

  const packedOrders = (state.onlineOrders || []).map(o => {
    if (o.id !== packOrderId) return o;
    return {
      ...o,
      status: 'packed',
      priceVerified: true,
      verificationStatus: 'verified',
      verificationIssues: [],
      statusHistory: [...(o.statusHistory || []), { status: 'packed', timestamp: Date.now(), note: '' }],
    };
  });

  let updatedInventory = [...(state.dayData?.inventory || [])];
  (orderToPack.items || []).forEach(item => {
    const pid = item.productId || item.id;
    if (pid) {
      updatedInventory = updatedInventory.map(inv => {
        if (String(inv.id) === String(pid)) {
          return {
            ...inv,
            closingStock: Math.max(0, (Number(inv.closingStock) || 0) - (Number(item.quantity) || 0)),
          };
        }
        return inv;
      });
    }
  });

  const nextState = {
    ...state,
    onlineOrders: packedOrders,
    dayData: state.dayData ? { ...state.dayData, inventory: updatedInventory } : state.dayData,
  };
  delete nextState._orderVerificationError;
  delete nextState._orderPaymentVerificationError;
  delete nextState._orderIntegrityError;
  return nextState;
}

/**
 * Dedicated payment verification action: Owner verifies money received into their wallet.
 */
export function verifyOnlineOrderPaymentInState(state, payload = {}) {
  const orderId = typeof payload === 'string' ? payload : payload?.orderId;
  const order = (state?.onlineOrders || []).find(o => o.id === orderId);
  if (!order) return state;

  // Idempotency: If already verified, never credit wallet again
  if (order.paymentStatus === 'verified' || order.paymentVerifiedAt) {
    return state;
  }

  // P0 Bug 2: Check order status
  if (
    ['cancelled', 'returned', 'delivered', 'settled'].includes(order.status) ||
    !['draft', 'confirmed', 'packed', 'shipped'].includes(order.status)
  ) {
    const errObj = {
      orderId,
      code: 'invalid_order_status_for_verification',
      action: 'ONLINE_ORDER_VERIFY_PAYMENT',
      status: order.status,
      message: `Cannot verify payment for order #${String(orderId).slice(-6)} in '${order.status}' status. Payment can only be verified for active pre-delivery orders (draft, confirmed, packed, shipped).`,
    };
    return {
      ...state,
      _orderPaymentVerificationError: errObj,
    };
  }

  const rawAmount = payload?.verifiedAmount ?? payload?.advancePaid ?? payload?.amount;
  const maxPayable = Number(order.totalAmount) || 0;
  const parsedAmount = parseStrictMoney(rawAmount, null, true);

  // Strict amount validation
  if (parsedAmount === null || parsedAmount <= 0 || parsedAmount > maxPayable) {
    const errObj = {
      orderId,
      code: 'invalid_payment_amount',
      action: 'ONLINE_ORDER_VERIFY_PAYMENT',
      message: parsedAmount === null || parsedAmount <= 0
        ? 'Payment amount must be greater than zero'
        : `Payment amount (৳${parsedAmount}) exceeds order payable total (৳${maxPayable})`,
    };
    return {
      ...state,
      _orderPaymentVerificationError: errObj,
    };
  }

  const verifiedAmount = roundBDT(parsedAmount);
  let updatedWallets = state.dayData?.wallets ? { ...state.dayData.wallets } : {};
  let paymentWallet = payload?.paymentWallet || payload?.walletKey || payload?.advanceWallet || order.advanceWallet;

  if (!paymentWallet) {
    const recommended = getRecommendedWalletForPayment(order.paymentMethod, updatedWallets);
    if (recommended) {
      paymentWallet = recommended;
    }
  }

  // Validate receiving wallet exists and is strictly compatible with payment method
  const isCompatible = isWalletCompatibleWithPayment(order.paymentMethod, paymentWallet);
  if (!paymentWallet || !updatedWallets[paymentWallet] || !isCompatible) {
    const errObj = {
      orderId,
      code: 'invalid_receiving_wallet',
      action: 'ONLINE_ORDER_VERIFY_PAYMENT',
      message: !paymentWallet
        ? `A valid receiving wallet matching payment method '${order.paymentMethod}' is required for payment verification`
        : !updatedWallets[paymentWallet]
          ? `Receiving wallet '${paymentWallet}' does not exist in active ledger`
          : `Receiving wallet '${paymentWallet}' is incompatible with payment method '${order.paymentMethod}'`,
    };
    return {
      ...state,
      _orderPaymentVerificationError: errObj,
    };
  }

  const allowWithoutTrxId = Boolean(payload?.allowWithoutTrxId);
  const withoutTrxIdReason = String(payload?.withoutTrxIdReason || '').trim();
  const verifiedTrxId = allowWithoutTrxId
    ? ''
    : String(payload?.trxId || payload?.verifiedTrxId || order.paymentTrxId || '').trim();
  const normTrx = verifiedTrxId.toUpperCase();

  const isMfs = ['bkash_manual', 'nagad_manual', 'rocket_manual'].includes(order.paymentMethod);
  if (isMfs) {
    if (!allowWithoutTrxId && !normTrx) {
      const errObj = {
        orderId,
        code: 'missing_trx_id',
        action: 'ONLINE_ORDER_VERIFY_PAYMENT',
        paymentMethod: order.paymentMethod,
        message: state.language === 'en'
          ? `Transaction ID (TrxID) is mandatory for mobile banking (${order.paymentMethod.replace('_manual', '').toUpperCase()}) payment verification.`
          : `মোবাইল ব্যাংকিং (${order.paymentMethod.replace('_manual', '').toUpperCase()}) পেমেন্ট যাচাইয়ের জন্য ট্রানজ্যাকশন আইডি (TrxID) আবশ্যক।`,
      };
      return {
        ...state,
        _orderPaymentVerificationError: errObj,
      };
    }

    if (allowWithoutTrxId) {
      if (!withoutTrxIdReason || withoutTrxIdReason.length < 5) {
        const errObj = {
          orderId,
          code: 'missing_exception_reason',
          action: 'ONLINE_ORDER_VERIFY_PAYMENT',
          paymentMethod: order.paymentMethod,
          message: state.language === 'en'
            ? 'At least 5 characters reason is required for verification without TrxID.'
            : 'TrxID ছাড়া ম্যানুয়াল যাচাইয়ের জন্য কমপক্ষে ৫ অক্ষরের কারণ দেওয়া আবশ্যক।',
        };
        return {
          ...state,
          _orderPaymentVerificationError: errObj,
        };
      }
    }
  }

  // P0 Bug 3: Provider-scoped TrxID uniqueness
  if (normTrx) {
    const provider = String(order.paymentMethod || '').replace(/_manual$/, '').toLowerCase();
    const conflictingOrder = (state.onlineOrders || []).find(o => {
      if (String(o.id) === String(orderId)) return false;
      if (o.paymentStatus !== 'verified') return false;
      const otherProvider = String(o.paymentMethod || '').replace(/_manual$/, '').toLowerCase();
      if (otherProvider !== provider) return false;
      const otherTrx = String(o.verifiedTrxId || o.paymentTrxId || '').trim().toUpperCase();
      return otherTrx && otherTrx === normTrx;
    });

    if (conflictingOrder) {
      const errObj = {
        orderId,
        code: 'duplicate_trx_id',
        action: 'ONLINE_ORDER_VERIFY_PAYMENT',
        trxId: verifiedTrxId,
        provider,
        conflictingOrderId: conflictingOrder.id,
        message: `Transaction ID '${verifiedTrxId}' has already been verified for order #${String(conflictingOrder.id).slice(-6)} (${provider.toUpperCase()}). Duplicate TrxID reuse is forbidden.`,
      };
      return {
        ...state,
        _orderPaymentVerificationError: errObj,
      };
    }
  }

  const note = payload?.note || '';

  const orders = (state.onlineOrders || []).map(o => {
    if (o.id !== orderId) return o;
    return {
      ...o,
      paymentStatus: 'verified',
      paymentVerifiedAt: Date.now(),
      paymentWallet,
      advanceWallet: paymentWallet,
      advancePaid: verifiedAmount,
      codAmount: Math.max(0, roundBDT(maxPayable - verifiedAmount)),
      verifiedTrxId: normTrx || (allowWithoutTrxId ? '' : (o.verifiedTrxId || o.paymentTrxId || '')),
      paymentTrxId: normTrx || (allowWithoutTrxId ? '' : (o.paymentTrxId || '')),
      allowWithoutTrxId,
      withoutTrxIdReason: allowWithoutTrxId ? withoutTrxIdReason : undefined,
      statusHistory: [
        ...(o.statusHistory || []),
        {
          status: 'payment_verified',
          timestamp: Date.now(),
          note: `Payment ৳${verifiedAmount} verified in ${paymentWallet}${normTrx ? ` (TrxID: ${normTrx})` : (allowWithoutTrxId ? ` (Manual exception: ${withoutTrxIdReason})` : '')}${note ? ` - ${note}` : ''}`,
        },
      ],
    };
  });

  updatedWallets[paymentWallet] = {
    ...updatedWallets[paymentWallet],
    current: roundBDT((Number(updatedWallets[paymentWallet].current) || 0) + verifiedAmount),
  };
  const advanceTx = {
    id: nextTxId('oo_adv'),
    timestamp: Date.now(),
    type: 'service_income',
    subType: 'online_order_advance',
    amount: verifiedAmount,
    wallet: paymentWallet,
    note: state.language === 'en'
      ? `📦 Online order payment verified (Order #${String(orderId).slice(-6)}${verifiedTrxId ? `, TrxID: ${verifiedTrxId}` : ''})`
      : `📦 অনলাইন অর্ডার পেমেন্ট যাচাইকৃত (অর্ডার #${String(orderId).slice(-6)}${verifiedTrxId ? `, TrxID: ${verifiedTrxId}` : ''})`,
    linkedOrderId: orderId,
    isAutoGenerated: true,
  };

  const advanceJE = {
    id: `je_adv_${advanceTx.id}`,
    timestamp: advanceTx.timestamp,
    txId: advanceTx.id,
    txType: 'online_order_advance',
    description: `Online Order Payment Verified: #${String(orderId).slice(-6)}`,
    lines: [
      { accountId: mapWalletToAccount(advanceTx.wallet), debit: advanceTx.amount, credit: 0 },
      { accountId: 'customer_advance', debit: 0, credit: advanceTx.amount },
    ],
  };

  const nextState = {
    ...state,
    onlineOrders: orders,
    dayData: state.dayData ? {
      ...state.dayData,
      wallets: updatedWallets,
      transactions: [...(state.dayData.transactions || []), advanceTx],
      journalEntries: [...(state.dayData.journalEntries || []), advanceJE],
      verifiedOrderIds: Array.from(new Set([...(state.dayData.verifiedOrderIds || []), String(orderId)])),
      orderPaymentVerifications: {
        ...(state.dayData.orderPaymentVerifications || {}),
        [String(orderId)]: {
          wallet: paymentWallet,
          amount: verifiedAmount,
          verifiedAt: Date.now(),
        },
      },
    } : state.dayData,
  };
  delete nextState._orderVerificationError;
  delete nextState._orderPaymentVerificationError;
  delete nextState._orderIntegrityError;
  return nextState;
}

/**
 * Owner rejects claimed payment (e.g. invalid TrxID / fake SMS).
 */
export function rejectOnlineOrderPaymentInState(state, payload = {}) {
  const orderId = typeof payload === 'string' ? payload : payload?.orderId;
  const order = (state?.onlineOrders || []).find(o => o.id === orderId);
  if (!order) return state;

  const reason = payload?.reason || (state.language === 'en' ? 'Payment not received / invalid TrxID' : 'পেমেন্ট পাওয়া যায়নি / ভুল TrxID');

  const orders = (state.onlineOrders || []).map(o => {
    if (o.id !== orderId) return o;
    return {
      ...o,
      paymentStatus: 'rejected',
      paymentRejectedAt: Date.now(),
      paymentRejectionReason: reason,
      statusHistory: [
        ...(o.statusHistory || []),
        {
          status: 'payment_rejected',
          timestamp: Date.now(),
          note: `Payment rejected: ${reason}`,
        },
      ],
    };
  });

  return {
    ...state,
    onlineOrders: orders,
  };
}

/**
 * Item 3: ONLINE_ORDER_DELIVER with authoritative catalog, price, quantity, and stock verification.
 */
export function deliverOnlineOrderInState(state, payload) {
  const deliverOrderId = typeof payload === 'string' ? payload : payload?.orderId;
  const walletKey = typeof payload === 'object' ? payload?.walletKey : undefined;
  const orderToDeliver = (state?.onlineOrders || []).find(o => o.id === deliverOrderId);
  if (!orderToDeliver) return state;

  // Idempotency: If already delivered or settled, return state immediately without touching inventory, wallets or journals
  if (['delivered', 'settled'].includes(orderToDeliver.status) || Boolean(orderToDeliver.deliveredAt)) {
    return state;
  }

  const catalog = state?.dayData?.inventory || [];
  const requireMatch = shouldRequireCatalogMatch(orderToDeliver, catalog);
  const alreadyPackedOrShipped = orderToDeliver.status === 'packed' || orderToDeliver.status === 'shipped';
  const check = verifyOrderAgainstCatalog(orderToDeliver, catalog, {
    requireCatalogMatch: requireMatch,
    checkStockLevel: !alreadyPackedOrShipped && requireMatch,
  });

  if (!check.valid) {
    const updatedOrders = (state.onlineOrders || []).map(o =>
      o.id === deliverOrderId
        ? {
            ...o,
            priceVerified: false,
            verificationStatus: check.verificationStatus,
            verificationIssues: check.issues,
          }
        : o
    );
    const errObj = {
      orderId: deliverOrderId,
      action: 'ONLINE_ORDER_DELIVER',
      verificationStatus: check.verificationStatus,
      issues: check.issues,
    };
    return {
      ...state,
      onlineOrders: updatedOrders,
      _orderVerificationError: errObj,
      _orderIntegrityError: errObj,
    };
  }

  // State transition enforcement: Can only deliver from 'shipped'
  if (orderToDeliver.status !== 'shipped') {
    return state;
  }

  const deliveredOrders = (state.onlineOrders || []).map(o => {
    if (o.id !== deliverOrderId) return o;
    const isCod = !o.paymentMethod || o.paymentMethod === 'cod';
    return {
      ...o,
      status: 'delivered',
      deliveredAt: Date.now(),
      priceVerified: true,
      verificationStatus: 'verified',
      verificationIssues: [],
      paymentStatus: isCod ? 'paid_on_delivery' : (o.paymentStatus || 'verified'),
      statusHistory: [
        ...(o.statusHistory || []),
        { status: 'delivered', timestamp: Date.now(), note: isCod ? 'IFRS 15: Revenue recognized & COD collected' : 'IFRS 15: Revenue recognized' },
      ],
    };
  });

  let updatedInventory = [...(state.dayData?.inventory || [])];
  let computedCogs = 0;

  (orderToDeliver.items || []).forEach(item => {
    const pid = item.productId || item.id;
    const qty = Number(item.quantity) || 1;
    const itemRevenue = Number(item.subtotal ?? (qty * (Number(item.unitPrice ?? item.price) || 0))) || 0;
    let matchedItem = false;

    if (pid) {
      updatedInventory = updatedInventory.map(inv => {
        if (String(inv.id) === String(pid)) {
          matchedItem = true;
          const fifoRes = consumeFIFOBatches(inv.batches || [], qty, inv.buyPrice);
          const itemCogs = roundBDT(fifoRes.totalCost > 0 ? fifoRes.totalCost : ((Number(item.buyPrice ?? inv.buyPrice ?? 0) || 0) * qty));
          computedCogs = roundBDT(computedCogs + itemCogs);
          return {
            ...inv,
            closingStock: alreadyPackedOrShipped
              ? Number(inv.closingStock) || 0
              : Math.max(0, (Number(inv.closingStock) || 0) - qty),
            fifoSoldUnits: (Number(inv.fifoSoldUnits) || 0) + qty,
            fifoCogs: roundBDT((Number(inv.fifoCogs) || 0) + itemCogs),
            fifoRevenue: roundBDT((Number(inv.fifoRevenue) || 0) + itemRevenue),
            batches: fifoRes.remainingBatches || inv.batches || [],
          };
        }
        return inv;
      });
    }

    if (!matchedItem) {
      const unitCost = Number(item.buyPrice ?? 0) || 0;
      computedCogs = roundBDT(computedCogs + unitCost * qty);
    }
  });

  const revenueAmount = Number(orderToDeliver.totalAmount) || 0;
  let updatedWallets = state.dayData?.wallets ? { ...state.dayData.wallets } : undefined;
  if (walletKey && updatedWallets && updatedWallets[walletKey]) {
    updatedWallets = {
      ...updatedWallets,
      [walletKey]: {
        ...updatedWallets[walletKey],
        current: roundBDT((Number(updatedWallets[walletKey].current) || 0) + revenueAmount),
      },
    };
  }

  const advancePaid = Number(orderToDeliver.advancePaid) || 0;
  const codAmount = orderToDeliver.codAmount !== undefined ? Number(orderToDeliver.codAmount) : Math.max(0, roundBDT(revenueAmount - advancePaid));

  const saleTx = {
    id: nextTxId('oo_sale'),
    timestamp: Date.now(),
    type: 'stock_sale',
    subType: 'online_order_sale',
    amount: revenueAmount,
    advancePaid,
    codAmount,
    profit: roundBDT(revenueAmount - computedCogs),
    costAmount: computedCogs,
    costOfGoods: computedCogs,
    note:
      state.language === 'en'
        ? `📦 Online order delivered (Order #${String(deliverOrderId).slice(-6)}) — COD ৳${codAmount} via ${orderToDeliver.courierName || 'courier'}`
        : `📦 অনলাইন অর্ডার ডেলিভারি সফল (অর্ডার #${String(deliverOrderId).slice(-6)}) — COD ৳${codAmount} কুরিয়ার: ${orderToDeliver.courierName || ''}`,
    wallet: walletKey || (advancePaid > 0 ? (orderToDeliver.advanceWallet || 'hand_cash') : '_courier_ar'),
    linkedOrderId: deliverOrderId,
    isAutoGenerated: true,
    items: orderToDeliver.items,
  };

  const deliverStats = { ...(state.dayData?.onlineOrdersDayStats || {}) };
  deliverStats.delivered = (deliverStats.delivered || 0) + 1;
  deliverStats.revenue = (deliverStats.revenue || 0) + revenueAmount;

  // Double-Entry Journal Entries (IFRS 15 & IAS 2)
  const revenueLines = [];
  if (advancePaid > 0) {
    revenueLines.push({ accountId: 'customer_advance', debit: advancePaid, credit: 0 });
  }
  if (codAmount > 0) {
    revenueLines.push({ accountId: 'courier_receivable', debit: codAmount, credit: 0 });
  }
  if (revenueLines.length === 0) {
    revenueLines.push({ accountId: mapWalletToAccount(walletKey || orderToDeliver.advanceWallet), debit: revenueAmount, credit: 0 });
  }
  revenueLines.push({ accountId: 'sales_revenue', debit: 0, credit: revenueAmount });

  const salesJE = {
    id: `je_sale_${saleTx.id}`,
    timestamp: saleTx.timestamp,
    txId: saleTx.id,
    txType: 'stock_sale',
    description: `Online Order Delivered: #${String(deliverOrderId).slice(-6)}`,
    lines: revenueLines,
  };

  const cogsJE = computedCogs > 0 ? {
    id: `je_cogs_${saleTx.id}`,
    timestamp: saleTx.timestamp,
    txId: saleTx.id,
    txType: 'cogs_recognition',
    description: `COGS — Online Order #${String(deliverOrderId).slice(-6)}`,
    lines: [
      { accountId: 'cogs', debit: computedCogs, credit: 0 },
      { accountId: 'inventory', debit: 0, credit: computedCogs },
    ],
  } : null;

  const nextState = {
    ...state,
    onlineOrders: deliveredOrders,
    dayData: state.dayData
      ? {
          ...state.dayData,
          ...(updatedWallets ? { wallets: updatedWallets } : {}),
          inventory: updatedInventory,
          transactions: [...(state.dayData.transactions || []), saleTx],
          journalEntries: [...(state.dayData.journalEntries || []), salesJE, ...(cogsJE ? [cogsJE] : [])],
          onlineOrdersDayStats: deliverStats,
        }
      : state.dayData,
  };
  delete nextState._orderVerificationError;
  delete nextState._orderIntegrityError;
  return nextState;
}

/**
 * Item 3: VERIFY_AND_REPRICE_ONLINE_ORDER — Reprices an unverified/manipulated order
 * from the authoritative shop catalog so the owner can safely review and accept it.
 */
export function verifyAndRepriceOnlineOrderInState(state, orderId) {
  const catalog = state?.dayData?.inventory || [];
  const orders = (state?.onlineOrders || []).map(o => {
    if (o.id !== orderId) return o;
    return repriceOrderFromCatalog(o, catalog);
  });
  const nextState = {
    ...state,
    onlineOrders: orders,
  };
  delete nextState._orderVerificationError;
  delete nextState._orderIntegrityError;
  return nextState;
}

/**
 * ONLINE_ORDER_SHIP — Pure, deterministic transition of an online order to 'shipped'
 * with tracking information and idempotency guards.
 */
export function shipOnlineOrderInState(state, payload = {}) {
  const shipId = typeof payload === 'string' ? payload : payload?.orderId;
  const order = (state?.onlineOrders || []).find(o => o.id === shipId);
  if (!order) return state;

  // Idempotency: If already delivered or settled, no-op
  if (['delivered', 'settled'].includes(order.status)) {
    return state;
  }

  const courierName = payload?.courierName || order.courierName;
  const trackingNumber = payload?.trackingNumber || order.trackingNumber;

  // If already shipped with identical courier/tracking, no-op
  if (order.status === 'shipped' && order.courierName === courierName && order.trackingNumber === trackingNumber) {
    return state;
  }

  // State transition enforcement: Can only ship from 'packed' (or idempotent no-op if already 'shipped')
  if (order.status !== 'packed' && order.status !== 'shipped') {
    return state;
  }

  const shippedOrders = (state.onlineOrders || []).map(o => {
    if (o.id !== shipId) return o;
    const isFirstShip = o.status !== 'shipped';
    return {
      ...o,
      status: 'shipped',
      shippedAt: o.shippedAt || Date.now(),
      courierName: courierName || o.courierName,
      trackingNumber: trackingNumber || o.trackingNumber,
      statusHistory: isFirstShip ? [
        ...(o.statusHistory || []),
        { status: 'shipped', timestamp: Date.now(), note: `Courier: ${courierName || 'courier'}, Tracking: ${trackingNumber || 'N/A'}` },
      ] : o.statusHistory,
    };
  });

  const shipStats = { ...(state.dayData?.onlineOrdersDayStats || {}) };
  if (order.status !== 'shipped') {
    shipStats.shipped = (shipStats.shipped || 0) + 1;
  }

  return {
    ...state,
    onlineOrders: shippedOrders,
    dayData: state.dayData ? { ...state.dayData, onlineOrdersDayStats: shipStats } : state.dayData,
  };
}

/**
 * ONLINE_ORDER_SETTLE — Pure, deterministic courier settlement with strict idempotency guards.
 * Clears courier receivable, deposits net amount into receiving wallet, records courier fee as expense,
 * and posts balanced double-entry settlement journal entry.
 */
export function settleOnlineOrderInState(state, payload = {}) {
  const settleId = typeof payload === 'string' ? payload : payload?.orderId;
  const orderToSettle = (state?.onlineOrders || []).find(o => String(o.id) === String(settleId));
  if (!orderToSettle) return state;

  const isForceReconcile = Boolean(orderToSettle.status === 'settled' && payload?.forceReconcile);

  // Idempotency: If already settled, never credit wallet again or create duplicate transactions (unless forceReconcile)
  if ((orderToSettle.status === 'settled' || Boolean(orderToSettle.settledAt)) && !isForceReconcile) {
    return state;
  }

  // State transition enforcement: Can only settle from 'delivered' (unless forceReconcile)
  if (orderToSettle.status !== 'delivered' && !isForceReconcile) {
    return state;
  }

  if (isForceReconcile && !orderToSettle.settlementWallet) {
    const errObj = {
      orderId: settleId,
      code: 'missing_stored_settlement_wallet',
      action: 'ONLINE_ORDER_SETTLE',
      message: 'Cannot reconcile settled order without stored settlementWallet metadata',
    };
    return {
      ...state,
      _orderSettleError: errObj,
    };
  }

  const updatedWallets = state.dayData?.wallets ? { ...state.dayData.wallets } : {};
  const settlementWallet = isForceReconcile
    ? orderToSettle.settlementWallet
    : (payload?.settlementWallet || payload?.walletKey || orderToSettle.settlementWallet || 'hand_cash');

  // 1. Require the selected wallet to exist in state.dayData.wallets
  if (!settlementWallet || !updatedWallets[settlementWallet]) {
    const errObj = {
      orderId: settleId,
      code: 'missing_settlement_wallet',
      action: 'ONLINE_ORDER_SETTLE',
      wallet: settlementWallet,
      message: `Settlement wallet '${settlementWallet || 'undefined'}' not found in active ledger`,
    };
    return {
      ...state,
      _orderSettleError: errObj,
    };
  }

  // 2. Require COD amount, courier charges and COD fees to be finite non-negative numbers
  // Authoritative COD amount is strictly mandatory. totalAmount is NEVER an acceptable fallback!
  const rawCod = payload?.codAmount ?? orderToSettle.codAmount;
  const rawCourierCharge = payload?.courierCharge ?? orderToSettle.courierCharge;
  const rawCodFee = payload?.codFee ?? orderToSettle.codFee;

  const codAmount = rawCod !== undefined && rawCod !== null
    ? parseStrictMoney(rawCod, null, true)
    : null;
  const courierCharge = parseStrictMoney(rawCourierCharge, 0, false);
  const codFee = parseStrictMoney(rawCodFee, 0, false);

  if (codAmount === null || courierCharge === null || codFee === null) {
    const errObj = {
      orderId: settleId,
      code: 'invalid_settlement_amounts',
      action: 'ONLINE_ORDER_SETTLE',
      message: 'COD amount, courier charge, and COD fee must be valid finite non-negative numbers',
    };
    return {
      ...state,
      _orderSettleError: errObj,
    };
  }

  // 3. Recalculate courier expenses and validate whether fees exceed COD collection
  const courierExpense = roundBDT(courierCharge + codFee);

  // P1 Fix: When total courier fees exceed COD collection, reject settlement with shortfall error.
  // Do NOT automatically treat as zero-net, which under-reports actual courier expense.
  if (courierExpense > codAmount) {
    const shortfall = roundBDT(courierExpense - codAmount);
    const errObj = {
      orderId: settleId,
      code: 'courier_fee_exceeds_cod',
      action: 'ONLINE_ORDER_SETTLE',
      codAmount,
      courierExpense,
      shortfall,
      message: `Total courier fees (৳${courierExpense}) exceed COD collection (৳${codAmount}) by ৳${shortfall}. Cannot settle as positive or zero payout.`,
    };
    return {
      ...state,
      _orderSettleError: errObj,
    };
  }

  const expectedNet = roundBDT(codAmount - courierExpense);

  // 4. Validate explicit net settlement amount (reject negative, exceeding COD obligation, or unapproved fee mismatch)
  let netAmount;
  let adjustmentApproved = false;
  let adjustmentReason = '';
  let adjustmentDiscrepancy = 0;

  if (isForceReconcile) {
    const storedNet = orderToSettle.netAmount ?? orderToSettle.netFromCourier ?? expectedNet;
    const parsedNet = parseStrictMoney(storedNet, null, true);
    if (parsedNet === null) {
      const errObj = {
        orderId: settleId,
        code: 'invalid_stored_net_amount',
        action: 'ONLINE_ORDER_SETTLE',
        message: 'Stored net amount is not a valid non-negative number',
      };
      return {
        ...state,
        _orderSettleError: errObj,
      };
    }
    netAmount = parsedNet;
    adjustmentApproved = Boolean(orderToSettle.adjustmentApproved);
    adjustmentReason = String(orderToSettle.adjustmentReason || 'Reconciliation of stored settled order');
    adjustmentDiscrepancy = Number(orderToSettle.adjustmentDiscrepancy || 0);
  } else if (payload?.netAmount !== undefined && payload?.netAmount !== null) {
    if (typeof payload.netAmount === 'string' && payload.netAmount.trim() === '') {
      const errObj = {
        orderId: settleId,
        code: 'invalid_settlement_amounts',
        action: 'ONLINE_ORDER_SETTLE',
        netAmount: payload.netAmount,
        message: 'Actual received net amount cannot be empty',
      };
      return {
        ...state,
        _orderSettleError: errObj,
      };
    }
    const parsedNet = parseStrictMoney(payload.netAmount, null, true);
    if (parsedNet === null) {
      const isNegative = typeof payload.netAmount === 'number' ? payload.netAmount < 0 : /^\s*-\d/.test(String(payload.netAmount));
      const errObj = {
        orderId: settleId,
        code: isNegative ? 'negative_settlement_amount' : 'invalid_settlement_amounts',
        action: 'ONLINE_ORDER_SETTLE',
        netAmount: payload.netAmount,
        message: isNegative
          ? `Net settlement amount (${payload.netAmount}) must be a valid non-negative number`
          : `Net settlement amount (${payload.netAmount}) must be a valid finite non-negative number`,
      };
      return {
        ...state,
        _orderSettleError: errObj,
      };
    }
    netAmount = parsedNet;
  } else if (payload?.netFromCourier !== undefined && payload?.netFromCourier !== null) {
    if (typeof payload.netFromCourier === 'string' && payload.netFromCourier.trim() === '') {
      const errObj = {
        orderId: settleId,
        code: 'invalid_settlement_amounts',
        action: 'ONLINE_ORDER_SETTLE',
        netAmount: payload.netFromCourier,
        message: 'Actual received net amount cannot be empty',
      };
      return {
        ...state,
        _orderSettleError: errObj,
      };
    }
    const parsedNet = parseStrictMoney(payload.netFromCourier, null, true);
    if (parsedNet === null) {
      const isNegative = typeof payload.netFromCourier === 'number' ? payload.netFromCourier < 0 : /^\s*-\d/.test(String(payload.netFromCourier));
      const errObj = {
        orderId: settleId,
        code: isNegative ? 'negative_settlement_amount' : 'invalid_settlement_amounts',
        action: 'ONLINE_ORDER_SETTLE',
        netAmount: payload.netFromCourier,
        message: isNegative
          ? `Net settlement amount (${payload.netFromCourier}) must be a valid non-negative number`
          : `Net settlement amount (${payload.netFromCourier}) must be a valid finite non-negative number`,
      };
      return {
        ...state,
        _orderSettleError: errObj,
      };
    }
    netAmount = parsedNet;
  } else if (orderToSettle.netFromCourier !== undefined && orderToSettle.netFromCourier !== null) {
    const parsedStored = parseStrictMoney(orderToSettle.netFromCourier, null, true);
    netAmount = parsedStored !== null ? parsedStored : expectedNet;
  } else if (orderToSettle.settlementAmount !== undefined && orderToSettle.settlementAmount !== null) {
    const parsedStored = parseStrictMoney(orderToSettle.settlementAmount, null, true);
    netAmount = parsedStored !== null ? parsedStored : expectedNet;
  } else {
    netAmount = expectedNet;
  }

  if (netAmount > codAmount) {
    const errObj = {
      orderId: settleId,
      code: 'net_exceeds_cod',
      action: 'ONLINE_ORDER_SETTLE',
      netAmount,
      codAmount,
      message: `Net settlement amount (৳${netAmount}) cannot exceed recorded COD obligation (৳${codAmount})`,
    };
    return {
      ...state,
      _orderSettleError: errObj,
    };
  }

  if (Math.abs(netAmount - expectedNet) > 0.01) {
    // P1 Fix: Strict boolean check - only boolean true is accepted; 'false', 1, 'true', null are rejected!
    const allowAdjustment = payload?.allowAdjustment === true || (isForceReconcile && orderToSettle?.adjustmentApproved === true);
    if (!allowAdjustment) {
      const discrepancy = roundBDT(netAmount - expectedNet);
      const errObj = {
        orderId: settleId,
        code: 'net_fee_mismatch',
        action: 'ONLINE_ORDER_SETTLE',
        netAmount,
        expectedNet,
        discrepancy,
        message: `Net settlement amount (৳${netAmount}) does not match expected net (৳${expectedNet} = COD ৳${codAmount} - fees ৳${courierExpense}). Discrepancy: ৳${discrepancy}. Pass allowAdjustment: true and adjustmentReason to accept adjusted settlement.`,
      };
      return {
        ...state,
        _orderSettleError: errObj,
      };
    }

    // P1 Fix: Require non-empty adjustment reason when approving adjustment
    const reasonStr = typeof payload?.adjustmentReason === 'string'
      ? payload.adjustmentReason.trim()
      : (isForceReconcile && typeof orderToSettle?.adjustmentReason === 'string' ? orderToSettle.adjustmentReason.trim() : '');
    if (!reasonStr || reasonStr.length < 3) {
      const errObj = {
        orderId: settleId,
        code: 'missing_adjustment_reason',
        action: 'ONLINE_ORDER_SETTLE',
        netAmount,
        expectedNet,
        message: 'An adjustment reason (minimum 3 characters) is required when approving courier settlement adjustment.',
      };
      return {
        ...state,
        _orderSettleError: errObj,
      };
    }

    adjustmentApproved = true;
    adjustmentReason = reasonStr;
    adjustmentDiscrepancy = roundBDT(netAmount - expectedNet);
  }

  // 5. Effective courier expense recognized on settlement
  const effectiveExpense = roundBDT(codAmount - netAmount);

  const settledOrders = (state.onlineOrders || []).map(o => {
    if (String(o.id) !== String(settleId)) return o;
    return {
      ...o,
      status: 'settled',
      settledAt: o.settledAt || Date.now(),
      settlementWallet,
      settlementAmount: netAmount,
      ...(adjustmentApproved ? {
        adjustmentApproved: true,
        adjustmentReason,
        adjustmentDiscrepancy,
      } : {}),
      statusHistory: [
        ...(o.statusHistory || []),
        {
          status: 'settled',
          timestamp: Date.now(),
          note: isForceReconcile
            ? (state.language === 'en'
                ? `Reconciled missing ledger settlement: Net ৳${netAmount} received in ${settlementWallet}`
                : `অনুপস্থিত লেজার নিষ্পত্তি সমন্বয়: নেট ৳${netAmount} গ্রহণ করা হয়েছে ${settlementWallet}-এ`)
            : (state.language === 'en'
                ? `Net ৳${netAmount} received in ${settlementWallet}${adjustmentApproved ? ` (Adjusted: ৳${adjustmentDiscrepancy}, Reason: ${adjustmentReason})` : ''}`
                : `নেট ৳${netAmount} গ্রহণ করা হয়েছে ${settlementWallet}-এ${adjustmentApproved ? ` (সমন্বয়: ৳${adjustmentDiscrepancy}, কারণ: ${adjustmentReason})` : ''}`),
        },
      ],
    };
  });

  updatedWallets[settlementWallet] = {
    ...updatedWallets[settlementWallet],
    current: roundBDT((Number(updatedWallets[settlementWallet].current) || 0) + netAmount),
  };

  const newTxs = [];
  if (effectiveExpense > 0) {
    newTxs.push({
      id: nextTxId('oo_courier_exp'),
      timestamp: Date.now(),
      type: 'expense',
      subType: 'courier_expense',
      category: 'courier_expense',
      amount: effectiveExpense,
      note: state.language === 'en'
        ? `🚚 Courier charge: Delivery ৳${courierCharge} + COD fee ৳${codFee}${effectiveExpense !== courierExpense ? ` (Adjusted: ৳${effectiveExpense}${adjustmentReason ? ` - ${adjustmentReason}` : ''})` : ''} (Order #${String(settleId).slice(-6)})`
        : `🚚 কুরিয়ার খরচ: ডেলিভারি ৳${courierCharge} + COD ফি ৳${codFee}${effectiveExpense !== courierExpense ? ` (সমন্বয়: ৳${effectiveExpense}${adjustmentReason ? ` - ${adjustmentReason}` : ''})` : ''} (অর্ডার #${String(settleId).slice(-6)})`,
      wallet: settlementWallet,
      orderId: settleId,
      linkedOrderId: settleId,
      isAutoGenerated: true,
    });
  }

  const settleTx = {
    id: nextTxId('oo_settle'),
    timestamp: Date.now(),
    type: 'courier_settlement',
    subType: 'online_order_settlement',
    amount: netAmount,
    courierExpense: effectiveExpense,
    codAmount,
    wallet: settlementWallet,
    orderId: settleId,
    linkedOrderId: settleId,
    ...(adjustmentApproved ? {
      adjustmentApproved: true,
      adjustmentReason,
      adjustmentDiscrepancy,
    } : {}),
    note: state.language === 'en'
      ? `💰 Courier payment received (Order #${String(settleId).slice(-6)}) — Net ৳${netAmount}${adjustmentApproved ? ` (Adjusted: ${adjustmentReason})` : ''}`
      : `💰 কুরিয়ার থেকে টাকা পাওয়া গেছে (অর্ডার #${String(settleId).slice(-6)}) — নেট ৳${netAmount}${adjustmentApproved ? ` (সমন্বয়: ${adjustmentReason})` : ''}`,
    isAutoGenerated: true,
  };
  newTxs.push(settleTx);

  const settleJELines = [
    { accountId: mapWalletToAccount(settlementWallet), debit: netAmount, credit: 0 },
  ];
  if (effectiveExpense > 0) {
    settleJELines.push({ accountId: 'delivery_expense', debit: effectiveExpense, credit: 0 });
  }
  settleJELines.push({ accountId: 'courier_receivable', debit: 0, credit: codAmount });

  const settleJE = {
    id: `je_settle_${settleTx.id}`,
    timestamp: settleTx.timestamp,
    txId: settleTx.id,
    txType: 'courier_settlement',
    description: `Courier Settlement: #${String(settleId).slice(-6)}`,
    lines: settleJELines,
  };

  const settleStats = { ...(state.dayData?.onlineOrdersDayStats || {}) };
  settleStats.settled = (settleStats.settled || 0) + 1;
  settleStats.courierExpense = (settleStats.courierExpense || 0) + effectiveExpense;

  const nextState = {
    ...state,
    onlineOrders: settledOrders,
    dayData: state.dayData ? {
      ...state.dayData,
      wallets: updatedWallets,
      transactions: [...(state.dayData.transactions || []), ...newTxs],
      journalEntries: [...(state.dayData.journalEntries || []), settleJE],
      onlineOrdersDayStats: settleStats,
      settledOrderIds: Array.from(new Set([...(state.dayData.settledOrderIds || []), String(settleId)])),
      orderSettlements: {
        ...(state.dayData.orderSettlements || {}),
        [String(settleId)]: {
          wallet: settlementWallet,
          amount: netAmount,
          settledAt: Date.now(),
        },
      },
    } : state.dayData,
  };
  delete nextState._orderSettleError;
  return nextState;
}

/**
 * ONLINE_ORDER_CANCEL — Pure, deterministic cancellation with strict double-entry refund
 * accounting, selective inventory restoration, and idempotency guards.
 */
export function cancelOnlineOrderInState(state, payload = {}) {
  const cancelId = typeof payload === 'string' ? payload : payload?.orderId;
  const orderToCancel = (state?.onlineOrders || []).find(o => o.id === cancelId);
  if (!orderToCancel) return state;

  // Idempotency: Already cancelled order is a no-op
  if (orderToCancel.status === 'cancelled' || Boolean(orderToCancel.cancelledAt)) {
    return state;
  }

  // P0 Bug 1: State transition guards
  if (
    ['delivered', 'returned', 'settled'].includes(orderToCancel.status) ||
    !['draft', 'confirmed', 'packed', 'shipped'].includes(orderToCancel.status)
  ) {
    const errObj = {
      orderId: cancelId,
      code: 'invalid_cancellation_status',
      action: 'ONLINE_ORDER_CANCEL',
      status: orderToCancel.status,
      message: `Cannot cancel order #${String(cancelId).slice(-6)} in '${orderToCancel.status}' status. Only draft, confirmed, packed, or shipped orders can be cancelled.`,
    };
    return {
      ...state,
      _orderCancelError: errObj,
    };
  }

  const cancelReason = payload?.reason || (state.language === 'en' ? 'Customer cancelled order' : 'গ্রাহক অর্ডার বাতিল করেছেন');

  // Advance refund accounting (if advance was paid & verified)
  const advancePaid = Number(orderToCancel.advancePaid) || 0;
  const isAdvanceVerified = orderToCancel.paymentStatus === 'verified' || Boolean(orderToCancel.paymentVerifiedAt);
  const refundWallet = payload?.refundWallet || orderToCancel.advanceWallet || orderToCancel.paymentWallet;
  let updatedWallets = state.dayData?.wallets ? { ...state.dayData.wallets } : {};
  let refundTx = null;
  let refundJE = null;

  if (advancePaid > 0 && isAdvanceVerified) {
    if (!refundWallet || !updatedWallets[refundWallet]) {
      const errObj = {
        orderId: cancelId,
        code: 'missing_refund_wallet',
        action: 'ONLINE_ORDER_CANCEL',
        message: `Refund wallet '${refundWallet || 'undefined'}' not found in active ledger`,
      };
      return {
        ...state,
        _orderRefundError: errObj,
      };
    }

    const availableBal = Number(updatedWallets[refundWallet].current) || 0;
    if (availableBal < advancePaid) {
      const errObj = {
        orderId: cancelId,
        code: 'insufficient_wallet_balance',
        action: 'ONLINE_ORDER_CANCEL',
        required: advancePaid,
        available: availableBal,
        wallet: refundWallet,
        message: `Wallet '${refundWallet}' has insufficient balance (৳${availableBal}) for advance refund of ৳${advancePaid}. Please select a funded wallet.`,
      };
      return {
        ...state,
        _orderRefundError: errObj,
      };
    }

    // Deduct exact refund amount without clamping distortion
    updatedWallets = {
      ...updatedWallets,
      [refundWallet]: {
        ...updatedWallets[refundWallet],
        current: roundBDT(availableBal - advancePaid),
      },
    };

    refundTx = {
      id: nextTxId('oo_refund'),
      timestamp: Date.now(),
      type: 'online_order_refund',
      subType: 'online_order_refund',
      amount: advancePaid,
      wallet: refundWallet,
      note: state.language === 'en'
        ? `💸 Order cancelled — advance ৳${advancePaid} refunded (Order #${String(cancelId).slice(-6)})`
        : `💸 অর্ডার বাতিল — অগ্রিম ৳${advancePaid} ফেরত (অর্ডার #${String(cancelId).slice(-6)})`,
      linkedOrderId: cancelId,
      isAutoGenerated: true,
    };

    // Double-Entry Journal Entry:
    // Debit: customer_advance (clears the advance liability)
    // Credit: wallet (cash leaves the shop's wallet)
    refundJE = {
      id: `je_refund_${refundTx.id}`,
      timestamp: refundTx.timestamp,
      txId: refundTx.id,
      txType: 'online_order_refund',
      description: `Advance Refund (Order #${String(cancelId).slice(-6)})`,
      lines: [
        { accountId: 'customer_advance', debit: advancePaid, credit: 0 },
        { accountId: mapWalletToAccount(refundWallet), debit: 0, credit: advancePaid },
      ],
    };
  }

  // Restore inventory ONLY if stock was actually reserved/deducted (at packed or shipped stage)
  const wasStockDeducted = ['packed', 'shipped'].includes(orderToCancel.status);
  let cancelInventory = [...(state.dayData?.inventory || [])];
  if (wasStockDeducted) {
    (orderToCancel.items || []).forEach(item => {
      const pid = item.productId || item.id;
      const qty = Number(item.quantity) || 1;
      if (pid) {
        cancelInventory = cancelInventory.map(inv => {
          if (String(inv.id) === String(pid)) {
            return {
              ...inv,
              closingStock: (Number(inv.closingStock) || 0) + qty,
            };
          }
          return inv;
        });
      }
    });
  }

  const cancelledOrders = (state.onlineOrders || []).map(o => {
    if (o.id !== cancelId) return o;
    return {
      ...o,
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancelReason,
      refundedAmount: (refundTx ? advancePaid : 0),
      refundWallet: (refundTx ? refundWallet : undefined),
      statusHistory: [
        ...(o.statusHistory || []),
        {
          status: 'cancelled',
          timestamp: Date.now(),
          note: `Cancelled: ${cancelReason}${refundTx ? ` (Advance ৳${advancePaid} refunded via ${refundWallet})` : ''}`,
        },
      ],
    };
  });

  const nextState = {
    ...state,
    onlineOrders: cancelledOrders,
    dayData: state.dayData ? {
      ...state.dayData,
      inventory: cancelInventory,
      wallets: updatedWallets,
      transactions: refundTx ? [...(state.dayData.transactions || []), refundTx] : (state.dayData.transactions || []),
      journalEntries: refundJE ? [...(state.dayData.journalEntries || []), refundJE] : (state.dayData.journalEntries || []),
    } : state.dayData,
  };
  delete nextState._orderRefundError;
  delete nextState._orderCancelError;
  return nextState;
}

/**
 * ONLINE_ORDER_RETURN — Pure, deterministic Return-To-Origin (RTO) accounting with
 * stock restoration, delivery expense recognition, customer advance refund, and blacklist update.
 */
export function returnOnlineOrderInState(state, payload = {}) {
  const returnId = typeof payload === 'string' ? payload : payload?.orderId;
  const orderToReturn = (state?.onlineOrders || []).find(o => o.id === returnId);
  if (!orderToReturn) return state;

  // Idempotency: If already returned, return state immediately
  if (
    orderToReturn.status === 'returned' ||
    Boolean(orderToReturn.returnedAt) ||
    orderToReturn.status === 'cancelled' ||
    Boolean(orderToReturn.cancelledAt)
  ) {
    return state;
  }

  // State transition guard: RTO is Return To Origin before delivery — strictly allowed ONLY from 'shipped'
  if (orderToReturn.status !== 'shipped') {
    return state;
  }

  const returnReason = payload?.reason || (state.language === 'en' ? 'RTO — Customer refused delivery' : 'RTO — গ্রাহক পার্সেল গ্রহণ করেননি');

  const returnCharge = Number(payload?.returnCharge ?? orderToReturn.returnCharge ?? orderToReturn.courierCharge ?? 0);
  const expenseWallet = payload?.expenseWallet || 'hand_cash';
  const advancePaid = Number(orderToReturn.advancePaid) || 0;
  const isAdvanceVerified = orderToReturn.paymentStatus === 'verified' || Boolean(orderToReturn.paymentVerifiedAt);
  const refundWallet = payload?.refundWallet || orderToReturn.advanceWallet || orderToReturn.paymentWallet || 'hand_cash';

  let updatedWallets = state.dayData?.wallets ? { ...state.dayData.wallets } : {};

  // Wallet Balance Validation (P1 Wallet Reconciliation Guard):
  // 1. Courier return charge balance check
  if (returnCharge > 0) {
    if (!expenseWallet || !updatedWallets[expenseWallet]) {
      const errObj = {
        orderId: returnId,
        code: 'missing_expense_wallet',
        action: 'ONLINE_ORDER_RETURN',
        message: `Expense wallet '${expenseWallet || 'undefined'}' not found in active ledger`,
      };
      return { ...state, _orderReturnError: errObj };
    }
    const availExpenseBal = Number(updatedWallets[expenseWallet].current) || 0;
    if (availExpenseBal < returnCharge) {
      const errObj = {
        orderId: returnId,
        code: 'insufficient_wallet_balance',
        action: 'ONLINE_ORDER_RETURN',
        field: 'expenseWallet',
        required: returnCharge,
        available: availExpenseBal,
        wallet: expenseWallet,
        message: `Wallet '${expenseWallet}' has insufficient balance (৳${availExpenseBal}) for courier return fee of ৳${returnCharge}.`,
      };
      return { ...state, _orderReturnError: errObj };
    }
  }

  // 2. Advance refund balance check
  if (advancePaid > 0 && isAdvanceVerified) {
    if (!refundWallet || !updatedWallets[refundWallet]) {
      const errObj = {
        orderId: returnId,
        code: 'missing_refund_wallet',
        action: 'ONLINE_ORDER_RETURN',
        message: `Refund wallet '${refundWallet || 'undefined'}' not found in active ledger`,
      };
      return { ...state, _orderReturnError: errObj };
    }
    const availRefundBal = Number(updatedWallets[refundWallet].current) || 0;
    const requiredRefundBal = (expenseWallet === refundWallet ? returnCharge : 0) + advancePaid;
    if (availRefundBal < requiredRefundBal) {
      const errObj = {
        orderId: returnId,
        code: 'insufficient_wallet_balance',
        action: 'ONLINE_ORDER_RETURN',
        field: 'refundWallet',
        required: requiredRefundBal,
        available: availRefundBal,
        wallet: refundWallet,
        message: `Wallet '${refundWallet}' has insufficient balance (৳${availRefundBal}) for total required deductions of ৳${requiredRefundBal}.`,
      };
      return { ...state, _orderReturnError: errObj };
    }
  }

  // Restore inventory (stock was deducted at packed/shipped)
  let returnInventory = [...(state.dayData?.inventory || [])];
  (orderToReturn.items || []).forEach(item => {
    const pid = item.productId || item.id;
    const qty = Number(item.quantity) || 1;
    if (pid) {
      returnInventory = returnInventory.map(inv => {
        if (String(inv.id) === String(pid)) {
          return {
            ...inv,
            closingStock: (Number(inv.closingStock) || 0) + qty,
          };
        }
        return inv;
      });
    }
  });

  const newTxs = [];
  const newJEs = [];

  // Courier Return fee accounting
  if (returnCharge > 0) {
    updatedWallets = {
      ...updatedWallets,
      [expenseWallet]: {
        ...updatedWallets[expenseWallet],
        current: roundBDT((Number(updatedWallets[expenseWallet].current) || 0) - returnCharge),
      },
    };
    const rtoTx = {
      id: nextTxId('oo_rto_loss'),
      timestamp: Date.now(),
      type: 'expense',
      subType: 'rto_loss',
      category: 'delivery_expense',
      amount: returnCharge,
      wallet: expenseWallet,
      note: state.language === 'en'
        ? `🚚 RTO delivery loss (Order #${String(returnId).slice(-6)}) — Return charge ৳${returnCharge}`
        : `🚚 RTO ডেলিভারি খরচ (অর্ডার #${String(returnId).slice(-6)}) — রিটার্ন চার্জ ৳${returnCharge}`,
      linkedOrderId: returnId,
      isAutoGenerated: true,
    };
    newTxs.push(rtoTx);

    const rtoJE = {
      id: `je_rto_${rtoTx.id}`,
      timestamp: rtoTx.timestamp,
      txId: rtoTx.id,
      txType: 'rto_loss',
      description: `RTO Courier Charge: #${String(returnId).slice(-6)}`,
      lines: [
        { accountId: 'delivery_expense', debit: returnCharge, credit: 0 },
        { accountId: mapWalletToAccount(expenseWallet), debit: 0, credit: returnCharge },
      ],
    };
    newJEs.push(rtoJE);
  }

  // Advance refund accounting (if advance was paid & verified)
  if (advancePaid > 0 && isAdvanceVerified) {
    updatedWallets = {
      ...updatedWallets,
      [refundWallet]: {
        ...updatedWallets[refundWallet],
        current: roundBDT((Number(updatedWallets[refundWallet].current) || 0) - advancePaid),
      },
    };
    const advanceRefundTx = {
      id: nextTxId('oo_refund'),
      timestamp: Date.now(),
      type: 'online_order_refund',
      subType: 'online_order_refund',
      amount: advancePaid,
      wallet: refundWallet,
      note: state.language === 'en'
        ? `💸 Advance refund to customer (Order #${String(returnId).slice(-6)})`
        : `💸 কাস্টমারকে অগ্রিম ফেরত (অর্ডার #${String(returnId).slice(-6)})`,
      linkedOrderId: returnId,
      isAutoGenerated: true,
    };
    newTxs.push(advanceRefundTx);

    const advanceRefundJE = {
      id: `je_refund_${advanceRefundTx.id}`,
      timestamp: advanceRefundTx.timestamp,
      txId: advanceRefundTx.id,
      txType: 'online_order_refund',
      description: `RTO Advance Refund: #${String(returnId).slice(-6)}`,
      lines: [
        { accountId: 'customer_advance', debit: advancePaid, credit: 0 },
        { accountId: mapWalletToAccount(refundWallet), debit: 0, credit: advancePaid },
      ],
    };
    newJEs.push(advanceRefundJE);
  }

  // Update customer blacklist with normalized phone
  const updatedBlacklist = recordRtoInBlacklist(state.customerBlacklist, orderToReturn.customerPhone);

  const returnedOrders = (state.onlineOrders || []).map(o => {
    if (o.id !== returnId) return o;
    return {
      ...o,
      status: 'returned',
      returnedAt: Date.now(),
      returnReason,
      rtoExpense: returnCharge,
      refundedAmount: advancePaid,
      statusHistory: [
        ...(o.statusHistory || []),
        {
          status: 'returned',
          timestamp: Date.now(),
          note: returnReason,
        },
      ],
    };
  });

  const returnStats = { ...(state.dayData?.onlineOrdersDayStats || {}) };
  returnStats.returned = (returnStats.returned || 0) + 1;
  returnStats.courierExpense = (returnStats.courierExpense || 0) + returnCharge;

  const nextState = {
    ...state,
    onlineOrders: returnedOrders,
    customerBlacklist: updatedBlacklist,
    dayData: state.dayData ? {
      ...state.dayData,
      inventory: returnInventory,
      wallets: updatedWallets,
      transactions: [...(state.dayData.transactions || []), ...newTxs],
      journalEntries: [...(state.dayData.journalEntries || []), ...newJEs],
      onlineOrdersDayStats: returnStats,
    } : state.dayData,
  };
  delete nextState._orderReturnError;
  return nextState;
}

/**
 * Pure dispatcher for testing or direct state transitions.
 */
export function executeLedgerAction(state, action) {
  if (!action || !action.type) return state;
  switch (action.type) {
    case 'QUICK_SELL_STOCK':
      return quickSellStockInState(state, action.payload);
    case 'QUICK_RESTOCK':
      return quickRestockInState(state, action.payload);
    case 'WRITE_OFF_DAMAGE':
      return writeOffDamageInState(state, action.payload);
    case 'APPLY_STOCK_AUDIT':
      return applyStockAuditInState(state, action.payload);
    case 'DELETE_TRANSACTION':
    case 'REVERSE_TRANSACTION':
      return reverseSingleTransactionInState(state, action.payload);
    case 'BULK_DELETE_TRANSACTIONS':
      return bulkDeleteTransactionsInState(state, action.payload);
    case 'DELETE_BUSINESS':
      return deleteBusinessInState(state, action.payload);
    case 'CLEAR_AUDIT_LOG_ENTRIES':
    case 'CLEAR_AUDIT_ENTRY': {
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
    case 'BLACKLIST_CUSTOMER':
      return blacklistCustomerInState(state, action.payload);
    case 'UNBLACKLIST_CUSTOMER':
      return unblacklistCustomerInState(state, action.payload);
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
    case 'ONLINE_ORDER_SETTLE':
      return settleOnlineOrderInState(state, action.payload);
    case 'ONLINE_ORDER_CANCEL':
      return cancelOnlineOrderInState(state, action.payload);
    case 'ONLINE_ORDER_RETURN':
      return returnOnlineOrderInState(state, action.payload);
    case 'VERIFY_AND_REPRICE_ONLINE_ORDER':
      return verifyAndRepriceOnlineOrderInState(state, action.payload);
    default:
      return state;
  }
}
