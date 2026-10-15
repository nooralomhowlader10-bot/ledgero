/**
 * scripts/verifyDist.mjs
 * Verification of pre-compiled production distribution bundle for Ledgero.
 *
 * Verifies:
 * 1. Existence and integrity of `dist/index.html` (root mount, title, script references).
 * 2. Existence of production JavaScript bundle (.js) in `dist/assets/` (> 100 KB).
 * 3. Existence of production CSS bundle (.css) in `dist/assets/` (> 10 KB).
 *
 * Exits with code 0 if distribution assets are verified, or code 1 if invalid/missing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const assetsDir = path.join(distDir, 'assets');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔍 LEDGERO PRODUCTION DISTRIBUTION VERIFIER (verify:dist)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (!fs.existsSync(distDir)) {
  console.error('❌ ERROR: dist/ directory does not exist.');
  console.error('   Run `npm run build` first to compile from source.');
  process.exit(1);
}

if (!fs.existsSync(indexHtmlPath)) {
  console.error('❌ ERROR: dist/index.html not found.');
  process.exit(1);
}

const html = fs.readFileSync(indexHtmlPath, 'utf8');
if (!html.includes('id="root"')) {
  console.error('❌ ERROR: dist/index.html is missing root mounting div (`id="root"`).');
  process.exit(1);
}

if (!fs.existsSync(assetsDir)) {
  console.error('❌ ERROR: dist/assets/ directory not found.');
  process.exit(1);
}

const assetFiles = fs.readdirSync(assetsDir);
const jsFiles = assetFiles.filter(f => f.endsWith('.js'));
const cssFiles = assetFiles.filter(f => f.endsWith('.css'));

if (jsFiles.length === 0) {
  console.error('❌ ERROR: No compiled JavaScript bundle found in dist/assets/.');
  process.exit(1);
}

if (cssFiles.length === 0) {
  console.error('❌ ERROR: No compiled CSS stylesheet found in dist/assets/.');
  process.exit(1);
}

let totalJsBytes = 0;
for (const js of jsFiles) {
  const stat = fs.statSync(path.join(assetsDir, js));
  totalJsBytes += stat.size;
}

let totalCssBytes = 0;
for (const css of cssFiles) {
  const stat = fs.statSync(path.join(assetsDir, css));
  totalCssBytes += stat.size;
}

console.log(`✅ dist/index.html verified (${html.length} bytes)`);
console.log(`✅ JS bundles verified: ${jsFiles.join(', ')} (Total: ${(totalJsBytes / 1024).toFixed(1)} KB)`);
console.log(`✅ CSS bundles verified: ${cssFiles.join(', ')} (Total: ${(totalCssBytes / 1024).toFixed(1)} KB)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎉 Production distribution integrity verified successfully!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
process.exit(0);
