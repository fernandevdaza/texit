/** Small, dependency-free helpers shared by the compile backends and the service. */
import { normalizePath, stripExtension, basename, dirname } from '@texit/core';
import type { ProjectFile } from '@texit/core';

const utf8Decoder = /* @__PURE__ */ new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = /* @__PURE__ */ new TextEncoder();

export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/** Text content of a project file (binary contents are decoded as UTF-8). */
export function fileText(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : utf8Decoder.decode(content);
}

export function fileBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? utf8Encoder.encode(content) : content;
}

/**
 * Returns a Uint8Array that owns its whole buffer. Structured clone (postMessage,
 * IPC) copies the *entire* underlying ArrayBuffer of a view, so sub-views of big
 * buffers (e.g. Yjs updates) must be compacted before crossing a boundary.
 */
export function compactBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
    ? bytes
    : bytes.slice();
}

// ───────────────────────────── base64 ─────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = /* @__PURE__ */ (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // base64url
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Encode bytes as standard base64 (works in browsers, workers and Node without Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const parts: string[] = [];
  const CHUNK = 0x8000 * 3; // multiple of 3 → no padding inside the chunks
  for (let start = 0; start < len; start += CHUNK) {
    const end = Math.min(start + CHUNK, len);
    let out = '';
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < end) {
      const rem = end - i;
      const n = (bytes[i] << 16) | (rem > 1 ? bytes[i + 1] << 8 : 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (rem > 1 ? B64[(n >> 6) & 63] : '=') + '=';
    }
    parts.push(out);
  }
  return parts.join('');
}

/** Decode standard or url-safe base64 (whitespace and missing padding are tolerated). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]+/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean.charCodeAt(i) & 255];
    if (v < 0) throw new Error(`Invalid base64 character at position ${i}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return o === out.length ? out : out.slice(0, o);
}

// ───────────────────────────── abort / async ─────────────────────────────

export class AbortedError extends Error {
  constructor(message = 'Compilation cancelled') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError();
}

/** Combine several (optional) abort signals into one. */
export function anySignal(signals: (AbortSignal | undefined)[]): { signal: AbortSignal; dispose(): void } {
  const ctrl = new AbortController();
  const cleanups: (() => void)[] = [];
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    const on = () => ctrl.abort(s.reason);
    s.addEventListener('abort', on, { once: true });
    cleanups.push(() => s.removeEventListener('abort', on));
  }
  return { signal: ctrl.signal, dispose: () => cleanups.forEach((c) => c()) };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function randomId(prefix = ''): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const id = c && typeof c.randomUUID === 'function' ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix + id;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A FIFO mutex: `run` executes callbacks one at a time, in call order. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  get busy(): boolean {
    return this.depth > 0;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth++;
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => void this.depth--,
      () => void this.depth--,
    );
    return result;
  }
}

// ───────────────────────────── project files ─────────────────────────────

/**
 * Normalise a set of project files: POSIX paths without leading slash, no
 * duplicates (last one wins), no empty paths.
 */
export function normalizeFiles(files: ProjectFile[]): ProjectFile[] {
  const map = new Map<string, ProjectFile>();
  for (const f of files) {
    const path = normalizePath(f.path);
    if (!path) continue;
    map.set(path, path === f.path ? f : { path, content: f.content });
  }
  return [...map.values()];
}

const ARTIFACT_EXTENSIONS = ['aux', 'log', 'synctex.gz', 'synctex', 'synctex(busy)', 'fls', 'fdb_latexmk', 'xdv', 'dvi', 'bcf', 'run.xml', 'pdf'];

/**
 * Drop stale build artefacts of the main job (e.g. `main.aux`, `main.pdf` that
 * came with an imported zip). They can break or confuse a fresh build. `.bbl`
 * files are kept on purpose (arXiv-style projects ship them without a `.bib`).
 */
export function stripBuildArtifacts(files: ProjectFile[], mainPath: string): ProjectFile[] {
  const dir = dirname(mainPath);
  const stem = stripExtension(basename(mainPath));
  const prefix = dir ? `${dir}/${stem}.` : `${stem}.`;
  return files.filter((f) => {
    if (!f.path.startsWith(prefix)) return true;
    const ext = f.path.slice(prefix.length);
    return !ARTIFACT_EXTENSIONS.includes(ext);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
