/**
 * Project actions shared by the dashboard UI, the command palette and the
 * `project.*` commands (create, import, star, tags, trash…).
 */
import { basename, isTextPath, isTexPath, stripExtension, type ProjectFile, type ProjectSummary } from '@texit/core';
import {
  createProject,
  deleteProjectForever,
  duplicateProject,
  exportProjectZip,
  importFilesProject,
  importZipProject,
  renameProject,
  trashProject,
  updateSummary,
  useProjects,
  withProject,
} from '@/services/projects';
import { navigate } from '@/lib/router';
import { downloadBlob } from '@/lib/format';
import { host } from '@/lib/platform';
import { t } from '@/lib/i18n';
import { confirmDialog, toast } from '@/ui';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function openProject(id: string) {
  navigate(`/p/${id}`);
}

export function openProjectInNewWindow(id: string) {
  const base = location.href.split('#')[0];
  window.open(`${base}#/p/${id}`, '_blank', 'noopener');
}

export const engineLabel: Record<string, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

function uniqueName(base: string): string {
  const names = new Set(useProjects.getState().projects.filter((p) => !p.trashed).map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export async function createBlankProject(open = true): Promise<string | undefined> {
  try {
    const id = await createProject({ name: uniqueName(t('dashboard.untitledProject')), templateId: 'blank' });
    if (open) openProject(id);
    return id;
  } catch (err) {
    toast.error(t('dashboard.toast.createError'), { description: errMsg(err) });
  }
}

// ───────────────────────────── import ─────────────────────────────

function pickLocalFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Import one or more Overleaf-style .zip archives. Opens the project when there is exactly one. */
export async function importZips(files: (File | { name: string; data: Uint8Array })[], opts: { open?: boolean } = {}) {
  if (!files.length) return;
  const ids: string[] = [];
  const loading = toast.loading(files.length === 1 ? t('dashboard.toast.importing', { name: files[0]!.name }) : t('dashboard.toast.importingMany', { count: files.length }));
  for (const f of files) {
    try {
      ids.push(await importZipProject(f));
    } catch (err) {
      toast.error(t('dashboard.toast.importError', { name: f.name }), { description: errMsg(err) });
    }
  }
  toast.dismiss(loading);
  if (!ids.length) return;
  if (ids.length === 1 && opts.open !== false) {
    openProject(ids[0]!);
  } else {
    toast.success(t('dashboard.toast.imported', { count: ids.length }), {
      action: ids.length === 1 ? { label: t('common.open'), onClick: () => openProject(ids[0]!) } : undefined,
    });
  }
}

/** `project.importZip`: native picker on desktop, file input on the web. */
export async function pickAndImportZip() {
  if (host) {
    const picked = await host.fs.pickFiles({ title: t('dashboard.toast.pickTitle'), filters: [{ name: t('dashboard.toast.zipFilter'), extensions: ['zip'] }], multiple: true });
    if (picked?.length) await importZips(picked.map((p) => ({ name: p.name, data: p.content })));
    return;
  }
  const files = await pickLocalFiles('.zip,application/zip,application/x-zip-compressed');
  await importZips(files);
}

const IGNORED = /(^|\/)(\.git|\.svn|node_modules|__MACOSX|\.DS_Store|Thumbs\.db|\.idea|\.vscode)(\/|$)/;
const BUILD_ARTIFACT = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex\.gz|synctex|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv)$/i;

function toProjectFile(path: string, bytes: Uint8Array): ProjectFile {
  if (isTextPath(path)) {
    try {
      return { path, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch {
      return { path, content: new TextDecoder('latin1').decode(bytes) };
    }
  }
  return { path, content: bytes };
}

function keepPath(path: string) {
  return !IGNORED.test(path) && !BUILD_ARTIFACT.test(path);
}

/** Pick a nice project name from a folder name or the main .tex file. */
function nameFromFiles(files: ProjectFile[], fallback: string): string {
  const main = files.find((f) => typeof f.content === 'string' && isTexPath(f.path) && /\\documentclass/.test(f.content));
  if (main && typeof main.content === 'string') {
    const title = /\\title\s*(?:\[[^\]]*\])?\s*\{([^{}]{2,80})\}/.exec(main.content)?.[1]?.trim();
    if (title && !/\\/.test(title)) return title;
    return stripExtension(basename(main.path));
  }
  return fallback;
}

/** Desktop: "Open folder…" → read the tree and create a project mirrored from it. */
export async function openFolderDesktop() {
  if (!host) return;
  try {
    const dir = await host.fs.pickDirectory({ title: t('dashboard.toast.pickFolder') });
    if (!dir) return;
    const entries = await host.fs.readTree(dir);
    const files = entries.filter((e) => keepPath(e.path)).map((e) => toProjectFile(e.path, e.content));
    if (!files.length) {
      toast.error(t('dashboard.toast.folderEmpty'), { description: dir });
      return;
    }
    const name = basename(dir.replace(/\\/g, '/')) || nameFromFiles(files, t('dashboard.importedProject'));
    const id = await importFilesProject(name, files);
    await updateSummary(id, { folderPath: dir });
    openProject(id);
  } catch (err) {
    toast.error(t('dashboard.toast.folderError'), { description: errMsg(err) });
  }
}

// ── drag & drop ──

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const out: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) resolve(out);
        else {
          out.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, prefix: string, out: ProjectFile[]) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (!keepPath(path)) return;
  if (entry.isFile) {
    const file = await readEntryFile(entry as FileSystemFileEntry);
    out.push(toProjectFile(path, new Uint8Array(await file.arrayBuffer())));
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries(entry as FileSystemDirectoryEntry)) await walk(child, path, out);
  }
}

/**
 * Collect what was dropped. MUST be called synchronously inside the drop
 * handler (DataTransfer items are invalidated afterwards); the returned
 * promise does the async work.
 */
export function collectDrop(dt: DataTransfer): Promise<void> {
  const entries: FileSystemEntry[] = [];
  const plain: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) plain.push(f);
    }
  }
  if (!entries.length && !plain.length) plain.push(...Array.from(dt.files ?? []));
  return importDropped(entries, plain);
}

async function importDropped(entries: FileSystemEntry[], plain: File[]) {
  const zips: File[] = plain.filter((f) => /\.zip$/i.test(f.name));
  const loose: ProjectFile[] = [];
  const folders: { name: string; files: ProjectFile[] }[] = [];
  try {
    for (const e of entries) {
      if (e.isDirectory) {
        const files: ProjectFile[] = [];
        for (const child of await readAllEntries(e as FileSystemDirectoryEntry)) await walk(child, '', files);
        if (files.length) folders.push({ name: e.name, files });
      } else if (/\.zip$/i.test(e.name)) {
        zips.push(await readEntryFile(e as FileSystemFileEntry));
      } else if (keepPath(e.name)) {
        const f = await readEntryFile(e as FileSystemFileEntry);
        loose.push(toProjectFile(f.name, new Uint8Array(await f.arrayBuffer())));
      }
    }
    for (const f of plain.filter((f) => !/\.zip$/i.test(f.name) && keepPath(f.name))) {
      loose.push(toProjectFile(f.name, new Uint8Array(await f.arrayBuffer())));
    }
  } catch (err) {
    toast.error(t('dashboard.toast.dropReadError'), { description: errMsg(err) });
    return;
  }

  const created: string[] = [];
  for (const folder of folders) {
    try {
      created.push(await importFilesProject(folder.name, folder.files));
    } catch (err) {
      toast.error(t('dashboard.toast.importError', { name: folder.name }), { description: errMsg(err) });
    }
  }
  if (loose.length) {
    if (!loose.some((f) => isTexPath(f.path))) {
      toast.error(t('dashboard.toast.nothingToImport'), { description: t('dashboard.toast.nothingToImportText') });
    } else {
      try {
        created.push(await importFilesProject(nameFromFiles(loose, t('dashboard.importedProject')), loose));
      } catch (err) {
        toast.error(t('dashboard.toast.filesImportError'), { description: errMsg(err) });
      }
    }
  }
  if (created.length) {
    toast.success(t('dashboard.toast.imported', { count: created.length }), {
      action: created.length === 1 ? { label: t('common.open'), onClick: () => openProject(created[0]!) } : undefined,
    });
  }
  if (zips.length) await importZips(zips, { open: false });
}

// ───────────────────────────── manage ─────────────────────────────

export async function downloadProjectZip(id: string) {
  try {
    const { name, data } = await exportProjectZip(id);
    downloadBlob(data, name, 'application/zip');
  } catch (err) {
    toast.error(t('dashboard.toast.exportError'), { description: errMsg(err) });
  }
}

export async function duplicate(id: string) {
  try {
    const copy = await duplicateProject(id);
    toast.success(t('dashboard.toast.duplicated'), { action: { label: t('common.open'), onClick: () => openProject(copy) } });
    return copy;
  } catch (err) {
    toast.error(t('dashboard.toast.duplicateError'), { description: errMsg(err) });
  }
}

export async function rename(id: string, name: string) {
  const n = name.trim();
  if (!n) return;
  try {
    await renameProject(id, n);
  } catch (err) {
    toast.error(t('dashboard.toast.renameError'), { description: errMsg(err) });
  }
}

export async function setStarred(ids: string[], starred: boolean) {
  for (const id of ids) await updateSummary(id, { starred });
}

export async function setTags(id: string, tags: string[]) {
  await updateSummary(id, { tags });
  try {
    await withProject(id, (p) => p.setMeta({ tags }));
  } catch {
    /* summary is enough for the dashboard */
  }
}

export async function moveToTrash(ids: string[]) {
  const projects = useProjects.getState().projects;
  for (const id of ids) await trashProject(id, true);
  const first = projects.find((p) => p.id === ids[0]);
  toast(ids.length === 1 ? t('dashboard.toast.movedOne', { name: first?.name ?? t('dashboard.toast.projectFallback') }) : t('dashboard.toast.movedMany', { count: ids.length }), {
    action: { label: t('common.undo'), onClick: () => void restore(ids, true) },
  });
}

export async function restore(ids: string[], silent = false) {
  for (const id of ids) await trashProject(id, false);
  if (!silent) toast.success(t('dashboard.toast.restored', { count: ids.length }));
}

export async function deleteForever(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const projects = useProjects.getState().projects;
  const one = ids.length === 1 ? projects.find((p) => p.id === ids[0]) : undefined;
  const ok = await confirmDialog({
    title: one ? t('dashboard.confirm.deleteOne', { name: one.name }) : t('dashboard.confirm.deleteMany', { count: ids.length }),
    message: t('dashboard.confirm.deleteMessage'),
    confirmLabel: t('dashboard.confirm.deleteLabel'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });
  if (!ok) return false;
  for (const id of ids) await deleteProjectForever(id);
  toast.success(t('dashboard.toast.deleted', { count: ids.length }));
  return true;
}

export async function emptyTrash() {
  const ids = useProjects.getState().projects.filter((p) => p.trashed).map((p) => p.id);
  return deleteForever(ids);
}

// ───────────────────────────── collaboration ─────────────────────────────

/**
 * Turn an invite link (https://…/#/join/<room>?k=…, texit://join/…, or a bare
 * "#/join/…" / "join/…") into the in-app route to navigate to.
 */
export function parseJoinLink(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const i = s.indexOf('/join/');
  let rest: string | null = null;
  if (i >= 0) rest = s.slice(i + '/join/'.length);
  else if (s.startsWith('join/')) rest = s.slice(5);
  if (!rest) return null;
  const room = rest.split(/[?#&]/)[0];
  if (!room || !/^[\w-]{4,}$/.test(room)) return null;
  return `/join/${rest}`;
}

export function projectsByTag(projects: ProjectSummary[]) {
  const map = new Map<string, number>();
  for (const p of projects) if (!p.trashed) for (const tag of p.tags ?? []) map.set(tag, (map.get(tag) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
