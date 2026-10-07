import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Copy, FolderSearch, Pin, X, XCircle } from 'lucide-react';
import { basename, dirname } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { cn } from '@/lib/cn';
import { ContextMenu, toast, Tooltip } from '@/ui';
import { FileIcon } from '@/features/files/FileIcon';
import { revealInTree } from '@/features/files/api';
import { usePeersByFile, type Peer } from './presence';

export function PresenceDots({ peers, max = 3, className }: { peers?: Peer[]; max?: number; className?: string }) {
  if (!peers?.length) return null;
  return (
    <span className={cn('flex shrink-0 items-center -space-x-1', className)} title={peers.map((p) => p.user.name).join(', ')}>
      {peers.slice(0, max).map((p) => (
        <span key={p.clientId} className="size-2 rounded-full ring-2 ring-[var(--dot-ring,var(--tx-surface))]" style={{ background: p.user.color }} />
      ))}
      {peers.length > max && <span className="pl-1.5 text-[9.5px] text-fg-subtle">+{peers.length - max}</span>}
    </span>
  );
}

export function TabBar() {
  const openTabs = useWorkspace((s) => s.openTabs);
  const activeId = useWorkspace((s) => s.activeFileId);
  const previewId = useWorkspace((s) => s.previewTabId);
  const files = useWorkspace((s) => s.files);
  const peers = usePeersByFile();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);

  const byId = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  // Disambiguate duplicate names with their folder.
  const dupNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of openTabs) {
      const n = byId.get(id)?.name;
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return counts;
  }, [openTabs, byId]);

  // Keep the active tab visible.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, openTabs.length]);

  if (!openTabs.length) return null;

  const ws = () => useWorkspace.getState();

  const onDrop = (targetIdx: number) => {
    if (!drag) return;
    const tabs = openTabs.filter((t) => t !== drag.id);
    const from = openTabs.indexOf(drag.id);
    const idx = targetIdx > from ? targetIdx - 1 : targetIdx;
    tabs.splice(Math.max(0, Math.min(idx, tabs.length)), 0, drag.id);
    ws().reorderTabs(tabs);
    setDrag(null);
  };

  return (
    <div className="relative flex h-9 shrink-0 items-stretch border-b border-border bg-surface-2/60">
      <div
        ref={scroller}
        role="tablist"
        aria-label="Open files"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && scroller.current) scroller.current.scrollLeft += e.deltaY;
        }}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if (!drag) return;
          e.preventDefault();
          onDrop(drag.over);
        }}
      >
        {openTabs.map((id, i) => {
          const f = byId.get(id);
          if (!f) return null;
          const active = id === activeId;
          const preview = id === previewId;
          const showDir = (dupNames.get(f.name) ?? 0) > 1 && dirname(f.path);
          return (
            <ContextMenu
              key={id}
              items={() => [
                { label: 'Close', icon: <X />, shortcut: 'Mod-w', onSelect: () => ws().closeTab(id) },
                { label: 'Close others', icon: <XCircle />, disabled: openTabs.length < 2, onSelect: () => ws().closeOtherTabs(id) },
                {
                  label: 'Close tabs to the right',
                  icon: <ArrowLeftRight />,
                  disabled: i === openTabs.length - 1,
                  onSelect: () => {
                    const keep = openTabs.slice(0, i + 1);
                    useWorkspace.setState({ openTabs: keep, activeFileId: keep.includes(activeId ?? '') ? activeId : id });
                  },
                },
                ...(preview ? [{ label: 'Keep open', icon: <Pin />, onSelect: () => ws().pinTab(id) }] : []),
                { type: 'separator' as const },
                {
                  label: 'Copy path',
                  icon: <Copy />,
                  onSelect: () => {
                    void navigator.clipboard?.writeText(f.path);
                    toast.success('Path copied', { description: f.path });
                  },
                },
                { label: 'Reveal in file tree', icon: <FolderSearch />, onSelect: () => revealInTree(id) },
              ]}
            >
              <div
                role="tab"
                aria-selected={active}
                data-tab-id={id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', f.path);
                  setDrag({ id, over: i });
                }}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const over = e.clientX < rect.left + rect.width / 2 ? i : i + 1;
                  if (over !== drag.over) setDrag({ ...drag, over });
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    ws().closeTab(id);
                  }
                }}
                onClick={() => ws().setActive(id)}
                onDoubleClick={() => ws().pinTab(id)}
                className={cn(
                  'group relative flex min-w-0 max-w-[220px] shrink-0 cursor-default select-none items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-[12.5px] transition-colors',
                  active ? 'bg-surface text-fg [--dot-ring:var(--tx-surface)]' : 'text-fg-muted hover:bg-hover hover:text-fg [--dot-ring:var(--tx-surface-2)]',
                  drag?.id === id && 'opacity-50',
                )}
              >
                {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />}
                {active && <span className="absolute inset-x-0 -bottom-px h-px bg-surface" />}
                {drag && drag.id !== id && drag.over === i && <span className="absolute inset-y-1 -left-px w-0.5 rounded bg-accent" />}
                {drag && drag.id !== id && drag.over === i + 1 && i === openTabs.length - 1 && <span className="absolute inset-y-1 -right-px w-0.5 rounded bg-accent" />}
                <FileIcon path={f.path} className="size-[15px]" />
                <span className={cn('truncate', preview && 'italic')}>{f.name}</span>
                {showDir && <span className="truncate text-[11px] text-fg-subtle">{basename(dirname(f.path))}</span>}
                <PresenceDots peers={peers.get(id)} />
                <Tooltip content="Close" shortcut="Mod-w">
                  <button
                    aria-label={`Close ${f.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      ws().closeTab(id);
                    }}
                    className={cn(
                      'ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-[opacity,background] hover:bg-active hover:text-fg',
                      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <X className="size-3.5" />
                  </button>
                </Tooltip>
              </div>
            </ContextMenu>
          );
        })}
        <div className="min-w-4 flex-1" />
      </div>
    </div>
  );
}
