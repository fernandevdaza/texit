/**
 * FolderSync — two-way mirror between a ProjectDoc (Y.Doc) and a folder on disk
 * through `window.texit.fs`.
 *
 * Used for: CLI agents working in the project mirror dir, "Open folder as
 * project", and editing with external editors.
 *
 * - Y → disk: content/tree changes are debounced and written (only files whose
 *   content hash changed; renames are detected by hash and done as renames).
 * - disk → Y: watch batches are applied with a minimal Y.Text diff (so remote
 *   collaborators' concurrent edits survive), renames keep node ids.
 * - Echo loops are prevented with per-path content hashes of the last state
 *   known to be identical on both sides.
 * - Conflicts (file changed on disk while it also has unsynced local edits):
 *   a 3-way line merge against the last synced text is attempted; if it fails
 *   the disk version wins (last writer wins). Yjs then merges with peers.
 */
import { applyPatch, structuredPatch } from 'diff';
import { basename, decodeUtf8, dirname, isTextPath, normalizePath, type HostWatchEvent, type ProjectDoc, type TexitHost, getHost } from '@texit/core';
import { hashContent, hashString } from './hash';

export type InitialSyncMode = 'project-to-disk' | 'disk-to-project' | 'merge';

export interface FolderSyncConflict {
  path: string;
  resolution: 'merged' | 'disk-wins';
}

export interface FolderSyncOptions {
  project: ProjectDoc;
  /** Absolute folder path. */
  dir: string;
  host?: TexitHost;
  /**
   * How to reconcile on start:
   * - 'project-to-disk' (default; CLI-agent mirror dirs): disk is made identical to the project.
   * - 'disk-to-project' ("open folder as project"): the project is made identical to the folder.
   * - 'merge': union of both; when both have a file, the most recently modified side wins.
   */
  initial?: InitialSyncMode;
  /** For 'project-to-disk': delete disk files that are not in the project (default true). */
  deleteExtraneous?: boolean;
  /** Debounce for Y → disk writes (default 250 ms). */
  debounceMs?: number;
  /** Extra project-relative paths to never sync. */
  ignore?: (path: string) => boolean;
  onConflict?: (c: FolderSyncConflict) => void;
  onError?: (err: unknown) => void;
  /** Paths changed in the project because of disk changes (e.g. to show "updated by agent"). */
  onDiskChange?: (paths: string[]) => void;
}

interface Known {
  hash: string;
  /** Last synced text (base for 3-way merges). */
  base?: string;
}

export type FolderSyncStatus = 'idle' | 'starting' | 'running' | 'stopped';

export class FolderSync {
  readonly dir: string;
  private readonly project: ProjectDoc;
  private readonly host: TexitHost;
  private readonly opts: FolderSyncOptions;
  private readonly sep: string;
  private known = new Map<string, Known>();
  private knownDirs = new Set<string>();
  private dirtyIds = new Set<string>();
  private fullScan = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private disposers: (() => void)[] = [];
  private _status: FolderSyncStatus = 'idle';

  constructor(opts: FolderSyncOptions) {
    const host = opts.host ?? getHost();
    if (!host) throw new Error('FolderSync requires the TexIt desktop app');
    this.host = host;
    this.project = opts.project;
    this.opts = opts;
    this.sep = host.platform === 'win32' ? '\\' : '/';
    this.dir = opts.dir.replace(/[\\/]+$/, '');
  }

  get status(): FolderSyncStatus {
    return this._status;
  }

  /** Initial reconciliation, then live two-way sync. */
  async start(): Promise<void> {
    if (this._status !== 'idle') return;
    this._status = 'starting';
    await this.host.fs.mkdir(this.dir);
    // Watch first (events are queued behind the initial sync on the chain) so nothing is missed.
    const unwatch = await this.host.fs.watch(this.dir, (events) => {
      void this.enqueue(() => this.applyDiskEvents(events));
    });
    this.disposers.push(unwatch);
    await this.enqueue(() => this.initialSync(this.opts.initial ?? 'project-to-disk'));
    this.disposers.push(
      this.project.onContentChange((ids) => {
        ids.forEach((id) => this.dirtyIds.add(id));
        this.schedule();
      }),
      this.project.onTreeChange(() => {
        this.fullScan = true;
        this.schedule();
      }),
    );
    this._status = 'running';
  }

  /** Write pending project changes to disk now (call before starting a CLI agent). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.enqueue(() => this.flushToDisk());
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped') return;
    try {
      if (this._status === 'running') await this.flush();
    } finally {
      this._status = 'stopped';
      if (this.timer) clearTimeout(this.timer);
      this.disposers.splice(0).forEach((d) => {
        try {
          d();
        } catch {
          /* ignore */
        }
      });
    }
  }

  // ───────────────────────────── plumbing ─────────────────────────────

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch((err) => this.report(err));
    return next;
  }

  private report(err: unknown) {
    if (this.opts.onError) this.opts.onError(err);
    else console.error('[texit] folder sync error', err);
  }

  private schedule() {
    if (this._status === 'stopped') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(() => this.flushToDisk());
    }, this.opts.debounceMs ?? 250);
  }

  private abs(rel: string): string {
    return this.dir + this.sep + rel.split('/').join(this.sep);
  }

  private ignored(rel: string): boolean {
    return !rel || (this.opts.ignore?.(rel) ?? false);
  }

  private diskHash(rel: string, bytes: Uint8Array): { hash: string; text?: string } {
    if (isTextPath(rel)) {
      const text = decodeUtf8(bytes);
      return { hash: hashString(text), text };
    }
    return { hash: hashContent(bytes) };
  }

  private projectFiles(): Map<string, { id: string; content: string | Uint8Array }> {
    const out = new Map<string, { id: string; content: string | Uint8Array }>();
    for (const f of this.project.listFiles()) {
      if (this.ignored(f.path)) continue;
      out.set(f.path, { id: f.id, content: this.project.readFile(f.id) });
    }
    return out;
  }

  private projectFolders(): string[] {
    return this.project
      .list()
      .filter((n) => n.kind === 'folder' && !this.ignored(n.path))
      .map((n) => n.path);
  }

  // ───────────────────────────── initial sync ─────────────────────────────

  private async initialSync(mode: InitialSyncMode): Promise<void> {
    const disk = new Map<string, { content: Uint8Array; mtimeMs: number }>();
    for (const e of await this.host.fs.readTree(this.dir)) {
      const rel = normalizePath(e.path);
      if (!this.ignored(rel)) disk.set(rel, { content: e.content, mtimeMs: e.mtimeMs });
    }
    const proj = this.projectFiles();
    const changedInProject: string[] = [];

    const toDisk = async (rel: string, content: string | Uint8Array) => {
      await this.host.fs.writeFile(this.abs(rel), content);
      this.known.set(rel, { hash: hashContent(content), base: typeof content === 'string' ? content : undefined });
    };
    const toProject = (rel: string, bytes: Uint8Array) => {
      const { hash, text } = this.diskHash(rel, bytes);
      const id = this.project.findByPath(rel);
      if (id) this.project.writeFile(id, text ?? bytes);
      else this.project.createFile(rel, text ?? bytes);
      this.known.set(rel, { hash, base: text });
      changedInProject.push(rel);
    };

    if (mode === 'project-to-disk') {
      for (const [rel, f] of proj) {
        const d = disk.get(rel);
        const h = hashContent(f.content);
        if (d && this.diskHash(rel, d.content).hash === h) this.known.set(rel, { hash: h, base: typeof f.content === 'string' ? f.content : undefined });
        else await toDisk(rel, f.content);
      }
      if (this.opts.deleteExtraneous !== false) {
        for (const rel of disk.keys()) if (!proj.has(rel)) await this.host.fs.remove(this.abs(rel)).catch((e) => this.report(e));
      }
      for (const folder of this.projectFolders()) {
        await this.host.fs.mkdir(this.abs(folder));
        this.knownDirs.add(folder);
      }
    } else {
      this.project.doc.transact(() => {
        for (const [rel, d] of disk) {
          const p = proj.get(rel);
          const dh = this.diskHash(rel, d.content);
          if (p && hashContent(p.content) === dh.hash) {
            this.known.set(rel, { hash: dh.hash, base: dh.text });
            continue;
          }
          if (p && mode === 'merge') {
            const node = this.project.getNode(p.id);
            if (node && node.updatedAt > d.mtimeMs) continue; // project is newer → written below
          }
          toProject(rel, d.content);
        }
        if (mode === 'disk-to-project') {
          for (const [rel, p] of proj) if (!disk.has(rel)) this.project.delete(p.id);
        }
      });
      // 'merge': project-only (or newer) files go to disk.
      if (mode === 'merge') {
        for (const [rel, p] of this.projectFiles()) {
          if (!this.known.has(rel)) await toDisk(rel, p.content);
        }
      }
      for (const folder of this.projectFolders()) this.knownDirs.add(folder);
    }
    if (changedInProject.length) this.opts.onDiskChange?.(changedInProject);
  }

  // ───────────────────────────── Y → disk ─────────────────────────────

  private async flushToDisk(): Promise<void> {
    if (this._status === 'stopped') return;
    const full = this.fullScan;
    const dirty = new Set(this.dirtyIds);
    this.fullScan = false;
    this.dirtyIds.clear();

    if (!full) {
      for (const id of dirty) {
        const node = this.project.getNode(id);
        if (!node || node.kind !== 'file' || this.ignored(node.path)) continue;
        const content = this.project.readFile(id);
        const h = hashContent(content);
        if (this.known.get(node.path)?.hash === h) continue;
        await this.host.fs.writeFile(this.abs(node.path), content);
        this.known.set(node.path, { hash: h, base: typeof content === 'string' ? content : undefined });
      }
      return;
    }

    const proj = this.projectFiles();
    const added: [string, string | Uint8Array, string][] = [];
    for (const [rel, f] of proj) {
      const h = hashContent(f.content);
      if (this.known.get(rel)?.hash !== h) added.push([rel, f.content, h]);
    }
    const removed = [...this.known.keys()].filter((rel) => !proj.has(rel));

    // Folders first (so renames / writes have a parent), including empty ones.
    const folders = this.projectFolders();
    for (const folder of folders) {
      if (this.knownDirs.has(folder)) continue;
      await this.host.fs.mkdir(this.abs(folder));
      this.knownDirs.add(folder);
    }

    // Renames: a removed path whose hash matches an added (new) path.
    const removedByHash = new Map<string, string>();
    for (const rel of removed) removedByHash.set(this.known.get(rel)!.hash, rel);
    for (const entry of [...added]) {
      const [rel, content, h] = entry;
      const from = this.known.has(rel) ? undefined : removedByHash.get(h);
      if (!from) continue;
      removedByHash.delete(h);
      removed.splice(removed.indexOf(from), 1);
      added.splice(added.indexOf(entry), 1);
      try {
        await this.host.fs.rename(this.abs(from), this.abs(rel));
      } catch {
        await this.host.fs.writeFile(this.abs(rel), content);
        await this.host.fs.remove(this.abs(from)).catch(() => undefined);
      }
      const prev = this.known.get(from)!;
      this.known.delete(from);
      this.known.set(rel, prev);
    }

    for (const [rel, content, h] of added) {
      await this.host.fs.writeFile(this.abs(rel), content);
      this.known.set(rel, { hash: h, base: typeof content === 'string' ? content : undefined });
    }
    for (const rel of removed) {
      await this.host.fs.remove(this.abs(rel)).catch((e) => this.report(e));
      this.known.delete(rel);
    }
    // Folders deleted in the project (deepest first; parents may already be gone).
    const live = new Set(folders);
    const gone = [...this.knownDirs].filter((d) => !live.has(d)).sort((a, b) => b.length - a.length);
    for (const d of gone) {
      this.knownDirs.delete(d);
      if (gone.some((other) => other !== d && d.startsWith(other + '/'))) continue;
      await this.host.fs.remove(this.abs(d)).catch(() => undefined);
    }
  }

  // ───────────────────────────── disk → Y ─────────────────────────────

  private async applyDiskEvents(events: HostWatchEvent[]): Promise<void> {
    if (this._status === 'stopped') return;
    // Resolve contents first (outside of the Y transaction).
    const resolved: { e: HostWatchEvent; rel: string; bytes?: Uint8Array }[] = [];
    for (const e of events) {
      const rel = normalizePath(e.path);
      if (this.ignored(rel)) continue;
      let bytes = e.content;
      if ((e.type === 'add' || e.type === 'change') && !bytes) {
        if (!this.host.fs.readFile) continue;
        bytes = await this.host.fs.readFile(this.abs(rel)).catch(() => undefined);
        if (!bytes) continue;
      }
      resolved.push({ e, rel, bytes });
    }
    if (!resolved.length) return;

    const changed: string[] = [];
    const conflicts: FolderSyncConflict[] = [];
    this.project.doc.transact(() => {
      // Renames done by external tools arrive as unlink(old) + add(new) with identical content: keep the node.
      const unlinks = new Map<string, string>(); // hash → old path
      for (const r of resolved) {
        if (r.e.type !== 'unlink') continue;
        const k = this.known.get(r.rel);
        if (k) unlinks.set(k.hash, r.rel);
      }
      const renames = new Map<string, string>(); // new path → old path
      for (const r of resolved) {
        if (r.e.type !== 'add' || this.project.findByPath(r.rel) !== null) continue;
        const from = unlinks.get(this.diskHash(r.rel, r.bytes!).hash);
        if (from && this.project.findByPath(from) !== null) {
          renames.set(r.rel, from);
          unlinks.delete(this.known.get(from)!.hash);
        }
      }
      const consumedUnlinks = new Set(renames.values());

      for (const { e, rel, bytes } of resolved) {
        switch (e.type) {
          case 'addDir':
            if (this.project.findByPath(rel) === null) this.project.ensureFolder(rel);
            this.knownDirs.add(rel);
            break;
          case 'add':
          case 'change': {
            const { hash, text } = this.diskHash(rel, bytes!);
            const k = this.known.get(rel);
            if (k?.hash === hash) break; // our own write (echo) or no-op
            const id = this.project.findByPath(rel);
            if (!id) {
              const from = renames.get(rel);
              const fromId = from ? this.project.findByPath(from) : null;
              if (from && fromId) {
                const parent = this.project.ensureFolder(dirname(rel));
                this.project.move(fromId, parent);
                this.project.rename(fromId, basename(rel));
                this.known.delete(from);
              } else {
                this.project.createFile(rel, text ?? bytes!);
              }
              this.known.set(rel, { hash, base: text });
              changed.push(rel);
              break;
            }
            if (text === undefined) {
              this.project.writeFile(id, bytes!);
              this.known.set(rel, { hash, base: undefined });
              changed.push(rel);
              break;
            }
            const local = this.project.readText(id);
            const localHash = hashString(local);
            if (localHash === hash) {
              this.known.set(rel, { hash, base: text });
              break;
            }
            const hasUnsyncedLocal = !!k && localHash !== k.hash;
            if (!hasUnsyncedLocal) {
              this.project.writeFile(id, text);
              this.known.set(rel, { hash, base: text });
            } else {
              const merged = k.base !== undefined ? threeWayMerge(k.base, local, text) : false;
              if (merged !== false) {
                this.project.writeFile(id, merged);
                conflicts.push({ path: rel, resolution: 'merged' });
              } else {
                this.project.writeFile(id, text);
                conflicts.push({ path: rel, resolution: 'disk-wins' });
              }
              // Disk holds `text`; the merged result (if different) is written back by the next flush.
              this.known.set(rel, { hash, base: text });
              this.dirtyIds.add(id);
            }
            changed.push(rel);
            break;
          }
          case 'unlink': {
            if (consumedUnlinks.has(rel)) break;
            const k = this.known.get(rel);
            const id = this.project.findByPath(rel);
            this.known.delete(rel);
            if (!id || !k) break;
            const content = this.project.readFile(id);
            if (hashContent(content) === k.hash) {
              this.project.delete(id);
              changed.push(rel);
            } else {
              this.dirtyIds.add(id); // local edits survive: rewrite the file
            }
            break;
          }
          case 'unlinkDir': {
            this.knownDirs.delete(rel);
            const id = this.project.findByPath(rel);
            if (!id) break;
            const prefix = rel + '/';
            const files = this.project.listFiles().filter((f) => f.path.startsWith(prefix));
            const unsynced = files.filter((f) => this.known.get(f.path)?.hash !== hashContent(this.project.readFile(f.id)));
            for (const f of files) this.known.delete(f.path);
            if (unsynced.length) {
              unsynced.forEach((f) => this.dirtyIds.add(f.id));
              this.fullScan = true;
              for (const f of files) if (!unsynced.includes(f)) this.project.delete(f.id);
            } else {
              this.project.delete(id);
            }
            changed.push(rel);
            break;
          }
        }
      }
    });
    if (this.dirtyIds.size || this.fullScan) this.schedule();
    for (const c of conflicts) this.opts.onConflict?.(c);
    if (changed.length) this.opts.onDiskChange?.(changed);
  }
}

/** Line-based 3-way merge: apply the base→theirs patch onto ours. Returns false on conflict. */
export function threeWayMerge(base: string, ours: string, theirs: string): string | false {
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  if (ours === theirs) return ours;
  const patch = structuredPatch('a', 'b', base, theirs, undefined, undefined, { context: 0 });
  return applyPatch(ours, patch);
}
