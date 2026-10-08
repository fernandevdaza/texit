import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { isTexPath, type BibTool, type ProjectMeta, type TexEngine } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { useProjects } from '@/services/projects';
import { isDesktop } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { useT, type TFunction } from '@/lib/i18n';
import { Badge, Dialog, Input, Select } from '@/ui';
import { TagInput } from '@/ui/TagInput';
import { useSettingsUi } from './store';

const engines: { value: TexEngine; label: string }[] = [
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'xelatex', label: 'XeLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' },
];

const bibTools = (t: TFunction): { value: BibTool; label: string; description: string }[] => [
  { value: 'auto', label: t('settings.project.bib.auto'), description: t('settings.project.bib.autoHint') },
  { value: 'bibtex', label: 'BibTeX', description: t('settings.project.bib.bibtexHint') },
  { value: 'biber', label: 'Biber', description: t('settings.project.bib.biberHint') },
  { value: 'none', label: t('common.none'), description: t('settings.project.bib.noneHint') },
];

const languages: { value: string; label: string }[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'es-MX', label: 'Español (Latinoamérica)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'ca-ES', label: 'Català' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'pl-PL', label: 'Polski' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'tr-TR', label: 'Türkçe' },
];

const AUTO = '__auto__';

function FieldBlock({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-fg">{label}</span>
        {hint && <span className="text-[11px] text-fg-subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** `project.settings` — per-project options stored in the project's Y.Doc meta. */
export function ProjectSettingsDialog() {
  const open = useSettingsUi((s) => s.projectOpen);
  const setOpen = useSettingsUi((s) => s.setProjectOpen);
  const meta = useWorkspace((s) => s.meta);
  const hasProject = useWorkspace((s) => !!s.project);
  const t = useT();

  useEffect(() => {
    if (open && !hasProject) setOpen(false);
  }, [open, hasProject, setOpen]);

  return (
    <Dialog
      open={open && hasProject}
      onOpenChange={setOpen}
      title={t('settings.project.title')}
      description={meta ? t('settings.project.description', { name: meta.name }) : undefined}
      icon={<Settings2 />}
      width="max-w-[600px]"
      bodyClassName="px-5 pb-5 pt-3"
    >
      {open && meta && <Body meta={meta} />}
    </Dialog>
  );
}

function Body({ meta }: { meta: ProjectMeta }) {
  const project = useWorkspace((s) => s.project);
  const files = useWorkspace((s) => s.files);
  const projects = useProjects((s) => s.projects);
  const [name, setName] = useState(meta.name);
  const t = useT();
  useEffect(() => setName(meta.name), [meta.name]);

  const patch = (p: Partial<ProjectMeta>) => project?.setMeta(p);
  const texFiles = useMemo(() => files.filter((f) => f.kind === 'file' && isTexPath(f.path)), [files]);
  const detectedMain = useMemo(() => {
    try {
      const id = project?.detectMainFile();
      return files.find((f) => f.id === id)?.path;
    } catch {
      return undefined;
    }
  }, [project, files]);
  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags ?? []))].sort(), [projects]);

  const commitName = () => {
    const n = name.trim();
    if (n && n !== meta.name) patch({ name: n });
    else setName(meta.name);
  };

  return (
    <div className="space-y-5">
      <FieldBlock label={t('settings.project.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && commitName()} />
      </FieldBlock>

      <FieldBlock label={t('settings.project.main')} hint={t('settings.project.mainHint')}>
        <Select
          value={meta.mainFileId && texFiles.some((f) => f.id === meta.mainFileId) ? meta.mainFileId : AUTO}
          onValueChange={(v) => patch({ mainFileId: v === AUTO ? '' : v })}
          options={[
            { value: AUTO, label: detectedMain ? t('settings.project.autoDetectFile', { file: detectedMain }) : t('settings.project.autoDetect') },
            ...texFiles.map((f) => ({ value: f.id, label: <span className="font-mono text-[12px]">{f.path}</span> })),
          ]}
        />
      </FieldBlock>

      <FieldBlock label={t('settings.project.engine')}>
        <div role="radiogroup" aria-label={t('settings.project.engine')} className="grid gap-2 sm:grid-cols-3">
          {engines.map((e) => {
            const active = meta.engine === e.value;
            return (
              <button
                key={e.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patch({ engine: e.value })}
                className={cn(
                  'relative rounded-xl border p-3 text-left transition-[border,box-shadow] focus-visible:ring-3 focus-visible:ring-accent/30',
                  active ? 'border-accent bg-accent-soft/40 shadow-[0_0_0_1px_var(--tx-accent)]' : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-fg">{e.label}</span>
                  {active && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Check className="size-2.5" strokeWidth={3.5} />
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">{t(`settings.project.engine.${e.value}`)}</p>
              </button>
            );
          })}
        </div>
      </FieldBlock>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label={t('settings.project.bibliography')}>
          <Select value={meta.bibTool ?? 'auto'} onValueChange={(v) => patch({ bibTool: v as BibTool })} options={bibTools(t)} />
        </FieldBlock>
        <FieldBlock label={t('settings.project.compiler')}>
          <Select
            value={meta.compilerBackend || AUTO}
            onValueChange={(v) => patch({ compilerBackend: v === AUTO ? '' : v })}
            options={[
              { value: AUTO, label: t('settings.project.appDefault'), description: t('settings.project.appDefaultHint') },
              { value: 'busytex', label: t('settings.compiler.busytex') },
              {
                value: 'native',
                label: isDesktop ? (
                  t('settings.compiler.native')
                ) : (
                  <span className="flex items-center gap-2">
                    {t('settings.compiler.native')} <Badge>{t('settings.desktopBadge')}</Badge>
                  </span>
                ),
                disabled: !isDesktop,
              },
              { value: 'remote', label: t('settings.compiler.remote') },
            ]}
          />
        </FieldBlock>
        <FieldBlock label={t('settings.project.spellLanguage')}>
          <Select value={meta.language || 'en-US'} onValueChange={(v) => patch({ language: v })} options={languages} />
        </FieldBlock>
      </div>

      <FieldBlock label={t('settings.project.tags')} hint={t('settings.project.tagsHint')}>
        <TagInput value={meta.tags ?? []} onChange={(tags) => patch({ tags })} suggestions={allTags} />
      </FieldBlock>
    </div>
  );
}
