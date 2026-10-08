import { useState } from 'react';
import { ArrowRight, Blocks, Cpu, FileArchive, FolderOpen, HardDrive, Laptop, Plus, ShieldCheck, Sparkles, Users } from 'lucide-react';
import type { ProjectTemplate } from '@texit/core';
import { useTemplates } from '@/services/templates';
import { createProject } from '@/services/projects';
import { isDesktop } from '@/lib/platform';
import { useLocale, useT, t as tr } from '@/lib/i18n';
import { Button, Kbd, toast } from '@/ui';
import { HeroVisual } from './HeroVisual';
import { Cover } from './Paper';
import { accentColor, defaultProjectName, featuredTemplates, templateBackground, templateDescription, templateName, templatePreview } from './templates';
import { useDashboardUi } from './store';
import * as actions from './actions';

const features = [
  { icon: ShieldCheck, id: 'local' },
  { icon: Users, id: 'realtime' },
  { icon: Sparkles, id: 'ai' },
  { icon: Blocks, id: 'plugins' },
  { icon: Cpu, id: 'compile' },
  { icon: Laptop, id: 'desktop' },
];

export function Hero() {
  const templates = useTemplates((s) => s.templates);
  const picks = featuredTemplates(templates, 6);
  const [busy, setBusy] = useState<string | null>(null);
  const t = useT();
  const locale = useLocale();

  const quickCreate = async (tpl: ProjectTemplate) => {
    if (busy) return;
    setBusy(tpl.id);
    try {
      const id = await createProject({ name: defaultProjectName(tpl), template: tpl });
      actions.openProject(id);
    } catch (err) {
      toast.error(tr('dashboard.toast.createError'), { description: err instanceof Error ? err.message : String(err) });
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <div className="hx-grid" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{ background: 'radial-gradient(60% 70% at 50% 0%, color-mix(in srgb, var(--tx-accent) 14%, transparent), transparent 70%)' }}
      />
      <section className="relative mx-auto grid max-w-[1240px] items-center gap-10 px-5 pb-10 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12 lg:pt-16">
        <div className="min-w-0">
          <div className="hx-rise inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 py-1 pl-1 pr-3 text-[12px] text-fg-muted shadow-xs backdrop-blur" style={{ animationDelay: '0.05s' }}>
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">{t('dashboard.hero.badge')}</span>
            {t('dashboard.hero.badgeMeta')}
          </div>
          <h1 className="hx-rise mt-5 text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] text-fg sm:text-[50px] xl:text-[56px]" style={{ animationDelay: '0.12s' }}>
            {t('dashboard.hero.titleLine1')}
            <br />
            <span className="text-gradient">{t('dashboard.hero.titleLine2')}</span>
          </h1>
          <p className="hx-rise mt-5 max-w-[540px] text-[15px] leading-relaxed text-fg-muted sm:text-[16px]" style={{ animationDelay: '0.2s' }}>
            {t('dashboard.hero.lead')}
          </p>
          <div className="hx-rise mt-7 flex flex-wrap items-center gap-2.5" style={{ animationDelay: '0.28s' }}>
            <Button size="lg" variant="gradient" icon={<Plus />} onClick={() => useDashboardUi.getState().openNewProject()} className="h-11 rounded-xl px-5 text-[14px]">
              {t('dashboard.newProject')}
              <Kbd keys="Mod-Alt-n" className="ml-1 hidden sm:inline-flex [&_kbd]:border-white/25 [&_kbd]:bg-white/15 [&_kbd]:text-white/90" />
            </Button>
            <Button size="lg" variant="secondary" icon={<FileArchive />} onClick={() => void actions.pickAndImportZip()} className="h-11 rounded-xl px-4 text-[14px]">
              {t('dashboard.hero.importZip')}
            </Button>
            {isDesktop && (
              <Button size="lg" variant="ghost" icon={<FolderOpen />} onClick={() => void actions.openFolderDesktop()} className="h-11 rounded-xl px-4 text-[14px]">
                {t('dashboard.hero.openFolder')}
              </Button>
            )}
          </div>
          <p className="hx-rise mt-3 hidden items-center sm:flex gap-1.5 text-[12px] text-fg-subtle" style={{ animationDelay: '0.32s' }}>
            <HardDrive className="size-3.5" /> {t('dashboard.hero.dropHint')}
          </p>

          <div className="hx-rise mt-9 grid gap-x-6 gap-y-4 sm:grid-cols-2" style={{ animationDelay: '0.4s' }}>
            {features.map((f) => (
              <div key={f.id} className="flex gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent shadow-xs">
                  <f.icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-fg">{t(`dashboard.hero.feature.${f.id}.title`)}</div>
                  <div className="text-[12px] leading-snug text-fg-subtle">{t(`dashboard.hero.feature.${f.id}.text`)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hx-rise min-w-0 lg:-mr-4" style={{ animationDelay: '0.25s' }}>
          <HeroVisual />
        </div>
      </section>

      {picks.length > 0 && (
        <section className="relative mx-auto max-w-[1240px] px-5 pb-16 sm:px-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-fg">{t('dashboard.hero.templatesTitle')}</h2>
              <p className="text-[12.5px] text-fg-subtle">{t('dashboard.hero.templatesSubtitle')}</p>
            </div>
            <Button variant="ghost" size="sm" iconRight={<ArrowRight />} onClick={() => useDashboardUi.getState().openNewProject()}>
              {t('dashboard.hero.browseTemplates')}
            </Button>
          </div>
          <div className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
            {picks.map((tpl, i) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => void quickCreate(tpl)}
                disabled={!!busy}
                className="hx-rise group w-[170px] shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-surface text-left outline-none transition-[transform,box-shadow,border] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_12px_30px_-14px_rgb(0_0_0/0.35)] focus-visible:ring-3 focus-visible:ring-accent/35 disabled:opacity-60 sm:w-auto"
                style={{ animationDelay: `${0.45 + i * 0.05}s` }}
              >
                <Cover background={templateBackground(tpl)} preview={templatePreview(tpl)} title={tpl.name} accent={accentColor(tpl.accent)} className="aspect-[4/3] border-b border-border" />
                <div className="px-3 py-2.5">
                  <div className="truncate text-[12.5px] font-semibold text-fg">{busy === tpl.id ? t('dashboard.hero.creating') : templateName(tpl, locale)}</div>
                  <div className="truncate text-[11.5px] text-fg-subtle">{templateDescription(tpl, locale)}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
