#!/usr/bin/env node
/**
 * Bundle the Electron main process and the sandboxed preload with esbuild.
 *
 *   node scripts/build-main.mjs                # development build
 *   node scripts/build-main.mjs --production   # minified, no sourcemaps
 *   node scripts/build-main.mjs --watch        # rebuild on change (used by dev.mjs)
 */
import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

/** @type {import('esbuild').BuildOptions} */
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: production ? false : 'linked',
  minify: production,
  keepNames: true,
  legalComments: 'none',
  logLevel: 'info',
  define: {
    'process.env.TEXIT_BUILD_VERSION': JSON.stringify(pkg.version),
  },
  banner: { js: '/* TexIt desktop — AGPL-3.0-or-later */' },
};

const mainOptions = {
  ...common,
  entryPoints: { main: 'src/main.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  // ESM-only deps (chokidar 5…) may read `import.meta.url`; map it to the bundle's file URL.
  inject: [path.join(root, 'scripts/import-meta-url-shim.js')],
  define: { ...common.define, 'import.meta.url': 'import_meta_url' },
};

const preloadOptions = {
  ...common,
  entryPoints: { preload: 'src/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  // Sandboxed preloads can only `require('electron')` (and a few polyfilled modules).
  platform: 'browser',
  format: 'cjs',
  target: 'chrome130',
};

/** Fail the build if the preload pulls in anything but `electron`. */
const checkPreload = {
  name: 'check-preload',
  setup(b) {
    b.onEnd((result) => {
      if (result.errors.length) return;
      const out = readFileSync(path.join(root, 'dist-electron/preload.cjs'), 'utf8');
      const requires = [...out.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]).filter((m) => m !== 'electron');
      if (requires.length) {
        console.error(`✖ preload must only require "electron", found: ${requires.join(', ')}`);
        if (!watch) process.exitCode = 1;
      }
    });
  },
};

if (watch) {
  const ctxMain = await context({ ...mainOptions, plugins: [notify('main')] });
  const ctxPreload = await context({ ...preloadOptions, plugins: [checkPreload, notify('preload')] });
  await Promise.all([ctxMain.watch(), ctxPreload.watch()]);
} else {
  await Promise.all([build(mainOptions), build({ ...preloadOptions, plugins: [checkPreload] })]);
}

function notify(name) {
  return {
    name: `notify-${name}`,
    setup(b) {
      b.onEnd((result) => {
        if (process.send) process.send({ type: 'built', name, errors: result.errors.length });
      });
    },
  };
}
