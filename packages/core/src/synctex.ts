/**
 * SyncTeX parser + forward/inverse search, implemented in pure TS so it works
 * in the browser (WASM builds) and on desktop alike.
 *
 * Coordinates: PDF points (1/72 in), origin at the TOP-LEFT of the page,
 * y growing downwards (i.e. already converted from TeX's baseline coords).
 *
 * File format (SyncTeX v1, as written by pdfTeX/XeTeX/LuaTeX/Tectonic):
 *
 *   SyncTeX Version:1
 *   Input:<tag>:<path>              (may also appear inside the content)
 *   Output:pdf
 *   Magnification:<int>             (1000 = 1.0)
 *   Unit:<int>                      (scaled points per unit, usually 1)
 *   X Offset:<int>  Y Offset:<int>  (sp)
 *   Content:
 *   !<bytes>                        (byte-offset markers, ignored)
 *   {<page>  …  }<page>
 *   [<tag>,<line>(,<col>)?:<h>,<v>:<W>,<H>,<D>   vbox begin …  ]  vbox end
 *   (<tag>,<line>:<h>,<v>:<W>,<H>,<D>            hbox begin …  )  hbox end
 *   v<tag>,<line>:<h>,<v>:<W>,<H>,<D>            void vbox
 *   h<tag>,<line>:<h>,<v>:<W>,<H>,<D>            void hbox
 *   r<tag>,<line>:<h>,<v>:<W>,<H>,<D>            rule
 *   k<tag>,<line>:<h>,<v>:<W>                    kern
 *   g<tag>,<line>:<h>,<v>                        glue
 *   $<tag>,<line>:<h>,<v>                        math
 *   x<tag>,<line>:<h>,<v>                        current point
 *   <…> form begin/end, f<…> form reference      (ignored)
 *   Postamble: / Count: / Post scriptum: (Magnification:, X Offset:, Y Offset: overrides)
 *
 * h/v are in "units" from the top-left corner of the page (they already
 * include TeX's 1in origin); v is the baseline, so the top of a box is v − H.
 * 1 bp = 72.27/72 pt = 65781.76 sp.
 */
import { gunzipSync } from 'fflate';
import { normalizePath } from './paths';

export type SyncTexNodeKind = 'vbox' | 'hbox' | 'void-vbox' | 'void-hbox' | 'rule' | 'kern' | 'glue' | 'math' | 'current';

export interface SyncTexBox {
  page: number; // 1-based
  x: number;
  y: number; // top of the box
  width: number;
  height: number; // height + depth
  file: string; // as recorded in the synctex input table
  line: number;
  /** Node kind (boxes: vbox, hbox, void-vbox, void-hbox, rule). */
  kind?: SyncTexNodeKind;
  /** y of the baseline (PDF points, top-left origin). */
  baseline?: number;
  /** Index of the enclosing box in the same page array (-1 = none). */
  parent?: number;
  /** Input tag. */
  tag?: number;
}

/** Point records (kern, glue, math, current) — positions on a baseline inside a box. */
export interface SyncTexRecord {
  kind: 'kern' | 'glue' | 'math' | 'current';
  x: number;
  /** Baseline y (PDF points, top-left origin). */
  y: number;
  /** Kern width (0 for the other kinds). */
  width: number;
  tag: number;
  line: number;
  /** Index of the enclosing box in `pages.get(page)` (-1 = none). */
  parent: number;
}

export interface SyncTexData {
  /** Input files by tag. */
  inputs: Map<number, string>;
  /** Boxes grouped by page. */
  pages: Map<number, SyncTexBox[]>;
  /** Magnification from the preamble (1000 = 1.0). */
  magnification: number;
  /** `Unit:` from the preamble (scaled points per synctex unit). */
  unit: number;
  /** Horizontal offset in PDF points (preamble + post scriptum). */
  xOffset: number;
  /** Vertical offset in PDF points. */
  yOffset: number;
  /** Point records grouped by page. */
  records?: Map<number, SyncTexRecord[]>;
}

const SP_PER_BP = 65781.76;
const textDecoder = new TextDecoder('utf-8');

/** Parse a dimension like `1in`, `-12.5pt`, `3000` (sp) into scaled points. */
function parseDimension(v: string): number {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z]{2})?/i.exec(v);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? 'sp').toLowerCase()) {
    case 'pt':
      return n * 65536;
    case 'bp':
      return n * SP_PER_BP;
    case 'in':
      return n * 72.27 * 65536;
    case 'cm':
      return (n * 72.27 * 65536) / 2.54;
    case 'mm':
      return (n * 72.27 * 65536) / 25.4;
    case 'pc':
      return n * 12 * 65536;
    case 'dd':
      return ((n * 1238) / 1157) * 65536;
    case 'cc':
      return ((n * 12 * 1238) / 1157) * 65536;
    default:
      return n;
  }
}

/** Accepts gzipped (.synctex.gz) or plain synctex bytes/text. */
export function parseSyncTex(data: Uint8Array | string): SyncTexData {
  let text: string;
  if (typeof data === 'string') text = data;
  else {
    const bytes = data.length > 2 && data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
    text = textDecoder.decode(bytes);
  }

  const inputs = new Map<number, string>();
  const pages = new Map<number, SyncTexBox[]>();
  const records = new Map<number, SyncTexRecord[]>();
  let magnification = 1000;
  let unit = 1;
  let xOffsetSp = 0;
  let yOffsetSp = 0;
  let postMag = 0;
  let postX: number | undefined;
  let postY: number | undefined;

  // Raw nodes, converted to points once the post scriptum is known.
  interface RawBox { page: number; kind: SyncTexNodeKind; tag: number; line: number; h: number; v: number; W: number; H: number; D: number; parent: number }
  interface RawRec { page: number; kind: SyncTexRecord['kind']; tag: number; line: number; h: number; v: number; W: number; parent: number }
  const rawBoxes: RawBox[][] = [];
  const rawRecs: RawRec[][] = [];
  const pageNumbers: number[] = [];

  let state: 'preamble' | 'content' | 'postamble' | 'postscriptum' = 'preamble';
  let page = 0;
  let pageBoxes: RawBox[] = [];
  let pageRecs: RawRec[] = [];
  const open: number[] = []; // stack of indices into pageBoxes
  let formDepth = 0;

  const n = text.length;
  let pos = 0;
  while (pos < n) {
    let eol = text.indexOf('\n', pos);
    if (eol === -1) eol = n;
    let line = text.slice(pos, eol);
    pos = eol + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) continue;

    if (line.startsWith('Input:')) {
      const c = line.indexOf(':', 6);
      if (c > 6) {
        const tag = parseInt(line.slice(6, c), 10);
        const path = line.slice(c + 1);
        if (!Number.isNaN(tag) && path) inputs.set(tag, path);
      }
      continue;
    }

    if (state !== 'content') {
      const c = line.indexOf(':');
      const key = c === -1 ? line : line.slice(0, c);
      const val = c === -1 ? '' : line.slice(c + 1);
      if (key === 'Content') {
        state = 'content';
        continue;
      }
      if (key === 'Post scriptum') {
        state = 'postscriptum';
        continue;
      }
      if (state === 'preamble') {
        if (key === 'Magnification') magnification = parseInt(val, 10) || 1000;
        else if (key === 'Unit') unit = parseInt(val, 10) || 1;
        else if (key === 'X Offset') xOffsetSp = parseDimension(val);
        else if (key === 'Y Offset') yOffsetSp = parseDimension(val);
      } else if (state === 'postscriptum') {
        if (key === 'Magnification') postMag = parseFloat(val) || 0;
        else if (key === 'X Offset') postX = parseDimension(val);
        else if (key === 'Y Offset') postY = parseDimension(val);
      }
      continue;
    }

    const t = line.charCodeAt(0);
    switch (t) {
      case 123: /* { */ {
        page = parseInt(line.slice(1), 10) || pageNumbers.length + 1;
        pageBoxes = [];
        pageRecs = [];
        open.length = 0;
        formDepth = 0;
        break;
      }
      case 125: /* } */ {
        if (page) {
          rawBoxes.push(pageBoxes);
          rawRecs.push(pageRecs);
          pageNumbers.push(page);
        }
        page = 0;
        open.length = 0;
        break;
      }
      case 60: /* < form begin */
        formDepth++;
        break;
      case 62: /* > form end */
        if (formDepth > 0) formDepth--;
        break;
      case 91: /* [ */
      case 40: /* ( */
      case 118: /* v */
      case 104: /* h */
      case 114: /* r */ {
        if (!page || formDepth) {
          if (t === 91 || t === 40) open.push(-1);
          break;
        }
        const f = parseRecord(line);
        if (!f || f.length < 7) {
          if (t === 91 || t === 40) open.push(-1);
          break;
        }
        const kind: SyncTexNodeKind = t === 91 ? 'vbox' : t === 40 ? 'hbox' : t === 118 ? 'void-vbox' : t === 104 ? 'void-hbox' : 'rule';
        const parent = enclosing(open);
        pageBoxes.push({ page, kind, tag: f[0], line: f[1], h: f[2], v: f[3], W: f[4], H: f[5], D: f[6], parent });
        if (t === 91 || t === 40) open.push(pageBoxes.length - 1);
        break;
      }
      case 93: /* ] */
      case 41: /* ) */
        open.pop();
        break;
      case 107: /* k */
      case 103: /* g */
      case 36: /* $ */
      case 120: /* x */ {
        if (!page || formDepth) break;
        const f = parseRecord(line);
        if (!f || f.length < 4) break;
        const kind: SyncTexRecord['kind'] = t === 107 ? 'kern' : t === 103 ? 'glue' : t === 36 ? 'math' : 'current';
        pageRecs.push({ page, kind, tag: f[0], line: f[1], h: f[2], v: f[3], W: t === 107 && f.length > 4 ? f[4] : 0, parent: enclosing(open) });
        break;
      }
      default:
        if (line.startsWith('Postamble')) state = 'postamble';
        break;
    }
  }
  if (page && pageBoxes.length) {
    rawBoxes.push(pageBoxes);
    rawRecs.push(pageRecs);
    pageNumbers.push(page);
  }

  // Unit conversion (mirrors synctex_parser.c).
  let factor = unit / SP_PER_BP;
  if (postMag > 0) factor *= postMag;
  factor *= magnification / 1000;
  const xOffset = (postX ?? xOffsetSp) / SP_PER_BP;
  const yOffset = (postY ?? yOffsetSp) / SP_PER_BP;

  for (let p = 0; p < pageNumbers.length; p++) {
    const pg = pageNumbers[p];
    const boxes: SyncTexBox[] = rawBoxes[p].map((b) => {
      let x = b.h * factor + xOffset;
      let w = b.W * factor;
      if (w < 0) {
        x += w;
        w = -w;
      }
      const baseline = b.v * factor + yOffset;
      const H = b.H * factor;
      const D = b.D * factor;
      return {
        page: pg,
        x,
        y: baseline - H,
        width: w,
        height: Math.max(0, H + D),
        file: inputs.get(b.tag) ?? '',
        line: b.line,
        kind: b.kind,
        baseline,
        parent: b.parent,
        tag: b.tag,
      };
    });
    const recs: SyncTexRecord[] = rawRecs[p].map((r) => ({
      kind: r.kind,
      x: r.h * factor + xOffset,
      y: r.v * factor + yOffset,
      width: r.W * factor,
      tag: r.tag,
      line: r.line,
      parent: r.parent,
    }));
    const prevBoxes = pages.get(pg);
    if (prevBoxes) {
      // Same page number shipped twice (rare): append, re-basing parent indices.
      const base = prevBoxes.length;
      for (const b of boxes) if (b.parent !== undefined && b.parent >= 0) b.parent += base;
      for (const r of recs) if (r.parent >= 0) r.parent += base;
      prevBoxes.push(...boxes);
      records.get(pg)!.push(...recs);
    } else {
      pages.set(pg, boxes);
      records.set(pg, recs);
    }
  }
  // Boxes parsed before a late `Input:` line: fill in file names.
  for (const boxes of pages.values()) for (const b of boxes) if (!b.file && b.tag !== undefined) b.file = inputs.get(b.tag) ?? '';

  return { inputs, pages, magnification, unit, xOffset, yOffset, records };
}

function enclosing(open: number[]): number {
  for (let i = open.length - 1; i >= 0; i--) if (open[i] >= 0) return open[i];
  return -1;
}

/** Parse `X<tag>,<line>(,<col>)?:<a>,<b>(:<c>,<d>,<e>)?` → [tag, line, a, b, c, d, e]. */
function parseRecord(line: string): number[] | null {
  const out: number[] = [];
  let i = 1;
  const n = line.length;
  let field = 0;
  while (i < n) {
    let neg = false;
    if (line.charCodeAt(i) === 45) {
      neg = true;
      i++;
    }
    let v = 0;
    const start = i;
    while (i < n) {
      const c = line.charCodeAt(i);
      if (c < 48 || c > 57) break;
      v = v * 10 + (c - 48);
      i++;
    }
    if (i === start) return out.length >= 4 ? out : null;
    out.push(neg ? -v : v);
    field++;
    const sep = line.charCodeAt(i);
    // An optional column after the line ("tag,line,col:") is dropped.
    if (field === 2 && sep === 44 /* , */) {
      i++;
      while (i < n && line.charCodeAt(i) !== 58) i++;
      if (i >= n) return null;
      i++;
      continue;
    }
    if (sep === 44 || sep === 58) i++;
    else break;
  }
  return out.length >= 4 ? out : null;
}

// ───────────────────────────── search ─────────────────────────────

function fileMatches(recorded: string, file: string): boolean {
  const r = normalizePath(recorded.replace(/\\/g, '/'));
  const f = normalizePath(file);
  if (!r || !f) return false;
  if (r === f || r.endsWith('/' + f)) return true;
  // Recorded without extension (`\input{chapters/one}` under Tectonic).
  const fNoExt = f.replace(/\.tex$/i, '');
  return fNoExt !== f && (r === fNoExt || r.endsWith('/' + fNoExt));
}

/** Tags whose input path matches `file` (longest suffix wins; ties keep all). */
function tagsFor(data: SyncTexData, file: string): Set<number> {
  const tags = new Set<number>();
  for (const [tag, path] of data.inputs) if (fileMatches(path, file)) tags.add(tag);
  if (!tags.size) {
    // Fall back to a basename match.
    const base = normalizePath(file).split('/').pop()!;
    for (const [tag, path] of data.inputs) {
      const b = normalizePath(path.replace(/\\/g, '/')).split('/').pop()!;
      if (b === base || b === base.replace(/\.tex$/i, '')) tags.add(tag);
    }
  }
  return tags;
}

/** Source → PDF. `file` is project-relative; matched against inputs by longest suffix. */
export function syncTexForward(data: SyncTexData, file: string, line: number): SyncTexBox[] {
  const tags = tagsFor(data, file);
  if (!tags.size) return [];
  const records = data.records ?? new Map<number, SyncTexRecord[]>();

  // Lines present per tag (from hboxes and records) for the nearest-line fallback.
  const present = new Set<number>();
  for (const [pg, boxes] of data.pages) {
    for (const b of boxes) if (b.tag !== undefined && tags.has(b.tag) && (b.kind === 'hbox' || b.kind === 'void-hbox' || b.kind === 'rule')) present.add(b.line);
    for (const r of records.get(pg) ?? []) if (tags.has(r.tag)) present.add(r.line);
  }

  const collect = (target: number, allowVbox: boolean): SyncTexBox[] => {
    const out: SyncTexBox[] = [];
    for (const [pg, boxes] of data.pages) {
      const picked = new Set<number>();
      boxes.forEach((b, i) => {
        if (b.tag === undefined || !tags.has(b.tag) || b.line !== target) return;
        if (b.kind === 'hbox' || b.kind === 'void-hbox' || b.kind === 'rule' || (allowVbox && (b.kind === 'vbox' || b.kind === 'void-vbox'))) picked.add(i);
      });
      for (const r of records.get(pg) ?? []) {
        if (!tags.has(r.tag) || r.line !== target || r.parent < 0) continue;
        const parent = boxes[r.parent];
        if (parent && parent.kind === 'hbox') picked.add(r.parent);
      }
      // Nested matches (an \mbox inside a matching text line): keep the outermost hbox = the visual line.
      for (const i of Array.from(picked)) {
        let p = boxes[i].parent ?? -1;
        while (p >= 0) {
          if (picked.has(p) && boxes[p].kind === 'hbox') {
            picked.delete(i);
            break;
          }
          p = boxes[p].parent ?? -1;
        }
      }
      for (const i of picked) {
        const b = boxes[i];
        if (b.width <= 0 && b.height <= 0) continue;
        out.push(b);
      }
    }
    return out;
  };

  let result = present.has(line) ? collect(line, false) : [];
  if (!result.length && present.size) {
    // Nearest line with content; ties prefer the following line.
    let best = -1;
    let bestDist = Infinity;
    for (const l of present) {
      const d = Math.abs(l - line);
      if (d < bestDist || (d === bestDist && l > best)) {
        best = l;
        bestDist = d;
      }
    }
    if (best >= 0) result = collect(best, false);
  }
  if (!result.length) result = collect(line, true);
  result.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  return result;
}

/** PDF → source. Returns the recorded file path (map with resolveProjectPath) and line. */
export function syncTexInverse(data: SyncTexData, page: number, x: number, y: number): { file: string; line: number } | null {
  const boxes = data.pages.get(page);
  if (!boxes || !boxes.length) return null;
  const recs = data.records?.get(page) ?? [];
  const fileOf = (tag: number | undefined, fallback: string) => (tag !== undefined ? data.inputs.get(tag) ?? fallback : fallback);
  const tol = 0.5;

  // Smallest enclosing hbox.
  let hit = -1;
  let hitArea = Infinity;
  boxes.forEach((b, i) => {
    if (b.kind !== 'hbox' && b.kind !== 'void-hbox') return;
    if (x < b.x - tol || x > b.x + b.width + tol || y < b.y - tol || y > b.y + b.height + tol) return;
    const area = b.width * b.height;
    if (area < hitArea) {
      hit = i;
      hitArea = area;
    }
  });

  if (hit >= 0) {
    const box = boxes[hit];
    // Refine with the closest child node: prefer the last one starting left of the point.
    let best: { tag: number; line: number } | null = null;
    let bestLeft = -Infinity;
    let bestRight = Infinity;
    let right: { tag: number; line: number } | null = null;
    const consider = (nx: number, tag: number, line: number) => {
      if (nx <= x + tol) {
        if (nx > bestLeft) {
          bestLeft = nx;
          best = { tag, line };
        }
      } else if (nx < bestRight) {
        bestRight = nx;
        right = { tag, line };
      }
    };
    for (const r of recs) if (r.parent === hit) consider(r.x, r.tag, r.line);
    boxes.forEach((b, i) => {
      if (b.parent === hit && i !== hit) consider(b.x, b.tag ?? -1, b.line);
    });
    const chosen = (best ?? right) as { tag: number; line: number } | null;
    if (chosen && chosen.tag >= 0) return { file: fileOf(chosen.tag, box.file), line: chosen.line };
    return { file: box.file, line: box.line };
  }

  // Nearest node on the page.
  let bestD = Infinity;
  let res: { file: string; line: number } | null = null;
  for (const b of boxes) {
    if (b.kind === 'vbox' || b.kind === 'void-vbox') continue;
    const dx = x < b.x ? b.x - x : x > b.x + b.width ? x - b.x - b.width : 0;
    const dy = y < b.y ? b.y - y : y > b.y + b.height ? y - b.y - b.height : 0;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      res = { file: b.file, line: b.line };
    }
  }
  for (const r of recs) {
    const dx = r.x - x;
    const dy = r.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      res = { file: fileOf(r.tag, ''), line: r.line };
    }
  }
  if (!res) {
    // Only vboxes on the page.
    for (const b of boxes) {
      const dx = x < b.x ? b.x - x : x > b.x + b.width ? x - b.x - b.width : 0;
      const dy = y < b.y ? b.y - y : y > b.y + b.height ? y - b.y - b.height : 0;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        res = { file: b.file, line: b.line };
      }
    }
  }
  return res;
}
