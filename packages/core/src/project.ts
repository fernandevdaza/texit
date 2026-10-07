import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import type { FileNode, NodeKind, ProjectFile, ProjectMeta } from './types';
import { basename, dirname, isTextPath, isTexPath, joinPath, normalizePath } from './paths';

export const ROOT_ID = '';

/**
 * Y.Doc layout (the single source of truth of a project — persisted locally
 * with y-indexeddb and synced peer-to-peer for collaboration):
 *
 *   meta   : Y.Map<string, any>              → ProjectMeta fields
 *   nodes  : Y.Map<id, Y.Map<string, any>>   → { id, name, parentId, kind, createdAt, updatedAt }
 *   texts  : Y.Map<id, Y.Text>               → contents of text files
 *   blobs  : Y.Map<id, Uint8Array>           → contents of binary files
 *   comments: Y.Map<id, Y.Map>               → review comments (anchored with Y.RelativePosition)
 */
export class ProjectDoc {
  readonly doc: Y.Doc;
  readonly meta: Y.Map<any>;
  readonly nodes: Y.Map<Y.Map<any>>;
  readonly texts: Y.Map<Y.Text>;
  readonly blobs: Y.Map<Uint8Array>;
  readonly comments: Y.Map<Y.Map<any>>;

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.meta = doc.getMap('meta');
    this.nodes = doc.getMap('nodes');
    this.texts = doc.getMap('texts');
    this.blobs = doc.getMap('blobs');
    this.comments = doc.getMap('comments');
  }

  /** Initialise metadata for a brand-new project (no-op for fields already set). */
  init(meta: Partial<ProjectMeta> & { id: string; name: string }): void {
    this.doc.transact(() => {
      const now = Date.now();
      const defaults: ProjectMeta = {
        id: meta.id,
        name: meta.name,
        mainFileId: '',
        engine: 'pdflatex',
        bibTool: 'auto',
        compilerBackend: '',
        createdAt: now,
        updatedAt: now,
        tags: [],
        language: 'en-US',
      };
      for (const [k, v] of Object.entries({ ...defaults, ...meta })) {
        if (!this.meta.has(k)) this.meta.set(k, v);
      }
    });
  }

  // ───────────────────────────── meta ─────────────────────────────

  getMeta(): ProjectMeta {
    return this.meta.toJSON() as ProjectMeta;
  }

  setMeta(patch: Partial<ProjectMeta>): void {
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) this.meta.set(k, v);
      this.meta.set('updatedAt', Date.now());
    });
  }

  // ───────────────────────────── tree ─────────────────────────────

  private nodeToFile(id: string, m: Y.Map<any>): FileNode {
    const kind = m.get('kind') as NodeKind;
    const text = this.texts.get(id);
    const blob = this.blobs.get(id);
    return {
      id,
      name: m.get('name'),
      parentId: m.get('parentId') ?? ROOT_ID,
      kind,
      path: this.getPath(id),
      isText: kind === 'file' && !!text,
      createdAt: m.get('createdAt') ?? 0,
      updatedAt: m.get('updatedAt') ?? 0,
      size: text ? text.length : blob ? blob.byteLength : 0,
    };
  }

  /** All nodes (files and folders), sorted folders-first then by path. */
  list(): FileNode[] {
    const out: FileNode[] = [];
    this.nodes.forEach((m, id) => {
      if (this.isOrphan(id)) return;
      out.push(this.nodeToFile(id, m));
    });
    return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  listFiles(): FileNode[] {
    return this.list().filter((n) => n.kind === 'file');
  }

  children(parentId: string): FileNode[] {
    const out: FileNode[] = [];
    this.nodes.forEach((m, id) => {
      if ((m.get('parentId') ?? ROOT_ID) === parentId) out.push(this.nodeToFile(id, m));
    });
    return out.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }

  getNode(id: string): FileNode | null {
    const m = this.nodes.get(id);
    return m ? this.nodeToFile(id, m) : null;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /** A node is orphaned if any ancestor no longer exists (e.g. concurrent delete of a parent). */
  private isOrphan(id: string): boolean {
    let cur = this.nodes.get(id);
    let guard = 0;
    while (cur) {
      const parent = cur.get('parentId') ?? ROOT_ID;
      if (parent === ROOT_ID) return false;
      cur = this.nodes.get(parent);
      if (++guard > 256) return true; // cycle protection (concurrent moves)
    }
    return true;
  }

  getPath(id: string): string {
    const segs: string[] = [];
    let cur = this.nodes.get(id);
    let guard = 0;
    while (cur && guard++ < 256) {
      segs.unshift(cur.get('name'));
      const parent = cur.get('parentId') ?? ROOT_ID;
      if (parent === ROOT_ID) break;
      cur = this.nodes.get(parent);
    }
    return segs.join('/');
  }

  /** Find a node id by project-relative path (case-sensitive). */
  findByPath(path: string): string | null {
    const target = normalizePath(path);
    if (!target) return ROOT_ID;
    let parent = ROOT_ID;
    for (const seg of target.split('/')) {
      let found: string | null = null;
      this.nodes.forEach((m, id) => {
        if (found === null && (m.get('parentId') ?? ROOT_ID) === parent && m.get('name') === seg) found = id;
      });
      if (found === null) return null;
      parent = found;
    }
    return parent;
  }

  existsPath(path: string): boolean {
    return this.findByPath(path) !== null;
  }

  /** Ensure a folder path exists, creating intermediate folders. Returns the folder id. */
  ensureFolder(path: string): string {
    const norm = normalizePath(path);
    if (!norm) return ROOT_ID;
    let parent = ROOT_ID;
    this.doc.transact(() => {
      let acc = '';
      for (const seg of norm.split('/')) {
        acc = acc ? `${acc}/${seg}` : seg;
        const existing = this.findByPath(acc);
        if (existing !== null) {
          parent = existing;
          continue;
        }
        parent = this.insertNode(seg, parent, 'folder');
      }
    });
    return parent;
  }

  private insertNode(name: string, parentId: string, kind: NodeKind, id = nanoid(12)): string {
    const m = new Y.Map<any>();
    const now = Date.now();
    m.set('id', id);
    m.set('name', name);
    m.set('parentId', parentId);
    m.set('kind', kind);
    m.set('createdAt', now);
    m.set('updatedAt', now);
    this.nodes.set(id, m);
    return id;
  }

  createFolder(path: string): string {
    return this.ensureFolder(path);
  }

  /**
   * Create (or overwrite) a file at `path`. Text vs binary storage is decided by
   * the extension unless `content` is a Uint8Array for a text path, in which case
   * it's decoded as UTF-8.
   */
  createFile(path: string, content: string | Uint8Array = ''): string {
    const norm = normalizePath(path);
    if (!norm) throw new Error('Invalid file path');
    let id = '';
    this.doc.transact(() => {
      const existing = this.findByPath(norm);
      if (existing) {
        if (this.nodes.get(existing)?.get('kind') === 'folder') throw new Error(`A folder already exists at ${norm}`);
        this.writeFile(existing, content);
        id = existing;
        return;
      }
      const parent = this.ensureFolder(dirname(norm));
      id = this.insertNode(basename(norm), parent, 'file');
      this.setContent(id, norm, content);
    });
    return id;
  }

  private setContent(id: string, path: string, content: string | Uint8Array) {
    if (isTextPath(path)) {
      const text = typeof content === 'string' ? content : decodeUtf8(content);
      const yt = new Y.Text();
      yt.insert(0, text);
      this.texts.set(id, yt);
      this.blobs.delete(id);
    } else {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      this.blobs.set(id, bytes);
      this.texts.delete(id);
    }
  }

  /** Replace the entire content of a file. For text files this performs a minimal diff on the Y.Text. */
  writeFile(id: string, content: string | Uint8Array): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`File not found: ${id}`);
    this.doc.transact(() => {
      const yt = this.texts.get(id);
      if (yt) {
        applyTextDiff(yt, typeof content === 'string' ? content : decodeUtf8(content));
      } else {
        this.setContent(id, this.getPath(id), content);
      }
      node.set('updatedAt', Date.now());
    });
  }

  readText(id: string): string {
    const yt = this.texts.get(id);
    if (yt) return yt.toString();
    const blob = this.blobs.get(id);
    return blob ? decodeUtf8(blob) : '';
  }

  /** The live Y.Text of a text file (bind editors to this). */
  getYText(id: string): Y.Text | null {
    return this.texts.get(id) ?? null;
  }

  readBinary(id: string): Uint8Array {
    const blob = this.blobs.get(id);
    if (blob) return blob;
    const yt = this.texts.get(id);
    return new TextEncoder().encode(yt ? yt.toString() : '');
  }

  readFile(id: string): string | Uint8Array {
    const yt = this.texts.get(id);
    if (yt) return yt.toString();
    return this.blobs.get(id) ?? new Uint8Array();
  }

  readPath(path: string): string | Uint8Array | null {
    const id = this.findByPath(path);
    return id ? this.readFile(id) : null;
  }

  rename(id: string, newName: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const name = basename(newName);
    if (!name) throw new Error('Invalid name');
    if (name === node.get('name')) return;
    if (this.siblingNamed(node.get('parentId') ?? ROOT_ID, name, id)) throw new Error(`"${name}" already exists`);
    this.doc.transact(() => {
      const oldPath = this.getPath(id);
      node.set('name', name);
      node.set('updatedAt', Date.now());
      // Text ↔ binary storage may change with the extension.
      if (node.get('kind') === 'file' && isTextPath(oldPath) !== isTextPath(name)) {
        const content = this.readFile(id);
        this.setContent(id, this.getPath(id), content);
      }
    });
  }

  /** Move a node into another folder (`ROOT_ID` for root). Refuses to move a folder into itself. */
  move(id: string, newParentId: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if ((node.get('parentId') ?? ROOT_ID) === newParentId) return;
    if (newParentId !== ROOT_ID) {
      const target = this.nodes.get(newParentId);
      if (!target) throw new Error('Target folder not found');
      if (target.get('kind') !== 'folder') throw new Error('Target is not a folder');
    }
    let cur: string = newParentId;
    let guard = 0;
    while (cur !== ROOT_ID && guard++ < 256) {
      if (cur === id) throw new Error('Cannot move a folder into itself');
      cur = this.nodes.get(cur)?.get('parentId') ?? ROOT_ID;
    }
    if (this.siblingNamed(newParentId, node.get('name'), id)) throw new Error(`"${node.get('name')}" already exists in the target folder`);
    this.doc.transact(() => {
      node.set('parentId', newParentId);
      node.set('updatedAt', Date.now());
    });
  }

  private siblingNamed(parentId: string, name: string, exceptId: string): string | null {
    let found: string | null = null;
    this.nodes.forEach((m, id) => {
      if (found === null && id !== exceptId && (m.get('parentId') ?? ROOT_ID) === parentId && m.get('name') === name) found = id;
    });
    return found;
  }

  /** Delete a node and (recursively) all its descendants. */
  delete(id: string): void {
    this.doc.transact(() => {
      const stack = [id];
      const mainId = this.meta.get('mainFileId');
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === mainId) this.meta.set('mainFileId', '');
        this.nodes.forEach((m, childId) => {
          if (m.get('parentId') === cur) stack.push(childId);
        });
        this.nodes.delete(cur);
        this.texts.delete(cur);
        this.blobs.delete(cur);
      }
    });
  }

  duplicate(id: string): string | null {
    const node = this.getNode(id);
    if (!node || node.kind !== 'file') return null;
    const dir = dirname(node.path);
    const dot = node.name.lastIndexOf('.');
    const stem = dot > 0 ? node.name.slice(0, dot) : node.name;
    const ext = dot > 0 ? node.name.slice(dot) : '';
    let n = 1;
    let candidate = joinPath(dir, `${stem} copy${ext}`);
    while (this.existsPath(candidate)) candidate = joinPath(dir, `${stem} copy ${++n}${ext}`);
    return this.createFile(candidate, this.readFile(id));
  }

  // ─────────────────────── bulk import / export ───────────────────────

  /** Import many files at once (zip upload, templates, folder sync). */
  importFiles(files: ProjectFile[], opts: { into?: string; replace?: boolean } = {}): string[] {
    const ids: string[] = [];
    this.doc.transact(() => {
      if (opts.replace) {
        for (const id of Array.from(this.nodes.keys())) this.delete(id);
      }
      for (const f of files) {
        const path = joinPath(opts.into ?? '', f.path);
        if (!path) continue;
        ids.push(this.createFile(path, f.content));
      }
    });
    return ids;
  }

  /** Plain snapshot of every file — used for compiling, zip export and AI tools. */
  snapshot(): ProjectFile[] {
    return this.listFiles().map((f) => ({ path: f.path, content: this.readFile(f.id) }));
  }

  // ───────────────────────────── main file ─────────────────────────────

  /** Resolve the main .tex file: explicit meta → `main.tex` → first file with \documentclass. */
  getMainFileId(): string | null {
    const explicit = this.meta.get('mainFileId');
    if (explicit && this.nodes.has(explicit)) return explicit;
    return this.detectMainFile();
  }

  detectMainFile(): string | null {
    const files = this.listFiles().filter((f) => isTexPath(f.path));
    const main = detectMainPath(files.map((f) => ({ path: f.path, content: this.readText(f.id) })));
    if (main) return files.find((f) => f.path === main)?.id ?? null;
    return files[0]?.id ?? null;
  }

  // ───────────────────────────── observe ─────────────────────────────

  /** Fires when the file tree (names/parents/added/removed) or meta changes. */
  onTreeChange(cb: () => void): () => void {
    const h = () => cb();
    this.nodes.observeDeep(h);
    this.texts.observe(h);
    this.blobs.observe(h);
    this.meta.observe(h);
    return () => {
      this.nodes.unobserveDeep(h);
      this.texts.unobserve(h);
      this.blobs.unobserve(h);
      this.meta.unobserve(h);
    };
  }

  /** Fires on any change to any file content (debounce on the caller side). */
  onContentChange(cb: (changedIds: Set<string>) => void): () => void {
    const h = (events: Y.YEvent<any>[]) => {
      const ids = new Set<string>();
      for (const e of events) {
        // Y.Text events inside `texts`: path[0] is the key of the Y.Text in the map.
        const key = e.path[0];
        if (typeof key === 'string') ids.add(key);
        else if (e.target === this.texts || e.target === this.blobs) {
          (e as Y.YMapEvent<any>).keysChanged.forEach((k) => ids.add(k));
        }
      }
      if (ids.size) cb(ids);
    };
    const hb = (e: Y.YMapEvent<any>) => cb(new Set(e.keysChanged));
    this.texts.observeDeep(h);
    this.blobs.observe(hb);
    return () => {
      this.texts.unobserveDeep(h);
      this.blobs.unobserve(hb);
    };
  }

  destroy() {
    this.doc.destroy();
  }
}

// ───────────────────────────── helpers ─────────────────────────────

const PREFERRED_MAIN = ['main.tex', 'paper.tex', 'thesis.tex', 'document.tex', 'report.tex', 'article.tex', 'manuscript.tex', 'root.tex'];

/**
 * Pick the root .tex file among plain files: files with an (uncommented)
 * `\documentclass` win — sub-files (`\documentclass[..]{subfiles}`) and
 * standalone figures only if nothing else qualifies; then preferred names
 * (main.tex, paper.tex, thesis.tex…) at the shallowest depth, then files that
 * also contain `\begin{document}`, then the shallowest path.
 */
export function detectMainPath(files: ProjectFile[]): string | undefined {
  const candidates: { path: string; depth: number; score: number }[] = [];
  for (const f of files) {
    if (!isTexPath(f.path)) continue;
    const text = typeof f.content === 'string' ? f.content : decodeUtf8(f.content);
    const m = /^[^%\n]*\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/m.exec(text);
    if (!m) continue;
    const cls = m[1].trim();
    let score = 0;
    if (cls === 'subfiles' || cls === 'standalone') score -= 100;
    if (/^[^%\n]*\\begin\s*\{document\}/m.test(text)) score += 10;
    const name = basename(f.path);
    const pref = PREFERRED_MAIN.indexOf(name);
    if (pref !== -1) score += 50 - pref;
    candidates.push({ path: f.path, depth: f.path.split('/').length, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.depth - b.depth || a.path.localeCompare(b.path));
  return candidates[0]?.path;
}

const utf8 = new TextDecoder('utf-8');
export function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

/**
 * Apply `next` to a Y.Text using a common prefix/suffix diff so concurrent
 * edits elsewhere in the document survive (instead of delete-all + insert).
 */
export function applyTextDiff(yt: Y.Text, next: string): void {
  const prev = yt.toString();
  if (prev === next) return;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }
  yt.doc!.transact(() => {
    if (endPrev > start) yt.delete(start, endPrev - start);
    if (endNext > start) yt.insert(start, next.slice(start, endNext));
  });
}

/** Encode the whole project as a single Yjs update (for snapshots / versions / export). */
export function encodeProject(p: ProjectDoc): Uint8Array {
  return Y.encodeStateAsUpdate(p.doc);
}

/** Create a ProjectDoc from an encoded update. */
export function decodeProject(update: Uint8Array): ProjectDoc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return new ProjectDoc(doc);
}

/** Build a fresh project from plain files (templates, zip import). */
export function createProjectFromFiles(
  meta: Partial<ProjectMeta> & { id: string; name: string },
  files: ProjectFile[],
  mainPath?: string,
): ProjectDoc {
  const p = new ProjectDoc();
  p.init(meta);
  p.importFiles(files);
  const mainId = mainPath ? p.findByPath(mainPath) : p.detectMainFile();
  if (mainId) p.setMeta({ mainFileId: mainId });
  return p;
}
