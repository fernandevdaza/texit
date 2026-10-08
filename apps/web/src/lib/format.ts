import { intlLocale } from './i18n';

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();

export function timeAgo(ts: number): string {
  const loc = intlLocale();
  let rtf = rtfCache.get(loc);
  if (!rtf && typeof Intl !== 'undefined') rtfCache.set(loc, (rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' })));
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return new Date(ts).toLocaleString(loc);
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 2700) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 64800) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 518400) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 2419200) return rtf.format(Math.round(diff / 604800), 'week');
  return new Date(ts).toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatBytes(bytes: number): string {
  const loc = intlLocale();
  if (bytes < 1024) return `${bytes.toLocaleString(loc)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v < 10 ? 1 : 0;
  return `${v.toLocaleString(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  const loc = intlLocale();
  if (ms < 1000) return `${Math.round(ms).toLocaleString(loc)} ms`;
  const digits = ms < 10000 ? 1 : 0;
  return `${(ms / 1000).toLocaleString(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits })} s`;
}

export function downloadBlob(data: Uint8Array | Blob | string, filename: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
