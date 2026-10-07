import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { isTexPath, type BibTool, type ProjectMeta, type TexEngine } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { useProjects } from '@/services/projects';
import { isDesktop } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { Badge, Dialog, Input, Select } from '@/ui';
import { TagInput } from '@/ui/TagInput';
import { useSettingsUi } from './store';

const engines: { value: TexEngine; label: string; description: string }[] = [
  { value: 'pdflatex', label: 'pdfLaTeX', description: 'Fastest and most compatible. Ideal for classic documents.' },
  { value: 'xelatex', label: 'XeLaTeX', description: 'Unicode input and system / OpenType fonts via fontspec.' },
  { value: 'lualatex', label: 'LuaLaTeX', description: 'Modern engine with OpenType fonts and Lua scripting.' },
];

const bibTools: { value: BibTool; label: string; description: string }[] = [
  { value: 'auto', label: 'Automatic', description: 'Detect from biblatex / \\bibliography' },
  { value: 'bibtex', label: 'BibTeX', description: 'Classic \\bibliography + .bst styles' },
  { value: 'biber', label: 'Biber', description: 'For biblatex (Unicode, modern styles)' },
  { value: 'none', label: 'None', description: 'Never run a bibliography tool' },
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

  useEffect(() => {
    if (open && !hasProject) setOpen(false);
  }, [open, hasProject, setOpen]);

  return (
    <Dialog
      open={open && hasProject}
      onOpenChange={setOpen}
      title="Project settings"
      description={meta ? <>Applies to “{meta.name}” for everyone collaborating on it.</> : undefined}
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
      <FieldBlock label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && commitName()} />
      </FieldBlock>

      <FieldBlock label="Main document" hint="The file passed to the TeX engine">
        <Select
          value={meta.mainFileId && texFiles.some((f) => f.id === meta.mainFileId) ? meta.mainFileId : AUTO}
          onValueChange={(v) => patch({ mainFileId: v === AUTO ? '' : v })}
          options={[
            { value: AUTO, label: detectedMain ? `Auto-detect (${detectedMain})` : 'Auto-detect' },
            ...texFiles.map((f) => ({ value: f.id, label: <span className="font-mono text-[12px]">{f.path}</span> })),
          ]}
        />
      </FieldBlock>

      <FieldBlock label="TeX engine">
        <div role="radiogroup" aria-label="TeX engine" className="grid gap-2 sm:grid-cols-3">
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
                <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">{e.description}</p>
              </button>
            );
          })}
        </div>
      </FieldBlock>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label="Bibliography">
          <Select value={meta.bibTool ?? 'auto'} onValueChange={(v) => patch({ bibTool: v as BibTool })} options={bibTools} />
        </FieldBlock>
        <FieldBlock label="Compiler">
          <Select
            value={meta.compilerBackend || AUTO}
            onValueChange={(v) => patch({ compilerBackend: v === AUTO ? '' : v })}
            options={[
              { value: AUTO, label: 'App default', description: 'From Settings → Compiler' },
              { value: 'busytex', label: 'In-browser (WASM)' },
              { value: 'native', label: isDesktop ? 'Native TeX' : <span className="flex items-center gap-2">Native TeX <Badge>Desktop</Badge></span>, disabled: !isDesktop },
              { value: 'remote', label: 'Remote server' },
            ]}
          />
        </FieldBlock>
        <FieldBlock label="Spell-check language">
          <Select value={meta.language || 'en-US'} onValueChange={(v) => patch({ language: v })} options={languages} />
        </FieldBlock>
      </div>

      <FieldBlock label="Tags" hint="Organize projects on the dashboard">
        <TagInput value={meta.tags ?? []} onChange={(tags) => patch({ tags })} suggestions={allTags} />
      </FieldBlock>
    </div>
  );
}
