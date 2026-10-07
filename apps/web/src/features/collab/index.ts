/**
 * Collaboration feature: serverless real-time collaboration (Yjs over
 * Trystero/WebRTC, end-to-end encrypted), presence, follow mode, chat and
 * review comments.
 */
import { Link2, MessageCircle, MessageSquarePlus, MessageSquareText, Pause, RefreshCw, Users, UserX } from 'lucide-react';
import type { Disposable, ProjectDoc } from '@texit/core';
import { registerCommands } from '@/services/commands';
import { registerPanel, registerStatusItem, type PanelContribution } from '@/services/panels';
import { contributeEditorExtension, getEditorBridge } from '@/services/editor';
import { useLayout, useWorkspace } from '@/state/workspace';
import { toast } from '@/ui';
import { initCollabSessions, isViewOnly, openShareDialog, reconnectNow, setPaused, isPaused, useCollab } from './session';
import { CollabStatusItem } from './StatusItem';
import { ChatPanel } from './ChatPanel';
import { CommentsPanel } from './CommentsPanel';
import { commentsExtension, viewOnlyExtension } from './editorExtensions';
import { countUnread, getChat, isValidMessage } from './chat';
import { listThreads, lineCol } from './comments';
import { useCollabSettings } from './settings';
import { copyInviteLink } from './ShareDialog';
import { stopFollowing } from './follow';

export { getProvider, useCollab, startSharing, stopSharing, inviteLink } from './session';
export { TrysteroProvider } from './provider';

const inProject = () => !!useWorkspace.getState().project;
const isShared = () => !!useCollab.getState().record;

const chatVisible = () => {
  const l = useLayout.getState();
  return l.sidebarOpen && l.sidebarPanel === 'chat' && l.focusMode === 'none';
};

/** Panels re-register when their badge changes so the activity bar re-renders. */
function badgePanel(base: Omit<PanelContribution, 'badge'>, badge: () => number | null): () => void {
  let d: Disposable = registerPanel({ ...base, badge });
  let last = badge();
  const unsub = useCollab.subscribe(() => {
    const v = badge();
    if (v === last) return;
    last = v;
    d.dispose();
    d = registerPanel({ ...base, badge });
  });
  return () => {
    unsub();
    d.dispose();
  };
}

/** Track unread chat + open comment counts of the open project. */
function watchProjectActivity(): () => void {
  let offProject: (() => void) | null = null;
  const attach = (project: ProjectDoc | null, projectId: string | null) => {
    offProject?.();
    offProject = null;
    useCollab.setState({ unreadChat: 0, openComments: 0 });
    if (!project || !projectId) return;
    const chat = getChat(project);
    const updateChat = (e?: { changes: { added: Set<any> } }) => {
      if (chatVisible()) {
        useCollab.setState({ unreadChat: 0 });
        return;
      }
      useCollab.setState({ unreadChat: countUnread(project, projectId) });
      // Toast new messages from others.
      if (e && useCollabSettings.getState().chatToasts) {
        const me = useCollabSettings.getState().localUserId;
        for (const item of e.changes.added) {
          for (const m of item.content.getContent() as unknown[]) {
            if (isValidMessage(m) && m.uid !== me && Date.now() - m.ts < 60_000) {
              toast(m.name, {
                description: m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text,
                action: { label: 'Reply', onClick: () => useLayout.getState().showSidebarPanel('chat') },
              });
            }
          }
        }
      }
    };
    const updateComments = () => useCollab.setState({ openComments: listThreads(project).filter((t) => !t.resolved).length });
    chat.observe(updateChat);
    project.comments.observeDeep(updateComments);
    updateChat();
    updateComments();
    const unLayout = useLayout.subscribe(() => chatVisible() && useCollab.getState().unreadChat && useCollab.setState({ unreadChat: 0 }));
    offProject = () => {
      chat.unobserve(updateChat);
      project.comments.unobserveDeep(updateComments);
      unLayout();
    };
  };
  attach(useWorkspace.getState().project, useWorkspace.getState().session?.id ?? null);
  const unsub = useWorkspace.subscribe((s, prev) => {
    if (s.project !== prev.project) attach(s.project, s.session?.id ?? null);
  });
  return () => {
    unsub();
    offProject?.();
  };
}

/** Read-only editor while the project was joined through a view-only invite. */
function watchViewOnly(): () => void {
  let d: Disposable | null = null;
  const apply = () => {
    const vo = isViewOnly();
    if (vo && !d) d = contributeEditorExtension('collab.viewOnly', viewOnlyExtension());
    else if (!vo && d) {
      d.dispose();
      d = null;
    }
  };
  apply();
  const unsub = useCollab.subscribe((s, prev) => s.record !== prev.record && apply());
  return () => {
    unsub();
    d?.dispose();
  };
}

/** Collab.addComment: open a draft for the current selection (or the current line). */
function addCommentFromSelection() {
  const ws = useWorkspace.getState();
  const project = ws.project;
  const sel = getEditorBridge()?.getSelection();
  if (!project || !sel) {
    toast.message('Open a file and select some text to comment on');
    return;
  }
  const yt = project.getYText(sel.fileId);
  if (!yt) {
    toast.message('Comments can only be added to text files');
    return;
  }
  const text = yt.toString();
  let { from, to } = sel;
  if (from > to) [from, to] = [to, from];
  if (from === to) {
    // No selection: anchor to the whole current line.
    from = text.lastIndexOf('\n', from - 1) + 1;
    const nl = text.indexOf('\n', to);
    to = nl < 0 ? text.length : nl;
  }
  useCollab.setState({
    commentDraft: { fileId: sel.fileId, from, to, quote: text.slice(from, to).slice(0, 500), line: lineCol(text, from).line },
  });
  useLayout.getState().showSidebarPanel('comments');
}

export function activate() {
  const offs: (() => void)[] = [];
  offs.push(initCollabSessions());
  offs.push(
    badgePanel({ id: 'chat', title: 'Chat', location: 'sidebar', icon: MessageCircle, order: 40, component: ChatPanel }, () => useCollab.getState().unreadChat || null),
  );
  offs.push(
    badgePanel(
      { id: 'comments', title: 'Comments', location: 'sidebar', icon: MessageSquareText, order: 35, component: CommentsPanel },
      () => useCollab.getState().openComments || null,
    ),
  );
  const status = registerStatusItem({ id: 'collab.status', align: 'left', order: 5, component: CollabStatusItem });
  const ext = contributeEditorExtension('collab.comments', commentsExtension());
  offs.push(() => status.dispose(), () => ext.dispose(), watchProjectActivity(), watchViewOnly());

  const cmds = registerCommands([
    { id: 'collab.share', title: 'Share project…', category: 'Collaboration', icon: Users, when: inProject, keywords: ['collaborate', 'invite', 'p2p'], run: () => openShareDialog() },
    {
      id: 'collab.copyInvite',
      title: 'Copy invite link',
      category: 'Collaboration',
      icon: Link2,
      when: () => inProject() && isShared(),
      run: () => copyInviteLink(false),
    },
    {
      id: 'collab.copyViewOnlyInvite',
      title: 'Copy view-only invite link',
      category: 'Collaboration',
      icon: Link2,
      when: () => inProject() && isShared(),
      run: () => copyInviteLink(true),
    },
    {
      id: 'collab.togglePause',
      title: 'Pause / resume collaboration',
      category: 'Collaboration',
      icon: Pause,
      when: () => inProject() && isShared(),
      run: () => setPaused(!isPaused()),
    },
    { id: 'collab.reconnect', title: 'Reconnect to collaborators', category: 'Collaboration', icon: RefreshCw, when: () => inProject() && isShared(), run: () => reconnectNow() },
    { id: 'collab.stopFollowing', title: 'Stop following', category: 'Collaboration', icon: UserX, when: () => useCollab.getState().following != null, run: () => stopFollowing() },
    {
      id: 'collab.addComment',
      title: 'Add comment',
      category: 'Collaboration',
      icon: MessageSquarePlus,
      keybinding: 'Mod-Alt-m',
      global: true,
      when: inProject,
      run: addCommentFromSelection,
    },
    { id: 'collab.showChat', title: 'Show chat', category: 'Collaboration', icon: MessageCircle, when: inProject, run: () => useLayout.getState().showSidebarPanel('chat') },
    {
      id: 'collab.showComments',
      title: 'Show comments',
      category: 'Collaboration',
      icon: MessageSquareText,
      when: inProject,
      run: () => useLayout.getState().showSidebarPanel('comments'),
    },
  ]);
  offs.push(() => cmds.dispose());
  if (import.meta.env.DEV) {
    // Debug handle for automated UI checks (never exposes secrets directly; the record is in the store).
    void import('./session').then((m) => ((window as any).__texitCollab = m));
  }
  return () => offs.forEach((off) => off());
}
