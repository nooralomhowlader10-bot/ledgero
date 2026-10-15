/**
 * fifoEngine.js — First-In, First-Out (FIFO) Inventory Valuation Engine (IAS 2)
 * 
 * Tracks inventory in distinct purchase batches. When sales occur, inventory is
 * consumed from the oldest batch first, providing compliant Cost of Goods Sold (COGS).
 */

let _batchSeq = 0;

function compareBatches(a, b) {
  const dateDiff = new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
  if (dateDiff !== 0 && !Number.isNaN(dateDiff)) return dateDiff;
  const createdDiff = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  if (createdDiff !== 0) return createdDiff;
  return (Number(a.seq) || 0) - (Number(b.seq) || 0);
}

/**
 * Creates a new inventory batch.
 * @param {number} quantity - Number of units in this batch
 * @param {number} buyPrice - Purchase cost per unit
 * @param {string|number} [date] - Purchase date/timestamp
 * @param {string} [batchId] - Optional custom batch ID
 * @returns {Object} Batch object
 */
export function createBatch(quantity, buyPrice, date = Date.now(), batchId = null) {
  const qty = Number(quantity) || 0;
  const cost = Number(buyPrice) || 0;
  const seq = ++_batchSeq;
  const createdAt = typeof date === 'number' ? date : Date.now();
  return {
    id: batchId || `batch_${Date.now()}_${seq}_${Math.random().toString(36).substr(2, 5)}`,
    date: typeof date === 'string' ? date : new Date(date).toISOString().slice(0, 10),
    createdAt,
    seq,
    buyPrice: cost,
    initialQty: qty,
    remainingQty: qty,
  };
}

/**
 * Consumes stock from an array of batches using the FIFO method.
 * @param {Array} batches - Existing batches on the inventory item
 * @param {number} quantityToConsume - Units sold or damaged
 * @param {number} fallbackBuyPrice - Fallback price if no batches exist
 * @returns {{ totalCost: number, remainingBatches: Array, consumedDetails: Array }}
 */
export function consumeFIFOBatches(batches = [], quantityToConsume, fallbackBuyPrice = 0) {
  let needed = Number(quantityToConsume) || 0;
  if (needed <= 0) {
    return { totalCost: 0, remainingBatches: [...batches], consumedDetails: [] };
  }

  // If no batches exist, initialize a default batch from fallback
  let currentBatches = Array.isArray(batches) && batches.length > 0 
    ? batches.map((b, idx) => ({ ...b, seq: b.seq ?? idx }))
    : [createBatch(needed, fallbackBuyPrice)];

  let totalCost = 0;
  const consumedDetails = [];

  // Sort by date ascending, then createdAt/seq (oldest first)
  currentBatches.sort(compareBatches);

  for (let i = 0; i < currentBatches.length && needed > 0; i++) {
    const batch = currentBatches[i];
    if ((batch.remainingQty || 0) <= 0) continue;

    const take = Math.min(batch.remainingQty, needed);
    const costForTake = take * (batch.buyPrice || 0);

    totalCost += costForTake;
    batch.remainingQty -= take;
    needed -= take;

    consumedDetails.push({
      batchId: batch.id,
      date: batch.date,
      createdAt: batch.createdAt,
      seq: batch.seq,
      initialQty: batch.initialQty ?? (batch.remainingQty + take),
      buyPrice: batch.buyPrice,
      unitsTaken: take,
      cost: Math.round(costForTake * 100) / 100,
    });
  }

  // If inventory ran below total tracked batches (negative stock / emergency sales),
  // price remaining deficit at fallbackBuyPrice or latest batch price
  if (needed > 0) {
    const unitPrice = currentBatches[currentBatches.length - 1]?.buyPrice || fallbackBuyPrice || 0;
    const extraCost = needed * unitPrice;
    totalCost += extraCost;
    consumedDetails.push({
      batchId: 'unassigned_deficit',
      date: new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
      seq: ++_batchSeq,
      initialQty: needed,
      buyPrice: unitPrice,
      unitsTaken: needed,
      cost: Math.round(extraCost * 100) / 100,
    });
  }

  // Filter out exhausted batches while consumedDetails preserves full restoration metadata
  const remainingBatches = currentBatches.filter(b => (b.remainingQty || 0) > 0);

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    remainingBatches,
    consumedDetails,
  };
}

/**
 * Restores previously consumed FIFO batches when a sale or damage write-off is reversed.
 * Preserves original batch buyPrice, date, and FIFO sequence ordering.
 *
 * @param {Array} currentBatches - Current batches on the inventory item
 * @param {Array} consumedDetails - The consumedDetails array recorded on the original transaction
 * @param {number} [fallbackQty=0] - Fallback quantity if consumedDetails is missing on legacy tx
 * @param {number} [fallbackBuyPrice=0] - Fallback unit cost if consumedDetails is missing
 * @returns {Array} Updated array of FIFO batches sorted oldest-first
 */
export function restoreFIFOBatches(currentBatches = [], consumedDetails = [], fallbackQty = 0, fallbackBuyPrice = 0) {
  const restored = Array.isArray(currentBatches)
    ? currentBatches.map((b, idx) => ({ ...b, seq: b.seq ?? (idx + 1000) }))
    : [];

  if (Array.isArray(consumedDetails) && consumedDetails.length > 0) {
    consumedDetails.forEach((detail, idx) => {
      const units = Number(detail.unitsTaken) || 0;
      if (units <= 0 || detail.batchId === 'unassigned_deficit') return;

      const existing = restored.find(b => b.id === detail.batchId);
      if (existing) {
        existing.remainingQty = (Number(existing.remainingQty) || 0) + units;
        if (detail.createdAt !== undefined && existing.createdAt === undefined) {
          existing.createdAt = detail.createdAt;
        }
        if (detail.seq !== undefined && existing.seq === undefined) {
          existing.seq = detail.seq;
        }
      } else {
        restored.push({
          id: detail.batchId || `batch_restored_${Date.now()}_${idx}`,
          date: detail.date || new Date().toISOString().slice(0, 10),
          createdAt: detail.createdAt ?? 0,
          seq: detail.seq ?? idx,
          buyPrice: Number(detail.buyPrice) || fallbackBuyPrice || 0,
          initialQty: Number(detail.initialQty) || units,
          remainingQty: units,
        });
      }
    });
  } else if ((Number(fallbackQty) || 0) > 0) {
    restored.unshift({
      ...createBatch(Number(fallbackQty), Number(fallbackBuyPrice) || 0),
      createdAt: 0,
      seq: -1,
    });
  }

  restored.sort(compareBatches);
  return restored;
}

/**
 * Calculates current total FIFO valuation of an item's remaining batches.
 * @param {Array} batches - Array of remaining batches
 * @returns {number} Total valuation
 */
export function calculateFIFOValuation(batches = []) {
  if (!Array.isArray(batches)) return 0;
  return batches.reduce((sum, b) => sum + ((b.remainingQty || 0) * (b.buyPrice || 0)), 0);
}

