import { forwardRef, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ArchiveRestore,
  CalendarPlus,
  Clock,
  PenLine,
  Check,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Pencil,
  Star,
  Tag,
  Trash2,
  Users,
} from 'lucide-react';
import type { ProjectSummary } from '@texit/core';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { intlLocale, t as tr, useT } from '@/lib/i18n';
import { Badge, DropdownMenu, type MenuEntry } from '@/ui';
import { Highlight } from '@/ui/Highlight';
import { usePreviews } from './preview';
import { Cover, Paper, coverBackground, coverColors } from './Paper';
import { useDashboardUi, type SortKey } from './store';
import * as actions from './actions';

export function projectMenu(p: ProjectSummary, selectedIds: string[]): MenuEntry[] {
  const ids = selectedIds.includes(p.id) && selectedIds.length > 1 ? selectedIds : [p.id];
  const many = ids.length > 1;
  if (p.trashed) {
    return [
      { label: many ? tr('dashboard.card.restoreMany', { count: ids.length }) : tr('dashboard.card.restore'), icon: <ArchiveRestore />, onSelect: () => void actions.restore(ids) },
      { type: 'separator' },
      { label: many ? tr('dashboard.card.deleteManyForever', { count: ids.length }) : tr('dashboard.card.deleteForever'), icon: <Trash2 />, danger: true, onSelect: () => void actions.deleteForever(ids) },
    ];
  }
  if (many) {
    return [
      { type: 'label', label: tr('dashboard.card.selectedCount', { count: ids.length }) },
      { label: tr('dashboard.card.star'), icon: <Star />, onSelect: () => void actions.setStarred(ids, true) },
      { label: tr('dashboard.card.unstar'), icon: <Star />, onSelect: () => void actions.setStarred(ids, false) },
      { label: tr('dashboard.card.downloadZip'), icon: <Download />, onSelect: () => ids.forEach((id) => void actions.downloadProjectZip(id)) },
      { type: 'separator' },
      { label: tr('dashboard.card.moveToTrash'), icon: <Trash2 />, danger: true, shortcut: 'Backspace', onSelect: () => void actions.moveToTrash(ids) },
    ];
  }
  return [
    { label: tr('common.open'), icon: <FolderOpen />, shortcut: 'Enter', onSelect: () => actions.openProject(p.id) },
    { label: tr('dashboard.card.openNewWindow'), icon: <ExternalLink />, onSelect: () => actions.openProjectInNewWindow(p.id) },
    { type: 'separator' },
    { label: tr('common.rename'), icon: <Pencil />, hint: 'F2', onSelect: () => useDashboardUi.getState().setRenaming(p.id) },
    { label: tr('common.duplicate'), icon: <Copy />, onSelect: () => void actions.duplicate(p.id) },
    { label: tr('dashboard.card.downloadZip'), icon: <Download />, onSelect: () => void actions.downloadProjectZip(p.id) },
    { type: 'separator' },
    { label: p.starred ? tr('dashboard.card.removeStar') : tr('dashboard.card.star'), icon: <Star />, hint: 'S', onSelect: () => void actions.setStarred([p.id], !p.starred) },
    { label: tr('dashboard.card.tags'), icon: <Tag />, onSelect: () => useDashboardUi.getState().setTagsFor(p.id) },
    { type: 'separator' },
    { label: tr('dashboard.card.moveToTrash'), icon: <Trash2 />, danger: true, hint: '⌫', onSelect: () => void actions.moveToTrash([p.id]) },
  ];
}

/** Relative time for the active sort key (locale-formatted, so no English prefix). */
export function timeLabel(p: ProjectSummary, sort: SortKey) {
  if (sort === 'created') return timeAgo(p.createdAt);
  if (sort === 'modified' || !p.openedAt) return timeAgo(p.updatedAt);
  return timeAgo(p.openedAt);
}

function timeTitle(p: ProjectSummary) {
  const f = (ts: number) => (ts ? new Date(ts).toLocaleString(intlLocale()) : '—');
  return tr('dashboard.card.timeTitle', { opened: f(p.openedAt), modified: f(p.updatedAt), created: f(p.createdAt) });
}

function RenameInput({ p, className }: { p: ProjectSummary; className?: string }) {
  const [v, setV] = useState(p.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    useDashboardUi.getState().setRenaming(null);
    if (commit && v.trim() && v.trim() !== p.name) void actions.rename(p.id, v);
  };
  return (
    <input
      ref={ref}
      value={v}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      className={cn('-mx-1 w-full rounded-md border border-accent bg-surface px-1 text-fg outline-none ring-3 ring-accent/15', className)}
    />
  );
}

export interface CardProps {
  p: ProjectSummary;
  index: number;
  selected: boolean;
  selecting: boolean;
  focused: boolean;
  query: string;
  queryPositions?: number[];
  sort: SortKey;
  selectedIds: string[];
  onActivate(e: MouseEvent, p: ProjectSummary, index: number): void;
  onToggleSelect(p: ProjectSummary, index: number, range: boolean): void;
  onKeyDown(e: KeyboardEvent, index: number): void;
  onFocus(index: number): void;
}

function StarButton({ p, className }: { p: ProjectSummary; className?: string }) {
  const t = useT();
  if (p.trashed) return null;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={p.starred ? t('dashboard.card.removeStar') : t('dashboard.card.star')}
      onClick={(e) => {
        e.stopPropagation();
        void actions.setStarred([p.id], !p.starred);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'flex size-7 items-center justify-center rounded-lg transition-[opacity,transform,color] duration-150 hover:scale-110 active:scale-95',
        p.starred ? 'text-amber-400 opacity-100' : 'text-fg-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:text-fg',
        className,
      )}
    >
      <Star className={cn('size-4', p.starred && 'fill-current drop-shadow-[0_1px_2px_rgb(0_0_0/0.2)]')} />
    </button>
  );
}

function SelectBox({ checked, visible, onClick }: { checked: boolean; visible: boolean; onClick: (e: MouseEvent) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      tabIndex={-1}
      role="checkbox"
      aria-checked={checked}
      aria-label={t('dashboard.card.select')}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'flex size-[18px] items-center justify-center rounded-[5px] border transition-[opacity,background,border] duration-150',
        checked ? 'border-accent bg-accent text-accent-fg opacity-100' : 'border-black/20 bg-white/80 text-transparent backdrop-blur hover:border-accent dark:border-white/25 dark:bg-black/40',
        !checked && !visible && 'opacity-0 group-hover:opacity-100',
      )}
    >
      <Check className="size-3" strokeWidth={3.5} />
    </button>
  );
}

function Meta({ p, sort }: { p: ProjectSummary; sort: SortKey }) {
  const t = useT();
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-subtle">
      <span className="flex min-w-0 items-center gap-1 truncate" title={timeTitle(p)}>
        {sort === 'created' ? <CalendarPlus className="size-3 shrink-0" /> : sort === 'modified' || !p.openedAt ? <PenLine className="size-3 shrink-0" /> : <Clock className="size-3 shrink-0" />}
        <span className="truncate">{p.trashed ? timeAgo(p.updatedAt) : timeLabel(p, sort)}</span>
      </span>
      <span className="hidden text-fg-subtle/50 sm:inline">·</span>
      <span className="hidden shrink-0 sm:inline">{actions.engineLabel[p.engine] ?? p.engine}</span>
      {p.collab && (
        <Badge tone="info" className="ml-0.5 shrink-0">
          <Users /> {p.collab.role === 'owner' ? t('dashboard.card.shared') : t('dashboard.card.guest')}
        </Badge>
      )}
      {p.folderPath && (
        <span title={p.folderPath} className="shrink-0">
          <HardDrive className="size-3" />
        </span>
      )}
    </div>
  );
}

export const ProjectCard = forwardRef<HTMLDivElement, CardProps>(function ProjectCard(props, ref) {
  const { p, index, selected, selecting, focused, query, queryPositions, sort, selectedIds } = props;
  const preview = usePreviews((s) => s.map[p.id]);
  const renaming = useDashboardUi((s) => s.renaming === p.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useT();

  return (
    <div
      ref={ref}
      role="gridcell"
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      aria-label={p.name}
      data-idx={index}
      onClick={(e) => props.onActivate(e, p, index)}
      onAuxClick={(e) => e.button === 1 && actions.openProjectInNewWindow(p.id)}
      onKeyDown={(e) => props.onKeyDown(e, index)}
      onFocus={() => props.onFocus(index)}
      className={cn(
        'group relative flex h-full cursor-default flex-col overflow-hidden rounded-2xl border bg-surface outline-none transition-[box-shadow,border-color,transform] duration-200 ease-out',
        'shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:-translate-y-0.5 hover:shadow-[0_14px_36px_-14px_rgb(0_0_0/0.28)] dark:hover:shadow-[0_14px_36px_-12px_rgb(0_0_0/0.7)]',
        'focus-visible:ring-3 focus-visible:ring-accent/35',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--tx-accent)]' : 'border-border hover:border-border-strong',
        menuOpen && 'border-border-strong',
        p.trashed && 'opacity-80',
      )}
    >
      <Cover
        background={coverBackground(p.id)}
        preview={preview}
        title={p.name}
        thumbnail={p.thumbnail}
        accent={coverColors(p.id)[0]}
        className={cn('aspect-[16/10] border-b border-border', p.trashed && 'grayscale-[60%]')}
      >
        <div className="absolute left-2.5 top-2.5">
          <SelectBox checked={selected} visible={selecting} onClick={(e) => props.onToggleSelect(p, index, e.shiftKey)} />
        </div>
        <div className="absolute right-2 top-2 flex items-center gap-1">
          <StarButton p={p} className="bg-white/70 backdrop-blur dark:bg-black/40" />
        </div>
        {p.tags?.length ? (
          <div className="absolute bottom-2 left-2.5 right-2.5 hidden flex-wrap gap-1 sm:flex">
            {p.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-md bg-white/75 px-1.5 py-[1px] text-[10.5px] font-medium text-zinc-700 shadow-sm backdrop-blur dark:bg-black/50 dark:text-zinc-200">
                #{tag}
              </span>
            ))}
            {p.tags.length > 3 && <span className="rounded-md bg-white/75 px-1.5 py-[1px] text-[10.5px] text-zinc-600 backdrop-blur dark:bg-black/50 dark:text-zinc-300">+{p.tags.length - 3}</span>}
          </div>
        ) : null}
      </Cover>
      <div className="flex items-start gap-1 px-3.5 pb-3 pt-2.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameInput p={p} className="h-6 text-[13.5px] font-semibold" />
          ) : (
            <div className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-fg" title={p.name}>
              <Highlight text={p.name} positions={query ? queryPositions : undefined} />
            </div>
          )}
          <Meta p={p} sort={sort} />
        </div>
        <DropdownMenu
          align="end"
          onOpenChange={setMenuOpen}
          items={projectMenu(p, selectedIds)}
          trigger={
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('dashboard.card.moreActions')}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className={cn(
                '-mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-[opacity,background] hover:bg-hover hover:text-fg',
                menuOpen ? 'bg-hover text-fg opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
            >
              <Ellipsis className="size-4" />
            </button>
          }
        />
      </div>
    </div>
  );
});

export const ProjectRow = forwardRef<HTMLDivElement, CardProps>(function ProjectRow(props, ref) {
  const { p, index, selected, selecting, focused, query, queryPositions, selectedIds } = props;
  const preview = usePreviews((s) => s.map[p.id]);
  const renaming = useDashboardUi((s) => s.renaming === p.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useT();
  return (
    <div
      ref={ref}
      role="row"
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      data-idx={index}
      onClick={(e) => props.onActivate(e, p, index)}
      onAuxClick={(e) => e.button === 1 && actions.openProjectInNewWindow(p.id)}
      onKeyDown={(e) => props.onKeyDown(e, index)}
      onFocus={() => props.onFocus(index)}
      className={cn(
        'group grid h-[52px] cursor-default grid-cols-[18px_34px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 outline-none transition-colors md:grid-cols-[18px_34px_minmax(0,1fr)_100px_150px_auto]',
        'focus-visible:ring-2 focus-visible:ring-accent/40',
        selected ? 'bg-accent-soft' : menuOpen ? 'bg-hover' : 'hover:bg-hover',
      )}
    >
      <SelectBox checked={selected} visible={selecting} onClick={(e) => props.onToggleSelect(p, index, e.shiftKey)} />
      <div className="relative h-[38px] w-[34px] overflow-hidden rounded-[5px] ring-1 ring-border" style={{ background: coverBackground(p.id) }}>
        <Paper preview={preview} fallbackTitle={p.name} thumbnail={p.thumbnail} accent={coverColors(p.id)[0]} className="absolute left-1/2 top-[5px] w-[26px] -translate-x-1/2 rounded-[1px] shadow-sm" />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {renaming ? (
            <RenameInput p={p} className="h-6 max-w-sm text-[13px] font-medium" />
          ) : (
            <span className="truncate text-[13px] font-medium text-fg">
              <Highlight text={p.name} positions={query ? queryPositions : undefined} />
            </span>
          )}
          {p.collab && (
            <Badge tone="info" className="shrink-0">
              <Users /> {p.collab.role === 'owner' ? t('dashboard.card.shared') : t('dashboard.card.guest')}
            </Badge>
          )}
          {p.tags?.slice(0, 3).map((tag) => (
            <span key={tag} className="hidden shrink-0 text-[11px] text-fg-subtle xl:inline">
              #{tag}
            </span>
          ))}
        </div>
        <div className="truncate text-[11.5px] text-fg-subtle md:hidden">{timeLabel(p, props.sort)}</div>
      </div>
      <span className="hidden text-[12px] text-fg-muted md:block">{actions.engineLabel[p.engine] ?? p.engine}</span>
      <span className="hidden truncate text-[12px] text-fg-muted md:block">{timeAgo(props.sort === 'created' ? p.createdAt : props.sort === 'opened' && p.openedAt ? p.openedAt : p.updatedAt)}</span>
      <div className="flex items-center gap-0.5">
        <StarButton p={p} />
        <DropdownMenu
          align="end"
          onOpenChange={setMenuOpen}
          items={projectMenu(p, selectedIds)}
          trigger={
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('dashboard.card.moreActions')}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'flex size-7 items-center justify-center rounded-lg text-fg-subtle transition-[opacity,background] hover:bg-active hover:text-fg',
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
            >
              <Ellipsis className="size-4" />
            </button>
          }
        />
      </div>
    </div>
  );
});
