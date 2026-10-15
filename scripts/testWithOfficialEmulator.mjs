/**
 * Official Firestore Emulator test runner.
 *
 * Guarantees:
 * - A stale report can never be mistaken for a fresh successful run.
 * - Uses local JDK 21 or system Java with strict version verification (JDK 21+).
 * - Pins the emulator project ID so the rules tests and CLI use the same project.
 * - Fails on missing Java, timeout, spawn errors, signals, missing report, or failed tests.
 * - Does not convert an unknown/null child exit code into success.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const artifactDir = path.join(projectRoot, 'tests', 'artifacts');
const reportPath = path.join(artifactDir, 'emulator-rules-report.json');
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [host, port] = EMULATOR_HOST.split(':');
const PROJECT_ID = 'shopbook-460ca'; // Must match project ID used by tests/emulatorRulesTest.mjs.
const TIMEOUT_MS = Number.parseInt(process.env.LEDGERO_EMULATOR_TIMEOUT_MS || '600000', 10);
const runStartedAt = Date.now();

fs.mkdirSync(artifactDir, { recursive: true });
// A stale report must never survive a new attempt, whether startup passes or fails.
fs.rmSync(reportPath, { force: true });

function fail(message, exitCode = 1) {
  console.error(`\n❌ ${message}`);
  process.exitCode = exitCode;
}

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
      res.on('end', () => resolve(body.trim() === 'Ok'));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveJavaEnv() {
  const env = { ...process.env };
  const candidateJdks = [
    env.JAVA_HOME,
    'C:\\Users\\bahad\\jdk-21\\jdk-21.0.12.1+1',
    'C:\\Program Files\\Microsoft\\jdk-21',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
    'C:\\Program Files\\Java\\jdk-21',
  ].filter(Boolean);

  const foundJdk = candidateJdks.find(p => fs.existsSync(path.join(p, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
  if (foundJdk) {
    env.JAVA_HOME = foundJdk;
    const javaBin = path.join(foundJdk, 'bin');
    env.PATH = `${javaBin}${path.delimiter}${env.PATH || ''}`;
  } else if (env.JAVA_HOME) {
    const javaBin = path.join(env.JAVA_HOME, 'bin');
    if (fs.existsSync(javaBin)) env.PATH = `${javaBin}${path.delimiter}${env.PATH || ''}`;
  }
  return env;
}

function javaMajorVersion(env) {
  const javaExe = env.JAVA_HOME
    ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const javaResult = spawnSync(javaExe, ['-version'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  const output = `${javaResult.stdout || ''}\n${javaResult.stderr || ''}`;
  const match = output.match(/version\s+"(?:1\.)?(\d+)/i) || output.match(/openjdk\s+(\d+)/i);
  if (javaResult.error || javaResult.status !== 0 || !match) return null;
  return Number(match[1]);
}

const PINNED_FIREBASE_VERSION = '15.33.0';

function pickCli() {
  const localCli = path.join(projectRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  const localPkgJson = path.join(projectRoot, 'node_modules', 'firebase-tools', 'package.json');
  if (fs.existsSync(localCli) && fs.existsSync(localPkgJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(localPkgJson, 'utf8'));
      if (pkg.version === PINNED_FIREBASE_VERSION || pkg.version.startsWith('15.33.')) {
        return { command: process.execPath, prefixArgs: [localCli], source: `local node_modules (firebase-tools ${pkg.version})` };
      }
      console.warn(`⚠️ Notice: Local firebase-tools version ${pkg.version} does not match pinned ${PINNED_FIREBASE_VERSION}.`);
    } catch {}
  }

  // Check global firebase CLI - strictly require pinned 15.33.x
  const globalProbe = spawnSync('firebase', ['--version'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  const globalVersion = `${globalProbe.stdout || ''}${globalProbe.stderr || ''}`.trim().split(/\s+/)[0];
  if (globalProbe.status === 0 && (globalVersion === PINNED_FIREBASE_VERSION || globalVersion.startsWith('15.33.'))) {
    return { command: 'firebase', prefixArgs: [], source: `global firebase-tools ${globalVersion}` };
  }
  if (globalProbe.status === 0 && globalVersion) {
    console.log(`ℹ️ Notice: Global firebase-tools version (${globalVersion}) is not pinned ${PINNED_FIREBASE_VERSION}. Enforcing pinned npx CLI.`);
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    prefixArgs: ['--yes', `firebase-tools@${PINNED_FIREBASE_VERSION}`],
    source: `pinned npx firebase-tools@${PINNED_FIREBASE_VERSION}`,
  };
}

function validateFreshReport() {
  if (!fs.existsSync(reportPath)) {
    fail('Test process exited 0 but did not create a fresh emulator-rules-report.json. Refusing false success.');
    return false;
  }
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const reportTime = Date.parse(report.executedAt || '');
    const valid = report.suite === 'Google Cloud Firestore Emulator Security Rules Suite'
      && report.status === 'PASSED'
      && report.totalTests === 25
      && report.passed === 25
      && report.failed === 0
      && Array.isArray(report.results)
      && report.results.length === 25
      && report.results.every((test) => test && test.status === 'PASS')
      && report.emulatorHost === EMULATOR_HOST
      && Number.isFinite(reportTime)
      && reportTime >= runStartedAt - 2000;
    if (!valid) {
      fail(`Fresh emulator report is invalid or incomplete: status=${report.status}, passed=${report.passed}, failed=${report.failed}, host=${report.emulatorHost}`);
      return false;
    }
    console.log(`✅ Fresh report verified: ${report.passed}/${report.totalTests} tests passed at ${report.executedAt}.`);
    return true;
  } catch (error) {
    fail(`Could not validate emulator report: ${error.message}`);
    return false;
  }
}

function runChild(command, args, env, shell) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;

    const fullCmd = shell && args.length > 0
      ? `${command} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`
      : command;
    const cmdArgs = shell && args.length > 0 ? [] : args;

    const child = spawn(fullCmd, cmdArgs, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
      shell,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      console.error(`\n❌ Emulator command exceeded ${TIMEOUT_MS} ms; terminating it (no pass will be reported).`);
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        if (settled) return;
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {}
      }, 5000).unref();
    }, TIMEOUT_MS);

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code: 1, error, timedOut });
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code: typeof code === 'number' ? code : 1, signal, timedOut });
    });
  });
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔥 LEDGERO — OFFICIAL FIRESTORE EMULATOR TEST RUNNER');
console.log(`Target: ${EMULATOR_HOST} | Project: ${PROJECT_ID}`);
console.log(`Report: ${path.relative(projectRoot, reportPath)}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const alreadyRunning = await isEmulatorRunning();
let result;

if (alreadyRunning) {
  console.log(`📡 Found a running Firestore endpoint at ${EMULATOR_HOST}; running the suite directly.`);
  result = await runChild(process.execPath, ['tests/emulatorRulesTest.mjs'], process.env, false);
} else {
  const env = resolveJavaEnv();
  const major = javaMajorVersion(env);
  if (major === null) {
    fail('Java could not be executed. Install a JDK and set JAVA_HOME/PATH before starting the Official Firestore Emulator.');
    process.exit(1);
  }
  if (major < 21) {
    fail(`Java ${major} was found; this release gate requires JDK 21+. Detected java -version output is too old.`, 1);
    process.exit(1);
  }
  console.log(`☕ Java ${major} verified at: ${env.JAVA_HOME || 'system PATH'}`);

  const cli = pickCli();
  const args = [
    ...cli.prefixArgs,
    'emulators:exec',
    '--only', 'firestore',
    '--project', PROJECT_ID,
    'node tests/emulatorRulesTest.mjs',
  ];
  console.log(`🚀 Starting the official emulator through ${cli.source}.`);
  result = await runChild(cli.command, args, env, process.platform === 'win32');
}

if (result.error) {
  fail(`Could not start emulator test process: ${result.error.message}`);
  process.exit(1);
}
if (result.timedOut) {
  fail('Official emulator run timed out. Treat this as a failed verification, not a pass.', 124);
  process.exit(124);
}
if (result.code !== 0) {
  fail(`Official emulator command failed with exit code ${result.code}${result.signal ? ` (signal ${result.signal})` : ''}.`);
  process.exit(result.code > 0 ? result.code : 1);
}
if (!validateFreshReport()) process.exit(1);

console.log('\n🎉 Official Firestore Emulator suite and fresh-report checks passed.');
process.exit(0);
