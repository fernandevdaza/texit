/**
 * Search feature: project-wide find & replace commands (the panel is registered
 * by the workspace feature; `edit.findInProject` opens it).
 */
import { Replace } from 'lucide-react';
import { registerCommands } from '@/services/commands';
import { useLayout, useWorkspace } from '@/state/workspace';
import { useSearchUi } from './store';

export function activate(): void | (() => void) {
  const d = registerCommands([
    {
      id: 'edit.replaceInProject',
      title: 'Replace in project',
      category: 'Edit',
      icon: Replace,
      keybinding: 'Mod-Shift-h',
      global: true,
      when: () => !!useWorkspace.getState().project,
      run: () => {
        const l = useLayout.getState();
        if (l.focusMode !== 'none') l.set({ focusMode: 'none' });
        l.showSidebarPanel('search');
        useSearchUi.getState().set({ showReplace: true, focusNonce: Date.now() });
      },
    },
  ]);
  return () => d.dispose();
}
