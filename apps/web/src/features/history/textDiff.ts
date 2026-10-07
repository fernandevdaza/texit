/** Diff helpers for version history: change stats and minimal Y.Text updates. */
import { diffLines } from 'diff';
import type * as Y from 'yjs';
import type { ProjectFile } from '@texit/core';

/**
 * Make `yt` equal `next` with a line-level diff, refining each replaced hunk to
 * its changed characters. Untouched regions keep their Yjs identity, so
 * concurrent edits by collaborators elsewhere in the file merge cleanly.
 */
export function applyMinimalTextDiff(yt: Y.Text, next: string): void {
  const prev = yt.toString();
  if (prev === next) return;
  const parts = diffLines(prev, next);
  const apply = () => {
    let pos = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.removed) {
        const n = parts[i + 1];
        if (n?.added) {
          replaceRange(yt, pos, p.value, n.value);
          pos += n.value.length;
          i++;
        } else yt.delete(pos, p.value.length);
      } else if (p.added) {
        yt.insert(pos, p.value);
        pos += p.value.length;
      } else pos += p.value.length;
    }
  };
  if (yt.doc) yt.doc.transact(apply, 'history-restore');
  else apply();
}

function replaceRange(yt: Y.Text, at: number, oldText: string, newText: string) {
  let start = 0;
  const min = Math.min(oldText.length, newText.length);
  while (start < min && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  if (endOld > start) yt.delete(at + start, endOld - start);
  if (endNew > start) yt.insert(at + start, newText.slice(start, endNew));
}

export function lineStats(a: string, b: string): { added: number; removed: number } {
  if (a === b) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const p of diffLines(a, b)) {
    if (p.added) added += p.count ?? 0;
    else if (p.removed) removed += p.count ?? 0;
  }
  return { added, removed };
}

export type FileChangeKind = 'added' | 'deleted' | 'modified' | 'unchanged';

export interface FileChange {
  path: string;
  kind: FileChangeKind;
  binary: boolean;
  before: string | Uint8Array | null;
  after: string | Uint8Array | null;
  added: number;
  removed: number;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function contentEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a !== 'string' && typeof b !== 'string') return bytesEqual(a, b);
  return false;
}

const lineCount = (s: string) => (s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0);

/** Compare two file sets (`before` → `after`). */
export function compareFiles(before: ProjectFile[], after: ProjectFile[], opts: { includeUnchanged?: boolean } = {}): FileChange[] {
  const a = new Map(before.map((f) => [f.path, f.content]));
  const b = new Map(after.map((f) => [f.path, f.content]));
  const paths = Array.from(new Set([...a.keys(), ...b.keys()])).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const out: FileChange[] = [];
  for (const path of paths) {
    const x = a.get(path) ?? null;
    const y = b.get(path) ?? null;
    const binary = (x != null && typeof x !== 'string') || (y != null && typeof y !== 'string');
    if (x == null && y != null) {
      out.push({ path, kind: 'added', binary, before: null, after: y, added: typeof y === 'string' ? lineCount(y) : 0, removed: 0 });
    } else if (y == null && x != null) {
      out.push({ path, kind: 'deleted', binary, before: x, after: null, added: 0, removed: typeof x === 'string' ? lineCount(x) : 0 });
    } else if (x != null && y != null) {
      if (contentEqual(x, y)) {
        if (opts.includeUnchanged) out.push({ path, kind: 'unchanged', binary, before: x, after: y, added: 0, removed: 0 });
      } else {
        const s = typeof x === 'string' && typeof y === 'string' ? lineStats(x, y) : { added: 0, removed: 0 };
        out.push({ path, kind: 'modified', binary, before: x, after: y, ...s });
      }
    }
  }
  return out;
}

export interface ChangeSummary {
  files: number;
  added: number;
  removed: number;
  addedFiles: number;
  deletedFiles: number;
}

export function summarize(changes: FileChange[]): ChangeSummary {
  return changes.reduce<ChangeSummary>(
    (s, c) => {
      if (c.kind === 'unchanged') return s;
      s.files++;
      s.added += c.added;
      s.removed += c.removed;
      if (c.kind === 'added') s.addedFiles++;
      if (c.kind === 'deleted') s.deletedFiles++;
      return s;
    },
    { files: 0, added: 0, removed: 0, addedFiles: 0, deletedFiles: 0 },
  );
}
