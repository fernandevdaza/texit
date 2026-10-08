import { useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'motion/react';
import {
  Code2,
  Cpu,
  FileText,
  Info,
  Keyboard,
  Palette,
  Puzzle,
  RotateCcw,
  Search,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { defaultSettings, useSettings } from '@/state/settings';
import { cn } from '@/lib/cn';
import { host } from '@/lib/platform';
import { t as tr, useLocale, useT, type Locale, translate } from '@/lib/i18n';
import { Avatar, Button, Dialog, DialogClose, toast } from '@/ui';
import { AiSettings } from '@/features/ai/AiSettings';
import { CollabSettings } from '@/features/collab/CollabSettings';
import { PluginSettings } from '@/features/plugins/PluginSettings';
import { useSettingsUi, type SettingsSection } from './store';
import { ProfileSection } from './sections/Profile';
import { AppearanceSection } from './sections/Appearance';
import { EditorSection } from './sections/Editor';
import { CompilerSection } from './sections/Compiler';
import { PdfSection } from './sections/Pdf';
import { ShortcutsSection } from './sections/Shortcuts';
import { AboutSection } from './sections/About';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import pkg from '../../../package.json';

interface SectionDef {
  id: SettingsSection;
  label: string;
  title?: string;
  description: string;
  icon: LucideIcon;
  group: 'account' | 'preferences' | 'integrations' | 'help';
  keywords: string;
  component: ComponentType;
  reset?: () => void;
}

/** Reset helper with an Undo toast. */
function resetWithUndo(section: 'appearance' | 'editor' | 'compiler' | 'pdf', pick: () => Partial<ReturnType<typeof useSettings.getState>>, apply: () => void) {
  const prev = pick();
  apply();
  toast(tr(`settings.resetDone.${section}`), { action: { label: tr('common.undo'), onClick: () => useSettings.setState(prev) } });
}

const sections: SectionDef[] = [
  {
    id: 'profile',
    label: 'Profile',
    description: 'Your name and color, used for live cursors, comments and history.',
    icon: Users,
    group: 'account',
    keywords: 'name color avatar presence cursor identity user',
    component: ProfileSection,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, accent color and language.',
    icon: Palette,
    group: 'preferences',
    keywords: 'theme dark light system accent color language spanish español locale',
    component: AppearanceSection,
    reset: () =>
      resetWithUndo(
        'appearance',
        () => {
          const s = useSettings.getState();
          return { theme: s.theme, accent: s.accent, locale: s.locale };
        },
        () => useSettings.getState().set({ theme: defaultSettings.theme, accent: defaultSettings.accent, locale: defaultSettings.locale }),
      ),
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Typography, key bindings and editing behavior.',
    icon: Code2,
    group: 'preferences',
    keywords: 'font size family line height vim emacs keymap wrap numbers autocomplete spell brackets tab rich math fold lint',
    component: EditorSection,
    reset: () =>
      resetWithUndo(
        'editor',
        () => ({ editor: useSettings.getState().editor }),
        () => useSettings.setState({ editor: { ...defaultSettings.editor } }),
      ),
  },
  {
    id: 'compiler',
    label: 'Compiler',
    description: 'How and where your documents are built.',
    icon: Cpu,
    group: 'preferences',
    keywords: 'compile latex engine wasm busytex native remote server auto delay synctex draft shell escape texlive cache',
    component: CompilerSection,
    reset: () =>
      resetWithUndo(
        'compiler',
        () => ({ compile: useSettings.getState().compile }),
        () => useSettings.setState({ compile: { ...defaultSettings.compile } }),
      ),
  },
  {
    id: 'pdf',
    label: 'PDF viewer',
    description: 'Preview appearance and source ↔ PDF navigation.',
    icon: FileText,
    group: 'preferences',
    keywords: 'pdf dark invert dim zoom follow cursor double click synctex viewer',
    component: PdfSection,
    reset: () =>
      resetWithUndo(
        'pdf',
        () => ({ pdf: useSettings.getState().pdf }),
        () => useSettings.setState({ pdf: { ...defaultSettings.pdf } }),
      ),
  },
  {
    id: 'ai',
    label: 'AI & agents',
    description: 'Bring your own API keys, local models, or your Codex / Claude / Gemini subscription. MCP servers.',
    icon: Sparkles,
    group: 'integrations',
    keywords: 'ai openai anthropic claude gemini codex ollama local model api key mcp agent assistant',
    component: AiSettings,
  },
  {
    id: 'collab',
    label: 'Collaboration',
    description: 'Peer-to-peer real-time editing — no servers, end-to-end encrypted.',
    icon: Users,
    group: 'integrations',
    keywords: 'collaboration share peer p2p webrtc signaling ice turn invite',
    component: CollabSettings,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    description: 'Extend TexIt with commands, panels, snippets and compilers.',
    icon: Puzzle,
    group: 'integrations',
    keywords: 'plugins extensions install marketplace',
    component: PluginSettings,
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Every command and its key binding.',
    icon: Keyboard,
    group: 'help',
    keywords: 'keyboard shortcuts keybindings hotkeys keys commands',
    component: ShortcutsSection,
  },
  {
    id: 'about',
    label: 'About TexIt',
    description: 'Version, license and credits.',
    icon: Info,
    group: 'help',
    keywords: 'about version license agpl credits update github',
    component: AboutSection,
  },
];

const groupLabels: Record<SectionDef['group'], string | null> = {
  account: null,
  preferences: 'settings.group.preferences',
  integrations: 'settings.group.integrations',
  help: 'settings.group.help',
};

/** Localized label / description of a section (the English strings above are the fallback). */
const sectionLabel = (s: SectionDef, locale: Locale) => translate(locale, `settings.section.${s.id}.label`, undefined, s.label);
const sectionDescription = (s: SectionDef, locale: Locale) => translate(locale, `settings.section.${s.id}.description`, undefined, s.description);

export function SettingsDialog() {
  const open = useSettingsUi((s) => s.open);
  const hide = useSettingsUi((s) => s.hide);
  const t = useT();
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && hide()}
        bare
        title={t('settings.title')}
        width="max-w-[960px]"
        className="h-[min(740px,calc(100dvh-32px))] max-h-none rounded-2xl"
      >
        {open && <SettingsBody />}
      </Dialog>
      <ProjectSettingsDialog />
    </>
  );
}

function SettingsBody() {
  const section = useSettingsUi((s) => s.section);
  const setSection = useSettingsUi((s) => s.setSection);
  const userName = useSettings((s) => s.userName);
  const userColor = useSettings((s) => s.userColor);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const locale = useLocale();

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return sections;
    return sections.filter((s) =>
      [s.label, s.keywords, s.description, sectionLabel(s, locale), sectionDescription(s, locale), translate(locale, `settings.section.${s.id}.keywords`, undefined, '')]
        .join(' ')
        .toLowerCase()
        .includes(f),
    );
  }, [filter, locale]);

  const current = sections.find((s) => s.id === section) ?? sections[1]!;
  const Body = current.component;
  const go = (id: SettingsSection) => {
    setSection(id);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="flex h-full min-h-0 flex-col sm:flex-row">
      {/* ── Nav ── */}
      <nav className="flex shrink-0 flex-col border-b border-border bg-surface-2/60 sm:w-[236px] sm:border-b-0 sm:border-r" aria-label={t('settings.navLabel')}>
        <div className="hidden px-3 pb-2 pt-4 sm:block">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && visible[0]) go(visible[0].id);
                if (e.key === 'Escape' && filter) {
                  e.stopPropagation();
                  setFilter('');
                }
              }}
              placeholder={t('settings.search')}
              spellCheck={false}
              className="h-8 w-full rounded-lg border border-transparent bg-hover pl-8 pr-2 text-[12.5px] text-fg outline-none transition-[border,background,box-shadow] placeholder:text-fg-subtle focus:border-accent focus:bg-surface focus:ring-3 focus:ring-accent/15"
            />
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto px-2 py-2 sm:min-h-0 sm:flex-1 sm:flex-col sm:gap-0 sm:overflow-y-auto sm:overflow-x-visible sm:py-1">
          {visible.length === 0 && <p className="hidden px-3 py-6 text-center text-[12px] text-fg-subtle sm:block">{t('settings.noMatch', { query: filter })}</p>}
          {visible.map((s, i) => {
            const groupStart = i === 0 || visible[i - 1]!.group !== s.group;
            const active = s.id === current.id;
            if (s.id === 'profile') {
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(s.id)}
                  className={cn(
                    'mb-1 hidden w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors sm:flex',
                    active ? 'bg-surface shadow-xs ring-1 ring-border' : 'hover:bg-hover',
                  )}
                >
                  <Avatar name={userName} color={userColor} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-fg">{userName}</span>
                    <span className="block text-[11.5px] text-fg-subtle">{t('settings.profilePresence')}</span>
                  </span>
                </button>
              );
            }
            return (
              <div key={s.id} className="contents">
                {groupStart && groupLabels[s.group] && (
                  <div className="hidden px-2.5 pb-1 pt-3.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle sm:block">{t(groupLabels[s.group]!)}</div>
                )}
                <button
                  type="button"
                  onClick={() => go(s.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
                    active ? 'bg-surface font-medium text-fg shadow-xs ring-1 ring-border' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  <s.icon className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-fg-subtle')} />
                  <span className="whitespace-nowrap">{sectionLabel(s, locale)}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="hidden items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-fg-subtle sm:flex">
          <span>TexIt {host?.appVersion ?? (pkg as { version: string }).version}</span>
          <span>
            {host ? t('settings.platformDesktop') : t('settings.platformWeb')} · {t('settings.localFirst')}
          </span>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-elevated">
        <header className="flex shrink-0 items-start gap-4 border-b border-border px-6 pb-4 pt-5 sm:px-8">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-tight text-fg">{sectionLabel(current, locale)}</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-subtle">{sectionDescription(current, locale)}</p>
          </div>
          {current.reset && (
            <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={current.reset} className="mt-0.5 text-fg-subtle">
              {t('common.reset')}
            </Button>
          )}
          <DialogClose className="-mr-2 mt-0.5 rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-hover hover:text-fg" aria-label={t('settings.close')}>
            <X className="size-4" />
          </DialogClose>
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
            <Body />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
