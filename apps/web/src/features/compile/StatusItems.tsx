import { AlertCircle, AlertTriangle, CheckCircle2, CircleSlash, CloudDownload, Cpu, Globe, Cloud, Puzzle } from 'lucide-react';
import { StatusButton } from '@/features/workspace/StatusBar';
import { useT } from '@/lib/i18n';
import { useLayout, useWorkspace } from '@/state/workspace';
import { useSettings } from '@/state/settings';
import { Spinner } from '@/ui';
import { ENGINE_LABELS, useCompileUi } from './controller';
import { backendShort, formatDurationL, formatPercent, localizeDetail } from './format';
import { formatElapsed, useDiagnosticCounts, useElapsed } from './hooks';

/** Left: compile status ("Compiled in 0.4 s", "3 errors", "Downloading TeX Live 43%"). */
export function CompileStatusItem() {
  const c = useWorkspace((s) => s.compile);
  const counts = useDiagnosticCounts();
  const lastMs = useCompileUi((s) => s.lastDurationMs);
  const busy = c.status === 'preparing' || c.status === 'compiling';
  const elapsed = useElapsed(c.startedAt, busy, 250);
  const t = useT();
  const open = () => useLayout.getState().showBottomPanel(c.status === 'error' && !counts.errors ? 'log' : 'problems');

  let content: React.ReactNode;
  if (c.status === 'preparing' && c.progress !== undefined) {
    content = (
      <>
        <CloudDownload className="text-accent" />
        <span className="tabular-nums">{c.detail ? localizeDetail(c.detail, t) : t('compile.status.downloading', { pct: formatPercent(c.progress * 100, t) })}</span>
      </>
    );
  } else if (busy) {
    content = (
      <>
        <Spinner className="size-3" />
        <span className="tabular-nums">{c.status === 'preparing' ? (c.detail ? localizeDetail(c.detail, t) : t('compile.detail.preparing')) : t('compile.status.compilingElapsed', { elapsed: formatElapsed(elapsed, t) })}</span>
      </>
    );
  } else if (c.status === 'error') {
    content = (
      <>
        <AlertCircle className="text-danger" />
        <span>{counts.errors ? t('compile.status.errors', { count: counts.errors }) : t('compile.status.failed')}</span>
      </>
    );
  } else if (c.status === 'success') {
    content = (
      <>
        <CheckCircle2 className="text-success" />
        <span className="tabular-nums">{lastMs !== undefined ? t('compile.status.compiledIn', { duration: formatDurationL(lastMs, t) }) : t('compile.status.compiled')}</span>
      </>
    );
  } else if (c.status === 'cancelled') {
    content = (
      <>
        <CircleSlash />
        <span>{t('compile.status.cancelled')}</span>
      </>
    );
  } else return null;

  return (
    <>
      <StatusButton onClick={open} title={t('compile.status.showProblems')}>
        {content}
      </StatusButton>
      {!busy && counts.warnings > 0 && (
        <StatusButton onClick={() => useLayout.getState().showBottomPanel('problems')} title={t('compile.status.warnings')}>
          <AlertTriangle className="text-warning" />
          <span className="tabular-nums">{counts.warnings}</span>
        </StatusButton>
      )}
    </>
  );
}

const BACKEND_ICON: Record<string, typeof Globe> = { busytex: Globe, native: Cpu, remote: Cloud };

/** Right: "pdfLaTeX · WASM". */
export function EngineStatusItem() {
  const meta = useWorkspace((s) => s.meta);
  const backendId = useWorkspace((s) => s.compile.backendId);
  const lastEngine = useCompileUi((s) => s.lastEngine);
  const pref = useSettings((s) => s.compile.backend);
  const t = useT();
  const engine = lastEngine ?? meta?.engine ?? 'pdflatex';
  const id = backendId || (meta?.compilerBackend && meta.compilerBackend !== 'auto' ? meta.compilerBackend : pref !== 'auto' ? pref : '');
  const Icon = BACKEND_ICON[id] ?? Puzzle;
  return (
    <StatusButton title={t('compile.status.compilerTitle')} onClick={() => document.querySelector<HTMLButtonElement>('[data-compile-menu]')?.click()}>
      {id && <Icon />}
      <span>
        {ENGINE_LABELS[engine as keyof typeof ENGINE_LABELS] ?? engine}
        {id ? ` · ${backendShort(id, t)}` : ''}
      </span>
    </StatusButton>
  );
}
