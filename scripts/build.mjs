/**
 * scripts/build.mjs
 * Resilient Production Build Runner for Ledgero
 *
 * Strict fail-fast, zero-network, fresh compilation runner:
 * 1. Checks if `node_modules/vite/bin/vite.js` exists.
 *    If NOT found, fails fast immediately with exit code 1 (no network downloads / no npx fallback).
 * 2. Only when Vite is verified locally, cleans `dist/` to guarantee 100% fresh compilation from source.
 * 3. On POSIX environments (Linux / macOS / Docker), ensures permissions on Vite binaries.
 * 4. Invokes Node directly on `node_modules/vite/bin/vite.js build` to bypass any POSIX permission issues.
 * 5. Fails with non-zero exit code if Vite compilation fails.
 * 6. Confirms that fresh `dist/index.html` was generated and exits with code 0.
 *
 * NOTE: For verifying pre-existing distribution assets without compiling, use `npm run verify:dist`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const assetsDir = path.join(distDir, 'assets');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📦 LEDGERO FRESH PRODUCTION BUILD RUNNER');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// 1. Fail-fast dependency check: verify local Vite installation before touching any files
const directViteJs = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(directViteJs)) {
  console.error('\n❌ FATAL: Vite compiler not found at node_modules/vite/bin/vite.js.');
  console.error('   Dependencies are missing. Please run `npm ci` first to install all packages.');
  console.error('   Network-dependent fallback (npx) is strictly disabled to prevent timeouts.');
  console.error('   Aborting production source build.\n');
  process.exit(1);
}

const buildStartTime = Date.now();

// 2. Clean previous dist/ directory ONLY after confirming Vite is present
if (fs.existsSync(distDir)) {
  console.log('🧹 Cleaning previous dist/ directory to guarantee fresh source compilation...');
  try {
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log('✅ Previous dist/ removed successfully.');
  } catch (cleanErr) {
    console.warn(`⚠️ Warning: Could not remove old dist/: ${cleanErr.message}`);
  }
}

// 3. On POSIX systems, ensure permissions on node_modules/.bin and vite.js
if (process.platform !== 'win32') {
  try {
    fs.chmodSync(directViteJs, 0o755);
    const binDir = path.join(projectRoot, 'node_modules', '.bin');
    if (fs.existsSync(binDir)) {
      for (const file of fs.readdirSync(binDir)) {
        try {
          fs.chmodSync(path.join(binDir, file), 0o755);
        } catch {}
      }
    }
  } catch {}
}

// 4. Execute compilation directly via Node (never bash/sh execution of vite)
console.log('⚡ Compiling fresh production build with Vite...');
const res = spawnSync(process.execPath, [directViteJs, 'build'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

if (res.status !== 0) {
  console.error(`\n❌ FATAL: Production compilation failed with exit code ${res.status}.`);
  process.exit(res.status ?? 1);
}

// 5. Verify that fresh compilation produced dist/index.html and asset bundles
if (!fs.existsSync(indexHtmlPath) || !fs.existsSync(assetsDir)) {
  console.error('\n❌ FATAL: Build finished with exit code 0 but dist/index.html was not generated.');
  process.exit(1);
}

const htmlStat = fs.statSync(indexHtmlPath);
const assetFiles = fs.readdirSync(assetsDir);
const jsFiles = assetFiles.filter(f => f.endsWith('.js'));
const cssFiles = assetFiles.filter(f => f.endsWith('.css'));
const elapsedSec = ((Date.now() - buildStartTime) / 1000).toFixed(2);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🎉 FRESH PRODUCTION BUILD COMPILED SUCCESSFULLY in ${elapsedSec}s!`);
console.log(`   - Entrypoint: dist/index.html (${htmlStat.size} bytes)`);
console.log(`   - Bundles: ${jsFiles.length} JavaScript chunks, ${cssFiles.length} CSS stylesheets`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(0);
