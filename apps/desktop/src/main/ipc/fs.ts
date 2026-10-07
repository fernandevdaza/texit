import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { Invoke, Stream } from '../../shared/ipc';
import { readFileBytes, readTree, renamePath, watchDir, writeFileAtomic, type WatchHandle } from '../files/files';
import { sanitizeProjectId } from '../tex/compile';
import { paths } from '../paths';
import { handle, safeSend, zAbsPath, zBytes, zFilters, zId } from './util';

interface Watch {
  handle: WatchHandle;
  owner: WebContents;
}

const watches = new Map<string, Watch>();
const MAX_PICK_BYTES = 512 * 1024 * 1024;
const EXECUTABLE_EXT =
  /\.(app|exe|com|bat|cmd|msi|msix|scr|pif|cpl|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|jar|command|tool|sh|bash|zsh|csh|fish|run|bin|appimage|desktop|deb|rpm|pkg|dmg|workflow|terminal|scpt|applescript)$/i;

function parentWindow(wc: WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(wc) ?? undefined;
}

async function stopWatch(id: string) {
  const w = watches.get(id);
  if (!w) return;
  watches.delete(id);
  await w.handle.close().catch(() => undefined);
}

export async function stopAllWatches(): Promise<void> {
  await Promise.all(Array.from(watches.keys()).map(stopWatch));
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function registerFsIpc(): void {
  handle(
    Invoke.fsPickDirectory,
    z.tuple([z.object({ title: z.string().max(300).optional(), defaultPath: z.string().max(4096).optional() }).optional()]),
    async (event, opts) => {
      const win = parentWindow(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: opts?.title,
        defaultPath: opts?.defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      };
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
    },
  );

  handle(
    Invoke.fsPickFiles,
    z.tuple([z.object({ title: z.string().max(300).optional(), filters: zFilters.optional(), multiple: z.boolean().optional() }).optional()]),
    async (event, opts) => {
      const win = parentWindow(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: opts?.title,
        filters: opts?.filters,
        properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      };
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (r.canceled || !r.filePaths.length) return null;
      let total = 0;
      const out: { name: string; path: string; content: Uint8Array }[] = [];
      for (const p of r.filePaths) {
        const content = await readFileBytes(p);
        total += content.byteLength;
        if (total > MAX_PICK_BYTES) throw new Error('Selected files are too large (limit 512 MB).');
        out.push({ name: path.basename(p), path: p, content });
      }
      return out;
    },
  );

  handle(
    Invoke.fsSaveFile,
    z.tuple([z.object({ defaultName: z.string().min(1).max(1024), content: zBytes, filters: zFilters.optional() })]),
    async (event, opts) => {
      const win = parentWindow(event.sender);
      const options: Electron.SaveDialogOptions = { defaultPath: opts.defaultName, filters: opts.filters };
      const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (r.canceled || !r.filePath) return null;
      await writeFileAtomic(r.filePath, opts.content);
      return r.filePath;
    },
  );

  handle(Invoke.fsReadTree, z.tuple([zAbsPath]), (_e, dir) => readTree(dir));
  handle(Invoke.fsReadFile, z.tuple([zAbsPath]), (_e, p) => readFileBytes(p));
  handle(Invoke.fsWriteFile, z.tuple([zAbsPath, z.union([zBytes, z.string()])]), (_e, p, content) => writeFileAtomic(p, content));
  handle(Invoke.fsMkdir, z.tuple([zAbsPath]), async (_e, p) => {
    await fs.mkdir(p, { recursive: true });
  });

  handle(Invoke.fsRemove, z.tuple([zAbsPath]), async (_e, p) => {
    const exists = await fs.lstat(p).catch(() => null);
    if (!exists) return;
    try {
      await shell.trashItem(p);
    } catch (err) {
      // Trash unavailable (e.g. some Linux setups): only permanently delete inside TexIt's own mirror dirs.
      if (isInside(path.resolve(p), paths.projects())) await fs.rm(p, { recursive: true, force: true });
      else throw err;
    }
  });

  handle(Invoke.fsRename, z.tuple([zAbsPath, zAbsPath]), (_e, from, to) => renamePath(from, to));

  handle(Invoke.fsWatch, z.tuple([zId, zAbsPath]), async (event, watchId, dir) => {
    await stopWatch(watchId);
    const st = await fs.stat(dir);
    if (!st.isDirectory()) throw new Error(`Not a directory: ${dir}`);
    const owner = event.sender;
    const handleW = watchDir(dir, (events) => {
      if (!safeSend(owner, Stream.fsWatch(watchId), events)) void stopWatch(watchId);
    });
    watches.set(watchId, { handle: handleW, owner });
    owner.once('destroyed', () => void stopWatch(watchId));
  });

  handle(Invoke.fsUnwatch, z.tuple([zId]), (_e, watchId) => stopWatch(watchId));

  handle(Invoke.fsProjectMirrorDir, z.tuple([z.string().min(1).max(200)]), async (_e, projectId) => {
    const dir = path.join(paths.projects(), sanitizeProjectId(projectId));
    await fs.mkdir(dir, { recursive: true });
    return dir;
  });

  handle(Invoke.fsRevealInFolder, z.tuple([zAbsPath]), (_e, p) => shell.showItemInFolder(p));

  handle(Invoke.fsOpenPath, z.tuple([zAbsPath]), async (_e, p) => {
    // Opening a file must never launch a program (project files may come from collaborators).
    if (EXECUTABLE_EXT.test(p)) throw new Error('Refusing to open an executable file; use "Reveal in folder" instead.');
    const st = await fs.stat(p);
    if (st.isFile() && process.platform !== 'win32' && st.mode & 0o111) {
      throw new Error('Refusing to open an executable file; use "Reveal in folder" instead.');
    }
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  });
}
