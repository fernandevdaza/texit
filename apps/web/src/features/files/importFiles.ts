/**
 * Importing files into the project: OS drag & drop (files and whole folders via
 * `webkitGetAsEntry`), the upload button, and .zip extraction.
 */
import { basename, importZip, joinPath, uniquePath, type ProjectDoc } from '@texit/core';
import { confirmDialog, toast } from '@/ui';

export interface PendingFile {
  /** Path relative to the drop target. */
  path: string;
  file: File;
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
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

async function walk(entry: FileSystemEntry, prefix: string, out: PendingFile[]) {
  if (/^(\.DS_Store|Thumbs\.db|__MACOSX|\.git)$/.test(entry.name)) return;
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: joinPath(prefix, entry.name), file });
  } else if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const c of children) await walk(c, joinPath(prefix, entry.name), out);
  }
}

/** Collect files (recursively for folders) from a drop event's DataTransfer. */
export async function collectDropped(dt: DataTransfer): Promise<PendingFile[]> {
  const out: PendingFile[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) out.push({ path: f.name, file: f });
    }
  }
  for (const e of entries) await walk(e, '', out);
  if (!entries.length && !out.length) for (const f of Array.from(dt.files)) out.push({ path: f.name, file: f });
  return out;
}

/**
 * Write files into `folderPath`. A single dropped .zip offers extraction.
 * Returns the ids of the created files.
 */
export async function importIntoProject(project: ProjectDoc, folderPath: string, files: PendingFile[]): Promise<string[]> {
  if (!files.length) return [];
  if (files.length === 1 && /\.zip$/i.test(files[0].path)) {
    const zip = files[0];
    const extract = await confirmDialog({
      title: `Extract “${basename(zip.path)}”?`,
      message: `Unpack the archive into ${folderPath ? `“${folderPath}”` : 'the project root'}, or keep it as a .zip file.`,
      confirmLabel: 'Extract into project',
      cancelLabel: 'Keep as .zip',
    });
    if (extract) {
      try {
        const data = new Uint8Array(await zip.file.arrayBuffer());
        const res = importZip(data, zip.file.name);
        const ids = project.importFiles(res.files, { into: folderPath });
        toast.success(`Extracted ${res.files.length} file${res.files.length === 1 ? '' : 's'}`);
        return ids;
      } catch (err) {
        toast.error('Could not extract the archive', { description: String((err as Error)?.message ?? err) });
        return [];
      }
    }
  }
  const targets = files.map((f) => ({ ...f, target: joinPath(folderPath, f.path) }));
  const clashes = targets.filter((t) => project.existsPath(t.target));
  let replace = true;
  if (clashes.length) {
    replace = await confirmDialog({
      title: clashes.length === 1 ? `Replace “${basename(clashes[0].target)}”?` : `Replace ${clashes.length} existing files?`,
      message: 'Files with the same name already exist in this folder.',
      confirmLabel: 'Replace',
      cancelLabel: 'Keep both',
      danger: true,
    });
  }
  const contents = await Promise.all(targets.map(async (t) => new Uint8Array(await t.file.arrayBuffer())));
  const ids: string[] = [];
  project.doc.transact(() => {
    targets.forEach((t, i) => {
      const path = !replace && project.existsPath(t.target) ? uniquePath(t.target, (p) => project.existsPath(p)) : t.target;
      ids.push(project.createFile(path, contents[i]));
    });
  });
  toast.success(`Added ${ids.length} file${ids.length === 1 ? '' : 's'}`, folderPath ? { description: `to ${folderPath}` } : undefined);
  return ids;
}
