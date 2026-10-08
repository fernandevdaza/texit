/**
 * Files feature: file-tree commands (the panel itself is registered by the
 * workspace feature).
 */
import './i18n';
import { FilePlus, FolderPlus, FolderSearch, Pencil, Star, Upload } from 'lucide-react';
import { isTexPath } from '@texit/core';
import { registerCommands } from '@/services/commands';
import { useWorkspace } from '@/state/workspace';
import { toast } from '@/ui';
import { t } from '@/lib/i18n';
import { requestFilesAction, revealInTree } from './api';

const inProject = () => !!useWorkspace.getState().project;

export function activate(): void | (() => void) {
  const d = registerCommands([
    { id: 'file.new', title: 'New file…', category: 'File', icon: FilePlus, keybinding: 'Mod-Alt-n', global: true, when: inProject, run: () => requestFilesAction({ type: 'newFile' }) },
    { id: 'file.newFolder', title: 'New folder…', category: 'File', icon: FolderPlus, when: inProject, run: () => requestFilesAction({ type: 'newFolder' }) },
    { id: 'file.upload', title: 'Upload files…', category: 'File', icon: Upload, when: inProject, run: () => requestFilesAction({ type: 'upload' }) },
    {
      id: 'file.rename',
      title: 'Rename current file…',
      category: 'File',
      icon: Pencil,
      when: () => !!useWorkspace.getState().activeFileId,
      run: () => requestFilesAction({ type: 'rename', id: useWorkspace.getState().activeFileId ?? undefined }),
    },
    {
      id: 'file.revealActive',
      title: 'Reveal current file in file tree',
      category: 'File',
      icon: FolderSearch,
      when: () => !!useWorkspace.getState().activeFileId,
      run: () => {
        const id = useWorkspace.getState().activeFileId;
        if (id) revealInTree(id);
      },
    },
    {
      id: 'file.setMain',
      title: 'Set current file as main file',
      category: 'File',
      icon: Star,
      when: () => {
        const s = useWorkspace.getState();
        const f = s.files.find((x) => x.id === s.activeFileId);
        return !!f && isTexPath(f.path);
      },
      run: () => {
        const s = useWorkspace.getState();
        const f = s.files.find((x) => x.id === s.activeFileId);
        if (!f || !s.project) return;
        s.project.setMeta({ mainFileId: f.id });
        toast.success(t('files.isNowMain', { name: f.name }));
      },
    },
  ]);
  return () => d.dispose();
}
