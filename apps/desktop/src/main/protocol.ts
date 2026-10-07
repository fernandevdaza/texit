/**
 * `texit://app/` — serves the production web build from disk.
 *
 * A privileged standard scheme gives the app a stable secure origin (needed
 * for IndexedDB/y-indexeddb, service workers, fetch, WASM streaming
 * compilation…) without running a local HTTP server. Files are streamed from
 * disk with Range support so the large TeX Live WASM bundles under /busytex/
 * are served efficiently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { app, protocol, session } from 'electron';
import { APP_HOST, APP_SCHEME, mimeType, parseRange, resolveRequestPath, shouldFallbackToIndex } from './protocol-utils';

/**
 * Cross-origin isolation (COOP/COEP) is only needed for SharedArrayBuffer
 * (e.g. threaded WASM). The web build does not require it today; flip this
 * if a future engine does. Note: COEP also blocks cross-origin resources that
 * do not send CORP/CORS headers.
 */
export const CROSS_ORIGIN_ISOLATED = false;

/** Optional Content-Security-Policy header for app documents (null = let the web app's own meta CSP apply). */
export const APP_CSP: string | null = null;

/** Must run before `app.whenReady()`. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        allowServiceWorkers: true,
        codeCache: true,
      },
    },
  ]);
}

/** Directory containing the built web app (index.html, assets/, busytex/…). */
export function resolveWebRoot(): string {
  const candidates = [
    process.env.TEXIT_WEB_DIST,
    path.join(app.getAppPath(), 'web'), // packaged: copied next to dist-electron by scripts/copy-web.mjs
    path.join(app.getAppPath(), '..', 'web', 'dist'), // monorepo: apps/desktop → apps/web/dist
  ].filter((p): p is string => !!p);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return candidates[0] ?? path.join(app.getAppPath(), 'web');
}

function baseHeaders(file: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': mimeType(file),
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  const isHtml = /\.html?$/i.test(file);
  h['Cache-Control'] = isHtml ? 'no-cache' : /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  if (CROSS_ORIGIN_ISOLATED) {
    h['Cross-Origin-Opener-Policy'] = 'same-origin';
    h['Cross-Origin-Embedder-Policy'] = 'require-corp';
    h['Cross-Origin-Resource-Policy'] = 'same-origin';
  }
  if (isHtml && APP_CSP) h['Content-Security-Policy'] = APP_CSP;
  return h;
}

async function serveFile(file: string, request: Request): Promise<Response> {
  const stat = await fs.promises.stat(file);
  const headers = baseHeaders(file);
  const range = parseRange(request.headers.get('range'), stat.size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : stat.size - 1;
  const length = stat.size === 0 ? 0 : end - start + 1;
  if (length === 0) return new Response(new Uint8Array(0), { status: 200, headers: { ...headers, 'Content-Length': '0' } });
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 1024 * 1024 });
  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'Content-Length': String(length),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
    },
  });
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Extra in-memory pages (used by the `--smoke` self-test). */
const virtualPages = new Map<string, string>();
export function setVirtualPage(pathname: string, html: string): void {
  virtualPages.set(pathname, html);
}

/** Register the `texit://` handler on the default session. Call after `app.whenReady()`. */
export function registerAppProtocol(webRoot: string): void {
  session.defaultSession.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const virtual = virtualPages.get(url.pathname);
    if (virtual !== undefined) return new Response(virtual, { headers: baseHeaders('page.html') });
    const file = resolveRequestPath(webRoot, url.pathname);
    if (!file) return new Response('Bad request', { status: 400 });
    try {
      if (await isFile(file)) return await serveFile(file, request);
      if (shouldFallbackToIndex(url.pathname, request.headers.get('accept'))) {
        const index = path.join(webRoot, 'index.html');
        if (await isFile(index)) return await serveFile(index, request);
        return new Response(missingBuildPage(webRoot), { status: 503, headers: baseHeaders('index.html') });
      }
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (err) {
      return new Response(`Internal error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
    }
  });
}

function missingBuildPage(webRoot: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><meta charset="utf-8"><title>TexIt</title>
<body style="font:14px system-ui;padding:48px;color:#334">
<h2>TexIt web build not found</h2>
<p>Expected <code>${esc(path.join(webRoot, 'index.html'))}</code>.</p>
<p>Run <code>pnpm --filter @texit/desktop build</code>, or start the dev server with <code>pnpm desktop:dev</code>.</p></body>`;
}
