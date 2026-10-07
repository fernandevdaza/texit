#!/usr/bin/env node
/**
 * Copy the production web build (apps/web/dist) into apps/desktop/web so that
 * electron-builder packages it next to dist-electron/.
 *
 * The ~500 MB TeX Live WASM bundle (busytex/) is skipped by default: the
 * desktop app prefers native TeX (latexmk / tectonic). Set
 * TEXIT_BUNDLE_BUSYTEX=1 to ship it (it is then unpacked from the asar).
 */
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(root, '..', 'web', 'dist');
const dest = path.join(root, 'web');
const bundleBusytex = /^(1|true|yes)$/i.test(process.env.TEXIT_BUNDLE_BUSYTEX ?? '');

if (!existsSync(path.join(src, 'index.html'))) {
  console.error(`✖ ${src}/index.html not found — run \`pnpm --filter @texit/web build\` first.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
let files = 0;
let bytes = 0;
cpSync(src, dest, {
  recursive: true,
  filter: (p) => {
    const rel = path.relative(src, p).split(path.sep).join('/');
    if (!bundleBusytex && (rel === 'busytex' || rel.startsWith('busytex/'))) return false;
    if (rel.endsWith('.map')) return false; // no sourcemaps in the app bundle
    const st = statSync(p);
    if (st.isFile()) {
      files++;
      bytes += st.size;
    }
    return true;
  },
});
console.log(`✓ copied web build → ${path.relative(root, dest)} (${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB${bundleBusytex ? ', busytex included' : ', busytex skipped'})`);
