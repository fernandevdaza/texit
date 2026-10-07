/**
 * Local-first project storage.
 *
 *  - Each project is a Y.Doc persisted in its own IndexedDB database via y-indexeddb
 *    (`texit-project-<id>`), so edits survive reloads and merge with collaborators.
 *  - A lightweight index of `ProjectSummary` records (dashboard) lives in the
 *    `texit-index/projects` object store.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { createStore, del, get, set, values } from 'idb-keyval';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import {
  ProjectDoc,
  exportZip,
  getTemplate,
  importZip,
  type ProjectFile,
  type ProjectSummary,
  type ProjectTemplate,
  type TexEngine,
} from '@texit/core';

const indexStore = typeof indexedDB !== 'undefined' ? createStore('texit-index', 'projects') : undefined;
const docDbName = (id: string) => `texit-project-${id}`;

// ───────────────────────────── index ─────────────────────────────

interface ProjectsState {
  projects: ProjectSummary[];
  loaded: boolean;
  refresh(): Promise<void>;
}

export const useProjects = create<ProjectsState>((setState) => ({
  projects: [],
  loaded: false,
  async refresh() {
    const all = indexStore ? ((await values(indexStore)) as ProjectSummary[]) : [];
    all.sort((a, b) => (b.openedAt || b.updatedAt) - (a.openedAt || a.updatedAt));
    setState({ projects: all, loaded: true });
  },
}));

export async function getSummary(id: string): Promise<ProjectSummary | undefined> {
  return indexStore ? get(id, indexStore) : undefined;
}

export async function updateSummary(id: string, patch: Partial<ProjectSummary>): Promise<void> {
  const cur = await getSummary(id);
  if (!cur || !indexStore) return;
  await set(id, { ...cur, ...patch }, indexStore);
  await useProjects.getState().refresh();
}

async function putSummary(s: ProjectSummary) {
  if (indexStore) await set(s.id, s, indexStore);
  await useProjects.getState().refresh();
}

// ───────────────────────────── create / import ─────────────────────────────

async function persistNewDoc(id: string, p: ProjectDoc): Promise<void> {
  const persistence = new IndexeddbPersistence(docDbName(id), p.doc);
  await persistence.whenSynced;
  // Give y-indexeddb a tick to flush the initial state.
  await new Promise((r) => setTimeout(r, 30));
  await persistence.destroy();
}

export interface CreateProjectOptions {
  name: string;
  templateId?: string;
  template?: ProjectTemplate;
  files?: ProjectFile[];
  mainPath?: string;
  engine?: TexEngine;
  tags?: string[];
  /** Pre-existing doc (e.g. joined collaboration room, duplicated project). */
  doc?: ProjectDoc;
  folderPath?: string;
  collab?: ProjectSummary['collab'];
}

/** Download a template's extra files (class/style files not shipped with the in-browser TeX Live). */
async function fetchTemplateAssets(assets: NonNullable<ProjectTemplate['assets']>): Promise<ProjectFile[]> {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const out = await Promise.all(
    assets.map(async (a) => {
      try {
        const res = await fetch(new URL(a.url, base));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { path: a.path, content: new Uint8Array(await res.arrayBuffer()) } as ProjectFile;
      } catch (err) {
        console.warn(`[texit] could not fetch template asset ${a.url}`, err);
        return null;
      }
    }),
  );
  return out.filter((f): f is ProjectFile => !!f);
}

export async function createProject(opts: CreateProjectOptions): Promise<string> {
  const id = nanoid(12);
  const now = Date.now();
  const template = opts.template ?? (opts.templateId ? getTemplate(opts.templateId) : undefined);
  const files = [...(opts.files ?? template?.files ?? getTemplate('blank')?.files ?? [])];
  if (!opts.files && template?.assets?.length) files.push(...(await fetchTemplateAssets(template.assets)));
  const engine = opts.engine ?? template?.engine ?? 'pdflatex';
  const p = opts.doc ?? new ProjectDoc();
  if (!opts.doc) {
    p.init({ id, name: opts.name, engine, tags: opts.tags ?? template?.tags ?? [] });
    p.importFiles(files);
    const mainId = p.findByPath(opts.mainPath ?? template?.main ?? '') || p.detectMainFile();
    if (mainId) p.setMeta({ mainFileId: mainId });
  } else if (!opts.collab) {
    // Shared docs keep the owner's meta (writing our local id would propagate to every peer).
    p.setMeta({ id, name: opts.name });
  }
  await persistNewDoc(id, p);
  await putSummary({
    id,
    name: opts.name,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
    tags: opts.tags ?? template?.tags ?? [],
    engine,
    folderPath: opts.folderPath,
    collab: opts.collab,
  });
  return id;
}

/** Import an Overleaf-style .zip as a new project. */
export async function importZipProject(file: File | { name: string; data: Uint8Array }): Promise<string> {
  const data = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.data;
  const res = importZip(data, file.name);
  if (!res.files.length) throw new Error('The zip file does not contain any files.');
  const name = res.suggestedName || file.name.replace(/\.zip$/i, '') || 'Imported project';
  return createProject({ name, files: res.files, mainPath: res.mainPath });
}

/** Create a project from loose files (drag & drop of a folder or several files). */
export async function importFilesProject(name: string, files: ProjectFile[]): Promise<string> {
  return createProject({ name, files });
}

// ───────────────────────────── open / session ─────────────────────────────

export interface ProjectSession {
  id: string;
  project: ProjectDoc;
  persistence: IndexeddbPersistence;
  close(): Promise<void>;
}

export async function openProjectSession(id: string): Promise<ProjectSession> {
  const doc = new Y.Doc({ gc: true });
  const project = new ProjectDoc(doc);
  const persistence = new IndexeddbPersistence(docDbName(id), doc);
  await persistence.whenSynced;
  if (!project.meta.get('id')) {
    const summary = await getSummary(id);
    project.init({ id, name: summary?.name ?? 'Untitled' });
  }
  await updateSummary(id, { openedAt: Date.now() });

  // Keep the dashboard summary roughly up to date.
  let t: ReturnType<typeof setTimeout> | undefined;
  const onUpdate = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const meta = project.getMeta();
      void updateSummary(id, { updatedAt: Date.now(), name: meta.name, engine: meta.engine, tags: meta.tags ?? [] });
    }, 1500);
  };
  doc.on('update', onUpdate);

  return {
    id,
    project,
    persistence,
    async close() {
      clearTimeout(t);
      doc.off('update', onUpdate);
      await persistence.destroy();
      doc.destroy();
    },
  };
}

// ───────────────────────────── manage ─────────────────────────────

export async function renameProject(id: string, name: string) {
  await updateSummary(id, { name });
  // Also rename inside the doc (best-effort, without keeping it open).
  await withProject(id, (p) => p.setMeta({ name }));
}

/** Run a short operation against a project that is not currently open. */
export async function withProject<T>(id: string, fn: (p: ProjectDoc) => T | Promise<T>): Promise<T> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docDbName(id), doc);
  await persistence.whenSynced;
  try {
    const out = await fn(new ProjectDoc(doc));
    await new Promise((r) => setTimeout(r, 30));
    return out;
  } finally {
    await persistence.destroy();
    doc.destroy();
  }
}

export async function duplicateProject(id: string): Promise<string> {
  const summary = await getSummary(id);
  const files = await withProject(id, (p) => ({ files: p.snapshot(), meta: p.getMeta(), main: p.getMainFileId() ? p.getPath(p.getMainFileId()!) : undefined }));
  return createProject({
    name: `${summary?.name ?? files.meta.name} (copy)`,
    files: files.files,
    mainPath: files.main,
    engine: files.meta.engine,
    tags: summary?.tags,
  });
}

export async function trashProject(id: string, trashed = true) {
  await updateSummary(id, { trashed });
}

export async function deleteProjectForever(id: string) {
  if (indexStore) await del(id, indexStore);
  // Version history lives in its own database (lazy import keeps the dashboard bundle small).
  await import('@/features/history/store').then((m) => m.deleteProjectHistory(id)).catch(() => {});
  await import('@/features/compile/pdfCache').then((m) => m.deleteCachedResult(id)).catch(() => {});
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(docDbName(id));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  await useProjects.getState().refresh();
}

export async function exportProjectZip(id: string): Promise<{ name: string; data: Uint8Array }> {
  const summary = await getSummary(id);
  const files = await withProject(id, (p) => p.snapshot());
  const name = (summary?.name ?? 'project').replace(/[\\/:*?"<>|]+/g, '-');
  return { name: `${name}.zip`, data: exportZip(files) };
}
