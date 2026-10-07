/** Small cross-feature API of the Files panel. */
import { Emitter } from '@/lib/emitter';
import { useLayout } from '@/state/workspace';

export type FilesAction = { type: 'reveal'; id: string } | { type: 'newFile' } | { type: 'newFolder' } | { type: 'upload' } | { type: 'rename'; id?: string };

/** Actions for the Files panel (it may not be mounted yet → kept as pending). */
export const filesActionRequested = new Emitter<FilesAction>();
let pending: FilesAction | null = null;
let mounted = 0;

export function requestFilesAction(action: FilesAction) {
  const l = useLayout.getState();
  if (l.focusMode !== 'none') l.set({ focusMode: 'none' });
  l.showSidebarPanel('files');
  if (mounted) filesActionRequested.emit(action);
  else pending = action;
}

/** Ask the file tree to reveal (expand parents, scroll to, select) a node. */
export function revealInTree(fileId: string) {
  requestFilesAction({ type: 'reveal', id: fileId });
}

/** Called by the Files panel on mount; returns an action requested while it was hidden. */
export function filesPanelMounted(): { pending: FilesAction | null; unmount: () => void } {
  mounted++;
  const p = pending;
  pending = null;
  return { pending: p, unmount: () => void mounted-- };
}
