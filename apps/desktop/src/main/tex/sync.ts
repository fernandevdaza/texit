/**
 * Synchronises a project snapshot into a persistent build directory.
 *
 * Only files whose content changed are rewritten (so mtimes stay stable and
 * latexmk can skip work), source files removed from the project are deleted,
 * and everything else (aux, toc, bbl, fdb_latexmk…) is kept between builds for
 * fast incremental compiles.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MANIFEST_NAME = '.texit-sources.json';

interface Manifest {
  version: 1;
  files: Record<string, string>; // relative path → sha1
}

/** Normalise a project-relative path and make sure it cannot escape `root`. Returns null when unsafe. */
export function safeRelative(p: string): string | null {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;
    if (/^[a-zA-Z]:$/.test(seg) && parts.length === 0) return null; // drive letters
    parts.push(seg);
  }
  if (!parts.length) return null;
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return null;
  return parts.join('/');
}

export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, ...rel.split('/'));
  const relCheck = path.relative(root, abs);
  if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new Error(`Path escapes build directory: ${rel}`);
  return abs;
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

async function readManifest(buildDir: string): Promise<Manifest> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(buildDir, MANIFEST_NAME), 'utf8'));
    if (raw && raw.version === 1 && raw.files && typeof raw.files === 'object') return raw as Manifest;
  } catch {
    /* first build */
  }
  return { version: 1, files: {} };
}

export interface SyncStats {
  written: number;
  unchanged: number;
  deleted: number;
}

export async function syncBuildDir(buildDir: string, files: { path: string; content: string | Uint8Array }[]): Promise<SyncStats> {
  await fs.mkdir(buildDir, { recursive: true });
  const prev = await readManifest(buildDir);
  const next: Manifest = { version: 1, files: {} };
  const stats: SyncStats = { written: 0, unchanged: 0, deleted: 0 };

  for (const f of files) {
    const rel = safeRelative(f.path);
    if (!rel || rel === MANIFEST_NAME) continue;
    const bytes = toBytes(f.content);
    const hash = sha1(bytes);
    next.files[rel] = hash;
    const abs = resolveInside(buildDir, rel);
    if (prev.files[rel] === hash) {
      try {
        const st = await fs.stat(abs);
        if (st.isFile() && st.size === bytes.byteLength) {
          stats.unchanged++;
          continue;
        }
      } catch {
        /* missing → rewrite */
      }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, bytes);
    stats.written++;
  }

  for (const rel of Object.keys(prev.files)) {
    if (rel in next.files) continue;
    const safe = safeRelative(rel);
    if (!safe) continue;
    try {
      await fs.rm(resolveInside(buildDir, safe), { force: true });
      stats.deleted++;
      await pruneEmptyDirs(buildDir, path.dirname(resolveInside(buildDir, safe)));
    } catch {
      /* ignore */
    }
  }

  await fs.writeFile(path.join(buildDir, MANIFEST_NAME), JSON.stringify(next));
  return stats;
}

async function pruneEmptyDirs(root: string, dir: string): Promise<void> {
  let cur = dir;
  while (cur.startsWith(root) && cur !== root) {
    try {
      const entries = await fs.readdir(cur);
      if (entries.length) return;
      await fs.rmdir(cur);
    } catch {
      return;
    }
    cur = path.dirname(cur);
  }
}
