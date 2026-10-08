import { useLocation } from 'wouter';
import {
  ChevronDown,
  Columns2,
  Copy,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  LayoutPanelLeft,
  PanelRight,
  Pencil,
  Search,
  Settings2,
  Sparkles,
  SquareSplitHorizontal,
} from 'lucide-react';
import { useLayout, useWorkspace } from '@/state/workspace';
import { executeCommand } from '@/services/commands';
import { host, isDesktop, isMac } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { DropdownMenu, IconButton, Kbd, Logo, Segmented, Tooltip } from '@/ui';
import { CompileButton } from '@/features/compile/CompileButton';
import { ShareButton } from '@/features/collab/ShareButton';
import { PresenceAvatars } from '@/features/collab/PresenceAvatars';

export function TopBar() {
  const [, navigate] = useLocation();
  const name = useWorkspace((s) => s.meta?.name ?? '');
  const { focusMode, set, aiOpen, toggle } = useLayout();
  const t = useT();

  return (
    <header
      className={cn(
        'app-drag relative z-20 flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface/85 pr-2 backdrop-blur-xl',
        isDesktop && isMac ? 'pl-[78px]' : 'pl-2',
      )}
    >
      <div className="app-no-drag flex min-w-0 items-center gap-1">
        <Tooltip content={t('workspace.allProjects')}>
          <button
            onClick={() => navigate('/')}
            className="flex size-8 items-center justify-center rounded-lg transition-transform hover:scale-105 active:scale-95"
            aria-label={t('workspace.allProjects')}
          >
            <Logo size={22} />
          </button>
        </Tooltip>
        <span className="text-fg-subtle/60">/</span>
        <DropdownMenu
          trigger={
            <button className="flex h-8 min-w-0 max-w-[340px] items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-fg transition-colors hover:bg-hover">
              <span className="truncate">{name || t('common.untitled')}</span>
              <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
            </button>
          }
          items={[
            { label: t('workspace.renameProjectMenu'), icon: <Pencil />, onSelect: () => executeCommand('project.rename') },
            { label: t('workspace.projectSettings'), icon: <Settings2 />, onSelect: () => executeCommand('project.settings') },
            { type: 'separator' },
            { label: t('workspace.downloadSourceZip'), icon: <Download />, onSelect: () => executeCommand('project.exportZip') },
            { label: t('workspace.downloadPdf'), icon: <FileDown />, onSelect: () => executeCommand('pdf.download') },
            { label: t('workspace.duplicateProject'), icon: <Copy />, onSelect: () => executeCommand('project.duplicate') },
            ...(host ? [{ label: t('workspace.revealMirror'), icon: <FolderOpen />, onSelect: () => executeCommand('desktop.revealMirror') }] : []),
            { type: 'separator' as const },
            { label: t('workspace.allProjects'), icon: <FileText />, onSelect: () => navigate('/') },
          ]}
        />
      </div>

      {/* Center: command / search launcher */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <button
          onClick={() => executeCommand('view.commandPalette')}
          className="app-no-drag pointer-events-auto hidden h-7 w-[min(360px,32vw)] items-center gap-2 rounded-lg border border-border bg-surface-2/70 px-2.5 text-[12px] text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted lg:flex"
        >
          <Search className="size-3.5" />
          <span className="flex-1 truncate text-left">{t('workspace.searchLauncher')}</span>
          <Kbd keys="Mod-Shift-p" />
        </button>
      </div>

      <div className="flex-1" />

      <div className="app-no-drag flex items-center gap-1.5">
        <PresenceAvatars />
        <ShareButton />
        <div className="mx-1 h-5 w-px bg-border" />
        <Segmented
          size="sm"
          value={focusMode === 'none' ? 'split' : focusMode}
          onChange={(v) => set({ focusMode: v === 'split' ? 'none' : (v as 'editor' | 'pdf'), ...(v !== 'editor' ? { pdfOpen: true } : {}) })}
          options={[
            { value: 'editor', label: '', icon: <LayoutPanelLeft />, title: t('workspace.editorOnly') },
            { value: 'split', label: '', icon: <Columns2 />, title: t('workspace.editorAndPdf') },
            { value: 'pdf', label: '', icon: <SquareSplitHorizontal />, title: t('workspace.pdfOnly') },
          ]}
        />
        <CompileButton />
        <IconButton label={aiOpen ? t('workspace.hideAiAssistant') : t('workspace.aiAssistant')} shortcut="Mod-l" active={aiOpen} onClick={() => toggle('aiOpen')} size="md">
          <Sparkles className={cn(aiOpen && 'text-accent')} />
        </IconButton>
        <IconButton label={t('workspace.togglePdf')} shortcut="Mod-Alt-p" onClick={() => executeCommand('view.togglePdf')} size="md" className="hidden xl:inline-flex">
          <PanelRight />
        </IconButton>
      </div>
    </header>
  );
}
