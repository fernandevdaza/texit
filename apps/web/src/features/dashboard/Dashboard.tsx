import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  ArchiveRestore,
  ArrowDownUp,
  ChevronDown,
  Clock,
  Download,
  FileArchive,
  FilePlus2,
  FolderInput,
  FolderOpen,
  HardDrive,
  Hash,
  LayoutGrid,
  Library,
  Link2,
  List,
  Moon,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectSummary } from '@texit/core';
import { useProjects } from '@/services/projects';
import { executeCommand } from '@/services/commands';
import { useResolvedTheme, useSettings } from '@/state/settings';
import { host, isDesktop, isMac } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { Avatar, Button, ContextMenu, DropdownMenu, EmptyState, IconButton, Kbd, Logo, Segmented, Tooltip, type MenuEntry } from '@/ui';
import { fuzzyWords } from '@/features/palette/fuzzy';
import { Hero } from './Hero';
import { ProjectCard, ProjectRow, projectMenu } from './ProjectCard';
import { ensurePreviews, prunePreviews } from './preview';
import { focusSearch, useDashboardPrefs, useDashboardSearch as useSearch, useDashboardUi, type DashSection, type SortKey } from './store';
import * as actions from './actions';

const sortLabels: Record<SortKey, string> = { opened: 'Last opened', modified: 'Last modified', name: 'Name', created: 'Date created' };

const sectionMeta: Record<'all' | 'recent' | 'starred' | 'shared' | 'trash', { label: string; icon: LucideIcon }> = {
  all: { label: 'All projects', icon: Library },
  recent: { label: 'Recent', icon: Clock },
  starred: { label: 'Starred', icon: Star },
  shared: { label: 'Shared', icon: Users },
  trash: { label: 'Trash', icon: Trash2 },
};

function sortProjects(list: ProjectSummary[], sort: SortKey) {
  const out = [...list];
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  else if (sort === 'created') out.sort((a, b) => b.createdAt - a.createdAt);
  else if (sort === 'modified') out.sort((a, b) => b.updatedAt - a.updatedAt);
  else out.sort((a, b) => (b.openedAt || b.updatedAt) - (a.openedAt || a.updatedAt));
  return out;
}

export function newProjectMenu(): MenuEntry[] {
  return [
    { label: 'Blank project', icon: <FilePlus2 />, onSelect: () => void actions.createBlankProject() },
    { label: 'From template…', icon: <LayoutGrid />, shortcut: 'Mod-Alt-n', onSelect: () => useDashboardUi.getState().openNewProject() },
    { type: 'separator' },
    { label: 'Import .zip…', icon: <FileArchive />, onSelect: () => void actions.pickAndImportZip() },
    ...(isDesktop ? [{ label: 'Open folder…', icon: <FolderOpen />, onSelect: () => void actions.openFolderDesktop() } as MenuEntry] : []),
    { label: 'Join shared project…', icon: <Link2 />, onSelect: () => useDashboardUi.getState().setJoinOpen(true) },
  ];
}

// ───────────────────────────── shell ─────────────────────────────

export function Dashboard() {
  const projects = useProjects((s) => s.projects);
  const loaded = useProjects((s) => s.loaded);
  const [section, setSection] = useState<DashSection>('all');
  const [forceList, setForceList] = useState(false);

  useEffect(() => {
    void useProjects.getState().refresh();
    document.title = 'TexIt';
    host?.app.setTitle('TexIt');
  }, []);

  useEffect(() => {
    if (!loaded) return;
    ensurePreviews(projects);
    prunePreviews(new Set(projects.map((p) => p.id)));
  }, [projects, loaded]);

  const live = projects.filter((p) => !p.trashed);
  const showHero = loaded && live.length === 0 && !forceList && section !== 'trash';

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col bg-bg">
        <Header
          hero={showHero}
          trashCount={projects.length - live.length}
          onTrash={() => {
            setForceList(true);
            setSection('trash');
          }}
        />
        {showHero ? (
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Hero />
          </main>
        ) : (
          <Projects section={section} setSection={setSection} loaded={loaded} />
        )}
        <DropOverlay />
      </div>
    </MotionConfig>
  );
}

function SearchBox({ className, inputClassName }: { className?: string; inputClassName?: string }) {
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const d = focusSearch.on(() => {
      const el = ref.current;
      if (el && el.offsetParent !== null) {
        el.focus();
        el.select();
      }
    });
    return () => d.dispose();
  }, []);
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      <input
        ref={ref}
        data-dashboard-search
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (query) setQuery('');
            else e.currentTarget.blur();
          } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
            const first = document.querySelector<HTMLElement>('[data-idx="0"]');
            if (!first) return;
            e.preventDefault();
            if (e.key === 'Enter') first.click();
            else first.focus();
          }
        }}
        placeholder="Search projects…"
        className={cn(
          'h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-16 text-[13px] text-fg shadow-xs outline-none transition-[border,box-shadow,background] placeholder:text-fg-subtle hover:border-border-strong focus:border-accent focus:ring-4 focus:ring-accent/12',
          inputClassName,
        )}
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery('');
            ref.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <Kbd keys="Mod-k" className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:inline-flex" />
      )}
    </div>
  );
}


function Header({ hero, trashCount, onTrash }: { hero: boolean; trashCount: number; onTrash: () => void }) {
  const theme = useResolvedTheme((s) => s.theme);
  const set = useSettings((s) => s.set);
  const userName = useSettings((s) => s.userName);
  const userColor = useSettings((s) => s.userColor);
  const macDesktop = isDesktop && isMac;

  return (
    <header
      className={cn(
        'app-drag relative z-20 flex h-14 shrink-0 items-center gap-3 pr-3 sm:pr-4',
        hero ? 'bg-transparent' : 'border-b border-border bg-bg/80 backdrop-blur-xl',
        macDesktop ? 'pl-[84px]' : 'pl-4 sm:pl-5',
      )}
    >
      <a href="#/" className="app-no-drag flex items-center gap-2.5 rounded-lg pr-1" aria-label="TexIt home">
        <Logo size={26} className="drop-shadow-[0_4px_10px_rgb(91_91_240/0.35)]" />
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">TexIt</span>
      </a>

      {!hero && (
        <div className="app-no-drag mx-auto hidden w-[min(520px,42vw)] sm:block">
          <SearchBox />
        </div>
      )}
      {hero && <div className="flex-1" />}

      <div className={cn('app-no-drag flex items-center gap-1', !hero && 'ml-auto sm:ml-0')}>
        {hero && trashCount > 0 && (
          <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={onTrash} className="text-fg-subtle">
            Trash · {trashCount}
          </Button>
        )}
        {!hero && (
          <div className="mr-1.5 flex">
            <Tooltip content="New project" shortcut="Mod-Alt-n">
              <Button variant="primary" icon={<Plus />} onClick={() => useDashboardUi.getState().openNewProject()} className="rounded-r-none pr-2.5">
                <span className="hidden sm:inline">New project</span>
                <span className="sm:hidden">New</span>
              </Button>
            </Tooltip>
            <DropdownMenu
              align="end"
              items={newProjectMenu()}
              trigger={
                <Button variant="primary" aria-label="More ways to create a project" className="rounded-l-none border-l border-white/20 px-1.5">
                  <ChevronDown />
                </Button>
              }
            />
          </div>
        )}
        <IconButton label={theme === 'dark' ? 'Light theme' : 'Dark theme'} size="md" onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </IconButton>
        <IconButton label="Settings" shortcut="Mod-," size="md" onClick={() => void executeCommand('app.settings')}>
          <Settings />
        </IconButton>
        <Tooltip content={`${userName} — profile`}>
          <button type="button" aria-label="Profile" onClick={() => void executeCommand('app.settings', 'profile')} className="ml-1 rounded-full transition-transform hover:scale-105 active:scale-95">
            <Avatar name={userName} color={userColor} size={28} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

// ───────────────────────────── projects view ─────────────────────────────

function Projects({ section, setSection, loaded }: { section: DashSection; setSection: (s: DashSection) => void; loaded: boolean }) {
  const projects = useProjects((s) => s.projects);
  const { view, sort, setView, setSort } = useDashboardPrefs();
  const query = useSearch((s) => s.query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);
  const anchor = useRef<number | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const live = useMemo(() => projects.filter((p) => !p.trashed), [projects]);
  const tags = useMemo(() => actions.projectsByTag(projects), [projects]);
  const counts = {
    all: live.length,
    recent: live.filter((p) => p.openedAt).length,
    starred: live.filter((p) => p.starred).length,
    shared: live.filter((p) => p.collab).length,
    trash: projects.length - live.length,
  };

  // If the selected tag disappears, fall back to "All".
  useEffect(() => {
    if (section.startsWith('tag:') && !tags.some(([t]) => `tag:${t}` === section)) setSection('all');
  }, [section, tags, setSection]);

  const items = useMemo(() => {
    let list: ProjectSummary[];
    if (section === 'trash') list = projects.filter((p) => p.trashed);
    else if (section === 'starred') list = live.filter((p) => p.starred);
    else if (section === 'shared') list = live.filter((p) => p.collab);
    else if (section === 'recent') list = live.filter((p) => p.openedAt).sort((a, b) => b.openedAt - a.openedAt).slice(0, 12);
    else if (section.startsWith('tag:')) list = live.filter((p) => p.tags?.includes(section.slice(4)));
    else list = live;
    if (section !== 'recent') list = sortProjects(list, sort);
    const q = query.trim();
    if (!q) return list.map((p) => ({ p, positions: undefined as number[] | undefined }));
    const ql = q.toLowerCase();
    return list
      .map((p) => {
        const r = fuzzyWords(q, p.name);
        if (r) return { p, positions: r.positions, score: r.score };
        const meta = `${(p.tags ?? []).join(' ')} ${p.engine}`.toLowerCase();
        return meta.includes(ql) ? { p, positions: [], score: -5 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score) as { p: ProjectSummary; positions?: number[] }[];
  }, [projects, live, section, sort, query]);

  // Keep selection & focus in range.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(items.map((i) => i.p.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
    setFocusIdx((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items]);
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [section]);

  const selectedIds = [...selected];
  const selecting = selected.size > 0;

  const focusItem = (i: number) => {
    const idx = Math.max(0, Math.min(items.length - 1, i));
    setFocusIdx(idx);
    const el = itemRefs.current[idx];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };

  const columns = () => {
    if (view === 'list') return 1;
    const els = itemRefs.current.filter(Boolean) as HTMLElement[];
    if (!els.length) return 1;
    const top = els[0]!.getBoundingClientRect().top;
    return Math.max(1, els.filter((el) => Math.abs(el.getBoundingClientRect().top - top) < 4).length);
  };

  const toggle = (p: ProjectSummary, index: number, range: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      if (range && anchor.current != null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        for (let i = a; i <= b; i++) next.add(items[i]!.p.id);
      } else if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
    if (!range) anchor.current = index;
  };

  const onActivate = (e: MouseEvent, p: ProjectSummary, index: number) => {
    if (useDashboardUi.getState().renaming) return;
    setFocusIdx(index);
    if (e.metaKey || e.ctrlKey || e.shiftKey || selecting || p.trashed) toggle(p, index, e.shiftKey);
    else actions.openProject(p.id);
  };

  const targetIds = (p: ProjectSummary) => (selected.has(p.id) ? selectedIds : [p.id]);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.target !== e.currentTarget) return;
    const p = items[index]?.p;
    if (!p) return;
    const mod = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusItem(index + (view === 'list' ? 0 : 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusItem(index - (view === 'list' ? 0 : 1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusItem(index + columns());
        if (e.shiftKey) toggle(items[Math.min(items.length - 1, index + columns())]!.p, index + columns(), false);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (index - columns() < 0) {
          document.querySelector<HTMLInputElement>('[data-dashboard-search]')?.focus();
          break;
        }
        focusItem(index - columns());
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (p.trashed) toggle(p, index, false);
        else if (mod) actions.openProjectInNewWindow(p.id);
        else actions.openProject(p.id);
        break;
      case ' ':
        e.preventDefault();
        toggle(p, index, e.shiftKey);
        break;
      case 'F2':
        e.preventDefault();
        if (!p.trashed) useDashboardUi.getState().setRenaming(p.id);
        break;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        if (section === 'trash') void actions.deleteForever(targetIds(p));
        else void actions.moveToTrash(targetIds(p));
        break;
      case 's':
      case 'S':
        if (mod || p.trashed) break;
        e.preventDefault();
        void actions.setStarred(targetIds(p), !p.starred);
        break;
      case 'a':
        if (mod) {
          e.preventDefault();
          setSelected(new Set(items.map((i) => i.p.id)));
        }
        break;
      case 'Escape':
        if (selecting) {
          e.preventDefault();
          setSelected(new Set());
        }
        break;
    }
  };

  // "/" focuses the search; Escape clears the selection.
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input,textarea,[contenteditable=true],[role=dialog],[role=menu]');
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        focusSearch.emit();
      } else if (e.key === 'Escape' && selected.size) {
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selected]);

  const title = section.startsWith('tag:') ? `#${section.slice(4)}` : sectionMeta[section as keyof typeof sectionMeta].label;

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar section={section} setSection={setSection} counts={counts} tags={tags} />
      <main ref={containerRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
        <div className="mx-auto max-w-[1320px] px-4 pb-28 pt-5 sm:px-8 sm:pt-7">
          {/* Mobile: search + sections */}
          <div className="mb-4 space-y-3 sm:hidden">
            <SearchBox />
            <MobileSections section={section} setSection={setSection} counts={counts} tags={tags} />
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <h1 className="truncate text-[22px] font-semibold tracking-[-0.025em] text-fg">{title}</h1>
              <span className="text-[13px] tabular-nums text-fg-subtle">
                {query ? `${items.length} of ${section === 'trash' ? counts.trash : items.length}` : items.length}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {section === 'trash' && counts.trash > 0 && (
                <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => void actions.emptyTrash()}>
                  Empty trash
                </Button>
              )}
              {section !== 'recent' && (
                <DropdownMenu
                  align="end"
                  items={[
                    { type: 'label', label: 'Sort by' },
                    ...(Object.keys(sortLabels) as SortKey[]).map((k) => ({ label: sortLabels[k], checked: sort === k, onSelect: () => setSort(k) })),
                  ]}
                  trigger={
                    <Button size="sm" variant="ghost" icon={<ArrowDownUp />} className="text-fg-muted">
                      <span className="hidden sm:inline">{sortLabels[sort]}</span>
                    </Button>
                  }
                />
              )}
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: 'grid', label: '', icon: <LayoutGrid />, title: 'Grid' },
                  { value: 'list', label: '', icon: <List />, title: 'List' },
                ]}
              />
            </div>
          </div>

          {section === 'trash' && counts.trash > 0 && (
            <p className="-mt-2 mb-5 text-[12px] text-fg-subtle">Projects in the trash stay on this device until you delete them forever.</p>
          )}

          {!loaded ? (
            <Skeleton view={view} />
          ) : items.length === 0 ? (
            <Empty section={section} query={query} />
          ) : view === 'grid' ? (
            <div role="grid" aria-label={title} className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(232px,1fr))] sm:gap-5">
              <AnimatePresence mode="popLayout" initial={false}>
                {items.map(({ p, positions }, i) => (
                  <motion.div
                    key={p.id}
                    layout="position"
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
                    transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
                  >
                    <ContextMenu items={() => projectMenu(p, selectedIds)}>
                      <ProjectCard
                        ref={(el) => {
                          itemRefs.current[i] = el;
                        }}
                        p={p}
                        index={i}
                        query={query}
                        queryPositions={positions}
                        selected={selected.has(p.id)}
                        selecting={selecting}
                        focused={i === focusIdx}
                        sort={sort}
                        selectedIds={selectedIds}
                        onActivate={onActivate}
                        onToggleSelect={toggle}
                        onKeyDown={onKeyDown}
                        onFocus={setFocusIdx}
                      />
                    </ContextMenu>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div role="grid" aria-label={title}>
              <ListHeader sort={sort} setSort={setSort} />
              <AnimatePresence mode="popLayout" initial={false}>
                {items.map(({ p, positions }, i) => (
                  <motion.div key={p.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                    <ContextMenu items={() => projectMenu(p, selectedIds)}>
                      <ProjectRow
                        ref={(el) => {
                          itemRefs.current[i] = el;
                        }}
                        p={p}
                        index={i}
                        query={query}
                        queryPositions={positions}
                        selected={selected.has(p.id)}
                        selecting={selecting}
                        focused={i === focusIdx}
                        sort={sort}
                        selectedIds={selectedIds}
                        onActivate={onActivate}
                        onToggleSelect={toggle}
                        onKeyDown={onKeyDown}
                        onFocus={setFocusIdx}
                      />
                    </ContextMenu>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>
      <BulkBar ids={selectedIds} trash={section === 'trash'} onClear={() => setSelected(new Set())} onSelectAll={() => setSelected(new Set(items.map((i) => i.p.id)))} total={items.length} />
    </div>
  );
}

function ListHeader({ sort, setSort }: { sort: SortKey; setSort: (s: SortKey) => void }) {
  const H = ({ k, children, className }: { k?: SortKey; children: ReactNode; className?: string }) =>
    k ? (
      <button type="button" onClick={() => setSort(k)} className={cn('flex items-center gap-1 text-left uppercase tracking-wider hover:text-fg', sort === k && 'text-fg', className)}>
        {children}
        {sort === k && <ChevronDown className="size-3" />}
      </button>
    ) : (
      <span className={className}>{children}</span>
    );
  return (
    <div className="mb-1 grid h-8 grid-cols-[18px_34px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 text-[11px] font-medium uppercase tracking-wider text-fg-subtle md:grid-cols-[18px_34px_minmax(0,1fr)_100px_150px_auto]">
      <span />
      <span />
      <H k="name">Name</H>
      <H className="hidden md:flex">Engine</H>
      <H k={sort === 'created' ? 'created' : sort === 'modified' ? 'modified' : 'opened'} className="hidden md:flex">
        {sortLabels[sort === 'name' ? 'opened' : sort]}
      </H>
      <span className="w-[60px]" />
    </div>
  );
}

// ───────────────────────────── sidebar ─────────────────────────────

type Counts = Record<'all' | 'recent' | 'starred' | 'shared' | 'trash', number>;

function NavItem({ active, icon, label, count, onClick, tone }: { active: boolean; icon: ReactNode; label: ReactNode; count?: number; onClick: () => void; tone?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors [&_svg]:size-4',
        active ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted', tone)}>{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count != null && count > 0 && <span className="text-[11.5px] tabular-nums text-fg-subtle">{count}</span>}
    </button>
  );
}

function Sidebar({ section, setSection, counts, tags }: { section: DashSection; setSection: (s: DashSection) => void; counts: Counts; tags: [string, number][] }) {
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-border bg-surface/40 md:flex">
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Library">
        {(Object.keys(sectionMeta) as (keyof typeof sectionMeta)[]).map((k) => {
          const M = sectionMeta[k];
          return (
            <div key={k} className={cn(k === 'trash' && 'mt-2 border-t border-border pt-2')}>
              <NavItem active={section === k} icon={<M.icon />} label={M.label} count={counts[k]} onClick={() => setSection(k)} />
            </div>
          );
        })}
        {tags.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">Tags</div>
            {tags.map(([t, n]) => (
              <NavItem key={t} active={section === `tag:${t}`} icon={<Hash />} label={t} count={n} onClick={() => setSection(`tag:${t}`)} />
            ))}
          </>
        )}
      </nav>
      <div className="m-3 rounded-xl border border-border bg-surface p-3 shadow-xs">
        <div className="flex items-center gap-2 text-[12px] font-medium text-fg">
          <HardDrive className="size-3.5 text-success" /> Stored on this device
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
          {isDesktop ? 'Projects are saved locally and can be mirrored to folders on disk.' : 'Private by design. Download a .zip anytime to back up or move projects.'}
        </p>
        <button
          type="button"
          onClick={() => void executeCommand('help.shortcuts')}
          className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-subtle transition-colors hover:text-fg"
        >
          Keyboard shortcuts <Kbd keys="Mod-/" />
        </button>
      </div>
    </aside>
  );
}

function MobileSections({ section, setSection, counts, tags }: { section: DashSection; setSection: (s: DashSection) => void; counts: Counts; tags: [string, number][] }) {
  const chip = (id: DashSection, label: ReactNode, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setSection(id)}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors',
        section === id ? 'border-transparent bg-fg text-bg' : 'border-border bg-surface text-fg-muted',
      )}
    >
      {label}
      {count ? <span className="opacity-60">{count}</span> : null}
    </button>
  );
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {(Object.keys(sectionMeta) as (keyof typeof sectionMeta)[]).map((k) => chip(k, sectionMeta[k].label, k === 'all' ? undefined : counts[k]))}
      {tags.map(([t, n]) => chip(`tag:${t}`, `#${t}`, n))}
    </div>
  );
}

// ───────────────────────────── states ─────────────────────────────

function Skeleton({ view }: { view: 'grid' | 'list' }) {
  if (view === 'list')
    return (
      <div className="space-y-1">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-[52px] items-center gap-3 px-3">
            <div className="skeleton h-[38px] w-[34px] rounded-[5px]" />
            <div className="skeleton h-3 rounded-full" style={{ width: `${30 + ((i * 17) % 30)}%` }} />
          </div>
        ))}
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(232px,1fr))] sm:gap-5">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="skeleton aspect-[16/10]" />
          <div className="space-y-2 p-3.5">
            <div className="skeleton h-3 w-2/3 rounded-full" />
            <div className="skeleton h-2.5 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ section, query }: { section: DashSection; query: string }) {
  const setQuery = useSearch((s) => s.setQuery);
  if (query.trim())
    return (
      <EmptyState
        className="py-24"
        icon={<Search />}
        title={`No projects match “${query.trim()}”`}
        description="Try another name, a #tag or an engine like xelatex."
        action={
          <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
            Clear search
          </Button>
        }
      />
    );
  const map: Record<string, { icon: ReactNode; title: string; description: string; action?: ReactNode }> = {
    all: {
      icon: <Library />,
      title: 'No projects yet',
      description: 'Create one from a template, or drop an Overleaf .zip anywhere on this page.',
      action: (
        <Button variant="primary" icon={<Plus />} onClick={() => useDashboardUi.getState().openNewProject()}>
          New project
        </Button>
      ),
    },
    recent: { icon: <Clock />, title: 'Nothing opened yet', description: 'Projects you open show up here for quick access.' },
    starred: { icon: <Star />, title: 'No starred projects', description: 'Star the projects you work on most — press S on a focused card.' },
    shared: {
      icon: <Users />,
      title: 'No shared projects',
      description: 'Share a project from the editor, or join one with an invite link.',
      action: (
        <Button variant="secondary" icon={<Link2 />} onClick={() => useDashboardUi.getState().setJoinOpen(true)}>
          Join with a link
        </Button>
      ),
    },
    trash: { icon: <Trash2 />, title: 'Trash is empty', description: 'Deleted projects stay here until you remove them forever.' },
  };
  const m = map[section] ?? { icon: <Hash />, title: 'No projects with this tag', description: 'Add tags from a project’s menu.' };
  return <EmptyState className="py-24" icon={m.icon} title={m.title} description={m.description} action={m.action} />;
}

function BulkBar({ ids, trash, onClear, onSelectAll, total }: { ids: string[]; trash: boolean; onClear: () => void; onSelectAll: () => void; total: number }) {
  const btn = 'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors hover:bg-white/10 [&_svg]:size-4';
  return (
    <AnimatePresence>
      {ids.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 16, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          className="fixed bottom-6 left-1/2 z-40 flex items-center gap-1 rounded-2xl border border-white/10 bg-[#18181b]/95 p-1.5 pl-3.5 text-white shadow-[0_20px_50px_-12px_rgb(0_0_0/0.5)] backdrop-blur-xl dark:bg-[#26262e]/95"
          role="toolbar"
          aria-label="Selection actions"
        >
          <span className="mr-1.5 text-[12.5px] tabular-nums text-white/70">{ids.length} selected</span>
          {ids.length < total && (
            <button type="button" className={cn(btn, 'text-white/70')} onClick={onSelectAll}>
              Select all
            </button>
          )}
          <span className="mx-1 h-5 w-px bg-white/15" />
          {trash ? (
            <>
              <button type="button" className={btn} onClick={() => void actions.restore(ids).then(onClear)}>
                <ArchiveRestore /> Restore
              </button>
              <button type="button" className={cn(btn, 'text-[#ff8a8f]')} onClick={() => void actions.deleteForever(ids).then((ok) => ok && onClear())}>
                <Trash2 /> Delete forever
              </button>
            </>
          ) : (
            <>
              <button type="button" className={btn} onClick={() => void actions.setStarred(ids, true)}>
                <Star /> <span className="hidden sm:inline">Star</span>
              </button>
              <button type="button" className={btn} onClick={() => ids.forEach((id) => void actions.downloadProjectZip(id))}>
                <Download /> <span className="hidden sm:inline">Download</span>
              </button>
              <button type="button" className={cn(btn, 'text-[#ff8a8f]')} onClick={() => void actions.moveToTrash(ids).then(onClear)}>
                <Trash2 /> <span className="hidden sm:inline">Trash</span>
              </button>
            </>
          )}
          <button type="button" aria-label="Clear selection" className={cn(btn, 'px-2 text-white/60')} onClick={onClear}>
            <X />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────────── drag & drop ─────────────────────────────

function DropOverlay() {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

  const reset = useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      reset();
      if (e.dataTransfer) void actions.collectDrop(e.dataTransfer);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('blur', reset);
    };
  }, [reset]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-bg/70 p-6 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.94, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="relative flex w-[min(520px,100%)] flex-col items-center rounded-3xl border-2 border-dashed border-accent/60 bg-surface/90 px-10 py-14 text-center shadow-2xl"
          >
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_srgb,var(--tx-accent)_16%,transparent),transparent)]" />
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--tx-accent),#b06cff)] text-white shadow-lg shadow-accent/30"
            >
              <FolderInput className="size-7" />
            </motion.div>
            <div className="relative text-[18px] font-semibold tracking-tight text-fg">Drop to import</div>
            <p className="relative mt-1.5 max-w-xs text-[13px] leading-relaxed text-fg-muted">Overleaf .zip archives, project folders or loose .tex files become new projects.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
