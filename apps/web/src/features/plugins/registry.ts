/**
 * Community plugin registry (`registry.json`):
 *
 * { "version": 1, "plugins": [ { "id", "name", "description", "author", "version",
 *   "url", "icon", "tags", "homepage", "permissions"? } ] }
 *
 * `url` may be relative to the registry file. A bare array of entries is accepted too.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PluginPermission } from '@texit/plugin-api';

export interface RegistryEntry {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version: string;
  /** Absolute module URL (resolved against the registry location). */
  url: string;
  icon?: string;
  tags?: string[];
  homepage?: string;
  permissions?: PluginPermission[];
}

export const DEFAULT_REGISTRY_URL = `${import.meta.env?.BASE_URL ?? '/'}plugins/registry.json`;

interface PluginPrefs {
  devMode: boolean;
  registryUrl: string;
  set(patch: Partial<Omit<PluginPrefs, 'set'>>): void;
}

export const usePluginPrefs = create<PluginPrefs>()(
  persist(
    (set) => ({
      devMode: false,
      registryUrl: DEFAULT_REGISTRY_URL,
      set: (patch) => set(patch),
    }),
    { name: 'texit:plugins', version: 1 },
  ),
);

export function parseRegistry(json: unknown, baseUrl: string): RegistryEntry[] {
  const list = Array.isArray(json) ? json : Array.isArray((json as any)?.plugins) ? (json as any).plugins : null;
  if (!list) throw new Error('Invalid registry: expected { "plugins": [...] }');
  const out: RegistryEntry[] = [];
  for (const e of list) {
    if (!e || typeof e.id !== 'string' || typeof e.url !== 'string' || typeof e.name !== 'string') continue;
    let url: string;
    try {
      url = new URL(e.url, baseUrl).href;
    } catch {
      continue;
    }
    out.push({
      id: e.id,
      name: e.name,
      description: typeof e.description === 'string' ? e.description : undefined,
      author: typeof e.author === 'string' ? e.author : undefined,
      version: typeof e.version === 'string' ? e.version : '0.0.0',
      url,
      icon: typeof e.icon === 'string' ? e.icon : undefined,
      tags: Array.isArray(e.tags) ? e.tags.filter((t: unknown) => typeof t === 'string') : undefined,
      homepage: typeof e.homepage === 'string' ? e.homepage : undefined,
      permissions: Array.isArray(e.permissions) ? e.permissions : undefined,
    });
  }
  return out;
}

interface RegistryState {
  entries: RegistryEntry[];
  loading: boolean;
  error: string | null;
  loadedFrom: string | null;
  load(force?: boolean): Promise<void>;
}

export const useRegistry = create<RegistryState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  loadedFrom: null,
  async load(force) {
    const url = usePluginPrefs.getState().registryUrl || DEFAULT_REGISTRY_URL;
    if (!force && get().loadedFrom === url && !get().error) return;
    set({ loading: true, error: null });
    try {
      const abs = new URL(url, location.href).href;
      const res = await fetch(abs, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      set({ entries: parseRegistry(await res.json(), abs), loading: false, loadedFrom: url });
    } catch (err) {
      set({ loading: false, error: `Could not load the plugin registry: ${err instanceof Error ? err.message : String(err)}`, loadedFrom: url });
    }
  },
}));

/** Compare dotted versions: >0 when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
