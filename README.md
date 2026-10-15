# Ledgero (লেজারো) — দোকানের ডিজিটাল হিসাবরক্ষক

Digital Accounting, FIFO Inventory, Double-Entry Ledger & POS for Bangladeshi Shopkeepers with Cloud Sync, Multi-Device Support, and AI Business Insights.

---

## 🔒 Security & Environment Variables

All configuration values are strictly managed through environment variables. **No secret API keys or credentials exist in the source code or client bundle.**

### ⚠️ IMPORTANT: Secret Rotation & Client Bundle Safety
> **SECURITY WARNING:**
> 1. Never place secret server API keys (such as raw Gemini API keys) in `VITE_*` environment variables, because Vite embeds `VITE_*` variables into client-side JavaScript bundles (`dist/assets/*.js`).
> 2. For NAM AI cloud queries, either configure `VITE_GEMINI_PROXY_URL` pointing to your authenticated backend proxy or enter an ephemeral user key in-app (stored only in `sessionStorage` for the current tab session). Without a cloud key, NAM AI automatically runs its deterministic local financial engine (`processLocalAIQuery`).
> 3. Restrict Firebase Web API keys in Google Cloud Console to authorized HTTP referrers (`ledgero-app.web.app`, `ledgero-bd.web.app`, `localhost`).
> 4. Never commit `.env` or `.env.local` to version control.

---

## 🚀 Environment Setup & Running Locally

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in the required Firebase Web SDK variables in `.env`:
   - `VITE_FIREBASE_API_KEY`: Firebase Web API Key
   - `VITE_FIREBASE_AUTH_DOMAIN`: Firebase Auth Domain
   - `VITE_FIREBASE_PROJECT_ID`: Firebase Project ID
   - `VITE_FIREBASE_STORAGE_BUCKET`: Firebase Storage Bucket
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`: Firebase Messaging Sender ID
   - `VITE_FIREBASE_APP_ID`: Firebase App ID
   - `VITE_GEMINI_PROXY_URL`: *(Optional)* Authenticated server-side proxy URL for Gemini AI

3. Install dependencies and start the development server:
   ```bash
   npm install
   npm run dev
   ```

4. Run the automated verification suite (works both with `node_modules` installed and in zero-dependency sandbox environments via `tests/firebaseTestLoader.mjs`):
   ```bash
   npm test
   ```

5. Build for production:
   ```bash
   npm run build
   ```

---

## 🛡️ Security & Accounting Architecture

- **FIFO Inventory & Double-Entry Journal Engine**:
  - Every sale (`QUICK_SELL_STOCK`), restock (`QUICK_RESTOCK`), damage write-off (`WRITE_OFF_DAMAGE`), physical stock audit (`APPLY_STOCK_AUDIT`), single reversal (`DELETE_TRANSACTION` / `REVERSE_TRANSACTION`), and bulk reversal (`BULK_DELETE_TRANSACTIONS`) maintains 3-way reconciliation across Wallets, FIFO Inventory Batches, Contact Ledgers (Khata), and Double-Entry General Ledger Journals (`src/data/ledgerStateEngine.js`, `src/data/fifoEngine.js`, `src/data/journalEngine.js`).
  - Physical stock audit shortages consume FIFO batches and increment `damagedStock` so `calcUnitsSold()` never misreports missing stock as sales revenue. Physical stock audit surpluses increment `addedStock`, create a new FIFO batch, and record a reversible `stock_audit_surplus` journal entry (`Dr Inventory / Cr Other Income`).
- **Firestore Security Rules & Service Contract Alignment**:
  - Protected user documents and subcollections enforced by strict `firestore.rules` where `request.auth.uid == userId`.
  - Schema allowlists in `firestore.rules` (`isValidSettingsData`, `isValidSheetsConfigData`, `isValidAuditLogData`, `isValidStoreData`, `isValidPublicStoreInfoData`, `isValidPublicProductData`) are verified in automated tests against `firestoreService.js` and `auditService.js`.
  - `auditLog` is strictly append-only during normal business operation (`allow update: if false;`) and only allows deletion during full business or account teardown after `businesses/{bizId}/meta/info` has been removed.
- **Public Storefront Privacy**:
  - Public customers read only `/stores/{shopSlug}/public/info` (containing only `shopName`, `displayName`, `whatsappNumber`, `address`, `isActive`, `createdAt`, `updatedAt`) and `/stores/{shopSlug}/products/{productId}` (strictly stripped of `buyPrice`, `profit`, `cogs`, `batches`, and `fifoCogs`).
  - Owner metadata (`ownerUserId`, `bizId`, `autoSync`, `movedTo`) is stored on `/stores/{shopSlug}` and restricted to authenticated users.
- **Complete Business & Account Deletion**:
  - `deleteBusinessFromCloud` and `deleteAllUserData` delete all nested subcollections (`days`, `contacts`, `contactTxs`, `meta`, `auditLog`) in 450-operation batches, clean up linked public storefronts, and verify zero remaining documents before completing.
