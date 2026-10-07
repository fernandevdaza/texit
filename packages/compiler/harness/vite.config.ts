// Dev harness for @texit/compiler — serves the BusyTeX assets of the web app.
//   pnpm --filter @texit/compiler harness   →  http://localhost:5180
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../apps/web/public', import.meta.url)),
  // No HMR: other packages change while the harness runs long compiles.
  server: { port: 5180, strictPort: true, hmr: false, fs: { allow: [repoRoot] } },
  // Same settings as apps/web (the busytex npm package only spawns a classic worker from the asset dir).
  optimizeDeps: { exclude: ['texlyre-busytex'] },
  worker: { format: 'es' },
});
