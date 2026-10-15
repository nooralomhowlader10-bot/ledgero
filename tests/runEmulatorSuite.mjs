/**
 * tests/runEmulatorSuite.mjs
 * Embedded Rules Simulator Test Runner (Zero-Java Contract Suite)
 *
 * Runs the expanded 25-test rules contract suite (including online orders, atomic settlement, and trxRegistry) against an embedded Node.js HTTP simulator.
 * To run against the official Google Firestore Emulator (requires Java JDK 21+), use:
 *   npm run test:emulator
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18080';
const [host, port] = EMULATOR_HOST.split(':');

function isEmulatorRunning() {
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
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveJavaEnv() {
  const env = { ...process.env };
  const cacheRoot = path.join(os.homedir(), '.cache', 'jdk21');
  if (fs.existsSync(cacheRoot)) {
    const entries = fs.readdirSync(cacheRoot);
    const jdkDir = entries.find((e) => e.startsWith('jdk-21'));
    if (jdkDir) {
      const fullJdkPath = path.join(cacheRoot, jdkDir);
      const binPath = path.join(fullJdkPath, 'bin');
      if (fs.existsSync(binPath)) {
        env.JAVA_HOME = fullJdkPath;
        env.PATH = `${binPath}${path.delimiter}${env.PATH || ''}`;
      }
    }
  }
  return env;
}

const env = resolveJavaEnv();
env.REQUIRE_EMULATOR = '1';
const alreadyRunning = await isEmulatorRunning();

if (alreadyRunning) {
  console.log(`✅ Detected existing Firestore Emulator listening on http://${host}:${port}`);
  const res = spawnSync(process.execPath, ['tests/emulatorRulesTest.mjs', '--strict'], {
    stdio: 'inherit',
    env,
  });
  process.exit(res.status ?? 1);
}

if (process.env.USE_REAL_EMULATOR === '1') {
  console.log('🚀 Starting Firebase Firestore Emulator via firebase emulators:exec...');
  const cmdLine = 'npx firebase emulators:exec --only firestore --project ledgero-rules-test "node tests/emulatorRulesTest.mjs --strict"';
  const res = spawnSync(cmdLine, {
    stdio: 'inherit',
    env,
    shell: true,
  });
  process.exit(res.status ?? 1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 EMBEDDED RULES-CONTRACT SIMULATOR TEST SUITE');
console.log(`🚀 Launching embedded Firestore Rules simulator on http://${host}:${port}...`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const serverProcess = spawn(process.execPath, ['tests/embeddedRulesServer.mjs'], {
  env: {
    ...env,
    EMULATOR_HOST_IP: host,
    EMULATOR_PORT: port,
  },
  stdio: 'inherit',
});

// Wait up to 5 seconds for embedded server to respond (typically takes ~25ms)
let isReady = false;
for (let i = 0; i < 50; i++) {
  if (await isEmulatorRunning()) {
    isReady = true;
    break;
  }
  await new Promise(r => setTimeout(r, 100));
}

if (!isReady) {
  serverProcess.kill();
  console.error('❌ Failed to start embedded Firestore Rules Test Engine.');
  process.exit(1);
}

console.log(`✅ Embedded rules engine active on http://${host}:${port}`);
env.FORCE_REST = '1';
env.FIRESTORE_EMULATOR_HOST = `${host}:${port}`;

const res = spawnSync(process.execPath, ['tests/emulatorRulesTest.mjs', '--strict'], {
  stdio: 'inherit',
  env,
});

serverProcess.kill();
process.exit(typeof res.status === 'number' ? res.status : 1);


