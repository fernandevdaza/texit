/**
 * Localized views of plugin manifests (`PluginManifest.locales`): name,
 * description and settings labels in the current UI language, with the plain
 * (English) fields as fallback.
 */
import { useMemo } from 'react';
import type { PluginManifest, PluginManifestLocalization } from '@texit/plugin-api';
import { getLocale, useLocale } from '@/lib/i18n';

/** Best match for `locale` in the manifest's `locales` (exact tag, then base language). */
export function manifestLocalization(m: Pick<PluginManifest, 'locales'>, locale: string): PluginManifestLocalization | undefined {
  const all = m.locales;
  if (!all || typeof all !== 'object') return undefined;
  const base = locale.toLowerCase().split('-')[0];
  if (all[locale]) return all[locale];
  if (all[base]) return all[base];
  const hit = Object.keys(all).find((k) => k.toLowerCase().split('-')[0] === base);
  return hit ? all[hit] : undefined;
}

const cache = new WeakMap<PluginManifest, Map<string, PluginManifest>>();

/** The manifest with its user-visible strings translated (stable object per manifest + locale). */
export function localizeManifest<M extends PluginManifest>(m: M, locale: string = getLocale()): M {
  const loc = manifestLocalization(m, locale);
  if (!loc) return m;
  let byLocale = cache.get(m);
  if (!byLocale) cache.set(m, (byLocale = new Map()));
  const hit = byLocale.get(locale);
  if (hit) return hit as M;
  const out: M = {
    ...m,
    name: loc.name || m.name,
    description: loc.description ?? m.description,
    settings: m.settings?.map((s) => {
      const ls = loc.settings?.[s.key];
      if (!ls) return s;
      return {
        ...s,
        title: ls.title ?? s.title,
        description: ls.description ?? s.description,
        placeholder: ls.placeholder ?? s.placeholder,
        options: s.options?.map((o) => ({ ...o, label: ls.options?.[o.value] ?? o.label })),
      };
    }),
  };
  byLocale.set(locale, out);
  return out;
}

/** Display name of a plugin in the current language. */
export function pluginName(m: PluginManifest): string {
  return localizeManifest(m).name;
}

/** Reactive variant of `localizeManifest`. */
export function useLocalizedManifest<M extends PluginManifest>(m: M): M {
  const locale = useLocale();
  return useMemo(() => localizeManifest(m, locale), [m, locale]);
}
