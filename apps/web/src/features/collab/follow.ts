/**
 * Follow mode: open the file a collaborator is in and keep their cursor in
 * view until the local user takes over (typing, clicking or scrolling in the
 * editor) or presses Escape.
 */
import * as Y from 'yjs';
import { EditorView } from '@codemirror/view';
import { getAwareness, type PeerUser } from '@/services/collab';
import { getEditorBridge, selectionChanged } from '@/services/editor';
import { useWorkspace } from '@/state/workspace';
import { toast } from '@/ui';
import { t } from '@/lib/i18n';
import { useCollab } from './session';
import { fileIdForView, fileIdForYText } from './editorExtensions';

interface FollowState {
  clientId: number;
  name: string;
  offs: (() => void)[];
  lastJump: number;
  raf: number;
}

let follow: FollowState | null = null;

export function isFollowing(clientId?: number) {
  return follow != null && (clientId == null || follow.clientId === clientId);
}

export function stopFollowing() {
  const f = follow;
  if (!f) return;
  follow = null;
  cancelAnimationFrame(f.raf);
  for (const off of f.offs) off();
  if (useCollab.getState().following != null) useCollab.setState({ following: null });
}

export function toggleFollow(clientId: number) {
  if (isFollowing(clientId)) stopFollowing();
  else startFollowing(clientId);
}

export function startFollowing(clientId: number) {
  stopFollowing();
  const aw = getAwareness();
  if (!aw || clientId === aw.clientID) return;
  const state = aw.getStates().get(clientId);
  const name = (state?.user as PeerUser | undefined)?.name ?? t('collab.collaborator');
  const f: FollowState = { clientId, name, offs: [], lastJump: 0, raf: 0 };
  follow = f;
  useCollab.setState({ following: clientId });

  const schedule = () => {
    if (follow !== f || f.raf) return;
    f.raf = requestAnimationFrame(() => {
      f.raf = 0;
      sync(f);
    });
  };
  aw.on('change', schedule);
  f.offs.push(() => aw.off('change', schedule));

  // Any local interaction with the editor ends follow mode.
  const userActed = () => {
    if (performance.now() - f.lastJump > 400) stopFollowing();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopFollowing();
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    if ((e.target as Element | null)?.closest?.('.cm-editor')) stopFollowing();
  };
  const onPointer = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('.cm-editor')) stopFollowing();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mousedown', onPointer, true);
  window.addEventListener('wheel', onPointer, { capture: true, passive: true });
  window.addEventListener('touchstart', onPointer, { capture: true, passive: true });
  const sel = selectionChanged.on(() => userActed());
  f.offs.push(() => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onPointer, true);
    window.removeEventListener('wheel', onPointer, true);
    window.removeEventListener('touchstart', onPointer, true);
    sel.dispose();
  });
  // Stop if the session goes away.
  f.offs.push(
    useWorkspace.subscribe((s, prev) => {
      if (s.session !== prev.session) stopFollowing();
    }),
  );
  sync(f);
}

function sync(f: FollowState) {
  if (follow !== f) return;
  const aw = getAwareness();
  const ws = useWorkspace.getState();
  const project = ws.project;
  if (!aw || !project) return stopFollowing();
  const state = aw.getStates().get(f.clientId);
  if (!state) {
    toast.message(t('collab.followLeft', { name: f.name }));
    return stopFollowing();
  }
  const user = state.user as PeerUser | undefined;
  let fileId = user?.fileId ?? null;
  let pos: number | null = null;
  const head = (state.cursor as { head?: unknown } | null | undefined)?.head;
  if (head) {
    try {
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(head), project.doc);
      if (abs) {
        const owner = fileIdForYText(project, abs.type);
        if (owner) {
          fileId = owner;
          pos = abs.index;
        }
      }
    } catch {
      /* stale cursor */
    }
  }
  if (!fileId || !project.has(fileId)) return;
  if (ws.activeFileId !== fileId) {
    f.lastJump = performance.now();
    ws.openFile(fileId);
  }
  if (pos != null) scrollTo(f, fileId, pos, 0);
}

function scrollTo(f: FollowState, fileId: string, pos: number, tries: number) {
  if (follow !== f) return;
  const view = getEditorBridge()?.getView();
  if (!view || fileIdForView(view) !== fileId) {
    if (tries < 40) requestAnimationFrame(() => scrollTo(f, fileId, pos, tries + 1));
    return;
  }
  f.lastJump = performance.now();
  view.dispatch({ effects: EditorView.scrollIntoView(Math.min(pos, view.state.doc.length), { y: 'nearest', yMargin: 96 }) });
}
