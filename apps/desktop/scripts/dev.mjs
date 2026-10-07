#!/usr/bin/env node
/**
 * Desktop dev loop:
 *   1. start the web Vite dev server (unless something already answers on VITE_DEV_SERVER_URL),
 *   2. wait until it is reachable,
 *   3. esbuild-watch main + preload,
 *   4. launch Electron, restarting it whenever main/preload are rebuilt.
 */
import { spawn, fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..', '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron'); // path to the Electron binary
const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

const children = new Set();
let electron = null;
let shuttingDown = false;

function log(msg) {
  console.log(`\x1b[35m[texit-desktop]\x1b[0m ${msg}`);
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await reachable(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startWeb() {
  log(`starting web dev server (${devUrl})…`);
  const child = spawn('pnpm', ['--filter', '@texit/web', 'dev'], {
    cwd: repo,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  children.add(child);
  child.on('exit', (code) => {
    children.delete(child);
    if (!shuttingDown) {
      log(`web dev server exited (${code}); stopping.`);
      shutdown(code ?? 1);
    }
  });
}

function startElectron() {
  if (shuttingDown) return;
  log('launching Electron…');
  electron = spawn(electronBin, [root, ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl, NODE_ENV: 'development', ELECTRON_ENABLE_LOGGING: '1' },
  });
  const me = electron;
  me.on('exit', (code, signal) => {
    if (electron === me) electron = null;
    // A user-initiated quit (not a restart) ends the dev session.
    if (!me.restarting && !shuttingDown) {
      log(`Electron exited (${signal ?? code}).`);
      shutdown(0);
    }
  });
}

let restartTimer = null;
function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (electron) {
      log('main/preload changed → restarting Electron');
      electron.restarting = true;
      const old = electron;
      old.once('exit', startElectron);
      old.kill('SIGTERM');
    } else {
      startElectron();
    }
  }, 150);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electron) electron.kill('SIGTERM');
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (await reachable(devUrl)) log(`reusing running dev server at ${devUrl}`);
else startWeb();

if (!(await waitFor(devUrl, 120_000))) {
  log(`dev server did not come up at ${devUrl}`);
  shutdown(1);
} else {
  const builder = fork(path.join(root, 'scripts', 'build-main.mjs'), ['--watch'], { cwd: root, stdio: 'inherit' });
  children.add(builder);
  const built = new Set();
  builder.on('message', (m) => {
    if (!m || m.type !== 'built') return;
    if (m.errors) {
      log(`${m.name} build failed — fix the errors to relaunch.`);
      return;
    }
    if (built.size < 2) {
      built.add(m.name);
      if (built.size === 2) startElectron();
      return;
    }
    restartElectron();
  });
}
