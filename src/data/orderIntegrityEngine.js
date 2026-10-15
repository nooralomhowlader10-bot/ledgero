/**
 * Order Integrity, Catalog Price Verification & Legacy Migration Engine (Items 3, 4, 6, 11)
 * Pure functions for:
 *  - Authoritative verification of customer orders against public catalog & shop inventory
 *  - Protection against manipulated prices, unavailable products, invalid quantities & bad totals
 *  - Idempotent incoming-order deduplication and strict multi-business isolation
 *  - Legacy public product sanitization (stripping private buyPrice, profit, cogs, etc.)
 */

import { roundBDT } from './calculations.js';

export const ALLOWED_PUBLIC_PRODUCT_KEYS = [
  'name',
  'price',
  'unit',
  'category',
  'inStock',
  'stock',
  'addedAt',
  'updatedAt',
];

export const PRIVATE_PRODUCT_KEYS = [
  'buyPrice',
  'costPrice',
  'unitCost',
  'profit',
  'cogs',
  'fifoCogs',
  'fifoRevenue',
  'fifoSoldUnits',
  'openingStock',
  'addedStock',
  'closingStock',
  'damagedStock',
  'batches',
  'supplier',
  'supplierPhone',
];

/**
 * Sanitize a product document to strictly conform to the public product schema (Item 6).
 * Strips any legacy private fields (buyPrice, profit, batches, etc.).
 */
export function sanitizePublicProductRecord(rawProduct = {}) {
  if (!rawProduct || typeof rawProduct !== 'object') {
    return { cleanRecord: null, hadPrivateFields: false, strippedKeys: [] };
  }

  const strippedKeys = [];
  for (const key of Object.keys(rawProduct)) {
    if (key !== 'id' && !ALLOWED_PUBLIC_PRODUCT_KEYS.includes(key)) {
      strippedKeys.push(key);
    }
  }

  const rawPrice = rawProduct.price !== undefined ? rawProduct.price : rawProduct.sellPrice;
  const price = Math.max(0, Math.min(100000000, Number(rawPrice) || 0));
  const name = String(rawProduct.name || '').trim().slice(0, 150);
  if (!name) {
    return { cleanRecord: null, hadPrivateFields: strippedKeys.length > 0, strippedKeys };
  }

  const rawStock = rawProduct.stock !== undefined
    ? Number(rawProduct.stock)
    : (rawProduct.closingStock !== undefined ? Number(rawProduct.closingStock) : null);
  const safeStock = rawStock !== null && Number.isFinite(rawStock)
    ? Math.max(0, Math.min(10000000, rawStock))
    : undefined;

  const cleanRecord = {
    name,
    price,
    category: String(rawProduct.category || '').trim().slice(0, 80),
    unit: String(rawProduct.unit || 'pcs').trim().slice(0, 30),
    inStock: rawProduct.inStock !== undefined
      ? Boolean(rawProduct.inStock)
      : (safeStock !== undefined ? safeStock > 0 : true),
    ...(safeStock !== undefined && { stock: safeStock }),
    addedAt: String(rawProduct.addedAt || new Date().toISOString()).slice(0, 40),
    updatedAt: String(rawProduct.updatedAt || new Date().toISOString()).slice(0, 40),
  };

  return {
    cleanRecord,
    hadPrivateFields: strippedKeys.length > 0,
    strippedKeys,
    strippedPrivateFields: strippedKeys,
  };
}

/**
 * Find matching authoritative product from catalog/inventory by id or normalized name.
 */
export function findAuthoritativeProduct(orderItem, catalogProducts = []) {
  if (!orderItem || !Array.isArray(catalogProducts) || catalogProducts.length === 0) {
    return null;
  }
  const itemProdId = String(orderItem.productId || '').trim();
  const itemProdName = String(orderItem.productName || orderItem.name || '').trim().toLowerCase();

  if (itemProdId) {
    const byId = catalogProducts.find(p => String(p.id || '').trim() === itemProdId);
    if (byId) return byId;
  }
  if (itemProdName) {
    const byName = catalogProducts.find(
      p => String(p.name || p.productName || '').trim().toLowerCase() === itemProdName
    );
    if (byName) return byName;
  }
  return null;
}

/**
 * Authoritatively validate an order's items, prices, availability, quantities, stock, and totals
 * against trusted product records (Item 3).
 *
 * @param {object} order - Incoming or stored customer order
 * @param {Array} authoritativeProducts - Inventory items or public store product records
 * @param {object} options - { requireCatalogMatch: boolean, checkStockLevel: boolean }
 */
export function verifyOrderAgainstCatalog(order, authoritativeProducts = [], options = {}) {
  const issues = [];
  if (!order || typeof order !== 'object') {
    return {
      valid: false,
      verificationStatus: 'invalid_order',
      issues: [{ code: 'invalid_order', message: 'Order payload is missing or invalid' }],
      repricingRequired: false,
      stockBlocked: true,
    };
  }

  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length < 1 || items.length > 5) {
    issues.push({
      code: 'invalid_item_count',
      message: `Order must contain between 1 and 5 items (received ${items.length})`,
    });
  }

  const hasCatalog = Array.isArray(authoritativeProducts) && authoritativeProducts.length > 0;
  const requireCatalogMatch = options.requireCatalogMatch !== undefined
    ? Boolean(options.requireCatalogMatch)
    : hasCatalog;
  const checkStockLevel = options.checkStockLevel !== undefined
    ? Boolean(options.checkStockLevel)
    : hasCatalog;

  let submittedItemsSubtotal = 0;
  let authoritativeItemsSubtotal = 0;
  const verifiedItems = [];

  items.forEach((item, index) => {
    const productName = String(item?.productName || item?.name || '').trim();
    const rawQty = Number(item?.quantity);
    const rawUnitPrice = Number(item?.unitPrice);
    const rawSubtotal = item?.subtotal !== undefined ? Number(item.subtotal) : roundBDT(rawQty * rawUnitPrice);

    if (!productName) {
      issues.push({
        code: 'invalid_product',
        itemIndex: index,
        message: `Item #${index + 1} is missing a product name`,
      });
    }

    if (!Number.isFinite(rawQty) || rawQty < 1 || rawQty > 10000 || !Number.isInteger(rawQty)) {
      issues.push({
        code: 'invalid_quantity',
        itemIndex: index,
        productName,
        submittedQuantity: item?.quantity,
        message: `Item "${productName || index + 1}" has an invalid quantity (${item?.quantity})`,
      });
    }

    if (!Number.isFinite(rawUnitPrice) || rawUnitPrice < 0 || rawUnitPrice > 100000000) {
      issues.push({
        code: 'invalid_price',
        itemIndex: index,
        productName,
        submittedPrice: item?.unitPrice,
        message: `Item "${productName || index + 1}" has an invalid unit price (${item?.unitPrice})`,
      });
    }

    const expectedItemSubtotal = Number.isFinite(rawQty) && Number.isFinite(rawUnitPrice)
      ? roundBDT(rawQty * rawUnitPrice)
      : 0;
    if (!Number.isFinite(rawSubtotal) || Math.abs(rawSubtotal - expectedItemSubtotal) > 0.01) {
      issues.push({
        code: 'inconsistent_item_subtotal',
        itemIndex: index,
        productName,
        submittedSubtotal: item?.subtotal,
        expectedSubtotal: expectedItemSubtotal,
        message: `Item "${productName || index + 1}" subtotal (${item?.subtotal}) does not equal quantity * unitPrice (${expectedItemSubtotal})`,
      });
    }

    submittedItemsSubtotal = roundBDT(submittedItemsSubtotal + (Number.isFinite(expectedItemSubtotal) ? expectedItemSubtotal : 0));

    const matchedProduct = hasCatalog ? findAuthoritativeProduct(item, authoritativeProducts) : null;
    let authoritativeUnitPrice = Number.isFinite(rawUnitPrice) ? rawUnitPrice : 0;

    if (requireCatalogMatch && !matchedProduct) {
      issues.push({
        code: 'unavailable_product',
        itemIndex: index,
        productName,
        productId: item?.productId || null,
        message: `Product "${productName || item?.productId || index + 1}" does not exist in shop catalog`,
      });
    } else if (matchedProduct) {
      // Check availability flag
      if (matchedProduct.inStock === false) {
        issues.push({
          code: 'unavailable_product',
          itemIndex: index,
          productName: matchedProduct.name || productName,
          productId: matchedProduct.id || item?.productId,
          message: `Product "${matchedProduct.name || productName}" is marked out of stock`,
        });
      }

      // Check physical stock level if closingStock or stock is present on product/inventory item
      const rawAvailableStock = matchedProduct.closingStock !== undefined && matchedProduct.closingStock !== null
        ? matchedProduct.closingStock
        : matchedProduct.stock;
      if (checkStockLevel && rawAvailableStock !== undefined && rawAvailableStock !== null) {
        const availableStock = Number(rawAvailableStock) || 0;
        if (Number.isFinite(rawQty) && rawQty > availableStock) {
          issues.push({
            code: 'insufficient_stock',
            itemIndex: index,
            productName: matchedProduct.name || productName,
            productId: matchedProduct.id || item?.productId,
            requestedQuantity: rawQty,
            availableStock,
            message: `Insufficient stock for "${matchedProduct.name || productName}": requested ${rawQty}, available ${availableStock}`,
          });
        }
      }

      // Check authoritative price
      const catalogPrice = matchedProduct.sellPrice !== undefined
        ? Number(matchedProduct.sellPrice)
        : Number(matchedProduct.price);
      if (Number.isFinite(catalogPrice) && catalogPrice >= 0) {
        authoritativeUnitPrice = catalogPrice;
        if (Number.isFinite(rawUnitPrice) && Math.abs(rawUnitPrice - catalogPrice) > 0.01) {
          issues.push({
            code: 'price_mismatch',
            itemIndex: index,
            productName: matchedProduct.name || productName,
            productId: matchedProduct.id || item?.productId,
            submittedPrice: rawUnitPrice,
            authoritativePrice: catalogPrice,
            message: `Manipulated or stale price for "${matchedProduct.name || productName}": submitted ৳${rawUnitPrice}, authoritative catalog price is ৳${catalogPrice}`,
          });
        }
      }
    }

    const authoritativeItemSubtotal = Number.isFinite(rawQty) && rawQty > 0
      ? roundBDT(rawQty * authoritativeUnitPrice)
      : 0;
    authoritativeItemsSubtotal = roundBDT(authoritativeItemsSubtotal + authoritativeItemSubtotal);

    verifiedItems.push({
      productId: matchedProduct?.id || item?.productId || '',
      productName: matchedProduct?.name || productName,
      quantity: Number.isFinite(rawQty) ? rawQty : 0,
      unitPrice: authoritativeUnitPrice,
      submittedUnitPrice: rawUnitPrice,
      subtotal: authoritativeItemSubtotal,
    });
  });

  const deliveryCharge = Math.max(0, Number(order.deliveryCharge) || 0);
  const discount = Math.max(0, Number(order.discount) || 0);

  if (order.subtotal !== undefined && order.subtotal !== null) {
    const submittedOrderSubtotal = Number(order.subtotal);
    if (!Number.isFinite(submittedOrderSubtotal) || Math.abs(submittedOrderSubtotal - submittedItemsSubtotal) > 0.01) {
      issues.push({
        code: 'inconsistent_totals',
        submittedSubtotal: order.subtotal,
        expectedSubtotal: submittedItemsSubtotal,
        message: `Order subtotal (${order.subtotal}) does not match sum of item subtotals (${submittedItemsSubtotal})`,
      });
    }
  }

  const expectedSubmittedTotal = roundBDT(Math.max(0, submittedItemsSubtotal + deliveryCharge - discount));
  const submittedTotal = Number(order.totalAmount);
  if (!Number.isFinite(submittedTotal) || Math.abs(submittedTotal - expectedSubmittedTotal) > 0.01) {
    issues.push({
      code: 'inconsistent_totals',
      submittedTotal: order.totalAmount,
      expectedTotal: expectedSubmittedTotal,
      message: `Order totalAmount (${order.totalAmount}) does not equal subtotal + deliveryCharge - discount (${expectedSubmittedTotal})`,
    });
  }

  const authoritativeTotal = roundBDT(Math.max(0, authoritativeItemsSubtotal + deliveryCharge - discount));

  return {
    valid: issues.length === 0,
    verificationStatus: issues.length === 0 ? 'verified' : issues[0].code,
    issues,
    submittedSubtotal: submittedItemsSubtotal,
    submittedTotal: Number.isFinite(submittedTotal) ? submittedTotal : 0,
    authoritativeSubtotal: authoritativeItemsSubtotal,
    authoritativeTotal,
    repricingRequired: issues.some(i => i.code === 'price_mismatch' || i.code === 'inconsistent_totals' || i.code === 'inconsistent_item_subtotal'),
    stockBlocked: issues.some(i =>
      i.code === 'unavailable_product' ||
      i.code === 'insufficient_stock' ||
      i.code === 'invalid_quantity' ||
      i.code === 'invalid_product' ||
      i.code === 'invalid_price' ||
      i.code === 'invalid_item_count'
    ),
    verifiedItems,
  };
}

/**
 * Reprice an order using authoritative catalog prices after shop owner review (Item 3).
 */
export function repriceOrderFromCatalog(order, authoritativeProducts = []) {
  const check = verifyOrderAgainstCatalog(order, authoritativeProducts, {
    requireCatalogMatch: true,
    checkStockLevel: false,
  });
  if (check.stockBlocked) {
    const err = new Error(check.issues[0]?.message || 'Cannot reprice order with unavailable products or invalid quantities');
    err.code = check.issues[0]?.code || 'order-verification-failed';
    err.issues = check.issues;
    throw err;
  }
  const advancePaid = Math.max(0, Number(order.advancePaid) || 0);
  return {
    ...order,
    items: check.verifiedItems.map(({ submittedUnitPrice, ...rest }) => rest),
    subtotal: check.authoritativeSubtotal,
    totalAmount: check.authoritativeTotal,
    codAmount: roundBDT(Math.max(0, check.authoritativeTotal - advancePaid)),
    priceVerified: true,
    verificationStatus: 'verified',
    verificationIssues: [],
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Verify that a public store document belongs to the expected owner and active business (Item 4).
 */
export function verifyStoreBusinessOwnership(storeDoc, expectedUserId, expectedBizId) {
  if (!storeDoc || typeof storeDoc !== 'object') {
    return { valid: false, allowed: false, code: 'store-not-found', reason: 'Store document does not exist' };
  }
  if (!expectedUserId || storeDoc.ownerUserId !== expectedUserId) {
    return { valid: false, allowed: false, code: 'store-owner-mismatch', reason: 'Store does not belong to current user' };
  }
  if (!expectedBizId) {
    return { valid: false, allowed: false, code: 'missing-active-business', reason: 'Active business ID is required' };
  }
  if (storeDoc.bizId && storeDoc.bizId !== expectedBizId) {
    return {
      valid: false,
      allowed: false,
      code: 'store-business-mismatch',
      reason: `Store belongs to business "${storeDoc.bizId}", not active business "${expectedBizId}"`,
    };
  }
  return { valid: true, allowed: true, code: 'ok', reason: null };
}

/**
 * Merge newly transferred incoming orders into an existing business onlineOrders list idempotently (Item 4).
 * Never duplicates an order with the same ID, and never overwrites an order that has already progressed
 * past 'new' status.
 */
export function mergeIncomingOrdersIdempotently(existingOrders = [], incomingOrders = []) {
  const byId = new Map();
  const result = [];

  for (const existing of (existingOrders || [])) {
    if (!existing?.id) continue;
    byId.set(existing.id, existing);
    result.push(existing);
  }

  let addedCount = 0;
  let skippedCount = 0;
  for (const incoming of (incomingOrders || [])) {
    if (!incoming?.id) continue;
    if (byId.has(incoming.id)) {
      // Already present — preserve existing order state (idempotent retry protection)
      skippedCount++;
      continue;
    }
    byId.set(incoming.id, incoming);
    result.unshift(incoming);
    addedCount++;
  }

  return {
    orders: result,
    mergedOrders: result,
    addedCount,
    skippedCount,
  };
}
