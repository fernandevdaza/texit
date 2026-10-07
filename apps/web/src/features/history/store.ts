/**
 * Version history storage (IndexedDB database `texit-history`, store `versions`):
 *
 *   idx:<projectId>  → VersionMeta[]  (newest first; small, loaded for the panel)
 *   upd:<versionId>  → Uint8Array     (Y.encodeStateAsUpdate of the project doc)
 *
 * Writes to a project's index are serialized through a per-project lock.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createStore, del, delMany, get, keys, set, type UseStore } from 'idb-keyval';
import type { ChangeSummary } from './textDiff';
import type { VersionKind } from './prune';

export interface VersionMeta {
  id: string;
  projectId: string;
  createdAt: number;
  kind: VersionKind;
  /** User label (named versions, safety snapshots). */
  label?: string;
  author: { name: string; color: string };
  /** Bytes of the stored Yjs update. */
  size: number;
  /** Changes relative to the previous version. */
  changes: ChangeSummary;
  /** Number of files in this version. */
  fileCount: number;
}

interface KV {
  get<T>(k: string): Promise<T | undefined>;
  set(k: string, v: unknown): Promise<void>;
  del(k: string): Promise<void>;
  delMany(k: string[]): Promise<void>;
  keys(): Promise<string[]>;
}

function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k) as any,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
    delMany: async (ks) => ks.forEach((k) => m.delete(k)),
    keys: async () => [...m.keys()],
  };
}

let kv: KV | null = null;
function store(): KV {
  if (kv) return kv;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no idb');
    const s: UseStore = createStore('texit-history', 'versions');
    kv = {
      get: (k) => get(k, s),
      set: (k, v) => set(k, v, s),
      del: (k) => del(k, s),
      delMany: (k) => delMany(k, s),
      keys: async () => (await keys(s)).map(String),
    };
  } catch {
    kv = memoryKV();
  }
  return kv;
}

const locks = new Map<string, Promise<unknown>>();
/** Serialize async read-modify-write operations per project. */
export function withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    projectId,
    next.catch(() => {}),
  );
  return next;
}

export async function readIndex(projectId: string): Promise<VersionMeta[]> {
  return ((await store().get<VersionMeta[]>(`idx:${projectId}`)) ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function writeIndex(projectId: string, list: VersionMeta[]): Promise<void> {
  await store().set(`idx:${projectId}`, [...list].sort((a, b) => b.createdAt - a.createdAt));
}

export const readUpdate = (versionId: string) => store().get<Uint8Array>(`upd:${versionId}`);
export const writeUpdate = (versionId: string, data: Uint8Array) => store().set(`upd:${versionId}`, data);
export const deleteUpdates = (ids: string[]) => store().delMany(ids.map((id) => `upd:${id}`));

/** Remove every stored version of a project (call when a project is deleted forever). */
export async function deleteProjectHistory(projectId: string): Promise<void> {
  await withLock(projectId, async () => {
    const list = await readIndex(projectId);
    await deleteUpdates(list.map((v) => v.id));
    await store().del(`idx:${projectId}`);
  });
}

// ───────────────────────────── UI state ─────────────────────────────

interface HistoryState {
  projectId: string | null;
  versions: VersionMeta[];
  loading: boolean;
  /** Time of the last local change not yet captured in a version (null = up to date). */
  dirtySince: number | null;
  /** A snapshot is being written. */
  saving: boolean;
}

export const useHistory = create<HistoryState>(() => ({ projectId: null, versions: [], loading: false, dirtySince: null, saving: false }));

export interface HistoryPrefs {
  /** Minutes between automatic versions while there are changes (0 = off). */
  intervalMin: number;
  showAuto: boolean;
  set(patch: Partial<Omit<HistoryPrefs, 'set'>>): void;
}

export const useHistoryPrefs = create<HistoryPrefs>()(
  persist(
    (setState) => ({
      intervalMin: 5,
      showAuto: true,
      set: (patch) => setState(patch),
    }),
    { name: 'texit:history', version: 1 },
  ),
);
