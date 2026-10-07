/**
 * Version history feature: automatic + named snapshots of the project Y.Doc
 * (IndexedDB), diff viewer and restore.
 *
 * Other features can take a checkpoint before risky operations with
 * `executeCommand('history.snapshot', 'Before AI edit')` or by importing
 * `createSnapshot` from '@/features/history/service'.
 */
import { BookmarkPlus, History } from 'lucide-react';
import { registerCommands } from '@/services/commands';
import { useLayout, useWorkspace } from '@/state/workspace';
import { createSnapshot, startHistoryService } from './service';
import { saveNamedVersion } from './actions';

export { createSnapshot } from './service';
export { deleteProjectHistory } from './store';

const inProject = () => !!useWorkspace.getState().project;

export function activate(): () => void {
  const stop = startHistoryService();
  const commands = registerCommands([
    { id: 'history.saveVersion', title: 'Save version…', category: 'History', icon: BookmarkPlus, keybinding: 'Mod-Alt-s', global: true, when: inProject, run: (label?: unknown) => saveNamedVersion(typeof label === 'string' ? label : undefined) },
    {
      id: 'history.show',
      title: 'Show version history',
      category: 'History',
      icon: History,
      when: inProject,
      run: () => {
        const l = useLayout.getState();
        if (l.focusMode !== 'none') l.set({ focusMode: 'none' });
        l.showSidebarPanel('history');
      },
    },
    {
      id: 'history.snapshot',
      title: 'Take a history checkpoint',
      category: 'History',
      hidden: true,
      when: inProject,
      run: (label?: unknown) => createSnapshot({ kind: 'checkpoint', label: typeof label === 'string' ? label : undefined, force: false }),
    },
  ]);
  if (import.meta.env.DEV) {
    void Promise.all([import('./service'), import('./store')]).then(([service, store]) => {
      const debug = { ...service, ...store };
      (window as any).__texitHistory = debug;
      const attach = () => {
        const t = (window as any).__texit;
        if (t) t.history = debug;
        else setTimeout(attach, 250);
      };
      attach();
    });
  }
  return () => {
    stop();
    commands.dispose();
  };
}
