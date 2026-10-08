import * as core from '@texit/core';
import type { ProjectTemplate } from '@texit/core';
import { t as tr, type Locale, getLocale, translate } from '@/lib/i18n';
import { parseLatexPreview, type DocPreview } from './preview';

const fallbackLabels: Record<string, string> = {
  basic: 'Basic',
  academic: 'Academic',
  presentation: 'Presentations',
  cv: 'CV & résumé',
  letter: 'Letters',
  book: 'Books & theses',
  poster: 'Posters',
  other: 'Other',
};
const fallbackOrder = ['basic', 'academic', 'presentation', 'book', 'cv', 'letter', 'poster', 'other'];

export interface CategoryInfo {
  id: string;
  label: string;
}

/** Categories from `@texit/core`'s `templateCategories` when available (array or record), else built-ins. */
export function templateCategoryList(templates: ProjectTemplate[]): CategoryInfo[] {
  const raw = (core as Record<string, unknown>).templateCategories;
  let list: CategoryInfo[] = [];
  if (Array.isArray(raw)) {
    list = raw
      .map((c) => {
        if (typeof c === 'string') return { id: c, label: fallbackLabels[c] ?? c };
        const o = c as Record<string, unknown>;
        const id = String(o.id ?? o.value ?? '');
        return { id, label: String(o.label ?? o.name ?? o.title ?? fallbackLabels[id] ?? id) };
      })
      .filter((c) => c.id);
  } else if (raw && typeof raw === 'object') {
    list = Object.entries(raw as Record<string, unknown>).map(([id, v]) => ({
      id,
      label: typeof v === 'string' ? v : String((v as Record<string, unknown>)?.label ?? (v as Record<string, unknown>)?.name ?? fallbackLabels[id] ?? id),
    }));
  }
  if (!list.length) list = fallbackOrder.map((id) => ({ id, label: fallbackLabels[id]! }));
  const used = new Set(templates.map((t) => t.category));
  const known = new Set(list.map((c) => c.id));
  for (const t of templates) if (!known.has(t.category)) (list.push({ id: t.category, label: fallbackLabels[t.category] ?? t.category }), known.add(t.category));
  return list.filter((c) => used.has(c.id as ProjectTemplate['category']));
}

/** Localized template name (translated by id; falls back to the template's own English name). */
export function templateName(t: ProjectTemplate, locale: Locale = getLocale()): string {
  return translate(locale, `templates.${t.id}.name`, undefined, t.name);
}

/** Localized template description. */
export function templateDescription(t: ProjectTemplate, locale: Locale = getLocale()): string {
  return translate(locale, `templates.${t.id}.description`, undefined, t.description);
}

/** Localized category label. */
export function categoryLabel(c: CategoryInfo, locale: Locale = getLocale()): string {
  return translate(locale, `templates.category.${c.id}`, undefined, c.label);
}

/** Default project name for a template ("Untitled project" for the blank one). */
export function defaultProjectName(t?: ProjectTemplate): string {
  return !t || t.id === 'blank' ? tr('dashboard.untitledProject') : templateName(t);
}

const cache = new WeakMap<ProjectTemplate, DocPreview>();

export function templatePreview(t: ProjectTemplate): DocPreview {
  let p = cache.get(t);
  if (!p) {
    const main = t.files.find((f) => f.path === t.main) ?? t.files.find((f) => f.path.endsWith('.tex'));
    p = parseLatexPreview(typeof main?.content === 'string' ? main.content : '');
    if (!p.title || /^untitled$/i.test(p.title)) p = { ...p, title: t.id === 'blank' ? 'Untitled' : t.name };
    if (t.category === 'presentation' && p.kind === 'article') p = { ...p, kind: 'slides' };
    if (t.category === 'cv' && p.kind === 'article') p = { ...p, kind: 'cv' };
    if (t.category === 'letter' && p.kind === 'article') p = { ...p, kind: 'letter' };
    if (t.category === 'poster' && p.kind === 'article') p = { ...p, kind: 'poster' };
    cache.set(t, p);
  }
  return p;
}

/** First color found in a CSS gradient string (accent for slide title bars etc.). */
export function accentColor(css?: string, fallback = '#5b5bf0'): string {
  return /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i.exec(css ?? '')?.[0] ?? fallback;
}

/** Background used behind the paper on template cards (template accent softened). */
export function templateBackground(t: ProjectTemplate): string {
  const a = accentColor(t.accent);
  return `radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, ${a} 55%, transparent), transparent 70%), ${t.accent ?? `linear-gradient(135deg, ${a}, #a35cff)`}`;
}

/** Pick N templates spanning different categories (hero quick-picks). */
export function featuredTemplates(templates: ProjectTemplate[], n = 6): ProjectTemplate[] {
  const out: ProjectTemplate[] = [];
  const seen = new Set<string>();
  for (const t of templates) if (!seen.has(t.category)) (out.push(t), seen.add(t.category));
  for (const t of templates) if (out.length < n && !out.includes(t)) out.push(t);
  return out.slice(0, n);
}
