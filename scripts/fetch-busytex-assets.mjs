#!/usr/bin/env node
// Download the BusyTeX WASM + TeX Live data assets (~500 MB compressed) into apps/web/public/busytex/.
//
//   pnpm assets:busytex            # skip if already present (and matching the installed version)
//   pnpm assets:busytex --force    # re-download
//   node scripts/fetch-busytex-assets.mjs --dest path/to/busytex
//
// The asset release is derived from the installed `texlyre-busytex` package version.
// Uses only Node built-ins + the system `tar` (bsdtar on macOS/Windows 10+, GNU tar on Linux).

import { createRequire } from 'node:module';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force') || args.includes('-f');
const destArg = args.indexOf('--dest');
const dest = path.resolve(root, destArg !== -1 && args[destArg + 1] ? args[destArg + 1] : 'apps/web/public/busytex');
const MARKER = '.texit-assets-version';
const REQUIRED = ['busytex.js', 'busytex.wasm', 'busytex_worker.js', 'busytex_pipeline.js', 'texlive-basic.js', 'texlive-basic.data'];

function busytexVersion() {
  const require = createRequire(path.join(root, 'packages/compiler/package.json'));
  const pkg = JSON.parse(String(require('node:fs').readFileSync(require.resolve('texlyre-busytex/package.json'))));
  return pkg.version;
}

async function isComplete(dir, version) {
  if (!REQUIRED.every((f) => existsSync(path.join(dir, f)))) return false;
  const marker = await readFile(path.join(dir, MARKER), 'utf8').catch(() => null);
  return marker === null || marker.trim() === version; // pre-existing manual installs count as complete
}

function fmt(n) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function download(url, file) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText} (${url})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let loaded = 0;
  let lastPrint = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    loaded += chunk.length;
    const now = Date.now();
    if (process.stdout.isTTY && now - lastPrint > 200) {
      lastPrint = now;
      const pct = total ? ` ${((loaded / total) * 100).toFixed(1)}%` : '';
      process.stdout.write(`\r  ${fmt(loaded)}${total ? ` / ${fmt(total)}` : ''}${pct}   `);
    }
  });
  await pipeline(body, createWriteStream(file));
  if (process.stdout.isTTY) process.stdout.write('\n');
  if (total && loaded !== total) throw new Error(`Incomplete download: ${loaded} of ${total} bytes`);
  return loaded;
}

function extract(archive, dir) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
    child.on('error', (err) => reject(new Error(`Could not run tar (${err.message}). Install tar or extract ${archive} manually.`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`))));
  });
}

/** Directory inside `dir` that contains busytex.wasm (the archive nests it under busytex/). */
async function findAssetDir(dir, depth = 0) {
  if (existsSync(path.join(dir, 'busytex.wasm'))) return dir;
  if (depth > 3) return null;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = await findAssetDir(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

async function main() {
  const version = busytexVersion();
  const url = `https://github.com/TeXlyre/texlyre-busytex/releases/download/assets-v${version}/busytex-assets.tar.gz`;
  if (!force && (await isComplete(dest, version))) {
    console.log(`✓ BusyTeX assets already present in ${path.relative(root, dest)} (use --force to re-download)`);
    return;
  }
  const parent = path.dirname(dest);
  await mkdir(parent, { recursive: true });
  const work = path.join(parent, `.busytex-download-${process.pid}`);
  const archive = path.join(work, 'busytex-assets.tar.gz');
  const extracted = path.join(work, 'extracted');
  await mkdir(extracted, { recursive: true });
  try {
    console.log(`Downloading BusyTeX assets v${version}\n  ${url}`);
    const bytes = await download(url, archive);
    console.log(`✓ Downloaded ${fmt(bytes)} — extracting…`);
    await extract(archive, extracted);
    await rm(archive, { force: true });
    const assets = await findAssetDir(extracted);
    if (!assets) throw new Error('busytex.wasm not found in the archive');
    await writeFile(path.join(assets, MARKER), `${version}\n`);
    await rm(dest, { recursive: true, force: true });
    await rename(assets, dest);
    const size = (await readdir(dest)).length;
    const wasm = await stat(path.join(dest, 'busytex.wasm'));
    console.log(`✓ BusyTeX assets ready in ${path.relative(root, dest)} (${size} files, busytex.wasm ${fmt(wasm.size)})`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
