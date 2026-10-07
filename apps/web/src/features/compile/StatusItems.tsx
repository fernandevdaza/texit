import { AlertCircle, AlertTriangle, CheckCircle2, CircleSlash, CloudDownload, Cpu, Globe, Cloud, Puzzle } from 'lucide-react';
import { StatusButton } from '@/features/workspace/StatusBar';
import { formatDuration } from '@/lib/format';
import { useLayout, useWorkspace } from '@/state/workspace';
import { useSettings } from '@/state/settings';
import { Spinner } from '@/ui';
import { BACKEND_SHORT, ENGINE_LABELS, useCompileUi } from './controller';
import { formatElapsed, useDiagnosticCounts, useElapsed } from './hooks';

/** Left: compile status ("Compiled in 0.4 s", "3 errors", "Downloading TeX Live 43%"). */
export function CompileStatusItem() {
  const c = useWorkspace((s) => s.compile);
  const counts = useDiagnosticCounts();
  const lastMs = useCompileUi((s) => s.lastDurationMs);
  const busy = c.status === 'preparing' || c.status === 'compiling';
  const elapsed = useElapsed(c.startedAt, busy, 250);
  const open = () => useLayout.getState().showBottomPanel(c.status === 'error' && !counts.errors ? 'log' : 'problems');

  let content: React.ReactNode;
  if (c.status === 'preparing' && c.progress !== undefined) {
    content = (
      <>
        <CloudDownload className="text-accent" />
        <span className="tabular-nums">{c.detail ?? `Downloading ${Math.round(c.progress * 100)}%`}</span>
      </>
    );
  } else if (busy) {
    content = (
      <>
        <Spinner className="size-3" />
        <span className="tabular-nums">{c.status === 'preparing' ? c.detail ?? 'Preparing…' : `Compiling… ${formatElapsed(elapsed)}`}</span>
      </>
    );
  } else if (c.status === 'error') {
    content = (
      <>
        <AlertCircle className="text-danger" />
        <span>{counts.errors ? `${counts.errors} error${counts.errors === 1 ? '' : 's'}` : 'Compilation failed'}</span>
      </>
    );
  } else if (c.status === 'success') {
    content = (
      <>
        <CheckCircle2 className="text-success" />
        <span className="tabular-nums">Compiled{lastMs !== undefined ? ` in ${formatDuration(lastMs)}` : ''}</span>
      </>
    );
  } else if (c.status === 'cancelled') {
    content = (
      <>
        <CircleSlash />
        <span>Cancelled</span>
      </>
    );
  } else return null;

  return (
    <>
      <StatusButton onClick={open} title="Show problems">
        {content}
      </StatusButton>
      {!busy && counts.warnings > 0 && (
        <StatusButton onClick={() => useLayout.getState().showBottomPanel('problems')} title="Warnings">
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
  const engine = lastEngine ?? meta?.engine ?? 'pdflatex';
  const id = backendId || (meta?.compilerBackend && meta.compilerBackend !== 'auto' ? meta.compilerBackend : pref !== 'auto' ? pref : '');
  const Icon = BACKEND_ICON[id] ?? Puzzle;
  return (
    <StatusButton title="Compiler (engine · backend)" onClick={() => document.querySelector<HTMLButtonElement>('[data-compile-menu]')?.click()}>
      {id && <Icon />}
      <span>
        {ENGINE_LABELS[engine as keyof typeof ENGINE_LABELS] ?? engine}
        {id ? ` · ${BACKEND_SHORT[id] ?? id}` : ''}
      </span>
    </StatusButton>
  );
}
