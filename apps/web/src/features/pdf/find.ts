/**
 * Text search over pdf.js text content.
 *
 * Every page gets an index: the text items concatenated into a searchable
 * string (line ends become spaces, hyphenated line breaks are joined) plus a
 * map back to "raw" offsets (the items' `str` concatenated), which is what the
 * text layer's spans contain — so a match can be highlighted span by span.
 */
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';

export interface PageTextIndex {
  /** Searchable text. */
  text: string;
  /** For each char of `text`: offset in the raw item text, or -1 for synthetic separators. */
  map: Int32Array;
  /** Raw start offset of every text item, plus the total length at the end. */
  itemStarts: Int32Array;
  items: TextItem[];
}

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** A match in raw offsets of one page (end exclusive). */
export interface PageMatch {
  page: number; // 0-based
  start: number;
  end: number;
}

const HYPHENS = /[-­‐‑]$/;

export function textItems(tc: TextContent): TextItem[] {
  return tc.items.filter((it): it is TextItem => (it as TextItem).str !== undefined);
}

export function buildPageIndex(tc: TextContent): PageTextIndex {
  const items = textItems(tc);
  const itemStarts = new Int32Array(items.length + 1);
  let rawLen = 0;
  for (const it of items) rawLen += it.str.length;
  const map = new Int32Array(rawLen + items.length);
  let text = '';
  let n = 0;
  let raw = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const s = it.str;
    itemStarts[i] = raw;
    const joinHyphen = it.hasEOL && i < items.length - 1 && s.length > 1 && HYPHENS.test(s) && /\p{L}/u.test(s[s.length - 2]);
    const len = joinHyphen ? s.length - 1 : s.length;
    for (let j = 0; j < len; j++) {
      map[n++] = raw + j;
    }
    text += joinHyphen ? s.slice(0, -1) : s;
    raw += s.length;
    if (it.hasEOL && !joinHyphen && !/\s$/.test(s)) {
      text += ' ';
      map[n++] = -1;
    }
  }
  itemStarts[items.length] = raw;
  return { text, map: map.subarray(0, n), itemStarts, items };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildRegex(query: string, opts: FindOptions = {}): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  let src = q
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s*');
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, opts.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

/** All matches on a page, as raw offset ranges. */
export function findInPage(idx: PageTextIndex, re: RegExp, page: number): PageMatch[] {
  const out: PageMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(idx.text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const a = m.index;
    const b = a + m[0].length;
    let s = -1;
    let e = -1;
    for (let i = a; i < b; i++) {
      const r = idx.map[i];
      if (r >= 0) {
        if (s < 0) s = r;
        e = r + 1;
      }
    }
    if (s >= 0) out.push({ page, start: s, end: e });
  }
  return out;
}

/** Split a raw range into per-item ranges `[item, from, to)`. */
export function itemRanges(idx: PageTextIndex, start: number, end: number): { item: number; from: number; to: number }[] {
  const starts = idx.itemStarts;
  const n = idx.items.length;
  // Binary search for the item containing `start`.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= start) lo = mid;
    else hi = mid - 1;
  }
  const out: { item: number; from: number; to: number }[] = [];
  for (let i = lo; i < n && starts[i] < end; i++) {
    const from = Math.max(start, starts[i]) - starts[i];
    const to = Math.min(end, starts[i + 1]) - starts[i];
    if (to > from) out.push({ item: i, from, to });
  }
  return out;
}
