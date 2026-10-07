import { useState } from 'react';
import { ArrowRight, Blocks, Cpu, FileArchive, FolderOpen, HardDrive, Laptop, Plus, ShieldCheck, Sparkles, Users } from 'lucide-react';
import type { ProjectTemplate } from '@texit/core';
import { useTemplates } from '@/services/templates';
import { createProject } from '@/services/projects';
import { isDesktop } from '@/lib/platform';
import { Button, Kbd, toast } from '@/ui';
import { HeroVisual } from './HeroVisual';
import { Cover } from './Paper';
import { accentColor, featuredTemplates, templateBackground, templatePreview } from './templates';
import { useDashboardUi } from './store';
import * as actions from './actions';

const features = [
  { icon: ShieldCheck, title: 'Local-first & private', text: 'Projects live on your device. No account, no tracking, works offline.' },
  { icon: Users, title: 'Real-time, serverless', text: 'Peer-to-peer collaboration with live cursors — end-to-end encrypted.' },
  { icon: Sparkles, title: 'AI agents, your way', text: 'Your API keys, local models, or your Codex, Claude & Gemini subscription.' },
  { icon: Blocks, title: 'Plugins & MCP', text: 'Extend the editor, and let external agents read, edit and compile.' },
  { icon: Cpu, title: 'Compile anywhere', text: 'TeX Live in WebAssembly, or native TeX in the desktop app.' },
  { icon: Laptop, title: 'Desktop app', text: 'macOS, Windows & Linux — with real folders on disk.' },
];

export function Hero() {
  const templates = useTemplates((s) => s.templates);
  const picks = featuredTemplates(templates, 6);
  const [busy, setBusy] = useState<string | null>(null);

  const quickCreate = async (t: ProjectTemplate) => {
    if (busy) return;
    setBusy(t.id);
    try {
      const id = await createProject({ name: t.id === 'blank' ? 'Untitled project' : t.name, template: t });
      actions.openProject(id);
    } catch (err) {
      toast.error('Could not create the project', { description: err instanceof Error ? err.message : String(err) });
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
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Open source</span>
            AGPL-3.0 · free forever · no account
          </div>
          <h1 className="hx-rise mt-5 text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] text-fg sm:text-[50px] xl:text-[56px]" style={{ animationDelay: '0.12s' }}>
            Write LaTeX together.
            <br />
            <span className="text-gradient">Keep it yours.</span>
          </h1>
          <p className="hx-rise mt-5 max-w-[540px] text-[15px] leading-relaxed text-fg-muted sm:text-[16px]" style={{ animationDelay: '0.2s' }}>
            TexIt is a fast, beautiful LaTeX editor that lives on your device. Collaborate in real time without servers, compile right in the browser, and
            bring AI agents with your own keys, local models — or your Codex, Claude & Gemini subscription.
          </p>
          <div className="hx-rise mt-7 flex flex-wrap items-center gap-2.5" style={{ animationDelay: '0.28s' }}>
            <Button size="lg" variant="gradient" icon={<Plus />} onClick={() => useDashboardUi.getState().openNewProject()} className="h-11 rounded-xl px-5 text-[14px]">
              New project
              <Kbd keys="Mod-Alt-n" className="ml-1 hidden sm:inline-flex [&_kbd]:border-white/25 [&_kbd]:bg-white/15 [&_kbd]:text-white/90" />
            </Button>
            <Button size="lg" variant="secondary" icon={<FileArchive />} onClick={() => void actions.pickAndImportZip()} className="h-11 rounded-xl px-4 text-[14px]">
              Import .zip
            </Button>
            {isDesktop && (
              <Button size="lg" variant="ghost" icon={<FolderOpen />} onClick={() => void actions.openFolderDesktop()} className="h-11 rounded-xl px-4 text-[14px]">
                Open folder
              </Button>
            )}
          </div>
          <p className="hx-rise mt-3 hidden items-center sm:flex gap-1.5 text-[12px] text-fg-subtle" style={{ animationDelay: '0.32s' }}>
            <HardDrive className="size-3.5" /> Overleaf export? Drop the .zip or a folder anywhere on this page.
          </p>

          <div className="hx-rise mt-9 grid gap-x-6 gap-y-4 sm:grid-cols-2" style={{ animationDelay: '0.4s' }}>
            {features.map((f) => (
              <div key={f.title} className="flex gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent shadow-xs">
                  <f.icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-fg">{f.title}</div>
                  <div className="text-[12px] leading-snug text-fg-subtle">{f.text}</div>
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
              <h2 className="text-[15px] font-semibold tracking-tight text-fg">Start from a template</h2>
              <p className="text-[12.5px] text-fg-subtle">One click and you’re writing.</p>
            </div>
            <Button variant="ghost" size="sm" iconRight={<ArrowRight />} onClick={() => useDashboardUi.getState().openNewProject()}>
              Browse all templates
            </Button>
          </div>
          <div className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
            {picks.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void quickCreate(t)}
                disabled={!!busy}
                className="hx-rise group w-[170px] shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-surface text-left outline-none transition-[transform,box-shadow,border] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_12px_30px_-14px_rgb(0_0_0/0.35)] focus-visible:ring-3 focus-visible:ring-accent/35 disabled:opacity-60 sm:w-auto"
                style={{ animationDelay: `${0.45 + i * 0.05}s` }}
              >
                <Cover background={templateBackground(t)} preview={templatePreview(t)} title={t.name} accent={accentColor(t.accent)} className="aspect-[4/3] border-b border-border" />
                <div className="px-3 py-2.5">
                  <div className="truncate text-[12.5px] font-semibold text-fg">{busy === t.id ? 'Creating…' : t.name}</div>
                  <div className="truncate text-[11.5px] text-fg-subtle">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
