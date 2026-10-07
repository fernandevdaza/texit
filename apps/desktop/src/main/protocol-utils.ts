/**
 * Pure helpers for the `texit://app/` protocol (unit tested).
 */
import path from 'node:path';

export const APP_SCHEME = 'texit';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  wasm: 'application/wasm',
  data: 'application/octet-stream',
  bin: 'application/octet-stream',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain; charset=utf-8',
  tex: 'text/plain; charset=utf-8',
  cnf: 'text/plain; charset=utf-8',
  profile: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

export function mimeType(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

/**
 * Map a request pathname (`/assets/x.js`) to a file inside `root`.
 * Returns null for anything that could escape the root (traversal, encoded
 * separators, drive letters, NUL bytes) or malformed escapes.
 */
export function resolveRequestPath(root: string, pathname: string): string | null {
  let segments: string[];
  try {
    segments = pathname.split('/').map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  const clean: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..' || seg.includes('\0') || seg.includes('\\') || seg.includes('/') || /^[a-zA-Z]:/.test(seg)) return null;
    clean.push(seg);
  }
  if (!clean.length || pathname.endsWith('/')) clean.push('index.html');
  const abs = path.resolve(root, ...clean);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/**
 * SPA fallback: unknown paths that look like client-side routes (no file
 * extension, or an HTML navigation) are answered with index.html; missing
 * assets stay 404 so bugs are not masked.
 */
export function shouldFallbackToIndex(pathname: string, accept?: string | null): boolean {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  if (!last.includes('.')) return true;
  return !!accept && accept.includes('text/html') && !/\.(js|mjs|css|wasm|data|json|map|png|jpe?g|svg|woff2?)$/i.test(last);
}

export type ByteRange = { start: number; end: number };

/** Parse a single-range `Range: bytes=…` header. Returns null when absent / unsupported, 'invalid' when unsatisfiable. */
export function parseRange(header: string | null | undefined, size: number): ByteRange | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or other units: serve the full body
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  let start: number;
  let end: number;
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/** Is `url` part of our own app (packaged protocol or dev server)? */
export function isAppUrl(url: string, devServerUrl?: string | null): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST) return true;
    if (devServerUrl) {
      const d = new URL(devServerUrl);
      return u.origin === d.origin;
    }
  } catch {
    /* invalid URL */
  }
  return false;
}

/** URLs we are willing to hand to the OS (window.open, link clicks…). */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}
