#!/usr/bin/env node
/**
 * Ledgero Historical TrxID Registry Migration Utility
 * Scans verified online orders across all businesses owned by a user,
 * identifies historical duplicates (both intra-business and cross-business),
 * registers missing unique TrxIDs into user-level and business-level registries,
 * and prints an audit report.
 *
 * Usage:
 *   node scripts/migrateHistoricalTrx.mjs --userId <USER_ID> [--dryRun]
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

// Load .env if present
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      value = value.trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

// Fallback environment settings for standalone CLI
if (!process.env.VITE_FIREBASE_API_KEY) process.env.VITE_FIREBASE_API_KEY = 'demo-api-key';
if (!process.env.VITE_FIREBASE_AUTH_DOMAIN) process.env.VITE_FIREBASE_AUTH_DOMAIN = 'demo.firebaseapp.com';
if (!process.env.VITE_FIREBASE_PROJECT_ID) process.env.VITE_FIREBASE_PROJECT_ID = 'demo-project';
if (!process.env.VITE_FIREBASE_APP_ID) process.env.VITE_FIREBASE_APP_ID = '1:123456789:web:demo';

// Parse command line arguments
const args = process.argv.slice(2);
let userId = null;
let dryRun = false;
let emulator = false;
let emulatorPort = 8080;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--userId' && args[i + 1]) {
    userId = args[i + 1];
    i++;
  } else if (args[i] === '--dryRun' || args[i] === '--dry-run') {
    dryRun = true;
  } else if (args[i] === '--emulator') {
    emulator = true;
    if (args[i + 1] && /^\d+$/.test(args[i + 1])) {
      emulatorPort = parseInt(args[i + 1], 10);
      i++;
    }
  }
}

// Strip extraneous quotes or placeholder angle brackets if accidentally typed
if (userId) {
  userId = userId.trim().replace(/^['"<]+|[>'"]+$/g, '');
  if (userId.toLowerCase() === 'user_uid') {
    userId = null;
  }
}

if (emulator) {
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${emulatorPort}`;
}

async function askUserIdInteractively() {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question('\n👉 Enter your Firebase User ID (UID) [or press Enter to cancel]: ', (ans) => {
      rl.close();
      const cleaned = (ans || '').trim().replace(/^['"<]+|[>'"]+$/g, '');
      if (cleaned && cleaned.toLowerCase() !== 'user_uid') {
        resolve(cleaned);
      } else {
        resolve(null);
      }
    });
  });
}

async function run() {
  try {
    if (!userId) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 Ledgero Historical TrxID Registry Migration Script');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      userId = await askUserIdInteractively();
    }

    if (!userId) {
      console.log('\n📖 Usage Guide for Windows PowerShell:');
      console.log('  npm run migrate:trx -- --userId "YOUR_FIREBASE_UID"');
      console.log('  npm run migrate:trx -- --userId "YOUR_FIREBASE_UID" --dryRun');
      console.log('  npm run migrate:trx -- --userId "YOUR_FIREBASE_UID" --emulator 8080');
      console.log('');
      console.log('💡 Example:');
      console.log('  npm run migrate:trx -- --userId "demo_user_123"');
      console.log('  npm run migrate:trx -- --userId "demo_user_123" --dryRun');
      console.log('');
      console.log('⚠️  PowerShell Note:');
      console.log('   Do NOT type literal angle brackets like <USER_UID>. In PowerShell,');
      console.log('   the "<" character is a reserved redirection symbol and causes an error.');
      console.log('   Always enclose your User ID in quotes: --userId "your_id"');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      process.exit(0);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 Starting Historical TrxID Registry Migration for User: ${userId}`);
    if (dryRun) console.log('⚠️  DRY RUN MODE ENABLED: No database writes will be executed');
    if (emulator) console.log(`🔌 LOCAL EMULATOR MODE ENABLED: Connecting to 127.0.0.1:${emulatorPort}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (emulator) {
      try {
        const { connectFirestoreEmulator } = await import('firebase/firestore');
        const { db } = await import('../src/firebase/firebaseConfig.js');
        if (db && typeof connectFirestoreEmulator === 'function') {
          connectFirestoreEmulator(db, '127.0.0.1', emulatorPort);
        }
      } catch (emuErr) {
        // Ignored if emulator was already configured via FIRESTORE_EMULATOR_HOST
      }
    }

    const { migrateAllBusinessesHistoricalTrxRegistry } = await import('../src/firebase/firestoreService.js');

    const customOps = dryRun ? {
      writeBatch: () => ({
        set: () => {},
        commit: async () => {},
      }),
      setDoc: async () => {},
    } : null;

    const report = await migrateAllBusinessesHistoricalTrxRegistry(userId, null, customOps);

    console.log('\n📊 Migration Results Summary:');
    console.log(`  • Businesses Scanned: ${report.businessesProcessed.join(', ') || 'None'}`);
    console.log(`  • Total Verified Orders: ${report.totalVerified}`);
    console.log(`  • Unique TrxIDs Registered: ${report.migrated}`);
    console.log(`  • Duplicates / Conflicts Found: ${report.duplicatesCount}`);

    if (report.duplicatesCount > 0) {
      console.log('\n⚠️  Duplicate / Conflicting Historical TrxIDs Detected:');
      report.duplicates.forEach((d, idx) => {
        console.log(`  [${idx + 1}] TrxID: ${d.trxId} (${d.provider})`);
        console.log(`      Reason: ${d.reason}`);
        if (d.isCrossBusiness) {
          console.log(`      Cross-Business Reuse across: ${d.businessesInvolved.join(', ')}`);
        }
        console.log(`      Orders Involved: ${d.orderIds ? d.orderIds.join(', ') : d.orderId}`);
      });
      console.log('\n💡 Recommendation: Review duplicate orders above in the Ledgero closing audit.');
    } else {
      console.log('\n✅ All historical TrxIDs are clean and strictly unique across all businesses!');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message || err);
    process.exit(1);
  }
}

run();
