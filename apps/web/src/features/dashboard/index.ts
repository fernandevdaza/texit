/**
 * Dashboard feature: project library, first-run hero, new-project gallery,
 * imports (zip / folder / drag & drop) and joining shared projects.
 */
import './i18n';
import { FileArchive, FilePlus2, FolderOpen, LayoutGrid, Link2, Search } from 'lucide-react';
import { registerCommands } from '@/services/commands';
import { useWorkspace } from '@/state/workspace';
import { isDesktop } from '@/lib/platform';
import { focusSearch, useDashboardUi } from './store';
import * as actions from './actions';

const onDashboard = () => {
  if (useWorkspace.getState().project) return false;
  const h = location.hash.replace(/^#/, '').split('?')[0] ?? '';
  return h === '' || h === '/';
};

export function activate() {
  const d = registerCommands([
    {
      id: 'project.new',
      title: 'New project…',
      category: 'Project',
      icon: LayoutGrid,
      keybinding: 'Mod-Alt-n',
      global: true,
      keywords: ['create', 'template', 'gallery'],
      run: (templateId?: unknown) => useDashboardUi.getState().openNewProject(typeof templateId === 'string' ? templateId : undefined),
    },
    {
      id: 'project.newBlank',
      title: 'New blank project',
      category: 'Project',
      icon: FilePlus2,
      keywords: ['create', 'empty'],
      run: () => actions.createBlankProject(),
    },
    {
      id: 'project.importZip',
      title: 'Import project from .zip…',
      category: 'Project',
      icon: FileArchive,
      keywords: ['overleaf', 'upload', 'archive'],
      run: () => actions.pickAndImportZip(),
    },
    {
      id: 'project.openFolder',
      title: 'Open folder as project…',
      category: 'Project',
      icon: FolderOpen,
      when: () => isDesktop,
      keywords: ['directory', 'disk', 'local'],
      run: () => actions.openFolderDesktop(),
    },
    {
      id: 'project.join',
      title: 'Join shared project…',
      category: 'Collaboration',
      icon: Link2,
      keywords: ['invite', 'link', 'collaborate'],
      run: () => useDashboardUi.getState().setJoinOpen(true),
    },
    {
      id: 'dashboard.search',
      title: 'Search projects',
      category: 'Project',
      icon: Search,
      keybinding: 'Mod-k | Mod-f',
      global: true,
      hidden: true,
      when: () => onDashboard() && !document.querySelector('[role=dialog]'),
      run: () => focusSearch.emit(),
    },
  ]);
  return () => d.dispose();
}
