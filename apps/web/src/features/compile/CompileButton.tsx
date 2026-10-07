import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Cloud,
  Cpu,
  Eraser,
  Globe,
  ListChecks,
  Play,
  Puzzle,
  Repeat,
  RotateCcw,
  ScrollText,
  Settings2,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import type { TexEngine } from '@texit/core';
import { cn } from '@/lib/cn';
import { isDesktop } from '@/lib/platform';
import { executeCommand } from '@/services/commands';
import { useSettings } from '@/state/settings';
import { useLayout, useWorkspace } from '@/state/workspace';
import { DropdownMenu, Kbd, Spinner, Tooltip, type MenuEntry } from '@/ui';
import { ENGINE_LABELS, getController, useCompileUi } from './controller';
import { formatElapsed, useElapsed } from './hooks';
import { setProjectBackend, setProjectEngine } from './actions';

const BACKEND_ITEMS = [
  { id: 'busytex', label: 'In-browser (WASM)', icon: Globe },
  { id: 'native', label: 'Native TeX', icon: Cpu },
  { id: 'remote', label: 'Remote server', icon: Cloud },
] as const;

/** Top-bar split button: Compile / Stop + options menu. */
export function CompileButton() {
  const status = useWorkspace((s) => s.compile.status);
  const progress = useWorkspace((s) => s.compile.progress);
  const startedAt = useWorkspace((s) => s.compile.startedAt);
  const hasPdf = useWorkspace((s) => !!s.compile.pdf);
  const hasProject = useWorkspace((s) => !!s.project);
  const busy = status === 'preparing' || status === 'compiling';
  const elapsed = useElapsed(startedAt, busy, 100);
  const flash = useFlash();

  const label = busy ? 'Stop' : hasPdf ? 'Recompile' : 'Compile';
  const onClick = () => {
    if (busy) getController()?.cancel();
    else void executeCommand('compile.run');
  };

  return (
    <div
      className={cn(
        'relative flex h-7 items-stretch overflow-hidden rounded-md shadow-sm shadow-accent/20 transition-shadow duration-300',
        flash === 'success' && 'ring-2 ring-success/60',
        flash === 'error' && 'ring-2 ring-danger/60',
      )}
    >
      <Tooltip content={busy ? 'Stop compilation' : 'Compile the project'} shortcut={busy ? 'Mod-.' : 'Mod-Enter'}>
        <button
          type="button"
          disabled={!hasProject}
          onClick={onClick}
          aria-label={label}
          className={cn(
            'group relative flex min-w-[104px] items-center gap-1.5 pl-2.5 pr-2 text-xs font-medium transition-colors disabled:opacity-50 [&_svg]:size-3.5',
            busy ? 'bg-accent-hover text-accent-fg' : 'bg-accent text-accent-fg hover:bg-accent-hover',
          )}
        >
          {busy && progress !== undefined && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {busy ? (
              <>
                <Spinner className="size-3.5 group-hover:hidden" />
                <Square className="hidden fill-current group-hover:block" />
              </>
            ) : hasPdf ? (
              <RotateCcw />
            ) : (
              <Play className="fill-current" />
            )}
            <span>{label}</span>
            {busy ? (
              <span className="tabular-nums opacity-75">{progress !== undefined ? `${Math.round(progress * 100)}%` : formatElapsed(elapsed)}</span>
            ) : (
              <Kbd keys="Mod-Enter" className="ml-0.5 opacity-70 [&_kbd]:border-white/20 [&_kbd]:bg-white/15 [&_kbd]:text-accent-fg" />
            )}
          </span>
        </button>
      </Tooltip>
      <CompileMenu disabled={!hasProject} />
    </div>
  );
}

/** Briefly highlight the button after a run finishes. */
function useFlash(): 'success' | 'error' | null {
  const counter = useCompileUi((s) => s.runCounter);
  const outcome = useCompileUi((s) => s.lastOutcome);
  const [flash, setFlash] = useState<'success' | 'error' | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (outcome !== 'success' && outcome !== 'error') return;
    setFlash(outcome);
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [counter, outcome]);
  return flash;
}

function CompileMenu({ disabled }: { disabled: boolean }) {
  const auto = useSettings((s) => s.compile.auto);
  const draft = useSettings((s) => s.compile.draftWhileTyping);
  const appBackend = useSettings((s) => s.compile.backend);
  const remoteUrl = useSettings((s) => s.compile.remoteUrl);
  const setCompile = useSettings((s) => s.setCompile);
  const meta = useWorkspace((s) => s.meta);
  const lastEngine = useCompileUi((s) => s.lastEngine);
  const engineReason = useCompileUi((s) => s.engineReason);
  const backends = useCompileUi((s) => s.backends);

  const projectEngine = (meta?.engine ?? 'pdflatex') as TexEngine;
  const projectBackend = meta?.compilerBackend || 'auto';
  const statusOf = (id: string) => backends.find((b) => b.id === id)?.status;

  const engineItems: MenuEntry[] = (['pdflatex', 'xelatex', 'lualatex'] as TexEngine[]).map((e) => ({
    label: ENGINE_LABELS[e],
    checked: projectEngine === e,
    hint: lastEngine === e && lastEngine !== projectEngine ? 'in use' : undefined,
    onSelect: () => setProjectEngine(e),
  }));
  if (engineReason && lastEngine && lastEngine !== projectEngine) {
    engineItems.push({ type: 'separator' }, { type: 'label', label: `Using ${ENGINE_LABELS[lastEngine]}: ${engineReason}` });
  }

  const pluginBackends = backends.filter((b) => !['busytex', 'native', 'remote'].includes(b.id));
  const appDefaultLabel = appBackend === 'auto' ? 'Automatic' : (BACKEND_ITEMS.find((b) => b.id === appBackend)?.label ?? appBackend);
  const backendItems: MenuEntry[] = [
    { label: `App default (${appDefaultLabel})`, icon: <Sparkles />, checked: projectBackend === 'auto', onSelect: () => setProjectBackend('auto') },
    { type: 'separator' },
    ...BACKEND_ITEMS.map((b): MenuEntry => {
      const st = statusOf(b.id);
      const unavailable =
        (b.id === 'native' && !isDesktop) || (b.id === 'remote' && !remoteUrl.trim()) || (st ? !st.available : b.id !== 'busytex');
      return {
        label: b.label,
        icon: <b.icon />,
        checked: projectBackend === b.id,
        disabled: b.id === 'native' ? !isDesktop : b.id === 'remote' ? !remoteUrl.trim() : false,
        hint: b.id === 'native' && !isDesktop ? 'desktop' : b.id === 'remote' && !remoteUrl.trim() ? 'not set up' : unavailable ? 'offline' : undefined,
        onSelect: () => setProjectBackend(b.id),
      };
    }),
    ...pluginBackends.map((b): MenuEntry => ({
      label: b.label,
      icon: <Puzzle />,
      checked: projectBackend === b.id,
      hint: b.status && !b.status.available ? 'unavailable' : undefined,
      onSelect: () => setProjectBackend(b.id),
    })),
    { type: 'separator' },
    { label: 'Compiler settings…', icon: <Settings2 />, onSelect: () => executeCommand('app.settings', 'compiler') },
  ];
  const usedBackend = useWorkspace.getState().compile.backendId;
  const backendLabel =
    projectBackend === 'auto'
      ? usedBackend
        ? `Auto (${BACKEND_ITEMS.find((b) => b.id === usedBackend)?.label ?? usedBackend})`
        : 'Auto'
      : (BACKEND_ITEMS.find((b) => b.id === projectBackend)?.label ?? projectBackend);
  const nativeDetail = statusOf('native')?.detail;
  if (isDesktop && nativeDetail) backendItems.splice(backendItems.length - 2, 0, { type: 'label', label: nativeDetail });

  const items: MenuEntry[] = [
    { label: 'Compile', icon: <Play />, shortcut: 'Mod-Enter', onSelect: () => executeCommand('compile.run') },
    { label: 'Fast draft pass', icon: <Zap />, shortcut: 'Mod-Alt-Enter', onSelect: () => executeCommand('compile.draft') },
    { type: 'separator' },
    { label: 'Auto-compile', icon: <Repeat />, checked: auto, onSelect: () => setCompile({ auto: !auto }) },
    { label: 'Draft passes while typing', icon: <Zap />, checked: draft, disabled: !auto, onSelect: () => setCompile({ draftWhileTyping: !draft }) },
    { type: 'separator' },
    { label: `Engine · ${ENGINE_LABELS[lastEngine ?? projectEngine]}`, icon: <Cpu />, submenu: engineItems },
    { label: `Backend · ${backendLabel}`, icon: <Globe />, submenu: backendItems },
    { type: 'separator' },
    { label: 'Problems', icon: <ListChecks />, shortcut: 'F8', onSelect: () => useLayout.getState().showBottomPanel('problems') },
    { label: 'Raw log', icon: <ScrollText />, onSelect: () => useLayout.getState().showBottomPanel('log') },
    { label: 'Clear cache & recompile', icon: <Eraser />, onSelect: () => executeCommand('compile.clearCache') },
  ];

  return (
    <DropdownMenu
      align="end"
      items={items}
      onOpenChange={(open) => open && void getController()?.refreshBackends()}
      trigger={
        <button
          type="button"
          disabled={disabled}
          data-compile-menu
          aria-label="Compile options"
          className="flex w-6 items-center justify-center border-l border-white/20 bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50 data-[state=open]:bg-accent-hover [&_svg]:size-3.5"
        >
          <ChevronDown />
        </button>
      }
    />
  );
}
