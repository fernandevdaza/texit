import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { FileArchive, FolderOpen, LayoutGrid, Link2, Search, X } from 'lucide-react';
import type { ProjectTemplate, TexEngine } from '@texit/core';
import { useTemplates } from '@/services/templates';
import { createProject, useProjects } from '@/services/projects';
import { isDesktop } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { t as tr, useLocale, useT } from '@/lib/i18n';
import { Badge, Button, Dialog, DialogClose, Input, Kbd, Select, toast } from '@/ui';
import { Highlight } from '@/ui/Highlight';
import { fuzzyWords } from '@/features/palette/fuzzy';
import { Cover } from './Paper';
import { accentColor, categoryLabel, defaultProjectName, templateBackground, templateCategoryList, templateDescription, templateName, templatePreview } from './templates';
import { useDashboardUi } from './store';
import * as actions from './actions';

const engineOptions = (): { value: TexEngine; label: string; description: string }[] => [
  { value: 'pdflatex', label: 'pdfLaTeX', description: tr('dashboard.engine.pdflatex') },
  { value: 'xelatex', label: 'XeLaTeX', description: tr('dashboard.engine.xelatex') },
  { value: 'lualatex', label: 'LuaLaTeX', description: tr('dashboard.engine.lualatex') },
];

function uniqueName(base: string) {
  const names = new Set(useProjects.getState().projects.filter((p) => !p.trashed).map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

const defaultName = defaultProjectName;

export function NewProjectDialog() {
  const state = useDashboardUi((s) => s.newProject);
  const close = useDashboardUi((s) => s.closeNewProject);
  const t = useT();
  return (
    <Dialog
      open={state.open}
      onOpenChange={(o) => !o && close()}
      bare
      title={t('dashboard.newProject')}
      width="max-w-[1080px]"
      className="h-[min(780px,calc(100dvh-32px))] max-h-none rounded-2xl"
    >
      {state.open && <Gallery initialTemplateId={state.templateId} />}
    </Dialog>
  );
}

function Gallery({ initialTemplateId }: { initialTemplateId?: string }) {
  const templates = useTemplates((s) => s.templates);
  const t = useT();
  const locale = useLocale();
  const categories = useMemo(() => templateCategoryList(templates), [templates]);
  const [category, setCategory] = useState<string>('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string>(() => initialTemplateId ?? templates.find((t) => t.id === 'blank')?.id ?? templates[0]?.id ?? '');
  const selected = templates.find((t) => t.id === selectedId);
  const [name, setName] = useState(() => defaultName(selected));
  const [nameTouched, setNameTouched] = useState(false);
  const [engine, setEngine] = useState<TexEngine>(selected?.engine ?? 'pdflatex');
  const [engineTouched, setEngineTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    if (!nameTouched) setName(defaultName(selected));
    if (!engineTouched) setEngine(selected.engine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (initialTemplateId) requestAnimationFrame(() => nameRef.current?.select());
  }, [initialTemplateId]);

  const visible = useMemo(() => {
    const inCat = templates.filter((tpl) => category === 'all' || tpl.category === category);
    if (!q.trim()) return inCat.map((tpl) => ({ t: tpl, positions: undefined as number[] | undefined }));
    return inCat
      .map((tpl) => {
        const name = templateName(tpl, locale);
        const r =
          fuzzyWords(q, name) ??
          fuzzyWords(
            q,
            `${name} ${tpl.name} ${templateDescription(tpl, locale)} ${tpl.description} ${(tpl.tags ?? []).join(' ')} ${tpl.category} ${categoryLabel({ id: tpl.category, label: tpl.category }, locale)}`,
          );
        return r ? { t: tpl, positions: r.positions.filter((p) => p < name.length), score: r.score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score) as { t: ProjectTemplate; positions?: number[] }[];
  }, [templates, category, q, locale]);

  const create = async (tpl = selected) => {
    if (!tpl || creating) return;
    setCreating(true);
    try {
      const id = await createProject({ name: uniqueName(name.trim() || defaultName(tpl)), template: tpl, engine });
      useDashboardUi.getState().closeNewProject();
      actions.openProject(id);
    } catch (err) {
      toast.error(tr('dashboard.toast.createError'), { description: err instanceof Error ? err.message : String(err) });
      setCreating(false);
    }
  };

  const moveFocus = (from: number, key: string) => {
    const items = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-tpl]') ?? []);
    if (!items.length) return;
    const top = items[0]!.offsetTop;
    const cols = Math.max(1, items.filter((el) => el.offsetTop === top).length);
    const delta = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'ArrowDown' ? cols : -cols;
    const next = items[Math.min(items.length - 1, Math.max(0, from + delta))];
    next?.focus();
    if (next?.dataset.tpl) setSelectedId(next.dataset.tpl);
  };

  const sideItem = (id: string, label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setCategory(id)}
      className={cn(
        'flex h-8 shrink-0 items-center justify-between gap-3 rounded-lg px-2.5 text-[13px] transition-colors',
        category === id ? 'bg-surface font-medium text-fg shadow-xs ring-1 ring-border' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      <span className="text-[11px] tabular-nums text-fg-subtle">{count}</span>
    </button>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void create();
        }
      }}
    >
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <LayoutGrid className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-fg">{t('dashboard.newProject')}</h2>
          <p className="hidden text-[12px] text-fg-subtle sm:block">{t('dashboard.gallery.subtitle')}</p>
        </div>
        <div className="ml-auto w-[min(300px,40vw)]">
          <Input
            icon={<Search />}
            placeholder={t('dashboard.gallery.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                gridRef.current?.querySelector<HTMLElement>('[data-tpl]')?.focus();
              }
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && visible[0]) {
                setSelectedId(visible[0].t.id);
                nameRef.current?.focus();
              }
            }}
          />
        </div>
        <DialogClose className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-hover hover:text-fg" aria-label={t('common.close')}>
          <X className="size-4" />
        </DialogClose>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-border bg-surface-2/60 md:w-[210px] md:border-b-0 md:border-r">
          <div className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
            {sideItem('all', t('dashboard.gallery.allTemplates'), templates.length)}
            {categories.map((c) => sideItem(c.id, categoryLabel(c, locale), templates.filter((tpl) => tpl.category === c.id).length))}
          </div>
          <div className="mt-auto hidden space-y-0.5 border-t border-border p-2 md:block">
            <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">{t('dashboard.gallery.bringYourOwn')}</div>
            <SideAction icon={<FileArchive />} label={t('dashboard.menu.importZip')} onClick={() => (useDashboardUi.getState().closeNewProject(), void actions.pickAndImportZip())} />
            {isDesktop && <SideAction icon={<FolderOpen />} label={t('dashboard.menu.openFolder')} onClick={() => (useDashboardUi.getState().closeNewProject(), void actions.openFolderDesktop())} />}
            <SideAction icon={<Link2 />} label={t('dashboard.gallery.joinWithLink')} onClick={() => (useDashboardUi.getState().closeNewProject(), useDashboardUi.getState().setJoinOpen(true))} />
          </div>
        </aside>

        <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto p-5" role="radiogroup" aria-label={t('dashboard.gallery.templates')}>
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12.5px] text-fg-subtle">
              <Search className="size-5 opacity-50" />
              {t('dashboard.gallery.noMatch', { query: q })}
              <Button size="sm" variant="ghost" onClick={() => (setQ(''), setCategory('all'))}>
                {t('dashboard.gallery.clearFilters')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-4">
              {visible.map(({ t: tpl, positions }, i) => (
                <TemplateCard
                  key={tpl.id}
                  t={tpl}
                  positions={positions}
                  selected={tpl.id === selectedId}
                  index={i}
                  onSelect={() => setSelectedId(tpl.id)}
                  onCreate={() => void create(tpl)}
                  onArrow={moveFocus}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-surface-2/60 px-5 py-3">
        <div className="hidden min-w-0 items-center gap-2 lg:flex">
          <span className="size-3 shrink-0 rounded-full" style={{ background: selected?.accent ?? 'var(--tx-accent)' }} />
          <span className="truncate text-[12.5px] text-fg-muted">
            <span className="font-medium text-fg">{selected ? templateName(selected, locale) : t('dashboard.gallery.template')}</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:ml-4">
          <Input
            ref={nameRef}
            aria-label={t('dashboard.gallery.projectName')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder={t('dashboard.gallery.projectName')}
            className="min-w-0 max-w-[340px]"
          />
          <Select<TexEngine>
            className="w-[132px]"
            value={engine}
            onValueChange={(v) => {
              setEngine(v);
              setEngineTouched(true);
            }}
            options={engineOptions()}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{t('common.cancel')}</Button>
          </DialogClose>
          <Button variant="primary" loading={creating} disabled={!selected} onClick={() => void create()} iconRight={<Kbd keys="Mod-Enter" className="ml-1 [&_kbd]:border-white/25 [&_kbd]:bg-white/15 [&_kbd]:text-white/90" />}>
            {t('dashboard.gallery.create')}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function SideAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] text-fg-muted transition-colors hover:bg-hover hover:text-fg [&_svg]:size-4 [&_svg]:text-fg-subtle">
      {icon}
      {label}
    </button>
  );
}

function TemplateCard({
  t,
  positions,
  selected,
  index,
  onSelect,
  onCreate,
  onArrow,
}: {
  t: ProjectTemplate;
  positions?: number[];
  selected: boolean;
  index: number;
  onSelect: () => void;
  onCreate: () => void;
  onArrow: (from: number, key: string) => void;
}) {
  const preview = templatePreview(t);
  const locale = useLocale();
  const name = templateName(t, locale);
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      data-tpl={t.id}
      tabIndex={selected ? 0 : -1}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.025, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      onClick={onSelect}
      onDoubleClick={onCreate}
      onKeyDown={(e) => {
        if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          onArrow(index, e.key);
        } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          onCreate();
        }
      }}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border bg-surface text-left outline-none transition-[border,box-shadow,transform] duration-200',
        'hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-14px_rgb(0_0_0/0.35)] focus-visible:ring-3 focus-visible:ring-accent/35',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--tx-accent),0_10px_30px_-14px_color-mix(in_srgb,var(--tx-accent)_60%,transparent)]' : 'border-border hover:border-border-strong',
      )}
    >
      <Cover background={templateBackground(t)} preview={preview} title={t.name} accent={accentColor(t.accent)} className="aspect-[4/3] border-b border-border" />
      <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-2">
          <Highlight text={name} positions={positions} className="truncate text-[13px] font-semibold text-fg" />
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-subtle">{templateDescription(t, locale)}</p>
        <div className="mt-auto flex flex-wrap gap-1 pt-2">
          <Badge>{actions.engineLabel[t.engine] ?? t.engine}</Badge>
          {(t.tags ?? []).slice(0, 2).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      </div>
    </motion.button>
  );
}
