/**
 * journalEngine.js — Double-Entry Journal Entry Generator
 * 
 * Converts single-entry transactions into proper debit/credit journal entries.
 * Only active when Advanced Mode → doubleEntry feature flag is ON.
 * 
 * Accounting Rules:
 *   Assets & Expenses → increase with DEBIT
 *   Liabilities, Equity & Revenue → increase with CREDIT
 */

// ── Wallet & Category Mapping Helpers ───────────────────────────────
export function mapWalletToAccount(walletKey) {
  if (!walletKey) return 'cash_in_hand';
  const k = String(walletKey).toLowerCase();
  if (k === 'hand_cash' || k === 'cash' || k === 'cash_in_hand') return 'cash_in_hand';
  if (k.includes('bkash')) return 'bkash';
  if (k.includes('nagad')) return 'nagad';
  if (k.includes('rocket')) return 'rocket';
  if (k.includes('digital')) return 'digital_payment';
  if (k.includes('bank')) return 'bank_account';
  return 'cash_in_hand';
}

export function mapExpenseCategoryToAccount(category = '', note = '') {
  const text = `${category || ''} ${note || ''}`.toLowerCase();
  if (text.includes('বেতন') || text.includes('salary') || text.includes('staff') || text.includes('কর্মচারী') || text.includes('কর্মী')) {
    return 'salary_expense';
  }
  if (text.includes('ভাড়া') || text.includes('ভাড়া') || text.includes('rent') || text.includes('দোকান ভাড়া')) {
    return 'rent_expense';
  }
  if (text.includes('ট্রান্সফার') || text.includes('খরচ ফি') || text.includes('fee') || text.includes('charge')) {
    if (text.includes('courier') || text.includes('কুরিয়ার') || text.includes('ডেলিভারি') || text.includes('delivery')) {
      return 'delivery_expense';
    }
    return 'transfer_fee_expense';
  }
  if (text.includes('courier') || text.includes('কুরিয়ার') || text.includes('ডেলিভারি') || text.includes('delivery')) {
    return 'delivery_expense';
  }
  return 'operating_expenses';
}

// ── TX Type → Journal Entry Mapping ─────────────────────────────────
const TX_TO_JOURNAL = {
  // Revenue transactions
  stock_sale:      (amt, meta) => {
    if (meta?.subType === 'online_order_sale') {
      const advancePaid = Number(meta?.advancePaid) || 0;
      const codAmount = meta?.codAmount !== undefined ? Number(meta?.codAmount) : Math.max(0, amt - advancePaid);
      const lines = [];
      if (advancePaid > 0) {
        lines.push({ accountId: 'customer_advance', debit: advancePaid, credit: 0 });
      }
      if (codAmount > 0) {
        lines.push({ accountId: 'courier_receivable', debit: codAmount, credit: 0 });
      }
      if (lines.length === 0) {
        lines.push({ accountId: mapWalletToAccount(meta?.wallet || meta?.toWallet), debit: amt, credit: 0 });
      }
      lines.push({ accountId: 'sales_revenue', debit: 0, credit: amt });
      return lines;
    }
    return [
      { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet || meta?.fromWallet), debit: amt, credit: 0 },
      { accountId: 'sales_revenue', debit: 0, credit: amt },
    ];
  },
  sale:            (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet || meta?.fromWallet), debit: amt, credit: 0 },
    { accountId: 'sales_revenue', debit: 0, credit: amt },
  ],
  cash_sale:       (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet || meta?.fromWallet), debit: amt, credit: 0 },
    { accountId: 'sales_revenue', debit: 0, credit: amt },
  ],
  credit_sale:     (amt) => [
    { accountId: 'accounts_receivable', debit: amt, credit: 0 },
    { accountId: 'credit_sales_revenue', debit: 0, credit: amt },
  ],
  service_income:  (amt, meta) => {
    if (meta?.subType === 'online_order_advance') {
      return [
        { accountId: mapWalletToAccount(meta?.wallet || meta?.toWallet), debit: amt, credit: 0 },
        { accountId: 'customer_advance', debit: 0, credit: amt },
      ];
    }
    if (meta?.subType === 'online_order_settlement') {
      const courierExpense = Number(meta?.courierExpense) || 0;
      const codAmount = Number(meta?.codAmount) || (amt + courierExpense);
      const lines = [
        { accountId: mapWalletToAccount(meta?.wallet || meta?.toWallet), debit: amt, credit: 0 },
      ];
      if (courierExpense > 0) {
        lines.push({ accountId: 'delivery_expense', debit: courierExpense, credit: 0 });
      }
      lines.push({ accountId: 'courier_receivable', debit: 0, credit: codAmount });
      return lines;
    }
    return [
      { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
      { accountId: 'service_revenue', debit: 0, credit: amt },
    ];
  },
  online_order_advance: (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.wallet || meta?.toWallet), debit: amt, credit: 0 },
    { accountId: 'customer_advance', debit: 0, credit: amt },
  ],
  courier_settlement: (amt, meta) => {
    const courierExpense = Number(meta?.courierExpense) || 0;
    const codAmount = Number(meta?.codAmount) || (amt + courierExpense);
    const lines = [
      { accountId: mapWalletToAccount(meta?.wallet || meta?.toWallet), debit: amt, credit: 0 },
    ];
    if (courierExpense > 0) {
      lines.push({ accountId: 'delivery_expense', debit: courierExpense, credit: 0 });
    }
    lines.push({ accountId: 'courier_receivable', debit: 0, credit: codAmount });
    return lines;
  },
  online_order_refund: (amt, meta) => [
    { accountId: 'customer_advance', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.wallet || meta?.fromWallet), debit: 0, credit: amt },
  ],
  rto_loss: (amt, meta) => [
    { accountId: 'delivery_expense', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.wallet || meta?.fromWallet), debit: 0, credit: amt },
  ],
  recharge:        (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || 'hand_cash'), debit: amt, credit: 0 },
    { accountId: 'service_revenue', debit: 0, credit: amt },
  ],

  // Expense transactions
  expense:         (amt, meta) => {
    if (meta?.subType === 'online_order_refund') {
      return [
        { accountId: 'customer_advance', debit: amt, credit: 0 },
        { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
      ];
    }
    if (meta?.subType === 'rto_loss' || meta?.subType === 'courier_expense') {
      return [
        { accountId: 'delivery_expense', debit: amt, credit: 0 },
        { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
      ];
    }
    return [
      { accountId: mapExpenseCategoryToAccount(meta?.category, meta?.note || meta?.description), debit: amt, credit: 0 },
      { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
    ];
  },
  stock_purchase:  (amt, meta) => [
    { accountId: 'inventory', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],
  restock:         (amt, meta) => [
    { accountId: 'inventory', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],
  transfer_fee:    (amt, meta) => [
    { accountId: 'transfer_fee_expense', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],

  // Owner transactions
  owner_gave:      (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
    { accountId: 'owners_capital', debit: 0, credit: amt },
  ],
  owner_took:      (amt, meta) => [
    { accountId: 'owners_drawings', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],
  personal_draw:   (amt, meta) => [
    { accountId: 'owners_drawings', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],

  // Loan / Credit / Due transactions
  loan_given:      (amt, meta) => [
    { accountId: 'accounts_receivable', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],
  due_given:       (amt, meta) => [
    { accountId: 'accounts_receivable', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],
  loan_collected:  (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
    { accountId: 'accounts_receivable', debit: 0, credit: amt },
  ],
  due_collected:   (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
    { accountId: 'accounts_receivable', debit: 0, credit: amt },
  ],
  due_received:    (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
    { accountId: 'accounts_receivable', debit: 0, credit: amt },
  ],
  debt_collection: (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
    { accountId: 'accounts_receivable', debit: 0, credit: amt },
  ],
  baki_received:   (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
    { accountId: 'accounts_receivable', debit: 0, credit: amt },
  ],
  baki_given:      (amt) => [
    { accountId: 'accounts_receivable', debit: amt, credit: 0 },
    { accountId: 'sales_revenue', debit: 0, credit: amt },
  ],
  loan_taken:      (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || meta?.wallet), debit: amt, credit: 0 },
    { accountId: 'loans_payable', debit: 0, credit: amt },
  ],
  loan_repaid:     (amt, meta) => [
    { accountId: 'loans_payable', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],
  debt_repaid:     (amt, meta) => [
    { accountId: 'loans_payable', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || meta?.wallet), debit: 0, credit: amt },
  ],

  // Interest
  interest_charged: (amt) => [
    { accountId: 'accounts_receivable', debit: amt, credit: 0 },
    { accountId: 'interest_income', debit: 0, credit: amt },
  ],

  // Fund transfer (wallet to wallet) — net zero in GL
  fund_transfer:   (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.toWallet || 'bkash'), debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.fromWallet || 'cash_in_hand'), debit: 0, credit: amt },
  ],

  // Inventory Damage / Loss Write-off (IAS 2)
  damage_loss:     (amt) => [
    { accountId: 'inventory_loss', debit: amt, credit: 0 },
    { accountId: 'inventory', debit: 0, credit: amt },
  ],

  // Inventory Surplus / Gain from Physical Stock Audit (IAS 2)
  stock_audit_surplus: (amt) => [
    { accountId: 'inventory', debit: amt, credit: 0 },
    { accountId: 'other_income', debit: 0, credit: amt },
  ],

  // Fixed Asset Purchase (IAS 16)
  asset_purchase:  (amt, meta) => [
    { accountId: 'fixed_assets', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.wallet || meta?.fromWallet), debit: 0, credit: amt },
  ],

  // Fixed Asset Sale / Disposal
  asset_sale:      (amt, meta) => [
    { accountId: mapWalletToAccount(meta?.wallet || meta?.toWallet), debit: amt, credit: 0 },
    { accountId: 'fixed_assets', debit: 0, credit: amt },
  ],

  // Tax / VAT Payment
  tax_payment:     (amt, meta) => [
    { accountId: 'vat_output', debit: amt, credit: 0 },
    { accountId: mapWalletToAccount(meta?.wallet || meta?.fromWallet), debit: 0, credit: amt },
  ],
};

/**
 * Generate a journal entry from a transaction object.
 * @param {Object} tx - Transaction with at least { id, type, amount }
 * @param {Object} meta - Optional metadata (wallets, etc.)
 * @returns {Object|null} Journal entry or null if unmapped
 */
export function generateJournalEntry(tx, meta = {}) {
  if (!tx) return null;
  const mergedMeta = {
    fromWallet: tx.fromWallet || meta.fromWallet,
    toWallet: tx.toWallet || meta.toWallet,
    wallet: tx.wallet || meta.wallet,
    category: tx.category || meta.category,
    note: tx.note || tx.description || meta.note,
    ...meta
  };

  const mapper = TX_TO_JOURNAL[tx.type];
  if (!mapper) return null;

  const amount = Math.abs(Number(tx.amount) || 0);
  if (amount === 0) return null;

  const lines = mapper(amount, mergedMeta);

  return {
    id: `je_${tx.id || Date.now()}`,
    timestamp: tx.timestamp || Date.now(),
    txId: tx.id,
    txType: tx.type,
    description: tx.note || tx.description || tx.type,
    lines,
  };
}

/**
 * Compute Trial Balance from an array of journal entries.
 * @param {Array} journalEntries - Array of journal entry objects
 * @returns {Object} Map of accountId → { debit, credit, net }
 */
export function computeTrialBalance(journalEntries = []) {
  const balances = {};

  journalEntries.forEach(entry => {
    if (!entry?.lines) return;
    entry.lines.forEach(line => {
      if (!balances[line.accountId]) {
        balances[line.accountId] = { debit: 0, credit: 0, net: 0 };
      }
      balances[line.accountId].debit += line.debit || 0;
      balances[line.accountId].credit += line.credit || 0;
      balances[line.accountId].net += (line.debit || 0) - (line.credit || 0);
    });
  });

  return balances;
}

/**
 * Validate that a trial balance is balanced (total debits = total credits).
 * @param {Object} trialBalance - Output of computeTrialBalance()
 * @returns {{ isBalanced: boolean, totalDebit: number, totalCredit: number, diff: number }}
 */
export function validateTrialBalance(trialBalance) {
  let totalDebit = 0;
  let totalCredit = 0;

  Object.values(trialBalance).forEach(({ debit, credit }) => {
    totalDebit += debit;
    totalCredit += credit;
  });

  const diff = Math.abs(totalDebit - totalCredit);
  return {
    isBalanced: diff < 0.01,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    diff: Math.round(diff * 100) / 100,
  };
}

/**
 * Generate COGS journal entry for a stock sale (Perpetual Inventory).
 * @param {number} costAmount - buyPrice × quantity sold
 * @param {string} saleId - Transaction ID
 * @returns {Object} Journal entry for COGS recognition
 */
export function generateCOGSEntry(costAmount, saleId) {
  return {
    id: `je_cogs_${saleId || Date.now()}`,
    timestamp: Date.now(),
    txId: saleId,
    txType: 'cogs_recognition',
    description: 'Auto COGS — Perpetual Inventory',
    lines: [
      { accountId: 'cogs', debit: costAmount, credit: 0 },
      { accountId: 'inventory', debit: 0, credit: costAmount },
    ],
  };
}

/**
 * Generate reversal journal entry when a transaction is deleted/reversed.
 * Inverts debit and credit lines.
 * @param {Object} entry - The original journal entry to reverse
 * @returns {Object} Reversal journal entry
 */
export function generateReversalJournalEntry(entry) {
  if (!entry?.lines) return null;
  return {
    id: `rev_${entry.id}_${Date.now()}`,
    timestamp: Date.now(),
    txId: entry.txId,
    txType: 'reversal',
    description: `Reversal of: ${entry.description || entry.txType}`,
    lines: entry.lines.map(line => ({
      accountId: line.accountId,
      debit: line.credit || 0,
      credit: line.debit || 0,
    })),
  };
}

/**
 * Compute General Ledger for a specific account or all accounts.
 * Provides a running balance based on account type (Normal Debit vs Normal Credit).
 * @param {Array} journalEntries - All journal entries
 * @param {string} targetAccountId - ID of account to get ledger for
 * @param {string} accountType - 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
 * @returns {{ entries: Array, totalDebit: number, totalCredit: number, closingBalance: number }}
 */
export function computeGeneralLedger(journalEntries = [], targetAccountId, accountType = 'ASSET') {
  const isDebitNormal = accountType === 'ASSET' || accountType === 'EXPENSE';
  let runningBalance = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const ledgerEntries = [];

  // Sort chronologically
  const sorted = [...journalEntries].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  sorted.forEach(entry => {
    if (!entry?.lines) return;
    entry.lines.forEach(line => {
      if (line.accountId === targetAccountId) {
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        totalDebit += debit;
        totalCredit += credit;

        if (isDebitNormal) {
          runningBalance += debit - credit;
        } else {
          runningBalance += credit - debit;
        }

        ledgerEntries.push({
          id: entry.id,
          timestamp: entry.timestamp,
          txId: entry.txId,
          txType: entry.txType,
          description: entry.description,
          debit,
          credit,
          runningBalance: Math.round(runningBalance * 100) / 100,
        });
      }
    });
  });

  return {
    entries: ledgerEntries,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    closingBalance: Math.round(runningBalance * 100) / 100,
  };
}

/**
 * Reconcile journal entries for a set of transactions.
 * Scans transactions and creates missing journal entries for any transaction
 * that does not have an active journal entry.
 * Also synthesizes COGS entries for stock sales if missing.
 * 
 * @param {Array} transactions - List of transactions
 * @param {Array} existingJournals - List of existing journal entries
 * @param {Array} inventory - Optional inventory items for COGS lookups
 * @returns {{ reconciledJournals: Array, addedCount: number }}
 */
export function reconcileJournalsForTransactions(transactions = [], existingJournals = [], inventory = []) {
  const existingTxMap = new Set();
  const existingCogsMap = new Set();

  (existingJournals || []).forEach(j => {
    if (j?.txId) {
      if (j.txType === 'cogs_recognition') {
        existingCogsMap.add(j.txId);
      } else {
        existingTxMap.add(j.txId);
      }
    }
  });

  const newJournals = [...(existingJournals || [])];
  let addedCount = 0;

  (transactions || []).forEach(tx => {
    if (!tx || !tx.id || tx.reversed || tx.isReversal) return;

    // 1. Generate main transaction journal if missing
    if (!existingTxMap.has(tx.id)) {
      const je = generateJournalEntry(tx);
      if (je) {
        newJournals.push(je);
        existingTxMap.add(tx.id);
        addedCount++;
      }
    }

    // 2. Generate COGS journal if stock sale and COGS is missing
    if (['stock_sale', 'sale', 'cash_sale'].includes(tx.type) && !existingCogsMap.has(tx.id)) {
      let costAmount = 0;
      if (tx.costAmount && tx.costAmount > 0) {
        costAmount = Number(tx.costAmount);
      } else if (tx.profit !== undefined && tx.amount > tx.profit) {
        costAmount = Number(tx.amount) - Number(tx.profit);
      } else if (tx.itemId && Array.isArray(inventory)) {
        const item = inventory.find(i => i.id === tx.itemId);
        if (item && item.buyPrice && tx.quantity) {
          costAmount = Number(item.buyPrice) * Number(tx.quantity);
        }
      }

      if (costAmount > 0) {
        const cogsJE = generateCOGSEntry(costAmount, tx.id);
        if (cogsJE) {
          newJournals.push(cogsJE);
          existingCogsMap.add(tx.id);
          addedCount++;
        }
      }
    }
  });

  return {
    reconciledJournals: newJournals,
    addedCount,
  };
}

