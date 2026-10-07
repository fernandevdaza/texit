/**
 * File-system services behind `host.fs` (Electron-free except for trash).
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HostFileEntry, HostWatchEvent } from '@texit/core';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { isIgnoredDir, isIgnoredPath } from './ignore';

export const MAX_TREE_FILES = 20_000;
export const MAX_TREE_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
/** Watch events carry the file content up to this size ("text-sized" files). */
export const WATCH_CONTENT_LIMIT = 4 * 1024 * 1024;

const toPosix = (p: string) => p.split(path.sep).join('/');

export async function readTree(dir: string): Promise<HostFileEntry[]> {
  const root = path.resolve(dir);
  const st = await fs.stat(root);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${dir}`);
  const out: HostFileEntry[] = [];
  let total = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (isIgnoredDir(e.name)) continue;
        await walk(childAbs, childRel);
        continue;
      }
      if (e.isSymbolicLink()) {
        // Follow links to files only (avoids cycles through linked directories).
        const target = await fs.stat(childAbs).catch(() => null);
        if (!target?.isFile()) continue;
      } else if (!e.isFile()) continue;
      if (isIgnoredPath(childRel)) continue;
      const fst = await fs.stat(childAbs);
      if (fst.size > MAX_FILE_BYTES) continue;
      total += fst.size;
      if (out.length >= MAX_TREE_FILES || total > MAX_TREE_BYTES) {
        throw new Error(`Folder is too large to open as a project (limit ${MAX_TREE_FILES} files / ${MAX_TREE_BYTES / 1024 / 1024} MB).`);
      }
      out.push({ path: childRel, content: new Uint8Array(await fs.readFile(childAbs)), mtimeMs: fst.mtimeMs });
    }
  };
  await walk(root, '');
  return out;
}

export async function readFileBytes(absPath: string): Promise<Uint8Array> {
  const st = await fs.stat(absPath);
  if (!st.isFile()) throw new Error(`Not a file: ${absPath}`);
  if (st.size > MAX_FILE_BYTES) throw new Error(`File too large: ${absPath}`);
  return new Uint8Array(await fs.readFile(absPath));
}

/** Atomic write (temp file + rename) so watchers and editors never observe partial content. */
export async function writeFileAtomic(absPath: string, content: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = path.join(path.dirname(absPath), `.${path.basename(absPath)}.${randomBytes(4).toString('hex')}.texit-tmp`);
  try {
    await fs.writeFile(tmp, content);
    try {
      // Keep the original permissions.
      const st = await fs.stat(absPath);
      await fs.chmod(tmp, st.mode);
    } catch {
      /* new file */
    }
    await fs.rename(tmp, absPath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    // Some filesystems (network shares, Windows with open handles) reject rename-over: fall back to a direct write.
    if ((err as NodeJS.ErrnoException).code === 'EPERM' || (err as NodeJS.ErrnoException).code === 'EXDEV' || (err as NodeJS.ErrnoException).code === 'EBUSY') {
      await fs.writeFile(absPath, content);
      return;
    }
    throw err;
  }
}

export async function renamePath(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

// ───────────────────────────── watching ─────────────────────────────

export interface WatchHandle {
  close(): Promise<void>;
}

/**
 * Collapse a batch so each path appears once with its latest state
 * (add+change → add, add+unlink → dropped, unlink+add → change).
 */
export function collapseEvents(events: HostWatchEvent[]): HostWatchEvent[] {
  const byPath = new Map<string, HostWatchEvent>();
  for (const e of events) {
    const prev = byPath.get(e.path);
    if (!prev) {
      byPath.set(e.path, e);
      continue;
    }
    if (prev.type === 'add' && e.type === 'change') byPath.set(e.path, { ...e, type: 'add' });
    else if (prev.type === 'add' && e.type === 'unlink') byPath.delete(e.path);
    else if (prev.type === 'addDir' && e.type === 'unlinkDir') byPath.delete(e.path);
    else if (prev.type === 'unlink' && (e.type === 'add' || e.type === 'change')) byPath.set(e.path, { ...e, type: 'change' });
    else {
      byPath.delete(e.path); // keep insertion order = latest
      byPath.set(e.path, e);
    }
  }
  return Array.from(byPath.values());
}

export function watchDir(dir: string, onBatch: (events: HostWatchEvent[]) => void, opts: { debounceMs?: number } = {}): WatchHandle {
  const root = path.resolve(dir);
  const debounceMs = opts.debounceMs ?? 120;
  let queue: { type: HostWatchEvent['type']; rel: string }[] = [];
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const flush = async () => {
    timer = null;
    const batch = queue;
    queue = [];
    const collapsed = collapseEvents(batch.map((q) => ({ type: q.type, path: q.rel })));
    const events: HostWatchEvent[] = [];
    for (const e of collapsed) {
      if (e.type === 'add' || e.type === 'change') {
        const abs = path.join(root, ...e.path.split('/'));
        try {
          const st = await fs.stat(abs);
          if (!st.isFile()) continue;
          if (st.size <= WATCH_CONTENT_LIMIT) e.content = new Uint8Array(await fs.readFile(abs));
        } catch {
          continue; // vanished in the meantime: the unlink event will follow
        }
      }
      events.push(e);
    }
    if (events.length && !closed) onBatch(events);
  };

  const push = (type: HostWatchEvent['type'], abs: string) => {
    const rel = toPosix(path.relative(root, abs));
    if (!rel || rel.startsWith('..')) return;
    if (type === 'addDir' || type === 'unlinkDir' ? rel.split('/').some(isIgnoredDir) : isIgnoredPath(rel)) return;
    if (/\.texit-tmp$/.test(rel)) return;
    queue.push({ type, rel });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
  };

  const watcher: FSWatcher = chokidarWatch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (p: string) => {
      const rel = toPosix(path.relative(root, p));
      if (!rel || rel.startsWith('..')) return false;
      return rel.split('/').some(isIgnoredDir);
    },
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    atomic: true,
  });
  watcher.on('add', (p) => push('add', p));
  watcher.on('change', (p) => push('change', p));
  watcher.on('unlink', (p) => push('unlink', p));
  watcher.on('addDir', (p) => push('addDir', p));
  watcher.on('unlinkDir', (p) => push('unlinkDir', p));
  watcher.on('error', () => undefined);

  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}
