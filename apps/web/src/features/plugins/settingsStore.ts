/**
 * Per-plugin settings: a synchronous in-memory cache (api.settings.get is sync)
 * backed by IndexedDB, shared by the plugin host and the settings form.
 */
import type { Disposable } from '@texit/core';
import type { PluginManifest } from '@texit/plugin-api';
import { Emitter } from '@/lib/emitter';
import { loadPluginSettings, savePluginSettings } from './persistence';

export class PluginSettingsHandle {
  private values: Record<string, unknown> = {};
  private emitter = new Emitter<{ key: string; value: unknown }>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  loaded = false;

  constructor(
    readonly pluginId: string,
    private manifest: PluginManifest,
  ) {}

  setManifest(m: PluginManifest) {
    this.manifest = m;
  }

  async load(): Promise<void> {
    try {
      this.values = await loadPluginSettings(this.pluginId);
    } catch {
      this.values = {};
    }
    this.loaded = true;
  }

  defaultFor(key: string): unknown {
    return this.manifest.settings?.find((s) => s.key === key)?.default;
  }

  get<T>(key: string, fallback?: T): T {
    if (Object.prototype.hasOwnProperty.call(this.values, key)) return this.values[key] as T;
    const d = this.defaultFor(key);
    return (d !== undefined ? d : fallback) as T;
  }

  /** Explicitly stored values (without defaults). */
  all(): Record<string, unknown> {
    return { ...this.values };
  }

  set(key: string, value: unknown) {
    if (value === undefined) delete this.values[key];
    else this.values[key] = value;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void savePluginSettings(this.pluginId, this.values).catch(() => {}), 150);
    this.emitter.emit({ key, value: this.get(key) });
  }

  reset() {
    const keys = Object.keys(this.values);
    this.values = {};
    void savePluginSettings(this.pluginId, {}).catch(() => {});
    for (const key of keys) this.emitter.emit({ key, value: this.get(key) });
  }

  onDidChange(cb: (key: string, value: unknown) => void): Disposable {
    return this.emitter.on(({ key, value }) => cb(key, value));
  }
}

const handles = new Map<string, PluginSettingsHandle>();

export function getSettingsHandle(id: string, manifest: PluginManifest): PluginSettingsHandle {
  let h = handles.get(id);
  if (!h) {
    h = new PluginSettingsHandle(id, manifest);
    handles.set(id, h);
  } else h.setManifest(manifest);
  return h;
}

export function dropSettingsHandle(id: string) {
  handles.delete(id);
}
