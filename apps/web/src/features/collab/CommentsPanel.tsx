import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, CheckCheck, MessageSquareText, RotateCcw, Trash2, X } from 'lucide-react';
import type { ProjectDoc } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { getEditorBridge } from '@/services/editor';
import { Avatar, Button, EmptyState, IconButton, Kbd, PanelHeader, Segmented, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { formatRelative } from './time';
import {
  addComment,
  deleteComment,
  lineCol,
  listThreads,
  replyToComment,
  resolveRange,
  setCommentResolved,
  type CommentThread,
} from './comments';
import { useCollab } from './session';
import { useCollabSettings } from './settings';

interface ThreadView extends CommentThread {
  path: string;
  line: number;
  from: number;
  to: number;
  orphaned: boolean;
}

/** Re-render on any change to comments or file contents (positions move with edits). */
function useCommentsVersion(project: ProjectDoc | null): number {
  const v = useRef(0);
  return useSyncExternalStore(
    (cb) => {
      if (!project) return () => {};
      let t: ReturnType<typeof setTimeout> | undefined;
      const bump = () => {
        v.current++;
        cb();
      };
      const debounced = () => {
        clearTimeout(t);
        t = setTimeout(bump, 250);
      };
      project.comments.observeDeep(bump);
      const offContent = project.onContentChange(debounced);
      return () => {
        clearTimeout(t);
        project.comments.unobserveDeep(bump);
        offContent();
      };
    },
    () => v.current,
  );
}

function computeThreads(project: ProjectDoc): ThreadView[] {
  const textCache = new Map<string, string>();
  const out: ThreadView[] = [];
  for (const t of listThreads(project)) {
    const node = project.getNode(t.fileId);
    const r = resolveRange(project, t.id);
    let line = 0;
    if (r) {
      let text = textCache.get(t.fileId);
      if (text == null) textCache.set(t.fileId, (text = project.readText(t.fileId)));
      line = lineCol(text, r.from).line;
    }
    out.push({ ...t, path: node?.path ?? '(deleted file)', line, from: r?.from ?? 0, to: r?.to ?? 0, orphaned: !r || r.orphaned });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.from - b.from || a.ts - b.ts);
}

export function revealThread(t: { fileId: string; id: string }) {
  const ws = useWorkspace.getState();
  const project = ws.project;
  if (!project?.has(t.fileId)) return;
  const r = resolveRange(project, t.id);
  const text = project.readText(t.fileId);
  const { line, column } = lineCol(text, r?.from ?? 0);
  useCollab.setState({ activeCommentId: t.id });
  ws.revealLocation(t.fileId, line, column);
  if (!r) return;
  // Select the commented range once the editor shows the file.
  let tries = 0;
  const select = () => {
    const view = getEditorBridge()?.getView();
    const sel = getEditorBridge()?.getSelection();
    if (view && sel?.fileId === t.fileId) {
      const len = view.state.doc.length;
      view.dispatch({ selection: { anchor: Math.min(r.from, len), head: Math.min(r.to, len) }, scrollIntoView: true });
      return;
    }
    if (tries++ < 30) requestAnimationFrame(select);
  };
  requestAnimationFrame(select);
}

function Composer({
  placeholder,
  onSubmit,
  onCancel,
  autoFocus,
  submitLabel = 'Comment',
}: {
  placeholder: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  submitLabel?: string;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => ref.current?.focus());
  }, [autoFocus]);
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text);
    setText('');
  };
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={text}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits (Mod-Enter is the global compile shortcut); Shift+Enter inserts a newline.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/15"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[10.5px] text-fg-subtle">Enter to send · Shift+Enter for a new line</span>
        {onCancel && (
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="xs" variant="primary" disabled={!text.trim()} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function Message({ name, color, ts, text, mine }: { name: string; color: string; ts: number; text: string; mine: boolean }) {
  return (
    <div className="flex gap-2">
      <Avatar name={name} color={color} size={20} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[12px] font-semibold text-fg">
            {name}
            {mine && <span className="font-normal text-fg-subtle"> (you)</span>}
          </span>
          <span className="shrink-0 text-[10.5px] text-fg-subtle">{formatRelative(ts)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg">{text}</div>
      </div>
    </div>
  );
}

function ThreadCard({ t, project, active }: { t: ThreadView; project: ProjectDoc; active: boolean }) {
  const me = useCollabSettings((s) => s.localUserId);
  const [replying, setReplying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={() => revealThread(t)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && revealThread(t)}
      className={cn(
        'group rounded-lg border bg-surface p-2.5 text-left shadow-xs outline-none transition-colors',
        active ? 'border-warning/70 ring-2 ring-warning/20' : 'border-border hover:border-border-strong',
        t.resolved && 'opacity-75',
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="truncate font-mono">
          {t.path}
          {t.line ? `:${t.line}` : ''}
        </span>
        <div className="flex-1" />
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
          {t.resolved ? (
            <IconButton label="Reopen" size="xs" onClick={() => setCommentResolved(project, t.id, false)}>
              <RotateCcw />
            </IconButton>
          ) : (
            <IconButton label="Resolve" size="xs" onClick={() => setCommentResolved(project, t.id, true)}>
              <Check />
            </IconButton>
          )}
          {t.uid === me && (
            <IconButton
              label="Delete thread"
              size="xs"
              onClick={() => {
                deleteComment(project, t.id);
                toast.message('Comment deleted');
              }}
            >
              <Trash2 />
            </IconButton>
          )}
        </div>
      </div>
      {t.quote && (
        <div
          className={cn(
            'mb-2 line-clamp-3 border-l-2 pl-2 font-mono text-[11.5px] leading-relaxed text-fg-muted',
            t.orphaned ? 'border-border line-through decoration-fg-subtle/50' : 'border-warning/70',
          )}
          title={t.orphaned ? 'The commented text was deleted' : undefined}
        >
          {t.quote}
        </div>
      )}
      <div className="space-y-2">
        <Message name={t.name} color={t.color} ts={t.ts} text={t.text} mine={t.uid === me} />
        {t.replies.map((r) => (
          <Message key={r.id} name={r.name} color={r.color} ts={r.ts} text={r.text} mine={r.uid === me} />
        ))}
      </div>
      {t.resolved && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-success">
          <CheckCheck className="size-3.5" /> Resolved{t.resolvedBy ? ` by ${t.resolvedBy}` : ''}
        </div>
      )}
      {!t.resolved && (
        <div className="mt-2">
          {replying ? (
            <Composer
              autoFocus
              placeholder="Reply…"
              submitLabel="Reply"
              onCancel={() => setReplying(false)}
              onSubmit={(text) => {
                replyToComment(project, t.id, text);
                setReplying(false);
              }}
            />
          ) : (
            <button
              className="text-[11.5px] font-medium text-fg-subtle hover:text-accent"
              onClick={(e) => {
                e.stopPropagation();
                setReplying(true);
              }}
            >
              Reply
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DraftCard({ project }: { project: ProjectDoc }) {
  const draft = useCollab((s) => s.commentDraft);
  const path = useWorkspace((s) => (draft ? s.files.find((f) => f.id === draft.fileId)?.path : undefined));
  if (!draft) return null;
  return (
    <div className="mb-2 animate-slide-up rounded-lg border border-accent/50 bg-surface p-2.5 shadow-sm ring-2 ring-accent/10">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <MessageSquareText className="size-3.5 text-accent" />
        <span className="truncate font-mono">
          {path}:{draft.line}
        </span>
        <div className="flex-1" />
        <IconButton label="Discard" size="xs" onClick={() => useCollab.setState({ commentDraft: null })}>
          <X />
        </IconButton>
      </div>
      {draft.quote && <div className="mb-2 line-clamp-3 border-l-2 border-accent/60 pl-2 font-mono text-[11.5px] text-fg-muted">{draft.quote}</div>}
      <Composer
        autoFocus
        placeholder="Add a comment…"
        onCancel={() => useCollab.setState({ commentDraft: null })}
        onSubmit={(text) => {
          const id = addComment(project, { fileId: draft.fileId, from: draft.from, to: draft.to, text, quote: draft.quote });
          useCollab.setState({ commentDraft: null, activeCommentId: id });
        }}
      />
    </div>
  );
}

export function CommentsPanel() {
  const project = useWorkspace((s) => s.project);
  const version = useCommentsVersion(project);
  const treeVersion = useWorkspace((s) => s.treeVersion);
  const active = useCollab((s) => s.activeCommentId);
  const hasDraft = useCollab((s) => !!s.commentDraft);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const threads = useMemo(() => (project ? computeThreads(project) : []), [project, version, treeVersion]);
  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);
  const list = tab === 'open' ? open : resolved;

  if (!project) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Comments" />
      <div className="px-3 pb-2">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          className="[&>div]:w-full [&_button]:flex-1 [&_button]:justify-center"
          options={[
            { value: 'open', label: `Open${open.length ? ` · ${open.length}` : ''}` },
            { value: 'resolved', label: `Resolved${resolved.length ? ` · ${resolved.length}` : ''}` },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        <DraftCard project={project} />
        {list.length === 0 && !hasDraft ? (
          <EmptyState
            icon={<MessageSquareText />}
            title={tab === 'open' ? 'No open comments' : 'No resolved comments'}
            description={
              tab === 'open' ? (
                <>
                  Select text in the editor and press <Kbd keys="Mod-Alt-m" className="align-middle" /> to start a review thread.
                </>
              ) : (
                'Resolved threads show up here.'
              )
            }
          />
        ) : (
          list.map((t) => <ThreadCard key={t.id} t={t} project={project} active={t.id === active} />)
        )}
      </div>
    </div>
  );
}
