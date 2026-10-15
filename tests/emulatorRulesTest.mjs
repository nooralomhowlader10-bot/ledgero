/**
 * tests/emulatorRulesTest.mjs
 * Real Firebase Firestore Emulator Integration Test Suite
 *
 * Verifies live `firestore.rules` against a running Firestore Emulator instance.
 * Run locally with:
 *   firebase emulators:exec --only firestore "node tests/emulatorRulesTest.mjs"
 * Or start emulator in background and run:
 *   npm run test:emulator
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [host, port] = EMULATOR_HOST.split(':');

async function isEmulatorRunning() {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve(body.trim() === 'Ok');
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

const isEmbedded = port === '18080' || process.env.FORCE_REST === '1';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (isEmbedded) {
  console.log('🧪 EMBEDDED RULES-CONTRACT SIMULATOR TEST SUITE (Node.js REST)');
  console.log(`Connecting to Embedded Simulator at http://${EMULATOR_HOST}...`);
} else {
  console.log('🔥 GOOGLE CLOUD FIRESTORE EMULATOR TEST SUITE (Official Google Emulator)');
  console.log(`Connecting to Firestore Emulator at ${EMULATOR_HOST}...`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const running = await isEmulatorRunning();
if (!running) {
  if (isEmbedded) {
    console.error(`❌ Embedded Rules Simulator is NOT running at http://${EMULATOR_HOST}.`);
    process.exit(1);
  } else {
    console.error(`❌ Google Firestore Emulator is NOT running at http://${EMULATOR_HOST}.`);
    console.error('   To run against the live official Google Firestore Emulator (requires Java JDK 21+):');
    console.error('     npx firebase emulators:start --only firestore');
    console.error('   Or launch via Firebase emulator wrapper:');
    console.error('     npx firebase emulators:exec --only firestore "node tests/emulatorRulesTest.mjs"\n');
    console.error('💡 To test rules contracts without Java 21+, run the embedded simulator suite:');
    console.error('     npm run test:rules:embedded\n');
    process.exit(1);
  }
}

// When emulator is running, import Firebase client SDK or fallback to zero-dependency native REST
let doc, getDoc, setDoc, dbOwner, appOwner, deleteApp;
let usingNativeRest = false;

if (process.env.FORCE_REST) {
  usingNativeRest = true;
} else {
  try {
    const { initializeApp, deleteApp: fbDeleteApp } = await import('firebase/app');
    const { getFirestore, connectFirestoreEmulator, doc: fbDoc, getDoc: fbGetDoc, setDoc: fbSetDoc } = await import('firebase/firestore');
    appOwner = initializeApp({ projectId: 'shopbook-460ca', apiKey: 'fake-api-key' }, 'ownerApp');
    dbOwner = getFirestore(appOwner);
    connectFirestoreEmulator(dbOwner, host, parseInt(port, 10));
    doc = fbDoc;
    getDoc = fbGetDoc;
    setDoc = fbSetDoc;
    deleteApp = fbDeleteApp;
  } catch (_err) {
    usingNativeRest = true;
  }
}

if (usingNativeRest) {
  console.log('ℹ️  Using zero-dependency native REST client for Firestore Emulator verification...');
  dbOwner = { projectId: 'shopbook-460ca' };
  doc = (_db, ...segments) => ({ path: segments.join('/') });

  function toFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
      return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    }
    if (typeof val === 'string') return { stringValue: val };
    if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
    if (typeof val === 'object') {
      const fields = {};
      for (const [k, v] of Object.entries(val)) {
        fields[k] = toFirestoreValue(v);
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
  }

  getDoc = async (docRef) => {
    const url = `http://${host}:${port}/v1/projects/shopbook-460ca/databases/(default)/documents/${docRef.path}`;
    const res = await fetch(url);
    if (res.status === 403) {
      const err = new Error('permission-denied: Client does not have permission');
      err.code = 'permission-denied';
      throw err;
    }
    if (res.status === 404) {
      return { exists: () => false, data: () => null };
    }
    const data = await res.json().catch(() => null);
    return {
      exists: () => Boolean(data && data.fields),
      data: () => data?.fields,
    };
  };

  setDoc = async (docRef, dataObj, _options = {}) => {
    const fields = {};
    for (const [k, v] of Object.entries(dataObj)) {
      fields[k] = toFirestoreValue(v);
    }
    const url = `http://${host}:${port}/v1/projects/shopbook-460ca/databases/(default)/documents/${docRef.path}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
      const err = new Error(errMsg);
      err.code = res.status === 403 ? 'permission-denied' : 'error';
      throw err;
    }
    return true;
  };
}

function createMockJwt(uid) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    user_id: uid,
    sub: uid,
    user_id: uid,
    aud: 'shopbook-460ca',
    iss: 'https://securetoken.google.com/shopbook-460ca',
    auth_time: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  return `${header}.${payload}.`;
}

// Helper for sending authenticated REST operations with mock auth tokens
async function firestoreRest(docPath, { method = 'GET', body = null, uid = null } = {}) {
  const url = `http://${host}:${port}/v1/projects/shopbook-460ca/databases/(default)/documents/${docPath}`;
  const headers = {};
  if (uid) {
    headers['Authorization'] = `Bearer ${createMockJwt(uid)}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`[firestoreRest] ${method} ${docPath} (${res.status}):`, JSON.stringify(data));
  }
  return { status: res.status, ok: res.ok, data };
}

if (isEmbedded) {
  console.log('🧪 Connected to Embedded Rules-Contract Simulator (Port 18080)!');
  console.log('Running security rules contract verification against embedded Node.js rules simulator...\n');
} else {
  console.log('🔥 Connected to live Google Cloud Firestore Emulator!');
  console.log('Running security rules contract verification against live Google Cloud Firestore Emulator...\n');
}

let passed = 0;
let failed = 0;
const testLogEntries = [];

async function test(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - startedAt;
    console.log(`  ✅ [PASS] ${name} (${durationMs}ms)`);
    passed += 1;
    testLogEntries.push({ name, status: 'PASS', durationMs });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed += 1;
    testLogEntries.push({ name, status: 'FAIL', durationMs, error: err.message });
  }
}

// Seed 'emulator-test-store' as authenticated owner so it exists for storefront & order tests
const seedStoreOwnerUid = 'emu_seed_owner_1';
await firestoreRest('stores/emulator-test-store', {
  method: 'PATCH',
  uid: seedStoreOwnerUid,
  body: {
    fields: {
      shopName: { stringValue: 'Emulator Test Store' },
      ownerUserId: { stringValue: seedStoreOwnerUid },
      whatsappNumber: { stringValue: '01711112222' },
      isActive: { booleanValue: true },
    },
  },
});

// 1. Unauthenticated read on private store document must fail
await test('1. Unauthenticated client cannot access private owner store (/stores/{slug})', async () => {
  const storeRef = doc(dbOwner, 'stores', 'emulator-test-store');
  await assert.rejects(
    async () => getDoc(storeRef),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 2. Unauthenticated read on public store info must succeed (or return not-found without permission error)
await test('2. Unauthenticated client can read public store info (/stores/{slug}/public/info)', async () => {
  const publicInfoRef = doc(dbOwner, 'stores', 'emulator-test-store', 'public', 'info');
  try {
    const snap = await getDoc(publicInfoRef);
    assert.equal(snap.exists(), false); // Empty is expected, but NO permission-denied!
  } catch (err) {
    assert.fail(`Public read failed with error: ${err.message}`);
  }
});

// 3. Unauthenticated read on public store products must succeed
await test('3. Unauthenticated client can read public store products (/stores/{slug}/products/{id})', async () => {
  const prodRef = doc(dbOwner, 'stores', 'emulator-test-store', 'products', 'p1');
  try {
    const snap = await getDoc(prodRef);
    assert.equal(snap.exists(), false); // Empty is expected, but NO permission-denied!
  } catch (err) {
    assert.fail(`Public read failed with error: ${err.message}`);
  }
});

// 4. Unauthenticated client cannot read user private docs
await test('4. Unauthenticated client is blocked from reading user data (/users/{userId})', async () => {
  const userRef = doc(dbOwner, 'users', 'secret_user_123');
  await assert.rejects(
    async () => getDoc(userRef),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 5. Unauthenticated client cannot read or write audit logs
await test('5. Unauthenticated client is blocked from reading audit logs (/users/{userId}/businesses/{bizId}/auditLog)', async () => {
  const auditRef = doc(dbOwner, 'users', 'secret_user_123', 'businesses', 'biz_1', 'auditLog', 'log_1');
  await assert.rejects(
    async () => getDoc(auditRef),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 6. Anonymous customer can submit valid draft order to public storefront
await test('6. Anonymous customer can place a valid draft order (/stores/{slug}/orders/{orderId})', async () => {
  const validOrder = {
    id: 'ord_emu_valid_1',
    customerName: 'Shakib Khan',
    customerPhone: '01712345678',
    totalAmount: 1500,
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
    status: 'draft',
    source: 'web_storefront',
  };
  await setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'ord_emu_valid_1'), validOrder);
});

// 7. Malicious order with status == 'delivered' is blocked by firestore.rules
await test('7. Malicious order with status == "delivered" is rejected with permission-denied', async () => {
  const badOrder = {
    id: 'ord_emu_bad_status',
    customerName: 'Hacker',
    customerPhone: '01700000000',
    totalAmount: 1500,
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
    status: 'delivered', // ❌ VIOLATION: only 'draft' status allowed on public creation
  };
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'ord_emu_bad_status'), badOrder),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 8. Malicious order with unauthorized/injected fields is blocked
await test('8. Malicious order with injected unauthorized fields is rejected with permission-denied', async () => {
  const badOrder = {
    id: 'ord_emu_bad_fields',
    customerName: 'Hacker',
    customerPhone: '01700000000',
    totalAmount: 1500,
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
    status: 'draft',
    isAdminPrivileged: true, // ❌ VIOLATION: not allowed by isValidIncomingCustomerOrder
  };
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'ord_emu_bad_fields'), badOrder),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 9. Malicious order with negative totalAmount is blocked
await test('9. Malicious order with negative totalAmount is rejected with permission-denied', async () => {
  const badOrder = {
    id: 'ord_emu_bad_total',
    customerName: 'Hacker',
    customerPhone: '01700000000',
    totalAmount: -750, // ❌ VIOLATION: negative total
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
    status: 'draft',
  };
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'ord_emu_bad_total'), badOrder),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 10. Malicious order placed against nonexistent store is blocked
await test('10. Order on nonexistent store path is rejected with permission-denied', async () => {
  const badOrder = {
    id: 'ord_emu_nonexistent',
    customerName: 'Buyer',
    customerPhone: '01700000000',
    totalAmount: 1500,
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
    status: 'draft',
  };
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'nonexistent-fake-store-slug', 'orders', 'ord_emu_nonexistent'), badOrder),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 11. Order with path ID mismatch is blocked
await test('11. Order with id mismatch (path id != document id) is rejected with permission-denied', async () => {
  const mismatchedOrder = {
    id: 'different_id_than_path',
    customerName: 'Buyer',
    customerPhone: '01700000000',
    totalAmount: 1500,
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
    status: 'draft',
  };
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'actual_path_id'), mismatchedOrder),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 12. Order with 6 items (where the 6th item is malformed) is blocked
await test('12. Order with 6 items where the 6th item is malformed is rejected with permission-denied', async () => {
  const sixItemOrder = {
    id: 'ord_emu_six_items',
    customerName: 'Buyer',
    customerPhone: '01700000000',
    totalAmount: 500,
    items: [
      { productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 100, subtotal: 100 },
      { productId: 'p2', productName: 'Item 2', quantity: 1, unitPrice: 100, subtotal: 100 },
      { productId: 'p3', productName: 'Item 3', quantity: 1, unitPrice: 100, subtotal: 100 },
      { productId: 'p4', productName: 'Item 4', quantity: 1, unitPrice: 100, subtotal: 100 },
      { productId: 'p5', productName: 'Item 5', quantity: 1, unitPrice: 100, subtotal: 100 },
      { productId: 'p6', productName: '', quantity: -5, unitPrice: -100, subtotal: 0 }, // ❌ Malformed 6th item
    ],
    status: 'draft',
  };
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'ord_emu_six_items'), sixItemOrder),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 13. Order with omitted subtotal field where totalAmount != sum(items.subtotal) + deliveryCharge is blocked
await test('13. Order without subtotal field where totalAmount does not equal sum of item subtotals is rejected', async () => {
  const mismatchedTotalOrder = {
    id: 'ord_emu_no_subtotal_mismatch',
    customerName: 'Buyer',
    customerPhone: '01700000000',
    totalAmount: 50, // ❌ Should be 1500
    items: [{ productId: 'p1', productName: 'Item 1', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
    status: 'draft',
  };
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'ord_emu_no_subtotal_mismatch'), mismatchedTotalOrder),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 14. Updating an existing storefront order is blocked
await test('14. Updating an existing storefront order is rejected (allow update: if false;)', async () => {
  await assert.rejects(
    async () => setDoc(doc(dbOwner, 'stores', 'emulator-test-store', 'orders', 'ord_emu_valid_1'), {
      customerName: 'Tampered Name',
    }, { merge: true }),
    (err) => err.code === 'permission-denied' || err.message.includes('permission-denied')
  );
});

// 15. Authenticated Storefront Isolation & Owner Separation
await test('15. Authenticated stranger cannot read owner store (/stores/{slug}), owner can', async () => {
  const ownerUid = 'emu_store_owner_1';
  const strangerUid = 'emu_stranger_user_2';
  const slug = 'emu-live-shop-1';

  // Seed store document as owner
  const seedRes = await firestoreRest(`stores/${slug}`, {
    method: 'PATCH',
    uid: ownerUid,
    body: {
      fields: {
        shopName: { stringValue: 'Live Emulator Shop' },
        ownerUserId: { stringValue: ownerUid },
        whatsappNumber: { stringValue: '01799999999' },
        isActive: { booleanValue: true },
      },
    },
  });
  assert.equal(seedRes.status, 200, 'Owner should be able to create store doc');

  // Stranger attempts to read private store doc
  const strangerRes = await firestoreRest(`stores/${slug}`, {
    method: 'GET',
    uid: strangerUid,
  });
  assert.equal(strangerRes.status, 403, 'Authenticated stranger must receive 403 PERMISSION_DENIED on /stores/{slug}');

  // Owner reads own store doc
  const ownerRes = await firestoreRest(`stores/${slug}`, {
    method: 'GET',
    uid: ownerUid,
  });
  assert.equal(ownerRes.status, 200, 'Store owner must receive 200 OK on /stores/{slug}');
});

// 16. Owner vs Non-Owner private business ledger access (/users/{userId}/businesses/{bizId}/days/{dateKey})
await test('16. Owner can read/write private ledger days, non-owner authenticated user is blocked with 403', async () => {
  const ownerUid = 'emu_ledger_owner_1';
  const strangerUid = 'emu_ledger_stranger_2';
  const dayPath = `users/${ownerUid}/businesses/default/days/2026-10-10`;

  const ownerWrite = await firestoreRest(dayPath, {
    method: 'PATCH',
    uid: ownerUid,
    body: {
      fields: {
        dateKey: { stringValue: '2026-10-10' },
        status: { stringValue: 'open' },
      },
    },
  });
  assert.equal(ownerWrite.status, 200, 'Owner should write day document');

  const strangerRead = await firestoreRest(dayPath, {
    method: 'GET',
    uid: strangerUid,
  });
  assert.equal(strangerRead.status, 403, 'Non-owner must be blocked from reading owner ledger day');

  const strangerWrite = await firestoreRest(dayPath, {
    method: 'PATCH',
    uid: strangerUid,
    body: {
      fields: {
        dateKey: { stringValue: '2026-10-10' },
        status: { stringValue: 'finalized' },
      },
    },
  });
  assert.equal(strangerWrite.status, 403, 'Non-owner must be blocked from modifying owner ledger day');
});

// 17. Public product allowlist enforcement & non-owner verification (Item 6 & Item 7)
await test('17. Public product blocks private fields (buyPrice, profit, batches) and non-owner reads only public schema', async () => {
  const ownerUid = 'emu_store_owner_1';
  const nonOwnerUid = 'emu_non_owner_customer';
  const slug = 'emu-live-shop-1';

  // Attempt to publish product with private buyPrice & profit -> MUST FAIL (403)
  const leakyProdRes = await firestoreRest(`stores/${slug}/products/prod_leaky`, {
    method: 'PATCH',
    uid: ownerUid,
    body: {
      fields: {
        name: { stringValue: 'Miniket Rice 5kg' },
        price: { integerValue: '420' },
        buyPrice: { integerValue: '350' }, // ❌ Forbidden private field
        profit: { integerValue: '70' },    // ❌ Forbidden private field
        inStock: { booleanValue: true },
      },
    },
  });
  assert.equal(leakyProdRes.status, 403, 'Public product with buyPrice/profit must be rejected with 403');

  // Publish sanitized public-only product -> MUST SUCCEED (200)
  const cleanProdRes = await firestoreRest(`stores/${slug}/products/prod_clean`, {
    method: 'PATCH',
    uid: ownerUid,
    body: {
      fields: {
        name: { stringValue: 'Miniket Rice 5kg' },
        price: { integerValue: '420' },
        unit: { stringValue: 'bag' },
        category: { stringValue: 'Grocery' },
        inStock: { booleanValue: true },
        stock: { integerValue: '15' },
      },
    },
  });
  assert.equal(cleanProdRes.status, 200, 'Sanitized public product should be accepted');

  // Non-owner account reads the published product and verifies no private fields exist
  const nonOwnerRead = await firestoreRest(`stores/${slug}/products/prod_clean`, {
    method: 'GET',
    uid: nonOwnerUid,
  });
  assert.equal(nonOwnerRead.status, 200, 'Non-owner can read public product');
  const fields = nonOwnerRead.data?.fields || {};
  assert.equal(fields.buyPrice, undefined, 'buyPrice must never be exposed on public product');
  assert.equal(fields.profit, undefined, 'profit must never be exposed on public product');
  assert.equal(fields.batches, undefined, 'batches must never be exposed on public product');
  assert.equal(fields.name?.stringValue, 'Miniket Rice 5kg');
});

// 18. Audit log tamper-resistant append-only verification (even after meta/info removal)
await test('18. Audit log is strictly append-only; cannot be updated or deleted even if meta/info is removed', async () => {
  const auditOwner = 'emu_audit_owner_1';
  const bizId = 'biz_emu_1';

  // Seed meta/info to mark business active
  const metaRes = await firestoreRest(`users/${auditOwner}/businesses/${bizId}/meta/info`, {
    method: 'PATCH',
    uid: auditOwner,
    body: { fields: { initialized: { booleanValue: true } } },
  });
  assert.equal(metaRes.status, 200);

  // Create audit log
  const createLogRes = await firestoreRest(`users/${auditOwner}/businesses/${bizId}/auditLog/log_emu_1`, {
    method: 'PATCH',
    uid: auditOwner,
    body: {
      fields: {
        action: { stringValue: 'REVERSE' },
        timestamp: { stringValue: new Date().toISOString() },
      },
    },
  });
  assert.equal(createLogRes.status, 200, 'Audit log creation should succeed');

  // Attempt to UPDATE audit log -> Must be blocked (allow update, delete: if false;)
  const updateLogRes = await firestoreRest(`users/${auditOwner}/businesses/${bizId}/auditLog/log_emu_1`, {
    method: 'PATCH',
    uid: auditOwner,
    body: {
      fields: { action: { stringValue: 'TAMPERED_ACTION' } },
    },
  });
  assert.equal(updateLogRes.status, 403, 'Audit log update must be rejected with 403');

  // Attempt to DELETE audit log while meta/info exists -> Must be blocked
  const deleteLogBlockedRes = await firestoreRest(`users/${auditOwner}/businesses/${bizId}/auditLog/log_emu_1`, {
    method: 'DELETE',
    uid: auditOwner,
  });
  assert.equal(deleteLogBlockedRes.status, 403, 'Audit log deletion while business is active must be rejected with 403');

  // Delete meta/info
  const delMetaRes = await firestoreRest(`users/${auditOwner}/businesses/${bizId}/meta/info`, {
    method: 'DELETE',
    uid: auditOwner,
  });
  assert.equal(delMetaRes.status, 200);

  // Attempt to DELETE audit log after meta/info deleted -> Must STILL be blocked (403)
  const deleteLogStillBlockedRes = await firestoreRest(`users/${auditOwner}/businesses/${bizId}/auditLog/log_emu_1`, {
    method: 'DELETE',
    uid: auditOwner,
  });
  assert.equal(deleteLogStillBlockedRes.status, 403, 'Client-side deletion of meta/info must NOT unlock deletion of auditLog');
});

await test('19. Storefront Mobile Banking numbers (bkashNumber/nagadNumber) & customer order TrxID validation', async () => {
  const mbOwner = 'owner_mb_19';
  const mbSlug = `mb-shop-${Date.now()}`;

  // 1. Owner creates store with bkashNumber & nagadNumber
  const createStoreRes = await firestoreRest(`stores/${mbSlug}`, {
    method: 'PATCH',
    uid: mbOwner,
    body: {
      fields: {
        shopName: { stringValue: 'MB Telecom' },
        ownerUserId: { stringValue: mbOwner },
        whatsappNumber: { stringValue: '01712345678' },
        bkashNumber: { stringValue: '01712345678' },
        nagadNumber: { stringValue: '01812345678' },
        isActive: { booleanValue: true },
      },
    },
  });
  assert.equal(createStoreRes.status, 200, 'Owner should create store with bkashNumber and nagadNumber');

  // 2. Owner creates public/info with bkashNumber & nagadNumber
  const createPubRes = await firestoreRest(`stores/${mbSlug}/public/info`, {
    method: 'PATCH',
    uid: mbOwner,
    body: {
      fields: {
        shopName: { stringValue: 'MB Telecom' },
        whatsappNumber: { stringValue: '01712345678' },
        bkashNumber: { stringValue: '01712345678' },
        nagadNumber: { stringValue: '01812345678' },
        isActive: { booleanValue: true },
      },
    },
  });
  assert.equal(createPubRes.status, 200, 'Owner should publish bkashNumber and nagadNumber in public/info');

  // 3. Unauthenticated customer submits valid bKash order with paymentTrxId & paymentSenderPhone
  const validMbOrderRes = await firestoreRest(`stores/${mbSlug}/orders/ord_mb_valid`, {
    method: 'PATCH',
    uid: null,
    body: {
      fields: {
        id: { stringValue: 'ord_mb_valid' },
        customerName: { stringValue: 'Rahim' },
        customerPhone: { stringValue: '01799887766' },
        paymentMethod: { stringValue: 'bkash_manual' },
        paymentTrxId: { stringValue: 'BKS982374X' },
        paymentSenderPhone: { stringValue: '01799887766' },
        status: { stringValue: 'draft' },
        subtotal: { integerValue: '500' },
        deliveryCharge: { integerValue: '60' },
        totalAmount: { integerValue: '560' },
        items: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    productName: { stringValue: 'Router' },
                    quantity: { integerValue: '1' },
                    unitPrice: { integerValue: '500' },
                    subtotal: { integerValue: '500' },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(validMbOrderRes.status, 200, 'Customer order with valid bkash_manual + paymentTrxId should succeed');

  // 4. Unauthenticated customer order with invalid paymentMethod must be rejected (403)
  const invalidMethodRes = await firestoreRest(`stores/${mbSlug}/orders/ord_mb_invalid`, {
    method: 'PATCH',
    uid: null,
    body: {
      fields: {
        id: { stringValue: 'ord_mb_invalid' },
        customerName: { stringValue: 'Rahim' },
        customerPhone: { stringValue: '01799887766' },
        paymentMethod: { stringValue: 'hacked_gateway' },
        status: { stringValue: 'draft' },
        totalAmount: { integerValue: '500' },
        items: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    productName: { stringValue: 'Router' },
                    quantity: { integerValue: '1' },
                    unitPrice: { integerValue: '500' },
                    subtotal: { integerValue: '500' },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(invalidMethodRes.status, 403, 'Order with unsupported paymentMethod must be rejected with 403');

  // 5. Unsupported payment methods like upay_manual and whatsapp_pay are strictly rejected (403)
  const upayRes = await firestoreRest(`stores/${mbSlug}/orders/ord_mb_upay`, {
    method: 'PATCH',
    uid: null,
    body: {
      fields: {
        id: { stringValue: 'ord_mb_upay' },
        customerName: { stringValue: 'Rahim' },
        customerPhone: { stringValue: '01799887766' },
        paymentMethod: { stringValue: 'upay_manual' },
        status: { stringValue: 'draft' },
        subtotal: { integerValue: '500' },
        totalAmount: { integerValue: '500' },
        items: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    productName: { stringValue: 'Router' },
                    quantity: { integerValue: '1' },
                    unitPrice: { integerValue: '500' },
                    subtotal: { integerValue: '500' },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(upayRes.status, 403, 'Order with upay_manual must be rejected with 403 on live emulator');

  const waRes = await firestoreRest(`stores/${mbSlug}/orders/ord_mb_wa`, {
    method: 'PATCH',
    uid: null,
    body: {
      fields: {
        id: { stringValue: 'ord_mb_wa' },
        customerName: { stringValue: 'Rahim' },
        customerPhone: { stringValue: '01799887766' },
        paymentMethod: { stringValue: 'whatsapp_pay' },
        status: { stringValue: 'draft' },
        subtotal: { integerValue: '500' },
        totalAmount: { integerValue: '500' },
        items: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    productName: { stringValue: 'Router' },
                    quantity: { integerValue: '1' },
                    unitPrice: { integerValue: '500' },
                    subtotal: { integerValue: '500' },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(waRes.status, 403, 'Order with whatsapp_pay must be rejected with 403 on live emulator');
});

// 20. Online Order Creation Rules: Cannot create pre-settled or pre-verified orders; draft/confirmed allowed
await test('20. Online Orders: Creation of pre-settled or pre-verified orders is strictly forbidden; draft/confirmed succeeds', async () => {
  const uid = 'emu_order_creator_1';
  const bizId = 'biz_emu_1';

  // Seed business document
  await firestoreRest(`users/${uid}/businesses/${bizId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { id: { stringValue: bizId } } },
  });

  // Attempt 1: Direct create with status 'settled' -> must be 403
  const badSettleCreate = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/ord_bad_settle`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: 'ord_bad_settle' },
        status: { stringValue: 'settled' },
        totalAmount: { integerValue: '500' },
      },
    },
  });
  assert.equal(badSettleCreate.status, 403, 'Creating order directly as settled must be rejected (403)');

  // Attempt 2: Direct create with paymentStatus 'verified' -> must be 403
  const badVerifyCreate = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/ord_bad_verify`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: 'ord_bad_verify' },
        status: { stringValue: 'confirmed' },
        paymentStatus: { stringValue: 'verified' },
        totalAmount: { integerValue: '500' },
      },
    },
  });
  assert.equal(badVerifyCreate.status, 403, 'Creating order directly as verified must be rejected (403)');

  // Attempt 3: Malicious attempt to bypass create restrictions with isRestored: true -> MUST BE 403!
  const isRestoredBypassAttempt = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/ord_bad_is_restored`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: 'ord_bad_is_restored' },
        status: { stringValue: 'settled' },
        paymentStatus: { stringValue: 'verified' },
        isRestored: { booleanValue: true },
        totalAmount: { integerValue: '500' },
      },
    },
  });
  assert.equal(isRestoredBypassAttempt.status, 403, 'Creating order with isRestored: true bypass MUST be rejected with 403');

  // Attempt 4: Valid creation in draft status -> must succeed (200)
  const goodCreate = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/ord_good_1`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: 'ord_good_1' },
        status: { stringValue: 'draft' },
        paymentStatus: { stringValue: 'pending' },
        totalAmount: { integerValue: '500' },
      },
    },
  });
  assert.equal(goodCreate.status, 200, 'Creating order in draft status must succeed (200)');
});

// 21. Online Order State Transitions: Valid progression vs invalid shortcuts
await test('21. Online Orders: State transition constraints prevent illegal status jumps', async () => {
  const uid = 'emu_trans_user_1';
  const bizId = 'biz_emu_1';
  const ordId = 'ord_prog_1';

  // Seed order in draft
  await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: ordId },
        status: { stringValue: 'draft' },
        totalAmount: { integerValue: '500' },
      },
    },
  });

  // Attempt to jump directly from draft to settled -> must be 403
  const jumpSettle = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'settled' },
      },
    },
  });
  assert.equal(jumpSettle.status, 403, 'Jumping from draft directly to settled must be rejected (403)');

  // Advance draft -> confirmed -> packed -> shipped -> delivered
  const toConfirmed = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { status: { stringValue: 'confirmed' } } },
  });
  assert.equal(toConfirmed.status, 200);

  const toPacked = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { status: { stringValue: 'packed' } } },
  });
  assert.equal(toPacked.status, 200);

  // Packed cannot transition to returned (must be shipped first) -> 403
  const badReturn = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { status: { stringValue: 'returned' } } },
  });
  assert.equal(badReturn.status, 403, 'Transition to returned from packed must be rejected (403)');

  const toShipped = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { status: { stringValue: 'shipped' } } },
  });
  assert.equal(toShipped.status, 200);

  const toDelivered = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { status: { stringValue: 'delivered' } } },
  });
  assert.equal(toDelivered.status, 200);

  // Delivered cannot be cancelled -> 403
  const cancelDelivered = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { status: { stringValue: 'cancelled' } } },
  });
  assert.equal(cancelDelivered.status, 403, 'Delivered order cannot transition to cancelled (403)');
});

// 22. P0-1: Settle transition atomic day ledger binding
await test('22. P0-1: Order settlement requires atomic day document write synchronization', async () => {
  const uid = 'emu_settle_user_1';
  const bizId = 'biz_emu_1';
  const ordId = 'ord_settle_atomic';
  const dateKey = '2026-10-12';
  const timestamp = 1791789000000;

  // Seed delivered order (create in draft, then transition to delivered)
  await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: ordId },
        status: { stringValue: 'draft' },
        totalAmount: { integerValue: '800' },
      },
    },
  });
  await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'delivered' },
      },
    },
  });

  // 1. Direct update to settled without day doc -> must be 403
  const directSettle = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'settled' },
        settlementDateKey: { stringValue: dateKey },
        settledAt: { integerValue: String(timestamp) },
        settlementWallet: { stringValue: 'cash' },
      },
    },
  });
  assert.equal(directSettle.status, 403, 'Direct settlement update without day doc must be rejected (403)');

  // 2. Seed day doc with different timestamp -> must be 403
  await firestoreRest(`users/${uid}/businesses/${bizId}/days/${dateKey}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        dateKey: { stringValue: dateKey },
        _lastCloudSavedAt: { integerValue: '1791700000000' },
      },
    },
  });
  const unalignedSettle = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'settled' },
        settlementDateKey: { stringValue: dateKey },
        settledAt: { integerValue: String(timestamp) },
        settlementWallet: { stringValue: 'cash' },
      },
    },
  });
  assert.equal(unalignedSettle.status, 403, 'Settlement with mismatched day timestamp must be rejected (403)');

  // 3. Synchronize timestamp but omit settlement wallet -> must be 403
  await firestoreRest(`users/${uid}/businesses/${bizId}/days/${dateKey}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        dateKey: { stringValue: dateKey },
        _lastCloudSavedAt: { integerValue: String(timestamp) },
        wallets: {
          mapValue: {
            fields: {
              bank: { mapValue: { fields: { current: { integerValue: '500' } } } },
            },
          },
        },
      },
    },
  });
  const noWalletSettle = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'settled' },
        settlementDateKey: { stringValue: dateKey },
        settledAt: { integerValue: String(timestamp) },
        settlementWallet: { stringValue: 'cash' },
      },
    },
  });
  assert.equal(noWalletSettle.status, 403, 'Settlement when wallet is missing in day ledger must be rejected (403)');

  // 4. Include wallet but omit settledOrderIds claim -> must be 403
  await firestoreRest(`users/${uid}/businesses/${bizId}/days/${dateKey}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        dateKey: { stringValue: dateKey },
        _lastCloudSavedAt: { integerValue: String(timestamp) },
        wallets: {
          mapValue: {
            fields: {
              cash: { mapValue: { fields: { current: { integerValue: '500' } } } },
            },
          },
        },
      },
    },
  });
  const noClaimSettle = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'settled' },
        settlementDateKey: { stringValue: dateKey },
        settledAt: { integerValue: String(timestamp) },
        settlementWallet: { stringValue: 'cash' },
      },
    },
  });
  assert.equal(noClaimSettle.status, 403, 'Settlement without ledger transaction record in day doc must be rejected (403)');

  // 5. Complete atomic day doc synchronization: timestamp, wallet, and settledOrderIds -> settlement succeeds (200)
  await firestoreRest(`users/${uid}/businesses/${bizId}/days/${dateKey}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        dateKey: { stringValue: dateKey },
        _lastCloudSavedAt: { integerValue: String(timestamp) },
        wallets: {
          mapValue: {
            fields: {
              cash: { mapValue: { fields: { current: { integerValue: '500' } } } },
            },
          },
        },
        settledOrderIds: {
          arrayValue: {
            values: [{ stringValue: ordId }],
          },
        },
      },
    },
  });
  const alignedSettle = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'settled' },
        settlementDateKey: { stringValue: dateKey },
        settledAt: { integerValue: String(timestamp) },
        settlementWallet: { stringValue: 'cash' },
      },
    },
  });
  assert.equal(alignedSettle.status, 200, 'Synchronized atomic settlement with day ledger transaction must succeed (200)');
});

// 23. P0-2: Payment verification conflicting status & atomic registry claim
await test('23. P0-2: Payment verification forbids conflicting status and requires atomic trxRegistry claim', async () => {
  const uid = 'emu_verify_user_1';
  const bizId = 'biz_emu_1';
  const ordId = 'ord_verify_mfs';
  const trxId = 'BKS778899X';
  const verifyDateKey = '2026-10-10';
  const verifyTimestamp = 1791800000000;

  // Seed draft order with bkash_manual
  await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: ordId },
        status: { stringValue: 'draft' },
        paymentMethod: { stringValue: 'bkash_manual' },
        paymentStatus: { stringValue: 'pending' },
        totalAmount: { integerValue: '600' },
      },
    },
  });

  // 1. Conflicting update: status 'cancelled' AND paymentStatus 'verified' -> must be 403
  const conflictUpdate = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'cancelled' },
        paymentStatus: { stringValue: 'verified' },
        verifiedTrxId: { stringValue: trxId },
      },
    },
  });
  assert.equal(conflictUpdate.status, 403, 'Simultaneous status: cancelled + paymentStatus: verified must be rejected (403)');

  // 2. Payment verification without trxRegistry claim -> must be 403
  const noRegUpdate = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        paymentStatus: { stringValue: 'verified' },
        verifiedTrxId: { stringValue: trxId },
        paymentDateKey: { stringValue: verifyDateKey },
        paymentVerifiedAt: { integerValue: String(verifyTimestamp) },
        paymentWallet: { stringValue: 'bkash_merchant' },
      },
    },
  });
  assert.equal(noRegUpdate.status, 403, 'Payment verification without atomic trxRegistry claim must be rejected (403)');

  // 3. Claim trxRegistry entry
  await firestoreRest(`users/${uid}/trxRegistry/bkash_${trxId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        provider: { stringValue: 'bkash' },
        trxId: { stringValue: trxId },
        orderId: { stringValue: ordId },
        bizId: { stringValue: bizId },
      },
    },
  });

  // 4. Verify without day doc synchronization -> must be 403
  const noDayDocVerify = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        paymentStatus: { stringValue: 'verified' },
        verifiedTrxId: { stringValue: trxId },
        paymentDateKey: { stringValue: verifyDateKey },
        paymentVerifiedAt: { integerValue: String(verifyTimestamp) },
        paymentWallet: { stringValue: 'bkash_merchant' },
      },
    },
  });
  assert.equal(noDayDocVerify.status, 403, 'Payment verification without day document synchronization must be rejected (403)');

  // 5. Seed day doc with synchronized timestamp, wallet, and verifiedOrderIds claim
  await firestoreRest(`users/${uid}/businesses/${bizId}/days/${verifyDateKey}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        dateKey: { stringValue: verifyDateKey },
        _lastCloudSavedAt: { integerValue: String(verifyTimestamp) },
        wallets: {
          mapValue: {
            fields: {
              bkash_merchant: { mapValue: { fields: { current: { integerValue: '600' } } } },
            },
          },
        },
        verifiedOrderIds: {
          arrayValue: {
            values: [{ stringValue: ordId }],
          },
        },
      },
    },
  });

  // 6. Payment verification now succeeds (200)
  const validVerify = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        paymentStatus: { stringValue: 'verified' },
        verifiedTrxId: { stringValue: trxId },
        paymentDateKey: { stringValue: verifyDateKey },
        paymentVerifiedAt: { integerValue: String(verifyTimestamp) },
        paymentWallet: { stringValue: 'bkash_merchant' },
      },
    },
  });
  assert.equal(validVerify.status, 200, 'Payment verification with atomic trxRegistry claim and day ledger claim must succeed (200)');
});

// 24. TrxRegistry append-only tamper resistance & delete protection
await test('24. TrxID Registry: Entries are strictly append-only; updates and deletes are rejected (403)', async () => {
  const uid = 'emu_trx_user_1';
  const regPath = `users/${uid}/trxRegistry/nagad_NGD112233`;

  // Create registry entry
  const createReg = await firestoreRest(regPath, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        provider: { stringValue: 'nagad' },
        trxId: { stringValue: 'NGD112233' },
        orderId: { stringValue: 'ord_sample_99' },
      },
    },
  });
  assert.equal(createReg.status, 200, 'Creating trxRegistry entry must succeed (200)');

  // Attempt update -> must be 403
  const updateReg = await firestoreRest(regPath, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        orderId: { stringValue: 'ord_hijacked_100' },
      },
    },
  });
  assert.equal(updateReg.status, 403, 'Updating trxRegistry entry must be rejected (403)');

  // Attempt delete -> must be 403
  const deleteReg = await firestoreRest(regPath, {
    method: 'DELETE',
    uid,
  });
  assert.equal(deleteReg.status, 403, 'Deleting trxRegistry entry must be rejected (403)');
});

// 25. Settled Order Immutability & Deletion Lockdown
await test('25. Settled Orders: Financial fields are immutable and deletion is forbidden (403)', async () => {
  const uid = 'emu_settled_immut_user';
  const bizId = 'biz_emu_1';
  const ordId = 'ord_settled_permanent';

  const dateKey = '2026-10-12';
  const timestamp = 1791789000000;

  // 1. Seed order in draft
  await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        id: { stringValue: ordId },
        status: { stringValue: 'draft' },
        totalAmount: { integerValue: '1200' },
        settlementWallet: { stringValue: 'bkash' },
        netAmount: { integerValue: '1100' },
      },
    },
  });

  // 2. Transition draft -> delivered
  await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: { fields: { status: { stringValue: 'delivered' } } },
  });

  // 3. Sync day document
  await firestoreRest(`users/${uid}/businesses/${bizId}/days/${dateKey}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        dateKey: { stringValue: dateKey },
        _lastCloudSavedAt: { integerValue: String(timestamp) },
        wallets: {
          mapValue: {
            fields: {
              bkash: { mapValue: { fields: { current: { integerValue: '1100' } } } },
            },
          },
        },
        settledOrderIds: {
          arrayValue: {
            values: [{ stringValue: ordId }],
          },
        },
      },
    },
  });

  // 4. Transition delivered -> settled with atomic day sync
  const settleRes = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'settled' },
        settlementDateKey: { stringValue: dateKey },
        settledAt: { integerValue: String(timestamp) },
        settlementWallet: { stringValue: 'bkash' },
        netAmount: { integerValue: '1100' },
      },
    },
  });
  assert.equal(settleRes.status, 200, 'Legitimately settled order should succeed (200)');

  // Attempt 1: Delete settled order -> must be 403
  const deleteSettled = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'DELETE',
    uid,
  });
  assert.equal(deleteSettled.status, 403, 'Deleting settled order must be rejected (403)');

  // Attempt 2: Alter financial amount on settled order -> must be 403
  const alterAmount = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        totalAmount: { integerValue: '9999' },
      },
    },
  });
  assert.equal(alterAmount.status, 403, 'Altering totalAmount on settled order must be rejected (403)');

  // Attempt 3: Revert status to draft -> must be 403
  const revertStatus = await firestoreRest(`users/${uid}/businesses/${bizId}/onlineOrders/${ordId}`, {
    method: 'PATCH',
    uid,
    body: {
      fields: {
        status: { stringValue: 'draft' },
      },
    },
  });
  assert.equal(revertStatus.status, 403, 'Reverting status of settled order must be rejected (403)');
});

if (typeof deleteApp === 'function' && appOwner) {
  await deleteApp(appOwner);
}

// Write CI artifact report to separate files based on runner mode
try {
  const artifactDir = path.resolve(process.cwd(), 'tests', 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  const reportPayload = {
    suite: isEmbedded ? 'Embedded Rules-Contract Simulator Suite' : 'Google Cloud Firestore Emulator Security Rules Suite',
    emulatorHost: EMULATOR_HOST,
    executedAt: new Date().toISOString(),
    totalTests: passed + failed,
    passed,
    failed,
    status: failed === 0 ? 'PASSED' : 'FAILED',
    results: testLogEntries,
  };
  const reportFileName = isEmbedded ? 'embedded-rules-report.json' : 'emulator-rules-report.json';
  fs.writeFileSync(
    path.join(artifactDir, reportFileName),
    JSON.stringify(reportPayload, null, 2),
    'utf8'
  );
  console.log(`📄 Saved ${isEmbedded ? 'embedded' : 'official'} security rules artifact to tests/artifacts/${reportFileName}`);
} catch (artifactErr) {
  console.warn(`Could not write emulator artifact report: ${artifactErr.message}`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🎉 ${isEmbedded ? 'EMBEDDED RULES-CONTRACT SIMULATOR' : 'LIVE EMULATOR'} TESTS COMPLETED: ${passed} passed, ${failed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
if (failed > 0) {
  process.exit(1);
}

