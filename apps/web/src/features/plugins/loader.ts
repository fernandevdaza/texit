/** Loading third-party plugin modules (URL or local file) + manifest validation. */
import { PLUGIN_API_VERSION, type PluginManifest, type PluginPermission, type TexitPlugin } from '@texit/plugin-api';
import { t } from '@/lib/i18n';
import './i18n';

const KNOWN_PERMISSIONS: PluginPermission[] = ['project:read', 'project:write', 'editor', 'ui', 'compiler', 'ai', 'network', 'storage'];

export class PluginLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginLoadError';
  }
}

/** Absolute URL for a module specifier (relative URLs resolve against the app). */
export function resolvePluginUrl(url: string): string {
  return new URL(url.trim(), location.href).href;
}

/** Plugins may export `default`, a named `plugin`, or be the module namespace itself. */
export function extractPlugin(mod: any): TexitPlugin {
  const candidate = mod?.default?.activate ? mod.default : mod?.plugin?.activate ? mod.plugin : mod?.activate ? mod : null;
  if (!candidate) throw new PluginLoadError('The module does not export a plugin (expected `export default definePlugin({...})`).');
  validateManifest(candidate);
  return candidate as TexitPlugin;
}

export function validateManifest(p: any): asserts p is PluginManifest {
  if (typeof p !== 'object' || !p) throw new PluginLoadError('Invalid plugin object.');
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(p.id))
    throw new PluginLoadError('Plugin `id` must be a reverse-DNS style string, e.g. "com.example.myplugin".');
  if (typeof p.name !== 'string' || !p.name.trim()) throw new PluginLoadError('Plugin `name` is required.');
  if (typeof p.version !== 'string' || !p.version.trim()) throw new PluginLoadError('Plugin `version` is required.');
  if (p.permissions != null) {
    if (!Array.isArray(p.permissions)) throw new PluginLoadError('`permissions` must be an array.');
    const unknown = p.permissions.filter((x: unknown) => !KNOWN_PERMISSIONS.includes(x as PluginPermission));
    if (unknown.length) throw new PluginLoadError(`Unknown permission(s): ${unknown.join(', ')}`);
  }
  if (!isApiCompatible(p.apiVersion))
    throw new PluginLoadError(t('plugins.apiIncompatible', { required: String(p.apiVersion), host: PLUGIN_API_VERSION }));
}

/** `required` (from the manifest) is satisfied when majors match and required minor ≤ host minor. */
export function isApiCompatible(required: string | undefined, host = PLUGIN_API_VERSION): boolean {
  if (!required) return true;
  const [rM, rm = 0] = required.replace(/^[~^>=v\s]+/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [hM, hm = 0] = host.split('.').map((n) => parseInt(n, 10) || 0);
  return rM === hM && rm <= hm;
}

/** JSON-safe copy of a manifest (no functions). */
export function manifestOf(p: TexitPlugin | PluginManifest): PluginManifest {
  const m: PluginManifest = {
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    author: p.author,
    homepage: p.homepage,
    icon: p.icon,
    apiVersion: p.apiVersion,
    permissions: p.permissions ? [...p.permissions] : undefined,
    tags: p.tags ? [...p.tags] : undefined,
    settings: p.settings ? JSON.parse(JSON.stringify(p.settings)) : undefined,
    locales: p.locales && typeof p.locales === 'object' ? JSON.parse(JSON.stringify(p.locales)) : undefined,
  };
  return JSON.parse(JSON.stringify(m));
}

/** Import a plugin module from a URL (cache-busted on reload) or from source text (Blob URL). */
export async function importPluginModule(spec: { url?: string; code?: string }, bust = false): Promise<TexitPlugin> {
  let mod: unknown;
  if (spec.code != null) {
    const blobUrl = URL.createObjectURL(new Blob([spec.code], { type: 'text/javascript' }));
    try {
      mod = await import(/* @vite-ignore */ blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } else if (spec.url) {
    const abs = new URL(resolvePluginUrl(spec.url));
    if (bust) abs.searchParams.set('texit-reload', Date.now().toString(36));
    try {
      mod = await import(/* @vite-ignore */ abs.href);
    } catch (err) {
      throw new PluginLoadError(t('plugins.couldNotLoadUrl', { url: spec.url, error: err instanceof Error ? err.message : String(err) }));
    }
  } else throw new PluginLoadError('Nothing to load.');
  return extractPlugin(mod);
}

/** Small stable hash of a string (dev-mode change detection). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + s.length;
}
