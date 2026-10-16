/**
 * scripts/verifyAll.mjs
 * Master Quality & Production Verification Pipeline for Ledgero
 *
 * Runs all 5 mandatory certification gates sequentially:
 * 1. Core Accounting & Ledger Engine (npm test - 101 tests)
 * 2. Embedded Rules-Contract Simulator (npm run test:rules:embedded - 25 tests)
 * 3. Fresh Production Source Build (npm run build - Vite compilation)
 * 4. Distribution Integrity Check (npm run verify:dist)
 * 5. Official Google Cloud Firestore Emulator Suite (npm run test:emulator - 25 tests)
 *
 * Generates an auditable execution summary and exits with code 0 only if ALL gates pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(projectRoot, 'tests', 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

// Prevent artifacts from an older run being mistaken for evidence from this run.
fs.rmSync(path.join(artifactsDir, 'emulator-rules-report.json'), { force: true });
fs.rmSync(path.join(artifactsDir, 'embedded-rules-report.json'), { force: true });
fs.rmSync(path.join(artifactsDir, 'STAGING_ACCEPTANCE_REPORT.json'), { force: true });

const gates = [
  {
    name: 'Core Accounting & State Engine Tests (101 Tests)',
    command: process.execPath,
    args: ['--import', './tests/firebaseTestLoader.mjs', 'tests/runAllTests.mjs'],
  },
  {
    name: 'Embedded Rules-Contract Simulator (25 Tests)',
    command: process.execPath,
    args: ['tests/runEmulatorSuite.mjs'],
  },
  {
    name: 'Fresh Production Source Build (Vite v6)',
    command: process.execPath,
    args: ['scripts/build.mjs'],
  },
  {
    name: 'Distribution Integrity Verifier (verify:dist)',
    command: process.execPath,
    args: ['scripts/verifyDist.mjs'],
  },
  {
    name: 'Official Google Cloud Firestore Emulator (Port 8080, 25 Tests)',
    command: process.execPath,
    args: ['scripts/testWithOfficialEmulator.mjs'],
  },
  {
    name: 'Staging Acceptance & Disaster Recovery Suite (7 Tests)',
    command: process.execPath,
    args: ['scripts/verifyStagingWorkflow.mjs'],
  },
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🌟 LEDGERO MASTER PRODUCTION CERTIFICATION PIPELINE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Node.js Version: ${process.version}`);
console.log(`Platform: ${process.platform} (${process.arch})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const results = [];
let allPassed = true;
const logChunks = [];

function log(msg) {
  console.log(msg);
  logChunks.push(msg);
}

for (let i = 0; i < gates.length; i++) {
  const gate = gates[i];
  log(`▶️ GATE ${i + 1}/${gates.length}: Running ${gate.name}...`);
  const startTime = Date.now();

  const proc = spawnSync(gate.command, gate.args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  const durationMs = Date.now() - startTime;
  const status = proc.status === 0 ? 'PASSED' : 'FAILED';
  if (proc.status !== 0) allPassed = false;

  results.push({
    gate: i + 1,
    name: gate.name,
    exitCode: proc.status,
    status,
    durationMs,
  });

  log(`   Status: [${status}] | Exit Code: ${proc.status} | Duration: ${(durationMs / 1000).toFixed(2)}s\n`);
}

log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
log('📊 MASTER CERTIFICATION SUMMARY MATRIX');
log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const r of results) {
  const icon = r.status === 'PASSED' ? '✅' : '❌';
  log(`${icon} Gate ${r.gate}: ${r.name.padEnd(55)} Exit: ${r.exitCode} (${(r.durationMs / 1000).toFixed(2)}s)`);
}
log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (allPassed) {
  log(`\n🎉 ALL ${gates.length} AUTOMATED VERIFICATION GATES PASSED. Review staging/pilot and operational checks separately before production launch.`);
} else {
  log('\n❌ ONE OR MORE CERTIFICATION GATES FAILED. Review logs above.');
}

const logFilePath = path.join(artifactsDir, 'FULL_VERIFICATION_LOG.txt');
fs.writeFileSync(logFilePath, logChunks.join('\n') + '\n', 'utf8');
console.log(`📄 Saved audit summary log to: tests/artifacts/FULL_VERIFICATION_LOG.txt`);

if (allPassed) {
  process.exit(0);
} else {
  process.exit(1);
}
