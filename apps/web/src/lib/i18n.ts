/**
 * Tiny i18n layer (no dependencies).
 *
 * Each feature registers its own messages next to its code:
 *
 *   // features/files/i18n.ts
 *   import { registerMessages } from '@/lib/i18n';
 *   registerMessages({
 *     en: { 'files.newFile': 'New file', 'files.count_one': '{count} file', 'files.count_other': '{count} files' },
 *     es: { 'files.newFile': 'Nuevo archivo', 'files.count_one': '{count} archivo', 'files.count_other': '{count} archivos' },
 *   });
 *
 * and translates with `const t = useT(); t('files.newFile')` in components
 * (re-renders when the language changes) or `t('…')` outside React.
 *
 * Conventions:
 *  - Keys are `<feature>.<thing>` (camelCase leaf). English is the source of truth and the fallback.
 *  - Interpolation: `{name}`. Plurals: pass `{ count }` and define `<key>_one` / `<key>_other`.
 *  - Command titles/categories and panel titles are translated by id: `cmd.<commandId>`,
 *    `cmdCategory.<Category>`, `panel.<panelId>` (see `commandTitle`, `panelTitle`).
 */
import { create } from 'zustand';
import { useSettings } from '@/state/settings';

export type Locale = 'en' | 'es';
export const locales: { id: Locale; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'es', label: 'Spanish', native: 'Español' },
];

type Messages = Record<string, string>;
const catalogs: Record<Locale, Messages> = { en: {}, es: {} };

/** Bumped when messages are registered (lazy-loaded features) so hooks re-render. */
const useCatalogVersion = create<{ v: number }>(() => ({ v: 0 }));

export function registerMessages(messages: Partial<Record<Locale, Messages>>): void {
  for (const [loc, msgs] of Object.entries(messages) as [Locale, Messages][]) {
    if (catalogs[loc] && msgs) Object.assign(catalogs[loc], msgs);
  }
  useCatalogVersion.setState((s) => ({ v: s.v + 1 }));
}

export function getLocale(): Locale {
  const l = useSettings.getState().locale;
  return l === 'es' ? 'es' : 'en';
}

/** BCP-47 tag for Intl APIs. */
export function intlLocale(locale: Locale = getLocale()): string {
  return locale === 'es' ? 'es' : 'en';
}

export type TranslateVars = Record<string, string | number | undefined | null>;

function lookup(locale: Locale, key: string): string | undefined {
  return catalogs[locale][key] ?? (locale !== 'en' ? catalogs.en[key] : undefined);
}

export function translate(locale: Locale, key: string, vars?: TranslateVars, fallback?: string): string {
  let msg: string | undefined;
  if (vars && typeof vars.count === 'number') {
    const cat = new Intl.PluralRules(intlLocale(locale)).select(vars.count);
    msg = lookup(locale, `${key}_${cat}`) ?? lookup(locale, `${key}_other`);
  }
  msg ??= lookup(locale, key);
  if (msg === undefined) {
    if (import.meta.env.DEV && fallback === undefined && !missing.has(key)) {
      missing.add(key);
      console.debug(`[i18n] missing key: ${key}`);
    }
    msg = fallback ?? key;
  }
  if (!vars) return msg;
  return msg.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null) return m;
    return typeof v === 'number' ? v.toLocaleString(intlLocale(locale)) : String(v);
  });
}

const missing = new Set<string>();

export type TFunction = (key: string, vars?: TranslateVars, fallback?: string) => string;

/** Translate with the current locale (non-reactive; use `useT` in components). */
export const t: TFunction = (key, vars, fallback) => translate(getLocale(), key, vars, fallback);

/** Reactive translator: re-renders on language change or when new messages load. */
export function useT(): TFunction {
  const locale = useSettings((s) => (s.locale === 'es' ? 'es' : 'en')) as Locale;
  useCatalogVersion((s) => s.v);
  return (key, vars, fallback) => translate(locale, key, vars, fallback);
}

export function useLocale(): Locale {
  return useSettings((s) => (s.locale === 'es' ? 'es' : 'en')) as Locale;
}

// ───────────────────── registries translated by id ─────────────────────

/** Title of a command in the current language (falls back to its registered English title). */
export function commandTitle(cmd: { id: string; title: string }, locale: Locale = getLocale()): string {
  return translate(locale, `cmd.${cmd.id}`, undefined, cmd.title);
}

export function commandCategory(category: string | undefined, locale: Locale = getLocale()): string {
  if (!category) return '';
  return translate(locale, `cmdCategory.${category}`, undefined, category);
}

export function panelTitle(panel: { id: string; title: string }, locale: Locale = getLocale()): string {
  return translate(locale, `panel.${panel.id}`, undefined, panel.title);
}

/** Keep <html lang> in sync. Call once at startup. */
export function initI18n() {
  const apply = () => {
    document.documentElement.lang = getLocale();
  };
  apply();
  useSettings.subscribe((s, p) => {
    if (s.locale !== p.locale) apply();
  });
}
