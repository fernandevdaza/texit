/**
 * IndexedDB persistence for the plugin system (database `texit-plugins`):
 *
 *   installed            → InstalledRecord[]          (third-party plugins)
 *   builtin-enabled      → Record<pluginId, boolean>  (built-in toggles)
 *   settings:<pluginId>  → Record<string, unknown>    (api.settings)
 *   storage:<pluginId>:<key> → unknown                (api.storage)
 *
 * Every function degrades to an in-memory map when IndexedDB is unavailable
 * (unit tests, private windows that block IDB).
 */
import { createStore, del, delMany, get, keys, set, type UseStore } from 'idb-keyval';
import type { PluginManifest, PluginPermission } from '@texit/plugin-api';

export type PluginSource = 'builtin' | 'url' | 'file' | 'registry';

export interface InstalledRecord {
  id: string;
  source: Exclude<PluginSource, 'builtin'>;
  /** Module URL (url / registry installs). */
  url?: string;
  /** Module source text (file installs — re-imported through a Blob URL). */
  code?: string;
  fileName?: string;
  enabled: boolean;
  /** Serializable copy of the manifest captured at install time. */
  manifest: PluginManifest;
  /** Permissions the user approved. */
  granted: PluginPermission[];
  installedAt: number;
  updatedAt: number;
}

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  delMany(keys: string[]): Promise<void>;
}

function idbKV(store: UseStore): KV {
  return {
    get: (k) => get(k, store),
    set: (k, v) => set(k, v, store),
    del: (k) => del(k, store),
    keys: async () => (await keys(store)).map(String),
    delMany: (ks) => delMany(ks, store),
  };
}

export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => structuredClone(m.get(k)) as any,
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    keys: async () => Array.from(m.keys()),
    delMany: async (ks) => ks.forEach((k) => m.delete(k)),
  };
}

let kv: KV | null = null;
export function pluginKV(): KV {
  if (!kv) {
    try {
      kv = typeof indexedDB !== 'undefined' ? idbKV(createStore('texit-plugins', 'kv')) : memoryKV();
    } catch {
      kv = memoryKV();
    }
  }
  return kv;
}

/** Tests can swap the backing store. */
export function setPluginKV(next: KV) {
  kv = next;
}

export const loadInstalled = async () => ((await pluginKV().get<InstalledRecord[]>('installed')) ?? []).filter((r) => r && r.id);
export const saveInstalled = (records: InstalledRecord[]) => pluginKV().set('installed', records);
export const loadBuiltinEnabled = async () => (await pluginKV().get<Record<string, boolean>>('builtin-enabled')) ?? {};
export const saveBuiltinEnabled = (flags: Record<string, boolean>) => pluginKV().set('builtin-enabled', flags);

export const loadPluginSettings = async (id: string) => (await pluginKV().get<Record<string, unknown>>(`settings:${id}`)) ?? {};
export const savePluginSettings = (id: string, values: Record<string, unknown>) => pluginKV().set(`settings:${id}`, values);

const storageKey = (id: string, key: string) => `storage:${id}:${key}`;
export const storageGet = <T>(id: string, key: string) => pluginKV().get<T>(storageKey(id, key));
export const storageSet = (id: string, key: string, value: unknown) => pluginKV().set(storageKey(id, key), value);
export const storageDelete = (id: string, key: string) => pluginKV().del(storageKey(id, key));

/** Remove everything a plugin stored (settings + storage). Used on uninstall. */
export async function clearPluginData(id: string): Promise<void> {
  const store = pluginKV();
  const all = await store.keys();
  const mine = all.filter((k) => k === `settings:${id}` || k.startsWith(`storage:${id}:`));
  if (mine.length) await store.delMany(mine);
}
