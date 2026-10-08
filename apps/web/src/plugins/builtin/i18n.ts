/**
 * Tiny translation helper for the built-in plugins. Like any third-party
 * plugin, they only use the public API: `api.ui.getLocale()` and
 * `api.ui.onLocaleChange()` (plugin API ≥ 1.2). Each plugin keeps its own
 * small `{ en, es }` message map; English is the fallback.
 *
 *   const tr = createTr(api, MESSAGES);   tr('words', { count: 3 })
 *   const tr = useTr(api, MESSAGES);      // in React panels: re-renders on language change
 *
 * Interpolation: `{name}`. Plurals: pass `{ count }` and define `key_one` / `key_other`.
 */
import { useEffect, useState } from 'react';
import type { PluginAPI } from '@texit/plugin-api';

export type Messages = Record<string, string>;
export type Catalog = { en: Messages } & Partial<Record<string, Messages>>;
export type Vars = Record<string, string | number>;
export type Tr = (key: string, vars?: Vars) => string;

export function translate(catalog: Catalog, locale: string, key: string, vars?: Vars): string {
  const table = catalog[locale] ?? catalog[locale.split('-')[0]] ?? catalog.en;
  const find = (k: string) => table[k] ?? catalog.en[k];
  let msg: string | undefined;
  if (vars && typeof vars.count === 'number') {
    const cat = new Intl.PluralRules(locale).select(vars.count);
    msg = find(`${key}_${cat}`) ?? find(`${key}_other`);
  }
  msg ??= find(key) ?? key;
  if (!vars) return msg;
  return msg.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) return m;
    return typeof v === 'number' ? v.toLocaleString(locale) : v;
  });
}

/** Non-reactive translator (reads the locale on every call). */
export function createTr(api: PluginAPI, catalog: Catalog): Tr {
  return (key, vars) => translate(catalog, api.ui.getLocale(), key, vars);
}

/** Current UI language; re-renders the component when it changes. */
export function usePluginLocale(api: PluginAPI): string {
  const [locale, setLocale] = useState(() => api.ui.getLocale());
  useEffect(() => {
    setLocale(api.ui.getLocale());
    const d = api.ui.onLocaleChange(setLocale);
    return () => d.dispose();
  }, [api]);
  return locale;
}

/** Reactive translator for React panels / modals. */
export function useTr(api: PluginAPI, catalog: Catalog): Tr {
  const locale = usePluginLocale(api);
  return (key, vars) => translate(catalog, locale, key, vars);
}
