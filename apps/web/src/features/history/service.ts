/**
 * Version history service: automatic snapshots of the open project's Y.Doc,
 * named versions, restore (whole version / single file), zip download.
 *
 * Snapshots are taken locally on each device (they are not synced to
 * collaborators). A snapshot = `Y.encodeStateAsUpdate(doc)` + metadata with the
 * change summary relative to the previous version.
 */
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { zipSync } from 'fflate';
import { decodeProject, exportZip, normalizePath, type ProjectFile } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { useSettings } from '@/state/settings';
import type { ProjectSession } from '@/services/projects';
import { downloadBlob } from '@/lib/format';
import { intlLocale, t } from '@/lib/i18n';
import './i18n';
import { pruneVersions, type VersionKind } from './prune';
import { applyMinimalTextDiff, bytesEqual, compareFiles, summarize } from './textDiff';
import { deleteUpdates, readIndex, readUpdate, useHistory, useHistoryPrefs, withLock, writeIndex, writeUpdate, type VersionMeta } from './store';

interface Live {
  session: ProjectSession;
  projectId: string;
  /** Files of the latest stored version (baseline for change detection). */
  lastFiles: ProjectFile[] | null;
  lastSnapshotAt: number;
  lastUpdateAt: number;
  updateSeq: number;
  off: () => void;
  openTimer?: ReturnType<typeof setTimeout>;
  ready: Promise<void>;
}

let live: Live | null = null;
/** Transaction origin of restores (lets other features recognise them). */
const RESTORE_ORIGIN = 'history-restore';

interface Captured {
  projectId: string;
  update: Uint8Array;
  files: ProjectFile[];
  kind: VersionKind;
  label?: string;
  createdAt: number;
  seq: number;
}

function capture(l: Live, kind: VersionKind, label?: string): Captured {
  return {
    projectId: l.projectId,
    update: Y.encodeStateAsUpdate(l.session.project.doc),
    files: l.session.project.snapshot(),
    kind,
    label,
    createdAt: Date.now(),
    seq: l.updateSeq,
  };
}

async function persist(c: Captured, opts: { force?: boolean } = {}): Promise<VersionMeta | null> {
  return withLock(c.projectId, async () => {
    const l = live && live.projectId === c.projectId ? live : null;
    if (l) await l.ready;
    const baseline = l?.lastFiles ?? (await latestFiles(c.projectId));
    const changes = summarize(compareFiles(baseline ?? [], c.files));
    if (!opts.force && baseline && changes.files === 0) {
      if (l && l.updateSeq === c.seq) markClean(l);
      return null;
    }
    const { userName, userColor } = useSettings.getState();
    const meta: VersionMeta = {
      id: nanoid(12),
      projectId: c.projectId,
      createdAt: c.createdAt,
      kind: c.kind,
      label: c.label,
      author: { name: userName, color: userColor },
      size: c.update.byteLength,
      changes,
      fileCount: c.files.length,
    };
    useHistory.setState({ saving: true });
    try {
      await writeUpdate(meta.id, c.update);
      const list = [meta, ...(await readIndex(c.projectId))];
      const { keep, drop } = pruneVersions(list);
      await writeIndex(c.projectId, keep);
      if (drop.length) await deleteUpdates(drop.map((d) => d.id));
      if (useHistory.getState().projectId === c.projectId) useHistory.setState({ versions: keep });
    } finally {
      useHistory.setState({ saving: false });
    }
    if (l) {
      l.lastFiles = c.files;
      l.lastSnapshotAt = c.createdAt;
      if (l.updateSeq === c.seq) markClean(l);
    }
    return meta;
  });
}

function markClean(l: Live) {
  if (live === l) useHistory.setState({ dirtySince: null });
}

// ───────────────────────────── decoding ─────────────────────────────

export interface VersionContent {
  files: ProjectFile[];
  folders: string[];
  mainPath: string | null;
}

const decoded = new Map<string, VersionContent>();

export async function loadVersionContent(versionId: string): Promise<VersionContent> {
  const hit = decoded.get(versionId);
  if (hit) {
    decoded.delete(versionId);
    decoded.set(versionId, hit);
    return hit;
  }
  const update = await readUpdate(versionId);
  if (!update) throw new Error(t('history.err.missingData'));
  const p = decodeProject(update);
  try {
    const mainId = p.getMainFileId();
    const content: VersionContent = {
      files: p.snapshot(),
      folders: p.list().filter((n) => n.kind === 'folder').map((n) => n.path),
      mainPath: mainId ? p.getPath(mainId) : null,
    };
    decoded.set(versionId, content);
    while (decoded.size > 6) decoded.delete(decoded.keys().next().value!);
    return content;
  } finally {
    p.destroy();
  }
}

async function latestFiles(projectId: string): Promise<ProjectFile[] | null> {
  const [latest] = await readIndex(projectId);
  if (!latest) return null;
  try {
    return (await loadVersionContent(latest.id)).files;
  } catch {
    return null;
  }
}

/** The version just before `versionId` (for "changes in this version"). */
export function previousVersion(versionId: string): VersionMeta | null {
  const list = useHistory.getState().versions;
  const i = list.findIndex((v) => v.id === versionId);
  return i >= 0 ? (list[i + 1] ?? null) : null;
}

export function currentFiles(): ProjectFile[] {
  return useWorkspace.getState().project?.snapshot() ?? [];
}

// ───────────────────────────── public API ─────────────────────────────

/**
 * Take a snapshot of the open project now. Named versions (with a label) are
 * always stored; automatic ones only when something changed.
 */
export async function createSnapshot(opts: { label?: string; kind?: VersionKind; force?: boolean } = {}): Promise<VersionMeta | null> {
  if (!live) return null;
  const kind = opts.kind ?? (opts.label ? 'named' : 'auto');
  return persist(capture(live, kind, opts.label), { force: opts.force ?? kind === 'named' });
}

export async function renameVersion(versionId: string, label: string): Promise<void> {
  const projectId = useHistory.getState().projectId;
  if (!projectId) return;
  await withLock(projectId, async () => {
    const list = await readIndex(projectId);
    const next = list.map((v) => (v.id === versionId ? { ...v, label: label.trim() || undefined, kind: label.trim() ? ('named' as const) : v.kind } : v));
    await writeIndex(projectId, next);
    useHistory.setState({ versions: next });
  });
}

export async function deleteVersion(versionId: string): Promise<void> {
  const projectId = useHistory.getState().projectId;
  if (!projectId) return;
  await withLock(projectId, async () => {
    const list = (await readIndex(projectId)).filter((v) => v.id !== versionId);
    await writeIndex(projectId, list);
    await deleteUpdates([versionId]);
    decoded.delete(versionId);
    useHistory.setState({ versions: list });
    if (live?.projectId === projectId && list[0]) {
      live.lastFiles = (await loadVersionContent(list[0].id).catch(() => null))?.files ?? live.lastFiles;
    }
  });
}

/** Apply a set of files to the live project with minimal Y.Text edits. */
function applyFiles(target: ProjectFile[], opts: { deleteExtra: boolean; folders?: string[]; only?: string }) {
  const p = useWorkspace.getState().project;
  if (!p) throw new Error(t('history.err.noProject'));
  p.doc.transact(() => {
    for (const f of target) {
      if (opts.only && f.path !== opts.only) continue;
      const id = p.findByPath(f.path);
      if (id && p.getNode(id)?.kind === 'file') {
        const yt = p.getYText(id);
        if (yt && typeof f.content === 'string') applyMinimalTextDiff(yt, f.content);
        else {
          const cur = p.readFile(id);
          const same = typeof cur === 'string' ? cur === f.content : typeof f.content !== 'string' && bytesEqual(cur, f.content);
          if (!same) p.writeFile(id, f.content);
        }
      } else p.createFile(f.path, f.content);
    }
    if (opts.only) {
      if (!target.some((f) => f.path === opts.only)) {
        const id = p.findByPath(opts.only);
        if (id) p.delete(id);
      }
      return;
    }
    for (const folder of opts.folders ?? []) p.ensureFolder(folder);
    if (opts.deleteExtra) {
      const keep = new Set(target.map((f) => f.path));
      for (const f of p.listFiles()) if (!keep.has(f.path)) p.delete(f.id);
      const keepFolders = new Set(opts.folders ?? []);
      for (const n of p.list().filter((x) => x.kind === 'folder').sort((a, b) => b.path.length - a.path.length)) {
        if (!keepFolders.has(n.path) && p.children(n.id).length === 0) p.delete(n.id);
      }
    }
  }, RESTORE_ORIGIN);
}

function versionTitle(v: VersionMeta) {
  return v.label ?? new Date(v.createdAt).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

/** Restore the whole project to a version (a safety snapshot is taken first). */
export async function restoreVersion(versionId: string): Promise<void> {
  const v = useHistory.getState().versions.find((x) => x.id === versionId);
  if (!v || !live) throw new Error(t('history.err.notFound'));
  const content = await loadVersionContent(versionId);
  await createSnapshot({ kind: 'safety', label: t('history.beforeRestoring', { title: versionTitle(v) }), force: true });
  applyFiles(content.files, { deleteExtra: true, folders: content.folders });
  const p = useWorkspace.getState().project;
  if (p && content.mainPath) {
    const mainId = p.findByPath(content.mainPath);
    if (mainId && p.getMeta().mainFileId !== mainId) p.setMeta({ mainFileId: mainId });
  }
  await createSnapshot({ kind: 'checkpoint', label: t('history.restoredLabel', { title: versionTitle(v) }), force: true });
}

/** Restore a single file (re-creates it if it was deleted, deletes it if it didn't exist then). */
export async function restoreFile(versionId: string, path: string): Promise<void> {
  const v = useHistory.getState().versions.find((x) => x.id === versionId);
  if (!v || !live) throw new Error(t('history.err.notFound'));
  const content = await loadVersionContent(versionId);
  await createSnapshot({ kind: 'safety', label: t('history.beforeRestoringFile', { path }), force: true });
  applyFiles(content.files, { deleteExtra: false, only: normalizePath(path) });
}

export async function downloadVersionZip(versionId: string): Promise<void> {
  const v = useHistory.getState().versions.find((x) => x.id === versionId);
  const content = await loadVersionContent(versionId);
  let data: Uint8Array;
  try {
    data = exportZip(content.files);
  } catch {
    // Fallback while core's exportZip is unavailable.
    const enc = new TextEncoder();
    data = zipSync(Object.fromEntries(content.files.map((f) => [f.path, typeof f.content === 'string' ? enc.encode(f.content) : f.content])));
  }
  const name = (useWorkspace.getState().meta?.name ?? 'project').replace(/[\\/:*?"<>|]+/g, '-');
  const stamp = v ? new Date(v.createdAt).toISOString().slice(0, 16).replace(/[T:]/g, '-') : 'version';
  downloadBlob(data, `${name} (${v?.label ? v.label.replace(/[\\/:*?"<>|]+/g, '-') : stamp}).zip`, 'application/zip');
}

// ───────────────────────────── lifecycle ─────────────────────────────

function attach(session: ProjectSession) {
  const doc = session.project.doc;
  const l: Live = {
    session,
    projectId: session.id,
    lastFiles: null,
    lastSnapshotAt: Date.now(),
    lastUpdateAt: 0,
    updateSeq: 0,
    off: () => {},
    ready: Promise.resolve(),
  };
  const onUpdate = () => {
    l.updateSeq++;
    l.lastUpdateAt = Date.now();
    if (live === l && useHistory.getState().dirtySince == null) useHistory.setState({ dirtySince: Date.now() });
  };
  doc.on('update', onUpdate);
  l.off = () => doc.off('update', onUpdate);
  live = l;
  useHistory.setState({ projectId: l.projectId, versions: [], loading: true, dirtySince: null });
  l.ready = (async () => {
    const versions = await readIndex(l.projectId);
    if (live !== l) return;
    useHistory.setState({ versions, loading: false });
    if (versions[0]) {
      l.lastSnapshotAt = versions[0].createdAt;
      l.lastFiles = (await loadVersionContent(versions[0].id).catch(() => null))?.files ?? null;
    }
  })();
  // Snapshot on open (after collaborators had a moment to sync) when the content differs.
  l.openTimer = setTimeout(() => {
    if (live === l) void persist(capture(l, 'open')).catch((err) => console.error('[history] snapshot failed', err));
  }, 4000);
}

function detach(prev: ProjectSession) {
  const l = live;
  if (!l || l.session !== prev) return;
  clearTimeout(l.openTimer);
  l.off();
  live = null;
  // Capture synchronously: the doc is destroyed right after the session closes.
  if (useHistory.getState().dirtySince != null) {
    const c = capture(l, 'auto');
    void persist(c).catch(() => {});
  }
  useHistory.setState({ projectId: null, versions: [], dirtySince: null, loading: false });
}

function tick() {
  const l = live;
  if (!l || useHistory.getState().dirtySince == null) return;
  const interval = useHistoryPrefs.getState().intervalMin * 60_000;
  if (interval <= 0) return;
  const now = Date.now();
  if (now - l.lastSnapshotAt < interval) return;
  // Wait for a short pause in typing, but don't postpone forever.
  if (now - l.lastUpdateAt < 4000 && now - l.lastSnapshotAt < interval * 2) return;
  void persist(capture(l, 'auto')).catch((err) => console.error('[history] snapshot failed', err));
}

export function startHistoryService(): () => void {
  const cur = useWorkspace.getState().session;
  if (cur) attach(cur);
  const unsub = useWorkspace.subscribe((s, p) => {
    if (s.session === p.session) return;
    if (p.session) detach(p.session);
    if (s.session) attach(s.session);
  });
  const timer = setInterval(tick, 15_000);
  const onHide = () => {
    if (document.visibilityState === 'hidden' && live && useHistory.getState().dirtySince != null && Date.now() - live.lastSnapshotAt > 60_000) {
      void persist(capture(live, 'auto')).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    unsub();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    if (live) detach(live.session);
  };
}

