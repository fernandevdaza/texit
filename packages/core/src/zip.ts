/**
 * Zip import/export for projects (Overleaf-compatible zips).
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { ProjectFile } from './types';
import { basename, extname, isTextPath, normalizePath } from './paths';
import { detectMainPath } from './project';

export interface ZipImportResult {
  files: ProjectFile[];
  /** Suggested project name (zip name or common root folder). */
  suggestedName?: string;
  /** Detected main file path, if any. */
  mainPath?: string;
}

const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized', 'icon\r']);
const IGNORED_DIRS = new Set(['__macosx', '.git', '.svn', '.hg', '.idea', '.vscode', 'node_modules', '.texpadtmp', '.trash']);
/** Build artefacts (by extension, lower-case). `.bbl` is kept on purpose (arXiv needs it). */
const IGNORED_EXTENSIONS = new Set([
  'aux', 'log', 'fdb_latexmk', 'fls', 'out', 'toc', 'lof', 'lot', 'lol', 'loa', 'blg', 'bcf', 'nav', 'snm', 'vrb',
  'xdv', 'dvi', 'synctex', 'ilg', 'glg', 'glo', 'acn', 'acr', 'alg', 'thm', 'brf', 'auxlock', 'run.xml', 'ptc',
  'mtc', 'maf', 'idv', 'lg', 'tmp', 'xref', '4ct', '4tc', 'pyg', 'upa', 'upb', 'figlist', 'bak', 'swp',
]);

function isIgnored(path: string): boolean {
  const lower = path.toLowerCase();
  const segs = lower.split('/');
  for (let i = 0; i < segs.length - 1; i++) {
    if (IGNORED_DIRS.has(segs[i]) || segs[i].startsWith('_minted')) return true;
  }
  const name = segs[segs.length - 1];
  if (IGNORED_NAMES.has(name) || name.startsWith('._')) return true;
  if (/\.synctex(?:\.gz)?(?:\(busy\))?$/.test(name) || name.endsWith('.run.xml') || name.endsWith('.synctex.gz')) return true;
  if (/\.(?:gz|zip)\(busy\)$/.test(name) || name.endsWith('~')) return true;
  return IGNORED_EXTENSIONS.has(extname(name));
}

let utf8Fatal: TextDecoder | null = null;
let latin1: TextDecoder | null | undefined;

/** Decode bytes as UTF-8 (BOM stripped); fall back to Windows-1252/Latin-1 when not valid UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  utf8Fatal ??= new TextDecoder('utf-8', { fatal: true });
  try {
    return utf8Fatal.decode(bytes);
  } catch {
    if (latin1 === undefined) {
      try {
        latin1 = new TextDecoder('windows-1252');
      } catch {
        latin1 = null;
      }
    }
    if (latin1) return latin1.decode(bytes);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return s;
  }
}

/**
 * Unzip → project files. Strips a single common top-level folder, ignores
 * __MACOSX/, .DS_Store, Thumbs.db, .git/, build artefacts (*.aux, *.log, *.synctex.gz, *.fdb_latexmk, *.fls…),
 * decodes text files as UTF-8 (falls back to latin1).
 */
export function importZip(data: Uint8Array, zipName?: string): ZipImportResult {
  const entries = unzipSync(data, {
    filter: (f) => {
      if (f.name.endsWith('/')) return false;
      const p = normalizePath(f.name);
      return !!p && !isIgnored(p);
    },
  });

  let raw: { path: string; bytes: Uint8Array }[] = [];
  const seen = new Set<string>();
  for (const [name, bytes] of Object.entries(entries)) {
    const path = normalizePath(name);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    raw.push({ path, bytes });
  }

  // Strip common root folder(s): `project/…` or `repo-main/project/…`.
  let rootName: string | undefined;
  while (raw.length) {
    const first = raw[0].path.split('/')[0];
    if (!raw.every((f) => f.path.startsWith(first + '/'))) break;
    rootName ??= first;
    raw = raw.map((f) => ({ path: f.path.slice(first.length + 1), bytes: f.bytes }));
  }

  const files: ProjectFile[] = raw
    .map((f) => ({ path: f.path, content: isTextPath(f.path) ? decodeText(f.bytes) : f.bytes }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

  const result: ZipImportResult = { files };
  const zipStem = zipName ? basename(zipName).replace(/\.zip$/i, '').trim() : '';
  const suggestedName = rootName || zipStem;
  if (suggestedName) result.suggestedName = suggestedName;
  const mainPath = detectMainPath(files);
  if (mainPath) result.mainPath = mainPath;
  return result;
}

/** Already-compressed formats are stored instead of deflated (faster, same size). */
const STORED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'mp4', 'mp3', 'woff', 'woff2', 'docx', 'xlsx', 'pptx']);

export function exportZip(files: ProjectFile[], opts?: { rootFolder?: string }): Uint8Array {
  const root = opts?.rootFolder ? normalizePath(opts.rootFolder).replace(/[\\/:*?"<>|]/g, '_') : '';
  const encoder = new TextEncoder();
  const tree: Zippable = {};
  for (const f of files) {
    const path = normalizePath(f.path);
    if (!path) continue;
    const full = root ? `${root}/${path}` : path;
    const bytes = typeof f.content === 'string' ? encoder.encode(f.content) : f.content;
    const level = STORED_EXTENSIONS.has(extname(path)) ? 0 : 6;
    tree[full] = [bytes, { level }];
  }
  return zipSync(tree);
}
