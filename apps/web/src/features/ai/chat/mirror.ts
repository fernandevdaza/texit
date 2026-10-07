/**
 * Desktop: keep the open project mirrored to disk for CLI agents.
 *
 * Prefers the desktop feature's `FolderSync` (two-way live mirror, features/desktop) when it
 * exists; otherwise falls back to a one-shot export before the run and an import of the
 * changed files after it.
 */
import { decodeUtf8, isTextPath, type ProjectDoc } from '@texit/core';
import { host } from '@/lib/platform';

interface FolderSyncLike {
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  flush?(): Promise<void> | void;
  syncNow?(): Promise<void> | void;
}

type FolderSyncCtor = new (...args: any[]) => FolderSyncLike;

// Optional module owned by the desktop engineer — resolved at build time without failing if absent.
const desktopModules = import.meta.glob('../../desktop/index.ts');

async function findFolderSync(): Promise<FolderSyncCtor | null> {
  for (const load of Object.values(desktopModules)) {
    try {
      const mod = (await load()) as Record<string, unknown>;
      if (typeof mod.FolderSync === 'function') return mod.FolderSync as FolderSyncCtor;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const live = new Map<string, FolderSyncLike>();

export interface MirrorHandle {
  dir: string;
  /** Pull changes made on disk back into the project (fallback mode); `deleted` = paths the agent reported deleting. */
  finish(deleted: string[]): Promise<void>;
}

function joinAbs(dir: string, rel: string) {
  return `${dir.replace(/[\\/]+$/, '')}/${rel}`;
}

export async function prepareMirror(projectId: string, project: ProjectDoc): Promise<MirrorHandle> {
  if (!host) throw new Error('CLI agents require the desktop app.');
  const dir = await host.fs.projectMirrorDir(projectId);

  const Ctor = await findFolderSync();
  if (Ctor) {
    let sync = live.get(projectId);
    if (!sync) {
      sync = new Ctor({ project, dir, host, initial: 'project-to-disk' });
      live.set(projectId, sync);
      await sync.start?.();
    }
    await (sync.flush ?? sync.syncNow)?.call(sync);
    return { dir, finish: async () => void (await (sync!.flush ?? sync!.syncNow)?.call(sync)) };
  }

  // Fallback: one-shot export.
  for (const f of project.listFiles()) {
    const content = project.readFile(f.id);
    await host.fs.writeFile(joinAbs(dir, f.path), content);
  }
  return {
    dir,
    async finish(deleted) {
      const entries = await host!.fs.readTree(dir);
      const onDisk = new Set<string>();
      project.doc.transact(() => {
        for (const e of entries) {
          onDisk.add(e.path);
          const id = project.findByPath(e.path);
          if (isTextPath(e.path)) {
            const text = decodeUtf8(e.content);
            if (!id) project.createFile(e.path, text);
            else if (project.readText(id) !== text) project.writeFile(id, text);
          } else if (!id) {
            project.createFile(e.path, e.content);
          }
        }
      });
      // Only delete files the agent reported (never infer deletions from the tree alone).
      for (const path of deleted) {
        const id = project.findByPath(path);
        if (id && !onDisk.has(path)) project.delete(id);
      }
    },
  };
}

export function stopMirrors() {
  for (const s of live.values()) void s.stop?.();
  live.clear();
}
