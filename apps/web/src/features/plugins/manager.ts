/**
 * Plugin manager: installed list, enable/disable, install/uninstall/reload and
 * the activation lifecycle of every plugin (built-in and third-party).
 *
 *   install (URL / file / registry) → permission prompt → persist → activate
 *   startup: load persisted records → activate enabled plugins
 *   disable / uninstall → plugin.deactivate() → dispose every registration
 *   reload → deactivate → re-import module (cache-busted) → activate
 */
import { create } from 'zustand';
import type { PluginManifest, PluginPermission, TexitPlugin } from '@texit/plugin-api';
import { builtinPlugins } from '@/plugins/builtin';
import { createPluginHost, type PluginHostHandle } from './host';
import { hashText, importPluginModule, manifestOf, PluginLoadError, resolvePluginUrl } from './loader';
import {
  clearPluginData,
  loadBuiltinEnabled,
  loadInstalled,
  saveBuiltinEnabled,
  saveInstalled,
  storageDelete,
  storageGet,
  storageSet,
  type InstalledRecord,
  type PluginSource,
} from './persistence';
import { dropSettingsHandle, getSettingsHandle } from './settingsStore';
import { appUi, notifyPluginError, requestPermissionApproval } from './appUi';
import { usePluginPrefs, type RegistryEntry } from './registry';

export type PluginStatus = 'inactive' | 'activating' | 'active' | 'error';

export interface PluginEntry {
  id: string;
  manifest: PluginManifest;
  source: PluginSource;
  builtin: boolean;
  enabled: boolean;
  status: PluginStatus;
  /** Activation / load error. */
  error?: string;
  /** Last runtime error thrown by a plugin callback. */
  lastError?: { message: string; context: string; at: number; count: number };
  url?: string;
  fileName?: string;
  installedAt?: number;
  granted: PluginPermission[];
}

interface PluginsState {
  entries: Record<string, PluginEntry>;
  /** Display order: built-ins first, then installs by date. */
  order: string[];
  ready: boolean;
}

export const usePlugins = create<PluginsState>(() => ({ entries: {}, order: [], ready: false }));

const instances = new Map<string, { plugin: TexitPlugin; host: PluginHostHandle }>();
const modules = new Map<string, TexitPlugin>();
const records = new Map<string, InstalledRecord>();
const sourceHashes = new Map<string, string>();
let builtinFlags: Record<string, boolean> = {};
const ACTIVATE_TIMEOUT = 15000;

const BUILTINS = new Map(builtinPlugins.map((p) => [p.id, p]));

function patch(id: string, p: Partial<PluginEntry>) {
  usePlugins.setState((s) => {
    const cur = s.entries[id];
    if (!cur) return s;
    return { entries: { ...s.entries, [id]: { ...cur, ...p } } };
  });
}

function upsert(entry: PluginEntry) {
  usePlugins.setState((s) => ({
    entries: { ...s.entries, [entry.id]: entry },
    order: s.order.includes(entry.id) ? s.order : [...s.order, entry.id],
  }));
}

function remove(id: string) {
  usePlugins.setState((s) => {
    const entries = { ...s.entries };
    delete entries[id];
    return { entries, order: s.order.filter((x) => x !== id) };
  });
}

export function getEntry(id: string): PluginEntry | undefined {
  return usePlugins.getState().entries[id];
}

async function persistRecords() {
  await saveInstalled(Array.from(records.values()));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ───────────────────────────── errors ─────────────────────────────

/** Isolated runtime error from plugin code: badge + throttled toast. Never throws. */
export function reportPluginError(id: string, err: unknown, context: string) {
  console.error(`[plugin ${id}] error in ${context}`, err);
  // Defer: errors may be reported while React renders (status items).
  queueMicrotask(() => {
    const e = getEntry(id);
    if (!e) return;
    const count = (e.lastError?.count ?? 0) + 1;
    patch(id, { lastError: { message: errMsg(err), context, at: Date.now(), count } });
    notifyPluginError(e.manifest.name, context, errMsg(err), id);
  });
}

// ───────────────────────────── activation ─────────────────────────────

async function loadPlugin(id: string, bust = false): Promise<TexitPlugin> {
  const builtin = BUILTINS.get(id);
  if (builtin) return builtin;
  if (!bust && modules.has(id)) return modules.get(id)!;
  const rec = records.get(id);
  if (!rec) throw new PluginLoadError(`Unknown plugin ${id}`);
  const plugin = await importPluginModule(rec.code != null ? { code: rec.code } : { url: rec.url }, bust);
  if (plugin.id !== id) throw new PluginLoadError(`The module now declares id "${plugin.id}" instead of "${id}".`);
  modules.set(id, plugin);
  return plugin;
}

async function activate(id: string, opts: { bust?: boolean } = {}): Promise<boolean> {
  const entry = getEntry(id);
  if (!entry || instances.has(id)) return !!entry;
  patch(id, { status: 'activating', error: undefined });
  let host: PluginHostHandle | null = null;
  try {
    const plugin = await loadPlugin(id, opts.bust);
    const manifest = manifestOf(plugin);
    const settings = getSettingsHandle(id, manifest);
    if (!settings.loaded) await settings.load();
    host = createPluginHost({
      manifest,
      trusted: entry.builtin,
      granted: entry.granted,
      ui: appUi,
      storage: { get: storageGet, set: storageSet, delete: storageDelete },
      settings,
      onError: (err, ctx) => reportPluginError(id, err, ctx),
    });
    instances.set(id, { plugin, host });
    const result = await withTimeout(Promise.resolve(plugin.activate(host.api)), ACTIVATE_TIMEOUT, 'activate()');
    if (result && typeof (result as { dispose?: unknown }).dispose === 'function') host.track(result as { dispose(): void });
    patch(id, { status: 'active', error: undefined, lastError: undefined, manifest });
    if (usePluginPrefs.getState().devMode) void rememberSourceHash(id);
    return true;
  } catch (err) {
    console.error(`[plugin ${id}] activation failed`, err);
    instances.delete(id);
    host?.dispose();
    patch(id, { status: 'error', error: errMsg(err) });
    appUi.toast(`Plugin "${entry.manifest.name}" failed to start`, { type: 'error', description: errMsg(err) });
    return false;
  }
}

async function deactivate(id: string): Promise<void> {
  const inst = instances.get(id);
  if (!inst) {
    if (getEntry(id)?.status !== 'error') patch(id, { status: 'inactive' });
    return;
  }
  instances.delete(id);
  try {
    if (inst.plugin.deactivate) await withTimeout(Promise.resolve(inst.plugin.deactivate()), 5000, 'deactivate()');
  } catch (err) {
    reportPluginError(id, err, 'deactivate()');
  } finally {
    inst.host.dispose();
    patch(id, { status: 'inactive' });
  }
}

// ───────────────────────────── startup ─────────────────────────────

let initPromise: Promise<void> | null = null;

export function initPlugins(): Promise<void> {
  initPromise ??= (async () => {
    try {
      builtinFlags = await loadBuiltinEnabled();
    } catch {
      builtinFlags = {};
    }
    let installed: InstalledRecord[] = [];
    try {
      installed = await loadInstalled();
    } catch (err) {
      console.error('[plugins] could not read installed plugins', err);
    }
    for (const p of builtinPlugins) {
      upsert({
        id: p.id,
        manifest: manifestOf(p),
        source: 'builtin',
        builtin: true,
        enabled: builtinFlags[p.id] ?? true,
        status: 'inactive',
        granted: p.permissions ?? [],
      });
    }
    for (const r of installed.sort((a, b) => a.installedAt - b.installedAt)) {
      if (BUILTINS.has(r.id)) continue;
      records.set(r.id, r);
      upsert(entryFromRecord(r));
    }
    usePlugins.setState({ ready: true });
    const enabled = usePlugins.getState().order.filter((id) => getEntry(id)?.enabled);
    // Built-ins first (synchronous modules), then remote ones in parallel.
    for (const id of enabled.filter((id) => BUILTINS.has(id))) await activate(id);
    await Promise.allSettled(enabled.filter((id) => !BUILTINS.has(id)).map((id) => activate(id)));
  })();
  return initPromise;
}

function entryFromRecord(r: InstalledRecord): PluginEntry {
  return {
    id: r.id,
    manifest: r.manifest,
    source: r.source,
    builtin: false,
    enabled: r.enabled,
    status: 'inactive',
    url: r.url,
    fileName: r.fileName,
    installedAt: r.installedAt,
    granted: r.granted,
  };
}

// ───────────────────────────── management ─────────────────────────────

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const entry = getEntry(id);
  if (!entry) return;
  patch(id, { enabled });
  if (entry.builtin) {
    builtinFlags = { ...builtinFlags, [id]: enabled };
    await saveBuiltinEnabled(builtinFlags);
  } else {
    const rec = records.get(id);
    if (rec) {
      records.set(id, { ...rec, enabled, updatedAt: Date.now() });
      await persistRecords();
    }
  }
  if (enabled) await activate(id);
  else await deactivate(id);
}

export async function reloadPlugin(id: string): Promise<boolean> {
  const entry = getEntry(id);
  if (!entry) return false;
  await deactivate(id);
  patch(id, { lastError: undefined, error: undefined });
  if (!entry.enabled) {
    // Still re-import to surface load errors and refresh the manifest.
    if (!entry.builtin) {
      try {
        const p = await loadPlugin(id, true);
        refreshManifest(id, p);
      } catch (err) {
        patch(id, { status: 'error', error: errMsg(err) });
        return false;
      }
    }
    return true;
  }
  if (!entry.builtin) {
    try {
      const p = await loadPlugin(id, true);
      if (!(await ensurePermissions(p, entry.granted))) {
        patch(id, { status: 'error', error: 'New permissions were not approved.' });
        return false;
      }
      refreshManifest(id, p);
    } catch (err) {
      patch(id, { status: 'error', error: errMsg(err) });
      return false;
    }
  }
  return activate(id);
}

function refreshManifest(id: string, p: TexitPlugin) {
  const rec = records.get(id);
  const manifest = manifestOf(p);
  if (rec) records.set(id, { ...rec, manifest, updatedAt: Date.now() });
  patch(id, { manifest });
  void persistRecords();
}

/** Ask for any permission not yet granted. Updates the record when approved. */
async function ensurePermissions(p: TexitPlugin, granted: PluginPermission[], source?: string): Promise<boolean> {
  const wanted = p.permissions ?? [];
  const missing = wanted.filter((x) => !granted.includes(x));
  if (!missing.length) return true;
  const ok = await requestPermissionApproval(manifestOf(p), { source, newPermissions: granted.length ? missing : undefined });
  if (!ok) return false;
  const rec = records.get(p.id);
  if (rec) {
    records.set(p.id, { ...rec, granted: [...new Set([...granted, ...wanted])] });
    patch(p.id, { granted: [...new Set([...granted, ...wanted])] });
    await persistRecords();
  }
  return true;
}

export async function uninstallPlugin(id: string): Promise<void> {
  const entry = getEntry(id);
  if (!entry || entry.builtin) return;
  await deactivate(id);
  records.delete(id);
  modules.delete(id);
  sourceHashes.delete(id);
  await persistRecords();
  await clearPluginData(id).catch(() => {});
  dropSettingsHandle(id);
  remove(id);
}

interface InstallSpec {
  source: Exclude<PluginSource, 'builtin'>;
  url?: string;
  code?: string;
  fileName?: string;
}

async function install(spec: InstallSpec): Promise<PluginEntry | null> {
  const plugin = await importPluginModule(spec.code != null ? { code: spec.code } : { url: spec.url }, true);
  if (BUILTINS.has(plugin.id)) throw new PluginLoadError(`"${plugin.id}" is the id of a built-in plugin.`);
  const existing = records.get(plugin.id);
  const manifest = manifestOf(plugin);
  if (existing) {
    const ok = await appUi.confirm({
      title: `Update "${manifest.name}"?`,
      message: `Version ${existing.manifest.version} is installed. Replace it with ${manifest.version}${spec.url ? ` from ${spec.url}` : ''}?`,
    });
    if (!ok) return null;
  }
  const granted = existing?.granted ?? [];
  const wanted = manifest.permissions ?? [];
  const missing = wanted.filter((x) => !granted.includes(x));
  if (!existing || missing.length) {
    const ok = await requestPermissionApproval(manifest, {
      source: spec.url ?? spec.fileName,
      newPermissions: existing ? missing : undefined,
    });
    if (!ok) return null;
  }
  if (existing) await deactivate(plugin.id);
  const now = Date.now();
  const rec: InstalledRecord = {
    id: plugin.id,
    source: spec.source,
    url: spec.url,
    code: spec.code,
    fileName: spec.fileName,
    enabled: true,
    manifest,
    granted: [...new Set([...granted, ...wanted])],
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  records.set(rec.id, rec);
  modules.set(rec.id, plugin);
  await persistRecords();
  upsert(entryFromRecord(rec));
  await activate(rec.id);
  return getEntry(rec.id) ?? null;
}

export async function installFromUrl(url: string, source: 'url' | 'registry' = 'url'): Promise<PluginEntry | null> {
  return install({ source, url: resolvePluginUrl(url) });
}

export async function installFromRegistry(entry: RegistryEntry): Promise<PluginEntry | null> {
  return installFromUrl(entry.url, 'registry');
}

export async function installFromFile(file: File): Promise<PluginEntry | null> {
  if (file.size > 2_000_000) throw new PluginLoadError('Plugin files larger than 2 MB are not supported.');
  const code = await file.text();
  return install({ source: 'file', code, fileName: file.name });
}

/** Debug / tests: ids of plugins with a live host and their registration counts. */
export function activeInstances(): Record<string, number> {
  return Object.fromEntries(Array.from(instances.entries()).map(([id, i]) => [id, i.host.size()]));
}

// ───────────────────────────── developer mode ─────────────────────────────

async function fetchSource(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function rememberSourceHash(id: string) {
  const rec = records.get(id);
  if (!rec?.url) return;
  const text = await fetchSource(rec.url);
  if (text != null) sourceHashes.set(id, hashText(text));
}

let checking = false;
/** Developer mode: reload URL plugins whose source changed (called on window focus). */
export async function reloadChangedPlugins(): Promise<string[]> {
  if (checking) return [];
  checking = true;
  const reloaded: string[] = [];
  try {
    for (const rec of records.values()) {
      if (!rec.url || !rec.enabled) continue;
      const text = await fetchSource(rec.url);
      if (text == null) continue;
      const h = hashText(text);
      const prev = sourceHashes.get(rec.id);
      sourceHashes.set(rec.id, h);
      if (prev && prev !== h) {
        await reloadPlugin(rec.id);
        reloaded.push(rec.manifest.name);
      }
    }
  } finally {
    checking = false;
  }
  if (reloaded.length) appUi.toast(`Reloaded ${reloaded.join(', ')}`, { type: 'info', description: 'Developer mode: source changed.' });
  return reloaded;
}

export async function primeSourceHashes() {
  await Promise.all(Array.from(records.keys()).map(rememberSourceHash));
}
