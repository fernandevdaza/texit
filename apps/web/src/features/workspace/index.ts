/**
 * Core workspace commands + registration of the built-in panels.
 * Feature owners implement the panel components; registration lives here so
 * the activity bar order stays stable.
 */
import {
  Columns2,
  Files,
  GitCompareArrows,
  History,
  ListTree,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Puzzle,
  ScrollText,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { registerCommands } from '@/services/commands';
import { registerPanel } from '@/services/panels';
import { useLayout, useWorkspace } from '@/state/workspace';
import { navigate } from '@/lib/router';
import { FilesPanel } from '@/features/files/FilesPanel';
import { OutlinePanel } from '@/features/outline/OutlinePanel';
import { SearchPanel } from '@/features/search/SearchPanel';
import { HistoryPanel } from '@/features/history/HistoryPanel';
import { PluginsPanel } from '@/features/plugins/PluginsPanel';
import { ProblemsPanel } from '@/features/compile/ProblemsPanel';
import { LogPanel } from '@/features/compile/LogPanel';
import { promptDialog, toast } from '@/ui';
import { duplicateProject, exportProjectZip } from '@/services/projects';
import { downloadBlob } from '@/lib/format';

const inProject = () => !!useWorkspace.getState().project;

export function activate() {
  const disposables = [
    registerPanel({ id: 'files', title: 'Files', location: 'sidebar', icon: Files, order: 0, component: FilesPanel }),
    registerPanel({ id: 'outline', title: 'Outline', location: 'sidebar', icon: ListTree, order: 10, component: OutlinePanel }),
    registerPanel({ id: 'search', title: 'Search', location: 'sidebar', icon: Search, order: 20, component: SearchPanel }),
    registerPanel({ id: 'history', title: 'History', location: 'sidebar', icon: History, order: 30, component: HistoryPanel }),
    registerPanel({ id: 'plugins', title: 'Plugins', location: 'sidebar', icon: Puzzle, order: 90, component: PluginsPanel }),
    registerPanel({
      id: 'problems',
      title: 'Problems',
      location: 'bottom',
      icon: TriangleAlert,
      order: 0,
      component: ProblemsPanel,
      badge: () => useWorkspace.getState().compile.diagnostics.length || null,
    }),
    registerPanel({ id: 'log', title: 'Raw log', location: 'bottom', icon: ScrollText, order: 10, component: LogPanel }),

    registerCommands([
      // View
      { id: 'view.toggleSidebar', title: 'Toggle sidebar', category: 'View', icon: PanelLeft, keybinding: 'Mod-Shift-b', global: true, run: () => useLayout.getState().toggle('sidebarOpen') },
      { id: 'view.togglePdf', title: 'Toggle PDF preview', category: 'View', icon: PanelRight, keybinding: 'Mod-Alt-p', global: true, run: () => {
        const l = useLayout.getState();
        if (l.focusMode !== 'none') l.set({ focusMode: 'none', pdfOpen: true });
        else l.toggle('pdfOpen');
      } },
      { id: 'view.toggleBottom', title: 'Toggle problems panel', category: 'View', icon: PanelBottom, keybinding: 'Mod-j', global: true, run: () => useLayout.getState().toggle('bottomOpen') },
      { id: 'view.toggleAi', title: 'Toggle AI assistant', category: 'AI', icon: Sparkles, keybinding: 'Mod-l', global: true, run: () => useLayout.getState().toggle('aiOpen') },
      { id: 'view.files', title: 'Show files', category: 'View', icon: Files, keybinding: 'Mod-Shift-e', global: true, run: () => useLayout.getState().showSidebarPanel('files') },
      { id: 'view.outline', title: 'Show document outline', category: 'View', icon: ListTree, keybinding: 'Mod-Shift-o', global: true, run: () => useLayout.getState().showSidebarPanel('outline') },
      { id: 'edit.findInProject', title: 'Find in project', category: 'Edit', icon: Search, keybinding: 'Mod-Shift-f', global: true, run: () => useLayout.getState().showSidebarPanel('search') },
      { id: 'view.history', title: 'Show history & versions', category: 'View', icon: History, run: () => useLayout.getState().showSidebarPanel('history') },
      { id: 'view.plugins', title: 'Manage plugins', category: 'Plugins', icon: Puzzle, run: () => useLayout.getState().showSidebarPanel('plugins') },
      { id: 'view.log', title: 'Show raw compile log', category: 'Compile', icon: ScrollText, run: () => useLayout.getState().showBottomPanel('log') },
      { id: 'view.problems', title: 'Show problems', category: 'Compile', icon: TriangleAlert, run: () => useLayout.getState().showBottomPanel('problems') },
      { id: 'view.layoutSplit', title: 'Layout: editor & PDF', category: 'View', icon: Columns2, run: () => useLayout.getState().set({ focusMode: 'none', pdfOpen: true }) },
      { id: 'view.layoutEditor', title: 'Layout: editor only', category: 'View', run: () => useLayout.getState().set({ focusMode: 'editor' }) },
      { id: 'view.layoutPdf', title: 'Layout: PDF only', category: 'View', run: () => useLayout.getState().set({ focusMode: 'pdf', pdfOpen: true }) },
      { id: 'view.compare', title: 'Compare with previous version', category: 'History', icon: GitCompareArrows, when: inProject, run: () => useLayout.getState().showSidebarPanel('history') },

      // Project
      { id: 'project.home', title: 'Go to all projects', category: 'Project', run: () => navigate('/') },
      {
        id: 'project.rename',
        title: 'Rename project',
        category: 'Project',
        when: inProject,
        run: async () => {
          const ws = useWorkspace.getState();
          const name = await promptDialog({ title: 'Rename project', value: ws.meta?.name ?? '' });
          if (name) ws.project?.setMeta({ name });
        },
      },
      {
        id: 'project.exportZip',
        title: 'Download source as .zip',
        category: 'Project',
        when: inProject,
        run: async () => {
          const id = useWorkspace.getState().session?.id;
          if (!id) return;
          const { name, data } = await exportProjectZip(id);
          downloadBlob(data, name, 'application/zip');
        },
      },
      {
        id: 'project.duplicate',
        title: 'Duplicate project',
        category: 'Project',
        when: inProject,
        run: async () => {
          const id = useWorkspace.getState().session?.id;
          if (!id) return;
          const copy = await duplicateProject(id);
          toast.success('Project duplicated', { action: { label: 'Open', onClick: () => navigate(`/p/${copy}`) } });
        },
      },
    ]),
  ];
  return () => disposables.forEach((d) => d.dispose());
}
