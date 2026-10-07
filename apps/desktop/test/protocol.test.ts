import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAppUrl, isSafeExternalUrl, mimeType, parseRange, resolveRequestPath, shouldFallbackToIndex } from '../src/main/protocol-utils';

const root = path.resolve('/srv/web');

describe('resolveRequestPath', () => {
  it('maps paths inside the root and defaults to index.html', () => {
    expect(resolveRequestPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveRequestPath(root, '')).toBe(path.join(root, 'index.html'));
    expect(resolveRequestPath(root, '/assets/app-1a2b.js')).toBe(path.join(root, 'assets', 'app-1a2b.js'));
    expect(resolveRequestPath(root, '/busytex/texlive%20basic.data')).toBe(path.join(root, 'busytex', 'texlive basic.data'));
    expect(resolveRequestPath(root, '/docs/')).toBe(path.join(root, 'docs', 'index.html'));
  });
  it('blocks traversal, encoded separators, drive letters and NUL bytes', () => {
    expect(resolveRequestPath(root, '/../etc/passwd')).toBeNull();
    expect(resolveRequestPath(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveRequestPath(root, '/a/%2F..%2F..%2Fetc')).toBeNull();
    expect(resolveRequestPath(root, '/..%5C..%5Cwindows')).toBeNull();
    expect(resolveRequestPath(root, '/C:/Windows/win.ini')).toBeNull();
    expect(resolveRequestPath(root, '/a%00.js')).toBeNull();
    expect(resolveRequestPath(root, '/%E0%A4%A')).toBeNull();
  });
});

describe('mimeType', () => {
  it('serves WASM, data, modules and fonts correctly', () => {
    expect(mimeType('x.wasm')).toBe('application/wasm');
    expect(mimeType('texlive-basic.data')).toBe('application/octet-stream');
    expect(mimeType('worker.mjs')).toBe('text/javascript; charset=utf-8');
    expect(mimeType('index.HTML')).toBe('text/html; charset=utf-8');
    expect(mimeType('a.woff2')).toBe('font/woff2');
    expect(mimeType('a.svg')).toBe('image/svg+xml');
    expect(mimeType('noext')).toBe('application/octet-stream');
  });
});

describe('shouldFallbackToIndex', () => {
  it('falls back for client routes, not for missing assets', () => {
    expect(shouldFallbackToIndex('/project/abc')).toBe(true);
    expect(shouldFallbackToIndex('/join/room-1')).toBe(true);
    expect(shouldFallbackToIndex('/assets/missing.js')).toBe(false);
    expect(shouldFallbackToIndex('/busytex/x.wasm', 'text/html')).toBe(false);
    expect(shouldFallbackToIndex('/p/v1.2', 'text/html,application/xhtml+xml')).toBe(true);
  });
});

describe('parseRange', () => {
  it('parses single ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
  });
  it('rejects unsatisfiable ranges and ignores unsupported ones', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=5-1', 1000)).toBe('invalid');
    expect(parseRange('bytes=-', 1000)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });
});

describe('url guards', () => {
  it('recognises app URLs', () => {
    expect(isAppUrl('texit://app/index.html')).toBe(true);
    expect(isAppUrl('texit://evil/index.html')).toBe(false);
    expect(isAppUrl('http://localhost:5173/x', 'http://localhost:5173')).toBe(true);
    expect(isAppUrl('http://localhost:5174/x', 'http://localhost:5173')).toBe(false);
    expect(isAppUrl('https://example.com')).toBe(false);
    expect(isAppUrl('not a url')).toBe(false);
  });
  it('only allows http(s)/mailto externally', () => {
    expect(isSafeExternalUrl('https://overleaf.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('smb://host/share')).toBe(false);
  });
});
