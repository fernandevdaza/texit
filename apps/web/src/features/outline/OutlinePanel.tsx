import { useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, ChevronRight, ChevronsDownUp, ChevronsUpDown, Hash, Image, ListTree, Presentation, Search, Table2, Tag, X } from 'lucide-react';
import { basename } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { getEditorBridge } from '@/services/editor';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { EmptyState, IconButton, PanelHeader, Segmented } from '@/ui';
import { getProjectIndex } from '@/features/editor/projectIndex';
import { useIndexVersion } from '@/features/editor/presence';
import { buildStructure, currentItem, nest, type DocItem, type TreeNode } from './model';

type Tab = 'sections' | 'labels' | 'floats';

const keyOf = (i: DocItem) => `${i.fileId}:${i.line}:${i.order}`;

function go(fileId: string, line: number, focus = true) {
  useWorkspace.getState().revealLocation(fileId, line);
  if (focus) requestAnimationFrame(() => getEditorBridge()?.focus());
}

/** Section numbers like "2.1" (unnumbered for starred / frames). */
function numbering(items: DocItem[]): Map<DocItem, string> {
  const out = new Map<DocItem, string>();
  const levels = [...new Set(items.filter((i) => i.level >= 0 && !i.starred).map((i) => i.level))].sort((a, b) => a - b);
  // Parts aren't numbered with the rest (Roman); skip level 0 when chapters/sections exist.
  const counted = levels.filter((l) => l !== 0 || levels.length === 1).slice(0, 4);
  const counters = counted.map(() => 0);
  for (const it of items) {
    const li = counted.indexOf(it.level);
    if (li < 0 || it.starred) continue;
    counters[li]++;
    for (let j = li + 1; j < counters.length; j++) counters[j] = 0;
    out.set(it, counters.slice(0, li + 1).join('.'));
  }
  return out;
}

function TabLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      {text}
      {count > 0 && <span className="text-[10px] tabular-nums text-fg-subtle">{count}</span>}
    </span>
  );
}

export function OutlinePanel() {
  const project = useWorkspace((s) => s.project);
  const activeId = useWorkspace((s) => s.activeFileId);
  const cursorLine = useWorkspace((s) => s.cursor.line);
  const metaMain = useWorkspace((s) => s.meta?.mainFileId);
  const version = useIndexVersion();
  const [tab, setTab] = useState<Tab>('sections');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const structure = useMemo(() => {
    const idx = getProjectIndex();
    if (!idx) return null;
    try {
      return buildStructure(idx, idx.mainFileId());
    } catch (err) {
      console.warn('[outline] failed to build structure', err);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, version, metaMain]);

  const tree = useMemo(() => (structure ? nest(structure.items) : []), [structure]);
  const numbers = useMemo(() => numbering(structure?.items ?? []), [structure]);
  const current = useMemo(() => (structure ? currentItem(structure, activeId, cursorLine) : null), [structure, activeId, cursorLine]);

  // Keep the current section visible.
  useEffect(() => {
    if (!current || tab !== 'sections') return;
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(keyOf(current))}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current, tab]);

  const q = query.trim().toLowerCase();
  const toggle = (k: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const allKeys = () => {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) =>
      nodes.forEach((n) => {
        if (n.children.length) out.push(keyOf(n.item));
        walk(n.children);
      });
    walk(tree);
    return out;
  };

  const counts = {
    sections: structure?.items.length ?? 0,
    labels: structure?.labels.length ?? 0,
    floats: structure?.floats.length ?? 0,
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const it = node.item;
    const k = keyOf(it);
    const isCollapsed = collapsed.has(k) && !q;
    const matches = !q || it.title.toLowerCase().includes(q);
    const childEls = isCollapsed ? [] : node.children.map((c) => renderNode(c, depth + 1)).filter(Boolean);
    if (!matches && !childEls.length) return null;
    const isCurrent = current === it;
    const num = numbers.get(it);
    return (
      <div key={k}>
        <div
          role="treeitem"
          aria-selected={isCurrent}
          data-key={k}
          onClick={() => go(it.fileId, it.line)}
          style={{ paddingLeft: 6 + depth * 14 }}
          className={cn(
            'group relative flex h-[26px] cursor-default select-none items-center gap-1 pr-2 text-[12.5px] transition-colors',
            isCurrent ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
          )}
        >
          {isCurrent && <span className="absolute inset-y-1 left-0 w-[2px] rounded-r bg-accent" />}
          <button
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              if (node.children.length) toggle(k);
            }}
            className={cn('flex size-4 shrink-0 items-center justify-center rounded text-fg-subtle', node.children.length ? 'hover:bg-active' : 'invisible')}
            aria-label={isCollapsed ? t('outline.expand') : t('outline.collapse')}
          >
            <ChevronRight className={cn('size-3 transition-transform', !isCollapsed && 'rotate-90')} />
          </button>
          {it.level < 0 ? (
            <Presentation className="size-3.5 shrink-0 text-fg-subtle" />
          ) : num ? (
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-fg-subtle">{num}</span>
          ) : (
            <Hash className="size-3 shrink-0 text-fg-subtle" />
          )}
          <span className={cn('min-w-0 flex-1 truncate', it.level <= 1 && it.level >= 0 && 'font-semibold text-fg', it.level === 2 && 'font-medium')}>
            {it.title || <span className="italic text-fg-subtle">{it.kind}</span>}
          </span>
          {structure && it.fileId !== structure.rootId && (
            <span className="hidden shrink-0 text-[10.5px] text-fg-subtle group-hover:inline">{basename(it.path)}</span>
          )}
        </div>
        {childEls}
      </div>
    );
  };

  const labels = (structure?.labels ?? []).filter((l) => !q || l.name.toLowerCase().includes(q) || l.context?.toLowerCase().includes(q));
  const floats = (structure?.floats ?? []).filter((f) => !q || f.caption.toLowerCase().includes(q) || f.label?.toLowerCase().includes(q));

  return (
    <div className="flex h-full min-h-0 flex-col" data-keep-focus>
      <PanelHeader
        title={t('panel.outline')}
        actions={
          tab === 'sections' ? (
            <>
              <IconButton size="xs" label={t('outline.expandAll')} onClick={() => setCollapsed(new Set())}>
                <ChevronsUpDown />
              </IconButton>
              <IconButton size="xs" label={t('outline.collapseAll')} onClick={() => setCollapsed(new Set(allKeys()))}>
                <ChevronsDownUp />
              </IconButton>
            </>
          ) : null
        }
      />
      <div className="space-y-1.5 px-2 pb-2">
        <Segmented
          size="sm"
          className="[&>div]:flex [&>div]:w-full [&_button]:flex-1 [&_button]:justify-center"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sections', label: <TabLabel text={t('outline.sections')} count={counts.sections} /> },
            { value: 'labels', label: <TabLabel text={t('outline.labels')} count={counts.labels} /> },
            { value: 'floats', label: <TabLabel text={t('outline.floats')} count={counts.floats} /> },
          ]}
        />
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <Search className="size-3.5 shrink-0 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder={tab === 'sections' ? t('outline.filterSections') : tab === 'labels' ? t('outline.filterLabels') : t('outline.filterFloats')}
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-subtle"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-fg-subtle hover:text-fg" aria-label={t('outline.clear')}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div ref={listRef} role="tree" className="min-h-0 flex-1 overflow-y-auto pb-3">
        {!structure?.rootId ? (
          <EmptyState icon={<ListTree />} title={t('outline.noMainFile')} description={t('outline.noMainFileHint')} />
        ) : tab === 'sections' ? (
          tree.length ? (
            tree.map((n) => renderNode(n, 0))
          ) : (
            <EmptyState icon={<ListTree />} title={t('outline.noSections')} description={t('outline.noSectionsHint')} />
          )
        ) : tab === 'labels' ? (
          labels.length ? (
            labels.map((l, i) => (
              <button
                key={`${l.fileId}:${l.line}:${i}`}
                onClick={() => go(l.fileId, l.line)}
                className="group flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Tag className="size-3.5 shrink-0 text-success opacity-80" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{l.name}</span>
                <span className="shrink-0 text-[10.5px] text-fg-subtle">
                  {basename(l.path)}:{l.line}
                </span>
              </button>
            ))
          ) : (
            <EmptyState icon={<Tag />} title={t('outline.noLabels')} description={t('outline.noLabelsHint')} />
          )
        ) : floats.length ? (
          floats.map((f, i) => (
            <button
              key={`${f.fileId}:${f.line}:${i}`}
              onClick={() => go(f.fileId, f.line)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              {f.kind === 'table' ? <Table2 className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" /> : <Image className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 leading-snug text-fg">{f.caption || <span className="italic text-fg-subtle">{t('outline.noCaption')}</span>}</span>
                <span className="mt-0.5 block truncate text-[10.5px] text-fg-subtle">
                  {f.label ? <span className="font-mono">{f.label}</span> : f.kind} · {basename(f.path)}:{f.line}
                </span>
              </span>
            </button>
          ))
        ) : (
          <EmptyState icon={<Image />} title={t('outline.noFloats')} description={t('outline.noFloatsHint')} />
        )}
      </div>
      {structure && (
        <div className="flex h-7 shrink-0 items-center gap-1.5 border-t border-border px-3 text-[11px] text-fg-subtle">
          <BookMarked className="size-3.5" />
          {t('outline.bibEntries', { count: structure.bibCount })}
          <span className="ml-auto truncate">{structure.files.length > 1 ? t('outline.fileCount', { count: structure.files.length }) : ''}</span>
        </div>
      )}
    </div>
  );
}
