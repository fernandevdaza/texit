import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { cpSync, createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/**
 * Serve (dev) / copy (build) pdf.js runtime assets — standard fonts, CMaps,
 * ICC profiles and WASM image decoders — under `<base>pdfjs/`.
 */
function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const dirs = ['standard_fonts', 'cmaps', 'iccs', 'wasm'];
  let outDir = 'dist';
  return {
    name: 'texit-pdfjs-assets',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/pdfjs\/([^?#]+)/.exec(req.url ?? '');
        if (!m) return next();
        const rel = normalize(decodeURIComponent(m[1]));
        if (rel.startsWith('..') || !dirs.includes(rel.split(/[\\/]/)[0])) return next();
        const file = join(root, rel);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Cache-Control', 'public, max-age=86400');
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      // Dev-only test fixtures (PDF viewer harness) never ship.
      rmSync(join(outDir, '__test__'), { recursive: true, force: true });
      for (const d of dirs) if (existsSync(join(root, d))) cpSync(join(root, d), join(outDir, 'pdfjs', d), { recursive: true });
    },
  };
}

// `TEXIT_BASE` lets the static build be hosted under a sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: process.env.TEXIT_BASE ?? '/',
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Multiple copies of these break Yjs/CodeMirror at runtime.
    dedupe: ['yjs', 'y-protocols', 'lib0', '@codemirror/state', '@codemirror/view', '@codemirror/language', 'react', 'react-dom'],
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['texlyre-busytex'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: true },
});
