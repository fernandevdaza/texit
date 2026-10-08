/**
 * SyncTeX glue between the compile output, the editor and the PDF viewer.
 *
 * Data source: `compile.synctex` (parsed by the compile feature) or, as a
 * fallback, the raw `compile.result.synctex` bytes captured when the PDF
 * changed — parsed lazily here and memoized per `pdfVersion`.
 */
import { parseSyncTex, resolveProjectPath, syncTexForward, syncTexInverse, isTexPath, type SyncTexData } from '@texit/core';
import { t } from '@/lib/i18n';
import { toast } from '@/ui';
import './i18n';
import { useWorkspace } from '@/state/workspace';
import type { PdfPoint, PdfRect } from './engine';

let raw: { version: number; bytes: Uint8Array | null } = { version: -1, bytes: null };
let parsed: { version: number; data: SyncTexData | null } = { version: -1, data: null };
let warnedUnavailable = false;

/** Track the raw SyncTeX bytes belonging to each PDF version. Call once. */
export function trackSyncTex(): () => void {
  return useWorkspace.subscribe((s, prev) => {
    if (s.compile.pdfVersion !== prev.compile.pdfVersion) {
      const r = s.compile.result;
      raw = { version: s.compile.pdfVersion, bytes: r && r.status === 'success' && r.synctex ? r.synctex : null };
    }
  });
}

export function getSyncTex(): SyncTexData | null {
  const c = useWorkspace.getState().compile;
  if (c.synctex) return c.synctex;
  if (parsed.version === c.pdfVersion) return parsed.data;
  let bytes = raw.version === c.pdfVersion ? raw.bytes : null;
  if (!bytes && c.result?.status === 'success' && c.result.synctex) bytes = c.result.synctex;
  let data: SyncTexData | null = null;
  if (bytes) {
    try {
      data = parseSyncTex(bytes);
    } catch (err) {
      console.warn('[pdf] SyncTeX parse failed', err);
    }
  }
  parsed = { version: c.pdfVersion, data };
  return data;
}

function unavailable(silent?: boolean) {
  if (silent || warnedUnavailable) return;
  warnedUnavailable = true;
  toast(t('pdf.synctexUnavailable'), { description: t('pdf.synctexUnavailableDesc') });
}

/** PDF → source. Opens the editor at the matching line. Returns true on success. */
export function inverseSearch(pt: PdfPoint): boolean {
  const data = getSyncTex();
  if (!data) {
    unavailable();
    return false;
  }
  let hit: { file: string; line: number } | null = null;
  try {
    hit = syncTexInverse(data, pt.page, pt.x, pt.y);
  } catch (err) {
    console.warn('[pdf] inverse SyncTeX failed', err);
    return false;
  }
  if (!hit) return false;
  const ws = useWorkspace.getState();
  const paths = ws.files.filter((f) => f.kind !== 'folder').map((f) => f.path);
  let path: string | undefined;
  try {
    path = resolveProjectPath(hit.file, paths);
  } catch {
    // Fallback until core's resolver lands: longest path suffix match.
    const norm = hit.file.replace(/\\/g, '/');
    path = paths.filter((p) => norm === p || norm.endsWith(`/${p}`)).sort((a, b) => b.length - a.length)[0];
  }
  if (!path) {
    toast(t('pdf.sourceNotFound'), { description: hit.file });
    return false;
  }
  ws.revealLocation(path, hit.line);
  return true;
}

/** Source → PDF boxes (PDF points, top-left origin). */
export function forwardBoxes(path: string, line: number, opts: { silent?: boolean } = {}): PdfRect[] {
  const data = getSyncTex();
  if (!data) {
    unavailable(opts.silent);
    return [];
  }
  try {
    return syncTexForward(data, path, line)
      .filter((b) => b.page >= 1)
      .map((b) => ({ page: b.page, x: b.x, y: b.y, width: b.width, height: b.height }));
  } catch (err) {
    if (!opts.silent) console.warn('[pdf] forward SyncTeX failed', err);
    return [];
  }
}

/** Project path of the active editor tab when it is a TeX file. */
export function activeTexPath(): string | null {
  const ws = useWorkspace.getState();
  const f = ws.files.find((x) => x.id === ws.activeFileId);
  return f && isTexPath(f.path) ? f.path : null;
}

/**
 * Merge raw SyncTeX boxes into tidy line highlights: drop degenerate boxes,
 * keep the boxes of the first page that has any, merge boxes sharing a line.
 */
export function tidyBoxes(boxes: PdfRect[]): PdfRect[] {
  const good = boxes.filter((b) => b.width > 0.5 && b.height > 0.5 && b.width < 2000 && b.height < 2000);
  if (!good.length) {
    const b = boxes[0];
    return b ? [{ ...b, x: Math.max(0, b.x - 2), width: Math.max(b.width, 60), height: Math.max(b.height, 10) }] : [];
  }
  const page = good[0].page;
  const onPage = good.filter((b) => b.page === page).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PdfRect[] = [];
  for (const b of onPage) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - b.y) < 2 && Math.abs(last.y + last.height - (b.y + b.height)) < 3) {
      const x0 = Math.min(last.x, b.x);
      const x1 = Math.max(last.x + last.width, b.x + b.width);
      last.x = x0;
      last.width = x1 - x0;
    } else lines.push({ ...b });
  }
  // A paragraph-sized vbox that contains the line boxes adds nothing.
  const kept = lines.filter((l, i) => !(l.height > 40 && lines.some((o, j) => j !== i && o.height <= 40 && o.y >= l.y && o.y + o.height <= l.y + l.height)));
  // Merge consecutive lines of a paragraph into one block (reads much calmer than a stack of outlines).
  const blocks: PdfRect[] = [];
  for (const l of kept) {
    const b = blocks[blocks.length - 1];
    if (b && l.y - (b.y + b.height) < 4 && l.y >= b.y) {
      const x0 = Math.min(b.x, l.x);
      const x1 = Math.max(b.x + b.width, l.x + l.width);
      b.height = Math.max(b.y + b.height, l.y + l.height) - b.y;
      b.x = x0;
      b.width = x1 - x0;
    } else blocks.push({ ...l });
  }
  return blocks.slice(0, 40);
}

let pendingForward: { path: string; line: number; at: number } | null = null;

/** Remember a forward search that arrived while no viewer was ready (e.g. pane closed). */
export function setPendingForward(path: string, line: number) {
  pendingForward = { path, line, at: Date.now() };
}

export function consumePendingForward(): { path: string; line: number } | null {
  const p = pendingForward;
  pendingForward = null;
  return p && Date.now() - p.at < 15_000 ? p : null;
}
