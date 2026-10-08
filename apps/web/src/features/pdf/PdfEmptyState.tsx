import { AlertTriangle, CloudDownload, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { localizeDetail } from '@/features/compile/format';
import { executeCommand, useCommands } from '@/services/commands';
import { Button, Kbd } from '@/ui';
import type { CompileState } from '@/state/workspace';
import './pdf.css';
import './i18n';

/** Percent from `progress` (0..1) or a "(34%)" in the detail string. */
export function compilePercent(c: Pick<CompileState, 'progress' | 'detail'>): number | null {
  if (typeof c.progress === 'number' && Number.isFinite(c.progress)) return Math.round(Math.min(1, Math.max(0, c.progress)) * 100);
  const m = c.detail?.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
  return m ? Math.min(100, Math.round(parseFloat(m[1]))) : null;
}

/** Stacked paper sheets with typeset lines; lines shimmer while `busy`. */
function PaperIllustration({ busy, tone = 'accent' }: { busy?: boolean; tone?: 'accent' | 'danger' }) {
  const line = (y: number, w: number, i: number, x = 26) => (
    <rect
      key={`${y}-${i}`}
      x={x}
      y={y}
      width={w}
      height={3.2}
      rx={1.6}
      className={cn('fill-[#d9dbe3] dark:fill-[#3a3a46]', busy && 'tx-empty-line')}
      style={busy ? { animationDelay: `${i * 90}ms` } : undefined}
    />
  );
  return (
    <div className="relative mx-auto h-[150px] w-[168px]">
      <div
        className={cn(
          'absolute inset-x-4 bottom-2 top-6 rounded-full blur-2xl',
          tone === 'danger' ? 'bg-danger/20' : 'bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--tx-accent)_35%,transparent),transparent)]',
          busy && 'animate-pulse',
        )}
      />
      <svg viewBox="0 0 168 150" className="relative h-full w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="tx-empty-accent" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--tx-accent)" />
            <stop offset="1" stopColor="#b25cff" />
          </linearGradient>
          <filter id="tx-empty-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#0b0b20" floodOpacity="0.16" />
          </filter>
        </defs>
        {/* back sheet */}
        <g transform="rotate(-7 84 80)" filter="url(#tx-empty-shadow)">
          <rect x="30" y="14" width="98" height="126" rx="3" className="fill-white dark:fill-[#202029]" />
          <rect x="30" y="14" width="98" height="126" rx="3" fill="none" className="stroke-black/5 dark:stroke-white/10" />
        </g>
        {/* front sheet */}
        <g transform="rotate(4 84 80)" filter="url(#tx-empty-shadow)">
          <rect x="16" y="10" width="110" height="134" rx="3" className="fill-white dark:fill-[#25252f]" />
          <rect x="16" y="10" width="110" height="134" rx="3" fill="none" className="stroke-black/5 dark:stroke-white/10" />
          <rect x="40" y="24" width="62" height="5" rx="2.5" fill="url(#tx-empty-accent)" opacity={tone === 'danger' ? 0.35 : 0.9} />
          <rect x="52" y="33" width="38" height="3" rx="1.5" className="fill-[#c7c9d3] dark:fill-[#454552]" />
          {[46, 52, 58, 64].map((y, i) => line(y, i === 3 ? 56 : 90, i))}
          <text x="71" y="88" textAnchor="middle" className="fill-fg-muted" style={{ font: 'italic 15px "Latin Modern Math", "STIX Two Math", Cambria, Georgia, serif' }}>
            ∫ e<tspan dy="-5" fontSize="9">−x²</tspan>
            <tspan dy="5"> dx = √π</tspan>
          </text>
          {[100, 106, 112, 118, 124].map((y, i) => line(y, i === 4 ? 40 : 90, i + 4))}
          <text x="71" y="138" textAnchor="middle" className="fill-fg-subtle" style={{ font: '6px ui-sans-serif, system-ui' }}>
            1
          </text>
        </g>
        {tone === 'danger' && (
          <g transform="translate(118 112)">
            <circle r="13" className="fill-danger" />
            <path d="M0 -6v7M0 5.5v.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        )}
      </svg>
    </div>
  );
}

function useCompileShortcut() {
  return useCommands((s) => s.commands['compile.run']?.keybinding?.split(/\s*\|\s*/)[0]) ?? 'Mod-Enter';
}

export function PdfEmptyState({ compile }: { compile: CompileState }) {
  const shortcut = useCompileShortcut();
  const t = useT();
  const hasCancel = useCommands((s) => !!s.commands['compile.cancel']);
  const { status } = compile;
  const pct = compilePercent(compile);
  const busy = status === 'preparing' || status === 'compiling';
  const firstRun = status === 'preparing';

  let title: string;
  let description: React.ReactNode;
  let actions: React.ReactNode = null;

  if (firstRun) {
    title = t('pdf.empty.setupTitle');
    description = t('pdf.empty.setupDesc');
  } else if (status === 'compiling') {
    title = t('pdf.empty.typesetting');
    description = compile.detail ? localizeDetail(compile.detail, t) : t('pdf.empty.typesettingDesc');
  } else if (status === 'error') {
    title = t('pdf.empty.failed');
    description = t('pdf.empty.failedDesc');
    actions = (
      <div className="flex items-center gap-2">
        <Button size="md" variant="secondary" icon={<AlertTriangle />} onClick={() => executeCommand('view.problems')}>
          {t('pdf.viewProblems')}
        </Button>
        <Button size="md" variant="primary" icon={<RotateCcw />} onClick={() => executeCommand('compile.run')}>
          {t('pdf.empty.tryAgain')}
        </Button>
      </div>
    );
  } else {
    title = t('pdf.empty.noPdf');
    description = t('pdf.empty.noPdfDesc');
    actions = (
      <Button size="lg" variant="primary" icon={<Play className="fill-current" />} onClick={() => executeCommand('compile.run')} className="px-5">
        {t('pdf.empty.compile')}
        <Kbd keys={shortcut} className="ml-1.5 [&_kbd]:border-white/25 [&_kbd]:bg-white/15 [&_kbd]:text-white" />
      </Button>
    );
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-pdf-bg px-6 py-10">
      <div className="flex w-full max-w-[340px] animate-slide-up flex-col items-center text-center">
        <PaperIllustration busy={busy} tone={status === 'error' ? 'danger' : 'accent'} />
        <h2 className="mt-5 text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">{description}</p>
        {firstRun && (
          <div className="mt-5 w-full rounded-xl border border-border bg-surface/80 p-3 text-left shadow-[var(--shadow-card)] backdrop-blur">
            <div className="flex items-center gap-2 text-[12px]">
              <CloudDownload className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{compile.detail ? localizeDetail(compile.detail, t) : t('pdf.empty.preparing')}</span>
              {pct != null && <span className="tabular-nums text-fg-muted">{t('pdf.percent', { pct: String(pct) })}</span>}
            </div>
            <ProgressTrack percent={pct} className="mt-2.5" />
            <div className="mt-2 text-[11px] text-fg-subtle">{t('pdf.empty.onlyOnce')}</div>
          </div>
        )}
        {status === 'compiling' && <ProgressTrack percent={pct} className="mt-5 w-40" />}
        {busy && hasCancel && (
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => executeCommand('compile.cancel')}>
            {t('common.cancel')}
          </Button>
        )}
        {actions && <div className="mt-5">{actions}</div>}
        {!busy && status !== 'error' && (
          <p className="mt-4 text-[11.5px] text-fg-subtle">
            {t('pdf.empty.tip')}
          </p>
        )}
      </div>
    </div>
  );
}

/** Determinate (percent) or indeterminate progress track. */
export function ProgressTrack({ percent, className, thin }: { percent: number | null; className?: string; thin?: boolean }) {
  return (
    <div className={cn('relative overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-border', thin ? 'h-[3px]' : 'h-1.5', className)}>
      {percent != null ? (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--tx-accent),#b25cff)] transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      ) : (
        <div className="tx-progress-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-[linear-gradient(90deg,transparent,var(--tx-accent),transparent)]" />
      )}
    </div>
  );
}
