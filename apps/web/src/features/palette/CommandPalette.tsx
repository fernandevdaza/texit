import { useMemo, useRef, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  ChevronRight,
  CircleQuestionMark,
  CornerDownLeft,
  File,
  FileCode2,
  FileImage,
  FileText,
  FolderClosed,
  Hash,
  Keyboard,
  ListOrdered,
  Presentation,
  Search,
  Tag,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { extname, type ProjectSummary } from '@texit/core';
import { useCommands, type Command as Cmd } from '@/services/commands';
import { useProjects } from '@/services/projects';
import { useWorkspace } from '@/state/workspace';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { navigate } from '@/lib/router';
import { commandCategory, commandTitle, useLocale, useT, type Locale } from '@/lib/i18n';
import { Kbd } from '@/ui';
import { Highlight } from '@/ui/Highlight';
import { DashboardDialogs } from '@/features/dashboard/Dialogs';
import { fuzzyPath, fuzzyWords } from './fuzzy';
import { modeOf, usePalette, usePaletteHistory, type PaletteMode } from './store';
import { extractSymbols } from './symbols';
import { ShortcutsSheet } from './ShortcutsSheet';
import { consumePrevFocus } from './focus';

/** Rendered once at the app root: palette + cheat sheet + global dialogs owned by dashboard/settings. */
export function CommandPalette() {
  return (
    <>
      <Palette />
      <ShortcutsSheet />
      <DashboardDialogs />
    </>
  );
}

// ───────────────────────────── model ─────────────────────────────

interface Item {
  value: string;
  title: string;
  titlePositions?: number[];
  titleOffset?: number;
  subtitle?: string;
  subtitlePositions?: number[];
  icon?: ReactNode;
  right?: ReactNode;
  indent?: number;
  disabled?: boolean;
  run?: () => void;
}

interface Group {
  heading?: string;
  items: Item[];
}

const categoryOrder = ['Project', 'File', 'Edit', 'Insert', 'Format', 'View', 'Compile', 'PDF', 'AI', 'Collaboration', 'History', 'Plugins', 'Preferences', 'Help'];

/** Commands surfaced on the dashboard when nothing is typed. */
const dashboardQuickCommands = ['project.new', 'project.newBlank', 'project.importZip', 'project.openFolder', 'project.join', 'app.settings', 'view.toggleTheme', 'help.shortcuts'];

/** Categories that only make sense with a project open (unless the command declares its own `when`). */
const projectOnlyCategories = new Set(['File', 'Edit', 'Insert', 'Format', 'Compile', 'PDF', 'AI', 'Collaboration', 'History']);

function isAvailable(c: Cmd) {
  if (c.hidden) return false;
  if (!c.when && c.category && projectOnlyCategories.has(c.category) && !useWorkspace.getState().project) return false;
  try {
    return !c.when || c.when();
  } catch {
    return false;
  }
}

function fileIcon(path: string): LucideIcon {
  const ext = extname(path);
  if (ext === 'tex' || ext === 'ltx' || ext === 'latex') return FileText;
  if (ext === 'bib') return BookOpen;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'eps'].includes(ext)) return FileImage;
  if (['sty', 'cls', 'bst', 'lua', 'py', 'js', 'json'].includes(ext)) return FileCode2;
  return File;
}

const fileTint: Record<string, string> = { tex: 'text-accent', bib: 'text-warning', pdf: 'text-danger', png: 'text-success', jpg: 'text-success', jpeg: 'text-success', svg: 'text-success' };

function CommandIcon({ cmd }: { cmd: Cmd }) {
  const I = cmd.icon ?? ChevronRight;
  return <I className={cn(!cmd.icon && 'opacity-40')} />;
}

function commandItem(c: Cmd, positions: number[] | undefined, close: (fn: () => void) => void, showCategory: boolean, locale: Locale): Item {
  return {
    value: `cmd:${c.id}`,
    title: commandTitle(c, locale),
    titlePositions: positions,
    icon: <CommandIcon cmd={c} />,
    right: (
      <>
        {showCategory && c.category && <span className="text-[11.5px] text-fg-subtle">{commandCategory(c.category, locale)}</span>}
        {c.keybinding && <Kbd keys={c.keybinding.split(/\s*\|\s*/)[0]!} />}
      </>
    ),
    run: () =>
      close(() => {
        usePaletteHistory.getState().pushCommand(c.id);
        // `when` was checked when the list was built (focus has moved since, e.g. back to the editor).
        const cmd = useCommands.getState().commands[c.id];
        if (cmd) void Promise.resolve(cmd.run()).catch((err) => console.error(`[texit] command ${c.id} failed`, err));
      }),
  };
}

/** Fuzzy-scores commands against the localized title first, then the English title, then category/keywords/id. */
function scoreCommands(cmds: Cmd[], q: string, recent: string[], locale: Locale) {
  const out: { c: Cmd; score: number; positions: number[] }[] = [];
  for (const c of cmds) {
    const title = commandTitle(c, locale);
    let r = fuzzyWords(q, title);
    let positions = r?.positions ?? [];
    if (!r && title !== c.title) {
      // English title still works in other languages (no highlight: positions refer to another string).
      r = fuzzyWords(q, c.title);
      if (r) {
        r = { ...r, score: r.score - 0.5 };
        positions = [];
      }
    }
    if (!r) {
      const hay = [c.category, c.category && commandCategory(c.category, locale), ...(c.keywords ?? []), c.id].filter(Boolean).join(' ');
      r = fuzzyWords(q, `${title} ${c.title} ${hay}`);
      if (r && r.score < 0.6) r = null;
      if (r) {
        r.score -= 2;
        positions = r.positions.filter((p) => p < title.length);
      }
    }
    if (!r) continue;
    const ri = recent.indexOf(c.id);
    out.push({ c, score: r.score + (ri >= 0 ? Math.max(0, 1.5 - ri * 0.1) : 0), positions });
  }
  return out.sort((a, b) => b.score - a.score);
}

function useGroups(query: string, close: (fn: () => void) => void): { groups: Group[]; mode: PaletteMode; empty: ReactNode } {
  const commands = useCommands((s) => s.commands);
  const projects = useProjects((s) => s.projects);
  const project = useWorkspace((s) => s.project);
  const session = useWorkspace((s) => s.session);
  const files = useWorkspace((s) => s.files);
  const activeFileId = useWorkspace((s) => s.activeFileId);
  const history = usePaletteHistory();
  const t = useT();
  const locale = useLocale();
  const mode = modeOf(query);
  const q = (mode === 'files' ? query : query.slice(1)).trim();

  // Source of the active file (symbols / go to line). Read once per open/file.
  const source = useMemo(() => {
    if (!project || !activeFileId || (mode !== 'symbols' && mode !== 'line')) return null;
    try {
      return project.readText(activeFileId);
    } catch {
      return null;
    }
  }, [project, activeFileId, mode]);
  const symbols = useMemo(() => (source != null && mode === 'symbols' ? extractSymbols(source) : []), [source, mode]);

  return useMemo(() => {
    const available = Object.values(commands).filter((c) => isAvailable(c) && c.id !== 'view.commandPalette');
    const activeFile = activeFileId ? files.find((f) => f.id === activeFileId) : undefined;
    const goFile = (id: string) => () => close(() => useWorkspace.getState().openFile(id));

    // ── commands ──
    if (mode === 'commands') {
      if (!q) {
        const recent = history.commands.map((id) => available.find((c) => c.id === id)).filter(Boolean).slice(0, 5) as Cmd[];
        const byCat = new Map<string, Cmd[]>();
        for (const c of available) {
          const cat = c.category ?? 'Other';
          if (!byCat.has(cat)) byCat.set(cat, []);
          byCat.get(cat)!.push(c);
        }
        const cats = [...byCat.keys()].sort((a, b) => {
          const ia = categoryOrder.indexOf(a);
          const ib = categoryOrder.indexOf(b);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
        });
        const groups: Group[] = [];
        if (recent.length)
          groups.push({ heading: t('palette.group.recentlyUsed'), items: recent.map((c) => ({ ...commandItem(c, undefined, close, true, locale), value: `recent:${c.id}` })) });
        for (const cat of cats) {
          groups.push({
            heading: commandCategory(cat, locale),
            items: byCat
              .get(cat)!
              .map((c) => commandItem(c, undefined, close, false, locale))
              .sort((a, b) => a.title.localeCompare(b.title, locale)),
          });
        }
        return { groups, mode, empty: t('palette.empty.noCommands') };
      }
      const scored = scoreCommands(available, q, history.commands, locale).slice(0, 60);
      return { groups: [{ items: scored.map((s) => commandItem(s.c, s.positions, close, true, locale)) }], mode, empty: t('palette.empty.commandsNoMatch', { query: q }) };
    }

    // ── symbols ──
    if (mode === 'symbols') {
      if (!project) return { groups: [], mode, empty: t('palette.empty.symbolsNoProject') };
      if (!activeFile || source == null) return { groups: [], mode, empty: t('palette.empty.symbolsNoFile') };
      const toItem = (s: (typeof symbols)[number], positions?: number[]): Item => {
        const Icon = s.kind === 'label' ? Tag : s.kind === 'frame' ? Presentation : Hash;
        return {
          value: `sym:${s.kind}:${s.line}:${s.title}`,
          title: s.title || t('palette.untitled'),
          titlePositions: positions,
          indent: q ? 0 : s.depth,
          icon: <Icon className={cn(s.kind === 'label' ? 'text-warning' : 'text-accent')} />,
          right: (
            <span className="flex items-center gap-2">
              <span className="text-[11px] capitalize text-fg-subtle">{t(`palette.kind.${s.kind}`, undefined, s.kind)}</span>
              <span className="font-mono text-[11px] tabular-nums text-fg-subtle">:{s.line}</span>
            </span>
          ),
          run: () => close(() => useWorkspace.getState().revealLocation(activeFile.id, s.line)),
        };
      };
      if (!q) {
        const heads = symbols.filter((s) => s.kind !== 'label');
        const labels = symbols.filter((s) => s.kind === 'label');
        const groups: Group[] = [];
        if (heads.length) groups.push({ heading: t('palette.group.outline', { file: activeFile.name }), items: heads.map((s) => toItem(s)) });
        if (labels.length) groups.push({ heading: t('palette.group.labels'), items: labels.map((s) => toItem(s)) });
        return { groups, mode, empty: t('palette.empty.noSymbols', { file: activeFile.name }) };
      }
      const scored = symbols
        .map((s) => ({ s, r: fuzzyWords(q, s.title) }))
        .filter((x) => x.r)
        .sort((a, b) => b.r!.score - a.r!.score)
        .slice(0, 80);
      return { groups: [{ items: scored.map((x) => toItem(x.s, x.r!.positions)) }], mode, empty: t('palette.empty.symbolsNoMatch', { query: q }) };
    }

    // ── go to line ──
    if (mode === 'line') {
      if (!project || !activeFile || source == null) return { groups: [], mode, empty: t('palette.empty.lineNoFile') };
      const total = source.split('\n').length;
      const m = /^(\d+)?(?:[:,](\d+))?$/.exec(q);
      const line = m?.[1] ? Math.min(Math.max(1, parseInt(m[1], 10)), total) : 0;
      const col = m?.[2] ? parseInt(m[2], 10) : undefined;
      const item: Item = line
        ? {
            value: `line:${line}:${col ?? ''}`,
            title: col ? t('palette.line.goToColumn', { line: String(line), column: String(col) }) : t('palette.line.goTo', { line: String(line) }),
            subtitle: activeFile.path,
            icon: <ListOrdered />,
            right: <CornerDownLeft className="size-3.5 text-fg-subtle" />,
            run: () => close(() => useWorkspace.getState().revealLocation(activeFile.id, line, col)),
          }
        : {
            value: 'line:hint',
            title: t('palette.line.hint', { total: String(total) }),
            subtitle: t('palette.line.current', { file: activeFile.name, line: String(useWorkspace.getState().cursor.line) }),
            icon: <ListOrdered />,
            disabled: true,
          };
      return { groups: [{ items: [item] }], mode, empty: null };
    }

    // ── help ──
    if (mode === 'help') {
      const set = (prefix: string) => () => usePalette.getState().setQuery(prefix);
      const entries: [string, string, LucideIcon, string][] = [
        ['', project ? t('palette.help.goToFile') : t('palette.help.openProject'), project ? FileText : FolderClosed, t('palette.help.typeName')],
        ['>', t('palette.help.runCommand'), SquareTerminal, '>'],
        ['@', t('palette.help.goToSymbol'), Hash, '@'],
        [':', t('palette.help.goToLine'), ListOrdered, ':'],
        ['?', t('palette.help.showHelp'), CircleQuestionMark, '?'],
      ];
      return {
        groups: [
          {
            heading: t('palette.group.prefixes'),
            items: [
              ...entries.map(([prefix, title, Icon, hint]) => ({
                value: `help:${prefix || 'files'}`,
                title,
                icon: <Icon />,
                right: <span className="rounded-md border border-border bg-surface-2 px-1.5 font-mono text-[11px] text-fg-muted">{hint}</span>,
                run: set(prefix),
              })),
              {
                value: 'help:shortcuts',
                title: t('palette.help.allShortcuts'),
                icon: <Keyboard />,
                right: <Kbd keys="Mod-/" />,
                run: () => close(() => usePalette.getState().setShortcutsOpen(true)),
              },
            ],
          },
        ],
        mode,
        empty: null,
      };
    }

    // ── files (in a project) ──
    if (project && session) {
      const all = files.filter((f) => f.kind === 'file');
      const recent = (history.files[session.id] ?? []).filter((id) => id !== activeFileId);
      const fileItem = (f: (typeof all)[number], positions?: number[]): Item => {
        const slash = f.path.lastIndexOf('/');
        const Icon = fileIcon(f.path);
        return {
          value: `file:${f.id}`,
          title: f.name,
          titlePositions: positions,
          titleOffset: slash + 1,
          subtitle: slash > 0 ? f.path.slice(0, slash) : undefined,
          subtitlePositions: positions?.filter((p) => p < slash),
          icon: <Icon className={fileTint[extname(f.path)] ?? ''} />,
          right: f.id === activeFileId ? <span className="text-[11px] text-fg-subtle">{t('palette.current')}</span> : undefined,
          run: goFile(f.id),
        };
      };
      if (!q) {
        const recentFiles = recent.map((id) => all.find((f) => f.id === id)).filter(Boolean).slice(0, 8) as typeof all;
        const rest = all.filter((f) => !recentFiles.includes(f)).slice(0, 150);
        const groups: Group[] = [];
        if (recentFiles.length) groups.push({ heading: t('palette.group.recentlyOpened'), items: recentFiles.map((f) => fileItem(f)) });
        groups.push({ heading: recentFiles.length ? t('palette.group.allFiles') : t('palette.group.files'), items: rest.map((f) => fileItem(f)) });
        return { groups, mode, empty: t('palette.empty.noFiles') };
      }
      const scored = all
        .map((f) => {
          const r = fuzzyPath(q, f.path);
          if (!r) return null;
          const ri = recent.indexOf(f.id);
          return { f, r, score: r.score + (ri >= 0 ? Math.max(0, 1.2 - ri * 0.1) : 0) };
        })
        .filter(Boolean)
        .sort((a, b) => b!.score - a!.score)
        .slice(0, 60) as { f: (typeof all)[number]; r: { positions: number[] } }[];
      const cmdHits = scoreCommands(available, q, history.commands, locale).slice(0, scored.length ? 3 : 6);
      const groups: Group[] = [];
      if (scored.length) groups.push({ heading: t('palette.group.files'), items: scored.map((x) => fileItem(x.f, x.r.positions)) });
      if (cmdHits.length) groups.push({ heading: t('palette.group.commands'), items: cmdHits.map((s) => commandItem(s.c, s.positions, close, true, locale)) });
      return { groups, mode, empty: t('palette.empty.filesNoMatch', { query: q }) };
    }

    // ── dashboard: projects + quick actions ──
    const live = projects.filter((p) => !p.trashed);
    const projectItem = (p: ProjectSummary, positions?: number[]): Item => ({
      value: `project:${p.id}`,
      title: p.name,
      titlePositions: positions,
      subtitle: p.tags?.length ? p.tags.map((t) => `#${t}`).join(' ') : undefined,
      icon: <FolderClosed className={p.starred ? 'text-warning' : ''} />,
      right: <span className="text-[11.5px] text-fg-subtle">{timeAgo(p.openedAt || p.updatedAt)}</span>,
      run: () => close(() => navigate(`/p/${p.id}`)),
    });
    if (!q) {
      const groups: Group[] = [];
      if (live.length) groups.push({ heading: t('palette.group.recentProjects'), items: live.slice(0, 8).map((p) => projectItem(p)) });
      const quick = dashboardQuickCommands.map((id) => available.find((c) => c.id === id)).filter(Boolean) as Cmd[];
      groups.push({ heading: t('palette.group.quickActions'), items: quick.map((c) => commandItem(c, undefined, close, false, locale)) });
      return { groups, mode, empty: null };
    }
    const scored = live
      .map((p) => ({ p, r: fuzzyWords(q, p.name) ?? (p.tags?.some((t) => t.includes(q.toLowerCase())) ? { score: -1, positions: [] } : null) }))
      .filter((x) => x.r)
      .sort((a, b) => b.r!.score - a.r!.score)
      .slice(0, 30);
    const cmdHits = scoreCommands(available, q, history.commands, locale).slice(0, scored.length ? 4 : 8);
    const groups: Group[] = [];
    if (scored.length) groups.push({ heading: t('palette.group.projects'), items: scored.map((x) => projectItem(x.p, x.r!.positions)) });
    if (cmdHits.length) groups.push({ heading: t('palette.group.commands'), items: cmdHits.map((s) => commandItem(s.c, s.positions, close, true, locale)) });
    return { groups, mode, empty: t('palette.empty.nothing', { query: q }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, projects, project, session, files, activeFileId, history, mode, q, symbols, source, locale]);
}

const modeMeta: Record<PaletteMode, { icon: LucideIcon }> = {
  files: { icon: Search },
  commands: { icon: SquareTerminal },
  symbols: { icon: Hash },
  line: { icon: ListOrdered },
  help: { icon: CircleQuestionMark },
};

// ───────────────────────────── view ─────────────────────────────

function Palette() {
  const open = usePalette((s) => s.open);
  const query = usePalette((s) => s.query);
  const setQuery = usePalette((s) => s.setQuery);
  const hide = usePalette((s) => s.hide);
  const inProject = useWorkspace((s) => !!s.project);
  const executed = useRef(false);
  const t = useT();

  const close = (fn: () => void) => {
    executed.current = true;
    hide();
    const prev = consumePrevFocus();
    if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    setTimeout(fn, 0);
  };

  const { groups, mode, empty } = useGroups(query, close);
  const meta = modeMeta[mode];
  const ModeIcon = meta.icon;
  const placeholder = t(`palette.placeholder.${mode === 'files' ? (inProject ? 'files' : 'projects') : mode}`);
  const count = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <D.Root open={open} onOpenChange={(o) => !o && hide()}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[80] bg-black/20 backdrop-blur-[3px] dark:bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
              />
            </D.Overlay>
            <D.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => {
                if (executed.current) e.preventDefault();
                executed.current = false;
              }}
            >
              <motion.div
                className="fixed left-1/2 top-[12vh] z-[81] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 outline-none"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.985 }}
                transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.7 }}
              >
                <D.Title className="sr-only">{t('palette.label')}</D.Title>
                <Command
                  label={t('palette.label')}
                  shouldFilter={false}
                  loop
                  className="overflow-hidden rounded-2xl border border-border bg-elevated/95 shadow-[0_24px_80px_-12px_rgb(0_0_0/0.35),0_0_0_1px_rgb(0_0_0/0.04)] backdrop-blur-2xl dark:shadow-[0_24px_80px_-12px_rgb(0_0_0/0.7)]"
                >
                  <div className="flex h-[52px] items-center gap-3 border-b border-border px-4">
                    <ModeIcon className="size-[18px] shrink-0 text-fg-subtle" />
                    <Command.Input
                      value={query}
                      onValueChange={setQuery}
                      placeholder={placeholder}
                      autoFocus
                      className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-fg-subtle"
                    />
                    <span
                      className={cn(
                        'hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:inline-flex',
                        mode === 'files' ? 'text-fg-subtle' : 'bg-accent-soft text-accent',
                      )}
                    >
                      {t(`palette.mode.${mode === 'files' && !inProject ? 'projects' : mode}`)}
                    </span>
                  </div>
                  <Command.List className="h-[min(440px,var(--cmdk-list-height))] max-h-[min(440px,60vh)] overflow-y-auto overscroll-contain transition-[height] duration-150 ease-out">
                    <div className="p-1.5">
                      {count === 0 && empty && (
                        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-[12.5px] text-fg-subtle">
                          <Search className="size-5 opacity-50" />
                          {empty}
                        </div>
                      )}
                      {groups.map((g, gi) =>
                        g.items.length ? (
                          <Command.Group
                            key={g.heading ?? gi}
                            heading={g.heading}
                            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle"
                          >
                            {g.items.map((it) => (
                              <PaletteItem key={it.value} item={it} />
                            ))}
                          </Command.Group>
                        ) : null,
                      )}
                    </div>
                  </Command.List>
                  <Footer mode={mode} count={count} />
                </Command>
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}

function PaletteItem({ item }: { item: Item }) {
  return (
    <Command.Item
      value={item.value}
      disabled={item.disabled}
      onSelect={() => item.run?.()}
      className="group relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-fg outline-none transition-colors duration-75 data-[disabled=true]:text-fg-muted data-[selected=true]:bg-active/80 data-[disabled=true]:data-[selected=true]:bg-hover"
      style={item.indent ? { paddingLeft: 10 + item.indent * 14 } : undefined}
    >
      <span className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent opacity-0 transition-opacity group-data-[selected=true]:opacity-100" />
      <span className="flex size-5 shrink-0 items-center justify-center text-fg-subtle group-data-[selected=true]:text-fg [&_svg]:size-4">{item.icon}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
        <Highlight text={item.title} positions={item.titlePositions} offset={item.titleOffset ?? 0} className="truncate" />
        {item.subtitle && (
          <Highlight
            text={item.subtitle}
            positions={item.subtitlePositions}
            className="truncate text-[12px] text-fg-subtle"
            markClassName="text-fg-muted"
          />
        )}
      </span>
      {item.right && <span className="ml-2 flex shrink-0 items-center gap-2">{item.right}</span>}
    </Command.Item>
  );
}

function Footer({ mode, count }: { mode: PaletteMode; count: number }) {
  const setQuery = usePalette((s) => s.setQuery);
  const t = useT();
  const chips: [string, string][] = [
    ['>', t('palette.footer.commands')],
    ['@', t('palette.footer.symbols')],
    [':', t('palette.footer.line')],
    ['?', t('palette.footer.help')],
  ];
  return (
    <div className="flex h-9 items-center gap-3 border-t border-border bg-surface-2/50 px-3 text-[11px] text-fg-subtle">
      <span className="flex items-center gap-1">
        <kbd className="rounded border border-border bg-surface px-1 font-sans">↑</kbd>
        <kbd className="rounded border border-border bg-surface px-1 font-sans">↓</kbd>
        {t('palette.footer.navigate')}
      </span>
      <span className="flex items-center gap-1">
        <kbd className="rounded border border-border bg-surface px-1 font-sans">↵</kbd>
        {mode === 'help' ? t('palette.footer.pick') : t('palette.footer.open')}
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        <kbd className="rounded border border-border bg-surface px-1 font-sans">esc</kbd>
        {t('palette.footer.close')}
      </span>
      <span className="flex-1" />
      <span className="hidden items-center gap-1 md:flex">
        {chips.map(([p, label]) => (
          <button
            key={p}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQuery(p)}
            className={cn(
              'rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover hover:text-fg',
              modeOf(p) === mode && 'bg-accent-soft text-accent',
            )}
          >
            <span className="font-mono">{p}</span> {label}
          </button>
        ))}
      </span>
      <span className="tabular-nums md:hidden">{t('palette.footer.results', { count })}</span>
    </div>
  );
}

