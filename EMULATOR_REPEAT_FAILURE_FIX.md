# Ledgero — Official Firestore Emulator repeat-failure fix

## What changed

1. `scripts/testWithOfficialEmulator.mjs` now deletes any old emulator report before every attempt, verifies Java before auto-start, uses a pinned Firebase CLI fallback (`firebase-tools@15.33.0`), supplies an explicit project ID, enforces a configurable timeout, handles child-process errors/signals as failures, and requires a fresh 25/25 report before returning exit code 0.
2. `scripts/verifyAll.mjs` removes any old `emulator-rules-report.json` before running the gates. A prior passing report cannot survive a new failed attempt.
3. `scripts/packZip.mjs` has the `.env.*` check corrected and includes `.github` workflow files in the whitelist.
4. `.github/workflows/ledgero-verify.yml` sets up Node 22 and Java 21, installs the project and a pinned Firebase CLI, caches the Firestore emulator JAR, then runs the full five-gate verifier and uploads artifacts.

## Important constraint

A first-time official-emulator run needs network access to download the pinned Firebase CLI (unless preinstalled) and Firestore emulator JAR. No script can make those network downloads succeed in a sandbox that blocks the package registry. The new runner fails honestly on timeout and does not report a fake pass. GitHub Actions is the clean, repeatable environment for the authoritative run.

## Verification performed in the attached review environment on 2026-10-13

- `npm test`: 101/101 passed, exit 0.
- `npm run test:rules:embedded`: 25/25 passed, exit 0. This is the project's embedded simulator, not Google's emulator.
- `npm run verify:dist`: exit 0 for the ZIP's prebuilt `dist/`; it does not compile source.
- `npm run build`: exit 1 because `node_modules/vite/bin/vite.js` is absent; dependency installation did not complete in this environment.
- `npm run test:emulator`: the first attempt timed out after 180 seconds while `npx` tried to obtain `firebase-tools`; no official-emulator test result was produced. After the patch, a second diagnostic run used `LEDGERO_EMULATOR_TIMEOUT_MS=5000` intentionally and exited 124 after 5 seconds, rather than reporting success. `npm ci` also did not complete within this environment’s 120-second tool window.

Therefore, this patch makes the runner and CI gate stricter and repeatable, but **does not claim that the official Google emulator passed in this review environment**. The GitHub Actions run must be green before describing that gate as passed.
