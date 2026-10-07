import { useShallow } from 'zustand/react/shallow';
import { Moon, Settings, Sun, TriangleAlert } from 'lucide-react';
import { usePanelRegistry } from '@/services/panels';
import { executeCommand } from '@/services/commands';
import { useLayout, useWorkspace } from '@/state/workspace';
import { useResolvedTheme, useSettings } from '@/state/settings';
import { cn } from '@/lib/cn';
import { Avatar, Tooltip } from '@/ui';
import { PanelIcon } from './PanelIcon';

const shortcuts: Record<string, string> = {
  files: 'Mod-Shift-e',
  search: 'Mod-Shift-f',
  outline: 'Mod-Shift-o',
};

export function ActivityBar() {
  const panels = usePanelRegistry(useShallow((s) => s.panels.filter((p) => p.location === 'sidebar')));
  usePanelRegistry((s) => s.badgeVersion);
  const { sidebarOpen, sidebarPanel, showSidebarPanel, focusMode } = useLayout();
  const theme = useResolvedTheme((s) => s.theme);
  const { userName, userColor, set } = useSettings();
  const problems = useWorkspace((s) => s.compile.diagnostics.filter((d) => d.severity === 'error').length);

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2">
      {panels.map((p) => {
        const active = sidebarOpen && focusMode === 'none' && sidebarPanel === p.id;
        const badge = p.badge?.();
        return (
          <Tooltip key={p.id} content={p.title} shortcut={shortcuts[p.id]} side="right">
            <button
              aria-label={p.title}
              onClick={() => {
                if (focusMode !== 'none') useLayout.getState().set({ focusMode: 'none' });
                showSidebarPanel(p.id, { toggle: true });
              }}
              className={cn(
                'relative flex size-9 items-center justify-center rounded-lg transition-colors',
                active ? 'bg-accent-soft text-accent' : 'text-fg-subtle hover:bg-hover hover:text-fg',
              )}
            >
              {active && <span className="absolute -left-2 h-5 w-[3px] rounded-r-full bg-accent" />}
              <PanelIcon icon={p.icon} className="size-[18px]" />
              {badge ? (
                <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-fg">
                  {badge}
                </span>
              ) : null}
            </button>
          </Tooltip>
        );
      })}
      <div className="flex-1" />
      <Tooltip content={problems ? `${problems} error${problems > 1 ? 's' : ''}` : 'Problems'} shortcut="Mod-j" side="right">
        <button
          aria-label="Problems"
          onClick={() => useLayout.getState().showBottomPanel('problems', { toggle: true })}
          className={cn(
            'relative flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-hover',
            problems ? 'text-danger' : 'text-fg-subtle hover:text-fg',
          )}
        >
          <TriangleAlert className="size-[18px]" />
          {problems > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
              {problems}
            </span>
          )}
        </button>
      </Tooltip>
      <Tooltip content={theme === 'dark' ? 'Light mode' : 'Dark mode'} side="right">
        <button
          aria-label="Toggle theme"
          onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}
          className="flex size-9 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
        >
          {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
      </Tooltip>
      <Tooltip content="Settings" shortcut="Mod-," side="right">
        <button
          aria-label="Settings"
          onClick={() => executeCommand('app.settings')}
          className="flex size-9 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
        >
          <Settings className="size-[18px]" />
        </button>
      </Tooltip>
      <Tooltip content={`${userName} — edit profile`} side="right">
        <button className="mt-1" onClick={() => executeCommand('app.settings', 'profile')} aria-label="Profile">
          <Avatar name={userName} color={userColor} size={26} />
        </button>
      </Tooltip>
    </nav>
  );
}
