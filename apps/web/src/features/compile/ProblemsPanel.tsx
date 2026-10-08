import { memo, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  Lightbulb,
  MessageCircleQuestion,
  Play,
  ScrollText,
  Sparkles,
  SquareDashed,
  PartyPopper,
} from 'lucide-react';
import type { Diagnostic, DiagnosticSeverity } from '@texit/core';
import { FileIcon } from '@/features/files/FileIcon';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { executeCommand } from '@/services/commands';
import { getAiBridge } from '@/services/ai';
import { useLayout, useWorkspace } from '@/state/workspace';
import { Button, EmptyState, Spinner, Tooltip } from '@/ui';
import { ENGINE_LABELS, useCompileUi } from './controller';
import { backendShort, formatDurationL } from './format';
import { aiPrompt, hintFor } from './hints';
import { useDiagnosticCounts } from './hooks';

/** `label` / `plural` are i18n keys. */
const SEVERITY: Record<DiagnosticSeverity, { icon: typeof AlertCircle; cls: string; label: string; plural: string }> = {
  error: { icon: AlertCircle, cls: 'text-danger', label: 'compile.sev.error', plural: 'compile.sev.errors' },
  warning: { icon: AlertTriangle, cls: 'text-warning', label: 'compile.sev.warning', plural: 'compile.sev.warnings' },
  badbox: { icon: SquareDashed, cls: 'text-fg-subtle', label: 'compile.sev.badbox', plural: 'compile.sev.badboxes' },
  info: { icon: Info, cls: 'text-info', label: 'compile.sev.info', plural: 'compile.sev.infos' },
};
const ORDER: DiagnosticSeverity[] = ['error', 'warning', 'badbox', 'info'];
const RANK: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, badbox: 2, info: 3 };

export function ProblemsPanel() {
  const diagnostics = useWorkspace((s) => s.compile.diagnostics);
  const status = useWorkspace((s) => s.compile.status);
  const backendId = useWorkspace((s) => s.compile.backendId);
  const hasResult = useWorkspace((s) => !!s.compile.result);
  const project = useWorkspace((s) => s.project);
  useWorkspace((s) => s.treeVersion); // re-resolve clickable files on tree changes
  const counts = useDiagnosticCounts();
  const lastMs = useCompileUi((s) => s.lastDurationMs);
  const engine = useCompileUi((s) => s.lastEngine);
  const t = useT();
  const [hidden, setHidden] = useState<Set<DiagnosticSeverity>>(() => new Set(['badbox', 'info']));
  const toggle = (sev: DiagnosticSeverity) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(sev)) n.delete(sev);
      else n.add(sev);
      return n;
    });

  const groups = useMemo(() => {
    const visible = diagnostics.filter((d) => !hidden.has(d.severity));
    const map = new Map<string, Diagnostic[]>();
    for (const d of visible) {
      const key = d.file ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return [...map.entries()]
      .map(([file, items]) => ({
        file,
        items: items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.line ?? 0) - (b.line ?? 0)),
        worst: Math.min(...items.map((d) => RANK[d.severity])),
      }))
      .sort((a, b) => a.worst - b.worst || (a.file === '' ? 1 : b.file === '' ? -1 : a.file.localeCompare(b.file)));
  }, [diagnostics, hidden]);

  const busy = status === 'preparing' || status === 'compiling';
  const countOf = { error: counts.errors, warning: counts.warnings, badbox: counts.badboxes, info: counts.infos };
  const summary =
    lastMs !== undefined && hasResult
      ? [
          t(status === 'error' ? 'compile.status.failedIn' : 'compile.status.compiledIn', { duration: formatDurationL(lastMs, t) }),
          engine && `· ${ENGINE_LABELS[engine]}`,
          backendId && `· ${backendShort(backendId, t)}`,
        ]
          .filter(Boolean)
          .join(' ')
      : null;

  return (
    <div className="@container flex h-full min-h-0 flex-col text-[12.5px]">
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border/70 px-2 [scrollbar-width:none]">
        {ORDER.map((sev) => {
          const S = SEVERITY[sev];
          const active = !hidden.has(sev);
          return (
            <button
              key={sev}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(sev)}
              className={cn(
                'flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium ring-1 ring-inset transition-colors [&_svg]:size-3.5',
                active ? 'bg-surface-2 text-fg ring-border' : 'text-fg-subtle ring-transparent hover:bg-hover',
              )}
            >
              <S.icon className={cn(active ? S.cls : 'opacity-60')} />
              {t(S.plural)}
              <span className="tabular-nums text-fg-subtle">{countOf[sev]}</span>
            </button>
          );
        })}
        <div className="flex-1" />
        {busy && <Spinner className="mr-1 size-3.5 text-fg-subtle" />}
        {summary && <span className="mr-1 hidden truncate text-[11.5px] text-fg-subtle sm:inline">{summary}</span>}
        <Button size="xs" variant="ghost" icon={<ScrollText />} onClick={() => useLayout.getState().showBottomPanel('log')}>
          {t('compile.rawLog')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {groups.length > 0 ? (
          groups.map((g) => <FileGroup key={g.file} file={g.file} items={g.items} clickable={!!(g.file && project?.findByPath(g.file))} />)
        ) : (
          <Empty status={status} hasResult={hasResult} total={counts.total} summary={summary} />
        )}
      </div>
    </div>
  );
}

function Empty({ status, hasResult, total, summary }: { status: string; hasResult: boolean; total: number; summary: string | null }) {
  const t = useT();
  if (status === 'preparing' || status === 'compiling')
    return <EmptyState icon={<Spinner />} title={t('compile.detail.compiling')} description={t('compile.empty.compilingDesc')} />;
  if (!hasResult)
    return (
      <EmptyState
        icon={<Play />}
        title={t('compile.empty.noCompile')}
        description={t('compile.empty.noCompileDesc')}
        action={
          <Button size="sm" variant="primary" onClick={() => executeCommand('compile.run')}>
            {t('compile.compile')}
          </Button>
        }
      />
    );
  if (status === 'error' && total === 0)
    return (
      <EmptyState
        icon={<AlertCircle />}
        title={t('compile.status.failed')}
        description={t('compile.empty.failedDesc')}
        action={
          <Button size="sm" icon={<ScrollText />} onClick={() => useLayout.getState().showBottomPanel('log')}>
            {t('compile.empty.openRawLog')}
          </Button>
        }
      />
    );
  if (total > 0) return <EmptyState title={t('compile.empty.filtered')} description={t('compile.empty.filteredDesc')} />;
  return <EmptyState icon={<PartyPopper />} title={t('compile.empty.noProblems')} description={summary ?? undefined} />;
}

const FileGroup = memo(function FileGroup({ file, items, clickable }: { file: string; items: Diagnostic[]; clickable: boolean }) {
  const [open, setOpen] = useState(true);
  const t = useT();
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-6 w-full items-center gap-1.5 px-2 text-left text-[12px] font-medium text-fg hover:bg-hover"
      >
        {open ? <ChevronDown className="size-3.5 text-fg-subtle" /> : <ChevronRight className="size-3.5 text-fg-subtle" />}
        {file ? <FileIcon path={file} className="size-3.5" /> : <Info className="size-3.5 text-fg-subtle" />}
        <span className={cn('truncate', !clickable && file && 'text-fg-muted')}>{file || t('compile.general')}</span>
        <span className="ml-1 rounded-full bg-surface-2 px-1.5 text-[10.5px] tabular-nums text-fg-muted ring-1 ring-border">{items.length}</span>
      </button>
      {open && items.map((d, i) => <ProblemRow key={i} d={d} clickable={clickable} />)}
    </div>
  );
});

function ProblemRow({ d, clickable }: { d: Diagnostic; clickable: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const backendId = useWorkspace((s) => s.compile.backendId);
  const engine = useCompileUi((s) => s.lastEngine);
  const S = SEVERITY[d.severity];
  const hint = hintFor(d, { backendId, engine }, t);
  const ai = getAiBridge();
  const excerpt = (d.raw ?? d.context ?? '').trim();
  const [first, ...rest] = d.message.split('\n');
  const go = () => {
    if (clickable && d.file) useWorkspace.getState().revealLocation(d.file, d.line ?? 1);
  };

  return (
    <div className="group/row">
      <div
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go();
          if (e.key === 'ArrowRight') setExpanded(true);
          if (e.key === 'ArrowLeft') setExpanded(false);
        }}
        className={cn(
          'flex min-h-[26px] items-start gap-2 py-1 pl-7 pr-2 outline-none hover:bg-hover focus-visible:bg-hover',
          clickable ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        <button
          type="button"
          aria-label={expanded ? t('compile.collapseDetails') : t('compile.expandDetails')}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="mt-[3px] text-fg-subtle hover:text-fg [&_svg]:size-3"
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </button>
        <S.icon className={cn('mt-[2px] size-3.5 shrink-0', S.cls)} aria-label={t(S.label)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn('min-w-[8rem] flex-1 break-words text-fg', !expanded && 'line-clamp-2')}>{first}</span>
            {d.line !== undefined && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
                {d.file ? `${d.file.split('/').pop()}:${d.line}` : t('compile.line', { line: String(d.line) })}
              </span>
            )}
          </div>
          {hint && !expanded && d.severity === 'error' && (
            <div className="mt-0.5 flex items-start gap-1 text-[11.5px] text-fg-muted">
              <Lightbulb className="mt-[2px] size-3 shrink-0 text-warning" />
              <span className="line-clamp-1">{hint}</span>
            </div>
          )}
        </div>
        {ai && d.severity !== 'info' && (
          <div className="hidden shrink-0 @[28rem]:flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
            <Tooltip content={t('compile.explainTooltip')}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  ai.ask(aiPrompt(d, 'explain', t), { includeDiagnostics: false });
                }}
                className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-fg-muted hover:bg-active hover:text-fg [&_svg]:size-3"
              >
                <MessageCircleQuestion /> {t('compile.explain')}
              </button>
            </Tooltip>
            <Tooltip content={t('compile.fixTooltip')}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  ai.ask(aiPrompt(d, 'fix', t), { includeDiagnostics: true });
                }}
                className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-accent hover:bg-accent-soft [&_svg]:size-3"
              >
                <Sparkles /> {t('compile.fixWithAi')}
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {expanded && (
        <div className="mb-1 ml-[52px] mr-2 space-y-1.5">
          {rest.length > 0 && <div className="whitespace-pre-wrap text-[12px] text-fg-muted">{rest.join('\n')}</div>}
          {hint && (
            <div className="flex items-start gap-1.5 rounded-md bg-warning-soft/60 px-2 py-1.5 text-[12px] text-fg">
              <Lightbulb className="mt-[2px] size-3.5 shrink-0 text-warning" />
              <span>{hint}</span>
            </div>
          )}
          {excerpt && (
            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface-2/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg-muted">{excerpt}</pre>
          )}
          <div className="flex flex-wrap items-center gap-1">
            {d.code && <span className="mr-1 text-[10.5px] uppercase tracking-wider text-fg-subtle">{d.code}</span>}
            {ai && d.severity !== 'info' && (
              <>
                <Button size="xs" variant="ghost" icon={<MessageCircleQuestion />} onClick={() => ai.ask(aiPrompt(d, 'explain', t), { includeDiagnostics: false })}>
                  {t('compile.explain')}
                </Button>
                <Button size="xs" variant="subtle" icon={<Sparkles />} onClick={() => ai.ask(aiPrompt(d, 'fix', t), { includeDiagnostics: true })}>
                  {t('compile.fixWithAi')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
