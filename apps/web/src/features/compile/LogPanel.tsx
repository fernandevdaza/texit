import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronDown, ChevronUp, Copy, Download, ScrollText, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/format';
import { executeCommand } from '@/services/commands';
import { useWorkspace } from '@/state/workspace';
import { Button, EmptyState, IconButton, Segmented, toast } from '@/ui';

const LINE_H = 18;
const OVERSCAN = 30;

type Tone = 'error' | 'warning' | 'dim' | 'tool' | 'plain';

function toneOf(line: string): Tone {
  if (/^! |^\S+?:\d+: |\bError\b|^l\.\d+ |EXITCODE: [1-9]|exit code [1-9]|Fatal error/.test(line)) return 'error';
  if (/Warning|^(?:Over|Under)full \\[hv]box|^Missing character/.test(line)) return 'warning';
  if (/^\[(?:busytex|texit|native|remote|compile-server|[a-z0-9]+)\]|^\$ |^={10,}/.test(line)) return 'tool';
  if (/^\s*[()<>[\]{}]*\(\/|^\s*\(\.\/|\.(?:sty|cls|cfg|def|fd|clo|tex|ldf)\)?\s*$|^\s*\)+\s*$|^LaTeX Font Info|^File: |^Package: |^Document Class: |^\\[a-z@]+=\\(?:count|dimen|skip|toks|box|muskip|read|write)\d+/i.test(line))
    return 'dim';
  return 'plain';
}

const TONE_CLS: Record<Tone, string> = {
  error: 'text-danger',
  warning: 'text-warning',
  dim: 'text-fg-subtle/80',
  tool: 'text-accent',
  plain: 'text-fg-muted',
};

export function LogPanel() {
  const status = useWorkspace((s) => s.compile.status);
  const liveLog = useWorkspace((s) => s.compile.liveLog);
  const resultLog = useWorkspace((s) => s.compile.result?.log ?? '');
  const busy = status === 'preparing' || status === 'compiling';
  const [view, setView] = useState<'log' | 'output'>('log');
  const text = busy || view === 'output' ? liveLog : resultLog;
  const lines = useMemo(() => (text ? text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n') : []), [text]);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 400 });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(q)) out.push(i);
    return out;
  }, [lines, query]);

  const scrollToLine = useCallback((line: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = Math.max(0, line * LINE_H - el.clientHeight / 3);
  }, []);

  useEffect(() => {
    if (!matches.length) return;
    const i = Math.min(matchIdx, matches.length - 1);
    scrollToLine(matches[i]);
  }, [matchIdx, matches, scrollToLine]);

  // Follow the tail while streaming; jump to the first error when a failed log arrives.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (busy || view === 'output') {
      if (follow) el.scrollTop = el.scrollHeight;
    } else if (status === 'error') {
      const firstError = lines.findIndex((l) => l.startsWith('! ') || /^\S+?:\d+: /.test(l));
      if (firstError >= 0) scrollToLine(firstError);
      else el.scrollTop = el.scrollHeight;
    }
  }, [lines, busy, follow, status, view, scrollToLine]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  const first = Math.max(0, Math.floor(viewport.top / LINE_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((viewport.top + viewport.height) / LINE_H) + OVERSCAN);
  const current = matches.length ? matches[Math.min(matchIdx, matches.length - 1)] : -1;
  const q = query.trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Log copied', { duration: 1500 });
    } catch {
      toast.error('Could not copy the log');
    }
  };
  const download = () => {
    const main = useWorkspace.getState().compile.result ? 'output' : 'build';
    downloadBlob(text, `${main}.log`, 'text/plain;charset=utf-8');
  };
  const step = (dir: 1 | -1) => matches.length && setMatchIdx((i) => (i + dir + matches.length) % matches.length);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          e.stopPropagation();
          setSearchOpen(true);
        }
      }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/70 px-2">
        <Segmented
          size="sm"
          value={busy ? 'output' : view}
          onChange={(v) => setView(v)}
          options={[
            { value: 'log', label: 'TeX log', title: 'The .log file of the last TeX run (+ bibliography tools)' },
            { value: 'output', label: busy ? 'Live output' : 'Build output', title: 'Everything the compiler printed' },
          ]}
        />
        {searchOpen ? (
          <div className="ml-1 flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-1.5 focus-within:border-accent">
            <Search className="size-3.5 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              placeholder="Search log"
              onChange={(e) => {
                setQuery(e.target.value);
                setMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
                if (e.key === 'Escape') {
                  setSearchOpen(false);
                  setQuery('');
                }
              }}
              className="w-40 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-subtle"
            />
            <span className="min-w-[44px] text-right text-[11px] tabular-nums text-fg-subtle">
              {q ? (matches.length ? `${Math.min(matchIdx, matches.length - 1) + 1}/${matches.length}` : '0/0') : ''}
            </span>
            <IconButton label="Previous match" size="xs" onClick={() => step(-1)} noTooltip>
              <ChevronUp />
            </IconButton>
            <IconButton label="Next match" size="xs" onClick={() => step(1)} noTooltip>
              <ChevronDown />
            </IconButton>
            <IconButton
              label="Close search"
              size="xs"
              noTooltip
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
            >
              <X />
            </IconButton>
          </div>
        ) : (
          <IconButton label="Search log" shortcut="Mod-f" size="xs" onClick={() => setSearchOpen(true)}>
            <Search />
          </IconButton>
        )}
        <div className="flex-1" />
        <span className="mr-1 text-[11px] tabular-nums text-fg-subtle">{lines.length ? `${lines.length.toLocaleString()} lines` : ''}</span>
        <IconButton label={follow ? 'Auto-scroll on' : 'Auto-scroll off'} size="xs" active={follow} onClick={() => setFollow(!follow)}>
          <ArrowDownToLine />
        </IconButton>
        <IconButton label="Copy log" size="xs" onClick={copy} disabled={!text}>
          <Copy />
        </IconButton>
        <IconButton label="Download .log" size="xs" onClick={download} disabled={!text}>
          <Download />
        </IconButton>
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto bg-surface font-mono text-[11.5px]" tabIndex={0}>
        {lines.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title={busy ? 'Waiting for output…' : 'No log yet'}
            description={busy ? undefined : 'The raw compiler log appears here after a compile.'}
            action={
              busy ? undefined : (
                <Button size="sm" onClick={() => executeCommand('compile.run')}>
                  Compile
                </Button>
              )
            }
          />
        ) : (
          <div style={{ height: lines.length * LINE_H, minWidth: '100%' }} className="relative">
            <div style={{ transform: `translateY(${first * LINE_H}px)` }} className="absolute inset-x-0 top-0 w-max min-w-full">
              {lines.slice(first, last).map((line, k) => {
                const i = first + k;
                return (
                  <div
                    key={i}
                    style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}
                    className={cn('flex whitespace-pre pr-4', i === current && 'bg-accent-soft')}
                  >
                    <span className="sticky left-0 w-12 shrink-0 select-none bg-surface pr-3 text-right text-[10.5px] tabular-nums text-fg-subtle/60">{i + 1}</span>
                    <span className={TONE_CLS[toneOf(line)]}>{q ? <Highlight line={line} q={q} /> : line || ' '}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Highlight({ line, q }: { line: string; q: string }) {
  const lower = line.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (let idx = lower.indexOf(needle); idx !== -1; idx = lower.indexOf(needle, pos)) {
    if (idx > pos) parts.push(line.slice(pos, idx));
    parts.push(
      <mark key={idx} className="rounded-sm bg-warning/35 text-fg">
        {line.slice(idx, idx + needle.length)}
      </mark>,
    );
    pos = idx + needle.length;
  }
  parts.push(line.slice(pos));
  return <>{parts}</>;
}
