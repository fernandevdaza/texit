/**
 * CodeMirror contributions of the collaboration feature:
 *   - comment highlights (decorations read from `project.comments`)
 *   - read-only mode for view-only invites (best-effort)
 */
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { EditorState, StateEffect, type Extension, type Range } from '@codemirror/state';
import { ySyncFacet } from 'y-codemirror.next';
import type * as Y from 'yjs';
import type { ProjectDoc } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { getEditorBridge } from '@/services/editor';
import { listThreads, resolveRange } from './comments';
import { useCollab } from './session';

/** The file id a CodeMirror view is editing (y-sync binding → editor bridge → active file). */
export function fileIdForView(view: EditorView): string | null {
  const project = useWorkspace.getState().project;
  if (!project) return null;
  try {
    const conf = view.state.facet(ySyncFacet) as { ytext?: Y.Text } | undefined;
    const yt = conf?.ytext;
    if (yt) {
      const key = (yt as unknown as { _item?: { parentSub?: string } })._item?.parentSub;
      if (typeof key === 'string' && project.texts.get(key) === yt) return key;
      for (const [id, t] of project.texts.entries()) if (t === yt) return id;
    }
  } catch {
    /* facet not present */
  }
  const bridge = getEditorBridge();
  if (bridge?.getView() === view) {
    const sel = bridge.getSelection();
    if (sel?.fileId) return sel.fileId;
  }
  return useWorkspace.getState().activeFileId;
}

/** The file id that owns a Y.Text (texts map key). */
export function fileIdForYText(project: ProjectDoc, yt: unknown): string | null {
  const key = (yt as { _item?: { parentSub?: string } } | null)?._item?.parentSub;
  if (typeof key === 'string' && project.texts.get(key) === yt) return key;
  for (const [id, t] of project.texts.entries()) if (t === yt) return id;
  return null;
}

const refreshComments = StateEffect.define<null>();

const commentMark = (id: string, active: boolean) =>
  Decoration.mark({
    class: active ? 'cm-tx-comment cm-tx-comment-active' : 'cm-tx-comment',
    attributes: { 'data-comment-id': id },
  });

const commentsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    private raf = 0;
    private offs: (() => void)[] = [];
    private unobserve: (() => void) | null = null;

    constructor(readonly view: EditorView) {
      this.observe(useWorkspace.getState().project);
      this.offs.push(
        useWorkspace.subscribe((s, prev) => {
          if (s.project !== prev.project) {
            this.observe(s.project);
            this.schedule();
          }
        }),
        useCollab.subscribe((s, prev) => {
          if (s.activeCommentId !== prev.activeCommentId) this.schedule();
        }),
      );
      this.decorations = this.build();
    }

    observe(project: ProjectDoc | null) {
      this.unobserve?.();
      this.unobserve = null;
      if (!project) return;
      const h = () => this.schedule();
      project.comments.observeDeep(h);
      this.unobserve = () => project.comments.unobserveDeep(h);
    }

    schedule() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        try {
          this.view.dispatch({ effects: refreshComments.of(null) });
        } catch {
          /* view destroyed */
        }
      });
    }

    update(u: ViewUpdate) {
      if (u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshComments)))) this.decorations = this.build();
      else if (u.docChanged) {
        this.decorations = this.decorations.map(u.changes);
        // Re-anchor from Yjs once the edit has settled (positions follow remote edits exactly).
        this.schedule();
      }
    }

    build(): DecorationSet {
      const project = useWorkspace.getState().project;
      if (!project || project.comments.size === 0) return Decoration.none;
      const fileId = fileIdForView(this.view);
      if (!fileId) return Decoration.none;
      const active = useCollab.getState().activeCommentId;
      const len = this.view.state.doc.length;
      const ranges: Range<Decoration>[] = [];
      for (const t of listThreads(project)) {
        if (t.fileId !== fileId || t.resolved) continue;
        const r = resolveRange(project, t.id);
        if (!r || r.to <= r.from) continue;
        const from = Math.min(r.from, len);
        const to = Math.min(r.to, len);
        if (to > from) ranges.push(commentMark(t.id, t.id === active).range(from, to));
      }
      return Decoration.set(ranges, true);
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.unobserve?.();
      for (const off of this.offs) off();
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e) {
        const el = (e.target as HTMLElement | null)?.closest?.('[data-comment-id]');
        const id = el?.getAttribute('data-comment-id') ?? null;
        if (id !== useCollab.getState().activeCommentId) useCollab.setState({ activeCommentId: id });
        return false;
      },
    },
  },
);

const commentsTheme = EditorView.baseTheme({
  '.cm-tx-comment': {
    backgroundColor: 'rgba(250, 204, 21, 0.16)',
    borderBottom: '2px solid rgba(234, 179, 8, 0.55)',
    cursor: 'pointer',
  },
  '.cm-tx-comment-active': {
    backgroundColor: 'rgba(250, 204, 21, 0.36)',
    borderBottomColor: 'rgb(234, 179, 8)',
  },
  '&dark .cm-tx-comment': { backgroundColor: 'rgba(250, 204, 21, 0.10)' },
  '&dark .cm-tx-comment-active': { backgroundColor: 'rgba(250, 204, 21, 0.24)' },
});

export function commentsExtension(): Extension {
  return [commentsPlugin, commentsTheme];
}

/** Best-effort read-only editor for view-only invites (P2P can't enforce it). */
export function viewOnlyExtension(): Extension {
  return [
    EditorState.readOnly.of(true),
    EditorView.theme({ '.cm-content': { caretColor: 'transparent' } }),
  ];
}
