import { intlLocale, t } from '@/lib/i18n';

/** "just now", "5 min ago", "3 h ago", then a short date (in the UI language). */
export function formatRelative(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return t('collab.justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('collab.minAgo', { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('collab.hAgo', { count: h });
  return new Date(ts).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' });
}
