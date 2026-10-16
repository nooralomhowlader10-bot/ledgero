# Ledgero Historical Patch Notes (ঐতিহাসিক প্যাচ রেকর্ড — 2026-10-15)

> [!NOTE]
> **ঐতিহাসিক অডিট রেকর্ড সতর্কতা (Historical Audit Context):**
> এই ডকুমেন্টে উল্লিখিত পরিবর্তনগুলো এবং ৫-গেট রানটাইম মেট্রিক্স (যেমন Gate 3: 4.64s, Gate 5: 6.69s) হলো `2026-10-15` তারিখের ঐতিহাসিক টেস্ট রান ও প্যাচ সংক্রান্ত তথ্য।
>
> বর্তমান রিলিজের অথরিটেটিভ সার্টিফায়েড মেট্রিক্স হলো **৬টি গেট (ALL 6 GATES)**, যা `REVIEWER_CHECKLIST_AND_RESOLUTION.md` এবং `tests/artifacts/FULL_VERIFICATION_LOG.txt`-এ সংরক্ষিত আছে:
> - **Gate 1:** Core Accounting & State Engine (101 Tests) — `0.23s` (Exit 0)
> - **Gate 2:** Embedded Rules Simulator (25 Tests) — `0.29s` (Exit 0)
> - **Gate 3:** Fresh Production Source Build (Vite v6) — `4.89s` (Exit 0)
> - **Gate 4:** Distribution Integrity Verifier (verify:dist) — `0.04s` (Exit 0)
> - **Gate 5:** Official Google Cloud Firestore Emulator (25 Tests) — `6.80s` (Exit 0)
> - **Gate 6:** Staging Acceptance & Local Recovery Suite (7 Tests) — `0.05s` (Exit 0)

---

## ঐতিহাসিক পরিবর্তনসমূহ (2026-10-15)

1. Settlement amount, wallet debit, receivable credit, delivery expense এবং journal debit/credit balance এখন পয়সা-স্তরে exact comparison করে। আগের `> 0.01` tolerance-এর কারণে এক পয়সার অমিল PASS হয়ে যাওয়ার ঝুঁকি বন্ধ করা হয়েছে।
2. Journal line-এ Debit এবং Credit—দুটোই positive হলে `invalid_journal_line_sides` দিয়ে Reconciliation-এ পাঠায়। Debit=0 এবং Credit=0—দুই দিকই শূন্য এমন line-ও প্রত্যাখ্যান করা হয়।
3. Journal amount precision check-এ floating-point representation noise (যেমন `0.29 * 100`) সহনীয় করা হয়েছে, কিন্তু প্রকৃত fractional-paisa amount ও unsafe cent values প্রত্যাখ্যান করা হয়।
4. `tests/runAllTests.mjs`-এ Condition 18 যোগ হয়েছে: এক পয়সার unbalanced journal অবশ্যই block হবে।
5. Condition 19 যোগ হয়েছে: একই journal line-এ debit ও credit একসঙ্গে থাকলে অবশ্যই block হবে।
6. Condition 20 যোগ হয়েছে: ফ্র্যাকশনাল পয়সা (`900.001`) ইনপুট পেলে round না করে কঠোরভাবে reject (`invalid_settlement_transaction_amount`) করা হবে।
7. Condition 21 যোগ হয়েছে: জার্নাল লাইনে `debit: true`-এর মতো বুলিয়ান বা বিকৃত মান থাকলে `invalid_journal_line_format` দিয়ে reject হবে।
8. Condition 22 যোগ হয়েছে: সেটেলমেন্ট ট্রানজ্যাকশন অনুপস্থিত সেলফ-হিলিং পরিস্থিতিতে `totalAmount`-কে COD-এর বিকল্প হিসেবে গ্রহণ করা নিষিদ্ধ। অথরিটেটিভ `codAmount` না থাকলে সিস্টেম কোনো ওয়ালেট ক্রেডিট বা ট্রানজ্যাকশন তৈরি না করে `missing_authoritative_cod_amount` দিয়ে রিকনসিলিয়েশন লক করবে।
9. Condition 23 যোগ হয়েছে: একই অর্ডারের জার্নালে অন্য `txId` থাকলে তা লিগ্যাসি হিসেবে গ্রহণ করা নিষিদ্ধ; `settlement_journal_transaction_mismatch` দিয়ে রিকনসিলিয়েশন হবে।
10. Condition 24 যোগ হয়েছে: একই অর্ডারে Exact `txId` জার্নাল এবং লিগ্যাসি (No `txId`) জার্নাল দুটোই উপস্থিত থাকলে ডুপ্লিকেট (`duplicate_settlement_journal_entries`) হিসেবে চিহ্নিত হবে।
11. 100% Pure Node.js & Cross-Platform Packaging: `scripts/packZip.mjs`-এ PowerShell বা কোনো OS বাইনারির ওপর নির্ভরতা সম্পূর্ণ দূর করা হয়েছে। Node-এর বিল্ট-ইন `zlib` ব্যবহার করে ১০০% পিউর Node.js জিপ প্যাকার লেখা হয়েছে। ফলে Linux, macOS এবং Windows—সব অপারেটিং সিস্টেমেই `npm run package` সরাসরি কোনো সমস্যা ছাড়াই চলবে এবং জিপ ফাইলের প্রতিটি এন্ট্রি POSIX ফরওয়ার্ড স্ল্যাশ (`/`) ও সঠিক ইউনিক্স পারমিশন (০ ব্যাকস্ল্যাশ ভ্যালিডেশন পাস) নিশ্চিত করে।
12. Synchronized Verification Metrics (ঐতিহাসিক 2026-10-15 টেস্ট রান): `FULL_VERIFICATION_LOG.txt` এবং রিপোর্টের এক্সিকিউশন টাইম হুবহু একই সিঙ্গেল রানের মান দিয়ে সিঙ্ক করা হয়েছিল (ঐতিহাসিক: Gate 1: 0.22s, Gate 2: 0.28s, Gate 3: 4.64s, Gate 4: 0.04s, Gate 5: 6.69s)।
13. Strict Firebase CLI Version Pinning & Separate Reports: `scripts/testWithOfficialEmulator.mjs`-এ লোকাল, গ্লোবাল ও npx ফলব্যাক—সব স্তরেই কঠোরভাবে `15.33.0` পিন করা হয়েছে (অন্য কোনো গ্লোবাল ভার্সন পাওয়া গেলেও তা বাইপাস করে নির্দিষ্ট 15.33.0 চালিত হবে)। এছাড়া Gate 2 (`tests/artifacts/embedded-rules-report.json`) ও Gate 5 (`tests/artifacts/emulator-rules-report.json`)-এর অডিট রিপোর্ট সম্পূর্ণ আলাদা ফাইলে সংরক্ষণের ব্যবস্থা করা হয়েছে যাতে কোনো রিপোর্ট ওভাররাইট বা অস্পষ্টতা তৈরি না হয়।

---

## বর্তমান সার্টিফাইড ভেরিফিকেশনের নিয়ম (2026-10-16 রিলিজ)

Project root-এ চালান:

```bash
npm ci --no-audit --no-fund
npm run verify:all
```

`npm run verify:all` স্বয়ংক্রিয়ভাবে বর্তমান **৬টি Gate** ক্রমানুসারে চালায়:
- **Gate 1:** Core Accounting & State Engine Tests (101/101 PASS)
- **Gate 2:** Embedded Rules Simulator (25/25 PASS)
- **Gate 3:** Fresh Production Source Build (Vite v6 Compile PASS)
- **Gate 4:** Distribution Integrity Verifier (verify:dist PASS)
- **Gate 5:** Official Google Cloud Firestore Emulator (Port 8080, 25/25 PASS)
- **Gate 6:** Staging Acceptance & Local Recovery Suite (7/7 PASS)
