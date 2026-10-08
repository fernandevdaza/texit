/**
 * Locale-aware formatting for compile UI + translation of the (English)
 * progress/status strings produced by the compile backends.
 *
 * The workspace store keeps the backends' English text (other code parses it,
 * e.g. the "(34%)" in `compilePercent`); it is localized at display time.
 */
import { intlLocale, t as tr, type TFunction } from '@/lib/i18n';
import './i18n';

const num = (n: number, digits: number) => n.toLocaleString(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "0.6 s" / "0,6 s", "240 ms" (localized `formatDuration`). */
export function formatDurationL(ms: number, t: TFunction = tr): string {
  if (ms < 1000) return t('compile.durationMs', { n: String(Math.round(ms)) });
  return t('compile.durationS', { n: num(ms / 1000, ms < 10000 ? 1 : 0) });
}

/** Live elapsed time: "1.2s" / "1,2 s", "2m 05s". */
export function formatElapsedL(ms: number, t: TFunction = tr): string {
  if (ms < 60_000) return t('compile.seconds', { n: num(ms / 1000, 1) });
  return t('compile.minutesSeconds', { m: String(Math.floor(ms / 60_000)), s: String(Math.floor((ms % 60_000) / 1000)) });
}

export function formatPercent(pct: number, t: TFunction = tr): string {
  return t('compile.percent', { pct: String(Math.round(pct)) });
}

const BACKEND_LABELS: Record<string, string> = {
  'Local TeX installation': 'compile.backendLabel.native',
  'Remote compile server': 'compile.backendLabel.remote',
  'Remote server': 'compile.backendLabel.remote',
};

/**
 * Translate a backend progress/status detail ("Downloading TeX Live (recommended) 43%",
 * "Running biber…", "Compiling with TeX Live (WebAssembly)…"). Unknown text is returned as is.
 */
export function localizeDetail(detail: string | undefined | null, t: TFunction = tr): string {
  if (!detail) return '';
  let base = detail.trim();
  let pct = '';
  const pm = /\s(\d{1,3})\s?%$/.exec(base);
  if (pm) {
    pct = ` ${formatPercent(Number(pm[1]), t)}`;
    base = base.slice(0, pm.index);
  }
  return translateBase(base, t) + pct;
}

function translateBase(s: string, t: TFunction): string {
  let m: RegExpExecArray | null;
  if (/^Preparing(…)?$/.test(s)) return t('compile.detail.preparing');
  if (s === 'Compiling…') return t('compile.detail.compiling');
  if (s === 'Compilation cancelled') return t('compile.detail.cancelled');
  if ((m = /^Downloading TeX Live \(([^)]+)\)(…)?(?:\s*·.*)?$/.exec(s))) return t('compile.detail.downloadingTexLive', { tier: m[1] }) + (m[2] ?? '');
  if ((m = /^Downloading (.+?)(…)?$/.exec(s))) return t('compile.detail.downloading', { what: m[1] }) + (m[2] ?? '');
  if ((m = /^Loading TeX Live \(([^)]+)\) from cache…$/.exec(s))) return t('compile.detail.loadingFromCache', { tier: m[1] });
  if ((m = /^Starting TeX engine \(([^)]+)\)…$/.exec(s))) return t('compile.detail.startingEngine', { tier: m[1] });
  if ((m = /^Compiling with (.+)…$/.exec(s))) {
    const key = BACKEND_LABELS[m[1]];
    return t('compile.detail.compilingWith', { what: key ? t(key) : m[1] });
  }
  if ((m = /^Running (.+)…$/.exec(s))) return t('compile.detail.running', { tool: m[1] });
  if ((m = /^Could not start TeX Live: ([\s\S]+)$/.exec(s))) return t('compile.detail.couldNotStart', { error: m[1] });
  return s;
}

/** Status text of a compile backend shown in the compile menu (native / remote). */
export function localizeBackendDetail(detail: string, t: TFunction = tr): string {
  switch (detail) {
    case 'Only available in the desktop app':
      return t('compile.native.desktopOnly');
    case 'Could not detect a TeX installation':
      return t('compile.native.detectFailed');
    case 'No TeX installation found — install TeX Live, MacTeX, MiKTeX or Tectonic':
      return t('compile.native.notFound');
    case 'No compile server URL configured':
      return t('compile.remote.noUrl');
    default:
      return detail;
  }
}

/** Why an engine was chosen ("project setting", "uses fontspec", "% !TEX program = …"). */
export function localizeEngineReason(reason: string, t: TFunction = tr): string {
  if (reason === 'project setting') return t('compile.reason.projectSetting');
  let m: RegExpExecArray | null;
  if ((m = /^uses (.+)$/.exec(reason))) return t('compile.reason.uses', { what: m[1] });
  if ((m = /^class (.+)$/.exec(reason))) return t('compile.reason.class', { what: m[1] });
  return reason;
}

/** "WASM" / "Nativo" / "Remoto" (status bar & summaries). */
export function backendShort(id: string, t: TFunction = tr): string {
  if (id === 'busytex') return 'WASM';
  if (id === 'native' || id === 'remote') return t(`compile.backendShort.${id}`);
  return id;
}
